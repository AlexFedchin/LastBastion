// The zombie's clips that the pack doesn't have, keyed by hand on its rig, and the pack's own
// locomotion re-cut for the game's speeds. Each is a function of the loop's phase built from
// periodic curves (so every loop closes), with the body's weight on its feet (groundLock), limbs
// out of step with each other and the head lagging the body. See zombie_pose.mjs for the axes:
// x = the zombie's left, y = up, z = forward; pitch + bends forward / flexes a knee, roll + leans right.
//
// Each of these can be replaced by a Mixamo clip of the same name (build_zombie.mjs).
import * as THREE from 'three';
import { BONES, BI, rot } from './zombie_pose.mjs';

const D2R = Math.PI / 180;
const TAU = Math.PI * 2;

/** A periodic curve through [phase, value] keys (Catmull-Rom, wraps at 1). */
export function cyc(keys) {
  const k = [...keys].sort((a, b) => a[0] - b[0]);
  const n = k.length;
  return (p) => {
    p = ((p % 1) + 1) % 1;
    let i = n - 1;
    for (let j = 0; j < n; j++) if (k[j][0] <= p) i = j;
    const a = k[(i - 1 + n) % n], b = k[i], c = k[(i + 1) % n], d = k[(i + 2) % n];
    const tb = b[0], tc = c[0] <= tb ? c[0] + 1 : c[0];
    const pp = p < tb ? p + 1 : p;
    const t = (pp - tb) / (tc - tb);
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * b[1]) + (-a[1] + c[1]) * t + (2 * a[1] - 5 * b[1] + 4 * c[1] - d[1]) * t2 + (-a[1] + 3 * b[1] - 3 * c[1] + d[1]) * t3);
  };
}
/** A one-shot curve through [t, value] keys (smooth, holds its ends). */
export function seg(keys) {
  const k = [...keys].sort((a, b) => a[0] - b[0]);
  return (t) => {
    if (t <= k[0][0]) return k[0][1];
    if (t >= k[k.length - 1][0]) return k[k.length - 1][1];
    let i = 0; while (k[i + 1][0] < t) i++;
    const a = k[Math.max(0, i - 1)], b = k[i], c = k[i + 1], d = k[Math.min(k.length - 1, i + 2)];
    const u = (t - b[0]) / (c[0] - b[0]);
    // monotone-ish: Catmull-Rom with tangents scaled to the segment
    const m1 = (c[1] - a[1]) / Math.max(1e-6, c[0] - a[0]) * (c[0] - b[0]);
    const m2 = (d[1] - b[1]) / Math.max(1e-6, d[0] - b[0]) * (c[0] - b[0]);
    const u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * b[1] + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * c[1] + (u3 - u2) * m2;
  };
}
/** Smooth noise that loops: a few harmonics of the loop with fixed random phases. */
function loopNoise(seed, harmonics = [1, 2, 3, 5]) {
  let s = seed * 9301 + 49297;
  const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const H = harmonics.map((h) => [h, r() * TAU, 0.5 + r()]);
  const norm = H.reduce((a, x) => a + x[2], 0);
  return (p) => H.reduce((a, [h, ph, w]) => a + Math.sin(TAU * h * p + ph) * w, 0) / norm;
}

export function handClips({ rig, src, FPS, Pose }) {
  const B = rig.bind;
  const dir = (a, b) => B[BI[b]].clone().sub(B[BI[a]]).normalize();
  const Z = new THREE.Vector3(0, 0, 1);
  // what turns each arm from the A-pose to hanging straight down
  const hang = {}, elbowAxis = {}, upperDir = {}, foreDir = {};
  for (const s of ['Left', 'Right']) {
    upperDir[s] = dir(s + 'Arm', s + 'ForeArm');
    foreDir[s] = dir(s + 'ForeArm', s + 'Hand');
    hang[s] = new THREE.Quaternion().setFromUnitVectors(upperDir[s], new THREE.Vector3(0, -1, 0));
    elbowAxis[s] = new THREE.Vector3().crossVectors(foreDir[s], Z).normalize();
  }
  const axisAngle = (ax, deg) => new THREE.Quaternion().setFromAxisAngle(ax, deg * D2R);
  const sgn = (s) => (s === 'Left' ? 1 : -1);

  // ── pose helpers (angles in degrees) ──
  const base = () => { const p = new Pose(); p.hips.copy(rig.hips0); return p; };
  /** fwd: swing forward (90 = straight ahead, 180 = overhead), out: away from the body, twist: about the arm. */
  function arm(p, s, { fwd = 0, out = 8, twist = 0, elbow = 15, wrist = 0, wristSide = 0, shrug = 0, reach = 0 } = {}) {
    const q = rot(-fwd, 0, 0).multiply(rot(0, 0, sgn(s) * out)).multiply(hang[s]).multiply(axisAngle(upperDir[s], twist * sgn(s)));
    p.set(s + 'Arm', q);
    p.set(s + 'ForeArm', axisAngle(elbowAxis[s], elbow));
    p.set(s + 'Hand', rot(wrist, 0, sgn(s) * wristSide));
    p.set(s + 'Shoulder', rot(-reach, 0, sgn(s) * shrug));
  }
  /** thigh: forward swing, knee: flexion, foot: toe down. */
  function leg(p, s, { thigh = 0, out = 0, knee = 4, foot = 0, twist = 0, toe = 0 } = {}) {
    p.set(s + 'UpLeg', rot(-thigh, sgn(s) * twist, sgn(s) * out));
    p.set(s + 'Leg', rot(knee, 0, 0));
    p.set(s + 'Foot', rot(foot - knee * 0 , 0, 0));
    p.set(s + 'ToeBase', rot(toe, 0, 0));
  }
  function spine(p, { pitch = 0, yaw = 0, roll = 0 } = {}) {
    p.set('Spine', rot(pitch * 0.4, yaw * 0.3, roll * 0.4));
    p.set('Spine1', rot(pitch * 0.35, yaw * 0.35, roll * 0.35));
    p.set('Spine2', rot(pitch * 0.25, yaw * 0.35, roll * 0.25));
  }
  function head(p, { pitch = 0, yaw = 0, roll = 0, jaw = 6 } = {}) {
    p.set('Neck', rot(pitch * 0.45, yaw * 0.4, roll * 0.4));
    p.set('Head', rot(pitch * 0.55, yaw * 0.6, roll * 0.6));
    p.set('Jaw', rot(jaw, 0, 0));
  }
  const hips = (p, { pitch = 0, yaw = 0, roll = 0, x = 0, y = 0, z = 0 } = {}) => {
    p.set('Hips', rot(pitch, yaw, roll));
    p.hips.set(rig.hips0.x + x, rig.hips0.y + y, rig.hips0.z + z);
  };
  // the feet: how high each contact point stood at bind
  const contact = ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase'].map((b) => BI[b]);
  /** Drop (or lift) the body so its lowest foot is on the ground. lift: extra height (a flight phase). */
  function groundLock(p, lift = 0) {
    const { P } = rig.solve(p);
    let off = Infinity;
    for (const i of contact) off = Math.min(off, P[i].y - B[i].y);
    p.hips.y -= off - lift;
    return p;
  }
  const loop = (name, dur, fn, opts = {}) => {
    const n = Math.round(dur * FPS), poses = [];
    for (let f = 0; f < n; f++) poses.push(fn(f / n, f / FPS));
    return { name, loop: true, poses, ...opts };
  };
  const once = (name, dur, fn) => {
    const n = Math.round(dur * FPS), poses = [];
    for (let f = 0; f <= n; f++) poses.push(fn(f / n, f / FPS));
    return { name, loop: false, poses };
  };

  // ── re-cut locomotion: longer strides from the pack's walk and run ──
  // Exaggerate each joint's swing about its average through the cycle (legs, and arms a little),
  // then put the feet back on the ground.
  function avgQ(poses, i) {
    const a = new THREE.Vector4(), r0 = poses[0].R[i];
    for (const p of poses) { const q = p.R[i]; const s = q.dot(r0) < 0 ? -1 : 1; a.x += q.x * s; a.y += q.y * s; a.z += q.z * s; a.w += q.w * s; }
    return new THREE.Quaternion(a.x, a.y, a.z, a.w).normalize();
  }
  const powQ = (q, k) => { // q^k for a unit quaternion
    const w = Math.min(1, Math.max(-1, q.w)), ang = 2 * Math.acos(w), s = Math.sqrt(1 - w * w);
    if (s < 1e-6) return new THREE.Quaternion();
    return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(q.x / s, q.y / s, q.z / s), ang * k);
  };
  function exaggerate(clip, name, gains, after = null, speed = undefined) {
    const poses = clip.poses;
    const avg = BONES.map((b, i) => avgQ(poses, i));
    const out = poses.map((p0, f) => {
      const p = p0.clone();
      for (const [b, k] of Object.entries(gains)) {
        const i = BI[b];
        const d = avg[i].clone().invert().multiply(p.R[i]);
        p.R[i].copy(avg[i]).multiply(powQ(d, k));
      }
      if (after) after(p, f / poses.length);
      return groundLock(p);
    });
    return { name, loop: true, poses: out, speed };
  }
  const LEGS = (k, kk = k) => ({ LeftUpLeg: k, RightUpLeg: k, LeftLeg: kk, RightLeg: kk, LeftFoot: 1.1, RightFoot: 1.1 });
  const clips = [];
  // the shambler's lurch: the pack's walk, half again the stride
  clips.push(exaggerate(src.walk, 'shuffle', { ...LEGS(1.6, 1.35), LeftArm: 1.25, RightArm: 1.25, Spine: 1.3, Spine1: 1.2 }));
  // the brute: a heavy stride, more lean, arms hanging wide
  clips.push(exaggerate(src.walk, 'stomp', { ...LEGS(1.4, 1.3), Spine: 1.4, Hips: 1.5 }, (p, ph) => {
    p.turn('Spine', rot(9, 0, 0)); p.turn('Neck', rot(-8, 0, 0));
    p.turn('LeftArm', rot(0, 0, 14)); p.turn('RightArm', rot(0, 0, -14));
    p.turn('LeftShoulder', rot(0, 0, 6)); p.turn('RightShoulder', rot(0, 0, -6));
  }));
  // the bloater: a waddle, the weight rolling from foot to foot, arms held off the belly
  clips.push(exaggerate(src.walk, 'waddle', { ...LEGS(1.15, 1.1), Hips: 2.2, Spine: 1.6 }, (p, ph) => {
    const roll = Math.sin(TAU * ph) * 7;
    p.turn('Hips', rot(0, 0, roll)); p.turn('Spine', rot(-6, 0, -roll * 1.4));
    p.turn('LeftArm', rot(0, 0, 24)); p.turn('RightArm', rot(0, 0, -24));
    p.turn('LeftUpLeg', rot(0, 0, 6)); p.turn('RightUpLeg', rot(0, 0, -6));
  }, 0.42));
  // a limp: the right leg stiff and dragging, the body lurching over the good one
  {
    const w = src.walk.poses, n = w.length;
    const avg = BONES.map((b, i) => avgQ(w, i));
    const poses = w.map((p0, f) => {
      const p = p0.clone(), ph = f / n;
      for (const [b, k] of Object.entries({ ...LEGS(1.45, 1.25), LeftArm: 1.2, RightArm: 0.3 })) {
        const i = BI[b]; const d = avg[i].clone().invert().multiply(p.R[i]); p.R[i].copy(avg[i]).multiply(powQ(d, k));
      }
      // the bad leg barely bends; the hip hitches to swing it
      const iK = BI.RightLeg; p.R[iK].slerp(new THREE.Quaternion(), 0.75);
      const swing = Math.max(0, Math.sin(TAU * (ph + 0.08)));
      p.turn('RightUpLeg', rot(0, 0, -swing * 9));
      p.turn('Hips', rot(0, 0, -swing * 7 + 3));
      p.turn('Spine', rot(4, 0, swing * 12 - 4));
      p.turn('RightArm', rot(0, 0, -6)); // the dead arm hangs
      p.turn('Neck', rot(0, 0, -swing * 6));
      return groundLock(p);
    });
    clips.push({ name: 'limp', loop: true, poses, speed: 0.4 });
  }

  // ── runs, by the feet: each foot's path is laid down (on the ground for its stance, sweeping
  // back at exactly the run's speed; then an arc up behind, through under the hip and out ahead)
  // and the leg is solved onto it. So the stance never slides and the swing never scuffs, and the
  // clip's speed is known: a long stride at a human cadence instead of a whirl of short ones. ──
  const L1 = B[BI.LeftUpLeg].distanceTo(B[BI.LeftLeg]);
  const L2 = B[BI.LeftLeg].distanceTo(B[BI.LeftFoot]);
  const SHIN0 = Math.atan2(B[BI.LeftFoot].z - B[BI.LeftLeg].z, B[BI.LeftLeg].y - B[BI.LeftFoot].y); // the shin's lean at bind
  const HIPJ = B[BI.LeftUpLeg].y - B[BI.Hips].y;                       // hip joint below the hips bone
  const ANK = B[BI.LeftFoot].y, BALL = B[BI.LeftToeBase], BX = BALL.z - B[BI.LeftFoot].z, BY = B[BI.LeftFoot].y - BALL.y;
  /** Thigh, knee and foot (degrees, leg() conventions) putting the ankle at (z ahead of the hip,
   *  y above the ground) for a hip joint at height hip, the foot pitched toe-down by toe (deg). */
  function legTo(z, y, hip, toe) {
    const ty = y - hip, d = Math.min(L1 + L2 - 1e-4, Math.hypot(z, ty));
    const kg = Math.PI - Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2))));
    const th = Math.atan2(z, -ty) + Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d))));
    const thigh = th / D2R, knee = (kg + SHIN0) / D2R;
    return { thigh, knee, foot: thigh - knee + toe };
  }
  /** The ankle on the ground with the foot rolled toe-down by toe (deg) about the ball at bz. */
  const onBall = (bz, toe) => {
    const r = toe * D2R;
    return [bz - BX * Math.cos(r) - BY * Math.sin(r), BALL.y + BY * Math.cos(r) + BX * Math.sin(r)];
  };
  /**
   * A run cycle's legs. o: T (s), ST (stance share), v (m/s), land (ball z ahead of the hip at
   * the strike), hip (keys over the half-stride: [h, height of the hip joint]), swing ([phase, z,
   * y, toe] keys from toe-off to the next strike), roll (toe-down at toe-off).
   * Returns (phase) -> { Left, Right, hip } for leg() and the hips.
   */
  function runLegs(o) {
    const sweep = o.v * o.T * o.ST, b0 = o.land, b1 = o.land - sweep;
    const [z1, y1] = onBall(b1, o.roll), [z0, y0] = onBall(b0, 0);
    const keys = [[o.ST, z1, y1, o.roll], ...o.swing, [1, z0, y0, 0]];
    const sz = seg(keys.map((k) => [k[0], k[1]])), sy = seg(keys.map((k) => [k[0], k[2]])), st = seg(keys.map((k) => [k[0], k[3]]));
    const hipH = cyc(o.hip);
    return (ph) => {
      const hip = hipH((ph * 2) % 1);
      const one = (q) => {
        q = ((q % 1) + 1) % 1;
        if (q < o.ST) {
          const u = q / o.ST, toe = o.roll * Math.pow(Math.max(0, (u - 0.45) / 0.55), 1.6);
          const [z, y] = onBall(b0 + (b1 - b0) * u, toe);
          return legTo(z, y, hip, toe);
        }
        return legTo(sz(q), sy(q), hip, st(q));
      };
      return { Left: one(ph), Right: one(ph + 0.5), hip };
    };
  }
  const setHip = (p, hip) => { p.hips.y = hip - HIPJ; };
  /** Lower (or raise) a whole clip by one amount so its lowest contact over the cycle is on the ground. */
  const settle = (clip) => {
    let low = Infinity;
    for (const p of clip.poses) { const { P } = rig.solve(p); for (const i of contact) low = Math.min(low, P[i].y - B[i].y); }
    for (const p of clip.poses) p.hips.y -= low;
    return clip;
  };

  // ── sprint: the runner. Thrown forward, knees driving, arms clawing ahead ──
  // A short, hard stance (a fifth of the stride) and a flight off both feet: about three steps a
  // second at the runner's pace.
  {
    const T = 0.76;
    const legs = runLegs({
      T, ST: 0.22, v: 5.4, land: 0.62, roll: 40,
      hip: [[0, 0.85], [0.22, 0.815], [0.44, 0.87], [0.72, 0.925]],
      swing: [[0.34, -0.5, 0.5, 30], [0.48, -0.15, 0.6, 22], [0.62, 0.3, 0.46, 8], [0.78, 0.55, 0.22, -6], [0.92, 0.38, 0.09, -4]],
    });
    const nz = loopNoise(7);
    clips.push(settle(loop('sprint', T, (ph) => {
      const p = base();
      const h = (ph * 2) % 1, Lg = legs(ph);
      hips(p, { pitch: 0, yaw: Math.sin(TAU * ph) * 8, roll: Math.sin(TAU * (ph + 0.25)) * 3 });
      setHip(p, Lg.hip);
      leg(p, 'Left', { ...Lg.Left, out: 2 });
      leg(p, 'Right', { ...Lg.Right, out: 2 });
      // the trunk dips into each landing and drives up out of it
      spine(p, { pitch: 44 + Math.cos(TAU * h) * 4, yaw: -Math.sin(TAU * ph) * 18, roll: nz(ph) * 4 });
      head(p, { pitch: -48 + Math.cos(TAU * h + 0.6) * 5, yaw: Math.sin(TAU * ph) * 9 + nz(ph + 0.3) * 6, roll: nz(ph + 0.5) * 8, jaw: 20 + 8 * Math.sin(TAU * h) });
      // arms: swinging hard against the legs, reaching forward on the up-stroke, hands clawed
      const aL = Math.sin(TAU * (ph + 0.5 + 0.06)), aR = Math.sin(TAU * (ph + 0.06));
      arm(p, 'Left', { fwd: 40 + aL * 54, out: 18 + aL * 6, elbow: 74 - aL * 28, twist: 15, wrist: -10, shrug: 8 + aL * 6, reach: aL * 9 });
      arm(p, 'Right', { fwd: 42 + aR * 56, out: 16 + aR * 6, elbow: 70 - aR * 30, twist: 15, wrist: -10, shrug: 8 + aR * 6, reach: aR * 9 });
      return p;
    }, { speed: 5.4 })));
  }

  // ── jog: a shambler that hurries. A lurching, uneven run with hardly any flight, the head
  // hanging, one arm reaching ahead and the other dangling ──
  {
    const T = 0.92;
    const legs = runLegs({
      T, ST: 0.36, v: 2.2, land: 0.5, roll: 28,
      hip: [[0, 0.86], [0.36, 0.83], [0.72, 0.865], [0.86, 0.885]],
      swing: [[0.48, -0.42, 0.3, 22], [0.62, -0.1, 0.38, 14], [0.76, 0.3, 0.24, 2], [0.9, 0.3, 0.1, -4]],
    });
    const nz = loopNoise(13), nz2 = loopNoise(31);
    clips.push(settle(loop('jog', T, (ph) => {
      const p = base();
      const h = (ph * 2) % 1, Lg = legs(ph);
      hips(p, { pitch: 0, yaw: Math.sin(TAU * ph) * 9, roll: Math.sin(TAU * (ph + 0.25)) * 5 + 3 });
      setHip(p, Lg.hip);
      leg(p, 'Left', { ...Lg.Left, out: 4, twist: -4 });
      leg(p, 'Right', { ...Lg.Right, out: 3 });
      spine(p, { pitch: 26 + Math.cos(TAU * h) * 5, yaw: -Math.sin(TAU * ph) * 16, roll: -6 + nz(ph) * 6 });
      head(p, { pitch: -26 + Math.cos(TAU * h + 0.8) * 7 + nz2(ph) * 5, yaw: Math.sin(TAU * ph) * 10 + nz(ph + 0.4) * 10, roll: 10 + nz2(ph + 0.3) * 8, jaw: 16 + 10 * Math.sin(TAU * h) });
      const aL = Math.sin(TAU * (ph + 0.6)), aR = Math.sin(TAU * (ph + 0.1));
      // the left arm reaching out ahead, the right flopping with the run
      arm(p, 'Left', { fwd: 62 + aL * 22, out: 20 + aL * 5, elbow: 34 - aL * 14, twist: 20, wrist: -18, shrug: 10 + aL * 4, reach: 6 + aL * 5 });
      arm(p, 'Right', { fwd: 18 + aR * 38, out: 14, elbow: 40 - aR * 22, twist: 8, wrist: 12 + aR * 10, shrug: 2, reach: aR * 4 });
      return p;
    }, { speed: 2.2 })));
  }

  // ── claw: at the foot of the wall, tearing at the concrete, head up at the men above ──
  {
    const T = 2.6;
    // the left hand strikes high and drags down; the right a beat later; once a loop both slam
    const strokeL = cyc([[0, 0], [0.1, 1], [0.26, 0.15], [0.42, 0.9], [0.56, 0.1], [0.7, 0.55], [0.78, 1], [0.86, 0.2]]);
    const strokeR = cyc([[0, 0.6], [0.14, 0.05], [0.3, 1], [0.46, 0.2], [0.6, 0.95], [0.72, 0.4], [0.8, 1], [0.9, 0.3]]);
    const nz = loopNoise(11), nz2 = loopNoise(23);
    clips.push(loop('claw', T, (ph) => {
      const p = base();
      const sL = strokeL(ph), sR = strokeR(ph);
      const push = 0.5 + 0.5 * Math.sin(TAU * ph * 2 + 1.2); // leaning into it
      hips(p, { pitch: 0, yaw: (sR - sL) * 6, roll: (sL - sR) * 3, z: -0.04 });
      // stance: left foot a little forward, knees soft, the weight rocking
      leg(p, 'Left', { thigh: 14 + push * 4, knee: 20 + push * 8, foot: -4, out: 3 });
      leg(p, 'Right', { thigh: -10 + push * 3, knee: 14 + push * 6, foot: 4, out: 4 });
      spine(p, { pitch: 8 - push * 10, yaw: (sL - sR) * 14, roll: (sR - sL) * 6 + nz(ph) * 3 });
      head(p, { pitch: -34 + nz2(ph) * 8, yaw: nz(ph + 0.4) * 14, roll: nz2(ph + 0.2) * 9, jaw: 10 + 22 * Math.max(0, Math.sin(TAU * ph * 3)) });
      // arms high on the wall: stroke 1 = up and reaching, 0 = dragged down to the chest
      arm(p, 'Left', { fwd: 105 + sL * 52, out: 22 - sL * 8, elbow: 78 - sL * 52, twist: 30, wrist: -24 + sL * 30, shrug: 6 + sL * 16, reach: 4 + sL * 10 });
      arm(p, 'Right', { fwd: 100 + sR * 56, out: 24 - sR * 8, elbow: 82 - sR * 54, twist: 30, wrist: -24 + sR * 30, shrug: 6 + sR * 16, reach: 4 + sR * 10 });
      return groundLock(p);
    }));
  }

  // ── scramble: clambering up the mound of bodies on all fours ──
  {
    const T = 1.5;
    const reachL = cyc([[0, 0], [0.18, 1], [0.38, 0.75], [0.55, 0.1], [0.8, 0]]);
    const thigh = cyc([[0, 20], [0.2, 78], [0.42, 64], [0.65, 22], [0.85, 4]]);
    const knee = cyc([[0, 50], [0.2, 104], [0.42, 92], [0.65, 48], [0.85, 30]]);
    const nz = loopNoise(5);
    clips.push(loop('scramble', T, (ph) => {
      const p = base();
      const L = ph, R = ph + 0.5;
      hips(p, { pitch: 0, yaw: Math.sin(TAU * ph) * 9, roll: Math.sin(TAU * ph) * 5 });
      leg(p, 'Left', { thigh: thigh(R), knee: knee(R), foot: 8, out: 7 });
      leg(p, 'Right', { thigh: thigh(L), knee: knee(L), foot: 8, out: 7 });
      spine(p, { pitch: 52 + Math.sin(TAU * ph * 2) * 5, yaw: -Math.sin(TAU * ph) * 18, roll: nz(ph) * 5 });
      head(p, { pitch: -52 + nz(ph + 0.2) * 6, yaw: Math.sin(TAU * ph) * 10, jaw: 14 + 10 * Math.sin(TAU * ph * 2) });
      const rl = reachL(L), rr = reachL(R);
      // reach up the slope and haul down on whatever is there
      arm(p, 'Left', { fwd: 70 + rl * 70, out: 20, elbow: 70 - rl * 50, twist: 25, wrist: -30 + rl * 20, shrug: rl * 14, reach: rl * 12 });
      arm(p, 'Right', { fwd: 70 + rr * 70, out: 20, elbow: 70 - rr * 50, twist: 25, wrist: -30 + rr * 20, shrug: rr * 14, reach: rr * 12 });
      return groundLock(p);
    }));
  }

  // ── climb: hauling itself over the parapet (one shot, played over the climb) ──
  {
    const k = (keys) => seg(keys);
    const armF = k([[0, 90], [0.14, 168], [0.32, 160], [0.5, 120], [0.66, 70], [0.82, 40], [1, 30]]);
    const elb = k([[0, 40], [0.14, 18], [0.32, 70], [0.5, 112], [0.66, 70], [0.82, 30], [1, 40]]);
    const out = k([[0, 20], [0.14, 18], [0.5, 34], [0.82, 30], [1, 26]]);
    const sp = k([[0, 6], [0.14, -6], [0.32, 4], [0.5, 22], [0.66, 48], [0.82, 56], [1, 40]]);
    const hd = k([[0, -40], [0.14, -48], [0.4, -30], [0.66, -8], [0.86, -24], [1, -30]]);
    const thR = k([[0, 10], [0.2, 0], [0.38, 70], [0.55, 104], [0.72, 96], [1, 92]]);
    const knR = k([[0, 20], [0.2, 12], [0.38, 108], [0.55, 128], [0.72, 120], [1, 118]]);
    const thL = k([[0, 6], [0.3, -10], [0.55, 10], [0.7, 64], [0.86, 98], [1, 96]]);
    const knL = k([[0, 18], [0.3, 30], [0.55, 70], [0.7, 120], [0.86, 126], [1, 122]]);
    const lagR = k([[0, 0], [0.12, 0.06], [0.3, 0], [1, 0]]); // the right hand catches a beat late
    clips.push(once('climb', 2.2, (t) => {
      const p = base();
      hips(p, { yaw: Math.sin(t * 9) * 4 });
      leg(p, 'Left', { thigh: thL(t), knee: knL(t), foot: 12, out: 8 });
      leg(p, 'Right', { thigh: thR(t), knee: knR(t), foot: 12, out: 10 });
      spine(p, { pitch: sp(t), yaw: Math.sin(t * 7) * 8, roll: Math.sin(t * 5) * 4 });
      head(p, { pitch: hd(t), yaw: Math.sin(t * 6 + 1) * 10, jaw: 16 + 12 * Math.sin(t * 13) });
      arm(p, 'Left', { fwd: armF(t), out: out(t), elbow: elb(t), twist: 20, wrist: -20, shrug: 14, reach: 10 });
      const tr = Math.max(0, t - lagR(t) * 2);
      arm(p, 'Right', { fwd: armF(tr), out: out(tr), elbow: elb(tr), twist: 20, wrist: -20, shrug: 14, reach: 10 });
      // (the body's height is the game's: the pose stays on its feet)
      return groundLock(p);
    }));
  }

  // ── perch: crouched on the parapet, looking down into the yard ──
  {
    const nz = loopNoise(31, [1, 2, 3]), nz2 = loopNoise(41, [1, 2, 4]);
    clips.push(loop('perch', 3.0, (ph) => {
      const p = base();
      const br = Math.sin(TAU * ph * 2); // heaving breath
      hips(p, { yaw: nz(ph) * 5 });
      leg(p, 'Left', { thigh: 96, knee: 128, foot: -18, out: 16 });
      leg(p, 'Right', { thigh: 88, knee: 124, foot: -16, out: 18 });
      spine(p, { pitch: 46 + br * 3, yaw: nz(ph + 0.3) * 10, roll: nz2(ph) * 5 });
      // a predator's head: still, then a twitch to a new spot
      const look = Math.round(nz2(ph) * 3) / 3;
      head(p, { pitch: -18 + look * 12, yaw: look * 34 + nz(ph) * 4, roll: nz2(ph + 0.5) * 10, jaw: 8 + 6 * Math.max(0, br) });
      arm(p, 'Left', { fwd: 44, out: 12, elbow: 12, twist: 20, wrist: -50, shrug: 12 + br * 3, reach: 12 });
      arm(p, 'Right', { fwd: 50, out: 14, elbow: 8, twist: 20, wrist: -50, shrug: 12 + br * 3, reach: 12 });
      return groundLock(p);
    }));
  }

  // ── burn: on fire, stumbling, beating at itself, head thrashing ──
  {
    const nz = [3, 4, 9, 12, 17, 19, 25, 27].map((s) => loopNoise(s, [1, 2, 3, 4, 6]));
    const w = exaggerate(src.walk, '_bw', LEGS(1.3, 1.2)).poses;
    clips.push(loop('burn', 2.5, (ph) => {
      const p = w[Math.floor(ph * w.length) % w.length].clone();
      const lurch = nz[0](ph);
      p.turn('Hips', rot(0, nz[1](ph) * 18, lurch * 6));
      spine(p, { pitch: 22 + nz[2](ph) * 16, yaw: nz[3](ph) * 30, roll: lurch * 16 });
      head(p, { pitch: nz[4](ph) * 30 - 10, yaw: nz[5](ph) * 50, roll: nz[6](ph) * 25, jaw: 32 + 10 * Math.sin(TAU * ph * 5) });
      // flailing: arms swinging up over the head and beating down, out of step
      const a = nz[7](ph), b = nz[0](ph + 0.37), c = nz[2](ph + 0.61), d = nz[5](ph + 0.13);
      arm(p, 'Left', { fwd: 90 + a * 80, out: 40 + c * 35, elbow: 70 + b * 50, twist: 20 + d * 30, wrist: c * 30, shrug: 20 + a * 15 });
      arm(p, 'Right', { fwd: 90 + b * 80, out: 40 + d * 35, elbow: 70 + c * 50, twist: 20 + a * 30, wrist: d * 30, shrug: 20 + b * 15 });
      return groundLock(p);
    }));
  }

  // ── thrown: what a blast leaves of the body in the air (two held poses) ──
  {
    const p = base();
    hips(p, { pitch: -10 });
    leg(p, 'Left', { thigh: 30, knee: 70, out: 20, foot: 30 });
    leg(p, 'Right', { thigh: -20, knee: 40, out: 12, foot: 20 });
    spine(p, { pitch: -28, yaw: 14, roll: 10 });
    head(p, { pitch: -40, yaw: 20, roll: 14, jaw: 30 });
    arm(p, 'Left', { fwd: 150, out: 50, elbow: 30, twist: 10 });
    arm(p, 'Right', { fwd: 120, out: 70, elbow: 60, twist: -20 });
    const q = base();
    hips(q, { pitch: 14 });
    leg(q, 'Left', { thigh: 80, knee: 110, out: 10, foot: 30 });
    leg(q, 'Right', { thigh: 50, knee: 90, out: 18, foot: 20 });
    spine(q, { pitch: 40, yaw: -18, roll: -12 });
    head(q, { pitch: 30, yaw: -24, roll: -10, jaw: 24 });
    arm(q, 'Left', { fwd: 30, out: 70, elbow: 90, twist: 30 });
    arm(q, 'Right', { fwd: 70, out: 40, elbow: 110, twist: 20 });
    clips.push({ name: 'thrown', loop: false, poses: [p, q] });
  }
  return clips;
}
