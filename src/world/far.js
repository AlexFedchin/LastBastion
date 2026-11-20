// Everything beyond the killing ground: forested hills, a dead village with
// its church, a broken highway viaduct across the valley, power pylons, a
// radio mast, the far mountains and the burning city with its smoke plumes
// and the street fighting still going on inside it.
import * as THREE from 'three';
import { makeRng, lerp } from '../core/util.js';
import { groundH, groundNormal, heightFn, roadX, valleyEdge, vnoise } from './terrain.js';
import { box, cylY, merge, xf, worldUV, makePylonGeo, sagWire, weather } from './kit.js';
import { placeModel } from './vehicles.js';
import { placeTree } from './flora.js';
import { FOG_CUSTOM_GLSL, fogUniforms } from '../render/atmosphere.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

// ── smoke plume shader (cylindrical billboard, wind-bent) ───────────────────
const PLUME_VERT = /* glsl */`
uniform float uTime;
uniform vec2 uWind;
attribute vec4 iP;   // x, y, z, seed
attribute vec4 iS;   // width, height, lit, unused
varying vec2 vUv;
varying float vSeed;
varying float vLit;
varying float vFog;
varying vec3 vFogCol;
${FOG_CUSTOM_GLSL}
void main(){
  vec3 c = iP.xyz;
  vec2 tc = normalize(cameraPosition.xz - c.xz + 1e-4);
  vec3 right = vec3(tc.y, 0.0, -tc.x);
  float y = position.y;
  float w = iS.x * mix(0.25, 1.0, pow(y, 0.6));
  vec3 p = c + right * position.x * w + vec3(0.0, y * iS.y, 0.0);
  p.xz += uWind * pow(y, 1.6) * iS.y * 0.55;
  vUv = vec2(position.x + 0.5, y);
  vSeed = iP.w; vLit = iS.z;
  vec4 f = lbFog(p, cameraPosition, lbFogColor, lbTime, lbDawn);
  vFog = 1.0 - exp(log(max(1.0 - f.a, 1e-4)) * 0.5);
  vFogCol = f.rgb;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const PLUME_FRAG = /* glsl */`
uniform float uTime;
uniform float uBurn;
uniform float uDawn;
varying vec2 vUv;
varying float vSeed;
varying float vLit;
varying float vFog;
varying vec3 vFogCol;
float pHash(vec2 p){ p = fract(p * vec2(127.1, 311.7)); p += dot(p, p + 34.5); return fract(p.x * p.y); }
float pNoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(pHash(i), pHash(i + vec2(1.0, 0.0)), u.x), mix(pHash(i + vec2(0.0, 1.0)), pHash(i + vec2(1.0, 1.0)), u.x), u.y); }
float pFbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ v += a * pNoise(p); p = p * 2.02 + 7.7; a *= 0.5; } return v; }
void main(){
  float t = uTime * 0.035;
  vec2 q = vec2(vUv.x * 2.2, vUv.y * 3.0 - t * 2.0) + vSeed * 13.0;
  float n = pFbm(q + vec2(pFbm(q * 0.7 + t), 0.0) * 0.8);
  float x = (vUv.x - 0.5) * 2.0;
  float body = 1.0 - smoothstep(0.35, 1.0, abs(x + (n - 0.5) * 0.9));
  body *= smoothstep(0.0, 0.06, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
  float a = clamp(body * (0.45 + n * 0.9), 0.0, 1.0) * 0.92;
  // lit from below by the fires, sooty above
  float lit = exp(-vUv.y * 6.0) * vLit * uBurn * (0.6 + n * 0.6) * (1.0 - uDawn * 0.7);
  vec3 col = mix(vec3(0.012, 0.011, 0.011), vec3(0.05, 0.048, 0.05), uDawn) * (0.7 + n * 0.6) + vec3(0.9, 0.28, 0.06) * lit;
  col = mix(col, vFogCol, vFog);
  gl_FragColor = vec4(col, a * (1.0 - vFog * 0.5));
}`;

/** A burnt pine: a bare pole and a few snapped limbs. */
export function makeDeadPineGeo() {
  return merge([
    xf(new THREE.CylinderGeometry(0.12, 0.35, 12, 5), 0, 6, 0),
    box(2.2, 0.12, 0.12, 0.6, 7, 0, 0, 0.3, 0.2), box(1.8, 0.1, 0.1, -0.4, 8.6, 0, 0, 1.9, -0.25),
    box(1.4, 0.1, 0.1, 0.3, 10, 0, 0, 3.6, 0.3), box(2.4, 0.12, 0.12, -0.5, 5.6, 0, 0, 4.4, -0.15),
  ]);
}

export function buildFar(env) {
  const { scene, mats, fire } = env;
  const q = env.quality;
  const rng = makeRng(9090);

  // ── forests on the hills ────────────────────────────────────────────────
  const deadPine = makeDeadPineGeo();
  const NT = q.texSize >= 1024 ? 5200 : 2600;
  const cMs = [], dMs = [];
  let tries = 0;
  while (cMs.length + dMs.length < NT && tries < NT * 12) {
    tries++;
    const x = (rng() - 0.5) * 2900, z = rng() < 0.16 ? 90 + rng() * 700 : -150 - rng() * 1400;
    if (z > 0) continue; // the country behind the base is dressed in rear.js
    const inField = Math.abs(x) < valleyEdge(z, x) + 8 && z > -430;
    if (inField) continue;
    if (z < -930 && Math.abs(x) < 820) continue; // the city
    if (Math.abs(x - roadX(z)) < 14) continue;
    const dens = vnoise(x * 0.0055 + 3, z * 0.0055);
    if (dens < 0.42 + rng() * 0.2) continue;
    const y = heightFn(x, z);
    if (y < 2.5) continue;
    const gn = [0, 1, 0];
    groundNormal(x, z, gn);
    if (gn[1] < 0.72) continue;
    const s = 0.75 + rng() * 0.8;
    const dead = rng() < 0.38 + (z > -500 ? 0.4 : 0);
    _q.setFromEuler(new THREE.Euler((rng() - 0.5) * 0.08, rng() * 6.28, (rng() - 0.5) * 0.08));
    _m.compose(_v.set(x, y - 0.4, z), _q, _s.set(s, s * (0.85 + rng() * 0.4), s));
    (dead ? dMs : cMs).push(_m.clone());
  }
  // the living woods: the tree pack's spruce, pine and birch (low-poly cards: hills only)
  for (const m of cMs) placeTree(env, m, 'far');
  const dead = new THREE.InstancedMesh(deadPine, mats.charred, dMs.length);
  dMs.forEach((m, i) => dead.setMatrixAt(i, m));
  scene.add(dead);

  // ── a dead village on the left hills, a hamlet on the right ─────────────
  const village = (cx, cz, n, seed) => {
    const r = makeRng(seed);
    for (let k = 0; k < n; k++) {
      const a = r() * 6.28, d = Math.sqrt(r()) * 60;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d * 0.7;
      const w = 6 + r() * 5, dd = 5 + r() * 4, h = 3 + r() * 3;
      r(); // (was the roof's pitch: keeps the village where it was)
      const ry = r() * 6.28;
      const y = groundH(x, z) - 0.5;
      // the house model, sized by the plot; some have lost their roofs to the fires
      const burnt = r() < 0.3;
      const o = new THREE.Object3D();
      o.position.set(x, y + 0.25, z); o.rotation.y = ry; o.scale.setScalar(0.7 + (w - 6) / 5 * 0.3);
      placeModel(env, 'house', o, burnt ? { skip: 'roof' } : undefined);
      if (r() < 0.22) fire.add(x, y + h * 0.6, z, w * 0.7, h * 1.6, 3.2, { smoke: 0, glow: false, fogScale: 0.75 });
      if (r() < 0.08) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.1), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.2, 0.45) }));
        const k = 0.7 + (w - 6) / 5 * 0.3;
        win.position.set(x + Math.sin(ry) * 4.4 * k, y + 0.25 + 1.55 * k, z + Math.cos(ry) * 4.4 * k);
        win.rotation.y = ry;
        scene.add(win);
        env.flickerWindows.push(win);
      }
    }
    // the church (app/models/church.glb), its bell tower standing beside the nave
    {
      const x = cx + 20, z = cz - 12, o = new THREE.Object3D();
      o.position.set(x, groundH(x, z) - 0.4, z); o.rotation.y = 0.35 + seed * 1.9;
      placeModel(env, 'church', o);
    }
  };
  village(-430, -610, 16, 1);
  village(520, -470, 9, 2);

  // ── the broken viaduct ───────────────────────────────────────────────────
  {
    const G = [];
    const zb = (x) => -505 + x * 0.1;
    const deckY = 30;
    const gapA = -66, gapB = -18;
    let xStart = -560, xEnd = 600;
    for (let x = -560; x < 0; x += 5) if (heightFn(x, zb(x)) < deckY - 1) { xStart = x; break; }
    for (let x = 600; x > 0; x -= 5) if (heightFn(x, zb(x)) < deckY - 1) { xEnd = x; break; }
    const span = (x0, x1, tilt = 0, drop = 0) => {
      const len = x1 - x0, cx = (x0 + x1) / 2;
      const ang = Math.atan(0.1);
      const g = merge([
        box(len, 1.6, 13, 0, 0, 0),
        box(len, 1.1, 0.35, 0, 1.3, 6.3), box(len, 1.1, 0.35, 0, 1.3, -6.3),
        box(len, 0.25, 0.2, 0, 0.9, 0),
      ]);
      g.rotateZ(tilt);
      g.rotateY(-ang);
      g.translate(cx, deckY - drop, zb(cx));
      G.push(g);
    };
    span(xStart - 10, gapA);
    span(gapB, xEnd + 10);
    // collapsed pieces hanging into the gap
    span(gapA - 2, gapA + 16, -0.55, 6.5);
    span(gapB - 14, gapB + 2, 0.7, 7.5);
    for (let x = xStart + 20; x < xEnd - 10; x += 46) {
      if (x > gapA - 6 && x < gapB + 6) continue;
      const z = zb(x), gy = heightFn(x, z);
      const h = deckY - gy + 2;
      if (h < 3) continue;
      G.push(box(3.2, h, 5.5, x, gy - 2 + h / 2, z));
      G.push(box(4.2, 1.4, 12, x, deckY - 1.4, z));
    }
    const vMat = weather(new THREE.MeshStandardMaterial({ map: env.tex.concrete.map, normalMap: env.tex.concrete.normalMap, color: 0x8a8680, roughness: 0.95 }), { soot: 0.5, key: 'viaduct' });
    const via = new THREE.Mesh(env.tex.concrete.file ? worldUV(merge(G), 4.0) : merge(G), vMat);
    scene.add(via);
    // rebar dangling from the broken ends
    const R = [];
    for (let k = 0; k < 10; k++) {
      const x = gapA + 14 + rng() * 2, z = zb(x) + (rng() - 0.5) * 11;
      R.push(sagWire(new THREE.Vector3(x, deckY - 6, z), new THREE.Vector3(x + 2 + rng() * 3, deckY - 12 - rng() * 6, z + (rng() - 0.5) * 2), -0.6, 0.06, 6));
    }
    scene.add(new THREE.Mesh(merge(R), mats.darkSteel));
    // a burning truck stranded on the deck
    fire.add(110, deckY + 1.5, zb(110), 4, 7, 4, { smoke: 0, glow: false, fogScale: 0.7 });
    env.viaductFire = { x: 110, y: deckY + 1.5, z: zb(110) };
  }

  // ── power pylons marching across the far valley ──────────────────────────
  {
    const pyl = makePylonGeo(30);
    const tops = [];
    const ms = [];
    for (let k = 0; k <= 16; k++) {
      const x = -1250 + k * 160, z = -840 + Math.sin(k * 0.7) * 30;
      if (Math.abs(x) < 820 && z < -930) continue;
      const y = heightFn(x, z) - 0.5;
      const lean = k === 9 ? 0.45 : (rng() - 0.5) * 0.04;
      _q.setFromEuler(new THREE.Euler(0, Math.atan2(30, 160) * 0.2, lean));
      _m.compose(_v.set(x, y, z), _q, _s.set(1, 1, 1));
      ms.push(_m.clone());
      tops.push(k === 9 ? null : [-5.6, 5.6].map((dx) => new THREE.Vector3(dx, 26, 0).applyMatrix4(_m)));
    }
    const pm = new THREE.InstancedMesh(pyl, mats.darkSteel, ms.length);
    ms.forEach((m, i) => pm.setMatrixAt(i, m));
    scene.add(pm);
    const C = [];
    for (let k = 0; k + 1 < tops.length; k++) {
      const a = tops[k], b = tops[k + 1];
      if (!a || !b) continue;
      for (let c = 0; c < 2; c++) C.push(sagWire(a[c], b[c], 9, 0.09, 18));
    }
    if (C.length) scene.add(new THREE.Mesh(merge(C), mats.darkSteel));
  }

  // ── radio mast on the right hills ────────────────────────────────────────
  {
    const x = 640, z = -575, y = heightFn(x, z);
    const G = [];
    for (let k = 0; k < 12; k++) {
      const hy = k * 6;
      G.push(box(0.15, 6, 0.15, -0.6, hy + 3, -0.6), box(0.15, 6, 0.15, 0.6, hy + 3, -0.6), box(0.15, 6, 0.15, 0, hy + 3, 0.6));
      G.push(box(1.4, 0.1, 0.1, 0, hy + 1, -0.6, 0, 0, 0.7));
    }
    const mast = new THREE.Mesh(merge(G), mats.darkSteel);
    mast.position.set(x, y, z);
    scene.add(mast);
    for (const hy of [24, 48, 72]) {
      const s = env.makeGlowSprite(0xff1a0a, hy === 72 ? 10 : 7, 2.4, true);
      s.position.set(x, y + hy, z);
      scene.add(s);
      env.blinkers.push({ sprite: s, ph: rng() * 6, rate: 1.1 });
    }
  }

  // ── far mountains beyond everything ──────────────────────────────────────
  buildRanges(env, rng);

  buildCity(env, rng);
}

// ── the far ranges ──────────────────────────────────────────────────────────
// Three ridgelines one behind the other, each the hazier for its distance: a real slope
// up to a crest (so the evening light grades across it) with a crest that is jagged at
// every scale, from the long shoulders down to single crags. In the prologue's long lens
// the sun goes down behind them, so the crests carry what stands on them: woods of
// pines in silhouette, bare snags, a line of pylons and a mast with its red lights.
const RANGES = [
  { r: 2000, h0: 55, h1: 150, fog: 0.36, tone: 0.8, trees: 1, seed: 1, pass: 0.72 },
  { r: 2300, h0: 100, h1: 230, fog: 0.42, tone: 1.0, trees: 0.6, seed: 2, pass: 0.68 },
  { r: 2650, h0: 160, h1: 330, fog: 0.5, tone: 1.15, trees: 0, seed: 3, pass: 0.76 },
];
// where the valley runs out through the ranges, past the city: the gap the sun goes down in
// (the prologue's long lens looks straight down it)
const PASS_A = -0.29, PASS_W = 0.14;
const A0 = -1.75, A1 = 1.75;
const FACE = 520; // how far the face runs out from the crest to its foot

/** The crest of range L at angle a (metres above the valley floor). */
function crest(L, a) {
  const s = a * L.r, o = L.seed * 31.7;
  const ridged = (f, oo) => 1 - Math.abs(2 * vnoise(s / f + oo, o + oo) - 1);
  const big = vnoise(s / 1500 + o, o) * 0.65 + vnoise(s / 640 + o, o + 5) * 0.35;
  let h = L.h0 + L.h1 * Math.pow(big, 1.35) * (0.62 + 0.38 * Math.abs(Math.sin(a * 1.3 + L.seed)));
  h += L.h1 * (0.16 * ridged(260, 3) + 0.07 * ridged(85, 7) + 0.025 * ridged(27, 11));
  h += (vnoise(s / 9 + o, o + 13) - 0.5) * L.h1 * 0.012; // crags
  return h * (1 - L.pass * Math.exp(-(((a - PASS_A) / PASS_W) ** 2)));
}
/** A point on range L's face: angle a, t from its foot (0) to the crest (1). */
function onFace(L, a, t, out = new THREE.Vector3()) {
  const top = crest(L, a), rr = L.r - FACE * (1 - t);
  return out.set(Math.sin(a) * rr, -50 + (top + 50) * (1 - Math.pow(1 - t, 1.7)), -Math.cos(a) * rr);
}

function buildRanges(env, rng) {
  const { scene } = env;
  const SEG = 1500, ROWS = [0, 0.18, 0.36, 0.52, 0.66, 0.78, 0.88, 0.95, 1, 1.12];
  const treeMs = [], snagMs = [];
  const col = new THREE.Color();
  for (const L of RANGES) {
    const pos = [], cols = [], idx = [];
    const nr = ROWS.length;
    for (let i = 0; i <= SEG; i++) {
      const a = lerp(A0, A1, i / SEG);
      const sa = Math.sin(a), ca = -Math.cos(a);
      const top = crest(L, a), s = a * L.r;
      for (let j = 0; j < nr; j++) {
        const t = ROWS[j];
        // up the face from its foot to the crest (t = 1), and a little way down the far side
        const back = t > 1;
        const rr = back ? L.r + 180 : L.r - FACE * (1 - t);
        const rise = back ? top - 70 : -50 + (top + 50) * (1 - Math.pow(1 - t, 1.7));
        const bump = back || t === 1 ? 0 : (vnoise(s / 70 + j * 1.7, L.seed * 9 + j) - 0.5) * 26 * (1 - t * 0.7);
        pos.push(sa * rr, rise + bump, ca * rr);
        // woods (dark, a little green) and bare rock and scree (greyer) in patches, the crests barest
        const wood = vnoise(s / 160 + j * 0.3, L.seed * 4) > 0.48 + t * 0.12;
        const k = L.tone * (0.85 + vnoise(s / 40, j + L.seed) * 0.3);
        if (wood) col.setRGB(0.0052 * k, 0.0062 * k, 0.0048 * k); else col.setRGB(0.0095 * k, 0.0092 * k, 0.0095 * k);
        cols.push(col.r, col.g, col.b);
      }
      if (i < SEG) for (let j = 0; j < nr - 1; j++) {
        const b = i * nr + j;
        idx.push(b, b + nr, b + 1, b + 1, b + nr, b + nr + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mm = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 1, side: THREE.DoubleSide });
    farFog(mm, L.fog);
    const mtn = new THREE.Mesh(g, mm);
    mtn.frustumCulled = false;
    scene.add(mtn);

    // the woods on the crest and the top of the face: pines, and the odd dead snag
    if (L.trees > 0) {
      for (let i = 0; i < 9000; i++) {
        const a = lerp(A0, A1, rng());
        if (vnoise(a * L.r / 210, L.seed * 17) < 0.42 + (1 - L.trees) * 0.25) continue;
        const t = 1 - Math.pow(rng(), 2.2) * 0.3; // mostly along the crest itself
        onFace(L, a, t, _v);
        _v.y -= 1.5;
        const sc = (0.75 + rng() * 0.7) * (L.r / 2000);
        _q.setFromEuler(new THREE.Euler((rng() - 0.5) * 0.1, rng() * 6.28, (rng() - 0.5) * 0.1));
        _m.compose(_v, _q, _s.set(sc, sc * (0.8 + rng() * 0.5), sc));
        (rng() < 0.12 ? snagMs : treeMs).push([_m.clone(), L]);
      }
    }
  }
  // (one mesh per range, so each takes its range's haze)
  const pine = merge([
    xf(new THREE.CylinderGeometry(0, 3.4, 9, 6), 0, 7.5, 0),
    xf(new THREE.CylinderGeometry(0, 2.6, 8, 6), 0, 12, 0),
    xf(new THREE.CylinderGeometry(0, 1.6, 6, 6), 0, 16.5, 0),
    xf(new THREE.CylinderGeometry(0.25, 0.4, 4, 5), 0, 2, 0),
  ]);
  const snag = makeDeadPineGeo();
  for (const L of RANGES) {
    for (const [geo, list, c] of [[pine, treeMs, 0x050604], [snag, snagMs, 0x070605]]) {
      const ms = list.filter((e) => e[1] === L).map((e) => e[0]);
      if (!ms.length) continue;
      const mat = new THREE.MeshStandardMaterial({ color: c, roughness: 1 });
      farFog(mat, L.fog);
      const im = new THREE.InstancedMesh(geo, mat, ms.length);
      ms.forEach((m, i) => im.setMatrixAt(i, m));
      im.frustumCulled = false;
      scene.add(im);
    }
  }

  const steel = (L) => { const m = new THREE.MeshStandardMaterial({ color: 0x060606, roughness: 1, metalness: 0 }); farFog(m, L.fog); return m; };
  // a power line strung along the nearest crest (one pylon down), and a mast on the second
  {
    const L = RANGES[0], pyl = makePylonGeo(30), ms = [], tops = [];
    for (let k = 0; k < 14; k++) {
      const a = -0.62 + k * 0.042;
      onFace(L, a, 0.97, _v);
      _v.y -= 1;
      _q.setFromEuler(new THREE.Euler(0, -a, k === 8 ? 0.3 : 0));
      _m.compose(_v, _q, _s.set(1.5, 1.5, 1.5));
      ms.push(_m.clone());
      tops.push(k === 8 ? null : [-5.6, 5.6].map((dx) => new THREE.Vector3(dx, 26, 0).applyMatrix4(_m)));
    }
    const mat = steel(L);
    const pm = new THREE.InstancedMesh(pyl, mat, ms.length);
    ms.forEach((m, i) => pm.setMatrixAt(i, m));
    pm.frustumCulled = false;
    scene.add(pm);
    const C = [];
    for (let k = 0; k + 1 < tops.length; k++) {
      const a = tops[k], b = tops[k + 1];
      if (a && b) for (let c = 0; c < 2; c++) C.push(sagWire(a[c], b[c], 14, 0.25, 18));
    }
    if (C.length) { const w = new THREE.Mesh(merge(C), mat); w.frustumCulled = false; scene.add(w); }
  }
  {
    const L = RANGES[1], a = -0.12;
    const p = onFace(L, a, 0.99);
    const G = [];
    for (let k = 0; k < 16; k++) {
      const hy = k * 6;
      G.push(box(0.35, 6, 0.35, -1.2, hy + 3, -1.2), box(0.35, 6, 0.35, 1.2, hy + 3, -1.2), box(0.35, 6, 0.35, 0, hy + 3, 1.2));
      G.push(box(2.6, 0.2, 0.2, 0, hy + 1, -1.2, 0, 0, 0.7));
    }
    const mast = new THREE.Mesh(merge(G), steel(L));
    mast.position.set(p.x, p.y - 3, p.z);
    mast.frustumCulled = false;
    scene.add(mast);
    for (const hy of [32, 64, 96]) {
      const sp = env.makeGlowSprite(0xff1a0a, hy === 96 ? 16 : 11, 2.2, true);
      sp.position.set(p.x, p.y - 3 + hy, p.z);
      scene.add(sp);
      env.blinkers.push({ sprite: sp, ph: rng() * 6, rate: 0.9 });
    }
  }
}

/** The atmosphere's haze on a far material, thinned by `scale` (the far things would be lost in it). */
function farFog(mat, scale) {
  mat.defines = { ...(mat.defines || {}), LB_FOG_SCALE: String(scale) };
}

// ── the burning city ────────────────────────────────────────────────────────
function buildCity(env, rng) {
  const { scene, fire } = env;
  // Every part of a building is built about its own footing and then set in place with the
  // building's lean and turn; each carries the building's id (the windows are hashed on it)
  // and its colour: concrete, brick, sandstone, dark glass.
  const parts = [];
  const tall = [];
  let bid = 0;
  const PALETTE = [
    [0.030, 0.029, 0.027], [0.040, 0.037, 0.032], [0.036, 0.021, 0.015], [0.044, 0.035, 0.024],
    [0.020, 0.022, 0.026], [0.026, 0.026, 0.026], [0.033, 0.026, 0.020],
  ];
  const cityGround = (x, z) => heightFn(x, z) - 1.5;
  let B = []; // the building being put up: [geometry, colour]
  const put = (g, c) => B.push([g, c]);
  const bx = (w, h, d, x, y, z, c, ry = 0) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(0, h / 2, 0); if (ry) g.rotateY(ry); g.translate(x, y, z); put(g, c); };
  const cyl = (r0, r1, h, x, y, z, c, seg = 8) => { const g = new THREE.CylinderGeometry(r0, r1, h, seg); g.translate(x, y + h / 2, z); put(g, c); };
  const gable = (w, h, d, x, y, z, c) => { // a pitched roof along x
    const g = new THREE.CylinderGeometry(1, 1, 1, 3, 1);
    g.rotateZ(Math.PI / 2); g.rotateX(Math.PI / 6);
    g.scale(w, h / 1.5, d / 1.732); g.translate(x, y + h / 3, z); put(g, c);
  };
  const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
  const finish = (x, y, z, ry, rz) => {
    bid++;
    for (const [g, c] of B) {
      if (rz) g.rotateZ(rz);
      if (ry) g.rotateY(ry);
      g.translate(x, y, z);
      const n = (g.index ? g.toNonIndexed() : g);
      n.deleteAttribute('uv');
      const cnt = n.attributes.position.count;
      n.setAttribute('aBld', new THREE.Float32BufferAttribute(new Float32Array(cnt).fill(bid), 1));
      const C = new Float32Array(cnt * 3);
      for (let i = 0; i < cnt; i++) C.set(c, i * 3);
      n.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
      parts.push(n);
    }
    B = [];
  };
  // rooftop clutter: plant rooms, vents, water tanks on legs, aerials, the odd billboard
  const roof = (w, d, top, c, big) => {
    const n = big ? 2 + ((rng() * 3) | 0) : (rng() < 0.6 ? 1 : 0);
    for (let k = 0; k < n; k++) bx(2 + rng() * w * 0.25, 1.5 + rng() * 3.5, 2 + rng() * d * 0.25, (rng() - 0.5) * w * 0.6, top, (rng() - 0.5) * d * 0.6, shade(c, 0.85));
    if (rng() < 0.45) {
      const tx = (rng() - 0.5) * w * 0.5, tz = (rng() - 0.5) * d * 0.5, r = 1.6 + rng() * 1.4, lh = 2.5 + rng() * 2;
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) bx(0.25, lh, 0.25, tx + dx * r * 0.7, top, tz + dz * r * 0.7, [0.02, 0.018, 0.016]);
      cyl(r, r, r * 1.8, tx, top + lh, tz, [0.035, 0.026, 0.02]);
      cyl(0, r * 1.05, r * 0.6, tx, top + lh + r * 1.8, tz, [0.03, 0.022, 0.017]);
    }
    if (rng() < 0.35) for (let k = 0; k < 1 + ((rng() * 3) | 0); k++) bx(0.2, 4 + rng() * 9, 0.2, (rng() - 0.5) * w * 0.7, top, (rng() - 0.5) * d * 0.7, [0.02, 0.02, 0.02]);
    if (rng() < 0.12 && w > 14) {
      const bw = Math.min(w * 0.8, 10 + rng() * 8), ry = rng() < 0.5 ? 0 : Math.PI / 2;
      bx(0.3, 3, 0.3, -bw * 0.4, top, 0, [0.02, 0.02, 0.02], ry); bx(0.3, 3, 0.3, bw * 0.4, top, 0, [0.02, 0.02, 0.02], ry);
      bx(bw, bw * 0.35, 0.4, 0, top + 3, 0, [0.05, 0.045, 0.04], ry);
    }
  };
  const building = (x, z, w, d, h, opts = {}) => {
    const y = cityGround(x, z);
    const ry = opts.ry || 0, rz = opts.tilt || 0;
    const c0 = PALETTE[(rng() * PALETTE.length) | 0], c = shade(c0, 0.8 + rng() * 0.4);
    if (opts.broken) {
      // gutted: a stump of the block, then the bare frame of the floors above it, slabs
      // hanging off at angles and the columns standing up out of them
      const sh = h * (0.35 + rng() * 0.25);
      bx(w, sh, d, 0, 0, 0, c);
      const fl = Math.floor((h - sh) / 3.8);
      for (let k = 1; k <= fl; k++) {
        const kw = w * (1 - k / (fl + 2)) * (0.6 + rng() * 0.4), kd = d * (0.5 + rng() * 0.5);
        const g = new THREE.BoxGeometry(kw, 0.5, kd);
        g.rotateZ((rng() - 0.5) * 0.25 * (k / fl));
        g.translate((rng() - 0.5) * (w - kw), sh + k * 3.8, (rng() - 0.5) * (d - kd));
        put(g, shade(c, 0.8));
      }
      for (let k = 0; k < 6; k++) bx(0.7, sh + (h - sh) * (0.3 + rng() * 0.7), 0.7, (rng() - 0.5) * w * 0.9, 0, (rng() - 0.5) * d * 0.9, shade(c, 0.7));
      finish(x, y, z, ry, rz);
      return;
    }
    bx(w, h, d, 0, 0, 0, c);
    let top = h;
    if (h < 22) {
      // low-rise: a parapet round the flat roof, or a pitched roof
      if (rng() < 0.4 && w < 26) gable(w + 0.6, 3 + rng() * 3, d + 0.6, 0, h, 0, [0.03, 0.017, 0.013]);
      else { bx(w, 1.1, 0.4, 0, h, d / 2 - 0.2, c); bx(w, 1.1, 0.4, 0, h, -d / 2 + 0.2, c); bx(0.4, 1.1, d, w / 2 - 0.2, h, 0, c); bx(0.4, 1.1, d, -w / 2 + 0.2, h, 0, c); roof(w, d, h, c, false); }
      finish(x, y, z, ry, rz);
      return;
    }
    // cornices every few floors and a heavier one at the top (the older blocks); towers
    // instead get vertical fins up their faces
    const tower = h > 70;
    if (!tower || rng() < 0.3) {
      const every = (3 + ((rng() * 4) | 0)) * 3.8;
      for (let yy = every; yy < h - 2; yy += every) bx(w + 0.5, 0.45, d + 0.5, 0, yy, 0, shade(c, 1.15));
      bx(w + 1.2, 1.4, d + 1.2, 0, h - 1.4, 0, shade(c, 1.2));
    } else {
      const nf = 4 + ((rng() * 5) | 0);
      for (let k = 0; k <= nf; k++) {
        const u = -0.5 + k / nf;
        bx(0.5, h, 0.9, u * w, 0, d / 2 + 0.4, shade(c, 1.25)); bx(0.5, h, 0.9, u * w, 0, -d / 2 - 0.4, shade(c, 1.25));
        bx(0.9, h, 0.5, w / 2 + 0.4, 0, u * d, shade(c, 1.25)); bx(0.9, h, 0.5, -w / 2 - 0.4, 0, u * d, shade(c, 1.25));
      }
    }
    if (tower) {
      // setbacks, and a crown: a spire, a mast or a plain plant floor
      const tiers = 1 + ((rng() * 2.5) | 0);
      let tw = w, td = d;
      for (let k = 0; k < tiers; k++) {
        tw *= 0.62 + rng() * 0.2; td *= 0.62 + rng() * 0.2;
        const th = h * (0.12 + rng() * 0.15);
        bx(tw, th, td, 0, top, 0, shade(c, 0.95));
        bx(tw + 0.8, 0.6, td + 0.8, 0, top + th - 0.6, 0, shade(c, 1.2));
        top += th;
      }
      const crown = rng();
      if (crown < 0.3) { cyl(0, Math.min(tw, td) * 0.45, 18 + rng() * 22, 0, top, 0, shade(c, 1.1), 4); }
      else if (crown < 0.65) { bx(1, 30 + rng() * 30, 1, 0, top, 0, [0.02, 0.02, 0.02]); for (let k = 0; k < 3; k++) bx(0.3, 8 + rng() * 10, 0.3, (rng() - 0.5) * tw * 0.6, top, (rng() - 0.5) * td * 0.6, [0.02, 0.02, 0.02]); }
      else roof(tw, td, top, c, true);
      const T = new THREE.Vector3(0, top, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), rz);
      tall.push([x + T.x, y + T.y, z, rz]);
    } else roof(w, d, top, c, true);
    finish(x, y, z, ry, rz);
  };
  // the blocks on a rough grid, cut up by the streets; downtown's towers in the middle
  for (let gx = -19; gx <= 19; gx++) {
    for (let gz = 0; gz < 9; gz++) {
      if (rng() < 0.08) continue; // a burnt-out lot
      const bxc = gx * 44 + (rng() - 0.5) * 8, bzc = -990 - gz * 46 - (rng() - 0.5) * 8;
      // (downtown stands just right of the pass: in the long lens the towers frame the setting sun)
      const down = Math.exp(-Math.pow((bxc + 70) / 210, 2)) * Math.exp(-Math.pow((bzc + 1150) / 130, 2));
      const big = down > 0.35 && rng() < 0.75;
      // a block is one big building downtown, two or four smaller ones out of it
      const split = big ? 1 : rng() < 0.45 ? 2 : 4;
      for (let k = 0; k < split; k++) {
        const ox = split === 1 ? 0 : (k % 2 - 0.5) * 17, oz = split === 4 ? ((k >> 1) - 0.5) * 17 : 0;
        const lw = split === 1 ? 32 : 15, ld = split === 4 ? 15 : 32;
        if (split > 1 && rng() < 0.12) continue;
        const x = bxc + ox, z = bzc + oz;
        // (and a midtown of older blocks in the pass's line, tall enough to stand over the viaduct
        // in the long lens: the sun goes down behind their ragged roofline)
        const mid = Math.exp(-Math.pow((x + 340) / 150, 2)) * Math.exp(-Math.pow((z + 1170) / 150, 2));
        const h = 9 + Math.pow(rng(), 1.8) * (split === 4 ? 18 : 34) + down * (30 + rng() * 120) * (big ? 1 : 0.35) + mid * (22 + rng() * 38);
        const w = lw * (0.7 + rng() * 0.3), d = ld * (0.7 + rng() * 0.3);
        const tilt = rng() < 0.06 ? (rng() - 0.5) * 0.35 : 0;
        building(x, z, w, d, h, { broken: rng() < 0.08 && h > 30, tilt, ry: (rng() - 0.5) * 0.08 });
      }
    }
  }
  // the outskirts in front: rows of small houses and sheds with pitched roofs
  for (let i = 0; i < 260; i++) {
    const x = (rng() - 0.5) * 1640, z = -948 - rng() * 36;
    if (Math.abs(x - roadX(z)) < 16) continue;
    const y = cityGround(x, z);
    const w = 7 + rng() * 7, d = 6 + rng() * 5, h = 3 + rng() * 4;
    const c = PALETTE[(rng() * PALETTE.length) | 0];
    bx(w, h, d, 0, 0, 0, c);
    if (rng() < 0.75) gable(w + 0.6, 2 + rng() * 2, d + 0.6, 0, h, 0, [0.028, 0.016, 0.012]);
    finish(x, y, z, (rng() - 0.5) * 0.3, 0);
  }
  // an industrial quarter: smokestacks and a gasholder's frame
  for (const [x, z, h] of [[330, -975, 95], [352, -982, 80], [372, -970, 70], [-470, -985, 85]]) {
    const y = cityGround(x, z);
    cyl(2.6, 4, h, 0, 0, 0, [0.04, 0.026, 0.02], 10);
    for (const yy of [h - 8, h - 14]) cyl(4.1, 4.1, 2.2, 0, yy, 0, [0.06, 0.02, 0.015], 10);
    finish(x, y, z, 0, 0);
  }
  {
    const x = 420, z = -995, y = cityGround(x, z);
    cyl(26, 26, 22, 0, 0, 0, [0.03, 0.03, 0.03], 20);
    for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; bx(0.9, 40, 0.9, Math.cos(a) * 27, 0, Math.sin(a) * 27, [0.025, 0.025, 0.025]); }
    for (const yy of [14, 27, 39]) cyl(27.5, 27.5, 0.9, 0, yy, 0, [0.025, 0.025, 0.025], 20);
    finish(x, y, z, 0, 0);
  }
  // merge keeps aBld only if we do it by hand
  const total = parts.reduce((a, g) => a + g.attributes.position.count, 0);
  const P = new Float32Array(total * 3), N = new Float32Array(total * 3), Bd = new Float32Array(total), Cl = new Float32Array(total * 3);
  let o = 0;
  for (const g of parts) {
    g.computeVertexNormals();
    P.set(g.attributes.position.array, o * 3);
    N.set(g.attributes.normal.array, o * 3);
    Bd.set(g.attributes.aBld.array, o);
    Cl.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
  }
  const cg = new THREE.BufferGeometry();
  cg.setAttribute('position', new THREE.BufferAttribute(P, 3));
  cg.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  cg.setAttribute('aBld', new THREE.BufferAttribute(Bd, 1));
  cg.setAttribute('color', new THREE.BufferAttribute(Cl, 3));
  cg.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.9, metalness: 0.1, emissive: 0xffffff });
  mat.defines = { LB_FOG_SCALE: '0.5' };
  env.cityUniforms = { uTime: { value: 0 }, uDawn: { value: 0 }, uBurn: { value: 1 } };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = env.cityUniforms.uTime;
    sh.uniforms.uDawn = env.cityUniforms.uDawn;
    sh.uniforms.uBurn = env.cityUniforms.uBurn;
    sh.vertexShader = 'attribute float aBld;\nvarying float vBld;\nvarying vec3 vCW;\nvarying vec3 vCN;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vBld = aBld; vCW = (modelMatrix * vec4(transformed, 1.0)).xyz; vCN = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = `uniform float uTime;\nuniform float uDawn;\nuniform float uBurn;\nvarying float vBld;\nvarying vec3 vCW;\nvarying vec3 vCN;
      float cHash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float cNoise(float x){ float i = floor(x), f = fract(x); return mix(cHash(vec3(i, 1.0, 2.0)), cHash(vec3(i + 1.0, 1.0, 2.0)), f * f * (3.0 - 2.0 * f)); }
    ` + sh.fragmentShader.replace('#include <emissivemap_fragment>', `
      {
        vec3 em = vec3(0.0);
        float vert = 1.0 - abs(vCN.y);
        if (vert > 0.5) {
          float hc = abs(vCN.x) > abs(vCN.z) ? vCW.z : vCW.x;
          vec2 cell = vec2(floor(hc / 3.2), floor(vCW.y / 3.8));
          vec2 f = vec2(fract(hc / 3.2), fract(vCW.y / 3.8));
          float win = step(0.18, f.x) * step(f.x, 0.82) * step(0.25, f.y) * step(f.y, 0.78);
          float r = cHash(vec3(cell, vBld));
          float lit = step(0.982, r);
          float fireLit = step(0.985, r);
          float fl = 0.7 + 0.3 * sin(uTime * (3.0 + r * 9.0) + r * 40.0);
          // once the city has stopped burning (env.setStory): no fire in the windows, no glow in
          // the streets, and only the odd lamp left on
          lit *= min(1.0, step(0.996, r) + step(0.3, uBurn));
          em += win * lit * mix(vec3(1.1, 0.55, 0.2), vec3(0.6, 0.65, 0.75), step(0.993, r)) * 0.6;
          em += win * fireLit * vec3(4.0, 1.4, 0.3) * fl * uBurn;
          // burning districts light the facades from street level
          float district = smoothstep(0.55, 0.85, cNoise(vCW.x * 0.006 + 3.0)) * uBurn;
          em += vec3(1.0, 0.35, 0.08) * exp(-max(vCW.y, 0.0) / 28.0) * district * 0.55 * (0.85 + 0.15 * sin(uTime * 2.0 + vCW.x * 0.05));
        }
        totalEmissiveRadiance = em * (1.0 - uDawn * 0.85);
      }`);
  };
  mat.customProgramCacheKey = () => 'lb-city';
  const city = new THREE.Mesh(cg, mat);
  city.frustumCulled = false;
  scene.add(city);

  // aviation lights on the tallest towers
  tall.sort((a, b) => b[1] - a[1]);
  for (const [x, y, z] of tall.slice(0, 14)) {
    const s = env.makeGlowSprite(0xff2410, 9, 2.6, true);
    s.position.set(x, y + 2, z);
    scene.add(s);
    env.blinkers.push({ sprite: s, ph: rng() * 6, rate: 0.8 + rng() * 0.6 });
  }

  // tower cranes (one with its jib snapped)
  const C = [];
  for (const [x, z, broken] of [[-180, -1060, false], [240, -1180, true], [410, -1040, false]]) {
    const y = cityGround(x, z);
    const h = 110 + rng() * 40;
    for (const [dx, dz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) C.push(box(0.5, h, 0.5, x + dx, y + h / 2, z + dz));
    for (let k = 0; k < h / 5; k++) C.push(box(3.4, 0.25, 0.25, x, y + k * 5, z, 0, (k % 2) * Math.PI / 2, 0.6));
    const ry = rng() * 6.28;
    if (!broken) {
      C.push(xf(new THREE.BoxGeometry(70, 2.2, 1.6), x + Math.cos(ry) * 25, y + h, z - Math.sin(ry) * 25, 0, ry));
      C.push(xf(new THREE.BoxGeometry(20, 2.6, 2), x - Math.cos(ry) * 10, y + h, z + Math.sin(ry) * 10, 0, ry));
      C.push(box(6, 5, 4, x - Math.cos(ry) * 18, y + h - 3, z + Math.sin(ry) * 18));
    } else {
      C.push(xf(new THREE.BoxGeometry(60, 2.2, 1.6), x + Math.cos(ry) * 12, y + h - 25, z - Math.sin(ry) * 12, 0, ry, 1.1));
    }
  }
  scene.add(new THREE.Mesh(merge(C), new THREE.MeshStandardMaterial({ color: 0x1c1b1a, roughness: 0.8, metalness: 0.4 })));

  // street fires, district glow and smoke plumes
  env.cityFires = [];
  const plumes = [];
  for (let i = 0; i < 16; i++) {
    const x = (rng() - 0.5) * 1300, z = -995 - rng() * 230;
    const y = cityGround(x, z);
    const big = i < 7;
    const fk = big ? 7 : 5;
    const args = [x, y, z, big ? 50 + rng() * 40 : 22 + rng() * 20, big ? 70 + rng() * 60 : 30 + rng() * 25, fk, { glow: false, fogScale: 0.42, fadeIn: 0 }];
    const fid = fire.add(...args);
    const g = env.makeGlowSprite(0xff5a14, big ? 230 + rng() * 120 : 110, big ? 0.17 : 0.11, false);
    g.position.set(x, y + 30, z + 20);
    g.renderOrder = -3;
    scene.add(g);
    env.cityFires.push({ sprite: g, base: g.material.color.clone(), ph: rng() * 10, fid, fk, big, args });
    if (big) plumes.push([x, y + 20, z, 160 + rng() * 120, 520 + rng() * 380, 1]);
  }
  plumes.push([-640, cityGround(-640, -1100), -1100, 220, 700, 0.6]);
  plumes.push([700, cityGround(700, -1050), -1050, 200, 620, 0.6]);
  const pg = new THREE.InstancedBufferGeometry();
  const plane = new THREE.PlaneGeometry(1, 1, 1, 16);
  plane.translate(0, 0.5, 0);
  pg.index = plane.index;
  pg.setAttribute('position', plane.attributes.position);
  const IP = new Float32Array(plumes.length * 4), IS = new Float32Array(plumes.length * 4);
  plumes.forEach(([x, y, z, w, h, lit], i) => { IP.set([x, y, z, rng()], i * 4); IS.set([w, h, lit, 0], i * 4); });
  pg.setAttribute('iP', new THREE.InstancedBufferAttribute(IP, 4));
  pg.setAttribute('iS', new THREE.InstancedBufferAttribute(IS, 4));
  pg.instanceCount = plumes.length;
  env.plumeUniforms = { uTime: { value: 0 }, uDawn: { value: 0 }, uBurn: { value: 1 }, uWind: { value: new THREE.Vector2(0.55, 0.12) }, ...fogUniforms };
  const plumeMesh = new THREE.Mesh(pg, new THREE.ShaderMaterial({
    uniforms: env.plumeUniforms, vertexShader: PLUME_VERT, fragmentShader: PLUME_FRAG,
    transparent: true, depthWrite: false,
  }));
  plumeMesh.frustumCulled = false;
  plumeMesh.renderOrder = -1;
  scene.add(plumeMesh);

  env.combatSites = [[-260, -1080], [80, -1130], [380, -1060], [-520, -1150], [600, -1200]].map(([x, z]) => ({ x, z, y: cityGround(x, z), t: rng() * 3 }));
}
