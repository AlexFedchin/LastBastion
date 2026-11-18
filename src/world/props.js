// Dressing the killing ground: a column of abandoned cars on the road out,
// burnt-out trucks, a tank hulk, a downed helicopter, hedgehogs, wire,
// dead trees, poles, the old forward trench, rubble and the farm ruins.
import * as THREE from 'three';
import { WORLD, wallZ, wallDist } from '../config.js';
import { makeRng } from '../core/util.js';
import { groundH, groundNormal, roadX, trenchZ, valleyEdge, NAPALM_OFFSET, craterList } from './terrain.js';
import { box, cylY, merge, sandbagGeo, concertinaGeo, sagWire, makeTank, makeRuin } from './kit.js';
import { CAR_SIZE, TRUCK_SIZE, placeModel } from './vehicles.js';
import { addObstacle } from './obstacles.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _n = [0, 1, 0];
const UP = new THREE.Vector3(0, 1, 0);

/** Place an object on the terrain, tilted to the ground normal. */
function plant(obj, x, z, ry = 0, sink = 0, tiltK = 1, extra = null) {
  groundNormal(x, z, _n);
  const n = new THREE.Vector3(_n[0], _n[1], _n[2]).lerp(UP, 1 - tiltK).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(UP, n);
  q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, ry));
  if (extra) q.multiply(extra);
  obj.quaternion.copy(q);
  obj.position.set(x, groundH(x, z) - sink, z);
  return obj;
}

/** Register a vehicle's footprint (its local +x is its length; `off` = centre offset along it). */
function solid(x, z, ry, off, halfLen, halfWid) {
  const ax = Math.cos(ry), az = -Math.sin(ry);
  return addObstacle(x + ax * off, z + az * off, ry, halfLen, halfWid);
}

function instanced(geo, mat, mats, { cast = true, receive = true } = {}) {
  const im = new THREE.InstancedMesh(geo, mat, mats.length);
  mats.forEach((m, i) => im.setMatrixAt(i, m));
  im.castShadow = cast; im.receiveShadow = receive;
  return im;
}

export function buildProps(env) {
  const { scene, mats } = env;
  const rng = makeRng(2024);
  const fire = env.fire;

  // ── vehicles ────────────────────────────────────────────────────────────
  // (downloaded models, instanced once they load: see vehicles.js; a proxy carries each placement)
  const at = () => new THREE.Object3D();
  // the burning truck everybody remembers
  placeModel(env, 'ural_burnt', plant(at(), -38, -98, 0.7, 0.12, 1, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.06))));
  solid(-38, -98, 0.7, 0, TRUCK_SIZE[0], TRUCK_SIZE[1]);
  const wy = groundH(-38, -97);
  env.wreckFlames = { x: -38, y: wy + 1.4, z: -97 };
  fire.add(-38.4, wy + 1.2, -97.6, 3.2, 4.8, 3.4, { smoke: 3, embers: 6 });
  fire.add(-36.8, wy + 1.6, -96.2, 1.8, 3.2, 2.6, { smoke: 0, embers: 2 });
  fire.add(-39.8, wy + 0.4, -99.0, 1.4, 2.0, 2.2, { smoke: 0, embers: 1 });
  env.wreckFire.position.set(-38, wy + 2.6, -97);

  placeModel(env, 'ural_burnt', plant(at(), 52, -150, -1.2, 0.1)); solid(52, -150, -1.2, 0, TRUCK_SIZE[0], TRUCK_SIZE[1]);
  placeModel(env, 'ural', plant(at(), -90, -186, 2.1, 0.05, 1, new THREE.Quaternion().setFromEuler(new THREE.Euler(0.04, 0, -0.1)))); solid(-90, -186, 2.1, 0, TRUCK_SIZE[0], TRUCK_SIZE[1]);
  const tank = makeTank(mats, { body: mats.burnt, seed: 14 });
  scene.add(plant(tank, 26, -72, -0.45, 0.25, 1, new THREE.Quaternion().setFromEuler(new THREE.Euler(0.05, 0, 0.04)))); solid(26, -72, -0.45, 0.1, 3.75, 1.85);
  fire.add(25.6, groundH(26, -72) + 2.2, -72.4, 1.2, 1.8, 1.6, { smoke: 1.2, embers: 1, fadeIn: 0 });
  // the downed helicopter: the airframe lies along its x, the debris thrown round it
  placeModel(env, 'heliwreck', plant(at(), -118, -258, 0.9, 0.05, 1)); solid(-118, -258, 0.9, 0, 5.6, 1.6);
  fire.add(-118, groundH(-118, -258) + 1.6, -258, 2.4, 3.6, 2.6, { smoke: 2.4, embers: 3 });

  // abandoned column of cars on the road: the rusted sedan, burnt ones, now and then one on its roof
  const BURNT = ['car_police', 'car_hatch', 'car_saloon'];
  let z = -38;
  let carCount = 0;
  while (z > -330 && carCount < 16) {
    z -= 9 + rng() * 14;
    const rx = roadX(z);
    const lane = rng() < 0.5 ? -1.8 : 1.8;
    const x = rx + lane + (rng() - 0.5) * 1.4;
    if (wallDist(x, z) < 22) continue;
    const burnt = rng() < 0.45;
    if (!burnt) rng(); // (was the paint colour: keeps the rest of the field where it was)
    const ry = Math.PI / 2 + (rng() - 0.5) * 0.6 + (rng() < 0.2 ? Math.PI : 0);
    const flip = rng() < 0.12;
    if (flip) rng();
    const name = flip ? 'car_police_flip' : burnt ? BURNT[carCount % 3] : 'car_sedan';
    placeModel(env, name, plant(at(), x, z, ry, burnt ? 0.06 : 0.02, 1));
    solid(x, z, ry, 0, CAR_SIZE[name][0], CAR_SIZE[name][1]);
    carCount++;
    if (burnt && rng() < 0.35) fire.add(x, groundH(x, z) + 0.9, z, 1.0, 1.4, 1.5, { smoke: 0.8, embers: 0.6 });
  }

  // ── czech hedgehogs (app/models/hedgehog.glb), each lying as it was dropped ──
  for (let i = 0; i < 46; i++) {
    const x = (rng() - 0.5) * 230, zz = -32 - rng() * 190;
    if (wallDist(x, zz) < 20 || Math.abs(x - roadX(zz)) < 4.5) continue;
    const o = new THREE.Object3D();
    o.rotation.set((rng() - 0.5) * 0.25, rng() * 6.28, (rng() - 0.5) * 0.25);
    o.position.set(x, groundH(x, zz) - 0.05, zz);
    placeModel(env, 'hedgehog', o);
  }

  // ── wire fence lines in the field (broken, sagging) ──────────────────────
  const coilGeo = concertinaGeo(3, 0.45, 0.16, 0.007);
  const stakeGeo = merge([box(0.05, 1.4, 0.05, 0, 0.7, 0), box(0.04, 0.3, 0.04, 0, 1.25, 0.1, 0.6)]);
  const coilMs = [], stakeMs = [];
  for (const lineZ of [-58, -168]) {
    for (let x = -120; x < 120; x += 3) {
      if (rng() < 0.22) { x += 3 + rng() * 9; continue; }
      const zz = lineZ + Math.sin(x * 0.05) * 6 + (lineZ < -100 ? Math.sin(x * 0.013) * 10 : 0);
      if (wallDist(x, zz) < 22) continue;
      const y = groundH(x + 1.5, zz);
      _q.setFromEuler(new THREE.Euler(0, (rng() - 0.5) * 0.3, (rng() - 0.5) * 0.15));
      _m.compose(_v.set(x + 1.5, y - 0.15 - rng() * 0.2, zz), _q, _s.set(1, 0.8 + rng() * 0.4, 1));
      coilMs.push(_m.clone());
      _q.setFromEuler(new THREE.Euler((rng() - 0.5) * 0.3, 0, (rng() - 0.5) * 0.3));
      _m.compose(_v.set(x, groundH(x, zz), zz), _q, _s.set(1, 1, 1));
      stakeMs.push(_m.clone());
    }
  }
  scene.add(instanced(coilGeo, env.wireMat || mats.steel, coilMs, { cast: false }));
  scene.add(instanced(stakeGeo, mats.darkSteel, stakeMs, { cast: false }));

  // ── dead trees (recursive branching, three variants) ────────────────────
  const treeVariant = (seed) => {
    const r = makeRng(seed);
    const G = [];
    const branch = (p, dir, len, rad, depth) => {
      const end = p.clone().addScaledVector(dir, len);
      const g = new THREE.CylinderGeometry(rad * 0.62, rad, len, 6, 1);
      g.translate(0, len / 2, 0);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir));
      g.translate(p.x, p.y, p.z);
      G.push(g);
      if (depth <= 0 || rad < 0.02) return;
      const kids = depth > 2 ? 2 + (r() < 0.5 ? 1 : 0) : 2;
      for (let k = 0; k < kids; k++) {
        const nd = dir.clone().add(new THREE.Vector3((r() - 0.5) * 1.6, r() * 0.5, (r() - 0.5) * 1.6)).normalize();
        branch(end, nd, len * (0.55 + r() * 0.25), rad * 0.6, depth - 1);
      }
      if (r() < 0.6) branch(end, dir.clone().add(new THREE.Vector3((r() - 0.5) * 0.4, 0.4, (r() - 0.5) * 0.4)).normalize(), len * 0.7, rad * 0.65, depth - 1);
    };
    branch(new THREE.Vector3(0, -0.3, 0), new THREE.Vector3((r() - 0.5) * 0.2, 1, (r() - 0.5) * 0.2).normalize(), 3.2, 0.24, 4);
    return merge(G);
  };
  const treeGeos = [treeVariant(1), treeVariant(2), treeVariant(3)];
  const treeMs = [[], [], []];
  for (let i = 0; i < 60; i++) {
    const x = (rng() - 0.5) * 420, zz = -50 - rng() * 300;
    if (wallDist(x, zz) < 30 || Math.abs(x - roadX(zz)) < 6) continue;
    if (Math.abs(x) > valleyEdge(zz) + 30) continue;
    const s = 0.9 + rng() * 1.1;
    _q.setFromEuler(new THREE.Euler((rng() - 0.5) * 0.15, rng() * 6.28, (rng() - 0.5) * 0.15));
    _m.compose(_v.set(x, groundH(x, zz), zz), _q, _s.set(s, s * (0.9 + rng() * 0.3), s));
    treeMs[i % 3].push(_m.clone());
  }
  treeGeos.forEach((g, k) => scene.add(instanced(g, mats.charred, treeMs[k])));

  // ── telephone poles along the road, wires sagging between them ───────────
  const poleGeo = merge([
    cylY(0.13, 9, 7, 0, 4.5, 0), box(2.2, 0.14, 0.14, 0, 8.4, 0), box(1.4, 0.12, 0.12, 0, 7.7, 0),
    cylY(0.05, 0.16, 6, -0.95, 8.55, 0), cylY(0.05, 0.16, 6, 0.95, 8.55, 0), cylY(0.05, 0.16, 6, 0, 8.55, 0),
  ]);
  const tops = [];
  const poleMs = [];
  for (let k = 0; k < 13; k++) {
    const zz = -30 - k * 27;
    const x = roadX(zz) + 9.5 + (rng() - 0.5);
    const lean = (rng() - 0.5) * 0.2 + (k === 6 ? 0.5 : 0);
    _q.setFromEuler(new THREE.Euler(lean * 0.3, (rng() - 0.5) * 0.2, lean));
    const y0 = groundH(x, zz);
    _m.compose(_v.set(x, y0, zz), _q, _s.set(1, 1, 1));
    poleMs.push(_m.clone());
    if (k === 6) { tops.push(null); continue; }
    for (const dx of [-0.95, 0, 0.95]) {
      const p = new THREE.Vector3(dx, 8.62, 0).applyMatrix4(_m);
      tops.push(p);
    }
  }
  scene.add(instanced(poleGeo, mats.wood, poleMs));
  const wireGeos = [];
  for (let k = 0; k + 3 < tops.length; k += 3) {
    for (let c = 0; c < 3; c++) {
      const a = tops[k + c], b = tops[k + 3 + c];
      if (!a || !b) continue;
      wireGeos.push(sagWire(a, b, 1.1 + c * 0.1, 0.012, 14));
    }
  }
  // the broken pole drops its wires to the ground
  if (wireGeos.length) scene.add(new THREE.Mesh(merge(wireGeos), mats.darkSteel));

  // ── forward trench: sandbag parapet, duckboards, a few posts ─────────────
  const bag = sandbagGeo();
  const tbMs = [];
  for (let x = -62; x < 74; x += 0.62) {
    if (rng() < 0.15) continue;
    if (Math.abs(x - roadX(-128)) < 5) continue;
    const zz = trenchZ(x) - 2.0;
    const dzdx = (trenchZ(x + 0.5) - trenchZ(x - 0.5));
    for (let r = 0; r < 2; r++) {
      if (r === 1 && rng() < 0.4) continue;
      _q.setFromEuler(new THREE.Euler((rng() - 0.5) * 0.1, -Math.atan(dzdx) + (rng() - 0.5) * 0.25, 0));
      _m.compose(_v.set(x + r * 0.3, groundH(x, zz) + 0.06 + r * 0.15, zz), _q, _s.set(1, 1, 1));
      tbMs.push(_m.clone());
    }
  }
  // napalm pipe stubs and valves
  const pipeGeo = merge([cylY(0.12, 0.7, 8, 0, 0.1, 0), cylY(0.17, 0.1, 8, 0, 0.45, 0), box(0.4, 0.05, 0.05, 0, 0.55, 0)]);
  const pipeMs = [];
  for (let k = 0; k < 16; k++) {
    const x = -68 + k * (136 / 15);
    if (Math.abs(x) < 9) continue;
    const ax = Math.abs(x);
    const off = ax <= WORLD.GATE_HALF ? NAPALM_OFFSET : NAPALM_OFFSET / 0.876;
    const zz = wallZ(x) - off + 1.4;
    _m.compose(_v.set(x, groundH(x, zz), zz), _q.identity(), _s.set(1, 1, 1));
    pipeMs.push(_m.clone());
  }
  scene.add(instanced(bag, env.sandbagMat, tbMs));
  scene.add(instanced(pipeGeo, mats.steel, pipeMs));

  // ── barrels (some burning) ───────────────────────────────────────────────
  const drumGeo = merge([cylY(0.29, 0.88, 14, 0, 0.44, 0), cylY(0.3, 0.03, 14, 0, 0.3, 0), cylY(0.3, 0.03, 14, 0, 0.6, 0)]);
  const drumMs = [];
  const drumSpots = [[-44, -92], [58, -146], [12, -40], [-70, -60], [88, -110], [-20, -210], [40, -260]];
  drumSpots.forEach(([cx, cz], ci) => {
    const n = 3 + ((rng() * 4) | 0);
    for (let k = 0; k < n; k++) {
      const x = cx + (rng() - 0.5) * 3, zz = cz + (rng() - 0.5) * 3;
      const tipped = rng() < 0.35;
      _q.setFromEuler(new THREE.Euler(tipped ? Math.PI / 2 : (rng() - 0.5) * 0.1, rng() * 6.28, 0));
      _m.compose(_v.set(x, groundH(x, zz) + (tipped ? 0.29 : 0), zz), _q, _s.set(1, 1, 1));
      drumMs.push(_m.clone());
      if (!tipped && k === 0 && ci % 2 === 0) fire.add(x, groundH(x, zz) + 0.85, zz, 0.55, 0.9, 1.8, { smoke: 0.6, embers: 1.2, fadeIn: 0 });
    }
  });
  scene.add(instanced(drumGeo, mats.paintRed, drumMs));

  // ── rubble, stones and junk scattered across the field ───────────────────
  const rubbleGeo = new THREE.DodecahedronGeometry(0.5, 0);
  const rubbleMs = [];
  const RUB = env.quality.texSize >= 1024 ? 2600 : 1200;
  for (let i = 0; i < RUB; i++) {
    const x = (rng() - 0.5) * 300, zz = -8 - Math.pow(rng(), 0.7) * 260;
    const wd = wallDist(x, zz);
    if (wd < 3) continue;
    const s = 0.06 + Math.pow(rng(), 3) * 0.5;
    _q.setFromEuler(new THREE.Euler(rng() * 3, rng() * 3, rng() * 3));
    _m.compose(_v.set(x, groundH(x, zz) + s * 0.15, zz), _q, _s.set(s * (1 + rng()), s * 0.6, s));
    rubbleMs.push(_m.clone());
  }
  // crater ejecta: chunks around each crater rim
  for (const c of craterList()) {
    const n = Math.round(c.r * 2.5);
    for (let k = 0; k < n; k++) {
      const a = rng() * 6.28, r = c.r * (1.0 + rng() * 0.6);
      const x = c.x + Math.cos(a) * r, zz = c.z + Math.sin(a) * r;
      const s = 0.1 + rng() * 0.3;
      _q.setFromEuler(new THREE.Euler(rng() * 3, rng() * 3, rng() * 3));
      _m.compose(_v.set(x, groundH(x, zz) + s * 0.1, zz), _q, _s.set(s * 1.4, s * 0.7, s));
      rubbleMs.push(_m.clone());
    }
  }
  scene.add(instanced(rubbleGeo, env.rockMat, rubbleMs, { cast: false }));

  // boulders along the valley walls and the cliffs past the wings
  const boulderGeo = new THREE.DodecahedronGeometry(1, 1);
  {
    const p = boulderGeo.attributes.position;
    // the polyhedron is non-indexed (every triangle has its own corners), so the
    // jitter is keyed by corner position: copies of a shared corner move together
    // and the rock stays closed instead of splitting into loose triangles
    const r2 = makeRng(808), jit = new Map();
    for (let i = 0; i < p.count; i++) {
      const key = `${Math.round(p.getX(i) * 1e4)},${Math.round(p.getY(i) * 1e4)},${Math.round(p.getZ(i) * 1e4)}`;
      let k = jit.get(key);
      if (k === undefined) { k = 0.78 + r2() * 0.44; jit.set(key, k); }
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
    }
    boulderGeo.computeVertexNormals();
  }
  const bMs = [];
  for (const side of [-1, 1]) {
    for (let zz = -20; zz > -420; zz -= 4) {
      const x = side * (valleyEdge(zz) - 6 + rng() * 22);
      const s = 1.5 + rng() * 4.5;
      _q.setFromEuler(new THREE.Euler(rng() * 3, rng() * 3, rng() * 3));
      _m.compose(_v.set(x, groundH(x, zz) + s * 0.1, zz), _q, _s.set(s * 1.3, s * 0.8, s));
      bMs.push(_m.clone());
    }
    for (let ax = 72; ax < 110; ax += 2.5) {
      const x = side * ax, zz = wallZ(x) - 1 + rng() * 6;
      const s = 2 + rng() * 3.5;
      _q.setFromEuler(new THREE.Euler(rng() * 3, rng() * 3, rng() * 3));
      _m.compose(_v.set(x, groundH(x, zz) + s * 0.2, zz), _q, _s.set(s * 1.2, s, s));
      bMs.push(_m.clone());
    }
  }
  for (let i = 0; i < 30; i++) {
    const x = (rng() - 0.5) * 300, zz = -45 - rng() * 230;
    if (wallDist(x, zz) < 28) continue;
    const s = 0.6 + rng() * 1.5;
    _q.setFromEuler(new THREE.Euler(rng() * 3, rng() * 3, rng() * 3));
    _m.compose(_v.set(x, groundH(x, zz) + s * 0.2, zz), _q, _s.set(s * 1.4, s * 0.8, s));
    bMs.push(_m.clone());
  }
  scene.add(instanced(boulderGeo, env.rockMat, bMs));

  // ── farm ruins past the spawn line ──────────────────────────────────────
  for (const [x, zz, ry, seed, w, d] of [[-152, -292, 0.3, 7, 9, 7], [168, -318, -0.5, 9, 8, 6], [-188, -330, 1.2, 11, 6, 6], [118, -380, 0.15, 13, 10, 8]]) {
    const ruin = makeRuin(mats, seed, { w, d, storeys: seed % 2 ? 2 : 1 });
    ruin.position.set(x, groundH(x, zz) - 0.2, zz);
    ruin.rotation.y = ry;
    scene.add(ruin);
    if (seed === 9) fire.add(x + 1, groundH(x, zz) + 1.0, zz, 3.2, 5.0, 2.4, { smoke: 2, embers: 3 });
  }

  // ── checkpoint sign by the road ──────────────────────────────────────────
  const cvs = document.createElement('canvas');
  cvs.width = 512; cvs.height = 256;
  const ctx = cvs.getContext('2d');
  ctx.fillStyle = '#b8b2a0'; ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = '#7a1a12'; ctx.fillRect(0, 0, 512, 64);
  ctx.fillStyle = '#e8e0cc'; ctx.font = 'bold 44px Arial'; ctx.textAlign = 'center';
  ctx.fillText('CHECKPOINT B-7', 256, 48);
  ctx.fillStyle = '#1a1a18'; ctx.font = 'bold 30px Arial';
  ctx.fillText('MILITARY ZONE', 256, 112);
  ctx.fillText('DEADLY FORCE AUTHORIZED', 256, 156);
  ctx.font = '22px Arial';
  ctx.fillText('TURN BACK  ·  NO EVACUATION', 256, 204);
  const r2 = makeRng(3);
  ctx.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 900; i++) { ctx.fillStyle = `rgba(${60 + r2() * 60},${30 + r2() * 30},20,${r2() * 0.25})`; ctx.fillRect(r2() * 512, r2() * 256, r2() * 14, r2() * 30); }
  for (let i = 0; i < 9; i++) { ctx.fillStyle = 'rgba(10,8,6,0.9)'; ctx.beginPath(); ctx.arc(r2() * 512, r2() * 256, 3 + r2() * 4, 0, 7); ctx.fill(); }
  const signTex = new THREE.CanvasTexture(cvs); signTex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Group();
  sign.add(new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.6), new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.7, metalness: 0.3, side: THREE.DoubleSide })));
  sign.children[0].position.y = 2.6;
  sign.add(new THREE.Mesh(merge([box(0.08, 3.4, 0.08, -1.3, 1.7, -0.05), box(0.08, 3.4, 0.08, 1.3, 1.7, -0.05)]), mats.darkSteel));
  plant(sign, roadX(-48) - 6.5, -48, 0.25, 0, 0.2, new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.12)));
  scene.add(sign);
}
