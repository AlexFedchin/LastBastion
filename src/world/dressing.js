// Set dressing for the places you look at between waves: the walkway and the
// inner face of the wall, the bunker roof around your gun, and the yard behind
// the wall. Everything is static, so it is built once and merged per material
// (a handful of draw calls in all); sandbags share one instanced mesh.
import * as THREE from 'three';
import { WORLD } from '../config.js';
import { makeRng } from '../core/util.js';
import { groundH } from './terrain.js';
import { box, cylX, cylY, cylZ, merge, xf, pillow, sagWire, extrude, weather, sandbagGeo, makeTruck } from './kit.js';

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);

// keep in step with arsenal.js: where the crews stand on the walkway
const GUNNER_POSTS = [-27, 27, -52, 52];
const RIFLE_POSTS = [-15, 16, -38.5, 39.5, -63, 64];

/** Collects geometry per material and merges it into one mesh per material. */
class Batch {
  constructor() { this.map = new Map(); }
  add(mat, geo, matrix = null) {
    if (matrix) geo.applyMatrix4(matrix);
    if (!this.map.has(mat)) this.map.set(mat, []);
    this.map.get(mat).push(geo);
    return geo;
  }
  /** Add every [mat, geo] of a prefab under one placement matrix. */
  put(prefab, matrix) { for (const [mat, geo] of prefab) this.add(mat, geo, matrix); }
  flush(scene, castMats = new Set()) {
    for (const [mat, geos] of this.map) {
      const mesh = new THREE.Mesh(merge(geos), mat);
      mesh.receiveShadow = true;
      mesh.castShadow = castMats.has(mat);
      mesh.matrixAutoUpdate = false;
      scene.add(mesh);
    }
    this.map.clear();
  }
}

// kit props (Poly Haven scans) go through env.addKit and are instanced once the models load
let kit = () => {};

const place = (x, y, z, ry = 0, rx = 0, rz = 0, s = 1) => {
  _e.set(rx, ry, rz);
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e), _s.set(s, s, s));
};

// ── prefabs: functions returning fresh lists of [material, geometry], origin on the floor ──
function prefabs(M) {
  const P = {};
  // wooden ammo crate with battens and rope handles
  P.crate = (w = 0.9, h = 0.42, d = 0.5) => [
    [M.crate, box(w, h, d, 0, h / 2, 0)],
    [M.crate, box(w + 0.03, 0.05, d + 0.03, 0, h * 0.18, 0)],
    [M.crate, box(w + 0.03, 0.05, d + 0.03, 0, h * 0.82, 0)],
    [M.crate, box(0.05, h + 0.02, d + 0.03, -w / 2 + 0.06, h / 2, 0)],
    [M.crate, box(0.05, h + 0.02, d + 0.03, w / 2 - 0.06, h / 2, 0)],
    [M.dark, box(0.03, 0.04, 0.14, -w / 2 - 0.02, h * 0.6, 0)],
    [M.dark, box(0.03, 0.04, 0.14, w / 2 + 0.02, h * 0.6, 0)],
  ];
  // .50 cal ammo can
  P.can = () => [
    [M.olive, box(0.3, 0.19, 0.15, 0, 0.095, 0)],
    [M.olive, box(0.31, 0.03, 0.16, 0, 0.2, 0)],
    [M.dark, box(0.12, 0.02, 0.03, 0, 0.225, 0)],
    [M.dark, box(0.02, 0.06, 0.12, 0.155, 0.17, 0)],
  ];
  P.jerry = (mat = M.olive) => [
    [mat, box(0.17, 0.44, 0.34, 0, 0.22, 0)],
    [mat, box(0.18, 0.02, 0.35, 0, 0.15, 0)],
    [mat, box(0.18, 0.02, 0.35, 0, 0.3, 0)],
    [M.dark, box(0.04, 0.05, 0.2, 0, 0.47, -0.04)],
    [M.dark, cylY(0.03, 0.06, 8, 0, 0.46, 0.12)],
  ];
  P.stretcher = () => [
    [M.dark, cylX(0.02, 2.2, 6, 0, 0.12, -0.27)],
    [M.dark, cylX(0.02, 2.2, 6, 0, 0.12, 0.27)],
    [M.canvas, box(1.8, 0.02, 0.52, 0, 0.12, 0)],
    [M.dark, box(0.03, 0.12, 0.6, -0.8, 0.06, 0)],
    [M.dark, box(0.03, 0.12, 0.6, 0.8, 0.06, 0)],
  ];
  P.duffel = () => [[M.canvas, xf(pillow(0.75, 0.3, 0.32, 0.55, 12, 8), 0, 0.15, 0)]];
  P.roll = () => [[M.canvasDark, xf(new THREE.CylinderGeometry(0.15, 0.15, 0.7, 10), 0, 0.15, 0, 0, 0, Math.PI / 2)]];
  // spare MG barrel in its bag
  P.barrelBag = () => [[M.canvasDark, xf(pillow(1.4, 0.12, 0.14, 0.5, 10, 6), 0, 0.06, 0)], [M.dark, cylX(0.025, 0.25, 6, 0.78, 0.07, 0)]];
  P.extinguisher = () => [[M.red, cylY(0.08, 0.5, 10, 0, 0.25, 0)], [M.dark, cylY(0.03, 0.08, 6, 0, 0.54, 0)], [M.dark, box(0.12, 0.02, 0.03, 0.04, 0.58, 0)]];
  P.pallet = () => {
    const L = [];
    for (let k = 0; k < 7; k++) L.push([M.crate, box(0.1, 0.025, 1.0, -0.54 + k * 0.18, 0.135, 0)]);
    for (const z of [-0.45, 0, 0.45]) L.push([M.crate, box(1.2, 0.1, 0.1, 0, 0.07, z)]);
    for (const z of [-0.45, 0.45]) L.push([M.crate, box(1.2, 0.025, 0.1, 0, 0.012, z)]);
    return L;
  };
  // pallet load under a strapped tarp
  P.load = () => [
    ...P.pallet(),
    [M.canvas, xf(pillow(1.2, 0.85, 1.0, 0.22, 12, 8), 0, 0.58, 0)],
    [M.dark, box(0.04, 0.9, 1.04, -0.3, 0.58, 0)],
    [M.dark, box(0.04, 0.9, 1.04, 0.3, 0.58, 0)],
  ];
  P.phone = () => [[M.olive, box(0.26, 0.14, 0.2, 0, 0.07, 0)], [M.dark, box(0.18, 0.04, 0.05, 0, 0.16, 0)]];
  P.reel = () => [[M.dark, cylZ(0.22, 0.03, 12, 0, 0.22, -0.13)], [M.dark, cylZ(0.22, 0.03, 12, 0, 0.22, 0.13)], [M.rubber, cylZ(0.17, 0.24, 12, 0, 0.22, 0)], [M.dark, box(0.05, 0.25, 0.32, 0, 0.12, 0)]];
  // hurricane lantern with a steady glow
  P.lantern = () => [[M.dark, cylY(0.07, 0.03, 8, 0, 0.015, 0)], [M.lamp, cylY(0.055, 0.14, 8, 0, 0.1, 0)], [M.dark, cylY(0.06, 0.04, 8, 0, 0.19, 0)], [M.dark, xf(new THREE.TorusGeometry(0.06, 0.006, 4, 10, Math.PI), 0, 0.22, 0)]];
  P.burnBarrel = () => [[M.rust, cylY(0.29, 0.88, 14, 0, 0.44, 0)], [M.rust, cylY(0.3, 0.03, 14, 0, 0.3, 0)], [M.rust, cylY(0.3, 0.03, 14, 0, 0.6, 0)], [M.ember, cylY(0.27, 0.02, 12, 0, 0.84, 0)]];
  // concrete jersey barrier, 2.9 m long along z
  P.jersey = () => [[M.concrete, extrude([[-0.3, 0], [0.3, 0], [0.3, 0.08], [0.11, 0.32], [0.08, 0.81], [-0.08, 0.81], [-0.11, 0.32], [-0.3, 0.08]], 2.9, 0.01)]];
  P.loo = (mat) => [[mat, box(1.1, 2.2, 1.1, 0, 1.1, 0)], [mat, box(1.2, 0.08, 1.2, 0, 2.24, 0)], [M.dark, cylY(0.05, 0.25, 6, 0.3, 2.35, 0.3)], [M.dark, box(0.05, 0.1, 0.02, 0.4, 1.1, 0.56)]];
  // water tank on a steel stand
  P.tank = () => {
    const L = [[M.paintWhite, cylY(1.3, 2.2, 18, 0, 4.1, 0)], [M.paintWhite, xf(new THREE.SphereGeometry(1.3, 18, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0, 5.2, 0, 0, 0, 0, 1, 0.3, 1)]];
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) L.push([M.steel, box(0.12, 3.0, 0.12, sx * 0.9, 1.5, sz * 0.9)]);
    for (const y of [1.0, 2.2]) {
      L.push([M.steel, box(1.9, 0.07, 0.07, 0, y, 0.9)], [M.steel, box(1.9, 0.07, 0.07, 0, y, -0.9)]);
      L.push([M.steel, box(0.07, 0.07, 1.9, 0.9, y, 0)], [M.steel, box(0.07, 0.07, 1.9, -0.9, y, 0)]);
    }
    L.push([M.dark, cylY(0.07, 3.0, 8, 0.4, 1.5, 0.4)]);
    return L;
  };
  // a soldier: warming his hands (pose 0) or standing sentry, rifle slung (pose 1). Faces +z.
  P.soldier = (pose = 0) => {
    const L = [];
    const seg = (mat, r0, r1, a, b) => {
      const A = new THREE.Vector3(...a), Bv = new THREE.Vector3(...b);
      const len = A.distanceTo(Bv);
      const g = new THREE.CylinderGeometry(r1, r0, len, 8);
      g.translate(0, len / 2, 0);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), Bv.clone().sub(A).normalize()));
      g.translate(A.x, A.y, A.z);
      L.push([mat, g]);
    };
    seg(M.uniform, 0.08, 0.07, [0.1, 0, 0.02], [0.1, 0.48, 0]); seg(M.uniform, 0.08, 0.09, [0.1, 0.48, 0], [0.1, 0.92, 0]);
    seg(M.uniform, 0.08, 0.07, [-0.1, 0, -0.02], [-0.1, 0.48, 0]); seg(M.uniform, 0.08, 0.09, [-0.1, 0.48, 0], [-0.1, 0.92, 0]);
    seg(M.uniform, 0.16, 0.19, [0, 0.9, 0], [0, 1.4, 0.02]);
    L.push([M.gear, box(0.4, 0.34, 0.3, 0, 1.17, 0)], [M.gear, box(0.38, 0.06, 0.28, 0, 0.93, 0)], [M.gear, box(0.3, 0.36, 0.14, 0, 1.2, -0.2)]);
    L.push([M.skin, xf(new THREE.SphereGeometry(0.105, 10, 8), 0, 1.58, 0.02)]);
    L.push([M.helmet, xf(new THREE.SphereGeometry(0.145, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0, 1.63, 0, 0, 0, 0, 1, 0.85, 1.1)]);
    L.push([M.dark, box(0.1, 0.05, 0.24, 0.1, 0.03, 0.05)], [M.dark, box(0.1, 0.05, 0.24, -0.1, 0.03, 0.05)]);
    if (pose === 0) {
      seg(M.uniform, 0.05, 0.045, [0.2, 1.35, 0], [0.22, 1.12, 0.2]); seg(M.uniform, 0.045, 0.04, [0.22, 1.12, 0.2], [0.1, 1.15, 0.45]);
      seg(M.uniform, 0.05, 0.045, [-0.2, 1.35, 0], [-0.22, 1.12, 0.2]); seg(M.uniform, 0.045, 0.04, [-0.22, 1.12, 0.2], [-0.1, 1.15, 0.45]);
    } else {
      seg(M.uniform, 0.05, 0.045, [0.21, 1.35, 0], [0.24, 1.05, 0.02]); seg(M.uniform, 0.045, 0.04, [0.24, 1.05, 0.02], [0.24, 0.8, 0.06]);
      seg(M.uniform, 0.05, 0.045, [-0.21, 1.35, 0], [-0.2, 1.1, 0.12]); seg(M.uniform, 0.045, 0.04, [-0.2, 1.1, 0.12], [-0.05, 1.25, 0.18]);
      L.push([M.dark, box(0.05, 0.08, 0.95, 0.12, 1.15, -0.22, 1.1, 0, 0.1)]);
    }
    return L;
  };
  return P;
}

function materials(env) {
  const { mats, tex } = env;
  return {
    olive: mats.olive, dark: mats.darkSteel, steel: mats.steel, rubber: mats.rubber, concrete: mats.concrete,
    canvas: mats.canvas, paintWhite: mats.paintWhite,
    crate: weather(new THREE.MeshStandardMaterial({ map: tex.planks.map, normalMap: tex.planks.normalMap, color: 0x8a7656, roughness: 0.9 }), { soot: 0.35, key: 'crate' }),
    canvasDark: weather(new THREE.MeshStandardMaterial({ map: tex.burlap, color: 0x3f4231, roughness: 1, side: THREE.DoubleSide }), { soot: 0.3, key: 'canvasDark' }),
    red: new THREE.MeshStandardMaterial({ color: 0x7a1c14, roughness: 0.5, metalness: 0.3 }),
    rust: weather(new THREE.MeshStandardMaterial({ map: tex.metal.map, normalMap: tex.metal.normalMap, color: 0x5a3626, roughness: 0.95, metalness: 0.3 }), { soot: 0.8, rust: 0.8, key: 'rustDrum' }),
    blueLoo: weather(new THREE.MeshStandardMaterial({ color: 0x29435c, roughness: 0.7 }), { soot: 0.4, key: 'loo1' }),
    greenLoo: weather(new THREE.MeshStandardMaterial({ color: 0x3b4a2d, roughness: 0.7 }), { soot: 0.4, key: 'loo2' }),
    uniform: new THREE.MeshStandardMaterial({ color: 0x3a3f2c, roughness: 0.92 }),
    gear: new THREE.MeshStandardMaterial({ color: 0x2b3022, roughness: 0.8 }),
    helmet: new THREE.MeshStandardMaterial({ color: 0x353b2a, roughness: 0.6, metalness: 0.15 }),
    skin: new THREE.MeshStandardMaterial({ color: 0x5a4a3e, roughness: 0.7 }),
    // steady warm light: lantern glass, a lit window, coals in a barrel
    lamp: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.6, 0.55) }),
    ember: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.7, 0.12) }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
export function buildDressing(env, wingMatrix) {
  const M = materials(env);
  const P = prefabs(M);
  kit = (name, m) => env.addKit(name, m);
  const B = new Batch();
  const bagMs = [];
  const rng = makeRng(5150);
  dressWall(env, wingMatrix, M, P, B, bagMs, rng);
  dressRoof(env, M, P, B, bagMs, rng);
  dressYard(env, M, P, B, bagMs, rng);
  B.flush(env.scene, new Set([M.concrete, M.paintWhite, M.blueLoo, M.greenLoo]));
  const bags = new THREE.InstancedMesh(sandbagGeo(), env.sandbagMat, bagMs.length);
  bagMs.forEach((m, i) => bags.setMatrixAt(i, m));
  bags.receiveShadow = true;
  env.scene.add(bags);
}

// ── the wall: inner face, walkway rail, stairs, kit along the walkway ────────
function dressWall(env, wingMatrix, M, P, B, bagMs, rng) {
  const H = WORLD.WALL_H, deckY = H - 1.0, floor = deckY + 0.1;
  const FACE = 3.36; // inner face of the HESCO fill (wing-local w)
  for (const w of env.wings) {
    const toWorld = wingMatrix(w, 0, 0, 0, new THREE.Matrix4());
    const at = (u, y, ww, ry = 0) => wingMatrix(w, u, y, ww, new THREE.Matrix4(), 1, 1, 1, ry);
    // scaled, and tipped about the wall axis (rx > 0 leans the top towards the yard rail)
    const atS = (u, y, ww, ry = 0, s = 1, rx = 0) => wingMatrix(w, u, y, ww, new THREE.Matrix4(), s, s, s, ry, rx);
    const uOf = (x) => (x - w.A[0]) / w.tx;
    const L = w.len;
    // where people stand and things already are: keep the walkway clear there
    const busy = [];
    for (const px of GUNNER_POSTS) if (Math.sign(px) === w.side) busy.push([uOf(px) - 1.8, uOf(px) + 1.8]);
    for (const px of RIFLE_POSTS) if (Math.sign(px) === w.side) busy.push([uOf(px) - 1.0, uOf(px) + 1.0]);
    for (let k = 0; k < 5; k++) { const u = (k + 0.62) * (L / 5); busy.push([u - 0.5, u + 0.5]); }
    const local = [];
    const add = (mat, geo) => local.push([mat, geo]);
    // two stairs per wing, climbing along the inner face towards the bunker
    const RUN = 7.2, SW = 1.1;
    const gaps = [];
    for (const f of [0.3, 0.72]) {
      const dir = w.side < 0 ? 1 : -1;          // +u runs towards the bunker on the left wing
      const u1 = (w.side < 0 ? f : 1 - f) * L, u0 = u1 - dir * RUN;
      const wx = w.A[0] + w.tx * u0 + w.nx * (FACE + SW / 2), wz = w.A[1] + w.tz * u0 + w.nz * (FACE + SW / 2);
      const g0 = Math.max(0, groundH(wx, wz));
      const rise = floor - g0, n = Math.ceil(rise / 0.2), stepH = rise / n, stepU = RUN / n;
      for (let i = 0; i < n; i++) add(M.crate, box(stepU + 0.06, 0.05, SW - 0.08, u0 + dir * (i + 0.5) * stepU, g0 + (i + 1) * stepH - 0.025, FACE + SW / 2));
      const len = Math.hypot(RUN, rise), ang = Math.atan2(rise, RUN) * dir;
      for (const ww of [FACE + 0.06, FACE + SW - 0.04]) add(M.steel, box(len, 0.22, 0.06, (u0 + u1) / 2, g0 + rise / 2 - 0.1, ww, 0, 0, ang));
      for (let k = 0; k <= 4; k++) { const t = k / 4; add(M.steel, box(0.05, 1.0, 0.05, u0 + dir * RUN * t, g0 + rise * t + 0.5, FACE + SW - 0.02)); }
      add(M.steel, box(len, 0.05, 0.05, (u0 + u1) / 2, g0 + rise / 2 + 1.0, FACE + SW - 0.02, 0, 0, ang));
      // landing at the top, propped on a post; the walkway rail opens onto it
      add(M.crate, box(1.3, 0.1, SW, u1 + dir * 0.55, floor - 0.05, FACE + SW / 2));
      add(M.steel, box(0.12, floor - 0.1, 0.12, u1 + dir * 1.15, (floor - 0.1) / 2, FACE + SW - 0.08));
      gaps.push([Math.min(u1, u1 + dir * 1.2) - 0.1, Math.max(u1, u1 + dir * 1.2) + 0.1]);
    }
    busy.push(...gaps);
    // HESCO cages: steel mesh posts and wires over the geotextile
    for (let u = 0.2; u < L + 0.2; u += 1.0) add(M.dark, box(0.035, deckY, 0.035, u, deckY / 2, FACE + 0.015));
    for (const y of [0.06, deckY * 0.34, deckY * 0.67, deckY - 0.04]) add(M.dark, box(L + 0.4, 0.025, 0.025, L / 2, y, FACE + 0.02));
    // fascia board under the walkway edge
    add(M.crate, box(L + 0.4, 0.24, 0.08, L / 2, deckY - 0.1, FACE - 0.05));
    // walkway rail on the yard side, open where the stairs come up
    const railW = 3.18;
    const segs = [];
    let s0 = 0;
    for (const [a, b] of [...gaps].sort((p, q) => p[0] - q[0])) { segs.push([s0, a]); s0 = b; }
    segs.push([s0, L]);
    for (const [a, b] of segs) {
      if (b - a < 0.5) continue;
      const n = Math.max(1, Math.round((b - a) / 2.0));
      for (let k = 0; k <= n; k++) add(M.steel, box(0.05, 1.05, 0.05, a + (b - a) * k / n, floor + 0.52, railW));
      add(M.steel, box(b - a, 0.045, 0.045, (a + b) / 2, floor + 1.05, railW));
      add(M.steel, box(b - a, 0.035, 0.035, (a + b) / 2, floor + 0.55, railW));
      add(M.crate, box(b - a, 0.12, 0.025, (a + b) / 2, floor + 0.06, railW));
    }
    // power cable slung between the lamp poles
    for (let k = 0; k < 4; k++) {
      const a = new THREE.Vector3((k + 0.62) * (L / 5), floor + 2.9, 2.62), b = new THREE.Vector3((k + 1.62) * (L / 5), floor + 2.9, 2.62);
      add(M.rubber, sagWire(a, b, 0.7, 0.018, 18));
    }
    for (const [mat, geo] of local) B.add(mat, geo, toWorld);
    // kit along the walkway, in little clusters against the rail
    const free = (u, r) => u - r > 1 && u + r < L - 1 && !busy.some(([a, b]) => u + r > a && u - r < b);
    let u = 2.5 + rng() * 2;
    while (u < L - 2) {
      if (!free(u, 1.0)) { u += 0.7; continue; }
      const kind = (rng() * 9) | 0;
      const ww = 2.85;
      const ry = (rng() - 0.5) * 0.3;
      const jerry = () => (rng() < 0.7 ? 'jerry' : 'jerrySteel');
      if (kind === 0) { kit('crateWood', atS(u, floor, ww, ry, 0.8)); kit('crateWood', atS(u + 0.05, floor + 0.37, ww, ry + 0.1, 0.8)); kit('ammo', at(u - 0.75, floor, ww + 0.1, 0.3)); }
      else if (kind === 1) { for (let k = 0; k < 3; k++) kit('ammo', at(u - 0.35 + k * 0.36, floor, ww + 0.05, (rng() - 0.5) * 0.3)); kit('ammo', at(u - 0.2, floor + 0.23, ww + 0.05, 0.2)); kit('ammo', at(u + 0.15, floor + 0.23, ww + 0.05, -0.1)); }
      else if (kind === 2) { kit(jerry(), at(u - 0.2, floor, ww + 0.05, Math.PI / 2 + ry)); kit(jerry(), at(u + 0.2, floor, ww + 0.05, Math.PI / 2 - ry)); B.put(P.duffel(), at(u + 0.8, floor, ww - 0.05, ry)); }
      else if (kind === 3) { B.put(P.stretcher(), at(u, floor, ww - 0.15, ry * 0.3)); B.put(P.roll(), at(u - 1.4, floor, ww, ry)); kit('medbox', at(u + 1.35, floor, ww, ry)); }
      else if (kind === 4) {
        // sandbags waiting to be laid, cement for the posts, a spade against the rail
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3 - r; c++) bagMs.push(at(u - 0.6 + c * 0.6 + r * 0.3, floor + 0.09 + r * 0.155, ww, (rng() - 0.5) * 0.2 + (rng() < 0.5 ? Math.PI : 0)));
        kit('cement', at(u + 1.2, floor, ww - 0.1, Math.PI / 2 + ry)); kit('cement', at(u + 1.22, floor + 0.17, ww - 0.1, Math.PI / 2 - ry));
        kit(rng() < 0.5 ? 'spade' : 'pick', atS(u - 1.2, floor, 2.95, ry, 1, 0.22));
      } else if (kind === 5) { B.put(P.barrelBag(), at(u, floor, ww, ry)); B.put(P.extinguisher(), at(u + 0.9, floor, ww + 0.1)); B.put(P.lantern(), at(u - 0.6, floor, ww + 0.15)); kit('toolbox', at(u - 1.2, floor, ww, ry)); }
      else if (kind === 6) { kit('crateWood', atS(u, floor, ww, ry, 0.8)); kit('radio', atS(u + 0.05, floor + 0.37, ww, ry + Math.PI, 0.8)); B.put(P.reel(), at(u + 0.85, floor, ww, Math.PI / 2)); }
      else if (kind === 7) {
        // somebody's meal break: a crate for a table, rations, a thermos, a torch
        kit('crateSmall', at(u, floor, ww, Math.PI / 2 + ry));
        kit('rations', at(u - 0.2, floor + 0.46, ww, ry)); kit('thermos', at(u + 0.3, floor + 0.46, ww - 0.05, rng() * 6));
        kit('foodCans', at(u + 0.1, floor + 0.46, ww + 0.1, rng() * 6)); kit('flashlight', at(u + 0.45, floor + 0.46, ww + 0.1, rng() * 6));
        kit(jerry(), at(u + 0.9, floor, ww + 0.05, Math.PI / 2));
      } else {
        // tools leaning on the rail, a gas mask hung on a post, rubbish
        kit('pick', atS(u - 0.4, floor, 2.96, ry, 1, 0.2)); kit('sledge', atS(u - 0.1, floor, 2.98, ry + 0.4, 1, 0.18)); kit('crowbar', atS(u + 0.15, floor, 3.0, ry, 1, 0.16));
        kit('gasmask', atS(u + 0.5, floor, 3.05, Math.PI / 2, 1, 0.1));
        kit('trashbag', at(u + 1.0, floor, ww, rng() * 6)); kit('cardboard', at(u + 1.6, floor, ww, ry));
      }
      u += 4.5 + rng() * 5;
    }
    // each wall gunner keeps his ammo and a spare barrel behind him
    for (const px of GUNNER_POSTS) {
      if (Math.sign(px) !== w.side) continue;
      const ug = uOf(px);
      kit('ammo', at(ug - 0.3, floor, 2.6, 0.2)); kit('ammo', at(ug + 0.05, floor, 2.65, -0.1)); kit('ammo', at(ug - 0.12, floor + 0.23, 2.62, 0.1));
      B.put(P.barrelBag(), at(ug + 0.9, floor, 2.75, 0.1));
    }
  }
}

// ── the bunker roof around the gun ────────────────────────────────────────────
function dressRoof(env, M, P, B, bagMs, rng) {
  const top = WORLD.TOWER_TOP, z0 = WORLD.BASE_Z;
  const R = (x, z, ry = 0, y = top) => place(x, y, z, ry);
  // ready ammo for the fifty, stacked behind the nest
  // (the crates themselves are model crates: env.roofCrates, placed in dressWithModels)
  env.roofCrates = [];
  for (let k = 0; k < 3; k++) for (let r = 0; r < (k === 1 ? 3 : 2); r++) env.roofCrates.push([-4.6 + r * 0.03, top + r * 0.21, -0.5 + k * 0.36, (rng() - 0.5) * 0.08]);
  for (let k = 0; k < 5; k++) kit('ammo', R(2.2 + (k % 3) * 0.36, -0.3 + Math.floor(k / 3) * 0.2, (rng() - 0.5) * 0.3, top + (k >= 3 ? 0.23 : 0)));
  B.put(P.barrelBag(), R(3.6, 0.4, 0.3));
  B.put(P.barrelBag(), R(3.65, 0.62, 0.25));
  // duckboard path from the nest back to the shelter
  for (let k = 0; k < 4; k++) B.put(P.pallet(), R(-0.75 + (rng() - 0.5) * 0.1, -0.2 + k * 1.15, Math.PI / 2 + (rng() - 0.5) * 0.06));
  // roof hatch with the lid thrown open and a ladder going down
  B.add(M.steel, box(1.1, 0.25, 1.1, 4.4, top + 0.125, 2.0));
  B.add(M.dark, box(0.9, 0.02, 0.9, 4.4, top + 0.255, 2.0));
  B.add(M.steel, box(1.1, 0.06, 1.1, 4.4, top + 0.75, 2.62, -1.25));
  for (const s of [-0.3, 0.3]) B.add(M.dark, box(0.04, 0.9, 0.04, 4.4 + s, top + 0.6, 1.62));
  B.add(M.dark, box(0.64, 0.04, 0.04, 4.4, top + 1.02, 1.62));
  // ventilators and the cable runs on the roof
  for (const [x, z] of [[-6.2, 5.6], [6.6, 6.4], [-3.8, 6.8]]) {
    B.add(M.steel, cylY(0.16, 0.9, 10, x, top + 0.45, z));
    B.add(M.steel, xf(new THREE.ConeGeometry(0.34, 0.22, 10), x, top + 1.0, z));
  }
  B.add(M.rubber, box(0.04, 0.04, 6.2, 6.3, top + 0.02, 0.6));
  B.add(M.rubber, box(5.4, 0.04, 0.04, 3.6, top + 0.02, 3.7));
  // small satcom dish on a tripod
  B.add(M.paintWhite, xf(new THREE.SphereGeometry(0.7, 16, 6, 0, Math.PI * 2, 0, 0.6), 5.6, top + 1.35, 5.2, -1.0, 0.6, 0));
  for (let k = 0; k < 3; k++) { const a = k * 2.1; B.add(M.dark, box(0.04, 1.3, 0.04, 5.6 + Math.cos(a) * 0.3, top + 0.6, 5.2 + Math.sin(a) * 0.3, Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25)); }
  // spotting scope on a tripod at the front corner
  B.add(M.dark, cylZ(0.05, 0.5, 10, -6.6, top + 1.35, -0.9));
  for (let k = 0; k < 3; k++) { const a = k * 2.1 + 0.4; B.add(M.dark, box(0.03, 1.35, 0.03, -6.6 + Math.cos(a) * 0.22, top + 0.66, -0.9 + Math.sin(a) * 0.22, Math.sin(a) * 0.2, 0, -Math.cos(a) * 0.2)); }
  // jerrycans, kit and a stretcher by the shelter
  for (let k = 0; k < 4; k++) kit(k === 3 ? 'jerrySteel' : 'jerry', R(2.0 + k * 0.22, 3.9, (rng() - 0.5) * 0.2));
  // the generator that runs the lamps and the radio
  kit('generator', R(3.5, 5.0, 0.25)); kit('jerryPlastic', R(4.3, 5.6, 0.6));
  B.put(P.stretcher(), R(-4.6, 3.6, 0.1));
  B.put(P.duffel(), R(-3.2, 3.9, 0.3)); B.put(P.duffel(), R(-3.0, 3.5, -0.2));
  kit('radio', R(-1.9, 4.1, Math.PI + 0.2)); B.put(P.reel(), R(-2.5, 3.6, 0.6));
  kit('medbox', R(-4.6, 2.8, 0.2)); kit('trashbag', R(7.2, 7.0, 1)); kit('trashbag', R(6.6, 7.3, 2.5)); kit('cardboard', R(-7.1, 7.1, 0.3));
  B.put(P.extinguisher(), R(0.4, 4.15));
  B.put(P.lantern(), R(-1.5, 4.2));
  // camouflage tarp sagging over the shelter roof
  const net = new THREE.PlaneGeometry(6.4, 4.0, 20, 14);
  const np = net.attributes.position;
  for (let i = 0; i < np.count; i++) {
    const x = np.getX(i), y = np.getY(i);
    const e = Math.max(Math.abs(x) / 3.2, Math.abs(y) / 2.0);
    np.setZ(i, -Math.max(0, e - 0.75) * 2.2 + Math.sin(x * 2.3 + y * 1.7) * 0.05 + Math.sin(x * 5.1) * 0.03);
  }
  net.computeVertexNormals();
  B.add(M.canvasDark, xf(net, -0.5, top + 1.3, z0 + 7.4, -Math.PI / 2));
  // sandbags along the side and back parapets of the roof
  for (const sx of [-8.05, 8.05]) for (let k = 0; k < 14; k++) {
    const z = z0 + 0.4 + k * 0.62;
    bagMs.push(place(sx, top + 0.79, z, Math.PI / 2 + (rng() - 0.5) * 0.2 + (rng() < 0.5 ? Math.PI : 0)));
  }
  for (let k = 0; k < 25; k++) bagMs.push(place(-7.5 + k * 0.62, top + 0.79, z0 + 8.8, (rng() - 0.5) * 0.2 + (rng() < 0.5 ? Math.PI : 0)));
  // a low blast wall in front of the shelter door
  for (let r = 0; r < 3; r++) for (let k = 0; k < 4; k++) bagMs.push(place(-1.7 + k * 0.62 + (r % 2) * 0.3, top + 0.09 + r * 0.155, z0 + 4.95, (rng() - 0.5) * 0.15 + (rng() < 0.5 ? Math.PI : 0)));
  // a dim, shaded work lamp over the shelter door: just enough to see the roof by
  const l = new THREE.PointLight(0xffa860, 30, 16, 1.4);
  l.position.set(0, top + 2.9, 1.4);
  B.add(M.dark, cylY(0.05, 3.0, 6, 0, top + 1.5, 3.6));
  B.add(M.dark, box(0.04, 0.04, 2.2, 0, top + 2.95, 2.5));
  B.add(M.dark, xf(new THREE.ConeGeometry(0.22, 0.2, 10, 1, true), 0, top + 2.85, 1.4));
  B.add(M.lamp, cylY(0.08, 0.04, 8, 0, top + 2.77, 1.4));
  env.scene.add(l);
  // the parts of the roof you see from the gun: either side of the nest
  // a spotter at the scope and a loader on the right, both watching the field
  // (soldier models, placed in env.dressWithModels)
  env.roofSoldiers = [[-6.55, top, -0.25, Math.PI + 0.15, -0.12], [5.6, top, -0.7, Math.PI - 0.35, -0.2]];
  // expansion joints, a drain and tar patches in the roof slab
  for (let z = z0 + 0.1; z < z0 + 9; z += 3.0) B.add(M.rubber, box(16.2, 0.012, 0.06, 0, top + 0.006, z));
  for (const x of [-5.4, 5.4]) B.add(M.rubber, box(0.06, 0.012, 9, x, top + 0.006, z0 + 4.5));
  for (const [x, z] of [[-7.4, 3.2], [7.4, -0.8]]) { B.add(M.dark, box(0.5, 0.02, 0.5, x, top + 0.01, z)); for (let k = 0; k < 4; k++) B.add(M.steel, box(0.04, 0.03, 0.46, x - 0.15 + k * 0.1, top + 0.02, z)); }
  for (const [x, z, s] of [[-3.6, 1.6, 1.2], [6.8, 2.6, 0.9], [-7.0, -1.0, 0.7]]) B.add(M.rubber, xf(new THREE.CircleGeometry(s, 10), x, top + 0.004, z, -Math.PI / 2, 0, 0, 1, 0.6, 1));
  // right side: a sandbagged ready rack of ammo, crates, a cot
  for (let r = 0; r < 2; r++) for (let k = 0; k < 4; k++) bagMs.push(place(5.0 + k * 0.62 + (r % 2) * 0.3, top + 0.09 + r * 0.155, -1.2, (rng() - 0.5) * 0.15 + (rng() < 0.5 ? Math.PI : 0)));
  for (let k = 0; k < 6; k++) kit('ammo', R(5.1 + (k % 3) * 0.36, -0.9 + Math.floor(k / 3) * 0.13, (rng() - 0.5) * 0.15, top + 0.31));
  // a hand searchlight on the crate stack, for when the towers can't reach
  kit('searchlight', R(7.3, 0.6, Math.PI + 0.3, top + 0.63));
  env.roofCrates.push([7.3, top, 0.6, 0.05], [7.3, top + 0.21, 0.62, -0.05], [7.3, top + 0.42, 0.58, 0.03]);
  kit('crateSmall', R(6.5, 1.5, Math.PI / 2 + 0.3));
  kit('rations', R(6.4, 1.4, 0.4, top + 0.46)); kit('foodCans', R(6.75, 1.65, 1.2, top + 0.46));
  kit('jerry', R(7.55, 2.3, 0.2)); kit('jerry', R(7.55, 2.68, -0.1));
  // folding cot with a blanket, and a rolled tarp
  for (const sx of [-0.33, 0.33]) B.add(M.dark, cylZ(0.02, 1.9, 6, 3.0 + sx, top + 0.38, 2.0));
  for (const z of [1.2, 2.8]) for (const sx of [-0.33, 0.33]) B.add(M.dark, box(0.03, 0.4, 0.03, 3.0 + sx, top + 0.19, z));
  B.add(M.canvasDark, box(0.66, 0.04, 1.85, 3.0, top + 0.4, 2.0));
  B.add(M.canvas, xf(pillow(0.62, 0.1, 1.1, 0.5, 10, 6), 3.0, top + 0.45, 2.3));
  kit('rifle', R(3.05, 1.6, Math.PI / 2 + 0.08, top + 0.43));
  kit('thermos', R(3.75, 1.1, 0.5));
  B.put(P.roll(), R(-6.9, 2.6, 0.4));
  // left side: empty ammo boxes thrown aside, a sandbag pile, a lantern
  kit('ammo', R(-3.4, -0.6, 0.6)); kit('ammo', R(-3.5, 0.0, -0.4));
  kit('ammo', place(-3.2, top + 0.055, 0.45, 1.4, 0, Math.PI / 2)); // knocked over
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3 - r; c++) bagMs.push(place(-6.9 + r * 0.3 + c * 0.6 - 0.6, top + 0.09 + r * 0.155, 3.6, Math.PI / 2 + (rng() - 0.5) * 0.2));
  B.put(P.lantern(), R(-5.7, 0.9));
  // ladder down the back of the bunker
  for (const s of [-0.25, 0.25]) B.add(M.dark, box(0.05, top + 1.0, 0.05, 6.2 + s, (top + 1.0) / 2, z0 + 9.1));
  for (let y = 0.4; y < top + 0.9; y += 0.32) B.add(M.dark, box(0.5, 0.03, 0.03, 6.2, y, z0 + 9.1));
}

// ── the yard behind the wall ────────────────────────────────────────────────
function dressYard(env, M, P, B, bagMs, rng) {
  const G = (x, z) => groundH(x, z);
  const at = (x, z, ry = 0, dy = 0) => place(x, G(x, z) + dy, z, ry);
  const fire = env.fire;
  for (const side of [-1, 1]) {
    const S = (x) => side * x;
    // jersey barriers lining the track from the gate into the yard
    for (let k = 0; k < 12; k++) { const z = 8.4 + k * 1.58; kit(k % 5 === 3 ? 'barrier' : 'barrierTall', at(S(7), z, Math.PI / 2 + (rng() - 0.5) * 0.05)); }
    for (let k = 0; k < 6; k++) kit('barrierTall', at(S(8.6 + k * 1.58), 28.5, (rng() - 0.5) * 0.05));
    // supply dump: pallets under tarps, loose crates
    for (let k = 0; k < 5; k++) B.put(P.load(), at(S(22 + (k % 3) * 1.5), 6 + Math.floor(k / 3) * 1.4, (rng() - 0.5) * 0.15));
    for (let k = 0; k < 4; k++) kit('crateWood', at(S(26.6 + (rng() - 0.5) * 0.3), 5.6 + k * 0.62, Math.PI / 2 + (rng() - 0.5) * 0.2));
    kit('crateWood', at(S(26.6), 5.9, Math.PI / 2 + 0.1, 0.46));
    kit('crateLong', at(S(24), 9.2, 0.2 * side));
    kit('crateSmall', at(S(28.2), 6.2, 0.3)); kit('crateSmall', at(S(28.25), 6.25, 0.25, 0.46));
    B.put(P.pallet(), at(S(20), 9, 0.3));
    kit('handtruck', at(S(20.4), 9.3, 0.3 + Math.PI, 0.15));
    kit('cardboard', at(S(21.5), 9.4, 0.5)); kit('cardboard', at(S(21.6), 9.45, 0.2, 0.34));
    // burn barrel with men warming up around it
    const bx = S(side < 0 ? 19 : 21), bz = side < 0 ? 14 : 15;
    kit('stove', at(bx, bz, rng() * 6));
    B.add(M.ember, cylY(0.25, 0.02, 12, bx, G(bx, bz) + 0.8, bz));
    // something to sit on round the fire
    kit('foldstool', at(bx + 1.6, bz + 0.9, 0.7)); kit('crateSmall', at(bx - 1.5, bz - 1.1, 0.9));
    if (fire) fire.add(bx, G(bx, bz) + 0.85, bz, 0.5, 0.85, 1.7, { smoke: 0.5, embers: 1.0, fadeIn: 0 });
    env.lightPools.push({ x: bx, z: bz, r: 6, color: [1, 0.48, 0.15], k: 0.14 });
    const nMen = side < 0 ? 3 : 2;
    for (let k = 0; k < nMen; k++) {
      const a = k * (Math.PI * 2 / nMen) + 0.6 + (rng() - 0.5) * 0.4;
      const x = bx + Math.cos(a) * 0.95, z = bz + Math.sin(a) * 0.95;
      B.put(P.soldier(0), at(x, z, Math.atan2(bx - x, bz - z)));
    }
    // a sentry on the track
    B.put(P.soldier(1), at(S(12.5), 7.5, side * 0.6 + Math.PI));
    // sandbagged firing pit
    const px = S(40), pz = 3;
    for (let k = 0; k < 18; k++) {
      const a = k / 18 * Math.PI * 2;
      for (let r = 0; r < 2; r++) bagMs.push(place(px + Math.cos(a) * 1.8, G(px, pz) + 0.09 + r * 0.155, pz + Math.sin(a) * 1.8, -a + Math.PI / 2 + (r % 2) * 0.17));
    }
    // lit window in the command container
    const cx = side * 30, cz = 16, ry = side * 0.55;
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.55), M.lamp);
    win.position.set(cx - Math.sin(ry) * 1.23, G(cx, cz) + 1.5, cz - Math.cos(ry) * 1.23);
    win.rotation.y = ry + Math.PI;
    env.scene.add(win);
    env.lightPools.push({ x: cx - Math.sin(ry) * 3, z: cz - Math.cos(ry) * 3, r: 4, color: [1, 0.55, 0.2], k: 0.07 });
  }
  // ── the rest of the yard: the scanned kit ──
  // covered cars nobody has the fuel to drive
  kit('car', at(-34, 6, 0.4)); kit('car', at(32, 3, -0.15));
  // tyre stacks by the motor pool
  const tyres = (x, z, n) => { for (let k = 0; k < n; k++) kit('tyre', place(x + (rng() - 0.5) * 0.06, G(x, z) + 0.085 + k * 0.17, z - 0.3, rng() * 0.3, Math.PI / 2)); };
  tyres(-52, 20.5, 4); tyres(-51.3, 21.3, 3); tyres(53.5, 19, 5);
  kit('tyre', at(-50.5, 20.3, 1.2)); kit('tyre', at(54.4, 18.4, 0.3));
  // workshop corner by the containers: compressor, welding cart, tool cart, a rack, a ladder
  kit('compressor', at(-24.5, 18.5, 1.3)); kit('welder', at(-22.6, 19.2, 0.9)); kit('toolcart', at(-23.4, 16.8, 0.2));
  kit('rack', at(-26.2, 17.0, 1.2)); kit('ladder', at(-21.5, 17.4, -0.6)); kit('toolbox', at(-23.3, 16.85, 0.4, 0.96));
  kit('stool', at(-22.4, 17.8, 0)); kit('drumRed', at(-25.6, 19.8, 0.4)); kit('lpg', at(-21.8, 20.3, 0));
  // gas cylinders and water by the cook tent
  for (let k = 0; k < 3; k++) kit('propane', at(12.6 + k * 0.38, 14.4, rng() * 6));
  kit('lpg', at(12.8, 14.9, 1)); kit('lpg', at(13.3, 15.0, 2));
  for (let k = 0; k < 4; k++) kit('jerryPlastic', at(11.2 + k * 0.3, 15.2, (rng() - 0.5) * 0.4));
  kit('picnic', at(-12.5, 22.5, 0.3)); kit('foldstool', at(-10.6, 23.6, 1.9)); kit('thermos', at(-12.6, 22.45, 0.4, 0.75)); kit('foodCans', at(-12.2, 22.9, 1.0, 0.75));
  // power: utility boxes by the generator, aircon on the containers
  kit('utility', at(-7.4, 15.0, -Math.PI / 2)); kit('utility', at(-7.4, 15.6, -Math.PI / 2));
  for (const side of [-1, 1]) kit('aircon', place(side * 18, G(side * 18, 24) + 2.59, 24.4, side * 0.1 + Math.PI));
  // rubbish: trash cans by the latrines and the tents, bags piled up
  kit('trashcans', at(-46.2, 20.4, 0.55 + Math.PI)); kit('trashcans', at(17.5, 6.2, -0.3));
  for (const [x, z] of [[-45.4, 22.6], [-45.9, 23.2], [18.5, 5.6], [-14, 6.6]]) kit('trashbag', at(x, z, rng() * 6));
  kit('generator', at(-10.6, 13.6, 0.4)); kit('jerry', at(-10, 13.2, 0.2));

  // portable toilets and water tanks; two more trucks
  for (let k = 0; k < 3; k++) B.put(P.loo(k === 1 ? M.greenLoo : M.blueLoo), at(-44 + k * 1.25, 21, 0.55 + Math.PI));
  B.put(P.tank(), at(46, 18, 0.2));
  B.put(P.tank(), at(-58, 15, 0.7));
  for (const [x, z, ry] of [[-38, 30, 0.9], [44, 31, -2.2]]) {
    const t = makeTruck(env.mats, { body: env.mats.olive, burnt: false, seed: (x * 3) | 0, covered: x < 0 });
    t.position.set(x, G(x, z), z);
    t.rotation.y = ry;
    env.scene.add(t);
  }
  // radio mast with guy wires and a red light on top
  const mx = -28, mz = 32, my = G(mx, mz);
  B.add(M.steel, cylY(0.14, 20, 8, mx, my + 10, mz));
  for (let k = 0; k < 6; k++) B.add(M.steel, box(0.9 - k * 0.1, 0.05, 0.05, mx, my + 6 + k * 2.6, mz, 0, k * 0.5));
  for (let k = 0; k < 3; k++) {
    const a = k * 2.1 + 0.3, gx = mx + Math.cos(a) * 9, gz = mz + Math.sin(a) * 9;
    B.add(M.dark, sagWire(new THREE.Vector3(mx, my + 17, mz), new THREE.Vector3(gx, G(gx, gz) + 0.1, gz), 0.25, 0.012, 10));
    B.add(M.concrete, box(0.5, 0.3, 0.5, gx, G(gx, gz) + 0.15, gz));
  }
  const beacon = env.makeGlowSprite(0xff2010, 1.4, 1.8);
  beacon.position.set(mx, my + 20.2, mz);
  env.scene.add(beacon);
}
