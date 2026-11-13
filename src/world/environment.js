// The valley, the wall, the burning city, the rain. Everything that sits
// still (or nearly still) and makes the place feel like the end of the world.
// This file wires the world together and runs its per-frame life; the
// pieces live in terrain / structures / props / far / sky.
import * as THREE from 'three';
import { WORLD, wallZ } from '../config.js';
import { makeGroundTextures, makeConcreteTextures, makeBurlapTexture, makeGlowTexture, makeFlagTexture } from './textures.js';
import {
  makeMetalTextures, makePlasterTextures, makeSlabTextures, makeBarkTexture, makeHescoTextures,
  makePlankTextures, makeCorrugatedTextures, makeRockTextures,
} from './textures2.js';
import { lerp } from '../core/util.js';
import { patchFogChunks, patchLightChunks, fogUniforms, createSceneFog } from '../render/atmosphere.js';
import { Terrain, groundH } from './terrain.js';
import { FireSystem } from '../fx/fire.js';
import { makeMaterials, weather } from './kit.js';
import { buildFortification, buildTowers, buildBase, buildLightPools, updateWallBlood, wingMatrix } from './structures.js';
import { buildProps } from './props.js';
import { buildDressing } from './dressing.js';
import { buildFar } from './far.js';
import { buildSky, buildEnvMap, buildRain, buildSplashes, Bolts, BEAM_VERT, BEAM_FRAG } from './sky.js';
import { PF } from './textures.js';

patchFogChunks();
patchLightChunks();

const R = Math.random;
const _dir = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);

export class Environment {
  constructor(scene, renderer, quality) {
    this.scene = scene;
    this.renderer = renderer;
    this.quality = quality;
    this.time = 0;
    this.dawn = 0; // 0 night .. 1 grey dawn
    this.flash = 0;
    this.nextLightning = 14;
    this.nextHorizonFlash = 3;
    this.onThunder = null;
    this.onDistantBoom = null;
    this.onDistantGunfire = null;

    this.nightFog = new THREE.Color(0.0055, 0.006, 0.0085);
    this.dawnFog = new THREE.Color(0.075, 0.078, 0.085);
    scene.fog = createSceneFog(this.nightFog);
    this.fogUniforms = fogUniforms;
    scene.background = null;

    const ts = Math.min(512, quality.texSize);
    this.tex = {
      ground: makeGroundTextures(quality.texSize),
      concrete: makeConcreteTextures(512),
      burlap: makeBurlapTexture(256),
      glow: makeGlowTexture(128, 2.2),
      flag: makeFlagTexture(),
      metal: makeMetalTextures(ts),
      plaster: makePlasterTextures(ts),
      slab: makeSlabTextures(ts),
      bark: makeBarkTexture(256),
      hesco: makeHescoTextures(256),
      planks: makePlankTextures(256),
      corr: makeCorrugatedTextures(256),
      rock: makeRockTextures(256),
    };
    this.mats = makeMaterials(this.tex);
    this.sandbagMat = weather(new THREE.MeshStandardMaterial({ map: this.tex.burlap, roughness: 1, color: 0x8a7d62 }), { soot: 0.45, key: 'bags' });
    this.rockMat = weather(new THREE.MeshStandardMaterial({ map: this.tex.rock.map, normalMap: this.tex.rock.normalMap, color: 0x857f77, roughness: 0.95 }), { soot: 0.3, key: 'rock' });
    this.wireMat = new THREE.MeshStandardMaterial({ color: 0x6b665e, metalness: 0.85, roughness: 0.42 });
    this.darkMetal = this.mats.darkSteel;

    this.lightPools = [];
    this.lampSprites = [];
    this.power = 1;   // wall lighting (blackout event drops it to 0)
    this.fogBank = 0; // fog bank event, 0..1
    this.towerHousings = [];
    this.blinkers = [];
    this.flickerWindows = [];
    this.cityFires = [];
    this.skyBeams = [];
    this.combatSites = [];

    this.terrain = new Terrain(scene, quality, this.tex.ground);
    this.fire = new FireSystem(scene, quality);
    buildSky(this);
    this.bolts = new Bolts(scene);
    this.buildLights();
    buildFortification(this);
    buildTowers(this);
    buildBase(this);
    buildDressing(this, wingMatrix);
    buildProps(this);
    buildFar(this);
    buildLightPools(this);
    buildRain(this);
    buildSplashes(this);
    this.buildHorizonFlash();
    buildEnvMap(this);
  }

  // ── Lights ───────────────────────────────────────────────────────────────
  buildLights() {
    const q = this.quality;
    this.hemi = new THREE.HemisphereLight(0x3a465e, 0x15110d, 0.28);
    this.scene.add(this.hemi);

    this.moon = new THREE.DirectionalLight(0x8ea4c8, 0.14);
    this.moon.position.set(-90, 140, 70);
    this.scene.add(this.moon);
    this.scene.add(this.moon.target);

    // burning-city rim light from beyond the valley
    this.rim = new THREE.DirectionalLight(0xff7038, 0.35);
    this.rim.position.set(30, 35, -400);
    this.rim.target.position.set(0, 0, 0);
    this.scene.add(this.rim);
    this.scene.add(this.rim.target);

    // searchlights on the wing-end towers
    this.searchlights = [];
    [-1, 1].forEach((side, k) => {
      const tx = side * 77, tz = wallZ(77) + 2;
      const spot = new THREE.SpotLight(0xe4ecff, 0, 330, 0.115, 0.5, 1.15);
      spot.position.set(tx, groundH(tx, tz) + 17.2, tz);
      spot.intensity = 650;
      const shadow = q.spotShadows > k;
      spot.castShadow = shadow;
      // shadow maps are refreshed on alternate frames (see update): half the shadow passes
      spot.shadow.autoUpdate = false;
      spot.shadow.needsUpdate = true;
      if (shadow) {
        spot.shadow.mapSize.set(q.shadowMap, q.shadowMap);
        spot.shadow.camera.near = 4;
        spot.shadow.camera.far = 330;
        spot.shadow.bias = -0.00012;
        spot.shadow.normalBias = 0.02;
      }
      this.scene.add(spot);
      this.scene.add(spot.target);
      const len = 230;
      const rad = Math.tan(spot.angle * 1.05) * len;
      const geo = new THREE.CylinderGeometry(0.45, rad, len, 40, 1, true);
      geo.translate(0, -len / 2, 0);
      const beamMat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(0.55, 0.6, 0.72) }, uIntensity: { value: 0.05 }, uTime: { value: 0 }, uLen: { value: len } },
        vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, fog: false,
      });
      const beam = new THREE.Mesh(geo, beamMat);
      beam.position.copy(spot.position);
      beam.frustumCulled = false;
      beam.renderOrder = 5;
      this.scene.add(beam);
      const glare = this.makeGlowSprite(0xdfe8ff, 4, 1.6);
      glare.position.copy(spot.position);
      this.scene.add(glare);
      this.searchlights.push({
        spot, beam, glare, side,
        aim: new THREE.Vector3(side * 30, 0, -90),
        goal: new THREE.Vector3(side * 30, 0, -90),
        t: Math.random() * 10, hunt: 0, phase: k * 2.1,
      });
    });

    // static fire light for the burning wreck in the field
    this.wreckFire = new THREE.PointLight(0xff6a22, 110, 60, 1.6);
    this.wreckFire.position.set(-38, 2.5, -96);
    this.scene.add(this.wreckFire);
  }

  makeGlowSprite(color, size, intensity = 1, fog = true) {
    const m = new THREE.SpriteMaterial({ map: this.tex.glow, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog });
    if (fog) m.defines = { LB_FOG_ADD: '' };
    m.color.multiplyScalar(intensity);
    const s = new THREE.Sprite(m);
    s.scale.set(size, size, 1);
    s.renderOrder = 6;
    return s;
  }

  buildHorizonFlash() {
    this.horizonFlash = this.makeGlowSprite(0xffb070, 260, 0, false);
    this.horizonFlash.renderOrder = -3;
    this.scene.add(this.horizonFlash);
  }

  // ── Per-frame ─────────────────────────────────────────────────────────────
  update(dt, time, horde, fx, audio) {
    this.time = time;
    const d = this.dawn;
    const su = this.skyUniforms;
    su.uTime.value = time;
    this.rainUniforms.uTime.value = time;
    if (this.splashUniforms) { this.splashUniforms.uTime.value = time; this.splashUniforms.uColor.value.setRGB(0.07, 0.075, 0.085).multiplyScalar(1 - this.dawn * 0.4); }
    if (this.flagUniforms) this.flagUniforms.uTime.value = time;
    this.terrain.update(time);
    if (this.cityUniforms) { this.cityUniforms.uTime.value = time; this.cityUniforms.uDawn.value = d; }
    if (this.plumeUniforms) { this.plumeUniforms.uTime.value = time; this.plumeUniforms.uDawn.value = d; }
    const pw = this.power;
    if (this.poolUniforms) this.poolUniforms.uScale.value = (1 - d * 0.85) * pw;
    if (this.lampGlass) this.lampGlass.color.setRGB(5 * pw + 0.05, 2.3 * pw + 0.03, 0.7 * pw + 0.02);

    // lightning: a bolt out on the horizon, the cloud deck lights up
    this.nextLightning -= dt;
    if (this.nextLightning <= 0) {
      this.nextLightning = 20 + Math.random() * 38;
      this.flash = 1;
      const dir = this.bolts.strike(_dir.set(WORLD.CAM.x, WORLD.CAM.y, WORLD.CAM.z));
      su.uFlashDir.value.copy(dir).setY(Math.max(0.3, dir.y)).normalize();
      if (this.onThunder) this.onThunder(1.2 + Math.random() * 3);
    }
    this.bolts.update(dt, time);
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 2.6);
      const f = this.flash * (0.6 + 0.4 * Math.sin(time * 60)) * (1 - d);
      su.uFlash.value = f;
      this.hemi.intensity = this.baseHemi() + f * 2.4;
    } else {
      su.uFlash.value = 0;
      this.hemi.intensity = this.baseHemi();
    }

    // distant artillery on the horizon
    this.nextHorizonFlash -= dt;
    const hf = this.horizonFlash;
    if (this.nextHorizonFlash <= 0) {
      this.nextHorizonFlash = 2 + Math.random() * 7;
      hf.position.set((Math.random() - 0.5) * 1600, 5, -1150);
      this._hfi = 0.5 + Math.random() * 0.6;
      if (this.onDistantBoom) this.onDistantBoom(3 + Math.random() * 3);
    }
    this._hfi = (this._hfi || 0) * Math.exp(-dt * 7);
    hf.material.color.setRGB(1, 0.62, 0.35).multiplyScalar(this._hfi * (1 - d * 0.8));

    // the war in the city: tracer streams, flak, ground flashes
    if (fx) this.updateCombat(dt, fx);

    // city fires flicker, aviation lights blink, a candle in a village window
    // (none of these are fogged geometry: a fog bank has to hide them by hand)
    const clear = 1 - (d < 0.01 ? this.fogBank : 0);
    for (const f of this.cityFires) {
      const k = 0.75 + 0.25 * Math.sin(time * 1.3 + f.ph) * Math.sin(time * 2.9 + f.ph * 2);
      f.sprite.material.color.copy(f.base).multiplyScalar(k * (1 - d * 0.6) * clear * clear);
    }
    for (const b of this.blinkers) b.sprite.visible = clear > 0.5 && Math.sin(time * b.rate * 3.1 + b.ph) > 0.55;
    for (const w of this.flickerWindows) w.material.color.setRGB(2.2, 1.2, 0.45).multiplyScalar(0.7 + 0.3 * Math.sin(time * 7 + w.id) * Math.sin(time * 3.3));
    for (const b of this.skyBeams) {
      b.mesh.rotation.z = Math.sin(time * b.sp + b.ph) * 0.4;
      b.mesh.rotation.x = -0.28 + Math.cos(time * b.sp * 0.7 + b.ph) * 0.12;
      b.mesh.material.uniforms.uI.value = 0.022 * (1 - d) * clear * clear;
    }
    this.beacon.material.opacity = Math.sin(time * 3) > 0.6 ? 1 : 0.05;

    // burning wreck
    this.wreckFire.intensity = (90 + Math.random() * 45) * (1 - d * 0.5);
    const w = this.wreckFlames;
    if (fx && w) {
      if (Math.random() < 0.35) fx.flame(w.x + (Math.random() - 0.5) * 2.5, w.y, w.z + (Math.random() - 0.5) * 2, 0.9, 2.5);
      if (Math.random() < 0.12) fx.smokePuff(w.x, w.y + 3, w.z, 2.4, 0.028, 8, 2.2);
    }
    if (fx && this.generator && Math.random() < dt * 3) fx.smokePuff(this.generator.x, this.generator.y, this.generator.z, 0.5, 0.05, 3, 1.2);
    this.fire.update(dt, time, fx);

    // searchlights sweep, then hunt the thickest crowd
    // shadow maps refresh together on alternate frames: most of a shadow pass's cost is the
    // fixed render-target switch, so batching both lights into one frame halves it
    this._shadowFrame = (this._shadowFrame || 0) + 1;
    const shadowNow = (this._shadowFrame & 1) === 0;
    for (let k = 0; k < this.searchlights.length; k++) {
      const sl = this.searchlights[k];
      sl.t += dt;
      sl.hunt -= dt;
      if (sl.hunt <= 0 && horde && Math.random() < dt * 0.25) {
        const c = horde.densest(20, 200, 24, 7);
        if (c && c.count > 6) { sl.goal.set(c.x, groundH(c.x, c.z), c.z); sl.hunt = 4 + Math.random() * 3; }
      }
      if (sl.hunt <= 0) {
        const t = sl.t * 0.13 + sl.phase;
        const gx = sl.side * -10 + Math.sin(t) * 75 + Math.sin(t * 2.3) * 20, gz = -95 + Math.cos(t * 0.7) * 70;
        sl.goal.set(gx, groundH(gx, gz), gz);
      }
      sl.aim.lerp(sl.goal, 1 - Math.exp(-dt * (sl.hunt > 0 ? 1.6 : 0.9)));
      sl.spot.target.position.copy(sl.aim);
      sl.spot.target.updateMatrixWorld();
      _dir.subVectors(sl.aim, sl.spot.position).normalize();
      sl.beam.quaternion.setFromUnitVectors(_down, _dir);
      sl.beam.material.uniforms.uTime.value = time;
      sl.beam.material.uniforms.uIntensity.value = 0.05 * (1 - d) * this.power;
      sl.spot.intensity = 650 * (1 - d * 0.85) * this.power;
      if (sl.spot.castShadow && shadowNow) sl.spot.shadow.needsUpdate = true;
      const hs = this.towerHousings[k];
      if (hs) hs.lookAt(sl.aim);
    }

    updateWallBlood(this, horde, dt);

    // fog & sky follow the night/dawn blend
    const fc = this.scene.fog.color;
    fc.copy(this.nightFog).lerp(this.dawnFog, d);
    const bank = d < 0.01 ? this.fogBank : 0;
    if (bank > 0.001) fc.multiplyScalar(1 + bank * 2.2);
    su.uBank.value = bank;
    if (this.flash > 0) fc.offsetHSL(0, 0, 0).add(_flashCol.setRGB(0.012, 0.014, 0.02).multiplyScalar(su.uFlash.value));
    this.scene.fog.near = time;
    this.scene.fog.far = bank > 0.001 ? 2 + bank : d;
    fogUniforms.lbFogColor.value.copy(fc);
    fogUniforms.lbTime.value = time;
    fogUniforms.lbDawn.value = this.scene.fog.far;
    su.uHorizon.value.copy(fc);
    su.uZenith.value.setRGB(lerp(0.0025, 0.05, d), lerp(0.003, 0.055, d), lerp(0.0055, 0.068, d));
    su.uGlowAmt.value = lerp(0.7, 0.35, d);
    su.uCloudLight.value = lerp(1, 9, d);
    this.moon.intensity = lerp(0.14, 1.9, d);
    this.moon.color.setRGB(lerp(0.56, 0.75, d), lerp(0.64, 0.74, d), lerp(0.78, 0.72, d));
    this.rim.intensity = lerp(0.35, 0.25, d);
    this.rainUniforms.uIntensity.value = lerp(0.32, 0.18, d);
    for (const s of this.lampSprites) s.visible = d < 0.6 && this.power > 0.5;
    void audio;
  }

  updateCombat(dt, fx) {
    const d = this.dawn;
    for (const s of this.combatSites) {
      s.t -= dt;
      if (s.t > 0) continue;
      s.t = 0.8 + R() * 4.5;
      const kind = R();
      if (kind < 0.55) {
        // a stream of tracers arcing up out of the streets
        const n = 5 + ((R() * 9) | 0);
        const green = R() < 0.3;
        // the city is a kilometre off: the burst arrives seconds after the tracers
        if (this.onDistantGunfire && R() < 0.3) this.onDistantGunfire(3.2 + R() * 1.6);
        const ax = (R() - 0.5) * 0.9, az = (R() - 0.5) * 0.4;
        for (let k = 0; k < n; k++) {
          const sp = 260 + R() * 80;
          const vx = (ax + (R() - 0.5) * 0.06) * sp, vy = (0.55 + R() * 0.2) * sp, vz = (az + (R() - 0.5) * 0.06) * sp;
          const life = 1.2 + R() * 0.8;
          const r = green ? 6 : 40, g = green ? 30 : 9, b = green ? 6 : 2;
          fx.glow.spawn(s.x, s.y + 8 + k * 0.4, s.z, vx, vy, vz, life, 2.6, 2.2, PF.SPARK, r, g, b, 1, r * 0.6, g * 0.6, b * 0.6, 9.8, 0, 0.05, 0, 0, k * 0.03);
        }
      } else if (kind < 0.8) {
        // flak bursts in the clouds
        for (let k = 0; k < 3; k++) {
          const x = s.x + (R() - 0.5) * 160, y = s.y + 160 + R() * 160, z = s.z + (R() - 0.5) * 80;
          fx.glow.spawn(x, y, z, 0, 0, 0, 0.18 + R() * 0.1, 18, 34, PF.GLOW, 60, 34, 14, 1, 20, 8, 3);
        }
      } else {
        // something big goes up in the streets
        fx.glow.spawn(s.x, s.y + 15, s.z, 0, 0, 0, 0.5, 60, 140, PF.GLOW, 70, 34, 10, 1, 25, 8, 2);
        if (this.onDistantBoom && R() < 0.5) this.onDistantBoom(3.3 + R() * 1.5);
      }
    }
    void d;
  }

  // a dark night: the wall lamps, searchlights and fires are what you see by
  baseHemi() { return lerp(0.28, 3.2, this.dawn); }
}

const _flashCol = new THREE.Color();
