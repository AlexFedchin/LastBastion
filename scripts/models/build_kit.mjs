// Builds the bastion's set-dressing kit (app/models/kit/*.glb) from Poly Haven's
// CC0 scans (glTF, 1k), downloaded into scripts/models/source/polyhaven/<id>/.
// Each prop: every node's transform baked in, primitives joined per material,
// origin at the centre of its footprint on the floor, textures resized to WebP,
// simplified to a triangle budget, meshopt-packed.
//
//   node scripts/models/build_kit.mjs [name ...]   (missing sources are downloaded first)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { flatten, clearNodeTransform, join, weld, dedup, prune, simplify, meshopt, textureCompress, getBounds } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, 'source', 'polyhaven');
const OUT = path.join(here, '..', '..', 'app', 'models', 'kit');
fs.mkdirSync(OUT, { recursive: true });
await MeshoptSimplifier.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

// name: [poly haven id, texture px, triangle budget, extra]
// extra.rx/ry/rz rotate (radians) before the prop is set on its floor; extra.s scales.
export const KIT = {
  ammo: ['ammo_box', 512, 900, { s: 1.3, ry: Math.PI / 2 }],
  radio: ['vintage_radio_transceiver', 512, 5000, { err: 0.03 }],
  binoculars: ['binoculars', 512, 2500],
  gasmask: ['old_gas_mask', 512, 3500],
  jerry: ['metal_jerrycan_green', 512, 1500, { ry: Math.PI / 2 }],
  jerrySteel: ['metal_jerrycan', 512, 1500, { ry: Math.PI / 2 }],
  jerryPlastic: ['plastic_jerrycan', 512, 2000],
  medbox: ['medical_box', 512, 1500],
  thermos: ['modified_thermos', 256, 1500],
  searchlight: ['portable_searchlight', 512, 3000],
  foodCans: ['russian_food_cans_01', 256, 800],
  rations: ['long_life_food', 512, 1500],
  trashbag: ['trashbag', 512, 1500],
  crateLong: ['old_military_crate', 1024, 2500],
  crateWood: ['wooden_military_crate', 1024, 2000],
  crateSmall: ['wooden_crate_02', 512, 2000],
  drumRed: ['Barrel_01', 512, 1600],
  drumPlastic: ['Barrel_02', 512, 1600],
  drumBlue: ['barrel_03', 512, 1500],
  stove: ['barrel_stove', 512, 2500],
  cement: ['cement_bag', 512, 844],
  ladder: ['wooden_ladder', 512, 2500],
  spade: ['rusted_spade_01', 512, 1500],
  pick: ['picke_dirty_01', 512, 1500],
  sledge: ['sledgehammer_01', 256, 1200],
  crowbar: ['crowbar_01', 256, 800],
  generator: ['portable_generator', 1024, 4500, { err: 0.02 }],
  lpg: ['small_lpg_tank', 512, 2500],
  propane: ['propane_tank', 512, 2000],
  barrier: ['concrete_road_barrier', 1024, 1500],
  barrierTall: ['concrete_road_barrier_02', 1024, 1200],
  tyre: ['old_tyre', 512, 2000],
  trashcans: ['metal_trash_can', 1024, 5000],
  handtruck: ['hand_truck', 512, 3500],
  cardboard: ['cardboard_box_01', 512, 1500],
  compressor: ['old_military_compressor', 1024, 5000, { err: 0.02 }],
  welder: ['portable_welding_cart', 1024, 4000],
  toolcart: ['tool_cart', 1024, 3500, { err: 0.02 }],
  rack: ['worn_metal_rack', 1024, 4000],
  picnic: ['wooden_picnic_table', 1024, 4000],
  stool: ['metal_stool_01', 512, 2000],
  foldstool: ['folding_wooden_stool', 512, 2000],
  car: ['covered_car', 1024, 4000],
  utility: ['utility_box_01', 512, 2000],
  aircon: ['exterior_aircon_unit', 512, 6000],
  toolbox: ['metal_toolbox', 512, 3000],
  rifle: ['bolt_action_rifle_7_62', 512, 5000],
  flashlight: ['signal_flashlight', 256, 1500],
  // ── the hangar (the dawn resupply, src/world/hangar.js) ──
  lampHang: ['hanging_industrial_lamp', 512, 1500],
  wallLamp: ['industrial_wall_lamp', 512, 1500],
  floodlight: ['flood_lights', 512, 3000],
  crane: ['overhead_crane', 1024, 6000, { err: 0.02 }],
  shelves: ['steel_frame_shelves_01', 1024, 5000, { err: 0.02, s: 0.0935 }], // (modelled at ten times size)
  shelves2: ['steel_frame_shelves_02', 1024, 5000, { err: 0.02 }],
  toolchest: ['metal_tool_chest', 1024, 4000],
  drillpress: ['drill_press_01', 1024, 4000, { err: 0.02 }],
  chalkboard: ['standing_chalkboard_01', 1024, 2500],
  clipboard: ['clipboard', 512, 800],
  desk: ['metal_office_desk', 1024, 3000],
  extinguisher: ['korean_fire_extinguisher_01', 512, 1500],
  storecart: ['industrial_storage_cart', 1024, 3000],
  oilcan: ['small_oil_can_01', 256, 800],
  wrench: ['pipe_wrench', 256, 800],
  plasticCrate: ['plastic_crate_03', 512, 1500],
  woodCrate: ['wooden_crate_01', 1024, 1500],
};

/** Download a Poly Haven model's 1k glTF and its textures into source/polyhaven/<id>/ (if not there yet). */
async function fetchSource(id) {
  const dir = path.join(SRC, id);
  if (fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith('.gltf'))) return;
  const files = await (await fetch(`https://api.polyhaven.com/files/${id}`, { headers: { 'User-Agent': 'LastBastion-kit-build/1.0' } })).json();
  const g = files.gltf['1k'].gltf;
  const get = async (url, to) => {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    fs.writeFileSync(to, Buffer.from(await r.arrayBuffer()));
  };
  for (const [rel, f] of Object.entries(g.include || {})) await get(f.url, path.join(dir, rel));
  await get(g.url, path.join(dir, path.basename(g.url)));
  console.log('fetched', id);
}

async function build(name, [id, px, budget, extra = {}]) {
  await fetchSource(id);
  const dir = path.join(SRC, id);
  const file = fs.readdirSync(dir).find((f) => f.endsWith('.gltf'));
  const doc = await io.read(path.join(dir, file));
  const root = doc.getRoot();
  for (const s of root.listScenes().slice(1)) s.dispose();
  const scene = root.getDefaultScene() || root.listScenes()[0];
  // bake every transform into its mesh (meshes shared between nodes are copied first)
  await doc.transform(flatten());
  const seen = new Set();
  for (const n of scene.listChildren()) {
    const m = n.getMesh();
    if (m) { if (seen.has(m)) n.setMesh(m.clone()); seen.add(n.getMesh()); }
    clearNodeTransform(n);
  }
  // one parent to orient, scale and set on the floor
  const top = doc.createNode(name);
  for (const n of scene.listChildren()) { scene.removeChild(n); top.addChild(n); }
  scene.addChild(top);
  if (extra.rx || extra.ry || extra.rz) {
    const [x, y, z] = [extra.rx || 0, extra.ry || 0, extra.rz || 0];
    // XYZ euler → quaternion
    const c1 = Math.cos(x / 2), s1 = Math.sin(x / 2), c2 = Math.cos(y / 2), s2 = Math.sin(y / 2), c3 = Math.cos(z / 2), s3 = Math.sin(z / 2);
    top.setRotation([s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3]);
  }
  if (extra.s) top.setScale([extra.s, extra.s, extra.s]);
  clearNodeTransform(top); for (const n of top.listChildren()) clearNodeTransform(n);
  const b = getBounds(scene);
  top.setTranslation([-(b.min[0] + b.max[0]) / 2, -b.min[1], -(b.min[2] + b.max[2]) / 2]);
  clearNodeTransform(top); for (const n of top.listChildren()) clearNodeTransform(n);
  let tris = 0;
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) tris += p.getIndices().getCount() / 3;
  const ratio = Math.min(1, budget / tris);
  await doc.transform(
    dedup(), join({ keepNamed: false }), weld(),
    ...(ratio < 0.98 ? [simplify({ simplifier: MeshoptSimplifier, ratio, error: extra.err || 0.004 })] : []),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [px, px], quality: 82 }),
    prune({ keepLeaves: false }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  const out = path.join(OUT, name + '.glb');
  await io.write(out, doc);
  const bb = getBounds(scene);
  let t2 = 0, prims = 0;
  for (const m of root.listMeshes()) for (const p of m.listPrimitives()) { t2 += p.getIndices().getCount() / 3; prims++; }
  console.log(name.padEnd(14), (fs.statSync(out).size / 1024).toFixed(0).padStart(5), 'KB', String(t2 | 0).padStart(6), 'tris', prims, 'prims',
    bb.max.map((v, i) => (v - bb.min[i]).toFixed(2)).join(' x '));
}

const want = process.argv.slice(2);
for (const [k, v] of Object.entries(KIT)) if (!want.length || want.includes(k)) await build(k, v);
