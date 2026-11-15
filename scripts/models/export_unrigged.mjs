// Any character model -> an unrigged OBJ zip for Mixamo's auto-rigger: skinned parts in their
// bind pose, other parts where they stand, Y up, metres, feet at 0, with an .mtl pointing at the
// colour textures (embedded ones are extracted). Old FBX 6 files go through fbx6.mjs.
//   node scripts/models/export_unrigged.mjs <in.fbx> <outDir> [--zup] [--flip] [--tris N]
//     --zup   the source is Z-up (3ds Max style: front is -Y); --zdown: head toward -Z
//     --flip  turn it 180° about Y (if it ends up facing -Z)
//     --tris  simplify to about N triangles (Mixamo chokes on very heavy meshes)
// Writes <outDir>/model.obj|.mtl + textures and <outDir>.zip.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveObjectURL } from 'node:buffer';
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { load } from './load.mjs';
import { readFbx6 } from './fbx6.mjs';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? Number(args[i + 1]) : 0; };
const [IN, OUT] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1] === '--tris'));
const srcDir = path.dirname(path.resolve(IN));
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// every image file next to the model (and in its parent folder's tree), by lower-case basename
const files = new Map();
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(png|jpe?g|tga|bmp)$/i.test(e.name)) files.set(e.name.toLowerCase(), p); } };
// (the parent only for the usual source/ + textures/ layout: never a folder shared with other models)
if (path.basename(srcDir).toLowerCase() === 'source') walk(path.dirname(srcDir)); else walk(srcDir);

// parts: { geo: BufferGeometry (position, uv) in source space, mat: name, tex: {name, bytes|path} | null }
const parts = [];
const head = fs.readFileSync(IN).subarray(0, 27);
const ver = head.toString('latin1', 0, 18) === 'Kaydara FBX Binary' ? head.readUInt32LE(23) : 7000;
if (ver < 7000) {
  const { meshes } = readFbx6(IN);
  for (const m of meshes) {
    const n = m.faces.length * 3, pos = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    m.faces.forEach((f, i) => { for (let k = 0; k < 3; k++) {
      const v = f[k], u = f[3 + k], o = (i * 3 + k);
      pos.set(m.pos.slice(v * 3, v * 3 + 3), o * 3);
      if (u >= 0) { uv[o * 2] = m.uv[u * 2]; uv[o * 2 + 1] = m.uv[u * 2 + 1]; }
    } });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    // FBX 6: one material per mesh here; its texture is whatever colour map lies next to it
    const tex = [...files.values()].find((p) => /diffuse|color|albedo|_dif/i.test(p));
    parts.push({ geo, mat: m.name, tex: tex ? { name: path.basename(tex), path: tex } : null });
  }
} else {
  // embedded textures come through as blob: urls; keep them so their bytes can be written out
  const fbx = await load(IN);
  fbx.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  const texOf = async (m) => {
    const t = m.map; if (!t) return null;
    const src = t.userData.src || '';
    if (src.startsWith('blob:')) {
      const b = resolveObjectURL(src); if (!b) return null;
      const ext = /png/.test(b.type) ? 'png' : 'jpg';
      return { name: `${m.name.replace(/[^\w-]+/g, '_')}.${ext}`, bytes: Buffer.from(await b.arrayBuffer()) };
    }
    const p = files.get(path.basename(src.replace(/\\/g, '/')).toLowerCase());
    return p ? { name: path.basename(p), path: p } : null;
  };
  const meshes = []; fbx.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const o of meshes) {
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    const P = g.attributes.position;
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i);
      if (o.isSkinnedMesh) v.applyMatrix4(o.bindMatrix); else v.applyMatrix4(o.matrixWorld);
      P.setXYZ(i, v.x, v.y, v.z);
    }
    const mats = [].concat(o.material);
    const groups = g.groups.length ? g.groups : [{ start: 0, count: P.count, materialIndex: 0 }];
    for (const gr of groups) {
      const m = mats[gr.materialIndex] || mats[0];
      const sub = new THREE.BufferGeometry();
      sub.setAttribute('position', new THREE.BufferAttribute(P.array.slice(gr.start * 3, (gr.start + gr.count) * 3), 3));
      const U = g.attributes.uv;
      sub.setAttribute('uv', new THREE.BufferAttribute(U ? U.array.slice(gr.start * 2, (gr.start + gr.count) * 2) : new Float32Array(gr.count * 2), 2));
      parts.push({ geo: sub, mat: m.name || o.name, tex: await texOf(m) });
    }
  }
}

// orient: Y up, facing +Z, metres, feet at 0, centred
const fix = new THREE.Matrix4();
if (flag('--zup')) fix.premultiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
if (flag('--zdown')) fix.premultiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)); // head toward -Z
if (flag('--flip')) fix.premultiply(new THREE.Matrix4().makeRotationY(Math.PI));
const box = new THREE.Box3();
for (const p of parts) { p.geo.applyMatrix4(fix); p.geo.computeBoundingBox(); box.union(p.geo.boundingBox); }
const size = box.getSize(new THREE.Vector3()), height = size.y;
const k = height > 10 ? 0.01 : 1; // centimetres -> metres
const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
for (const p of parts) p.geo.applyMatrix4(new THREE.Matrix4().makeScale(k, k, k).multiply(new THREE.Matrix4().makeTranslation(-cx, -box.min.y, -cz)));

// simplify (welded on position + uv, borders free so the budget is met)
const total = () => parts.reduce((s, p) => s + (p.geo.index ? p.geo.index.count : p.geo.attributes.position.count) / 3, 0);
const before = total() | 0;
const want = opt('--tris');
await MeshoptSimplifier.ready;
for (const p of parts) {
  p.geo = mergeVertices(p.geo, 1e-5);
  if (want && before > want) {
    const idx = new Uint32Array(p.geo.index.array);
    const target = Math.max(3, Math.floor(idx.length * want / before / 3) * 3);
    const [out] = MeshoptSimplifier.simplify(idx, p.geo.attributes.position.array, 3, target, 0.05, []);
    p.geo.setIndex(new THREE.BufferAttribute(out, 1));
  }
}

// write OBJ + MTL + textures
const obj = ['mtllib model.mtl'], mtl = [], wrote = new Set(), matDone = new Set(), pending = [];
let base = 1, tris = 0;
const pv = new THREE.Vector3(), bb = new THREE.Box3();
parts.forEach((p, n) => {
  const P = p.geo.attributes.position, U = p.geo.attributes.uv, I = p.geo.index.array;
  if (!I.length) return;
  const mat = (p.mat || 'mat' + n).replace(/[^\w-]+/g, '_');
  obj.push(`o part_${n}`, `usemtl ${mat}`);
  for (let i = 0; i < P.count; i++) { pv.fromBufferAttribute(P, i); bb.expandByPoint(pv); obj.push(`v ${pv.x.toFixed(5)} ${pv.y.toFixed(5)} ${pv.z.toFixed(5)}`); }
  for (let i = 0; i < U.count; i++) obj.push(`vt ${U.getX(i).toFixed(5)} ${U.getY(i).toFixed(5)}`);
  for (let i = 0; i < I.length; i += 3) { const a = I[i] + base, b = I[i + 1] + base, c = I[i + 2] + base; obj.push(`f ${a}/${a} ${b}/${b} ${c}/${c}`); }
  base += P.count; tris += I.length / 3;
  if (matDone.has(mat)) return;
  matDone.add(mat);
  mtl.push(`newmtl ${mat}`, 'Kd 1 1 1');
  if (p.tex) {
    // at most 2048 px: Mixamo only needs them for its preview
    if (!wrote.has(p.tex.name)) { wrote.add(p.tex.name); pending.push(sharp(p.tex.bytes || p.tex.path).resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).toFile(path.join(OUT, p.tex.name))); }
    mtl.push(`map_Kd ${p.tex.name}`);
  }
  mtl.push('');
});
await Promise.all(pending);
fs.writeFileSync(path.join(OUT, 'model.obj'), obj.join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'model.mtl'), mtl.join('\n'));
const s = bb.getSize(new THREE.Vector3());
console.log(`${path.basename(OUT)}: ${before} -> ${tris} triangles, ${matDone.size} materials, ${wrote.size} textures, size ${s.x.toFixed(2)} x ${s.y.toFixed(2)} x ${s.z.toFixed(2)} m`);
const zip = OUT.replace(/[\\/]$/, '') + '.zip';
fs.rmSync(zip, { force: true });
execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${path.resolve(OUT)}\\*' -DestinationPath '${path.resolve(zip)}'`]);
console.log('  ->', path.resolve(zip), (fs.statSync(zip).size / 1e6).toFixed(1), 'MB');
