// The field and the hangar from the user's Sketchfab GLBs (the "3D Models" folder next
// to the repo, read in place like the tower; credits in app/models/CREDITS.md):
//   mg4        the wall crews' machine gun (HK MG4 standing in for the M240)
//   trees      the hills' woods (tall card trees), the field's bushes and rocks: one node each
//   deadtrees  the dead trees standing in the killing field: one node each
//   crow       the crows (body and wings apart: the game flaps them in the vertex shader)
//   hangar     the dawn resupply's building (the bays are the game's own)
// Every variant node sits on the origin with its base at y = 0, so the game can instance
// one at a time (env.addModel(name, m, { node })).
//
// Used by build_models.mjs: node scripts/models/build_models.mjs mg4 trees deadtrees crow hangar
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { flatten, getBounds, prune, transformMesh, metalRough } from '@gltf-transform/functions';

export function make({ io, SRC, finish, bakeNodes, helpers }) {
  const { grade, texWebp, anchors, triCount } = helpers;
  const OWN = path.resolve(SRC, '..', '..', '..', '..', '3D Models');
  const src = (f) => { const p = path.join(OWN, f); if (fs.existsSync(p)) return p; return path.join(SRC, 'field', f); };

  /** A GLB as one rigid frame (node transforms baked), spec-gloss converted. */
  async function readRigid(file) {
    const doc = await io.read(file);
    if (doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === 'KHR_materials_pbrSpecularGlossiness')) await doc.transform(metalRough());
    await doc.transform(flatten());
    const seen = new Set();
    for (const n of doc.getRoot().listNodes()) { const m = n.getMesh(); if (!m) continue; if (seen.has(m)) n.setMesh(m.clone()); else seen.add(m); }
    bakeNodes(doc);
    return doc;
  }
  const scene = (doc) => doc.getRoot().listScenes()[0];
  const meshNodes = (doc) => doc.getRoot().listNodes().filter((n) => n.getMesh());
  const xform = (mesh, m) => transformMesh(mesh, m.elements);
  /** Bounds of a set of mesh nodes (identity transforms after baking). */
  function boundsOf(nodes) {
    const b = new THREE.Box3(), v = [];
    for (const n of nodes) for (const p of n.getMesh().listPrimitives()) {
      const a = p.getAttribute('POSITION');
      for (let i = 0; i < a.getCount(); i++) { a.getElement(i, v); b.expandByPoint(new THREE.Vector3(...v)); }
    }
    return b;
  }
  /** Group mesh nodes under a new node, moved so their base centre is the origin, scaled by s. */
  function variant(doc, parent, name, nodes, s = 1, rot = null) {
    const b = boundsOf(nodes), c = b.getCenter(new THREE.Vector3());
    const M = new THREE.Matrix4();
    if (rot) M.premultiply(rot);
    M.multiply(new THREE.Matrix4().makeScale(s, s, s)).multiply(new THREE.Matrix4().makeTranslation(-c.x, -b.min.y, -c.z));
    const g = doc.createNode(name);
    const meshes = new Set();
    for (const n of nodes) {
      const m = n.getMesh();
      if (!meshes.has(m)) { xform(m, M); meshes.add(m); }
      for (const p of n.listParents()) if (p.removeChild) p.removeChild(n);
      g.addChild(n);
    }
    parent.addChild(g);
    return boundsOf(nodes);
  }
  function root(doc, name) {
    const s = scene(doc);
    const r = doc.createNode(name);
    for (const n of s.listChildren()) s.removeChild(n);
    s.addChild(r);
    return r;
  }
  /** Card foliage: alpha-tested (instanced by the thousand, it can't be sorted), double-sided. */
  function cutout(doc, test, cutoff = 0.45) {
    for (const m of doc.getRoot().listMaterials()) if (test(m.getName()) || m.getAlphaMode() !== 'OPAQUE') {
      if (m.getAlphaMode() === 'OPAQUE' && !test(m.getName())) continue;
      m.setAlphaMode('MASK').setAlphaCutoff(cutoff).setDoubleSided(true);
    }
  }
  const size = (b) => b.getSize(new THREE.Vector3()).toArray().map((v) => v.toFixed(2)).join(' x ');

  // ── HK MG4: barrel along +z, y up, origin at the pistol grip, 1.03 m long ──
  async function mg4() {
    const doc = await readRigid(src('HK MG4.glb'));
    const r = root(doc, 'mg4');
    const nodes = meshNodes(doc);
    // source: barrel along -x
    const rot = new THREE.Matrix4().makeRotationY(Math.PI / 2);
    const b0 = boundsOf(nodes);
    const s = 1.03 / (b0.max.x - b0.min.x);
    variant(doc, r, 'gun', nodes, s, rot);
    // the grip: the lowest of the vertices behind the feed box (the rear third, under the receiver)
    const b = boundsOf(nodes);
    const v = [], pts = [];
    for (const n of nodes) for (const p of n.getMesh().listPrimitives()) { const a = p.getAttribute('POSITION'); for (let i = 0; i < a.getCount(); i++) { a.getElement(i, v); pts.push(new THREE.Vector3(...v)); } }
    const L = b.max.z - b.min.z;
    const rear = pts.filter((p) => p.z < b.min.z + L * 0.42 && p.z > b.min.z + L * 0.2);
    const low = rear.reduce((a, p) => (p.y < a.y ? p : a), rear[0]);
    const grip = rear.filter((p) => p.y < low.y + 0.06).reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / Math.max(1, rear.filter((p) => p.y < low.y + 0.06).length));
    const handAt = new THREE.Vector3(grip.x, low.y + 0.11, grip.z); // the hand closes round the top of the grip
    for (const m of doc.getRoot().listMeshes()) xform(m, new THREE.Matrix4().makeTranslation(-handAt.x, -handAt.y, -handAt.z));
    const bb = boundsOf(nodes);
    anchors(doc, { muzzle: [0, (bb.max.y + bb.min.y) / 2 + 0.03, bb.max.z], bipod: [0, bb.min.y, bb.max.z - 0.33] });
    await grade(doc, { dark: 0.55, sat: 0.5 });
    await texWebp(doc, 512);
    console.log('mg4 size', size(bb), 'grip at', handAt.toArray().map((x) => x.toFixed(3)), 'tris', triCount(doc));
    await finish(doc, 'mg4.glb', { ratio: 1, error: 0.001 });
  }

  // ── trees, bushes, rocks: one node per variant ──
  // tall: Background_Tree_Atlas (.000-.007) are card trees 18-33 m (spruce, pine, birch);
  // Tree_Trunk/Branches 01/02 are four more with real trunks. Bushes: Atlas .008-.012.
  // Rocks: Rocks .000-.008 (0.4-2 m). The source is in metres already.
  async function trees() {
    const doc = await readRigid(src('Trees.glb'));
    const r = root(doc, 'trees');
    const all = meshNodes(doc);
    const by = (re) => all.filter((n) => re.test(n.getName()));
    const sfx = (n) => { const m = /Atlas\.(\d+)/.exec(n.getName()); return m ? +m[1] : 0; };
    const out = [];
    const atlas = by(/^Background_Tree_Atlas/);
    for (const n of atlas.filter((x) => sfx(x) <= 7)) out.push(['tree_' + out.filter((o) => o[0].startsWith('tree_')).length, [n]]);
    // the trunked trees: trunk + branches by matching position (each pair shares its x)
    const trunks = by(/^Tree_Trunk/), branches = by(/^Tree_Branches/);
    const cx = (n) => boundsOf([n]).getCenter(new THREE.Vector3()).x;
    for (const t of trunks) {
      const br = branches.reduce((a, b) => (Math.abs(cx(b) - cx(t)) < Math.abs(cx(a) - cx(t)) ? b : a), branches[0]);
      out.push(['tree_' + out.filter((o) => o[0].startsWith('tree_')).length, [t, br]]);
    }
    let k = 0;
    for (const n of atlas.filter((x) => sfx(x) > 7)) out.push(['bush_' + k++, [n]]);
    k = 0;
    for (const n of by(/^Rocks/)) out.push(['rock_' + k++, [n]]);
    const info = {};
    for (const [name, nodes] of out) { const b = variant(doc, r, name, nodes); info[name] = size(b); }
    cutout(doc, (m) => /Atlas|Branches/.test(m), 0.42);
    await grade(doc, { dark: 0.62, sat: 0.62 });
    await texWebp(doc, 1024, { normalSize: 512 });
    for (const [k2, v2] of Object.entries(info)) console.log(' ', k2.padEnd(8), v2);
    console.log('trees: variants', out.length, 'tris', triCount(doc));
    await finish(doc, 'trees.glb', { ratio: 1 });
  }

  // ── dead trees: seven, at real heights (the source is in centimetres, oversized) ──
  const DEAD_H = { tree1: 9.5, tree2: 11, tree3: 6.5, tree4: 7, tree5: 12.5, tree6: 14, tree7: 5 };
  async function deadtrees() {
    const doc = await readRigid(src('DeadTrees.glb'));
    const r = root(doc, 'deadtrees');
    const all = meshNodes(doc);
    // each tree is its own subtree in the source: gather mesh nodes by their top-level parent
    const groups = {};
    const src0 = await io.read(src('DeadTrees.glb'));
    const names = {};
    for (const n of src0.getRoot().listNodes()) if (/^tree\d$/.test(n.getName())) { const stack = [n]; while (stack.length) { const x = stack.pop(); stack.push(...x.listChildren()); if (x.getMesh()) names[x.getName()] = n.getName(); } }
    for (const n of all) { const t = names[n.getName()]; if (t) (groups[t] || (groups[t] = [])).push(n); }
    let k = 0;
    for (const t of Object.keys(groups).sort()) {
      const b = boundsOf(groups[t]);
      const s = DEAD_H[t] / (b.max.y - b.min.y);
      const bb = variant(doc, r, 'dead_' + k++, groups[t], s);
      console.log(' ', t, '->', 'dead_' + (k - 1), size(bb));
    }
    cutout(doc, (m) => /branch/i.test(m), 0.5);
    await grade(doc, { dark: 0.5, sat: 0.55 });
    await texWebp(doc, 1024, { normalSize: 512 });
    const t = triCount(doc);
    console.log('deadtrees: tris', t);
    await finish(doc, 'deadtrees.glb', { ratio: Math.min(1, 9000 / t), error: 0.004 });
  }

  // ── the crow: 0.46 m beak to tail, standing on its feet at the origin, facing +z ──
  async function crow() {
    const doc = await readRigid(src('Crow.glb'));
    const r = root(doc, 'crow');
    const nodes = meshNodes(doc);
    const b0 = boundsOf(nodes);
    // source: beak toward -z? measure: the head is the end the body mesh is tallest at
    const s = 0.46 / Math.max(b0.max.z - b0.min.z, b0.max.x - b0.min.x);
    const body = nodes.find((n) => /body/i.test(n.getName())), wings = nodes.find((n) => /wing/i.test(n.getName()));
    const others = nodes.filter((n) => n !== body && n !== wings);
    const all = [body, wings, ...others].filter(Boolean);
    const b = boundsOf(all), c = b.getCenter(new THREE.Vector3());
    // (the source's beak points down -z: turned round to face +z)
    const M = new THREE.Matrix4().makeRotationY(Math.PI).multiply(new THREE.Matrix4().makeScale(s, s, s)).multiply(new THREE.Matrix4().makeTranslation(-c.x, -b.min.y, -c.z));
    const done = new Set();
    for (const n of all) { const m = n.getMesh(); if (!done.has(m)) { xform(m, M); done.add(m); } }
    // head direction: the beak's material is 'Beak_and_Legs'; its forward-most part is the beak
    const g = doc.createNode('bird');
    for (const n of all) { for (const p of n.listParents()) if (p.removeChild) p.removeChild(n); g.addChild(n); }
    r.addChild(g);
    if (body) body.setName('body');
    if (wings) wings.setName('wings');
    await grade(doc, { dark: 0.7, sat: 0.6 });
    await texWebp(doc, 512);
    console.log('crow size', size(boundsOf(all)), 'nodes', all.map((n) => n.getName()).join(','), 'tris', triCount(doc));
    await finish(doc, 'crow.glb', { ratio: 1 });
  }

  // ── the hangar: an old factory hall (8.55 m wide, 31 m long, open at one end) ──
  // Built 1.3x (the bays need the room: 11.1 m wide, ~5.5 m under the trusses), turned so
  // the open end faces -z (the yard, where the old hangar's door was) at z = -10.48, the
  // hall running back to z = +29.9, centred on x, floor at y = 0. The machinery in the
  // front half (the pipes along the walls, the tanks, machines and the mezzanine) is taken
  // out: the four bays stand there. What is past source z -16 stays as the far end.
  async function hangar() {
    const doc = await readRigid(src('Hangar.glb'));
    const keepFar = -16.0; // (source z: the last bay reaches game z ~ +19.5)
    let dropped = 0;
    for (const n of meshNodes(doc)) {
      const name = n.getName();
      // the pale partition boards among the far tanks read as boards floating in the hall: out
      if (/^Plane\.01[01]/.test(name)) { n.setMesh(null); dropped++; continue; }
      if (!/^(factory_tube|Cylinder|Cube\.01|Plane\.007|Plane\.013|Plane\.009)/.test(name)) continue;
      const b = boundsOf([n]);
      if ((b.min.z + b.max.z) / 2 > keepFar) { n.setMesh(null); dropped++; }
    }
    await doc.transform(prune());
    const r = root(doc, 'hangar');
    const nodes = meshNodes(doc);
    const M = new THREE.Matrix4().makeScale(1.3, 1.3, 1.3).multiply(new THREE.Matrix4().makeRotationY(Math.PI));
    const done = new Set();
    for (const n of nodes) { const m = n.getMesh(); if (!done.has(m)) { xform(m, M); done.add(m); } }
    for (const n of nodes) { for (const p of n.listParents()) if (p.removeChild) p.removeChild(n); r.addChild(n); }
    // the heavy pipework at the far end is only backdrop: simplified hard in finish()
    await grade(doc, { dark: 0.92, sat: 0.85 });
    await texWebp(doc, 1024, { normalSize: 1024 });
    const b = boundsOf(nodes);
    console.log('hangar: dropped', dropped, 'machines; size', size(b), 'min', b.min.toArray().map((v) => v.toFixed(2)), 'max', b.max.toArray().map((v) => v.toFixed(2)), 'tris', triCount(doc));
    await finish(doc, 'hangar.glb', { ratio: Math.min(1, 45000 / triCount(doc)), error: 0.002 });
  }

  return { mg4, trees, deadtrees, crow, hangar };
}
