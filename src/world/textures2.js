// Second batch of procedural textures for the detailed world: turf, rock,
// asphalt, grass blades, rusted/burnt metal, plaster & brick, T-wall
// concrete, bark, and the camera lens dirt used by the post chain.
import * as THREE from 'three';
import { canvas, toTexture, normalFromHeight } from './textures.js';
import { fbmTile, makeRng, clamp } from '../core/util.js';

function imgOf(size) {
  const c = canvas(size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  return { c, ctx, img, d: img.data };
}

// ── Dead, matted turf ────────────────────────────────────────────────────────
export function makeTurfTextures(size = 512) {
  const rng = makeRng(901);
  const c = canvas(size), ctx = c.getContext('2d');
  const hc = canvas(size), hctx = hc.getContext('2d');
  const base = fbmTile(size, 8, 4, 903, 0.55);
  {
    const img = ctx.createImageData(size, size), d = img.data;
    for (let i = 0; i < size * size; i++) {
      const v = base[i];
      d[i * 4] = 44 + v * 30; d[i * 4 + 1] = 38 + v * 24; d[i * 4 + 2] = 26 + v * 14; d[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }
  hctx.fillStyle = '#000'; hctx.fillRect(0, 0, size, size);
  const N = Math.floor(size * size / 9);
  ctx.lineCap = hctx.lineCap = 'round';
  for (let k = 0; k < N; k++) {
    const x = rng() * size, y = rng() * size;
    const a = rng() * Math.PI * 2;
    const len = 4 + rng() * 14 * (size / 512);
    const dx = Math.cos(a) * len, dy = Math.sin(a) * len * 0.6;
    const t = rng();
    // straw, olive, dark rot
    const r = t < 0.5 ? 118 + rng() * 50 : t < 0.8 ? 80 + rng() * 30 : 46 + rng() * 20;
    const g = t < 0.5 ? 100 + rng() * 40 : t < 0.8 ? 80 + rng() * 26 : 40 + rng() * 16;
    const b = t < 0.5 ? 56 + rng() * 30 : t < 0.8 ? 42 + rng() * 14 : 26 + rng() * 10;
    ctx.strokeStyle = `rgba(${r | 0},${g | 0},${b | 0},${0.55 + rng() * 0.45})`;
    ctx.lineWidth = 0.8 + rng() * 1.4;
    const hv = 60 + rng() * 195;
    hctx.strokeStyle = `rgba(${hv | 0},${hv | 0},${hv | 0},0.8)`;
    hctx.lineWidth = ctx.lineWidth;
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      if (x + ox + Math.abs(dx) < -2 || x + ox - Math.abs(dx) > size + 2 || y + oy + Math.abs(dy) < -2 || y + oy - Math.abs(dy) > size + 2) continue;
      ctx.beginPath(); ctx.moveTo(x + ox, y + oy); ctx.quadraticCurveTo(x + ox + dx * 0.5 + dy * 0.2, y + oy + dy * 0.5, x + ox + dx, y + oy + dy); ctx.stroke();
      hctx.beginPath(); hctx.moveTo(x + ox, y + oy); hctx.quadraticCurveTo(x + ox + dx * 0.5 + dy * 0.2, y + oy + dy * 0.5, x + ox + dx, y + oy + dy); hctx.stroke();
    }
  }
  const hd = hctx.getImageData(0, 0, size, size).data;
  const h = new Float32Array(size * size);
  for (let i = 0; i < h.length; i++) h[i] = hd[i * 4] / 255 * 0.7 + base[i] * 0.3;
  return { map: toTexture(c), normalMap: toTexture(normalFromHeight(h, size, 5), { srgb: false }) };
}

// ── Weathered rock ──────────────────────────────────────────────────────────
export function makeRockTextures(size = 512) {
  const big = fbmTile(size, 4, 6, 911, 0.55);
  const mid = fbmTile(size, 12, 4, 913, 0.5);
  const crk = fbmTile(size, 6, 4, 917, 0.5);
  const strata = fbmTile(size, 3, 3, 919, 0.5);
  const lich = fbmTile(size, 24, 3, 923, 0.5);
  const { c, ctx, img, d } = imgOf(size);
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const ridge = 1 - Math.abs(crk[i] * 2 - 1);
    const crack = Math.pow(clamp((ridge - 0.86) * 8, 0, 1), 1.5);
    const band = 0.5 + 0.5 * Math.sin((y / size) * Math.PI * 10 + strata[i] * 9);
    let v = 72 + (big[i] - 0.5) * 60 + (mid[i] - 0.5) * 50 + band * 10;
    v *= 1 - crack * 0.65;
    const l = clamp((lich[i] - 0.62) * 6, 0, 1) * 0.5;
    const j = i * 4;
    d[j] = v * 1.02 * (1 - l) + 82 * l; d[j + 1] = v * (1 - l) + 84 * l; d[j + 2] = v * 0.94 * (1 - l) + 62 * l; d[j + 3] = 255;
    h[i] = big[i] * 0.5 + mid[i] * 0.35 + band * 0.08 - crack * 0.45;
  }
  ctx.putImageData(img, 0, 0);
  return { map: toTexture(c), normalMap: toTexture(normalFromHeight(h, size, 10), { srgb: false }) };
}

// ── Cracked asphalt ─────────────────────────────────────────────────────────
export function makeAsphaltTextures(size = 512) {
  const rng = makeRng(931);
  const big = fbmTile(size, 4, 5, 933, 0.55);
  const fine = fbmTile(size, 96, 2, 937, 0.6);
  const { c, ctx, img, d } = imgOf(size);
  const h = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const agg = fine[i] > 0.62 ? 1 : 0;
    const patchy = clamp((big[i] - 0.58) * 6, 0, 1);
    let v = 42 + (big[i] - 0.5) * 22 + (fine[i] - 0.5) * 30 + agg * 22;
    v = v * (1 - patchy * 0.35);
    const j = i * 4;
    d[j] = v; d[j + 1] = v * 0.99; d[j + 2] = v * 1.02; d[j + 3] = 255;
    h[i] = fine[i] * 0.4 + agg * 0.2 - patchy * 0.15;
  }
  ctx.putImageData(img, 0, 0);
  // cracks: wandering polylines, drawn wrapped
  const hc = canvas(size), hx = hc.getContext('2d');
  hx.fillStyle = '#fff'; hx.fillRect(0, 0, size, size);
  ctx.lineCap = hx.lineCap = 'round';
  for (let k = 0; k < 26; k++) {
    let x = rng() * size, y = rng() * size, a = rng() * Math.PI * 2;
    const n = 20 + Math.floor(rng() * 60);
    const w = 0.8 + rng() * 2.2;
    const pts = [[x, y]];
    for (let s = 0; s < n; s++) { a += (rng() - 0.5) * 0.9; x += Math.cos(a) * 6; y += Math.sin(a) * 6; pts.push([x, y]); }
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      ctx.strokeStyle = 'rgba(8,8,9,0.9)'; ctx.lineWidth = w;
      hx.strokeStyle = 'rgba(0,0,0,1)'; hx.lineWidth = w + 1;
      for (const g of [ctx, hx]) { g.beginPath(); pts.forEach(([px, py], q) => (q ? g.lineTo(px + ox, py + oy) : g.moveTo(px + ox, py + oy))); g.stroke(); }
    }
  }
  const hd = hx.getImageData(0, 0, size, size).data;
  for (let i = 0; i < h.length; i++) h[i] += hd[i * 4] / 255 * 0.5;
  return { map: toTexture(c), normalMap: toTexture(normalFromHeight(h, size, 6), { srgb: false }) };
}

// ── Grass blade cards (alpha) ───────────────────────────────────────────────
export function makeGrassBladeTexture(size = 256) {
  const rng = makeRng(941);
  const c = canvas(size), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  for (let k = 0; k < 46; k++) {
    const x0 = size * (0.08 + rng() * 0.84);
    const hgt = size * (0.45 + rng() * 0.55);
    const bend = (rng() - 0.5) * size * 0.35;
    const w = 2 + rng() * 4;
    const t = rng();
    const r = t < 0.6 ? 150 + rng() * 60 : 95 + rng() * 40;
    const g = t < 0.6 ? 130 + rng() * 45 : 95 + rng() * 30;
    const b = t < 0.6 ? 80 + rng() * 30 : 55 + rng() * 20;
    const grad = ctx.createLinearGradient(0, size, 0, size - hgt);
    grad.addColorStop(0, `rgb(${(r * 0.35) | 0},${(g * 0.33) | 0},${(b * 0.3) | 0})`);
    grad.addColorStop(1, `rgb(${r | 0},${g | 0},${b | 0})`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(x0 - w, size);
    ctx.quadraticCurveTo(x0 + bend * 0.3, size - hgt * 0.5, x0 + bend, size - hgt);
    ctx.quadraticCurveTo(x0 + bend * 0.3 + w * 0.4, size - hgt * 0.5, x0 + w, size);
    ctx.fill();
  }
  const t = toTexture(c, { aniso: 4 });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.premultiplyAlpha = false;
  return t;
}

// ── Burnt / rusted painted metal ────────────────────────────────────────────
export function makeMetalTextures(size = 512) {
  const big = fbmTile(size, 4, 5, 951, 0.6);
  const mid = fbmTile(size, 16, 4, 953, 0.55);
  const fine = fbmTile(size, 64, 2, 957, 0.5);
  const streak = fbmTile(size, 32, 3, 959, 0.5);
  const { c, ctx, img, d } = imgOf(size);
  const rc = canvas(size), rctx = rc.getContext('2d');
  const rimg = rctx.createImageData(size, size), r = rimg.data;
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    // paint survives where noise is high; rust underneath; soot over everything
    const paint = clamp((mid[i] * 0.7 + big[i] * 0.5 - 0.52) * 7, 0, 1);
    const rust = 1 - paint;
    const st = Math.pow(streak[x] * 0.5 + streak[i] * 0.5, 2) * (y / size);
    const soot = clamp((0.5 - big[i]) * 2.5 + st * 0.8, 0, 0.85);
    let R = paint * (78 + fine[i] * 18) + rust * (92 + fine[i] * 50 + mid[i] * 30);
    let G = paint * (80 + fine[i] * 16) + rust * (46 + fine[i] * 26);
    let B = paint * (70 + fine[i] * 14) + rust * (24 + fine[i] * 12);
    R *= 1 - soot; G *= 1 - soot; B *= 1 - soot;
    const j = i * 4;
    d[j] = R; d[j + 1] = G; d[j + 2] = B; d[j + 3] = 255;
    const rough = clamp(paint * 0.55 + rust * 0.92 + soot * 0.1 + (fine[i] - 0.5) * 0.1, 0.25, 1);
    r[j] = 255; r[j + 1] = rough * 255; r[j + 2] = (paint * 0.35 + rust * 0.1) * 255; r[j + 3] = 255;
    h[i] = paint * 0.15 + fine[i] * 0.08 + rust * mid[i] * 0.3;
  }
  ctx.putImageData(img, 0, 0);
  rctx.putImageData(rimg, 0, 0);
  return {
    map: toTexture(c), roughnessMap: toTexture(rc, { srgb: false }),
    normalMap: toTexture(normalFromHeight(h, size, 5), { srgb: false }),
  };
}

// ── Plaster over brick (ruined houses) ──────────────────────────────────────
export function makePlasterTextures(size = 512) {
  const big = fbmTile(size, 4, 5, 961, 0.6);
  const fine = fbmTile(size, 48, 3, 963, 0.5);
  const { c, ctx, img, d } = imgOf(size);
  const h = new Float32Array(size * size);
  const bw = size / 8, bh = size / 24;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const row = Math.floor(y / bh);
    const bx = (x + (row % 2) * bw * 0.5) % bw, by = y % bh;
    const mortar = bx < 2.5 || by < 2.5;
    const exposed = clamp((0.42 - big[i]) * 8, 0, 1);
    const brickTone = 0.8 + 0.2 * Math.sin(row * 12.9 + Math.floor((x + (row % 2) * bw * 0.5) / bw) * 7.1);
    let R = 132 + (fine[i] - 0.5) * 30, G = 126 + (fine[i] - 0.5) * 28, B = 112 + (fine[i] - 0.5) * 24;
    const bR = mortar ? 70 : 112 * brickTone, bG = mortar ? 66 : 54 * brickTone, bB = mortar ? 60 : 38 * brickTone;
    R = R * (1 - exposed) + bR * exposed; G = G * (1 - exposed) + bG * exposed; B = B * (1 - exposed) + bB * exposed;
    const grime = clamp(y / size * 0.4 + (0.5 - big[i]) * 0.6, 0, 0.6);
    const j = i * 4;
    d[j] = R * (1 - grime); d[j + 1] = G * (1 - grime); d[j + 2] = B * (1 - grime); d[j + 3] = 255;
    h[i] = (1 - exposed) * 0.3 + exposed * (mortar ? -0.1 : 0.05) + fine[i] * 0.1;
  }
  ctx.putImageData(img, 0, 0);
  return { map: toTexture(c), normalMap: toTexture(normalFromHeight(h, size, 5), { srgb: false }) };
}

// ── Precast T-wall concrete (one slab per texture width) ────────────────────
export function makeSlabTextures(size = 512) {
  const big = fbmTile(size, 4, 5, 971, 0.55);
  const fine = fbmTile(size, 64, 3, 973, 0.55);
  const pits = fbmTile(size, 128, 1, 977, 0.5);
  const streakN = fbmTile(size, 48, 2, 979, 0.5);
  const { c, ctx, img, d } = imgOf(size);
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const v01 = y / size; // 0 top .. 1 bottom
    const edge = Math.min(x, size - 1 - x) / size;
    const bevel = clamp(edge * 40, 0, 1);
    const st = Math.pow(streakN[x] * 0.65 + streakN[i] * 0.35, 3.2) * (0.3 + v01);
    const rustSt = Math.pow(clamp(streakN[(x * 7) % size] - 0.58, 0, 1) * 3, 2) * clamp(1 - v01 * 1.4, 0, 1);
    const lift = (y > size * 0.06 && y < size * 0.08 && Math.abs(x - size / 2) < size * 0.12) ? 0.5 : 1;
    const pit = pits[i] > 0.78 ? 0.6 : 1;
    let v = (138 + (big[i] - 0.5) * 50 + (fine[i] - 0.5) * 34) * pit * lift;
    v *= 1 - clamp(st * 1.4, 0, 0.6);
    v *= 0.7 + 0.3 * bevel;
    const j = i * 4;
    d[j] = v + rustSt * 40; d[j + 1] = v * 0.98 + rustSt * 8; d[j + 2] = v * 0.95 - rustSt * 10; d[j + 3] = 255;
    h[i] = fine[i] * 0.3 + big[i] * 0.2 - (pit < 1 ? 0.25 : 0) - (1 - bevel) * 0.6;
  }
  ctx.putImageData(img, 0, 0);
  return { map: toTexture(c), normalMap: toTexture(normalFromHeight(h, size, 7), { srgb: false }) };
}

// ── Lens dirt (smudges, specks, a scratch or two) ───────────────────────────
export function makeLensDirtTexture(size = 512) {
  const rng = makeRng(991);
  const c = canvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'lighter';
  // broad smudges
  for (let k = 0; k < 26; k++) {
    const x = rng() * size, y = rng() * size, r = size * (0.05 + rng() * 0.18);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.05 + rng() * 0.09;
    g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(x, y, r, r * (0.5 + rng() * 0.5), rng() * 3, 0, Math.PI * 2); ctx.fill();
  }
  // water spots / dust specks with bright rims
  for (let k = 0; k < 160; k++) {
    const x = rng() * size, y = rng() * size, r = 1 + Math.pow(rng(), 3) * size * 0.03;
    const a = 0.12 + rng() * 0.3;
    const g = ctx.createRadialGradient(x, y, r * 0.4, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${a * 0.35})`); g.addColorStop(0.85, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // fingerprint-ish arcs
  ctx.lineWidth = 1;
  for (let k = 0; k < 3; k++) {
    const x = rng() * size, y = rng() * size;
    for (let r = 4; r < size * 0.07; r += 3) {
      ctx.strokeStyle = `rgba(255,255,255,${0.025 + rng() * 0.02})`;
      ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.8, 0.4, rng(), 2 + rng() * 3); ctx.stroke();
    }
  }
  // scratches
  for (let k = 0; k < 7; k++) {
    ctx.strokeStyle = `rgba(255,255,255,${0.06 + rng() * 0.08})`;
    ctx.lineWidth = 0.6 + rng();
    ctx.beginPath();
    const x = rng() * size, y = rng() * size, a = rng() * 3, l = size * (0.05 + rng() * 0.25);
    ctx.moveTo(x, y); ctx.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + 10, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  const t = toTexture(c, { srgb: false, aniso: 1 });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ── Charred bark ────────────────────────────────────────────────────────────
export function makeBarkTexture(size = 256) {
  const n = fbmTile(size, 8, 4, 981, 0.55);
  const { c, ctx, img, d } = imgOf(size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const fur = 0.5 + 0.5 * Math.sin(x / size * Math.PI * 22 + n[i] * 8);
    const v = 18 + fur * 22 + n[i] * 14;
    const ember = 0; void ember;
    const j = i * 4;
    d[j] = v * 1.05; d[j + 1] = v * 0.92; d[j + 2] = v * 0.8; d[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c);
}

// ── HESCO bastion: wire mesh over a geotextile liner bulging with earth ──────
export function makeHescoTextures(size = 256) {
  const n = fbmTile(size, 8, 4, 1001, 0.55);
  const f = fbmTile(size, 32, 2, 1003, 0.5);
  const { c, ctx, img, d } = imgOf(size);
  const h = new Float32Array(size * size);
  const cell = size / 8;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const cx = (x % cell) / cell - 0.5, cy = (y % cell) / cell - 0.5;
    const bulge = 1 - (cx * cx + cy * cy) * 2.2;
    const wire = (x % cell < 2 || y % cell < 2) ? 1 : 0;
    let R = 118 + n[i] * 40 + f[i] * 16, G = 110 + n[i] * 34 + f[i] * 14, B = 86 + n[i] * 24;
    const dirt = clamp((y / size) * 0.5 + (0.5 - n[i]) * 0.8, 0, 0.7);
    R *= 1 - dirt * 0.6; G *= 1 - dirt * 0.62; B *= 1 - dirt * 0.65;
    if (wire) { R = 70; G = 68; B = 64; }
    const j = i * 4;
    d[j] = R * (0.75 + bulge * 0.25); d[j + 1] = G * (0.75 + bulge * 0.25); d[j + 2] = B * (0.75 + bulge * 0.25); d[j + 3] = 255;
    h[i] = bulge * 0.5 + f[i] * 0.15 + (wire ? 0.4 : 0);
  }
  ctx.putImageData(img, 0, 0);
  return { map: toTexture(c), normalMap: toTexture(normalFromHeight(h, size, 4), { srgb: false }) };
}

// ── Duckboard planks ────────────────────────────────────────────────────────
export function makePlankTextures(size = 256) {
  const n = fbmTile(size, 4, 4, 1011, 0.5);
  const g = fbmTile(size, 64, 2, 1013, 0.5);
  const { c, ctx, img, d } = imgOf(size);
  const h = new Float32Array(size * size);
  const pw = size / 6;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const plank = Math.floor(x / pw);
    const gap = x % pw < 2 ? 1 : 0;
    const tone = 0.75 + 0.25 * Math.sin(plank * 17.3);
    const grain = 0.85 + 0.15 * Math.sin(y * 0.25 + g[i] * 6 + plank * 3);
    const v = (60 + n[i] * 40) * tone * grain * (gap ? 0.25 : 1);
    const j = i * 4;
    d[j] = v * 1.1; d[j + 1] = v * 0.92; d[j + 2] = v * 0.72; d[j + 3] = 255;
    h[i] = gap ? 0 : 0.5 + grain * 0.2;
  }
  ctx.putImageData(img, 0, 0);
  return { map: toTexture(c), normalMap: toTexture(normalFromHeight(h, size, 3), { srgb: false }) };
}

// ── Corrugated steel (containers, sheds) ────────────────────────────────────
export function makeCorrugatedTextures(size = 256) {
  const n = fbmTile(size, 8, 4, 1021, 0.55);
  const { c, ctx, img, d } = imgOf(size);
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const wave = Math.sin(x / size * Math.PI * 2 * 12);
    const rust = clamp((n[i] - 0.55) * 4 + (y / size) * 0.4, 0, 1);
    const v = 150 + wave * 14;
    const j = i * 4;
    d[j] = v * (1 - rust) + 110 * rust; d[j + 1] = v * (1 - rust) + 58 * rust; d[j + 2] = v * (1 - rust) + 30 * rust; d[j + 3] = 255;
    h[i] = wave * 0.5 + 0.5;
  }
  ctx.putImageData(img, 0, 0);
  return { map: toTexture(c), normalMap: toTexture(normalFromHeight(h, size, 2.5), { srgb: false }) };
}
