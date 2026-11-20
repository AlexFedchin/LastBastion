// People in a crowd keep out of each other. Each looks a little way ahead along where it is
// going: someone in its path makes it ease off to their pace (keeping a step behind) and edge
// round them on the side it is already on; anyone at its shoulder pushes it away. After the
// step, `crowdResolve` lets no two stand inside each other.
//
// Agents are plain objects with x, z (and bias +1/-1, the side to pass on when dead behind);
// crowdSteer records each one's velocity on it (vx, vz) for the others to read.

const _out = [0, 0];

/**
 * The velocity agent u should use instead of (vx, vz), given the others in `list`
 * (an array; entries with skip(o) true are ignored). opts: r (body radius), look (how far ahead
 * it watches), side (0..1: how freely it steps aside: 0 for a single file, e.g. up a ramp).
 * Returns a shared [vx, vz] array (copy it if kept).
 */
export function crowdSteer(list, u, vx, vz, opts = {}, skip = null) {
  const r = opts.r ?? 0.34, look = opts.look ?? 2.6, side = opts.side ?? 1;
  const sp = Math.hypot(vx, vz);
  _out[0] = vx; _out[1] = vz;
  if (sp < 1e-4) { u.vx = 0; u.vz = 0; return _out; }
  const fx = vx / sp, fz = vz / sp;
  let fwd = sp, lat = 0, px = 0, pz = 0;
  const reach = look + 2 * r + 0.5, contact = 2 * r;
  for (const o of list) {
    if (o === u || (skip && skip(o))) continue;
    const dx = o.x - u.x, dz = o.z - u.z;
    if (Math.abs(dx) > reach || Math.abs(dz) > reach) continue;
    const d = Math.hypot(dx, dz);
    if (d > reach) continue;
    const ahead = dx * fx + dz * fz, off = -dx * fz + dz * fx; // along the way it is going, and to its left (+)
    // in its path: ease off to their pace a step behind them, and edge round them
    if (ahead > 0 && ahead < look && Math.abs(off) < contact + 0.3) {
      const w = 1 - ahead / look;
      const theirs = Math.max(0, (o.vx || 0) * fx + (o.vz || 0) * fz);
      const room = Math.max(0, ahead - contact - 0.15);
      fwd = Math.min(fwd, theirs + room * 1.8);
      const away = Math.abs(off) > 0.04 ? -Math.sign(off) : (u.bias || 1);
      lat += away * sp * (0.25 + 0.75 * w) * side;
    }
    // at its shoulder: pushed apart
    if (d < contact + 0.35 && d > 1e-4) {
      const k = (contact + 0.35 - d) / 0.35;
      px -= dx / d * k * 1.6; pz -= dz / d * k * 1.6;
    }
  }
  // (its left is (-fz, fx))
  vx = fx * fwd + -fz * lat + px;
  vz = fz * fwd + fx * lat + pz;
  // never faster than it would go alone
  const l = Math.hypot(vx, vz);
  if (l > sp) { vx *= sp / l; vz *= sp / l; }
  u.vx = vx; u.vz = vz;
  _out[0] = vx; _out[1] = vz;
  return _out;
}

/** Push apart any two closer than 2r (each half the overlap); skip(o) true leaves o out. */
export function crowdResolve(list, r = 0.34, skip = null, iters = 2) {
  const c = 2 * r;
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (skip && skip(a)) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (skip && skip(b)) continue;
        const dx = b.x - a.x, dz = b.z - a.z;
        if (Math.abs(dx) >= c || Math.abs(dz) >= c) continue;
        const d = Math.hypot(dx, dz);
        if (d >= c) continue;
        const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0, h = (c - d) / 2;
        a.x -= nx * h; a.z -= nz * h;
        b.x += nx * h; b.z += nz * h;
      }
    }
  }
}
