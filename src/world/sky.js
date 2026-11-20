// Sky dome (domain-warped storm clouds lit from below by the burning city,
// lightning glowing inside them), lightning bolts on the horizon, rain and
// the searchlight beam shader. (WebGPU / TSL node materials.)
import * as THREE from 'three';
import {
  Fn, Loop, If, float, vec2, vec3, vec4, uniform, attribute, varying, positionLocal, positionWorld, normalWorld, cameraPosition,
  cameraProjectionMatrix, cameraViewMatrix, modelViewMatrix, modelWorldMatrix, mix, smoothstep, clamp, max, min, abs, exp, pow,
  length, normalize, dot, cross, fract, floor, sin, mod, step, select, varyingProperty,
} from 'three/tsl';
import { WORLD } from '../config.js';
import { makeRng } from '../core/util.js';
import { groundH } from './terrain.js';
import { GLOW_RGB, fogUniforms, lbFog } from '../render/atmosphere.js';

// ── noise (the GLSL NOISE_GLSL, shared by sky, beams and others) ──
export const zHash = Fn(([p0]) => {
  const p = fract(p0.mul(vec2(123.34, 456.21))).toVar();
  p.addAssign(dot(p, p.add(45.32)));
  return fract(p.x.mul(p.y));
}).setLayout({ name: 'zHash', type: 'float', inputs: [{ name: 'p0', type: 'vec2' }] });

export const zNoise = Fn(([p]) => {
  const i = floor(p), f = fract(p);
  const a = zHash(i), b = zHash(i.add(vec2(1, 0))), c = zHash(i.add(vec2(0, 1))), d = zHash(i.add(vec2(1, 1)));
  const u = f.mul(f).mul(f.mul(-2).add(3));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}).setLayout({ name: 'zNoise', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

export const zFbm = Fn(([p0]) => {
  const v = float(0).toVar(), a = float(0.5).toVar(), p = vec2(p0).toVar();
  Loop(5, () => {
    v.addAssign(a.mul(zNoise(p)));
    p.assign(p.mul(2.03).add(17.1));
    a.mulAssign(0.5);
  });
  return v;
}).setLayout({ name: 'zFbm', type: 'float', inputs: [{ name: 'p0', type: 'vec2' }] });

/** The sky's colour for a view direction d (unit), from a set of sky uniforms U. */
function skyColor(U, d) {
  const h = d.y;
  const col = mix(U.uHorizon, U.uZenith, smoothstep(-0.02, 0.45, h)).toVar();
  const dxz = normalize(d.xz.add(1e-5));
  const toward = max(0, dxz.y.negate());
  const glow = toward.mul(toward).mul(exp(max(h, 0).mul(-13))).mul(U.uGlowAmt);
  const dome = pow(toward, 3).mul(exp(max(h, 0).mul(-3.5))).mul(U.uGlowAmt);
  col.addAssign(U.uGlow.mul(glow.add(dome.mul(0.18))));
  // sunset (the prologue): a low sun, a burning band under the storm deck, the deck
  // lifting off the horizon so the band shows, undersides lit from below
  const sd = max(dot(d, U.uSunDir), 0);
  const az = max(dot(dxz, normalize(U.uSunDir.xz.add(1e-5))), 0);
  const band = exp(max(h, 0).mul(-11));
  const sunSky = vec3(0).toVar();
  If(U.uDusk.greaterThan(0.001), () => {
    sunSky.assign(U.uSunCol.mul(band.mul(pow(az, 5).mul(0.55).add(0.05)).add(pow(sd, 18).mul(0.6)).add(pow(sd, 400).mul(1.1))).mul(U.uDusk));
    col.addAssign(sunSky);
    col.addAssign(U.uSunCol.mul(U.uDusk).mul(smoothstep(0.99975, 0.9999, sd)).mul(smoothstep(-0.004, 0.004, h)).mul(7));
    col.assign(mix(col, col.mul(vec3(0.78, 0.82, 1.15)), U.uDusk.mul(smoothstep(0.1, 0.5, h)).mul(0.6)));
  });
  // storm deck
  const ph = max(h, 0).add(0.055);
  const uv = d.xz.div(ph).mul(0.5).add(vec2(U.uTime.mul(0.0042), U.uTime.mul(0.0017)));
  const w = vec2(zFbm(uv.mul(0.7).add(3.1)), zFbm(uv.mul(0.7).add(7.3).add(U.uTime.mul(0.002))));
  const c = zFbm(uv.mul(1.15).add(w.mul(1.6)));
  const c2 = zFbm(uv.mul(3.2).add(w.mul(0.7)).add(11));
  const dens = smoothstep(0.34, 0.74, c.mul(0.82).add(c2.mul(0.3))).mul(smoothstep(-0.01, 0.09, h))
    .mul(float(1).sub(U.uDusk.mul(0.9).mul(float(1).sub(smoothstep(0.035, 0.2, h)))));
  // undersides lit by the fires: strongest towards the city, thin edges glow
  const under = glow.mul(2.4).add(dome.mul(1.3)).add(U.uGlowAmt.mul(0.03)).mul(c2.add(0.45)).mul(float(1.25).sub(dens.mul(0.5)));
  const cloudCol = vec3(0.0065, 0.007, 0.0095).mul(U.uCloudLight).mul(c2.mul(0.9).add(0.55)).add(U.uGlow.mul(under)).toVar();
  const fl = U.uFlash.mul(pow(max(dot(d, U.uFlashDir), 0), 5).mul(0.8).add(0.2));
  cloudCol.addAssign(vec3(0.55, 0.62, 0.86).mul(fl).mul(c.mul(1.3).add(0.35)));
  cloudCol.addAssign(U.uSunCol.mul(U.uDusk).mul(pow(sd, 3).mul(1.3).mul(c2.add(0.25)).mul(float(1.2).sub(dens.mul(0.6))).add(band.mul(0.25)).add(0.035)));
  col.assign(mix(col, cloudCol, dens.mul(0.96)));
  col.addAssign(vec3(0.6, 0.65, 0.8).mul(fl).mul(0.04));
  col.assign(mix(col, U.uHorizon.add(U.uGlow.mul(glow)).add(sunSky.mul(0.6)), smoothstep(0.02, -0.06, h)));
  // fog bank: the sky takes exactly the colour lbFog() gives far geometry, so whatever
  // the bank swallows leaves no silhouette against it
  If(U.uBank.greaterThan(0.001), () => {
    const fb = lbFog(cameraPosition.add(d.mul(1400)), cameraPosition, fogUniforms.lbFogColor, fogUniforms.lbTime, fogUniforms.lbDawn, float(1));
    col.assign(mix(col, fb.rgb, U.uBank.mul(fb.a)));
  });
  return col;
}

function makeSkyUniforms(env) {
  return {
    uTime: uniform(0),
    uFlash: uniform(0),
    uFlashDir: uniform(new THREE.Vector3(0, 0.5, -1).normalize()),
    uZenith: uniform(new THREE.Color(0.0025, 0.003, 0.0055)),
    uHorizon: uniform(env.nightFog.clone()),
    uGlow: uniform(new THREE.Color(...GLOW_RGB)),
    uGlowAmt: uniform(1),
    uCloudLight: uniform(1),
    uBank: uniform(0),
    uSunDir: uniform(new THREE.Vector3(-0.3, 0.05, -1).normalize()),
    uSunCol: uniform(new THREE.Color(1, 0.42, 0.14)),
    uDusk: uniform(0),
  };
}

function makeSkyMaterial(U) {
  const mat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false });
  // at the far plane wherever it is drawn (gl_Position = p.xyww)
  mat.vertexNode = Fn(() => {
    const p = cameraProjectionMatrix.mul(modelViewMatrix.mul(vec4(positionLocal, 1)));
    return vec4(p.x, p.y, p.w, p.w);
  })();
  mat.colorNode = Fn(() => skyColor(U, normalize(positionLocal)))();
  return mat;
}

export function buildSky(env) {
  env.skyUniforms = makeSkyUniforms(env);
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 24), makeSkyMaterial(env.skyUniforms));
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  env.sky = sky;
  env.scene.add(sky);
}

export function buildEnvMap(env) {
  // a brighter copy of the night sky, for the environment light only
  const U = makeSkyUniforms(env);
  U.uGlow.value.setRGB(0.55, 0.15, 0.04);
  U.uZenith.value.setRGB(0.02, 0.025, 0.04);
  U.uHorizon.value.setRGB(0.05, 0.05, 0.06);
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 24), makeSkyMaterial(U)));
  const pm = new THREE.PMREMGenerator(env.renderer);
  const rt = pm.fromScene(envScene, 0.04, 1, 2000);
  env.scene.environment = rt.texture;
  env.scene.environmentIntensity = 0.55;
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
    this.uI = uniform(0);
    this.mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.mat.colorNode = vec3(0.75, 0.82, 1.0).mul(this.uI).mul(attribute('aA', 'float'));
    this.mat.uniforms = { uI: this.uI };
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
    this.lastDist = dist; this.lastAz = az; // (the thunder: how long it takes, where it comes from)
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
    if (this.t <= 0) { this.uI.value = 0; return; }
    this.t -= dt;
    const flick = (Math.sin(time * 70) > -0.2 ? 1 : 0.15) * (this.t > 0.32 ? 1 : this.t / 0.32);
    this.uI.value = Math.max(0, flick) * 26;
  }
}

// ── rain ────────────────────────────────────────────────────────────────────
export function buildRain(env) {
  const N = env.quality.rain;
  const geo = new THREE.InstancedBufferGeometry();
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
  const seeds = new Float32Array(N * 4);
  for (let i = 0; i < N * 4; i++) seeds[i] = Math.random();
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  geo.instanceCount = N;
  const U = env.rainUniforms = {
    uTime: uniform(0),
    uCenter: uniform(new THREE.Vector3(WORLD.CAM.x, WORLD.CAM.y, WORLD.CAM.z - 14)),
    uBox: uniform(new THREE.Vector3(56, 34, 56)),
    uWind: uniform(new THREE.Vector3(3.5, 0, 1.5)),
    uIntensity: uniform(0.32),
    uColor: uniform(new THREE.Color(0.55, 0.6, 0.7)),
  };
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  const vA = varyingProperty('float', 'vRainA');
  mat.vertexNode = Fn(() => {
    const seed = attribute('aSeed', 'vec4');
    const speed = seed.w.mul(0.5).add(0.75).mul(26);
    const vel = vec3(U.uWind.x, speed.negate(), U.uWind.z);
    const p = mod(seed.xyz.mul(U.uBox).add(vel.mul(U.uTime)), U.uBox);
    const world = U.uCenter.sub(U.uBox.mul(0.5)).add(p);
    const mv = cameraViewMatrix.mul(vec4(world, 1));
    const vv = cameraViewMatrix.mul(vec4(vel, 0)).xyz;
    const head = mv.xyz;
    const tail = head.sub(vv.mul(0.028));
    const axis = normalize(head.sub(tail));
    const perp = normalize(cross(axis, normalize(head)));
    const pos = mix(tail, head, positionLocal.y.add(0.5)).add(perp.mul(positionLocal.x).mul(0.012));
    const d = mv.z.negate();
    vA.assign(smoothstep(0.5, 3.0, d).mul(float(1).sub(smoothstep(18.0, 34.0, d))));
    return cameraProjectionMatrix.mul(vec4(pos, 1));
  })();
  mat.colorNode = Fn(() => {
    const uvq = positionLocal.xy.add(0.5);
    const a = float(1).sub(abs(uvq.x.mul(2).sub(1))).mul(uvq.y).mul(vA).mul(U.uIntensity);
    return U.uColor.mul(a);
  })();
  env.rain = new THREE.Mesh(geo, mat);
  env.rain.frustumCulled = false;
  env.rain.renderOrder = 20;
  env.scene.add(env.rain);
}

// ── searchlight beam (the painted cone; volumetric.js replaces it where the air is ray-marched) ──
export function makeBeamMaterial(len) {
  const U = { uColor: uniform(new THREE.Color(0.55, 0.6, 0.72)), uIntensity: uniform(0.05), uTime: uniform(0), uLen: uniform(len) };
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false });
  mat.uniforms = U;
  mat.colorNode = Fn(() => {
    const vV = clamp(positionLocal.y.negate().div(U.uLen), 0, 1);
    const vWorld = positionWorld;
    const vN = normalWorld;
    const vView = normalize(cameraPosition.sub(vWorld));
    const edge = pow(abs(dot(vN, vView)), 1.6);
    const along = pow(max(float(1).sub(vV), 0), 1.8).mul(smoothstep(0, 0.02, vV));
    const dust = zNoise(vWorld.xz.mul(0.22).add(vec2(U.uTime.mul(0.4), vWorld.y.mul(0.2).sub(U.uTime.mul(0.2))))).mul(0.4).add(0.6);
    // rain streaking through the light
    const rain = pow(max(zNoise(vec2(vWorld.x.mul(5.2).add(vWorld.z.mul(3.4)), vWorld.y.mul(0.35).add(U.uTime.mul(9)))), 0), 9).mul(1.1).mul(max(float(1).sub(vV), 0));
    const ground = smoothstep(0, 3.5, vWorld.y);
    return U.uColor.mul(edge.mul(along).mul(dust.add(rain)).mul(ground).mul(U.uIntensity));
  })();
  return mat;
}

// ── raindrops bursting on the nest deck, the sandbags and the wall walk ─────
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
  const U = env.splashUniforms = {
    uTime: uniform(0),
    uA0: uniform(new THREE.Vector4(-2.7, -4.1, 2.7, -0.9)),
    uA1: uniform(new THREE.Vector4(-7.8, -1.0, 7.8, 7.2)),
    uY: uniform(new THREE.Vector2(top, top)),
    uColor: uniform(new THREE.Color(0.32, 0.34, 0.38)),
  };
  const sh = (n) => fract(sin(n.mul(91.345)).mul(47453.5453));
  const vA = varyingProperty('float', 'vSplashA');
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  mat.fog = false;
  mat.vertexNode = Fn(() => {
    const seed = attribute('aSeed', 'vec4');
    const rate = seed.z.add(1.6);
    const tt = U.uTime.mul(rate).add(seed.z.mul(10));
    const cyc = floor(tt), f = fract(tt);
    const id = seed.x.mul(1000).add(seed.y.mul(37)).add(cyc.mul(3.17));
    const r = vec2(sh(id), sh(id.add(7.1)));
    const second = seed.w.greaterThan(0.5);
    const A = select(second, U.uA1, U.uA0);
    const y = select(second, U.uY.y, U.uY.x);
    const c = vec3(mix(A.x, A.z, r.x), y.add(0.02), mix(A.y, A.w, r.y));
    const size = f.mul(0.08).add(0.02);
    const toCam = normalize(cameraPosition.sub(c));
    const right = normalize(cross(vec3(0, 1, 0), toCam));
    const p = c.add(right.mul(positionLocal.x).mul(size)).add(vec3(0, 1, 0).mul(positionLocal.y.add(0.5)).mul(size).mul(0.8));
    vA.assign(float(1).sub(f).mul(float(1).sub(f)).mul(step(f, 0.35)).mul(3));
    return cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(p, 1)));
  })();
  mat.colorNode = Fn(() => {
    const q = positionLocal.xy.mul(2);
    const crown = exp(pow(length(q.mul(vec2(1, 1.6))).sub(0.6), 2).mul(-30)).mul(step(q.y, 0.6));
    const dq = q.sub(vec2(0, 0.3));
    const drop = exp(dot(dq, dq).mul(-40));
    return U.uColor.mul(crown.add(drop.mul(0.6))).mul(vA);
  })();
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 19;
  env.scene.add(mesh);
}
