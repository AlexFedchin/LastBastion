// The good ending: the extraction. With at least EXTRACTION.souls alive at the start
// of the last night, night 10 is a hold (ExtractionHold, run like a night event): the
// flight is inbound, the radio counts it down, and for the last minute and a half
// everything in the valley comes over the ridge at once. If the wall still stands when
// the flight is overhead, ExtractionScene plays, still at night: the bombers carpet the
// field, two gunship helicopters circle it with their searchlights and miniguns, the
// lifters land behind the wall, the garrison runs for the ramps, and they leave the gun
// on the wall with the dead coming over it. Voiced and cut to the script like the
// other ending (EXTRACT_ENDING in config.js).
import * as THREE from 'three';
import { WORLD, EXTRACTION, EXTRACT_ENDING, ZT, wallZ } from '../config.js';
import { clamp, lerp, rand, fitFov } from '../core/util.js';
import { groundH } from '../world/terrain.js';
import { Survivor, ADULTS } from './survivor.js';
import { Soldier } from './soldier.js';
import { buildBomber, buildBomb } from './air.js';
import { makeAttackHeli, makeLifter, spinRotors, makeBeam, aimBeam } from './helis.js';

const $ = (id) => document.getElementById(id);
const ease = (k) => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const R = Math.random;
const GAP = 0.8, TAIL = 5, FADE_OUT = 3;
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4();

// ─────────────────────────────────────────────────────────────────────────────
/** Night 10, the hold: an event in NightEvents' list (blocking, so the night can't end on its own). */
export class ExtractionHold {
  constructor(g) {
    this.g = g; this.P = EXTRACTION; this.kind = 'extraction'; this.blocking = true; this.pinned = true;
    this.t = 0; this.said = new Set(); this.acc = 0; this.overrun = false; this.done = false;
  }

  start() { this.g.hud.alert('EXTRACTION INBOUND — HOLD THE WALL UNTIL THE FLIGHT IS OVERHEAD'); }

  get left() { return Math.max(0, this.P.hold - this.t); }

  update(dt) {
    const g = this.g, P = this.P, left = this.P.hold - (this.t += dt);
    P.lines.forEach(([at, who, text], k) => {
      if (this.said.has(k)) return;
      if (at === 'start' ? this.t >= 4 : left <= at) { this.said.add(k); g.hud.radio(who, text, at !== 'start' && at < 100); }
    });
    // the overrun: the whole valley at once, and faster
    if (left <= P.overrun) {
      if (!this.overrun) {
        this.overrun = true;
        g.hud.announce('THE OVERRUN', 'EVERYTHING IN THE VALLEY IS COMING', 4, 'red');
        g.audio.setTide(true); g.audio.horn(); setTimeout(() => g.audio.horn(), 1600);
      }
      const d = g.director, plan = g.plan;
      this.acc += P.overrunRate * dt * (0.6 + 0.8 * (1 - left / P.overrun));
      while (this.acc >= 1) {
        this.acc -= 1;
        const r = R(), type = r < 0.5 ? ZT.RUNNER : r < 0.93 ? ZT.SHAMBLER : r < 0.97 ? ZT.BRUTE : ZT.BLOATER;
        d.queue.push({ type, x: rand(-WORLD.SPAWN_X, WORLD.SPAWN_X), z: WORLD.SPAWN_Z_NEAR + rand(0, 25), side: 0, delay: 0 });
      }
      g.horde.globalSpeed = Math.max(g.horde.globalSpeed, 1.2);
      void plan;
    }
    // the flight, heard before it is seen: rotors coming up the valley behind the wall
    if (left < 30) {
      const A = g.audio;
      if (!this.rotor && A.ready && A.B.rotor) this.rotor = A.loop(A.B.rotor[1], { ref: 260, reverb: 0.4 });
      if (this.rotor) { const z = 40 + left * 22; this.rotor.update(0, 120, z, 0, 0, -22, 1.6 * (1 - left / 30)); }
    }
    if (left <= 0 && !this.done) {
      this.done = true;
      g.playExtraction();
      return true;
    }
    return false;
  }

  end() { if (this.rotor) { this.rotor.stop(3); this.rotor = null; } }

  objective() {
    const s = Math.ceil(this.left), m = Math.floor(s / 60), ss = String(s % 60).padStart(2, '0');
    return {
      title: 'EXTRACTION INBOUND',
      text: `${m}:${ss} UNTIL THE FLIGHT IS OVERHEAD · HOLD THE WALL`,
      progress: clamp(this.t / this.P.hold, 0, 1), cls: this.overrun ? 'danger' : '',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Where the lifters set down behind the wall (nose away from the wall: the ramp faces the yard).
const LZ = [
  { x: 0, z: 54, yaw: 0 },
  { x: -27, z: 66, yaw: 0.35 },
  { x: 27, z: 66, yaw: -0.35 },
];
const ORBIT = { x: 0, z: -78, r: 72, alt: 30, w: 0.29 };

// Each shot maps (k 0..1 over the shot, seconds into it, the scene) to a camera pose.
const SHOTS = {
  // on the left wing's walkway, the gunners firing, the field black with them
  overrun: (k, st) => ({
    pos: V(-22 - k * 3, WORLD.WALL_H + 1.75, wallZ(-22) + 2.2), look: V(-46 + k * 6, 1.5, -40 + k * 4), fov: 50, shake: 0.35,
  }),
  // from the nest roof: up at the bombers coming over, then down onto the field as it erupts
  bombers: (k, st) => {
    const u = ease(st / 3.4);
    return { pos: V(3.5, WORLD.TOWER_TOP + 2.4, 3.5), look: V(0, 150, -40).lerp(V(-4, 0, -120), u), fov: lerp(62, 48, u), shake: 0.15 };
  },
  // riding behind the lead gunship as it comes over the wall and swings round the field
  helos: (k, st, S) => {
    const h = S.helos[0];
    const f = h.fwd, p = h.pos;
    return { pos: V(p.x - f.x * 26 + h.side.x * 7, p.y + 8, p.z - f.z * 26 + h.side.z * 7), look: V(p.x + f.x * 34, p.y - 20, p.z + f.z * 34), fov: 50, shake: 0.12 };
  },
  // in the yard: the lead lifter settles in its own dust and drops the ramp
  lz: (k) => ({ pos: V(15, 0, 25).lerp(V(12, 0, 29), ease(k)), ground: 1.7, look: V(0, 5, 52), fov: 48, shake: 0.2 }),
  // low behind the garrison running for the ramp
  run: (k, st, S) => {
    const z = lerp(10, 33, ease(k));
    return { pos: V(-4.5, 0, z - 6), ground: 1.5, look: V(0.5, 1.6, LZ[0].z - 9), fov: 50, shake: 0.18 };
  },
  // at the foot of the ramp, looking back: the last of them running past, the wall burning behind them
  ramp: (k, st, S) => {
    const L = S.lifters[0];
    L.group.updateMatrixWorld();
    return { pos: _v.set(2.4, -0.9, -11.5).applyMatrix4(L.group.matrixWorld).clone(), look: V(-1, 3, 4), fov: 52, shake: 0.12 };
  },
  // off the back of the lifter as it climbs away: the dead on the wall, the gun still there
  liftoff: (k, st, S) => {
    const L = S.lifters[0];
    L.group.updateMatrixWorld();
    const pos = _v.set(-3.4, -1.6, -10.5).applyMatrix4(L.group.matrixWorld).clone();
    return { pos, look: V(0, WORLD.TOWER_TOP - 2, -10).lerp(V(0, 0, -60), ease(k)), fov: 50, shake: 0.08 };
  },
  // high and far: the lifters going away over the hills, the bastion small and burning
  away: (k) => ({ pos: V(70, 85, 210).lerp(V(40, 110, 300), ease(k)), look: V(0, 10, -30).lerp(V(0, 0, -90), ease(k)), fov: 46 }),
};

export class ExtractionScene {
  constructor(game) { this.g = game; this.active = false; this.built = false; }

  build() {
    if (this.built) return;
    this.built = true;
    const scene = this.g.scene;
    this.bombers = [0, 1, 2].map(() => { const b = buildBomber(); b.group.scale.setScalar(0.42); b.group.visible = false; scene.add(b.group); return b; });
    this.bombPool = Array.from({ length: 24 }, () => { const m = buildBomb(); m.visible = false; m.scale.setScalar(0.8); scene.add(m); return m; });
    this.helos = [0, 1].map(() => {
      const h = makeAttackHeli(); h.group.visible = false; scene.add(h.group);
      h.beam = makeBeam(); h.beam.visible = false; scene.add(h.beam);
      h.pos = new THREE.Vector3(); h.fwd = new THREE.Vector3(0, 0, -1); h.side = new THREE.Vector3(1, 0, 0);
      return h;
    });
    this.lifters = LZ.map(() => { const l = makeLifter(); l.group.visible = false; scene.add(l.group); return l; });
    // the garrison: soldiers and the civilians who sheltered behind the wall
    this.troops = Array.from({ length: 12 }, () => { const s = new Soldier(); s.root.visible = false; scene.add(s.root); return s; });
    this.civs = Array.from({ length: 10 }, (_, k) => { const p = new Survivor(k % 4 === 3 ? 'child' : ADULTS[k % 3]); p.root.visible = false; scene.add(p.root); return p; });
  }

  start() {
    const g = this.g;
    this.build();
    this.active = true;
    this.t = 0; this.skipArm = 0; this.titleOn = false; this.shake = 0;
    const A = g.audio;
    let at = 0;
    this.cues = EXTRACT_ENDING.map((c, i) => {
      at += c.gap ?? (i ? GAP : 0);
      const buf = A.voices_ && A.voices_[c.who + '|' + c.text];
      const dur = buf ? buf.duration + 0.15 : 1.2 + c.text.split(/\s+/).length / 2.6;
      const cue = { ...c, at, dur, done: false };
      at += dur;
      return cue;
    });
    this.end = at + TAIL;
    this.shots = [];
    this.cues.forEach((c, i) => {
      if (!c.shot) return;
      const from = i ? c.at - (c.gap ?? GAP) : 0;
      if (this.shots.length) this.shots[this.shots.length - 1].to = from;
      this.shots.push({ name: c.shot, from, to: this.end + FADE_OUT });
    });
    const T = (n) => this.shots.find((s) => s.name === n)?.from ?? 0;
    this.T = { bomb: T('bombers'), helo: T('helos'), lz: T('lz'), run: T('run'), ramp: T('ramp'), lift: T('liftoff'), away: T('away') };
    const title = this.cues.find((c) => c.title);
    this.titleAt = title ? title.at + title.dur - 0.4 : Infinity;

    // the world: still night, the wall still fighting, the field full of them
    g.hud.show(false);
    g.letterboxTarget = 1;
    // the fifty stays in the nest, pointed down the valley: they leave it there
    g.ending.placeGun();
    g.audio.intensity = 1; g.audio.pressure = 0.8;
    this.pileMul0 = g.horde.pileMul;
    g.horde.pileMul = Math.max(g.horde.pileMul, 1.6);
    for (let i = 0; i < 260; i++) g.horde.spawn(R() < 0.45 ? ZT.RUNNER : ZT.SHAMBLER, rand(-110, 110), rand(-150, -40), 1, 1.1);
    this.planBombs();
    this.stageHelos();
    this.stageLifters();
    this.stagePeople();
    this.lamps = [];
    $('cine-sub').classList.remove('on');
    $('cine-title').classList.remove('on');
    $('cine-skip').classList.remove('on');
    g.screens.show('cine');
  }

  // ── the bombers: three B-36s line abreast, each walking a stick of bombs up the field ──
  planBombs() {
    const t0 = this.T.bomb - 5.2, v = 78, alt = 125, fall = 2.4; // over the wall ~1.5 s into the shot
    this.drops = [];
    this.bomberRuns = this.bombers.map((b, k) => {
      const x = [-42, 2, 44][k] + rand(-4, 4), start = t0 + [0.6, 0, 1.1][k];
      const run = { b, x, start, v, alt, z0: 520, loop: null };
      b.group.visible = false;
      // a stick: from just off the wall face out to the far field
      const zFirst = wallZ(x) - 16;
      for (let i = 0; i < 17; i++) {
        const zi = zFirst - i * 13.5 + rand(-2, 2), xi = x + rand(-7, 7);
        const zr = zi + v * fall * 0.75;
        const trel = start + (run.z0 - zr) / v;
        this.drops.push({ run, xi, zi, xr: x, zr, trel, timp: trel + fall, fall, mesh: null, done: false, big: i % 5 === 2 });
      }
      return run;
    });
  }

  updateBombers(dt) {
    const g = this.g, fx = g.fx, t = this.t;
    for (const r of this.bomberRuns) {
      const s = t - r.start;
      const grp = r.b.group;
      if (s < 0 || s > 16) { if (grp.visible) { grp.visible = false; if (r.loop) { r.loop.stop(3); r.loop = null; } } continue; }
      const z = r.z0 - r.v * s, x = r.x, y = r.alt;
      grp.visible = true;
      grp.position.set(x, y, z);
      grp.lookAt(x, y, z - 1);
      grp.updateMatrixWorld();
      for (const p of r.b.props) p.rotation.z += dt * 30;
      for (const e of r.b.engines) { _v.copy(e).applyMatrix4(grp.matrixWorld); fx.glowDot(_v.x, _v.y, _v.z, 1.0, 3.2, 1.4, 0.5, 0.05); }
      if ((performance.now() % 900) < 80) { _v.copy(r.b.lights.tail).applyMatrix4(grp.matrixWorld); fx.glowDot(_v.x, _v.y, _v.z, 2.2, 8, 8, 8, 0.05); }
      if (!r.loop && g.audio.ready && g.audio.B.jet) r.loop = g.audio.loop(g.audio.B.jet[0], { ref: 150, reverb: 0.35 });
      if (r.loop) r.loop.update(x, y, z, 0, 0, -r.v, 2.6);
    }
    for (const d of this.drops) {
      if (d.done || t < d.trel) continue;
      if (!d.mesh) { d.mesh = this.bombPool.find((m) => !m.visible) || null; if (d.mesh) d.mesh.visible = true; }
      const u = clamp((t - d.trel) / d.fall, 0, 1);
      const gy = groundH(d.xi, d.zi);
      if (d.mesh) {
        const x = lerp(d.xr, d.xi, u), z = lerp(d.zr, d.zi, u), y = lerp(d.run.alt - 3, gy, u * u);
        d.mesh.position.set(x, y, z);
        d.mesh.lookAt(x + (d.xi - d.xr) * 0.1, y - 2 * u * (d.run.alt - gy) * 0.05 - 0.4, z + (d.zi - d.zr) * 0.1);
      }
      if (t >= d.timp) {
        d.done = true;
        if (d.mesh) { d.mesh.visible = false; d.mesh = null; }
        this.blast(d.xi, gy, d.zi, d.big);
      }
    }
  }

  blast(x, gy, z, big) {
    const g = this.g;
    if (big) g.fx.bigExplosion(x, gy, z, 0.8); else g.fx.explosion(x, gy, z, 1.7);
    g.horde.explode(x, gy + 0.5, z, big ? 20 : 14, 3200, 'bomb', { push: big ? 2.4 : 1.8, ignite: true });
    if (big) g.audio.bigBlast(x, z);
    else if (R() < 0.6) g.audio.explosion(x, z, 1.6);
    const cam = g.camera.position, d = Math.hypot(x - cam.x, z - cam.z);
    this.shake = Math.min(1.4, this.shake + (big ? 30 : 14) / (d + 20));
  }

  // ── the gunship helicopters ──
  stageHelos() {
    this.helos.forEach((h, k) => {
      h.k = k; h.group.visible = false; h.beam.visible = false;
      h.enter = this.T.helo - 2.2 + k * 1.4;              // when it starts its run in from behind the base
      h.orbitAt = h.enter + 7;                            // when it is established on the orbit
      h.phase0 = k ? Math.PI * 0.15 : Math.PI * 1.15;     // where on the orbit it arrives
      h.from = V(k ? 70 : -60, 70, 300);
      h.burst = 0; h.nextBurst = h.orbitAt + 0.8 + k * 1.3; h.round = 0; h.rocket = h.orbitAt + 2.5 + k;
      h.loop = null; h.light = null; h.tgt = new THREE.Vector3();
    });
  }

  orbitPos(h, t, out) {
    const a = h.phase0 + (t - h.orbitAt) * ORBIT.w;
    return out.set(ORBIT.x + Math.cos(a) * ORBIT.r, ORBIT.alt + Math.sin(t * 0.7 + h.k) * 2.5, ORBIT.z + Math.sin(a) * ORBIT.r);
  }

  helPos(h, t, out) {
    if (t >= h.orbitAt) return this.orbitPos(h, t, out);
    // a curve in from behind the base, over the wall, onto the orbit
    const u = clamp((t - h.enter) / (h.orbitAt - h.enter), 0, 1), e = u * u * (3 - 2 * u) * 0.5 + u * 0.5;
    const p1 = this.orbitPos(h, h.orbitAt, _w).clone();
    const mid = V(h.from.x * 0.7 + p1.x * 0.3, 42, 6); // over a wing, clear of the nest
    const a = h.from.clone().lerp(mid, e), b = mid.clone().lerp(p1, e);
    return out.copy(a.lerp(b, e));
  }

  updateHelos(dt) {
    const g = this.g, fx = g.fx, h0 = g.horde, t = this.t;
    for (const h of this.helos) {
      if (t < h.enter) continue;
      const grp = h.group;
      grp.visible = true;
      this.helPos(h, t, h.pos);
      this.helPos(h, t + 0.25, _w);
      const vx = (_w.x - h.pos.x) / 0.25, vy = (_w.y - h.pos.y) / 0.25, vz = (_w.z - h.pos.z) / 0.25;
      const sp = Math.hypot(vx, vz) || 1;
      h.fwd.set(vx / sp, 0, vz / sp);
      h.side.set(h.fwd.z, 0, -h.fwd.x);
      // nose into the turn a little (toward the field's centre) so the gun bears inward
      const inward = t >= h.orbitAt ? 0.45 : 0;
      const yaw = Math.atan2(h.fwd.x, h.fwd.z) + inward;
      const bank = t >= h.orbitAt ? -0.32 : 0.08 * Math.sin(t * 1.3);
      grp.position.copy(h.pos);
      grp.rotation.set(0.12 + Math.min(0.15, sp * 0.004), yaw, bank, 'YXZ');
      grp.updateMatrixWorld();
      spinRotors(h, dt, 1);
      // nav lights, the anti-collision strobe
      _v.copy(h.lights.port).applyMatrix4(grp.matrixWorld); fx.glowDot(_v.x, _v.y, _v.z, 0.9, 6, 0.4, 0.3, 0.05);
      _v.copy(h.lights.stbd).applyMatrix4(grp.matrixWorld); fx.glowDot(_v.x, _v.y, _v.z, 0.9, 0.3, 5, 0.8, 0.05);
      if (((t * 1.3 + h.k * 0.4) % 1) < 0.08) { _v.copy(h.lights.tail).applyMatrix4(grp.matrixWorld); fx.glowDot(_v.x, _v.y, _v.z, 2, 8, 8, 8, 0.05); }
      // sound
      if (!h.loop && g.audio.ready && g.audio.B.rotor) h.loop = g.audio.loop(g.audio.B.rotor[0], { ref: 110, reverb: 0.3, rate: 0.96 + h.k * 0.07 });
      if (h.loop) h.loop.update(h.pos.x, h.pos.y, h.pos.z, vx, vy, vz, 2.2);
      // the searchlight: sweeping the dead at the foot of the wall
      const lamp = _v.copy(h.lamp).applyMatrix4(grp.matrixWorld).clone();
      if (t >= h.orbitAt - 2) {
        const sw = t * 0.45 + h.k * 2;
        const tx = h.pos.x * 0.35 + Math.sin(sw) * 18, tz = clamp(h.pos.z * 0.35 - 30 + Math.cos(sw * 0.8) * 16, -110, wallZ(h.pos.x * 0.35) - 6);
        h.tgt.x += (tx - h.tgt.x) * Math.min(1, dt * 2.5); h.tgt.z += (tz - h.tgt.z) * Math.min(1, dt * 2.5);
        h.tgt.y = groundH(h.tgt.x, h.tgt.z);
        if (!h.beam.visible) { h.tgt.set(tx, groundH(tx, tz), tz); h.beam.visible = true; }
        aimBeam(h.beam, lamp, h.tgt, 5.5);
        h.beam.material.uniforms.uK.value = Math.min(1, (t - h.orbitAt + 2) * 0.8);
        if (!h.light) { h.light = fx.lights.acquire(); if (h.light) { h.light.color.setRGB(0.85, 0.9, 1); h.light.distance = 26; h.light.decay = 1.2; } }
        if (h.light) { h.light.position.set(h.tgt.x, h.tgt.y + 5, h.tgt.z); h.light.intensity = 260 * h.beam.material.uniforms.uK.value; }
        fx.glowDot(lamp.x, lamp.y, lamp.z, 1.4, 8, 8, 9, 0.05);
      }
      // the minigun: bursts walked through the crowd round the light
      if (t >= h.nextBurst && h.burst <= 0) { h.burst = rand(1.0, 1.6); h.nextBurst = t + h.burst + rand(1.2, 2.4); h.round = 0; }
      if (h.burst > 0) {
        h.burst -= dt;
        const gun = _w.copy(h.gun).applyMatrix4(grp.matrixWorld);
        if (h.round === 0) { const j = h0.densest(4, 160, 24, 6); if (j) { h.aimX = j.x; h.aimZ = j.z; } else { h.aimX = h.tgt.x; h.aimZ = h.tgt.z; } g.audio.minigun(gun.x, gun.y, gun.z, h.aimX, h.aimZ); }
        h.round += dt;
        while (h.round > 0.04) {
          h.round -= 0.04;
          const tx = h.aimX + rand(-3.5, 3.5), tz = h.aimZ + rand(-3.5, 3.5), ty = groundH(tx, tz);
          fx.tracer(gun.x, gun.y, gun.z, tx, ty + 0.4, tz, 700, 1.1, 6.5, 2.4, 1.0);
          if (R() < 0.4) fx.groundHit(tx, tz, R() < 0.2);
          if (R() < 0.5) h0.explode(tx, ty + 0.6, tz, 2.4, 260, 'gunship', { push: 0.6 });
        }
        h.round = h.round || 0.0001;
        fx.muzzle(gun.x, gun.y, gun.z, h.fwd.x, -0.4, h.fwd.z, 0.6);
      }
      // a pair of rockets now and then
      if (t >= h.rocket) {
        h.rocket = t + rand(3.5, 6);
        const j = h0.densest(6, 160, 24, 6);
        if (j) for (const pod of h.pods) {
          const p = _w.copy(pod).applyMatrix4(grp.matrixWorld);
          const tx = j.x + rand(-4, 4), tz = j.z + rand(-4, 4), ty = groundH(tx, tz);
          fx.tracer(p.x, p.y, p.z, tx, ty, tz, 260, 1.6, 8, 4, 1.5, 0.16, 0.02);
          const d = Math.hypot(tx - p.x, tz - p.z, ty - p.y) / 260;
          setTimeout(() => { if (!this.active) return; g.fx.explosion(tx, ty, tz, 1.1); h0.explode(tx, ty + 0.5, tz, 8, 900, 'gunship', { push: 1.2 }); g.audio.explosion(tx, tz, 1.1); }, d * 1000);
        }
      }
    }
  }

  // ── the lifters ──
  stageLifters() {
    this.lifters.forEach((L, k) => {
      const lz = LZ[k];
      L.k = k; L.lz = lz;
      L.arrive = this.T.lz - 13 + k * 1.6;  // starts its descent in from the hills behind the base
      L.touch = this.T.lz - 0.6 + k * 1.6;  // wheels down
      L.leave = this.T.lift + 0.3 + k * 1.8;
      L.from = V(lz.x * 1.6 + (k - 1) * 30, 140, lz.z + 640);
      L.rampK = 0; L.loop = null; L.pos = new THREE.Vector3(); L.group.visible = false;
      L.ramp.rotation.x = Math.PI / 2;
    });
  }

  updateLifters(dt) {
    const g = this.g, fx = g.fx, t = this.t;
    for (const L of this.lifters) {
      if (t < L.arrive) continue;
      const lz = L.lz, gy = groundH(lz.x, lz.z), grp = L.group;
      grp.visible = true;
      const ground = gy + L.gear;
      let pitch = 0, roll = 0, yaw = lz.yaw;
      if (t < L.touch) {
        // in on a long descending approach, flaring over the LZ
        const u = clamp((t - L.arrive) / (L.touch - L.arrive), 0, 1), e = 1 - Math.pow(1 - u, 2.4);
        L.pos.set(lerp(L.from.x, lz.x, e), lerp(L.from.y, ground, Math.pow(e, 1.25)), lerp(L.from.z, lz.z, e));
        pitch = -0.18 * Math.sin(Math.PI * u) - (u > 0.75 ? (u - 0.75) * 0.6 : 0); // nose up in the flare
        yaw = lz.yaw + Math.PI * (1 - ease(u * 1.3)); // swings round to put its ramp to the yard
      } else if (t < L.leave) {
        L.pos.set(lz.x, ground + Math.max(0, (L.touch + 0.8 - t)) * 0.4, lz.z);
      } else {
        // up, nose down, and away over the hills
        const s = t - L.leave;
        L.pos.set(lz.x + s * s * 0.25 * (L.k - 1), ground + s * 5.5 + s * s * 0.8, lz.z + s * s * 2.2);
        pitch = Math.min(0.16, s * 0.05);
        roll = (L.k - 1) * Math.min(0.15, s * 0.04);
      }
      grp.position.copy(L.pos);
      grp.rotation.set(pitch, yaw, roll, 'YXZ');
      grp.updateMatrixWorld();
      spinRotors(L, dt, 1, true);
      // the ramp: down once it is on the ground, up again as it lifts
      const want = t > L.touch + 0.5 && t < L.leave - 1.5 ? 1 : 0;
      L.rampK = clamp(L.rampK + (want ? dt * 0.6 : -dt * 0.5), 0, 1);
      L.ramp.rotation.x = lerp(Math.PI / 2, -0.14, ease(L.rampK)); // closed is upright, open rests on the ground
      // rotor wash: dust rolling out from under it near the ground
      const hAGL = L.pos.y - gy;
      if (hAGL < 16 && R() < dt * 26) {
        const a = R() * Math.PI * 2, r = rand(4, 10);
        fx.smokePuff(L.pos.x + Math.cos(a) * r, gy + 0.4, L.pos.z + Math.sin(a) * r, rand(2.2, 3.4), 0.12, rand(1.6, 2.6), 0.6);
      }
      // lights: nav, strobe, and the red glow of the open ramp
      _v.copy(L.lights.port).applyMatrix4(grp.matrixWorld); fx.glowDot(_v.x, _v.y, _v.z, 1, 6, 0.4, 0.3, 0.05);
      _v.copy(L.lights.stbd).applyMatrix4(grp.matrixWorld); fx.glowDot(_v.x, _v.y, _v.z, 1, 0.3, 5, 0.8, 0.05);
      if (((t * 1.1 + L.k * 0.3) % 1) < 0.07) { _v.copy(L.lights.tail).applyMatrix4(grp.matrixWorld); fx.glowDot(_v.x, _v.y, _v.z, 2.4, 8, 8, 8, 0.05); }
      if (L.rampK > 0.2) { _v.set(0, -0.6, -5.2).applyMatrix4(grp.matrixWorld); fx.glowDot(_v.x, _v.y, _v.z, 2.6, 5 * L.rampK, 0.5, 0.25, 0.05); }
      // the lead lifter's hold spills red light down the ramp onto the yard
      if (L.k === 0) {
        if (L.rampK > 0.05 && !L.light) { L.light = fx.lights.acquire(); if (L.light) { L.light.color.setRGB(1, 0.16, 0.08); L.light.distance = 16; L.light.decay = 1.3; } }
        if (L.light) {
          _v.set(0, -0.4, -8).applyMatrix4(grp.matrixWorld);
          L.light.position.copy(_v); L.light.intensity = 70 * L.rampK;
          if (L.rampK <= 0.01 && t > L.leave) { fx.lights.release(L.light); L.light = null; }
        }
      }
      if (!L.loop && g.audio.ready && g.audio.B.rotor) L.loop = g.audio.loop(g.audio.B.rotor[1], { ref: 140, reverb: 0.35, rate: 0.95 + L.k * 0.05 });
      if (L.loop) L.loop.update(L.pos.x, L.pos.y, L.pos.z, 0, 0, 0, L.k === 0 ? 2.4 : 1.6);
    }
  }

  // ── the garrison running for the ramps ──
  stagePeople() {
    const g = this.g;
    // how many come out: the garrison as it stands (cast caps it), soldiers first
    const alive = g.run ? g.run.survivors : 20;
    const nS = Math.min(this.troops.length, Math.max(6, Math.round(alive * 0.45)));
    const nC = Math.min(this.civs.length, Math.max(4, Math.round(alive * 0.35)));
    this.runners = [];
    const add = (f, soldier, k) => {
      const L = k % 5 === 4 ? 1 + (k % 2) : 0; // most to the lead lifter (on camera), some to the others
      const x = rand(-5, 5), z = rand(1.5, 7);
      this.runners.push({ f, soldier, L, x, z, ph: R() * 6, sp: rand(4.2, 5.2) * (f.child ? 0.9 : 1), go: this.T.run - 1.2 + k * 0.62, state: 'wait', yaw: 0, wp: 0, bias: k % 2 ? 1 : -1 });
      f.reset();
      f.root.visible = false;
    };
    let k = 0;
    const order = [];
    for (let i = 0; i < nS; i++) order.push([this.troops[i], true]);
    for (let i = 0; i < nC; i++) order.splice(1 + ((i * 2.3) | 0) % (order.length + 1), 0, [this.civs[i], false]);
    for (const [f, s] of order) add(f, s, k++);
  }

  updatePeople(dt) {
    const t = this.t;
    for (const u of this.runners) {
      if (u.state === 'gone') continue;
      if (t < u.go) continue;
      const f = u.f, L = this.lifters[u.L];
      if (u.state === 'wait') { u.state = 'run'; f.root.visible = true; }
      // the track out of the yard, then the ramp foot, then inside
      L.group.updateMatrixWorld();
      const foot = _v.copy(L.rampFoot).applyMatrix4(L.group.matrixWorld);
      const ins = _w.copy(L.inside).applyMatrix4(L.group.matrixWorld);
      const wps = [[u.L ? Math.sign(L.lz.x) * 4 : u.bias * 1.6, 26], [foot.x, foot.z], [ins.x, ins.z]];
      const [tx, tz] = wps[Math.min(u.wp, 2)];
      const dx = tx - u.x, dz = tz - u.z, d = Math.hypot(dx, dz);
      if (d < 0.6) {
        u.wp++;
        if (u.wp > 2) { u.state = 'gone'; f.root.visible = false; continue; }
      } else {
        const st = Math.min(d, u.sp * dt);
        u.x += dx / d * st; u.z += dz / d * st;
        u.yaw = Math.atan2(dx, dz);
      }
      u.ph += dt * u.sp;
      // up the ramp: climbing with it
      let y = groundH(u.x, u.z);
      if (u.wp >= 2) y = lerp(groundH(u.x, u.z), ins.y, clamp(1 - d / 3.6, 0, 1));
      f.root.position.set(u.x, y, u.z);
      f.root.rotation.y = u.yaw;
      f.run(u.ph);
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
      if (c.radio) { const len = g.audio.radioVoice(c.who, c.text, 0.2); g.audio.radioStatic(Math.max(0.6, (len || c.dur) - 0.1)); } else g.audio.narrate(c.who, c.text, 0.05);
      this.showSub(c);
    }
    if (!this.cues.find((c) => t >= c.at && t < c.at + c.dur + 0.5)) $('cine-sub').classList.remove('on');
    if (!this.titleOn && t >= this.titleAt) { this.titleOn = true; $('cine-title').classList.add('on'); }

    // the world goes on: the wall still fighting until the garrison leaves it
    const T = this.T;
    const onWall = t < T.run + 1;
    if (!onWall && !this.wallLeft) {
      this.wallLeft = true;
      g.arsenal.setGunners(0);
      for (const r of g.arsenal.riflemen || []) r.group.visible = false;
      g.audio.setMusicMode('victory');
    }
    if (t > T.lift && !this.overrun) {
      // nobody on the wall now: the dead come up it
      this.overrun = true;
      g.horde.pileMul = 5;
      for (let i = 0; i < 380; i++) g.horde.spawn(R() < 0.5 ? ZT.RUNNER : ZT.SHAMBLER, rand(-70, 70), rand(-60, -14), 1, 1.2);
    }
    if (onWall) g.arsenal.update(dt, g.time);
    g.horde.update(dt, g.time);
    this.updateBombers(dt);
    this.updateHelos(dt);
    this.updateLifters(dt);
    this.updatePeople(dt);
    if (t < T.away && g.horde.n < g.horde.cap - 40 && R() < dt * 25) g.spawnMenuZombie(rand(-200, -120));

    // the shot
    const s = this.shots.find((x) => t >= x.from && t < x.to) || this.shots[this.shots.length - 1];
    const st = t - s.from, k = clamp(st / Math.max(0.01, s.to - s.from), 0, 1);
    const p = SHOTS[s.name](k, st, this);
    if (p.ground !== undefined) p.pos.y = groundH(p.pos.x, p.pos.z) + p.ground;
    // hand-held: a little drift always, a jolt with every blast
    this.shake = Math.max(0, this.shake - rdt * 1.6);
    const sh = (p.shake || 0) * 0.04 + this.shake * 0.35;
    const cam = g.camera;
    cam.position.copy(p.pos);
    cam.position.x += Math.sin(t * 17.3) * sh + Math.sin(t * 2.1) * (p.shake || 0) * 0.12;
    cam.position.y += Math.sin(t * 21.1 + 1) * sh + Math.sin(t * 1.7) * (p.shake || 0) * 0.08;
    cam.up.set(0, 1, 0);
    cam.lookAt(p.look);
    cam.rotateZ(Math.sin(t * 11.7) * sh * 0.05);
    const fov = fitFov(p.fov, cam.aspect);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld(true);

    // hard cuts (a quick dip only into the first and out of the last)
    let fade = Math.min(1, t / 1.2);
    for (const x of this.shots) if (x.from > 0) fade = Math.min(fade, 0.25 + Math.abs(t - x.from) / 0.16);
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
    void el.offsetWidth;
    el.classList.add('on');
  }

  finish() {
    if (!this.active) return;
    this.stop();
    this.g.onEndingDone(true);
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    const g = this.g;
    g.audio.stopVoice();
    for (const r of this.bomberRuns || []) { r.b.group.visible = false; if (r.loop) r.loop.stop(1); r.loop = null; }
    for (const m of this.bombPool || []) m.visible = false;
    for (const h of this.helos || []) { h.group.visible = false; h.beam.visible = false; if (h.loop) h.loop.stop(1); h.loop = null; if (h.light) g.fx.lights.release(h.light); h.light = null; }
    for (const L of this.lifters || []) { L.group.visible = false; if (L.loop) L.loop.stop(1); L.loop = null; if (L.light) g.fx.lights.release(L.light); L.light = null; }
    g.ending.restoreGun();
    for (const u of this.runners || []) u.f.root.visible = false;
    for (const r of g.arsenal.riflemen || []) r.group.visible = true;
    g.arsenal.endNight();
    g.horde.pileMul = this.pileMul0 ?? g.horde.pileMul;
    g.horde.clearLiving();
    this.wallLeft = false; this.overrun = false;
    g.post.u.uFade.value = 1;
    $('cine-sub').classList.remove('on');
    $('cine-title').classList.remove('on');
  }
}
