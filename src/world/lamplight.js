// The sodium lamps on the wall, as real lights.
//
// Each lamp is a shaded fitting over the field: a soft cone thrown down and a little out from
// the wall, falling off with the square of the distance, so the ground it lands on keeps its
// colour, its normal map, its wet sheen and its slope. Under WebGPU they are ten plain spot
// lights (no shadows): every lit material takes them in its own lighting, the dead included,
// which the WebGL build could only do by patching each material's shader.
import * as THREE from 'three';

export const LAMP_COUNT = 10;

// lumen-ish strength (candela, falling off with the square of the distance) and colour
const LAMP_I = 260;
const LAMP_COL = new THREE.Color(1.0, 0.5, 0.19);

const lights = [];
let power = 1;

/**
 * Where the lamps are (world positions of the glass) and which way each throws its light
 * (unit world vectors). The lights are added to `scene` the first time.
 */
export function setLamps(pos, aim, scene) {
  for (let i = 0; i < LAMP_COUNT; i++) {
    if (!pos[i]) continue;
    let s = lights[i];
    if (!s) {
      // full inside ~39 degrees of its aim, a soft edge out to ~65 (the GLSL cone's smoothstep)
      s = new THREE.SpotLight(LAMP_COL, LAMP_I * power, 26, Math.acos(0.42), 0.4, 2);
      s.name = 'wall-lamp';
      lights[i] = s;
      if (scene) scene.add(s, s.target);
    }
    s.position.copy(pos[i]);
    s.target.position.copy(pos[i]).addScaledVector(aim[i] ? aim[i].clone().normalize() : new THREE.Vector3(0, -1, 0), 10);
    s.target.updateMatrixWorld();
  }
}

/** Brightness of every lamp (0 = blackout or daylight). */
export function setLampPower(k) {
  if (k === power) return;
  power = k;
  for (const s of lights) if (s) { s.intensity = LAMP_I * k; s.visible = k > 0.001; }
}

/** Kept for the callers: the lamps light every material by themselves now. */
export function lampLit(mat) { return mat; }

/** Stand-in for the old uniform block (some callers still read it). */
export const LAMP_UNIFORMS = { uLbLampPow: { get value() { return power; } } };
