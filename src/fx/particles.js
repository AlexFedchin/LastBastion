// GPU-billboarded particle system. CPU integrates, GPU orients quads.
// Supports round (rotating) billboards and velocity-stretched streaks
// (tracers, sparks, blood jets) with correct perspective.
import * as THREE from 'three';
import {
  Fn, If, Discard, float, vec2, vec3, vec4, uniform, attribute, texture, varyingProperty, positionLocal, cameraPosition, cameraProjectionMatrix,
  modelViewMatrix, mix, smoothstep, clamp, max, length, normalize, cross, cos, sin, floor, mod, select,
} from 'three/tsl';
import { fogUniforms, lbFog } from '../render/atmosphere.js';

/** Billboards (round, rotating) and velocity-stretched streaks, oriented on the GPU. */
function particleMaterial(atlas, additive) {
  const iPos = attribute('iPos', 'vec3'), iVel = attribute('iVel', 'vec3');
  const iData = attribute('iData', 'vec4');   // size, rotation, stretch, frame
  const iColor = attribute('iColor', 'vec4'); // rgb (HDR), alpha
  const uAtlas = uniform(new THREE.Vector2(4, 4));
  const vUv = varyingProperty('vec2', 'vPUv'), vColor = varyingProperty('vec4', 'vPColor');
  const vFog = varyingProperty('float', 'vPFog'), vFogCol = varyingProperty('vec3', 'vPFogCol');
  const map = texture(atlas);
  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true, depthWrite: false, fog: false,
    blending: additive ? THREE.CustomBlending : THREE.NormalBlending,
    blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  });
  mat.vertexNode = Fn(() => {
    const mv = modelViewMatrix.mul(vec4(iPos, 1));
    const size = iData.x, stretch = iData.z;
    const corner = positionLocal.xy;
    const p = vec3(mv.xyz).toVar();
    If(stretch.greaterThan(0), () => {
      const vv = modelViewMatrix.mul(vec4(iVel, 0)).xyz;
      const head = mv.xyz;
      const tail = head.sub(vv.mul(stretch));
      const ax0 = head.sub(tail);
      const len = length(ax0);
      const axis = select(len.greaterThan(1e-4), ax0.div(len), vec3(0, 1, 0)).toVar();
      const viewDir = normalize(mix(head, tail, 0.5));
      // (viewDir x axis keeps the quad's winding facing the camera)
      const pp = cross(viewDir, axis);
      const pl = length(pp);
      const perp = select(pl.greaterThan(1e-4), pp.div(pl), vec3(1, 0, 0));
      // extend the streak by half a size at both ends so it is never degenerate
      const A = tail.sub(axis.mul(size).mul(0.5));
      const B = head.add(axis.mul(size).mul(0.5));
      p.assign(mix(A, B, corner.y.add(0.5)).add(perp.mul(corner.x).mul(size)));
    }).Else(() => {
      const c = cos(iData.y), s = sin(iData.y);
      p.addAssign(vec3(vec2(c.mul(corner.x).sub(s.mul(corner.y)), s.mul(corner.x).add(c.mul(corner.y))).mul(size), 0));
    });
    const f = floor(iData.w.add(0.5));
    const cell = vec2(mod(f, uAtlas.x), uAtlas.y.sub(1).sub(floor(f.div(uAtlas.x))));
    vUv.assign(cell.add(corner).add(0.5).div(uAtlas));
    const lf = lbFog(iPos, cameraPosition, fogUniforms.lbFogColor, fogUniforms.lbTime, fogUniforms.lbDawn, float(1));
    // fire is a light source: in the fog bank a blast still burns through and lights the murk,
    // so the hottest particles (colours well above 1) shed most of the bank's veil
    const hot = smoothstep(1.5, 4.0, max(iColor.r, max(iColor.g, iColor.b)));
    vFog.assign(lf.a.mul(float(1).sub(hot.mul(0.75).mul(clamp(fogUniforms.lbDawn.sub(2), 0, 1)))));
    vFogCol.assign(lf.rgb);
    // fade particles that are right in the camera's face
    vColor.assign(vec4(iColor.rgb, iColor.a.mul(smoothstep(0.15, 1.2, p.z.negate()))));
    return cameraProjectionMatrix.mul(vec4(p, 1));
  })();
  if (additive) {
    mat.colorNode = Fn(() => {
      const t = map.sample(vUv);
      const a = t.a.mul(vColor.a).mul(float(1).sub(vFog));
      return vec4(t.rgb.mul(vColor.rgb).mul(a), 1);
    })();
  } else {
    mat.colorNode = Fn(() => {
      const t = map.sample(vUv);
      const a = t.a.mul(vColor.a);
      If(a.lessThan(0.004), () => { Discard(); });
      return vec4(mix(t.rgb.mul(vColor.rgb), vFogCol, vFog), a.mul(float(1).sub(vFog.mul(0.6))));
    })();
  }
  mat.uniforms = { uAtlas };
  return mat;
}

export class ParticleSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {object} opts { capacity, additive, atlas, fog: {color, density}, renderOrder }
   */
  constructor(scene, { capacity = 6000, additive = true, atlas, fogUniforms, renderOrder = 10 }) {
    this.cap = capacity;
    this.count = 0;
    const N = capacity;
    // simulation state (SoA)
    this.px = new Float32Array(N); this.py = new Float32Array(N); this.pz = new Float32Array(N);
    this.vx = new Float32Array(N); this.vy = new Float32Array(N); this.vz = new Float32Array(N);
    this.life = new Float32Array(N); this.maxLife = new Float32Array(N);
    this.s0 = new Float32Array(N); this.s1 = new Float32Array(N);
    this.rot = new Float32Array(N); this.rotV = new Float32Array(N);
    this.r0 = new Float32Array(N); this.g0 = new Float32Array(N); this.b0 = new Float32Array(N);
    this.r1 = new Float32Array(N); this.g1 = new Float32Array(N); this.b1 = new Float32Array(N);
    this.a0 = new Float32Array(N);
    this.frame = new Float32Array(N);
    this.stretch = new Float32Array(N);
    this.grav = new Float32Array(N);
    this.drag = new Float32Array(N);
    this.fadeIn = new Float32Array(N);
    this.floorY = new Float32Array(N);
    this._arrays = [this.px, this.py, this.pz, this.vx, this.vy, this.vz, this.life, this.maxLife, this.s0, this.s1,
      this.rot, this.rotV, this.r0, this.g0, this.b0, this.r1, this.g1, this.b1, this.a0, this.frame, this.stretch,
      this.grav, this.drag, this.fadeIn, this.floorY];

    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aData = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iVel', this.aVel);
    geo.setAttribute('iData', this.aData);
    geo.setAttribute('iColor', this.aColor);
    geo.instanceCount = 0;
    this.geo = geo;

    this.material = particleMaterial(atlas, additive);
    void fogUniforms;
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    scene.add(this.mesh);
  }

  /**
   * Spawn one particle. Positional args avoid allocations in hot paths.
   * colour goes from (r,g,b) to (r2,g2,b2) over its life; alpha fades out.
   */
  spawn(x, y, z, vx, vy, vz, life, size0, size1, frame, r, g, b, a, r2, g2, b2, grav = 0, drag = 0, stretch = 0, rot = 0, rotV = 0, fadeIn = 0, floorY = -1e9) {
    let i;
    if (this.count < this.cap) i = this.count++;
    else i = (Math.random() * this.cap) | 0; // overwrite a random one when full
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = 0; this.maxLife[i] = life;
    this.s0[i] = size0; this.s1[i] = size1;
    this.frame[i] = frame;
    this.r0[i] = r; this.g0[i] = g; this.b0[i] = b; this.a0[i] = a;
    this.r1[i] = r2; this.g1[i] = g2; this.b1[i] = b2;
    this.grav[i] = grav; this.drag[i] = drag; this.stretch[i] = stretch;
    this.rot[i] = rot; this.rotV[i] = rotV; this.fadeIn[i] = fadeIn;
    this.floorY[i] = floorY;
    return i;
  }

  clear() { this.count = 0; this.geo.instanceCount = 0; }

  update(dt) {
    const P = this.aPos.array, V = this.aVel.array, D = this.aData.array, C = this.aColor.array;
    let n = this.count;
    for (let i = 0; i < n; i++) {
      let l = this.life[i] + dt;
      if (l >= this.maxLife[i]) {
        // swap-remove
        n--;
        if (i !== n) this._move(n, i);
        i--;
        continue;
      }
      this.life[i] = l;
      const dr = this.drag[i];
      if (dr > 0) {
        const k = Math.exp(-dr * dt);
        this.vx[i] *= k; this.vy[i] *= k; this.vz[i] *= k;
      }
      this.vy[i] -= this.grav[i] * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      if (this.py[i] < this.floorY[i]) { this.py[i] = this.floorY[i]; this.vy[i] *= -0.2; this.vx[i] *= 0.5; this.vz[i] *= 0.5; }
      this.rot[i] += this.rotV[i] * dt;
      const t = l / this.maxLife[i];
      const fi = this.fadeIn[i];
      let alpha = this.a0[i] * (1 - t) * (1 - t); // quadratic fade-out
      if (fi > 0 && t < fi) alpha *= t / fi;
      const j3 = i * 3, j4 = i * 4;
      P[j3] = this.px[i]; P[j3 + 1] = this.py[i]; P[j3 + 2] = this.pz[i];
      V[j3] = this.vx[i]; V[j3 + 1] = this.vy[i]; V[j3 + 2] = this.vz[i];
      D[j4] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      D[j4 + 1] = this.rot[i];
      D[j4 + 2] = this.stretch[i];
      D[j4 + 3] = this.frame[i];
      C[j4] = this.r0[i] + (this.r1[i] - this.r0[i]) * t;
      C[j4 + 1] = this.g0[i] + (this.g1[i] - this.g0[i]) * t;
      C[j4 + 2] = this.b0[i] + (this.b1[i] - this.b0[i]) * t;
      C[j4 + 3] = alpha;
    }
    this.count = n;
    this.geo.instanceCount = n;
    if (n > 0) {
      for (const a of [this.aPos, this.aVel, this.aData, this.aColor]) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, n * a.itemSize);
        a.needsUpdate = true;
      }
    }
  }

  _move(from, to) {
    const A = this._arrays;
    for (let k = 0; k < A.length; k++) A[k][to] = A[k][from];
  }
}
