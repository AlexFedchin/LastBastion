// ─────────────────────────────────────────────────────────────────────────────
//  LAST BASTION — entry point and game state machine
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { uniform } from 'three/tsl';
import {
  WORLD, DIFFICULTY, ZOMBIE_TYPES, ZT, UPGRADES, CLAYMORE, FINAL_NIGHT, RADIO, BARKS,
  nightPlan, baseStats, SUPPLY_BONUS, sectionCenterX, wallZ, wallDist, ABILITY, CALL, COMMS,
  UNLOCKS, UNLOCK_INFO, UNLOCK_LINES, isUnlocked, allRadioLines, CHRONICLE, NIGHT_EVENTS, EXTRACTION,
  GUN_MODS,
} from './config.js';
import { clamp, lerp, damp, pick, rand, formatInt, fitFov } from './core/util.js';
import { Input } from './core/input.js';
import { QUALITY, loadSettings, saveSettings, loadSave, writeSave, clearSave, loadBest, recordBest } from './core/storage.js';
import { Environment } from './world/environment.js';
import { groundH } from './world/terrain.js';
import { makeParticleAtlas, makeDecalAtlas } from './world/textures.js';
import { Effects } from './fx/effects.js';
import { Horde } from './game/horde.js';
import { Player } from './game/player.js';
import { Arsenal } from './game/arsenal.js';
import { Director } from './game/director.js';
import { NightEvents } from './game/events.js';
import { Telemetry } from './core/telemetry.js';
import { Post } from './render/post.js';
import { AudioEngine } from './audio/audio.js';
import { HUD } from './ui/hud.js';
import { Screens } from './ui/screens.js';
import { NightCard } from './ui/nightcard.js';
import { Loader } from './ui/loader.js';
import { loadModels, modelMesh, zombieAnimData, modelNames, cloneModel } from './world/models.js';
import { zombieSkin } from './game/zombieSkin.js';
import { loadTextures } from './world/texlib.js';
import { setSoldierLamps, setSoldierClock } from './game/soldier.js';
import { Chronicle, composeChronicle } from './ui/chronicle.js';
import { DevTools } from './ui/devtools.js';
import { FreeCam } from './ui/freecam.js';
import { Medals } from './game/medals.js';
import { medalSVG } from './ui/medalArt.js';
import { Hangar } from './world/hangar.js';
import { Coach } from './ui/coach.js';
import { Ending } from './game/ending.js';
import { Prologue } from './game/prologue.js';
import { obstacles } from './world/obstacles.js';
import { ExtractionHold, ExtractionScene } from './game/extraction.js';

const SECTION_LABELS = ['L5', 'L4', 'L3', 'L2', 'L1', 'R1', 'R2', 'R3', 'R4', 'R5'];
const params = new URLSearchParams(location.search);
const TEST = params.has('test');
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

class Game {
  constructor() {
    this.settings = loadSettings();
    if (params.get('quality') && QUALITY[params.get('quality')]) this.settings.quality = params.get('quality');
    this.quality = QUALITY[this.settings.quality] || QUALITY.high;
    this.state = 'boot';
    this.time = 0;
    this.stateT = 0;
    this.timeScale = 1;
    this.slowmo = 0;
    this.slowmoCd = 0;
    this.damagePulse = 0;
    this.flashPulse = 0;
    this.radial = 0;
    this.letterbox = 1;
    this.fps = { acc: 0, n: 0 };
    this.alertCd = new Float32Array(10);
    this.barkCd = 0;
    this.killTimes = [];
    this.carnageShown = 0;
    this.groanAcc = 0;
    this.burnAcc = 0;
  }

  async boot() {
    this.loader = new Loader();
    const BOOT_STEPS = 9;
    let stepN = 0;
    const step = async (t) => { if (TEST) console.info('[boot]', t); this.loader.step(t, stepN++ / BOOT_STEPS); await nextFrame(); };
    await step('warming the generators…');
    const modelsLoaded = loadModels();
    const texturesLoaded = loadTextures(this.quality);
    const canvas = document.getElementById('game');
    this.canvas = canvas;
    // WebGPU (three's WebGPURenderer; it falls back to WebGL2 where WebGPU is missing)
    const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, trackTimestamp: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    await renderer.init();
    THREE.asyncPipelines(renderer); // new pipelines compile in the background (render/three-shim.js)
    console.info(`[render] ${renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2 fallback'}`);
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = this.quality.spotShadows > 0;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    if (renderer.asyncScenes) renderer.asyncScenes.add(this.scene);
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, window.innerWidth / window.innerHeight, 0.1, 3200);

    await texturesLoaded;
    await step('painting the valley…');
    this.env = new Environment(this.scene, renderer, this.quality);
    await step('digging graves…');
    const textures = { particles: makeParticleAtlas(128), decals: makeDecalAtlas(128) };
    this.fx = new Effects(this.scene, textures, this.env.fogUniforms, this.quality);
    this.fx.fire = this.env.fire;
    // anything that goes off near the crows puts them up
    for (const k of ['explosion', 'bigExplosion']) {
      const f = this.fx[k].bind(this.fx);
      this.fx[k] = (x, y, z, ...rest) => { if (this.env.crows) this.env.crows.scare(x, z, k === 'bigExplosion' ? 70 : 40); return f(x, y, z, ...rest); };
    }
    // (TSL uniforms: the zombie, eye and soldier node materials read them; each has a .value)
    this.uniforms = {
      uTime: uniform(0),
      uEyeGlow: uniform(9),
      uRim: uniform(new THREE.Color(0.075, 0.032, 0.014)),
      uEyeGlowBillboard: uniform(1),
      uPixel: uniform(0.001),
      // the sodium lamps on the wall light the dead beneath them
      uLamps: { value: (this.env.wallLamps || []).slice(0, 10) },
      uLampPow: { value: 1 },
    };
    await step('waking the dead…');
    this.horde = new Horde(this.scene, this.fx, {
      // (room for half as many again: the extraction raises the limit for the valley's last rush)
      cap: Math.round(this.quality.maxZombies * 1.5), limit: this.quality.maxZombies, corpseCap: this.quality.corpses, shadows: this.quality.zombieShadows, uniforms: this.uniforms,
    });
    this.horde.fire = this.env.fire;
    this.audio = new AudioEngine();
    this.audio.applySettings(this.settings);
    const soundLoaded = this.audio.preload();
    await modelsLoaded;
    this.horde.useModel(zombieSkin(modelMesh, zombieAnimData()));
    setSoldierLamps(this.uniforms);
    this.env.dressWithModels(modelMesh);
    this.player = new Player(this.camera, this.scene, this.fx, this.audio, this.horde);
    this.applyPlayerSettings();
    this.arsenal = new Arsenal(this.scene, this.fx, this.audio, this.horde, this.env);
    this.director = new Director(this.horde);
    this.events = new NightEvents(this);
    this.telemetry = new Telemetry(this);
    await step('loading the belt…');
    this.post = new Post(renderer, this.scene, this.camera, this.quality);
    this.hud = new HUD();
    this.screens = new Screens(this);
    this.nightCard = new NightCard();
    this.chronicle = new Chronicle(this);
    this.dev = new DevTools(this);
    this.hangar = new Hangar(this);
    this.freecam = new FreeCam(this);
    this.medals = new Medals();
    this.medals.onAward = (m) => this.medalToast(m);
    this.coach = new Coach(this);
    this.ending = new Ending(this);
    this.prologue = new Prologue(this);
    this.extraction = new ExtractionScene(this);
    this.input = new Input(canvas);

    this.wireEvents();
    this.onResize();
    window.addEventListener('resize', () => this.onResize());

    // compile shaders before the first visible frame
    await step('checking the wire…');
    this.menuStats = { ...baseStats(), gunners: 4, wireBands: 1 };
    this.arsenal.startNight(this.menuStats, true);
    this.env.setStory(1);
    for (let i = 0; i < 220; i++) this.spawnMenuZombie(rand(-170, -30));
    this.horde.update(0.016, 0);
    this.horde.syncRender();
    this.updateMenuCamera(0);
    await this.compileScene(this.scene, this.camera);
    this.post.render(0.016, 0);
    await this.pipelinesSettled();

    // first launch: measure this machine and pick the graphics preset
    await this.autoQuality(step);

    await step('tuning the radio…');
    await Promise.race([soundLoaded, new Promise((r) => setTimeout(r, 6000))]);

    this.loader.step('the wall is manned', 1);
    this.loader.hide();
    if (window.bastion) this.audio.init(); // Electron allows audio without a gesture
    this.enterMenu();
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));

    this.telemetry.session();
    // closing the window mid-night still leaves a summary of it in the log
    window.addEventListener('beforeunload', () => { if (this.telemetry.n) this.telemetry.endNight('quit'); });
    window.__LB = this; // handy from devtools
    if (TEST) this.setupTestHooks();
  }

  /**
   * First-launch graphics calibration. Renders a heavy night from the gun (a big
   * horde, explosions, fire) for a few dozen frames, times it on the GPU, works
   * out what that frame would cost at HIGH and picks the preset that should hold
   * 60 fps in a heavy fight. Runs once; Settings ▸ Quality ▸ AUTO runs it again.
   */
  async autoQuality(step) {
    if (TEST || params.get('quality') || this.settings.benchmarked) return;
    await step('calibrating graphics for this machine…');
    const cur = this.settings.quality in QUALITY ? this.settings.quality : 'high';
    let ms = 0;
    try { ms = await this.benchmarkFrame(); } catch (err) { console.warn('[quality] benchmark failed', err); return; }
    // relative cost of each preset against HIGH (pixel count, MSAA, shadows)
    const COST = { low: 0.35, medium: 0.6, high: 1, ultra: 2.3 };
    const atHigh = ms / COST[cur];
    const pick = atHigh <= 6 ? 'ultra' : atHigh <= 12 ? 'high' : atHigh <= 20 ? 'medium' : 'low';
    this.settings.quality = pick;
    this.settings.benchmarked = true;
    this.settings.benchMs = Math.round(atHigh * 10) / 10;
    saveSettings(this.settings);
    console.info(`[quality] heavy frame ${ms.toFixed(1)} ms at ${cur} (~${atHigh.toFixed(1)} ms at high) → ${pick}`);
    if (pick !== cur) {
      await step(`graphics set to ${pick} — reloading…`);
      location.reload();
      await new Promise(() => {}); // the page is going away
    }
  }

  /** Median GPU time (ms) of a heavy night frame seen from the gun. */
  async benchmarkFrame() {
    const r = this.renderer, cam = this.camera;
    const device = r.backend.device; // (WebGPU; the WebGL2 fallback has none and uses wall time)
    // the gunner's view
    cam.position.set(WORLD.CAM.x, WORLD.CAM.y, WORLD.CAM.z);
    cam.rotation.order = 'YXZ';
    cam.rotation.set(-0.16, 0, 0);
    cam.fov = fitFov(this.settings.fov, cam.aspect);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    // a heavy night: a big horde, fire and blasts
    for (let i = 0; i < 700; i++) this.horde.spawn(Math.random() < 0.8 ? ZT.SHAMBLER : ZT.RUNNER, rand(-80, 80), rand(-190, -20), 1, 1);
    for (let k = 0; k < 6; k++) this.fx.explosion(rand(-40, 40), 0, rand(-120, -40), 1.4);
    const frames = 36, warm = 10, wall = [];
    let times = [];
    let t = 0;
    for (let k = 0; k < frames + warm; k++) {
      t += 1 / 60;
      this.horde.update(1 / 60, t);
      this.horde.syncRender();
      this.env.update(1 / 60, t, this.horde, this.fx, this.audio);
      this.fx.update(1 / 60);
      const a = performance.now();
      this.post.render(1 / 60, t);
      if (device) await device.queue.onSubmittedWorkDone(); // wait for the GPU
      if (k >= warm) wall.push(performance.now() - a);
      // GPU time: every render pass of the frame, from timestamp queries
      try {
        const ms = await r.resolveTimestampsAsync(THREE.TimestampQuery.RENDER);
        if (k >= warm && ms > 0) times.push(ms);
      } catch { /* no timestamp queries */ }
      if (k % 6 === 0) await nextFrame();
    }
    if (times.length < frames / 2) times = wall; // no timer queries: wall time with a GPU sync
    // back to the attract mode the menu expects
    this.horde.clear();
    this.fx.clear();
    for (let i = 0; i < 220; i++) this.spawnMenuZombie(rand(-170, -30));
    times.sort((x, y) => x - y);
    return times[Math.floor(times.length / 2)];
  }

  /** Cover the screen, then reload (graphics presets size buffers at startup). */
  async reloadWithLoader() {
    await this.loader.show({ kicker: 'BASTION-7 · SIGNALS', title: 'LAST <b>BASTION</b>', tag: 'Repainting the valley.', sub: '' });
    this.loader.step('repainting the valley…', 0.3);
    await nextFrame();
    location.reload();
  }

  /**
   * The deployment card between the menu and a night: what night it is, what's
   * new, and — behind it — every shader the night may need compiled up front, so
   * the first giant, aircraft or rescue party doesn't hitch.
   */
  async deploy(save, begin) {
    if (this.deploying) return;
    this.deploying = true;
    try {
      const n = save.night || 1;
      const diff = DIFFICULTY[save.difficulty] || DIFFICULTY.veteran;
      const shop = !!save.atShop;
      const hours = Math.max(0, 72 - (n - 1) * 8);
      const fresh = Object.keys(UNLOCKS).filter((k) => UNLOCKS[k] === n).map((k) => UNLOCK_INFO[k]);
      const souls = save.survivors ?? 0, past = save.endless || n > FINAL_NIGHT;
      // from the sixth night on, the card keeps the count the flight is waiting for
      const need = !past && n >= 6 && save.survivors ? ` · ${EXTRACTION.souls} NEEDED FOR EXTRACTION` : '';
      this.screens.show(null);
      await this.loader.show({
        kicker: `BASTION-7 · ${diff.label}${save.survivors ? ` · ${save.survivors} ON THE WALL` : ''}${need}`,
        title: shop ? 'DAWN <b>RESUPPLY</b>' : `NIGHT <b>${String(n).padStart(2, '0')}</b>`,
        tag: shop ? 'Count the living. Spend what you scavenged.'
          : past ? 'Nobody is coming for us.'
            : n === FINAL_NIGHT ? (souls >= EXTRACTION.souls ? 'The flight is coming. Hold until it is overhead.' : 'Too few of us left for the flight. Hold anyway.')
              : fresh.length ? `New tonight: ${fresh.map((f) => f.replace(/ /g, '\u00a0')).join(' · ')}` : `${hours} hours until extraction.`,
        sub: '',
        art: shop ? 'dawn' : this.nightArt(n),
      });
      const t0 = performance.now();
      this.loader.step('issuing ammunition…', 0.2);
      await nextFrame();
      this.loader.step('briefing the crews…', 0.45);
      // the extraction's aircraft and cast, built now so the precompile covers them
      if (n === FINAL_NIGHT && !save.endless && (save.survivors ?? 0) >= EXTRACTION.souls) this.extraction.build();
      await this.precompile();
      this.loader.step('manning the wall…', 0.8);
      while (performance.now() - t0 < 1500) await nextFrame();
      begin();
      // the night's own set-up changes a few materials: their shaders too, before the loader lifts
      await this.precompile();
      this.loader.step('stand to', 1);
      await nextFrame();
      this.loader.hide();
    } finally {
      this.deploying = false;
    }
  }

  /** Compile the shaders of everything not on screen yet (giants, aircraft, people, props). */
  async precompile() {
    // a copy of every model, so the props, aircraft and people an event brings in later don't
    // build their shaders the moment they first come into view (a hitch of ~20 ms a material)
    if (!this.warmModels) {
      const g = this.warmModels = new THREE.Group();
      g.name = 'warm-models';
      for (const name of modelNames()) {
        if (name === 'hangar' || name === 'zombie') continue; // the hall is its own scene; the dead have their own material
        const m = cloneModel(name);
        m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
        g.add(m);
      }
    }
    this.scene.add(this.warmModels);
    await this.warmScene(this.scene, this.camera);
    this.scene.remove(this.warmModels);
    // the dawn resupply's hall: built and compiled under the first loader rather than at the
    // first dawn (a second's stall on the way in)
    if (!this.hangar.built) {
      try { this.hangar.build(); } catch (err) { console.warn('[precompile] hangar', err); }
      if (this.hangar.built && this.hangar.scene) await this.warmScene(this.hangar.scene, this.hangar.camera);
    }
    // that frame's pipelines compile in the background: the loader stays up until they're in
    await this.pipelinesSettled();
  }

  /**
   * Build the shaders of everything in `scene`, hidden or not, on camera or not: compile it for
   * the scene pass, upload its textures, and draw one frame of it through the post chain with
   * everything showing and nothing culled (that builds the shadow-pass shaders too). Compiling
   * only takes what the camera sees, so a prop behind the gun built its shaders when the player
   * turned round to it. (Call it under a loading screen: the frame goes to the canvas.)
   */
  async warmScene(scene, camera) {
    const hidden = [], culled = [], lit = new Set(), dark = [];
    scene.traverseVisible((o) => { if (o.isLight) lit.add(o); });
    scene.traverse((o) => {
      if (!o.visible) { hidden.push(o); o.visible = true; }
      if (o.frustumCulled) { culled.push(o); o.frustumCulled = false; }
    });
    // but the lights stay as they are: the set of lights is part of every shader's key, and a light
    // in a hidden group showing for this frame would build every shader for a night that never is
    scene.traverse((o) => { if (o.isLight && o.visible && !lit.has(o)) { dark.push(o); o.visible = false; } });
    const sp = this.post.scenePass, prevScene = sp.scene, prevCam = sp.camera;
    try {
      await this.compileScene(scene, camera);
      const seen = new Set();
      scene.traverse((o) => {
        if (!o.material) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          for (const k in m) {
            const v = m[k];
            if (!v || !v.isTexture || seen.has(v)) continue;
            seen.add(v);
            // (an image still loading uploads when it comes in, and a canvas when it's drawn on:
            // the hangar's board, blank till the hangar opens, only failed to upload here)
            const img = v.image;
            if (img && (img.complete === false || (typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement))) continue;
            this.renderer.initTexture(v);
          }
        }
      });
      sp.scene = scene; sp.camera = camera;
      this.post.render(1 / 60, this.time);
    } catch (err) { console.warn('[precompile]', err); }
    sp.scene = prevScene; sp.camera = prevCam;
    for (const o of dark) o.visible = true;
    for (const o of culled) o.frustumCulled = true;
    for (const o of hidden) o.visible = false;
  }

  /**
   * Compile a scene's shaders for the post chain's scene pass: its render target and outputs are
   * part of every shader's key, so compiling for the canvas built shaders no frame ever used.
   * (PassNode.compileAsync leaves the renderer pointed at the pass until the compile is done, and
   * the game's frames go on meanwhile; three takes the target when the compile starts, so it is
   * set back straight away here.)
   */
  compileScene(scene, camera) {
    const r = this.renderer, sp = this.post.scenePass;
    const prevRT = r.getRenderTarget(), prevMRT = r.getMRT(), prevCtx = r.contextNode;
    sp.renderTarget.samples = sp.options.samples === undefined ? r.samples : sp.options.samples;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    sp.setSize(size.width, size.height);
    r.setRenderTarget(sp.renderTarget);
    r.setMRT(sp._mrt);
    if (sp.contextNode !== null) r.contextNode = sp._getContextNode(r);
    let done;
    try { done = r.compileAsync(scene, camera); } finally { r.setRenderTarget(prevRT); r.setMRT(prevMRT); r.contextNode = prevCtx; }
    return done;
  }

  /** Wait (at most `maxMs`) for every pipeline asked for so far to finish compiling. */
  async pipelinesSettled(maxMs = 30000) {
    if (!this.renderer.pipelinesSettled) return;
    await Promise.race([this.renderer.pipelinesSettled(), new Promise((r) => setTimeout(r, maxMs))]);
  }

  applyPlayerSettings() {
    this.player.sens = 0.0022 * this.settings.sensitivity;
    this.player.invertY = !!this.settings.invertY;
    this.player.baseFov = this.settings.fov;
  }

  applySetting(k, v) {
    this.settings[k] = v;
    saveSettings(this.settings);
    if (['master', 'music', 'sfx', 'gunSound'].includes(k)) this.audio.applySettings(this.settings);
    if (['sensitivity', 'invertY', 'fov'].includes(k)) this.applyPlayerSettings();
    if (k === 'showFps') document.getElementById('fps').textContent = '';
  }

  // ── Event wiring ─────────────────────────────────────────────────────────
  wireEvents() {
    const h = this.horde;
    h.onKill = (type, cause, x, y, z, headshot) => this.onKill(type, cause, x, y, z, headshot);
    h.onBreach = (sec, x, y, z) => this.onBreach(sec, x, y, z, 'climb');
    h.onBloaterWall = (sec, x, z) => this.onBloaterWall(sec, x, z);
    h.onIgnite = (i) => { if (this.inPlay()) this.audio.ignited(h.x[i], h.z[i], h.type[i]); };
    // the wire: it catching a crowd, and a section of it going
    this.arsenal.onMessage = (text, kind, item) => {
      if (!this.inPlay()) return;
      if (kind === 'wireHold') this.hud.alert('', 'wire', { key: 'wireHold', item, format: (s) => `WIRE HOLDING — ${s.join(' · ')}`, priority: 0, life: 2.6 });
      else if (kind === 'wireCut') { this.hud.alert('', '', { key: 'wireCut', item, format: (s) => `WIRE CUT — ${s.join(' · ')}` }); }
    };
    this.player.onHit = (killed, head) => { this.hud.hitmarker(killed, head); };
    this.player.onOverheat = () => { this.bark('overheat', 0.5); this.telemetry.overheat(); this.medals.overheat(this.run); };
    this.arsenal.onExplosionKills = (kills, x, z, cause) => this.onExplosionKills(kills, x, z, cause);
    this.arsenal.air.onRadio = (who, text, opts) => { if (this.inPlay()) this.hud.radio(who, text, true, opts); };
    this.arsenal.onShake = (scale, x, z) => {
      const d = Math.hypot(x - WORLD.CAM.x, z - WORLD.CAM.z);
      this.player.addTrauma(clamp(scale * 22 / (d + 8), 0, 0.9));
      if (d < 40) this.flashPulse = Math.max(this.flashPulse, 0.06 * scale);
    };
    this.fx.onShake = (a) => this.player.addTrauma(a);
    this.env.onThunder = (delay, dist, pan) => this.audio.thunder(delay, dist, pan);
    this.env.onDistantBoom = (delay) => this.audio.distantBoom(delay);
    this.env.onDistantGunfire = (delay) => this.audio.distantGunfire(delay);
    this.director.onEvent = (kind, e) => this.onDirectorEvent(kind, e);
    this.input.onLockChange = (locked) => {
      if (this.freecam.on) return; // the free camera captures the mouse for itself
      if (!locked && this.state === 'night' && !this.ignoreUnlock) this.pause();
      if (locked && this.state === 'night') this.screens.show(null);
    };
    this.canvas.addEventListener('click', () => {
      this.audio.init();
      if (this.freecam.on) return;
      if (this.state === 'night' && !this.input.locked) this.input.lock();
      if (this.state === 'shop') this.hangar.click();
    });
    // the hangar: what the cursor is over (only over the 3D view, not the panels)
    window.addEventListener('mousemove', (e) => { if (this.state === 'shop' && !this.freecam.on) this.hangar.pointer(e, e.target === this.canvas); });
    document.addEventListener('keydown', (e) => {
      this.audio.init();
      if (this.chronicle.active && ['Space', 'Enter', 'NumpadEnter', 'Escape'].includes(e.code)) { if (!e.repeat) this.chronicle.advance(); return; }
      if (this.state === 'prologue' && ['Space', 'Enter', 'NumpadEnter', 'Escape'].includes(e.code)) { if (!e.repeat) this.prologue.skipPress(); return; }
      if (this.state === 'ending' && ['Space', 'Enter', 'NumpadEnter', 'Escape'].includes(e.code)) { this.ending.skipPress(); return; }
      if (this.state === 'extraction' && ['Space', 'Enter', 'NumpadEnter', 'Escape'].includes(e.code)) { this.extraction.skipPress(); return; }
      if (this.state === 'shop' && !e.repeat && this.screens.current === 'shop' && this.hangar.key(e.code)) { e.preventDefault(); return; }
      if (e.code === 'KeyH' && this.coach.active) { this.coach.dismiss(); return; }
      if (e.code === 'Escape') {
        if (this.state === 'paused' && performance.now() - (this.pausedAt || 0) > 350) this.resume();
        else if (this.screens.current === 'medals' && this.screens.medalZoomOpen()) this.screens.medalZoom(null);
        else if (this.screens.current === 'settings' || this.screens.current === 'howto' || this.screens.current === 'medals') this.onAction('back');
      }
    });
    window.addEventListener('mousedown', () => this.audio.init(), { once: false });
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post.setSize(w, h);
  }

  // ── Menu & flow ──────────────────────────────────────────────────────────
  enterMenu() {
    this.state = 'menu';
    this.stateT = 0;
    this.hud.show(false);
    this.input.unlock();
    this.env.dawn = 0;
    this.screens.refreshMenu(loadSave());
    this.screens.show('menu');
    this.audio.setMusicMode('menu');
    this.audio.pressure = 0; this.audio.intensity = 0; this.audio.lowLife = false; this.audio.tide = false;
    this.letterboxTarget = 0;
    if (this.events) this.events.reset();
    if (this.chronicle) this.chronicle.stop();
    if (this.ending) this.ending.stop();
    if (this.extraction) this.extraction.stop();
    if (this.prologue) this.prologue.stop();
    this.audio.stopVoice();
    this.arsenal.startNight(this.menuStats, true);
    this.env.setStory(1);
    this.menuArtyT = 6;
    this.horde.pileMul = 0.6;
    this.horde.globalSpeed = 1;
    this.player.gun.visible = false;
  }

  onAction(act, el) {
    // the clicks that lead into a night take the mouse there and then (a pointer lock needs
    // the click's gesture), so the night opens straight onto the gun with no "click to play"
    if (!TEST && ['continue', 'start', 'begin', 'retry'].includes(act)) this.input.lock();
    switch (act) {
      case 'continue': {
        const s = loadSave();
        if (s) this.deploy(s, () => this.startRun(s));
        break;
      }
      case 'new': this.screens.show('new'); break;
      case 'start': this.deploy({ night: 1, difficulty: el.dataset.diff }, () => this.newCampaign(el.dataset.diff)); break;
      case 'howto': this.prevScreen = this.screens.current; this.screens.show('howto'); break;
      case 'medals': this.prevScreen = this.screens.current; this.screens.buildMedals(this.medals); this.screens.show('medals'); break;
      case 'settings':
        this.prevScreen = this.screens.current;
        this.screens.buildSettings(this.settings, this.state !== 'menu');
        this.screens.show('settings');
        break;
      case 'settings-back':
        if (this.state === 'menu' && (QUALITY[this.settings.quality] !== this.quality || !this.settings.benchmarked)) { this.reloadWithLoader(); return; }
        this.screens.show(this.prevScreen || 'menu');
        break;
      case 'back': this.screens.show(this.state === 'paused' ? 'pause' : (this.prevScreen && this.prevScreen !== 'howto' && this.prevScreen !== 'settings' ? this.prevScreen : 'menu')); break;
      case 'dev': this.dev.toggle(true); break;
      case 'quit': window.bastion?.quit(); break;
      case 'resume': this.resume(); break;
      case 'abandon': this.abandonNight(); break;
      case 'open-logs': window.bastion?.openTelemetry?.(); break;
      case 'buy': this.buyUpgrade(el.dataset.id); break;
      case 'buy-mines': this.buyMines(); break;
      case 'begin': this.beginNightFromShop(); break;
      case 'bay': this.hangar.go(el.dataset.bay); break;
      case 'shop-menu': writeSave(this.run); this.enterMenu(); break;
      case 'retry': { const s = this.run && this.run.dev ? this.devSave : loadSave(); if (s) this.deploy(s, () => this.startRun(s)); break; }
      case 'menu': this.enterMenu(); break;
      case 'endless': this.run.endless = true; writeSave(this.run); this.audio.setMusicMode('dawn'); this.openShop(); break;
      case 'ending-skip': if (this.state === 'prologue') this.prologue.skipPress(); else if (this.state === 'extraction') this.extraction.skipPress(); else this.ending.skipPress(); break;
      case 'victory-new': this.enterMenu(); this.screens.show('new'); break;
      case 'chronicle-next': this.chronicle.advance(); break;
      default: break;
    }
  }

  newCampaign(diffId) {
    const d = DIFFICULTY[diffId] || DIFFICULTY.veteran;
    const run = {
      difficulty: d.id, night: 1, survivors: d.survivors, supplies: 0, kills: 0,
      upgrades: {}, minesOwned: 0, endless: false,
      totals: { shots: 0, hits: 0, headshots: 0 },
      log: [],
    };
    clearSave();
    writeSave(run);
    this.medals.newCampaign();
    this.startRun(run, { prologue: true });
  }

  /** opts.prologue: a new campaign, so the sunset before the first night plays first. */
  startRun(save, opts = {}) {
    this.run = JSON.parse(JSON.stringify(save));
    this.newRecord = false;
    this.run.totals = this.run.totals || { shots: 0, hits: 0, headshots: 0 };
    this.run.log = this.run.log || [];
    // saves from before the Molotovs: the napalm upgrade carries over to the bottles
    const up = this.run.upgrades || (this.run.upgrades = {});
    if (up.napalm) { up.molotov = Math.max(up.molotov || 0, up.napalm); delete up.napalm; }
    this.diff = DIFFICULTY[this.run.difficulty] || DIFFICULTY.veteran;
    this.stats = this.computeStats();
    if (this.run.atShop) {
      // resume at the dawn resupply where the player left off
      this.report = null;
      this.env.dawn = 1;
      this.player.reset();
      this.player.gun.visible = true;
      this.horde.clear();
      this.audio.setMusicMode('dawn');
      this.openShop();
      return;
    }
    if (opts.prologue && this.run.night === 1) this.playPrologue();
    else this.startNight();
  }

  /** The last evening before the first night (src/game/prologue.js); night 1 follows. */
  playPrologue() {
    // (the menu's night has Spectre up: the evening before the first night has nothing in the sky)
    this.arsenal.air.hide();
    this.state = 'prologue';
    this.stateT = 0;
    this.prologue.start();
  }

  onPrologueDone() {
    if (this.state !== 'prologue') return;
    this.startNight();
  }

  computeStats() {
    const s = baseStats();
    for (const u of UPGRADES) {
      const r = this.run.upgrades[u.id] || 0;
      if (r > 0) u.apply(s, r);
    }
    return s;
  }

  startNight() {
    const run = this.run;
    const diff = DIFFICULTY[run.difficulty];
    this.diff = diff;
    this.stats = this.computeStats();
    this.plan = nightPlan(run.night, diff);
    this.audio.stopVoice();
    this.horde.clear();
    this.horde.pileMul = diff.pileMul;
    this.fx.glow.clear(); this.fx.smoke.clear(); this.fx.gibs.clear();
    this.fx.lights.releaseAll();
    this.arsenal.minesOwned = run.minesOwned;
    this.arsenal.startNight(this.stats, false, run.night);
    this.director.start(this.plan);
    this.player.reset();
    this.env.setStory(run.night, run.endless);
    if (this.env.crows) this.env.crows.reset();
    this.env.dawn = 0;
    this.ns = { kills: 0, headshots: 0, lost: 0, shots: 0, hits: 0, bestStreak: 0, supplies: 0, bonus: 0, fireKills: 0 };
    this.medals.startNight(run);
    this.killTimes.length = 0;
    this.alertCd.fill(0);
    this.doneT = 0;
    this.horde.globalSpeed = 1;
    this.screens.show(null);
    this.hud.show(true);
    this.hud.radioQueue.length = 0;
    this.hud.clearAlerts();
    // radio script for the night
    // the last night with enough of us left: the extraction flight is coming (ExtractionHold)
    this.extracting = run.night === FINAL_NIGHT && !run.endless && run.survivors >= EXTRACTION.souls;
    const lines = this.extracting ? [] : (run.night <= FINAL_NIGHT && !run.endless) ? RADIO[run.night] : [pick(RADIO.endless), pick(RADIO.endless)];
    this.events.start(run.night, run.endless || run.night > FINAL_NIGHT);
    if (this.extracting) { const hold = new ExtractionHold(this); hold.start(); this.events.active.push(hold); }
    this.radioScript = (lines || []).map((l, i) => ({ at: i === 0 ? 4 : this.plan.duration * 0.42, who: l[0], text: l[1], done: false }));
    // new tools tonight: told over the radio, flagged on the HUD when you take the gun
    this.newUnlocks = Object.keys(UNLOCKS).filter((k) => UNLOCKS[k] === run.night && !run.endless);
    (UNLOCK_LINES[run.night] && !run.endless ? UNLOCK_LINES[run.night] : []).forEach((l, i) => this.radioScript.push({ at: 10 + i * 7, who: l[0], text: l[1], done: false }));
    this.radioScript.sort((a, b) => a.at - b.at);
    if (!isUnlocked('grenades', run.night)) this.arsenal.grenadesLeft = 0;
    if (!isUnlocked('molotov', run.night)) this.arsenal.molotovsLeft = 0;
    this.telemetry.startNight(run, this.plan, this.stats, Object.keys(UNLOCKS).filter((k) => isUnlocked(k, run.night)));
    this.audio.night = run.night;
    this.audio.setMusicMode('night');
    // cinematic camera move into the gun
    this.state = 'intro';
    this.stateT = 0;
    this.introFrom = { pos: this.camera.position.clone(), quat: this.camera.quaternion.clone() };
    this.introLen = 2.8;
    this.introSlope = 0;
    this.introRaised = false;
    if (this.introCarry) {
      // straight on from the prologue's last shot, at the speed it was moving (src/game/prologue.js)
      const c = this.introCarry;
      this.introCarry = null;
      this.introLen = c.len; this.introSlope = c.slope; this.introFrom.fov = c.fov;
    }
    this.player.gun.visible = false;
    if (this.fromCard) {
      // high over the base behind the tower, looking down the valley: it sinks into the nest
      const c = new THREE.Object3D();
      c.position.set(16, 34, 26);
      c.lookAt(-8, 2, -110);
      this.introFrom = { pos: c.position.clone(), quat: c.quaternion.clone() };
      this.introLen = 7.5;
    }
    this.letterboxTarget = 1;
    const hoursLeft = Math.max(0, 72 - (run.night - 1) * 8);
    const sub = run.endless || run.night > FINAL_NIGHT ? 'NOBODY IS COMING'
      : run.night === FINAL_NIGHT ? (this.extracting ? 'HOLD FOR THE EXTRACTION FLIGHT' : 'THE LAST NIGHT') : `${hoursLeft} HOURS UNTIL EXTRACTION`;
    // (after the night's card the title has been said: no second one over the field)
    if (!this.fromCard) this.hud.announce(`NIGHT ${String(run.night).padStart(2, '0')}`, sub, 4.2);
    this.issueLoadout(run);
    this.coach.start();
    this.audio.init();
  }

  /**
   * What came out of the hangar at the last dawn: a card in the top-right corner, and the
   * gun's fitted upgrades under its heat bar.
   * run.issued is the kit as it stood at the start of the last night (the save keeps it).
   */
  issueLoadout(run) {
    const roman = ['', 'I', 'II', 'III', 'IV', 'V'];
    this.hud.mods(Object.keys(GUN_MODS).filter((id) => run.upgrades[id]).map((id) => `${GUN_MODS[id]} ${roman[run.upgrades[id]] || run.upgrades[id]}`).join(' · '));
    const prev = run.issued;
    run.issued = { ...run.upgrades, claymores: run.minesOwned };
    if (!prev) { this.hud.loadout([]); return; } // a save from before this: nothing to compare with
    const fresh = UPGRADES.filter((u) => (run.upgrades[u.id] || 0) > (prev[u.id] || 0));
    const items = fresh.map((u) => ({ name: u.name, rank: run.upgrades[u.id], max: u.costs.length, what: u.total(run.upgrades[u.id]) }));
    const mines = run.minesOwned > (prev.claymores || 0);
    if (mines) items.push({ name: 'CLAYMORES', rank: 0, max: 0, what: `${run.minesOwned} in the approach` });
    // (the card in the corner is the whole of it: nobody reads the list out over the radio)
    this.hud.loadout(items, this.fromCard ? 6.5 : 2.5);
  }

  pause() {
    if (this.state !== 'night') return;
    this.state = 'paused';
    this.pausedAt = performance.now();
    const tn = document.getElementById('tele-note');
    if (tn) tn.textContent = this.telemetry.path ? `Play-test log: ${this.telemetry.path}` : '';
    this.screens.show('pause');
    this.audio.setMuffle(0.7);
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'night';
    this.screens.show(null);
    this.audio.setMuffle(0);
    if (!TEST) this.input.lock();
  }

  abandonNight() {
    // retreat to the last dawn save
    this.telemetry.endNight('abandoned');
    this.audio.setMuffle(0);
    this.arsenal.endNight();
    this.enterMenu();
  }

  /** A medal won: a card slides in at the top right, wherever the game is (queued, one at a time). */
  medalToast(m) {
    (this._medalQ || (this._medalQ = [])).push(m);
    if (this._medalQ.length > 1) return;
    const next = () => {
      const q = this._medalQ, cur = q[0];
      if (!cur) return;
      const el = document.getElementById('medal-toast');
      el.innerHTML = `<div class="mt-art">${medalSVG(cur, { suffix: '-toast' })}</div><div class="mt-text"><div class="mt-kicker">MEDAL AWARDED</div><div class="mt-name">${cur.name}</div><div class="mt-req">${cur.req}</div></div>`;
      el.className = `show ${cur.grade}`;
      this.audio.uiBuy?.();
      setTimeout(() => { el.className = cur.grade; setTimeout(() => { q.shift(); next(); }, 600); }, 5200);
    };
    next();
  }

  // ── Events from the world ────────────────────────────────────────────────
  inPlay() { return this.state === 'night' || this.state === 'intro'; }

  onKill(type, cause, x, y, z, headshot) {
    if (!this.run || !this.inPlay()) return;
    const run = this.run;
    run.kills++;
    this.ns.kills++;
    this.telemetry.kill(type, cause, headshot);
    this.medals.kill(run, type, cause, headshot);
    if (headshot) { this.ns.headshots++; run.totals.headshots++; }
    if (cause === 'fire') this.ns.fireKills++;
    const sup = ZOMBIE_TYPES[type].supplies * this.diff.supplyMul * this.plan.supplyMul;
    run.supplies += sup;
    this.ns.supplies += sup;
    this.hud.kill();
    this.killTimes.push(this.time);
    if (type === ZT.BRUTE) this.hud.alert('BRUTE DOWN', '');
    if (cause === 'hmg' && headshot && Math.random() < 0.12) this.audio.gib(x, z, 0.3);
    if (type === ZT.BLOATER) this.audio.bloater(x, z);
    else if (type === ZT.BRUTE) this.audio.bodyfall(x, z);
  }

  onExplosionKills(kills, x, z, cause) {
    if (!this.inPlay() && this.state !== 'menu') return;
    if (kills >= 3 && this.state !== 'menu') this.audio.gib(x, z);
    if (this.inPlay()) this.medals.blast(this.run, kills, cause);
    if (kills >= 14 && this.slowmoCd <= 0 && this.state === 'night') {
      this.slowmo = 0.75;
      this.slowmoCd = 6;
      this.radial = 1;
      this.audio.setMuffle(0.45);
      this.hud.carnage(`${kills} IN ONE BLAST`, 'big red');
      if (Math.random() < 0.5) this.bark('massacre', 0.3);
    }
    void cause;
  }

  onBreach(sec, x, y, z, cause = 'climb') {
    if (this.inPlay()) { this.telemetry.breach(sec, cause); this.medals.breach(this.run); }
    if (this.state === 'menu') return;
    if (!this.inPlay()) return;
    const run = this.run;
    run.survivors = Math.max(0, run.survivors - 1);
    this.ns.lost++;
    this.damagePulse = 1;
    this.player.addTrauma(0.35);
    this.audio.scream(x, z);
    this.hud.alert('', 'red', { key: 'breach', item: SECTION_LABELS[sec] ?? 'WALL', format: (s, n) => `BREACH — ${s.join(' · ')} — ${n === 1 ? 'WE LOST ONE' : `WE LOST ${n}`}` });
    this.bark('breach', 0.35);
    this.coach.breach(sec);
    // the climber is cut down on the walkway: blood on the parapet
    this.fx.headshot(x, WORLD.WALL_H + 1, z, 0, 0.4, 1);
    if (run.survivors <= 0) this.fall();
  }

  onBloaterWall(sec, x, z) {
    if (!this.inPlay()) return;
    this.damagePulse = Math.max(this.damagePulse, 0.35);
    this.hud.alert('', 'red', { key: 'acid', item: SECTION_LABELS[sec], format: (s) => `ACID ON ${s.join(' · ')} — A RAMP IS MELTING INTO THE WALL` });
    this.fx.explosion(x, 1.5, z, 0.6, { dirt: false, scorch: false, color: 1 });
    this.audio.acid(x, z);
    this.ns.acid = (this.ns.acid || 0) + 1;
  }

  onDirectorEvent(kind, e) {
    if (this.state === 'menu') return;
    if (kind === 'surgeWarn') {
      const side = e.cx < -30 ? 'LEFT FLANK' : e.cx > 30 ? 'RIGHT FLANK' : 'CENTRE';
      this.hud.alert('', '', { key: 'surge', item: side, format: (s) => `HORDE INBOUND — ${s.join(' & ')}` });
      this.audio.horn();
      this.bark('surge', 0.6);
    } else if (kind === 'tideWarn') {
      this.hud.announce('THE TIDE', 'EVERYTHING THEY HAVE', 4, 'red');
      this.audio.setTide(true);
      this.audio.horn();
      setTimeout(() => this.audio.horn(), 1800);
    }
  }

  bark(kind, chance = 1) {
    if (this.barkCd > 0 || Math.random() > chance) return;
    this.barkCd = 12;
    this.hud.radio(CALL.kovac, pick(BARKS[kind]), true, { ttl: 4 });
  }

  // ── Night end / fall ─────────────────────────────────────────────────────
  /** The books for a night that was held: supplies, totals, the save (at the next dawn's shop). */
  settleNight() {
    const run = this.run;
    const bonus = Math.round(SUPPLY_BONUS(run.night, run.survivors) * this.diff.supplyMul);
    run.supplies += bonus;
    this.ns.bonus = bonus;
    this.ns.shots = this.player.shots;
    this.ns.hits = this.player.hits;
    run.totals.shots += this.player.shots;
    run.totals.hits += this.player.hits;
    run.supplies = Math.round(run.supplies);
    // (a kill's share is fractional: the night's sum is a float like 523.4800000000003)
    this.ns.supplies = Math.round(this.ns.supplies);
    this.report = { ...this.ns };
    for (const r of this.radioScript) run.log.push([r.who, r.text]);
    run.log = run.log.slice(-8);
    const survived = run.night;
    run.night++;
    run.minesOwned = this.arsenal.minesOwned;
    run.atShop = true;
    writeSave(run);
    // endless: every dawn past the seventy-second hour counts toward the record
    if (run.endless && !run.dev && survived > FINAL_NIGHT) this.newRecord = recordBest(survived - FINAL_NIGHT, run.kills, run.difficulty) || this.newRecord;
    this.telemetry.endNight('survived');
    this.medals.nightHeld(run, survived, this.report);
    return survived;
  }

  endNight() {
    const run = this.run;
    document.getElementById('scope').classList.remove('on');
    this.hud.hint('');
    this.state = 'dawn';
    this.stateT = 0;
    this.events.reset();
    this.arsenal.endNight();
    this.ignoreUnlock = true;
    this.input.unlock();
    setTimeout(() => { this.ignoreUnlock = false; }, 300);
    // the night as it will be remembered: told over the dawn, kept for the resupply screen
    this.story = composeChronicle({
      night: run.night, endless: run.endless, log: this.events.log || [], ns: this.ns,
      survivors: run.survivors, dangerUsed: this.arsenal.dangerUsed,
    });
    run.chronicle = { night: this.story.night, title: this.story.title, lines: this.story.lines };
    this.chronicleStarted = false;
    this.voiceUntil = null;
    const survived = this.settleNight();
    this.hud.announce('DAWN', `NIGHT ${String(survived).padStart(2, '0')} SURVIVED · ${run.survivors} ALIVE`, 5);
    this.hud.radio(CALL.kovac, pick(BARKS.dawn), true);
    this.audio.setMusicMode('dawn');
    this.audio.setTide(false);
    this.audio.pressure = 0; this.audio.lowLife = false;
    this.victory = survived === FINAL_NIGHT && !run.endless;
  }

  openShop() {
    this.state = 'shop';
    this.input.unlock(); // (a "continue" click takes the mouse; the hangar wants it back)
    this.arsenal.air.hide();
    this.hud.show(false);
    const first = !this.hangar.built;
    this.hangar.enter(this.run, this.report);
    if (first) this.compileScene(this.hangar.scene, this.hangar.camera).catch(() => {});
    this.screens.buildShop(this.run, this.report);
    this.screens.show('shop');
  }

  buyUpgrade(id) {
    const u = UPGRADES.find((x) => x.id === id);
    const run = this.run;
    const rank = run.upgrades[id] || 0;
    if (!u || rank >= u.costs.length) return;
    const cost = u.costs[rank];
    if (run.supplies < cost) return;
    run.supplies -= cost;
    run.upgrades[id] = rank + 1;
    this.telemetry.purchase(id, rank + 1, cost, run.supplies);
    this.medals.purchase(run, id);
    this.audio.uiBuy();
    this.screens.buildShop(run, this.report);
  }

  buyMines() {
    const run = this.run;
    if (run.supplies < CLAYMORE.cost || run.minesOwned + CLAYMORE.perBuy > CLAYMORE.max) return;
    run.supplies -= CLAYMORE.cost;
    run.minesOwned += CLAYMORE.perBuy;
    this.telemetry.purchase('claymores', run.minesOwned, CLAYMORE.cost, run.supplies);
    this.medals.purchase(run, 'claymores');
    this.audio.uiBuy();
    this.screens.buildShop(run, this.report);
  }

  beginNightFromShop() {
    if (this.leavingShop) return;
    this.run.atShop = false;
    writeSave(this.run);
    // (the smoke tests step straight into the night; test.leaveShop() runs the walk-out)
    if (TEST && !this.walkOut) { this.startNight(); return; }
    this.leaveShop();
  }

  /**
   * From the hangar to the night, as one move: the camera walks out through the hangar door
   * while the screen goes black, the night's card comes up with the siren winding outside, and
   * it opens on the valley from high over the base, settling down into the gun.
   */
  async leaveShop() {
    this.leavingShop = true;
    const run = this.run, n = run.night;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      this.audio.ui();
      this.hangar.leave();
      document.getElementById('s-shop')?.classList.add('leaving');
      const diff = DIFFICULTY[run.difficulty] || DIFFICULTY.veteran;
      const past = run.endless || n > FINAL_NIGHT;
      const hours = Math.max(0, 72 - (n - 1) * 8);
      const fresh = Object.keys(UNLOCKS).filter((k) => UNLOCKS[k] === n && !run.endless).map((k) => UNLOCK_INFO[k]);
      const souls = run.survivors ?? 0;
      const sub = past ? 'NOBODY IS COMING'
        : n === FINAL_NIGHT ? (souls >= EXTRACTION.souls ? 'HOLD FOR THE EXTRACTION FLIGHT' : 'THE LAST NIGHT')
          : `${hours} HOURS UNTIL EXTRACTION`;
      const tag = fresh.length ? `New tonight: ${fresh.join(' · ')}` : n === FINAL_NIGHT && souls < EXTRACTION.souls ? 'Too few of us left for the flight. Hold anyway.' : '';
      await this.nightCard.show({ night: n, past, sub, tag, kicker: `BASTION-7 · ${diff.label} · ${souls} ON THE WALL` });
      // black: out there, the siren starts up, and the night is set going behind the card
      this.audio.horn();
      this.audio.thunder(1.6);
      document.getElementById('s-shop')?.classList.remove('leaving');
      this.fromCard = true;
      this.startNight();
      // under the card: anything the night brings that hasn't had its shaders built yet
      const t0 = performance.now();
      await this.precompile();
      await wait(Math.max(0, 3200 - (performance.now() - t0)));
      await this.nightCard.hide();
    } finally {
      this.fromCard = false;
      this.leavingShop = false;
    }
  }

  fall() {
    if (this.state === 'fallen') return;
    document.getElementById('scope').classList.remove('on');
    this.telemetry.endNight('fallen');
    this.state = 'fallen';
    this.stateT = 0;
    this.events.reset();
    this.ignoreUnlock = true;
    this.input.unlock();
    this.hud.announce('THE WALL HAS FALLEN', '', 6, 'red');
    this.audio.setMusicMode('gameover');
    this.slowmo = 2.5;
    this.audio.setMuffle(0.6);
    this.run.totals.shots += this.player.shots;
    this.run.totals.hits += this.player.hits;
  }

  // ── Main loop ────────────────────────────────────────────────────────────
  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    if (this.frozen) { this.last = now; return; } // smoke tests drive every frame themselves
    const rdt = Math.min(0.05, Math.max(0.0001, (now - this.last) / 1000));
    this.last = now;
    this.step(rdt);
  }

  step(rdt) {
    // time dilation for big moments
    if (this.slowmo > 0) {
      this.slowmo -= rdt;
      this.timeScale = damp(this.timeScale, 0.28, 12, rdt);
      if (this.slowmo <= 0 && this.state !== 'fallen') this.audio.setMuffle(0);
    } else this.timeScale = damp(this.timeScale, 1, 6, rdt);
    this.slowmoCd = Math.max(0, this.slowmoCd - rdt);
    // the developer's free camera: the game holds still and only the ambient world goes on;
    // a cutscene plays on under it (at the camera's pace: paused, slowed, sped up)
    const flying = this.freecam.on;
    const cine = flying && this.freecam.cine ? this.freecam.cineStep(rdt) : -1;
    const paused = cine === 0 || (!flying && this.state === 'paused');
    const dt = paused ? 0 : cine > 0 ? cine : flying ? rdt : rdt * this.timeScale;
    this.time += dt;
    setSoldierClock(this.time);
    if (!flying) this.stateT += rdt;
    else if (cine > 0) this.stateT += cine;
    this.barkCd = Math.max(0, this.barkCd - rdt);

    // the gun left in the nest for the victory screen goes back on the camera when it closes
    if (this.victoryGun && this.state !== 'victory') { this.victoryGun = false; this.ending.restoreGun(); this.player.gun.visible = true; }
    if (this.coach && !flying) this.coach.update(dt);
    if (cine > 0) this[this.state].update(cine, cine); // this.prologue / this.ending / this.extraction
    if (flying) this.freecam.update(rdt);
    else switch (this.state) {
      case 'menu': this.updateMenu(dt, rdt); break;
      case 'intro': this.updateIntro(dt, rdt); break;
      case 'night': if (!paused) this.updateNight(dt, rdt); else this.player.update(0, rdt, this.input, this.stats, false, this.time); break;
      case 'dawn': this.updateDawn(dt, rdt); break;
      case 'shop': this.updateShop(dt, rdt); break;
      case 'fallen': this.updateFallen(dt, rdt); break;
      case 'prologue': this.prologue.update(dt, rdt); break;
      case 'ending': this.ending.update(dt, rdt); break;
      case 'extraction': this.extraction.update(dt, rdt); break;
      case 'victory': this.updateVictory(dt, rdt); break;
      default: break;
    }

    if (!paused) {
      if (!flying || cine > 0) this.horde.syncRender();
      this.env.update(dt, this.time, this.horde, this.fx, this.audio);
      this.fx.update(dt);
    }
    this.audio.setListener(this.camera.position.x, this.camera.position.z, this.camera.rotation.y, this.camera.position.y);
    this.audio.dawn = this.env.dawn;
    this.audio.hordeAlive = flying && cine < 0 ? 0 : this.horde.alive;
    this.audio.update(rdt);
    if (!this.noRender) this.render(rdt);
    this.input.endFrame();
  }

  /** The loading-screen painting for the deployment card of night n. */
  nightArt(n) {
    const ev = (NIGHT_EVENTS[n] || []).map((e) => e[0]);
    if (ev.includes('drop')) return 'drop';
    if (ev.includes('giant') || ev.includes('behemoth')) return 'giant';
    if (ev.includes('gunshipDown') || n === UNLOCKS.gunship) return 'gunship';
    return n % 2 ? 'wall' : 'nest';
  }

  render(rdt) {
    const u = this.post.u;
    const freeView = this.freecam.on && !this.freecam.follow;
    this.letterbox = freeView ? 0 : damp(this.letterbox, this.letterboxTarget || 0, 3, rdt);
    this.damagePulse = Math.max(0, this.damagePulse - rdt * 0.9);
    this.flashPulse = Math.max(0, this.flashPulse - rdt * 3);
    this.radial = Math.max(0, this.radial - rdt * 1.4);
    const lowLife = this.run && this.inPlay() && this.run.survivors <= 5 ? 0.25 + 0.15 * Math.sin(this.time * 6) : 0;
    u.uLetterbox.value = this.letterbox;
    u.uDamage.value = Math.max(this.damagePulse, lowLife, this.state === 'fallen' ? Math.min(1, this.stateT * 0.4) : 0);
    u.uFlash.value = this.flashPulse + this.env.flash * 0.04;
    u.uRadial.value = this.radial;
    u.uDesat.value = this.state === 'fallen' ? Math.min(0.85, 0.28 + this.stateT * 0.15) : lerp(0.28, 0.4, this.env.dawn) - this.env.dusk * 0.2;
    u.uExposure.value = lerp(1.25, 1.2, this.env.dawn);
    u.uWarm.value = this.env.dawn * 0.3 * (1 - this.env.dusk) + this.env.dusk * 0.45;
    u.uCA.value = 0.0025 + this.player.trauma * 0.005 + this.radial * 0.012;
    // the dawn resupply is drawn in the hangar: its own scene and camera through the same post chain
    const inHangar = this.state === 'shop' && this.hangar.active;
    if (!inHangar && this.hangar.active) this.hangar.exit();
    this.post.scenePass.scene = inHangar ? this.hangar.scene : this.scene;
    this.post.scenePass.camera = inHangar ? this.hangar.camera : this.camera;
    // the hangar is graded like daylight indoors, not like the night: a gentle curve, soft
    // colour, no lens glare (the night's look crushed its shadows and blew out every lamp)
    // (more contrast in the valley: a stronger S-curve, so the fires, beams and lit faces stand out
    // of the dark. uBlack, a black point, is there to crush the darks further, but even 0.0025 lost
    // the ground at night)
    u.uCurve.value = inHangar ? 0.3 : 0.55; u.uBlack.value = 0; u.uTint.value = inHangar ? 0.75 : 1;
    u.uFlare.value = inHangar ? 0.008 : 0.035; u.uStreak.value = inHangar ? 0.004 : 0.025; u.uDirt.value = inHangar ? 0.015 : 0.07;
    this.post.bloom.strength = inHangar ? 0.2 : 0.42;
    if (inHangar) {
      u.uHeatN.value = 0; u.uShockN.value = 0;
      // graded grim: drained, contrasty, cold in the shadows (the dawn is outside, not in here)
      u.uDesat.value = 0.4; u.uExposure.value = 1.0; u.uWarm.value = 0.04; u.uCA.value = 0.0015;
    } else this.post.updateDistortion(this.env.fire.heatSources, this.fx.shocks);
    // pixel size for eye billboards
    const h = this.renderer.getDrawingBufferSize(this._sz || (this._sz = new THREE.Vector2())).y;
    this.uniforms.uPixel.value = 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) / h;
    this.uniforms.uEyeGlow.value = lerp(9, 1.2, this.env.dawn);
    this.uniforms.uEyeGlowBillboard.value = 1 - this.env.dawn;
    this.uniforms.uLampPow.value = this.env.power * Math.max(0, 1 - this.env.dawn * 1.6);
    this.uniforms.uRim.value.setRGB(0.032, 0.014, 0.006).multiplyScalar(1 - this.env.dawn * 0.5);
    if (this.freecam.on) u.uExposure.value *= this.freecam.bright;
    if (freeView) u.uFade.value = 1; // a cutscene's dips to black are for its own cuts
    this.post.render(rdt, this.time);
    if (this.settings.showFps) {
      this.fps.acc += rdt; this.fps.n++;
      if (this.fps.acc > 0.5) {
        this.hud.fps(`${Math.round(this.fps.n / this.fps.acc)} FPS · ${this.horde.n} DEAD WALKING · ${this.renderer.info.render.calls} DC`);
        this.fps.acc = 0; this.fps.n = 0;
      }
    }
  }

  // ── States ───────────────────────────────────────────────────────────────
  menuCamPose(t) {
    // a slow crane shot over the right wing, down the valley toward the burning city
    const a = Math.sin(t * 0.03);
    const pos = new THREE.Vector3(46 + a * 14, 24 + Math.sin(t * 0.045) * 2.5, -16 + Math.cos(t * 0.03) * 5);
    const look = new THREE.Vector3(-18 + Math.sin(t * 0.021) * 22, 0, -135);
    return { pos, look };
  }

  updateMenuCamera(t) {
    const { pos, look } = this.menuCamPose(t);
    this.camera.position.copy(pos);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(look);
    const mf = fitFov(55, this.camera.aspect);
    if (Math.abs(this.camera.fov - mf) > 0.01) { this.camera.fov = mf; this.camera.updateProjectionMatrix(); }
  }

  spawnMenuZombie(z) {
    const r = Math.random();
    const type = r < 0.8 ? ZT.SHAMBLER : r < 0.92 ? ZT.RUNNER : r < 0.97 ? ZT.BRUTE : ZT.BLOATER;
    this.horde.spawn(type, rand(-140, 140), z ?? rand(-170, -110), 1, 0.9);
  }

  updateMenu(dt, rdt) {
    this.updateMenuCamera(this.time);
    // attract mode: the dead walk, the wall answers
    if (this.horde.n < 420 && Math.random() < dt * 9) this.spawnMenuZombie();
    this.menuArtyT -= dt;
    if (this.menuArtyT <= 0) {
      this.menuArtyT = rand(7, 12);
      const c = this.horde.densest(30, 200, 30, 8);
      if (c) this.arsenal.callArtillery({ x: c.x, z: c.z }) || (this.arsenal.artyCd = 0);
      this.arsenal.artyCd = 0;
    }
    this.arsenal.update(dt, this.time);
    this.horde.update(dt, this.time);
    this.groans(dt);
    void rdt;
  }

  updateIntro(dt, rdt) {
    const T = this.introLen || 2.8;
    const k = Math.min(1, this.stateT / T);
    // smootherstep: it comes to rest with no speed and no deceleration left, so the hand-off to
    // the gun's own camera is seamless. Carried on from a moving shot, it starts at that shot's
    // speed (slope s, in path per unit k) and still comes to rest the same way (a quartic).
    const sl = this.introSlope || 0;
    const e = sl > 0 ? k * (sl + k * ((6 - 3 * sl) + k * ((3 * sl - 8) + k * (3 - sl))))
      : k * k * k * (k * (k * 6 - 15) + 10);
    // target pose = gunner pose
    const target = new THREE.Object3D();
    target.position.set(WORLD.CAM.x, WORLD.CAM.y, WORLD.CAM.z);
    target.rotation.order = 'YXZ';
    target.rotation.set(this.player.pitch, this.player.yaw, 0);
    target.updateMatrixWorld();
    this.camera.position.lerpVectors(this.introFrom.pos, target.position, e);
    this.camera.quaternion.slerpQuaternions(this.introFrom.quat, target.quaternion, e);
    // the gun is taken up from below as the camera settles behind it
    // (an intro skipped straight past its end: the gun is simply there)
    if (!this.introRaised && this.stateT >= T + 0.2) { this.introRaised = true; this.player.raise = 1; this.player.raising = false; this.player.gun.visible = true; }
    if (!this.player.raising && this.player.raise >= 1 && !this.introRaised && this.stateT >= T - Math.min(1.1, T * 0.4)) {
      this.introRaised = true;
      this.player.takeUp(1.35);
      const B = this.audio.B;
      if (this.audio.ready && B && B.charge && B.charge[0]) { this.audio.play(B.charge[0], { gain: 0.45, reverb: 0.25, pan: 0.1, delay: 0.55, force: true }); this.audio.play(B.charge[0], { gain: 0.38, rate: 0.94, reverb: 0.25, pan: 0.1, delay: 1.2, force: true }); }
    }
    if (!this.introRaised) this.player.gun.visible = false;
    this.player.poseGun(dt, rdt);
    const fov = fitFov(lerp(this.introFrom.fov ?? 55, this.settings.fov, e), this.camera.aspect);
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
    this.director.update(dt);
    this.horde.update(dt, this.time);
    this.arsenal.update(dt, this.time);
    this.hud.update(rdt, this);
    if (k >= 1) {
      this.state = 'night';
      this.stateT = 0;
      this.camera.rotation.setFromQuaternion(this.camera.quaternion, 'YXZ');
      this.letterboxTarget = 0;
      if (!this.input.locked && !TEST) this.input.lock(); // (taken at the click that began it; Electron grants it here too)
      const n = this.run.night, keys = ['LMB FIRE', 'RMB OPTICS'];
      if (isUnlocked('artillery', n)) keys.push('Q ARTILLERY');
      if (isUnlocked('molotov', n)) keys.push('E MOLOTOV');
      if (isUnlocked('bomber', n)) keys.push('T BOMBER MARKER');
      if (isUnlocked('grenades', n)) keys.push('G GRENADES');
      this.hud.hint(keys.join(' · '));
      // (what's new tonight is taught by the coach's tips, src/ui/coach.js UNLOCK_TIPS)
      setTimeout(() => this.hud.hint(''), 9000);
    }
  }

  updateNight(dt, rdt) {
    const input = this.input;
    const active = input.locked || TEST;
    const run = this.run;
    // the crows near where the fifty's rounds are landing go up
    if (this.player.firing && this.env.crows && (this.crowT = (this.crowT || 0) - dt) <= 0) {
      this.crowT = 0.3;
      const at = this.player.aimPoint(320);
      this.env.crows.scare(at.x, at.z, 24);
    }

    // abilities (each arrives on its own night: see UNLOCKS)
    const can = (k) => isUnlocked(k, run.night);
    const T = this.telemetry;
    if (active) {
      if (input.hit('KeyQ') && can('artillery')) {
        const p = this.player.aimPoint(330);
        const ok = this.arsenal.callArtillery(p);
        T.ability('artillery', ok === true);
        this.medals.ability(run, 'artillery', ok === true);
        if (ok === 'close') this.hud.alert("TOO CLOSE TO THE WALL — THE BATTERY WON'T FIRE THERE", '', { key: 'arty-close', plain: true });
        else if (ok) {
          this.hud.alert(`FIRE MISSION — ${this.stats.artyShells} ROUNDS — SPLASH IN 3`);
          this.hud.radio(CALL.battery, COMMS.battery[this.stats.artyShells] || `Shot, over. ${this.stats.artyShells} rounds HE, splash in three.`, true, { valid: () => this.arsenal.shells.some((s) => s.kind === 'arty' && s.t > 1.2) });
        } else this.hud.alert(`BATTERY RELOADING — ${Math.ceil(this.arsenal.artyCd)}s`, '', { key: 'arty-cd', plain: true });
      }
      if (input.hit('KeyE') && can('molotov')) {
        const r = this.arsenal.throwMolotov(this.player.throwPoint(ABILITY.molotov.maxRange, this.horde), this.player.throwOrigin(-1));
        if (r !== 'rearm') T.ability('molotov', r === true);
        if (r === 'empty') this.hud.alert('NO BOTTLES LEFT', '', { key: 'molotov-empty', plain: true });
      }
      if (input.hit('KeyT') && can('bomber')) {
        const air = this.arsenal.air;
        const ok = air.throwMarker(this.player.aimPoint(ABILITY.bomber.maxRange));
        T.ability('bomber', ok === true);
        if (ok === 'close') this.hud.alert("TOO CLOSE TO THE WALL — HAMMER WON'T DROP THERE", '', { key: 'bomber-close', plain: true });
        else if (ok) {
          this.hud.alert('MARKER OUT — BOMBER INBOUND');
          this.hud.radio(CALL.kovac, COMMS.markerOut, true, { ttl: 3 });
        } else this.hud.alert(air.bomberBusy ? 'BOMBER ALREADY ON ITS RUN' : `BOMBER RE-ARMING — ${Math.ceil(air.bomberCd)}s`, '', { key: 'bomber-cd', plain: true });
      }
      if (input.hit('KeyG') && can('grenades')) {
        const r = this.arsenal.throwGrenade(this.player.throwPoint(ABILITY.grenade.maxRange, this.horde), this.player.throwOrigin(1));
        if (r !== 'rearm') T.ability('grenades', r === true);
        if (r === 'empty') this.hud.alert('NO GRENADES LEFT');
      }
      if (input.hit('KeyB') && can('dangerClose')) {
        T.ability('dangerClose', !this.arsenal.dangerUsed && run.survivors > ABILITY.dangerClose.cost, { survivors: run.survivors });
        if (this.arsenal.dangerUsed) this.hud.alert('DANGER CLOSE ALREADY CALLED');
        else if (run.survivors <= ABILITY.dangerClose.cost) this.hud.alert('NOT ENOUGH MEN LEFT TO PAY FOR IT', 'red');
        else if (this.arsenal.dangerClose()) {
          run.survivors -= ABILITY.dangerClose.cost;
          this.ns.lost += ABILITY.dangerClose.cost;
          this.hud.announce('DANGER CLOSE', 'THREE OF OURS WERE STILL ON THE WALL', 3.5, 'red');
          this.hud.radio(CALL.kovac, COMMS.dangerClose, true, { valid: () => this.arsenal.shells.some((s) => s.kind === 'danger') });
        }
      }
    }

    this.player.update(dt, rdt, input, this.stats, active, this.time);
    this.arsenal.update(dt, this.time);
    this.director.update(dt);
    this.events.update(dt);
    this.horde.update(dt, this.time);
    document.getElementById('scope').classList.toggle('on', this.player.zoom > 0.55);

    // radio script
    for (const r of this.radioScript) {
      if (!r.done && this.director.t >= r.at) { r.done = true; this.hud.radio(r.who, r.text); }
    }

    // carnage counter
    const window2 = 2.5;
    while (this.killTimes.length && this.time - this.killTimes[0] > window2) this.killTimes.shift();
    const streak = this.killTimes.length;
    if (streak > this.ns.bestStreak) this.ns.bestStreak = streak;
    if (streak >= 8 && streak !== this.carnageShown) {
      this.carnageShown = streak;
      const label = streak >= 80 ? 'ANNIHILATION' : streak >= 40 ? 'MASSACRE' : streak >= 20 ? 'SLAUGHTER' : 'CARNAGE';
      this.hud.carnage(`${label} ×${streak}`, streak >= 40 ? 'red big' : streak >= 20 ? 'big' : '');
    }

    // pile alerts
    let maxP = 0, maxS = -1;
    for (let s = 0; s < 10; s++) {
      const p = this.horde.pressure(s);
      if (p > maxP) { maxP = p; maxS = s; }
      this.alertCd[s] = Math.max(0, this.alertCd[s] - rdt);
      if (p > 0.62 && this.alertCd[s] <= 0) {
        this.alertCd[s] = 9;
        this.hud.alert('', p > 0.85 ? 'red' : '', { key: 'climb', item: SECTION_LABELS[s], format: (secs) => `THEY'RE CLIMBING — ${secs.join(' · ')}` });
        if (p > 0.8) this.audio.klaxon();
        this.bark('pile', 0.35);
      }
    }
    this.audio.intensity = clamp(this.horde.alive / 600 + maxP * 0.7, 0, 1);
    this.telemetry.frame(rdt, maxP, maxS);
    this.audio.pressure = maxP;
    this.audio.lowLife = this.run.survivors <= 5;
    this.groans(dt);
    this.burnScreams(dt);
    this.footfalls(dt);

    this.hud.update(rdt, this);

    // night over? (stragglers that won't come in fall back into the fog eventually)
    if (this.director.spawningDone) {
      this.doneT = (this.doneT || 0) + dt;
      this.horde.globalSpeed = 1.45; // stragglers hurry in
      if (this.horde.alive > 0 && !this.events.busy && (this.doneT > 110 || (this.horde.alive <= 6 && this.doneT > 45))) {
        this.horde.clearLiving();
        this.hud.alert('THE LAST OF THEM FALL BACK INTO THE FOG');
      }
      if (this.horde.alive === 0 && this.horde.pending.length === 0 && !this.events.busy) this.endNight();
    } else this.doneT = 0;
  }

  groans(dt) {
    const h = this.horde;
    this.groanAcc += dt * Math.min(5, h.alive / 70);
    while (this.groanAcc >= 1) {
      this.groanAcc -= 1;
      const i = h.randomAlive();
      if (i >= 0) this.audio.groan(h.x[i], h.z[i], h.type[i]);
    }
  }

  /**
   * The runners' feet: how many are sprinting at the wall near enough to hear (a brute stampede
   * counts heavier), and from which side, for the audio's running bed. Counted a few times a second.
   */
  footfalls(dt) {
    if ((this.footAcc = (this.footAcc || 0) + dt) < 0.25) return;
    this.footAcc = 0;
    const h = this.horde, A = this.audio, lx = A.listenerX, lz = A.listenerZ, yaw = A.listenerYaw;
    let w = 0, pan = 0;
    for (let i = 0; i < h.n; i++) {
      const t = h.type[i];
      if (h.dead[i] || (t !== ZT.RUNNER && t !== ZT.BRUTE)) continue;
      const dx = h.x[i] - lx, dz = h.z[i] - lz, d = Math.hypot(dx, dz);
      if (d < 14 || d > 170 || wallDist(h.x[i], h.z[i]) < 3) continue; // (not the ones already on the pile)
      const k = (t === ZT.BRUTE ? 1.6 : 1) / (1 + d / 35);
      w += k; pan += k * Math.sin(Math.atan2(dx, -dz) - yaw);
    }
    A.runners = clamp(w / 4, 0, 1);
    A.runnersPan = w > 0 ? pan / w : 0;
  }

  /** The ones still burning keep screaming until the fire or a bullet ends it. */
  burnScreams(dt) {
    const h = this.horde;
    let n = 0;
    for (let i = 0; i < h.n; i++) if (h.burn[i] > 0 && !h.dead[i]) n++;
    if (!n) { this.burnAcc = 0; return; }
    this.burnAcc += dt * Math.min(5, 0.6 + n * 0.3);
    while (this.burnAcc >= 1) {
      this.burnAcc -= 1;
      for (let k = 0; k < 12; k++) {
        const i = (Math.random() * h.n) | 0;
        if (h.burn[i] > 0 && !h.dead[i]) { this.audio.burnScream(h.x[i], h.z[i], h.type[i]); break; }
      }
    }
  }

  updateDawn(dt, rdt) {
    // first light: the dark lifts slowly, then the grey morning comes up over the valley
    const u = Math.min(1, this.stateT / 10);
    this.env.dawn = Math.max(this.env.dawn, u * u * (3 - 2 * u));
    // daylight reveals what the night left in the valley
    this.player.pitch = damp(this.player.pitch, -0.2, 0.7, rdt);
    this.player.yaw = damp(this.player.yaw, Math.sin(this.stateT * 0.12) * 0.35, 0.7, rdt);
    this.player.update(dt, rdt, this.input, this.stats, false, this.time);
    this.horde.update(dt, this.time);
    this.arsenal.update(dt, this.time);
    this.audio.intensity = 0;
    this.audio.pressure = 0;
    // once the light is coming up, the chronicle of the night is told over it
    // (no new radio lines once the light comes; the chronicle waits for the one still being
    // spoken to end, rather than cutting it off mid-word: that was the stutter at dawn)
    if (this.stateT > 3) {
      this.hud.radioQueue.length = 0;
      // (measured once, then counted in game time like everything else in the dawn)
      if (this.voiceUntil == null) this.voiceUntil = this.stateT + this.audio.voiceLeft();
    }
    if (!this.chronicleStarted && this.story && this.stateT > Math.max(5.5, Math.min(20, (this.voiceUntil ?? 0) + 0.6))) {
      this.chronicleStarted = true;
      this.hud.show(false);
      this.hud.radioQueue.length = 0;
      this.chronicle.play(this.story, () => { this.story = null; });
    }
    if (this.chronicle.active) this.chronicle.update(rdt);
    else this.hud.update(rdt, this);
    if (this.stateT > 11 && !this.chronicle.active && (this.chronicleStarted || !this.story)) {
      if (this.victory) this.playEnding();
      else this.openShop();
    }
  }

  /** The seventy-second hour is over: the ending, then the choice of endless nights or a new campaign. */
  playEnding() {
    this.arsenal.air.hide(); // the gunship's gone home: no drone over the morning
    this.state = 'ending';
    this.stateT = 0;
    this.ending.start();
  }

  /** The flight is overhead: the night is held, and the extraction plays (still at night). */
  playExtraction() {
    document.getElementById('scope').classList.remove('on');
    this.hud.hint('');
    this.settleNight();
    this.victory = true;
    this.events.reset();
    this.ignoreUnlock = true;
    this.input.unlock();
    setTimeout(() => { this.ignoreUnlock = false; }, 300);
    this.audio.setTide(false);
    this.state = 'extraction';
    this.stateT = 0;
    this.extraction.start();
  }

  onEndingDone(extracted = false) {
    this.medals.campaignEnd(this.run, extracted);
    this.state = 'victory';
    this.stateT = 0;
    this.hud.show(false);
    this.letterboxTarget = 0;
    // behind the summary: the bastion at first light, the gun still in the nest where they left it
    this.ending.placeGun();
    this.victoryGun = true;
    this.env.dawn = Math.max(this.env.dawn, 0.6);
    this.screens.buildVictory(this.run, loadBest(), extracted);
    this.screens.show('victory');
    this.audio.setMusicMode('victory');
  }

  updateShop(dt, rdt) {
    this.env.dawn = damp(this.env.dawn, 1, 1, rdt);
    // the valley goes on behind the hangar (not drawn): the last of the night's fires and bodies settle
    this.player.yaw = damp(this.player.yaw, 0, 0.5, rdt);
    this.player.pitch = damp(this.player.pitch, -0.17, 0.5, rdt);
    this.player.update(dt, rdt, this.input, this.stats, false, this.time);
    this.horde.update(dt, this.time);
    this.hangar.update(rdt);
  }

  /** The summary after the last night: a slow crane over the empty bastion at first light. */
  updateVictory(dt, rdt) {
    this.env.dawn = damp(this.env.dawn, 0.85, 0.3, rdt);
    const t = this.stateT, cam = this.camera;
    cam.position.set(-26 + Math.sin(t * 0.025) * 12, 22 + Math.sin(t * 0.04) * 2, 30 + Math.cos(t * 0.025) * 4);
    cam.up.set(0, 1, 0);
    cam.lookAt(Math.sin(t * 0.018) * 10, 6, -70);
    const f = fitFov(52, cam.aspect);
    if (Math.abs(cam.fov - f) > 0.01) { cam.fov = f; cam.updateProjectionMatrix(); }
    // the dead still walk the field below
    if (this.horde.n < 380 && Math.random() < dt * 8) this.spawnMenuZombie(rand(-150, -50));
    this.horde.update(dt, this.time);
  }

  updateFallen(dt, rdt) {
    // they keep coming; the camera drifts up and away
    if (this.horde.n < this.horde.limit - 10 && Math.random() < dt * 30) this.spawnMenuZombie(rand(-120, -60));
    this.director.update(dt);
    this.horde.update(dt, this.time);
    this.arsenal.update(dt, this.time);
    this.player.pitch = damp(this.player.pitch, -0.35, 0.5, rdt);
    this.player.update(dt, rdt, this.input, this.stats, false, this.time);
    this.camera.position.y += this.stateT * 0.8;
    this.camera.position.z += this.stateT * 1.2;
    this.camera.updateMatrixWorld(true);
    this.groans(dt);
    if (this.stateT > 5 && this.screens.current !== 'over') {
      this.hud.show(false);
      this.hud.radioQueue.length = 0;
      const epitaph = pick(CHRONICLE.fallen);
      this.screens.buildGameOver(this.run, !!loadSave(), epitaph, this.run.endless ? { best: loadBest(), fresh: this.newRecord } : null);
      this.screens.show('over');
      this.audio.narrate(CALL.narrator, epitaph, 1.2);
    }
  }

  // ── Test hooks (used by automated screenshots: ?test) ────────────────────
  setupTestHooks() {
    this.__upgrades = UPGRADES;
    this.test = {
      start: (night = 1, diff = 'veteran', upgrades = {}) => {
        const d = DIFFICULTY[diff];
        this.startRun({ difficulty: diff, night, survivors: d.survivors, supplies: 0, kills: 0, upgrades, minesOwned: 12, endless: false, totals: { shots: 0, hits: 0, headshots: 0 }, log: [] });
      },
      skipIntro: () => { this.stateT = 99; },
      leaveShop: () => { this.walkOut = true; this.beginNightFromShop(); this.walkOut = false; },
      aim: (yawDeg, pitchDeg) => { this.player.yaw = yawDeg * Math.PI / 180; this.player.pitch = pitchDeg * Math.PI / 180; },
      fire: (on) => { if (on) this.input.buttons |= 1; else this.input.buttons &= ~1; },
      press: (code) => this.input.pressed.add(code),
      spawn: (n, zmin = -120, zmax = -40, type = 0) => { for (let i = 0; i < n; i++) this.horde.spawn(type, rand(-70, 70), rand(zmin, zmax), 1, 1); },
      advance: (seconds, stepDt = 1 / 30, render = true) => {
        this.noRender = !render;
        for (let t = 0; t < seconds; t += stepDt) this.step(stepDt);
        this.noRender = false;
        if (!render) this.render(stepDt);
      },
      event: (kind) => { this.events.trigger(kind); },
      extraction: (seek = 0) => { if (this.state !== 'extraction') this.playExtraction(); this.extraction.t = seek; for (const c of this.extraction.cues) c.done = c.at < seek; },
      extractionInfo: () => ({ t: this.extraction.t, end: this.extraction.end, T: this.extraction.T, shots: this.extraction.shots }),
      hold: (left) => { const h = this.events.active.find((e) => e.kind === 'extraction'); if (h) h.t = h.P.hold - left; return !!h; },
      ending: (seek = 0) => { this.victory = true; if (this.state !== 'ending') this.playEnding(); this.ending.t = seek; for (const c of this.ending.cues) c.done = c.at < seek; },
      prologue: (seek = 0) => { if (this.state !== 'prologue') this.playPrologue(); this.prologue.t = seek; for (const c of this.prologue.cues) c.done = c.at < seek; this.prologue.lightsOn = this.prologue.lightsAt < seek; },
      prologueInfo: () => ({ t: this.prologue.t, end: this.prologue.end, shots: this.prologue.shots, cues: this.prologue.cues.map((c) => [c.at, c.dur, c.shot || '']) }),
      endingInfo: () => ({ t: this.ending.t, end: this.ending.end, shots: this.ending.shots, cues: this.ending.cues.map((c) => [c.at, c.dur, c.shot || '']) }),
      freeze: (on = true) => { this.frozen = !!on; },
      radioLines: () => allRadioLines(),
      obstacles: () => obstacles().map((b) => ({ ...b })),
      inside: () => { let n = 0; const h = this.horde; for (let i = 0; i < h.n; i++) { if (h.dead[i]) continue; for (const b of obstacles()) { const dx = h.x[i] - b.x, dz = h.z[i] - b.z; if (Math.abs(dx * b.ax + dz * b.az) < b.hl && Math.abs(-dx * b.az + dz * b.ax) < b.hw) n++; } } return n; },
      ground: (x, z) => groundH(x, z),
      state: () => ({ state: this.state, n: this.horde.n, kills: this.run?.kills, surv: this.run?.survivors, pile: Array.from(this.horde.pileH).map((v) => +v.toFixed(2)), t: this.director.t }),
    };
    void formatInt; void sectionCenterX; void wallZ;
  }
}

const game = new Game();
game.boot().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  const sub = document.getElementById('ld-sub');
  if (sub) sub.textContent = 'Failed to start: ' + (err && err.message ? err.message : err);
});
