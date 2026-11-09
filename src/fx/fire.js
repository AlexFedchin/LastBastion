// Procedural fire: camera-facing cylindrical billboards whose flames are
// generated per pixel (scrolling turbulence, tapered tongues, a black-body
// colour ramp). Each fire also lays an additive glow on the terrain under it,
// can breathe smoke and embers through the particle system, and reports
// itself as a heat source for the screen-space haze in the post chain.
import * as THREE from 'three';
import { FOG_CUSTOM_GLSL, fogUniforms } from '../render/atmosphere.js';
import { heightUniforms, HEIGHT_GLSL } from '../world/terrain.js';

const VERT = /* glsl */`
attribute vec4 iPos;   // xyz, seed
attribute vec4 iSize;  // width, height, intensity, fog scale
uniform float uTime;
uniform vec2 uWind;
varying vec2 vUv;
varying float vSeed;
varying float vInt;
varying float vFog;
${FOG_CUSTOM_GLSL}
void main(){
  vec3 c = iPos.xyz;
  vec3 toCam = cameraPosition - c;
  vec2 tc = normalize(toCam.xz + 1e-4);
  vec3 right = vec3(tc.y, 0.0, -tc.x);
  float y = position.y;
  float x = position.x;
  vec3 p = c + right * x * iSize.x + vec3(0.0, y * iSize.y, 0.0);
  float sway = sin(uTime * 2.3 + iPos.w * 17.0) * 0.07 + sin(uTime * 5.3 + iPos.w * 5.0) * 0.035;
  p.xz += (uWind * 0.12 + vec2(sway, sway * 0.6)) * y * y * iSize.y;
  // pull the quad slightly towards the camera so it doesn't clip into what it burns
  p += normalize(toCam) * min(iSize.x * 0.35, 1.5);
  vUv = vec2(x + 0.5, y);
  vSeed = iPos.w;
  vInt = iSize.z;
  vec4 f = lbFog(p, cameraPosition, lbFogColor, lbTime, lbDawn);
  vFog = 1.0 - exp(log(max(1.0 - f.a, 1e-4)) * abs(iSize.w));
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const FRAG = /* glsl */`
uniform float uTime;
varying vec2 vUv;
varying float vSeed;
varying float vInt;
varying float vFog;
float fHash(vec2 p){ p = fract(p * vec2(127.1, 311.7)); p += dot(p, p + 34.5); return fract(p.x * p.y); }
float fNoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(fHash(i), fHash(i + vec2(1.0, 0.0)), u.x), mix(fHash(i + vec2(0.0, 1.0)), fHash(i + vec2(1.0, 1.0)), u.x), u.y); }
float fFbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ v += a * fNoise(p); p = p * 2.07 + 13.7; a *= 0.5; } return v; }
void main(){
  float t = uTime * (0.9 + fract(vSeed * 7.3) * 0.4) + vSeed * 37.0;
  float x = vUv.x * 2.0 - 1.0;
  float y = vUv.y;
  vec2 q = vec2(x * 1.25, y * 1.5 - t * 1.35);
  float n1 = fFbm(q * 1.7 + vSeed * 9.0);
  float n2 = fFbm(q * 3.9 + vec2(4.1, -t * 0.7));
  float xs = x + (n1 - 0.5) * 0.65 * y + sin(y * 6.0 - t * 3.0 + vSeed * 20.0) * 0.06 * y;
  float width = mix(0.92, 0.06, pow(y, 0.8));
  float body = 1.0 - abs(xs) / max(width, 0.03);
  float heat = body * 1.15 - y * 0.95 + (n1 - 0.5) * 1.0 + (n2 - 0.5) * 0.55 + 0.22;
  heat *= smoothstep(0.0, 0.08, y);
  // detached licks near the top
  heat = max(heat, (n2 - 0.62) * 2.0 * smoothstep(0.35, 0.8, y) * (1.0 - smoothstep(0.85, 1.0, y)) * step(abs(xs), 0.4));
  heat = clamp(heat, 0.0, 1.0);
  vec3 col = mix(vec3(0.28, 0.025, 0.0), vec3(1.0, 0.26, 0.025), smoothstep(0.04, 0.32, heat));
  col = mix(col, vec3(1.0, 0.58, 0.13), smoothstep(0.32, 0.62, heat));
  col = mix(col, vec3(1.0, 0.9, 0.62), smoothstep(0.68, 0.96, heat));
  float a = smoothstep(0.02, 0.28, heat);
  gl_FragColor = vec4(col * a * vInt * (1.0 - vFog), 1.0);
}`;

const GLOW_VERT = /* glsl */`
${HEIGHT_GLSL}
attribute vec4 iPos;
attribute vec4 iSize;
uniform float uTime;
varying vec2 vR;
varying float vK;
void main(){
  float r = iSize.x * 1.7 + 1.2;
  vec2 xz = iPos.xz + position.xz * r;
  float y = lbTerrainH(xz) + 0.07;
  vR = position.xz;
  float fl = 0.8 + 0.2 * sin(uTime * 9.0 + iPos.w * 40.0) * sin(uTime * 13.7 + iPos.w * 10.0);
  // only fires near the ground light it
  float nearGround = 1.0 - smoothstep(1.5, 5.0, iPos.y - lbTerrainH(iPos.xz));
  vK = iSize.z * fl * nearGround * step(0.5, iSize.w);
  gl_Position = projectionMatrix * viewMatrix * vec4(xz.x, y, xz.y, 1.0);
}`;
const GLOW_FRAG = /* glsl */`
varying vec2 vR;
varying float vK;
void main(){
  float r = length(vR);
  float a = pow(max(0.0, 1.0 - r), 2.2) * vK * 0.016;
  gl_FragColor = vec4(vec3(1.0, 0.42, 0.11) * a, 1.0);
}`;

export class FireSystem {
  constructor(scene, quality) {
    this.cap = 320;
    this.tcap = quality.maxZombies >= 2000 ? 420 : 260;
    const N = this.cap + this.tcap;
    this.N = N;
    // persistent fires (SoA)
    const C = this.cap;
    this.alive = new Uint8Array(C);
    this.x = new Float32Array(C); this.y = new Float32Array(C); this.z = new Float32Array(C);
    this.w = new Float32Array(C); this.h = new Float32Array(C); this.k = new Float32Array(C);
    this.seed = new Float32Array(C);
    this.fogS = new Float32Array(C);
    this.glow = new Uint8Array(C);
    this.smoke = new Float32Array(C); this.embers = new Float32Array(C);
    this.life = new Float32Array(C); this.age = new Float32Array(C); this.fadeIn = new Float32Array(C);
    this.free = [];
    for (let i = C - 1; i >= 0; i--) this.free.push(i);
    this.tn = 0;
    this.T = new Float32Array(this.tcap * 8);

    const quad = new THREE.InstancedBufferGeometry();
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0]), 3));
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage);
    quad.setAttribute('iPos', this.aPos);
    quad.setAttribute('iSize', this.aSize);
    quad.instanceCount = 0;
    this.geo = quad;
    this.uniforms = { uTime: { value: 0 }, uWind: { value: new THREE.Vector2(0.8, 0.3) }, ...fogUniforms };
    this.mesh = new THREE.Mesh(quad, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 13;
    scene.add(this.mesh);

    // ground glow, sharing the instance attributes
    const disc = new THREE.PlaneGeometry(2, 2, 6, 6).rotateX(-Math.PI / 2);
    const g2 = new THREE.InstancedBufferGeometry();
    g2.index = disc.index;
    g2.setAttribute('position', disc.attributes.position);
    g2.setAttribute('iPos', this.aPos);
    g2.setAttribute('iSize', this.aSize);
    g2.instanceCount = 0;
    this.geo2 = g2;
    this.glowMesh = new THREE.Mesh(g2, new THREE.ShaderMaterial({
      uniforms: { uTime: this.uniforms.uTime, ...heightUniforms() },
      vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    }));
    this.glowMesh.frustumCulled = false;
    this.glowMesh.renderOrder = 3;
    scene.add(this.glowMesh);
    this._heat = [];
  }

  /** Add a persistent fire. Returns an id (or -1 when full). */
  add(x, y, z, w, h, intensity = 3, { smoke = 0, embers = 0, glow = true, fogScale = 1, life = Infinity, fadeIn = 0.4 } = {}) {
    const i = this.free.pop();
    if (i === undefined) return -1;
    this.alive[i] = 1;
    this.x[i] = x; this.y[i] = y; this.z[i] = z;
    this.w[i] = w; this.h[i] = h; this.k[i] = intensity;
    this.seed[i] = Math.random();
    this.fogS[i] = fogScale;
    this.glow[i] = glow ? 1 : 0;
    this.smoke[i] = smoke; this.embers[i] = embers;
    this.life[i] = life; this.age[i] = 0; this.fadeIn[i] = fadeIn;
    return i;
  }
  set(i, intensity) { if (i >= 0 && this.alive[i]) this.k[i] = intensity; }
  move(i, x, y, z) { if (i >= 0 && this.alive[i]) { this.x[i] = x; this.y[i] = y; this.z[i] = z; } }
  remove(i) { if (i >= 0 && this.alive[i]) { this.alive[i] = 0; this.free.push(i); } }
  clearTemporary() {
    for (let i = 0; i < this.cap; i++) if (this.alive[i] && this.life[i] !== Infinity) this.remove(i);
  }

  /** A one-frame flame (burning zombies etc.). */
  transient(x, y, z, w, h, intensity, seed) {
    if (this.tn >= this.tcap) return;
    const o = this.tn++ * 8;
    const T = this.T;
    T[o] = x; T[o + 1] = y; T[o + 2] = z; T[o + 3] = seed;
    T[o + 4] = w; T[o + 5] = h; T[o + 6] = intensity; T[o + 7] = 1;
  }

  update(dt, time, fx, camera) {
    this.uniforms.uTime.value = time;
    const P = this.aPos.array, S = this.aSize.array;
    let n = 0;
    const heat = this._heat;
    heat.length = 0;
    for (let i = 0; i < this.cap; i++) {
      if (!this.alive[i]) continue;
      this.age[i] += dt;
      const L = this.life[i];
      if (this.age[i] >= L) { this.remove(i); continue; }
      let k = this.k[i];
      if (this.fadeIn[i] > 0) k *= Math.min(1, this.age[i] / this.fadeIn[i]);
      if (L !== Infinity) k *= Math.min(1, (L - this.age[i]) / Math.min(2.5, L * 0.4));
      const o = n * 4;
      P[o] = this.x[i]; P[o + 1] = this.y[i]; P[o + 2] = this.z[i]; P[o + 3] = this.seed[i];
      S[o] = this.w[i]; S[o + 1] = this.h[i]; S[o + 2] = k; S[o + 3] = this.glow[i] ? this.fogS[i] : -this.fogS[i];
      n++;
      if (fx && k > 0.2) {
        const sm = this.smoke[i];
        if (sm > 0 && Math.random() < sm * dt) fx.smokePuff(this.x[i] + (Math.random() - 0.5) * this.w[i] * 0.5, this.y[i] + this.h[i] * 0.8, this.z[i], this.w[i] * 0.9, 0.025, 7, 1.8);
        const em = this.embers[i];
        if (em > 0 && Math.random() < em * dt) fx.ember(this.x[i] + (Math.random() - 0.5) * this.w[i] * 0.6, this.y[i] + this.h[i] * 0.4, this.z[i]);
      }
      if (this.fogS[i] >= 0.9 && k > 0.5) heat.push(this.x[i], this.y[i] + this.h[i] * 0.9, this.z[i], this.w[i] * 0.5 + this.h[i] * 0.4, k);
    }
    // transients
    const T = this.T;
    for (let t = 0; t < this.tn; t++) {
      const o = n * 4, s = t * 8;
      P[o] = T[s]; P[o + 1] = T[s + 1]; P[o + 2] = T[s + 2]; P[o + 3] = T[s + 3];
      S[o] = T[s + 4]; S[o + 1] = T[s + 5]; S[o + 2] = T[s + 6]; S[o + 3] = -1;
      n++;
    }
    this.tn = 0;
    this.geo.instanceCount = n;
    this.geo2.instanceCount = n;
    if (n) {
      for (const a of [this.aPos, this.aSize]) { a.clearUpdateRanges(); a.addUpdateRange(0, n * 4); a.needsUpdate = true; }
    }
    void camera;
  }

  /** Flat array [x,y,z,radius,strength,...] of persistent heat sources. */
  get heatSources() { return this._heat; }
}
