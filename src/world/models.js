// The game's GLB models (app/models, built by scripts/models/build_models.mjs —
// see app/models/CREDITS.md). Loaded once at boot; builders clone them.
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const FILES = { m2hb: 'models/m2hb.glb', ac130: 'models/ac130.glb', b36: 'models/b36.glb' };
const scenes = {};
let loading = null;

/** Start loading every model; resolves when all are in. */
export function loadModels() {
  if (loading) return loading;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  loading = Promise.all(Object.entries(FILES).map(async ([name, url]) => {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`model ${url}: ${r.status}`);
    const gltf = await loader.parseAsync(await r.arrayBuffer(), '');
    scenes[name] = gltf.scene;
  }));
  return loading;
}

/**
 * A fresh copy of a loaded model. Geometry and textures are shared; materials
 * are cloned so each copy can be tinted on its own.
 */
export function cloneModel(name) {
  const src = scenes[name];
  if (!src) throw new Error(`model ${name} not loaded`);
  const copy = src.clone(true);
  copy.traverse((o) => { if (o.isMesh) o.material = o.material.clone(); });
  return copy;
}
