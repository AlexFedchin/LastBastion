// Jet exhaust: a cold, clean blue flame out of a nozzle, the way a jet's exhaust shows at night
// (no afterburner, no smoke): white-blue at the nozzle, deep blue down its length, gone a few
// metres back. One mesh per engine, carried on the aircraft; drawn additively and soft at its
// edges (brightest where you look through the most of it), with a faint flutter along it.
import * as THREE from 'three';
import { Fn, float, uniform, positionLocal, positionWorld, normalWorld, cameraPosition, clamp, pow, abs, dot, normalize, smoothstep, mix, fract, floor, sin } from 'three/tsl';

// (WebGPU: the WebGL build's GLSL ported to TSL, the same maths. normalWorld is the true normal
// matrix the GLSL built by hand for the squashed flame.)
const h = (x, seed) => fract(sin(x.mul(91.7).add(seed.mul(13.1))).mul(43758.5));
const n1 = (x, seed) => {
  const i = floor(x), f0 = fract(x);
  const f = f0.mul(f0).mul(float(3).sub(f0.mul(2)));
  return mix(h(i, seed), h(i.add(1), seed), f);
};
function flameMaterial(u) {
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false });
  mat.uniforms = u;
  mat.colorNode = Fn(() => {
    const uu = clamp(positionLocal.z.negate().div(u.uLen), 0, 1);
    // soft edges: through the middle of the flame there is more of it to see
    const thick = pow(abs(dot(normalize(normalWorld), normalize(cameraPosition.sub(positionWorld)))), 2.4);
    // fading down its length, with a flutter running back along it
    const fall = pow(float(1).sub(uu), 1.7).mul(smoothstep(0, 0.04, uu.add(0.02)));
    const flut = float(0.82).add(n1(uu.mul(9).sub(u.uTime.mul(38)), u.uSeed).mul(0.18)).add(n1(u.uTime.mul(21), u.uSeed).mul(0.06));
    // the colour: white-hot blue at the nozzle, cooling to deep blue
    const col = mix(u.uBody, u.uCore, pow(float(1).sub(uu), 5));
    return col.mul(fall).mul(thick).mul(flut).mul(u.uK);
  })();
  return mat;
}

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
      const mat = flameMaterial({
        uLen: uniform(L), uK: uniform(0), uTime: uniform(0), uSeed: uniform(seed),
        uCore: uniform(coreCol), uBody: uniform(bodyCol),
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
