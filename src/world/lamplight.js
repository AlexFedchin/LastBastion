// The sodium lamps on the wall, as real lights in a material's own lighting.
//
// Each lamp is a shaded fitting over the field: a soft cone thrown down and a little out from
// the wall, falling off with the square of the distance. It goes through three.js' own direct-
// light BRDF (RE_Direct), so the ground it lands on keeps its colour, its normal map, its wet
// sheen and its slope. That is what an additive glow decal could not do: it washed the same
// flat gradient over mud, puddles and craters alike.
//
// Ten lights in a fixed loop (never real three.js lights, so nothing else recompiles and the
// light count stays the same when the power goes out). Patched materials share LAMP_UNIFORMS.
import * as THREE from 'three';

export const LAMP_COUNT = 10;

export const LAMP_UNIFORMS = {
  uLbLampP: { value: Array.from({ length: LAMP_COUNT }, () => new THREE.Vector3(0, -1000, 0)) },
  uLbLampD: { value: Array.from({ length: LAMP_COUNT }, () => new THREE.Vector3(0, -1, 0)) },
  uLbLampPow: { value: 1 },
};

// lumen-ish strength (linear radiance scale) and colour of a lamp
const LAMP_I = 260.0;
const LAMP_COL = 'vec3(1.0, 0.5, 0.19)';

/**
 * Where the lamps are (world positions of the glass) and which way each throws its light
 * (unit world vectors). Missing entries stay parked far below the world.
 */
export function setLamps(pos, aim) {
  const P = LAMP_UNIFORMS.uLbLampP.value, D = LAMP_UNIFORMS.uLbLampD.value;
  for (let i = 0; i < LAMP_COUNT; i++) {
    if (pos[i]) P[i].copy(pos[i]); else P[i].set(0, -1000, 0);
    if (aim[i]) D[i].copy(aim[i]).normalize(); else D[i].set(0, -1, 0);
  }
}

/** Brightness of every lamp (0 = blackout or daylight). */
export function setLampPower(k) { LAMP_UNIFORMS.uLbLampPow.value = k; }

const GLSL = /* glsl */`
#if defined( STANDARD )
if (uLbLampPow > 0.001) {
  for (int k = 0; k < ${LAMP_COUNT}; k++) {
    vec3 lp = (viewMatrix * vec4(uLbLampP[k], 1.0)).xyz;
    vec3 L = lp - geometryPosition;
    float d2 = dot(L, L);
    float d = sqrt(d2);
    if (d > 26.0) continue;
    IncidentLight lbL;
    lbL.direction = L / d;
    lbL.visible = true;
    // the shade: full inside ~40 degrees of its aim, a soft edge out to ~65, a faint spill beyond
    vec3 aim = normalize((viewMatrix * vec4(uLbLampD[k], 0.0)).xyz);
    float c = dot(-lbL.direction, aim);
    float cone = 0.04 + 0.96 * smoothstep(0.42, 0.78, c);
    // a smooth window to zero at the cut-off (no ring where the loop skips it)
    float w = clamp(1.0 - pow(d / 26.0, 4.0), 0.0, 1.0);
    lbL.color = ${LAMP_COL} * (${LAMP_I.toFixed(1)} * uLbLampPow * cone * w * w / (d2 + 1.5));
    RE_Direct( lbL, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
  }
}
#endif
`;

/** Light a MeshStandardMaterial by the wall lamps (keeps any onBeforeCompile it already has). */
export function lampLit(mat) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(mat, sh, r);
    Object.assign(sh.uniforms, LAMP_UNIFORMS);
    sh.fragmentShader = `uniform vec3 uLbLampP[${LAMP_COUNT}];\nuniform vec3 uLbLampD[${LAMP_COUNT}];\nuniform float uLbLampPow;\n`
      + sh.fragmentShader.replace('#include <lights_fragment_begin>', '#include <lights_fragment_begin>\n' + GLSL);
  };
  const key = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => '';
  mat.customProgramCacheKey = () => key() + '|lbLamps';
  mat.needsUpdate = true;
  return mat;
}
