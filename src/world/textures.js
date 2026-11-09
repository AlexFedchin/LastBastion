// Procedural textures. No asset files: everything is painted at startup.
import * as THREE from 'three';
import { fbmTile, makeRng, clamp } from '../core/util.js';

export function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

export function toTexture(c, { srgb = true, repeat = 1, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

/** Height field -> tangent-space normal map canvas. */
export function normalFromHeight(h, size, strength) {
  const c = canvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    const yu = ((y - 1 + size) % size) * size, yd = ((y + 1) % size) * size, yr = y * size;
    for (let x = 0; x < size; x++) {
      const xl = (x - 1 + size) % size, xr = (x + 1) % size;
      const dx = (h[yr + xr] - h[yr + xl]) * strength;
      const dy = (h[yd + x] - h[yu + x]) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (yr + x) * 4;
      d[i] = (-dx * inv * 0.5 + 0.5) * 255;
      d[i + 1] = (dy * inv * 0.5 + 0.5) * 255;
      d[i + 2] = (inv * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// ── Ground: churned, wet mud ────────────────────────────────────────────────
export function makeGroundTextures(size = 1024) {
  const big = fbmTile(size, 4, 5, 11, 0.55);
  const mid = fbmTile(size, 16, 4, 23, 0.5);
  const fine = fbmTile(size, 64, 3, 37, 0.5);
  const ruts = fbmTile(size, 8, 3, 51, 0.6);
  const height = new Float32Array(size * size);

  const ca = canvas(size), cr = canvas(size);
  const actx = ca.getContext('2d'), rctx = cr.getContext('2d');
  const aimg = actx.createImageData(size, size), rimg = rctx.createImageData(size, size);
  const a = aimg.data, r = rimg.data;

  for (let i = 0; i < size * size; i++) {
    const b = big[i], m = mid[i], f = fine[i];
    // puddles in low areas
    const puddle = clamp((0.36 - b) * 9 + (0.5 - m) * 1.2, 0, 1);
    const grass = clamp((m - 0.6) * 5, 0, 1) * clamp((b - 0.45) * 4, 0, 1);
    const rut = Math.pow(Math.abs(Math.sin(ruts[i] * 18)), 6) * 0.6;
    let R = 70 + (m - 0.5) * 60 + (f - 0.5) * 50;
    let G = 63 + (m - 0.5) * 52 + (f - 0.5) * 44;
    let B = 56 + (m - 0.5) * 40 + (f - 0.5) * 36;
    // olive dead grass
    R = R * (1 - grass) + (66 + f * 30) * grass;
    G = G * (1 - grass) + (66 + f * 30) * grass;
    B = B * (1 - grass) + (40 + f * 16) * grass;
    // ruts darker
    R *= 1 - rut * 0.35; G *= 1 - rut * 0.35; B *= 1 - rut * 0.32;
    // wet puddles: dark, slightly blue
    const w = puddle;
    R = R * (1 - w * 0.7); G = G * (1 - w * 0.68); B = B * (1 - w * 0.6);
    const j = i * 4;
    a[j] = R; a[j + 1] = G; a[j + 2] = B; a[j + 3] = 255;
    const rough = clamp(0.92 - w * 0.86 - (0.5 - f) * 0.08 - rut * 0.15, 0.05, 1);
    r[j] = 255; r[j + 1] = rough * 255; r[j + 2] = 0; r[j + 3] = 255;
    height[i] = b * 0.4 + m * 0.4 + f * 0.25 - w * 0.25 - rut * 0.2;
  }
  actx.putImageData(aimg, 0, 0);
  rctx.putImageData(rimg, 0, 0);
  const n = normalFromHeight(height, size, 9);
  return {
    map: toTexture(ca, { repeat: 1 }),
    roughnessMap: toTexture(cr, { srgb: false }),
    normalMap: toTexture(n, { srgb: false }),
  };
}

// ── Concrete with rain streaks and scorch ───────────────────────────────────
export function makeConcreteTextures(size = 512) {
  const big = fbmTile(size, 4, 5, 101, 0.55);
  const fine = fbmTile(size, 48, 3, 103, 0.5);
  const streakN = fbmTile(size, 32, 2, 107, 0.5);
  const height = new Float32Array(size * size);
  const ca = canvas(size), ctx = ca.getContext('2d');
  const img = ctx.createImageData(size, size), d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const streak = Math.pow(streakN[(x % size)] * 0.6 + streakN[i] * 0.4, 3) * (y / size);
      const panel = (x % 128 < 2 || y % 256 < 2) ? 0.55 : 1; // formwork seams
      let v = 120 + (big[i] - 0.5) * 70 + (fine[i] - 0.5) * 40;
      v *= panel;
      v *= 1 - clamp(streak * 1.6, 0, 0.55);
      const grime = clamp((0.45 - big[i]) * 3, 0, 1) * 0.4;
      const j = i * 4;
      d[j] = v * (1 - grime * 0.4);
      d[j + 1] = v * (1 - grime * 0.45);
      d[j + 2] = v * (1 - grime * 0.5) * 1.02;
      d[j + 3] = 255;
      height[i] = fine[i] * 0.6 + big[i] * 0.4 - (panel < 1 ? 0.3 : 0);
    }
  }
  ctx.putImageData(img, 0, 0);
  return { map: toTexture(ca), normalMap: toTexture(normalFromHeight(height, size, 6), { srgb: false }) };
}

// ── Burlap for sandbags ─────────────────────────────────────────────────────
export function makeBurlapTexture(size = 256) {
  const n = fbmTile(size, 8, 3, 211, 0.5);
  const c = canvas(size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size), d = img.data;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const weave = 0.85 + 0.15 * Math.sin(x * 1.6) * Math.sin(y * 1.6);
    const v = (90 + n[i] * 60) * weave;
    const j = i * 4;
    d[j] = v * 1.05; d[j + 1] = v * 0.95; d[j + 2] = v * 0.72; d[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c);
}

// ── Particle atlas (4x4) ────────────────────────────────────────────────────
// 0 soft glow · 1 spark · 2-5 smoke · 6-9 fire · 10-11 blood · 12 star flash
// 13 ring · 14 dirt clump · 15 streak
export const PF = { GLOW: 0, SPARK: 1, SMOKE: 2, FIRE: 6, BLOOD: 10, STAR: 12, RING: 13, DIRT: 14, STREAK: 15 };

export function makeParticleAtlas(cell = 128) {
  const size = cell * 4;
  const c = canvas(size), ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  const rng = makeRng(77);

  const cellImage = (fn, seed) => {
    const img = ctx.createImageData(cell, cell);
    const d = img.data;
    const n = fbmTile(cell, 4, 5, seed, 0.55);
    const n2 = fbmTile(cell, 8, 3, seed + 1, 0.5);
    for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
      const u = (x + 0.5) / cell * 2 - 1, v = (y + 0.5) / cell * 2 - 1;
      const i = y * cell + x;
      const [R, G, B, A] = fn(u, v, n[i], n2[i]);
      const j = i * 4;
      d[j] = R * 255; d[j + 1] = G * 255; d[j + 2] = B * 255; d[j + 3] = clamp(A, 0, 1) * 255;
    }
    return img;
  };
  const put = (idx, img) => ctx.putImageData(img, (idx % 4) * cell, Math.floor(idx / 4) * cell);

  // 0 soft glow
  put(0, cellImage((u, v) => { const r = Math.sqrt(u * u + v * v); const a = Math.pow(clamp(1 - r, 0, 1), 2.2); return [1, 1, 1, a]; }, 1));
  // 1 spark (tight core)
  put(1, cellImage((u, v) => { const r = Math.sqrt(u * u + v * v); const a = Math.exp(-r * r * 18) + 0.25 * Math.pow(clamp(1 - r, 0, 1), 3); return [1, 1, 1, a]; }, 2));
  // 2-5 smoke puffs
  for (let k = 0; k < 4; k++) {
    put(2 + k, cellImage((u, v, n, n2) => {
      const r = Math.sqrt(u * u + v * v);
      const edge = clamp(1 - r * (0.85 + (n - 0.5) * 0.9), 0, 1);
      const a = Math.pow(edge, 1.4) * (0.55 + n2 * 0.6);
      const shade = 0.75 + n * 0.35 - v * 0.12;
      return [shade, shade, shade, a];
    }, 300 + k * 7));
  }
  // 6-9 fire lobes
  for (let k = 0; k < 4; k++) {
    put(6 + k, cellImage((u, v, n, n2) => {
      const r = Math.sqrt(u * u * 1.2 + (v + 0.1) * (v + 0.1) * 0.9);
      const lick = clamp(1 - r * (0.9 + (n - 0.5) * 1.6) - Math.max(0, -v) * n2 * 0.5, 0, 1);
      const core = Math.pow(lick, 0.8);
      return [1, 0.85 * core + 0.15, 0.6 * core * core, Math.pow(lick, 1.2)];
    }, 400 + k * 13));
  }
  // 10-11 blood droplets / mist
  for (let k = 0; k < 2; k++) {
    put(10 + k, cellImage((u, v, n, n2) => {
      const r = Math.sqrt(u * u + v * v);
      const blob = clamp(1 - r * (1.1 + (n - 0.5) * 1.8), 0, 1);
      const a = k === 0 ? Math.pow(blob, 0.6) : Math.pow(blob, 1.5) * (0.4 + n2 * 0.6);
      return [0.55 + n * 0.2, 0.03, 0.02, a];
    }, 500 + k * 3));
  }
  // 12 star flash (muzzle)
  put(12, cellImage((u, v, n) => {
    const r = Math.sqrt(u * u + v * v), ang = Math.atan2(v, u);
    const spikes = Math.pow(Math.abs(Math.cos(ang * 3 + n)), 12) * clamp(1 - r, 0, 1);
    const core = Math.exp(-r * r * 10);
    return [1, 0.9, 0.7, clamp(core + spikes * 1.2 + Math.pow(clamp(1 - r, 0, 1), 3) * 0.4, 0, 1)];
  }, 12));
  // 13 ring
  put(13, cellImage((u, v) => { const r = Math.sqrt(u * u + v * v); const a = Math.exp(-Math.pow((r - 0.75) * 9, 2)); return [1, 1, 1, a]; }, 13));
  // 14 dirt clump
  put(14, cellImage((u, v, n) => { const r = Math.sqrt(u * u + v * v); const a = clamp(1 - r * (1.2 + (n - 0.5) * 2.5), 0, 1); return [0.45 + n * 0.2, 0.38 + n * 0.15, 0.3, Math.pow(a, 0.5)]; }, 14));
  // 15 streak (vertical)
  put(15, cellImage((u, v) => { const a = Math.exp(-u * u * 40) * clamp(1 - Math.abs(v), 0, 1); return [1, 1, 1, a]; }, 15));

  void rng;
  const t = toTexture(c, { srgb: false, aniso: 1 });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ── Decal atlas (4x4): 0-7 blood splats, 8-9 scorch, 10 crater, 11 oil ──────
export const DF = { BLOOD: 0, SCORCH: 8, CRATER: 10, PUDDLE: 11 };

export function makeDecalAtlas(cell = 128) {
  const size = cell * 4;
  const c = canvas(size), ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size), d = img.data;
  const rng = makeRng(919);
  for (let idx = 0; idx < 12; idx++) {
    const ox = (idx % 4) * cell, oy = Math.floor(idx / 4) * cell;
    const n = fbmTile(cell, 4, 5, 600 + idx * 11, 0.6);
    const n2 = fbmTile(cell, 16, 3, 700 + idx * 5, 0.5);
    // satellite droplets for blood
    const drops = [];
    if (idx < 8) for (let k = 0; k < 14; k++) {
      const ang = rng() * Math.PI * 2, dist = 0.45 + rng() * 0.45;
      drops.push([Math.cos(ang) * dist, Math.sin(ang) * dist, 0.03 + rng() * 0.07]);
    }
    for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
      const u = (x + 0.5) / cell * 2 - 1, v = (y + 0.5) / cell * 2 - 1;
      const i = y * cell + x;
      const r = Math.sqrt(u * u + v * v);
      let R = 0, G = 0, B = 0, A = 0;
      if (idx < 8) {
        let blob = clamp((0.62 - r - (n[i] - 0.5) * 0.9) * 6, 0, 1);
        for (const [dx, dy, s] of drops) {
          const dd = Math.sqrt((u - dx) ** 2 + (v - dy) ** 2);
          blob = Math.max(blob, clamp((s - dd) * 40, 0, 1));
        }
        const dark = 0.5 + n2[i] * 0.5;
        R = 0.32 * dark + 0.05; G = 0.01; B = 0.01; A = blob * (0.85 + n2[i] * 0.15);
      } else if (idx < 10) {
        const a = clamp((0.85 - r - (n[i] - 0.5) * 0.7) * 2.2, 0, 1);
        R = 0.05; G = 0.045; B = 0.04; A = Math.pow(a, 0.8) * 0.95;
      } else if (idx === 10) {
        const rim = Math.exp(-Math.pow((r - 0.62) * 7, 2));
        const pit = clamp((0.55 - r) * 4, 0, 1);
        R = 0.06 + rim * 0.15; G = 0.05 + rim * 0.12; B = 0.045 + rim * 0.1;
        A = clamp(pit * 0.95 + rim * 0.8 - (n[i] - 0.5) * 0.4, 0, 1) * clamp((1 - r) * 4, 0, 1);
      } else {
        const a = clamp((0.7 - r - (n[i] - 0.5) * 0.6) * 4, 0, 1);
        R = 0.02; G = 0.02; B = 0.025; A = a * 0.8;
      }
      const j = ((oy + y) * size + ox + x) * 4;
      d[j] = R * 255; d[j + 1] = G * 255; d[j + 2] = B * 255; d[j + 3] = A * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = toTexture(c, { srgb: true, aniso: 4 });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ── Glow sprite ─────────────────────────────────────────────────────────────
export function makeGlowTexture(size = 128, falloff = 2.0) {
  const c = canvas(size), ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    g.addColorStop(t, `rgba(255,255,255,${Math.pow(1 - t, falloff).toFixed(3)})`);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = toTexture(c, { srgb: false, aniso: 1 });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// ── City windows (emissive) ─────────────────────────────────────────────────
export function makeWindowTexture(size = 256) {
  const c = canvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  const rng = makeRng(4242);
  const cols = 16, rows = 32;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    if (rng() < 0.11) {
      const warm = 0.6 + rng() * 0.4;
      ctx.fillStyle = `rgba(255,${Math.floor(120 * warm)},${Math.floor(40 * warm)},${0.5 + rng() * 0.5})`;
      ctx.fillRect(x * (size / cols) + 3, y * (size / rows) + 2, size / cols - 6, size / rows - 4);
    }
  }
  return toTexture(c);
}

// ── Tattered flag ───────────────────────────────────────────────────────────
export function makeFlagTexture() {
  const c = canvas(256), ctx = c.getContext('2d');
  ctx.fillStyle = '#3c3b2a'; ctx.fillRect(0, 0, 256, 170);
  ctx.fillStyle = '#5c1712'; ctx.fillRect(0, 56, 256, 58);
  ctx.fillStyle = '#c9b98a';
  ctx.font = 'bold 44px sans-serif';
  ctx.fillText('B-7', 70, 100);
  // tatter the fly end
  ctx.globalCompositeOperation = 'destination-out';
  const rng = makeRng(5);
  for (let i = 0; i < 26; i++) {
    ctx.beginPath();
    const y = rng() * 170, x = 190 + rng() * 70;
    ctx.moveTo(256, y); ctx.lineTo(x, y + 4 + rng() * 8); ctx.lineTo(256, y + 12 + rng() * 10);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  const t = toTexture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
