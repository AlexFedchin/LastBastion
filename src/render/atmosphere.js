// Atmosphere: one fog model for every material in the game.
//
// three.js' own fog chunks are replaced globally with a physically-flavoured
// model: thin exponential haze, a dense height-fog layer that hugs the ground
// (patchy, drifting mist), and in-scattered light from the burning city that
// matches the sky shader's horizon glow exactly, so far hills melt into the
// glow instead of ending at a fog wall.
//
// Built-in materials receive the fog parameters through scene.fog (a plain
// THREE.Fog whose `near` carries time and `far` carries the dawn blend);
// custom ShaderMaterials use `fogUniforms` + `FOG_CUSTOM_GLSL`.
import * as THREE from 'three';

// colour of the city glow (shared with the sky shader)
export const GLOW_RGB = [0.2, 0.05, 0.012];

const f = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
const NIGHT = { Db: 0.00155, D0: 0.0085, b: 0.15 };
const DAWN = { Db: 0.0027, D0: 0.016, b: 0.085 };

export const FOG_FUNCS = /* glsl */`
#ifndef LB_FOG_SCALE
#define LB_FOG_SCALE 1.0
#endif
float lbHash(vec2 p){ p = fract(p * vec2(233.34, 851.73)); p += dot(p, p + 23.45); return fract(p.x * p.y); }
float lbNoise(vec2 p){
  vec2 i = floor(p), q = fract(p);
  vec2 u = q * q * (3.0 - 2.0 * q);
  return mix(mix(lbHash(i), lbHash(i + vec2(1.0, 0.0)), u.x), mix(lbHash(i + vec2(0.0, 1.0)), lbHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// returns rgb = in-scattered colour, a = fog amount
vec4 lbFog(vec3 wp, vec3 cam, vec3 baseCol, float t, float dawn){
  // a fog bank rides on the dawn channel: values above 2 are 2 + bank strength (night only)
  float bank = max(0.0, dawn - 2.0);
  dawn = dawn > 1.5 ? 0.0 : dawn;
  vec3 rv = wp - cam;
  float d = length(rv);
  vec3 rd = rv / max(d, 1e-4);
  float Db = mix(${f(NIGHT.Db)}, ${f(DAWN.Db)}, dawn);
  float D0 = mix(${f(NIGHT.D0)}, ${f(DAWN.D0)}, dawn);
  float b = mix(${f(NIGHT.b)}, ${f(DAWN.b)}, dawn);
  // a real bank lies out in the valley: the wall base and the first stretch of field stay
  // clear, it thickens over the next tens of metres, and the far field is gone
  float bankPath = max(d - 30.0, 0.0);
  float bankFrac = bankPath / max(d, 1e-4);
  float bankTau = bank * (0.0016 * 26.0) * bankPath * (0.6 + 0.4 * smoothstep(30.0, 90.0, d));
  D0 *= 1.0 + bank * 6.0 * bankFrac;
  b = mix(b, 0.05, bank * bankFrac);
  // drifting, patchy ground mist
  float m = lbNoise(wp.xz * 0.012 + t * vec2(0.010, 0.0035)) * 0.62 + lbNoise(wp.xz * 0.041 - t * vec2(0.004, 0.016)) * 0.38;
  m = 0.22 + 1.65 * m * m;
  float k = b * rd.y * d;
  float hi = abs(k) < 1e-3 ? d : (1.0 - exp(-k)) / (b * rd.y);
  float th = D0 * exp(-b * cam.y) * hi * m;
  float tb = Db * d + bankTau;
  vec2 dxz = normalize(rd.xz + 1e-5);
  float toward = max(0.0, -dxz.y);
  float glow = toward * toward * exp(-max(rd.y, 0.0) * 13.0) * mix(0.5, 0.35, dawn);
  glow *= 1.0 - exp(-max(d - 120.0, 0.0) / 700.0);   // only long paths pick up the city's light
  glow *= 1.0 - 0.75 * bank;                          // a dense bank swallows most of it
  vec3 G = vec3(${GLOW_RGB.map(f).join(', ')});
  vec3 cb = baseCol + G * glow;
  // inside a bank everything is one milky colour: the haze/mist tint split (weighted by
  // mist noise at the far end of the ray) would otherwise draw fogged-out skylines
  vec3 ch = mix(baseCol * 1.75 + G * glow * 0.55, cb, bank);
  float tau = (tb + th) * LB_FOG_SCALE;
  vec3 col = (cb * tb + ch * th) / max(tb + th, 1e-6);
  return vec4(col, 1.0 - exp(-tau));
}
`;

// For custom ShaderMaterials: declare uniforms + functions.
export const FOG_CUSTOM_GLSL = /* glsl */`
uniform vec3 lbFogColor;
uniform float lbTime;
uniform float lbDawn;
${FOG_FUNCS}
`;

export const fogUniforms = {
  lbFogColor: { value: new THREE.Color(0.0055, 0.006, 0.0085) },
  lbTime: { value: 0 },
  lbDawn: { value: 0 },
};

let patched = false;
export function patchFogChunks() {
  if (patched) return;
  patched = true;
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = /* glsl */`
#ifdef USE_FOG
  varying vec3 vLbFogW;
#endif`;
  C.fog_vertex = /* glsl */`
#ifdef USE_FOG
  vLbFogW = transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);
#endif`;
  C.fog_pars_fragment = /* glsl */`
#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  varying vec3 vLbFogW;
  ${FOG_FUNCS}
#endif`;
  C.fog_fragment = /* glsl */`
#ifdef USE_FOG
  vec4 lbF = lbFog(vLbFogW, cameraPosition, fogColor, fogNear, fogFar);
  #ifdef LB_FOG_ADD
    gl_FragColor.rgb *= 1.0 - lbF.a;
  #else
    gl_FragColor.rgb = mix(gl_FragColor.rgb, lbF.rgb, lbF.a);
  #endif
#endif`;
}

/**
 * Skip the BRDF for lights that contribute nothing at this pixel. three.js
 * already works out directLight.visible (zero colour, out of range, outside a
 * spot cone) but evaluates the full GGX term anyway. The game keeps a fixed pool
 * of point lights (so shaders never recompile) and most of them sit dark, so
 * this is a large, pixel-identical saving on every lit surface.
 */
let lightsPatched = false;
export function patchLightChunks() {
  if (lightsPatched) return;
  lightsPatched = true;
  const C = THREE.ShaderChunk;
  const call = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
  if (C.lights_fragment_begin.includes(call)) {
    C.lights_fragment_begin = C.lights_fragment_begin.split(call).join('if ( directLight.visible ) ' + call);
  }
  // a dark pool light (colour uniform == 0) is skipped before any per-pixel work;
  // the branch is uniform across the draw, so it costs nothing
  const info = 'getPointLightInfo( pointLight, geometryPosition, directLight );';
  if (C.lights_fragment_begin.includes(info)) {
    C.lights_fragment_begin = C.lights_fragment_begin.replace(info,
      'directLight.visible = false; if ( any( notEqual( pointLight.color, vec3( 0.0 ) ) ) ) ' + info);
  }
}

/** The scene fog object: color = base fog colour, near = time, far = dawn. */
export function createSceneFog(color) {
  const fog = new THREE.Fog(color.clone(), 0, 0);
  return fog;
}

