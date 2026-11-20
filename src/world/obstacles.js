// Solid things on the field that walkers go around instead of through: the abandoned
// cars on the road, the trucks, the tank hulk, the downed helicopter, the tanker.
// Each is an oriented box on the ground plane. Movers ask `steer` to bend their
// velocity around whatever is ahead (they slide along it toward the nearer corner,
// and their own goal pulls them round it), then `pushOut` to stay out of it.

const CELL = 12, X0 = -260, Z0 = -460, GW = 44, GZ = 42;
const MARGIN = 2.2; // how far out from a box a walker starts bending round it (m)

const boxes = [];
let grid = null;

/** x, z: centre; yaw: the object's rotation about y (its local +x is its length). */
export function addObstacle(x, z, yaw, halfLen, halfWid, metal = 0) {
  // metal: its height in metres if it is steel a round rings off (wrecks, hedgehogs), else 0
  const b = { x, z, ax: Math.cos(yaw), az: -Math.sin(yaw), hl: halfLen, hw: halfWid, metal };
  boxes.push(b);
  grid = null;
  return b;
}

export function removeObstacle(b) {
  const i = boxes.indexOf(b);
  if (i >= 0) { boxes.splice(i, 1); grid = null; }
}

export function obstacles() { return boxes; }

/**
 * A ray against the steel on the field (the metal obstacles as boxes standing on the ground at
 * their footprint, `metal` metres tall): the nearest t in (0, maxT), or -1. groundAt(x, z) gives
 * the ground under each.
 */
export function rayMetal(o, d, maxT, groundAt) {
  let best = -1;
  for (const b of boxes) {
    if (!b.metal) continue;
    // into the box's frame: u along its length, v across it, y up from the ground under it
    const ox = o.x - b.x, oz = o.z - b.z, gy = groundAt(b.x, b.z);
    const ou = ox * b.ax + oz * b.az, ov = -ox * b.az + oz * b.ax, oy = o.y - gy;
    const du = d.x * b.ax + d.z * b.az, dv = -d.x * b.az + d.z * b.ax, dy = d.y;
    let t0 = 0, t1 = best >= 0 ? best : maxT;
    for (const [p, q, lo, hi] of [[ou, du, -b.hl, b.hl], [ov, dv, -b.hw, b.hw], [oy, dy, -0.3, b.metal]]) {
      if (Math.abs(q) < 1e-9) { if (p < lo || p > hi) { t0 = 1; t1 = 0; break; } continue; }
      let a = (lo - p) / q, c = (hi - p) / q;
      if (a > c) [a, c] = [c, a];
      if (a > t0) t0 = a;
      if (c < t1) t1 = c;
      if (t0 > t1) break;
    }
    if (t0 <= t1 && t0 > 0) best = t0;
  }
  return best;
}

function build() {
  grid = new Array(GW * GZ);
  for (const b of boxes) {
    const R = Math.max(b.hl, b.hw) + MARGIN + 1.5;
    const c0 = Math.max(0, Math.floor((b.x - R - X0) / CELL)), c1 = Math.min(GW - 1, Math.floor((b.x + R - X0) / CELL));
    const r0 = Math.max(0, Math.floor((b.z - R - Z0) / CELL)), r1 = Math.min(GZ - 1, Math.floor((b.z + R - Z0) / CELL));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) (grid[r * GW + c] || (grid[r * GW + c] = [])).push(b);
  }
}

function cell(x, z) {
  if (!boxes.length) return null;
  if (!grid) build();
  const c = Math.floor((x - X0) / CELL), r = Math.floor((z - Z0) / CELL);
  if (c < 0 || c >= GW || r < 0 || r >= GZ) return null;
  return grid[r * GW + c];
}

/** Any obstacle near (x, z)? (cheap early-out for callers) */
export function nearObstacle(x, z) { return !!cell(x, z); }

/**
 * Bend velocity (vx, vz) of a walker of radius r at (x, z) round whatever is ahead.
 * Writes the new velocity (same speed) to out[0], out[1]; returns true if it changed.
 * `bias` (+1 / -1) picks the side to pass on when heading dead-on at a face.
 */
export function steer(x, z, vx, vz, r, out, bias = 1) {
  out[0] = vx; out[1] = vz;
  const list = cell(x, z);
  if (!list) return false;
  const sp = Math.sqrt(vx * vx + vz * vz);
  if (sp < 1e-4) return false;
  let changed = false;
  let ux = vx, uz = vz;
  for (const b of list) {
    const dx = x - b.x, dz = z - b.z;
    const lu = dx * b.ax + dz * b.az, lw = -dx * b.az + dz * b.ax; // local coords (length, width)
    const HL = b.hl + r, HW = b.hw + r;
    // closest point on the (inflated) box, and the way out from it
    const cu = Math.max(-HL, Math.min(HL, lu)), cw = Math.max(-HW, Math.min(HW, lw));
    let eu = lu - cu, ew = lw - cw;
    let d = Math.sqrt(eu * eu + ew * ew);
    if (d > MARGIN) continue;
    if (d < 1e-4) { // inside: out through the nearer face
      if (HL - Math.abs(lu) < HW - Math.abs(lw)) { eu = Math.sign(lu) || 1; ew = 0; } else { eu = 0; ew = Math.sign(lw) || 1; }
      d = 0;
    } else { eu /= d; ew /= d; }
    // the away direction in world space
    const ex = eu * b.ax - ew * b.az, ez = eu * b.az + ew * b.ax;
    const into = ux * ex + uz * ez;
    if (into >= 0) continue; // already moving away / along it
    // slide: tangent along the face, on the side the walker is already drifting to
    let tx = -ez, tz = ex;
    let along = ux * tx + uz * tz;
    if (Math.abs(along) < 0.05 * sp) {
      // dead on at a face: go round the nearer end (away from the box's centre), else the bias
      const off = -(tx * -dx + tz * -dz);
      along = Math.abs(off) > 0.05 ? off : bias;
    }
    if (along < 0) { tx = -tx; tz = -tz; }
    const k = 1 - d / MARGIN; // the closer, the harder it turns
    ux += (-into * ex + -into * tx) * (0.35 + 0.65 * k) + tx * sp * 0.25 * k;
    uz += (-into * ez + -into * tz) * (0.35 + 0.65 * k) + tz * sp * 0.25 * k;
    changed = true;
  }
  if (!changed) return false;
  const l = Math.sqrt(ux * ux + uz * uz) || 1;
  out[0] = ux / l * sp; out[1] = uz / l * sp;
  return true;
}

/** Keep a walker of radius r out of every box. Writes the corrected position to out. */
export function pushOut(x, z, r, out) {
  out[0] = x; out[1] = z;
  const list = cell(x, z);
  if (!list) return false;
  let moved = false;
  for (const b of list) {
    const dx = out[0] - b.x, dz = out[1] - b.z;
    const lu = dx * b.ax + dz * b.az, lw = -dx * b.az + dz * b.ax;
    const HL = b.hl + r, HW = b.hw + r;
    const pu = HL - Math.abs(lu), pw = HW - Math.abs(lw);
    if (pu <= 0 || pw <= 0) continue;
    let nu = lu, nw = lw;
    if (pu < pw) nu = Math.sign(lu || 1) * HL; else nw = Math.sign(lw || 1) * HW;
    out[0] = b.x + nu * b.ax - nw * b.az;
    out[1] = b.z + nu * b.az + nw * b.ax;
    moved = true;
  }
  return moved;
}

const _o = [0, 0];
/**
 * One step for a scripted walker: velocity (vx, vz) for dt, bent round obstacles and kept out
 * of them. Mutates u.x, u.z; returns the velocity actually used in out (for facing).
 */
export function walkStep(u, vx, vz, dt, r = 0.35, out = _o) {
  steer(u.x, u.z, vx, vz, r, out, u.bias || 1);
  const wx = out[0], wz = out[1];
  pushOut(u.x + wx * dt, u.z + wz * dt, r, out);
  u.x = out[0]; u.z = out[1];
  out[0] = wx; out[1] = wz;
  return out;
}
