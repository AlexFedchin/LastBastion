// The country behind the base, as the cutscenes see it from the air: a broad
// valley of fields and hedgerows with a dirt track running back out of the
// yard, a few farmsteads along it (one still burning), telegraph poles, and
// wooded hills rising either side where the valley walls of the front die away.
import * as THREE from 'three';
import { makeRng } from '../core/util.js';
import {
  heightFn, groundNormal, vnoise, valleyEdge, rearRoadX, rearValleyX,
  fieldCoords, fieldToWorld, fieldKind,
} from './terrain.js';
import { box, cylY, merge, xf, makeHouseGeo, makeRuin, sagWire, weather } from './kit.js';
import { placeModel } from './vehicles.js';
import { makeConiferGeo, makeDeadPineGeo, makePineMat } from './far.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

// keep clear of the yard and the landing zone, where the lifters set down
const clearOfBase = (x, z) => z > 95 || (z > 72 && Math.abs(x) > 70);

function instanced(scene, geo, mat, ms, { cast = false, receive = true } = {}) {
  if (!ms.length) return null;
  const im = new THREE.InstancedMesh(geo, mat, ms.length);
  ms.forEach((m, i) => im.setMatrixAt(i, m));
  im.castShadow = cast; im.receiveShadow = receive;
  im.computeBoundingSphere();
  scene.add(im);
  return im;
}

/** A jittered blob (welded, so the jitter never splits it): bushes and boulders. */
function lumpGeo(detail, seed, lo, hi) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position, r = makeRng(seed), jit = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${Math.round(p.getX(i) * 1e4)},${Math.round(p.getY(i) * 1e4)},${Math.round(p.getZ(i) * 1e4)}`;
    let k = jit.get(key);
    if (k === undefined) { k = lo + r() * (hi - lo); jit.set(key, k); }
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

export function buildRear(env) {
  const { scene, mats, fire } = env;
  const q = env.quality;
  const big = q.texSize >= 1024;
  const rng = makeRng(31337);
  const gn = [0, 1, 0];
  let conifers = [], deads = [];
  const bushes = [], rocks = [];
  // the crest trees beside the base are seen in play; the rear valley only behind the gun:
  // separate meshes so the rear ones are culled while you look out over the field
  const crestC = [], crestD = [], rearC = conifers, rearD = deads;

  const tree = (x, z, s, deadChance) => {
    const y = heightFn(x, z);
    _e.set((rng() - 0.5) * 0.08, rng() * 6.28, (rng() - 0.5) * 0.08);
    _m.compose(_v.set(x, y - 0.4, z), _q.setFromEuler(_e), _s.set(s, s * (0.85 + rng() * 0.4), s));
    (rng() < deadChance ? deads : conifers).push(_m.clone());
  };
  const bush = (x, z, s) => {
    _e.set(0, rng() * 6.28, 0);
    _m.compose(_v.set(x, heightFn(x, z) + s * 0.25, z), _q.setFromEuler(_e), _s.set(s * (1 + rng() * 0.6), s * (0.55 + rng() * 0.3), s * (1 + rng() * 0.4)));
    bushes.push(_m.clone());
  };

  // ── woods on the hills, thick on the crests, copses down on the floor ─────
  const NT = big ? 4200 : 2400;
  let tries = 0, placed = 0;
  while (placed < NT && tries < NT * 10) {
    tries++;
    const x = (rng() - 0.5) * 1500, z = 60 + Math.pow(rng(), 0.85) * 820;
    if (!clearOfBase(x, z)) continue;
    if (Math.abs(x - rearRoadX(z)) < 9) continue;
    const adx = Math.abs(x - rearValleyX(z));
    const hillK = Math.min(1, Math.max(0, (adx - 70) / 60));
    const dens = vnoise(x * 0.007 + 13, z * 0.007 - 5) * 0.75 + vnoise(x * 0.03, z * 0.03) * 0.25;
    // woods on the hills; on the floor only the densest patches make a copse
    const need = hillK > 0 ? 0.62 - hillK * 0.25 : 0.74;
    if (dens < need + rng() * 0.08) continue;
    groundNormal(x, z, gn);
    if (gn[1] < 0.7) continue;
    tree(x, z, 0.7 + rng() * 0.85, 0.12 + (z < 200 ? 0.2 : 0));
    placed++;
    if (rng() < 0.18) bush(x + (rng() - 0.5) * 6, z + (rng() - 0.5) * 6, 1.2 + rng() * 1.4);
  }

  // ── trees along the valley-wall crests and back slopes either side of the base ──
  conifers = crestC; deads = crestD;
  for (let k = 0; k < (big ? 1600 : 900); k++) {
    const side = rng() < 0.5 ? -1 : 1;
    const z = -160 + rng() * 300;
    const x = side * (valleyEdge(z) + 4 + Math.pow(rng(), 0.8) * 260);
    if (!clearOfBase(x, z) && z > 0) continue;
    const dens = vnoise(x * 0.012 + 3, z * 0.012 + 8);
    if (dens < 0.38 + rng() * 0.15) continue;
    groundNormal(x, z, gn);
    if (gn[1] < 0.74) continue;
    tree(x, z, 0.7 + rng() * 0.8, 0.35);
  }
  conifers = rearC; deads = rearD;
  // boulders and outcrops on the wall faces
  for (let k = 0; k < (big ? 220 : 140); k++) {
    const side = rng() < 0.5 ? -1 : 1;
    const z = -150 + rng() * 270;
    const x = side * (valleyEdge(z) - 10 + rng() * 40);
    if (z > -30 && Math.abs(x) < 88) continue; // the cliffs past the wings already have theirs
    groundNormal(x, z, gn);
    if (gn[1] > 0.93) continue; // only where it is steep
    const s = 1.4 + Math.pow(rng(), 2) * 4.5;
    _e.set(rng() * 3, rng() * 3, rng() * 3);
    _m.compose(_v.set(x, heightFn(x, z) + s * 0.05, z), _q.setFromEuler(_e), _s.set(s * 1.4, s * 0.7, s));
    rocks.push(_m.clone());
  }

  // ── hedgerows along the plot boundaries, trees standing in them ──────────
  const fc = [0, 0], w = [0, 0];
  const onFloor = (x, z) => {
    if (!clearOfBase(x, z) || z < 100) return false;
    if (Math.abs(x - rearValleyX(z)) > 95) return false;
    if (Math.abs(x - rearRoadX(z)) < 8) return false;
    const y = heightFn(x, z);
    if (y > 15) return false;
    groundNormal(x, z, gn);
    return gn[1] > 0.95;
  };
  fieldCoords(0, 520, fc);
  const U0 = Math.floor(fc[0]) - 8, U1 = U0 + 16, V0 = Math.floor(fieldCoords(0, 60, fc)[1]) - 3, V1 = V0 + 30;
  for (let iu = U0; iu <= U1; iu++) {
    for (let iv = V0; iv <= V1; iv++) {
      // each plot owns its left and near edges; some edges are open
      for (const dir of [0, 1]) {
        if (rng() < 0.3) continue;
        const steps = dir ? 9 : 13;
        for (let k = 0; k < steps; k++) {
          const t = (k + rng() * 0.6) / steps;
          fieldToWorld(dir ? iu : iu + t, dir ? iv + t : iv, w);
          const x = w[0] + (rng() - 0.5) * 1.2, z = w[1] + (rng() - 0.5) * 1.2;
          if (!onFloor(x, z)) continue;
          if (rng() < 0.16) tree(x, z, 0.55 + rng() * 0.5, 0.25);
          else bush(x, z, 1.0 + rng() * 1.1);
        }
      }
      // round bales left out on the stubble
      if (fieldKind(iu, iv) === 1 && rng() < 0.75) {
        const n = 3 + ((rng() * 7) | 0), ry = rng() * 6.28;
        for (let k = 0; k < n; k++) {
          fieldToWorld(iu + 0.2 + 0.6 * rng(), iv + 0.2 + 0.6 * rng(), w);
          const [x, z] = w;
          if (!onFloor(x, z)) continue;
          _e.set(0, ry + (rng() - 0.5) * 0.5, 0);
          _m.compose(_v.set(x, heightFn(x, z) - 0.04, z), _q.setFromEuler(_e), _s.set(1, 1, 1));
          env.addModel('bale', _m, { tint: 0x8a8070 }); // the round bale model on its side (axis along x), dulled to the night
        }
      }
    }
  }

  // ── boulders breaking out of the hill flanks ──────────────────────────────
  for (let k = 0; k < (big ? 260 : 160); k++) {
    const x = (rng() - 0.5) * 900, z = 80 + rng() * 650;
    if (!clearOfBase(x, z)) continue;
    const adx = Math.abs(x - rearValleyX(z));
    if (adx < 90 && rng() < 0.85) continue;
    const s = 1 + Math.pow(rng(), 2) * 4;
    _e.set(rng() * 3, rng() * 3, rng() * 3);
    _m.compose(_v.set(x, heightFn(x, z) + s * 0.15, z), _q.setFromEuler(_e), _s.set(s * 1.3, s * 0.75, s));
    rocks.push(_m.clone());
  }

  const leafMat = weather(new THREE.MeshStandardMaterial({ color: 0x232b1b, roughness: 1, flatShading: true }), { soot: 0.4, key: 'hedge' });
  const coniferGeo = makeConiferGeo(), deadGeo = makeDeadPineGeo();
  instanced(scene, coniferGeo, makePineMat(), rearC);
  instanced(scene, deadGeo, mats.charred, rearD);
  for (const sd of [-1, 1]) {
    // and the crest trees per side, so each side culls on its own
    instanced(scene, coniferGeo, makePineMat(), crestC.filter((m) => Math.sign(m.elements[12]) === sd));
    instanced(scene, deadGeo, mats.charred, crestD.filter((m) => Math.sign(m.elements[12]) === sd));
  }
  instanced(scene, lumpGeo(1, 41, 0.75, 1.2), leafMat, bushes);
  instanced(scene, lumpGeo(1, 77, 0.78, 1.22), env.rockMat, rocks);

  // ── farmsteads along the track ────────────────────────────────────────────
  const houses = [], roofs = [], barns = [];
  const farm = (z, off, seed, { burning = false, lit = false, ruined = false } = {}) => {
    const r = makeRng(seed);
    const cx = rearRoadX(z) + off, cz = z;
    const ry = Math.atan2(rearRoadX(z + 5) - rearRoadX(z - 5), 10) + (r() - 0.5) * 0.2;
    const place = (g, dx, dz) => {
      const c = Math.cos(ry), s = Math.sin(ry);
      const x = cx + c * dx + s * dz, zz = cz - s * dx + c * dz;
      g.rotateY(ry); g.translate(x, heightFn(x, zz) - 0.4, zz);
      return [x, zz];
    };
    // farmhouse: a ruin, or still standing
    if (ruined) {
      const ruin = makeRuin(mats, seed, { w: 9, d: 7, storeys: 2 });
      ruin.position.set(cx, heightFn(cx, cz) - 0.1, cz); ruin.rotation.y = ry;
      scene.add(ruin);
    } else {
      const [hg, rg] = makeHouseGeo(9, 7, 5.5, 3);
      place(hg, 0, 0); houses.push(hg);
      place(rg, 0, 0); roofs.push(rg);
      if (lit) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.1), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.2, 0.45) }));
        const c = Math.cos(ry), s = Math.sin(ry);
        const x = cx + s * 3.55, zz = cz + c * 3.55;
        win.position.set(x, heightFn(cx, cz) + 2.0, zz); win.rotation.y = ry;
        win.id = seed;
        scene.add(win);
        env.flickerWindows.push(win);
      }
    }
    // the barn, a lean-to and a fenced yard
    const side = off > 0 ? 1 : -1;
    const [bg, br] = makeHouseGeo(14, 9, 6, 3.5);
    const [bx, bz] = place(bg, side * 13, 6); barns.push(bg);
    if (!burning) { place(br, side * 13, 6); roofs.push(br); }
    const lean = box(6, 3, 4, 0, 1.5, 0);
    place(lean, side * 12, -6); barns.push(lean);
    for (let k = 0; k < 14; k++) {
      const post = box(0.16, 1.2, 0.16, 0, 0.6, 0);
      place(post, side * (4 + k * 1.4), 12 + (r() - 0.5) * 0.2); houses.push(post);
    }
    if (burning) {
      const y = heightFn(bx, bz);
      fire.add(bx, y + 3.5, bz, 9, 8, 3.4, { smoke: 0.6, glow: true, fogScale: 0.8 });
      fire.add(bx + 3, y + 1.2, bz - 2, 3, 3, 2, { smoke: 0, glow: false, fogScale: 0.8 });
    }
  };
  farm(150, 34, 11, { burning: true });
  farm(265, -30, 12, { lit: true });
  farm(390, 38, 13, { ruined: true });
  farm(540, -36, 14, { lit: true });
  farm(700, 32, 15, { burning: true, ruined: true });
  if (houses.length) { const m = new THREE.Mesh(merge(houses), mats.plaster); m.receiveShadow = true; scene.add(m); }
  if (barns.length) { const m = new THREE.Mesh(merge(barns), mats.wood); m.receiveShadow = true; scene.add(m); }
  if (roofs.length) scene.add(new THREE.Mesh(merge(roofs), mats.roofTile));

  // ── telegraph poles down the track, the line sagging between them ───────
  {
    const poleGeo = merge([cylY(0.13, 9, 6, 0, 4.5, 0), box(1.9, 0.13, 0.13, 0, 8.4, 0)]);
    const ms = [], tops = [];
    for (let z = 112; z < 860; z += 34) {
      const x = rearRoadX(z) + 7.5;
      const lean = (rng() - 0.5) * 0.12 + (z === 248 ? 0.4 : 0);
      _e.set(lean * 0.3, Math.atan2(rearRoadX(z + 5) - rearRoadX(z - 5), 10), lean);
      _m.compose(_v.set(x, heightFn(x, z), z), _q.setFromEuler(_e), _s.set(1, 1, 1));
      ms.push(_m.clone());
      tops.push(lean > 0.3 ? null : [-0.85, 0.85].map((dx) => new THREE.Vector3(dx, 8.5, 0).applyMatrix4(_m)));
    }
    instanced(scene, poleGeo, mats.wood, ms);
    const W = [];
    for (let k = 0; k + 1 < tops.length; k++) {
      const a = tops[k], b = tops[k + 1];
      if (!a || !b) continue;
      for (let c = 0; c < 2; c++) W.push(sagWire(a[c], b[c], 0.9, 0.03, 10));
    }
    if (W.length) scene.add(new THREE.Mesh(merge(W), mats.darkSteel));
  }

  // ── what was left on the track: a truck in the ditch, two cars ───────────
  const wreck = (name, z, off, tilt) => {
    const x = rearRoadX(z) + off, obj = new THREE.Object3D();
    obj.position.set(x, heightFn(x, z) - 0.1, z);
    obj.rotation.set(0, Math.atan2(rearRoadX(z + 5) - rearRoadX(z - 5), 10) + (rng() - 0.5) * 0.6, tilt);
    placeModel(env, name, obj);
  };
  wreck('ural_burnt', 215, 4.6, 0.12);
  wreck('car_saloon', 330, -1.2, 0);
  wreck('car_sedan', 470, 4.8, -0.15);
}
