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
  vec3 rv = wp - cam;
  float d = length(rv);
  vec3 rd = rv / max(d, 1e-4);
  float Db = mix(${f(NIGHT.Db)}, ${f(DAWN.Db)}, dawn);
  float D0 = mix(${f(NIGHT.D0)}, ${f(DAWN.D0)}, dawn);
  float b = mix(${f(NIGHT.b)}, ${f(DAWN.b)}, dawn);
  // drifting, patchy ground mist
  float m = lbNoise(wp.xz * 0.012 + t * vec2(0.010, 0.0035)) * 0.62 + lbNoise(wp.xz * 0.041 - t * vec2(0.004, 0.016)) * 0.38;
  m = 0.22 + 1.65 * m * m;
  float k = b * rd.y * d;
  float hi = abs(k) < 1e-3 ? d : (1.0 - exp(-k)) / (b * rd.y);
  float th = D0 * exp(-b * cam.y) * hi * m;
  float tb = Db * d;
  vec2 dxz = normalize(rd.xz + 1e-5);
  float toward = max(0.0, -dxz.y);
  float glow = toward * toward * exp(-max(rd.y, 0.0) * 13.0) * mix(1.0, 0.35, dawn);
  glow *= 1.0 - exp(-max(d - 120.0, 0.0) / 700.0);   // only long paths pick up the city's light
  vec3 G = vec3(${GLOW_RGB.map(f).join(', ')});
  vec3 cb = baseCol + G * glow;
  vec3 ch = baseCol * 1.75 + G * glow * 0.55;
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
  lbFogColor: { value: new THREE.Color(0.0105, 0.0115, 0.015) },
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

/** The scene fog object: color = base fog colour, near = time, far = dawn. */
export function createSceneFog(color) {
  const fog = new THREE.Fog(color.clone(), 0, 0);
  return fog;
}

/** CPU version (used to fade far geometry sprites etc.). */
export function fogAmountCPU(d, dawn) {
  const Db = NIGHT.Db + (DAWN.Db - NIGHT.Db) * dawn;
  return 1 - Math.exp(-Db * d);
}
