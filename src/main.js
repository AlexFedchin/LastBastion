// ─────────────────────────────────────────────────────────────────────────────
//  LAST BASTION — entry point and game state machine
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import {
  WORLD, DIFFICULTY, ZOMBIE_TYPES, ZT, UPGRADES, CLAYMORE, FINAL_NIGHT, RADIO, BARKS,
  nightPlan, baseStats, SUPPLY_BONUS, sectionCenterX, wallZ, ABILITY, CALL, COMMS,
  UNLOCKS, UNLOCK_INFO, UNLOCK_LINES, isUnlocked, allRadioLines, CHRONICLE,
} from './config.js';
import { clamp, lerp, damp, pick, rand, formatInt, fitFov } from './core/util.js';
import { Input } from './core/input.js';
import { QUALITY, loadSettings, saveSettings, loadSave, writeSave, clearSave } from './core/storage.js';
import { Environment } from './world/environment.js';
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
import { Loader } from './ui/loader.js';
import { Chronicle, composeChronicle } from './ui/chronicle.js';

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
    const step = async (t) => { this.loader.step(t, stepN++ / BOOT_STEPS); await nextFrame(); };
    await step('warming the generators…');
    const canvas = document.getElementById('game');
    this.canvas = canvas;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = this.quality.spotShadows > 0;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, window.innerWidth / window.innerHeight, 0.1, 3200);

    await step('painting the valley…');
    this.env = new Environment(this.scene, renderer, this.quality);
    await step('digging graves…');
    const textures = { particles: makeParticleAtlas(128), decals: makeDecalAtlas(128) };
    this.fx = new Effects(this.scene, textures, this.env.fogUniforms, this.quality);
    this.fx.fire = this.env.fire;
    this.uniforms = {
      uTime: { value: 0 },
      uEyeGlow: { value: 9 },
      uRim: { value: new THREE.Color(0.075, 0.032, 0.014) },
      uEyeGlowBillboard: { value: 1 },
      uPixel: { value: 0.001 },
    };
    await step('waking the dead…');
    this.horde = new Horde(this.scene, this.fx, {
      cap: this.quality.maxZombies, corpseCap: this.quality.corpses, shadows: this.quality.zombieShadows, uniforms: this.uniforms,
    });
    this.horde.fire = this.env.fire;
    this.audio = new AudioEngine();
    this.audio.applySettings(this.settings);
    const soundLoaded = this.audio.preload();
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
    this.chronicle = new Chronicle(this);
    this.input = new Input(canvas);

    this.wireEvents();
    this.onResize();
    window.addEventListener('resize', () => this.onResize());

    // compile shaders before the first visible frame
    await step('checking the wire…');
    this.menuStats = { ...baseStats(), gunners: 4, wireBands: 1 };
    this.arsenal.startNight(this.menuStats, true);
    for (let i = 0; i < 220; i++) this.spawnMenuZombie(rand(-170, -30));
    this.horde.update(0.016, 0);
    this.horde.syncRender();
    this.updateMenuCamera(0);
    renderer.compile(this.scene, this.camera);
    this.post.render(0.016, 0);

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
    const r = this.renderer, gl = r.getContext(), cam = this.camera;
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
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
    const frames = 36, warm = 10, qs = [], wall = [];
    let t = 0;
    for (let k = 0; k < frames + warm; k++) {
      t += 1 / 60;
      this.horde.update(1 / 60, t);
      this.horde.syncRender();
      this.env.update(1 / 60, t, this.horde, this.fx, this.audio);
      this.fx.update(1 / 60);
      let q = null;
      if (ext && k >= warm) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); }
      const a = performance.now();
      this.post.render(1 / 60, t);
      if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); qs.push(q); }
      const px = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // wait for the GPU
      if (k >= warm) wall.push(performance.now() - a);
      if (k % 6 === 0) await nextFrame();
    }
    let times = [];
    if (ext && !gl.getParameter(ext.GPU_DISJOINT_EXT)) {
      for (const q of qs) {
        for (let n = 0; n < 60 && !gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE); n++) await nextFrame();
        if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) times.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(q);
      }
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
      this.screens.show(null);
      await this.loader.show({
        kicker: `BASTION-7 · ${diff.label}${save.survivors ? ` · ${save.survivors} ON THE WALL` : ''}`,
        title: shop ? 'DAWN <b>RESUPPLY</b>' : `NIGHT <b>${String(n).padStart(2, '0')}</b>`,
        tag: shop ? 'Count the living. Spend what you scavenged.'
          : n > FINAL_NIGHT ? 'No relief is coming.'
            : fresh.length ? `New tonight: ${fresh.map((f) => f.replace(/ /g, '\u00a0')).join(' · ')}` : `${hours} hours until relief.`,
        sub: '',
      });
      const t0 = performance.now();
      this.loader.step('issuing ammunition…', 0.2);
      await nextFrame();
      this.loader.step('briefing the crews…', 0.45);
      await this.precompile();
      this.loader.step('manning the wall…', 0.8);
      while (performance.now() - t0 < 1500) await nextFrame();
      begin();
      this.loader.step('stand to', 1);
      await nextFrame();
      this.loader.hide();
    } finally {
      this.deploying = false;
    }
  }

  /** Compile the shaders of everything not on screen yet (giants, aircraft, people, props). */
  async precompile() {
    const hidden = [];
    this.scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
    try {
      if (this.renderer.compileAsync) await this.renderer.compileAsync(this.scene, this.camera);
      else this.renderer.compile(this.scene, this.camera);
    } catch (err) { console.warn('[precompile]', err); }
    for (const o of hidden) o.visible = false;
  }

  applyPlayerSettings() {
    this.player.sens = 0.0022 * this.settings.sensitivity;
    this.player.invertY = !!this.settings.invertY;
    this.player.baseFov = this.settings.fov;
  }

  applySetting(k, v) {
    this.settings[k] = v;
    saveSettings(this.settings);
    if (['master', 'music', 'sfx'].includes(k)) this.audio.applySettings(this.settings);
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
    this.player.onHit = (killed, head) => { this.hud.hitmarker(killed, head); };
    this.player.onOverheat = () => { this.bark('overheat', 0.5); this.telemetry.overheat(); };
    this.arsenal.onExplosionKills = (kills, x, z, cause) => this.onExplosionKills(kills, x, z, cause);
    this.arsenal.air.onRadio = (who, text) => { if (this.inPlay()) this.hud.radio(who, text, true); };
    this.arsenal.onShake = (scale, x, z) => {
      const d = Math.hypot(x - WORLD.CAM.x, z - WORLD.CAM.z);
      this.player.addTrauma(clamp(scale * 22 / (d + 8), 0, 0.9));
      if (d < 40) this.flashPulse = Math.max(this.flashPulse, 0.06 * scale);
    };
    this.fx.onShake = (a) => this.player.addTrauma(a);
    this.env.onThunder = (delay) => this.audio.thunder(delay);
    this.env.onDistantBoom = (delay) => this.audio.distantBoom(delay);
    this.env.onDistantGunfire = (delay) => this.audio.distantGunfire(delay);
    this.director.onEvent = (kind, e) => this.onDirectorEvent(kind, e);
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'night' && !this.ignoreUnlock) this.pause();
      if (locked && this.state === 'night') this.screens.show(null);
    };
    this.canvas.addEventListener('click', () => {
      this.audio.init();
      if (this.state === 'night' && !this.input.locked) this.input.lock();
    });
    document.getElementById('s-click').addEventListener('click', () => { this.audio.init(); this.input.lock(); });
    document.addEventListener('keydown', (e) => {
      this.audio.init();
      if (this.chronicle.active && ['Space', 'Enter', 'NumpadEnter', 'Escape'].includes(e.code)) { this.chronicle.advance(); return; }
      if (e.code === 'Escape') {
        if (this.state === 'paused' && performance.now() - (this.pausedAt || 0) > 350) this.resume();
        else if (this.screens.current === 'settings' || this.screens.current === 'howto') this.onAction('back');
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
    this.audio.stopVoice();
    this.arsenal.startNight(this.menuStats, true);
    this.menuArtyT = 6;
    this.horde.pileMul = 0.6;
    this.horde.globalSpeed = 1;
    this.player.gun.visible = false;
  }

  onAction(act, el) {
    switch (act) {
      case 'continue': {
        const s = loadSave();
        if (s) this.deploy(s, () => this.startRun(s));
        break;
      }
      case 'new': this.screens.show('new'); break;
      case 'start': this.deploy({ night: 1, difficulty: el.dataset.diff }, () => this.newCampaign(el.dataset.diff)); break;
      case 'howto': this.prevScreen = this.screens.current; this.screens.show('howto'); break;
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
      case 'quit': window.bastion?.quit(); break;
      case 'resume': this.resume(); break;
      case 'abandon': this.abandonNight(); break;
      case 'open-logs': window.bastion?.openTelemetry?.(); break;
      case 'buy': this.buyUpgrade(el.dataset.id); break;
      case 'buy-mines': this.buyMines(); break;
      case 'begin': this.beginNightFromShop(); break;
      case 'shop-menu': writeSave(this.run); this.enterMenu(); break;
      case 'retry': { const s = loadSave(); if (s) this.deploy(s, () => this.startRun(s)); break; }
      case 'menu': this.enterMenu(); break;
      case 'endless': this.run.endless = true; writeSave(this.run); this.openShop(); break;
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
    this.startRun(run);
  }

  startRun(save) {
    this.run = JSON.parse(JSON.stringify(save));
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
    this.env.dawn = 0;
    this.ns = { kills: 0, headshots: 0, lost: 0, shots: 0, hits: 0, bestStreak: 0, supplies: 0, bonus: 0, fireKills: 0 };
    this.killTimes.length = 0;
    this.alertCd.fill(0);
    this.doneT = 0;
    this.horde.globalSpeed = 1;
    this.screens.show(null);
    this.hud.show(true);
    this.hud.radioQueue.length = 0;
    this.hud.clearAlerts();
    // radio script for the night
    const lines = (run.night <= FINAL_NIGHT && !run.endless) ? RADIO[run.night] : [pick(RADIO.endless), pick(RADIO.endless)];
    this.events.start(run.night, run.endless || run.night > FINAL_NIGHT);
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
    this.letterboxTarget = 1;
    const hoursLeft = Math.max(0, 72 - (run.night - 1) * 8);
    const sub = run.endless || run.night > FINAL_NIGHT ? 'NO RELIEF IS COMING'
      : run.night === FINAL_NIGHT ? 'THE LAST NIGHT' : `${hoursLeft} HOURS UNTIL RELIEF`;
    this.hud.announce(`NIGHT ${String(run.night).padStart(2, '0')}`, sub, 4.2);
    this.audio.init();
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
    this.screens.show(this.input.locked ? null : 'click');
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

  // ── Events from the world ────────────────────────────────────────────────
  inPlay() { return this.state === 'night' || this.state === 'intro'; }

  onKill(type, cause, x, y, z, headshot) {
    if (!this.run || !this.inPlay()) return;
    const run = this.run;
    run.kills++;
    this.ns.kills++;
    this.telemetry.kill(type, cause, headshot);
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
    if (this.inPlay()) this.telemetry.breach(sec, cause);
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
    // the climber is cut down on the walkway: blood on the parapet
    this.fx.headshot(x, WORLD.WALL_H + 1, z, 0, 0.4, 1);
    if (run.survivors <= 0) this.fall();
  }

  onBloaterWall(sec, x, z) {
    if (!this.inPlay()) return;
    this.damagePulse = Math.max(this.damagePulse, 0.35);
    this.hud.alert('', 'red', { key: 'acid', item: SECTION_LABELS[sec], format: (s) => `ACID ON ${s.join(' · ')} — THE WALL IS MELTING` });
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
    this.hud.radio(CALL.kovac, pick(BARKS[kind]), true);
  }

  // ── Night end / fall ─────────────────────────────────────────────────────
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
    const bonus = Math.round(SUPPLY_BONUS(run.night, run.survivors) * this.diff.supplyMul);
    run.supplies += bonus;
    this.ns.bonus = bonus;
    this.ns.shots = this.player.shots;
    this.ns.hits = this.player.hits;
    run.totals.shots += this.player.shots;
    run.totals.hits += this.player.hits;
    run.supplies = Math.round(run.supplies);
    this.report = { ...this.ns };
    for (const r of this.radioScript) run.log.push([r.who, r.text]);
    run.log = run.log.slice(-8);
    const survived = run.night;
    run.night++;
    run.minesOwned = this.arsenal.minesOwned;
    run.atShop = true;
    writeSave(run);
    this.telemetry.endNight('survived');
    this.hud.announce('DAWN', `NIGHT ${String(survived).padStart(2, '0')} SURVIVED · ${run.survivors} ALIVE`, 5);
    this.hud.radio(CALL.kovac, pick(BARKS.dawn), true);
    this.audio.setMusicMode('dawn');
    this.audio.setTide(false);
    this.audio.pressure = 0; this.audio.lowLife = false;
    this.victory = survived === FINAL_NIGHT && !run.endless;
  }

  openShop() {
    this.state = 'shop';
    this.arsenal.air.hide();
    this.hud.show(false);
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
    this.audio.uiBuy();
    this.screens.buildShop(run, this.report);
  }

  buyMines() {
    const run = this.run;
    if (run.supplies < CLAYMORE.cost || run.minesOwned + CLAYMORE.perBuy > CLAYMORE.max) return;
    run.supplies -= CLAYMORE.cost;
    run.minesOwned += CLAYMORE.perBuy;
    this.telemetry.purchase('claymores', run.minesOwned, CLAYMORE.cost, run.supplies);
    this.audio.uiBuy();
    this.screens.buildShop(run, this.report);
  }

  beginNightFromShop() {
    this.run.atShop = false;
    writeSave(this.run);
    this.startNight();
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
    // the night holds its breath until you take the gun
    const paused = this.state === 'paused' || (this.state === 'night' && !this.input.locked && !TEST);
    const dt = paused ? 0 : rdt * this.timeScale;
    this.time += dt;
    this.stateT += rdt;
    this.barkCd = Math.max(0, this.barkCd - rdt);

    switch (this.state) {
      case 'menu': this.updateMenu(dt, rdt); break;
      case 'intro': this.updateIntro(dt, rdt); break;
      case 'night': if (!paused) this.updateNight(dt, rdt); else this.player.update(0, rdt, this.input, this.stats, false, this.time); break;
      case 'dawn': this.updateDawn(dt, rdt); break;
      case 'shop': this.updateShop(dt, rdt); break;
      case 'fallen': this.updateFallen(dt, rdt); break;
      case 'victory': this.updateShop(dt, rdt); break;
      default: break;
    }

    if (!paused) {
      this.horde.syncRender();
      this.env.update(dt, this.time, this.horde, this.fx, this.audio);
      this.fx.update(dt);
    }
    this.audio.setListener(this.camera.position.x, this.camera.position.z, this.camera.rotation.y, this.camera.position.y);
    this.audio.dawn = this.env.dawn;
    this.audio.hordeAlive = this.horde.alive;
    this.audio.update(rdt);
    if (!this.noRender) this.render(rdt);
    this.input.endFrame();
  }

  render(rdt) {
    const u = this.post.u;
    this.letterbox = damp(this.letterbox, this.letterboxTarget || 0, 3, rdt);
    this.damagePulse = Math.max(0, this.damagePulse - rdt * 0.9);
    this.flashPulse = Math.max(0, this.flashPulse - rdt * 3);
    this.radial = Math.max(0, this.radial - rdt * 1.4);
    const lowLife = this.run && this.inPlay() && this.run.survivors <= 5 ? 0.25 + 0.15 * Math.sin(this.time * 6) : 0;
    u.uLetterbox.value = this.letterbox;
    u.uDamage.value = Math.max(this.damagePulse, lowLife, this.state === 'fallen' ? Math.min(1, this.stateT * 0.4) : 0);
    u.uFlash.value = this.flashPulse + this.env.flash * 0.04;
    u.uRadial.value = this.radial;
    u.uDesat.value = this.state === 'fallen' ? Math.min(0.85, 0.28 + this.stateT * 0.15) : lerp(0.28, 0.4, this.env.dawn);
    u.uExposure.value = lerp(1.25, 1.2, this.env.dawn);
    u.uWarm.value = this.env.dawn * 0.3;
    u.uCA.value = 0.008 + this.player.trauma * 0.008 + this.radial * 0.015;
    this.post.updateDistortion(this.env.fire.heatSources, this.fx.shocks);
    // pixel size for eye billboards
    const h = this.renderer.getDrawingBufferSize(this._sz || (this._sz = new THREE.Vector2())).y;
    this.uniforms.uPixel.value = 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) / h;
    this.uniforms.uEyeGlow.value = lerp(9, 1.2, this.env.dawn);
    this.uniforms.uEyeGlowBillboard.value = 1 - this.env.dawn;
    this.uniforms.uRim.value.setRGB(0.032, 0.014, 0.006).multiplyScalar(1 - this.env.dawn * 0.5);
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
    const T = 2.8;
    const k = Math.min(1, this.stateT / T);
    const e = k * k * (3 - 2 * k);
    // target pose = gunner pose
    const target = new THREE.Object3D();
    target.position.set(WORLD.CAM.x, WORLD.CAM.y, WORLD.CAM.z);
    target.rotation.order = 'YXZ';
    target.rotation.set(this.player.pitch, this.player.yaw, 0);
    target.updateMatrixWorld();
    this.camera.position.lerpVectors(this.introFrom.pos, target.position, e);
    this.camera.quaternion.slerpQuaternions(this.introFrom.quat, target.quaternion, e);
    this.player.gun.visible = k > 0.55;
    const fov = fitFov(lerp(55, this.settings.fov, e), this.camera.aspect);
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
      if (!this.input.locked && !TEST) this.screens.show('click');
      const n = this.run.night, keys = ['LMB FIRE', 'RMB OPTICS'];
      if (isUnlocked('artillery', n)) keys.push('Q ARTILLERY');
      if (isUnlocked('molotov', n)) keys.push('E MOLOTOV');
      if (isUnlocked('bomber', n)) keys.push('T BOMBER MARKER');
      if (isUnlocked('grenades', n)) keys.push('G GRENADES');
      this.hud.hint(keys.join(' · '));
      for (const k of this.newUnlocks || []) this.hud.alert('', '', { key: 'new', item: UNLOCK_INFO[k], life: 7, priority: 1.5, format: (s) => `NEW — ${s.join(' · ')}` });
      setTimeout(() => this.hud.hint(''), 9000);
    }
  }

  updateNight(dt, rdt) {
    const input = this.input;
    const active = input.locked || TEST;
    const run = this.run;

    // abilities (each arrives on its own night: see UNLOCKS)
    const can = (k) => isUnlocked(k, run.night);
    const T = this.telemetry;
    if (active) {
      if (input.hit('KeyQ') && can('artillery')) {
        const p = this.player.aimPoint(330);
        const ok = this.arsenal.callArtillery(p);
        T.ability('artillery', ok);
        if (ok) {
          this.hud.alert(`FIRE MISSION — ${this.stats.artyShells} ROUNDS — SPLASH IN 3`);
          this.hud.radio(CALL.battery, COMMS.battery[this.stats.artyShells] || `Shot, over. ${this.stats.artyShells} rounds HE, splash in three.`, true);
        } else this.hud.alert(`BATTERY RELOADING — ${Math.ceil(this.arsenal.artyCd)}s`, '', { key: 'arty-cd', plain: true });
      }
      if (input.hit('KeyE') && can('molotov')) {
        const r = this.arsenal.throwMolotov(this.player.aimPoint(ABILITY.molotov.maxRange));
        if (r !== 'rearm') T.ability('molotov', r === true);
        if (r === 'empty') this.hud.alert('NO BOTTLES LEFT', '', { key: 'molotov-empty', plain: true });
      }
      if (input.hit('KeyT') && can('bomber')) {
        const air = this.arsenal.air;
        const ok = air.throwMarker(this.player.aimPoint(ABILITY.bomber.maxRange));
        T.ability('bomber', ok);
        if (ok) {
          this.hud.alert('MARKER OUT — BOMBER INBOUND');
          this.hud.radio(CALL.kovac, COMMS.markerOut, true);
        } else this.hud.alert(air.bomberBusy ? 'BOMBER ALREADY ON ITS RUN' : `BOMBER RE-ARMING — ${Math.ceil(air.bomberCd)}s`, '', { key: 'bomber-cd', plain: true });
      }
      if (input.hit('KeyG') && can('grenades')) {
        const r = this.arsenal.throwGrenade(this.player.aimPoint(ABILITY.grenade.maxRange));
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
          this.hud.radio(CALL.kovac, COMMS.dangerClose, true);
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
    if (!this.chronicleStarted && this.story && this.stateT > 5.5) {
      this.chronicleStarted = true;
      this.hud.show(false);
      this.hud.radioQueue.length = 0;
      this.chronicle.play(this.story, () => { this.story = null; });
    }
    if (this.chronicle.active) this.chronicle.update(rdt);
    else this.hud.update(rdt, this);
    if (this.stateT > 11 && !this.chronicle.active) {
      if (this.victory) {
        this.state = 'victory';
        this.hud.show(false);
        this.screens.buildVictory(this.run);
        this.screens.show('victory');
        this.audio.setMusicMode('victory');
      } else this.openShop();
    }
  }

  updateShop(dt, rdt) {
    this.env.dawn = damp(this.env.dawn, 1, 1, rdt);
    // slow drift of the camera from the gun position
    this.player.yaw = damp(this.player.yaw, Math.sin(this.time * 0.04) * 0.4, 0.5, rdt);
    this.player.pitch = damp(this.player.pitch, -0.17, 0.5, rdt);
    this.player.update(dt, rdt, this.input, this.stats, false, this.time);
    this.horde.update(dt, this.time);
  }

  updateFallen(dt, rdt) {
    // they keep coming; the camera drifts up and away
    if (this.horde.n < this.horde.cap - 10 && Math.random() < dt * 30) this.spawnMenuZombie(rand(-120, -60));
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
      this.screens.buildGameOver(this.run, !!loadSave(), epitaph);
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
      freeze: (on = true) => { this.frozen = !!on; },
      radioLines: () => allRadioLines(),
      state: () => ({ state: this.state, n: this.horde.n, kills: this.run?.kills, surv: this.run?.survivors, pile: Array.from(this.horde.pileH).map((v) => +v.toFixed(2)), t: this.director.t }),
    };
    void formatInt; void sectionCenterX; void wallZ;
  }
}

const game = new Game();
game.boot().catch((err) => {
  console.error(err);
  const sub = document.getElementById('ld-sub');
  if (sub) sub.textContent = 'Failed to start: ' + (err && err.message ? err.message : err);
});
