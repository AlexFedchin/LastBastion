// The valley, the wall, the burning city, the rain. Everything that sits
// still (or nearly still) and makes the place feel like the end of the world.
// This file wires the world together and runs its per-frame life; the
// pieces live in terrain / structures / props / far / sky.
import * as THREE from 'three';
import { WORLD, wallZ } from '../config.js';
import { Soldier } from '../game/soldier.js';
import { modelScene } from './models.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// scans whose albedo is too clean for a sooty, rain-soaked base: darkened in place
const KIT_TINT = { barrier: 0.55, barrierTall: 0.55, cement: 0.7, foodCans: 0.8, rations: 0.8 };
import { makeGroundTextures, makeConcreteTextures, makeBurlapTexture, makeGlowTexture, makeFlagTexture } from './textures.js';
import {
  makeMetalTextures, makePlasterTextures, makeSlabTextures, makeBarkTexture, makeHescoTextures,
  makePlankTextures, makeCorrugatedTextures, makeRockTextures,
} from './textures2.js';
import { lerp, clamp } from '../core/util.js';
import { patchFogChunks, patchLightChunks, fogUniforms, createSceneFog } from '../render/atmosphere.js';
import { Terrain, groundH } from './terrain.js';
import { FireSystem } from '../fx/fire.js';
import { makeMaterials, weather } from './kit.js';
import { lampLit, setLamps, setLampPower } from './lamplight.js';
import { buildFortification, buildTowers, buildBase, buildLightPools, updateWallBlood, wingMatrix } from './structures.js';
import { buildProps } from './props.js';
import { CrowField, crowPerches } from './crows.js';
import { patchFoliage } from './flora.js';
import { buildDressing } from './dressing.js';
import { buildFar } from './far.js';
import { buildRear } from './rear.js';
import { fileTex } from './texlib.js';
import { buildSky, buildEnvMap, buildRain, buildSplashes, Bolts, makeBeamMaterial } from './sky.js';
import { fogMaterial } from '../render/atmosphere.js';
import { VOL, VOL_LAYER } from '../render/volumetric.js';
import { PF } from './textures.js';

patchFogChunks();
patchLightChunks();

const R = Math.random;
const _dir = new THREE.Vector3();
const _prev = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);

export class Environment {
  constructor(scene, renderer, quality) {
    this.scene = scene;
    this.renderer = renderer;
    this.quality = quality;
    this.time = 0;
    this.dawn = 0; // 0 night .. 1 grey dawn
    this.dusk = 0; // 0 .. 1 sunset warmth over the dawn blend (the prologue); sunDir is the low sun
    this.sunDir = new THREE.Vector3(-0.3, 0.05, -1).normalize();
    this.flash = 0;
    this.nextLightning = 14;
    this.nextHorizonFlash = 3;
    this.onThunder = null;
    this.onDistantBoom = null;
    this.onDistantGunfire = null;

    this.nightFog = new THREE.Color(0.0038, 0.0042, 0.0062);
    this.dawnFog = new THREE.Color(0.075, 0.078, 0.085);
    scene.fog = createSceneFog(this.nightFog);
    this.fogUniforms = fogUniforms;
    scene.background = null;

    const ts = Math.min(512, quality.texSize);
    // scanned sets where they loaded (texlib), the procedural ones otherwise
    const F = (name, gen) => fileTex(name) || gen();
    const F1 = (name, gen) => (fileTex(name) ? fileTex(name).map : gen());
    this.tex = {
      ground: F('mud', () => makeGroundTextures(quality.texSize)),
      concrete: F('concrete', () => makeConcreteTextures(512)),
      burlap: F1('burlap', () => makeBurlapTexture(256)),
      glow: makeGlowTexture(128, 2.2),
      flag: makeFlagTexture(),
      metal: F('metal', () => makeMetalTextures(ts)),
      plaster: F('plaster', () => makePlasterTextures(ts)),
      slab: F('slab', () => makeSlabTextures(ts)),
      bark: F1('bark', () => makeBarkTexture(256)),
      hesco: makeHescoTextures(256),
      planks: F('planks', () => makePlankTextures(256)),
      corr: F('corr', () => makeCorrugatedTextures(256)),
      rock: F('rock', () => makeRockTextures(256)),
    };
    this.mats = makeMaterials(this.tex);
    this.kit = {}; // kit props asked for by the builders (addKit), placed in dressWithModels
    this.placed = new Map(); // whole models asked for by the builders (addModel): vehicles, wrecks, containers, bales
    this.sandbagMat = weather(new THREE.MeshStandardMaterial({ map: this.tex.burlap, roughness: 1, color: 0x8a7d62 }), { soot: 0.45, key: 'bags' });
    this.rockMat = weather(new THREE.MeshStandardMaterial({ map: this.tex.rock.map, normalMap: this.tex.rock.normalMap, normalScale: new THREE.Vector2(1.8, 1.8), color: 0x857f77, roughness: 1, envMapIntensity: 0.6 }), { soot: 0.3, wet: 0, key: 'rock' });
    this.wireMat = new THREE.MeshStandardMaterial({ color: 0x6b665e, metalness: 0.85, roughness: 0.42 });
    this.darkMetal = this.mats.darkSteel;

    this.lightPools = [];
    this.lampSprites = [];
    this.power = 1;   // wall lighting (blackout event drops it to 0)
    this.beamBoost = 1; // searchlight beams, brighter for a cutscene
    this.fogBank = 0; // fog bank event, 0..1
    this.towerHousings = [];
    this.blinkers = [];
    this.flickerWindows = [];
    this.cityFires = [];
    this.combatSites = [];
    // the story, as the valley shows it (see setStory)
    this.burn = 1; this.war = 1;

    this.terrain = new Terrain(scene, quality, this.tex.ground);
    this.fire = new FireSystem(scene, quality);
    buildSky(this);
    this.bolts = new Bolts(scene);
    this.buildLights();
    buildFortification(this);
    // the wall lamps light the ground for real (lamplight.js), not with a glow pasted on it
    setLamps(this.wallLamps || [], this.wallLampAims || [], scene);
    lampLit(this.terrain.mesh.material);
    buildTowers(this);
    buildBase(this);
    buildDressing(this, wingMatrix);
    buildProps(this);
    buildFar(this);
    buildRear(this);
    buildLightPools(this);
    buildRain(this);
    buildSplashes(this);
    this.buildHorizonFlash();
    buildEnvMap(this);
  }

  /**
   * What is built from the downloaded models once they have loaded (they load in
   * parallel with the world): the scanned sandbag piles round the nest and the
   * ammo crates on the roof. modelMesh: (name, node) -> a mesh to instance.
   */
  dressWithModels(modelMesh) {
    const rnd = makeRngLocal(77);
    // the packs' foliage keeps its crowns at a distance (flora.js)
    for (const k of ['trees', 'deadtrees']) modelScene(k).traverse((o) => { if (o.isMesh) patchFoliage(o.material); });
    // the valley's crows: on the dead trees and the wall at night, among the dead at dawn
    this.crows = new CrowField(this.scene, crowPerches(this.deadTreeSpots || []));
    this.crows.reset();
    // sandbag piles: as many 1.6 m piles as fit each run, alternating the two scans
    const piles = [modelMesh('sandbags', 'pile_0'), modelMesh('sandbags', 'pile_1')];
    const ms = [[], []];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    let k = 0;
    for (const [x0, z0, x1, z1] of this.nestBagRuns || []) {
      const len = Math.hypot(x1 - x0, z1 - z0), ang = Math.atan2(z1 - z0, x1 - x0);
      const n = Math.max(1, Math.round(len / 1.35));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        e.set(0, -ang + (rnd() < 0.5 ? Math.PI : 0) + (rnd() - 0.5) * 0.12, 0);
        // squeeze each pile to its share of the run, keep it narrow so the nest stays open
        m.compose(p.set(x0 + (x1 - x0) * t, WORLD.TOWER_TOP - 0.02, z0 + (z1 - z0) * t), q.setFromEuler(e), s.set(Math.min(1.15, (len / n) / 1.45), 0.95 + rnd() * 0.15, 0.62));
        ms[k++ % 2].push(m.clone());
      }
    }
    piles.forEach((src, i) => {
      if (!src || !ms[i].length) return;
      const im = new THREE.InstancedMesh(src.geometry, src.material, ms[i].length);
      ms[i].forEach((mm, j) => im.setMatrixAt(j, mm));
      im.castShadow = true; im.receiveShadow = true;
      this.scene.add(im);
    });
    // a spotter and a loader on the roof either side of the nest, watching the field
    this.roofMen = (this.roofSoldiers || []).map(([x, y, z, ry, elev]) => {
      const s = new Soldier();
      s.root.position.set(x, y, z); s.root.rotation.y = ry; s.root.visible = true;
      s.aim(elev);
      this.scene.add(s.root);
      return s;
    });
    // ammo crates: the weapons crate model (every mesh of it), stacked on the roof
    if (this.roofCrates && this.roofCrates.length) {
      const src = modelScene('mcrate');
      src.updateMatrixWorld(true);
      src.traverse((o) => {
        if (!o.isMesh) return;
        const im = new THREE.InstancedMesh(o.geometry, o.material, this.roofCrates.length);
        this.roofCrates.forEach(([x, y, z, ry], j) => im.setMatrixAt(j, m.compose(p.set(x, y, z), q.setFromEuler(e.set(0, ry, 0)), s.set(1, 1, 1)).multiply(o.matrixWorld)));
        im.castShadow = true; im.receiveShadow = true;
        this.scene.add(im);
      });
    }
    // the kit: everything the builders asked for in this.kit (name -> [Matrix4]), one instanced
    // mesh per prop and material; only what is big enough to matter casts a shadow
    const size = new THREE.Vector3();
    for (const [name, list] of Object.entries(this.kit || {})) {
      if (!list.length) continue;
      const src = modelScene('kit/' + name);
      src.updateMatrixWorld(true);
      new THREE.Box3().setFromObject(src).getSize(size);
      const cast = size.y > 0.4 || Math.max(size.x, size.z) > 0.9;
      const tint = KIT_TINT[name];
      src.traverse((o) => {
        if (!o.isMesh) return;
        let mat = o.material;
        if (tint) { mat = mat.clone(); mat.color.multiplyScalar(tint); }
        const im = new THREE.InstancedMesh(o.geometry, mat, list.length);
        list.forEach((mm, j) => im.setMatrixAt(j, m.multiplyMatrices(mm, o.matrixWorld)));
        im.castShadow = cast; im.receiveShadow = true;
        im.computeBoundingSphere();
        im.matrixAutoUpdate = false; // (fixed in place: no matrix to recompose every frame)
        im.name = 'kit/' + name;
        this.scene.add(im);
      });
    }
    // whole models: one instanced mesh per material of the model (vehicles keep their part nodes).
    // The model's meshes that share a material are merged first: the church came as 49 meshes in
    // 5 materials, the house 43 in 4, and every one of them was a draw in the view and in each
    // searchlight's shadow map, ~300 of a night's ~700 draws
    for (const { name, skip, tint, swap, node, cast, matte, list, mat: own } of this.placed.values()) {
      const src = modelScene(name);
      src.updateMatrixWorld(true);
      const groups = new Map(); // source material + vertex layout -> meshes
      let order = 0;
      src.traverse((o) => {
        if (!o.isMesh) return;
        for (let p = o; p; p = p.parent) if (skip && p.name === skip) return;
        if (node) { let p = o; while (p && p.name !== node) p = p.parent; if (!p) return; }
        const base = own || (swap && swap[o.material.name]) || o.material;
        const g = o.geometry;
        const layout = Object.keys(g.attributes).sort().join(',') + (g.index ? '|i' : '') + (Object.keys(g.morphAttributes).length ? '|m' + g.uuid : '');
        const key = base.uuid + '|' + layout;
        if (!groups.has(key)) groups.set(key, { base, src: o.material, meshes: [], last: 0 });
        const gr = groups.get(key);
        gr.meshes.push(o);
        gr.last = order++;
      });
      // Layers that lie on each other (the house's red roof over the charred one the burnt houses
      // show) are settled by draw order, and three orders opaque draws by distance, then by when
      // the mesh was made. So the parts are made in the order of their last mesh in the model and
      // share one bounding sphere (one distance): the later layer draws last and wins, as it did
      // when every mesh of the model was its own draw.
      // and when any part is merged every part is baked the same way, so layers that coincide
      // still come out at the same depth (a part placed by its node's matrix on the GPU rounds
      // differently from one baked into the model on the CPU)
      const made = [];
      const bake = [...groups.values()].some((gr) => gr.meshes.length > 1);
      for (const { base, src: srcMat, meshes } of [...groups.values()].sort((a, b) => a.last - b.last)) {
        let mat = base;
        if (tint != null) { mat = mat.clone(); mat.color.multiply(new THREE.Color(tint)); }
        // matte: bare stone, no sheen (the pack's rocks come in with a gloss)
        if (matte) { if (mat === srcMat) mat = mat.clone(); mat.roughness = 1; mat.roughnessMap = null; mat.metalness = 0; mat.metalnessMap = null; mat.envMapIntensity = 0.6; }
        const merged = meshes.length > 1 || bake ? mergeInModel(meshes) : null;
        // (a merged geometry is in the model's space already; a lone mesh keeps its node's matrix)
        const parts = merged ? [[merged, null]] : meshes.map((o) => [o.geometry, o.matrixWorld]);
        for (const [geo, local] of parts) {
          const im = new THREE.InstancedMesh(geo, mat, list.length);
          list.forEach((mm, j) => im.setMatrixAt(j, local ? m.multiplyMatrices(mm, local) : mm));
          im.castShadow = cast; im.receiveShadow = true;
          im.computeBoundingSphere();
          im.matrixAutoUpdate = false;
          im.name = node ? name + '/' + node : name;
          this.scene.add(im);
          made.push(im);
        }
      }
      if (made.length > 1) {
        const all = made[0].boundingSphere.clone();
        for (const im of made) all.union(im.boundingSphere);
        for (const im of made) im.boundingSphere = all.clone();
      }
    }
  }

  /**
   * Ask for a model (app/models/<name>.glb) at a placement matrix, instanced once the
   * models are in. skip: a node whose meshes are left out (the Ural's 'canvas');
   * tint: a colour the materials are multiplied by; swap: material name -> a material of the
   * game's to use instead (the tower's 'concrete' gets the wall's).
   */
  addModel(name, matrix, { skip = null, tint = null, swap = null, node = null, cast = true, group = '', mat = null, matte = false } = {}) {
    // mat: one material of the game's for every mesh of it; matte: the model's own, without its gloss
    // node: only that node's meshes (one variant of a pack: 'trees' / 'tree_3');
    // group: instances kept in a mesh of their own (so each part of the world culls apart)
    const key = `${name}|${skip || ''}|${tint ?? ''}|${node || ''}|${group}|${cast}|${mat ? mat.uuid : ''}|${matte}`;
    if (!this.placed.has(key)) this.placed.set(key, { name, skip, tint, swap, node, cast, mat, matte, list: [] });
    this.placed.get(key).list.push(matrix.clone());
  }

  /** Ask for a kit prop at a placement matrix (instanced once the models are in). */
  addKit(name, matrix) {
    (this.kit[name] || (this.kit[name] = [])).push(matrix.clone());
  }

  // ── Lights ───────────────────────────────────────────────────────────────
  buildLights() {
    const q = this.quality;
    this.hemi = new THREE.HemisphereLight(0x3a465e, 0x15110d, 0.16);
    this.scene.add(this.hemi);

    this.moon = new THREE.DirectionalLight(0x8ea4c8, 0.08);
    this.moon.position.set(-90, 140, 70);
    this.scene.add(this.moon);
    this.scene.add(this.moon.target);

    // burning-city rim light from beyond the valley
    this.rim = new THREE.DirectionalLight(0xff7038, 0.24);
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
      // the light also lights the air (volumetric.js); the painted cone is for presets without it
      spot.layers.enable(VOL_LAYER);
      const beam = new THREE.Mesh(geo, makeBeamMaterial(len));
      beam.visible = !q.volumetric;
      beam.position.copy(spot.position);
      beam.frustumCulled = false;
      beam.renderOrder = 5;
      this.scene.add(beam);
      this.searchlights.push({
        spot, beam, side,
        aim: new THREE.Vector3(side * 30, 0, -90),
        goal: new THREE.Vector3(side * 30, 0, -90),
        t: Math.random() * 10, hunt: 0, phase: k * 2.1,
      });
    });

    // static fire light for the burning wreck in the field
    this.wreckFire = new THREE.PointLight(0xff6a22, 110, 60, 1.6);
    this.wreckFire.position.set(-38, 2.5, -96);
    this.wreckFire.layers.enable(VOL_LAYER); // its glow in the smoke and rain round it
    this.scene.add(this.wreckFire);
  }

  makeGlowSprite(color, size, intensity = 1, fog = true) {
    const m = new THREE.SpriteMaterial({ map: this.tex.glow, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog });
    if (fog) fogMaterial(m, { add: true });
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

  /**
   * A lightning strike: a bolt out on the horizon (or at `at`, a ground point {x, z}, seen from
   * `cam`), the cloud deck lit up, and its thunder on the way.
   */
  strike(at = null, cam = null) {
    this.nextLightning = 20 + Math.random() * 38;
    this.flash = 1;
    const from = cam || _dir.set(WORLD.CAM.x, WORLD.CAM.y, WORLD.CAM.z);
    const dir = this.bolts.strike(from, at);
    this.skyUniforms.uFlashDir.value.copy(dir).setY(Math.max(0.3, dir.y)).normalize();
    // sound takes its time over the distance; it comes from where the bolt came down
    const B = this.bolts, d = B.lastDist || 1000;
    if (this.onThunder) this.onThunder(d / 343, d, Math.sin(B.lastAz || 0) * 0.8);
  }

  // ── Per-frame ─────────────────────────────────────────────────────────────
  update(dt, time, horde, fx, audio) {
    if (this.crows) this.crows.update(dt, this.dawn);
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
    setLampPower(pw * Math.max(0, 1 - d * 1.6));
    if (this.lampGlass) this.lampGlass.color.setRGB(5 * pw + 0.05, 2.3 * pw + 0.03, 0.7 * pw + 0.02);

    // lightning: a bolt out on the horizon, the cloud deck lights up
    this.nextLightning -= dt;
    if (this.nextLightning <= 0) this.strike();
    if (this.roofMen) for (const s of this.roofMen) s.idle(); // the spotter and loader by the nest
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

    // the war in the city: street fighting and explosions, all at ground level
    if (fx) this.updateCombat(dt, fx);

    // city fires flicker, aviation lights blink, a candle in a village window
    // (none of these are fogged geometry: a fog bank has to hide them by hand)
    const clear = 1 - (d < 0.01 ? this.fogBank : 0);
    for (const f of this.cityFires) {
      const k = 0.75 + 0.25 * Math.sin(time * 1.3 + f.ph) * Math.sin(time * 2.9 + f.ph * 2);
      f.sprite.material.color.copy(f.base).multiplyScalar(k * (1 - d * 0.6) * clear * clear * this.burn);
    }
    for (const b of this.blinkers) b.sprite.visible = clear > 0.5 && Math.sin(time * b.rate * 3.1 + b.ph) > 0.55;
    for (const w of this.flickerWindows) w.material.color.setRGB(2.2, 1.2, 0.45).multiplyScalar(0.7 + 0.3 * Math.sin(time * 7 + w.id) * Math.sin(time * 3.3));
    // the mast's aviation light: a slow soft pulse, fading up and away (every 1.6 s), never quite out
    {
      const u = (time / 1.6) % 1, on = 0.06 + 0.94 * Math.pow(0.5 - 0.5 * Math.cos(u * Math.PI * 2), 2);
      const b = this.beacon;
      // (deep red: pushed much past ~3 the tone curve bleaches it to pink)
      b.glass.material.color.setRGB(0.06 + 3.4 * on, 0.004 + 0.06 * on, 0.003 + 0.03 * on);
      b.halo.material.color.setRGB(1, 0.05, 0.02).multiplyScalar(0.9 * on * clear);
      b.haze.material.color.setRGB(1, 0.06, 0.03).multiplyScalar(0.16 * on * clear);
      b.glint.material.color.setRGB(1, 0.06, 0.025).multiplyScalar(3 * on * clear);
    }

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
      if (sl.track) { sl.goal.copy(sl.track); sl.hunt = 0.5; }
      else if (sl.hunt <= 0 && horde && Math.random() < dt * 0.25) {
        const c = horde.densest(20, 200, 24, 7);
        if (c && c.count > 6) { sl.goal.set(c.x, groundH(c.x, c.z), c.z); sl.hunt = 4 + Math.random() * 3; }
      }
      if (sl.hunt <= 0) {
        const t = sl.t * 0.13 + sl.phase;
        const gx = sl.side * -10 + Math.sin(t) * 75 + Math.sin(t * 2.3) * 20, gz = -95 + Math.cos(t * 0.7) * 70;
        sl.goal.set(gx, groundH(gx, gz), gz);
      }
      _prev.subVectors(sl.aim, sl.spot.position).normalize();
      sl.aim.lerp(sl.goal, 1 - Math.exp(-dt * (sl.track ? 4.5 : sl.hunt > 0 ? 1.6 : 0.9)));
      // the mount's motor: heard when the beam slews (jumping to a crowd, swinging out), not on the slow sweep
      if (audio && audio.ready && dt > 0) {
        const slew = _prev.angleTo(_dir.subVectors(sl.aim, sl.spot.position).normalize()) / dt;
        sl.slew = (sl.slew || 0) + (slew - (sl.slew || 0)) * Math.min(1, dt * 6);
        const on = this.power > 0.5 && !audio.inside && (audio.musicMode !== 'menu' || audio._cine);
        const lvl = on ? clamp((sl.slew - 0.12) / 0.45, 0, 1) : 0;
        if (!sl.motor && lvl > 0) sl.motor = audio.slMotor();
        if (sl.motor) { const P = sl.spot.position; sl.motor.update(P.x, P.y, P.z, 0, 0, 0, 0.55 * lvl * lvl); }
      }
      sl.spot.target.position.copy(sl.aim);
      sl.spot.target.updateMatrixWorld();
      _dir.subVectors(sl.aim, sl.spot.position).normalize();
      sl.beam.quaternion.setFromUnitVectors(_down, _dir);
      sl.beam.material.uniforms.uTime.value = time;
      // (sl.pw: one light on its own, the extraction's blackout takes them one at a time)
      const pw = this.power * (sl.pw ?? 1);
      sl.beam.material.uniforms.uIntensity.value = 0.05 * (1 - d) * pw * this.beamBoost * (sl.boost ?? 1);
      sl.spot.intensity = 650 * (1 - d * 0.85) * pw * (sl.spotK ?? 1);
      if (sl.spot.castShadow && shadowNow) sl.spot.shadow.needsUpdate = true;
      const hs = this.towerHousings[k];
      if (hs) hs.lookAt(sl.aim);
    }

    // the air the searchlights light: thinner towards dawn, thicker in a fog bank, a cutscene's boost
    if (this.searchlights[0]) VOL.src0.value.copy(this.searchlights[0].spot.position);
    if (this.searchlights[1]) VOL.src1.value.copy(this.searchlights[1].spot.position);
    VOL.density.value = 0.55 * (1 - d * 0.9) * (this.beamBoost > 1 ? 1.2 : 1) * (1 + (d < 0.01 ? this.fogBank : 0) * 1.5);

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
    su.uGlowAmt.value = lerp(0.36, 0.22, d) * (0.3 + 0.7 * this.burn);
    su.uCloudLight.value = lerp(1, 9, d);
    this.moon.intensity = lerp(0.08, 1.9, d);
    this.moon.color.setRGB(lerp(0.56, 0.75, d), lerp(0.64, 0.74, d), lerp(0.78, 0.72, d));
    this.rim.intensity = lerp(0.14, 0.2, d) * (0.3 + 0.7 * this.burn);
    this.rainUniforms.uIntensity.value = lerp(0.32, 0.18, d);
    for (const s of this.lampSprites) s.visible = d < 0.6 && this.power > 0.5;
    this.applyDusk();
  }

  /**
   * Sunset over whatever the dawn blend gives: the fog and sky warm, the low sun lights the
   * clouds from under the deck, and the key light swings round to come from it. Off (0),
   * everything is as the night/dawn blend left it.
   */
  applyDusk() {
    const k = this.dusk, su = this.skyUniforms;
    if (!this._base) this._base = { moon: this.moon.position.clone(), sky: this.hemi.color.clone(), ground: this.hemi.groundColor.clone(), rain: 0 };
    su.uDusk.value = k;
    if (k < 0.001) {
      if (this._duskOn) { this._duskOn = false; this.moon.position.copy(this._base.moon); this.hemi.color.copy(this._base.sky); this.hemi.groundColor.copy(this._base.ground); }
      return;
    }
    this._duskOn = true;
    const sd = this.sunDir;
    // how much of the sun is left: full above the hills, a glow for a while after it sets
    const up = Math.min(1, Math.max(0, (sd.y + 0.05) / 0.1));
    const fc = this.scene.fog.color;
    fc.lerp(_duskCol.setRGB(0.15, 0.075, 0.045).multiplyScalar(lerp(0.12, 1, up)), k * 0.85);
    fogUniforms.lbFogColor.value.copy(fc);
    su.uHorizon.value.copy(fc);
    su.uZenith.value.lerp(_duskCol.setRGB(0.032, 0.036, 0.07).multiplyScalar(lerp(0.15, 1, up)), k);
    su.uSunDir.value.copy(sd);
    su.uSunCol.value.setRGB(1, lerp(0.22, 0.45, up), lerp(0.08, 0.16, up)).multiplyScalar(lerp(0.18, 1, up));
    su.uCloudLight.value = lerp(su.uCloudLight.value, 3, k);
    // the key light: the moon's light, out of the sun, low and orange
    this.moon.position.copy(this._base.moon).lerp(_duskV.copy(sd).setY(Math.max(sd.y, 0.035)).multiplyScalar(300), k);
    this.moon.color.lerp(_duskCol.setRGB(1, 0.52, 0.26), k);
    this.moon.intensity = lerp(this.moon.intensity, 9 * up, k);
    this.hemi.color.copy(this._base.sky).lerp(_duskCol.setRGB(0.5, 0.36, 0.38), k);
    this.hemi.groundColor.copy(this._base.ground).lerp(_duskCol.setRGB(0.2, 0.12, 0.08), k);
    this.rainUniforms.uIntensity.value *= 1 - k * 0.7;
  }

  updateCombat(dt, fx) {
    const d = this.dawn;
    const Q = this._muzzleQ || (this._muzzleQ = []);
    for (let i = Q.length - 1; i >= 0; i--) {
      const m = Q[i];
      if ((m.t -= dt) > 0) continue;
      fx.glow.spawn(m.x, m.y, m.z, 0, 0, 0, 0.05 + R() * 0.04, 5, 9, PF.GLOW, 40, 26, 10, 1, 12, 6, 2);
      Q[i] = Q[Q.length - 1]; Q.pop();
    }
    for (const s of this.combatSites) {
      s.t -= dt;
      if (s.t > 0) continue;
      s.t = 0.8 + R() * 4.5;
      if (R() > this.war) continue;
      const kind = R();
      if (kind < 0.7) {
        // a firefight in the streets: muzzle flashes flickering low between the blocks
        const n = 3 + ((R() * 6) | 0);
        const x = s.x + (R() - 0.5) * 60, z = s.z + (R() - 0.5) * 30;
        let t = 0;
        for (let k = 0; k < n; k++) {
          t += 0.05 + R() * 0.25;
          this._muzzleQ.push({ t, x: x + (R() - 0.5) * 14, y: s.y + 2 + R() * 6, z: z + (R() - 0.5) * 8 });
        }
        // the city is a kilometre off: the burst arrives seconds after the flashes
        if (this.onDistantGunfire && R() < 0.35) this.onDistantGunfire(3.2 + R() * 1.6);
      } else {
        // something big goes up in the streets
        fx.glow.spawn(s.x, s.y + 15, s.z, 0, 0, 0, 0.5, 60, 140, PF.GLOW, 70, 34, 10, 1, 25, 8, 2);
        if (this.onDistantBoom && R() < 0.5) this.onDistantBoom(3.3 + R() * 1.5);
      }
    }
    void d;
  }

  /**
   * The world keeps pace with the radio. The city burns and fights through the
   * first nights; Bastion-3 falls on the fifth and the fighting
   * dies down; by the seventh "the city stopped burning" — embers and dark plumes only.
   */
  setStory(night, endless = false) {
    this.storyNight = night; this.storyEndless = endless; // (the developer's free camera restores it)
    const n = endless ? 99 : night;
    this.burn = n <= 5 ? 1 : n === 6 ? 0.5 : n <= 10 ? 0.05 : 0.03;
    this.war = n <= 4 ? 1 : n <= 6 ? 0.45 : 0;
    for (const f of this.cityFires) {
      if (!f.args) continue;
      // burning: the flames are there, as bright as the night calls for; burnt out: gone
      if (this.burn > 0.2) {
        if (f.fid < 0 || f.fid === undefined) f.fid = this.fire.add(...f.args);
        this.fire.set(f.fid, f.fk * this.burn);
      } else if (f.fid >= 0) { this.fire.remove(f.fid); f.fid = -1; }
    }
    if (this.plumeUniforms) this.plumeUniforms.uBurn.value = this.burn > 0.2 ? this.burn : 0;
    if (this.cityUniforms) this.cityUniforms.uBurn.value = this.burn;
  }

  // a dark night: the wall lamps, searchlights and fires are what you see by
  baseHemi() { return lerp(0.16, 3.2, this.dawn); }
}

const _flashCol = new THREE.Color();
const _duskCol = new THREE.Color();
const _duskV = new THREE.Vector3();

/** Small seeded RNG for placement. */
function makeRngLocal(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/**
 * One geometry of several meshes of a model (all in one material), each baked into the model's
 * space by its node's matrix. The attributes come out as plain floats (a meshopt model's are
 * often quantized or interleaved, which a matrix can't be applied to). null if they don't merge.
 */
function mergeInModel(meshes) {
  try {
    const geos = meshes.map((o) => {
      const src = o.geometry, g = new THREE.BufferGeometry();
      for (const [k, a] of Object.entries(src.attributes)) {
        const n = a.count, sz = a.itemSize, arr = new Float32Array(n * sz);
        for (let i = 0; i < n; i++) for (let c = 0; c < sz; c++) arr[i * sz + c] = a.getComponent(i, c);
        g.setAttribute(k, new THREE.BufferAttribute(arr, sz));
      }
      if (src.index) g.setIndex(new THREE.BufferAttribute(Uint32Array.from(src.index.array), 1));
      g.applyMatrix4(o.matrixWorld);
      return g;
    });
    const out = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    return out || null;
  } catch (err) {
    console.warn('[models] merge failed', err);
    return null;
  }
}
