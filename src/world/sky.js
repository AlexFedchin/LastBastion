// Sky dome (domain-warped storm clouds lit from below by the burning city,
// lightning glowing inside them), lightning bolts on the horizon, rain and
// the searchlight beam shader.
import * as THREE from 'three';
import { WORLD } from '../config.js';
import { makeRng } from '../core/util.js';
import { groundH } from './terrain.js';
import { GLOW_RGB } from '../render/atmosphere.js';

export const NOISE_GLSL = /* glsl */`
float zHash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float zNoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float a = zHash(i), b = zHash(i + vec2(1.0, 0.0)), c = zHash(i + vec2(0.0, 1.0)), d = zHash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float zFbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ v += a * zNoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return v; }
`;

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const SKY_FRAG = /* glsl */`
${NOISE_GLSL}
varying vec3 vDir;
uniform float uTime;
uniform float uFlash;
uniform vec3 uFlashDir;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform float uGlowAmt;
uniform float uCloudLight;
void main(){
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uZenith, smoothstep(-0.02, 0.45, h));
  vec2 dxz = normalize(d.xz + 1e-5);
  float toward = max(0.0, -dxz.y);
  float glow = toward * toward * exp(-max(h, 0.0) * 13.0) * uGlowAmt;
  float dome = pow(toward, 3.0) * exp(-max(h, 0.0) * 3.5) * uGlowAmt;
  col += uGlow * (glow + dome * 0.18);
  // storm deck
  float ph = max(h, 0.0) + 0.055;
  vec2 uv = d.xz / ph * 0.5 + vec2(uTime * 0.0042, uTime * 0.0017);
  vec2 w = vec2(zFbm(uv * 0.7 + 3.1), zFbm(uv * 0.7 + 7.3 + uTime * 0.002));
  float c = zFbm(uv * 1.15 + w * 1.6);
  float c2 = zFbm(uv * 3.2 + w * 0.7 + 11.0);
  float dens = smoothstep(0.34, 0.74, c * 0.82 + c2 * 0.3) * smoothstep(-0.01, 0.09, h);
  // undersides lit by the fires: strongest towards the city, thin edges glow
  float under = (glow * 2.4 + dome * 1.3 + 0.03 * uGlowAmt) * (0.45 + c2 * 1.0) * (1.25 - dens * 0.5);
  vec3 cloudCol = vec3(0.0065, 0.007, 0.0095) * uCloudLight * (0.55 + 0.9 * c2) + uGlow * under;
  float fl = uFlash * (0.2 + 0.8 * pow(max(dot(d, uFlashDir), 0.0), 5.0));
  cloudCol += fl * vec3(0.55, 0.62, 0.86) * (0.35 + c * 1.3);
  col = mix(col, cloudCol, dens * 0.96);
  col += fl * 0.04 * vec3(0.6, 0.65, 0.8);
  col = mix(col, uHorizon + uGlow * glow, smoothstep(0.02, -0.06, h));
  gl_FragColor = vec4(col, 1.0);
}`;

export function buildSky(env) {
  env.skyUniforms = {
    uTime: { value: 0 },
    uFlash: { value: 0 },
    uFlashDir: { value: new THREE.Vector3(0, 0.5, -1).normalize() },
    uZenith: { value: new THREE.Color(0.0025, 0.003, 0.0055) },
    uHorizon: { value: env.nightFog.clone() },
    uGlow: { value: new THREE.Color(...GLOW_RGB) },
    uGlowAmt: { value: 1 },
    uCloudLight: { value: 1 },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1500, 48, 24),
    new THREE.ShaderMaterial({ uniforms: env.skyUniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false })
  );
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  env.sky = sky;
  env.scene.add(sky);
}

export function buildEnvMap(env) {
  const pm = new THREE.PMREMGenerator(env.renderer);
  const envScene = new THREE.Scene();
  const s = env.sky.clone();
  s.material = env.sky.material.clone();
  s.material.uniforms = THREE.UniformsUtils.clone(env.skyUniforms);
  s.material.uniforms.uGlow.value.setRGB(0.55, 0.15, 0.04);
  s.material.uniforms.uZenith.value.setRGB(0.02, 0.025, 0.04);
  s.material.uniforms.uHorizon.value.setRGB(0.05, 0.05, 0.06);
  envScene.add(s);
  const rt = pm.fromScene(envScene, 0.04, 1, 2000);
  env.scene.environment = rt.texture;
  env.scene.environmentIntensity = 0.55;
  pm.dispose();
}

// ── lightning bolt ribbons ──────────────────────────────────────────────────
export class Bolts {
  constructor(scene) {
    const MAXV = 1400;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAXV * 3);
    this.alpha = new Float32Array(MAXV);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aA', new THREE.BufferAttribute(this.alpha, 1));
    this.geo.setDrawRange(0, 0);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uI: { value: 0 } },
      vertexShader: 'attribute float aA; varying float vA; void main(){ vA = aA; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float uI; varying float vA; void main(){ gl_FragColor = vec4(vec3(0.75, 0.82, 1.0) * uI * vA, 1.0); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    scene.add(this.mesh);
    this.rng = makeRng(17);
    this.t = 0;
  }

  /** Strike somewhere out on the horizon; returns the direction for the sky glow. */
  strike(cam) {
    const r = this.rng;
    const az = (r() - 0.5) * 2.4;
    const dist = 650 + r() * 700;
    const gx = Math.sin(az) * dist, gz = -Math.cos(az) * dist;
    const top = new THREE.Vector3(gx + (r() - 0.5) * 120, 330 + r() * 100, gz + (r() - 0.5) * 60);
    const bottom = new THREE.Vector3(gx, groundH(gx, gz), gz);
    const segs = [];
    const build = (a, b, width, depth, alpha) => {
      let pts = [a, b];
      for (let it = 0; it < 6; it++) {
        const np = [pts[0]];
        for (let k = 0; k < pts.length - 1; k++) {
          const p = pts[k], q = pts[k + 1];
          const mid = p.clone().lerp(q, 0.5);
          const len = p.distanceTo(q);
          mid.x += (r() - 0.5) * len * 0.35; mid.z += (r() - 0.5) * len * 0.2; mid.y += (r() - 0.5) * len * 0.1;
          np.push(mid, q);
        }
        pts = np;
      }
      for (let k = 0; k < pts.length - 1; k++) {
        segs.push([pts[k], pts[k + 1], width * (1 - k / pts.length * 0.5), alpha]);
        if (depth > 0 && r() < 0.06) {
          const dir = pts[k + 1].clone().sub(pts[k]).normalize();
          const end = pts[k].clone().add(dir.multiplyScalar(40 + r() * 80)).add(new THREE.Vector3((r() - 0.5) * 70, -20 - r() * 40, (r() - 0.5) * 30));
          build(pts[k], end, width * 0.45, depth - 1, alpha * 0.6);
        }
      }
    };
    build(top, bottom, 3.2, 2, 1);
    // ribbon quads facing the camera
    let v = 0;
    const P = this.pos, A = this.alpha;
    const toCam = new THREE.Vector3();
    for (const [a, b, w, al] of segs) {
      if (v + 6 > P.length / 3) break;
      const dir = b.clone().sub(a).normalize();
      toCam.copy(cam).sub(a).normalize();
      const side = dir.clone().cross(toCam).normalize().multiplyScalar(w);
      const quad = [a.clone().sub(side), a.clone().add(side), b.clone().add(side), a.clone().sub(side), b.clone().add(side), b.clone().sub(side)];
      for (const p of quad) { P[v * 3] = p.x; P[v * 3 + 1] = p.y; P[v * 3 + 2] = p.z; A[v] = al; v++; }
    }
    this.geo.setDrawRange(0, v);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aA.needsUpdate = true;
    this.geo.computeBoundingSphere();
    this.t = 0.45;
    return top.clone().normalize();
  }

  update(dt, time) {
    if (this.t <= 0) { this.mat.uniforms.uI.value = 0; return; }
    this.t -= dt;
    const flick = (Math.sin(time * 70) > -0.2 ? 1 : 0.15) * (this.t > 0.32 ? 1 : this.t / 0.32);
    this.mat.uniforms.uI.value = Math.max(0, flick) * 26;
  }
}

// ── rain ────────────────────────────────────────────────────────────────────
const RAIN_VERT = /* glsl */`
attribute vec4 aSeed;
uniform float uTime;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform vec3 uWind;
varying float vA;
varying vec2 vUv;
void main(){
  float speed = 26.0 * (0.75 + 0.5 * aSeed.w);
  vec3 vel = vec3(uWind.x, -speed, uWind.z);
  vec3 p = aSeed.xyz * uBox;
  p += vel * uTime;
  p = mod(p, uBox);
  vec3 world = uCenter - uBox * 0.5 + p;
  vec4 mv = viewMatrix * vec4(world, 1.0);
  vec3 vv = (viewMatrix * vec4(vel, 0.0)).xyz;
  vec3 head = mv.xyz;
  vec3 tail = head - vv * 0.028;
  vec3 axis = normalize(head - tail);
  vec3 perp = normalize(cross(axis, normalize(head)));
  vec3 pos = mix(tail, head, position.y + 0.5) + perp * position.x * 0.012;
  gl_Position = projectionMatrix * vec4(pos, 1.0);
  float d = -mv.z;
  vA = smoothstep(0.5, 3.0, d) * (1.0 - smoothstep(18.0, 34.0, d));
  vUv = position.xy + 0.5;
}`;
const RAIN_FRAG = /* glsl */`
uniform float uIntensity;
uniform vec3 uColor;
varying float vA;
varying vec2 vUv;
void main(){
  float a = (1.0 - abs(vUv.x * 2.0 - 1.0)) * vUv.y * vA * uIntensity;
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

export function buildRain(env) {
  const N = env.quality.rain;
  const geo = new THREE.InstancedBufferGeometry();
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
  const seeds = new Float32Array(N * 4);
  for (let i = 0; i < N * 4; i++) seeds[i] = Math.random();
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  geo.instanceCount = N;
  env.rainUniforms = {
    uTime: { value: 0 },
    uCenter: { value: new THREE.Vector3(WORLD.CAM.x, WORLD.CAM.y, WORLD.CAM.z - 14) },
    uBox: { value: new THREE.Vector3(56, 34, 56) },
    uWind: { value: new THREE.Vector3(3.5, 0, 1.5) },
    uIntensity: { value: 0.32 },
    uColor: { value: new THREE.Color(0.55, 0.6, 0.7) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: env.rainUniforms, vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  env.rain = new THREE.Mesh(geo, mat);
  env.rain.frustumCulled = false;
  env.rain.renderOrder = 20;
  env.scene.add(env.rain);
}

// ── searchlight beam ────────────────────────────────────────────────────────
export const BEAM_VERT = /* glsl */`
varying float vV;
varying vec3 vN;
varying vec3 vWorld;
varying vec3 vView;
uniform float uLen;
void main(){
  vV = clamp(-position.y / uLen, 0.0, 1.0);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vView = normalize(cameraPosition - w.xyz);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
export const BEAM_FRAG = /* glsl */`
${NOISE_GLSL}
uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;
varying float vV;
varying vec3 vN;
varying vec3 vWorld;
varying vec3 vView;
void main(){
  float edge = pow(abs(dot(vN, vView)), 1.6);
  // interpolation can push vV a hair past 1: pow() of a negative is NaN on D3D,
  // and bloom smears a single NaN pixel across the whole frame
  float along = pow(max(1.0 - vV, 0.0), 1.8) * smoothstep(0.0, 0.02, vV);
  float dust = 0.6 + 0.4 * zNoise(vWorld.xz * 0.22 + vec2(uTime * 0.4, vWorld.y * 0.2 - uTime * 0.2));
  // rain streaking through the light
  float rain = pow(max(zNoise(vec2(vWorld.x * 5.2 + vWorld.z * 3.4, vWorld.y * 0.35 + uTime * 9.0)), 0.0), 9.0) * 1.1 * max(1.0 - vV, 0.0);
  float ground = smoothstep(0.0, 3.5, vWorld.y);
  float a = edge * along * (dust + rain) * ground * uIntensity;
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

// ── raindrops bursting on the nest deck, the sandbags and the wall walk ─────
const SPLASH_VERT = /* glsl */`
attribute vec4 aSeed;      // u, v, phase, area
uniform float uTime;
uniform vec4 uA0; uniform vec4 uA1;   // areas: x0, z0, x1, z1 (y in the next vec)
uniform vec2 uY;
varying float vA;
varying vec2 vUv;
float sh(float n){ return fract(sin(n * 91.345) * 47453.5453); }
void main(){
  float rate = 1.6 + aSeed.z;
  float tt = uTime * rate + aSeed.z * 10.0;
  float cyc = floor(tt);
  float f = fract(tt);
  float id = aSeed.x * 1000.0 + aSeed.y * 37.0 + cyc * 3.17;
  vec2 r = vec2(sh(id), sh(id + 7.1));
  bool second = aSeed.w > 0.5;
  vec4 A = second ? uA1 : uA0;
  float y = second ? uY.y : uY.x;
  vec3 c = vec3(mix(A.x, A.z, r.x), y + 0.02, mix(A.y, A.w, r.y));
  float size = (0.02 + f * 0.08);
  vec3 toCam = normalize(cameraPosition - c);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), toCam));
  vec3 up = vec3(0.0, 1.0, 0.0);
  vec3 p = c + right * position.x * size + up * (position.y + 0.5) * size * 0.8;
  vA = (1.0 - f) * (1.0 - f) * step(f, 0.35) * 3.0;
  vUv = position.xy + 0.5;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const SPLASH_FRAG = /* glsl */`
uniform vec3 uColor;
varying float vA;
varying vec2 vUv;
void main(){
  vec2 q = vUv * 2.0 - 1.0;
  float crown = exp(-pow(length(q * vec2(1.0, 1.6)) - 0.6, 2.0) * 30.0) * step(q.y, 0.6);
  float drop = exp(-dot(q - vec2(0.0, 0.3), q - vec2(0.0, 0.3)) * 40.0);
  gl_FragColor = vec4(uColor * (crown + drop * 0.6) * vA, 1.0);
}`;

export function buildSplashes(env) {
  const N = Math.round(env.quality.rain / 18);
  const geo = new THREE.InstancedBufferGeometry();
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
  const seeds = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) { seeds[i * 4] = Math.random(); seeds[i * 4 + 1] = Math.random(); seeds[i * 4 + 2] = Math.random(); seeds[i * 4 + 3] = i % 3 === 0 ? 1 : 0; }
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  geo.instanceCount = N;
  const top = WORLD.TOWER_TOP;
  env.splashUniforms = {
    uTime: { value: 0 },
    uA0: { value: new THREE.Vector4(-2.7, -4.1, 2.7, -0.9) },
    uA1: { value: new THREE.Vector4(-7.8, -1.0, 7.8, 7.2) },
    uY: { value: new THREE.Vector2(top, top) },
    uColor: { value: new THREE.Color(0.32, 0.34, 0.38) },
  };
  const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms: env.splashUniforms, vertexShader: SPLASH_VERT, fragmentShader: SPLASH_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  mesh.frustumCulled = false;
  mesh.renderOrder = 19;
  env.scene.add(mesh);
}
