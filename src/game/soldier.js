// Soldiers on our side: the rigged contractor model (app/models/soldier.glb) moving to
// Mixamo clips retargeted onto his skeleton at build time (scripts/models/retarget.mjs):
// run, walk, carry, aim/fire, idles, kneeling work, two deaths. Clips are sampled by hand
// (no AnimationMixer: dozens of men, each only ever blending two clips), and aiming is laid
// on top: the spine turns so the rifle points where the caller wants. Rotations are applied
// in model space (x = his left, y = up, z = forward), so they don't depend on how each
// Mixamo bone happens to be oriented.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { modelScene, modelClips, cloneModel } from '../world/models.js';
import { seatRest } from './seat.js';

const REST_ELEV = 25 * Math.PI / 180;     // the rifle's elevation in the model's own pose
const MUZZLE = new THREE.Vector3(0.053, 1.59, 0.96); // printed by build_models.mjs soldier
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
const _d = new THREE.Vector3(), _ax = new THREE.Vector3(), _v = new THREE.Vector3();
const wrap = (t, d) => ((t % d) + d) % d;

// ground speed (m/s) each in-place locomotion clip is played against: distance -> clip time.
// The run is played a little long in the stride so its cadence stays human at 4.6 m/s.
const GAIT = { rifle_run: 3.2, rifle_walk: 1.1, box_walk: 1.4 };

// the game clock the idles run on (set every frame by main.js)
let clock = 0;
export function setSoldierClock(t) { clock = t; }
export function soldierClock() { return clock; }

// clips: name -> { dur, times, tracks: [{ bone, pos, values }] }, built on first use
let CLIPS = null;
function clips() {
  if (CLIPS) return CLIPS;
  CLIPS = {};
  for (const c of modelClips('soldier')) {
    if (!c.tracks.length) continue;
    const tracks = c.tracks.map((t) => {
      const [node, prop] = t.name.split('.');
      return { bone: node.replace('mixamorig', ''), pos: prop === 'position', values: t.values };
    });
    CLIPS[c.name] = { dur: c.duration, times: c.tracks[0].times, tracks };
  }
  return CLIPS;
}
let serial = 0;

// the sodium lamps on the wall light our men the way they light the dead (see zombieModel.js)
let lampUniforms = null;
export function setSoldierLamps(u) { lampUniforms = u; }
const patched = new WeakSet();
export function lampify(mat) { patchLamps(mat); }
// (under WebGPU the wall lamps are real spot lights, lamplight.js: they light our men by themselves)
function patchLamps(mat) {
  if (patched.has(mat) || !lampUniforms) return;
  patched.add(mat);
}

export class Soldier {
  constructor() {
    this.isSoldier = true;
    this.root = new THREE.Group();     // placed and turned by the caller; forward = +z
    this.body = new THREE.Group();     // falls over when he is killed
    this.root.add(this.body);
    const m = cloneSkinned(modelScene('soldier'));
    m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; patchLamps(o.material); } });
    this.body.add(m);
    this.bones = {};
    m.traverse((o) => { if (o.isBone) this.bones[o.name.replace('mixamorig', '')] = o; });
    seatRest(this, m); // (the legs' rest pose, for sitting: seat.js)
    // rest: each bone's local rotation and its rotation in model space
    m.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(m.matrixWorld).invert();
    this.rest = {};
    for (const [k, b] of Object.entries(this.bones)) {
      const w = new THREE.Quaternion();
      new THREE.Matrix4().multiplyMatrices(inv, b.matrixWorld).decompose(new THREE.Vector3(), w, new THREE.Vector3());
      this.rest[k] = { local: b.quaternion.clone(), model: w };
    }
    // the muzzle rides the right hand
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.copy(MUZZLE);
    this.body.add(this.muzzle);
    this.body.updateMatrixWorld(true);
    this.rifle = this.bones.Rifle || this.bones.RightHand; // the rifle's own joint (see build_models.mjs)
    this.rifle.attach(this.muzzle);
    this.root.visible = false;
    this.model = m;
    this.hipsRest = this.bones.Hips.position.clone();
    // the rifle's axis in the right hand's frame (from the model's pose: pointing REST_ELEV up)
    this.rifleInHand = new THREE.Vector3(0, Math.sin(REST_ELEV), Math.cos(REST_ELEV))
      .applyQuaternion(this.modelQ('RightHand', new THREE.Quaternion()).invert());
    // slung: diagonally across his back, muzzle up behind the right shoulder (carrying, working)
    if (this.bones.Rifle) {
      const toModel = new THREE.Matrix4().copy(m.matrixWorld).invert();
      const Mr = toModel.clone().multiply(this.rifle.matrixWorld);
      const a0 = new THREE.Vector3(0, Math.sin(REST_ELEV), Math.cos(REST_ELEV));
      const mid = MUZZLE.clone().addScaledVector(a0, -0.45);
      const R = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(a0, new THREE.Vector3(-0.3, 0.95, -0.06).normalize()));
      const M = new THREE.Matrix4().makeTranslation(0.03, 1.36, -0.22).multiply(R).multiply(new THREE.Matrix4().makeTranslation(-mid.x, -mid.y, -mid.z)).multiply(Mr);
      const Ms = toModel.clone().multiply(this.bones.Spine2.matrixWorld);
      this.slingLocal = Ms.invert().multiply(M);
    }
    this.slung = false;
    this.id = serial++;
    this.off = (this.id * 7.31) % 30; // where in the idles this one is
  }

  /** A bone's rotation in model space, as posed now. */
  modelQ(name, out) {
    const b = this.bones[name];
    out.copy(b.quaternion);
    for (let p = b.parent; p && p !== this.model; p = p.parent) out.premultiply(p.quaternion);
    return out;
  }

  /** Rotate a bone by `angle` about a model-space axis, on top of its current pose. */
  addTurn(name, axis, angle) {
    const b = this.bones[name];
    if (!b || !angle) return;
    this.modelQ(name, _qa);
    _q.setFromAxisAngle(axis, angle);
    _q2.copy(_qa).invert().multiply(_q).multiply(_qa);
    b.quaternion.multiply(_q2);
  }

  /** Lay clip `name` at time t over the pose with weight w (w = 1: replace it). */
  play(name, t, w = 1) {
    const c = clips()[name];
    if (!c) return false;
    const T = c.times, n = T.length;
    let i = Math.min(n - 2, Math.max(0, Math.floor(t * 30)));
    while (i > 0 && T[i] > t) i--;
    while (i < n - 2 && T[i + 1] <= t) i++;
    const f = THREE.MathUtils.clamp((t - T[i]) / (T[i + 1] - T[i] || 1), 0, 1);
    for (const tr of c.tracks) {
      const b = this.bones[tr.bone];
      if (!b) continue;
      const v = tr.values;
      if (tr.pos) {
        _v.set(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]).lerp(_d.set(v[i * 3 + 3], v[i * 3 + 4], v[i * 3 + 5]), f);
        if (w >= 1) b.position.copy(_v); else b.position.lerp(_v, w);
      } else {
        _qa.fromArray(v, i * 4).slerp(_qb.fromArray(v, i * 4 + 4), f);
        if (w >= 1) b.quaternion.copy(_qa); else b.quaternion.slerp(_qa, w);
      }
    }
    return true;
  }

  dur(name) { const c = clips()[name]; return c ? c.dur : 1; }

  /** Where the rifle points now, in model space. */
  rifleDir(out) { return out.copy(this.rifleInHand).applyQuaternion(this.modelQ('RightHand', _q)); }

  /** Rotate a bone by `angle` about a model-space axis, on top of its rest pose. */
  turn(name, axis, angle) {
    const b = this.bones[name], r = this.rest[name];
    if (!b) return;
    // local = rest * (W^-1 * R * W): a model-space rotation expressed in the bone's frame
    _q.setFromAxisAngle(axis, angle);
    _q2.copy(r.model).invert().multiply(_q).multiply(r.model);
    b.quaternion.copy(r.local).multiply(_q2);
  }

  /**
   * Swap the rifle for another weapon model (the wall crews' MG4: app/models/mg4.glb, its
   * origin at the pistol grip, barrel along +z, a 'muzzle' anchor). The rifle's joint is
   * collapsed so its mesh vanishes; the gun rides the right hand on the rifle's own axis,
   * so aim() points it exactly as it pointed the rifle. Call before any pose is played.
   */
  carry(name) {
    if (this.carried || !this.bones.Rifle) return null;
    const gun = cloneModel(name);
    gun.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    let anchors = null;
    gun.traverse((o) => { if (!anchors && o.userData.anchors) anchors = o.userData.anchors; });
    // fitted to both hands as they are in the aiming pose: the pistol grip in the right palm,
    // the handguard (under the barrel, ahead of the feed cover) in the left
    for (const [k, r] of Object.entries(this.rest)) this.bones[k].quaternion.copy(r.local);
    this.play('rifle_aiming_idle', 0);
    this.body.updateMatrixWorld(true);
    const toModel = new THREE.Matrix4().copy(this.model.matrixWorld).invert();
    const P = (n) => new THREE.Vector3().setFromMatrixPosition(this.bones[n].matrixWorld).applyMatrix4(toModel);
    const palm = (side) => { const w = P(side + 'Hand'), m = this.bones[side + 'HandMiddle1'] ? P(side + 'HandMiddle1') : w; return w.lerp(m, 0.55); };
    const R = palm('Right'), L = palm('Left');
    const GUARD = new THREE.Vector3(0, 0.035, 0.34); // the handguard, in the gun's frame (grip at the origin)
    // barrel direction: the grip-to-guard line through both hands, the gun's top kept up
    const want = L.clone().sub(R).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(GUARD.clone().normalize(), want);
    const upNow = new THREE.Vector3(0, 1, 0).applyQuaternion(q), fwd = want;
    const flat = (v) => v.clone().sub(fwd.clone().multiplyScalar(v.dot(fwd))).normalize();
    const a1 = flat(upNow), b1 = flat(new THREE.Vector3(0, 1, 0));
    const roll = Math.atan2(fwd.dot(new THREE.Vector3().crossVectors(a1, b1)), a1.dot(b1));
    q.premultiply(new THREE.Quaternion().setFromAxisAngle(fwd, roll));
    gun.quaternion.copy(q);
    // grip in the right palm, slid along the line so the guard meets the left palm halfway
    const reach = L.distanceTo(R), slack = (reach - GUARD.length()) / 2;
    gun.position.copy(R).addScaledVector(want, slack);
    this.model.add(gun);
    gun.updateMatrixWorld(true);
    this.bones.RightHand.attach(gun);
    // aim() now points this gun's barrel: its axis in the right hand's frame
    const barrel = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    this.rifleInHand = barrel.applyQuaternion(this.modelQ('RightHand', new THREE.Quaternion()).invert()).normalize();
    // the muzzle point (tracers, flashes) moves to the new gun's muzzle
    gun.attach(this.muzzle);
    if (anchors && anchors.muzzle) this.muzzle.position.fromArray(anchors.muzzle); else this.muzzle.position.set(0, 0.03, 0.8);
    this.muzzle.quaternion.identity();
    this.bones.Rifle.scale.setScalar(1e-4);
    this.slingLocal = null; // (nothing to sling: the gun stays in his hands)
    this.carried = gun;
    for (const [k, r] of Object.entries(this.rest)) this.bones[k].quaternion.copy(r.local);
    return gun;
  }

  /** Rifle on his back (true) or in his hands. */
  sling(on) {
    if (on === this.slung || !this.slingLocal) return;
    this.slung = on;
    const r = this.rifle;
    if (on) { this.bones.Spine2.add(r); this.slingLocal.decompose(r.position, r.quaternion, r.scale); }
    else { this.bones.RightHand.add(r); r.position.set(0, 0, 0); r.quaternion.identity(); r.scale.set(1, 1, 1); }
  }

  reset() {
    this.sling(false);
    for (const [k, r] of Object.entries(this.rest)) this.bones[k].quaternion.copy(r.local);
    if (this.hipsRest) this.bones.Hips.position.copy(this.hipsRest);
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
  }

  /**
   * Standing, rifle pointed `elev` radians above the horizon and `yaw` to his left;
   * kick (0..1) is the recoil of the last shot.
   */
  aim(elev, yaw = 0, kick = 0) {
    this.sling(false);
    if (!this.play('rifle_aiming_idle', wrap(clock + this.off, this.dur('rifle_aiming_idle')))) return this.aimRest(elev, yaw, kick);
    if (kick > 0) this.play('rifle_firing', (1 - kick) * 0.3, kick * 0.85);
    // turn at the waist until the rifle is on the bearing, then bend it onto the elevation
    this.rifleDir(_d);
    const turn = THREE.MathUtils.clamp(yaw - Math.atan2(_d.x, _d.z), -1.2, 1.2);
    for (const sp of ['Spine', 'Spine1', 'Spine2']) this.addTurn(sp, Y, turn / 3);
    this.rifleDir(_d);
    const bend = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(_d.y, -1, 1)) - elev - kick * 0.06, -0.6, 1.1);
    _ax.set(_d.z, 0, -_d.x).normalize(); // horizontal, square to the rifle: + tips the muzzle down
    for (const sp of ['Spine', 'Spine1', 'Spine2']) this.addTurn(sp, _ax, bend / 3);
  }

  /** The old procedural aim: the model's own pose bent at the waist (no clips loaded). */
  aimRest(elev, yaw, kick) {
    this.reset();
    const bend = THREE.MathUtils.clamp(REST_ELEV - elev - kick * 0.06, -0.5, 1.05);
    for (const s of ['Spine', 'Spine1', 'Spine2']) this.turn(s, X, bend / 3);
    if (yaw) this.turn('Spine', Y, yaw);
  }

  /** Running, or (carry) a heavy walk under a load; dist is how far he has come, in metres. */
  run(dist, carry = false) {
    const c = carry ? 'box_walk' : 'rifle_run';
    this.sling(carry);
    this.play(c, wrap(dist / GAIT[c], this.dur(c)));
  }

  /** An unhurried walk, rifle low; dist is how far he has come, in metres. */
  walk(dist) {
    this.sling(false);
    this.play('rifle_walk', wrap(dist / GAIT.rifle_walk, this.dur('rifle_walk')));
  }

  /** Standing easy: one of three idles, each man at his own place in it. */
  idle() {
    const c = 'rifle_idle_' + (1 + this.id % 3);
    this.sling(false);
    this.play(c, wrap(clock + this.off, this.dur(c)));
  }

  /** Down on one knee at the crate, working the straps; t in seconds. */
  work(t) {
    this.sling(true);
    this.play('kneeling_work', wrap(t + this.off, this.dur('kneeling_work')));
  }

  /** Killed t seconds ago: one of two deaths, played once and held. */
  die(t) {
    const c = 'rifle_death_' + (1 + this.id % 2);
    this.sling(false);
    this.play(c, Math.min(t, this.dur(c) - 1e-3));
  }
}
