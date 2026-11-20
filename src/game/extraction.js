// The good ending: the extraction. With at least EXTRACTION.souls alive at the start
// of the last night, night 10 is a hold (ExtractionHold, run like a night event): the
// flight is inbound, the radio counts it down, and for the last minute and a half
// everything in the valley comes over the ridge at once. If the wall still stands when
// the flight is overhead, ExtractionScene plays, still at night: the B-2s come in head-on
// and carpet the field (a wide shot, riding above the lead bomber, then under it as the bay
// doors open in the searchlights and the bombs fall away), two gunship
// helicopters come in low over the wall, seen from out on the field, and
// make running passes with rockets and the chain gun, the lifters come round over the
// field and land behind the wall in their own dust, the garrison runs for the ramps,
// the ramps shut, and the lifters climb away with the dead coming over the wall under
// them; the gunships turn round and follow. Voiced and cut to the script like the
// other ending (EXTRACT_ENDING in config.js).
import { crowdSteer, crowdResolve } from './crowd.js';
import * as THREE from 'three';
import { WORLD, EXTRACTION, EXTRACT_ENDING, ZT, wallZ, WING_COS } from '../config.js';
import { clamp, lerp, rand, fitFov } from '../core/util.js';
import { groundH } from '../world/terrain.js';
import { Survivor, ADULTS } from './survivor.js';
import { Soldier } from './soldier.js';
import { buildStealthBomber, buildBomb } from './air.js';
import { NavLights } from '../fx/navlights.js';
import { Exhaust } from '../fx/exhaust.js';
import { makeAttackHeli, makeLifter, spinRotors, makeBeam, aimBeam } from './helis.js';
import { FlightPath, Attitude, racetrack } from './flight.js';

const $ = (id) => document.getElementById(id);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const R = Math.random;
const GAP = 0.8, TAIL = 5, FADE_OUT = 3;
const B2_SCALE = 0.62; // the B-2s, a little under their real size (52 m span): they fly at 120 m over a toy-sized valley
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

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
    // surges before the overrun: a flank at a time, so the wall is tested before the end
    for (const at of P.surges || []) {
      if (this.said.has('s' + at) || left > at) continue;
      this.said.add('s' + at);
      const side = R() < 0.5 ? -1 : 1, d = g.director;
      g.hud.alert('HORDE INBOUND — ' + (side < 0 ? 'LEFT FLANK' : 'RIGHT FLANK'), 'red');
      g.audio.horn();
      for (let i = 0; i < P.surgeSize; i++) {
        const r = R(), type = r < 0.5 ? ZT.RUNNER : r < 0.9 ? ZT.SHAMBLER : ZT.BRUTE;
        d.queue.push({ type, x: side * rand(25, WORLD.SPAWN_X), z: WORLD.SPAWN_Z_NEAR + rand(0, 30), side: 0, delay: 0 });
      }
    }
    // the overrun: the whole valley at once, and faster
    if (left <= P.overrun) {
      if (!this.overrun) {
        this.overrun = true;
        g.hud.announce('THE OVERRUN', 'EVERYTHING IN THE VALLEY IS COMING', 4, 'red');
        g.audio.setTide(true); g.audio.horn(); setTimeout(() => g.audio.horn(), 1600);
      }
      const d = g.director, plan = g.plan;
      this.acc += P.overrunRate * dt * (0.6 + 1.0 * (1 - left / P.overrun));
      while (this.acc >= 1) {
        this.acc -= 1;
        const r = R(), type = r < 0.46 ? ZT.RUNNER : r < 0.86 ? ZT.SHAMBLER : r < 0.95 ? ZT.BRUTE : ZT.BLOATER;
        d.queue.push({ type, x: rand(-WORLD.SPAWN_X, WORLD.SPAWN_X), z: WORLD.SPAWN_Z_NEAR + rand(0, 25), side: 0, delay: 0 });
      }
      g.horde.globalSpeed = Math.max(g.horde.globalSpeed, 1.25);
      void plan;
    }
    // the flight, heard before it is seen: rotors coming up the valley behind the wall
    if (left < 30) {
      const A = g.audio;
      if (!this.rotor && A.ready) { const b = A.rotorBuf(1); if (b) this.rotor = A.loop(b, { ref: 260, reverb: 0.4 }); }
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
const NEST = () => V(0, WORLD.TOWER_TOP + 1.9, 2);
const H_FAR = -160; // where the gunships break off a run and turn: short of the far end of the crowds they work
const smoother = (k) => { k = clamp(k, 0, 1); return k * k * k * (k * (k * 6 - 15) + 10); };
const _f = new THREE.Vector3(), _s = new THREE.Vector3();
const offRun = (u) => u.state !== 'run'; // (only those out and running are in the crowd)

/** Ease a stored vector toward a target (the camera's follow), at rate per second; returns a copy. */
function follow(S, key, target, rate, dt) {
  const v = S[key] || (S[key] = target.clone());
  if (S._snap) v.copy(target); else v.lerp(target, 1 - Math.exp(-rate * dt));
  return v.clone();
}
/** A look target from `from`, no steeper than maxEl above the horizon (no craning straight up). */
function clampLook(from, to, maxEl = 1.1) {
  const d = to.clone().sub(from), h = Math.hypot(d.x, d.z), el = Math.atan2(d.y, h);
  if (el <= maxEl) return to;
  const hh = Math.max(h, 1), ux = h > 1e-3 ? d.x / h : 0, uz = h > 1e-3 ? d.z / h : -1;
  return from.clone().add(V(ux * hh, Math.tan(maxEl) * hh, uz * hh));
}

// Each shot maps (k 0..1 over the shot, seconds into it, the scene, frame dt) to a camera pose.
const SHOTS = {
  // on the right wing's walkway, looking back over the base: the bombers come in head-on out
  // of the dark, lights first, and thunder over; the camera turns to watch them go
  bombersIn: (k, st, S, dt) => {
    const pos = V(52, WORLD.WALL_H + 1.8, wallZ(52) + 2.6);
    const lead = S.bomberRuns[1].b.group.position;
    const tgt = S.bomberRuns[1].b.group.visible ? lead.clone() : V(0, 120, 700);
    return { pos, look: follow(S, '_lk', clampLook(pos, tgt, 1.05), 2.2, dt), fov: 56, shake: 0.12 };
  },
  // riding with the lead bomber, high on its starboard quarter and looking down along it: the
  // black wing filling the frame, the four jets burning blue over the deck toward us, and past
  // the nose, far below, the bastion and the burning field. Rigid (no follow lag): it flies
  // dead straight and level; the camera only creeps in on it.
  bombersClose: (k, st, S) => {
    const g = S.bomberRuns[1].b.group;
    g.updateMatrixWorld();
    const pos = _v.set(lerp(-15, -11.5, k), lerp(9.5, 8, k), lerp(-29, -23, k)).applyMatrix4(g.matrixWorld).clone();
    const look = _w.set(lerp(3, 2, k), -13, 34).applyMatrix4(g.matrixWorld).clone();
    return { pos, look, fov: 50, shake: 0.05 };
  },
  // under the lead bomber, behind its port side, looking up at the belly: the searchlights off
  // the wall find it, the bay doors swing down (heard: the hydraulics, the clunk as they lock),
  // and the first of the bombs drop out of the bays past the camera
  bayOpen: (k, st, S) => {
    const g = S.bomberRuns[1].b.group;
    g.updateMatrixWorld();
    const pos = _v.set(lerp(11, 8.5, k), lerp(-10.5, -9, k), lerp(-23, -18, k)).applyMatrix4(g.matrixWorld).clone();
    const look = _w.set(lerp(0.5, -0.5, k), -2.5, lerp(5, 2, k)).applyMatrix4(g.matrixWorld).clone();
    return { pos, look, fov: 50, shake: 0.06 };
  },
  // high behind the left wing: the sticks walking up the field, wide enough to see all three
  bombing: (k) => ({ pos: V(-58, 31, 16).lerp(V(-54, 29, 10), k), look: V(2, 0, -100).lerp(V(-6, 0, -110), k), fov: 52, shake: 0.2 }),
  // out on the field, on the city side, low among the dead and the fires: looking back at the
  // bastion as the gunships come in over the wall at us, past us, and on up the field
  helosIn: (k, st, S, dt) => {
    const pos = V(-30, 0, -72).lerp(V(-31, 0, -76), k);
    pos.y = groundH(pos.x, pos.z) + 5.5;
    const a = S.helos[0].att.pos, b = S.helos[1].att.pos, mid = a.clone().add(b).multiplyScalar(0.5);
    // the tower to start with, then the pair as they come close
    const near = 1 - clamp((Math.hypot(mid.x - pos.x, mid.z - pos.z) - 35) / 70, 0, 1);
    const tgt = V(0, 9, 4).lerp(mid, S.helos[0].group.visible ? smoother(near) : 0);
    return { pos, look: follow(S, '_lk1', clampLook(pos, tgt, 0.9), 2.6, dt), fov: 58, shake: 0.12 };
  },
  // riding behind the lead gunship on its run: rockets and the gun into the crowd
  helosFire: (k, st, S, dt) => {
    const h = S.helos[0], p = h.att.pos;
    h.att.axes(_f, _s);
    const pos = follow(S, '_cp', V(p.x - _f.x * 24 - _s.x * 7, p.y + 6.5, p.z - _f.z * 24 - _s.z * 7), 3, dt);
    const look = follow(S, '_cl', V(p.x + _f.x * 45, p.y - 15, p.z + _f.z * 45), 3, dt);
    return { pos, look, fov: 52, shake: 0.1 };
  },
  // on the right wing, high: the lifters come round over the field in trail and in over the wall
  liftersIn: (k, st, S, dt) => {
    const pos = V(40, 24, 18).lerp(V(34, 22, 22), k);
    const L = S.lifters[0].att.pos;
    return { pos, look: follow(S, '_lk2', clampLook(pos, L.clone(), 0.9), 2.4, dt), fov: 50, shake: 0.08 };
  },
  // in the yard: the lead lifter comes over us, flares and settles in its own dust
  landing: (k, st, S, dt) => {
    const pos = V(15, 0, 25).lerp(V(12.5, 0, 28.5), k);
    pos.y = groundH(pos.x, pos.z) + 1.7;
    const L = S.lifters[0].att.pos, lz = V(LZ[0].x, groundH(LZ[0].x, LZ[0].z) + 4.5, LZ[0].z);
    const tgt = S.lifters[0].group.visible ? L.clone().lerp(lz, 0.35) : lz;
    return { pos, look: follow(S, '_lk3', clampLook(pos, tgt, 0.8), 2.5, dt), fov: 50, shake: 0.2 };
  },
  // low behind the garrison running for the ramp
  run: (k) => {
    const z = lerp(14, 33, k);
    return { pos: V(-4.5, 0, z - 6), ground: 1.5, look: V(0.5, 1.6, LZ[0].z - 9), fov: 50, shake: 0.18 };
  },
  // at the foot of the ramp, looking back on a longer lens: the last of them running past soft
  // in the foreground, and sharp behind them the wall, the first of the dead coming over it
  ramp: (k, st, S) => {
    const L = S.lifters[0];
    L.group.updateMatrixWorld();
    const pos = _v.set(2.4, -0.9, -11.5).applyMatrix4(L.group.matrixWorld).clone();
    const look = V(lerp(-4, 4, k), WORLD.WALL_H + 0.4, -6);
    return { pos, look, fov: 30, shake: 0.1 };
  },
  // behind the lifter: the ramp comes up and shuts, the dead already over the wall behind
  doorClose: (k, st, S) => {
    const L = S.lifters[0];
    L.group.updateMatrixWorld();
    const pos = _v.set(4.6, -0.6, -17.5 + k * 1.2).applyMatrix4(L.group.matrixWorld).clone();
    pos.y = Math.max(pos.y, groundH(pos.x, pos.z) + 1.5);
    return { pos, look: _w.set(0.3, -0.4, -7).applyMatrix4(L.group.matrixWorld).clone(), fov: 46, shake: 0.12 };
  },
  // low in the yard: the lifter climbs away slowly over the dead running in under it
  liftoff: (k, st, S, dt) => {
    const pos = V(-15, 0, 31).lerp(V(-17, 0, 29), k);
    pos.y = groundH(pos.x, pos.z) + 1.6;
    const L = S.lifters[0].att.pos;
    return { pos, look: follow(S, '_lk4', clampLook(pos, V(L.x, L.y + 1, L.z), 0.95), 2, dt), fov: 54, shake: 0.12 };
  },
  // back on the nest roof: the gunships stop over the field, turn round and go after the lifters
  helosLeave: (k, st, S, dt) => {
    const pos = NEST();
    const a = S.helos[0].att.pos, b = S.helos[1].att.pos;
    const mid = a.clone().add(b).multiplyScalar(0.5);
    return { pos, look: follow(S, '_lk5', clampLook(pos, mid, 1.0), 1.8, dt), fov: 58, shake: 0.08 };
  },
  // high and far: the flight going away over the hills, the bastion small and burning
  away: (k) => ({ pos: V(46, 52, 118).lerp(V(30, 78, 196), k), look: V(0, 4, -22).lerp(V(0, 0, -60), k), fov: 44 }),
};

export class ExtractionScene {
  constructor(game) { this.g = game; this.active = false; this.built = false; }

  build() {
    if (this.built) return;
    this.built = true;
    const scene = this.g.scene;
    const pool = this.g.fx.lights;
    this.bombers = [0, 1, 2].map((k) => {
      const b = buildStealthBomber();
      b.group.scale.setScalar(B2_SCALE); b.group.visible = false; scene.add(b.group);
      b.nav = new NavLights(b, { lens: 0.1, pool, phase: k * 0.31 });
      b.exhaust = new Exhaust(b.group, b.engines, { len: 7, r: 0.5, flat: 0.68, wide: 1.15 });
      return b;
    });
    this.bombPool = Array.from({ length: 72 }, () => { const m = buildBomb(); m.visible = false; m.scale.setScalar(0.5); scene.add(m); return m; });
    this.helos = [0, 1].map((k) => {
      const h = makeAttackHeli(); h.group.visible = false; scene.add(h.group);
      h.beam = makeBeam(); h.beam.visible = false; scene.add(h.beam);
      h.k = k; h.att = new Attitude({ drag: 0.0011, turn: 2.8, yawTurn: 1.8, maxBank: 0.8 });
      h.nav = new NavLights(h, { lens: 0.07, pool, phase: k * 0.4 });
      return h;
    });
    this.lifters = LZ.map((lz, k) => {
      const l = makeLifter(); l.group.visible = false; scene.add(l.group);
      l.nav = new NavLights(l, { lens: 0.08, pool, phase: k * 0.27 });
      l.k = k; l.lz = lz; l.att = new Attitude({ drag: 0.0007, turn: 1.6, yawTurn: 0.9, maxBank: 0.5, maxPitch: 0.3, pitch0: -0.02 });
      return l;
    });
    // 2.75 in rockets: a dark tube with the motor burning at its tail
    const rg = new THREE.CylinderGeometry(0.05, 0.05, 1.3, 6).rotateX(Math.PI / 2);
    const rm = new THREE.MeshStandardMaterial({ color: 0x2a2c26, roughness: 0.6, metalness: 0.4 });
    this.rockets = Array.from({ length: 12 }, () => { const m = new THREE.Mesh(rg, rm); m.visible = false; scene.add(m); return { m, on: false, p: new THREE.Vector3(), v: new THREE.Vector3(), t: 0 }; });
    // the garrison: soldiers and the civilians who sheltered behind the wall
    this.troops = Array.from({ length: 14 }, () => { const s = new Soldier(); s.root.visible = false; scene.add(s.root); return s; });
    this.civs = Array.from({ length: 4 }, (_, k) => { const p = new Survivor(k === 3 ? 'child' : ADULTS[k % 3]); p.root.visible = false; scene.add(p.root); return p; });
  }

  start() {
    const g = this.g;
    this.build();
    this.active = true;
    this.t = 0; this.skipArm = 0; this.titleOn = false; this.shake = 0; this.timers = []; this.lastShot = null;
    const A = g.audio;
    let at = 0;
    // the script: voiced lines, and silent beats (hold: seconds) that only hold a shot
    this.cues = EXTRACT_ENDING.map((c, i) => {
      at += c.gap ?? (i ? GAP : 0);
      let dur;
      if (!c.text) dur = c.hold || 2;
      else {
        const buf = A.voices_ && A.voices_[c.who + '|' + c.text];
        dur = buf ? buf.duration + 0.15 : 1.2 + c.text.split(/\s+/).length / 2.6;
      }
      const cue = { ...c, at, dur, done: !c.text };
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
    this.T = {};
    for (const s of this.shots) if (this.T[s.name] === undefined) this.T[s.name] = s.from;
    const title = this.cues.find((c) => c.title);
    this.titleAt = title ? title.at + title.dur - 0.4 : Infinity;

    // the world: still night, the wall still fighting, the field full of them
    g.hud.show(false);
    g.letterboxTarget = 1;
    // the fifty stays in the nest, pointed down the valley: they leave it there
    g.ending.placeGun();
    A.intensity = 1; A.pressure = 0.8;
    A.setCine(true);
    A.setTide(true); // the score's climax over the bombing, until the run turns it (victory)
    A.scape = { horde_near: 0.32, horde_surge: 0.3, shuffle: 0.22 };
    this.pileMul0 = g.horde.pileMul;
    g.horde.pileMul = Math.max(g.horde.pileMul, 1.6);
    // the whole valley: the horde may fill all the room it has (half as many again as in a night)
    this.limit0 = g.horde.limit;
    g.horde.limit = g.horde.cap;
    for (let i = 0; i < 520 && g.horde.n < g.horde.limit - 300; i++) g.horde.spawn(R() < 0.45 ? ZT.RUNNER : ZT.SHAMBLER, rand(-140, 140), rand(-160, -35), 1, 1.1);
    // and the crowds coming down the field along the lines the gunships will run (inside their
    // turns, so every pass has something under it)
    for (const [x, z] of [[-16, -105], [16, -122], [-22, -140], [20, -155], [-14, -170], [18, -185], [-60, -130], [70, -145], [-95, -115], [100, -125]]) this.crowd(x, z, 130, 300);
    this.planBombs();
    this.stageHelos();
    // the crowds the gunships' first runs are lined up on (behind the field camera as they come in),
    // running on past where they break off: they turn short of the last of them
    this.later(this.T.helosIn, () => {
      for (const x of [-13, 15]) for (const z of [-140, -160, -180, -200]) this.crowd(x + rand(-4, 4), z, 75, 120);
    });
    this.stageLifters();
    this.stagePeople();
    for (const r of this.rockets) { r.on = false; r.m.visible = false; }
    this.intrudeAcc = 0; this.chaseAcc = 0; this.fieldAcc = 0; this.darkDone = false; this.bassDone = false;
    $('cine-sub').classList.remove('on');
    $('cine-title').classList.remove('on');
    $('cine-skip').classList.remove('on');
    g.screens.show('cine');
  }

  // ── the bombers: three B-2s line abreast out of the south, each laying a carpet up the field ──
  planBombs() {
    const v = 70, alt = 120, fall = 2.6;
    // the doors start down early in the bay shot (the radio is done: they are heard), the first
    // bombs leave as they lock open; the wingmen a beat behind the lead
    const tDoors = this.T.bayOpen + 0.5, tRel = tDoors + 2.4;
    this.drops = [];
    this.bomberRuns = this.bombers.map((b, k) => {
      const x = [-55, 0, 55][k] + rand(-3, 3), lag = [0.45, 0, 0.8][k];
      const zFirst = wallZ(x) - 16;
      const zr0 = zFirst + v * fall * 0.75;       // where the first bomb leaves the bay
      const trel0 = tRel + lag;                    // and when
      const run = { b, x, v, alt, zr0, trel0, tDoors: tDoors + lag, heard: false, loop: null };
      b.group.visible = false;
      b.setDoors(0);
      // a ripple out of both bays in turn, fanning wide as they fall: a carpet 50 m across, not a line
      const N = 24;
      for (let i = 0; i < N; i++) {
        const bay = i % 2, side = bay ? 1 : -1;
        const zi = zFirst - i * 9.5 + rand(-3, 3), xi = x + side * (R() < 0.3 ? rand(2, 9) : rand(9, 27));
        const zr = zi + v * fall * 0.75, trel = trel0 + (zr0 - zr) / v;
        this.drops.push({ run, bay, xi, zi, zr, trel, timp: trel + fall, fall, mesh: null, p0: null, done: false, big: i % 7 === 3 });
      }
      run.tShut = trel0 + (N * 9.5) / v + 1.2;
      return run;
    });
  }

  bomberZ(r, t) { return r.zr0 + r.v * (r.trel0 - t); }

  updateBombers(dt) {
    const g = this.g, fx = g.fx, t = this.t, T = this.T;
    const lead = this.bomberRuns[1];
    for (const r of this.bomberRuns) {
      const z = this.bomberZ(r, t), x = r.x, y = r.alt;
      const B = r.b, grp = B.group;
      if (t < T.bombersIn - 0.5 || z < -700) {
        if (grp.visible) { grp.visible = false; if (r.loop) { r.loop.stop(3); r.loop = null; } }
        continue;
      }
      grp.visible = true;
      grp.position.set(x, y, z);
      grp.lookAt(x, y, z - 1);
      grp.updateMatrixWorld();
      // the jets: cold blue flames over the deck, a hot point at each nozzle. The B-2 hides its
      // exhaust from below (the deck shields it): seen from under the wing it is all but gone
      const camY = grp.worldToLocal(_w.copy(g.camera.position)).y;
      B.exhaust.update(t, clamp(1 + camY / 3, 0.06, 1));
      for (const e of B.engines) { _v.copy(e).applyMatrix4(grp.matrixWorld); fx.glowDot(_v.x, _v.y, _v.z, 0.65, 0.4, 1.0, 3.0, 0.05); }
      if (r === lead) {
        const near = t > T.bombersClose - 0.5 && t < T.bombing;
        if (near && !this.jetLight) { this.jetLight = fx.lights.acquire(); if (this.jetLight) { this.jetLight.color.setRGB(0.3, 0.5, 1); this.jetLight.distance = 16; this.jetLight.decay = 1.4; } }
        if (this.jetLight) {
          if (!near) { fx.lights.release(this.jetLight); this.jetLight = null; }
          else { this.jetLight.position.copy(_v.set(0, 3.6, -7.5).applyMatrix4(grp.matrixWorld)); this.jetLight.intensity = 70 * (0.92 + 0.08 * Math.sin(t * 37)); }
        }
      }
      // the bomb bays: the doors swing down ahead of the first release and shut after the last
      const open = smoother((t - r.tDoors) / 2.3) * (1 - smoother((t - r.tShut) / 2.6));
      if (Math.abs(open - B.open) > 1e-4) B.setDoors(open);
      if (!r.heard && t >= r.tDoors) { r.heard = true; g.audio.bayDoors(x, y - 2, z, r === lead ? 4.5 : 1.2); }
      // position lights and the beacon: how you see them coming in the dark
      B.nav.update(t, g.camera);
      // landing lights in the leading edge either side of the nose, burning straight ahead:
      // blinding head-on, nothing from behind
      const cam = g.camera.position, dz = cam.z - z, dd = Math.hypot(cam.x - x, cam.y - y, dz);
      const face = Math.pow(clamp(-dz / dd, 0, 1), 3);
      if (face > 0.02) for (const sx of [-3.2, 3.2]) { _v.set(sx, -1.0, 8.6).applyMatrix4(grp.matrixWorld); fx.glowDot(_v.x, _v.y, _v.z, 3.2 + face * 3, 9 * face, 8.6 * face, 7.5 * face, 0.05); }
      if (!r.loop && g.audio.ready) r.loop = g.audio.loop(g.audio.b2Buf(), { ref: 170, reverb: 0.4, rate: 0.96 + (r.x % 7) * 0.01 });
      if (r.loop) r.loop.update(x, y, z, 0, 0, -r.v, 3.4 * g.audio.bomberGain);
    }
    // the searchlights on the wing towers swing up and hold the lead bomber for the bay shot
    // (crossing on its belly as the doors open), then go back to the field
    const SL = g.env.searchlights || [];
    const lit = t > T.bayOpen - 1.6 && t < T.bombing + 0.3 && lead.b.group.visible;
    SL.forEach((sl, k) => {
      if (!lit) { sl.track = null; sl.boost = 1; sl.spotK = 1; return; }
      const p = lead.b.group.position;
      sl.track = (sl.track || new THREE.Vector3()).set(p.x + (k ? 2 : -2), p.y - 1, p.z - lead.v * 0.12);
      sl.boost = 2.6; sl.spotK = 0.3; // (a shaft of light up the sky; the lamp itself dimmed so the black airframe shows grey, not chrome)
    });
    for (const d of this.drops) {
      if (d.done || t < d.trel) continue;
      // out of the bay it left from, with the bomber's speed, dropping behind as it falls
      if (!d.p0) {
        const grp = d.run.b.group;
        grp.updateMatrixWorld();
        const bay = d.run.b.bays[d.bay];
        // (from inside the airframe, above the bay's ceiling: they come down out of the dark, never pop into the air)
        d.p0 = _v.set(bay.x, bay.y + 1.6, bay.z + rand(-2.2, 2.2)).applyMatrix4(grp.matrixWorld).clone();
      }
      if (!d.mesh) { d.mesh = this.bombPool.find((m) => !m.visible) || null; if (d.mesh) d.mesh.visible = true; }
      const s = Math.min(t - d.trel, d.fall), u = s / d.fall;
      const gy = groundH(d.xi, d.zi), p0 = d.p0, v = d.run.v;
      if (d.mesh) {
        // z: leaving at the bomber's speed and slowing (lands where planned); x: fanning out; y: falling
        const acc = 2 * (d.zi - p0.z + v * d.fall) / (d.fall * d.fall);
        const z = p0.z - v * s + 0.5 * acc * s * s, x = lerp(p0.x, d.xi, u * u * (3 - 2 * u)), y = lerp(p0.y, gy, u * u);
        d.mesh.position.set(x, y, z);
        const vx = (d.xi - p0.x) * 6 * u * (1 - u) / d.fall, vz = -v + acc * s, vy = -2 * u * (p0.y - gy) / d.fall;
        d.mesh.lookAt(x + vx, y + vy, z + vz);
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
    if (big) g.fx.bigExplosion(x, gy, z, 0.75); else g.fx.explosion(x, gy, z, 1.6);
    g.horde.explode(x, gy + 0.5, z, big ? 20 : 14, 3200, 'bomb', { push: big ? 2.4 : 1.8, ignite: true });
    if (big) g.audio.bigBlast(x, z);
    else if (R() < 0.7) g.audio.explosion(x, z, 1.7);
    const cam = g.camera.position, d = Math.hypot(x - cam.x, z - cam.z);
    this.shake = Math.min(1.4, this.shake + (big ? 30 : 14) / (d + 20));
  }

  // ── the gunship helicopters: in low over the nest, then running passes up the field ──
  stageHelos() {
    const T = this.T, tA = T.helosIn, IN = 1.5;
    this.helos.forEach((h) => {
      const k = h.k, s = k ? 1 : -1;
      const P = h.path = new FlightPath();
      // in from behind the base, low and fast, under the camera on the nest roof
      // (IN: they come in a beat after the shot opens, so the run the camera rides is the start of
      // their first pass, not its end)
      P.add(tA - 6 + IN, s * 15, 48, 230).add(tA - 2 + IN, s * 12, 19, 85).add(tA + 0.6 + IN, s * 11, 10.8, 10);
      // then running passes up the field until the lifters are gone
      const tl = T.helosLeave;
      racetrack(P, { t0: tA + 1.6 + IN, t1: tl, side: s, inner: 13 + k * 2, outer: 72, zNear: -14, zFar: H_FAR, alt: [16, 13, 26], speed: 23, turnSpeed: 16.5 });
      // break off: on down the field, a wide climbing turn outward (banked over at speed, as a
      // helicopter turns), round and back over the wall after the lifters. One unbroken move.
      const i0 = 13 + k * 2;
      P.add(tl + 2.0, s * (i0 + 3), 20, -52).add(tl + 3.4, s * (i0 + 12), 23, -76).add(tl + 4.8, s * (i0 + 30), 25, -84)
        .add(tl + 6.2, s * (i0 + 46), 27, -72).add(tl + 7.6, s * (i0 + 52), 30, -50).add(tl + 9.0, s * (i0 + 44), 34, -24)
        .add(tl + 10.6, s * (i0 + 28), 40, 10).add(tl + 12.6, s * 16, 50, 60).add(tl + 18, s * 10, 80, 300).add(tl + 27, s * 8, 112, 760);
      h.att.ready = false;
      h.group.visible = false; h.beam.visible = false;
      h.burst = 0; h.nextBurst = tA + 2 + k * 0.9; h.round = 0; h.rounds = 0;
      // the first salvos on the run the camera rides along with, then every few seconds on a pass
      h.salvos = k === 0 ? [T.helosFire + 0.7, T.helosFire + 2.2] : [T.helosFire + 1.6];
      h.nextRocket = T.helosFire + 6 + k * 1.7;
      h.loop = null; h.light = null; h.tgt = new THREE.Vector3(); h.aim = null;
    });
  }

  /** A crowd of n, packed round (x, z), as long as the horde has room past `keep`. */
  crowd(x, z, n, keep = 90) {
    const h = this.g.horde;
    for (let i = 0; i < n && h.n < h.limit - keep; i++) {
      const a = R() * 6.28, d = Math.sqrt(R()) * 14, r = R();
      h.spawn(r < 0.5 ? ZT.RUNNER : r < 0.92 ? ZT.SHAMBLER : ZT.BRUTE, x + Math.cos(a) * d, z + Math.sin(a) * d * 1.6, 1, 1.1);
    }
  }

  /** How many of the dead lie down the heading (fx, fz) from p, 50-150 m out: worth a rocket? */
  crowdAhead(p, f) {
    const h = this.g.horde, fl = Math.hypot(f.x, f.z) || 1;
    let c = 0;
    for (let d = 50; d <= 150; d += 20) c += h.queryRadius(p.x + f.x / fl * d, p.z + f.z / fl * d, 9, h._q);
    return c;
  }

  /** A zombie worth shooting near (x, z): the one with the most others around it, of a few looked at. */
  pickNear(x, z, r) {
    const h = this.g.horde;
    let best = null, bestC = -1;
    for (let s = 0; s < 40; s++) {
      const i = (R() * h.n) | 0;
      if (h.dead[i] || h.inside[i]) continue;
      const dx = h.x[i] - x, dz = h.z[i] - z;
      if (dx * dx + dz * dz > r * r) continue;
      const c = h.queryRadius(h.x[i], h.z[i], 5, h._q);
      if (c > bestC) { bestC = c; best = { x: h.x[i], z: h.z[i] }; }
    }
    return best;
  }

  updateHelos(dt) {
    const g = this.g, fx = g.fx, t = this.t;
    for (const h of this.helos) {
      if (t < h.path.start) continue;
      const grp = h.group, a = h.att;
      if (t > h.path.end) { if (grp.visible) { grp.visible = false; h.beam.visible = false; if (h.loop) { h.loop.stop(2); h.loop = null; } } continue; }
      grp.visible = true;
      a.update(h.path, t, dt);
      a.apply(grp, t, h.k * 2);
      a.axes(_f, _s);
      const p = a.pos;
      spinRotors(h, dt, 1);
      // nav lights, the anti-collision strobe
      h.nav.update(t, g.camera);
      // the rotor: the recording, panned and Doppler-shifted with it
      if (!h.loop && g.audio.ready) { const b = g.audio.rotorBuf(0); if (b) h.loop = g.audio.loop(b, { ref: 150, reverb: 0.35, rate: 0.97 + h.k * 0.06 }); }
      if (h.loop) h.loop.update(p.x, p.y, p.z, a.vel.x, a.vel.y, a.vel.z, 3.2);
      // on a run (nose up the field, over it): the searchlight ahead, the gun, the rockets
      const onRun = _f.z < -0.75 && p.z < -8 && p.z > H_FAR + 30 && t > this.T.helosIn + 1.4 && t < this.T.helosLeave + 1;
      const lamp = _v.copy(h.lamp).applyMatrix4(grp.matrixWorld).clone();
      const ahead = V(p.x + _f.x * 50, 0, p.z + _f.z * 50);
      ahead.y = groundH(ahead.x, ahead.z);
      h.tgt.lerp(ahead, h.beam.visible ? 1 - Math.exp(-dt * 2) : 1);
      const lampK = clamp((t - this.T.helosIn - 1) * 0.8, 0, 1) * (t < this.T.helosLeave + 3 ? 1 : clamp(1 - (t - this.T.helosLeave - 3), 0, 1));
      h.beam.visible = lampK > 0.01;
      if (h.beam.visible) {
        aimBeam(h.beam, lamp, h.tgt, 5.5);
        h.beam.material.uniforms.uK.value = lampK;
        if (!h.light) { h.light = fx.lights.acquire(); if (h.light) { h.light.color.setRGB(0.85, 0.9, 1); h.light.distance = 26; h.light.decay = 1.2; } }
        if (h.light) { h.light.position.set(h.tgt.x, h.tgt.y + 5, h.tgt.z); h.light.intensity = 260 * lampK; }
        fx.glowDot(lamp.x, lamp.y, lamp.z, 1.4, 8, 8, 9, 0.05);
      }
      // the 30 mm: bursts of ten-odd rounds walked into the crowd ahead, each round its own thud
      if (onRun && t >= h.nextBurst && h.burst <= 0 && this.crowdAhead(p, _f) >= 4) {
        h.burst = rand(0.9, 1.6); h.nextBurst = t + h.burst + rand(1.0, 2.2); h.round = 0; h.rounds = 0;
        h.aim = this.pickNear(ahead.x, ahead.z, 30) || { x: ahead.x, z: ahead.z };
      }
      if (h.burst > 0) {
        h.burst -= dt;
        const gun = _w.copy(h.gun).applyMatrix4(grp.matrixWorld);
        h.round -= dt;
        while (h.round <= 0) {
          h.round += 0.1;
          h.rounds++;
          const tx = h.aim.x + rand(-2.5, 2.5), tz = h.aim.z + rand(-2.5, 2.5), ty = groundH(tx, tz);
          fx.tracer(gun.x, gun.y, gun.z, tx, ty + 0.3, tz, 600, 1.3, 7, 3, 1.1, 0.09, 0.012);
          fx.muzzle(gun.x, gun.y, gun.z, _f.x, -0.35, _f.z, 0.9);
          g.audio.chainShot(gun.x, gun.y, gun.z, h.burst <= 0.1);
          const fly = Math.hypot(tx - gun.x, ty - gun.y, tz - gun.z) / 600, n = h.rounds;
          this.later(fly, () => {
            fx.explosion(tx, ty, tz, 0.32, { light: false, scorch: false, fires: false });
            g.horde.explode(tx, ty + 0.5, tz, 3.2, 420, 'gunship', { push: 0.8 });
            if (n % 3 === 0) g.audio.chainHit(tx, tz);
          });
        }
      }
      // rockets: a pair off the pods, scripted for the camera's run, then now and then on a pass
      const due = h.salvos.length && t >= h.salvos[0];
      if (due || (onRun && t >= h.nextRocket && this.crowdAhead(p, _f) >= 10)) {
        if (due) h.salvos.shift(); else h.nextRocket = t + rand(3.5, 6);
        h.pods.forEach((pod, n) => this.later(n * 0.14, () => this.fireRocket(h, pod)));
      }
    }
  }

  /**
   * A rocket off a pod, straight down the gunship's heading: boresighted along the nose,
   * dipped just enough (for its height) to land 60-110 m ahead, where the gun is working.
   */
  fireRocket(h, pod) {
    const r = this.rockets.find((x) => !x.on);
    if (!r || !h.group.visible) return;
    r.p.copy(pod).applyMatrix4(h.group.matrixWorld);
    h.att.axes(_f, _s);
    const fl = Math.hypot(_f.x, _f.z) || 1, fx0 = _f.x / fl, fz0 = _f.z / fl;
    const agl = Math.max(4, r.p.y - groundH(r.p.x, r.p.z));
    // the crowd it is lined up on: the thickest spot straight down the heading, 50-220 m out
    // (the pilot puts the nose on them; the rockets only drop with range)
    const hd = this.g.horde;
    let bestD = 85, bestC = 0;
    for (let d = 50; d <= 220; d += 6) {
      const c = hd.queryRadius(r.p.x + fx0 * d, r.p.z + fz0 * d, 7, hd._q);
      if (c > bestC) { bestC = c; bestD = d; }
    }
    const dip = clamp(Math.atan2(agl, bestD), 0.05, 0.4);
    const dir = _w.set(fx0 * Math.cos(dip), -Math.sin(dip), fz0 * Math.cos(dip));
    // where that line meets the ground
    let tx = r.p.x + dir.x * 300, tz = r.p.z + dir.z * 300;
    for (let s = 4; s < 400; s += 2) {
      const x = r.p.x + dir.x * s, y = r.p.y + dir.y * s, z = r.p.z + dir.z * s;
      if (y <= groundH(x, z)) { tx = x; tz = z; break; }
    }
    const ty = groundH(tx, tz);
    r.v.set(tx - r.p.x, ty - r.p.y, tz - r.p.z);
    const d = r.v.length();
    r.v.multiplyScalar(260 / d);
    r.t = 0; r.dur = d / 260; r.tx = tx; r.ty = ty; r.tz = tz; r.on = true;
    r.m.visible = true;
    const fx = this.g.fx;
    for (let k = 0; k < 6; k++) fx.smokePuff(r.p.x + rand(-0.4, 0.4), r.p.y, r.p.z + rand(-0.4, 0.4), 1.4, 0.14, rand(1.2, 2), 0.3);
    fx.lights.flash(r.p.x, r.p.y, r.p.z, 0xffb070, 90, 18, 0.12);
    this.g.audio.rocketLaunch(r.p.x, r.p.y, r.p.z);
  }

  updateRockets(dt) {
    const g = this.g, fx = g.fx;
    for (const r of this.rockets) {
      if (!r.on) continue;
      r.t += dt;
      const prev = _v.copy(r.p).clone();
      r.p.addScaledVector(r.v, dt);
      r.m.position.copy(r.p);
      r.m.lookAt(_w.copy(r.p).add(r.v));
      // the motor and its trail: a hot point, then grey smoke left hanging in the air
      _w.copy(r.v).normalize();
      fx.glowDot(r.p.x - _w.x * 0.8, r.p.y - _w.y * 0.8, r.p.z - _w.z * 0.8, 1.1, 9, 5, 2, 0.05);
      for (let k = 0; k < 3; k++) {
        const u = k / 3;
        fx.smoke.spawn(lerp(prev.x, r.p.x, u), lerp(prev.y, r.p.y, u), lerp(prev.z, r.p.z, u), rand(-0.3, 0.3), rand(0, 0.5), rand(-0.3, 0.3),
          rand(1.4, 2.4), 0.35, 2.2, 2 + ((R() * 4) | 0), 0.2, 0.19, 0.17, 0.5, 0.1, 0.1, 0.1, -0.1, 0.8, 0, R() * 6, 0.2, 0.05);
      }
      if (r.t >= r.dur) {
        r.on = false; r.m.visible = false;
        fx.explosion(r.tx, r.ty, r.tz, 1.15, { fires: R() < 0.3 });
        g.horde.explode(r.tx, r.ty + 0.5, r.tz, 8, 900, 'gunship', { push: 1.4 });
        g.audio.explosion(r.tx, r.tz, 1.2);
        const cam = g.camera.position;
        this.shake = Math.min(1.2, this.shake + 6 / (Math.hypot(r.tx - cam.x, r.tz - cam.z) + 20));
      }
    }
  }

  /** Run fn after s seconds of scene time (only while the scene plays). */
  later(s, fn) { this.timers.push({ at: this.t + s, fn }); }

  // ── the lifters: a long approach up the valley, round over the field and in over the wall ──
  stageLifters() {
    const T = this.T;
    this.lifters.forEach((L) => {
      const { k, lz } = L, X = lz.x, Z = lz.z;
      const gy = groundH(X, Z), base = gy + L.gear;
      const Td = L.touch = T.landing + 4.4 + k * 2.1;
      const Tl = L.leave = T.liftoff + 0.6 + k * 1.5;
      const P = L.path = new FlightPath();
      // up the left side of the valley, high, in trail
      P.add(Td - 36, -150 - k * 12, 125, 540 + k * 30).add(Td - 26.5, -112 - k * 6, 86, 200).add(Td - 21, -96, 62, 40);
      // round to the right over the far side of the field, losing height
      const xf = X * 0.5 - 12, cx = (xf - 92) / 2, r = (xf + 92) / 2;
      for (let i = 0; i <= 4; i++) {
        const ang = Math.PI * (1 + i / 4);
        P.add(Td - 17.2 + i * 1.9, cx + Math.cos(ang) * r, 50 - i * 3, -45 + Math.sin(ang) * r);
      }
      // in over the wall, slowing; the flare; the hover; down
      P.add(Td - 7.0, xf * 0.6 + X * 0.4, 22, -5);
      P.add(Td - 3.7, X, base + 8.5, Z - 9);
      P.hold(Td - 1.5, X, base + 3.2, Z, lz.yaw);
      P.hold(Td, X, base, Z, lz.yaw);
      // the liftoff: slow off the ground with the dead running in under it, then away
      P.hold(Tl, X, base, Z, lz.yaw);
      const s = k - 1;
      P.add(Tl + 3.8, X, base + 2.6, Z, lz.yaw).add(Tl + 7, X + s, base + 8.5, Z + 2.5, lz.yaw);
      P.add(Tl + 10.5, X + s * 4, base + 22, Z + 22).add(Tl + 15.5, X + s * 12, base + 50, Z + 110).add(Tl + 23.5, X + s * 30, base + 95, Z + 430).add(Tl + 33, X + s * 50, 140, Z + 950);
      L.base = base; L.gy = gy;
      L.att.ready = false;
      L.shut = 1; L.loop = null; L.group.visible = false;
      this.setRamp(L, 1);
    });
  }

  /**
   * The ramp: 0 down on the ground, 1 shut. The treadway boards run back into it as it
   * lifts off the ground; the upper door swings down from under the pylon to meet its end.
   */
  setRamp(L, shut) {
    L.ramp.rotation.x = L.rampShut * shut;
    const k = smoother(Math.min(1, shut / 0.35));
    L.boards.position.copy(L.boardsHome).addScaledVector(L.boardsSlide, k);
    L.boards.visible = k < 0.99;
    L.door.rotation.x = L.doorOpen * (1 - smoother(Math.max(0, (shut - 0.55) / 0.45)));
  }

  /** Rotor wash: dust rolling out along the ground from under the discs, thicker the lower it hovers. */
  rotorWash(L, dt) {
    const p = L.att.pos, hAGL = p.y - L.gear - L.gy;
    if (hAGL > 24) return;
    const k = Math.pow(1 - Math.max(0, hAGL) / 24, 1.4) * (hAGL < 0.3 ? 1.3 : 1);
    const fx = this.g.fx;
    let n = dt * 70 * k;
    while (n > 0) {
      if (n < 1 && R() > n) break;
      n -= 1;
      // under one of the two discs (fore and aft, along the fuselage)
      const along = (R() < 0.5 ? 6.2 : -6.2), yaw = L.att.yaw;
      const ox = p.x + Math.sin(yaw) * along, oz = p.z + Math.cos(yaw) * along;
      const a = R() * Math.PI * 2, r0 = rand(2, 7), sp = rand(7, 15) * (0.6 + 0.4 * k);
      const x = ox + Math.cos(a) * r0, z = oz + Math.sin(a) * r0;
      const c = rand(0.09, 0.13);
      fx.smoke.spawn(x, groundH(x, z) + rand(0.2, 1.2), z, Math.cos(a) * sp, rand(0.4, 1.8), Math.sin(a) * sp,
        rand(1.8, 3.4), rand(1.6, 2.6), rand(5.5, 9), 2 + ((R() * 4) | 0), c, c * 0.88, c * 0.72, 0.5 * Math.min(1, k + 0.3), c * 0.8, c * 0.72, c * 0.6,
        -0.05, 1.3, 0, R() * 6, (R() - 0.5) * 0.4, 0.15);
    }
    // grit kicked up close in
    if (hAGL < 6 && R() < dt * 8) fx.groundHit(p.x + rand(-8, 8), p.z + rand(-8, 8), false);
  }

  updateLifters(dt) {
    const g = this.g, fx = g.fx, t = this.t, T = this.T;
    for (const L of this.lifters) {
      if (t < L.path.start) continue;
      const grp = L.group, a = L.att;
      if (t > L.path.end) { if (grp.visible) { grp.visible = false; if (L.loop) { L.loop.stop(2); L.loop = null; } } continue; }
      grp.visible = true;
      a.update(L.path, t, dt);
      a.apply(grp, t, 1 + L.k);
      // on its wheels: level, and squatting a little as the weight comes on
      if (t >= L.touch && t < L.leave + 0.3) {
        const w = smoother((t - L.touch) / 0.8) * (1 - smoother((t - L.leave) / 0.3));
        grp.position.y = L.base - 0.06 * w;
        grp.rotation.x *= 1 - w; grp.rotation.z *= 1 - w;
        grp.updateMatrixWorld();
      }
      spinRotors(L, dt, 1, true);
      // the ramp: down once the weight is on the wheels, shut again when everyone is in
      let shut = 1;
      if (t > L.touch + 0.8) shut = 1 - smoother((t - L.touch - 0.8) / 2.6);
      const close = L.k === 0 ? T.doorClose + 0.4 : T.doorClose - 1 + L.k * 0.6;
      if (t > close) shut = smoother((t - close) / 3.6);
      this.setRamp(L, shut);
      L.shut = shut;
      this.rotorWash(L, dt);
      // lights: nav, strobe, and the red glow of the open ramp
      L.nav.update(t, g.camera);
      const open = 1 - shut;
      // the hold's red night lighting, deep in the cabin: it lights the inside and the people in
      // it, and (through the open ramp) the ground behind; the hull's outside faces away from it
      if (open > 0.03 && !L.holdLight) { L.holdLight = fx.lights.acquire(); if (L.holdLight) { L.holdLight.color.setRGB(1, 0.09, 0.04); L.holdLight.distance = 11; L.holdLight.decay = 1.1; } }
      if (L.holdLight) {
        L.holdLight.position.copy(_v.set(0, -0.7, 0.6).applyMatrix4(grp.matrixWorld));
        L.holdLight.intensity = 45 * Math.min(1, open * 1.5);
        if (open <= 0.01 && t > close) { fx.lights.release(L.holdLight); L.holdLight = null; }
      }
      // the lead lifter's hold spills red light down the ramp onto the yard
      if (L.k === 0) {
        if (open > 0.05 && !L.light) { L.light = fx.lights.acquire(); if (L.light) { L.light.color.setRGB(1, 0.16, 0.08); L.light.distance = 16; L.light.decay = 1.3; } }
        if (L.light) {
          _v.set(0, -0.4, -8).applyMatrix4(grp.matrixWorld);
          L.light.position.copy(_v); L.light.intensity = 70 * open;
          if (open <= 0.01 && t > close) { fx.lights.release(L.light); L.light = null; }
        }
      }
      if (!L.loop && g.audio.ready) { const b = g.audio.rotorBuf(1); if (b) L.loop = g.audio.loop(b, { ref: 170, reverb: 0.4, rate: 0.96 + L.k * 0.05 }); }
      if (L.loop) L.loop.update(a.pos.x, a.pos.y, a.pos.z, a.vel.x, a.vel.y, a.vel.z, L.k === 0 ? 3.4 : 2.4);
    }
  }

  // ── the garrison running for the ramps ──
  stagePeople() {
    const g = this.g;
    // how many come out: the garrison as it stands (cast caps it). It is a military base: the
    // soldiers, and the few civilians who made it in off the road
    const alive = g.run ? g.run.survivors : 20;
    const nC = Math.min(this.civs.length, Math.max(2, Math.round(alive * 0.15)));
    const nS = Math.min(this.troops.length, Math.max(8, alive - nC));
    const order = [];
    for (let i = 0; i < nS; i++) order.push([this.troops[i], true]);
    for (let i = 0; i < nC; i++) order.splice(2 + ((i * 3.7) | 0) % (order.length - 1), 0, [this.civs[i], false]);
    // they have to be up the ramps before it shuts: the gap between them shrinks with their number
    const gap = Math.min(0.55, 8.5 / order.length);
    for (const L of this.lifters) L.aboard = 0;
    this.runners = order.map(([f, soldier], k) => {
      const L = k % 3; // a third to each lifter (the lead's on camera, the others out to the sides)
      f.reset();
      if (f.root.parent !== this.g.scene) this.g.scene.add(f.root); // (out of last time's lifter)
      f.root.visible = false;
      // where each starts: behind the camera as it is when he sets off (the run shot tracks in
      // behind them), so he runs into the frame past it
      const go = this.T.run - 2.2 + k * gap;
      const cz = this.runCamZ(go);
      // (soldiers at a hard run; the civilians slower, a child slowest)
      const sp = soldier ? rand(4.6, 5.4) : rand(3.7, 4.3) * (f.child ? 0.85 : 1);
      return { f, soldier, L, x: rand(-6.5, 5.5), z: cz - rand(3, 8), ph: R() * 6, sp, go, state: 'wait', yaw: 0, wp: 0, bias: k % 2 ? 1 : -1 };
    });
  }

  /**
   * Into the hold: they stay there, standing packed in two files from the front of the cabin
   * back toward the ramp (carried on the lifter, so they fly out with it).
   */
  board(u) {
    const L = this.lifters[u.L], k = L.aboard++, f = u.f;
    const row = k >> 1, side = k % 2 ? 1 : -1;
    // (cabin floor at y -2.04 in the lifter's frame, the ramp's hinge near z -3.6)
    const z = Math.max(-3.1, 1.3 - row * 0.72) + rand(-0.08, 0.08), x = row * 0.72 > 4.4 ? rand(-0.15, 0.15) : side * rand(0.42, 0.55);
    L.group.add(f.root);
    f.root.position.set(x, -2.04, z);
    f.root.rotation.set(0, Math.PI + side * rand(0.3, 0.7), 0); // turned in, half facing the ramp
    f.root.visible = true;
    u.state = 'aboard';
    f.idle();
  }

  /** The run shot's camera z at scene time t (before the shot: where it will start). */
  runCamZ(t) {
    const s = this.shots.find((x) => x.name === 'run');
    if (!s) return 8;
    const k = clamp((t - s.from) / Math.max(0.01, s.to - s.from), 0, 1);
    return SHOTS.run(k).pos.z;
  }

  updatePeople(dt) {
    const t = this.t;
    for (const u of this.runners) {
      if (u.state === 'aboard') { u.f.idle(); continue; }
      if (u.state === 'gone') continue;
      if (t < u.go) continue;
      const f = u.f, L = this.lifters[u.L];
      // anyone still out when the ramp starts up is already on it, out of sight: in with the rest
      if (t > this.T.doorClose + 0.6) { this.board(u); continue; }
      if (u.state === 'wait') { u.state = 'run'; f.root.visible = true; }
      // the track out of the yard, then the ramp foot, then inside
      L.group.updateMatrixWorld();
      const foot = _v.copy(L.rampFoot).applyMatrix4(L.group.matrixWorld);
      const ins = _w.copy(L.inside).applyMatrix4(L.group.matrixWorld);
      const wps = [[u.L ? Math.sign(L.lz.x) * 4 : u.bias * 1.6, 26], [foot.x, foot.z], [ins.x, ins.z]];
      const [tx, tz] = wps[Math.min(u.wp, 2)];
      const dx = tx - u.x, dz = tz - u.z, d = Math.hypot(dx, dz);
      // (the turn out of the yard is a loose one; the ramp's foot and the hold are closer marks)
      if (d < [1.8, 1.0, 0.6][Math.min(u.wp, 2)]) {
        u.wp++;
        if (u.wp > 2) { this.board(u); continue; }
      }
      // round the others (in single file up the ramp), never through them
      const sp = Math.min(u.sp, d / Math.max(dt, 1e-3));
      const v = crowdSteer(this.runners, u, dx / d * sp, dz / d * sp, { side: u.wp >= 2 ? 0.15 : 1, look: 2.8 }, offRun);
      const x0 = u.x, z0 = u.z;
      u.x += v[0] * dt; u.z += v[1] * dt;
      u.moved = Math.hypot(u.x - x0, u.z - z0);
      u.d = d; u.ins = ins.y;
      if (u.moved > 1e-4) {
        let dy = Math.atan2(v[0], v[1]) - u.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        u.yaw += dy * Math.min(1, dt * 9);
      }
    }
    crowdResolve(this.runners, 0.34, offRun);
    for (const u of this.runners) {
      if (u.state !== 'run') continue;
      const f = u.f;
      u.ph += u.moved || 0; // the stride follows the ground actually covered
      // up the ramp: climbing with it
      let y = groundH(u.x, u.z);
      if (u.wp >= 2) y = lerp(groundH(u.x, u.z), u.ins, clamp(1 - u.d / 3.6, 0, 1));
      f.root.position.set(u.x, y, u.z);
      f.root.rotation.y = u.yaw;
      f.run(u.ph);
    }
  }

  /** Where one of the dead in the yard runs: for the lifters on the ground, after them once they lift. */
  chaseTarget(x, i) {
    let best = null, bd = Infinity;
    for (const L of this.lifters) {
      const lx = L.att.ready ? L.att.pos.x : L.lz.x, lz = L.att.ready ? L.att.pos.z : L.lz.z;
      const d = Math.abs(lx - x);
      if (d < bd) { bd = d; best = [lx, lz, L]; }
    }
    // a loose horde, not a queue: each keeps its own place in the crowd (by its id)
    const id = this.g.horde.id[i] || i, a = (id * 2.399) % (Math.PI * 2), r = 4 + ((id * 7.31) % 1) * 14;
    const up = best[2].att.ready && this.t > best[2].leave + 1.5;
    let z = best[1] + Math.sin(a) * r * (up ? 1.6 : 0.7) + (up ? 6 : -4);
    // until the ramps are up they get no further than the middle of the yard
    if (this.t < this.T.doorClose + 3) z = Math.min(z, best[1] - 26 + Math.sin(a) * 5);
    return [best[0] + Math.cos(a) * r, z];
  }

  // ── the dead over the wall: as the ramps start up they come over it, and run for the lifters ──
  updateIntruders(dt) {
    const g = this.g, h = g.horde, t = this.t, T = this.T;
    if (t < T.ramp - 1.0 || t > T.away + 12) return; // the garrison is off the wall: nothing holds them now
    if (!h.overWall) {
      // over the top: a moment crouched on the parapet before the drop while the garrison boards
      h.overWall = (x, z, i) => [...this.chaseTarget(x, i ?? 0), this.t < this.T.doorClose ? rand(1.6, 3.4) : rand(0, 0.5)];
      h.pileMul = 5;
      // the horde is at its cap by now: the far field (off camera from here on) makes room for the ones coming over
      h.cull((x, z) => z < -85 && R() < 0.75);
      for (let i = 0; i < 320; i++) h.spawn(R() < 0.55 ? ZT.RUNNER : ZT.SHAMBLER, rand(-75, 75), rand(-60, -12), 1, 1.25);
    }
    // the first heads over the parapet as the last of the garrison boards (seen past the ramp):
    // the mounds outside have reached the top under the wall's lamps, and the dead climb them
    // (horde: the climb over the top, then overWall puts them on the parapet, crouched); from
    // inside the yard all you see is heads and arms coming over the wall
    const early = t < T.doorClose;
    if (!this.mounds) {
      this.mounds = true;
      h.pileMul = 9;
      h.maxClimbers = 3; // (three at a time up each mound: the wall is lost)
      const lamps = (g.env.wallLamps || []).filter((l) => Math.abs(l.x) > 24 && Math.abs(l.x) < 60);
      for (const l of lamps) {
        const side = l.x < 0 ? -1 : 1, al = (Math.abs(l.x) - WORLD.GATE_HALF) / WING_COS;
        let p = h.nearestPile(side, al, 6);
        if (p < 0) p = h.seedPile(side, al);
        if (p < 0) continue;
        h.pH[p] = Math.max(h.pH[p], WORLD.WALL_H - 0.3);
        // the bodies that hold it up, and the ones crowding on to climb
        for (let k = 0; k < 34; k++) {
          const x = h.pX[p] + rand(-3.2, 3.2), i = h.spawn(R() < 0.6 ? ZT.RUNNER : ZT.SHAMBLER, x, wallZ(x) - rand(0.6, 5.5), 1, 1.2);
          if (i >= 0) { h.fadeIn[i] = 0; h.joinPile(i, p, WORLD.WALL_H); }
        }
      }
    }
    // later, once the ramps are shutting, a flood over every section near the yard (wide shots)
    this.intrudeAcc += dt * (early ? 0 : 15 + 18 * clamp((t - T.doorClose) / 10, 0, 1));
    while (this.intrudeAcc >= 1) {
      this.intrudeAcc -= 1;
      const x = (R() < 0.5 ? -1 : 1) * (R() < 0.75 ? rand(10, 34) : rand(34, 62)); // over the near wing sections, closest to the yard
      const i = h.spawn(R() < 0.8 ? ZT.RUNNER : ZT.SHAMBLER, x, wallZ(x) - 0.6, 1, 1.2);
      if (i >= 0) { const [tx, tz] = this.chaseTarget(x, i); h.goInside(i, tx, tz, rand(0, 0.5)); }
    }
    // the ones in the yard: every half second, a fresh bearing on the lifters (and after them)
    this.chaseAcc = (this.chaseAcc || 0) + dt;
    if (this.chaseAcc > 0.5) {
      this.chaseAcc = 0;
      for (let i = 0; i < h.n; i++) {
        if (h.dead[i] || !h.inside[i]) continue;
        const [tx, tz] = this.chaseTarget(h.x[i], i);
        h.tgtX[i] = tx; h.tgtZ[i] = tz;
      }
    }
  }

  /**
   * The dead around the yard, heard under everything: the crowd at the wall, a roar as they come
   * over it and flood the yard, falling away below as the lifters climb out.
   */
  updateScape(t) {
    const T = this.T, A = this.g.audio;
    const flood = clamp((t - T.doorClose + 1) / 3, 0, 1);
    const gone = clamp((t - T.away) / 8, 0, 1);
    A.scape = {
      horde_near: (0.32 + 0.12 * flood) * (1 - gone * 0.8),
      horde_surge: (0.28 + 0.3 * flood) * (1 - gone),
      shuffle: (0.22 + 0.1 * flood) * (1 - gone),
    };
  }

  /** The bastion goes dark: the wall's lamps and searchlights stutter and die once the flight is away. */
  updateLights(dt) {
    const g = this.g, t = this.t, at = this.T.away + 2.2; // early in the last wide, the whole wall in frame
    if (t < at) return;
    const u = t - at, env = g.env;
    // the power going out of the whole base: a sub sweep falling away under the lights as they die
    if (!this.bassDone) { this.bassDone = true; g.audio.blackout(); }
    // first the searchlights, one after another: each sags off its target and dies
    const SL = env.searchlights || [];
    SL.forEach((sl, k) => {
      const d = u - k * 0.55;
      sl.pw = d < 0 ? 1 : d < 0.35 ? (R() < 0.5 ? 1.3 : 0.1) : Math.max(0, 1 - (d - 0.35) * 3);
      if (d > 0 && d < 1) sl.goal.y -= 40 * (1 / 60);
    });
    // then the lamps along the wall: a surge, three stutters with the arcing, and gone
    const v = u - SL.length * 0.55 - 0.2;
    let p = 1;
    if (v > 0) {
      if (v < 0.25) p = 1.6;
      else if (v < 1.7) p = [1, 0, 1.2, 0, 0.7, 0, 0.4, 0][Math.floor((v - 0.25) / 0.18)] ?? 0;
      else p = 0;
      if (!this.darkDone) {
        this.darkDone = true;
        g.audio.powerDown();
        // sparks off every lamp as it shorts
        for (const l of env.wallLamps || []) for (let k = 0; k < 14; k++) g.fx.spark(l.x, l.y, l.z, rand(-3, 3), rand(0, 4), rand(-3, 3), 9, 6, 2, rand(0.4, 1.1));
      }
    }
    env.power = p;
    if (g.player.nestLight) g.player.nestLight.intensity = 1.6 * p;
    g.audio.lampPower = p;
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
    if (!this.cues.find((c) => c.text && t >= c.at && t < c.at + c.dur + 0.5)) $('cine-sub').classList.remove('on');
    if (!this.titleOn && t >= this.titleAt) { this.titleOn = true; $('cine-title').classList.add('on'); }
    for (let i = this.timers.length - 1; i >= 0; i--) if (t >= this.timers[i].at) { const f = this.timers[i].fn; this.timers.splice(i, 1); f(); }

    // the world goes on: the wall still fighting until the garrison leaves it
    const T = this.T;
    // "everyone off the wall": once the bombs are down and the gunships have the wall, nobody
    // stands on it, not the crews, the riflemen or the men on the roof
    const onWall = t < T.helosIn - 0.5;
    if (!onWall && !this.wallLeft) {
      this.wallLeft = true;
      g.arsenal.setGunners(0);
      for (const r of g.arsenal.riflemen || []) r.group.visible = false;
      for (const s of g.env.roofMen || []) s.root.visible = false;
      g.arsenal.air.endNight(); // the gunship on station heads home
    }
    if (t >= T.run + 1 && !this.scoreTurned) { this.scoreTurned = true; g.audio.setMusicMode('victory'); }
    this.updateScape(t);
    if (onWall) g.arsenal.update(dt, g.time);
    else g.arsenal.air.update(dt); // (the AC-130 flying home, not frozen where it was)
    g.horde.update(dt, g.time);
    this.updateBombers(dt);
    this.updateHelos(dt);
    this.updateRockets(dt);
    this.updateLifters(dt);
    this.updatePeople(dt);
    this.updateIntruders(dt);
    // the valley keeps coming, all the way through: whole crowds at a time, far out up the
    // field and down the gunships' lines (room kept for the ones coming over the wall)
    this.fieldAcc = (this.fieldAcc || 0) + dt;
    if (this.fieldAcc > 1.2) {
      this.fieldAcc = 0;
      this.crowd(R() < 0.6 ? (R() < 0.5 ? -1 : 1) * rand(8, 28) : rand(-130, 130), rand(-190, -100), 110, t > T.doorClose - 2 ? 320 : 120);
    }
    this.updateLights(dt);

    // the shot
    const s = this.shots.find((x) => t >= x.from && t < x.to) || this.shots[this.shots.length - 1];
    const st = t - s.from, k = clamp(st / Math.max(0.01, s.to - s.from), 0, 1);
    this._snap = this.lastShot !== s; this.lastShot = s; // on a cut the follow cameras start on their target
    const p = SHOTS[s.name](k, st, this, rdt);
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
    // the lens: focused where the shot looks (or on what it names), the blur growing with the focal length
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
    g.audio.setCine(false);
    this.timers = [];
    for (const r of this.bomberRuns || []) { r.b.group.visible = false; r.b.setDoors(0); if (r.loop) r.loop.stop(1); r.loop = null; }
    for (const m of this.bombPool || []) m.visible = false;
    for (const r of this.rockets || []) { r.on = false; r.m.visible = false; }
    for (const h of this.helos || []) { h.group.visible = false; h.beam.visible = false; if (h.loop) h.loop.stop(1); h.loop = null; if (h.light) g.fx.lights.release(h.light); h.light = null; }
    for (const L of this.lifters || []) { L.group.visible = false; if (L.loop) L.loop.stop(1); L.loop = null; if (L.light) g.fx.lights.release(L.light); L.light = null; if (L.holdLight) g.fx.lights.release(L.holdLight); L.holdLight = null; }
    g.arsenal.air.hide();
    g.ending.restoreGun();
    for (const u of this.runners || []) { u.f.root.visible = false; if (u.f.root.parent !== g.scene) g.scene.add(u.f.root); }
    for (const r of g.arsenal.riflemen || []) r.group.visible = true;
    g.arsenal.endNight();
    g.horde.overWall = null;
    g.horde.pileMul = this.pileMul0 ?? g.horde.pileMul;
    g.horde.limit = this.limit0 ?? g.horde.limit;
    for (const sl of g.env.searchlights || []) { sl.track = null; sl.boost = 1; sl.spotK = 1; }
    if (this.jetLight) { g.fx.lights.release(this.jetLight); this.jetLight = null; }
    this.mounds = false;
    g.horde.maxClimbers = 0;
    g.audio.scape = null;
    for (const sl of g.env.searchlights || []) sl.pw = 1;
    g.horde.clearLiving();
    this.wallLeft = false; this.scoreTurned = false;
    for (const s of g.env.roofMen || []) s.root.visible = true;
    g.env.power = 1; g.audio.lampPower = 1;
    if (g.player.nestLight) g.player.nestLight.intensity = 1.6;
    g.post.u.uFade.value = 1;
    $('cine-sub').classList.remove('on');
    $('cine-title').classList.remove('on');
  }
}
