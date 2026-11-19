// The zombie's poses, as the bake works with them: a pose is the hips' position plus one
// rotation per joint, each expressed in character axes as if its parent stood in the bind pose
// (x: the zombie's left, y: up, z: forward). That makes poses easy to key by hand ("swing the
// left arm forward 80°") and to layer on the pack's own clips, whatever the rig's joint frames.
//
// Forward kinematics: D(b) = D(parent) · R(b) is the bone's world rotation away from bind, and
// its joint sits where its parent carries it, rigidly. The skinning matrix is then
// S(b) = [ D(b) | p(b) − D(b)·p_bind(b) ].
import * as THREE from 'three';

export const SIDES = ['Left', 'Right'];
/** The bones the game animates (fingers and the jaw's chain fold into hand and jaw). */
export const BONES = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'Jaw'];
for (const s of SIDES) BONES.push(s + 'Shoulder', s + 'Arm', s + 'ForeArm', s + 'Hand');
for (const s of SIDES) BONES.push(s + 'UpLeg', s + 'Leg', s + 'Foot', s + 'ToeBase');
export const PARENT = { Hips: null, Spine: 'Hips', Spine1: 'Spine', Spine2: 'Spine1', Neck: 'Spine2', Head: 'Neck', Jaw: 'Head' };
for (const s of SIDES) Object.assign(PARENT, {
  [s + 'Shoulder']: 'Spine2', [s + 'Arm']: s + 'Shoulder', [s + 'ForeArm']: s + 'Arm', [s + 'Hand']: s + 'ForeArm',
  [s + 'UpLeg']: 'Hips', [s + 'Leg']: s + 'UpLeg', [s + 'Foot']: s + 'Leg', [s + 'ToeBase']: s + 'Foot',
});
export const BI = Object.fromEntries(BONES.map((b, i) => [b, i]));
/** The source rig's name for a game bone. */
export const srcName = (b) => (b === 'Jaw' ? 'Zombie_low_jaw1' : 'Zombie_' + b);

const D2R = Math.PI / 180;
const _e = new THREE.Euler();
/** A joint rotation from degrees about the character axes (x: pitch, y: yaw, z: roll), applied z, then x, then y... as Euler 'YXZ'. */
export const rot = (x = 0, y = 0, z = 0) => new THREE.Quaternion().setFromEuler(_e.set(x * D2R, y * D2R, z * D2R, 'YXZ'));

export class Pose {
  constructor() {
    this.hips = new THREE.Vector3();
    this.R = BONES.map(() => new THREE.Quaternion());
  }
  clone() { const p = new Pose(); p.hips.copy(this.hips); this.R.forEach((q, i) => p.R[i].copy(q)); return p; }
  copy(o) { this.hips.copy(o.hips); o.R.forEach((q, i) => this.R[i].copy(q)); return this; }
  /** Rotate joint b by q about the parent-frame axes (on top of what it has). */
  turn(b, q) { this.R[BI[b]].premultiply(q); return this; }
  /** Rotate joint b by q about its own (already turned) axes. */
  twist(b, q) { this.R[BI[b]].multiply(q); return this; }
  set(b, q) { this.R[BI[b]].copy(q); return this; }
}

/** Blend two poses: a·(1−t) + b·t (per joint slerp). */
export function mix(a, b, t, out = new Pose()) {
  out.hips.lerpVectors(a.hips, b.hips, t);
  for (let i = 0; i < BONES.length; i++) out.R[i].slerpQuaternions(a.R[i], b.R[i], t);
  return out;
}

/** The rig at bind: joint positions (character space, metres). */
export class Rig {
  constructor(bindPos) {
    this.bind = BONES.map((b) => bindPos[b].clone());
    this.hips0 = this.bind[0].clone();
  }
  /** Pose -> { D: world rotations, P: joint positions } */
  solve(pose) {
    const D = [], P = [];
    for (let i = 0; i < BONES.length; i++) {
      const pi = PARENT[BONES[i]] === null ? -1 : BI[PARENT[BONES[i]]];
      if (pi < 0) { D[i] = pose.R[i].clone(); P[i] = pose.hips.clone(); continue; }
      D[i] = D[pi].clone().multiply(pose.R[i]);
      P[i] = this.bind[i].clone().sub(this.bind[pi]).applyQuaternion(D[pi]).add(P[pi]);
    }
    return { D, P };
  }
  /** Skinning matrices as rows: 12 floats per bone (r0, r1, r2 of [R|t]). */
  skin(pose, out, o = 0) {
    const { D, P } = this.solve(pose);
    const m = new THREE.Matrix4();
    for (let i = 0; i < BONES.length; i++) {
      m.makeRotationFromQuaternion(D[i]);
      const t = this.bind[i].clone().applyQuaternion(D[i]).negate().add(P[i]);
      const e = m.elements; // column-major
      const k = o + i * 12;
      out[k] = e[0]; out[k + 1] = e[4]; out[k + 2] = e[8]; out[k + 3] = t.x;
      out[k + 4] = e[1]; out[k + 5] = e[5]; out[k + 6] = e[9]; out[k + 7] = t.y;
      out[k + 8] = e[2]; out[k + 9] = e[6]; out[k + 10] = e[10]; out[k + 11] = t.z;
    }
  }
  /** World rotations (from bind) + hips position -> a pose (the inverse of solve's rotations). */
  fromWorld(Dw, hips) {
    const p = new Pose();
    p.hips.copy(hips);
    for (let i = 0; i < BONES.length; i++) {
      const par = PARENT[BONES[i]];
      p.R[i].copy(par === null ? Dw[i] : Dw[BI[par]].clone().invert().multiply(Dw[i]));
    }
    return p;
  }
}
