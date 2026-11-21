// Modelling kit: geometry helpers, shared materials and the detailed
// vehicle / structure models used to dress the world.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeRng } from '../core/util.js';
import { Fn, float, vec3, vec4, positionWorld, materialColor, materialRoughness, mix, smoothstep, fract, floor } from 'three/tsl';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** Transform a geometry (returns it). */
export function xf(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  _m.compose(_p, _q, _s);
  geo.applyMatrix4(_m);
  return geo;
}

/** Merge geometries (normalising index/attributes). */
export function merge(geos) {
  const list = geos.filter(Boolean).map((g) => {
    let h = g.index ? g.toNonIndexed() : g;
    if (!h.attributes.uv) h.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(h.attributes.position.count * 2), 2));
    if (!h.attributes.normal) h.computeVertexNormals();
    for (const k of Object.keys(h.attributes)) if (!['position', 'normal', 'uv'].includes(k)) h.deleteAttribute(k);
    return h;
  });
  return mergeGeometries(list);
}

/**
 * Re-project a mesh's UVs onto the plane each face points along, at `tile` metres per
 * repeat: a scanned texture then lands at its real size on any box, however long or tall
 * (BoxGeometry maps one repeat per face, which smears a scan across a 7 m wall panel).
 */
export function worldUV(geo, tile, ox = 0, oz = 0) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + ox, y = p.getY(i), z = p.getZ(i) + oz;
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    if (ay >= ax && ay >= az) uv.setXY(i, x / tile, z / tile);
    else if (ax >= az) uv.setXY(i, z / tile, y / tile);
    else uv.setXY(i, x / tile, y / tile);
  }
  uv.needsUpdate = true;
  return geo;
}

export const box = (w, h, d, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => xf(new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz);
export const cylX = (r, l, seg = 12, x = 0, y = 0, z = 0) => xf(new THREE.CylinderGeometry(r, r, l, seg), x, y, z, 0, 0, Math.PI / 2);
export const cylY = (r, l, seg = 12, x = 0, y = 0, z = 0) => xf(new THREE.CylinderGeometry(r, r, l, seg), x, y, z);
export const cylZ = (r, l, seg = 12, x = 0, y = 0, z = 0) => xf(new THREE.CylinderGeometry(r, r, l, seg), x, y, z, Math.PI / 2);

/** Superellipsoid "pillow" box, used for sandbags, tyres, cushions. */
export function pillow(w, h, d, e = 0.35, wseg = 12, hseg = 8) {
  const g = new THREE.SphereGeometry(1, wseg, hseg);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const f = (v) => Math.sign(v) * Math.pow(Math.abs(v), e);
    p.setXYZ(i, f(x) * w / 2, f(y) * h / 2, f(z) * d / 2);
  }
  g.computeVertexNormals();
  return g;
}

/** A filled sandbag with a crimped tie end. */
export function sandbagGeo() {
  const g = pillow(0.62, 0.17, 0.34, 0.32, 14, 8);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const t = Math.max(0, (x - 0.18) / 0.13);
    const k = 1 - 0.45 * Math.min(1, t * t);
    p.setY(i, p.getY(i) * k * (1 + 0.08 * Math.sin(x * 20)));
    p.setZ(i, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

/** Helix tube (concertina razor wire). */
export function concertinaGeo(length = 3, radius = 0.42, pitch = 0.14, tube = 0.007) {
  const turns = length / pitch;
  class Helix extends THREE.Curve {
    getPoint(t, out = new THREE.Vector3()) {
      const a = t * turns * Math.PI * 2;
      const wob = 1 + 0.06 * Math.sin(a * 0.37);
      return out.set(t * length - length / 2, Math.sin(a) * radius * wob + radius, Math.cos(a) * radius * wob);
    }
  }
  return new THREE.TubeGeometry(new Helix(), Math.floor(turns * 10), tube, 3, false);
}

/** Polyline sagging wire as a thin tube between two points. */
export function sagWire(a, b, sag = 1, r = 0.012, segs = 16) {
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    pts.push(new THREE.Vector3().lerpVectors(a, b, t).add(new THREE.Vector3(0, -4 * t * (1 - t) * sag, 0)));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), segs, r, 3, false);
}

/** Extrude a 2D profile (in the XY plane) along Z, centred on z. */
export function extrude(points, depth, bevel = 0.02, holes = []) {
  const s = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  for (const h of holes) s.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))));
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 6 });
  g.translate(0, 0, -depth / 2);
  return g;
}

// ── materials ───────────────────────────────────────────────────────────────
/** World-space grime / soot / variation added to any standard material. */
export function weather(mat, { soot = 0.5, rust = 0.0, wet = 0.3, scale = 0.6, key = 'w' } = {}) {
  void key;
  const base = mat.colorNode || materialColor, baseR = mat.roughnessNode || materialRoughness;
  const wp = positionWorld; // (instancing included)
  mat.colorNode = Fn(() => {
    const b4 = vec4(base);
    const wn = wNoise(wp.mul(scale)).mul(0.6).add(wNoise(wp.mul(scale * 4.3)).mul(0.4));
    const sootM = smoothstep(0.35, 0.8, wn).mul(soot);
    let c = b4.rgb.mul(float(1).sub(sootM.mul(0.8)));
    if (rust > 0) {
      const rustM = smoothstep(0.55, 0.85, wNoise(wp.mul(scale * 2.1).add(7))).mul(rust);
      c = mix(c, vec3(0.16, 0.07, 0.03), rustM);
    }
    c = c.mul(wNoise(wp.mul(scale * 0.35).add(3)).mul(0.36).add(0.82));
    return vec4(c, b4.a);
  })();
  mat.roughnessNode = Fn(() => {
    const r = float(baseR);
    return mix(r, r.mul(0.6), smoothstep(0.4, 0.7, wNoise(wp.mul(0.9).add(11))).mul(wet));
  })();
  return mat;
}

const wHash = Fn(([p0]) => {
  const p = fract(p0.mul(0.3183099).add(0.1)).mul(17).toVar();
  return fract(p.x.mul(p.y).mul(p.z).mul(p.x.add(p.y).add(p.z)));
}).setLayout({ name: 'wHash', type: 'float', inputs: [{ name: 'p0', type: 'vec3' }] });

/** Value noise in 3D (world-space grime, shared by the weathered materials). */
export const wNoise = Fn(([x]) => {
  const i = floor(x), f0 = fract(x);
  const f = f0.mul(f0).mul(f0.mul(-2).add(3));
  const h = (o) => wHash(i.add(vec3(...o)));
  return mix(
    mix(mix(h([0, 0, 0]), h([1, 0, 0]), f.x), mix(h([0, 1, 0]), h([1, 1, 0]), f.x), f.y),
    mix(mix(h([0, 0, 1]), h([1, 0, 1]), f.x), mix(h([0, 1, 1]), h([1, 1, 1]), f.x), f.y), f.z);
}).setLayout({ name: 'wNoise', type: 'float', inputs: [{ name: 'x', type: 'vec3' }] });

export function makeMaterials(tex) {
  const M = {};
  const metal = tex.metal;
  M.burnt = weather(new THREE.MeshStandardMaterial({ map: metal.map, roughnessMap: metal.roughnessMap, normalMap: metal.normalMap, color: 0x3a3532, roughness: 1, metalness: 0.35, envMapIntensity: 0.5 }), { soot: 0.9, rust: 0.5, key: 'burnt' });
  M.olive = weather(new THREE.MeshStandardMaterial({ map: metal.map, roughnessMap: metal.roughnessMap, normalMap: metal.normalMap, color: 0x6d7650, roughness: 1, metalness: 0.25, envMapIntensity: 0.5 }), { soot: 0.4, rust: 0.25, key: 'olive' });
  M.paintRed = weather(new THREE.MeshStandardMaterial({ map: metal.map, roughnessMap: metal.roughnessMap, normalMap: metal.normalMap, color: 0x8a3a2c, roughness: 1, metalness: 0.3, envMapIntensity: 0.6 }), { soot: 0.55, rust: 0.35, key: 'red' });
  M.paintBlue = weather(new THREE.MeshStandardMaterial({ map: metal.map, roughnessMap: metal.roughnessMap, normalMap: metal.normalMap, color: 0x3d5266, roughness: 1, metalness: 0.3, envMapIntensity: 0.6 }), { soot: 0.55, rust: 0.35, key: 'blue' });
  M.paintWhite = weather(new THREE.MeshStandardMaterial({ map: metal.map, roughnessMap: metal.roughnessMap, normalMap: metal.normalMap, color: 0x9b9890, roughness: 1, metalness: 0.3, envMapIntensity: 0.6 }), { soot: 0.6, rust: 0.3, key: 'white' });
  M.steel = weather(new THREE.MeshStandardMaterial({ color: 0x2f2e2b, roughness: 0.55, metalness: 0.75, envMapIntensity: 0.6 }), { soot: 0.3, rust: 0.4, key: 'steel' });
  M.darkSteel = new THREE.MeshStandardMaterial({ color: 0x1c1c1b, roughness: 0.6, metalness: 0.6 });
  M.rubber = new THREE.MeshStandardMaterial({ color: 0x0f0f0f, roughness: 0.92, metalness: 0 });
  M.glass = new THREE.MeshStandardMaterial({ color: 0x05070a, roughness: 0.08, metalness: 0.2, envMapIntensity: 1.4 });
  M.wood = weather(new THREE.MeshStandardMaterial({ map: tex.bark, color: 0x6a5a48, roughness: 0.95 }), { soot: 0.5, key: 'wood' });
  M.charred = new THREE.MeshStandardMaterial({ map: tex.bark, color: 0x4a4440, roughness: 1 });
  M.canvas = weather(new THREE.MeshStandardMaterial({ map: tex.burlap, color: 0x6f7052, roughness: 1, side: THREE.DoubleSide }), { soot: 0.35, key: 'canvas' });
  M.plaster = weather(new THREE.MeshStandardMaterial({ map: tex.plaster.map, normalMap: tex.plaster.normalMap, color: 0xb0aaa0, roughness: 0.95 }), { soot: 0.7, key: 'plaster' });
  M.roofTile = weather(new THREE.MeshStandardMaterial({ color: 0x4a2a20, roughness: 0.85 }), { soot: 0.6, key: 'tile' });
  M.concrete = weather(new THREE.MeshStandardMaterial({ map: tex.concrete.map, normalMap: tex.concrete.normalMap, color: 0x8f8b84, roughness: 0.92 }), { soot: 0.45, key: 'conc' });
  return M;
}

// ── merged builds (the ruins; the vehicles are downloaded models, see vehicles.js) ──
/** Group meshes by material and merge per material. */
function assemble(list) {
  const byMat = new Map();
  for (const [g, m] of list) { if (!byMat.has(m)) byMat.set(m, []); byMat.get(m).push(g); }
  const grp = new THREE.Group();
  for (const [m, gs] of byMat) {
    const mesh = new THREE.Mesh(merge(gs), m);
    mesh.castShadow = true; mesh.receiveShadow = true;
    grp.add(mesh);
  }
  return grp;
}

/** A ruined two-storey house: walls with holes, broken roof beams. */
export function makeRuin(mats, seed = 7, { w = 9, d = 7, storeys = 2 } = {}) {
  const rng = makeRng(seed);
  const L = [];
  const H = storeys * 2.9;
  const T = 0.3;
  const wall = (len, x, z, ry) => {
    // wall made of vertical strips so we can knock holes and jag the top
    const cols = Math.max(3, Math.round(len / 0.9));
    const cw = len / cols;
    for (let c = 0; c < cols; c++) {
      const top = H * (0.45 + 0.55 * Math.pow(rng(), 0.4)) * (c === 0 || c === cols - 1 ? 1.05 : 1);
      const lx = -len / 2 + (c + 0.5) * cw;
      // window gaps per storey
      let y = 0;
      for (let s = 0; s < storeys; s++) {
        const sy = s * 2.9;
        const win = c % 3 === 1 && rng() < 0.85;
        if (win) {
          L.push([xf(new THREE.BoxGeometry(cw, 0.95, T), lx, sy + 0.475, 0), mats.plaster]);
          if (top > sy + 2.2) L.push([xf(new THREE.BoxGeometry(cw, Math.min(top, sy + 2.9) - (sy + 2.2), T), lx, (sy + 2.2 + Math.min(top, sy + 2.9)) / 2, 0), mats.plaster]);
          y = sy + 2.9;
        } else {
          const h = Math.min(top, sy + 2.9) - sy;
          if (h > 0.05) L.push([xf(new THREE.BoxGeometry(cw, h, T), lx, sy + h / 2, 0), mats.plaster]);
          y = sy + 2.9;
        }
        if (top < sy + 2.9) break;
      }
      void y;
    }
    // apply to the last pushed strips
    return (start) => { for (let k = start; k < L.length; k++) xf(L[k][0], x, 0, z, 0, ry, 0); };
  };
  const walls = [[w, 0, -d / 2, 0], [w, 0, d / 2, Math.PI], [d, -w / 2, 0, Math.PI / 2], [d, w / 2, 0, -Math.PI / 2]];
  for (const [len, x, z, ry] of walls) {
    if (rng() < 0.18) continue; // a wall blown away entirely
    const start = L.length;
    wall(len, x, z, ry)(start);
  }
  // floor slab remnants and roof beams
  L.push([box(w * 0.7, 0.18, d * 0.6, -w * 0.12, 2.9, d * 0.1, 0.06, 0, 0.09), mats.concrete]);
  for (let k = 0; k < 6; k++) {
    if (rng() < 0.3) continue;
    const bz = -d / 2 + (k + 0.5) * d / 6;
    L.push([box(0.14, 0.2, w * (0.5 + rng() * 0.5), -w / 4 + rng() * w / 2, H - 0.2 - rng() * 1.6, bz, rng() * 0.4, Math.PI / 2, (rng() - 0.5) * 0.5), mats.charred]);
  }
  // rubble heap
  for (let k = 0; k < 26; k++) {
    const s = 0.25 + rng() * 0.7;
    L.push([xf(new THREE.DodecahedronGeometry(s, 0), (rng() - 0.5) * w * 1.2, s * 0.3, (rng() - 0.5) * d * 1.2, rng() * 3, rng() * 3, 0, 1.2, 0.6, 1), mats.concrete]);
  }
  // chimney
  L.push([box(0.7, H + 1.4, 0.7, w / 2 - 0.6, (H + 1.4) / 2, -d / 2 + 0.6), mats.plaster]);
  return assemble(L);
}

/** Small intact-ish village house with a gable roof (far away, cheap). */
export function makeHouseGeo(w, d, h, roofH) {
  const g1 = box(w, h, d, 0, h / 2, 0);
  const roof = extrude([[-w / 2 - 0.3, h], [0, h + roofH], [w / 2 + 0.3, h]], d + 0.4, 0);
  return [g1, roof];
}

/** Steel lattice pylon for the power line on the hills. */
export function makePylonGeo(h = 28) {
  const G = [];
  const legs = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  const base = 3.2, top = 0.8;
  for (const [sx, sz] of legs) {
    const a = new THREE.Vector3(sx * base, 0, sz * base), b = new THREE.Vector3(sx * top, h, sz * top);
    const len = a.distanceTo(b);
    const g = new THREE.BoxGeometry(0.2, len, 0.2);
    g.translate(0, len / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    g.applyQuaternion(q); g.translate(a.x, a.y, a.z);
    G.push(g);
  }
  for (let k = 0; k < 7; k++) {
    const y = k * h / 7 + 1.5, w = base + (top - base) * (y / h);
    for (const ry of [0, Math.PI / 2]) {
      G.push(xf(new THREE.BoxGeometry(w * 2.6, 0.1, 0.1), 0, y, 0, 0, ry, 0.6));
      G.push(xf(new THREE.BoxGeometry(w * 2.6, 0.1, 0.1), 0, y, 0, 0, ry, -0.6));
    }
  }
  // cross arms
  for (const y of [h - 4, h - 1]) G.push(box(12, 0.35, 0.5, 0, y, 0));
  G.push(box(7, 0.35, 0.5, 0, h + 2, 0));
  return merge(G);
}
