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
  const f = (a, size) => { const o = new Float32Array(n * size); for (let i = 0; i < n; i++) for (let c = 0; c < size; c++) o[i * size + c] = a.getComponent(i, c); return new THREE.BufferAttribute(o, size); };
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nr, 3));
  g.setAttribute('uv', f(src.attributes.uv, 2));
  g.setAttribute('skinIndex', f(src.attributes.skinIndex, 4));
  g.setAttribute('skinWeight', f(src.attributes.skinWeight, 4));
  g.setIndex(src.index.clone());
  g.computeBoundingSphere();
  return g;
}

// ── the shader ──────────────────────────────────────────────────────────────
const SKIN_HEADER = /* glsl */`
uniform sampler2D uBones;
uniform float uTime;
uniform vec3 uHeadJoint;
attribute vec4 skinIndex;
attribute vec4 skinWeight;
attribute vec4 aAnim;
attribute vec4 aState;
attribute vec3 aTint;
// one bone's three rows at a fractional texture row (frames interpolate)
void zRows(float row, int b, out vec4 r0, out vec4 r1, out vec4 r2) {
  float f0 = floor(row), t = row - f0;
  ivec2 c = ivec2(b * 3, int(f0)), d = c + ivec2(0, 1);
  r0 = mix(texelFetch(uBones, c, 0), texelFetch(uBones, d, 0), t);
  r1 = mix(texelFetch(uBones, c + ivec2(1, 0), 0), texelFetch(uBones, d + ivec2(1, 0), 0), t);
  r2 = mix(texelFetch(uBones, c + ivec2(2, 0), 0), texelFetch(uBones, d + ivec2(2, 0), 0), t);
}
mat4 zBone(int b) {
  vec4 r0, r1, r2;
  zRows(aAnim.x, b, r0, r1, r2);
  if (aAnim.z > 0.002) {
    vec4 s0, s1, s2;
    zRows(aAnim.y, b, s0, s1, s2);
    r0 = mix(r0, s0, aAnim.z); r1 = mix(r1, s1, aAnim.z); r2 = mix(r2, s2, aAnim.z);
  }
  return mat4(r0.x, r1.x, r2.x, 0.0, r0.y, r1.y, r2.y, 0.0, r0.z, r1.z, r2.z, 0.0, r0.w, r1.w, r2.w, 1.0);
}
float zHeadW;
// skin a bind-space point and normal
void zSkin(inout vec3 p, inout vec3 n) {
  int type = int(aState.z + 0.5);
  bool headless = aState.w > 0.5;
  zHeadW = 0.0;
  // the bloater: a belly swollen with gas, swelling and settling
  if (type == 3) {
    float sw = 0.0;
    for (int k = 0; k < 4; k++) { int b = int(skinIndex[k] + 0.5); if (b >= 1 && b <= 3) sw += skinWeight[k]; }
    float belly = sw * smoothstep(0.95, 1.12, p.y) * smoothstep(1.5, 1.25, p.y) * (0.6 + 0.4 * smoothstep(-0.05, 0.12, n.z));
    p += n * belly * (0.11 + 0.025 * sin(uTime * 3.0 + aAnim.w * 40.0));
  }
  vec4 acc = vec4(0.0); vec3 nn = vec3(0.0);
  for (int k = 0; k < 4; k++) {
    float w = skinWeight[k];
    if (w <= 0.0) continue;
    int b = int(skinIndex[k] + 0.5);
    mat4 M = zBone(b);
    bool isHead = b == 5 || b == 6;
    if (isHead) zHeadW += w;
    // headless: what hung off the head bone pinches to the stump
    vec4 q = (isHead && headless) ? M * vec4(uHeadJoint, 1.0) : M * vec4(p, 1.0);
    acc += w * q;
    nn += w * mat3(M) * n;
  }
  p = acc.xyz;
  n = normalize(nn);
}
`;

const COLOR_FRAG = /* glsl */`
  if (vZState.w < -0.002) {
    float zd = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
    if (zd < -vZState.w) discard;
  }
  float zLook = floor(vZLook);
  vec4 zTex = texture2D(uLooks, vec2((vZUv.x + zLook) / 3.0, vZUv.y));
  vec3 zc = zTex.rgb; // (an sRGB texture: sampled linear)
  zc *= vZTint;
  // blood reads wet: red over green and blue
  float zBlood = clamp((zc.r - max(zc.g, zc.b) * 1.6) * 9.0, 0.0, 1.0);
  float zStump = (vZState.w > 0.5) ? smoothstep(0.02, 0.2, vZHeadW) : 0.0;
  zc = mix(zc, vec3(0.12, 0.008, 0.006), zStump);
  // giants have their own mesh; the bloater's skin goes sickly
  if (vZType > 2.5 && vZType < 3.5) zc *= vec3(0.85, 1.0, 0.7);
  // charring as it burns, in blotches that spread (the burnt dead: char all over)
  float zChar = uCorpse > 0.5 ? vZState.y : vZState.y * (0.35 + 0.4 * step(0.45, fract(sin(dot(floor(vZUv * 40.0), vec2(12.9898, 78.233))) * 43758.5453)));
  zc = mix(zc, vec3(0.022, 0.018, 0.016), clamp(zChar, 0.0, 1.0));
  diffuseColor.rgb *= zc;
`;

/** The zombie's material: MeshStandardMaterial skinned from the animation texture. */
export function createSkinnedZombieMaterial(anim, maps, uniforms, { corpse = false, depth = false } = {}) {
  const shared = {
    uBones: { value: anim.texture },
    uHeadJoint: { value: new THREE.Vector3(...anim.meta.stump) },
  };
  if (depth) {
    const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, shared, { uTime: uniforms.uTime });
      shader.vertexShader = SKIN_HEADER + shader.vertexShader.replace('#include <begin_vertex>', `
        vec3 transformed = position; vec3 zNN = normal; zSkin(transformed, zNN);`);
    };
    mat.customProgramCacheKey = () => 'zskin-depth-v1';
    return mat;
  }
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, normalMap: maps.normal, normalScale: new THREE.Vector2(1, 1) });
  const local = { uCorpse: { value: corpse ? 1 : 0 }, uLooks: { value: maps.looks } };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, local, {
      uTime: uniforms.uTime, uRim: uniforms.uRim, uLamps: uniforms.uLamps, uLampPow: uniforms.uLampPow,
    });
    shader.vertexShader = SKIN_HEADER + `
      varying vec2 vZUv; varying float vZLook; varying vec3 vZTint; varying vec4 vZState; varying float vZType; varying float vZHeadW;
    ` + shader.vertexShader
      .replace('#include <beginnormal_vertex>', `
        vec3 zP = position; vec3 objectNormal = normal; zSkin(zP, objectNormal);
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3( tangent.xyz );
        #endif`)
      .replace('#include <begin_vertex>', `
        vec3 transformed = zP;
        vZUv = uv; vZLook = aAnim.w; vZTint = aTint; vZState = aState; vZType = aState.z; vZHeadW = zHeadW;`);
    shader.fragmentShader = `
      uniform float uTime; uniform float uCorpse; uniform vec3 uRim; uniform sampler2D uLooks;
      uniform vec3 uLamps[10]; uniform float uLampPow;
      varying vec2 vZUv; varying float vZLook; varying vec3 vZTint; varying vec4 vZState; varying float vZType; varying float vZHeadW;
    ` + shader.fragmentShader
      .replace('#include <color_fragment>', COLOR_FRAG)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(0.45 + 0.55 * zTex.a, 0.22, max(zBlood, zStump));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float zRim = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
        totalEmissiveRadiance += zRim * uRim * (1.0 - uCorpse * 0.7);
        #ifdef USE_FOG
        if (uLampPow > 0.001) {
          // the sodium lamps on the wall: a warm wash on everything that reaches the wall
          vec3 zWN = normalize(transpose(mat3(viewMatrix)) * normal);
          float zLamp = 0.0;
          for (int k = 0; k < 10; k++) {
            vec3 L = uLamps[k] - vLbFogW;
            float d = length(L);
            float att = clamp(1.0 - d / 17.0, 0.0, 1.0);
            zLamp += att * att * (0.25 + 0.75 * clamp(dot(zWN, L / max(d, 1e-3)), 0.0, 1.0));
          }
          totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.52, 0.18) * zLamp * uLampPow * 2.6;
        }
        #endif
        // burning: a smoulder in patches of the charring skin (the flames drawn over it carry the motion)
        float zN = fract(sin(dot(floor(vZUv * 90.0), vec2(12.9898, 78.233))) * 43758.5453);
        totalEmissiveRadiance += clamp(vZState.y, 0.0, 1.0) * (1.0 - uCorpse) * vec3(0.75, 0.24, 0.04) * smoothstep(0.55, 0.95, zN);
        if (vZType > 2.5 && vZType < 3.5) totalEmissiveRadiance += zBlood * vec3(0.12, 0.3, 0.02) * (0.6 + 0.4 * sin(uTime * 4.0 + vZLook * 9.0));`);
  };
  mat.customProgramCacheKey = () => 'zskin-v1' + (corpse ? 'c' : '');
  return mat;
}
