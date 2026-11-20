// Atmosphere: one fog model for every material in the game (WebGPU / TSL).
//
// A physically-flavoured model: thin exponential haze, a dense height-fog layer that hugs
// the ground (patchy, drifting mist), and in-scattered light from the burning city that
// matches the sky shader's horizon glow exactly, so far hills melt into the glow instead of
// ending at a fog wall.
//
// Every node material gets it through scene.fogNode (installSceneFog). Materials that need
// it thinner (the far city) or that add light instead of covering (glow sprites) set their
// own with fogMaterial(); custom node shaders call lbFog() directly.
import * as THREE from 'three';
import { Fn, float, vec2, vec3, vec4, uniform, renderGroup, positionWorld, cameraPosition, mix, smoothstep, exp, max, abs, length, normalize, fract, floor, dot, select } from 'three/tsl';

// colour of the city glow (shared with the sky shader)
export const GLOW_RGB = [0.2, 0.05, 0.012];
const NIGHT = { Db: 0.00155, D0: 0.0085, b: 0.15 };
const DAWN = { Db: 0.0027, D0: 0.016, b: 0.085 };

/** The fog's live inputs (environment.js drives them every frame). */
// (in the shared render group, refreshed once a render for everything: in the default per-object
// group a material with no node of its own, which takes the fog through setupFog, is never
// refreshed once drawn, so the far ranges and plain models kept the night's black fog at dawn,
// dark shapes behind a field fogged pale)
export const fogUniforms = {
  lbFogColor: uniform(new THREE.Color(0.0055, 0.006, 0.0085)).setGroup(renderGroup),
  lbTime: uniform(0).setGroup(renderGroup),
  lbDawn: uniform(0).setGroup(renderGroup), // 0 night .. 1 dawn; above 2 it carries a fog bank: 2 + bank strength (night only)
};

const lbHash = Fn(([p]) => {
  const q = fract(p.mul(vec2(233.34, 851.73))).toVar();
  q.addAssign(dot(q, q.add(23.45)));
  return fract(q.x.mul(q.y));
}).setLayout({ name: 'lbHash', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

export const lbNoise = Fn(([p]) => {
  const i = floor(p), q = fract(p);
  const u = q.mul(q).mul(q.mul(-2).add(3));
  return mix(mix(lbHash(i), lbHash(i.add(vec2(1, 0))), u.x), mix(lbHash(i.add(vec2(0, 1))), lbHash(i.add(vec2(1, 1))), u.x), u.y);
}).setLayout({ name: 'lbNoise', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

/** rgb = in-scattered colour, a = fog amount, for a point wp seen from cam. */
export const lbFog = Fn(([wp, cam, baseCol, t, dawnIn, scale]) => {
  // a fog bank rides on the dawn channel: values above 2 are 2 + bank strength (night only)
  const bank = max(0, dawnIn.sub(2));
  const dawn = select(dawnIn.greaterThan(1.5), float(0), dawnIn);
  const rv = wp.sub(cam);
  const d = length(rv);
  const rd = rv.div(max(d, 1e-4));
  const Db = mix(NIGHT.Db, DAWN.Db, dawn);
  const D0 = mix(NIGHT.D0, DAWN.D0, dawn).toVar();
  const b = mix(NIGHT.b, DAWN.b, dawn).toVar();
  // a real bank lies out in the valley: the wall base and the first stretch of field stay
  // clear, it thickens over the next tens of metres, and the far field is gone
  const bankPath = max(d.sub(30), 0);
  const bankFrac = bankPath.div(max(d, 1e-4));
  const bankTau = bank.mul(0.0016 * 26).mul(bankPath).mul(smoothstep(30, 90, d).mul(0.4).add(0.6));
  D0.mulAssign(bank.mul(6).mul(bankFrac).add(1));
  b.assign(mix(b, 0.05, bank.mul(bankFrac)));
  // drifting, patchy ground mist
  const m0 = lbNoise(wp.xz.mul(0.012).add(t.mul(vec2(0.010, 0.0035)))).mul(0.62).add(lbNoise(wp.xz.mul(0.041).sub(t.mul(vec2(0.004, 0.016)))).mul(0.38));
  const m = m0.mul(m0).mul(1.65).add(0.22);
  const k = b.mul(rd.y).mul(d);
  const hi = select(abs(k).lessThan(1e-3), d, float(1).sub(exp(k.negate())).div(b.mul(rd.y)));
  const th = D0.mul(exp(b.negate().mul(cam.y))).mul(hi).mul(m);
  const tb = Db.mul(d).add(bankTau);
  const dxz = normalize(rd.xz.add(1e-5));
  const toward = max(0, dxz.y.negate());
  const glow = toward.mul(toward).mul(exp(max(rd.y, 0).mul(-13))).mul(mix(0.5, 0.35, dawn))
    .mul(float(1).sub(exp(max(d.sub(120), 0).div(-700))))    // only long paths pick up the city's light
    .mul(float(1).sub(bank.mul(0.75)));                        // a dense bank swallows most of it
  const G = vec3(...GLOW_RGB);
  const cb = baseCol.add(G.mul(glow));
  // inside a bank everything is one milky colour: the haze/mist tint split (weighted by
  // mist noise at the far end of the ray) would otherwise draw fogged-out skylines
  const ch = mix(baseCol.mul(1.75).add(G.mul(glow).mul(0.55)), cb, bank);
  const tau = tb.add(th).mul(scale);
  const col = cb.mul(tb).add(ch.mul(th)).div(max(tb.add(th), 1e-6));
  return vec4(col, float(1).sub(exp(tau.negate())));
}).setLayout({
  name: 'lbFog', type: 'vec4', inputs: [
    { name: 'wp', type: 'vec3' }, { name: 'cam', type: 'vec3' }, { name: 'baseCol', type: 'vec3' },
    { name: 't', type: 'float' }, { name: 'dawnIn', type: 'float' }, { name: 'scale', type: 'float' },
  ],
});

/** The fog at this fragment, with the shared uniforms. */
export const fogHere = (scale = 1, wp = positionWorld) => lbFog(wp, cameraPosition, fogUniforms.lbFogColor, fogUniforms.lbTime, fogUniforms.lbDawn, float(scale));

/** Apply the fog to a colour: covering (mix) or, for additive light, dimming it. */
export function applyFog(rgb, { scale = 1, add = false, wp = positionWorld } = {}) {
  const f = fogHere(scale, wp);
  return add ? rgb.mul(float(1).sub(f.a)) : mix(rgb, f.rgb, f.a);
}

/**
 * Fog a material its own way: thinner (scale < 1) or additive (light dimmed by the fog
 * instead of covered by it). With no options it is the scene's default.
 */
export function fogMaterial(mat, { scale = 1, add = false } = {}) {
  mat.fog = true;
  mat.setupFog = function (builder, outputNode) {
    return vec4(applyFog(outputNode.rgb, { scale, add }), outputNode.a);
  };
  // three keys a compiled shader on the material's properties and nodes, not on an overridden
  // setupFog: without this a thinned or additive fog shared its shader with any plain material of
  // the same settings, and whichever was built first won (at dawn the far ranges lost their haze
  // and stood dark behind a field fogged white)
  const base = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => base() + `|lbfog:${scale}:${add ? 'a' : 'm'}`;
  return mat;
}

/** The default fog for every NodeMaterial (patched once on the prototype). */
let patched = false;
export function patchFogChunks() {
  if (patched) return;
  patched = true;
  const threeFog = THREE.NodeMaterial.prototype.setupFog;
  THREE.NodeMaterial.prototype.setupFog = function (builder, outputNode) {
    // the valley's fog (createSceneFog); any other scene (the hangar) keeps three's own
    const f = builder.scene && builder.scene.fog;
    if (!f || !f.lbFog) return threeFog.call(this, builder, outputNode);
    return vec4(applyFog(outputNode.rgb), outputNode.a);
  };
}

/** No-op under WebGPU: there is no GLSL light loop to patch. */
export function patchLightChunks() {}

/** The scene fog object: color = base fog colour, near = time, far = dawn (read by environment.js). */
export function createSceneFog(color) {
  const fog = new THREE.Fog(color.clone(), 0, 0);
  fog.lbFog = true;
  return fog;
}
