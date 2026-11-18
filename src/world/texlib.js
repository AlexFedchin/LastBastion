// Scanned surface textures (Poly Haven CC0, built by scripts/textures/build_textures.py
// into app/textures/<size>/). Loaded once at boot; every builder falls back to the
// procedural texture of the same name if a file is missing or fails to load.
//
// Each set: <name>_c (colour; the mud carries roughness in alpha), <name>_n (OpenGL
// normal), and for the metal <name>_r (G roughness, B metalness).
import * as THREE from 'three';

// the big, close surfaces get 2k on the detailed presets; everything else 1k (512 on LOW)
const BIG = ['mud', 'turf', 'rock', 'asphalt', 'concrete', 'slab', 'metal', 'hgFloor', 'hgWall'];
const SETS = {
  mud: ['c', 'n'], turf: ['c', 'n'], rock: ['c', 'n'], asphalt: ['c', 'n'], track: ['c', 'n'], plough: ['c', 'n'],
  concrete: ['c', 'n'], slab: ['c', 'n'], metal: ['c', 'n', 'r'], corr: ['c', 'n'], plaster: ['c', 'n'],
  bark: ['c'], planks: ['c', 'n'], burlap: ['c'],
  // the hangar (ambientCG CC0, scripts/textures/build_ambientcg.py; the asphalt above comes from there too)
  hgFloor: ['c', 'n', 'r'], hgWall: ['c', 'n', 'r'], hgSteel: ['c', 'n', 'r'], hgHazard: ['c', 'n', 'r'],
  hgPlate: ['c', 'n', 'r'], hgRubber: ['c', 'n', 'r'], hgWood: ['c', 'n', 'r'],
};

const loaded = {};
let loading = null;

function sizeFor(name, q) {
  const detailed = q.texSize >= 1024 && q.pixelRatio >= 1;
  if (BIG.includes(name)) return detailed ? 2048 : 1024;
  return q.texSize >= 1024 ? 1024 : 512;
}

/** Start loading every set at the size this quality preset wants; resolves when all are in (or failed). */
export function loadTextures(quality) {
  if (loading) return loading;
  const loader = new THREE.TextureLoader();
  const one = (url, srgb) => new Promise((resolve) => {
    loader.load(url, (t) => {
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      resolve(t);
    }, undefined, () => { console.warn('[textures] missing', url); resolve(null); });
  });
  loading = Promise.all(Object.entries(SETS).map(async ([name, maps]) => {
    const s = sizeFor(name, quality);
    const [c, n, r] = await Promise.all(maps.map((m) => one(`textures/${s}/${name}_${m}.webp`, m === 'c')));
    if (!c) return;
    loaded[name] = { map: c, normalMap: n || null, roughnessMap: r || null, size: s, file: true };
  }));
  return loading;
}

/** The scanned set by name ({map, normalMap, roughnessMap, file: true}), or null. */
export function fileTex(name) { return loaded[name] || null; }
