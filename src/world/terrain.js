// The valley floor and the land beyond it.
//
// A single analytic height function describes everything: the trampled
// killing ground (kept dead flat right at the wall so the corpse piles
// behave), shell craters, the napalm ditch, the old forward trench, the
// cratered road out to the city, the valley walls and cliffs that funnel
// the horde, and the rolling hills and city plain on the horizon.
// A height cache answers groundH() queries for gameplay/FX, a splat texture
// carries grass / wetness / scorch / trample masks to the terrain shader and
// to the grass scatter.
import * as THREE from 'three';
import { WORLD, wallZ, wallDist } from '../config.js';
import { makeRng, clamp, smoothstep as S } from '../core/util.js';
import { lampLit } from './lamplight.js';
import { makeTurfTextures, makeRockTextures, makeAsphaltTextures, makeGrassBladeTexture } from './textures2.js';
import { fileTex } from './texlib.js';
import { terrainNodes } from './terrainShader.js';
import { Fn, float, vec2, vec3, vec4, uniform, texture, textureLoad, ivec2, positionLocal, cameraPosition, attribute, uv, smoothstep as sstep, sin, cos, length, mix, clamp as tclamp, floor, materialColor, varyingProperty, instance } from 'three/tsl';

// ── deterministic value noise ───────────────────────────────────────────────
function h2(ix, iz) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = h2(ix, iz), b = h2(ix + 1, iz), c = h2(ix, iz + 1), d = h2(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
export function fbm(x, z, oct = 4) {
  let v = 0, a = 0.5, t = 0;
  for (let i = 0; i < oct; i++) { v += a * vnoise(x, z); t += a; x = x * 2.03 + 17.1; z = z * 2.03 - 9.3; a *= 0.5; }
  return v / t;
}

// ── layout ──────────────────────────────────────────────────────────────────
/** x of the road centre at depth z (road runs from the tower out to the city). */
export function roadX(z) {
  return -52 * S(-110, -470, z) + 96 * S(-540, -930, z);
}
/** Inner edge (|x|) of the valley walls at depth z. */
export function valleyEdge(z, x = 1) {
  // the valley widening up the field, its edge wandering on each side on its own (bays where the
  // hills fall back, spurs where they come in): from above it is no ruled line. Straight at the
  // wall, where the cliffs carry the wall's own line on.
  const run = Math.max(0, -z - 40), s = x < 0 ? 1 : 0;
  // (long bays, spurs some tens of metres across, and smaller knuckles on those)
  const w = (vnoise(z * 0.009 + s * 17.3, s * 4.1 + 2.7) - 0.5) * 44 + (vnoise(z * 0.032 + s * 9.1, 5.3 + s) - 0.5) * 30
    + (vnoise(z * 0.085 + s * 3.7, 11.2 + s) - 0.5) * 12;
  return 92 + run * 0.46 + w * Math.min(1, run / 60);
}
/** Forward trench line. */
export function trenchZ(x) {
  return -128 + Math.sin(((x + 60) / 130) * 9) * 4;
}
export const NAPALM_OFFSET = 9;

// ── behind the base: farmland in a broad valley, wooded hills either side ───
/** x of the rear valley's axis at depth z (straight out of the yard, then winding). */
export function rearValleyX(z) {
  return S(80, 320, z) * (45 * Math.sin(z * 0.0055 + 0.4) - 10);
}
/** x of the dirt track that leaves the yard and runs back down the rear valley. */
export function rearRoadX(z) {
  return rearValleyX(z) + S(40, 160, z) * 15 * Math.sin(z * 0.02);
}
/** Half-width of the rear valley floor at depth z. */
function rearValleyW(z) {
  return 78 + Math.max(0, z - 70) * 0.16 + (fbm(z * 0.01, 3.3, 2) - 0.5) * 40;
}
/** The patchwork of fields on the rear valley floor: a rotated grid of plots. */
export const FIELD = { a: 0.32, w: 54, d: 36 };
const FC = Math.cos(FIELD.a), FS = Math.sin(FIELD.a);
/** Field coordinates (in plot units) of a world point. */
export function fieldCoords(x, z, out = [0, 0]) {
  out[0] = (FC * x - FS * z) / FIELD.w; out[1] = (FS * x + FC * z) / FIELD.d;
  return out;
}
/** World point of field coordinates. */
export function fieldToWorld(u, v, out = [0, 0]) {
  const fx = u * FIELD.w, fz = v * FIELD.d;
  out[0] = FC * fx + FS * fz; out[1] = -FS * fx + FC * fz;
  return out;
}
/** What a plot is used for: 0 ploughed, 1 stubble, 2 meadow, 3 fallow (same hash as the shader). */
export function fieldKind(iu, iv) {
  const h = fieldHash(iu + 3.7, iv + 3.7);
  return h < 0.3 ? 0 : h < 0.55 ? 1 : h < 0.85 ? 2 : 3;
}
// the shader's tHash, in JS (float32-faithful enough for a plot id)
function fract(v) { return v - Math.floor(v); }
export function fieldHash(px, py) {
  px = fract(px * 443.897); py = fract(py * 441.423);
  const d = px * (py + 19.19) + py * (px + 19.19);
  px += d; py += d;
  return fract((px + py) * px);
}
/** Height of the land behind the base (0 in the yard and on the landing zone). */
function rearLand(x, z) {
  if (z < 20) return 0;
  const Rh = S(20, 130, z), Rf = S(72, 150, z);
  const dx = x - rearValleyX(z);
  const adx = Math.abs(dx);
  const side = Math.max(0, adx - rearValleyW(z));
  // hills: rounded, ridged, rising out of the valley floor
  let hill = 0;
  if (side > 0) {
    const n = fbm(x * 0.0045 + 21, z * 0.0045 - 4, 4);
    const ridged = 1 - Math.abs(vnoise(x * 0.011 + 7, z * 0.011) * 2 - 1);
    hill = (1 - Math.exp(-side / 70)) * (34 + 74 * n) + side * 0.06 + ridged * Math.min(side, 90) * 0.17
      + (vnoise(x * 0.05, z * 0.05) - 0.5) * 2.2 * S(0, 30, side);
  }
  // the floor: gentle swells, the odd knoll off to the side, falling away from the base
  let floor = (fbm(x * 0.009 + 9, z * 0.009, 3) - 0.5) * 9 - 5 * S(90, 500, z);
  floor += Math.max(0, vnoise(x * 0.006 + 50, z * 0.006) - 0.6) * 55 * S(30, 70, adx) * S(160, 260, z);
  let detail = (vnoise(x * 0.045 + 3, z * 0.045) - 0.5) * 1.3 + (vnoise(x * 0.16, z * 0.16) - 0.5) * 0.25;
  // the track: fine detail smoothed away, a shallow ditch each side
  const rd = Math.abs(x - rearRoadX(z));
  const onRoad = S(5.5, 3.2, rd) * S(26, 40, z);
  detail *= 1 - onRoad * 0.85;
  floor += -0.4 * Math.exp(-Math.pow((rd - 4.6) / 0.9, 2)) * S(30, 60, z);
  return Rf * (floor + detail) + Rh * hill * (1 - onRoad);
}

// craters: placed once, deterministic
const CRATERS = [];
const CGRID = new Map();
const CCELL = 24;
(function placeCraters() {
  const rng = makeRng(4711);
  const tryAdd = (x, z, r, d) => {
    const wd = wallDist(x, z);
    if (wd < 16 + r) return;
    if (Math.abs(x) > valleyEdge(z, x) - 6) return;
    CRATERS.push({ x, z, r, d });
  };
  for (let i = 0; i < 150; i++) {
    const x = (rng() - 0.5) * 380, z = -14 - Math.pow(rng(), 0.8) * 340;
    const r = 1.4 + Math.pow(rng(), 2.2) * 5.5;
    tryAdd(x, z, r, r * (0.16 + rng() * 0.09));
  }
  for (let i = 0; i < 9; i++) {
    const x = (rng() - 0.5) * 260, z = -110 - rng() * 220;
    const r = 7 + rng() * 4;
    tryAdd(x, z, r, r * 0.17);
  }
  for (const c of CRATERS) {
    const R = c.r * 2;
    for (let gx = Math.floor((c.x - R) / CCELL); gx <= Math.floor((c.x + R) / CCELL); gx++) {
      for (let gz = Math.floor((c.z - R) / CCELL); gz <= Math.floor((c.z + R) / CCELL); gz++) {
        const k = gx * 10007 + gz;
        if (!CGRID.has(k)) CGRID.set(k, []);
        CGRID.get(k).push(c);
      }
    }
  }
})();
export function craterList() { return CRATERS; }

function craterAt(x, z) {
  const list = CGRID.get(Math.floor(x / CCELL) * 10007 + Math.floor(z / CCELL));
  if (!list) return 0;
  let h = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    const dx = x - c.x, dz = z - c.z;
    const d2 = dx * dx + dz * dz, R = c.r * 2;
    if (d2 > R * R) continue;
    const q = Math.sqrt(d2) / c.r;
    if (q < 1) h -= c.d * (1 - q * q) * (1 - q * q * 0.35);
    const e = (q - 1.02) / 0.3;
    h += c.d * 0.32 * Math.exp(-e * e);
  }
  return h;
}

// ── the height function ─────────────────────────────────────────────────────
const _parts = { base: 0, crater: 0, trench: 0, road: 0, wd: 0 };
export function heightParts(x, z, out = _parts) {
  const ax = Math.abs(x);
  const wd = wallDist(x, z);
  out.wd = wd;
  // killing field undulation
  const amp = S(5, 55, wd);
  const broad = amp * (fbm(x * 0.017, z * 0.017, 3) - 0.5) * 2.3, fine = amp * (vnoise(x * 0.085, z * 0.085) - 0.5) * 0.4;
  let base = broad + fine;
  // craters & ditches
  const crater = craterAt(x, z);
  let trench = 0;
  if (ax < 76 && wd > 6 && wd < 12) {
    const t = (wd - NAPALM_OFFSET) / 1.45;
    if (t > -1 && t < 1) trench -= 0.45 * (1 - t * t) * (1 - t * t);
  }
  if (x > -68 && x < 80 && z < -118 && z > -140) {
    const dz = z - trenchZ(x);
    const m = S(-68, -58, x) * S(80, 70, x);
    trench += m * (-0.9 * S(1.15, 0.55, Math.abs(dz)) + 0.42 * Math.exp(-Math.pow((dz + 2.4) / 1.1, 2)));
  }
  // road: a laid surface. It follows the valley's broad rise and fall, but not the lumps or
  // the shell craters (its potholes are in the shader), with a low crown down the middle
  const rd = Math.abs(x - roadX(z));
  const road = z < wallZ(x) - 1 ? S(6.8, 3.9, rd) : 0;
  const crown = 0.07 * Math.max(0, 1 - (rd / 4.2) ** 2);
  let h = broad * (1 - road * 0.3) + fine * (1 - road) + crater * (1 - road * 0.92) + trench * (1 - road * 0.7) + road * (0.06 + crown);

  // cliffs continuing the wall line beyond the wings
  // (behind the base they die away into the rear hills)
  const rearFade = 1 - S(20, 130, z);
  if (ax > 74 && rearFade > 0) {
    const k = S(78, 98, ax) * S(14, -10, wd) * rearFade;
    if (k > 0) {
      const spur = 1 - Math.abs(vnoise(x * 0.05 + 8.5, z * 0.05 + 2.5) * 2 - 1);
      h += k * (16 + fbm(x * 0.03, z * 0.03, 3) * 14 + (spur - 0.5) * 7 + (fbm(x * 0.09 + 4, z * 0.09, 2) - 0.5) * 5);
    }
  }
  // valley walls
  const side = ax - valleyEdge(z, x);
  if (side > -12 && rearFade > 0) {
    const s = Math.max(0, side + 12);
    const n = fbm(x * 0.012 + 5, z * 0.012, 4);
    const ridged = 1 - Math.abs(vnoise(x * 0.02, z * 0.02) * 2 - 1);
    let wh = (44 * (1 - Math.exp(-s / 55)) + s * 0.1) * (0.65 + n * 0.7) + ridged * Math.min(s, 50) * 0.12;
    // break the face up: gullies and spurs down it, rough ground, soft strata steps
    const rug = Math.min(s, 40) / 40;
    const spur = 1 - Math.abs(vnoise(x * 0.034 + 2.5, z * 0.034 - 1.5) * 2 - 1);
    wh += rug * ((spur - 0.55) * 9 + (fbm(x * 0.055 + 1, z * 0.055 + 2, 3) - 0.5) * 7);
    wh -= Math.sin(wh * 0.9) * 0.9 * rug;
    h += wh * rearFade;
  }
  // the country behind the base
  h += rearLand(x, z);
  // far hills & the city plain
  const far = S(-360, -640, z);
  if (far > 0) {
    const n = fbm(x * 0.0031 + 11, z * 0.0031 - 7, 5);
    const sideF = S(140, 620, ax);
    let H = (n - 0.3) * (34 + 130 * sideF) + (vnoise(x * 0.02, z * 0.02) - 0.5) * 3;
    const city = S(-850, -980, z) * (1 - S(720, 980, ax));
    H = H * (1 - city) + (1.5 + n * 5) * city;
    const rr = S(9, 5, Math.abs(x - roadX(z)));
    H = H * (1 - rr * 0.8) + rr * 0.8 * Math.min(H, 2 + n * 6);
    h = h * (1 - far) + Math.max(-6, H) * far;
  }
  out.base = base; out.crater = crater; out.trench = trench; out.road = road;
  return h;
}
export function heightFn(x, z) { return heightParts(x, z); }

// ── height cache for fast gameplay queries ─────────────────────────────────
const HC = { x0: -400, z0: -720, step: 1.25, w: 641, h: 641, data: null };
function buildCache() {
  const { x0, z0, step, w, h } = HC;
  const d = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    const z = z0 + j * step;
    for (let i = 0; i < w; i++) d[j * w + i] = heightFn(x0 + i * step, z);
  }
  HC.data = d;
}

export function groundH(x, z) {
  const d = HC.data;
  if (!d) return heightFn(x, z);
  const fx = (x - HC.x0) / HC.step, fz = (z - HC.z0) / HC.step;
  const i = Math.floor(fx), j = Math.floor(fz);
  if (i < 0 || j < 0 || i >= HC.w - 1 || j >= HC.h - 1) return heightFn(x, z);
  const tx = fx - i, tz = fz - j, w = HC.w, o = j * w + i;
  const a = d[o], b = d[o + 1], c = d[o + w], e = d[o + w + 1];
  return a + (b - a) * tx + (c - a) * tz + (a - b - c + e) * tx * tz;
}

/** Unit surface normal → out [nx, ny, nz]. */
export function groundNormal(x, z, out = [0, 1, 0]) {
  const e = 0.8;
  const hx = groundH(x + e, z) - groundH(x - e, z);
  const hz = groundH(x, z + e) - groundH(x, z - e);
  const nx = -hx, ny = 2 * e, nz = -hz;
  const l = Math.hypot(nx, ny, nz);
  out[0] = nx / l; out[1] = ny / l; out[2] = nz / l;
  return out;
}

/** Ray vs terrain. Returns t or -1. */
export function raycastGround(ox, oy, oz, dx, dy, dz, maxT = 700) {
  let t = 0, prevT = 0;
  let step = 1.5;
  let above = oy - groundH(ox, oz);
  if (above < 0) return 0;
  while (t < maxT) {
    prevT = t;
    t += step;
    const x = ox + dx * t, y = oy + dy * t, z = oz + dz * t;
    const gh = groundH(x, z);
    if (y <= gh) {
      // bisect
      let a = prevT, b = t;
      for (let k = 0; k < 10; k++) {
        const m = (a + b) * 0.5;
        if (oy + dy * m <= groundH(ox + dx * m, oz + dz * m)) b = m; else a = m;
      }
      return b;
    }
    above = y - gh;
    step = clamp(above * 0.5, 0.6, 6);
  }
  return -1;
}

// ── splat masks ─────────────────────────────────────────────────────────────
const SPLAT = { x0: -400, z0: -720, size: 800, res: 1024, data: null };
function buildSplat() {
  const N = SPLAT.res, sc = SPLAT.size / N;
  const d = new Uint8Array(N * N * 4);
  const p = { base: 0, crater: 0, trench: 0, road: 0, wd: 0 };
  for (let j = 0; j < N; j++) {
    const z = SPLAT.z0 + (j + 0.5) * sc;
    for (let i = 0; i < N; i++) {
      const x = SPLAT.x0 + (i + 0.5) * sc;
      heightParts(x, z, p);
      const wd = p.wd;
      const n1 = fbm(x * 0.03, z * 0.03, 3), n2 = vnoise(x * 0.16, z * 0.16);
      // grass: patchy, none on the trampled ground, the road or in fresh craters
      let grass = clamp((n1 - 0.36) * 2.6 + (n2 - 0.5) * 0.5, 0, 1) * S(12, 48, wd);
      grass *= 1 - p.road;
      grass *= clamp(1 + p.crater * 2.2, 0, 1);
      // scorch: along the napalm ditch, old shell bursts
      let burn = Math.exp(-Math.pow((wd - NAPALM_OFFSET) / 2.6, 2)) * (Math.abs(x) < 78 ? 0.9 : 0);
      burn = Math.max(burn, clamp(-p.crater * 1.4, 0, 0.75));
      burn = Math.max(burn, clamp((vnoise(x * 0.025 + 40, z * 0.025) - 0.74) * 4, 0, 0.6) * S(20, 40, wd));
      grass *= 1 - burn;
      // standing water in crater bowls, the ditches and ruts near the wall
      let wet = clamp(-(p.crater + p.trench) * 2.2 - 0.12, 0, 1);
      wet = Math.max(wet, clamp((n2 - 0.6) * 3.5, 0, 1) * (1 - S(16, 40, wd)) * (wd > 1.5 ? 1 : 0));
      wet = Math.max(wet, clamp((vnoise(x * 0.07, z * 0.07 + 9) - 0.7) * 3, 0, 0.8) * (1 - p.road * 0.5));
      // trampled black mud right at the wall (and the road shoulders)
      const trample = Math.max(1 - S(2, 30, wd), 0.0);
      const o = (j * N + i) * 4;
      d[o] = grass * 255; d[o + 1] = wet * 255; d[o + 2] = burn * 255; d[o + 3] = trample * 255;
    }
  }
  SPLAT.data = d;
}
/** grass density at a point (0..1) from the splat data. */
function splatAt(x, z, ch) {
  const N = SPLAT.res;
  const i = Math.floor((x - SPLAT.x0) / SPLAT.size * N), j = Math.floor((z - SPLAT.z0) / SPLAT.size * N);
  if (i < 0 || j < 0 || i >= N || j >= N) return 0;
  return SPLAT.data[(j * N + i) * 4 + ch] / 255;
}
export function wetnessAt(x, z) { return splatAt(x, z, 1); }

// (the terrain material is built in terrainShader.js)

export class Terrain {
  constructor(scene, quality, mudTex) {
    this.scene = scene;
    this.quality = quality;
    const t0 = performance.now();
    buildCache();
    buildSplat();
    this.buildMesh(mudTex);
    this.buildGrass();
    this.loadMs = performance.now() - t0;
  }

  buildMesh(mud) {
    const q = this.quality;
    const tsz = Math.min(1024, q.texSize);
    const F = (name, gen) => fileTex(name) || gen();
    this.tex = {
      turf: F('turf', () => makeTurfTextures(Math.min(512, tsz))),
      rock: F('rock', () => makeRockTextures(Math.min(512, tsz))),
      asph: F('asphalt', () => makeAsphaltTextures(Math.min(512, tsz))),
    };
    // the new rear surfaces have no procedural version: fall back to the mud
    this.tex.track = fileTex('track') || { map: mud.map, normalMap: mud.normalMap };
    this.tex.plough = fileTex('plough') || { map: mud.map, normalMap: mud.normalMap };
    // tile sizes in metres: the scans at (about) their real size, the procedural ones as tuned
    const scan = (n) => !!(fileTex(n) && fileTex(n).file);
    const TS = {
      mud: mud.file ? 2.2 : 9, mudMacro: mud.file ? 23 : 41, turf: scan('turf') ? 3.4 : 5.5,
      rock: scan('rock') ? 6.5 : 13, asph: scan('asphalt') ? 2.0 : 7, track: 2.4, plough: 9,
      // the mud's relief at the size it always had on screen (9 m a tile): smaller, its bumps
      // turn to mush past a few metres and the field reads flat
      mudN: 9,
    };
    const f = (v) => v.toFixed(2);
    this.TS = TS;
    const splat = new THREE.DataTexture(SPLAT.data, SPLAT.res, SPLAT.res, THREE.RGBAFormat);
    splat.magFilter = THREE.LinearFilter;
    splat.minFilter = THREE.LinearMipmapLinearFilter;
    splat.generateMipmaps = true;
    splat.needsUpdate = true;
    this.splatTex = splat;

    // warped grid: dense near the wall, coarse towards the horizon
    const NX = q.texSize >= 1024 ? 380 : 300;
    let NZ = q.texSize >= 1024 ? 340 : 270;
    const xs = new Float32Array(NX + 1);
    for (let i = 0; i <= NX; i++) {
      const u = i / NX * 2 - 1, a = Math.abs(u);
      xs[i] = Math.sign(u) * (230 * a + 1500 * a * a * a);
    }
    // behind the base (coarse) then the valley (dense near the wall)
    const REAR = q.texSize >= 1024 ? 130 : 110;
    const zList = [];
    for (let j = 0; j < REAR; j++) { const t = j / REAR; zList.push(70 + 830 * Math.pow(1 - t, 1.7)); }
    for (let j = 0; j <= NZ; j++) { const v = j / NZ; zList.push(70 - (400 * v + 1330 * v * v * v)); }
    const zs = Float32Array.from(zList);
    NZ = zs.length - 1;
    const pos = new Float32Array((NX + 1) * (NZ + 1) * 3);
    const uv = new Float32Array((NX + 1) * (NZ + 1) * 2);
    let p = 0, u2 = 0;
    for (let j = 0; j <= NZ; j++) {
      for (let i = 0; i <= NX; i++) {
        const x = xs[i], z = zs[j];
        pos[p++] = x; pos[p++] = heightFn(x, z); pos[p++] = z;
        uv[u2++] = x / 9; uv[u2++] = z / 9;
      }
    }
    const idx = new Uint32Array(NX * NZ * 6);
    let k = 0;
    for (let j = 0; j < NZ; j++) {
      for (let i = 0; i < NX; i++) {
        const a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1;
        idx[k++] = a; idx[k++] = b; idx[k++] = c;
        idx[k++] = b; idx[k++] = d; idx[k++] = c;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    for (const t of [mud.map, mud.normalMap, mud.roughnessMap]) if (t) t.repeat.set(1, 1);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 1, metalness: 0,
      normalMap: mud.normalMap, normalScale: new THREE.Vector2(1.1, 1.1),
      envMapIntensity: 0.35,
    });
    this.uniforms = {
      uSplatBox: uniform(new THREE.Vector4(SPLAT.x0, SPLAT.z0, SPLAT.size, SPLAT.size)),
      uTime: uniform(0),
      uRain: uniform(1),
    };
    terrainNodes(mat, {
      splat, mudA: mud.map, mudR: mud.roughnessMap || mud.map, mudN: mud.normalMap,
      turfA: this.tex.turf.map, turfN: this.tex.turf.normalMap, rockA: this.tex.rock.map, rockN: this.tex.rock.normalMap,
      asphA: this.tex.asph.map, asphN: this.tex.asph.normalMap, trackA: this.tex.track.map, ploughA: this.tex.plough.map,
    }, TS, { mudFile: !!mud.file, ploughFile: !!fileTex('plough'), trackFile: !!fileTex('track') }, this.uniforms);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.mesh = mesh;
  }

  buildGrass() {
    const q = this.quality;
    const count = q.grass ?? 20000;
    if (!count) return;
    // three crossed cards, pivot at the root
    const card = new THREE.PlaneGeometry(1, 1, 1, 3);
    card.translate(0, 0.5, 0);
    const geos = [];
    for (let k = 0; k < 3; k++) {
      const g = card.clone();
      g.rotateY(k * Math.PI / 3);
      geos.push(g);
    }
    const pos = [], uvs = [], nrm = [], idx = [];
    let base = 0;
    for (const g of geos) {
      const pa = g.attributes.position, ua = g.attributes.uv;
      for (let i = 0; i < pa.count; i++) {
        pos.push(pa.getX(i), pa.getY(i), pa.getZ(i));
        uvs.push(ua.getX(i), ua.getY(i));
        nrm.push(0, 1, 0);
      }
      const ia = g.index;
      for (let i = 0; i < ia.count; i++) idx.push(ia.getX(i) + base);
      base += pa.count;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    geo.setIndex(idx);

    const tex = makeGrassBladeTexture(256);
    const mat = new THREE.MeshStandardMaterial({
      map: tex, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.95, metalness: 0,
      color: 0xb8ad90, envMapIntensity: 0.15,
    });
    this.grassUniforms = { uTime: uniform(0) };
    // each blade sways from its root, the tips most; the far ones shrink away (the instance's
    // own position comes in aIP: the sway and the fade work in the blade's local space)
    const gT = this.grassUniforms.uTime;
    const vAO = varyingProperty('float', 'vGrassAO');
    mat.positionNode = Fn(() => {
      const ip = attribute('aIP', 'vec3');
      const gd = length(ip.xz.sub(cameraPosition.xz));
      const fade = sstep(175.0, 120.0, gd);
      const h = uv().y.mul(uv().y);
      const gust = sin(gT.mul(0.9).add(ip.x.mul(0.05)).add(ip.z.mul(0.03))).mul(0.5).add(0.5);
      const p = positionLocal.toVar();
      p.x.addAssign(sin(gT.mul(2.1).add(ip.x.mul(0.7)).add(ip.z.mul(0.4))).mul(0.07).add(gust.mul(0.12)).mul(h));
      p.z.addAssign(cos(gT.mul(1.7).add(ip.z.mul(0.6))).mul(0.05).mul(h));
      vAO.assign(uv().y);
      return p.mul(fade);
    })();
    mat.colorNode = Fn(() => vec4(materialColor.rgb.mul(vAO.mul(0.65).add(0.35)), materialColor.a))();
    lampLit(mat); // the blades under a wall lamp catch it like the ground they grow in

    // blades are bucketed into angular sectors around the gun, each its own instanced
    // mesh with a real bounding sphere, so the ones behind / beside the view are culled
    const SECTORS = 12, A0 = -Math.PI * 0.625, AW = Math.PI * 1.25;
    const buckets = Array.from({ length: SECTORS }, () => ({ m: [], c: [] }));
    const rng = makeRng(5150);
    const m = new THREE.Matrix4(), qt = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
    const col = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    let n = 0, tries = 0;
    while (n < count && tries < count * 14) {
      tries++;
      // denser close to the wall view, out to ~170 m
      const r = 14 + Math.pow(rng(), 0.75) * 165;
      const a = (rng() - 0.5) * Math.PI * 1.25;
      const x = WORLD.CAM.x + Math.sin(a) * r * 1.15, z = WORLD.CAM.z - Math.cos(a) * r;
      const g = splatAt(x, z, 0);
      if (g < 0.08 || rng() > g * 1.15) continue;
      const y = groundH(x, z);
      const s = (0.45 + rng() * 0.6) * (0.6 + g * 0.5);
      ps.set(x, y - 0.04, z);
      qt.setFromAxisAngle(up, rng() * Math.PI * 2);
      sc.set(s * (0.8 + rng() * 0.6), s * (0.7 + rng() * 0.7), s * (0.8 + rng() * 0.6));
      m.compose(ps, qt, sc);
      const t = rng();
      col.setRGB(0.75 + t * 0.35, 0.72 + t * 0.25, 0.6 + t * 0.15);
      const b = buckets[Math.min(SECTORS - 1, Math.max(0, Math.floor((a - A0) / AW * SECTORS)))];
      b.m.push(m.clone()); b.c.push(col.clone());
      n++;
    }
    const group = new THREE.Group();
    for (const b of buckets) {
      if (!b.m.length) continue;
      const g = geo.clone();
      const ipA = new Float32Array(b.m.length * 3);
      b.m.forEach((mm, i) => { ipA[i * 3] = mm.elements[12]; ipA[i * 3 + 1] = mm.elements[13]; ipA[i * 3 + 2] = mm.elements[14]; });
      g.setAttribute('aIP', new THREE.InstancedBufferAttribute(ipA, 3));
      const mesh = new THREE.InstancedMesh(g, mat, b.m.length);
      b.m.forEach((mm, i) => { mesh.setMatrixAt(i, mm); mesh.setColorAt(i, b.c[i]); });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.boundingSphere.radius += 1.5; // wind sway
      mesh.frustumCulled = true;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      group.add(mesh);
    }
    this.scene.add(group);
    this.grass = group;
  }

  update(time) {
    this.uniforms.uTime.value = time;
    if (this.grassUniforms) this.grassUniforms.uTime.value = time;
  }
}

// ── height texture for ground-conforming shaders (decals, light pools) ─────
let HTEX = null;
export function heightUniforms() {
  if (!HTEX) {
    HTEX = new THREE.DataTexture(HC.data, HC.w, HC.h, THREE.RedFormat, THREE.FloatType);
    HTEX.magFilter = HTEX.minFilter = THREE.NearestFilter;
    HTEX.needsUpdate = true;
  }
  return { tLbHeight: { value: HTEX }, uLbHBox: { value: new THREE.Vector4(HC.x0, HC.z0, HC.step, HC.w) } };
}
/** The terrain's height at xz (bilinear over the height cache), for vertex shaders. */
export const lbTerrainH = Fn(([xz]) => {
  const H = texture(heightUniforms().tLbHeight.value);
  const box = new THREE.Vector4(HC.x0, HC.z0, HC.step, HC.w);
  const f = xz.sub(vec2(box.x, box.y)).div(box.z);
  const i = tclamp(floor(f), vec2(0), vec2(box.w - 2));
  const t = tclamp(f.sub(i), 0, 1);
  const ii = ivec2(i);
  const a = textureLoad(H, ii, 0).r, b = textureLoad(H, ii.add(ivec2(1, 0)), 0).r;
  const c = textureLoad(H, ii.add(ivec2(0, 1)), 0).r, d = textureLoad(H, ii.add(ivec2(1, 1)), 0).r;
  return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
});
