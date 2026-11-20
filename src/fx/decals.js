// Ground decals (blood, scorch marks, craters) as one instanced mesh that
// takes part in lighting, so wet blood catches the searchlights.
import * as THREE from 'three';
import { Fn, vec2, vec3, vec4, attribute, texture, uv, positionLocal, floor, mod } from 'three/tsl';
import { lbTerrainH } from '../world/terrain.js';

export class Decals {
  constructor(scene, atlas, capacity = 4000) {
    this.cap = capacity;
    this.head = 0;
    this.count = 0;
    const geo = new THREE.PlaneGeometry(1, 1, 4, 4).rotateX(-Math.PI / 2);
    this.aFrame = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aFrame', this.aFrame);
    // the placement again as (x, z, cos * size, sin * size): the vertex shader lays each corner on
    // the ground under it before the instance matrix moves it there
    this.aDec = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aDec', this.aDec);
    const mat = new THREE.MeshStandardMaterial({
      map: atlas,
      transparent: true,
      depthWrite: false,
      roughness: 0.32,
      metalness: 0.0,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    const aDec = attribute('aDec', 'vec4'), aFrame = attribute('aFrame', 'float');
    mat.positionNode = Fn(() => {
      const p = positionLocal;
      const wx = aDec.x.add(aDec.z.mul(p.x)).add(aDec.w.mul(p.z));
      const wz = aDec.y.sub(aDec.w.mul(p.x)).add(aDec.z.mul(p.z));
      return vec3(p.x, p.y.add(lbTerrainH(vec2(wx, wz))), p.z);
    })();
    const map = texture(atlas);
    mat.colorNode = Fn(() => {
      const zfr = floor(aFrame.add(0.5));
      const zcell = vec2(mod(zfr, 4), floor(zfr.div(4)).negate().add(3));
      return map.sample(zcell.add(uv()).div(4));
    })();
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    this._dirty = false;
    this._yJitter = 0;
  }

  add(x, z, size, frame, r = 1, g = 1, b = 1, rot = Math.random() * Math.PI * 2, y = 0) {
    const i = this.head;
    this.head = (this.head + 1) % this.cap;
    if (this.count < this.cap) this.count++;
    const m = this.mesh.instanceMatrix.array;
    const c = Math.cos(rot) * size, s = Math.sin(rot) * size;
    this._yJitter = (this._yJitter + 1) % 64;
    const o = i * 16;
    m[o] = c; m[o + 1] = 0; m[o + 2] = -s; m[o + 3] = 0;
    m[o + 4] = 0; m[o + 5] = 1; m[o + 6] = 0; m[o + 7] = 0;
    m[o + 8] = s; m[o + 9] = 0; m[o + 10] = c; m[o + 11] = 0;
    m[o + 12] = x; m[o + 13] = y + 0.015 + this._yJitter * 0.0006; m[o + 14] = z; m[o + 15] = 1;
    this.aFrame.array[i] = frame;
    const D = this.aDec.array;
    D[i * 4] = x; D[i * 4 + 1] = z; D[i * 4 + 2] = c; D[i * 4 + 3] = s;
    const col = this.mesh.instanceColor.array;
    col[i * 3] = r; col[i * 3 + 1] = g; col[i * 3 + 2] = b;
    this._dirty = true;
  }

  clear() { this.head = 0; this.count = 0; this.mesh.count = 0; }

  update() {
    if (!this._dirty) return;
    this._dirty = false;
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    this.aFrame.needsUpdate = true;
    this.aDec.needsUpdate = true;
  }
}
