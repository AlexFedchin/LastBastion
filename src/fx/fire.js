// Procedural fire: camera-facing cylindrical billboards whose flames are
// generated per pixel (scrolling turbulence, tapered tongues, a black-body
// colour ramp). Each fire also lays an additive glow on the terrain under it,
// can breathe smoke and embers through the particle system, and reports
// itself as a heat source for the screen-space haze in the post chain.
import * as THREE from 'three';
import {
  Fn, Loop, float, vec2, vec3, vec4, uniform, attribute, varyingProperty, positionLocal, cameraPosition, cameraProjectionMatrix, cameraViewMatrix,
  mix, smoothstep, clamp, max, abs, exp, log, pow, sin, length, normalize, dot, fract, floor, step,
} from 'three/tsl';
import { fogUniforms, lbFog } from '../render/atmosphere.js';
import { lbTerrainH } from '../world/terrain.js';

const fHash = Fn(([p0]) => {
  const p = fract(p0.mul(vec2(127.1, 311.7))).toVar();
  p.addAssign(dot(p, p.add(34.5)));
  return fract(p.x.mul(p.y));
}).setLayout({ name: 'fHash', type: 'float', inputs: [{ name: 'p0', type: 'vec2' }] });
const fNoise = Fn(([p]) => {
  const i = floor(p), f = fract(p);
  const u = f.mul(f).mul(f.mul(-2).add(3));
  return mix(mix(fHash(i), fHash(i.add(vec2(1, 0))), u.x), mix(fHash(i.add(vec2(0, 1))), fHash(i.add(vec2(1, 1))), u.x), u.y);
}).setLayout({ name: 'fNoise', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });
const fFbm = Fn(([p0]) => {
  const v = float(0).toVar(), a = float(0.5).toVar(), p = vec2(p0).toVar();
  Loop(4, () => { v.addAssign(a.mul(fNoise(p))); p.assign(p.mul(2.07).add(13.7)); a.mulAssign(0.5); });
  return v;
}).setLayout({ name: 'fFbm', type: 'float', inputs: [{ name: 'p0', type: 'vec2' }] });

/** Flame billboards: camera-facing about the vertical, flames drawn per pixel. */
function flameMaterial(U) {
  const iPos = attribute('iPos', 'vec4');   // xyz, seed
  const iSize = attribute('iSize', 'vec4'); // width, height, intensity, fog scale
  const vUv = varyingProperty('vec2', 'vFireUv'), vSeed = varyingProperty('float', 'vFireSeed');
  const vInt = varyingProperty('float', 'vFireInt'), vFog = varyingProperty('float', 'vFireFog');
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  mat.vertexNode = Fn(() => {
    const c = iPos.xyz;
    const toCam = cameraPosition.sub(c);
    const tc = normalize(toCam.xz.add(1e-4));
    const right = vec3(tc.y, 0, tc.x.negate());
    const y = positionLocal.y, x = positionLocal.x;
    const p = c.add(right.mul(x).mul(iSize.x)).add(vec3(0, y.mul(iSize.y), 0)).toVar();
    const sway = sin(U.uTime.mul(2.3).add(iPos.w.mul(17))).mul(0.07).add(sin(U.uTime.mul(5.3).add(iPos.w.mul(5))).mul(0.035));
    const dxz = U.uWind.mul(0.12).add(vec2(sway, sway.mul(0.6))).mul(y).mul(y).mul(iSize.y);
    p.addAssign(vec3(dxz.x, 0, dxz.y));
    // pull the quad slightly towards the camera so it doesn't clip into what it burns
    p.addAssign(normalize(toCam).mul(iSize.x.mul(0.35).min(1.5)));
    vUv.assign(vec2(x.add(0.5), y));
    vSeed.assign(iPos.w);
    vInt.assign(iSize.z);
    const f = lbFog(p, cameraPosition, fogUniforms.lbFogColor, fogUniforms.lbTime, fogUniforms.lbDawn, float(1));
    // far fires are fogged lightly so the city burns through the haze, but not through a fog bank
    vFog.assign(float(1).sub(exp(log(max(float(1).sub(f.a), 1e-4)).mul(mix(abs(iSize.w), 1, clamp(fogUniforms.lbDawn.sub(2), 0, 1))))));
    return cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(p, 1)));
  })();
  mat.colorNode = Fn(() => {
    const t = U.uTime.mul(fract(vSeed.mul(7.3)).mul(0.4).add(0.9)).add(vSeed.mul(37));
    const x = vUv.x.mul(2).sub(1), y = vUv.y;
    const q = vec2(x.mul(1.25), y.mul(1.5).sub(t.mul(1.35)));
    const n1 = fFbm(q.mul(1.7).add(vSeed.mul(9)));
    const n2 = fFbm(q.mul(3.9).add(vec2(4.1, t.mul(-0.7))));
    const xs = x.add(n1.sub(0.5).mul(0.65).mul(y)).add(sin(y.mul(6).sub(t.mul(3)).add(vSeed.mul(20))).mul(0.06).mul(y));
    const width = mix(0.92, 0.06, pow(y, 0.8));
    const body = float(1).sub(abs(xs).div(max(width, 0.03)));
    const heat0 = body.mul(1.15).sub(y.mul(0.95)).add(n1.sub(0.5)).add(n2.sub(0.5).mul(0.55)).add(0.22).mul(smoothstep(0, 0.08, y));
    // detached licks near the top
    const heat = clamp(max(heat0, n2.sub(0.62).mul(2).mul(smoothstep(0.35, 0.8, y)).mul(float(1).sub(smoothstep(0.85, 1, y))).mul(step(abs(xs), 0.4))), 0, 1);
    const col = mix(vec3(0.28, 0.025, 0), vec3(1, 0.26, 0.025), smoothstep(0.04, 0.32, heat)).toVar();
    col.assign(mix(col, vec3(1, 0.58, 0.13), smoothstep(0.32, 0.62, heat)));
    col.assign(mix(col, vec3(1, 0.9, 0.62), smoothstep(0.68, 0.96, heat)));
    const a = smoothstep(0.02, 0.28, heat);
    return col.mul(a).mul(vInt).mul(float(1).sub(vFog));
  })();
  return mat;
}

/** The additive glow each fire lays on the ground under it. */
function groundGlowMaterial(U) {
  const iPos = attribute('iPos', 'vec4'), iSize = attribute('iSize', 'vec4');
  const vR = varyingProperty('vec2', 'vGlowR'), vK = varyingProperty('float', 'vGlowK');
  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  mat.vertexNode = Fn(() => {
    const r = iSize.x.mul(1.7).add(1.2);
    const xz = iPos.xz.add(positionLocal.xz.mul(r));
    const y = lbTerrainH(xz).add(0.07);
    vR.assign(positionLocal.xz);
    const fl = sin(U.uTime.mul(9).add(iPos.w.mul(40))).mul(sin(U.uTime.mul(13.7).add(iPos.w.mul(10)))).mul(0.2).add(0.8);
    // only fires near the ground light it
    const nearGround = float(1).sub(smoothstep(1.5, 5.0, iPos.y.sub(lbTerrainH(iPos.xz))));
    vK.assign(iSize.z.mul(fl).mul(nearGround).mul(step(0.5, iSize.w)));
    return cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(xz.x, y, xz.y, 1)));
  })();
  mat.colorNode = Fn(() => {
    const a = pow(max(0, float(1).sub(length(vR))), 2.2).mul(vK).mul(0.016);
    return vec3(1, 0.42, 0.11).mul(a);
  })();
  return mat;
}

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
    this.uniforms = { uTime: uniform(0), uWind: uniform(new THREE.Vector2(0.8, 0.3)) };
    this.mesh = new THREE.Mesh(quad, flameMaterial(this.uniforms));
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
    this.glowMesh = new THREE.Mesh(g2, groundGlowMaterial(this.uniforms));
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
