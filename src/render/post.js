// Cinematic post-processing: HDR → bloom → one final pass that does heat
// haze and blast shockwaves (screen-space refraction), lens ghosts and halo,
// anamorphic streaks, a dirty lens catching bright light, slight barrel
// distortion, chromatic aberration, ACES tone mapping, split-toning,
// vignette, film grain, damage tint, impact radial blur and letterboxing.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { makeLensDirtTexture } from '../world/textures2.js';

const MAX_HEAT = 12, MAX_SHOCK = 4;

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    tB0: { value: null }, tB2: { value: null }, tB3: { value: null },
    tDirt: { value: null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uExposure: { value: 1.6 },
    uGrain: { value: 0.045 },
    uVignette: { value: 0.75 },
    uCA: { value: 0.012 },
    uDamage: { value: 0 },
    uFlash: { value: 0 },
    uLetterbox: { value: 0 },
    uDesat: { value: 0.28 },
    uRadial: { value: 0 },
    uFade: { value: 1 },
    uWarm: { value: 0 },
    uFlare: { value: 0.1 },
    uStreak: { value: 0.09 },
    uDirt: { value: 0.22 },
    uBarrel: { value: 0.025 },
    uHeat: { value: Array.from({ length: MAX_HEAT }, () => new THREE.Vector4()) },
    uHeatN: { value: 0 },
    uShock: { value: Array.from({ length: MAX_SHOCK }, () => new THREE.Vector4()) },
    uShockN: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse, tB0, tB2, tB3, tDirt;
    uniform vec2 uRes;
    uniform float uTime, uExposure, uGrain, uVignette, uCA, uDamage, uFlash, uLetterbox, uDesat, uRadial, uFade, uWarm;
    uniform float uFlare, uStreak, uDirt, uBarrel;
    uniform vec4 uHeat[${MAX_HEAT}];
    uniform int uHeatN;
    uniform vec4 uShock[${MAX_SHOCK}];
    uniform int uShockN;
    varying vec2 vUv;

    vec3 aces(vec3 x){
      const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
      return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
    }
    float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y); }

    vec2 refractUv(vec2 uv){
      float aspect = uRes.x / uRes.y;
      vec2 o = vec2(0.0);
      for (int i = 0; i < ${MAX_HEAT}; i++){
        if (i >= uHeatN) break;
        vec4 h = uHeat[i];
        vec2 d = (uv - h.xy) * vec2(aspect, 1.0);
        d.y -= h.z * 0.8;
        vec2 e = d / vec2(h.z * 0.75, h.z * 1.5);
        float f = exp(-dot(e, e));
        if (f < 0.01) continue;
        vec2 q = uv * vec2(70.0, 28.0) + vec2(0.0, -uTime * 3.2) + float(i) * 7.0;
        o += (vec2(vnoise(q), vnoise(q + 17.3)) - 0.5) * f * h.w;
      }
      for (int i = 0; i < ${MAX_SHOCK}; i++){
        if (i >= uShockN) break;
        vec4 s = uShock[i];
        vec2 d = (uv - s.xy) * vec2(aspect, 1.0);
        float r = length(d) + 1e-4;
        float w = s.z * 0.22 + 0.004;
        float band = exp(-pow((r - s.z) / w, 2.0));
        o -= d / r * band * s.w / vec2(aspect, 1.0);
      }
      return uv + o;
    }

    void main(){
      vec2 uv0 = vUv;
      vec2 c0 = uv0 - 0.5;
      // gentle barrel distortion from the lens
      vec2 uv = 0.5 + c0 * (1.0 - uBarrel * 0.5 + uBarrel * dot(c0, c0) * 2.0);
      uv = refractUv(uv);
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);
      vec2 off = c * (r2 * 2.0 + 0.15) * uCA;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + off).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - off).b;
      if (uRadial > 0.001) {
        vec3 acc = col;
        for (int i = 1; i < 10; i++) {
          float k = float(i) / 10.0;
          acc += texture2D(tDiffuse, 0.5 + c * (1.0 - uRadial * 0.09 * k)).rgb;
        }
        col = mix(col, acc / 10.0, clamp(uRadial, 0.0, 1.0));
      }

      // ── lens: ghosts & halo mirrored through the centre ──
      vec2 tc = 1.0 - uv0;
      vec2 gv = (0.5 - tc) * 0.46;
      vec3 ghosts = vec3(0.0);
      for (int i = 1; i < 5; i++){
        vec2 o = tc + gv * float(i);
        float w = pow(max(0.0, 1.0 - length(0.5 - o) / 0.70711), 6.0);
        vec3 s;
        s.r = texture2D(tB2, o + gv * 0.035).r;
        s.g = texture2D(tB2, o).g;
        s.b = texture2D(tB2, o - gv * 0.035).b;
        vec3 tint = mix(vec3(1.0, 0.55, 0.25), vec3(0.35, 0.6, 1.0), fract(float(i) * 0.37 + 0.2));
        ghosts += s * w * tint;
      }
      vec2 hv = normalize(gv + 1e-5) * 0.42;
      vec2 ho = tc + hv;
      float hw = pow(max(0.0, 1.0 - length(0.5 - ho) / 0.70711), 5.0);
      float ring = smoothstep(0.3, 0.42, length((uv0 - 0.5) * vec2(uRes.x / uRes.y, 1.0)));
      ghosts += texture2D(tB3, ho).rgb * hw * vec3(0.55, 0.7, 1.0) * ring;
      // ── anamorphic streak ──
      vec3 streak = vec3(0.0);
      for (int i = -8; i <= 8; i++){
        float fi = float(i);
        streak += texture2D(tB0, uv + vec2(fi * 0.021, 0.0)).rgb * exp(-abs(fi) * 0.32);
      }
      streak *= vec3(0.45, 0.65, 1.25) * 0.16;
      // ── dirty lens lit by everything bright ──
      vec3 glare = min(texture2D(tB3, uv).rgb + texture2D(tB2, uv).rgb * 0.6, vec3(1.5));
      ghosts = min(ghosts, vec3(1.5));
      streak = min(streak, vec3(2.0));
      float dirt = texture2D(tDirt, uv0).r;
      col += ghosts * uFlare + streak * uStreak * 8.0 + (glare + ghosts) * dirt * uDirt;

      col *= uExposure;
      col += uFlash * vec3(1.0, 0.92, 0.82);
      col = aces(col);

      // grade: cold shadows, warm highlights, drained colour
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      vec3 shadowTint = vec3(0.84, 0.97, 1.1);
      vec3 highTint = vec3(1.1, 0.98, 0.84);
      col *= mix(shadowTint, highTint, smoothstep(0.03, 0.5, l));
      col = mix(vec3(l), col, clamp(1.0 - uDesat, 0.0, 1.2));
      col *= mix(vec3(1.0), vec3(1.06, 0.98, 0.9), uWarm);
      col = clamp(col, 0.0, 1.0);
      col = mix(col, col * col * (3.0 - 2.0 * col), 0.35);

      // vignette (+ a touch of optical falloff at the very corners)
      float vig = smoothstep(0.95, 0.22, length(c0 * vec2(1.0, 0.82)));
      col *= mix(1.0, vig, uVignette);

      // damage / breach: blood creeping in from the edges
      float edge = smoothstep(0.18, 0.72, length(c0 * vec2(0.9, 1.0)));
      col = mix(col, vec3(0.28, 0.0, 0.0) * (0.6 + 0.4 * l), edge * clamp(uDamage, 0.0, 1.0) * 0.9);

      col = pow(col, vec3(1.0 / 2.2));
      float g = hash(uv0 * uRes + fract(uTime * 7.13) * 917.0) - 0.5;
      col += g * uGrain * (1.15 - l);
      col += (hash(uv0 * uRes * 1.37) - 0.5) / 255.0;
      col *= uFade;

      // cinematic bars crop to 2.39:1 — on an ultrawide there is almost nothing to crop
      float lb = uLetterbox * max(0.0, (1.0 - (uRes.x / uRes.y) / 2.39) * 0.5);
      if (uv0.y < lb || uv0.y > 1.0 - lb) col = vec3(0.0);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

const _v = new THREE.Vector3();

export class Post {
  constructor(renderer, scene, camera, quality) {
    this.renderer = renderer;
    this.quality = quality;
    this.camera = camera;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: quality.msaa,
    });
    this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    // clamp extreme HDR before bloom: stacked fires must glow, not white out the frame.
    // Also scrub NaN/Inf — bloom would blur a single bad pixel into a black screen.
    this.clampPass = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uMax: { value: 4.0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform sampler2D tDiffuse; uniform float uMax; varying vec2 vUv; void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb; if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0); c = max(c, vec3(0.0)); float m = max(c.r, max(c.g, c.b)); c *= m > uMax ? uMax / m : 1.0; gl_FragColor = vec4(c, 1.0); }',
    });
    this.composer.addPass(this.clampPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x * quality.bloomScale, size.y * quality.bloomScale), 0.85, 0.38, 1.0);
    this.composer.addPass(this.bloom);
    this.final = new ShaderPass(FinalShader);
    this.composer.addPass(this.final);
    this.u = this.final.uniforms;
    const rv = this.bloom.renderTargetsVertical;
    this.u.tB0.value = rv[0].texture;
    this.u.tB2.value = rv[2].texture;
    this.u.tB3.value = rv[3].texture;
    this.u.tDirt.value = makeLensDirtTexture(512);
    this._heat = [];
  }

  setSize(w, h) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.u.uRes.value.set(s.x, s.y);
    this.bloom.setSize(s.x * this.quality.bloomScale, s.y * this.quality.bloomScale);
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
      const str = Math.min(0.008, 0.0024 * heat[i + 4] / 3 * (1 - dist / 140)) ;
      list.push([_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5, Math.min(0.25, r), str, dist]);
    }
    list.sort((a, b) => a[4] - b[4]);
    const H = this.u.uHeat.value;
    const n = Math.min(MAX_HEAT, list.length);
    for (let k = 0; k < n; k++) H[k].set(list[k][0], list[k][1], list[k][2], list[k][3]);
    this.u.uHeatN.value = n;
    const S = this.u.uShock.value;
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
    this.composer.render(dt);
  }
}
