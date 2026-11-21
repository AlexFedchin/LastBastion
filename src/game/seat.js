// Sitting down: a pose laid over whatever clip a figure (Soldier or Survivor) is playing.
// There is no sitting clip, so the legs are set here, in model space (x = their left,
// y = up, z = forward) against each bone's rest orientation, whatever the hips are doing:
// the thighs forward and a touch apart, the shins straight down a little ahead of the knees,
// the feet flat. The upper body keeps its clip (an idle: the breathing, the hands on the
// rifle), and the figure drops by its thigh's length onto a seat of the given height, or as
// far as its feet allow (a child's dangle).
import * as THREE from 'three';

const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion(), _p = new THREE.Quaternion(), _r = new THREE.Quaternion(), _s = new THREE.Quaternion();
const LEGS = ['UpLeg', 'Leg', 'Foot'];

/**
 * Note a figure's rest pose for sitting: call in its constructor, while the bones still hold
 * the bind pose (model: the skinned scene under fig.body; nothing transformed above it yet).
 */
export function seatRest(fig, model) {
  model.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(model.matrixWorld).invert(), m = new THREE.Matrix4();
  const rest = { q: {}, p: {} };
  for (const side of ['Left', 'Right']) for (const n of LEGS) {
    const b = fig.bones[side + n];
    if (!b) continue;
    const q = new THREE.Quaternion(), p = new THREE.Vector3();
    m.multiplyMatrices(inv, b.matrixWorld).decompose(new THREE.Vector3(), q, new THREE.Vector3());
    p.setFromMatrixPosition(b.matrixWorld); // (in metres: nothing above the model is moved yet)
    rest.q[side + n] = q; rest.p[side + n] = p;
  }
  const hip = rest.p.LeftUpLeg, knee = rest.p.LeftLeg;
  rest.thigh = hip && knee ? hip.y - knee.y : 0.45;
  rest.knee = knee ? knee.y : 0.5;
  fig.seatModel = model;
  fig.seatRestPose = rest;
}

/** A bone's parent's rotation in model space, as posed now. */
function parentQ(fig, b, out) {
  out.identity();
  for (let p = b.parent; p && p !== fig.seatModel; p = p.parent) out.premultiply(p.quaternion);
  return out;
}

/**
 * Sit: w 0..1 (0 standing as the clip has it, 1 seated); seatH: the seat's height over the
 * floor the figure stands on (metres). Call after the clip is played, every frame.
 */
export function seat(fig, w, seatH = 0.47) {
  const R = fig.seatRestPose;
  if (!R || w <= 0) { if (R) fig.body.position.y = 0; return; }
  for (const side of ['Left', 'Right']) {
    const out = side === 'Left' ? 1 : -1; // (their left is +x)
    for (const n of LEGS) {
      const b = fig.bones[side + n], rq = R.q[side + n];
      if (!b || !rq) continue;
      if (n === 'UpLeg') _r.setFromAxisAngle(Y, out * 0.13).multiply(_s.setFromAxisAngle(X, -Math.PI / 2)); // forward, knees a little apart
      else if (n === 'Leg') _r.setFromAxisAngle(X, -0.18); // shins down, the feet a little ahead of the knees
      else _r.identity(); // feet flat
      _q.copy(_r).multiply(rq);                          // where the bone should point, in model space
      _q.premultiply(parentQ(fig, b, _p).invert());      // ...in its parent's frame
      if (w >= 1) b.quaternion.copy(_q); else b.quaternion.slerp(_q, w);
    }
  }
  // seated, the hip joint is at the knee's standing height (the shin is upright under it), or
  // up on the seat if that is higher (the pelvis sits a few centimetres under the joint)
  const hipSeated = Math.max(R.knee, seatH + 0.06);
  fig.body.position.y = -(R.thigh + R.knee - hipSeated) * w;
}
