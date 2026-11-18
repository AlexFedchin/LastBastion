// Developer free camera: F9 (or FREE CAMERA in the developer panel) lifts the camera off
// the gun and lets you fly anywhere, to look the map over or check a model in place.
// It flies whichever camera is being drawn (the valley, or the hangar at dawn). While it is
// on, nothing happens: the night, the events and the guns stand still and the dead (walking
// or fallen) are hidden; only the ambient world goes on (sky, weather, fires, flags, the
// sound beds). Leaving puts everything back where it was.
//
//   click        capture the mouse to look around (Esc frees it; Esc again leaves)
//   right-drag   look around without capturing the mouse
//   WASD         fly where you look      E / Space up, Q down      Shift faster
//   wheel        cruise speed            1-4 viewpoints, 0 back to where you started
//   X            what is under the crosshair: point, distance, object (copied)
//   C            copy the camera pose    G metre grid (at the last X point)
//   L            brighter (x1, x2, x4), to see a model at night
//   H            hide this readout       F9 leave
import * as THREE from 'three';
import { WORLD } from '../config.js';
import { damp, clamp } from '../core/util.js';

const DEG = Math.PI / 180;
const SENS = 0.0022; // radians per pixel of mouse movement
const MOVE = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Space', 'ShiftLeft', 'ShiftRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const PASS = new Set(['F10', 'F11', 'F12']); // the developer panel, fullscreen, the browser's devtools

/** Viewpoints of the valley: [name, position, the point looked at]. */
const VIEWS = [
  ['the gun nest', [WORLD.CAM.x, WORLD.CAM.y, WORLD.CAM.z], [0, 9.5, -60]],
  ['the tower from the road', [0, 8, -34], [0, 7, 0]],
  ['the valley from above', [0, 75, -125], [0, 0, -30]],
  ['the base behind the wall', [0, 26, 55], [0, 6, 0]],
];

const STYLE = `
body.freecam #hud, body.freecam #screens { visibility: hidden; }
#freecam { position: fixed; left: 16px; top: 16px; z-index: 80; pointer-events: none; display: none; max-width: min(720px, calc(100vw - 32px));
  background: rgba(8, 9, 8, 0.78); border: 1px solid var(--line); padding: 10px 12px; color: var(--bone);
  font: 12px/1.5 var(--mono); white-space: pre-wrap; }
#freecam b { color: var(--amber); font-weight: 600; letter-spacing: 0.2em; }
#freecam .dim { color: var(--bone-dim); }
#freecam-dot { position: fixed; left: 50%; top: 50%; width: 4px; height: 4px; margin: -2px 0 0 -2px; border-radius: 50%; z-index: 80;
  background: var(--amber); box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.7); pointer-events: none; display: none; }
body.freecam #freecam-dot { display: block; }
body.freecam #freecam.on { display: block; }
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

    const st = document.createElement('style'); st.textContent = STYLE; document.head.appendChild(st);
    this.el = document.createElement('div'); this.el.id = 'freecam'; this.el.className = 'on'; document.body.appendChild(this.el);
    const dot = document.createElement('div'); dot.id = 'freecam-dot'; document.body.appendChild(dot);

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

  toggle(on = !this.on) { if (on) this.enter(); else this.exit(); }

  enter() {
    if (this.on) return;
    const g = this.g;
    if (g.deploying) return;
    const cam = this.cam = this.activeCamera();
    this.inHangar = cam !== g.camera;
    this.saved = { pos: cam.position.clone(), quat: cam.quaternion.clone(), fov: cam.fov, gun: g.player.gun.visible };
    const e = new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ');
    this.yaw = e.y; this.pitch = e.x;
    this.vel.set(0, 0, 0);
    this.keys.clear();
    this.on = true;
    g.player.gun.visible = false;
    this.hidden = this.hordeMeshes().map((m) => [m, m.visible]);
    for (const [m] of this.hidden) m.visible = false;
    document.body.classList.add('freecam');
    this.say('click to look around · F9 to leave');
    this.draw();
  }

  /** Leave: the camera goes back where it was, the game picks up where it stood. */
  exit() {
    if (!this.on) return;
    const g = this.g, cam = this.cam, s = this.saved;
    this.on = false;
    cam.position.copy(s.pos); cam.quaternion.copy(s.quat);
    if (cam.fov !== s.fov) { cam.fov = s.fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld(true);
    g.player.gun.visible = s.gun;
    for (const [m, v] of this.hidden) m.visible = v;
    if (this.grid) this.grid.visible = false;
    document.body.classList.remove('freecam');
    this.keys.clear();
    // back on the gun: keep the captured mouse; anywhere else, give it back
    if (g.state === 'night') { if (!g.input.locked) g.pause(); } else g.input.unlock();
  }

  onKey(e, down) {
    if (e.code === 'F9') { if (down) { e.preventDefault(); if (!e.repeat) this.toggle(); } e.stopImmediatePropagation(); return; }
    if (!this.on || PASS.has(e.code)) return;
    if (e.target && e.target.closest && e.target.closest('input, select, textarea, #dev')) return; // typing in the developer panel
    e.stopImmediatePropagation();
    if (MOVE.has(e.code) || e.code.startsWith('Digit')) e.preventDefault();
    if (!down) { this.keys.delete(e.code); return; }
    this.keys.add(e.code);
    if (e.repeat) return;
    switch (e.code) {
      case 'Escape': if (!this.g.input.locked && performance.now() - (this.unlockedAt || 0) > 350) this.exit(); break;
      case 'KeyH': this.showInfo = !this.showInfo; this.el.classList.toggle('on', this.showInfo); break;
      case 'KeyX': this.doPick(); break;
      case 'KeyC': this.copyPose(); break;
      case 'KeyG': this.toggleGrid(); break;
      case 'KeyL': this.bright = this.bright >= 4 ? 1 : this.bright * 2; this.say(`exposure x${this.bright}`); break;
      case 'Digit0': this.go(this.saved.pos, null, this.saved.quat); break;
      default:
        if (/^Digit[1-9]$/.test(e.code)) {
          const v = VIEWS[+e.code.slice(5) - 1];
          if (!v) break;
          if (this.inHangar) { this.say('viewpoints are for the valley'); break; }
          this.go(new THREE.Vector3(...v[1]), new THREE.Vector3(...v[2]));
          this.say(v[0]);
        }
    }
  }

  look(dx, dy) {
    this.yaw -= dx * SENS;
    this.pitch = clamp(this.pitch - dy * SENS, -89 * DEG, 89 * DEG);
  }

  /** Jump to a position, looking at a point (or with a given orientation). */
  go(pos, at, quat) {
    this.cam.position.copy(pos);
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

  /** Real-time tick (the game calls it instead of its own state while flying). */
  update(rdt) {
    if (!this.on) return;
    const k = this.keys, cam = this.cam;
    const f = (+(k.has('KeyW') || k.has('ArrowUp'))) - (+(k.has('KeyS') || k.has('ArrowDown')));
    const r = (+(k.has('KeyD') || k.has('ArrowRight'))) - (+(k.has('KeyA') || k.has('ArrowLeft')));
    const u = (+(k.has('KeyE') || k.has('Space'))) - (+k.has('KeyQ'));
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const v = (this.speed * (k.has('ShiftLeft') || k.has('ShiftRight') ? 5 : 1)) / (this.inHangar ? 6 : 1);
    // fly where you look; strafe level; up and down along the world's up
    const tx = (-sy * cp * f + cy * r) * v, ty = (sp * f + u) * v, tz = (-cy * cp * f - sy * r) * v;
    this.vel.set(damp(this.vel.x, tx, 10, rdt), damp(this.vel.y, ty, 10, rdt), damp(this.vel.z, tz, 10, rdt));
    cam.position.addScaledVector(this.vel, rdt);
    cam.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    cam.updateMatrixWorld(true);
    if (this.noteT > 0) { this.noteT -= rdt; if (this.noteT <= 0) this.note = ''; }
    this.draw();
  }

  /** What is under the crosshair. */
  doPick() {
    const cam = this.cam;
    this.ray.setFromCamera({ x: 0, y: 0 }, cam);
    this.ray.params.Points = { threshold: 0.2 };
    this.ray.params.Line = { threshold: 0.1 };
    let hits = [];
    try { hits = this.ray.intersectObject(this.activeScene(), true); } catch (err) { console.warn('[freecam] pick', err); }
    const hit = hits.find((h) => shown(h.object) && !h.object.isSprite && !(this.grid && this.grid.children.includes(h.object)));
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
    this.el.innerHTML = `<b>FREE CAMERA</b>  <span class="dim">${this.inHangar ? 'the hangar' : 'the valley'} · the game holds still · the dead hidden</span>
pos   ${f2(p.x)}, ${f2(p.y)}, ${f2(p.z)}
look  yaw ${(this.yaw / DEG).toFixed(1)}°  pitch ${(this.pitch / DEG).toFixed(1)}°   speed ${this.speed.toFixed(1)} m/s${this.bright > 1 ? `   exposure x${this.bright}` : ''}
${k ? `hit   ${f2(k.point.x)}, ${f2(k.point.y)}, ${f2(k.point.z)}  (${f2(k.dist)} m)\n      ${escapeHtml(k.name)}\n` : ''}<span class="dim">click / right-drag look · WASD fly · E/Space up · Q down · Shift fast · wheel speed
1-4 viewpoints · 0 start · X pick · C copy pose · G grid · L brighter · H hide · F9 leave</span>${this.note ? `\n<b>${escapeHtml(this.note)}</b>` : ''}`;
  }
}

/** Drawn: it and every parent up to the scene visible. */
function shown(o) { for (; o; o = o.parent) if (!o.visible) return false; return true; }

function escapeHtml(s) { return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
