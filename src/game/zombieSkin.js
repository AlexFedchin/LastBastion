// The horde's zombie: the user's rigged pack (scripts/models/build_zombie.mjs), skinned in the
// vertex shader from a baked animation texture so thousands can draw in a few instanced calls.
//
// Every clip's every frame is a row of the texture: 23 bones × 3 texels (the rows of [R|t]).
// Each instance carries two rows (two clips, or one clip crossfading out) and a blend:
//   aAnim  = (rowA, rowB, blend, look + seed)       rows are fractional: frames interpolate
//   aState = (flash, burn, type, fade < 0 | headless > 0.5)
//   aTint  = albedo multiplier (a dirtier shirt, a paler face...)
// ZombieAnim picks the rows on the CPU (clip, time -> row) and knows where the head is.
import * as THREE from 'three';
import { Fn, If, Discard, float, int, vec2, vec3, vec4, ivec2, uniform, attribute, texture, textureLoad, uv, varyingProperty, screenCoordinate, normalLocal, normalView, positionViewDirection, mix, smoothstep, clamp, max, pow, sin, dot, normalize, fract, floor, step, select } from 'three/tsl';

export class ZombieAnim {
  constructor(meta, data) {
    this.meta = meta;
    this.data = data;
    this.clips = meta.clips;
    this.names = Object.keys(meta.clips);
    this.id = Object.fromEntries(this.names.map((n, i) => [n, i]));
    this.byId = this.names.map((n) => meta.clips[n]);
    this.fps = meta.fps;
    this.nb = meta.bones.length;
    this.head = meta.headBone;
    this.eyes = meta.eyes;
    const tex = new THREE.DataTexture(data, meta.width, meta.rows, THREE.RGBAFormat, THREE.FloatType);
    tex.magFilter = tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    this.texture = tex;
  }
  /** Clip id, seconds into it -> texture row (loops wrap, one-shots hold their last frame). */
  row(id, t) {
    const c = this.byId[id];
    let f = t * this.fps;
    if (c.loop) { f %= c.frames; if (f < 0) f += c.frames; } else f = Math.min(Math.max(f, 0), c.frames - 1);
    return c.row + f;
  }
  dur(id) { return this.byId[id].dur; }
  /** Where a point fixed to the head (bind space, metres) is, at a row (nearest frame). */
  onHead(row, px, py, pz, out) {
    const o = (Math.round(row) * this.nb + this.head) * 12, d = this.data;
    out[0] = d[o] * px + d[o + 1] * py + d[o + 2] * pz + d[o + 3];
    out[1] = d[o + 4] * px + d[o + 5] * py + d[o + 6] * pz + d[o + 7];
    out[2] = d[o + 8] * px + d[o + 9] * py + d[o + 10] * pz + d[o + 11];
    return out;
  }
}

/** Everything the horde needs to draw on the model: its clips, its three levels of detail, its textures. */
export function zombieSkin(modelMesh, animData) {
  const anim = new ZombieAnim(animData.meta, animData.data);
  const meshes = [0, 1, 2].map((l) => modelMesh('zombie', 'lod' + l));
  for (const m of meshes) m.updateWorldMatrix(true, false);
  const mat = meshes[0].material;
  mat.map.anisotropy = 4;
  return { anim, geos: meshes.map(zombieGeometry), maps: { looks: mat.map, normal: mat.normalMap } };
}

/** The glb's geometry baked out of its (meshopt-quantized) node into plain floats. */
export function zombieGeometry(mesh) {
  const src = mesh.geometry, m = mesh.matrixWorld, nm = new THREE.Matrix3().getNormalMatrix(m);
  const g = new THREE.BufferGeometry();
  const P = src.attributes.position, N = src.attributes.normal, n = P.count;
  const p = new Float32Array(n * 3), nr = new Float32Array(n * 3), v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(P, i).applyMatrix4(m); p[i * 3] = v.x; p[i * 3 + 1] = v.y; p[i * 3 + 2] = v.z;
    v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nr[i * 3] = v.x; nr[i * 3 + 1] = v.y; nr[i * 3 + 2] = v.z;
  }
  // WebGPU allows 8 vertex buffers a draw, and the horde's instances bring four of their own
  // (the matrix, aAnim, aState, aTint): the per-vertex data goes in two interleaved buffers,
  // position | normal | uv, and skinIndex | skinWeight
  const UV = src.attributes.uv, SI = src.attributes.skinIndex, SW = src.attributes.skinWeight;
  const geoB = new Float32Array(n * 8), skinB = new Float32Array(n * 8);
  for (let i = 0; i < n; i++) {
    geoB.set([p[i * 3], p[i * 3 + 1], p[i * 3 + 2], nr[i * 3], nr[i * 3 + 1], nr[i * 3 + 2], UV.getX(i), UV.getY(i)], i * 8);
    for (let c = 0; c < 4; c++) { skinB[i * 8 + c] = SI.getComponent(i, c); skinB[i * 8 + 4 + c] = SW.getComponent(i, c); }
  }
  const ig = new THREE.InterleavedBuffer(geoB, 8), is = new THREE.InterleavedBuffer(skinB, 8);
  g.setAttribute('position', new THREE.InterleavedBufferAttribute(ig, 3, 0));
  g.setAttribute('normal', new THREE.InterleavedBufferAttribute(ig, 3, 3));
  g.setAttribute('uv', new THREE.InterleavedBufferAttribute(ig, 2, 6));
  g.setAttribute('skinIndex', new THREE.InterleavedBufferAttribute(is, 4, 0));
  g.setAttribute('skinWeight', new THREE.InterleavedBufferAttribute(is, 4, 4));
  g.setIndex(src.index.clone());
  g.computeBoundingSphere();
  return g;
}

/// ── the shader (WebGPU / TSL) ───────────────────────────────────────────────
// One bone's three rows ([R|t]) at a fractional texture row: the two frames either side, blended.
function boneRows(T, row, b) {
  const f0 = floor(row), t = row.sub(f0);
  const c = ivec2(int(b).mul(3), int(f0)), d = c.add(ivec2(0, 1));
  const r = (k) => mix(textureLoad(T, c.add(ivec2(k, 0)), 0), textureLoad(T, d.add(ivec2(k, 0)), 0), t);
  return [r(0), r(1), r(2)];
}

/**
 * Skin a bind-space point and normal from the animation texture: two clips (rows) crossfading,
 * the bloater's belly swelling, a headless body's head pinched to the stump. Sets normalLocal;
 * returns the skinned position. headW (a var) gets the head bones' weight.
 */
function skinNodes(T, U, headW) {
  const skinIndex = attribute('skinIndex', 'vec4'), skinWeight = attribute('skinWeight', 'vec4');
  const aAnim = attribute('aAnim', 'vec4'), aState = attribute('aState', 'vec4');
  return Fn(() => {
    const p = vec3(attribute('position', 'vec3')).toVar();
    const n = vec3(attribute('normal', 'vec3')).toVar();
    const type = int(aState.z.add(0.5));
    const headless = aState.w.greaterThan(0.5);
    headW.assign(0);
    // the bloater: a belly swollen with gas, swelling and settling
    If(type.equal(3), () => {
      const sw = float(0).toVar();
      for (const c of ['x', 'y', 'z', 'w']) {
        const b = int(skinIndex[c].add(0.5));
        If(b.greaterThanEqual(1).and(b.lessThanEqual(3)), () => { sw.addAssign(skinWeight[c]); });
      }
      const belly = sw.mul(smoothstep(0.95, 1.12, p.y)).mul(smoothstep(1.5, 1.25, p.y)).mul(smoothstep(-0.05, 0.12, n.z).mul(0.4).add(0.6));
      p.addAssign(n.mul(belly).mul(sin(U.uTime.mul(3).add(aAnim.w.mul(40))).mul(0.025).add(0.11)));
    });
    const acc = vec3(0).toVar(), nn = vec3(0).toVar();
    for (const c of ['x', 'y', 'z', 'w']) {
      const w = skinWeight[c];
      If(w.greaterThan(0), () => {
        const b = int(skinIndex[c].add(0.5)).toVar();
        const A = boneRows(T, aAnim.x, b);
        const r0 = vec4(A[0]).toVar(), r1 = vec4(A[1]).toVar(), r2 = vec4(A[2]).toVar();
        If(aAnim.z.greaterThan(0.002), () => {
          const B = boneRows(T, aAnim.y, b);
          r0.assign(mix(r0, B[0], aAnim.z)); r1.assign(mix(r1, B[1], aAnim.z)); r2.assign(mix(r2, B[2], aAnim.z));
        });
        const isHead = b.equal(5).or(b.equal(6));
        If(isHead, () => { headW.addAssign(w); });
        // headless: what hung off the head bone pinches to the stump
        const src = select(isHead.and(headless), U.uHeadJoint, p);
        const q = vec4(src, 1);
        acc.addAssign(vec3(dot(r0, q), dot(r1, q), dot(r2, q)).mul(w));
        nn.addAssign(vec3(dot(r0.xyz, n), dot(r1.xyz, n), dot(r2.xyz, n)).mul(w));
      });
    }
    normalLocal.assign(normalize(nn));
    return acc;
  })();
}

const dither = (k) => fract(sin(dot(floor(k), vec2(12.9898, 78.233))).mul(43758.5453));

/** The zombie's material: a standard material skinned from the animation texture. */
export function createSkinnedZombieMaterial(anim, maps, uniforms, { corpse = false, depth = false } = {}) {
  // (shadows draw with the material's own positionNode under WebGPU: no separate depth material)
  if (depth) return null;
  const T = texture(anim.texture);
  const U = { uTime: uniforms.uTime, uRim: uniforms.uRim, uHeadJoint: uniform(new THREE.Vector3(...anim.meta.stump)) };
  const uCorpse = corpse ? 1 : 0;
  const aAnim = attribute('aAnim', 'vec4'), aState = attribute('aState', 'vec4'), aTint = attribute('aTint', 'vec3');
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, normalMap: maps.normal, normalScale: new THREE.Vector2(1, 1) });
  const vHeadW = varyingProperty('float', 'vZHeadW');
  mat.positionNode = Fn(() => {
    const headW = float(0).toVar();
    const p = skinNodes(T, U, headW);
    vHeadW.assign(headW);
    return p;
  })();
  const looks = texture(maps.looks);
  const sample = () => looks.sample(vec2(uv().x.add(floor(aAnim.w)).div(3), uv().y));
  const masks = () => {
    const zTex = sample();
    const zc = zTex.rgb.mul(aTint).toVar();
    // blood reads wet: red over green and blue
    const blood = clamp(zc.r.sub(max(zc.g, zc.b).mul(1.6)).mul(9), 0, 1);
    const stump = select(aState.w.greaterThan(0.5), smoothstep(0.02, 0.2, vHeadW), float(0));
    return { zTex, zc, blood, stump };
  };
  mat.colorNode = Fn(() => {
    // fading out: a screen-door dither
    If(aState.w.lessThan(-0.002), () => {
      If(dither(screenCoordinate.xy).lessThan(aState.w.negate()), () => { Discard(); });
    });
    const M = masks();
    const zc = mix(M.zc, vec3(0.12, 0.008, 0.006), M.stump).toVar();
    // giants have their own mesh; the bloater's skin goes sickly
    If(aState.z.greaterThan(2.5).and(aState.z.lessThan(3.5)), () => { zc.mulAssign(vec3(0.85, 1.0, 0.7)); });
    // charring as it burns, in blotches that spread (the burnt dead: char all over)
    const zChar = corpse ? aState.y : aState.y.mul(step(0.45, dither(uv().mul(40))).mul(0.4).add(0.35));
    return vec4(mix(zc, vec3(0.022, 0.018, 0.016), clamp(zChar, 0, 1)), 1);
  })();
  mat.roughnessNode = Fn(() => {
    const M = masks();
    return mix(M.zTex.a.mul(0.55).add(0.45), 0.22, max(M.blood, M.stump));
  })();
  mat.emissiveNode = Fn(() => {
    const rim = pow(float(1).sub(clamp(dot(normalView, positionViewDirection), 0, 1)), 3);
    const e = U.uRim.mul(rim).mul(1 - uCorpse * 0.7).toVar();
    // burning: a smoulder in patches of the charring skin (the flames drawn over it carry the motion)
    if (!corpse) e.addAssign(vec3(0.75, 0.24, 0.04).mul(clamp(aState.y, 0, 1)).mul(smoothstep(0.55, 0.95, dither(uv().mul(90)))));
    If(aState.z.greaterThan(2.5).and(aState.z.lessThan(3.5)), () => {
      e.addAssign(vec3(0.12, 0.3, 0.02).mul(masks().blood).mul(sin(U.uTime.mul(4).add(aAnim.w.mul(9))).mul(0.4).add(0.6)));
    });
    return e;
  })();
  return mat;
}
