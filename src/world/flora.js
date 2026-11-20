// Trees, bushes, rocks and dead trees from the downloaded packs (app/models/trees.glb and
// deadtrees.glb, built by scripts/models/build_field.mjs: one node per variant, each on the
// origin with its base at y = 0). The world's builders keep laying their things out as they
// always have (a matrix per tree, sized as the old procedural one); these turn each matrix
// into a variant of the pack, scaled to stand in for it, and queue it with env.addModel.
//
// The tall trees are low-poly cards: they go only on the hills. The bushes and rocks go on
// the battlefield (and the farmland behind the base); the dead trees stand in the field.
import * as THREE from 'three';

// heights of the pack's variants (build log), and what each one is
const TREES = [
  // [height m, kind] spruce/fir, pine, birch (autumn)
  [26.0, 's'], [29.3, 'b'], [18.2, 's'], [26.0, 's'], [24.5, 'b'], [33.3, 'p'],
  [25.8, 's'], [26.0, 'p'], [10.3, 's'], [25.4, 's'], [18.5, 's'], [11.9, 'b'],
];
const BUSHES = [[2.21, 0.2], [5.51, 0.08], [2.24, 0.34], [2.04, 0.14], [2.58, 0.24]]; // [height, weight]
const ROCKS = [[0.71, 0.38], [1.77, 1.07], [1.44, 0.85], [0.94, 0.39], [1.14, 0.63], [2.11, 0.57], [1.64, 0.91], [1.32, 0.61], [0.78, 0.44]]; // [long side, height]
const DEAD = [9.5, 11, 6.5, 7, 12.5, 14, 5];

/** A stable pick in 0..1 from an index and a salt (keeps the world's own RNG sequence untouched). */
function hash(i, salt) {
  let h = (i * 374761393 + salt * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function pickWeighted(list, u) {
  const tot = list.reduce((a, l) => a + l[1], 0);
  let acc = 0;
  for (let i = 0; i < list.length; i++) { acc += list[i][1] / tot; if (u <= acc) return i; }
  return list.length - 1;
}

const _k = new THREE.Matrix4();
let serial = 0;

/**
 * A hill tree for one of the old conifer's matrices (12 m tall at scale 1): mostly spruce
 * and fir, some tall pines, a few birches turning. group: its own instanced mesh per region.
 */
export function placeTree(env, m, group = '') {
  const u = hash(serial++, 11);
  const kind = u < 0.62 ? 's' : u < 0.82 ? 'p' : 'b';
  const pool = TREES.map((t, i) => [t, i]).filter(([t]) => t[1] === kind);
  const [t, v] = pool[Math.floor(hash(serial, 23) * pool.length) % pool.length];
  // (the pack's trees are tall and slim: standing in for a 12 m cone they go up to ~17 m, so the
  // woods keep their mass on the hills)
  const k = 17 / t[0];
  env.addModel('trees', m.clone().multiply(_k.makeScale(k, k, k)), { node: 'tree_' + v, cast: false, group });
}

/** A bush for one of the old lump matrices (a unit blob scaled about s wide, 0.7 s tall). */
export function placeBush(env, m, group = '') {
  const v = pickWeighted(BUSHES, hash(serial++, 31));
  // the lump was a radius-1 ball: its height is about 2 x the y scale
  const sy = new THREE.Vector3().setFromMatrixColumn(m, 1).length();
  const k = (sy * 2) / BUSHES[v][0];
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  m.decompose(p, q, s);
  p.y -= sy * 0.35; // the lump sat half sunk; the bush stands on the ground
  const mm = new THREE.Matrix4().compose(p, q, s.set(k, k * (0.9 + hash(serial, 37) * 0.25), k));
  env.addModel('trees', mm, { node: 'bush_' + v, cast: false, group });
}

/**
 * A rock for one of the old boulder matrices (a radius-1 polyhedron, tumbled and scaled):
 * the same footprint, sat on the ground the right way up and turned at random.
 */
export function placeRock(env, m, { group = '', cast = true } = {}) {
  const v = Math.floor(hash(serial++, 41) * ROCKS.length) % ROCKS.length;
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  m.decompose(p, q, s);
  const wide = Math.max(s.x, s.z) * 2, high = s.y * 2;
  const k = wide / ROCKS[v][0];
  const ky = Math.max(k * 0.7, Math.min(k * 1.4, high / ROCKS[v][1]));
  const yaw = hash(serial, 43) * Math.PI * 2;
  q.setFromEuler(new THREE.Euler((hash(serial, 47) - 0.5) * 0.25, yaw, (hash(serial, 53) - 0.5) * 0.25));
  p.y -= high * 0.18; // bedded in
  // (the pack's rock is a pale limestone: darkened to the valley's wet, sooty stone)
  env.addModel('trees', new THREE.Matrix4().compose(p, q, s.set(k, ky, k)), { node: 'rock_' + v, cast, group, tint: 0x6f685e, matte: true });
}

/** A dead tree in the field for one of the old branching trees' matrices (about 7.5 m at scale 1). */
export function placeDeadTree(env, m, group = '') {
  const v = Math.floor(hash(serial++, 61) * DEAD.length) % DEAD.length;
  const k = 7.5 / DEAD[v];
  env.addModel('deadtrees', m.clone().multiply(_k.makeScale(k, k, k)), { node: 'dead_' + v, cast: true, group });
  // where it stands and how tall it is (the crows sit in them)
  const sy = new THREE.Vector3().setFromMatrixColumn(m, 1).length();
  (env.deadTreeSpots || (env.deadTreeSpots = [])).push([m.elements[12], m.elements[13], m.elements[14], DEAD[v] * k * sy]);
}

/**
 * Foliage cards are alpha-tested: as their textures mip down with distance the averaged alpha
 * falls under the cut and a wood thins to bare poles. Each card's alpha is raised with its mip
 * level (how many texels a pixel covers), so a tree keeps its crown from far off.
 */
export function patchFoliage(mat) {
  if (!mat || !(mat.alphaTest > 0) || mat.userData.foliage) return;
  mat.userData.foliage = true;
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <alphatest_fragment>', `
      #ifdef USE_MAP
        { vec2 tu = vMapUv * 1024.0; float lod = max(0.0, 0.5 * log2(max(dot(dFdx(tu), dFdx(tu)), dot(dFdy(tu), dFdy(tu)))));
          diffuseColor.a = min(1.0, diffuseColor.a * (1.0 + 0.33 * lod)); }
      #endif
      #include <alphatest_fragment>`);
  };
  mat.customProgramCacheKey = () => 'lb-foliage-v1';
  mat.needsUpdate = true;
}
