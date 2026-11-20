// The boulders' stone: ambientCG Rock030 (scripts/textures/build_ambientcg.py, set 'boulder'),
// projected on the rock from the three world axes (triplanar), so it needs no UVs, never
// stretches on a steep face and doesn't repeat from one boulder to the next. Colour, normal
// (whiteout blend, each axis' map turned onto its face) and roughness all come from the scan.
import * as THREE from 'three';
import { Fn, vec3, vec4, texture, positionWorld, normalWorld, cameraViewMatrix, abs, pow, normalize, dot, mix } from 'three/tsl';
import { fileTex } from './texlib.js';
import { weather } from './kit.js';

const TILE = 2.6; // metres to one repeat of the scan

let mat = null;
export function stoneMaterial() {
  if (mat) return mat;
  const set = fileTex('boulder');
  mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  if (!set) { mat.color.set(0x5c5852); return weather(mat, { soot: 0.3, key: 'stone' }); }
  const C = texture(set.map), N = texture(set.normalMap), R = texture(set.roughnessMap);
  const tri = () => {
    const p = positionWorld.div(TILE);
    const n = normalize(normalWorld);
    const w0 = pow(abs(n), vec3(4));
    const w = w0.div(dot(w0, vec3(1)));
    return { p, n, w, uvX: p.zy, uvY: p.xz, uvZ: p.xy };
  };
  mat.colorNode = Fn(() => {
    const t = tri();
    const c = C.sample(t.uvX).rgb.mul(t.w.x).add(C.sample(t.uvY).rgb.mul(t.w.y)).add(C.sample(t.uvZ).rgb.mul(t.w.z));
    // a little darker where it faces up: rain-soaked tops, the dirt that settles on them
    return vec4(c.mul(mix(1, 0.8, t.w.y)), 1);
  })();
  mat.roughnessNode = Fn(() => {
    const t = tri();
    return R.sample(t.uvX).g.mul(t.w.x).add(R.sample(t.uvY).g.mul(t.w.y)).add(R.sample(t.uvZ).g.mul(t.w.z));
  })();
  mat.normalNode = Fn(() => {
    const t = tri();
    const tn = (uv) => N.sample(uv).xyz.mul(2).sub(1);
    const a = tn(t.uvX), b = tn(t.uvY), c = tn(t.uvZ);
    const nx = vec3(a.xy.add(t.n.zy), abs(t.n.x));
    const ny = vec3(b.xy.add(t.n.xz), abs(t.n.y));
    const nz = vec3(c.xy.add(t.n.xy), abs(t.n.z));
    const sx = t.n.x.sign(), sy = t.n.y.sign(), sz = t.n.z.sign();
    const nW = normalize(vec3(nx.z.mul(sx), nx.y, nx.x).mul(t.w.x)
      .add(vec3(ny.x, ny.z.mul(sy), ny.y).mul(t.w.y))
      .add(vec3(nz.x, nz.y, nz.z.mul(sz)).mul(t.w.z)));
    return normalize(cameraViewMatrix.mul(vec4(nW, 0)).xyz);
  })();
  return mat;
}
