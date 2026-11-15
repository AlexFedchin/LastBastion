// Mixamo clips -> the game soldier's skeleton.
//
// Each clip FBX ("Without Skin") carries the auto-rigged Mixamo skeleton in its T-pose and
// local rotations for it. The game rig is the original model's own skeleton: same bone names,
// but different joint frames, and its bind pose is an A-pose. So:
//  1. build the game rig's T-pose: from its bind pose, swing each bone (parents first) so the
//     segment to its child points the way the Mixamo T-pose's does;
//  2. per bone, the offset between the two T-poses: O = Arest^-1 * Gt (world rotations);
//  3. per frame, the clip's world rotation times O is the game bone's world rotation, which
//     goes back into a local rotation under its (also retargeted) parent.
// Fingers keep the game pose (the hand is closed on the rifle); the hips also get their
// translation, scaled by leg length.
import * as THREE from 'three';
import { load } from './load.mjs';

// each bone -> the child that gives its direction
const SIDES = ['Left', 'Right'];
const CHAIN = {
  Spine: 'Spine1', Spine1: 'Spine2', Spine2: 'Neck', Neck: 'Head', Head: 'HeadTop_End',
};
for (const s of SIDES) Object.assign(CHAIN, {
  [s + 'Shoulder']: s + 'Arm', [s + 'Arm']: s + 'ForeArm', [s + 'ForeArm']: s + 'Hand', [s + 'Hand']: s + 'HandMiddle1',
  [s + 'UpLeg']: s + 'Leg', [s + 'Leg']: s + 'Foot', [s + 'Foot']: s + 'ToeBase', [s + 'ToeBase']: s + 'Toe_End',
});
export const ANIMATED = ['Hips', ...Object.keys(CHAIN)];
const P = 'mixamorig';

const world = (m) => { const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3(); m.decompose(p, q, s); return { p, q }; };

/**
 * gameBones: the game rig's bones by short name (first skeleton of the source FBX, scene pose
 * as the glb stores it); bind: their bind world matrices. Returns a function that turns a
 * clip FBX into { name, times, rot: {bone: Float32Array xyzw...}, hips: Float32Array xyz (cm, game world) }.
 */
export function makeRetargeter(gameBones, bind) {
  // game T-pose, built from the bind pose
  const names = Object.keys(gameBones);
  const parent = {};
  for (const n of names) { const pb = gameBones[n].parent; parent[n] = pb && pb.isBone ? pb.name.replace(P, '') : null; }
  const order = []; const visit = (n) => { if (order.includes(n)) return; if (parent[n]) visit(parent[n]); order.push(n); };
  names.forEach(visit);
  const kids = {}; for (const n of names) if (parent[n]) (kids[parent[n]] ||= []).push(n);
  const sub = (n) => [n, ...(kids[n] || []).flatMap(sub)];
  const T = {}; for (const n of names) T[n] = world(bind[n]);

  return async function retarget(file, { fps = 30 } = {}) {
    const a = await load(file);
    a.updateMatrixWorld(true);
    const ab = {}; a.traverse((o) => { if (o.isBone) ab[o.name.replace(P, '')] = o; });
    const rest = {}; for (const n in ab) rest[n] = world(ab[n].matrixWorld);
    // 1. swing the game bind pose into the Mixamo T-pose (fresh copy per clip: rests differ per rig)
    const G = {}; for (const n of names) G[n] = { p: T[n].p.clone(), q: T[n].q.clone() };
    const sw = new THREE.Quaternion(), d0 = new THREE.Vector3(), d1 = new THREE.Vector3(), r = new THREE.Vector3();
    for (const n of order) {
      const c = CHAIN[n];
      if (!c || !G[c] || !rest[n] || !rest[c]) continue;
      d0.subVectors(G[c].p, G[n].p).normalize();
      d1.subVectors(rest[c].p, rest[n].p).normalize();
      sw.setFromUnitVectors(d0, d1);
      const o = G[n].p.clone();
      for (const j of sub(n)) { G[j].q.premultiply(sw); r.subVectors(G[j].p, o).applyQuaternion(sw); G[j].p.copy(o).add(r); }
    }
    // 2. offsets
    const O = {}; for (const n of ANIMATED) if (rest[n] && G[n]) O[n] = rest[n].q.clone().invert().multiply(G[n].q);
    // hips: scale by hip height over the toes
    const s = (T.Hips.p.y - T.LeftToeBase.p.y) / (rest.Hips.p.y - rest.LeftToeBase.p.y);
    // 3. sample
    const clip = a.animations[0];
    const mixer = new THREE.AnimationMixer(a);
    mixer.clipAction(clip).play();
    const n = Math.max(2, Math.round(clip.duration * fps) + 1);
    const times = new Float32Array(n), rot = {}, hips = new Float32Array(n * 3);
    for (const b of ANIMATED) rot[b] = new Float32Array(n * 4);
    const W = {}, q = new THREE.Quaternion(), hp = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const t = Math.min(clip.duration, i / fps);
      times[i] = t;
      mixer.setTime(t);
      a.updateMatrixWorld(true);
      for (const b of ANIMATED) {
        if (!O[b]) continue;
        ab[b].getWorldQuaternion(q);
        W[b] = q.clone().multiply(O[b]);
      }
      for (const b of ANIMATED) {
        if (!W[b]) continue;
        const p = parent[b];
        // the hips hang off the glb's root directly, so their local rotation is the world one
        const local = p && W[p] ? W[p].clone().invert().multiply(W[b]) : W[b];
        local.toArray(rot[b], i * 4);
      }
      ab.Hips.getWorldPosition(hp);
      hips[i * 3] = T.Hips.p.x + (hp.x - rest.Hips.p.x) * s;
      hips[i * 3 + 1] = T.LeftToeBase.p.y + (hp.y - rest.LeftToeBase.p.y) * s;
      hips[i * 3 + 2] = T.Hips.p.z + (hp.z - rest.Hips.p.z) * s;
    }
    // keep quaternions on one hemisphere so interpolation takes the short way
    for (const b of ANIMATED) { const v = rot[b]; for (let i = 4; i < v.length; i += 4) if (v[i] * v[i - 4] + v[i + 1] * v[i - 3] + v[i + 2] * v[i - 2] + v[i + 3] * v[i - 1] < 0) for (let k = 0; k < 4; k++) v[i + k] = -v[i + k]; }
    return { duration: clip.duration, times, rot, hips };
  };
}
