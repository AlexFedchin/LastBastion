// Small math helpers shared everywhere.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const chance = (p) => Math.random() < p;
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));
export const TAU = Math.PI * 2;

// Gaussian-ish random in [-1,1]
export const randn = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;

// Seeded PRNG (mulberry32)
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Tileable fractal value noise into a Float32Array (size x size), values ~[0,1].
export function fbmTile(size, baseCells, octaves, seed = 1, persistence = 0.5) {
  const rng = makeRng(seed);
  const out = new Float32Array(size * size);
  let amp = 1, total = 0, cells = baseCells;
  for (let o = 0; o < octaves; o++) {
    const grid = new Float32Array(cells * cells);
    for (let i = 0; i < grid.length; i++) grid[i] = rng();
    const scale = cells / size;
    for (let y = 0; y < size; y++) {
      const gy = y * scale;
      const y0 = Math.floor(gy), fy = gy - y0;
      const sy = fy * fy * (3 - 2 * fy);
      const r0 = (y0 % cells) * cells, r1 = ((y0 + 1) % cells) * cells;
      for (let x = 0; x < size; x++) {
        const gx = x * scale;
        const x0 = Math.floor(gx), fx = gx - x0;
        const sx = fx * fx * (3 - 2 * fx);
        const c0 = x0 % cells, c1 = (x0 + 1) % cells;
        const a = grid[r0 + c0], b = grid[r0 + c1], c = grid[r1 + c0], d = grid[r1 + c1];
        out[y * size + x] += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
      }
    }
    total += amp;
    amp *= persistence;
    cells *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

export function formatInt(n) {
  return Math.floor(n).toLocaleString('en-US');
}

export function formatTime(sec) {
  sec = Math.max(0, Math.ceil(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Vertical FOV for the current aspect. `vfov` is the design FOV at 16:9;
 * wider screens get more horizontal view (Hor+) up to `maxH` degrees, after
 * which the vertical FOV tightens so ultrawides don't fish-eye at the edges.
 */
export function fitFov(vfov, aspect, maxH = 106) {
  const r = Math.PI / 180;
  const t = Math.tan(vfov * r / 2);
  if (aspect <= 16 / 9) return vfov;
  const tH = Math.min(t * aspect, Math.tan(maxH * r / 2));
  return 2 * Math.atan(tH / aspect) / r;
}
