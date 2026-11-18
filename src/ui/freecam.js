// Developer free camera: F9 (or FREE CAMERA in the developer panel) lifts the camera off
// the gun and lets you fly anywhere, to look the map over or check a model in place.
// It flies whichever camera is being drawn (the valley, or the hangar at dawn).
//
// Over a night (or the menu, the dawn...) nothing happens while it is on: the night, the
// events and the guns stand still and the dead are hidden; only the ambient world goes on
// (sky, weather, fires, flags, the sound beds). Over a cutscene, the cutscene plays on
// under it, with a transport (pause, speed, seek, restart) and its own camera a key away.
// The panel on the right sets the world: time of day, the generator, a fog bank, how far
// the city has burnt, a lightning strike. Leaving puts everything back where it was.
//
//   click        capture the mouse to look around (Esc frees it; Esc again leaves)
//   right-drag   look around without capturing the mouse
//   WASD         fly where you look      E / Space up, Q down      Shift faster
//   wheel        cruise speed            1-4 viewpoints, 0 back to where you started
//   X            what is under the crosshair: point, distance, object (copied)
//   C            copy the camera pose    G metre grid (at the last X point)
//   L            brighter (x1, x2, x4)   [ ]  time of day -/+ half an hour
//   Z            show / hide the dead    H hide the readout and the panel
//   cutscenes:   P pause, , . seek -/+5 s, V the cutscene's own camera
//   F9           leave
import * as THREE from 'three';
import { WORLD } from '../config.js';
import { damp, clamp, lerp } from '../core/util.js';

const DEG = Math.PI / 180;
const SENS = 0.0022; // radians per pixel of mouse movement
const MOVE = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Space', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const PASS = new Set(['F10', 'F11', 'F12']); // the developer panel, fullscreen, the browser's devtools
const ease = (k) => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };

/** Viewpoints of the valley: [name, position, the point looked at]. */
const VIEWS = [
  ['the gun nest', [WORLD.CAM.x, WORLD.CAM.y, WORLD.CAM.z], [0, 9.5, -60]],
  ['the tower from the road', [0, 8, -34], [0, 7, 0]],
  ['the valley from above', [0, 75, -125], [0, 0, -30]],
  ['the base behind the wall', [0, 26, 55], [0, 6, 0]],
];

// Time of day, as a clock from 18:00 to 06:00 (u 0..1): the sun goes down behind the city
// (the prologue's light), full dark from 21:00, grey dawn coming up from 03:36.
const SUNSET_END = 0.25, DAWN_FROM = 0.8;
const SUN_AZ = -0.3, SUN_FROM = 0.085, SUN_TO = -0.11; // as in prologue.js
const TIMES = [['SUNSET', 0.04], ['DUSK', 0.17], ['NIGHT', 0.5], ['DAWN', 1]];
const clock = (u) => { const m = Math.round((18 * 60 + u * 720) / 10) * 10 % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

const CINES = { prologue: 'THE PROLOGUE', extraction: 'THE EXTRACTION', ending: 'THE ENDING' };

const STYLE = `
body.freecam #hud, body.freecam #screens { visibility: hidden; }
#freecam, #fc-panel { position: fixed; top: 16px; z-index: 80; display: none; background: rgba(8, 9, 8, 0.8); border: 1px solid var(--line);
  color: var(--bone); font: 12px/1.5 var(--mono); }
#freecam { left: 16px; pointer-events: none; max-width: min(720px, calc(100vw - 360px)); padding: 10px 12px; white-space: pre-wrap; }
#freecam b { color: var(--amber); font-weight: 600; letter-spacing: 0.2em; }
#freecam .dim { color: var(--bone-dim); }
#freecam .sub { color: var(--bone); font-style: italic; }
#fc-panel { right: 16px; width: 300px; max-height: calc(100vh - 32px); overflow-y: auto; padding: 10px 12px 12px; user-select: none; }
#fc-panel h4 { font: 600 11px var(--cond); letter-spacing: 0.3em; color: var(--amber); margin: 10px 0 4px; }
#fc-panel div:first-child > h4:first-child { margin-top: 0; }
#fc-panel .lbl { display: flex; justify-content: space-between; color: var(--bone-dim); font-size: 11px; margin-top: 6px; }
#fc-panel .lbl span:last-child { color: var(--bone); }
#fc-panel input[type=range] { width: 100%; accent-color: var(--amber); margin: 2px 0; }
#fc-panel select { background: #111210; color: var(--bone); border: 1px solid var(--line); font: 12px var(--mono); padding: 2px 4px; width: 100%; }
#fc-panel .row { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
#fc-panel button { background: #1a1b17; color: var(--bone); border: 1px solid var(--line); padding: 3px 7px; font: 11px var(--cond); letter-spacing: 0.14em; cursor: pointer; }
#fc-panel button:hover { border-color: var(--amber); color: var(--amber); }
#fc-panel button.on { background: var(--amber-dim); color: #fff; border-color: var(--amber); }
#fc-panel button.game { color: var(--bone-dim); }
#fc-panel .note { color: var(--muted); font-size: 10.5px; margin-top: 3px; }
#fc-panel [hidden] { display: none !important; }
#freecam-dot { position: fixed; left: 50%; top: 50%; width: 4px; height: 4px; margin: -2px 0 0 -2px; border-radius: 50%; z-index: 80;
  background: var(--amber); box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.7); pointer-events: none; display: none; }
body.freecam #freecam-dot { display: block; }
body.freecam #freecam.on, body.freecam #fc-panel.on { display: block; }
body.freecam.fc-follow #freecam-dot { display: none; }
`;

const f2 = (v) => v.toFixed(2);

export class FreeCam {
  constructor(game) {
    this.g = game;
    this.on = false;
    this.speed = 15;        // cruise, metres a second
    this.yaw = 0; this.pitch = 0;
    this.vel = new THREE.Vector3();
    this.keys = new Set();
    this.pick = null;       // the last X: { point, dist, name }
    this.note = '';         // a short message on the readout ("copied")
    this.noteT = 0;
    this.showInfo = true;
    this.bright = 1;        // exposure multiplier (L), to see a model at night
    this.ray = new THREE.Raycaster();
    this.ray.far = 4000;
    // the world, set from the panel: null = as the game has it
    this.over = { time: null, power: null, fog: null };
    this.deadShown = false;
    this.hidden = [];
    // a cutscene playing under the camera
    this.cine = null;       // the cutscene (g.prologue / g.extraction / g.ending)
    this.cinePaused = false;
    this.cineSpeed = 1;
    this.follow = false;    // looking through the cutscene's own camera

    const st = document.createElement('style'); st.textContent = STYLE; document.head.appendChild(st);
    this.el = document.createElement('div'); this.el.id = 'freecam'; this.el.className = 'on'; document.body.appendChild(this.el);
    const dot = document.createElement('div'); dot.id = 'freecam-dot'; document.body.appendChild(dot);
    this.panel = this.buildPanel();

    // ahead of the game's own handlers (window, capture): while flying, the keys are the camera's
    window.addEventListener('keydown', (e) => this.onKey(e, true), true);
    window.addEventListener('keyup', (e) => this.onKey(e, false), true);
    window.addEventListener('blur', () => this.keys.clear());
    // the Esc that frees a captured mouse is not also the Esc that leaves
    document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement) this.unlockedAt = performance.now(); });
    const canvas = game.canvas;
    canvas.addEventListener('mousedown', (e) => {
      if (!this.on) return;
      if (e.button === 0) this.g.input.lock();
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.on) return;
      if (document.pointerLockElement === canvas || (e.buttons & 2 && e.target === canvas)) this.look(e.movementX, e.movementY);
    });
    canvas.addEventListener('wheel', (e) => {
      if (!this.on) return;
      e.preventDefault();
      this.speed = clamp(this.speed * (e.deltaY > 0 ? 1 / 1.25 : 1.25), 0.5, 400);
    }, { passive: false });
  }

  // ── The panel ─────────────────────────────────────────────────────────────
  buildPanel() {
    const el = document.createElement('aside');
    el.id = 'fc-panel'; el.className = 'on';
    const nights = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<option value="${n}">night ${n}${n <= 5 ? ' · burning' : n === 6 ? ' · burning out' : ' · burnt out'}</option>`).join('');
    el.innerHTML = `
      <div data-world>
        <h4>THE WORLD</h4>
        <div class="lbl"><span>time of day</span><span id="fc-time-l">the game's</span></div>
        <input type="range" id="fc-time" min="0" max="1000" value="500" aria-label="Time of day">
        <div class="row">${TIMES.map(([n, u]) => `<button data-time="${u}">${n}</button>`).join('')}<button class="game" data-time="game">GAME</button></div>
        <div class="lbl"><span>generator</span><span id="fc-power-l">the game's</span></div>
        <div class="row"><button data-power="1">ON</button><button data-power="0">DOWN</button><button class="game" data-power="game">GAME</button></div>
        <div class="lbl"><span>fog bank</span><span id="fc-fog-l">the game's</span></div>
        <input type="range" id="fc-fog" min="0" max="100" value="0" aria-label="Fog bank">
        <div class="row"><button class="game" data-fog="game">GAME</button></div>
        <div class="note">fog shows at night only (before 03:36)</div>
        <div class="lbl"><span>the city</span><span></span></div>
        <select id="fc-story" aria-label="The city as on night">${nights}<option value="99">endless · burnt out</option></select>
        <div class="row"><button data-act="lightning">LIGHTNING</button><button data-act="dead" id="fc-dead">SHOW THE DEAD</button></div>
      </div>
      <h4>CUTSCENES</h4>
      <div class="row">${Object.entries(CINES).map(([k, n]) => `<button data-cine="${k}">${n.slice(4)}</button>`).join('')}</div>
      <div class="note" id="fc-cine-none">fly through one: it loads, then plays under the free camera</div>
      <div id="fc-cine" hidden>
        <div class="lbl"><span id="fc-cine-name"></span><span id="fc-cine-t"></span></div>
        <input type="range" id="fc-cine-seek" min="0" max="1000" value="0" aria-label="Cutscene time">
        <div class="row">
          <button data-act="restart" title="from the start">⏮</button><button data-act="back" title="5 s back (,)">−5</button>
          <button data-act="play" id="fc-play" title="pause / play (P)">❚❚</button><button data-act="fwd" title="5 s on (.)">+5</button>
          ${[0.25, 0.5, 1, 2].map((s) => `<button data-speed="${s}">×${s}</button>`).join('')}
        </div>
        <div class="row"><button data-act="follow" id="fc-follow" title="V">ITS OWN CAMERA</button></div>
        <div class="note">seeking back replays it from the start</div>
      </div>`;
    document.body.appendChild(el);
    // keep the game's own key and click handlers out of the panel
    for (const ev of ['click', 'mousedown', 'wheel', 'input', 'change']) el.addEventListener(ev, (e) => e.stopPropagation());
    el.addEventListener('click', (e) => this.onPanel(e));
    const $ = (id) => el.querySelector('#' + id);
    $('fc-time').addEventListener('input', (e) => { this.over.time = +e.target.value / 1000; this.syncPanel(); });
    $('fc-fog').addEventListener('input', (e) => { this.over.fog = +e.target.value / 100; this.syncPanel(); });
    $('fc-story').addEventListener('change', (e) => { const n = +e.target.value; this.g.env.setStory(n === 99 ? 11 : n, n === 99); this.storyTouched = true; });
    $('fc-cine-seek').addEventListener('change', (e) => { if (this.cine) this.seek(+e.target.value / 1000 * this.cineLimit()); });
    this.$ = $;
    return el;
  }

  onPanel(e) {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if (d.time) this.over.time = d.time === 'game' ? null : +d.time;
    else if (d.power) this.over.power = d.power === 'game' ? null : +d.power;
    else if (d.fog) this.over.fog = null;
    else if (d.speed) this.cineSpeed = +d.speed;
    else if (d.cine) { this.g.dev.watch(d.cine, { freecam: true }); return; }
    else {
      switch (d.act) {
        case 'lightning': this.g.env.nextLightning = 0; break;
        case 'dead': this.showDead(!this.deadShown); break;
        case 'restart': this.seek(0); break;
        case 'back': if (this.cine) this.seek(this.cine.t - 5); break;
        case 'fwd': if (this.cine) this.seek(this.cine.t + 5); break;
        case 'play': this.cinePaused = !this.cinePaused; break;
        case 'follow': this.setFollow(!this.follow); break;
        default: break;
      }
    }
    this.syncPanel();
  }

  /** The panel's controls, as things stand. */
  syncPanel() {
    const $ = this.$, o = this.over, env = this.g.env;
    this.panel.querySelector('[data-world]').hidden = !!this.inHangar;
    $('fc-time-l').textContent = o.time === null ? "the game's" : clock(o.time);
    if (o.time !== null) $('fc-time').value = Math.round(o.time * 1000);
    $('fc-power-l').textContent = o.power === null ? "the game's" : o.power ? 'on' : 'down';
    $('fc-fog-l').textContent = o.fog === null ? "the game's" : `${Math.round(o.fog * 100)}%`;
    if (o.fog !== null) $('fc-fog').value = Math.round(o.fog * 100);
    this.panel.querySelectorAll('[data-time]').forEach((b) => b.classList.toggle('on', b.dataset.time === 'game' ? o.time === null : o.time !== null && Math.abs(+b.dataset.time - o.time) < 0.001));
    this.panel.querySelectorAll('[data-power]').forEach((b) => b.classList.toggle('on', b.dataset.power === 'game' ? o.power === null : o.power === +b.dataset.power));
    this.panel.querySelector('[data-fog]').classList.toggle('on', o.fog === null);
    $('fc-story').value = env.storyEndless ? '99' : String(clamp(env.storyNight || 1, 1, 10));
    $('fc-dead').classList.toggle('on', this.deadShown);
    $('fc-dead').textContent = this.deadShown ? 'THE DEAD SHOWN' : 'SHOW THE DEAD';
    $('fc-cine').hidden = !this.cine;
    $('fc-cine-none').hidden = !!this.cine;
    if (this.cine) {
      $('fc-play').textContent = this.cinePaused ? '▶' : '❚❚';
      $('fc-play').classList.toggle('on', this.cinePaused);
      this.panel.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('on', +b.dataset.speed === this.cineSpeed));
      $('fc-follow').classList.toggle('on', this.follow);
    }
    this.syncCineBar();
  }

  /** The cutscene's clock on the panel (every frame). */
  syncCineBar() {
    if (!this.cine) return;
    const c = this.cine, lim = this.cineLimit(), $ = this.$;
    const shot = c.shots.find((x) => c.t >= x.from && c.t < x.to) || c.shots[c.shots.length - 1];
    $('fc-cine-name').textContent = `${CINES[this.cineState]} · ${shot ? shot.name : ''}`;
    $('fc-cine-t').textContent = `${c.t.toFixed(1)} / ${lim.toFixed(1)} s`;
    if (document.activeElement !== $('fc-cine-seek')) $('fc-cine-seek').value = Math.round(c.t / lim * 1000);
  }

  // ── On and off ────────────────────────────────────────────────────────────
  /** The camera being drawn: the hangar's at dawn, the valley's otherwise. */
  activeCamera() {
    const g = this.g;
    return g.state === 'shop' && g.hangar.active ? g.hangar.camera : g.camera;
  }

  activeScene() {
    const g = this.g;
    return g.state === 'shop' && g.hangar.active ? g.hangar.scene : g.scene;
  }

  /** Everything that draws the dead: the walkers (every level of detail), their eyes and contact shadows, the bodies. */
  hordeMeshes() {
    const h = this.g.horde, c = h.corpses;
    return [...h.lods.map((l) => l.mesh), h.eyes, h.blobs, c.near.mesh, c.far.mesh, c.giant.mesh].filter(Boolean);
  }

  showDead(on) {
    this.deadShown = on;
    for (const [m, v] of this.hidden) m.visible = on ? v : false;
  }

  toggle(on = !this.on) { if (on) this.enter(); else this.exit(); }

  /** opts.follow: start looking through the cutscene's own camera; opts.deploy: called from a deployment's start. */
  enter(opts = {}) {
    if (this.on) return;
    const g = this.g, env = g.env;
    if (g.deploying && !opts.deploy) return;
    const cam = this.cam = this.activeCamera();
    this.inHangar = cam !== g.camera;
    this.saved = {
      pos: cam.position.clone(), quat: cam.quaternion.clone(), fov: cam.fov, gun: g.player.gun.visible,
      env: { dawn: env.dawn, dusk: env.dusk, sun: env.sunDir.clone(), power: env.power, fog: env.fogBank, nest: g.player.nestLight.intensity, lamp: g.audio.lampPower,
        story: [env.storyNight || 1, !!env.storyEndless] },
    };
    this.over = { time: null, power: null, fog: null };
    this.storyTouched = false;
    this.pos = null;
    this.fromPose();
    this.vel.set(0, 0, 0);
    this.keys.clear();
    this.on = true;
    // a cutscene plays on underneath; anything else holds still with the dead hidden
    this.cineState = CINES[g.state] ? g.state : null;
    this.cine = this.cineState ? g[this.cineState] : null;
    this.cinePaused = false; this.cineSpeed = 1;
    this.hidden = this.hordeMeshes().map((m) => [m, m.visible]);
    this.showDead(!!this.cine);
    this.setFollow(!!(this.cine && opts.follow));
    if (!this.follow && g.player.gun.parent === g.camera) g.player.gun.visible = false;
    document.body.classList.add('freecam');
    this.say(this.cine ? (this.follow ? 'the cutscene plays · move or press V to fly' : 'the cutscene plays on · P pause · V its own camera') : 'click to look around · F9 to leave');
    this.syncPanel();
    this.draw();
  }

  /** Leave: the camera and the world go back to how they were, the game picks up where it stood. */
  exit() {
    if (!this.on) return;
    const g = this.g, cam = this.cam, s = this.saved, env = g.env;
    this.on = false;
    // a cutscene sets its own camera and light every frame: only what it does not set goes back
    if (!this.cine) {
      cam.position.copy(s.pos); cam.quaternion.copy(s.quat);
      if (cam.fov !== s.fov) { cam.fov = s.fov; cam.updateProjectionMatrix(); }
      cam.updateMatrixWorld(true);
      g.player.gun.visible = s.gun;
      env.dawn = s.env.dawn; env.dusk = s.env.dusk; env.sunDir.copy(s.env.sun);
      env.power = s.env.power; g.player.nestLight.intensity = s.env.nest; g.audio.lampPower = s.env.lamp;
      env.fogBank = s.env.fog;
    } else {
      if (this.over.power !== null) { env.power = 1; g.player.nestLight.intensity = 1.6; g.audio.lampPower = 1; }
      if (this.over.fog !== null) env.fogBank = 0;
      if (g.player.gun.parent === g.camera) g.player.gun.visible = true;
    }
    if (this.storyTouched) env.setStory(...s.env.story);
    for (const [m, v] of this.hidden) m.visible = v;
    if (this.grid) this.grid.visible = false;
    document.body.classList.remove('freecam', 'fc-follow');
    this.keys.clear();
    this.cine = null;
    // back on the gun: keep the captured mouse; anywhere else, give it back
    if (g.state === 'night') { if (!g.input.locked) g.pause(); } else g.input.unlock();
  }

  /** Take the camera's pose as the free camera's. */
  fromPose() {
    const e = new THREE.Euler().setFromQuaternion(this.cam.quaternion, 'YXZ');
    this.yaw = e.y; this.pitch = e.x;
  }

  setFollow(on) {
    this.follow = !!(on && this.cine);
    document.body.classList.toggle('fc-follow', this.follow);
    if (!this.follow && this.cam) { this.fromPose(); this.vel.set(0, 0, 0); this.pos = this.cam.position.clone(); }
  }

  // ── Input ─────────────────────────────────────────────────────────────────
  onKey(e, down) {
    if (e.code === 'F9') { if (down) { e.preventDefault(); if (!e.repeat) this.toggle(); } e.stopImmediatePropagation(); return; }
    if (!this.on || PASS.has(e.code)) return;
    if (e.target && e.target.closest && e.target.closest('input, select, textarea, #dev')) return; // typing in a panel
    e.stopImmediatePropagation();
    if (MOVE.has(e.code) || e.code.startsWith('Digit')) e.preventDefault();
    if (!down) { this.keys.delete(e.code); return; }
    this.keys.add(e.code);
    if (MOVE.has(e.code) && !e.code.startsWith('Shift') && this.follow) { this.setFollow(false); this.syncPanel(); } // moving takes the camera over
    if (e.repeat) return;
    const time = () => (this.over.time ?? this.gameTime());
    switch (e.code) {
      case 'Escape': if (!this.g.input.locked && performance.now() - (this.unlockedAt || 0) > 350) this.exit(); break;
      case 'KeyH': this.showInfo = !this.showInfo; this.el.classList.toggle('on', this.showInfo); this.panel.classList.toggle('on', this.showInfo); break;
      case 'KeyX': this.doPick(); break;
      case 'KeyC': this.copyPose(); break;
      case 'KeyG': this.toggleGrid(); break;
      case 'KeyL': this.bright = this.bright >= 4 ? 1 : this.bright * 2; this.say(`exposure x${this.bright}`); break;
      case 'KeyZ': this.showDead(!this.deadShown); this.syncPanel(); break;
      case 'BracketLeft': this.over.time = clamp(time() - 1 / 24, 0, 1); this.syncPanel(); break;
      case 'BracketRight': this.over.time = clamp(time() + 1 / 24, 0, 1); this.syncPanel(); break;
      case 'KeyP': if (this.cine) { this.cinePaused = !this.cinePaused; this.syncPanel(); } break;
      case 'KeyV': if (this.cine) { this.setFollow(!this.follow); this.syncPanel(); } break;
      case 'Comma': if (this.cine) this.seek(this.cine.t - 5); break;
      case 'Period': if (this.cine) this.seek(this.cine.t + 5); break;
      case 'Digit0': this.setFollow(false); this.go(this.saved.pos, null, this.saved.quat); break;
      default:
        if (/^Digit[1-9]$/.test(e.code)) {
          const v = VIEWS[+e.code.slice(5) - 1];
          if (!v) break;
          if (this.inHangar) { this.say('viewpoints are for the valley'); break; }
          this.setFollow(false);
          this.go(new THREE.Vector3(...v[1]), new THREE.Vector3(...v[2]));
          this.say(v[0]);
        }
    }
  }

  look(dx, dy) {
    if (this.follow) { this.setFollow(false); this.syncPanel(); }
    this.yaw -= dx * SENS;
    this.pitch = clamp(this.pitch - dy * SENS, -89 * DEG, 89 * DEG);
  }

  /** Jump to a position, looking at a point (or with a given orientation). */
  go(pos, at, quat) {
    this.cam.position.copy(pos);
    this.pos = pos.clone();
    if (at) {
      const d = at.clone().sub(pos);
      this.yaw = Math.atan2(-d.x, -d.z);
      this.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    } else if (quat) {
      const e = new THREE.Euler().setFromQuaternion(quat, 'YXZ');
      this.yaw = e.y; this.pitch = e.x;
    }
    this.vel.set(0, 0, 0);
  }

  // ── The world ─────────────────────────────────────────────────────────────
  /** Where the game's own light sits on the clock (for [ and ] from "the game's"). */
  gameTime() {
    const env = this.g.env;
    if (env.dusk > 0.001) return SUNSET_END * 0.5;
    if (env.dawn > 0.001) return DAWN_FROM + (1 - DAWN_FROM) * env.dawn;
    return 0.5;
  }

  /** The panel's settings on the world (every frame: a cutscene sets its own light every frame). */
  applyWorld() {
    if (this.inHangar) return;
    const g = this.g, env = g.env, o = this.over;
    if (o.time !== null) {
      const u = o.time;
      if (u < SUNSET_END) {
        const f = u / SUNSET_END;
        env.sunDir.set(SUN_AZ, lerp(SUN_FROM, SUN_TO, f), -1).normalize();
        env.dawn = lerp(0.72, 0, ease(f * 1.08));
        env.dusk = 1 - ease((f - 0.5) / 0.5);
      } else {
        env.dusk = 0;
        env.dawn = u < DAWN_FROM ? 0 : ease((u - DAWN_FROM) / (1 - DAWN_FROM));
      }
    }
    if (o.power !== null) { env.power = o.power; g.player.nestLight.intensity = 1.6 * o.power; g.audio.lampPower = o.power; }
    if (o.fog !== null) env.fogBank = o.fog;
  }

  // ── Cutscenes ─────────────────────────────────────────────────────────────
  /** Where the cutscene would end (hand over to what follows): it holds just short of it. */
  cineLimit() { const c = this.cine; return c.shots.length ? c.shots[c.shots.length - 1].to : c.end; }

  /**
   * Called by the game each frame a cutscene plays under the camera, before it runs:
   * how far to run it this frame (0: hold still).
   */
  cineStep(rdt) {
    const c = this.cine;
    if (!c || !c.active || this.g.state !== this.cineState) { this.cine = null; this.syncPanel(); return 0; } // it ended under us
    if (this.cinePaused) return 0;
    const lim = this.cineLimit() - 0.05, s = rdt * this.cineSpeed;
    if (c.t + s >= lim) { this.cinePaused = true; this.syncPanel(); this.say('the end of the cutscene · ⏮ or , to go back'); return Math.max(0, lim - c.t); }
    return s;
  }

  /** Jump to t seconds into the cutscene: on from here, or (back) from the start again. */
  seek(t) {
    const c = this.cine, g = this.g;
    if (!c) return;
    t = clamp(t, 0, this.cineLimit() - 0.1);
    if (t < c.t) {
      for (const [m, v] of this.hidden) m.visible = v;
      c.stop();
      if (this.cineState === 'extraction') g.arsenal.startNight(g.stats, false, g.run ? g.run.night : 10);
      c.start();
      this.hidden = this.hordeMeshes().map((m) => [m, m.visible]);
    }
    // run it on in tenths of a second (silently: the lines it passes are not spoken)
    const h = 0.1, pos = this.cam.position.clone(), quat = this.cam.quaternion.clone();
    for (let n = 0; c.t < t - 1e-6 && n < 4000; n++) {
      const s = Math.min(h, t - c.t);
      g.time += s;
      c.update(s, s);
      g.env.update(s, g.time, g.horde, g.fx, null);
      g.fx.update(s);
    }
    g.horde.syncRender();
    g.audio.stopVoice();
    if (!this.follow) { this.cam.position.copy(pos); this.cam.quaternion.copy(quat); this.cam.updateMatrixWorld(true); }
    this.applyWorld();
    this.showDead(this.deadShown);
    this.syncPanel();
  }

  // ── Every frame ───────────────────────────────────────────────────────────
  /** Real-time tick (after the cutscene, if one plays; instead of the game's state otherwise). */
  update(rdt) {
    if (!this.on) return;
    const k = this.keys, cam = this.cam, g = this.g;
    this.applyWorld();
    if (this.follow) {
      // the cutscene's camera: just read where it is
      this.fromPose();
      this.pos = null;
    } else {
      const f = (+(k.has('KeyW') || k.has('ArrowUp'))) - (+(k.has('KeyS') || k.has('ArrowDown')));
      const r = (+(k.has('KeyD') || k.has('ArrowRight'))) - (+(k.has('KeyA') || k.has('ArrowLeft')));
      const u = (+(k.has('KeyE') || k.has('Space'))) - (+k.has('KeyQ'));
      const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
      const v = (this.speed * (k.has('ShiftLeft') || k.has('ShiftRight') ? 5 : 1)) / (this.inHangar ? 6 : 1);
      // fly where you look; strafe level; up and down along the world's up
      const tx = (-sy * cp * f + cy * r) * v, ty = (sp * f + u) * v, tz = (-cy * cp * f - sy * r) * v;
      this.vel.set(damp(this.vel.x, tx, 10, rdt), damp(this.vel.y, ty, 10, rdt), damp(this.vel.z, tz, 10, rdt));
      // a cutscene moves its camera every frame: ours stays where we left it
      if (this.pos) cam.position.copy(this.pos);
      cam.position.addScaledVector(this.vel, rdt);
      this.pos = cam.position.clone();
      cam.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
      cam.updateMatrixWorld(true);
      // the fifty rides the camera in a night: not in front of a free one
      if (g.player.gun.parent === g.camera) g.player.gun.visible = false;
    }
    if (this.noteT > 0) { this.noteT -= rdt; if (this.noteT <= 0) this.note = ''; }
    this.syncCineBar();
    this.draw();
  }

  // ── Tools ─────────────────────────────────────────────────────────────────
  /** What is under the crosshair. */
  doPick() {
    const cam = this.cam;
    this.ray.setFromCamera({ x: 0, y: 0 }, cam);
    this.ray.params.Points = { threshold: 0.2 };
    this.ray.params.Line = { threshold: 0.1 };
    let hits = [];
    try { hits = this.ray.intersectObject(this.activeScene(), true); } catch (err) { console.warn('[freecam] pick', err); }
    const hit = hits.find((h) => shown(h.object) && solid(h.object) && !(this.grid && this.grid.children.includes(h.object)));
    if (!hit) { this.pick = null; this.say('nothing under the crosshair'); return; }
    const names = [];
    for (let o = hit.object; o && names.length < 4; o = o.parent) if (o.name) names.push(o.name);
    const mat = Array.isArray(hit.object.material) ? hit.object.material[0] : hit.object.material;
    const name = (names.length ? names.join(' < ') : hit.object.type) + (hit.instanceId !== undefined ? ` #${hit.instanceId}` : '') + (mat && mat.name ? ` [${mat.name}]` : '');
    this.pick = { point: hit.point.clone(), dist: hit.distance, name };
    const p = hit.point;
    const text = `[${f2(p.x)}, ${f2(p.y)}, ${f2(p.z)}] // ${name}, ${f2(hit.distance)} m away`;
    console.log('[freecam] pick', text, hit.object);
    this.copy(text);
  }

  copyPose() {
    const p = this.cam.position;
    const text = `{ pos: [${f2(p.x)}, ${f2(p.y)}, ${f2(p.z)}], yaw: ${(this.yaw / DEG).toFixed(1)}, pitch: ${(this.pitch / DEG).toFixed(1)} } // degrees`;
    console.log('[freecam] pose', text);
    this.copy(text);
  }

  copy(text) {
    const done = () => this.say('copied');
    try { navigator.clipboard.writeText(text).then(done, () => this.say('(see the console)')); } catch { this.say('(see the console)'); }
  }

  /** A metre grid (10 m lines heavier) with the axes, at the last picked point or the origin. */
  toggleGrid() {
    if (!this.grid) {
      const g = this.grid = new THREE.Group();
      g.name = 'freecam grid';
      const fine = new THREE.GridHelper(60, 60, 0x6a5a3a, 0x3a3a34);
      const coarse = new THREE.GridHelper(600, 60, 0xe0a542, 0x8a7a50);
      for (const m of [fine, coarse]) { m.material.transparent = true; m.material.opacity = 0.6; m.material.depthWrite = false; m.renderOrder = 999; }
      const axes = new THREE.AxesHelper(5); axes.material.depthTest = false; axes.renderOrder = 1000; // the axes show through
      g.add(fine, coarse, axes);
      g.visible = false;
    }
    const g = this.grid, scene = this.activeScene();
    if (g.parent !== scene) scene.add(g);
    g.visible = !g.visible;
    if (g.visible) {
      const p = this.pick ? this.pick.point : new THREE.Vector3();
      g.position.set(Math.round(p.x), p.y + 0.01, Math.round(p.z));
      this.say(`grid at [${Math.round(p.x)}, ${f2(p.y)}, ${Math.round(p.z)}]: 1 m squares, 10 m lines in amber; axes x red, y green, z blue`);
    }
  }

  say(text) { this.note = text; this.noteT = 4; this.draw(); }

  draw() {
    if (!this.on || !this.showInfo) return;
    const p = this.cam.position, k = this.pick;
    const where = this.inHangar ? 'the hangar' : 'the valley';
    const what = this.cine
      ? `${CINES[this.cineState].toLowerCase()} ${this.cinePaused ? 'paused' : this.cineSpeed === 1 ? 'playing' : `playing ×${this.cineSpeed}`}${this.follow ? ' · its own camera' : ''}`
      : `the game holds still${this.deadShown ? '' : ' · the dead hidden'}`;
    const subOn = this.cine && document.getElementById('cine-sub')?.classList.contains('on');
    const sub = subOn ? `${document.getElementById('cine-who').textContent} ${document.getElementById('cine-txt').textContent}`.trim() : '';
    this.el.innerHTML = `<b>FREE CAMERA</b>  <span class="dim">${where} · ${what}</span>
pos   ${f2(p.x)}, ${f2(p.y)}, ${f2(p.z)}
look  yaw ${(this.yaw / DEG).toFixed(1)}°  pitch ${(this.pitch / DEG).toFixed(1)}°   speed ${this.speed.toFixed(1)} m/s${this.bright > 1 ? `   exposure x${this.bright}` : ''}
${k ? `hit   ${f2(k.point.x)}, ${f2(k.point.y)}, ${f2(k.point.z)}  (${f2(k.dist)} m)\n      ${escapeHtml(k.name)}\n` : ''}${sub ? `<span class="sub">${escapeHtml(sub)}</span>\n` : ''}<span class="dim">click / right-drag look · WASD fly · E/Space up · Q down · Shift fast · wheel speed
1-4 viewpoints · 0 start · X pick · C copy pose · G grid · L brighter · [ ] time · Z the dead
${this.cine ? 'P pause · , . seek 5 s · V its own camera · ' : ''}H hide · F9 leave</span>${this.note ? `\n<b>${escapeHtml(this.note)}</b>` : ''}`;
  }
}

/** Something you can stand a model against: not a sprite, a beam, a glow or a particle (see-through, writing no depth). */
function solid(o) {
  if (o.isSprite || o.isPoints || o.isLine) return false;
  const m = Array.isArray(o.material) ? o.material[0] : o.material;
  return !(m && m.transparent && !m.depthWrite);
}

/** Drawn: it and every parent up to the scene visible. */
function shown(o) { for (; o; o = o.parent) if (!o.visible) return false; return true; }

function escapeHtml(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
