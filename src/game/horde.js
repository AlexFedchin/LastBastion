// The horde: SoA simulation of thousands of zombies, the pile-up/breach
// mechanic, hit detection, explosions and the corpse field.
import * as THREE from 'three';
import { instanceMatrixNode } from '../render/nodeUtil.js';
import { Fn, float, vec3, vec4, attribute, instancedBufferAttribute, varyingProperty, cameraProjectionMatrix, cameraViewMatrix, length, max, pow } from 'three/tsl';
import {
  ZOMBIE_TYPES, ZT, WORLD, wallZ, wallDist, wallFacing, sectionOf, PILE,
  ZOMBIE_HEIGHT, WING_COS,
} from '../config.js';
import { nearObstacle, steer, pushOut } from '../world/obstacles.js';
import { createGiantGeometry, createZombieMaterial, createZombieDepthMaterial, createEyeMesh } from './zombieModel.js';
import { createSkinnedZombieMaterial } from './zombieSkin.js';
import { rand } from '../core/util.js';
import { groundH, valleyEdge } from '../world/terrain.js';
import { fogUniforms } from '../render/atmosphere.js';

const _ob = [0, 0];
const CELL = 2;
const GX0 = -230, GZ0 = -300;
const GW = 230, GH = 156;
const NCELLS = GW * GH;


const PILE_S_MIN = (PILE.MIN_X - WORLD.GATE_HALF) / WING_COS;     // nearest mound centre to the tower (m along the wall)
const PILE_S_MAX = (WORLD.WING_END - WORLD.GATE_HALF) / WING_COS - 2;

const EXPLOSIVE = { arty: 1, mortar: 1, grenade: 1, mine: 1, bloater: 1, danger: 1, he: 1, bomb: 1, gunship: 1 };

const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();

function addInstanced(geo, name, cap, size) {
  const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * size), size).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute(name, a);
  return a;
}

class CorpseField {
  constructor(scene, cap, uniforms) {
    this.scene = scene; this.cap = cap; this.uniforms = uniforms;
    this.giant = new Corpses(scene, 3, uniforms, 'giant');
    this.pools = [];               // near, mid, far: the zombie model (useModel)
    this.lim2 = [38 * 38, 95 * 95]; // the camera never moves: a body's detail is fixed where it falls
    this._onLand = null;
  }
  /** The zombie model is in: bodies from now on are skinned (see SkinCorpses). */
  useModel(skin) {
    const share = [0.32, 0.4, 0.28];
    this.pools = skin.geos.map((g, li) => new SkinCorpses(this.scene, Math.round(this.cap * share[li]), this.uniforms, skin, li));
    for (const p of this.pools) p.onLand = this._onLand;
  }
  set onLand(fn) { this._onLand = fn; for (const p of this.pools) p.onLand = fn; this.giant.onLand = fn; }
  get count() { return this.pools.reduce((a, p) => a + p.count, 0) + this.giant.count; }
  add(x, y, z, yaw, scale, type, ...rest) {
    if (type === ZT.GIANT) { this.giant.add(x, y, z, yaw, scale, type, ...rest); return; }
    if (!this.pools.length) return;
    const dx = x - WORLD.CAM.x, dz = z - WORLD.CAM.z, d2 = dx * dx + dz * dz;
    this.pools[d2 < this.lim2[0] ? 0 : d2 < this.lim2[1] ? 1 : 2].add(x, y, z, yaw, scale, type, ...rest);
  }
  update(dt) { for (const p of this.pools) p.update(dt); this.giant.update(dt); }
  clear() { for (const p of this.pools) p.clear(); this.giant.clear(); }
}

// ─────────────────────────────────────────────────────────────────────────────
// The dead, on the zombie model: shot ones play a death (falling back mostly, or folding
// forward onto their knees), thrown ones tumble in a limp pose and land flat; then they lie
// as they fell.
const DEATHS = [['death2', 1.75, 0.78], ['death1', 2.5, 1]]; // [clip, playback rate, cumulative chance]
class SkinCorpses {
  constructor(scene, cap, uniforms, skin, lod) {
    this.cap = cap; this.head = 0; this.count = 0;
    this.anim = skin.anim;
    const geo = skin.geos[lod].clone();
    this.aAnim = addInstanced(geo, 'aAnim', cap, 4);
    this.aState = addInstanced(geo, 'aState', cap, 4);
    this.aTint = addInstanced(geo, 'aTint', cap, 3);
    this.mesh = new THREE.InstancedMesh(geo, createSkinnedZombieMaterial(skin.anim, skin.maps, uniforms, { corpse: true }), cap);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    const F = () => new Float32Array(cap);
    this.x = F(); this.y = F(); this.z = F(); this.vx = F(); this.vy = F(); this.vz = F();
    this.yaw = F(); this.pitch = F(); this.pv = F(); this.roll = F(); this.rv = F(); this.scale = F();
    this.t = F(); this.rate = F(); this.target = F();
    this.clip = new Int16Array(cap);
    this.mode = new Uint8Array(cap); // 0 lying · 2 flying · 3 settling · 4 dying (playing its death)
    this.active = [];
    this.dirty = false;
    this.onLand = null;
    this.ids = DEATHS.map(([c]) => this.anim.id[c]);
    this.thrown = this.anim.id.thrown;
  }
  clear() { this.head = 0; this.count = 0; this.mesh.count = 0; this.active.length = 0; this.mode.fill(0); }
  add(x, y, z, yaw, scale, type, tint, vx, vy, vz, headless, charred, flying, look = 0) {
    const i = this.head;
    this.head = (this.head + 1) % this.cap;
    if (this.count < this.cap) this.count++;
    const wasActive = this.mode[i] !== 0;
    this.x[i] = x; this.y[i] = y; this.z[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.yaw[i] = yaw; this.scale[i] = scale;
    this.t[i] = 0;
    let row;
    if (flying) {
      this.mode[i] = 2;
      this.y[i] = y + 0.9 * scale;
      this.roll[i] = (Math.random() - 0.5) * 0.5;
      this.pitch[i] = (Math.random() - 0.5) * 0.6;
      const spin = Math.min(1.6, 0.5 + Math.hypot(vx, vy, vz) / 22) / Math.sqrt(scale);
      this.pv[i] = (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 9) * spin;
      this.rv[i] = (Math.random() - 0.5) * 9 * spin;
      row = this.anim.row(this.thrown, Math.random() < 0.5 ? 0 : 1 / this.anim.fps);
    } else {
      this.mode[i] = 4;
      this.pitch[i] = 0; this.roll[i] = 0; this.pv[i] = 0; this.rv[i] = 0;
      const r = Math.random();
      const k = DEATHS.findIndex((d) => r < d[2]);
      this.clip[i] = this.ids[k];
      this.rate[i] = DEATHS[k][1] * (0.85 + Math.random() * 0.3) / Math.sqrt(scale);
      row = this.anim.row(this.clip[i], 0);
    }
    const A = this.aAnim.array, S = this.aState.array, T = this.aTint.array;
    A[i * 4] = row; A[i * 4 + 1] = 0; A[i * 4 + 2] = 0; A[i * 4 + 3] = look;
    S[i * 4] = 0; S[i * 4 + 1] = charred ? 1 : 0; S[i * 4 + 2] = type; S[i * 4 + 3] = headless ? 1 : 0;
    T[i * 3] = tint[0]; T[i * 3 + 1] = tint[1]; T[i * 3 + 2] = tint[2];
    this.aAnim.needsUpdate = this.aState.needsUpdate = this.aTint.needsUpdate = true;
    if (!wasActive) this.active.push(i);
    this.write(i);
  }
  write(i) {
    const s = this.scale[i];
    if (this.mode[i] === 4 || (this.mode[i] === 0 && this.pitch[i] === 0)) {
      // standing where it was shot, the death clip does the falling
      _e.set(0, this.yaw[i], 0, 'YXZ');
      _q.setFromEuler(_e);
      _p.set(this.x[i], this.y[i] + groundH(this.x[i], this.z[i]), this.z[i]);
      _s.set(s, s, s);
      _m.compose(_p, _q, _s);
    } else {
      // thrown: tumbling about its middle
      _e.set(this.pitch[i], this.yaw[i], this.roll[i], 'YXZ');
      _q.setFromEuler(_e);
      _p.set(this.x[i], this.y[i] + groundH(this.x[i], this.z[i]), this.z[i]);
      _s.set(s, s, s);
      _m.compose(_p, _q, _s);
      const e = _m.elements;
      e[12] -= 0.9 * e[4]; e[13] -= 0.9 * e[5]; e[14] -= 0.9 * e[6];
    }
    _m.toArray(this.mesh.instanceMatrix.array, i * 16);
    this.dirty = true;
  }
  update(dt) {
    const act = this.active, A = this.aAnim.array;
    let animDirty = false;
    for (let k = 0; k < act.length; k++) {
      const i = act[k];
      const s = this.scale[i], mode = this.mode[i];
      if (mode === 4) {
        // dying: the clip plays out; a body shot on the mound drops to the ground as it goes
        this.t[i] += dt * this.rate[i];
        if (this.y[i] > 0) { this.vy[i] -= 20 * dt; this.y[i] = Math.max(0, this.y[i] + this.vy[i] * dt); }
        const damp = Math.exp(-4 * dt);
        this.x[i] += this.vx[i] * dt; this.z[i] += this.vz[i] * dt; this.vx[i] *= damp; this.vz[i] *= damp;
        A[i * 4] = this.anim.row(this.clip[i], this.t[i]);
        animDirty = true;
        if (this.t[i] >= this.anim.dur(this.clip[i]) && this.y[i] <= 0) {
          this.mode[i] = 0;
          if (this.onLand) this.onLand(this.x[i], this.z[i], 0.6);
          this.write(i);
          act[k] = act[act.length - 1]; act.pop(); k--;
          continue;
        }
      } else if (mode === 2) {
        this.vy[i] -= 22 * dt;
        const drag = Math.exp(-0.25 * dt);
        this.vx[i] *= drag; this.vz[i] *= drag;
        this.x[i] += this.vx[i] * dt; this.y[i] += this.vy[i] * dt; this.z[i] += this.vz[i] * dt;
        if (wallDist(this.x[i], this.z[i]) < 0.5 && Math.abs(this.x[i]) < WORLD.WING_END) {
          const ax = Math.abs(this.x[i]);
          this.z[i] = wallZ(this.x[i]) - (ax <= WORLD.GATE_HALF ? 0.5 : 0.5 / WING_COS);
          this.vx[i] *= 0.2; this.vz[i] = Math.min(0, this.vz[i]) * 0.2 - 1; this.pv[i] *= 0.3;
        }
        this.pitch[i] += this.pv[i] * dt;
        this.roll[i] += this.rv[i] * dt;
        const floor = 0.14 * s;
        if (this.y[i] <= floor && this.vy[i] < 0) {
          this.y[i] = floor;
          const impact = -this.vy[i];
          if (this.onLand) this.onLand(this.x[i], this.z[i], Math.min(1.6, 0.5 + impact * 0.05));
          if (impact > 9) {
            this.vy[i] = impact * 0.25; this.vx[i] *= 0.4; this.vz[i] *= 0.4; this.pv[i] *= 0.5; this.rv[i] *= 0.5;
          } else {
            this.mode[i] = 3;
            this.t[i] = 0;
            const sp = Math.sin(this.pitch[i]);
            this.target[i] = sp >= 0 ? Math.PI / 2 : -Math.PI / 2;
            this.pitch[i] = Math.atan2(Math.sin(this.pitch[i]), Math.cos(this.pitch[i]));
          }
        }
      } else if (mode === 3) {
        this.t[i] += dt;
        const k2 = Math.min(1, this.t[i] / 0.16);
        this.pitch[i] += (this.target[i] - this.pitch[i]) * k2;
        this.roll[i] *= 1 - k2 * 0.8;
        this.x[i] += this.vx[i] * dt * (1 - k2); this.z[i] += this.vz[i] * dt * (1 - k2);
        if (k2 >= 1) {
          this.mode[i] = 0;
          if (this.pitch[i] === 0) this.pitch[i] = 1e-4; // (stays drawn lying flat, not standing)
          this.write(i);
          act[k] = act[act.length - 1]; act.pop(); k--;
          continue;
        }
      }
      this.write(i);
    }
    if (animDirty) this.aAnim.needsUpdate = true;
    if (this.dirty) {
      this.mesh.count = this.count;
      this.mesh.instanceMatrix.needsUpdate = true;
      this.dirty = false;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
class Corpses {
  constructor(scene, cap, uniforms, lod = 1) {
    this.cap = cap;
    this.head = 0;
    this.count = 0;
    const geo = lod === 'giant' ? createGiantGeometry() : createZombieGeometry(lod);
    this.aAnim = addInstanced(geo, 'aAnim', cap, 4);
    this.aState = addInstanced(geo, 'aState', cap, 4);
    this.aTint = addInstanced(geo, 'aTint', cap, 3);
    this.mesh = new THREE.InstancedMesh(geo, createZombieMaterial(uniforms, { corpse: true }), cap);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = lod === 'giant';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);

    // physics state per slot
    this.x = new Float32Array(cap); this.y = new Float32Array(cap); this.z = new Float32Array(cap);
    this.vx = new Float32Array(cap); this.vy = new Float32Array(cap); this.vz = new Float32Array(cap);
    this.yaw = new Float32Array(cap); this.pitch = new Float32Array(cap); this.pv = new Float32Array(cap);
    this.roll = new Float32Array(cap); this.rv = new Float32Array(cap);
    this.scale = new Float32Array(cap);
    this.mode = new Uint8Array(cap);  // 0 static · 1 topple (feet pivot) · 2 flying · 3 settle
    this.t = new Float32Array(cap);
    this.target = new Float32Array(cap);
    this.active = [];
    this.dirty = false;
    this.onLand = null;
  }

  clear() { this.head = 0; this.count = 0; this.mesh.count = 0; this.active.length = 0; this.mode.fill(0); }

  add(x, y, z, yaw, scale, type, tint, vx, vy, vz, headless, charred, flying) {
    const i = this.head;
    this.head = (this.head + 1) % this.cap;
    if (this.count < this.cap) this.count++;
    const wasActive = this.mode[i] !== 0;
    this.x[i] = x; this.y[i] = y; this.z[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.yaw[i] = yaw; this.scale[i] = scale;
    this.roll[i] = (Math.random() - 0.5) * 0.5;
    this.t[i] = 0;
    if (flying) {
      this.mode[i] = 2;
      // convert feet position to body centre
      this.y[i] = y + 0.9 * scale;
      this.pitch[i] = (Math.random() - 0.5) * 0.6;
      // cartwheel in proportion to how hard it was thrown (heavy bodies spin slower)
      const spin = Math.min(1.6, 0.5 + Math.hypot(vx, vy, vz) / 22) / Math.sqrt(scale);
      this.pv[i] = (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 9) * spin;
      this.rv[i] = (Math.random() - 0.5) * 9 * spin;
    } else {
      this.mode[i] = 1;
      // fall backwards along the shot, sometimes crumple forwards
      const back = Math.random() < 0.8 ? -1 : 1;
      this.pitch[i] = 0;
      this.pv[i] = back * (1.2 + Math.random() * 1.5);
      this.rv[i] = 0;
    }
    const A = this.aAnim.array, S = this.aState.array, T = this.aTint.array;
    A[i * 4] = Math.random() * 40; A[i * 4 + 1] = 0; A[i * 4 + 2] = type; A[i * 4 + 3] = 0;
    S[i * 4] = 0; S[i * 4 + 1] = charred ? 1 : 0; S[i * 4 + 2] = 0; S[i * 4 + 3] = headless ? 1 : 0;
    T[i * 3] = tint[0]; T[i * 3 + 1] = tint[1]; T[i * 3 + 2] = tint[2];
    this.aAnim.needsUpdate = this.aState.needsUpdate = this.aTint.needsUpdate = true;
    if (!wasActive) this.active.push(i);
    this.write(i);
  }

  write(i) {
    const s = this.scale[i];
    const p = this.pitch[i];
    let cx, cy, cz;
    if (this.mode[i] === 1) {
      // rotate about the feet
      const sp = Math.sin(p), cp = Math.cos(p);
      cx = this.x[i] + 0.9 * s * sp * Math.sin(this.yaw[i]);
      cz = this.z[i] + 0.9 * s * sp * Math.cos(this.yaw[i]);
      cy = this.y[i] + 0.9 * s * cp + 0.13 * s * Math.abs(sp);
    } else {
      cx = this.x[i]; cy = this.y[i]; cz = this.z[i];
    }
    _e.set(p, this.yaw[i], this.roll[i], 'YXZ');
    _q.setFromEuler(_e);
    _p.set(cx, cy + groundH(cx, cz), cz);
    _s.set(s, s, s);
    _m.compose(_p, _q, _s);
    const e = _m.elements;
    e[12] -= 0.9 * e[4]; e[13] -= 0.9 * e[5]; e[14] -= 0.9 * e[6];
    _m.toArray(this.mesh.instanceMatrix.array, i * 16);
    this.dirty = true;
  }

  update(dt) {
    const act = this.active;
    for (let k = 0; k < act.length; k++) {
      const i = act[k];
      const s = this.scale[i];
      const mode = this.mode[i];
      if (mode === 1) {
        // topple: angular acceleration like a falling plank
        const sgn = this.pv[i] < 0 ? -1 : 1;
        this.pv[i] += sgn * 9 * dt;
        this.pitch[i] += this.pv[i] * dt;
        this.x[i] += this.vx[i] * dt; this.z[i] += this.vz[i] * dt;
        this.vx[i] *= Math.exp(-4 * dt); this.vz[i] *= Math.exp(-4 * dt);
        if (this.y[i] > 0) { this.vy[i] -= 20 * dt; this.y[i] = Math.max(0, this.y[i] + this.vy[i] * dt); }
        if (Math.abs(this.pitch[i]) >= Math.PI / 2 && this.y[i] <= 0) {
          this.pitch[i] = sgn * Math.PI / 2;
          // convert to centre-based static pose
          const sp = Math.sin(this.pitch[i]);
          this.x[i] += 0.9 * s * sp * Math.sin(this.yaw[i]);
          this.z[i] += 0.9 * s * sp * Math.cos(this.yaw[i]);
          this.y[i] = 0.13 * s;
          this.mode[i] = 0;
          if (this.onLand) this.onLand(this.x[i], this.z[i], 0.6);
          this.write(i);
          act[k] = act[act.length - 1]; act.pop(); k--;
          continue;
        }
      } else if (mode === 2) {
        this.vy[i] -= 22 * dt;
        const drag = Math.exp(-0.25 * dt);
        this.vx[i] *= drag; this.vz[i] *= drag;
        this.x[i] += this.vx[i] * dt; this.y[i] += this.vy[i] * dt; this.z[i] += this.vz[i] * dt;
        // the wall stops them: slap against the face and slide down
        if (wallDist(this.x[i], this.z[i]) < 0.5 && Math.abs(this.x[i]) < WORLD.WING_END) {
          const ax = Math.abs(this.x[i]);
          this.z[i] = wallZ(this.x[i]) - (ax <= WORLD.GATE_HALF ? 0.5 : 0.5 / WING_COS);
          this.vx[i] *= 0.2; this.vz[i] = Math.min(0, this.vz[i]) * 0.2 - 1; this.pv[i] *= 0.3;
        }
        this.pitch[i] += this.pv[i] * dt;
        this.roll[i] += this.rv[i] * dt;
        const floor = 0.14 * s;
        if (this.y[i] <= floor && this.vy[i] < 0) {
          this.y[i] = floor;
          const impact = -this.vy[i];
          if (this.onLand) this.onLand(this.x[i], this.z[i], Math.min(1.6, 0.5 + impact * 0.05));
          if (impact > 9) {
            // bounce once, limp
            this.vy[i] = impact * 0.25; this.vx[i] *= 0.4; this.vz[i] *= 0.4; this.pv[i] *= 0.5; this.rv[i] *= 0.5;
          } else {
            this.mode[i] = 3;
            this.t[i] = 0;
            const sp = Math.sin(this.pitch[i]);
            this.target[i] = sp >= 0 ? Math.PI / 2 : -Math.PI / 2;
            // keep winding consistent
            this.pitch[i] = Math.atan2(Math.sin(this.pitch[i]), Math.cos(this.pitch[i]));
          }
        }
      } else if (mode === 3) {
        this.t[i] += dt;
        const k2 = Math.min(1, this.t[i] / 0.16);
        this.pitch[i] += (this.target[i] - this.pitch[i]) * k2;
        this.roll[i] *= 1 - k2 * 0.8;
        this.x[i] += this.vx[i] * dt * (1 - k2); this.z[i] += this.vz[i] * dt * (1 - k2);
        if (k2 >= 1) {
          this.mode[i] = 0;
          this.write(i);
          act[k] = act[act.length - 1]; act.pop(); k--;
          continue;
        }
      }
      this.write(i);
    }
    if (this.dirty) {
      this.mesh.count = this.count;
      this.mesh.instanceMatrix.needsUpdate = true;
      this.dirty = false;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
export class Horde {
  constructor(scene, fx, { cap = 1500, limit = cap, corpseCap = 2500, shadows = true, uniforms }) {
    this.scene = scene;
    this.fx = fx;
    this.cap = cap;     // room allocated
    this.limit = limit; // how many spawn: the quality's number, raised only for the extraction's last stand
    this.n = 0;
    this.alive = 0;
    this.nextId = 1;
    this.pileMul = 1;
    this.globalSpeed = 1;
    this.uniforms = uniforms;

    const N = cap;
    const F = () => new Float32Array(N);
    this.id = new Int32Array(N);
    this.x = F(); this.y = F(); this.z = F(); this.yaw = F();
    this.hp = F(); this.maxHp = F(); this.speed = F(); this.rate = F(); this.phase = F(); this.lean = F();
    this.scale = F(); this.radius = F(); this.weight = F();
    this.tgtX = F(); this.tgtZ = F();
    this.flash = F(); this.burn = F(); this.burnDps = F(); this.atk = F();
    this.climb = F(); this.climbDur = F(); this.slow = F();
    this.tr = F(); this.tg = F(); this.tb = F();
    this.type = new Uint8Array(N); this.dead = new Uint8Array(N);
    this.pileJit = F();
    this.fadeIn = F();
    this.seek = F(); // countdown to looking for a mound to join, or to looking again at the one it joined
    this.sought = new Int8Array(N); // the mound it is heading for, + 1 (0: none, it is going for the wall)
    this.inside = new Uint8Array(N); // over the wall and in the yard (only in the extraction: overWall)
    // the model's animation (animStep): the clip playing and the one fading out under it
    this.look = F();                          // which of the three looks, + a seed in the fraction
    this.aClip = F(); this.aT = F(); this.pClip = F(); this.pT = F(); this.xf = F();
    this.px = F(); this.pz = F(); this.mv = F(); // last position, smoothed ground speed
    this.hitT = F(); this.hitCd = F();          // a flinch playing, and the time before the next can
    this.overWall = null; // the extraction sets (x, z) -> [tx, tz]: climbers drop into the yard and run there
    this._arrays = [this.seek, this.id, this.x, this.y, this.z, this.yaw, this.hp, this.maxHp, this.speed, this.rate, this.phase, this.lean,
      this.scale, this.radius, this.weight, this.tgtX, this.tgtZ, this.flash, this.burn, this.burnDps, this.atk, this.climb,
      this.climbDur, this.slow, this.tr, this.tg, this.tb, this.type, this.dead, this.pileJit, this.fadeIn, this.inside, this.sought,
      this.look, this.aClip, this.aT, this.pClip, this.pT, this.xf, this.px, this.pz, this.mv, this.hitT, this.hitCd];

    // mounds against the wall (see PILE): position along the wall (m from the tower corner) per side
    const P = PILE.MAX;
    this.pAct = new Uint8Array(P); this.pSide = new Int8Array(P);
    this.pS = new Float32Array(P); this.pX = new Float32Array(P);
    this.pH = new Float32Array(P);                                  // height (m)
    this.pW = new Float32Array(P); this.pWn = new Float32Array(P);  // weight on it: last frame / this frame
    this.pTop = new Float32Array(P); this.pTopN = new Float32Array(P); // highest body on it
    this.pAcid = new Float32Array(P);                               // melted ramp under it (bloaters, giants)
    this.pClimb = new Int32Array(P); this.pIdle = new Float32Array(P);
    // per wall section, for the HUD / wall blood / telemetry: the worst mound in it
    this.pileH = new Float32Array(WORLD.SECTIONS);
    this.pileTop = new Float32Array(WORLD.SECTIONS);
    this.acid = new Float32Array(WORLD.SECTIONS);

    // spatial grid
    this.cellStart = new Int32Array(NCELLS + 1);
    this.cellItems = new Int32Array(N);
    this.cellOf = new Int32Array(N);
    this._q = new Int32Array(N);

    // ray hits
    this.hitIdx = new Int32Array(16);
    this.hitT = new Float32Array(16);
    this.hitFrac = new Float32Array(16);

    this.pending = []; // delayed explosions (bloater chains)
    this._gibChance = -1; // set by explode() for the kill it is about to cause

    // rendering: living — the zombie model at three levels of detail (useModel, once it has
    // loaded), and the giants, few and huge, on a sculpted mesh of their own
    this.shadows = shadows;
    const geo = createGiantGeometry();
    const big = {
      aAnim: addInstanced(geo, 'aAnim', 4, 4), aState: addInstanced(geo, 'aState', 4, 4), aTint: addInstanced(geo, 'aTint', 4, 3),
    };
    big.mesh = new THREE.InstancedMesh(geo, createZombieMaterial(uniforms), 4);
    big.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    big.mesh.count = 0;
    big.mesh.frustumCulled = false;
    big.mesh.castShadow = shadows;
    big.mesh.receiveShadow = true;
    scene.add(big.mesh);
    this.big = big;
    this.lods = [];
    this.lodLim2 = [44 * 44, 120 * 120];
    this.anim = null;
    // full per-zombie buffers (eyes see every zombie): the giant's old pose inputs, and where the eyes are
    this.aAnim = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aState = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aEye = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.tintBuf = new Float32Array(N * 3);
    this.eyes = createEyeMesh(N, uniforms, fogUniforms, this.aAnim, this.aState, this.aEye);
    this.eyes.count = 0;
    scene.add(this.eyes);
    // soft contact shadows that ground every walker
    {
      const bg = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
      const bm = new THREE.MeshBasicNodeMaterial({
        transparent: true, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      this.blobs = new THREE.InstancedMesh(bg, bm, N);
      this.blobs.instanceMatrix = this.eyes.instanceMatrix;
      {
        const IM = instanceMatrixNode(this.eyes.instanceMatrix);
        const corner = attribute('position', 'vec3');
        const vB = varyingProperty('vec2', 'vBlob');
        bm.vertexNode = Fn(() => {
          vB.assign(corner.xz.mul(2));
          const c = IM.mul(vec4(0, 0, 0, 1)).xyz;
          const s = length(IM.mul(vec4(1, 0, 0, 0)).xyz);
          const p = c.add(vec3(corner.x.mul(1.1).mul(s), 0.035, corner.z.mul(1.25).mul(s)));
          return cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(p, 1)));
        })();
        bm.colorNode = Fn(() => vec4(0, 0, 0, pow(max(0, float(1).sub(length(vB))), 1.6).mul(0.55)))();
      }
      this.blobs.count = 0;
      this.blobs.frustumCulled = false;
      this.blobs.renderOrder = 2;
      scene.add(this.blobs);
    }
    this.fire = null; // FireSystem, set by the game

    // the camera never moves, so a corpse's level of detail is fixed where it falls
    this.corpses = new CorpseField(scene, corpseCap, uniforms);
    this.corpses.onLand = (x, z, size) => { this.fx.blood(x, z, size); };

    // hooks set by the game
    this.onKill = null;      // (type, cause, x, y, z, headshot)
    this.onBreach = null;    // (section, x, y, z)
    this.onIgnite = null;    // (index): one of them just caught fire
    this.onBloaterWall = null;
    this.onGiantWall = null;  // (i, section, x, z, dt)
    this.ctx = { fireAt: null, wireAt: null };
  }

  /**
   * The zombie model has loaded: { anim: ZombieAnim, geos: [lod0, lod1, lod2], maps: { looks, normal } }.
   * The living draw on it from now on, and so do the dead.
   */
  useModel(skin) {
    this.anim = skin.anim;
    const mat = createSkinnedZombieMaterial(skin.anim, skin.maps, this.uniforms);
    const depth = createSkinnedZombieMaterial(skin.anim, skin.maps, this.uniforms, { depth: true });
    const N = this.cap;
    this.lods = skin.geos.map((g, li) => {
      const geo = g.clone();
      const L = { aAnim: addInstanced(geo, 'aAnim', N, 4), aState: addInstanced(geo, 'aState', N, 4), aTint: addInstanced(geo, 'aTint', N, 3) };
      L.mesh = new THREE.InstancedMesh(geo, mat, N);
      if (depth) L.mesh.customDepthMaterial = depth;
      L.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      L.mesh.count = 0;
      L.mesh.frustumCulled = false;
      L.mesh.castShadow = this.shadows && li < 2;
      L.mesh.receiveShadow = true;
      this.scene.add(L.mesh);
      return L;
    });
    this.mesh = this.lods[0].mesh;
    const id = skin.anim.id;
    this.CLIP = {
      walk: id.shuffle, jog: id.jog, limp: id.limp, stomp: id.stomp, waddle: id.waddle, sprint: id.sprint,
      claw: id.claw, scramble: id.scramble, climb: id.climb, perch: id.perch, burn: id.burn, gethit: id.gethit,
      idle: [id.idle1, id.idle2, id.roar], attack: [id.attack1, id.attack2, id.attack3],
    };
    this.LOCO = new Set([id.shuffle, id.jog, id.limp, id.stomp, id.waddle, id.sprint, id.burn]);
    this.corpses.useModel(skin);
  }

  clear() {
    this.n = 0; this.alive = 0;
    this.pending.length = 0;
    this.pileH.fill(0); this.acid.fill(0); this.pileTop.fill(0);
    this.pAct.fill(0); this.pH.fill(0); this.pW.fill(0); this.pWn.fill(0); this.pAcid.fill(0); this.pTop.fill(0); this.pTopN.fill(0);
    this.corpses.clear();
    for (const L of this.lods) L.mesh.count = 0;
    this.big.mesh.count = 0;
    this.eyes.count = 0;
    this.blobs.count = 0;
    this.cellStart.fill(0);
  }

  /** Remove every living zombie without corpses (night failsafe). */
  clearLiving() {
    for (let i = 0; i < this.n; i++) this.dead[i] = 1;
    this.compact();
    this.buildGrid();
  }

  // ── spawning ─────────────────────────────────────────────────────────────
  spawn(type, x, z, hpMul = 1, speedMul = 1, laneSide = 0) {
    if (this.n >= Math.min(this.cap, this.limit)) return -1;
    // out on the field: on the valley floor, not up its walls (the edge wanders in and out)
    if (z < -40) { const e = valleyEdge(z, x) - 14; if (Math.abs(x) > e) x = Math.sign(x) * e; }
    const T = ZOMBIE_TYPES[type];
    const i = this.n++;
    this.alive++;
    this.id[i] = this.nextId++;
    this.type[i] = type;
    this.dead[i] = 0; this.inside[i] = 0;
    this.x[i] = x; this.z[i] = z; this.y[i] = 0;
    const sc = rand(T.scale[0], T.scale[1]);
    this.scale[i] = sc;
    this.radius[i] = T.radius * sc;
    this.weight[i] = T.weight;
    const hp = T.hp * hpMul * rand(0.92, 1.08);
    this.hp[i] = hp; this.maxHp[i] = hp;
    const sp = rand(T.speed[0], T.speed[1]) * speedMul;
    this.speed[i] = sp;
    this.rate[i] = sp * T.animK / sc;
    this.phase[i] = Math.random() * 60;
    this.fadeIn[i] = 1; // emerge from the mist
    this.lean[i] = rand(T.lean[0], T.lean[1]);
    // pick a lane on the wall, mostly on the near wing
    let side = laneSide !== 0 ? laneSide : (Math.random() < 0.72 ? Math.sign(x || 1) : -Math.sign(x || 1));
    const lx = side * rand(PILE.MIN_X - 3, WORLD.WING_END - 3);
    this.tgtX[i] = lx;
    this.tgtZ[i] = wallZ(lx) - 0.2;
    this.seek[i] = Math.random();
    this.sought[i] = 0;
    this.yaw[i] = Math.atan2(lx - x, this.tgtZ[i] - z);
    this.flash[i] = 0; this.burn[i] = 0; this.burnDps[i] = 0; this.atk[i] = 0;
    this.climb[i] = 0; this.climbDur[i] = rand(PILE.CLIMB_TIME[0], PILE.CLIMB_TIME[1]);
    this.slow[i] = 0;
    this.pileJit[i] = Math.random();
    if (type === ZT.GIANT) {
      // (the giant's own mesh: its hide colour)
      this.tr[i] = 0.06; this.tg[i] = 0.05; this.tb[i] = 0.045;
    } else {
      // the model's textures, a little dirtier or paler one to the next
      const v = rand(0.72, 1.08), w = rand(-0.06, 0.06);
      let c = [v * (1 + w), v, v * (1 - w)];
      if (type === ZT.BRUTE) c = [v * 0.78, v * 0.76, v * 0.72];
      this.tr[i] = c[0]; this.tg[i] = c[1]; this.tb[i] = c[2];
    }
    this.look[i] = ((Math.random() * 3) | 0) + Math.random() * 0.98;
    this.aClip[i] = -1; this.pClip[i] = -1; this.xf[i] = 0; this.aT[i] = 0; this.pT[i] = 0;
    this.px[i] = x; this.pz[i] = z; this.mv[i] = sp; this.hitT[i] = 0; this.hitCd[i] = 0;
    return i;
  }

  /** Send a zombie back to a lane on the wall (after an event pulled it elsewhere). */
  resetLane(i, side = 0) {
    const x = this.x[i];
    const s = side || (Math.random() < 0.72 ? Math.sign(x || 1) : -Math.sign(x || 1));
    const lx = s * rand(PILE.MIN_X - 3, WORLD.WING_END - 3);
    this.tgtX[i] = lx;
    this.tgtZ[i] = wallZ(lx) - 0.2;
    this.seek[i] = Math.random();
    this.sought[i] = 0;
  }

  // ── mounds ───────────────────────────────────────────────────────────────
  /** The mound on this side whose centre is nearest `al` (m along the wall), within `within`; -1 if none. */
  nearestPile(side, al, within = 1e9) {
    let best = -1, bd = within;
    for (let p = 0; p < PILE.MAX; p++) {
      if (!this.pAct[p] || this.pSide[p] !== side) continue;
      const d = Math.abs(this.pS[p] - al);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  /** Start a mound at `al` along the wall (clamped clear of the tower). Returns its index or -1. */
  seedPile(side, al) {
    al = Math.min(Math.max(al, PILE_S_MIN), PILE_S_MAX);
    for (let p = 0; p < PILE.MAX; p++) {
      if (this.pAct[p]) continue;
      this.pAct[p] = 1; this.pSide[p] = side; this.pS[p] = al;
      this.pX[p] = side * (WORLD.GATE_HALF + al * WING_COS);
      this.pH[p] = 0; this.pW[p] = 0; this.pWn[p] = 0; this.pTop[p] = 0; this.pTopN[p] = 0;
      this.pAcid[p] = 0; this.pClimb[p] = 0; this.pIdle[p] = 0;
      return p;
    }
    return -1;
  }

  /** Something broke the wall face at x (bloater acid, a giant's blows): a ramp the others climb. */
  addRamp(x, amount, max) {
    const ax = Math.abs(x), side = x < 0 ? -1 : 1;
    const al = Math.min(Math.max((ax - WORLD.GATE_HALF) / WING_COS, PILE_S_MIN), PILE_S_MAX);
    let p = this.nearestPile(side, al, PILE.SPACING);
    if (p < 0) p = this.seedPile(side, al);
    if (p < 0) return;
    this.pAcid[p] = Math.min(max, this.pAcid[p] + amount);
    const s = sectionOf(this.pX[p]);
    if (s >= 0) this.acid[s] = Math.max(this.acid[s], this.pAcid[p]);
  }

  /** A zombie heading for the wall picks a mound that has started near its lane and goes to help. */
  seekPile(i) {
    const tx = this.tgtX[i], side = tx < 0 ? -1 : 1;
    const tal = (Math.abs(tx) - WORLD.GATE_HALF) / WING_COS;
    let best = -1, bs = 0;
    for (let p = 0; p < PILE.MAX; p++) {
      if (!this.pAct[p] || this.pSide[p] !== side || this.pH[p] < 0.6) continue;
      const du = Math.abs(this.pS[p] - tal);
      if (du > PILE.SEEK_RANGE) continue;
      const sc = this.pH[p] + 1 - du * 0.1;
      if (sc > bs) { bs = sc; best = p; }
    }
    if (best < 0) return;
    // the bigger it is, the harder it is to ignore
    if (Math.random() > Math.min(0.9, 0.25 + this.pH[best] / 4)) return;
    this.joinPile(i, best, 4);
  }

  /**
   * Head for a spot on mound p's slope: somewhere on what it will become (a mound at least
   * `grow` m high), not all against the face, which makes the wide base.
   */
  joinPile(i, p, grow) {
    const side = this.pSide[p];
    const R = (PILE.R0 + Math.max(this.pH[p], grow) * PILE.SLOPE) * 0.8;
    const du = (Math.random() * 2 - 1) * R, out = Math.random() * Math.random() * Math.sqrt(Math.max(0, R * R - du * du));
    const al = Math.min(Math.max(this.pS[p] + du, PILE_S_MIN - 4), PILE_S_MAX);
    const lx = side * (WORLD.GATE_HALF + al * WING_COS);
    this.tgtX[i] = lx;
    this.tgtZ[i] = wallZ(lx) - 0.2 - out / WING_COS;
    this.sought[i] = p + 1;
    this.seek[i] = rand(2.5, 4);
  }

  /**
   * Every few seconds, one heading for (or waiting at) a mound looks at it again: a mound shot
   * down to its last few bodies is no reason to stand off the wall where its slope used to be.
   */
  recheckPile(i) {
    const p = this.sought[i] - 1;
    if (!this.pAct[p] || this.pH[p] < 0.6) {
      // gone: straight for the wall where it stands (it will start a mound of its own there)
      const x = this.x[i], side = x < 0 ? -1 : 1;
      const lx = side * Math.min(Math.max(Math.abs(x), PILE.MIN_X - 3), WORLD.WING_END - 3);
      this.tgtX[i] = lx; this.tgtZ[i] = wallZ(lx) - 0.2;
      this.sought[i] = 0; this.seek[i] = rand(0.8, 1.8);
      return;
    }
    const al = (Math.abs(this.tgtX[i]) - WORLD.GATE_HALF) / WING_COS, du = al - this.pS[p];
    const out = wallDist(this.tgtX[i], this.tgtZ[i]);
    // an event has sent it somewhere else since (after a survivor, a crate): not ours to undo
    const Rjoin = (PILE.R0 + Math.max(this.pH[p], 4) * PILE.SLOPE) * 0.8 + 4.5;
    if ((this.tgtX[i] < 0 ? -1 : 1) !== this.pSide[p] || du * du + out * out > Rjoin * Rjoin) { this.sought[i] = 0; this.seek[i] = rand(0.8, 1.8); return; }
    // still there: a spot on the slope it has now (floor 1.5 m: still a broad base to build on)
    const R = (PILE.R0 + Math.max(this.pH[p], 1.5) * PILE.SLOPE) * 0.8;
    if (du * du + out * out > R * R) this.joinPile(i, p, 1.5);
    else this.seek[i] = rand(2.5, 4);
  }

  /** Index of a zombie by id, or -1 (indices move every frame as the dead are compacted). */
  indexOf(id) {
    for (let i = 0; i < this.n; i++) if (this.id[i] === id && !this.dead[i]) return i;
    return -1;
  }

  // ── damage ───────────────────────────────────────────────────────────────
  /** Returns true if this hit killed the zombie. */
  damage(i, amount, cause, dx = 0, dy = 0, dz = 0, headshot = false) {
    if (this.dead[i]) return false;
    if (this.type[i] === ZT.GIANT && cause === 'gunship') amount *= 0.5; // thick hide: the gunship can't do it alone
    this.hp[i] -= amount;
    this.flash[i] = 1;
    // a heavy hit staggers it (not every round: a man-sized thing under a fifty would never move)
    if (this.hitCd[i] <= 0 && this.hp[i] > 0 && amount > this.maxHp[i] * 0.12 && Math.random() < 0.45) { this.hitT[i] = 0.62; this.hitCd[i] = rand(1.6, 3); }
    if (this.hp[i] <= 0) {
      this.kill(i, cause, dx, dy, dz, headshot, -this.hp[i]);
      return true;
    }
    return false;
  }

  ignite(i, seconds, dps) {
    if (this.dead[i]) return;
    if (this.burn[i] <= 0 && this.onIgnite) this.onIgnite(i); // it catches: it screams
    this.burn[i] = Math.max(this.burn[i], seconds);
    this.burnDps[i] = Math.max(this.burnDps[i], dps);
  }

  kill(i, cause, dx, dy, dz, headshot, overkill = 0) {
    if (this.dead[i]) return;
    this.dead[i] = 1;
    this.alive--;
    const type = this.type[i];
    const x = this.x[i], y = this.y[i], z = this.z[i], s = this.scale[i];
    const tint = [this.tr[i], this.tg[i], this.tb[i]];
    const explosive = isExplosive(cause);
    if (this.onKill) this.onKill(type, cause, x, y, z, headshot);

    if (type === ZT.BLOATER) {
      // pops like a rotten fruit and takes neighbours with it
      this.fx.gibBurst(x, y, z, s * 1.2, dx * 6, 6, dz * 6, 12);
      this.fx.explosion(x, y + 0.6, z, 0.55, { dirt: false, scorch: false, color: 1 });
      this.pending.push({ x, y: y + 0.8, z, r: 5.2, dmg: 150, cause: 'bloater', t: 0.08 });
      return;
    }
    const gibP = this._gibChance >= 0 ? this._gibChance : (overkill > this.maxHp[i] * 1.2 ? 1 : 0.28);
    if (explosive && type !== ZT.GIANT && Math.random() < gibP) {
      this.fx.gibBurst(x, y, z, s, dx, dy, dz, type === ZT.BRUTE ? 14 : 8);
      return;
    }
    // a .50 round sometimes just takes a body apart
    if (cause === 'hmg' && type !== ZT.BRUTE && type !== ZT.GIANT && !headshot && Math.random() < 0.09) {
      this.fx.gibBurst(x, y, z, s, dx * 9, 3, dz * 9, 6);
      return;
    }
    if (headshot) {
      const hy = y + 1.75 * s;
      this.fx.headshot(x, hy, z, dx, dy, dz);
    }
    const flying = explosive || y > 0.4;
    let vx = 0, vy = 0, vz = 0;
    if (explosive) { vx = dx; vy = dy; vz = dz; }
    else { vx = dx * 1.5; vz = dz * 1.5; }
    this.corpses.add(x, y, z, this.yaw[i], s, type, tint, vx, vy, vz, headshot, this.burn[i] > 0, flying, this.look[i]);
    if (!flying) this.fx.blood(x, z, 0.8 * s);
  }

  /** Quietly remove the living for which keep(x, z) is false (no corpses): room for a cutscene's own crowd. */
  cull(drop) {
    for (let i = 0; i < this.n; i++) if (!this.dead[i] && drop(this.x[i], this.z[i])) { this.dead[i] = 1; this.alive--; }
    this.compact();
  }

  /** One of them is in the yard (the extraction): off the wall top and running for (tx, tz). */
  goInside(i, tx, tz, perch = 0) {
    const x = this.x[i];
    this.inside[i] = 1;
    this.seek[i] = perch; // (inside, seek is the time it crouches on the parapet before it drops)
    this.z[i] = wallZ(x) + (Math.abs(x) <= WORLD.GATE_HALF ? 1.2 : 1.2 / WING_COS);
    this.y[i] = WORLD.WALL_H + 0.6;
    this.tgtX[i] = tx; this.tgtZ[i] = tz;
    this.climb[i] = 0;
  }

  breach(i) {
    if (this.dead[i]) return;
    if (this.overWall) { const [tx, tz, perch = 0] = this.overWall(this.x[i], this.z[i], i); this.goInside(i, tx, tz, perch); return; }
    this.dead[i] = 1;
    this.alive--;
    // the men on the walkway fight back and shove the pile down before they fall
    const ax = Math.abs(this.x[i]);
    if (ax > WORLD.GATE_HALF) {
      const p = this.nearestPile(this.x[i] < 0 ? -1 : 1, (ax - WORLD.GATE_HALF) / WING_COS, 14);
      if (p >= 0) { this.pH[p] = Math.max(0, this.pH[p] - PILE.KNOCKDOWN); this.pAcid[p] *= 0.5; }
    }
    if (this.onBreach) this.onBreach(sectionOf(this.x[i]), this.x[i], this.y[i], this.z[i]);
  }

  /** Area damage. Returns number killed. */
  explode(x, y, z, radius, dmg, cause, opts = {}) {
    const cnt = this.queryRadius(x, z, radius + 0.6, this._q);
    let kills = 0;
    const push = opts.push ?? 1;
    const kick = Math.sqrt(push);
    for (let k = 0; k < cnt; k++) {
      const i = this._q[k];
      if (this.dead[i]) continue;
      const ddx = this.x[i] - x, ddz = this.z[i] - z;
      const ddy = (this.y[i] + groundH(this.x[i], this.z[i]) + 0.9) - y;
      const d = Math.sqrt(ddx * ddx + ddz * ddz + ddy * ddy * 0.5);
      if (d > radius) continue;
      const f = 1 - 0.65 * (d / radius) * (d / radius);
      const amount = dmg * f;
      const hd = Math.sqrt(ddx * ddx + ddz * ddz) + 0.001;
      // the dead are thrown clear: hard and high near the core, a stumble-and-fall at the rim
      const c = 1 - d / radius;
      const jit = 0.8 + Math.random() * 0.45;
      const pw = (3.5 + 13 * c) * kick * jit;
      const up = Math.min(24, (4 + 9 * c * c + 3 * c) * Math.pow(push, 0.75) * jit);
      // only what stood right on top of it comes apart; the rest go flying whole
      this._gibChance = c > 0.8 ? 0.65 : c > 0.55 ? 0.15 : 0.03;
      const killed = this.damage(i, amount, cause, ddx / hd * pw, up, ddz / hd * pw);
      this._gibChance = -1;
      if (killed) kills++;
      else {
        // stagger survivors
        const kb = this.type[i] === ZT.GIANT ? 0 : (1 - d / radius) * 0.9 * push;
        this.x[i] += ddx / hd * kb; this.z[i] += ddz / hd * kb;
        if (opts.ignite) this.ignite(i, 4, 30);
      }
    }
    return kills;
  }

  // ── queries ──────────────────────────────────────────────────────────────
  queryRadius(x, z, r, out) {
    let cnt = 0;
    const c0 = Math.max(0, Math.floor((x - r - GX0) / CELL)), c1 = Math.min(GW - 1, Math.floor((x + r - GX0) / CELL));
    const r0 = Math.max(0, Math.floor((z - r - GZ0) / CELL)), r1 = Math.min(GH - 1, Math.floor((z + r - GZ0) / CELL));
    const r2 = r * r;
    for (let rz = r0; rz <= r1; rz++) {
      for (let cx = c0; cx <= c1; cx++) {
        const cell = rz * GW + cx;
        for (let k = this.cellStart[cell], e = this.cellStart[cell + 1]; k < e; k++) {
          const i = this.cellItems[k];
          if (i >= this.n || this.dead[i]) continue;
          const dx = this.x[i] - x, dz = this.z[i] - z;
          if (dx * dx + dz * dz <= r2) out[cnt++] = i;
        }
      }
    }
    return cnt;
  }

  countNear(x, z, r) {
    return this.queryRadius(x, z, r, this._q);
  }

  /** Finds a dense cluster at least `minDist` from the wall. Returns {x,z,count} or null. */
  densest(minDist = 12, maxDist = 220, samples = 48, r = 6) {
    if (this.alive === 0) return null;
    let best = null, bestC = 0;
    for (let s = 0; s < samples; s++) {
      const i = (Math.random() * this.n) | 0;
      if (this.dead[i]) continue;
      const d = wallDist(this.x[i], this.z[i]);
      if (d < minDist || d > maxDist) continue;
      const c = this.queryRadius(this.x[i], this.z[i], r, this._q);
      if (c > bestC) { bestC = c; best = i; }
    }
    if (best === null) return null;
    return { x: this.x[best], z: this.z[best], count: bestC };
  }

  randomAlive() {
    if (this.alive === 0) return -1;
    for (let k = 0; k < 8; k++) {
      const i = (Math.random() * this.n) | 0;
      if (!this.dead[i]) return i;
    }
    return -1;
  }

  /**
   * Ray vs. vertical capsules. Fills hitIdx/hitT/hitFrac with the nearest
   * `maxHits` hits sorted by distance; returns the count.
   */
  raycast(ox, oy, oz, dx, dy, dz, maxT, maxHits) {
    const h2 = dx * dx + dz * dz;
    let cnt = 0;
    const HI = this.hitIdx, HT = this.hitT, HF = this.hitFrac;
    if (h2 < 1e-8) return 0;
    const n = this.n;
    const X = this.x, Y = this.y, Z = this.z, S = this.scale, RA = this.radius, D = this.dead;
    for (let i = 0; i < n; i++) {
      if (D[i]) continue;
      const px = X[i] - ox, pz = Z[i] - oz;
      const tc = (px * dx + pz * dz) / h2;
      if (tc < -2) continue;
      const cx = dx * tc - px, cz = dz * tc - pz;
      const d2 = cx * cx + cz * cz;
      const r = RA[i] * 1.15;
      if (d2 > r * r) continue;
      const half = Math.sqrt((r * r - d2) / h2);
      let t0 = tc - half, t1 = tc + half;
      const hgt = ZOMBIE_HEIGHT * S[i];
      const yb = Y[i] + groundH(X[i], Z[i]), yt = yb + hgt;
      if (dy < -1e-6 || dy > 1e-6) {
        let ta = (yt - oy) / dy, tb = (yb - oy) / dy;
        if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
      } else if (oy < yb || oy > yt) continue;
      if (t0 > t1 || t1 < 0 || t0 > maxT) continue;
      const t = t0 > 0 ? t0 : 0;
      const frac = (oy + dy * t - yb) / hgt;
      // insertion into sorted top-K
      if (cnt < maxHits) cnt++;
      else if (t >= HT[cnt - 1]) continue;
      let k = cnt - 1;
      while (k > 0 && HT[k - 1] > t) { HT[k] = HT[k - 1]; HI[k] = HI[k - 1]; HF[k] = HF[k - 1]; k--; }
      HT[k] = t; HI[k] = i; HF[k] = frac;
    }
    return cnt;
  }

  // ── simulation ───────────────────────────────────────────────────────────
  update(dt, time) {
    this.uniforms.uTime.value = time;
    // pending chain explosions
    for (let k = 0; k < this.pending.length; k++) {
      const p = this.pending[k];
      p.t -= dt;
      if (p.t <= 0) {
        this.explode(p.x, p.y, p.z, p.r, p.dmg, p.cause);
        this.pending[k] = this.pending[this.pending.length - 1];
        this.pending.pop();
        k--;
      }
    }

    // mound heights from last frame's weight on them
    this.pileH.fill(0); this.pileTop.fill(0); this.acid.fill(0);
    // two mounds that have grown into each other are one: the smaller folds into the bigger
    for (let a = 0; a < PILE.MAX; a++) {
      if (!this.pAct[a]) continue;
      for (let b = a + 1; b < PILE.MAX; b++) {
        if (!this.pAct[b] || this.pSide[b] !== this.pSide[a]) continue;
        const Ra = PILE.R0 + this.pH[a] * PILE.SLOPE, Rb = PILE.R0 + this.pH[b] * PILE.SLOPE;
        if (Math.abs(this.pS[a] - this.pS[b]) > Math.max(Ra, Rb) * 0.7) continue;
        const [big, small] = this.pW[a] + this.pH[a] >= this.pW[b] + this.pH[b] ? [a, b] : [b, a];
        this.pAcid[big] = Math.max(this.pAcid[big], this.pAcid[small]);
        this.pWn[big] += this.pWn[small];
        this.pAct[small] = 0;
        if (small === a) break;
      }
    }
    for (let p = 0; p < PILE.MAX; p++) {
      if (!this.pAct[p]) continue;
      this.pAcid[p] = Math.max(0, this.pAcid[p] - dt * PILE.ACID_DECAY);
      const w = this.pWn[p];
      const target = Math.min(PILE.K * Math.sqrt(w * this.pileMul) + (w > 0 ? this.pAcid[p] : 0), WORLD.WALL_H + 0.4);
      const h = this.pH[p];
      this.pH[p] = target > h ? h + Math.min((target - h) * (1 - Math.exp(-0.7 * dt)), PILE.RISE * dt) : h + (target - h) * (1 - Math.exp(-2.0 * dt));
      this.pW[p] = w; this.pWn[p] = 0;
      this.pTop[p] = this.pTopN[p]; this.pTopN[p] = 0;
      this.pClimb[p] = 0;
      if (w === 0 && this.pH[p] < 0.05 && this.pAcid[p] < 0.05) {
        if ((this.pIdle[p] += dt) > 2) this.pAct[p] = 0;
      } else this.pIdle[p] = 0;
      // a melted ramp steams
      if (this.pAcid[p] > 0.3 && this.fx && Math.random() < dt * this.pAcid[p] * 2.5) {
        const px = this.pX[p] + rand(-1.5, 1.5);
        this.fx.smoke.spawn(px, rand(0.3, this.pAcid[p] + 0.8), wallZ(px) - 0.5, rand(-0.3, 0.3), rand(0.4, 1.0), -0.3,
          rand(2.5, 4), 0.8, 3.2, 2 + ((Math.random() * 4) | 0), 0.16, 0.2, 0.08, 0.35, 0.07, 0.08, 0.05, -0.15, 0.6, 0, Math.random() * 6, 0.2, 0.15);
      }
      const s = sectionOf(this.pX[p]);
      if (s < 0) continue;
      if (this.pH[p] > this.pileH[s]) this.pileH[s] = this.pH[p];
      if (this.pTop[p] > this.pileTop[s]) this.pileTop[s] = this.pTop[p];
      if (this.pAcid[p] > this.acid[s]) this.acid[s] = this.pAcid[p];
    }

    const n = this.n;
    const X = this.x, Z = this.z, Y = this.y;
    const ctx = this.ctx;
    const WALL_H = WORLD.WALL_H;
    const gs = this.globalSpeed;

    for (let i = 0; i < n; i++) {
      if (this.dead[i]) continue;
      const type = this.type[i];
      let x = X[i], z = Z[i];
      this.flash[i] *= Math.exp(-14 * dt);
      if (this.fadeIn[i] > 0) this.fadeIn[i] = Math.max(0, this.fadeIn[i] - dt * 0.55);

      // burning
      if (this.burn[i] > 0) {
        this.burn[i] -= dt;
        if (this.damage(i, this.burnDps[i] * dt, 'fire', 0, 1, 0)) continue;
        if (this.burn[i] <= 0) this.burnDps[i] = 0;
      }

      if (this.inside[i]) { this.updateInside(i, dt, time, gs); continue; }
      let dist = wallDist(x, z);
      // burning fuel on the ground / wire
      if (ctx.fireAt) {
        const fdps = ctx.fireAt(x, z, dist);
        if (fdps > 0) {
          // walking through it is enough: they come out the other side alight
          this.ignite(i, 5, fdps * 0.35);
          if (this.damage(i, fdps * dt, 'fire', 0, 1, 0)) continue;
        }
      }
      let slowMul = 1;
      if (ctx.wireAt) {
        slowMul = ctx.wireAt(x, dist, this.weight[i], dt);
        if (slowMul < 1) {
          if (this.damage(i, 7 * dt, 'wire', 0, 0, 0)) continue;
        }
      }
      // steering toward lane target
      let sp = this.speed[i] * gs * slowMul;
      if (this.burn[i] > 0) sp *= 1.25;
      if (type !== 1) sp *= 0.72 + 0.28 * Math.abs(Math.sin(time * this.rate[i] + this.phase[i]));
      let dx = this.tgtX[i] - x, dz = this.tgtZ[i] - z;
      let dd = Math.sqrt(dx * dx + dz * dz);
      let vx = 0, vz = 0;
      if (dd > 0.05) { vx = dx / dd * sp; vz = dz / dd * sp; }
      // keep off the central tower base
      if (x > -9.5 && x < 9.5 && z > -11) vx += (x >= 0 ? 2.2 : -2.2);
      // round the wrecks on the road, not through them
      const solidOK = type !== ZT.GIANT && nearObstacle(x, z);
      if (solidOK && steer(x, z, vx, vz, this.radius[i], _ob, (this.id[i] & 1) ? 1 : -1)) { vx = _ob[0]; vz = _ob[1]; }

      // which mound (if any) this one is on: the one it stands highest on
      const sec = sectionOf(x);
      const giant = type === ZT.GIANT;
      const axi = x < 0 ? -x : x, side = x < 0 ? -1 : 1;
      let pile = -1, pr = 0, pR = 1;
      if (!giant && axi > WORLD.GATE_HALF && dist < 16) {
        const al = (axi - WORLD.GATE_HALF) / WING_COS;
        let best = -1;
        for (let p = 0; p < PILE.MAX; p++) {
          if (!this.pAct[p] || this.pSide[p] !== side) continue;
          const du = al - this.pS[p], R = PILE.R0 + this.pH[p] * PILE.SLOPE;
          const r = Math.sqrt(du * du + dist * dist);
          if (r >= R) continue;
          const sc = this.pH[p] * (1 - r / R) + 0.01 * R;
          if (sc > best) { best = sc; pile = p; pr = r; pR = R; }
        }
        // at the wall with no mound around: start one (never right under the tower)
        if (pile < 0 && dist < PILE.SEED_D && al >= PILE_S_MIN - 0.5 && this.nearestPile(side, al, PILE.SPACING) < 0) {
          pile = this.seedPile(side, al);
          if (pile >= 0) { pr = Math.abs(al - this.pS[pile]) + dist; pR = PILE.R0; }
        }
      }
      const inPile = pile >= 0;
      // the crowd drifts toward a mound that has started near its lane
      if (!inPile && !giant && dist < PILE.SEEK_D && (this.seek[i] -= dt) <= 0) {
        if (this.sought[i]) this.recheckPile(i);
        else { this.seek[i] = rand(0.8, 1.8); this.seekPile(i); }
      }
      const pS0 = inPile ? this.pS[pile] : 0;
      const ri = this.radius[i] * (inPile ? 0.62 : 1);
      let pxs = 0, pzs = 0, checks = 0;
      // on the pile a zombie stands on someone: the highest body within reach that is
      // further out from the wall (so a pile grows from the ground up, never on air)
      let sup = 0;
      const gx = Math.floor((x - GX0) / CELL), gz = Math.floor((z - GZ0) / CELL);
      for (let rz = gz - 1; rz <= gz + 1 && checks < 30; rz++) {
        if (rz < 0 || rz >= GH) continue;
        for (let cx = gx - 1; cx <= gx + 1; cx++) {
          if (cx < 0 || cx >= GW) continue;
          const cell = rz * GW + cx;
          for (let k = this.cellStart[cell], e = this.cellStart[cell + 1]; k < e; k++) {
            const j = this.cellItems[k];
            if (j === i || j >= n || this.dead[j]) continue;
            const ox = x - X[j], oz = z - Z[j];
            const d2 = ox * ox + oz * oz;
            if (inPile && d2 < 1.21 && Y[j] + 1.2 * this.scale[j] > sup && X[j] * side > WORLD.GATE_HALF) {
              // only someone further down the mound's slope can hold this one up
              const duj = ((X[j] < 0 ? -X[j] : X[j]) - WORLD.GATE_HALF) / WING_COS - pS0, dj = wallDist(X[j], Z[j]);
              if (duj * duj + dj * dj > (pr + 0.08) * (pr + 0.08)) sup = Y[j] + 1.2 * this.scale[j];
            }
            const md = ri + this.radius[j] * (inPile ? 0.62 : 1);
            if (d2 < md * md && d2 > 1e-6) {
              const d = Math.sqrt(d2);
              const push = (md - d) / d * 0.5;
              pxs += ox * push; pzs += oz * push;
            }
            if (++checks >= 30) break;
          }
        }
      }
      const pl = Math.sqrt(pxs * pxs + pzs * pzs);
      if (pl > 0.35) { pxs *= 0.35 / pl; pzs *= 0.35 / pl; }
      x += vx * dt + pxs * 0.85;
      z += vz * dt + pzs * 0.85;
      if (solidOK && pushOut(x, z, this.radius[i], _ob)) { x = _ob[0]; z = _ob[1]; }

      // wall constraint
      dist = wallDist(x, z);
      const minD = 0.4 * this.scale[i];
      if (dist < minD) {
        const ax = x < 0 ? -x : x;
        z = wallZ(x) - (ax <= WORLD.GATE_HALF ? minD : minD / WING_COS);
        dist = minD;
      }
      X[i] = x; Z[i] = z;

      // a giant at the wall beats on it (the event drives what that does)
      if (giant && dist < 1.4 * this.scale[i] * 0.5 && this.onGiantWall) this.onGiantWall(i, sec, x, z, dt);

      // bloater reaching the wall detonates
      if (type === ZT.BLOATER && dist < 0.9 && sec >= 0) {
        this.addRamp(x, PILE.ACID_PER_BLOATER, PILE.ACID_MAX);
        if (this.onBloaterWall) this.onBloaterWall(sec, x, z);
        this.kill(i, 'wall', 0, 1, -1, false, 999);
        continue;
      }

      // pile & climbing
      let ty = 0;
      if (inPile) {
        this.pWn[pile] += this.weight[i];
        const ph = this.pH[pile];
        const k = 1 - pr / pR;
        ty = Math.min(ph * Math.pow(k > 0 ? k : 0, 0.85) * (0.85 + 0.15 * this.pileJit[i]), sup);
        if (Y[i] > this.pTopN[pile]) this.pTopN[pile] = Y[i];
        // only one that has really reached the top of the mound (at the wall, at its peak) goes over
        if (ph >= WALL_H - 0.5 && Y[i] >= WALL_H - 2.6 && pr < 1.4 + ph * 0.08 && (this.climb[i] > 0 || this.pClimb[pile] < (this.maxClimbers || PILE.MAX_CLIMBERS))) {
          this.pClimb[pile]++;
          this.climb[i] += dt;
          const c = this.climb[i] / this.climbDur[i];
          ty = ty + (WALL_H + 0.9 - ty) * Math.min(1, c);
          if (c >= 1) { Y[i] = ty; this.breach(i); continue; }
        } else if (this.climb[i] > 0) this.climb[i] = Math.max(0, this.climb[i] - dt);
      } else if (this.climb[i] > 0) this.climb[i] = 0;
      const yr = ty > Y[i] ? 4.5 : 7;
      Y[i] += (ty - Y[i]) * (1 - Math.exp(-yr * dt));

      // facing
      let wantYaw;
      if (dist < 1.9) {
        const f = wallFacing(x);
        wantYaw = Math.atan2(f[0], f[1]);
      } else if (vx * vx + vz * vz > 0.01) wantYaw = Math.atan2(vx, vz);
      else wantYaw = this.yaw[i];
      let dy = wantYaw - this.yaw[i];
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yaw[i] += dy * (1 - Math.exp(-6 * dt));

      const wantAtk = (dist < 1.6 + (inPile ? this.pH[pile] * 0.12 : 0) || Y[i] > 1.0 || (giant && dist < 2.8)) ? 1 : 0;
      this.atk[i] += (wantAtk - this.atk[i]) * (1 - Math.exp(-5 * dt));
    }

    this.compact();
    this.buildGrid();
    this.animStep(dt);
    this.corpses.update(dt);
  }

  /**
   * Which clip each one plays, and how fast: what it is doing (burning, going over, on the
   * mound, at the wall, running, standing) and what it is. Changes crossfade; the gait's
   * rate follows how fast it is really moving over the ground, so the feet don't slide.
   */
  animStep(dt) {
    if (!this.anim) return;
    const A = this.anim, C = this.CLIP, n = this.n;
    const k = 1 - Math.exp(-6 * dt);
    for (let i = 0; i < n; i++) {
      const type = this.type[i];
      if (type === ZT.GIANT) continue;
      // ground speed, smoothed
      const dx = this.x[i] - this.px[i], dz = this.z[i] - this.pz[i];
      this.px[i] = this.x[i]; this.pz[i] = this.z[i];
      const v = dt > 0 ? Math.min(12, Math.sqrt(dx * dx + dz * dz) / dt) : 0;
      this.mv[i] += (v - this.mv[i]) * k;
      if (this.hitCd[i] > 0) this.hitCd[i] -= dt;
      const seed = this.look[i] % 1;
      const y = this.y[i];
      let want, t = -1, rate = 1;
      if (this.hitT[i] > 0) this.hitT[i] -= dt;
      if (this.burn[i] > 0.2) { want = C.burn; }
      else if (this.inside[i]) {
        if (this.seek[i] > 0 || y > 2.5) want = C.perch;
        else if (this.mv[i] < 0.6 && this.atk[i] > 0.5) { want = C.attack[(seed * 3) | 0]; rate = 1.3; }
        else want = type === ZT.RUNNER || this.speed[i] > 2.1 ? C.sprint : C.jog;
      } else if (this.climb[i] > 0) {
        // going over the top: the climb plays over exactly the time it takes
        want = C.climb; t = Math.min(1, this.climb[i] / this.climbDur[i]) * A.dur(C.climb);
      } else if (y > 0.35) { want = C.scramble; rate = 0.85 + seed * 0.35; }
      else if (this.hitT[i] > 0) { want = C.gethit; t = 0.62 - this.hitT[i]; }
      else if (this.atk[i] > 0.5) { want = C.claw; rate = 0.85 + seed * 0.4; }
      else if (this.mv[i] > 0.3) {
        if (type === ZT.RUNNER) want = C.sprint;
        else if (type === ZT.BRUTE) want = C.stomp;
        else if (type === ZT.BLOATER) want = C.waddle;
        else want = seed > 0.86 ? C.limp : (this.speed[i] > 2.2 || seed < 0.3 ? C.jog : C.walk);
      } else { want = C.idle[seed < 0.45 ? 0 : seed < 0.85 ? 1 : 2]; rate = 0.8 + seed * 0.4; }
      if (this.LOCO.has(want)) {
        const sp = A.byId[want].speed;
        rate = sp > 0.05 ? this.mv[i] / (sp * this.scale[i]) : 1;
        if (want === C.burn) rate = Math.max(0.9, rate);
        rate = Math.min(3.2, Math.max(0.35, rate));
      }
      const cur = this.aClip[i];
      if (want !== cur) {
        if (cur >= 0) { this.pClip[i] = cur; this.pT[i] = this.aT[i]; this.xf[i] = 1; }
        // gaits hand over at the same point of the stride; anything else starts somewhere of its own
        if (cur >= 0 && this.LOCO.has(cur) && this.LOCO.has(want)) this.aT[i] = (this.aT[i] / A.dur(cur)) * A.dur(want);
        else this.aT[i] = A.byId[want].loop ? (this.phase[i] % A.dur(want)) : 0;
        this.aClip[i] = want;
      }
      if (t >= 0) this.aT[i] = t; else this.aT[i] += dt * rate;
      if (this.xf[i] > 0) { this.xf[i] = Math.max(0, this.xf[i] - dt / 0.28); this.pT[i] += dt; }
    }
  }

  /** In the yard: drop off the wall, then a straight run at the target, clawing when there. */
  updateInside(i, dt, time, gs) {
    // on the parapet a moment, looking down into the yard, before it drops
    if (this.seek[i] > 0) { this.seek[i] -= dt; this.atk[i] += (1 - this.atk[i]) * (1 - Math.exp(-5 * dt)); return; }
    let x = this.x[i], z = this.z[i];
    const dx = this.tgtX[i] - x, dz = this.tgtZ[i] - z, dd = Math.sqrt(dx * dx + dz * dz);
    const Y = this.y[i];
    if (Y > 0) this.y[i] = Math.max(0, Y - dt * (Y > WORLD.WALL_H * 0.5 ? 4 : 11)); // over the parapet, then the drop
    const sp = Math.max(2.6, this.speed[i] * 1.6) * gs * (this.y[i] > 3 ? 0.35 : 1) * (0.8 + 0.2 * Math.abs(Math.sin(time * this.rate[i] + this.phase[i])));
    if (dd > 1.5) { x += dx / dd * sp * dt; z += dz / dd * sp * dt; }
    this.x[i] = x; this.z[i] = z;
    const want = dd > 0.05 ? Math.atan2(dx, dz) : this.yaw[i];
    let dy = want - this.yaw[i]; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.yaw[i] += dy * (1 - Math.exp(-6 * dt));
    this.atk[i] += ((dd < 3 || this.y[i] > 1 ? 1 : 0) - this.atk[i]) * (1 - Math.exp(-5 * dt));
  }

  compact() {
    let w = 0;
    const n = this.n;
    const A = this._arrays;
    for (let r = 0; r < n; r++) {
      if (this.dead[r]) continue;
      if (w !== r) for (let k = 0; k < A.length; k++) A[k][w] = A[k][r];
      w++;
    }
    this.n = w;
    this.alive = w;
  }

  buildGrid() {
    const start = this.cellStart;
    start.fill(0);
    const n = this.n;
    for (let i = 0; i < n; i++) {
      let cx = Math.floor((this.x[i] - GX0) / CELL), cz = Math.floor((this.z[i] - GZ0) / CELL);
      if (cx < 0) cx = 0; else if (cx >= GW) cx = GW - 1;
      if (cz < 0) cz = 0; else if (cz >= GH) cz = GH - 1;
      const c = cz * GW + cx;
      this.cellOf[i] = c;
      start[c + 1]++;
    }
    for (let c = 0; c < NCELLS; c++) start[c + 1] += start[c];
    // fill using a cursor copy
    const cursor = this._cursor || (this._cursor = new Int32Array(NCELLS + 1));
    cursor.set(start);
    for (let i = 0; i < n; i++) {
      const c = this.cellOf[i];
      this.cellItems[cursor[c]++] = i;
    }
  }

  // ── rendering ────────────────────────────────────────────────────────────
  syncRender() {
    const n = this.n;
    if (!this.anim) return;
    const M = this.eyes.instanceMatrix.array;
    const A = this.aAnim.array, S = this.aState.array, T = this.tintBuf, E = this.aEye.array;
    const big = this.big, L = this.lods, AN = this.anim;
    const MG = big.mesh.instanceMatrix.array;
    const cx = WORLD.CAM.x, cz = WORLD.CAM.z, lim0 = this.lodLim2[0], lim1 = this.lodLim2[1];
    const fire = this.fire;
    const cnt = [0, 0, 0];
    const eye = this._eye || (this._eye = [0, 0, 0]);
    const EY = AN.eyes;
    let gi = 0;
    for (let i = 0; i < n; i++) {
      const c = Math.cos(this.yaw[i]), s = Math.sin(this.yaw[i]);
      const sc = this.scale[i];
      const o = i * 16;
      const x = this.x[i], z = this.z[i];
      const y = this.y[i] + groundH(x, z);
      const ty = this.type[i];
      const wide = ty === ZT.BLOATER ? 1.25 : (ty === ZT.BRUTE ? 1.12 : 1);  // the giant's own mesh is built at its proportions
      M[o] = c * sc * wide; M[o + 1] = 0; M[o + 2] = -s * sc * wide; M[o + 3] = 0;
      M[o + 4] = 0; M[o + 5] = sc; M[o + 6] = 0; M[o + 7] = 0;
      M[o + 8] = s * sc * wide; M[o + 9] = 0; M[o + 10] = c * sc * wide; M[o + 11] = 0;
      M[o + 12] = x; M[o + 13] = y; M[o + 14] = z; M[o + 15] = 1;
      const q4 = i * 4, t3 = i * 3;
      const burn = this.burn[i] > 0 ? Math.min(1, this.burn[i] * 2) : 0;
      // (the eyes' own inputs: type, and the giant's old lean)
      A[q4] = this.phase[i]; A[q4 + 1] = this.rate[i]; A[q4 + 2] = this.type[i]; A[q4 + 3] = this.lean[i];
      S[q4] = this.flash[i]; S[q4 + 1] = burn; S[q4 + 2] = this.atk[i]; S[q4 + 3] = -this.fadeIn[i];
      T[t3] = this.tr[i]; T[t3 + 1] = this.tg[i]; T[t3 + 2] = this.tb[i];
      const dx = x - cx, dz = z - cz;
      const e3 = i * 3;
      if (ty === ZT.GIANT && gi < 4) {
        const k = gi++, ko = k * 16, k4 = k * 4, k3 = k * 3;
        for (let j = 0; j < 16; j++) MG[ko + j] = M[o + j];
        const BA = big.aAnim.array, BS = big.aState.array, BT = big.aTint.array;
        BA[k4] = A[q4]; BA[k4 + 1] = A[q4 + 1]; BA[k4 + 2] = A[q4 + 2]; BA[k4 + 3] = A[q4 + 3];
        BS[k4] = S[q4]; BS[k4 + 1] = S[q4 + 1]; BS[k4 + 2] = S[q4 + 2]; BS[k4 + 3] = S[q4 + 3];
        BT[k3] = T[t3]; BT[k3 + 1] = T[t3 + 1]; BT[k3 + 2] = T[t3 + 2];
        const lean = this.lean[i] + this.atk[i] * 0.2;
        E[e3] = 0; E[e3 + 1] = 0.95 + 0.785 * Math.cos(lean); E[e3 + 2] = 0.12 + 0.785 * Math.sin(lean);
      } else {
        const li = dx * dx + dz * dz < lim0 ? 0 : dx * dx + dz * dz < lim1 ? 1 : 2;
        const D = L[li], k = cnt[li]++, ko = k * 16, k4 = k * 4, k3 = k * 3;
        const LM = D.mesh.instanceMatrix.array, LA = D.aAnim.array, LS = D.aState.array, LT = D.aTint.array;
        for (let j = 0; j < 16; j++) LM[ko + j] = M[o + j];
        const cA = this.aClip[i] < 0 ? 0 : this.aClip[i];
        const rowA = AN.row(cA, this.aT[i]);
        const xf = this.xf[i] > 0 && this.pClip[i] >= 0 ? this.xf[i] * this.xf[i] * (3 - 2 * this.xf[i]) : 0;
        LA[k4] = rowA; LA[k4 + 1] = xf > 0 ? AN.row(this.pClip[i], this.pT[i]) : rowA; LA[k4 + 2] = xf; LA[k4 + 3] = this.look[i];
        LS[k4] = this.flash[i]; LS[k4 + 1] = burn; LS[k4 + 2] = ty; LS[k4 + 3] = this.fadeIn[i] > 0 ? -this.fadeIn[i] : 0;
        LT[k3] = T[t3]; LT[k3 + 1] = T[t3 + 1]; LT[k3 + 2] = T[t3 + 2];
        AN.onHead(rowA, EY[0], EY[1], EY[2], eye);
        E[e3] = eye[0]; E[e3 + 1] = eye[1]; E[e3 + 2] = eye[2];
      }
      if (burn > 0 && fire) fire.transient(x, y + 0.15 * sc, z, 0.85 * sc * wide, 2.1 * sc, 0.9 + burn * 0.8, (this.phase[i] * 0.37) % 1);
    }
    for (let li = 0; li < L.length; li++) L[li].mesh.count = cnt[li];
    big.mesh.count = gi;
    this.eyes.count = n;
    this.blobs.count = n;
    const upd = (attr, cnt) => {
      if (cnt <= 0) return;
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, cnt * attr.itemSize);
      attr.needsUpdate = true;
    };
    upd(this.eyes.instanceMatrix, n); upd(this.aAnim, n); upd(this.aState, n); upd(this.aEye, n);
    for (let li = 0; li < L.length; li++) { const D = L[li], c = cnt[li]; upd(D.mesh.instanceMatrix, c); upd(D.aAnim, c); upd(D.aState, c); upd(D.aTint, c); }
    upd(big.mesh.instanceMatrix, gi); upd(big.aAnim, gi); upd(big.aState, gi); upd(big.aTint, gi);
  }

  /** 0..1 pressure per section for the HUD */
  /** How close a section is to being overrun: the pile as it actually stands. */
  pressure(s) { return Math.min(1, Math.min(this.pileH[s], this.pileTop[s] + 1.2) / WORLD.WALL_H); }
}

function isExplosive(cause) { return EXPLOSIVE[cause] === 1; }
