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

const want = process.argv.slice(2);
const all = { m2hb, ac130, b36 };
for (const [k, f] of Object.entries(all)) if (!want.length || want.includes(k)) await f();
