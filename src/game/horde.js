// The horde: SoA simulation of thousands of zombies, the pile-up/breach
// mechanic, hit detection, explosions and the corpse field.
import * as THREE from 'three';
import {
  ZOMBIE_TYPES, ZT, WORLD, wallZ, wallDist, wallFacing, sectionOf, PILE,
  ZOMBIE_HEIGHT, HEADSHOT_FRAC, WING_COS,
} from '../config.js';
import { createZombieGeometry, createGiantGeometry, createZombieMaterial, createZombieDepthMaterial, createEyeMesh } from './zombieModel.js';
import { rand } from '../core/util.js';
import { groundH } from '../world/terrain.js';
import { fogUniforms } from '../render/atmosphere.js';

const CELL = 2;
const GX0 = -230, GZ0 = -300;
const GW = 230, GH = 156;
const NCELLS = GW * GH;

const SHIRTS = [
  [0.15, 0.16, 0.11], [0.12, 0.12, 0.13], [0.17, 0.13, 0.09], [0.08, 0.09, 0.13],
  [0.24, 0.23, 0.2], [0.19, 0.07, 0.06], [0.1, 0.11, 0.08], [0.05, 0.05, 0.05],
  [0.2, 0.19, 0.12], [0.14, 0.1, 0.12],
];

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
    this.near = new Corpses(scene, Math.round(cap * 0.45), uniforms, 1);
    this.far = new Corpses(scene, Math.round(cap * 0.55), uniforms, 2);
    this.near2 = 62 * 62;
    this.giant = new Corpses(scene, 3, uniforms, 'giant');
  }
  set onLand(fn) { this.near.onLand = fn; this.far.onLand = fn; }
  get count() { return this.near.count + this.far.count + this.giant.count; }
  add(x, y, z, yaw, scale, type, ...rest) {
    const dx = x - WORLD.CAM.x, dz = z - WORLD.CAM.z;
    const C = type === ZT.GIANT ? this.giant : (dx * dx + dz * dz < this.near2 ? this.near : this.far);
    C.add(x, y, z, yaw, scale, type, ...rest);
  }
  update(dt) { this.near.update(dt); this.far.update(dt); this.giant.update(dt); }
  clear() { this.near.clear(); this.far.clear(); this.giant.clear(); }
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
  constructor(scene, fx, { cap = 1500, corpseCap = 2500, shadows = true, uniforms }) {
    this.scene = scene;
    this.fx = fx;
    this.cap = cap;
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
    this._arrays = [this.id, this.x, this.y, this.z, this.yaw, this.hp, this.maxHp, this.speed, this.rate, this.phase, this.lean,
      this.scale, this.radius, this.weight, this.tgtX, this.tgtZ, this.flash, this.burn, this.burnDps, this.atk, this.climb,
      this.climbDur, this.slow, this.tr, this.tg, this.tb, this.type, this.dead, this.pileJit, this.fadeIn];

    // sections
    this.secW = new Float32Array(WORLD.SECTIONS);
    this.secCount = new Int32Array(WORLD.SECTIONS);
    this.pileH = new Float32Array(WORLD.SECTIONS);
    this.climbers = new Int32Array(WORLD.SECTIONS);
    this.acid = new Float32Array(WORLD.SECTIONS); // bloater acid ramps

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

    // rendering: living — detailed mesh close to the wall, boxes far away
    const mat = createZombieMaterial(uniforms);
    const depth = createZombieDepthMaterial(uniforms);
    // (and the giants, few and huge, on a sculpted mesh of their own)
    this.lods = [createZombieGeometry(0), createZombieGeometry(2), createGiantGeometry()].map((geo, li) => {
      const L = {
        aAnim: addInstanced(geo, 'aAnim', li === 2 ? 4 : N, 4),
        aState: addInstanced(geo, 'aState', li === 2 ? 4 : N, 4),
        aTint: addInstanced(geo, 'aTint', li === 2 ? 4 : N, 3),
      };
      L.mesh = new THREE.InstancedMesh(geo, mat, li === 2 ? 4 : N);
      L.mesh.customDepthMaterial = depth;
      L.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      L.mesh.count = 0;
      L.mesh.frustumCulled = false;
      L.mesh.castShadow = shadows;
      L.mesh.receiveShadow = true;
      scene.add(L.mesh);
      return L;
    });
    this.mesh = this.lods[0].mesh;
    this.lodNear2 = 72 * 72;
    // full per-zombie buffers (eyes see every zombie)
    this.aAnim = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aState = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.tintBuf = new Float32Array(N * 3);
    this.eyes = createEyeMesh(N, uniforms, fogUniforms, this.aAnim, this.aState);
    this.eyes.count = 0;
    scene.add(this.eyes);
    // soft contact shadows that ground every walker
    {
      const bg = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
      const bm = new THREE.ShaderMaterial({
        vertexShader: `varying vec2 vB; void main(){ vB = position.xz * 2.0; vec3 c = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]); float s = length(instanceMatrix[0].xyz);
          vec3 p = c + vec3(position.x * 1.1 * s, 0.035, position.z * 1.25 * s); gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0); }`,
        fragmentShader: `varying vec2 vB; void main(){ float r = length(vB); float a = pow(max(0.0, 1.0 - r), 1.6) * 0.55; gl_FragColor = vec4(0.0, 0.0, 0.0, a); }`,
        transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      this.blobs = new THREE.InstancedMesh(bg, bm, N);
      this.blobs.instanceMatrix = this.eyes.instanceMatrix;
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

  clear() {
    this.n = 0; this.alive = 0;
    this.pending.length = 0;
    this.secW.fill(0); this.pileH.fill(0); this.secCount.fill(0); this.acid.fill(0);
    this.corpses.clear();
    for (const L of this.lods) L.mesh.count = 0;
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
    if (this.n >= this.cap) return -1;
    const T = ZOMBIE_TYPES[type];
    const i = this.n++;
    this.alive++;
    this.id[i] = this.nextId++;
    this.type[i] = type;
    this.dead[i] = 0;
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
    const lx = side * rand(WORLD.GATE_HALF + 2.5, WORLD.WING_END - 3);
    this.tgtX[i] = lx;
    this.tgtZ[i] = wallZ(lx) - 0.2;
    this.yaw[i] = Math.atan2(lx - x, this.tgtZ[i] - z);
    this.flash[i] = 0; this.burn[i] = 0; this.burnDps[i] = 0; this.atk[i] = 0;
    this.climb[i] = 0; this.climbDur[i] = rand(PILE.CLIMB_TIME[0], PILE.CLIMB_TIME[1]);
    this.slow[i] = 0;
    this.pileJit[i] = Math.random();
    let c = SHIRTS[(Math.random() * SHIRTS.length) | 0];
    if (type === ZT.BRUTE) c = [0.09, 0.1, 0.07];
    if (type === ZT.BLOATER) c = [0.2, 0.22, 0.15];
    if (type === ZT.GIANT) c = [0.06, 0.05, 0.045];
    const v = rand(0.7, 1.25);
    this.tr[i] = c[0] * v; this.tg[i] = c[1] * v; this.tb[i] = c[2] * v;
    return i;
  }

  /** Send a zombie back to a lane on the wall (after an event pulled it elsewhere). */
  resetLane(i, side = 0) {
    const x = this.x[i];
    const s = side || (Math.random() < 0.72 ? Math.sign(x || 1) : -Math.sign(x || 1));
    const lx = s * rand(WORLD.GATE_HALF + 2.5, WORLD.WING_END - 3);
    this.tgtX[i] = lx;
    this.tgtZ[i] = wallZ(lx) - 0.2;
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
    this.corpses.add(x, y, z, this.yaw[i], s, type, tint, vx, vy, vz, headshot, this.burn[i] > 0, flying);
    if (!flying) this.fx.blood(x, z, 0.8 * s);
  }

  breach(i) {
    if (this.dead[i]) return;
    this.dead[i] = 1;
    this.alive--;
    // the men on the walkway fight back and shove the pile down before they fall
    const s = sectionOf(this.x[i]);
    if (s >= 0) this.pileH[s] = Math.max(0, this.pileH[s] - PILE.KNOCKDOWN);
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

  isHeadshot(frac) { return frac > HEADSHOT_FRAC; }

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

    // pile heights from last frame's crowd weight
    for (let s = 0; s < WORLD.SECTIONS; s++) {
      this.acid[s] = Math.max(0, this.acid[s] - dt * PILE.ACID_DECAY);
      const target = Math.min(this.secW[s] * PILE.HEIGHT_PER_WEIGHT * this.pileMul + (this.secW[s] > 0 ? this.acid[s] : 0), WORLD.WALL_H + 0.4);
      const h = this.pileH[s];
      const rate = target > h ? 0.7 : 2.0;
      this.pileH[s] = h + (target - h) * (1 - Math.exp(-rate * dt));
      this.secW[s] = 0;
      this.secCount[s] = 0;
      this.climbers[s] = 0;
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

      // separation (uses last frame's grid)
      const sec = sectionOf(x);
      const zone = sec >= 0 ? PILE.ZONE_BASE + this.pileH[sec] * PILE.ZONE_PER_M : 0;
      const giant = type === ZT.GIANT;
      const inPile = !giant && sec >= 0 && dist < zone;
      const ri = this.radius[i] * (inPile ? 0.62 : 1);
      let pxs = 0, pzs = 0, checks = 0;
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
        this.acid[sec] = Math.min(PILE.ACID_MAX, this.acid[sec] + PILE.ACID_PER_BLOATER);
        if (this.onBloaterWall) this.onBloaterWall(sec, x, z);
        this.kill(i, 'wall', 0, 1, -1, false, 999);
        continue;
      }

      // pile & climbing
      let ty = 0;
      if (inPile) {
        this.secW[sec] += this.weight[i];
        this.secCount[sec]++;
        const ph = this.pileH[sec];
        const k = 1 - dist / zone;
        ty = ph * Math.pow(k > 0 ? k : 0, 0.75) * (0.82 + 0.18 * this.pileJit[i]);
        if (ph >= WALL_H - 0.5 && dist < 1.3 + ph * 0.08 && (this.climb[i] > 0 || this.climbers[sec] < PILE.MAX_CLIMBERS)) {
          this.climbers[sec]++;
          this.climb[i] += dt;
          const c = this.climb[i] / this.climbDur[i];
          ty = ph + (WALL_H + 0.9 - ph) * Math.min(1, c);
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

      const wantAtk = (dist < 1.6 + this.pileH[sec >= 0 ? sec : 0] * 0.12 || Y[i] > 1.0 || (giant && dist < 2.8)) ? 1 : 0;
      this.atk[i] += (wantAtk - this.atk[i]) * (1 - Math.exp(-5 * dt));
    }

    this.compact();
    this.buildGrid();
    this.corpses.update(dt);
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
    const M = this.eyes.instanceMatrix.array;
    const A = this.aAnim.array, S = this.aState.array, T = this.tintBuf;
    const near = this.lods[0], far = this.lods[1], big = this.lods[2];
    const MN = near.mesh.instanceMatrix.array, MF = far.mesh.instanceMatrix.array, MG = big.mesh.instanceMatrix.array;
    const AN = near.aAnim.array, AF = far.aAnim.array, SN = near.aState.array, SF = far.aState.array, TN = near.aTint.array, TF = far.aTint.array;
    const cx = WORLD.CAM.x, cz = WORLD.CAM.z, lim = this.lodNear2;
    const fire = this.fire;
    let a = 0, b = 0, gi = 0;
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
      A[q4] = this.phase[i]; A[q4 + 1] = this.rate[i]; A[q4 + 2] = this.type[i]; A[q4 + 3] = this.lean[i];
      S[q4] = this.flash[i]; S[q4 + 1] = burn; S[q4 + 2] = this.atk[i]; S[q4 + 3] = -this.fadeIn[i];
      T[t3] = this.tr[i]; T[t3 + 1] = this.tg[i]; T[t3 + 2] = this.tb[i];
      // copy into the LOD that draws it
      const dx = x - cx, dz = z - cz;
      let k, LM, LA, LS, LT;
      if (ty === ZT.GIANT && gi < 4) { k = gi++; LM = MG; LA = big.aAnim.array; LS = big.aState.array; LT = big.aTint.array; }
      else if (dx * dx + dz * dz < lim) { k = a++; LM = MN; LA = AN; LS = SN; LT = TN; } else { k = b++; LM = MF; LA = AF; LS = SF; LT = TF; }
      const ko = k * 16, k4 = k * 4, k3 = k * 3;
      for (let j = 0; j < 16; j++) LM[ko + j] = M[o + j];
      LA[k4] = A[q4]; LA[k4 + 1] = A[q4 + 1]; LA[k4 + 2] = A[q4 + 2]; LA[k4 + 3] = A[q4 + 3];
      LS[k4] = S[q4]; LS[k4 + 1] = S[q4 + 1]; LS[k4 + 2] = S[q4 + 2]; LS[k4 + 3] = S[q4 + 3];
      LT[k3] = T[t3]; LT[k3 + 1] = T[t3 + 1]; LT[k3 + 2] = T[t3 + 2];
      if (burn > 0 && fire) fire.transient(x, y + 0.15 * sc, z, 0.85 * sc * wide, 2.1 * sc, 0.9 + burn * 0.8, (this.phase[i] * 0.37) % 1);
    }
    near.mesh.count = a;
    far.mesh.count = b;
    big.mesh.count = gi;
    this.eyes.count = n;
    this.blobs.count = n;
    const upd = (attr, cnt) => {
      if (cnt <= 0) return;
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, cnt * attr.itemSize);
      attr.needsUpdate = true;
    };
    upd(this.eyes.instanceMatrix, n); upd(this.aAnim, n); upd(this.aState, n);
    upd(near.mesh.instanceMatrix, a); upd(near.aAnim, a); upd(near.aState, a); upd(near.aTint, a);
    upd(far.mesh.instanceMatrix, b); upd(far.aAnim, b); upd(far.aState, b); upd(far.aTint, b);
    upd(big.mesh.instanceMatrix, gi); upd(big.aAnim, gi); upd(big.aState, gi); upd(big.aTint, gi);
  }

  /** 0..1 pressure per section for the HUD */
  pressure(s) { return Math.min(1, this.pileH[s] / WORLD.WALL_H); }
}

function isExplosive(cause) { return EXPLOSIVE[cause] === 1; }
