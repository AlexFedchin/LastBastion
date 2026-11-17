// Builds the game's model files (app/models/*.glb) from the downloaded source
// models: reorients them to the game's axes, scales them to metres, drops what
// can never be seen, simplifies, resizes textures to WebP and meshopt-packs.
//
//   node scripts/models/build_models.mjs [m2hb|ac130|b36 ...]
//
// Tooling (gltf-transform, meshoptimizer, sharp): cd scripts/models && npm i
// Sources live in scripts/models/source/ (git-ignored, not shipped). See app/models/CREDITS.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { load } from './load.mjs';
import { makeRetargeter } from './retarget.mjs';

import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, simplify, dedup, prune, meshopt, transformMesh, flatten, getBounds, compactPrimitive } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));

const ROOT = path.resolve(here, '..', '..');
const SRC = path.join(here, 'source');
const OUT = path.join(ROOT, 'app', 'models');
fs.mkdirSync(OUT, { recursive: true });
await MeshoptSimplifier.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

// ── helpers ──────────────────────────────────────────────────────────────────
const webp = (img, size, q = 82) => sharp(img).resize(size, size, { fit: 'fill' }).webp({ quality: q }).toBuffer();

/** Pack occlusion (R), roughness (G), metalness (B) into one WebP. */
async function orm(ao, rough, metal, size) {
  const ch = async (f, fill) => f ? sharp(f).resize(size, size, { fit: 'fill' }).greyscale().raw().toBuffer() : Buffer.alloc(size * size, fill);
  const [a, r, m] = await Promise.all([ch(ao, 255), ch(rough, 200), ch(metal, 0)]);
  const px = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i++) { px[i * 3] = a[i]; px[i * 3 + 1] = r[i]; px[i * 3 + 2] = m[i]; }
  return sharp(px, { raw: { width: size, height: size, channels: 3 } }).webp({ quality: 85 }).toBuffer();
}

function tex(doc, name, buf) {
  return doc.createTexture(name).setImage(buf).setMimeType('image/webp');
}

/** Add an indexed three BufferGeometry as a glTF primitive. */
function prim(doc, buffer, geo, mat) {
  geo = geo.index ? geo : mergeVertices(geo, 1e-5);
  const p = doc.createPrimitive().setMaterial(mat);
  const acc = (arr, type) => doc.createAccessor().setArray(arr).setType(type).setBuffer(buffer);
  p.setAttribute('POSITION', acc(new Float32Array(geo.attributes.position.array), 'VEC3'));
  if (geo.attributes.normal) p.setAttribute('NORMAL', acc(new Float32Array(geo.attributes.normal.array), 'VEC3'));
  if (geo.attributes.uv) { // three's OBJ/FBX loaders keep GL's bottom-left origin; glTF's is top-left
    const uv = new Float32Array(geo.attributes.uv.array);
    for (let i = 1; i < uv.length; i += 2) uv[i] = 1 - uv[i];
    p.setAttribute('TEXCOORD_0', acc(uv, 'VEC2'));
  }
  const n = geo.attributes.position.count;
  p.setIndices(acc(n > 65535 ? new Uint32Array(geo.index.array) : new Uint16Array(geo.index.array), 'SCALAR'));
  return p;
}

/** Extract one material group of a non-indexed or indexed geometry. */
function groupGeo(geo, g) {
  const out = new THREE.BufferGeometry();
  const src = geo.index ? geo.toNonIndexed() : geo;
  for (const k of ['position', 'normal', 'uv']) {
    const a = src.attributes[k]; if (!a) continue;
    out.setAttribute(k, new THREE.BufferAttribute(a.array.slice(g.start * a.itemSize, (g.start + g.count) * a.itemSize), a.itemSize));
  }
  return out;
}

/** Mirrored parts of some sources carry normals facing into the surface: flip each one that disagrees with its triangle. */
function fixNormals(g) {
  const p = g.attributes.position, n = g.attributes.normal;
  if (!n || g.index) return 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), f = new THREE.Vector3(), v = new THREE.Vector3();
  let flipped = 0;
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    f.subVectors(c, b).cross(v.subVectors(a, b));
    for (let j = 0; j < 3; j++) {
      v.fromBufferAttribute(n, i + j);
      if (v.dot(f) < 0) { n.setXYZ(i + j, -v.x, -v.y, -v.z); flipped++; }
    }
  }
  return flipped;
}

const acc0 = (doc, buffer, arr, type) => doc.createAccessor().setArray(arr).setType(type).setBuffer(buffer);

async function finish(doc, file, { ratio = 1, error = 0.001 } = {}) {
  await doc.transform(
    dedup(), weld(),
    ...(ratio < 1 ? [simplify({ simplifier: MeshoptSimplifier, ratio, error, lockBorder: false })] : []),
    prune({ keepLeaves: true }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const outPath = path.join(OUT, file);
  await io.write(outPath, doc);
  const tris = doc.getRoot().listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((t, p) => t + (p.getIndices() ? p.getIndices().getCount() / 3 : 0), 0), 0);
  console.log(`${file}: ${(fs.statSync(outPath).size / 1048576).toFixed(2)} MB, ${tris | 0} triangles`);
}

// ── M2HB: the player's gun ───────────────────────────────────────────────────
// Source: one Z-up mesh, barrel along +x, ammo can on +y; five material groups,
// each with its own PBR texture set (FBX links recovered from the original paths).
// Game: camera space, barrel along -z, y up, muzzle at (0, 0.02, -2.19).
async function m2hb() {
  const fbx = await load(path.join(SRC, 'M2HB', 'M2HB.fbx'));
  fbx.updateMatrixWorld(true);
  let mesh; fbx.traverse((o) => { if (o.isMesh) mesh = o; });
  const geo = mesh.geometry.clone();
  // x' = -y, y' = z, z' = -x  (a proper rotation)
  const rot = new THREE.Matrix4().set(0, -1, 0, 0, 0, 0, 1, 0, -1, 0, 0, 0, 0, 0, 0, 1);
  geo.applyMatrix4(rot);
  const parts = [ // material name -> part name, texture folder, texture size
    ['Material', 'barrel', 3, 1024], ['Material.001', 'receiver', 2, 2048], ['None', 'rear', 4, 1024],
    ['Material.003', 'ammo', 1, 1024], ['Material.002', 'mount', 5, 1024],
  ];
  const groups = Object.fromEntries(geo.groups.map((g) => [mesh.material[g.materialIndex].name, groupGeo(geo, g)]));

  // fit: muzzle tip at z = -2.19 on the bore line, back of the grips at about z = +0.06
  const barrel = groups.Material;
  barrel.computeBoundingBox();
  const zMin = barrel.boundingBox.min.z;
  const tip = new THREE.Box3(); const v = new THREE.Vector3(), pa = barrel.attributes.position;
  for (let i = 0; i < pa.count; i++) { v.fromBufferAttribute(pa, i); if (v.z < zMin + 0.08) tip.expandByPoint(v); }
  const bore = tip.getCenter(new THREE.Vector3());
  const all = new THREE.Box3();
  for (const g of Object.values(groups)) { g.computeBoundingBox(); if (g !== groups['Material.002']) all.union(g.boundingBox); }
  const L = all.max.z - zMin;
  const s = 2.25 / L;
  const fit = new THREE.Matrix4().makeScale(s, s, s).premultiply(new THREE.Matrix4().makeTranslation(0, 0.02 - bore.y * s, -2.19 - zMin * s))
    .multiply(new THREE.Matrix4().makeTranslation(-bore.x, 0, 0));
  console.log('m2hb source length', L.toFixed(3), 'scale', s.toFixed(4), 'bore', bore.toArray().map((x) => x.toFixed(3)));

  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('M2HB');
  const root = doc.createNode('M2HB');
  scene.addChild(root);
  const T = (n, f) => path.join(SRC, 'M2HB', 'texture', String(n), f);
  for (const [matName, part, set, size] of parts) {
    const g = groups[matName];
    g.applyMatrix4(fit);
    const mat = doc.createMaterial(part)
      .setBaseColorTexture(tex(doc, part + '_color', await webp(T(set, 'None_Base_Color.png'), size)))
      .setNormalTexture(tex(doc, part + '_normal', await webp(T(set, 'None_Normal_OpenGL.png'), size, 90)))
      .setMetallicFactor(1).setRoughnessFactor(1);
    const ormTex = tex(doc, part + '_orm', await orm(T(set, 'None_Mixed_AO.png'), T(set, 'None_Roughness.png'), T(set, 'None_Metallic.png'), size));
    mat.setMetallicRoughnessTexture(ormTex).setOcclusionTexture(ormTex);
    const m = doc.createMesh(part).addPrimitive(prim(doc, buffer, g, mat));
    root.addChild(doc.createNode(part).setMesh(m));
  }
  await finish(doc, 'm2hb.glb', { ratio: 0.5, error: 0.0005 });
}

// ── AC-130 gunship ───────────────────────────────────────────────────────────
// Source: already Y-up, nose +z, port +x, metres. Re-centred on the fuselage,
// textures halved (it is a small shape high in the sky), geometry thinned.
async function ac130() {
  const doc = await io.read(path.join(SRC, 'ac-130.glb'));
  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
  await doc.transform(flatten());
  // bake every node transform into its mesh so the model is one rigid frame
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    transformMesh(mesh, node.getWorldMatrix());
    node.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  }
  const b = getBounds(scene);
  const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
  console.log('ac130 bounds', b.min.map((x) => x.toFixed(2)), b.max.map((x) => x.toFixed(2)));
  const shift = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -cx, 0, -cz, 1];
  for (const mesh of doc.getRoot().listMeshes()) transformMesh(mesh, shift);
  for (const t of doc.getRoot().listTextures()) {
    t.setImage(await webp(Buffer.from(t.getImage()), 512)).setMimeType('image/webp');
  }
  await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: 0.45, error: 0.002 }));
  // the four propellers are baked into the airframe: cut each one out (every
  // triangle in the thin disc ahead of its nacelle) into a node on its hub
  const ZP = 5.75;
  const pos0 = [];
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const a = p.getAttribute('POSITION'), v = [];
    for (let i = 0; i < a.getCount(); i++) { a.getElement(i, v); if (v[2] > 5.8 && v[2] < 6.2 && Math.abs(v[0]) > 3) pos0.push(v.slice()); }
  }
  const hubs = [[-1, 1], [-1, 0], [1, 0], [1, 1]].map(([sx, outer]) => {
    const s = pos0.filter((v) => Math.sign(v[0]) === sx && (Math.abs(v[0]) > 7.5) === !!outer);
    const m = s.reduce((acc, v) => [acc[0] + v[0], acc[1] + v[1]], [0, 0]).map((x) => x / s.length);
    return [m[0], m[1]];
  });
  console.log('ac130 hubs', hubs.map((h) => h.map((x) => x.toFixed(2)).join(',')).join('  '));
  const root = scene.listChildren()[0];
  splitByTriangles(doc, (tri) => {
    if (tri.some((v) => v[2] < ZP)) return -1;
    const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3, cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
    for (let k = 0; k < hubs.length; k++) if (Math.hypot(cx - hubs[k][0], cy - hubs[k][1]) < 2.5) return k;
    return -1;
  }, hubs.map((h, k) => ({ name: 'prop_' + k, pivot: [h[0], h[1], 6.1] })), root);
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) compactPrimitive(p);
  await finish(doc, 'ac130.glb');
}

/**
 * Move triangles that `classify` assigns to a bucket (>= 0) out of every
 * primitive into a new node per bucket, re-centred on that bucket's pivot.
 */
function splitByTriangles(doc, classify, buckets, parent) {
  const buffer = doc.getRoot().listBuffers()[0];
  const out = buckets.map(() => new Map()); // material -> {pos, nrm, uv}
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
    const A = { pos: p.getAttribute('POSITION'), nrm: p.getAttribute('NORMAL'), uv: p.getAttribute('TEXCOORD_0') };
    const idx = p.getIndices();
    const n = idx ? idx.getCount() : A.pos.getCount();
    const I = (i) => idx ? idx.getScalar(i) : i;
    const keep = [];
    const v = [[], [], []];
    for (let t = 0; t < n; t += 3) {
      const ids = [I(t), I(t + 1), I(t + 2)];
      ids.forEach((id, j) => A.pos.getElement(id, v[j]));
      const k = classify(v);
      if (k < 0) { keep.push(...ids); continue; }
      const mat = p.getMaterial();
      if (!out[k].has(mat)) out[k].set(mat, { pos: [], nrm: [], uv: [] });
      const o = out[k].get(mat), e = [];
      for (const id of ids) {
        A.pos.getElement(id, e); o.pos.push(e[0] - buckets[k].pivot[0], e[1] - buckets[k].pivot[1], e[2] - buckets[k].pivot[2]);
        if (A.nrm) { A.nrm.getElement(id, e); o.nrm.push(...e); }
        if (A.uv) { A.uv.getElement(id, e); o.uv.push(...e); }
      }
    }
    if (keep.length * 3 < n * 3) p.setIndices(doc.createAccessor().setType('SCALAR').setBuffer(buffer).setArray(new Uint32Array(keep)));
  }
  buckets.forEach((b, k) => {
    const mesh = doc.createMesh(b.name);
    for (const [mat, o] of out[k]) {
      const pr = doc.createPrimitive().setMaterial(mat);
      const acc = (arr, type) => doc.createAccessor().setType(type).setBuffer(buffer).setArray(new Float32Array(arr));
      pr.setAttribute('POSITION', acc(o.pos, 'VEC3'));
      if (o.nrm.length) pr.setAttribute('NORMAL', acc(o.nrm, 'VEC3'));
      if (o.uv.length) pr.setAttribute('TEXCOORD_0', acc(o.uv, 'VEC2'));
      mesh.addPrimitive(pr);
    }
    parent.addChild(doc.createNode(b.name).setTranslation(b.pivot).setMesh(mesh));
  });
}

// ── B-36 bomber ──────────────────────────────────────────────────────────────
// Source: OBJ, Y-up, nose +z, at about 0.53 scale. Cockpit interior, landing
// gear, bay-door variants and turbine fans are dropped; the six pusher props
// become their own nodes so the game can spin them.
async function b36() {
  const obj = await load(path.join(SRC, 'B-36', 'B-36.obj'));
  obj.updateMatrixWorld(true);
  const DROP = /^(Interior|Sit_|Dash_boerd|Landing_gear_down|doors_open|PS_generated_obj_doors_open|Flaps_landing|turbin|Blister_rim|Object05|Object20|Glass_round_frame|Reflector|Glass_Headlight)/;
  const meshes = [];
  obj.traverse((o) => { if (o.isMesh && !DROP.test(o.name)) meshes.push(o); });
  const box = new THREE.Box3();
  for (const m of meshes) box.expandByObject(m);
  const span = box.max.x - box.min.x;
  const s = 70.1 / span; // real wingspan, metres
  const c = box.getCenter(new THREE.Vector3());
  const fit = new THREE.Matrix4().makeScale(s, s, s).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
  console.log('b36 span', span.toFixed(2), 'scale', s.toFixed(3));

  const doc = new Document();
  const buffer = doc.createBuffer();
  const root = doc.createNode('B-36');
  doc.createScene('B-36').addChild(root);
  const P = (f) => path.join(SRC, 'B-36', 'B-36', f);
  const mats = {
    Fuselage: doc.createMaterial('Fuselage').setMetallicFactor(0.75).setRoughnessFactor(0.45)
      .setBaseColorTexture(tex(doc, 'paint', await webp(P('B36  Paint.jpg'), 1024)))
      .setNormalTexture(tex(doc, 'paint_normal', await webp(P('B36  Paint norm.jpg'), 1024, 88))),
    Glass: doc.createMaterial('Glass').setBaseColorFactor([0.06, 0.08, 0.1, 1]).setMetallicFactor(0.2).setRoughnessFactor(0.1),
    metal: doc.createMaterial('Metal').setBaseColorFactor([0.55, 0.56, 0.58, 1]).setMetallicFactor(0.85).setRoughnessFactor(0.4),
    dark: doc.createMaterial('Dark').setBaseColorFactor([0.05, 0.05, 0.05, 1]).setMetallicFactor(0.3).setRoughnessFactor(0.7),
  };
  const pick = (name) => mats[name] || (/Black|black|Rubber|Tire/.test(name) ? mats.dark : mats.metal);

  const byMat = new Map(); // merged static geometry per material
  const props = [];
  const hubs = meshes.filter((m) => /^pROP_HUB/.test(m.name)).map((m) => new THREE.Box3().setFromObject(m).getCenter(new THREE.Vector3()).applyMatrix4(fit));
  for (const m of meshes) {
    const isProp = /^(P?prop($|[._])|Prop_$)/i.test(m.name) && !/hub|engine/i.test(m.name);
    const g = m.geometry.clone().applyMatrix4(m.matrixWorld).applyMatrix4(fit);
    const ml = Array.isArray(m.material) ? m.material : [m.material];
    const parts = g.groups.length ? g.groups.map((gr) => [groupGeo(g, gr), ml[gr.materialIndex]]) : [[g, ml[0]]];
    for (const [pg, mt] of parts) {
      const keep = new THREE.BufferGeometry();
      for (const k of ['position', 'normal', 'uv']) if (pg.attributes[k]) keep.setAttribute(k, pg.attributes[k]);
      fixNormals(keep);
      if (!keep.attributes.uv) keep.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(keep.attributes.position.count * 2), 2));
      if (isProp) { props.push(keep); continue; }
      const mat = pick(mt && mt.name || '');
      if (!byMat.has(mat)) byMat.set(mat, []);
      byMat.get(mat).push(keep);
    }
  }
  const { mergeGeometries } = await import('three/examples/jsm/utils/BufferGeometryUtils.js');
  const body = doc.createMesh('body');
  for (const [mat, list] of byMat) body.addPrimitive(prim(doc, buffer, mergeGeometries(list.map((g) => g.index ? g.toNonIndexed() : g)), mat));
  root.addChild(doc.createNode('body').setMesh(body));
  // props: pivot on the hub, spin about z
  props.sort((a, b) => { a.computeBoundingBox(); b.computeBoundingBox(); return a.boundingBox.min.x - b.boundingBox.min.x; });
  props.forEach((g, i) => {
    const bc = g.boundingBox.getCenter(new THREE.Vector3());
    const hub = hubs.reduce((a, h) => (h.distanceTo(bc) < a.distanceTo(bc) ? h : a));
    const ctr = new THREE.Vector3(hub.x, hub.y, bc.z); // spin on the hub axis, in the blades' plane
    g.translate(-ctr.x, -ctr.y, -ctr.z);
    const n = doc.createNode('prop_' + i).setTranslation(ctr.toArray()).setMesh(doc.createMesh('prop_' + i).addPrimitive(prim(doc, buffer, g, mats.dark)));
    root.addChild(n);
  });
  console.log('b36 props', props.length, 'hubs', hubs.length);
  await finish(doc, 'b36.glb', { ratio: 0.12, error: 0.004 });
}

// ── small props ──────────────────────────────────────────────────────────────
/** A normal map authored for DirectX (green = down) turned into glTF's OpenGL convention. */
async function normalGL(file, size) {
  const { data, info } = await sharp(file).resize(size, size, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 1; i < data.length; i += info.channels) data[i] = 255 - data[i];
  return sharp(data, { raw: { width: size, height: size, channels: info.channels } }).webp({ quality: 90 }).toBuffer();
}

/** Bake every node transform into its mesh, so the model is one rigid frame. */
function bakeNodes(doc) {
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    transformMesh(mesh, node.getWorldMatrix());
    node.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  }
}

/** Scale a baked GLB so its height is `h` metres, centred on x/z, base at y = 0 (or centred: mid). */
function fitHeight(doc, h, mid = false) {
  const scene = doc.getRoot().listScenes()[0];
  const b = getBounds(scene);
  const s = h / (b.max[1] - b.min[1]);
  const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
  const cy = mid ? (b.min[1] + b.max[1]) / 2 : b.min[1];
  const m = [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, -cx * s, -cy * s, -cz * s, 1];
  for (const mesh of doc.getRoot().listMeshes()) transformMesh(mesh, m);
  return s;
}

// Grenade (M67-style, with pin and ring) and Molotov bottle: tiny Sketchfab GLBs, re-scaled to life size.
async function grenade() {
  const doc = await io.read(path.join(SRC, 'props', 'granade.glb'));
  await doc.transform(flatten());
  bakeNodes(doc);
  fitHeight(doc, 0.105, true);
  for (const t of doc.getRoot().listTextures()) t.setImage(await sharp(Buffer.from(t.getImage())).webp({ quality: 90, alphaQuality: 90 }).toBuffer()).setMimeType('image/webp');
  await finish(doc, 'grenade.glb');
}
async function molotov() {
  const doc = await io.read(path.join(SRC, 'props', 'molotov.glb'));
  await doc.transform(flatten());
  bakeNodes(doc);
  fitHeight(doc, 0.34); // bottle and the rag stuffed in its neck; base at y = 0
  for (const t of doc.getRoot().listTextures()) t.setImage(await sharp(Buffer.from(t.getImage())).webp({ quality: 88 }).toBuffer()).setMimeType('image/webp');
  await finish(doc, 'molotov.glb');
}

// Ammunition crate: an untextured FBX (centimetres). Painted olive drab here; 0.9 m long.
async function crate() {
  const fbx = await load(path.join(SRC, 'props', 'ammo-crate.fbx'));
  fbx.updateMatrixWorld(true);
  let mesh; fbx.traverse((o) => { if (o.isMesh) mesh = o; });
  const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
  g.computeBoundingBox();
  const b = g.boundingBox, s = 0.9 / (b.max.x - b.min.x);
  g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2).scale(s, s, s);
  if (!g.attributes.normal) g.computeVertexNormals();
  const keep = new THREE.BufferGeometry();
  for (const k of ['position', 'normal']) keep.setAttribute(k, g.attributes[k]);
  const doc = new Document();
  const buffer = doc.createBuffer();
  const root = doc.createNode('crate');
  doc.createScene('crate').addChild(root);
  const mat = doc.createMaterial('olive').setBaseColorFactor([0.16, 0.17, 0.1, 1]).setRoughnessFactor(0.8).setMetallicFactor(0.05);
  root.setMesh(doc.createMesh('crate').addPrimitive(prim(doc, buffer, keep, mat)));
  await finish(doc, 'crate.glb');
}

// Sandbags: two photo-scanned piles (OBJ + PBR set), each its own node; real size about 1.6 m long.
async function sandbags() {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const root = doc.createNode('sandbags');
  doc.createScene('sandbags').addChild(root);
  for (const [k, dir, obj, pre] of [[0, 'sandbag01', 's1-6k.obj', 's1'], [1, 'sandbag02', 's2-10k.obj', 's2']]) {
    const o = await load(path.join(SRC, dir, obj));
    o.updateMatrixWorld(true);
    let mesh; o.traverse((m) => { if (m.isMesh) mesh = m; });
    const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    g.computeBoundingBox();
    const b = g.boundingBox, len = Math.max(b.max.x - b.min.x, b.max.z - b.min.z), s = 1.6 / len;
    g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2).scale(s, s, s);
    // lay the long side along x
    if (b.max.z - b.min.z > b.max.x - b.min.x) g.rotateY(Math.PI / 2);
    const keep = new THREE.BufferGeometry();
    for (const a of ['position', 'normal', 'uv']) if (g.attributes[a]) keep.setAttribute(a, g.attributes[a]);
    const T = (f) => path.join(SRC, dir, `${pre}_${f}.png`);
    const mat = doc.createMaterial('burlap' + k).setMetallicFactor(0).setRoughnessFactor(1)
      .setBaseColorTexture(tex(doc, 'burlap' + k + '_color', await webp(T('Base_Color'), 1024)))
      .setNormalTexture(tex(doc, 'burlap' + k + '_normal', await normalGL(T('Normal_DirectX'), 1024)));
    const ormTex = tex(doc, 'burlap' + k + '_orm', await orm(T('Mixed_AO'), T('Roughness'), null, 512));
    mat.setMetallicRoughnessTexture(ormTex).setOcclusionTexture(ormTex);
    root.addChild(doc.createNode('pile_' + k).setMesh(doc.createMesh('pile_' + k).addPrimitive(prim(doc, buffer, keep, mat))));
    console.log('sandbag pile', k, 'size', ((b.max.x - b.min.x) * s).toFixed(2), ((b.max.y - b.min.y) * s).toFixed(2), ((b.max.z - b.min.z) * s).toFixed(2));
  }
  await finish(doc, 'sandbags.glb', { ratio: 0.3, error: 0.002 });
}

// ── Soldier ──────────────────────────────────────────────────────────────────
// Source: a Mixamo-rigged contractor (FBX, centimetres, facing +z) in a rifle-ready pose,
// 30 parts with their own 2K texture sets; the rifle, mags and pouches are loose meshes.
// Game: ONE skinned mesh, ONE material on a 2048 atlas (4 x 4 cells of 512), the rifle and
// mags riding the right hand and the pouches the chest, ~15k triangles; metres, feet at y = 0.
// The skeleton keeps Mixamo's bone names. Clips: every source/soldier/soldier_*.fbx (Mixamo,
// "Without Skin", made on the auto-rigged export_mixamo.mjs mesh) is retargeted onto this rig
// (retarget.mjs) and stored as a glTF animation; the rifle rides its own 'Rifle' joint so the
// game can sling it.
async function soldier() {
  const D = path.join(SRC, 'soldier');
  const T = (f) => path.join(D, 'textures', f);
  const fbx = await load(path.join(D, 'soldier.fbx'));
  fbx.updateMatrixWorld(true);
  // material -> atlas cell and its texture set: [color, normal, roughness, metal]
  const CELLS = {
    body: [0, 'privage_military_contractor_body_BaseColor.jpg', 'privage_military_contractor_body_Normal.jpg', 'privage_military_contractor_body_Roughness.jpg'],
    vest: [1, 'privage_military_contractor2_vest_BaseColo.jpg', 'privage_military_contractor2_vest_Normal.jpg', 'privage_military_contractor2_vest_Roughnes.jpg'],
    'mag pouch': [2, 'privage_military_contractor_mag_pouch_Base.jpg', 'privage_military_contractor_mag_pouch_Norm.jpg', 'privage_military_contractor_mag_pouch_Roug.jpg'],
    'l glove': [3, 'private_contractor1_gloves_BaseColor.jpg', 'private_contractor1_gloves_Normal.jpg', 'private_contractor1_gloves_Roughness.jpg'],
    helmet: [4, 'scp_operator_helmet_BaseColor.jpg', 'scp_operator_helmet_Normal.jpg', 'scp_operator_helmet_Roughness.jpg'],
    facemask: [5, 'scp_operator_mask_BaseColor.jpg', 'scp_operator_mask_Normal.jpg', 'scp_operator_mask_Roughness.jpg'],
    face: [6, 'swat_face_BaseColor.jpg', 'swat_face_Normal.jpg', null],
    googles: [7, 'googles_googles_BaseColor.png', 'googles_googles_Normal.jpg', 'googles_googles_Roughness.jpg', 'googles_googles_Metallic.jpg'],
    kneepad: [8, 'kneepad_kneepad_BaseColor.jpg', 'kneepad_kneepad_Normal.jpg', 'kneepad_kneepad_Roughness.jpg'],
    boots: [9, 'boot_color.jpg', 'army_boot_boot_lp_Normal.jpg', 'army_boot_boot_lp_Roughness.jpg'],
    __DEFAULT: [10, 'blue_eye.png', null, null],
  };
  CELLS['r glove'] = CELLS['l glove'];
  const FLAT = 11; // gunmetal: the rifle, magazines and rounds (their source texture tiles)
  const N = 4, C = 512, A = N * C;

  // bones: one list by name, from every skinned mesh
  const bones = [], boneIx = new Map();
  fbx.traverse((o) => { if (o.isBone && !boneIx.has(o.name)) { boneIx.set(o.name, bones.length); bones.push(o); } });
  const RHAND = boneIx.get('mixamorigRightHand'), CHEST = boneIx.get('mixamorigSpine2');
  // the rifle and its mags ride a joint of their own under the right hand, so the game can sling it
  const RIFLE = bones.length;

  const pos = [], nor = [], uvs = [], jnt = [], wts = [];
  const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3();
  fbx.traverse((o) => {
    if (!o.isMesh) return;
    const mname = (Array.isArray(o.material) ? o.material[0] : o.material).name;
    const rigid = !o.isSkinnedMesh;
    if (rigid && !/^(Gun_Low|pouch)/.test(o.name)) return; // smoke cards, decals, loose rounds and spare mags
    const cell = rigid && mname === 'scar' ? FLAT : (CELLS[mname] || [FLAT])[0];
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
    const P = g.attributes.position, Nn = g.attributes.normal, U = g.attributes.uv;
    const SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
    nm.getNormalMatrix(o.matrixWorld);
    // a skinned part's own bone indices -> the shared list
    const map = o.isSkinnedMesh ? o.skeleton.bones.map((b) => boneIx.get(b.name)) : null;
    const rigidBone = /^pouch/.test(o.name) ? CHEST : RIFLE;
    const cx = cell % N, cy = (cell / N) | 0;
    // skinned parts are stored in their rigging pose: bake the pose the scene is in (rifle
    // ready, which is where the loose rifle was modelled) by skinning every vertex here
    const skinMs = o.isSkinnedMesh ? o.skeleton.bones.map((b, k) => new THREE.Matrix4().multiplyMatrices(b.matrixWorld, o.skeleton.boneInverses[k])) : null;
    const sm = new THREE.Matrix4(), tmp = new THREE.Matrix4();
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i);
      n.fromBufferAttribute(Nn, i);
      if (skinMs) {
        sm.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
        for (const c of ['x', 'y', 'z', 'w']) {
          const w = SW['get' + c.toUpperCase()](i); if (!w) continue;
          tmp.copy(skinMs[SI['get' + c.toUpperCase()](i)]);
          for (let e = 0; e < 16; e++) sm.elements[e] += tmp.elements[e] * w;
        }
        v.applyMatrix4(o.bindMatrix).applyMatrix4(sm);
        n.transformDirection(o.bindMatrix).transformDirection(sm);
      } else {
        v.applyMatrix4(o.matrixWorld);
        n.applyMatrix3(nm).normalize();
      }
      v.multiplyScalar(0.01);
      pos.push(v.x, v.y, v.z);
      nor.push(n.x, n.y, n.z);
      // atlas uv (glTF's top-left origin)
      let u = 0.5, w = 0.5;
      if (cell !== FLAT && U) { u = THREE.MathUtils.clamp(U.getX(i), 0, 1); w = 1 - THREE.MathUtils.clamp(U.getY(i), 0, 1); }
      uvs.push((cx + 0.004 + u * 0.992) / N, (cy + 0.004 + w * 0.992) / N);
      if (rigid) { jnt.push(rigidBone, 0, 0, 0); wts.push(1, 0, 0, 0); continue; }
      const ws = [SW.getX(i), SW.getY(i), SW.getZ(i), SW.getW(i)], s = ws.reduce((a, b) => a + b, 0) || 1;
      jnt.push(map[SI.getX(i)] ?? 0, map[SI.getY(i)] ?? 0, map[SI.getZ(i)] ?? 0, map[SI.getW(i)] ?? 0);
      wts.push(ws[0] / s, ws[1] / s, ws[2] / s, ws[3] / s);
    }
  });
  // feet at y = 0
  let minY = Infinity; for (let i = 1; i < pos.length; i += 3) minY = Math.min(minY, pos[i]);
  // the muzzle: the rifle's (flat-cell, right-hand) vertex furthest forward; the game hangs tracers on it
  let tip = null;
  for (let i = 0, k = 0; i < pos.length; i += 3, k += 4) if (jnt[k] === RIFLE && (!tip || pos[i + 2] > tip[2])) tip = [pos[i], pos[i + 1], pos[i + 2]];
  console.log('soldier muzzle (m, feet at 0):', tip.map((x, j) => (j === 1 ? x - minY : x).toFixed(3)).join(', '));
  for (let i = 1; i < pos.length; i += 3) pos[i] -= minY;

  // atlases
  const cellImg = async (file, fill, grey = false) => {
    if (!file) return sharp({ create: { width: C, height: C, channels: 3, background: fill } }).png().toBuffer();
    let s = sharp(T(file)).resize(C, C, { fit: 'fill' }).removeAlpha();
    if (grey) s = s.greyscale().toColourspace('srgb');
    return s.png().toBuffer();
  };
  const atlas = async (layer) => {
    const comps = [];
    const done = new Set();
    for (const cell of Object.values(CELLS)) {
      if (done.has(cell[0])) continue; done.add(cell[0]);
      comps.push({ input: await layer(cell), left: (cell[0] % N) * C, top: ((cell[0] / N) | 0) * C });
    }
    return { comps };
  };
  const colorAt = await atlas((c) => cellImg(c[1], { r: 128, g: 128, b: 128 }));
  colorAt.comps.push({ input: await cellImg(null, { r: 30, g: 31, b: 31 }), left: (FLAT % N) * C, top: ((FLAT / N) | 0) * C });
  const normalAt = await atlas((c) => cellImg(c[2], { r: 128, g: 128, b: 255 }));
  normalAt.comps.push({ input: await cellImg(null, { r: 128, g: 128, b: 255 }), left: (FLAT % N) * C, top: ((FLAT / N) | 0) * C });
  // ORM: occlusion 255, roughness from the set, metal from the set (or 0)
  const ormCell = async (c) => {
    const r = c[3] ? await sharp(T(c[3])).resize(C, C, { fit: 'fill' }).greyscale().raw().toBuffer() : Buffer.alloc(C * C, 190);
    const m = c[4] ? await sharp(T(c[4])).resize(C, C, { fit: 'fill' }).greyscale().raw().toBuffer() : Buffer.alloc(C * C, 0);
    const px = Buffer.alloc(C * C * 3);
    for (let i = 0; i < C * C; i++) { px[i * 3] = 255; px[i * 3 + 1] = r[i]; px[i * 3 + 2] = m[i]; }
    return sharp(px, { raw: { width: C, height: C, channels: 3 } }).png().toBuffer();
  };
  const ormAt = await atlas(ormCell);
  ormAt.comps.push({ input: await sharp({ create: { width: C, height: C, channels: 3, background: { r: 255, g: 110, b: 180 } } }).png().toBuffer(), left: (FLAT % N) * C, top: ((FLAT / N) | 0) * C });
  const bake = async ({ comps }, bg, q) => sharp({ create: { width: A, height: A, channels: 3, background: bg } }).composite(comps).webp({ quality: q }).toBuffer();

  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('soldier');
  const root = doc.createNode('soldier').setScale([0.01, 0.01, 0.01]);
  scene.addChild(root);
  // joints: the hips go under the root with their full bind transform; the rest keep their locals
  const nodes = bones.map((b) => {
    const m = bones.includes(b.parent) ? b.matrix : b.matrixWorld;
    const t = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    m.decompose(t, q, s);
    if (!bones.includes(b.parent)) t.y -= minY * 100;
    return doc.createNode(b.name).setTranslation(t.toArray()).setRotation(q.toArray()).setScale(s.toArray());
  });
  bones.forEach((b, i) => { const p = bones.indexOf(b.parent); (p >= 0 ? nodes[p] : root).addChild(nodes[i]); });
  const S = new THREE.Matrix4().makeScale(0.01, 0.01, 0.01), lift = new THREE.Matrix4().makeTranslation(0, -minY, 0);
  const rifleNode = doc.createNode('Rifle'); // at the hand, unrotated: it binds like the hand
  nodes[RHAND].addChild(rifleNode);
  const ibm = new Float32Array((bones.length + 1) * 16);
  bones.forEach((b, i) => new THREE.Matrix4().multiplyMatrices(lift, S).multiply(b.matrixWorld).invert().toArray(ibm, i * 16));
  ibm.copyWithin(RIFLE * 16, RHAND * 16, RHAND * 16 + 16);
  const skin = doc.createSkin('soldier').setSkeleton(nodes[0])
    .setInverseBindMatrices(doc.createAccessor().setArray(ibm).setType('MAT4').setBuffer(buffer));
  for (const nd of nodes) skin.addJoint(nd);
  skin.addJoint(rifleNode);

  // animation clips from Mixamo (source/soldier/soldier_*.fbx), retargeted onto this rig
  {
    const first = []; fbx.traverse((o) => { if (o.isSkinnedMesh && o.skeleton.bones[0] === bones[0]) first.push(o); });
    const sk = first[0].skeleton;
    const short = (b) => b.name.replace('mixamorig', '');
    const gameBones = {}, bind = {};
    sk.bones.forEach((b, k) => { gameBones[short(b)] = b; bind[short(b)] = sk.boneInverses[k].clone().invert(); });
    const retarget = makeRetargeter(gameBones, bind);
    const nodeOf = Object.fromEntries(bones.map((b, i) => [short(b), nodes[i]]));
    const files = fs.readdirSync(D).filter((f) => /^soldier_.+\.fbx$/.test(f)).sort();
    for (const f of files) {
      const name = f.replace(/^soldier_|\.fbx$/g, '');
      const c = await retarget(path.join(D, f));
      const anim = doc.createAnimation(name);
      const input = acc0(doc, buffer, c.times, 'SCALAR');
      for (const [b, v] of Object.entries(c.rot)) {
        if (!nodeOf[b]) continue;
        const smp = doc.createAnimationSampler().setInput(input).setOutput(acc0(doc, buffer, v, 'VEC4')).setInterpolation('LINEAR');
        anim.addSampler(smp).addChannel(doc.createAnimationChannel().setTargetNode(nodeOf[b]).setTargetPath('rotation').setSampler(smp));
      }
      const hp = c.hips.slice(); for (let i = 1; i < hp.length; i += 3) hp[i] -= minY * 100;
      const smp = doc.createAnimationSampler().setInput(input).setOutput(acc0(doc, buffer, hp, 'VEC3')).setInterpolation('LINEAR');
      anim.addSampler(smp).addChannel(doc.createAnimationChannel().setTargetNode(nodeOf.Hips).setTargetPath('translation').setSampler(smp));
      console.log(`  clip ${name}: ${c.duration.toFixed(2)} s, ${c.times.length} keys`);
    }
  }

  const mat = doc.createMaterial('soldier').setMetallicFactor(1).setRoughnessFactor(1)
    .setBaseColorTexture(tex(doc, 'soldier_color', await bake(colorAt, { r: 60, g: 60, b: 60 }, 84)))
    .setNormalTexture(tex(doc, 'soldier_normal', await bake(normalAt, { r: 128, g: 128, b: 255 }, 88)));
  const ormTex = tex(doc, 'soldier_orm', await bake(ormAt, { r: 255, g: 200, b: 0 }, 88));
  mat.setMetallicRoughnessTexture(ormTex).setOcclusionTexture(ormTex);
  const acc = (arr, type) => doc.createAccessor().setArray(arr).setType(type).setBuffer(buffer);
  const prm = doc.createPrimitive().setMaterial(mat)
    .setAttribute('POSITION', acc(new Float32Array(pos), 'VEC3'))
    .setAttribute('NORMAL', acc(new Float32Array(nor), 'VEC3'))
    .setAttribute('TEXCOORD_0', acc(new Float32Array(uvs), 'VEC2'))
    .setAttribute('JOINTS_0', acc(new Uint16Array(jnt), 'VEC4'))
    .setAttribute('WEIGHTS_0', acc(new Float32Array(wts), 'VEC4'));
  const meshNode = doc.createNode('body').setMesh(doc.createMesh('body').addPrimitive(prm)).setSkin(skin);
  scene.addChild(meshNode);
  console.log('soldier', bones.length, 'bones,', pos.length / 9, 'source triangles');
  await finish(doc, 'soldier.glb', { ratio: 0.16, error: 0.004 });
}


// ── Survivors: the civilians on the road ─────────────────────────────────────
// Source: characters auto-rigged in Mixamo (source/survivors/<name>-t-pose.fbx, "With Skin",
// T-pose; made from export_unrigged.mjs zips) and Mixamo clips made on one of them
// (source/survivors/anims/*.fbx). Game: one skinned mesh per character on one atlas (its
// texture sets packed into cells), ~7k triangles, metres, feet at 0, facing +z; every clip
// retargeted onto its own skeleton (retarget.mjs) as a glTF animation.
const SURVIVORS = { 'civilian-1': 'man', 'civilian-2': 'woman', 'civilian-4': 'man2', 'child-1': 'child' };
const SURVIVOR_CLIPS = {
  'sad-walk': 'walk_sad', 'arm-injured-walk': 'walk_arm', 'leg-injured-walk': 'walk_leg',
  running: 'run_1', 'running-2': 'run_2', 'sad-idle': 'idle_sad', 'fall-farward-death': 'death', 'fall-forward-death': 'death',
};
async function survivors() {
  const { resolveObjectURL } = await import('node:buffer');
  const D = path.join(SRC, 'survivors');
  const clipFiles = fs.readdirSync(path.join(D, 'anims')).filter((f) => /\.fbx$/i.test(f)).sort();
  for (const [src, name] of Object.entries(SURVIVORS)) {
    const fbx = await load(path.join(D, `${src}-t-pose.fbx`));
    fbx.updateMatrixWorld(true);
    const short = (s) => s.replace('mixamorig', '');
    // bones (one list by name) and their bind matrices
    const bones = [], ix = new Map();
    fbx.traverse((o) => { if (o.isBone && !ix.has(o.name)) { ix.set(o.name, bones.length); bones.push(o); } });
    const meshes = []; fbx.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); });
    const bind = new Array(bones.length);
    for (const m of meshes) m.skeleton.bones.forEach((b, j) => { const i = ix.get(b.name); if (i !== undefined && !bind[i]) bind[i] = m.skeleton.boneInverses[j].clone().invert(); });
    for (let i = 0; i < bones.length; i++) if (!bind[i]) bind[i] = bones[i].matrixWorld.clone();

    // materials -> atlas cells: a colour texture (embedded by Mixamo) or a flat colour
    const cells = new Map();
    const cellOf = (m) => {
      const key = m.name || m.uuid;
      if (!cells.has(key)) cells.set(key, { i: cells.size, m });
      return cells.get(key).i;
    };
    const parts = [];
    for (const o of meshes) {
      let g0 = o.geometry;
      if (!g0.attributes.normal) {
        // the OBJ round trip through Mixamo drops normals: smooth ones, welded on position only
        const w = new THREE.BufferGeometry().setAttribute('position', g0.attributes.position.clone());
        if (g0.index) w.setIndex(g0.index.clone());
        const m = mergeVertices(w.index ? w.toNonIndexed() : w, 1e-4);
        m.computeVertexNormals();
        const key = (x, y, z) => `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
        const byPos = new Map(), MP = m.attributes.position, MN = m.attributes.normal;
        for (let i = 0; i < MP.count; i++) byPos.set(key(MP.getX(i), MP.getY(i), MP.getZ(i)), i);
        const P0 = g0.attributes.position, nrm = new Float32Array(P0.count * 3);
        for (let i = 0; i < P0.count; i++) { const j = byPos.get(key(P0.getX(i), P0.getY(i), P0.getZ(i))); if (j !== undefined) nrm.set([MN.getX(j), MN.getY(j), MN.getZ(j)], i * 3); else nrm[i * 3 + 1] = 1; }
        g0 = g0.clone(); g0.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      }
      const g = g0.index ? g0.toNonIndexed() : g0;
      const mats = [].concat(o.material);
      const groups = g.groups.length ? g.groups : [{ start: 0, count: g.attributes.position.count, materialIndex: 0 }];
      for (const gr of groups) parts.push({ o, g, gr, cell: cellOf(mats[gr.materialIndex] || mats[0]) });
    }
    const nC = cells.size, N = Math.ceil(Math.sqrt(nC)), A = nC > 4 ? 2048 : 1024, C = Math.floor(A / N);

    const pos = [], nor = [], uvs = [], jnt = [], wts = [];
    const v = new THREE.Vector3(), n = new THREE.Vector3();
    for (const { o, g, gr, cell } of parts) {
      const P = g.attributes.position, Nn = g.attributes.normal, U = g.attributes.uv, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
      const map = o.skeleton.bones.map((b) => ix.get(b.name));
      const cx = cell % N, cy = (cell / N) | 0;
      for (let i = gr.start; i < gr.start + gr.count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(o.bindMatrix);
        n.fromBufferAttribute(Nn, i).transformDirection(o.bindMatrix);
        pos.push(v.x, v.y, v.z); nor.push(n.x, n.y, n.z);
        let u = 0.5, w = 0.5;
        if (U) { u = U.getX(i); w = U.getY(i); u -= Math.floor(u); w -= Math.floor(w); w = 1 - w; }
        uvs.push((cx * C + 2 + u * (C - 4)) / A, (cy * C + 2 + w * (C - 4)) / A);
        const ws = [SW.getX(i), SW.getY(i), SW.getZ(i), SW.getW(i)], s = ws.reduce((a, b) => a + b, 0) || 1;
        jnt.push(map[SI.getX(i)] ?? 0, map[SI.getY(i)] ?? 0, map[SI.getZ(i)] ?? 0, map[SI.getW(i)] ?? 0);
        wts.push(ws[0] / s, ws[1] / s, ws[2] / s, ws[3] / s);
      }
    }
    let minY = Infinity, maxY = -Infinity;
    for (let i = 1; i < pos.length; i += 3) { minY = Math.min(minY, pos[i]); maxY = Math.max(maxY, pos[i]); }
    const k = maxY - minY > 10 ? 0.01 : 1; // centimetres -> metres
    for (let i = 0; i < pos.length; i += 3) { pos[i] *= k; pos[i + 1] = (pos[i + 1] - minY) * k; pos[i + 2] *= k; }

    // the atlas
    const comps = [];
    for (const { i, m } of cells.values()) {
      let img = null;
      const srcUrl = m.map && m.map.userData.src;
      if (srcUrl && srcUrl.startsWith('blob:')) { const b = resolveObjectURL(srcUrl); if (b) img = Buffer.from(await b.arrayBuffer()); }
      const c = m.color || new THREE.Color(0.6, 0.6, 0.6);
      const input = img
        ? await sharp(img).resize(C, C, { fit: 'fill' }).removeAlpha().png().toBuffer()
        : await sharp({ create: { width: C, height: C, channels: 3, background: { r: Math.round(c.r * 255), g: Math.round(c.g * 255), b: Math.round(c.b * 255) } } }).png().toBuffer();
      comps.push({ input, left: (i % N) * C, top: ((i / N) | 0) * C });
    }
    const atlas = await sharp({ create: { width: A, height: A, channels: 3, background: { r: 90, g: 90, b: 90 } } }).composite(comps).webp({ quality: 86 }).toBuffer();

    const doc = new Document();
    const buffer = doc.createBuffer();
    const scene = doc.createScene('survivor');
    const root = doc.createNode('survivor').setScale([k, k, k]);
    scene.addChild(root);
    const lift = new THREE.Matrix4().makeTranslation(0, -minY, 0);
    const nodes = bones.map((b, i) => {
      const p = bones.indexOf(b.parent);
      const m = p >= 0 ? bind[p].clone().invert().multiply(bind[i]) : lift.clone().multiply(bind[i]);
      const t = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      m.decompose(t, q, s);
      return doc.createNode(b.name).setTranslation(t.toArray()).setRotation(q.toArray()).setScale(s.toArray());
    });
    bones.forEach((b, i) => { const p = bones.indexOf(b.parent); (p >= 0 ? nodes[p] : root).addChild(nodes[i]); });
    const S = new THREE.Matrix4().makeScale(k, k, k);
    const ibm = new Float32Array(bones.length * 16);
    bones.forEach((b, i) => S.clone().multiply(lift).multiply(bind[i]).invert().toArray(ibm, i * 16));
    const skin = doc.createSkin(name).setSkeleton(nodes[0]).setInverseBindMatrices(acc0(doc, buffer, ibm, 'MAT4'));
    for (const nd of nodes) skin.addJoint(nd);
    const mat = doc.createMaterial(name).setMetallicFactor(0).setRoughnessFactor(0.85).setBaseColorTexture(tex(doc, name + '_color', atlas));
    const prm = doc.createPrimitive().setMaterial(mat)
      .setAttribute('POSITION', acc0(doc, buffer, new Float32Array(pos), 'VEC3'))
      .setAttribute('NORMAL', acc0(doc, buffer, new Float32Array(nor), 'VEC3'))
      .setAttribute('TEXCOORD_0', acc0(doc, buffer, new Float32Array(uvs), 'VEC2'))
      .setAttribute('JOINTS_0', acc0(doc, buffer, new Uint16Array(jnt), 'VEC4'))
      .setAttribute('WEIGHTS_0', acc0(doc, buffer, new Float32Array(wts), 'VEC4'));
    scene.addChild(doc.createNode('body').setMesh(doc.createMesh('body').addPrimitive(prm)).setSkin(skin));

    // clips
    const gameBones = {}, bindBy = {};
    bones.forEach((b, i) => { gameBones[short(b.name)] = b; bindBy[short(b.name)] = bind[i]; });
    const retarget = makeRetargeter(gameBones, bindBy);
    const nodeOf = Object.fromEntries(bones.map((b, i) => [short(b.name), nodes[i]]));
    for (const f of clipFiles) {
      const base = f.replace(/\.fbx$/i, '').toLowerCase();
      const clipName = SURVIVOR_CLIPS[base] || base.replace(/[^a-z0-9]+/g, '_');
      const c = await retarget(path.join(D, 'anims', f));
      const anim = doc.createAnimation(clipName);
      const input = acc0(doc, buffer, c.times, 'SCALAR');
      for (const [b, val] of Object.entries(c.rot)) {
        if (!nodeOf[b]) continue;
        const smp = doc.createAnimationSampler().setInput(input).setOutput(acc0(doc, buffer, val, 'VEC4')).setInterpolation('LINEAR');
        anim.addSampler(smp).addChannel(doc.createAnimationChannel().setTargetNode(nodeOf[b]).setTargetPath('rotation').setSampler(smp));
      }
      const hp = c.hips.slice(); for (let i = 1; i < hp.length; i += 3) hp[i] -= minY;
      const smp = doc.createAnimationSampler().setInput(input).setOutput(acc0(doc, buffer, hp, 'VEC3')).setInterpolation('LINEAR');
      anim.addSampler(smp).addChannel(doc.createAnimationChannel().setTargetNode(nodeOf.Hips).setTargetPath('translation').setSampler(smp));
    }
    const tris = pos.length / 9;
    console.log(`survivor ${name}: ${bones.length} bones, ${nC} materials (atlas ${A}, ${N}x${N}), ${tris} source triangles, ${((maxY - minY) * k).toFixed(2)} m tall, ${clipFiles.length} clips`);
    await finish(doc, `survivor_${name}.glb`, { ratio: Math.min(1, 7000 / tris), error: 0.01 });
  }
}

const { cars, ural, ch47, apache, heliwreck, container, bale, bomb, house, mcrate, church, hedgehog } = await import('./build_vehicles.mjs').then((m) => m.make({ io, SRC, finish, splitByTriangles, bakeNodes }));
const want = process.argv.slice(2);
const all = { m2hb, ac130, b36, grenade, molotov, crate, sandbags, soldier, survivors, cars, ural, ch47, apache, heliwreck, container, bale, bomb, house, mcrate, church, hedgehog };
for (const [k, f] of Object.entries(all)) if (!want.length || want.includes(k)) await f();
