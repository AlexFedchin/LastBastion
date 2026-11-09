// Physically simulated small pieces: gibs, dirt clods, shell casings.
import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export class Debris {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.BufferGeometry} geometry
   * @param {THREE.Material} material
   * @param {number} capacity
   * @param {(x:number,z:number)=>number} floorAt  floor height under a point
   */
  constructor(scene, geometry, material, capacity, floorAt) {
    this.cap = capacity;
    this.n = 0;
    this.floorAt = floorAt;
    const N = capacity;
    this.x = new Float32Array(N); this.y = new Float32Array(N); this.z = new Float32Array(N);
    this.vx = new Float32Array(N); this.vy = new Float32Array(N); this.vz = new Float32Array(N);
    this.rx = new Float32Array(N); this.ry = new Float32Array(N); this.rz = new Float32Array(N);
    this.wx = new Float32Array(N); this.wy = new Float32Array(N); this.wz = new Float32Array(N);
    this.sx = new Float32Array(N); this.sy = new Float32Array(N); this.sz = new Float32Array(N);
    this.life = new Float32Array(N); this.maxLife = new Float32Array(N);
    this.rest = new Uint8Array(N);
    this.bounce = new Float32Array(N);
    this.cr = new Float32Array(N); this.cg = new Float32Array(N); this.cb = new Float32Array(N);
    this.trail = new Uint8Array(N); // 1 = drips blood while flying
    this._arrays = [this.x, this.y, this.z, this.vx, this.vy, this.vz, this.rx, this.ry, this.rz, this.wx, this.wy, this.wz,
      this.sx, this.sy, this.sz, this.life, this.maxLife, this.rest, this.bounce, this.cr, this.cg, this.cb, this.trail];

    this.mesh = new THREE.InstancedMesh(geometry, material, N);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    this.onLand = null;   // (x, z, index) => void
    this.onTrail = null;  // (x, y, z) => void
  }

  spawn(x, y, z, vx, vy, vz, sx, sy, sz, r, g, b, life = 8, bounce = 0.25, trail = 0) {
    let i;
    if (this.n < this.cap) i = this.n++;
    else i = (Math.random() * this.cap) | 0;
    this.x[i] = x; this.y[i] = y; this.z[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.rx[i] = Math.random() * 6.28; this.ry[i] = Math.random() * 6.28; this.rz[i] = Math.random() * 6.28;
    this.wx[i] = (Math.random() - 0.5) * 24; this.wy[i] = (Math.random() - 0.5) * 24; this.wz[i] = (Math.random() - 0.5) * 24;
    this.sx[i] = sx; this.sy[i] = sy; this.sz[i] = sz;
    this.life[i] = 0; this.maxLife[i] = life;
    this.rest[i] = 0; this.bounce[i] = bounce;
    this.cr[i] = r; this.cg[i] = g; this.cb[i] = b;
    this.trail[i] = trail;
  }

  clear() { this.n = 0; this.mesh.count = 0; }

  update(dt) {
    let n = this.n;
    const M = this.mesh.instanceMatrix.array;
    const C = this.mesh.instanceColor.array;
    for (let i = 0; i < n; i++) {
      const l = this.life[i] + dt;
      if (l >= this.maxLife[i]) {
        n--;
        if (i !== n) this._move(n, i);
        i--;
        continue;
      }
      this.life[i] = l;
      if (!this.rest[i]) {
        this.vy[i] -= 22 * dt;
        this.x[i] += this.vx[i] * dt;
        this.y[i] += this.vy[i] * dt;
        this.z[i] += this.vz[i] * dt;
        this.rx[i] += this.wx[i] * dt; this.ry[i] += this.wy[i] * dt; this.rz[i] += this.wz[i] * dt;
        const fy = this.floorAt(this.x[i], this.z[i]) + this.sy[i] * 0.4;
        if (this.trail[i] && Math.random() < 0.35 && this.onTrail) this.onTrail(this.x[i], this.y[i], this.z[i]);
        if (this.y[i] < fy) {
          this.y[i] = fy;
          if (this.vy[i] < -2.5 && this.bounce[i] > 0) {
            this.vy[i] = -this.vy[i] * this.bounce[i];
            this.vx[i] *= 0.55; this.vz[i] *= 0.55;
            this.wx[i] *= 0.5; this.wy[i] *= 0.5; this.wz[i] *= 0.5;
            if (this.onLand && this.trail[i]) this.onLand(this.x[i], this.z[i], i);
          } else {
            this.rest[i] = 1;
            if (this.onLand && this.trail[i]) this.onLand(this.x[i], this.z[i], i);
          }
        }
      }
      // shrink away at end of life
      const t = l / this.maxLife[i];
      const k = t > 0.85 ? 1 - (t - 0.85) / 0.15 : 1;
      _p.set(this.x[i], this.y[i], this.z[i]);
      _e.set(this.rx[i], this.ry[i], this.rz[i]);
      _q.setFromEuler(_e);
      _s.set(this.sx[i] * k, this.sy[i] * k, this.sz[i] * k);
      _m.compose(_p, _q, _s);
      _m.toArray(M, i * 16);
      C[i * 3] = this.cr[i]; C[i * 3 + 1] = this.cg[i]; C[i * 3 + 2] = this.cb[i];
    }
    this.n = n;
    this.mesh.count = n;
    if (n > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor.needsUpdate = true;
    }
  }

  _move(from, to) {
    const A = this._arrays;
    for (let k = 0; k < A.length; k++) A[k][to] = A[k][from];
  }
}
