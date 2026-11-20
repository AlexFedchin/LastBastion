// Jet exhaust: a cold, clean blue flame out of a nozzle, the way a jet's exhaust shows at night
// (no afterburner, no smoke): white-blue at the nozzle, deep blue down its length, gone a few
// metres back. One mesh per engine, carried on the aircraft; drawn additively and soft at its
// edges (brightest where you look through the most of it), with a faint flutter along it.
import * as THREE from 'three';

const VERT = /* glsl */`
  uniform float uLen;
  varying float vU;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vU = clamp(-position.z / uLen, 0.0, 1.0);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vN = normalize(transpose(inverse(mat3(modelMatrix))) * normal); // (the flame is squashed: a true normal matrix)
    vV = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const FRAG = /* glsl */`
  uniform float uK;
  uniform float uTime;
  uniform float uSeed;
  uniform vec3 uCore;
  uniform vec3 uBody;
  varying float vU;
  varying vec3 vN;
  varying vec3 vV;
  float h(float x) { return fract(sin(x * 91.7 + uSeed * 13.1) * 43758.5); }
  float n1(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h(i), h(i + 1.0), f); }
  void main() {
    float u = vU;
    // soft edges: through the middle of the flame there is more of it to see
    float thick = pow(abs(dot(normalize(vN), normalize(vV))), 2.4);
    // fading down its length, with a flutter running back along it
    float fall = pow(1.0 - u, 1.7) * smoothstep(0.0, 0.04, u + 0.02);
    float flut = 0.82 + 0.18 * n1(u * 9.0 - uTime * 38.0) + 0.06 * n1(uTime * 21.0);
    // the colour: white-hot blue at the nozzle, cooling to deep blue
    vec3 col = mix(uBody, uCore, pow(1.0 - u, 5.0));
    gl_FragColor = vec4(col * fall * thick * flut * uK, 1.0);
  }
`;

/**
 * Exhaust flames for an aircraft's engines.
 * @param engines  nozzle points in the model's frame
 * @param opts.len    flame length (model units), pointing down -z (aft, for a nose-+z model)
 * @param opts.r      nozzle radius; opts.flat squashes it top to bottom (a slot nozzle)
 * @param opts.core   the inner, hotter flame's length as a fraction of the outer one
 */
export class Exhaust {
  constructor(group, engines, { len = 6, r = 0.45, flat = 0.5, wide = 1.2, core = 0.38 } = {}) {
    this.group = group;
    this.flames = [];
    const mk = (L, r0, r1, coreCol, bodyCol, k, seed) => {
      const geo = new THREE.CylinderGeometry(r1, r0, L, 20, 8, true).rotateX(-Math.PI / 2).translate(0, 0, -L / 2);
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uLen: { value: L }, uK: { value: 0 }, uTime: { value: 0 }, uSeed: { value: seed },
          uCore: { value: coreCol }, uBody: { value: bodyCol },
        },
        vertexShader: VERT, fragmentShader: FRAG,
        transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
      });
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = 6;
      m.frustumCulled = false;
      m.userData.k = k;
      return m;
    };
    engines.forEach((p, i) => {
      // the outer flame: long and blue; the core: short, nearly white
      const outer = mk(len, r, r * 0.3, new THREE.Color(0.9, 1.5, 3.2), new THREE.Color(0.05, 0.22, 1.25), 1, i * 1.7);
      const inner = mk(len * core, r * 0.62, r * 0.12, new THREE.Color(2.6, 3.2, 4.2), new THREE.Color(0.35, 0.8, 2.6), 1.3, i * 1.7 + 5);
      for (const m of [outer, inner]) {
        m.position.copy(p);
        m.scale.set(wide, flat, 1);
        group.add(m);
        this.flames.push(m);
      }
    });
  }

  /** Burn at k (0 off, 1 full), time t for the flutter. */
  update(t, k = 1) {
    for (const m of this.flames) {
      const u = m.material.uniforms;
      u.uK.value = k * m.userData.k;
      u.uTime.value = t;
      m.visible = k > 0.001;
    }
  }
}
