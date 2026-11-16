// The ending: the morning after the seventy-second hour, staged in the engine.
// Kovac's broadcast is answered at last; survivors come up the road and in through
// the gate; then the light goes, the dead come down the valley again, and the
// narrator gives the place its name. The script (ENDING in config.js) is voiced:
// every cue lasts as long as its recording, and the shots are cut to the cues.
import * as THREE from 'three';
import { WORLD, ENDING } from '../config.js';
import { clamp, lerp, rand, fitFov } from '../core/util.js';
import { groundH } from '../world/terrain.js';
import { Survivor, ADULTS, WALKS } from './survivor.js';
import { Soldier } from './soldier.js';
import { walkStep } from '../world/obstacles.js';

const $ = (id) => document.getElementById(id);
const ease = (k) => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const pickOne = (a) => a[(Math.random() * a.length) | 0];
const TOP = WORLD.TOWER_TOP;
const GATE_Z = -10.5;
const ROAD_FROM = -104, ROAD_TO = GATE_Z + 0.4; // the column walks this stretch, then goes in
const TRACK = { z0: -66, speed: 1.15 };          // the tracking shot keeps pace with the column
const GAP = 0.8;                                  // default silence between cues
const TAIL = 5.5;                                 // after the last word, before the fade
const FADE_OUT = 3;

// Each shot maps k (0..1 across the shot) to a camera pose.
const SHOTS = {
  // over the shoulder of the fifty, out across the valley it held
  gun: (k, t, E) => {
    const c = E.gunAt, e = ease(k);
    return {
      pos: V(c.x + 0.75, c.y + 0.3, c.z + 2.2).lerp(V(c.x + 0.2, c.y + 0.75, c.z + 1.0), e),
      look: V(c.x - 0.1, c.y + 0.15, c.z - 6).lerp(V(0, 2, -115), e), fov: 42,
    };
  },
  // the set in the nest, where Kovac sat with the handset
  radio: (k) => ({ pos: V(-1.2, TOP + 0.78, -2.2).lerp(V(-1.55, TOP + 0.62, -1.9), ease(k)), look: V(-2.2, TOP + 0.24, -1.25), fov: 38 }),
  // from out on the road: the wall, small, still standing
  field: (k) => ({ pos: V(7, 0, -80).lerp(V(5, 0, -62), ease(k)), ground: 2.0, look: V(0, 7.5, -2), fov: 40 }),
  // alongside the column as it walks
  road: (k, t) => {
    const z = TRACK.z0 + t * TRACK.speed;
    return { pos: V(-12, 0, z + 8), ground: 4.2, look: V(0.5, 0, z - 7), lookGround: 1.0, fov: 40 };
  },
  // from the wall top: the column coming in through the gate
  gate: (k) => ({ pos: V(11.5, 9.6, -4.2).lerp(V(8.5, 10.6, -6.5), ease(k)), look: V(-1, 0.4, -40), fov: 46 }),
  // up and away over the bastion as the light goes
  crane: (k) => ({ pos: V(7, 16, 12).lerp(V(-30, 66, 56), ease(k)), look: V(0, 7, -40).lerp(V(0, 0, -175), ease(k)), fov: 50 }),
};

export class Ending {
  constructor(game) {
    this.g = game;
    this.active = false;
    this.built = false;
  }

  /** Make the cast once, the first time the ending plays. */
  build() {
    if (this.built) return;
    this.built = true;
    const scene = this.g.scene;
    this.people = [];
    // families: about one in four a child
    for (let k = 0; k < 46; k++) {
      const p = new Survivor(k % 5 === 3 || k % 7 === 5 ? 'child' : ADULTS[k % ADULTS.length]);
      scene.add(p.root); this.people.push(p);
    }
    this.troops = [];
    for (let k = 0; k < 8; k++) { const s = new Soldier(); scene.add(s.root); this.troops.push(s); }
  }

  start() {
    const g = this.g;
    this.build();
    this.active = true;
    this.t = 0;
    this.skipArm = 0;
    this.titleOn = false;
    // the script: each cue as long as its recording (or a reading pace without one)
    const A = g.audio;
    let at = 0;
    this.cues = ENDING.map((c, i) => {
      at += c.gap ?? (i ? GAP : 0);
      const buf = A.voices_ && A.voices_[c.who + '|' + c.text];
      const dur = buf ? buf.duration + 0.15 : 1.2 + c.text.split(/\s+/).length / 2.6;
      const cue = { ...c, at, dur, done: false };
      at += dur;
      return cue;
    });
    this.end = at + TAIL;
    // shots run from the start of their cue's gap to the next shot
    this.shots = [];
    this.cues.forEach((c, i) => {
      if (!c.shot) return;
      const from = i ? c.at - (c.gap ?? GAP) : 0;
      if (this.shots.length) this.shots[this.shots.length - 1].to = from;
      this.shots.push({ name: c.shot, from, to: this.end + FADE_OUT });
    });
    const title = this.cues.find((c) => c.title);
    this.titleAt = title ? title.at + title.dur - 0.4 : Infinity;
    this.duskFrom = this.shots.find((s) => s.name === 'crane')?.from ?? this.end;

    // the morning: nobody left alive in the valley, the gun lifted off its pintle for its close-up
    g.horde.clearLiving();
    g.events.reset();
    g.hud.show(false);
    g.letterboxTarget = 1;
    g.env.dawn = 1;
    g.audio.setMusicMode('victory');
    g.audio.intensity = 0; g.audio.pressure = 0;
    this.placeGun();
    this.stageColumn();
    $('cine-sub').classList.remove('on');
    $('cine-title').classList.remove('on');
    $('cine-skip').classList.remove('on');
    g.screens.show('cine');
  }

  /** The fifty stays in the nest, pointed down the valley (it normally rides the camera). */
  placeGun() {
    const g = this.g, gun = g.player.gun;
    this.gunLocal = { pos: gun.position.clone(), rot: gun.rotation.clone(), scale: gun.scale.clone() };
    g.scene.add(gun);
    gun.position.set(WORLD.CAM.x, TOP, WORLD.CAM.z - 0.8);
    gun.rotation.set(-0.06, 0, 0);
    gun.visible = true;
    gun.updateMatrixWorld(true);
    // seat the pintle on the nest floor (on the camera it hangs below the view)
    const box = new THREE.Box3().setFromObject(gun);
    gun.position.y += TOP + 0.05 - box.min.y;
    gun.updateMatrixWorld(true);
    box.setFromObject(gun);
    this.gunAt = box.getCenter(new THREE.Vector3());
    this.gunAt.y = box.max.y - 0.2;
  }

  restoreGun() {
    const g = this.g, gun = g.player.gun;
    if (!this.gunLocal || gun.parent === g.camera) return;
    g.camera.add(gun);
    gun.position.copy(this.gunLocal.pos);
    gun.rotation.copy(this.gunLocal.rot);
    gun.scale.copy(this.gunLocal.scale);
  }

  /** The survivors on the road (hidden until their shot), a truck among them, and men at the gate. */
  stageColumn() {
    const n = this.people.length + this.troops.length;
    this.walkers = [];
    let k = 0;
    const span = ROAD_TO - ROAD_FROM;
    const place = (f, soldier, kid) => {
      const z = ROAD_FROM + (k++ / n) * span + rand(-1.2, 1.2);
      const lane = soldier ? rand(-2.8, -1.4) : rand(-2.2, 2.6);
      this.walkers.push({ f, soldier, kid, x: lane, lane, z, yaw: 0, bias: k % 2 ? 1 : -1, sp: rand(1.0, 1.35) * (kid ? 0.95 : 1), ph: Math.random() * 6 });
    };
    // families, stragglers, and soldiers with no unit
    const order = [];
    for (let i = 0; i < this.people.length; i++) order.push(['p', i]);
    for (let i = 0; i < this.troops.length; i++) order.splice(((i + 0.5) / this.troops.length) * order.length | 0, 0, ['s', i]);
    for (const [kind, i] of order) {
      if (kind === 's') { const s = this.troops[i]; s.reset(); s.root.scale.setScalar(rand(0.97, 1.03)); place(s, true, false); continue; }
      const p = this.people[i];
      const kid = p.child;
      // most just tired; some nursing an arm, a few limping (and slower for it)
      p.gait = kid ? 'walk_sad' : WALKS[Math.random() < 0.6 ? 0 : Math.random() < 0.6 ? 1 : 2];
      p.reset();
      p.root.scale.setScalar(kid ? rand(0.74, 0.86) : rand(0.95, 1.04));
      place(p, false, kid);
      this.walkers[this.walkers.length - 1].sp *= p.pace;
    }
    for (const w of this.walkers) w.f.root.visible = false;
    // the quarry's tractor-trailer stand-in: the survivors' truck, crawling up behind them
    this.truck = { z: -135, sp: 3.2, on: false };
    // the gate squad, out on the road to bring them in
    this.guards = this.g.events.soldiers.slice(8, 12).map((s, i) => {
      const side = i % 2 ? 1 : -1, x = side * (i < 2 ? 4.2 : 6.6), z = GATE_Z - 2.5 - (i < 2 ? 0 : 1.2);
      s.reset(); s.idle();
      s.root.position.set(x, groundH(x, z), z);
      s.root.rotation.y = Math.PI + side * 0.55;
      s.root.visible = false;
      return s;
    });
    this.columnOn = false;
  }

  showColumn(on) {
    if (this.columnOn === on) return;
    this.columnOn = on;
    for (const w of this.walkers) w.f.root.visible = on;
    for (const s of this.guards) s.root.visible = on;
    this.truck.on = on;
    this.g.events.truck.visible = on;
  }

  updateColumn(dt) {
    for (const w of this.walkers) {
      // along the road, round the wrecks on it
      const wv = walkStep(w, (w.lane - w.x) * 0.3, w.sp, dt, 0.35);
      w.yaw = Math.atan2(wv[0], wv[1]);
      if (Math.random() < dt * 0.05) w.lane = w.soldier ? rand(-2.8, -1.4) : rand(-2.2, 2.6);
      // through the gate: walk on from the far end of the column
      if (w.z > ROAD_TO) { w.z -= ROAD_TO - ROAD_FROM; w.x = w.lane; }
      const f = w.f;
      w.ph += dt * w.sp * 3.1;
      f.walk(w.ph / 3.1); // 3.1 rad per metre
      f.root.position.set(w.x, groundH(w.x, w.z), w.z);
      f.root.rotation.y += (w.yaw - f.root.rotation.y) * Math.min(1, dt * 5);
    }
    for (const s of this.guards) if (s.root.visible) s.idle();
    const T = this.truck, M = this.g.events.truck;
    if (T.on) {
      T.z += T.sp * dt;
      if (T.z > GATE_Z - 3) { T.z = GATE_Z - 3; T.sp = 0; }
      const x = 2.6;
      M.position.set(x, groundH(x, T.z), T.z);
      M.rotation.set(0, -Math.PI / 2, Math.sin(this.t * 7) * 0.006 * T.sp);
    }
  }

  /** Space / Enter / Esc / click: first press offers to skip, the second skips. */
  skipPress() {
    if (!this.active) return;
    if (this.skipArm > 0) { this.finish(); return; }
    this.skipArm = 2.6;
    $('cine-skip').classList.add('on');
  }

  update(dt, rdt) {
    if (!this.active) return;
    const g = this.g;
    this.t += rdt;
    const t = this.t;
    if (this.skipArm > 0) { this.skipArm -= rdt; if (this.skipArm <= 0) $('cine-skip').classList.remove('on'); }

    // the script
    for (const c of this.cues) {
      if (c.done || t < c.at) continue;
      c.done = true;
      let len = 0;
      if (c.radio) { len = g.audio.radioVoice(c.who, c.text, 0.3); g.audio.radioStatic(Math.max(0.6, (len || c.dur) - 0.1)); } else len = g.audio.narrate(c.who, c.text, 0.05);
      void len;
      this.showSub(c);
    }
    const cur = this.cues.find((c) => t >= c.at && t < c.at + c.dur + 0.5);
    if (!cur) $('cine-sub').classList.remove('on');
    if (!this.titleOn && t >= this.titleAt) { this.titleOn = true; $('cine-title').classList.add('on'); }

    // the shot
    const s = this.shots.find((x) => t >= x.from && t < x.to) || this.shots[this.shots.length - 1];
    const st = t - s.from, k = clamp(st / Math.max(0.01, s.to - s.from), 0, 1);
    const p = SHOTS[s.name](k, st, this);
    if (p.ground !== undefined) p.pos.y = groundH(p.pos.x, p.pos.z) + p.ground;
    if (p.lookGround !== undefined) p.look.y = groundH(p.look.x, p.look.z) + p.lookGround;
    const cam = g.camera;
    cam.position.copy(p.pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(p.look);
    const fov = fitFov(p.fov, cam.aspect);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld(true);

    // who is where in it
    const road = s.name === 'road' || s.name === 'gate';
    this.showColumn(road);
    if (road) this.updateColumn(dt);
    g.player.gun.visible = s.name === 'gun' || s.name === 'radio';

    // the light: grey morning, then dusk over the crane, and the dead come back down the valley
    const dusk = ease((t - this.duskFrom) / 12);
    g.env.dawn = lerp(1, 0.3, dusk);
    if (dusk > 0.3 && !this.deadBack) {
      this.deadBack = true;
      for (let i = 0; i < 160; i++) g.spawnMenuZombie(rand(-260, -190));
    }
    if (this.deadBack) g.horde.update(dt, g.time);

    // dips to black between shots; in from black at the start, out at the end
    let fade = Math.min(1, t / 1.6);
    for (const x of this.shots) { if (x.from > 0) fade = Math.min(fade, Math.abs(t - x.from) / 0.4); }
    if (t > this.end) fade = Math.min(fade, 1 - (t - this.end) / FADE_OUT);
    g.post.u.uFade.value = clamp(fade, 0, 1);
    if (t > this.end + FADE_OUT) this.finish();
  }

  showSub(c) {
    const el = $('cine-sub');
    $('cine-who').textContent = c.radio ? `RADIO — ${c.who}` : '';
    $('cine-who').style.display = c.radio ? '' : 'none';
    $('cine-txt').textContent = c.text;
    el.classList.toggle('narr', !c.radio);
    el.classList.remove('on');
    void el.offsetWidth; // restart the fade-in
    el.classList.add('on');
  }

  finish() {
    if (!this.active) return;
    this.stop();
    this.g.onEndingDone();
  }

  /** Tear the scene down (also used when leaving to the menu). */
  stop() {
    if (!this.active) return;
    this.active = false;
    const g = this.g;
    g.audio.stopVoice();
    this.showColumn(false);
    this.restoreGun();
    g.post.u.uFade.value = 1;
    g.horde.clearLiving();
    this.deadBack = false;
    $('cine-sub').classList.remove('on');
    $('cine-title').classList.remove('on');
  }
}


