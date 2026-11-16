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
import { makeTurfTextures, makeRockTextures, makeAsphaltTextures, makeGrassBladeTexture } from './textures2.js';
import { fileTex } from './texlib.js';

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
export function valleyEdge(z) {
  return 92 + Math.max(0, -z - 40) * 0.46;
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
    if (Math.abs(x) > valleyEdge(z) - 6) return;
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
  let base = amp * ((fbm(x * 0.017, z * 0.017, 3) - 0.5) * 2.3 + (vnoise(x * 0.085, z * 0.085) - 0.5) * 0.4);
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
  // road: smooth the fine detail, keep potholes
  const rd = Math.abs(x - roadX(z));
  const road = z < wallZ(x) - 1 ? S(6.8, 3.9, rd) : 0;
  let h = base * (1 - road * 0.55) + crater * (1 - road * 0.55) + trench * (1 - road * 0.7) + road * 0.04;

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
  const side = ax - valleyEdge(z);
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

// ── shaders ─────────────────────────────────────────────────────────────────
const T_COMMON = /* glsl */`
float tHash(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
float tNoise(vec2 p){
  vec2 i = floor(p), q = fract(p); vec2 u = q * q * (3.0 - 2.0 * q);
  return mix(mix(tHash(i), tHash(i + vec2(1.0, 0.0)), u.x), mix(tHash(i + vec2(0.0, 1.0)), tHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float tS(float a, float b, float v){ float t = clamp((v - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
float roadXg(float z){ return -52.0 * tS(-110.0, -470.0, z) + 96.0 * tS(-540.0, -930.0, z); }
float rearValleyXg(float z){ return tS(80.0, 320.0, z) * (45.0 * sin(z * 0.0055 + 0.4) - 10.0); }
float rearRoadXg(float z){ return rearValleyXg(z) + tS(40.0, 160.0, z) * 15.0 * sin(z * 0.02); }
// Anti-tiling (after Inigo Quilez, "texture repetition" #3): a low-frequency
// noise picks between eight randomly offset copies of the texture and blends
// neighbouring copies, so no two patches of ground repeat.
struct NT { vec2 a; vec2 b; float f; vec2 dx; vec2 dy; };
// explicit gradients: safe to call inside branches (derivatives aren't, in divergent flow)
NT ntSetupD(vec2 uv, vec2 dx, vec2 dy){
  float k = tNoise(uv * 0.33 + 11.3) * 0.65 + tNoise(uv * 1.1 - 4.7) * 0.35;
  float idx = k * 8.0;
  float i = floor(idx);
  NT n;
  n.f = smoothstep(0.25, 0.75, fract(idx));
  n.a = uv + sin(vec2(3.0, 7.0) * i) * 4.1;
  n.b = uv + sin(vec2(3.0, 7.0) * (i + 1.0)) * 4.1;
  n.dx = dx; n.dy = dy;
  return n;
}
NT ntSetup(vec2 uv){
  float k = tNoise(uv * 0.33 + 11.3) * 0.65 + tNoise(uv * 1.1 - 4.7) * 0.35;
  float idx = k * 8.0;
  float i = floor(idx);
  NT n;
  n.f = smoothstep(0.25, 0.75, fract(idx));
  n.a = uv + sin(vec2(3.0, 7.0) * i) * 4.1;
  n.b = uv + sin(vec2(3.0, 7.0) * (i + 1.0)) * 4.1;
  n.dx = dFdx(uv); n.dy = dFdy(uv);
  return n;
}
vec4 ntSample(sampler2D t, NT n){
  return mix(textureGrad(t, n.a, n.dx, n.dy), textureGrad(t, n.b, n.dx, n.dy), n.f);
}
vec2 rippleN(vec2 p, float t){
  vec2 acc = vec2(0.0);
  for (int k = 0; k < 3; k++){
    float fk = float(k);
    vec2 q = p * (1.9 + fk * 0.7) + fk * 7.13;
    vec2 i = floor(q), f = fract(q) - 0.5;
    float rnd = tHash(i + fk * 3.1);
    vec2 off = vec2(tHash(i + 1.7), tHash(i + 4.3)) - 0.5;
    vec2 dv = f - off * 0.5;
    float d = length(dv) + 1e-4;
    float ph = fract(t * (0.8 + rnd * 0.5) + rnd);
    float r = ph * 0.42;
    float w = exp(-pow((d - r) / 0.03, 2.0)) * (1.0 - ph) * (1.0 - ph);
    acc += dv / d * w * sin((d - r) * 90.0);
  }
  return acc;
}
`;

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
      rock: scan('rock') ? 6.5 : 13, asph: scan('asphalt') ? 3.6 : 7, track: 2.4, plough: 9,
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
      tSplat: { value: splat },
      uSplatBox: { value: new THREE.Vector4(SPLAT.x0, SPLAT.z0, SPLAT.size, SPLAT.size) },
      tMudA: { value: mud.map }, tMudR: { value: mud.roughnessMap || mud.map },
      tTrackA: { value: this.tex.track.map }, tTrackN: { value: this.tex.track.normalMap },
      tPloughA: { value: this.tex.plough.map }, tPloughN: { value: this.tex.plough.normalMap },
      tTurfA: { value: this.tex.turf.map }, tTurfN: { value: this.tex.turf.normalMap },
      tRockA: { value: this.tex.rock.map }, tRockN: { value: this.tex.rock.normalMap },
      tAsphA: { value: this.tex.asph.map }, tAsphN: { value: this.tex.asph.normalMap },
      uTime: { value: 0 },
      uRain: { value: 1 },
    };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = 'varying vec3 vTW;\nvarying vec3 vTNw;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vTW = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vTNw = normalize(mat3(modelMatrix) * objectNormal);`);
      sh.fragmentShader = /* glsl */`
varying vec3 vTW;
varying vec3 vTNw;
uniform sampler2D tSplat; uniform vec4 uSplatBox;
uniform sampler2D tMudA; uniform sampler2D tMudR;
uniform sampler2D tTurfA; uniform sampler2D tTurfN;
uniform sampler2D tRockA; uniform sampler2D tRockN;
uniform sampler2D tAsphA; uniform sampler2D tAsphN;
uniform sampler2D tTrackA; uniform sampler2D tTrackN;
uniform sampler2D tPloughA; uniform sampler2D tPloughN;
uniform float uTime; uniform float uRain;
${T_COMMON}
` + sh.fragmentShader
        .replace('#include <map_fragment>', /* glsl */`
  vec3 tw = vTW;
  vec3 tn = normalize(vTNw);
  vec2 sp = (tw.xz - uSplatBox.xy) / uSplatBox.zw;
  float inBox = step(0.0, sp.x) * step(sp.x, 1.0) * step(0.0, sp.y) * step(sp.y, 1.0);
  vec4 SPL = texture2D(tSplat, clamp(sp, 0.0, 1.0)) * inBox;
  float macro = tNoise(tw.xz * 0.021) * 0.6 + tNoise(tw.xz * 0.0045 + 3.7) * 0.4;
  float slope = 1.0 - tn.y;
  float distC = length(tw.xz - cameraPosition.xz);
  float farGrass = clamp((macro - 0.34) * 2.4, 0.0, 1.0) * 0.9;
  float tGrass = mix(farGrass * tS(-40.0, -120.0, tw.z), SPL.r, inBox);
  float tWet = SPL.g;
  float tBurn = SPL.b;
  float tTrample = SPL.a;
  float rdx = abs(tw.x - roadXg(tw.z));
  float tRoad = tS(4.4 + tNoise(tw.xz * 0.35) * 1.4, 3.0, rdx) * step(tw.z, -2.5);
  float tRock = tS(0.2, 0.42, slope + (macro - 0.5) * 0.18) + tS(30.0, 70.0, tw.y) * 0.55;
  tRock = clamp(tRock, 0.0, 1.0) * (1.0 - tRoad);
  // anti-tiling mud everywhere; the other layers only where they actually show
  // (weights are zero over most of the field, and a zero-weight mix changes nothing)
  vec3 gX3 = dFdx(tw), gY3 = dFdy(tw);
  vec2 gX = gX3.xz, gY = gY3.xz;
  bool hasTurf = tGrass > 0.002 || tw.z > 40.0, hasRoad = tRoad > 0.002, hasRock = tRock > 0.002;
  NT ntMud = ntSetup(tw.xz / ${f(TS.mud)});
  NT ntTurf, ntAsph, ntRock;
  vec3 mudC = ntSample(tMudA, ntMud).rgb * ${mud.file ? '0.85' : '0.7'} + texture2D(tMudA, tw.xz / ${f(TS.mudMacro)} + 0.37).rgb * ${mud.file ? '0.15' : '0.3'};
  // large-scale tonal drift so the field never reads as one flat material
  mudC *= 0.8 + 0.4 * tNoise(tw.xz * 0.013 + 7.0);
  vec3 turfC = vec3(0.0);
  if (hasTurf) {
    ntTurf = ntSetupD(tw.xz / ${f(TS.turf)} + 31.0, gX / ${f(TS.turf)}, gY / ${f(TS.turf)});
    turfC = ntSample(tTurfA, ntTurf).rgb * mix(0.36, 0.6, tNoise(tw.xz * 0.11));
  }
  vec3 rockC = vec3(0.0);
  if (hasRock) {
    ntRock = ntSetupD(tw.xz / ${f(TS.rock)} + 5.0, gX / ${f(TS.rock)}, gY / ${f(TS.rock)});
    vec3 bw = pow(abs(tn), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
    rockC = textureGrad(tRockA, tw.zy / ${f(TS.rock)}, gX3.zy / ${f(TS.rock)}, gY3.zy / ${f(TS.rock)}).rgb * bw.x
          + ntSample(tRockA, ntRock).rgb * bw.y
          + textureGrad(tRockA, tw.xy / ${f(TS.rock)}, gX3.xy / ${f(TS.rock)}, gY3.xy / ${f(TS.rock)}).rgb * bw.z;
  }
  vec3 asphC = vec3(0.0);
  if (hasRoad) {
    ntAsph = ntSetupD(tw.xz / ${f(TS.asph)} - 17.0, gX / ${f(TS.asph)}, gY / ${f(TS.asph)});
    asphC = ntSample(tAsphA, ntAsph).rgb;
    // faded centre line on the road
    float along = tw.z;
    float paint = (1.0 - tS(0.07, 0.12, abs(tw.x - roadXg(tw.z)))) * step(0.45, fract(along / 7.0)) * tS(0.35, 0.6, tNoise(tw.xz * 0.9));
    asphC = mix(asphC, vec3(0.32, 0.29, 0.2), paint * 0.7);
  }
  // ── behind the base: a patchwork of fields on the valley floor, a dirt track ──
  float rz = tS(40.0, 95.0, tw.z);
  float rRoad = 0.0, rRut = 0.0, fieldW = 0.0, fKind = 0.0, hedge = 0.0;
  vec3 fieldC = vec3(0.0);
  if (rz > 0.0) {
    float rrd = abs(tw.x - rearRoadXg(tw.z));
    rRoad = tS(3.9 + tNoise(tw.xz * 0.3) * 0.9, 2.6, rrd) * tS(24.0, 34.0, tw.z);
    rRut = exp(-pow((rrd - 0.95) / 0.28, 2.0)) * rRoad;
    // plots: a rotated grid, each one ploughed, stubble, meadow or fallow
    vec2 fr = vec2(${Math.cos(0.32).toFixed(6)} * tw.x - ${Math.sin(0.32).toFixed(6)} * tw.z, ${Math.sin(0.32).toFixed(6)} * tw.x + ${Math.cos(0.32).toFixed(6)} * tw.z);
    vec2 fc = fr / vec2(54.0, 36.0);
    vec2 fid = floor(fc), ff = fract(fc);
    float fh = tHash(fid + 3.7);
    fKind = fh < 0.3 ? 0.0 : fh < 0.55 ? 1.0 : fh < 0.85 ? 2.0 : 3.0;
    float edge = min(min(ff.x, 1.0 - ff.x) * 54.0, min(ff.y, 1.0 - ff.y) * 36.0);
    fieldW = rz * tS(0.09, 0.035, slope) * tS(16.0, 7.0, tw.y) * tS(70.0, 110.0, tw.z) * (1.0 - tS(2.2, 6.5, -(rrd - 9.0)));
    float wob = tNoise(tw.xz * 0.21) - 0.5;
    hedge = tS(2.6, 1.0, edge + wob * 1.6) * fieldW;
    float tone = 0.85 + 0.3 * tHash(fid + 9.1);
    if (fKind < 0.5) {
      // ploughed: dark turned earth in furrows along the plot
      float fur = 0.5 + 0.5 * sin(fr.x * 3.1 + wob * 0.6);
      vec2 pu = fr / ${f(TS.plough)};
      vec3 pc = textureGrad(tPloughA, pu, vec2(dot(gX, vec2(${Math.cos(0.32).toFixed(5)}, -${Math.sin(0.32).toFixed(5)})), dot(gX, vec2(${Math.sin(0.32).toFixed(5)}, ${Math.cos(0.32).toFixed(5)}))) / ${f(TS.plough)}, vec2(dot(gY, vec2(${Math.cos(0.32).toFixed(5)}, -${Math.sin(0.32).toFixed(5)})), dot(gY, vec2(${Math.sin(0.32).toFixed(5)}, ${Math.cos(0.32).toFixed(5)}))) / ${f(TS.plough)}).rgb;
      fieldC = ${fileTex('plough') ? 'pc * mix(0.85, 1.0, fur)' : 'mudC * mix(0.55, 0.95, fur) * vec3(0.95, 0.88, 0.8)'} * tone;
    } else if (fKind < 1.5) {
      // stubble: pale, combed in rows
      float row = 0.5 + 0.5 * sin(fr.y * 4.4);
      fieldC = vec3(0.25, 0.21, 0.135) * mix(0.75, 1.05, row) * (0.8 + 0.4 * tNoise(tw.xz * 0.6)) * tone;
    } else if (fKind < 2.5) {
      fieldC = mix(mudC, turfC + vec3(0.02, 0.025, 0.0), 0.85) * tone;
    } else {
      fieldC = mix(mudC * 0.9, turfC * 0.8, tS(0.35, 0.65, tNoise(tw.xz * 0.09))) * tone;
    }
  }
  if (rz > 0.0) {
    // meadow grass over the hills, thinning on the steep bits
    float rg = clamp((macro - 0.22) * 2.2, 0.0, 1.0) * (1.0 - tS(0.25, 0.45, slope)) * rz;
    tGrass = mix(tGrass, max(tGrass, rg), rz) * (1.0 - rRoad);
    tTrample *= 1.0 - rz;
  }
  vec3 tcol = mudC;
  tcol = mix(tcol, turfC, tGrass);
  if (rz > 0.0) {
    tcol = mix(tcol, fieldC, fieldW * (1.0 - rRoad));
    tcol = mix(tcol, turfC * vec3(0.55, 0.6, 0.45), hedge * 0.85);
    // the track: wet packed mud, two darker ruts, a grassy crown
    vec3 trackC = ${fileTex('track') ? `textureGrad(tTrackA, tw.xz / ${f(TS.track)}, gX / ${f(TS.track)}, gY / ${f(TS.track)}).rgb` : 'mudC * vec3(0.82, 0.78, 0.72)'};
    trackC = mix(trackC, mudC * 0.45, rRut / max(rRoad, 1e-3) * 0.8);
    trackC = mix(trackC, turfC * 0.7, exp(-pow(abs(tw.x - rearRoadXg(tw.z)) / 0.35, 2.0)) * 0.6);
    tcol = mix(tcol, trackC, rRoad);
  }
  tcol = mix(tcol, asphC, tRoad);
  tcol = mix(tcol, rockC * vec3(0.95, 0.93, 0.9), tRock);
  tcol *= 0.72 + 0.56 * macro;
  tcol *= mix(1.0, 0.22, tBurn);
  tcol *= mix(1.0, 0.55, tTrample * (1.0 - tRoad));
  float puddle = tS(0.5, 0.72, tWet + (tNoise(tw.xz * 0.55) - 0.5) * 0.18) * (1.0 - tRock);
  tcol *= mix(0.78, 0.42, max(tWet * 0.7, puddle));
  diffuseColor.rgb *= tcol;
`)
        .replace('#include <roughnessmap_fragment>', /* glsl */`
  float roughnessFactor = ntSample(tMudR, ntMud).${mud.file ? 'a' : 'g'};
  roughnessFactor = mix(roughnessFactor, 0.93, tGrass);
  roughnessFactor = mix(roughnessFactor, 0.62, tRoad);
  roughnessFactor = mix(roughnessFactor, 0.78, tRock);
  roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.72, tTrample);
  roughnessFactor = max(roughnessFactor, 0.55) * mix(1.0, 0.86, uRain);
  roughnessFactor = mix(roughnessFactor, 0.35, tWet * 0.6);
  roughnessFactor = mix(roughnessFactor, 0.035, puddle);
  roughnessFactor = mix(roughnessFactor, 0.4, rRut * 0.7);
`)
        .replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;', /* glsl */`
  vec3 nMud = ntSample(normalMap, ntMud).xyz * 2.0 - 1.0;
  vec3 mapN = nMud;
  if (hasTurf) mapN = mix(mapN, ntSample(tTurfN, ntTurf).xyz * 2.0 - 1.0, tGrass);
  if (hasRoad) mapN = mix(mapN, ntSample(tAsphN, ntAsph).xyz * 2.0 - 1.0, tRoad);
  if (hasRock) mapN = mix(mapN, (ntSample(tRockN, ntRock).xyz * 2.0 - 1.0) * vec3(1.6, 1.6, 1.0), tRock);
  mapN.xy *= (1.0 - puddle) * (1.0 - 0.35 * tWet);
  if (puddle > 0.01 && distC < 90.0) mapN.xy += rippleN(tw.xz * 1.6, uTime) * puddle * 0.9 * uRain;
`);
    };
    mat.customProgramCacheKey = () => 'lb-terrain';
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
    this.grassUniforms = { uTime: { value: 0 } };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.grassUniforms.uTime;
      sh.vertexShader = 'uniform float uTime;\nvarying float vGrassAO;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        float gd = length(ip.xz - cameraPosition.xz);
        float fade = smoothstep(175.0, 120.0, gd);
        float h = uv.y * uv.y;
        float gust = sin(uTime * 0.9 + ip.x * 0.05 + ip.z * 0.03) * 0.5 + 0.5;
        transformed.x += (sin(uTime * 2.1 + ip.x * 0.7 + ip.z * 0.4) * 0.07 + gust * 0.12) * h;
        transformed.z += cos(uTime * 1.7 + ip.z * 0.6) * 0.05 * h;
        transformed *= fade;
        vGrassAO = uv.y;`);
      sh.fragmentShader = 'varying float vGrassAO;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        diffuseColor.rgb *= 0.35 + 0.65 * vGrassAO;`);
    };
    mat.customProgramCacheKey = () => 'lb-grass';

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
      const mesh = new THREE.InstancedMesh(geo, mat, b.m.length);
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
export const HEIGHT_GLSL = /* glsl */`
uniform sampler2D tLbHeight;
uniform vec4 uLbHBox;
float lbTerrainH(vec2 xz){
  vec2 f = (xz - uLbHBox.xy) / uLbHBox.z;
  vec2 i = clamp(floor(f), vec2(0.0), vec2(uLbHBox.w - 2.0));
  vec2 t = clamp(f - i, 0.0, 1.0);
  ivec2 ii = ivec2(i);
  float a = texelFetch(tLbHeight, ii, 0).r;
  float b = texelFetch(tLbHeight, ii + ivec2(1, 0), 0).r;
  float c = texelFetch(tLbHeight, ii + ivec2(0, 1), 0).r;
  float d = texelFetch(tLbHeight, ii + ivec2(1, 1), 0).r;
  return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
}
`;
