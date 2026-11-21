// Helicopter flight for the cutscenes. A path is keyframes (time, position, and where
// the nose should point when it is slow); between them it is a smooth Hermite curve.
// The attitude is not keyframed: it comes from the motion, the way a real helicopter
// flies. It tilts its rotor (and so the whole airframe) toward where it accelerates:
// nose down to speed up and to hold speed against the drag, nose up to slow down
// (the flare before a landing), and banked into a turn by exactly the angle the turn
// needs (tan bank = sideways acceleration / g). Fast, it points along its track; slow,
// it turns to the heading the keys ask for (a pedal turn in the hover). Then the
// attitude is eased, because a heavy airframe never snaps from one to the other.
import * as THREE from 'three';

const G = 9.81;
const H = 0.18; // seconds either side for the finite differences
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class FlightPath {
  /** smooth: seconds either side the flown curve is averaged over (0: through the keys exactly). */
  constructor(smooth = 0) { this.keys = []; this.smooth = smooth; }

  /** A key at time t: position (x, y, z); face: the heading wanted when slow (rad, 0 = +z), or null. */
  add(t, x, y, z, face = null) {
    this.keys.push({ t, p: new THREE.Vector3(x, y, z), face });
    this.keys.sort((a, b) => a.t - b.t);
    this.tan = null; this.holds = null;
    return this;
  }

  /** A key it stops at (zero velocity there: a hover, a touchdown). */
  hold(t, x, y, z, face = null) {
    this.add(t, x, y, z, face);
    this.keys.find((k) => k.t === t).hold = true;
    this.holds = null;
    return this;
  }

  get start() { return this.keys.length ? this.keys[0].t : 0; }
  get end() { return this.keys.length ? this.keys[this.keys.length - 1].t : 0; }

  /** Catmull-Rom tangents for uneven key spacing (one-sided at the two ends: it flies in and on; zero at a hold). */
  tangents() {
    const K = this.keys;
    this.tan = K.map((k, i) => {
      if (k.hold) return new THREE.Vector3();
      const a = K[Math.max(0, i - 1)], b = K[Math.min(K.length - 1, i + 1)];
      if (a === b || b.t === a.t) return new THREE.Vector3();
      return b.p.clone().sub(a.p).multiplyScalar(1 / (b.t - a.t));
    });
    return this.tan;
  }

  pos(t, out) {
    const K = this.keys;
    if (!K.length) return out.set(0, -999, 0);
    const T = this.tan || this.tangents();
    // past either end: straight on at the end's velocity. (Held still there, the attitude's
    // differences on the first frame saw it stopped a moment ago: a huge acceleration, and
    // the airframe snapped 23 degrees nose-up as it appeared; at the last, a dead stop.)
    if (t <= K[0].t) return out.copy(K[0].p).addScaledVector(T[0], t - K[0].t);
    if (t >= K[K.length - 1].t) return out.copy(K[K.length - 1].p).addScaledVector(T[K.length - 1], t - K[K.length - 1].t);
    let i = 0;
    while (i < K.length - 2 && t > K[i + 1].t) i++;
    const a = K[i], b = K[i + 1], h = b.t - a.t, u = (t - a.t) / h;
    const u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    return out.set(
      h00 * a.p.x + h10 * h * T[i].x + h01 * b.p.x + h11 * h * T[i + 1].x,
      h00 * a.p.y + h10 * h * T[i].y + h01 * b.p.y + h11 * h * T[i + 1].y,
      h00 * a.p.z + h10 * h * T[i].z + h01 * b.p.z + h11 * h * T[i + 1].z,
    );
  }

  /**
   * The position the airframe flies at t: the curve averaged over a moving window of
   * `this.smooth` seconds either side (a Gaussian), so the acceleration, and with it the
   * bank and pitch, never steps where one key hands over to the next. The window closes up
   * toward a hold (the airframe still arrives exactly on a touchdown or a hover).
   */
  at(t, out) {
    const S = this.smooth || 0;
    if (S <= 0) return this.pos(t, out);
    if (!this.holds) this.holds = this.keys.filter((k) => k.hold).map((k) => k.t);
    let w = S;
    for (const h of this.holds) w = Math.min(w, Math.abs(t - h) * 0.5);
    if (w < 1e-3) return this.pos(t, out);
    const N = 6; // samples either side; the weights are a Gaussian of sigma w / 2
    out.set(0, 0, 0);
    let sum = 0;
    for (let i = -N; i <= N; i++) {
      const u = i / N, k = Math.exp(-2 * u * u);
      this.pos(t + u * w, _p);
      out.addScaledVector(_p, k);
      sum += k;
    }
    return out.multiplyScalar(1 / sum);
  }

  /** The heading the keys ask for at t (the last key at or before t that has one), or null. */
  face(t) {
    let f = null;
    for (const k of this.keys) { if (k.t > t) break; if (k.face !== null) f = k.face; }
    return f;
  }
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _p = new THREE.Vector3();

/** The airframe's attitude as it flies a path: yaw, pitch (+ nose down), roll (+ port side up). */
export class Attitude {
  /**
   * opts: drag (how far it leans to hold speed), turn (how hard it eases toward the wanted
   * attitude, per second), fastYaw (speed above which it points along its track), pitch0
   * (its attitude in the hover: a lifter sits a touch nose-up), maxBank.
   */
  constructor(opts = {}) {
    // (rates in rad/s: how fast the airframe can actually swing, however hard the path asks)
    this.o = { drag: 0.0009, turn: 2.6, yawTurn: 1.6, fastYaw: 9, pitch0: 0, maxBank: 0.85, maxPitch: 0.4, yawRate: 0.9, pitchRate: 0.35, rollRate: 0.6, ...opts };
    this.yaw = 0; this.pitch = 0; this.roll = 0;
    this.vel = new THREE.Vector3(); this.acc = new THREE.Vector3(); this.pos = new THREE.Vector3();
    this.ready = false;
  }

  /** Place the airframe at time t on the path (call every frame with the frame's dt). */
  update(path, t, dt) {
    const o = this.o;
    path.at(t - H, _a); path.at(t, this.pos); path.at(t + H, _b);
    this.vel.subVectors(_b, _a).multiplyScalar(1 / (2 * H));
    this.acc.copy(_b).add(_a).addScaledVector(this.pos, -2).multiplyScalar(1 / (H * H));
    const sp = Math.hypot(this.vel.x, this.vel.z);
    // heading: along the track when fast, the keyed heading when slow
    const track = Math.atan2(this.vel.x, this.vel.z), want = path.face(t);
    let yawT;
    if (want === null) yawT = sp > 1.5 ? track : this.yaw;
    else {
      const k = Math.min(1, Math.max(0, (sp - 3) / (o.fastYaw - 3)));
      yawT = want + wrap(track - want) * (sp > 1.5 ? k : 0);
    }
    if (!this.ready) { this.yaw = yawT; }
    const step = (d, rate) => Math.max(-rate * dt, Math.min(rate * dt, d));
    this.yaw += step(wrap(yawT - this.yaw) * (1 - Math.exp(-o.yawTurn * dt)), o.yawRate);
    // the rotor's tilt: forward and sideways acceleration in the airframe's frame, plus the drag it leans against
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);  // nose
    const lx = fz, lz = -fx;                                 // port (+x of the model)
    const vf = this.vel.x * fx + this.vel.z * fz;
    const af = this.acc.x * fx + this.acc.z * fz + o.drag * vf * Math.abs(vf);
    const al = this.acc.x * lx + this.acc.z * lz;
    const lift = G + this.acc.y; // climbing hard loads the disc: the same tilt does less
    const pitchT = Math.max(-o.maxPitch, Math.min(o.maxPitch, Math.atan2(af, Math.max(4, lift)) + o.pitch0));
    const rollT = Math.max(-o.maxBank, Math.min(o.maxBank, -Math.atan2(al, Math.max(4, lift))));
    if (!this.ready) { this.pitch = pitchT; this.roll = rollT; this.ready = true; }
    const e = 1 - Math.exp(-o.turn * dt);
    this.pitch += step((pitchT - this.pitch) * e, o.pitchRate);
    this.roll += step((rollT - this.roll) * e, o.rollRate);
    return this;
  }

  /** Put a group where the path says, turned as the airframe is (nose +z, up +y). */
  apply(group, t, bob = 0) {
    group.position.copy(this.pos);
    // a little air under it: never quite still
    group.rotation.set(this.pitch + Math.sin(t * 1.3 + bob) * 0.008, this.yaw, this.roll + Math.sin(t * 1.7 + bob * 2) * 0.01, 'YXZ');
    group.updateMatrixWorld();
  }

  /** Unit vectors of the airframe (world): nose and port, flattened. */
  axes(fwd, side) {
    fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    side.set(fwd.z, 0, -fwd.x);
  }
}

/** A seconds-long racetrack sampled into keys: legs at x = inner and outer, turns of radius r between them. */
export function racetrack(path, { t0, t1, side, inner, outer, zNear, zFar, alt, speed, turnSpeed, dt = 0.5 }) {
  // the loop, as a list of [x, z, y, speed] points every metre or so; attack leg first (heading -z)
  const pts = [];
  const r = (outer - inner) / 2, cx = side * (inner + r);
  const leg = (x, za, zb, ya, yb) => { const n = Math.ceil(Math.abs(zb - za)); for (let i = 0; i < n; i++) { const u = i / n; pts.push([x, za + (zb - za) * u, ya + (yb - ya) * u, speed]); } };
  const arc = (zc, a0, a1, y) => { const n = Math.ceil(Math.abs(a1 - a0) * r); for (let i = 0; i < n; i++) { const a = a0 + (a1 - a0) * i / n; pts.push([cx + Math.cos(a) * r, zc + Math.sin(a) * r, y, turnSpeed]); } };
  const xi = side * inner, xo = side * outer;
  leg(xi, zNear, zFar, alt[0], alt[1]);                              // the run in: down onto them, firing
  // break outward at the far end, back up the outside
  arc(zFar, side > 0 ? Math.PI : 0, side > 0 ? 2 * Math.PI : -Math.PI, alt[1] + 4);
  leg(xo, zFar, zNear, alt[1] + 6, alt[2]);
  arc(zNear, side > 0 ? 0 : Math.PI, side > 0 ? Math.PI : 0, alt[2]);
  // the speed eased between the legs and the turns (over ~40 m each way, round the loop):
  // a step in speed is a jolt of the nose up and down
  const W = 40, sp0 = pts.map((p) => p[3]), N = pts.length;
  for (let i = 0; i < N; i++) { let a = 0; for (let j = -W; j <= W; j++) a += sp0[(i + j + N) % N]; pts[i][3] = a / (2 * W + 1); }
  // arc-length timing, then keys every dt
  const tt = [0];
  for (let i = 1; i < pts.length; i++) tt.push(tt[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) / pts[i][3]);
  const loopT = tt[tt.length - 1] + 1 / speed;
  // fit a whole number of loops into [t0, t1]: the speed scales a little to land on the start point
  const loops = Math.max(1, Math.round((t1 - t0) / loopT)), sc = (t1 - t0) / (loops * loopT);
  let j = 0;
  for (let t = t0; t <= t1 + 1e-6; t += dt) {
    const lt = ((t - t0) / sc) % loopT;
    while (j < tt.length - 1 && tt[j + 1] < lt) j++;
    if (tt[j] > lt) j = 0;
    while (j < tt.length - 1 && tt[j + 1] < lt) j++;
    const p = pts[j], q = pts[Math.min(pts.length - 1, j + 1)], u = q === p ? 0 : Math.min(1, (lt - tt[j]) / Math.max(1e-4, tt[j + 1] - tt[j]));
    path.add(t, p[0] + (q[0] - p[0]) * u, p[2] + (q[2] - p[2]) * u, p[1] + (q[1] - p[1]) * u);
  }
  return { loopT: loopT * sc, loops };
}
