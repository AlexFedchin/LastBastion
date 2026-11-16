// Modelling kit: geometry helpers, shared materials and the detailed
// vehicle / structure models used to dress the world.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeRng } from '../core/util.js';

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
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWW;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      {
        vec4 wpw = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wpw = instanceMatrix * wpw;
        #endif
        vWW = (modelMatrix * wpw).xyz;
      }`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vWW;
      float wHash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float wNoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(wHash(i), wHash(i + vec3(1,0,0)), f.x), mix(wHash(i + vec3(0,1,0)), wHash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(wHash(i + vec3(0,0,1)), wHash(i + vec3(1,0,1)), f.x), mix(wHash(i + vec3(0,1,1)), wHash(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
      {
        float wn = wNoise(vWW * ${scale.toFixed(3)}) * 0.6 + wNoise(vWW * ${(scale * 4.3).toFixed(3)}) * 0.4;
        float sootM = smoothstep(0.35, 0.8, wn) * ${soot.toFixed(3)};
        diffuseColor.rgb *= 1.0 - sootM * 0.8;
        float rustM = smoothstep(0.55, 0.85, wNoise(vWW * ${(scale * 2.1).toFixed(3)} + 7.0)) * ${rust.toFixed(3)};
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.07, 0.03), rustM);
        diffuseColor.rgb *= 0.82 + 0.36 * wNoise(vWW * ${(scale * 0.35).toFixed(3)} + 3.0);
      }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.6, ${wet.toFixed(3)} * smoothstep(0.4, 0.7, wNoise(vWW * 0.9 + 11.0)));`);
  };
  const ck = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => '';
  mat.customProgramCacheKey = () => ck() + '|weather-' + key + soot + rust + wet + scale;
  return mat;
}

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

// ── vehicles ────────────────────────────────────────────────────────────────
function wheel(r, w, mats, burnt, x, y, z, rot = 0) {
  const parts = [];
  if (!burnt) parts.push([xf(new THREE.TorusGeometry(r * 0.72, r * 0.28, 8, 18), 0, 0, 0, 0, 0, 0, 1, 1, w / (r * 0.56)), mats.rubber]);
  parts.push([cylZ(r * 0.55, w * 0.9, 12), burnt ? mats.burnt : mats.steel]);
  parts.push([cylZ(r * 0.2, w * 1.02, 8), mats.darkSteel]);
  return parts.map(([g, m]) => [xf(g, x, y, z, 0, 0, rot), m]);
}

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

export function makeSedan(mats, { body = mats.burnt, burnt = true, seed = 1 } = {}) {
  const rng = makeRng(seed);
  const L = [];
  const W = 1.74;
  // lower body profile with wheel arches
  const prof = [];
  const arch = (cx, from, to, r = 0.4) => { for (let k = 0; k <= 8; k++) { const a = Math.PI - (k / 8) * Math.PI; prof.push([cx + Math.cos(a) * r * (from < to ? 1 : -1), 0.3 + Math.sin(a) * r]); } };
  prof.push([-2.32, 0.34], [-2.38, 0.62], [-2.28, 0.86], [-1.15, 0.94]);
  prof.push([0.98, 0.96], [2.22, 0.84], [2.36, 0.62], [2.32, 0.34], [1.84, 0.3]);
  arch(1.42, 1, 0); prof.push([-1.0, 0.3]);
  arch(-1.42, 1, 0); prof.push([-1.84, 0.3]);
  // the arch helper produces points right-to-left; fix order for the shape
  const lower = extrude(prof, W - 0.08, 0.04);
  L.push([lower, body]);
  // greenhouse: glass block + roof skin + pillars
  const gh = [[-1.12, 0.94], [-0.66, 1.36], [0.42, 1.4], [0.96, 0.96]];
  L.push([extrude(gh, W - 0.24, 0.01), mats.glass]);
  L.push([extrude([[-0.7, 1.33], [-0.64, 1.42], [0.44, 1.45], [0.4, 1.36]], W - 0.18, 0.02), body]);
  for (const s of [-1, 1]) {
    L.push([box(0.06, 0.48, 0.06, -0.9, 1.15, s * (W / 2 - 0.12), 0, 0, -0.75), body]);
    L.push([box(0.06, 0.5, 0.06, 0.7, 1.16, s * (W / 2 - 0.12), 0, 0, 0.85), body]);
    L.push([box(0.07, 0.44, 0.05, -0.1, 1.15, s * (W / 2 - 0.11)), body]);
    // door seams and handles
    L.push([box(0.02, 0.5, 0.01, 0.15, 0.62, s * (W / 2 - 0.02)), mats.darkSteel]);
    L.push([box(0.02, 0.5, 0.01, -1.0, 0.62, s * (W / 2 - 0.02)), mats.darkSteel]);
    L.push([box(0.12, 0.03, 0.02, -0.05, 0.82, s * (W / 2 - 0.01)), mats.steel]);
    // mirrors
    L.push([box(0.12, 0.09, 0.14, 0.88, 1.02, s * (W / 2 + 0.04)), body]);
  }
  // bumpers, lights, grille
  L.push([box(0.12, 0.18, W - 0.04, 2.36, 0.44, 0), mats.darkSteel]);
  L.push([box(0.12, 0.18, W - 0.04, -2.4, 0.46, 0), mats.darkSteel]);
  L.push([box(0.05, 0.16, 0.9, 2.37, 0.66, 0), mats.darkSteel]);
  for (const s of [-1, 1]) L.push([box(0.04, 0.12, 0.3, 2.35, 0.72, s * 0.64), mats.glass]);
  for (const s of [-1, 1]) L.push([box(0.04, 0.12, 0.3, -2.37, 0.76, s * 0.6), mats.paintRed]);
  // underside
  L.push([box(4.2, 0.12, W - 0.3, 0, 0.28, 0), mats.darkSteel]);
  // wheels
  for (const sx of [-1.42, 1.42]) for (const s of [-1, 1]) {
    if (burnt && rng() < 0.25) continue;
    for (const w of wheel(0.34, 0.22, mats, burnt, sx, 0.33 - (burnt ? 0.1 : 0), s * (W / 2 - 0.12))) L.push(w);
  }
  return assemble(L);
}

export function makeTruck(mats, { body = mats.olive, burnt = false, seed = 2, covered = true } = {}) {
  const rng = makeRng(seed);
  const L = [];
  const W = 2.45;
  // chassis rails
  for (const s of [-1, 1]) L.push([box(7.4, 0.25, 0.16, -0.3, 0.95, s * 0.55), mats.darkSteel]);
  // cab with slanted windscreen
  L.push([extrude([[2.0, 1.1], [2.0, 2.15], [2.25, 2.85], [3.55, 2.85], [3.75, 2.3], [3.75, 1.1]], W - 0.1, 0.05), body]);
  L.push([extrude([[2.28, 2.25], [2.36, 2.75], [3.48, 2.75], [3.66, 2.28]], W - 0.02, 0.01), mats.glass]);
  // bonnet & grille
  L.push([extrude([[3.75, 1.05], [3.75, 2.05], [4.9, 1.95], [5.05, 1.6], [5.05, 1.05]], 1.9, 0.05), body]);
  L.push([box(0.06, 0.7, 1.4, 5.08, 1.45, 0), mats.darkSteel]);
  for (let k = 0; k < 7; k++) L.push([box(0.04, 0.6, 0.04, 5.11, 1.45, -0.6 + k * 0.2), mats.steel]);
  for (const s of [-1, 1]) {
    L.push([cylX(0.13, 0.08, 10, 5.1, 1.85, s * 0.78), mats.glass]);
    // fenders
    L.push([extrude([[3.6, 1.0], [3.75, 1.45], [4.9, 1.45], [5.05, 1.0]], 0.42, 0.03).translate(0, 0, s * 1.05), body]);
    L.push([box(0.05, 1.3, 0.05, 2.25, 2.1, s * 1.3), mats.darkSteel]); // mirror arm
    L.push([box(0.06, 0.32, 0.18, 2.25, 2.45, s * 1.36), mats.darkSteel]);
    // fuel tank, step
    L.push([cylX(0.28, 1.1, 12, 1.2, 0.95, s * 0.95), body]);
    L.push([box(0.4, 0.06, 0.3, 1.9, 0.6, s * 1.1), mats.darkSteel]);
  }
  L.push([box(0.15, 0.25, W, 5.1, 0.85, 0), mats.darkSteel]);
  // cargo bed
  const bedL = 4.6, bx = -1.45;
  L.push([box(bedL, 0.12, W, bx, 1.3, 0), mats.wood]);
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) L.push([box(bedL, 0.16, 0.06, bx, 1.5 + k * 0.22, s * (W / 2 - 0.03)), body]);
    for (let k = 0; k <= 4; k++) L.push([box(0.08, 0.7, 0.08, bx - bedL / 2 + k * (bedL / 4), 1.65, s * (W / 2 - 0.03)), mats.darkSteel]);
  }
  L.push([box(0.06, 0.7, W, bx - bedL / 2, 1.65, 0), body]);
  if (covered) {
    // canvas tilt over hoops: half-cylinder shell
    const shell = new THREE.CylinderGeometry(W / 2, W / 2, bedL, 16, 1, true, 0, Math.PI);
    xf(shell, bx, 2.0, 0, 0, 0, Math.PI / 2);
    const p = shell.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, 2.0 + (p.getY(i) - 2.0) * 0.75 + Math.sin(p.getX(i) * 3) * 0.03);
    shell.computeVertexNormals();
    L.push([shell, mats.canvas]);
    for (const s of [-1, 1]) L.push([box(bedL, 0.75, 0.02, bx, 1.65, s * (W / 2 + 0.01)), mats.canvas]);
  } else {
    for (let k = 0; k < 4; k++) {
      const hoop = new THREE.TorusGeometry(W / 2 - 0.05, 0.03, 4, 12, Math.PI);
      L.push([xf(hoop, bx - bedL / 2 + 0.4 + k * 1.25, 1.95, 0, 0, Math.PI / 2), mats.darkSteel]);
    }
  }
  // wheels (dual rear axles)
  const axles = [4.15, -0.9, -2.35];
  for (const ax of axles) for (const s of [-1, 1]) {
    if (burnt && rng() < 0.2) continue;
    for (const w of wheel(0.55, 0.42, mats, burnt, ax, 0.55 - (burnt ? 0.14 : 0), s * 1.0)) L.push(w);
  }
  for (const s of [-1, 1]) L.push([extrude([[-3.0, 1.1], [-2.9, 1.25], [-0.35, 1.25], [-0.25, 1.1]], 0.55, 0.02).translate(0, 0, s * 1.0), mats.darkSteel]);
  const g = assemble(L);
  g.position.x = -0.8;
  const wrap = new THREE.Group(); wrap.add(g);
  return wrap;
}

export function makeTank(mats, { body = mats.burnt, seed = 3 } = {}) {
  const rng = makeRng(seed);
  const L = [];
  const W = 3.5;
  // hull side profile: sloped glacis and rear
  L.push([extrude([[-3.4, 0.55], [-3.6, 1.35], [-3.2, 1.75], [2.4, 1.75], [3.8, 1.2], [3.6, 0.55]], 2.3, 0.05), body]);
  // sponsons over the tracks
  for (const s of [-1, 1]) {
    L.push([box(7.2, 0.12, 0.65, 0.1, 1.55, s * 1.48), body]);
    // side skirts with panels
    for (let k = 0; k < 6; k++) {
      if (rng() < 0.25) continue;
      L.push([box(1.12, 0.55, 0.05, -2.75 + k * 1.15, 1.25, s * 1.82, 0, 0, (rng() - 0.5) * 0.06), body]);
    }
    // track run: belt as a flattened loop of boxes + road wheels
    L.push([box(6.4, 0.08, 0.6, 0.1, 0.06, s * 1.48), mats.darkSteel]);
    L.push([box(6.1, 0.08, 0.6, 0.0, 1.05, s * 1.48), mats.darkSteel]);
    for (let k = 0; k < 7; k++) L.push([cylZ(0.36, 0.5, 14, -2.6 + k * 0.85, 0.42, s * 1.48), mats.darkSteel]);
    L.push([cylZ(0.38, 0.55, 12, 3.3, 0.75, s * 1.48), mats.darkSteel]);
    L.push([cylZ(0.34, 0.55, 12, -3.35, 0.72, s * 1.48), mats.darkSteel]);
    for (let k = 0; k < 40; k++) {
      const t = k / 40;
      L.push([box(0.12, 0.06, 0.62, -3.2 + t * 6.5, 0.04, s * 1.48), mats.steel]);
    }
  }
  // turret: low faceted block
  L.push([extrude([[-1.6, 1.75], [-1.75, 2.35], [-1.3, 2.75], [1.3, 2.75], [2.0, 2.2], [1.8, 1.75]], 2.7, 0.06).translate(-0.3, 0, 0), body]);
  L.push([cylY(0.5, 0.35, 12, -0.6, 2.9, 0.55), body]);
  L.push([cylY(0.42, 0.12, 12, -0.6, 3.1, 0.55), mats.darkSteel]);
  L.push([cylY(0.38, 0.25, 12, -0.4, 2.85, -0.7), body]);
  // gun: drooping barrel with fume extractor
  const droop = -0.08 - rng() * 0.12;
  const gun = merge([cylX(0.11, 4.6, 12, 2.3 + 1.6, 0, 0), cylX(0.17, 0.9, 12, 2.8 + 1.0, 0, 0), cylX(0.24, 0.6, 12, 1.65 + 0.3, 0, 0)]);
  xf(gun, 0, 2.3, 0, 0, 0, droop);
  L.push([gun, mats.darkSteel]);
  // stowage bins, smoke dischargers
  L.push([box(1.2, 0.5, 2.9, -2.2, 2.2, 0), body]);
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) L.push([cylX(0.06, 0.3, 6, 1.6, 2.5 + k * 0.1, s * (1.25 + k * 0.05)), mats.darkSteel]);
  // engine deck grilles
  for (let k = 0; k < 6; k++) L.push([box(0.06, 0.04, 1.8, -1.4 - k * 0.3, 1.78, 0), mats.darkSteel]);
  return assemble(L);
}

export function makeHelicopter(mats, { body = mats.burnt } = {}) {
  const L = [];
  // fuselage: lathe-like body from a tapered cylinder, squashed
  const fus = new THREE.CylinderGeometry(1.0, 1.15, 6.5, 16, 6);
  const p = fus.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const t = (y + 3.25) / 6.5; // 0 tail .. 1 nose
    const k = t > 0.8 ? 1 - Math.pow((t - 0.8) / 0.2, 2) * 0.55 : 1;
    p.setX(i, p.getX(i) * k);
    p.setZ(i, p.getZ(i) * k * 0.95);
  }
  fus.computeVertexNormals();
  L.push([xf(fus, 0, 1.45, 0, 0, 0, -Math.PI / 2, 1, 1, 1.0), body]);
  // cockpit glass (shattered: dark)
  L.push([xf(new THREE.SphereGeometry(0.95, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), 2.9, 1.65, 0, 0, 0, -Math.PI / 2 + 0.3, 1, 1.1, 1), mats.glass]);
  // engine housing + exhausts
  L.push([box(2.6, 0.6, 1.3, -0.2, 2.65, 0), body]);
  for (const s of [-1, 1]) L.push([cylX(0.22, 1.0, 10, -1.2, 2.6, s * 0.6), mats.darkSteel]);
  // tail boom (snapped and bent)
  const boom = new THREE.CylinderGeometry(0.28, 0.55, 5.5, 10);
  L.push([xf(boom, -5.6, 1.9, 0.6, 0.08, 0.25, Math.PI / 2 + 0.12), body]);
  L.push([box(1.3, 1.9, 0.12, -8.2, 2.9, 1.3, 0.1, 0.25, -0.4), body]);
  // stub wings, doors open
  for (const s of [-1, 1]) L.push([box(1.0, 0.1, 1.8, 0.6, 2.2, s * 1.6, s * 0.15), body]);
  L.push([box(1.6, 1.4, 0.05, 0.9, 1.35, 1.12, 0, 0.35), body]);
  // main rotor: hub + bent blades
  L.push([cylY(0.3, 0.5, 10, -0.1, 3.15, 0), mats.darkSteel]);
  const blades = [[0.2, -0.05], [1.8, 0.3], [3.4, -0.35], [4.9, 0.6]];
  for (const [a, bend] of blades) {
    const b = new THREE.BoxGeometry(5.8, 0.05, 0.42, 8, 1, 1);
    const bp = b.attributes.position;
    for (let i = 0; i < bp.count; i++) { const x = bp.getX(i) + 2.9; bp.setY(i, bp.getY(i) - Math.pow(x / 5.8, 2) * bend * 3); }
    b.translate(2.9, 0, 0);
    b.computeVertexNormals();
    L.push([xf(b, -0.1, 3.35, 0, 0, a, 0), body]);
  }
  // landing gear
  for (const s of [-1, 1]) L.push([cylZ(0.3, 0.2, 10, 1.6, 0.3, s * 1.0), mats.rubber]);
  return assemble(L);
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
