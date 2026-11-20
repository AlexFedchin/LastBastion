// Cinematic post-processing (WebGPU / TSL): HDR → bloom → one final pass that does heat
// haze and blast shockwaves (screen-space refraction), lens ghosts and halo, anamorphic
// streaks, a dirty lens catching bright light, slight barrel distortion, chromatic
// aberration, ACES tone mapping, split-toning, vignette, film grain, damage tint, impact
// radial blur and letterboxing.
//
// The uniforms keep the WebGL build's names and live in `post.u` (each has a `.value`),
// so the game drives them exactly as before. All screen maths runs in GL-style UVs (y up),
// the way the heat and shock positions are computed; texture reads flip to WebGPU's y-down.
import * as THREE from 'three';
import {
  Fn, If, Loop, Break, float, int, vec2, vec3, vec4, uniform, uniformArray, texture, pass, screenUV,
  mix, smoothstep, clamp, max, min, abs, exp, pow, length, dot, normalize, fract, floor, sin, select,
} from 'three/tsl';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { makeLensDirtTexture } from '../world/textures2.js';
import { volumetricPass } from './volumetric.js';

const MAX_HEAT = 12, MAX_SHOCK = 4;

const hash = Fn(([p]) => {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar();
  p3.addAssign(dot(p3, p3.yzx.add(33.33)));
  return fract(p3.x.add(p3.y).mul(p3.z));
}).setLayout({ name: 'lbPostHash', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

const vnoise = Fn(([p]) => {
  const i = floor(p), f = fract(p);
  const u = f.mul(f).mul(f.mul(-2).add(3));
  return mix(mix(hash(i), hash(i.add(vec2(1, 0))), u.x), mix(hash(i.add(vec2(0, 1))), hash(i.add(vec2(1, 1))), u.x), u.y);
}).setLayout({ name: 'lbPostNoise', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

const aces = (x) => clamp(x.mul(x.mul(2.51).add(0.03)).div(x.mul(x.mul(2.43).add(0.59)).add(0.14)), 0, 1);

export class Post {
  constructor(renderer, scene, camera, quality) {
    this.renderer = renderer;
    this.quality = quality;
    this.camera = camera;
    const u = this.u = {
      uRes: uniform(new THREE.Vector2(1, 1)),
      uTime: uniform(0),
      uExposure: uniform(1.6),
      uGrain: uniform(0.045),
      uVignette: uniform(0.75),
      uCA: uniform(0.003),
      uDamage: uniform(0),
      uFlash: uniform(0),
      uLetterbox: uniform(0),
      uDesat: uniform(0.28),
      uRadial: uniform(0),
      uFade: uniform(1),
      uWarm: uniform(0),
      uCurve: uniform(0.35),
      uTint: uniform(1),
      uFlare: uniform(0.035),
      uStreak: uniform(0.025),
      uDirt: uniform(0.07),
      uBarrel: uniform(0.025),
      uHeat: uniformArray(Array.from({ length: MAX_HEAT }, () => new THREE.Vector4()), 'vec4'),
      uHeatN: uniform(0, 'int'),
      uShock: uniformArray(Array.from({ length: MAX_SHOCK }, () => new THREE.Vector4()), 'vec4'),
      uShockN: uniform(0, 'int'),
    };
    // the arrays: the game writes .value[k] (Vector4s) like the GLSL uniform arrays
    // (the arrays' Vector4s are in .array; .value becomes the GPU buffer once built)

    // the scene, multisampled HDR; clamped before bloom (stacked fires glow, they don't white
    // out the frame) and scrubbed of NaN/Inf (bloom would smear one bad pixel over the frame)
    this.scenePass = pass(scene, camera, { samples: quality.msaa || 0 });
    const sceneTex = this.scenePass.getTextureNode('output');
    const clampHDR = (c) => {
      const v = clamp(c.rgb, 0, 65000).toVar();
      const m = max(v.r, max(v.g, v.b));
      return select(m.greaterThan(3), v.mul(float(3).div(m)), v);
    };
    // the volumetric searchlights (volumetric.js) are added to the scene before anything else
    this.vol = volumetricPass(scene, camera, this.scenePass, quality);
    const hdr = Fn(([uvS]) => {
      const c = clampHDR(sceneTex.sample(uvS));
      if (!this.vol) return c;
      // the lit air, compressed at the top (a beam swinging across the lens glows, it doesn't
      // white out the frame): dim beams stay linear, the core rolls off
      const v = this.vol.sample(uvS).rgb;
      return c.add(v.div(dot(v, vec3(0.3, 0.5, 0.2)).mul(0.8).add(1)));
    });
    const bloomIn = Fn(() => vec4(hdr(screenUV), 1))();
    this.bloom = bloom(bloomIn, 0.42, 0.22, 1.0);
    // (UnrealBloomPass was sized to bloomScale of the buffer and started its mips at half that)
    this.bloom.setResolutionScale(quality.bloomScale * 0.5);
    const B = this.bloom;
    const tB0 = B._textureNodeBlur0, tB2 = B._textureNodeBlur2, tB3 = B._textureNodeBlur3;
    const tBloom = B._textureOutput;
    const dirtTex = texture(makeLensDirtTexture(512));

    const flipY = (p) => vec2(p.x, float(1).sub(p.y));

    const refractUv = Fn(([uv]) => {
      const aspect = u.uRes.x.div(u.uRes.y);
      const o = vec2(0).toVar();
      Loop(MAX_HEAT, ({ i }) => {
        If(int(i).greaterThanEqual(u.uHeatN), () => { Break(); });
        const h = u.uHeat.element(i);
        const d = uv.sub(h.xy).mul(vec2(aspect, 1)).toVar();
        d.y.subAssign(h.z.mul(0.8));
        const e = d.div(vec2(h.z.mul(0.75), h.z.mul(1.5)));
        const f = exp(dot(e, e).negate());
        const q = uv.mul(vec2(70, 28)).add(vec2(0, u.uTime.mul(-3.2))).add(float(i).mul(7));
        o.addAssign(vec2(vnoise(q), vnoise(q.add(17.3))).sub(0.5).mul(f).mul(h.w).mul(f.greaterThan(0.01).select(1, 0)));
      });
      Loop(MAX_SHOCK, ({ i }) => {
        If(int(i).greaterThanEqual(u.uShockN), () => { Break(); });
        const s = u.uShock.element(i);
        const d = uv.sub(s.xy).mul(vec2(aspect, 1));
        const r = length(d).add(1e-4);
        const w = s.z.mul(0.22).add(0.004);
        const band = exp(pow(r.sub(s.z).div(w), 2).negate());
        o.subAssign(d.div(r).mul(band).mul(s.w).div(vec2(aspect, 1)));
      });
      return uv.add(o);
    });

    const final = Fn(() => {
      const uv0 = flipY(screenUV);
      const c0 = uv0.sub(0.5);
      // gentle barrel distortion from the lens
      let uv = c0.mul(float(1).sub(u.uBarrel.mul(0.5)).add(u.uBarrel.mul(dot(c0, c0)).mul(2))).add(0.5);
      uv = refractUv(uv).toVar();
      const c = uv.sub(0.5);
      const r2 = dot(c, c);
      const off = c.mul(r2.mul(2).add(0.15)).mul(u.uCA);
      const col = vec3(
        hdr(flipY(uv.add(off))).r,
        hdr(flipY(uv)).g,
        hdr(flipY(uv.sub(off))).b,
      ).toVar();
      If(u.uRadial.greaterThan(0.001), () => {
        const acc = col.toVar();
        Loop({ start: 1, end: 10 }, ({ i }) => {
          const k = float(i).div(10);
          acc.addAssign(hdr(flipY(c.mul(float(1).sub(u.uRadial.mul(0.09).mul(k))).add(0.5))));
        });
        col.assign(mix(col, acc.div(10), clamp(u.uRadial, 0, 1)));
      });

      // ── lens: ghosts & halo mirrored through the centre ──
      const tc = float(1).sub(uv0);
      const gv = vec2(0.5).sub(tc).mul(0.46);
      const ghosts = vec3(0).toVar();
      Loop({ start: 1, end: 5 }, ({ i }) => {
        const fi = float(i);
        const o = tc.add(gv.mul(fi));
        const w = pow(max(0, float(1).sub(length(vec2(0.5).sub(o)).div(0.70711))), 6);
        const s = vec3(tB2.sample(flipY(o.add(gv.mul(0.035)))).r, tB2.sample(flipY(o)).g, tB2.sample(flipY(o.sub(gv.mul(0.035)))).b);
        const tint = mix(vec3(1, 0.55, 0.25), vec3(0.35, 0.6, 1), fract(fi.mul(0.37).add(0.2)));
        ghosts.addAssign(s.mul(w).mul(tint));
      });
      const hv = normalize(gv.add(1e-5)).mul(0.42);
      const ho = tc.add(hv);
      const hw = pow(max(0, float(1).sub(length(vec2(0.5).sub(ho)).div(0.70711))), 5);
      const ring = smoothstep(0.3, 0.42, length(uv0.sub(0.5).mul(vec2(u.uRes.x.div(u.uRes.y), 1))));
      ghosts.addAssign(tB3.sample(flipY(ho)).rgb.mul(hw).mul(vec3(0.55, 0.7, 1)).mul(ring));
      // ── anamorphic streak ──
      const streak = vec3(0).toVar();
      Loop({ start: -8, end: 8, condition: '<=' }, ({ i }) => {
        const fi = float(i);
        streak.addAssign(tB0.sample(flipY(uv.add(vec2(fi.mul(0.021), 0)))).rgb.mul(exp(abs(fi).mul(-0.32))));
      });
      streak.mulAssign(vec3(0.45, 0.65, 1.25).mul(0.16));
      // ── dirty lens lit by everything bright ──
      const glare = min(tB3.sample(flipY(uv)).rgb.add(tB2.sample(flipY(uv)).rgb.mul(0.6)), vec3(1.5));
      const gh = min(ghosts, vec3(1.5));
      const st = min(streak, vec3(2));
      const dirt = dirtTex.sample(uv0).r;
      // bloom itself (UnrealBloomPass added it to the frame before this pass)
      col.addAssign(tBloom.sample(flipY(uv)).rgb);
      col.addAssign(gh.mul(u.uFlare).add(st.mul(u.uStreak).mul(8)).add(glare.add(gh).mul(dirt).mul(u.uDirt)));

      col.mulAssign(u.uExposure);
      col.addAssign(vec3(1, 0.92, 0.82).mul(u.uFlash));
      col.assign(aces(col));

      // grade: cold shadows, warm highlights, drained colour
      const l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      const shadowTint = vec3(0.84, 0.97, 1.1), highTint = vec3(1.1, 0.98, 0.84);
      col.mulAssign(mix(vec3(1), mix(shadowTint, highTint, smoothstep(0.03, 0.5, l)), u.uTint));
      col.assign(mix(vec3(l), col, clamp(float(1).sub(u.uDesat), 0, 1.2)));
      col.mulAssign(mix(vec3(1), vec3(1.06, 0.98, 0.9), u.uWarm));
      col.assign(clamp(col, 0, 1));
      col.assign(mix(col, col.mul(col).mul(col.mul(-2).add(3)), u.uCurve));

      // vignette (+ a touch of optical falloff at the very corners)
      const vig = smoothstep(0.95, 0.22, length(c0.mul(vec2(1, 0.82))));
      col.mulAssign(mix(1, vig, u.uVignette));

      // damage / breach: blood creeping in from the edges
      const edge = smoothstep(0.18, 0.72, length(c0.mul(vec2(0.9, 1))));
      col.assign(mix(col, vec3(0.28, 0, 0).mul(l.mul(0.4).add(0.6)), edge.mul(clamp(u.uDamage, 0, 1)).mul(0.9)));

      col.assign(pow(max(col, 0), vec3(1 / 2.2)));
      const g = hash(uv0.mul(u.uRes).add(fract(u.uTime.mul(7.13)).mul(917))).sub(0.5);
      col.addAssign(g.mul(u.uGrain).mul(float(1.15).sub(l)));
      col.addAssign(hash(uv0.mul(u.uRes).mul(1.37)).sub(0.5).div(255));
      col.mulAssign(u.uFade);

      // cinematic bars crop to 2.39:1 — on an ultrawide there is almost nothing to crop
      const lb = u.uLetterbox.mul(max(0, float(1).sub(u.uRes.x.div(u.uRes.y).div(2.39)).mul(0.5)));
      const bar = uv0.y.lessThan(lb).or(uv0.y.greaterThan(float(1).sub(lb)));
      return vec4(select(bar, vec3(0), col), 1);
    });

    this.pipeline = new THREE.RenderPipeline(renderer);
    this.pipeline.outputColorTransform = false; // the final pass tone-maps and gamma-encodes itself
    this.pipeline.outputNode = final();
    this._heat = [];
  }

  setSize(w, h) {
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.u.uRes.value.set(s.x, s.y);
  }

  /** Project fires (heat haze) and fresh blasts (shockwaves) to screen space. */
  updateDistortion(heat, shocks) {
    const cam = this.camera;
    const tanH = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const list = this._heat;
    list.length = 0;
    for (let i = 0; i < heat.length; i += 5) {
      _v.set(heat[i], heat[i + 1], heat[i + 2]);
      const dist = _v.distanceTo(cam.position);
      if (dist > 140) continue;
      _v.project(cam);
      if (_v.z > 1 || Math.abs(_v.x) > 1.3 || Math.abs(_v.y) > 1.3) continue;
      const r = heat[i + 3] / (dist * tanH * 2);
      const str = Math.min(0.008, 0.0024 * heat[i + 4] / 3 * (1 - dist / 140));
      list.push([_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5, Math.min(0.25, r), str, dist]);
    }
    list.sort((a, b) => a[4] - b[4]);
    const H = this.u.uHeat.array;
    const n = Math.min(MAX_HEAT, list.length);
    for (let k = 0; k < n; k++) H[k].set(list[k][0], list[k][1], list[k][2], list[k][3]);
    this.u.uHeatN.value = n;
    const S = this.u.uShock.array;
    let m = 0;
    for (let k = shocks.length - 1; k >= 0 && m < MAX_SHOCK; k--) {
      const s = shocks[k];
      _v.set(s.x, s.y, s.z);
      const dist = Math.max(4, _v.distanceTo(cam.position));
      _v.project(cam);
      if (_v.z > 1) continue;
      const rWorld = 6 + s.t * 70 * Math.min(1.6, s.s);
      const r = rWorld / (dist * tanH * 2);
      const str = 0.012 * (1 - s.t / 0.6) * Math.min(1.5, s.s) * Math.min(1, 60 / dist);
      S[m++].set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5, r, str);
    }
    this.u.uShockN.value = m;
  }

  render(dt, time) {
    this.u.uTime.value = time;
    if (this.vol) this.vol.update(time);
    this.pipeline.render();
  }
}

const _v = new THREE.Vector3();
