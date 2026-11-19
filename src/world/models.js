// The game's GLB models (app/models, built by scripts/models/build_models.mjs —
// see app/models/CREDITS.md). Loaded once at boot; builders clone them.
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const FILES = {
  m2hb: 'models/m2hb.glb', ac130: 'models/ac130.glb', b36: 'models/b36.glb',
  soldier: 'models/soldier.glb', survivor_man: 'models/survivor_man.glb', survivor_woman: 'models/survivor_woman.glb',
  survivor_man2: 'models/survivor_man2.glb', survivor_child: 'models/survivor_child.glb', grenade: 'models/grenade.glb', molotov: 'models/molotov.glb', sandbags: 'models/sandbags.glb',
  // vehicles and field props (scripts/models/build_vehicles.mjs)
  ch47: 'models/ch47.glb', apache: 'models/apache.glb', ural: 'models/ural.glb', ural_burnt: 'models/ural_burnt.glb',
  heliwreck: 'models/heliwreck.glb', container: 'models/container.glb', bale: 'models/bale.glb', bomb: 'models/bomb.glb',
  house: 'models/house.glb', mcrate: 'models/mcrate.glb', church: 'models/church.glb', hedgehog: 'models/hedgehog.glb',
  tower: 'models/tower.glb', // the central tower (the user's own model)
  // the field, the hills and the crews (scripts/models/build_field.mjs)
  trees: 'models/trees.glb', deadtrees: 'models/deadtrees.glb', mg4: 'models/mg4.glb', crow: 'models/crow.glb',
  hangar: 'models/hangar.glb', // the dawn resupply's hall (src/world/hangar.js)
  // the horde's zombie (scripts/models/build_zombie.mjs; its baked clips load beside it)
  zombie: 'models/zombie.glb',
};
/** The wrecked cars on the roads, each its own model (long axis +x, base at 0). */
export const CARS = ['car_sedan', 'car_police', 'car_police_flip', 'car_hatch', 'car_saloon'];
for (const k of CARS) FILES[k] = `models/${k}.glb`;
// set dressing for the bastion: Poly Haven CC0 scans (scripts/models/build_kit.mjs), loaded as 'kit/<name>'
export const KIT = [
  'aircon', 'ammo', 'barrier', 'barrierTall', 'binoculars', 'car', 'cardboard', 'cement', 'compressor',
  'crateLong', 'crateSmall', 'crateWood', 'crowbar', 'drumBlue', 'drumPlastic', 'drumRed', 'flashlight',
  'foldstool', 'foodCans', 'gasmask', 'generator', 'handtruck', 'jerry', 'jerryPlastic', 'jerrySteel',
  'ladder', 'lpg', 'medbox', 'pick', 'picnic', 'propane', 'rack', 'radio', 'rations', 'rifle', 'searchlight',
  'sledge', 'spade', 'stool', 'stove', 'thermos', 'toolbox', 'toolcart', 'trashbag', 'trashcans',
  'tyre', 'utility', 'welder',
  // the hangar (the dawn resupply, src/world/hangar.js)
  'lampHang', 'wallLamp', 'floodlight', 'crane', 'shelves', 'shelves2', 'toolchest', 'drillpress',
  'chalkboard', 'clipboard', 'desk', 'extinguisher', 'storecart', 'oilcan', 'wrench', 'plasticCrate', 'woodCrate',
];
for (const k of KIT) FILES['kit/' + k] = `models/kit/${k}.glb`;
const scenes = {}, clips = {};
let loading = null;
let zombieAnim = null;

/** Start loading every model; resolves when all are in. */
export function loadModels() {
  if (loading) return loading;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  loading = Promise.all([...Object.entries(FILES).map(async ([name, url]) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`model ${url}: ${r.status}`);
    const gltf = await loader.parseAsync(await r.arrayBuffer(), '');
    scenes[name] = gltf.scene;
    clips[name] = gltf.animations || [];
  }), (async () => {
    const [m, d] = await Promise.all([fetch('models/zombie_anim.json'), fetch('models/zombie_anim.bin')]);
    if (!m.ok || !d.ok) throw new Error('models/zombie_anim: ' + m.status + ' ' + d.status);
    zombieAnim = { meta: await m.json(), data: new Float32Array(await d.arrayBuffer()) };
  })()]);
  return loading;
}

/**
 * A fresh copy of a loaded model. Geometry and textures are shared; materials
 * are cloned so each copy can be tinted on its own.
 */
/** The loaded scene itself (for skinned models, which need SkeletonUtils.clone). */
export function modelScene(name) {
  if (!scenes[name]) throw new Error(`model ${name} not loaded`);
  return scenes[name];
}

/** The zombie's baked clips: { meta (zombie_anim.json), data (every frame's bone matrices) }. */
export function zombieAnimData() { return zombieAnim; }

/** A loaded model's animation clips (the soldier's, retargeted from Mixamo). */
export function modelClips(name) { return clips[name] || []; }

/** A loaded model's mesh by node name (or its first mesh): for instancing its geometry and material. */
export function modelMesh(name, node = null) {
  const src = scenes[name];
  if (!src) throw new Error(`model ${name} not loaded`);
  let found = null;
  src.traverse((o) => { if (!found && o.isMesh && (!node || o.name === node || (o.parent && o.parent.name === node))) found = o; });
  return found;
}

export function cloneModel(name) {
  const src = scenes[name];
  if (!src) throw new Error(`model ${name} not loaded`);
  const copy = src.clone(true);
  copy.traverse((o) => { if (o.isMesh) o.material = o.material.clone(); });
  return copy;
}
