// The prologue: a new campaign opens on the last evening before the first night.
// A long lens on the sun going down behind the burning city, crows crossing it; the
// lens pulls out to the bastion; out on the road, the wall lit orange; along the
// walkway and round the M240 gunner; Aran and Kovac call the lights on and a
// searchlight clunks on and swings out over the field; the first of the dead come over
// the rise, lit by lightning; the camera settles behind the fifty as the dark comes down.
// Then night 1 begins (its own camera move into the gun takes over from the last shot).
//
// Voiced and cut to the script like the endings (PROLOGUE in config.js): every cue
// lasts as long as its recording (a reading pace until it is recorded), silent beats
// ({ hold }) just hold their shot, the shots are cut to the cues, and the light runs
// from sunset to full dark across the whole of it. The sound is scored here too:
// the beds (audio.scape, updateScape) and the one-shots placed on the shots (score()).
import * as THREE from 'three';
import { WORLD, PROLOGUE, ZT, wallZ } from '../config.js';
import { clamp, lerp, rand, fitFov } from '../core/util.js';
import { groundH } from '../world/terrain.js';

const $ = (id) => document.getElementById(id);
const ease = (k) => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };
const easeOut = (k) => { k = clamp(k, 0, 1); return 1 - (1 - k) ** 3; };
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const GAP = 0.8, TAIL = 2.2;
// the sun: low over the city at the end of the valley, a little left of the road
const SUN_AZ = -0.3, SUN_FROM = 0.085, SUN_TO = -0.11;
const TELE = V(5, 15.5, 24); // the long lens on the sun, behind the bastion

// along the left wing, behind the parapet: x on the wing -> a point `back` metres inside the wall
const IN = [-0.482, 0.876], ALONG = [-0.876, -0.482]; // inward, and along the wing outward (left wing)
const onWing = (x, back, y) => V(x + IN[0] * back, y, wallZ(x) + IN[1] * back);
const sunAt = (P, from, dist) => from.clone().addScaledVector(P.g.env.sunDir, dist);

// Each shot maps k (0..1 across the shot), t (seconds into it) and the prologue to a
// camera pose; `shake` adds a little handheld drift (radians).
const SHOTS = {
  // a long lens on the sun going down behind the city; crows cross it
  sunTele: (k, t, P) => ({ pos: TELE.clone(), look: sunAt(P, TELE, 1000).add(V(-8 + 10 * k, -9, 0)), fov: lerp(9, 10, k), shake: 0.0008 }),
  // the lens pulls out and back: the flag, the nest and the riflemen against the sun
  sun: (k, t, P) => {
    const e = easeOut(k / 0.55), s = ease(k);
    return {
      pos: TELE.clone().lerp(V(8, 16.8, 37), s),
      look: sunAt(P, TELE, 1000).add(V(2, -9, 0)).lerp(V(-55, 12, -260), e),
      fov: lerp(10, 26, e), shake: 0.0012,
    };
  },
  // out on the road: a low dolly across it that cranes up on the wall, lit orange from the front
  valley: (k) => { const e = ease(k); return { pos: V(lerp(-28, -5, e), 0, lerp(-86, -80, e)), ground: lerp(1.3, 4.6, e), look: V(lerp(-6, 1, e), 6.5, -2), fov: 33, shake: 0.002 }; },
  // along the left wing's walkway, past the riflemen and the M240, toward the light
  wall: (k) => {
    const x = lerp(-9, -23, ease(k));
    return { pos: onWing(x, 2.4, WORLD.WALL_H + 1.25), look: onWing(x - 22, -9, WORLD.WALL_H + 0.4), fov: 42, shake: 0.004 };
  },
  // round the M240 gunner at the end of the walk, ending over his shoulder with the sun past it
  sentry: (k, t, P) => {
    const G = P.sentryAt, a = lerp(1.05, -0.35, ease(k)), r = lerp(2.6, 2.0, ease(k));
    const dx = IN[0] * Math.cos(a) + ALONG[0] * Math.sin(a), dz = IN[1] * Math.cos(a) + ALONG[1] * Math.sin(a);
    const pos = V(G.x + dx * r, G.y + 1.85, G.z + dz * r);
    const look = V(G.x - IN[0] * 6 + ALONG[0] * 3, G.y + 1.25, G.z - IN[1] * 6 + ALONG[1] * 3).lerp(V(G.x, G.y + 1.5, G.z), 0.35 * (1 - k));
    return { pos, look, fov: 34, shake: 0.003 };
  },
  // up on the tower at the end of the left wing: the searchlight clunks on and swings out
  searchlight: (k, t, P) => {
    const T = P.lamp.spot.position, e = ease(k);
    // behind the lamp, looking down its beam: the housing in the corner of the frame, the beam out over the field
    const dir = P.lamp.aim.clone().sub(T).normalize();
    return {
      pos: V(T.x + 2.6, T.y + 1.7, T.z + 4.4).lerp(V(T.x + 1.7, T.y + 1.2, T.z + 3.0), e),
      look: T.clone().addScaledVector(dir, 22).add(V(0, 1.5, 0)),
      fov: lerp(46, 40, e), shake: 0.002,
    };
  },
  // high over the back of the bastion as the sun goes and the lights sweep the field
  lights: (k) => ({ pos: V(22, 31, 45).lerp(V(13, 26, 33), ease(k)), look: V(-8, 2, -95).lerp(V(-6, 3, -110), ease(k)), fov: 50 }),
  // low in the field, a long lens up the road: the first of them over the rise, lightning behind
  dead: (k) => ({ pos: V(8, 0, -166).lerp(V(5, 0, -176), ease(k)), ground: 0.9, look: V(-6, 0, -262), lookGround: 3.2, fov: lerp(26, 21, ease(k)), shake: 0.0025 }),
  // into the nest, behind the gun, as the dark comes down (night 1's move into the gun follows)
  nest: (k, t, P) => {
    const G = P.g.ending.gunAt, e = ease(k);
    return { pos: V(G.x + 1.6, G.y + 1.1, G.z + 4.0).lerp(V(G.x + 0.3, G.y + 0.42, G.z + 1.9), e), look: V(G.x - 0.2, G.y - 0.3, G.z - 6).lerp(V(0, 8, -90), e), fov: 42 };
  },
};

// ── crows ────────────────────────────────────────────────────────────────────
// A loose flock crossing the sun: flat silhouettes, each wing hinged at the body and
// flapped (with glides), drawn as one instanced mesh, two instances (mirrored) a bird.
const BIRDS = 34;
class Flock {
  constructor(scene) {
    const geo = new THREE.BufferGeometry();
    // one wing and half the body (the other half is its mirror), forward = +z
    geo.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0.16, 0, 0, -0.1, 0.62, 0, -0.06,       // inner wing
      0.62, 0, -0.06, 0, 0, -0.1, 0.5, 0, -0.16,    // trailing primaries
      0, 0, 0.3, 0.06, 0, -0.05, 0, 0, -0.32,       // body
    ], 3));
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0x050403, side: THREE.DoubleSide, fog: false }), BIRDS * 2);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.b = [];
    for (let i = 0; i < BIRDS; i++) {
      this.b.push({ u: rand(-10, 10) - (i % 5) * 2, v: rand(-2.5, 2.5), w: rand(-12, 12), sp: rand(0.92, 1.1), f: rand(3.4, 4.6), ph: rand(0, 6), glide: rand(0, 10), size: rand(1.3, 1.8) });
    }
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._r = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3();
    this._z = V(0, 0, 1); this._up = V(0, 1, 0);
  }

  /** Lay the flight out: from `origin` across the view along `right`; `fwd` is depth. */
  start(origin, right, fwd) { this.o = origin.clone(); this.right = right.clone(); this.fwd = fwd.clone(); this.t = 0; this.mesh.visible = true; }

  update(dt) {
    if (!this.mesh.visible) return;
    this.t += dt;
    const T = this.t, up = this._up;
    const dir = this.right.clone().multiplyScalar(0.95).addScaledVector(up, 0.12).normalize();
    this._q.setFromUnitVectors(this._z, dir);
    for (let i = 0; i < BIRDS; i++) {
      const b = this.b[i];
      // the flock drifts across, each bird wandering in it
      const along = T * 6.5 * b.sp + b.u + Math.sin(T * 0.7 + b.ph) * 1.5;
      const p = this._p.copy(this.o).addScaledVector(this.right, along).addScaledVector(this.fwd, b.w + Math.sin(T * 0.5 + b.ph) * 2)
        .addScaledVector(up, b.v + T * 1.0 + Math.sin(T * 1.1 + b.ph * 2) * 0.8);
      // flapping; now and then a glide on set wings
      const gliding = Math.sin(T * 0.6 + b.glide) > 0.55;
      const flap = gliding ? 0.12 : Math.sin(T * b.f * Math.PI * 2 + b.ph) * 0.75 + 0.1;
      for (let s = 0; s < 2; s++) {
        this._r.setFromAxisAngle(this._z, s ? -flap : flap);
        const q = this._q.clone().multiply(this._r);
        this._s.set((s ? -1 : 1) * b.size, b.size, b.size);
        this._m.compose(p, q, this._s);
        this.mesh.setMatrixAt(i * 2 + s, this._m);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  stop() { this.mesh.visible = false; }
}

export class Prologue {
  constructor(game) {
    this.g = game;
    this.active = false;
  }

  start() {
    const g = this.g;
    if (!this.flock) this.flock = new Flock(g.scene);
    this.active = true;
    this.t = 0;
    this.skipArm = 0;
    this.titleOn = false;
    // the script: each cue as long as its recording (or a reading pace without one)
    const A = g.audio;
    let at = 0;
    this.cues = PROLOGUE.map((c, i) => {
      at += c.gap ?? (i ? GAP : 0);
      const buf = c.text && A.voices_ && A.voices_[c.who + '|' + c.text];
      const dur = c.hold ?? (buf ? buf.duration + 0.15 : 1.4 + c.text.split(/\s+/).length / 2.5);
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
      this.shots.push({ name: c.shot, from, to: this.end });
    });
    const title = this.cues.find((c) => c.title);
    this.titleAt = title ? title.at + title.dur - 0.3 : Infinity;
    const lights = this.cues.find((c) => c.lights !== undefined);
    this.lightsAt = lights ? lights.at + lights.lights : Infinity;
    this.lightsOn = false;
    this.lampOnIn = this.lightsAt - this.shotAt('searchlight') + 0.5;

    // the valley before the first night: empty, quiet, the wall manned and its lights off
    g.horde.clear();
    g.events.reset();
    g.fx.glow.clear(); g.fx.smoke.clear();
    g.arsenal.startNight(g.computeStats(), false, 1);
    g.env.setStory(1);
    g.env.beamBoost = 3;
    g.env.nextLightning = 1e9; // the storm holds off until the dark (one strike, placed in score())
    this.power(0);
    g.hud.show(false);
    g.letterboxTarget = 1;
    g.player.reset();
    g.player.gun.visible = false;
    g.ending.placeGun();
    g.audio.setMusicMode('menu');
    g.audio.intensity = 0; g.audio.pressure = 0;
    g.audio.setCine(true);
    // the first of the dead, far up the valley: on the road by the time the light is gone
    for (let i = 0; i < 70; i++) {
      const r = Math.random(), type = r < 0.85 ? ZT.SHAMBLER : r < 0.95 ? ZT.RUNNER : ZT.BRUTE;
      g.horde.spawn(type, rand(-46, 34), rand(-330, -280), 1, 0.75);
    }
    const sentry = g.arsenal.gunners[0];
    this.sentryAt = sentry ? sentry.group.position.clone() : onWing(-27, 1.35, WORLD.WALL_H - 0.55);
    // the left wing's searchlight, pointed down at the foot of its tower until it comes on
    this.lamp = g.env.searchlights[0];
    const T = this.lamp.spot.position;
    this.lamp.aim.set(T.x + 14, T.y - 9, T.z - 26);
    this.lamp.goal.copy(this.lamp.aim);
    this.lamp.hunt = 1e6;
    this.light(0);
    // the crows: across the sun, left to right in the long lens
    const sd = g.env.sunDir, right = V(-sd.z, 0, sd.x).normalize();
    if (right.x < 0) right.negate();
    this.flock.start(sunAt(this, TELE, 105).addScaledVector(right, -26).add(V(0, -3.5, 0)), right, V(sd.x, 0, sd.z).normalize());
    this.score();
    $('cine-sub').classList.remove('on');
    $('cine-title').classList.remove('on');
    $('cine-skip').classList.remove('on');
    $('cine-tag').textContent = 'THE FIRST NIGHT';
    g.screens.show('cine');
  }

  shotAt(name) { return (this.shots.find((s) => s.name === name) || { from: Infinity }).from; }

  /**
   * The sound, placed on the shots: a siren in the dead city and the crows across the sun;
   * an evening bell in the valley; a dog far off; the gunner working his M240; the
   * searchlights' contactors and the arc striking; a heartbeat and a lightning strike over
   * the dead on the road; the fifty's charging handle. (The beds follow in updateScape.)
   */
  score() {
    const g = this.g, A = g.audio, B = A.B || {};
    const ev = [];
    const add = (t, fn) => ev.push({ t, fn, done: false });
    const amb = (buf, o) => buf && A.play(buf, { bus: 'amb', force: true, ...o });
    const tele = this.shotAt('sunTele');
    add(tele + 0.4, () => amb(B.siren?.[0], { gain: 0.08, rate: 0.8, pan: -0.4, lowpass: 1400, reverb: 0.95, fadeIn: 3, fadeOut: 4 }));
    // the flock: caws drifting left to right with it, then a few stragglers
    [1.1, 1.9, 2.4, 3.3, 4.0, 4.6, 5.5, 6.4, 7.6].forEach((dt, i, a) => add(tele + dt, () => amb(A.pickVar('crow'), {
      gain: rand(0.14, 0.28), rate: rand(0.93, 1.07), pan: lerp(-0.7, 0.75, i / (a.length - 1)), lowpass: rand(5000, 9000), reverb: 0.45,
    })));
    [11.5, 17, 24].forEach((dt) => add(tele + dt, () => amb(A.pickVar('crow'), { gain: rand(0.07, 0.12), rate: rand(0.9, 1.0), pan: rand(-0.8, 0.8), lowpass: 4000, reverb: 0.6 })));
    // an evening bell somewhere back down the valley road
    const val = this.shotAt('valley');
    [0.9, 4.3, 7.7].forEach((dt, i) => add(val + dt, () => amb(B.bell?.[0], { gain: 0.2 - i * 0.03, rate: 0.78, pan: 0.45, lowpass: 2800, reverb: 0.85 })));
    // a dog, far off, twice, and then not again
    const wall = this.shotAt('wall');
    add(wall + 3.2, () => amb(A.pickVar('dog'), { gain: 0.08, pan: -0.75, lowpass: 1700, reverb: 0.85 }));
    add(wall + 4.4, () => amb(A.pickVar('dog'), { gain: 0.06, pan: -0.72, lowpass: 1500, reverb: 0.85 }));
    // the gunner opens the feed cover, lays a belt in, shuts it
    const sen = this.shotAt('sentry'), G = this.sentryAt, at = { x: G.x, z: G.z, y: G.y + 1, ref: 5, force: true };
    add(sen + 1.0, () => B.latch && A.play(B.latch[0], { ...at, gain: 0.42, rate: 1.25, reverb: 0.2 }));
    add(sen + 2.1, () => A.play(A.pickVar('casing'), { ...at, gain: 0.16, rate: 0.7, reverb: 0.2 }));
    add(sen + 2.6, () => B.latch && A.play(B.latch[0], { ...at, gain: 0.5, rate: 0.95, reverb: 0.25 }));
    // the searchlights: a contactor slamming in on each tower and the arc striking, one after the other
    const L = this.lightsAt;
    for (const [k, d] of [[0, 0.05], [1, 0.75]]) {
      const sl = g.env.searchlights[k];
      if (!sl) continue;
      const p = { x: sl.spot.position.x, z: sl.spot.position.z, y: sl.spot.position.y, force: true };
      add(L + d, () => B.latch && A.play(B.latch[0], { ...p, gain: 0.9, rate: 0.42, ref: 22, reverb: 0.5 }));
      add(L + d + 0.12, () => B.steam && A.play(B.steam[0], { ...p, gain: 0.22, rate: 1.7, ref: 18, reverb: 0.3, duration: 0.9, fadeOut: 0.4 }));
    }
    // the dead: a heartbeat under the cut, one strike of lightning over the rise
    const dead = this.shotAt('dead');
    add(dead + 0.3, () => B.heartbeat && A.play(B.heartbeat[0], { gain: 0.3, force: true }));
    add(dead + 2.4, () => { g.env.nextLightning = 0; });
    add(dead + 3.0, () => B.heartbeat && A.play(B.heartbeat[0], { gain: 0.22, rate: 0.96, force: true }));
    // in the nest: the fifty's charging handle, twice
    const nest = this.shotAt('nest');
    add(nest + 2.0, () => B.charge && A.play(B.charge[0], { gain: 0.5, reverb: 0.25, pan: 0.1, force: true }));
    add(nest + 2.9, () => B.charge && A.play(B.charge[0], { gain: 0.42, rate: 0.94, reverb: 0.25, pan: 0.1, force: true }));
    this.events = ev.sort((a, b) => a.t - b.t);
    this.groanT = 0;
  }

  /** The beds: evening birds giving way to wind and rain, flies on the wall, the far horde with the dark. */
  updateScape(s, dt) {
    const g = this.g, A = g.audio, f = Math.min(1, this.t / this.end);
    const near = s.name === 'wall' || s.name === 'sentry';
    A.scape = {
      dawn: 0.26 * (1 - ease(f / 0.55)), // evening birds
      wind_howl: 0.03 + 0.12 * ease(f),
      rain_far: 0.2 * ease((f - 0.55) / 0.45),
      rain_near: 0.1 * ease((f - 0.72) / 0.28),
      flies: near ? 0.09 : 0.015,
      war: 0.04 + 0.07 * f,
      horde_far: s.name === 'dead' ? 0.34 : s.name === 'nest' ? 0.2 : 0,
      horde_mid: 0, horde_surge: 0,
      shuffle: s.name === 'dead' ? 0.07 : 0,
    };
    // the dead on the road groan as the long lens finds them
    if (s.name === 'dead' && (this.groanT -= dt) <= 0) {
      this.groanT = rand(0.5, 1.4);
      const h = g.horde;
      for (let tries = 0; tries < 6 && h.n; tries++) {
        const i = (Math.random() * h.n) | 0;
        if (h.dead[i]) continue;
        A.groan(h.x[i], h.z[i], h.type[i] === ZT.BRUTE ? 2 : 0);
        break;
      }
    }
  }

  /** The wall's lights: lamps, searchlights, the nest lamp and the sodium hum. */
  power(p) {
    const g = this.g;
    g.env.power = p;
    if (g.player.nestLight) g.player.nestLight.intensity = 1.6 * p;
    g.audio.lampPower = p;
  }

  /** Sunset to full dark across the whole prologue (f: 0..1 of the way through). */
  light(f) {
    const env = this.g.env;
    env.sunDir.set(SUN_AZ, lerp(SUN_FROM, SUN_TO, f), -1).normalize();
    env.dawn = lerp(0.72, 0, ease(f * 1.08));
    env.dusk = 1 - ease((f - 0.5) / 0.5);
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
      if (!c.text) continue;
      if (c.radio) { const len = g.audio.radioVoice(c.who, c.text, 0.3); g.audio.radioStatic(Math.max(0.6, (len || c.dur) - 0.1)); } else g.audio.narrate(c.who, c.text, 0.05);
      this.showSub(c);
    }
    const cur = this.cues.find((c) => c.text && t >= c.at && t < c.at + c.dur + 0.5);
    if (!cur) $('cine-sub').classList.remove('on');
    if (!this.titleOn && t >= this.titleAt && t < this.titleAt + 6) { this.titleOn = true; $('cine-title').classList.add('on'); }
    if (this.titleOn && t >= this.titleAt + 6) { this.titleOn = false; $('cine-title').classList.remove('on'); }

    // the lights come on: a stutter as the generator takes the load, then the hum;
    // the searchlight swings off the foot of its tower and out over the field
    if (t >= this.lightsAt) {
      const lt = t - this.lightsAt;
      if (!this.lightsOn) {
        this.lightsOn = true;
        g.audio.powerUp();
        this.lamp.goal.set(-24, groundH(-24, -150), -150);
        this.lamp.hunt = 14;
      }
      this.power(lt < 1.3 ? (Math.random() < 0.25 + lt * 0.5 ? 1 : 0.06) : 1);
    }

    // the shot
    const s = this.shots.find((x) => t >= x.from && t < x.to) || this.shots[this.shots.length - 1];
    const st = t - s.from, k = clamp(st / Math.max(0.01, s.to - s.from), 0, 1);
    const p = SHOTS[s.name](k, st, this);
    if (p.ground !== undefined) p.pos.y = groundH(p.pos.x, p.pos.z) + p.ground;
    if (p.lookGround !== undefined) p.look.y = groundH(p.look.x, p.look.z) + p.lookGround;
    if (p.shake) {
      // handheld: a slow wander of the aim, in proportion to how far off it is
      const d = p.pos.distanceTo(p.look) * p.shake;
      p.look.x += (Math.sin(t * 0.83) + 0.5 * Math.sin(t * 2.1 + 1.3)) * d;
      p.look.y += (Math.sin(t * 0.61 + 2) + 0.4 * Math.sin(t * 1.7)) * d * 0.7;
    }
    const cam = g.camera;
    cam.position.copy(p.pos);
    cam.up.set(0, 1, 0);
    cam.lookAt(p.look);
    const fov = fitFov(p.fov, cam.aspect);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld(true);

    this.light(Math.min(1, t / this.end));
    if (s.name === 'sunTele' || s.name === 'sun') this.flock.update(rdt); else this.flock.stop();
    g.horde.update(dt, g.time);
    g.arsenal.update(dt, g.time);
    for (const e of this.events) if (!e.done && t >= e.t) { e.done = true; e.fn(); }
    this.updateScape(s, rdt);

    // in from black; dips to black between shots (the pull-out runs straight on from the long lens)
    let fade = Math.min(1, t / 2.6);
    for (const x of this.shots) { if (x.from > 0 && x.name !== 'sun') fade = Math.min(fade, Math.abs(t - x.from) / 0.45); }
    g.post.u.uFade.value = clamp(fade, 0, 1);
    if (t > this.end) this.finish();
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

  /** Over (or skipped): night 1 begins from wherever the camera is. */
  finish() {
    if (!this.active) return;
    this.stop();
    this.g.onPrologueDone();
  }

  /** Tear it down (also used when leaving to the menu). */
  stop() {
    if (!this.active) return;
    this.active = false;
    const g = this.g;
    g.audio.stopVoice();
    g.audio.setCine(false);
    g.audio.scape = null;
    g.ending.restoreGun();
    g.env.dusk = 0;
    g.env.dawn = 0;
    g.env.nextLightning = 14;
    g.env.beamBoost = 1;
    this.lamp.hunt = 0;
    this.flock.stop();
    this.power(1);
    g.post.u.uFade.value = 1;
    $('cine-sub').classList.remove('on');
    $('cine-title').classList.remove('on');
    $('cine-skip').classList.remove('on');
    $('cine-tag').textContent = '';
  }
}
