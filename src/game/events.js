// Night events: something different every night. A patrol fighting its way
// home, fog, civilians from the overpass, a resupply drop to hold, giants,
// a brute stampede, a blackout, the gunship going down, a bloater column.
// Each event has its own radio traffic (EVENT_LINES, voiced) and can put an
// objective, a boss bar and markers on the HUD.
import * as THREE from 'three';
import {
  WORLD, ZT, ZOMBIE_TYPES, CALL, EVENTS, EVENT_LINES, NIGHT_EVENTS, ENDLESS_EVENTS, wallZ, wallDist, WING_COS,
} from '../config.js';
import { clamp, rand, lerp } from '../core/util.js';
import { PF } from '../world/textures.js';
import { groundH } from '../world/terrain.js';
import { buildGunship } from './air.js';
import { cylX } from '../world/kit.js';
import { makeUral, URAL_BED, URAL_LAMPS, TRUCK_SIZE } from '../world/vehicles.js';
import { cloneModel } from '../world/models.js';
import { Soldier } from './soldier.js';
import { Survivor } from './survivor.js';
import { walkStep, steer, addObstacle, removeObstacle } from '../world/obstacles.js';
const _w2 = [0, 0];

const R = Math.random;
const pickOne = (a) => a[(R() * a.length) | 0];
const GATE = { x: 0, z: -10.5 };

function offsetZ(x, d) {
  return wallZ(x) - (Math.abs(x) <= WORLD.GATE_HALF ? d : d / WING_COS);
}

// ── people: Soldier models (soldier.js) and Survivors (survivor.js) ──────────

/** Ready a Soldier model to go out. */
function dressSoldier(f) {
  f.reset(); f.root.scale.setScalar(rand(0.97, 1.03)); f.root.visible = true;
}

/** A soldier on the move fires at the nearest of them within range. */
function soldierFire(g, u, dt, range = 32, every = [0.18, 0.4]) {
  const h = g.horde, fx = g.fx;
  u.shootT -= dt;
  if (u.shootT > 0) return;
  u.shootT = rand(every[0], every[1]);
  const n = h.queryRadius(u.x, u.z, range, h._q);
  let best = -1, bd = 1e9;
  for (let k = 0; k < n; k++) { const j = h._q[k]; const dd = (h.x[j] - u.x) ** 2 + (h.z[j] - u.z) ** 2; if (dd < bd) { bd = dd; best = j; } }
  if (best < 0) return;
  const gy = groundH(u.x, u.z);
  const ox = u.x, oy = gy + 1.35, oz = u.z;
  const tx = h.x[best], ty = groundH(tx, h.z[best]) + 1.2 * h.scale[best], tz = h.z[best];
  const ddd = Math.sqrt(bd) || 1;
  fx.tracer(ox, oy, oz, tx, ty, tz, 420, 0.8, 6.5, 1.4, 0.6);
  fx.muzzle(ox, oy, oz, (tx - ox) / ddd, 0, (tz - oz) / ddd, 0.4);
  if (R() < 0.6) {
    h.damage(best, 26, 'gunner', (tx - ox) / ddd, 0, (tz - oz) / ddd, R() < 0.2);
    fx.fleshHit(tx, ty, tz, (tx - ox) / ddd, 0, (tz - oz) / ddd, 0.7);
  }
  if (R() < 0.5) g.audio.wallGun(ox, oz);
}

/** Running (or, carrying, a heavy walk under the crate) for one step of the cycle. */
function poseRun(f, ph, carry = false) {
  f.run(ph / 2.1, carry); // the phase runs at 2.1 rad per metre
}

// ─────────────────────────────────────────────────────────────────────────────
// The gate squad: when friendlies are coming in (an escort, the recovery team, the truck), four
// men step a few metres out of the gate, take a knee in a line and shoot what is chasing them,
// then go back in once everyone is through. Caught out there, a man is lost like any other.
const COVER_AT = 8; // soldiers[COVER_AT..] are the gate squad
class GateCover {
  constructor(E) { this.E = E; this.P = EVENTS.cover; this.state = 'in'; this.men = []; this.quiet = 0; this.pick = 0; this.targets = []; }

  reset() {
    for (const m of this.men) m.f.root.visible = false;
    this.men = []; this.state = 'in'; this.quiet = 0;
    if (this.light) { this.E.g.fx.lights.release(this.light); this.light = null; }
    this.lightK = 0;
  }

  /** The gate stands open while the squad is out: its floodlight spills onto the road. */
  flood(dt) {
    const fx = this.E.g.fx, on = this.state !== 'in';
    this.lightK = Math.max(0, Math.min(1, (this.lightK || 0) + (on ? dt * 2 : -dt * 0.8)));
    if (this.lightK > 0 && !this.light) {
      this.light = fx.lights.acquire();
      if (this.light) { this.light.color.setRGB(1, 0.78, 0.5); this.light.distance = 38; this.light.decay = 1.4; this.light.position.set(GATE.x, groundH(GATE.x, GATE.z) + 5.5, GATE.z - 2); }
    }
    if (this.light) {
      this.light.intensity = 160 * this.lightK;
      if (this.lightK <= 0) { fx.lights.release(this.light); this.light = null; }
    }
  }

  call() {
    const P = this.P, g = this.E.g;
    this.men = [];
    for (let k = 0; k < P.men; k++) {
      const f = this.E.soldiers[COVER_AT + k];
      dressSoldier(f);
      // a shallow line across the road in front of the gate
      const px = (k - (P.men - 1) / 2) * 3.4 + rand(-0.4, 0.4);
      this.men.push({
        f, x: GATE.x + (k - 1.5) * 0.8, z: GATE.z + 0.5, px, pz: GATE.z - rand(P.out[0], P.out[1]) + Math.abs(px) * 0.25,
        state: 'out', ph: R() * 6, yaw: Math.PI, t: 0, shootT: rand(0.3, 0.9), elev: 0, kick: 0, tgt: -1,
      });
    }
    this.state = 'out'; this.quiet = 0;
    this.E.say('cover', 'out', true);
    g.hud.alert('GATE SQUAD IS OUT');
  }

  /** friends: [{x, z}] of ours still coming in. */
  update(dt, friends) {
    const E = this.E, g = E.g, h = g.horde, fx = g.fx, P = this.P;
    const coming = friends.filter((f) => Math.hypot(f.x - GATE.x, f.z - GATE.z) < P.callD);
    this.flood(dt);
    if (this.state === 'in') { if (coming.length) this.call(); else return; }
    if (this.state === 'out' || this.state === 'hold') {
      this.quiet = coming.length ? 0 : this.quiet + dt;
      if (this.quiet > P.linger) this.back();
    }
    // what to shoot: the dead closest to whoever is coming in (or to the squad itself)
    if ((this.pick -= dt) <= 0) {
      this.pick = 0.3;
      // everything in range, the ones nearest our people (or the squad itself) first
      const c = [], sx = GATE.x, sz = GATE.z - 9;
      const n = h.queryRadius(sx, sz, P.range, h._q);
      for (let k = 0; k < n; k++) {
        const j = h._q[k], x = h.x[j], z = h.z[j];
        let s = Math.hypot(x - sx, z - sz) * 1.6;
        for (const f of coming) s = Math.min(s, Math.hypot(x - f.x, z - f.z));
        c.push({ id: h.id[j], s });
      }
      c.sort((a, b) => a.s - b.s);
      this.targets = c.slice(0, 8).map((o) => o.id);
    }
    let alive = 0;
    for (let k = 0; k < this.men.length; k++) {
      const m = this.men[k], f = m.f;
      m.t += dt;
      if (m.state === 'down') {
        f.die(m.t);
        continue;
      }
      if (m.state === 'gone') continue;
      alive++;
      const gy = groundH(m.x, m.z);
      if (m.state === 'out' || m.state === 'back') {
        const tx = m.state === 'out' ? m.px : GATE.x + (k - 1.5) * 0.8, tz = m.state === 'out' ? m.pz : GATE.z + 0.6;
        const dx = tx - m.x, dz = tz - m.z, d = Math.hypot(dx, dz);
        if (d < 0.25) {
          if (m.state === 'out') { m.state = 'hold'; m.t = 0; }
          else { m.state = 'gone'; f.root.visible = false; continue; }
        } else {
          const st = Math.min(d, P.speed * dt);
          m.x += dx / d * st; m.z += dz / d * st;
          m.yaw = Math.atan2(dx, dz);
          m.ph += dt * P.speed * 2.1;
          f.run(m.ph / 2.1);
        }
      }
      if (m.state === 'hold') {
        // pick a target (spread across the squad) and fire
        let j = -1;
        if (this.targets.length) {
          const id = this.targets[k % this.targets.length];
          if (m.tgt !== id) m.tgt = id;
          j = h.indexOf(id);
        }
        m.kick = Math.max(0, m.kick - dt * 6);
        if (j >= 0) {
          const ox = m.x, oz = m.z, tx = h.x[j], tz = h.z[j];
          const dd = Math.hypot(tx - ox, tz - oz) || 1;
          const want = Math.atan2(tx - ox, tz - oz);
          let dy = want - m.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          m.yaw += dy * Math.min(1, dt * 8);
          const ty = groundH(tx, tz) + 1.2 * h.scale[j];
          m.elev += (Math.atan2(ty - (gy + 1.45), dd) - m.elev) * Math.min(1, dt * 8);
          if ((m.shootT -= dt) <= 0 && dd < P.range && Math.abs(dy) < 0.25) {
            m.shootT = rand(P.every[0], P.every[1]);
            m.kick = 1;
            f.root.updateMatrixWorld(true);
            f.muzzle.getWorldPosition(_v);
            fx.tracer(_v.x, _v.y, _v.z, tx, ty, tz, 420, 0.8, 6.5, 1.4, 0.6);
            fx.muzzle(_v.x, _v.y, _v.z, (tx - ox) / dd, 0, (tz - oz) / dd, 0.4);
            if (R() < P.hit) {
              h.damage(j, P.damage, 'gunner', (tx - ox) / dd, 0, (tz - oz) / dd, R() < 0.2);
              fx.fleshHit(tx, ty, tz, (tx - ox) / dd, 0, (tz - oz) / dd, 0.7);
            }
            if (R() < 0.5) g.audio.wallGun(ox, oz);
          }
        } else {
          // nothing to shoot: watch the road
          let dy = Math.PI - m.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          m.yaw += dy * Math.min(1, dt * 3);
          m.elev *= 1 - Math.min(1, dt * 3);
        }
        f.aim(m.elev, 0, m.kick);
        // too close: the squad falls back before it is overrun
        if (h.queryRadius(m.x, m.z, P.fallBack, h._q) > 0 && this.state !== 'back') this.back();
      }
      // caught
      if (m.t > 0.5 && h.queryRadius(m.x, m.z, P.catchR, h._q) > 0) {
        m.state = 'down'; m.t = 0;
        g.audio.scream2(m.x, m.z);
        fx.headshot(m.x, gy + 1.3, m.z, 0, 0.3, 1);
        fx.blood(m.x, m.z, 1.4);
        if (g.run && g.inPlay()) { g.run.survivors = Math.max(0, g.run.survivors - 1); g.ns.lost++; }
        g.hud.alert('WE LOST A MAN AT THE GATE', 'red');
        E.say('cover', 'lost', true);
        if (this.state !== 'back') this.back(true);
        if (g.run && g.inPlay() && g.run.survivors <= 0) g.fall();
        continue;
      }
      f.root.position.set(m.x, gy, m.z);
      f.root.rotation.y = m.yaw;
      fx.glowDot(m.x, gy + 1.72, m.z, 0.32, 0.4, 5, 0.8, 0.05);
    }
    if (this.state === 'back' && alive === 0) this.state = 'in';
    if (this.state !== 'in' && this.men.every((m) => m.state === 'gone' || m.state === 'down') && this.state !== 'back') this.state = 'in';
  }

  back(quiet = false) {
    if (this.state === 'back' || this.state === 'in') return;
    this.state = 'back';
    for (const m of this.men) if (m.state === 'out' || m.state === 'hold') { m.state = 'back'; m.t = 1; }
    if (!quiet) this.E.say('cover', 'back');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
class Escort {
  constructor(E, kind) {
    this.E = E; this.kind = kind; this.P = EVENTS[kind]; this.blocking = true;
    this.title = kind === 'patrol' ? 'RECON TWO' : 'OVERPASS SURVIVORS';
  }

  start() {
    const { E, P } = this, h = E.g.horde, plan = E.g.plan;
    const x0 = rand(-12, 12), z0 = -178;
    this.units = [];
    for (let k = 0; k < P.count; k++) {
      const soldier = this.kind === 'patrol';
      const f = soldier ? E.soldiers[k] : E.people[k];
      if (soldier) { dressSoldier(f); this.units.push(this.unit(f, x0, z0, P, false)); continue; }
      const small = f.child; // the last two are children (see the people in NightEvents)
      f.reset();
      f.root.scale.setScalar(small ? rand(0.78, 0.88) : rand(0.96, 1.04));
      f.root.visible = true;
      this.units.push(this.unit(f, x0, z0, P, small, k % 2 === 0));
    }
    this.track = new Set();
    for (let k = 0; k < P.chasers; k++) {
      const type = R() < 0.8 ? ZT.RUNNER : ZT.SHAMBLER;
      const i = h.spawn(type, x0 + rand(-10, 10), z0 - rand(30, 60), plan.hpMul, plan.speedMul * 0.95);
      if (i >= 0) { this.track.add(h.id[i]); h.fadeIn[i] = 0; }
    }
    this.saved = 0; this.lost = 0; this.t = 0; this.lostSaid = false;
    E.say(this.kind, 'start', true);
    E.say(this.kind, 'follow');
    E.g.hud.alert(this.kind === 'patrol' ? 'FRIENDLIES ON THE ROAD — COVER THEM' : 'CIVILIANS ON THE ROAD — COVER THEM');
  }

  unit(f, x0, z0, P, small, light = true) {
    return {
      f, x: x0 + rand(-3, 3), z: z0 + rand(-5, 5), sp: rand(P.speed[0], P.speed[1]) * (small ? 0.92 : 1), ph: R() * 6,
      state: 'run', t: 0, shootT: rand(0.2, 0.6), light, yaw: Math.PI,
    };
  }

  update(dt) {
    const { E, P } = this, g = E.g, h = g.horde, fx = g.fx;
    this.t += dt;
    const running = this.units.filter((u) => u.state === 'run');
    // zombies near the group go for them
    for (const u of running) {
      const cnt = h.queryRadius(u.x, u.z, 14, h._q);
      for (let k = 0; k < cnt; k++) this.track.add(h.id[h._q[k]]);
    }
    for (let i = 0; i < h.n; i++) {
      if (h.dead[i] || !this.track.has(h.id[i])) continue;
      let best = null, bd = 1e9;
      for (const u of running) { const d = (h.x[i] - u.x) ** 2 + (h.z[i] - u.z) ** 2; if (d < bd) { bd = d; best = u; } }
      if (best && bd < 130 * 130) { h.tgtX[i] = best.x; h.tgtZ[i] = best.z; } else { h.resetLane(i); this.track.delete(h.id[i]); }
    }
    for (const u of this.units) {
      const f = u.f;
      if (u.state === 'run') {
        let dx = GATE.x - u.x, dz = GATE.z - u.z;
        const d = Math.hypot(dx, dz) || 1;
        dx /= d; dz /= d;
        // shy away from the dead
        const cnt = h.queryRadius(u.x, u.z, 4, h._q);
        let ax = 0, az = 0;
        for (let k = 0; k < cnt; k++) {
          const j = h._q[k], ox = u.x - h.x[j], oz = u.z - h.z[j], o = Math.hypot(ox, oz) || 1;
          ax += ox / o * (4 - o) * 0.35; az += oz / o * (4 - o) * 0.35;
        }
        let vx = dx + ax * 0.6, vz = dz + az * 0.25;
        const vl = Math.hypot(vx, vz) || 1;
        vx = vx / vl * u.sp; vz = vz / vl * u.sp;
        const wv = walkStep(u, vx, vz, dt, 0.4);
        u.yaw = Math.atan2(wv[0], wv[1]);
        u.ph += dt * u.sp * 2.1;
        // caught
        if (this.t > 1.5 && h.queryRadius(u.x, u.z, P.catchR * f.root.scale.x, h._q) > 0) {
          u.state = 'down'; u.t = 0; this.lost++;
          g.audio.scream2(u.x, u.z);
          fx.headshot(u.x, groundH(u.x, u.z) + 1.3, u.z, 0, 0.3, 1);
          fx.blood(u.x, u.z, 1.4);
          if (!this.lostSaid) { this.lostSaid = true; E.say(this.kind, 'lost', true); }
          g.hud.alert(this.kind === 'patrol' ? 'WE LOST ONE OF RECON TWO' : 'THEY GOT ONE OF THE CIVILIANS', 'red');
        } else if (u.z > GATE.z - 0.5 && Math.abs(u.x) < 7) {
          u.state = 'safe'; u.t = 0; this.saved++;
          g.hud.alert(this.kind === 'patrol' ? 'ONE OF RECON TWO IS THROUGH THE GATE' : 'CIVILIAN THROUGH THE GATE');
        }
        // soldiers fight as they run
        if (this.kind === 'patrol') soldierFire(g, u, dt);
      } else u.t += dt;
      // pose
      const gy = groundH(u.x, u.z);
      f.root.position.set(u.x, gy, u.z);
      f.root.rotation.y = u.yaw;
      if (u.state === 'run') {
        poseRun(f, u.ph);
        if (u.light) {
          const sc = f.root.scale.x;
          if (this.kind === 'patrol') fx.glowDot(u.x, gy + 1.72 * sc, u.z, 0.32, 0.4, 5, 0.8, 0.05);
          else fx.glowDot(u.x + Math.sin(u.yaw) * 0.4, gy + 1.0 * sc, u.z + Math.cos(u.yaw) * 0.4, 0.35, 5, 4, 2.4, 0.05);
        }
      } else if (u.state === 'down') {
        f.die(u.t);
      } else if (u.state === 'safe') {
        f.root.visible = u.t < 0.4;
      }
    }
    if (running.length === 0 && this.units.every((u) => u.state !== 'run')) return this.finish();
    return false;
  }

  finish() {
    const { E, P } = this, g = E.g;
    for (let i = 0; i < g.horde.n; i++) if (this.track.has(g.horde.id[i])) g.horde.resetLane(i);
    E.report(this.kind, 'end', { saved: this.saved, lost: this.lost, of: this.units.length, seconds: Math.round(this.t) });
    if (this.saved === this.units.length) E.say(this.kind, 'saved', true);
    else if (this.saved > 0) { E.say(this.kind, 'some', true); if (this.kind === 'patrol') E.say(this.kind, 'saved'); }
    else E.say(this.kind, 'none', true);
    if (this.saved > 0) {
      const run = g.run;
      run.survivors += this.saved * P.reward.survivors;
      const sup = this.saved * P.reward.supplies;
      run.supplies += sup; g.ns.supplies += sup;
      g.hud.alert(`+${this.saved * P.reward.survivors} ON THE WALL · +${sup} SUPPLIES`);
    }
    return true;
  }

  end() { for (const u of this.units || []) u.f.root.visible = false; }

  friendlies() { return (this.units || []).filter((u) => u.state === 'run'); }

  objective() {
    const run = this.units.filter((u) => u.state === 'run');
    const near = run.reduce((m, u) => Math.min(m, Math.hypot(u.x - GATE.x, u.z - GATE.z)), 999);
    return {
      title: this.title,
      text: `${run.length} RUNNING · ${this.saved} SAFE · ${this.lost} LOST${run.length ? ` · ${Math.round(near)} M TO THE GATE` : ''}`,
      progress: run.length ? 1 - near / 170 : 1, cls: this.lost ? 'warn' : '',
    };
  }

  markers() {
    const run = this.units.filter((u) => u.state === 'run');
    return run.map((u, k) => ({ x: u.x, y: groundH(u.x, u.z) + 2.4, z: u.z, label: k === 0 ? (this.kind === 'patrol' ? 'FRIENDLIES' : 'CIVILIANS') : '', cls: 'friend' }));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The resupply: a C-130 drops a crate in the field, and a recovery team goes out
// through the gate to bring it home. The dead go for the strobe, then for them.
const TEAM = 4;          // soldiers[TEAM_AT..] are the recovery team (the patrol uses the first four)
const TEAM_AT = 4;
class SupplyDrop {
  constructor(E) { this.E = E; this.P = EVENTS.drop; this.blocking = true; }

  start() {
    const E = this.E;
    const x = rand(-34, 34);
    this.tx = x; this.tz = offsetZ(x, rand(55, 85));
    this.phase = 'inbound'; this.t = 0; this.integrity = 100; this.hurtSaid = false; this.broken = false;
    // the C-130 comes in from behind the wall, low, across the drop zone
    const p = E.c130;
    p.group.visible = true;
    this.plane = { x: this.tx - 40, y: 110, z: 560, vx: 0, vz: -85, loop: null };
    this.plane.vx = (this.tx - this.plane.x) / ((this.plane.z - this.tz) / 85) * 0.3;
    this.crate = null;
    this.team = [];
    this.lost = 0;
    this.track = new Set();
    E.say('drop', 'start', true);
    E.g.hud.alert('RESUPPLY INBOUND — WATCH FOR THE STROBE');
  }

  friendlies() {
    if (this.phase !== 'carry' || !this.crate) return [];
    return this.team.filter((u) => u.state !== 'down').map((u) => ({ x: u.x, z: u.z }));
  }

  /** The team opens the load: the crates, the straps and the pallet tumble apart where it stood. */
  breakCrate() {
    const E = this.E, c = this.crate, g = E.g;
    E.crate.visible = false;
    E.crate.updateMatrixWorld(true);
    for (const p of E.crateParts) {
      p.m.position.copy(p.home).applyMatrix4(E.crate.matrixWorld);
      p.m.rotation.set(p.rot.x, p.rot.y + c.yaw, p.rot.z);
      const out = p.m.position.clone().sub(E.crate.position); out.y = 0;
      if (out.lengthSq() < 1e-4) out.set(R() - 0.5, 0, R() - 0.5);
      out.normalize();
      p.v.set(out.x * rand(0.6, 1.8), rand(0.8, 2.2), out.z * rand(0.6, 1.8));
      p.w.set(rand(-4, 4), rand(-2, 2), rand(-4, 4));
      p.rest = false;
      p.m.visible = true;
    }
    g.fx.groundHit(c.x, c.z, false);
    g.audio.giantStep(c.x, c.z, 0.12);
    this.broken = true;
  }

  /** The loose parts fall, tumble and settle on the ground. */
  updateParts(dt) {
    for (const p of this.E.crateParts) {
      if (p.rest || !p.m.visible) continue;
      const m = p.m;
      p.v.y -= 9.8 * dt;
      m.position.addScaledVector(p.v, dt);
      m.rotation.x += p.w.x * dt; m.rotation.y += p.w.y * dt; m.rotation.z += p.w.z * dt;
      const gy = groundH(m.position.x, m.position.z) + 0.12;
      if (m.position.y < gy) {
        m.position.y = gy;
        if (Math.abs(p.v.y) < 1.2) {
          // settle flat on whichever face it landed on
          p.rest = true;
          const q = (a) => Math.round(a / (Math.PI / 2)) * (Math.PI / 2);
          m.rotation.x = q(m.rotation.x); m.rotation.z = q(m.rotation.z);
        } else { p.v.y *= -0.3; p.v.x *= 0.5; p.v.z *= 0.5; p.w.multiplyScalar(0.5); }
      }
    }
  }

  /** The recovery team comes out of the gate. */
  sendTeam() {
    const P = this.P;
    this.team = [];
    for (let k = 0; k < TEAM; k++) {
      const f = this.E.soldiers[TEAM_AT + k];
      dressSoldier(f);
      this.team.push({
        f, x: GATE.x + (k - 1.5) * 1.3, z: GATE.z - rand(0, 1.5), ph: R() * 6, yaw: Math.PI, state: 'out', t: 0,
        sp: rand(P.teamSpeed[0], P.teamSpeed[1]), shootT: rand(0.3, 0.8), slot: k, carrying: false,
      });
    }
    this.phase = 'out';
    this.E.g.hud.alert('RECOVERY TEAM IS OUT — COVER THEM');
  }

  update(dt) {
    const E = this.E, g = E.g, h = g.horde, fx = g.fx, P = this.P;
    this.t += dt;
    // aircraft
    const pl = this.plane;
    if (pl) {
      pl.x += pl.vx * dt; pl.z += pl.vz * dt;
      const grp = E.c130.group;
      grp.position.set(pl.x, pl.y, pl.z);
      grp.lookAt(pl.x + pl.vx, pl.y, pl.z + pl.vz);
      grp.updateMatrixWorld();
      for (const pr of E.c130.props) pr.rotation.z += dt * 40;
      _v.copy(E.c130.lights.port).applyMatrix4(grp.matrixWorld); fx.glowDot(_v.x, _v.y, _v.z, 3, 7, 0.4, 0.25, 0.05);
      _v.copy(E.c130.lights.stbd).applyMatrix4(grp.matrixWorld); fx.glowDot(_v.x, _v.y, _v.z, 3, 0.25, 5.5, 0.9, 0.05);
      if (!pl.loop && g.audio.ready) pl.loop = g.audio.loop(g.audio.B.prop && g.audio.B.prop[0], { ref: 150, reverb: 0.4 });
      if (pl.loop) pl.loop.update(pl.x, pl.y, pl.z, pl.vx, 0, pl.vz, 3);
      if (this.phase === 'inbound' && pl.z <= this.tz + 85 * 1.2) {
        this.phase = 'fall';
        this.crate = { x: pl.x, y: pl.y - 3, z: pl.z, vy: 0, t: 0, sx: pl.x, sz: pl.z, yaw: 0 };
        E.crate.visible = true;
        E.say('drop', 'away');
      }
      if (pl.z < -900) { if (pl.loop) pl.loop.stop(2); this.plane = null; E.c130.group.visible = false; }
    }
    const c = this.crate;
    if (!c) return false;
    if (this.phase === 'fall') {
      c.t += dt;
      const chute = c.t > 1.1;
      if (!chute) c.vy -= 9.8 * dt; else c.vy += (-8 - c.vy) * (1 - Math.exp(-3 * dt));
      c.y += c.vy * dt;
      const u = clamp(c.t / 14, 0, 1);
      c.x = lerp(c.sx, this.tx, Math.min(1, u * 1.6)); c.z = lerp(c.sz, this.tz, Math.min(1, u * 1.6));
      const gy = groundH(c.x, c.z);
      E.chute.visible = chute;
      if (chute) { E.chute.position.set(c.x, c.y + 0.5, c.z); E.chute.scale.setScalar(Math.min(1, (c.t - 1.1) * 2.5)); E.chute.rotation.set(0, c.t * 0.2, 0); }
      if (c.y <= gy + 0.5) {
        c.y = gy + 0.5; this.phase = 'hold'; c.t = 0;
        c.gx = c.x; c.gz = c.z;
        fx.groundHit(c.x, c.z, true);
        g.audio.giantStep(c.x, c.z, 0.4);
        E.say('drop', 'land', true);
        g.hud.alert('CRATE DOWN — KEEP THEM OFF IT UNTIL THE RECOVERY TEAM GETS THERE');
      }
    } else {
      c.t += dt;
      // the canopy collapses and drapes away
      if (E.chute.visible) {
        const k = Math.min(1, c.t / 2);
        E.chute.position.set(c.gx + k * 3, groundH(c.gx, c.gz) + 1 - k * 5.5, c.gz);
        E.chute.rotation.set(k * 1.3, 0, 0);
        if (k >= 1) E.chute.visible = false;
      }
      if (this.phase === 'hold' && c.t >= P.teamDelay) this.sendTeam();
      const r = this.updateTeam(dt);
      if (r !== null) return r;
      const onGround = this.phase !== 'carry';
      // the strobe draws them in; once the team is out they go for the men
      const near = h.queryRadius(c.x, c.z, P.pull, h._q);
      for (let k = 0; k < near; k++) this.track.add(h.id[h._q[k]]);
      const up = this.team.filter((u) => u.state !== 'down');
      for (const u of up) {
        const n = h.queryRadius(u.x, u.z, 12, h._q);
        for (let k = 0; k < n; k++) this.track.add(h.id[h._q[k]]);
      }
      let tearing = 0;
      for (let i = 0; i < h.n; i++) {
        if (h.dead[i] || !this.track.has(h.id[i])) continue;
        const dc = (h.x[i] - c.x) ** 2 + (h.z[i] - c.z) ** 2;
        let best = null, bd = onGround ? dc * 0.8 : 1e9;
        for (const u of up) { const d = (h.x[i] - u.x) ** 2 + (h.z[i] - u.z) ** 2; if (d < bd) { bd = d; best = u; } }
        if (best) { h.tgtX[i] = best.x; h.tgtZ[i] = best.z; } else {
          const a = (h.id[i] * 2.399) % 6.283;
          h.tgtX[i] = c.x + Math.cos(a) * 1.4; h.tgtZ[i] = c.z + Math.sin(a) * 1.4;
        }
        if (onGround && dc < 2.6 * 2.6) tearing++;
      }
      if (onGround) {
        this.integrity -= Math.min(P.maxTearing, tearing) * P.tear * dt;
        if (tearing && R() < dt * 6) fx.spark(c.x + rand(-0.6, 0.6), c.y + 0.4, c.z + rand(-0.6, 0.6), rand(-2, 2), rand(1, 3), rand(-2, 2), 4, 3, 2, 0.4);
        if (!this.hurtSaid && this.integrity < 60) { this.hurtSaid = true; E.say('drop', 'hurt', true); }
        if (this.integrity <= 0) return this.finish(false);
      }
    }
    if (this.broken) { this.updateParts(dt); return false; }
    // crate + strobe
    E.crate.position.set(c.x, c.y, c.z);
    if ((this.t % 0.9) < dt) {
      fx.glowDot(c.x, c.y + 0.8, c.z, 2.2, 14, 14, 16, 0.08);
      fx.lights.flash(c.x, c.y + 1.5, c.z, 0xe0ecff, 260, 40, 0.1);
    }
    return false;
  }

  /** Move, fight and pose the recovery team. Returns true/false to end the event, null to go on. */
  updateTeam(dt) {
    const E = this.E, g = E.g, h = g.horde, fx = g.fx, P = this.P, c = this.crate;
    if (!this.team.length) return null;
    const up = this.team.filter((u) => u.state !== 'down');
    // carrying: each man with a crate in his arms; c is the middle of the group, walking home
    if (this.phase === 'carry') {
      let dx = GATE.x - c.x, dz = GATE.z - c.z;
      const d = Math.hypot(dx, dz) || 1;
      dx /= d; dz /= d;
      const sp = P.carrySpeed[TEAM];
      walkStep(c, dx * sp, dz * sp, dt, 1.4);
      c.yaw = Math.atan2(dx, dz);
      if (c.z > GATE.z - 0.6 && Math.abs(c.x) < 6) return this.finish(true);
    }
    for (const u of this.team) {
      const f = u.f;
      u.t += dt;
      if (u.state === 'down') {
        f.die(u.t);
        continue;
      }
      let gx, gz, sp = u.sp;
      if (this.phase === 'out' || this.phase === 'rig') {
        const a = u.slot * 1.57 + 0.6, r = this.phase === 'rig' ? 1.15 : 1.5;
        gx = c.x + Math.cos(a) * r; gz = c.z + Math.sin(a) * r;
        if (this.phase === 'rig') sp = 2;
      } else {
        // two by two, a crate each
        const idx = up.indexOf(u);
        const fx_ = Math.sin(c.yaw), fz_ = Math.cos(c.yaw);
        const [side, ahead] = [[-0.9, 0.9], [0.9, 0.9], [-0.9, -1.1], [0.9, -1.1]][idx];
        gx = c.x + fz_ * side + fx_ * ahead; gz = c.z - fx_ * side + fz_ * ahead;
        sp = 4;
        u.carrying = true;
      }
      const dx = gx - u.x, dz = gz - u.z, dd = Math.hypot(dx, dz);
      const moving = dd > 0.25;
      // held off its place by a wreck or the crate itself: close enough once it stops getting closer
      if (this.phase === 'out') {
        if (dd < (u.best ?? 1e9) - 0.15) { u.best = dd; u.stall = 0; } else u.stall = (u.stall || 0) + dt;
      }
      if (moving) {
        const st = Math.min(dd, sp * dt);
        const wv = walkStep(u, dx / dd * st / dt, dz / dd * st / dt, dt, 0.4);
        u.yaw = this.phase === 'carry' ? c.yaw : Math.atan2(wv[0], wv[1]);
        u.ph += dt * Math.min(sp, 2 + dd * 4) * 2.1;
      } else if (this.phase === 'carry') {
        u.yaw = c.yaw;
        u.ph += dt * P.carrySpeed[TEAM] * 2.1;
      } else {
        // at the crate: face it and work the straps
        u.yaw = Math.atan2(c.x - u.x, c.z - u.z);
      }
      // the ones not carrying keep shooting
      if (!u.carrying) soldierFire(g, u, dt, 28, this.phase === 'rig' ? [0.12, 0.3] : [0.2, 0.45]);
      // caught
      if (u.t > 1 && h.queryRadius(u.x, u.z, P.catchR * f.root.scale.x, h._q) > 0) {
        u.state = 'down'; u.t = 0; u.carrying = false; this.lost++;
        this.dropLoad(u);
        g.audio.scream2(u.x, u.z);
        fx.headshot(u.x, groundH(u.x, u.z) + 1.3, u.z, 0, 0.3, 1);
        fx.blood(u.x, u.z, 1.4);
        if (g.run && g.inPlay()) { g.run.survivors = Math.max(0, g.run.survivors - 1); g.ns.lost++; }
        const left = this.team.filter((v) => v.state !== 'down').length;
        g.hud.alert(left ? `WE LOST ONE OF THE RECOVERY TEAM — ${left} LEFT` : 'THE RECOVERY TEAM IS GONE', 'red');
        if (!left) return this.finish(false);
        if (g.run && g.inPlay() && g.run.survivors <= 0) { const r = this.finish(false); g.fall(); return r; }
        continue;
      }
      // pose
      f.root.position.set(u.x, groundH(u.x, u.z), u.z);
      f.root.rotation.y = u.yaw;
      if (moving || this.phase === 'carry') poseRun(f, u.ph, u.carrying);
      else f.work(u.t); // bent over the crate
      this.placeLoad(u);
      fx.glowDot(u.x, groundH(u.x, u.z) + 1.72 * f.root.scale.x, u.z, 0.32, 0.4, 5, 0.8, 0.05);
    }
    if (this.phase === 'out' && up.every((u) => { const d = Math.hypot(u.x - c.x, u.z - c.z); return d < 2 || (d < 7 && u.stall > 1.2); })) {
      this.phase = 'rig'; this.rigT = P.rig;
      g.hud.alert('RECOVERY TEAM AT THE CRATE — RIGGING IT');
    } else if (this.phase === 'rig' && (this.rigT -= dt) <= 0) {
      this.phase = 'carry';
      c.yaw = Math.atan2(GATE.x - c.x, GATE.z - c.z);
      this.breakCrate();
      g.hud.alert('THEY HAVE THE CRATES — BRING THEM HOME');
    }
    return null;
  }

  /** A carrying man's crate, held between his hands. */
  placeLoad(u) {
    const m = this.E.loads[u.slot];
    if (!u.carrying) { m.visible = false; return; }
    const f = u.f;
    f.root.updateMatrixWorld(true);
    const l = f.bones.LeftHand, r = f.bones.RightHand;
    l.getWorldPosition(_v); r.getWorldPosition(_w3);
    m.position.addVectors(_v, _w3).multiplyScalar(0.5);
    m.position.y -= 0.16 * f.root.scale.x;
    m.rotation.set(0, u.yaw, 0);
    m.visible = true;
  }

  /** A man goes down: his crate falls where he stood. */
  dropLoad(u) {
    const m = this.E.loads[u.slot];
    if (!m.visible) return;
    m.position.y = groundH(m.position.x, m.position.z);
    m.rotation.set(0, m.rotation.y + rand(-0.6, 0.6), rand(-0.2, 0.2));
  }

  finish(ok) {
    const E = this.E, g = E.g, h = g.horde, c = this.crate, P = this.P;
    E.report('drop', 'end', { recovered: ok, integrity: Math.max(0, Math.round(this.integrity)), pulled: this.track.size, teamLost: this.lost });
    for (let i = 0; i < h.n; i++) if (this.track.has(h.id[i])) h.resetLane(i);
    E.crate.visible = false; E.chute.visible = false;
    for (const u of this.team) if (u.state !== 'down') { u.f.root.visible = false; E.loads[u.slot].visible = false; }
    if (ok) {
      // green smoke: recovered
      for (let k = 0; k < 12; k++) g.fx.smoke.spawn(c.x, c.y, c.z, rand(-1, 1), rand(1.5, 3), rand(-1, 1), rand(4, 7), 1, 6, PF.SMOKE + ((R() * 4) | 0), 0.05, 0.3, 0.08, 0.7, 0.02, 0.06, 0.02, -0.2, 0.4);
      const a = g.arsenal, run = g.run;
      a.grenadesLeft += P.reward.grenades;
      a.molotovsLeft += P.reward.molotovs;
      a.artyCd = 0;
      a.air.bomberCd = 0;
      const sup = Math.round(P.reward.supplies * (1 + 0.1 * (run.night - 1)));
      run.supplies += sup; g.ns.supplies += sup;
      E.say('drop', 'saved', true);
      g.hud.alert(`RESUPPLY: +${P.reward.grenades} GRENADES · +${P.reward.molotovs} MOLOTOVS · BATTERY & BOMBER READY · +${sup} SUPPLIES`);
      g.audio.uiBuy();
    } else {
      if (this.phase !== 'carry') g.fx.explosion(c.x, c.y - 0.5, c.z, 0.5, { fires: false, scorch: false });
      E.say('drop', 'lost', true);
      if (this.integrity <= 0) g.hud.alert('THE CRATE IS GONE', 'red');
    }
    this.done = true;
    return true;
  }

  end() {
    const E = this.E;
    E.crate.visible = false; E.chute.visible = false;
    for (const m of E.loads) m.visible = false;
    for (const p of E.crateParts) p.m.visible = false;
    E.crate.rotation.set(0, 0, 0);
    if (this.plane) { if (this.plane.loop) this.plane.loop.stop(1); this.plane = null; }
    E.c130.group.visible = false;
    // the fallen lie where they fell until the night is over
    for (const u of this.team) if (u.state !== 'down') u.f.root.visible = false;
  }

  objective() {
    const c = this.crate, up = this.team.filter((u) => u.state !== 'down');
    const integ = `CRATE ${Math.max(0, Math.round(this.integrity))}%`;
    if (this.phase === 'hold') {
      return { title: 'HOLD THE DROP ZONE', text: `RECOVERY TEAM OUT IN ${Math.max(0, Math.ceil(this.P.teamDelay - c.t))} S · ${integ}`, progress: this.integrity / 100, cls: this.integrity < 50 ? 'danger' : '' };
    }
    if (this.phase === 'out' || this.phase === 'rig') {
      const lead = up.reduce((m, u) => Math.min(m, Math.hypot(u.x - c.x, u.z - c.z)), 999);
      return { title: 'COVER THE RECOVERY TEAM', text: `${up.length} OF ${TEAM} · ${this.phase === 'rig' ? 'RIGGING THE CRATE' : `${Math.round(lead)} M TO THE CRATE`} · ${integ}`,
        progress: this.integrity / 100, cls: this.lost || this.integrity < 50 ? 'danger' : '' };
    }
    if (this.phase === 'carry') {
      const d = Math.hypot(c.x - GATE.x, c.z - GATE.z);
      return { title: 'BRING THEM HOME', text: `${up.length} OF ${TEAM} · ${Math.round(d)} M TO THE GATE`, progress: 1 - d / 95, cls: this.lost ? 'warn' : '' };
    }
    return { title: 'RESUPPLY INBOUND', text: this.phase === 'fall' ? 'CHUTE OPEN — WATCH WHERE IT LANDS' : 'C-130 ON APPROACH', progress: 1, cls: '' };
  }

  markers() {
    const c = this.crate;
    if (!c) return [];
    const out = [{ x: c.x, y: c.y + 2.2, z: c.z, label: this.phase === 'carry' ? '' : 'SUPPLY CRATE', cls: this.integrity < 50 ? 'danger' : 'objective' }];
    let first = true;
    for (const u of this.team) {
      if (u.state === 'down') continue;
      out.push({ x: u.x, y: groundH(u.x, u.z) + 2.4, z: u.z, label: first ? 'RECOVERY TEAM' : '', cls: 'friend' });
      first = false;
    }
    return out;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
class Giant {
  constructor(E, kind) { this.E = E; this.kind = kind; this.P = EVENTS[kind]; this.blocking = true; }

  start() {
    const { E, P } = this, g = E.g, h = g.horde;
    const side = R() < 0.5 ? -1 : 1;
    const x = side * rand(5, 30), z = -236;
    const i = h.spawn(ZT.GIANT, x, z, g.plan.hpMul * P.hpMul, 1, side);
    if (i < 0) { this.dead = true; return; }
    const sc = P.scale * rand(0.98, 1.03);
    h.scale[i] = sc;
    h.radius[i] = ZOMBIE_TYPES[ZT.GIANT].radius * sc;
    h.rate[i] = h.speed[i] * ZOMBIE_TYPES[ZT.GIANT].animK / sc;
    const lx = side * rand(14, 34);
    h.tgtX[i] = lx; h.tgtZ[i] = wallZ(lx) - 0.2;
    this.id = h.id[i]; this.maxHp = h.maxHp[i]; this.hp = this.maxHp; this.scale = sc;
    this.x = x; this.z = z; this.lastS = 0; this.roarT = 3; this.smashT = 1.2; this.smashes = 0; this.wallSaid = false;
    this.downT = -1; this.t = 0;
    h.onGiantWall = (j, sec, gx, gz, dt) => { if (h.id[j] === this.id) this.atWall(sec, gx, gz, dt); };
    g.arsenal.air.priority = () => (this.downT < 0 ? { x: this.x, z: this.z } : null);
    g.hud.announce(P.name, this.kind === 'behemoth' ? 'THE LAST ONE IS THE BIGGEST' : 'SOMETHING BIG IS COMING', 3.5, 'red');
    E.say(this.kind, 'start', true);
    if (g.arsenal.air.gs.active && !g.arsenal.air.holdFire) E.say(this.kind, 'spectre');
    g.audio.horn();
  }

  atWall(sec, x, z, dt) {
    const { E, P } = this, g = E.g, h = g.horde;
    if (!this.wallSaid) { this.wallSaid = true; E.say(this.kind, 'wall', true); }
    this.smashT -= dt;
    if (this.smashT > 0 || sec < 0) return;
    this.smashT = P.smash;
    this.smashes++;
    const wy = WORLD.WALL_H * 0.75;
    g.fx.explosion(x, wy, z + 0.6, 0.9, { fires: false, scorch: false });
    for (let k = 0; k < 8; k++) g.fx.gibs.spawn(x, wy, z + 0.6, rand(-5, 5), rand(4, 10), rand(1, 6), 0.3, 0.25, 0.3, 0.3, 0.29, 0.27, rand(3, 6), 0.2, 0);
    h.addRamp(x, 2.2, 7.6); // smashed concrete: a ramp the others climb
    g.audio.giantSmash(x, z);
    g.player.addTrauma(0.4);
    g.hud.alert('', 'red', { key: 'wallbreak', item: ['L5', 'L4', 'L3', 'L2', 'L1', 'R1', 'R2', 'R3', 'R4', 'R5'][sec], format: (s) => `${s.join(' · ')} — THE WALL IS BREAKING` });
    if (this.smashes % 2 === 0) g.onBreach(sec, x, WORLD.WALL_H, z, this.kind);
  }

  update(dt) {
    const { E } = this, g = E.g, h = g.horde;
    this.t += dt;
    if (this.downT >= 0) {
      this.downT += dt;
      if (this.downT > 0.95 && !this.landed) {
        // the body hits the ground
        this.landed = true;
        const fx = g.fx, s = this.scale / 4;
        const bx = this.x + Math.sin(this.yaw) * -3 * s, bz = this.z + Math.cos(this.yaw) * -3 * s;
        fx.explosion(bx, groundH(bx, bz), bz, 1.6 * s, { fires: false, light: false });
        g.audio.giantStep(bx, bz, 2.2);
        g.audio.explosion(bx, bz, 1.4);
        g.player.addTrauma(clamp(30 / (Math.hypot(bx, bz + 3) + 10), 0.15, 0.8));
      }
      return this.downT > 3;
    }
    const i = h.indexOf(this.id);
    if (i < 0) {
      // dead
      this.downT = 0;
      g.arsenal.air.priority = null;
      E.report(this.kind, 'end', { killed: true, seconds: Math.round(this.t), smashes: this.smashes, reachedWall: this.wallSaid });
      E.say(this.kind, 'down', true);
      g.hud.carnage(`${this.P.name} DOWN`, 'big red');
      g.slowmo = Math.max(g.slowmo, 0.9); g.radial = 1;
      return false;
    }
    this.x = h.x[i]; this.z = h.z[i]; this.hp = h.hp[i]; this.yaw = h.yaw[i];
    // footfalls in step with the shader's gait
    const s = Math.sign(Math.sin(g.time * h.rate[i] + h.phase[i]));
    if (s !== this.lastS && this.lastS !== 0) {
      const d = Math.hypot(this.x - WORLD.CAM.x, this.z - WORLD.CAM.z);
      const k = this.scale / 4;
      g.audio.giantStep(this.x, this.z, k);
      g.player.addTrauma(clamp(6 * k / (d + 12), 0, 0.25));
      const fx = g.fx, gy = groundH(this.x, this.z);
      for (let n = 0; n < 6; n++) {
        const a = R() * 6.28;
        fx.smoke.spawn(this.x + Math.cos(a) * 1.5 * k, gy + 0.3, this.z + Math.sin(a) * 1.5 * k, Math.cos(a) * 4, rand(0.3, 1), Math.sin(a) * 4, rand(1.5, 2.5), 1.2 * k, 4 * k, PF.SMOKE + ((R() * 4) | 0), 0.08, 0.07, 0.06, 0.5, 0.04, 0.04, 0.035, -0.1, 1.5);
      }
    }
    this.lastS = s;
    this.roarT -= dt;
    if (this.roarT <= 0) { this.roarT = rand(7, 13); g.audio.giantRoar(this.x, this.z, this.scale / 4); }
    return false;
  }

  end() {
    const g = this.E.g;
    if (g.horde.onGiantWall) g.horde.onGiantWall = null;
    g.arsenal.air.priority = null;
  }

  boss() { return this.downT < 0 && this.id ? { name: this.P.name, hp: this.hp / this.maxHp } : null; }

  markers() {
    if (this.downT >= 0 || !this.id) return [];
    const d = Math.hypot(this.x - WORLD.CAM.x, this.z - WORLD.CAM.z);
    if (d < 45) return [];
    return [{ x: this.x, y: groundH(this.x, this.z) + this.scale * 1.8 + 2, z: this.z, label: this.P.name, cls: 'danger' }];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
/** A crowd of one type that arrives together (brute stampede, bloater column). */
class Wave {
  constructor(E, kind) { this.E = E; this.kind = kind; this.P = EVENTS[kind]; this.blocking = false; }

  start() {
    const { E, P } = this, g = E.g, h = g.horde, plan = g.plan;
    this.ids = new Set();
    this.t = 0;
    const add = (i) => { if (i >= 0) this.ids.add(h.id[i]); };
    if (this.kind === 'stampede') {
      const side = R() < 0.5 ? -1 : 1;
      const n = P.brutes + Math.max(0, g.run.night - 6) * 2;
      for (let k = 0; k < n; k++) add(h.spawn(ZT.BRUTE, side * rand(35, 110), rand(-245, -212), plan.hpMul, plan.speedMul * P.speed, side));
      for (let k = 0; k < P.runners; k++) h.spawn(ZT.RUNNER, side * rand(35, 110), rand(-245, -212), plan.hpMul, plan.speedMul, side);
      E.say('stampede', side < 0 ? 'left' : 'right', true);
      g.hud.alert(`BRUTE STAMPEDE — ${side < 0 ? 'LEFT' : 'RIGHT'} FLANK`, 'red');
      this.title = 'BRUTE STAMPEDE';
    } else {
      const n = P.count + Math.max(0, g.run.night - 9) * 4;
      for (let k = 0; k < n; k++) add(h.spawn(ZT.BLOATER, rand(-9, 9), -200 - k * 1.6 - rand(0, 3), plan.hpMul, plan.speedMul * 1.1));
      E.say('bloaters', 'start', true);
      g.hud.alert('BLOATER COLUMN ON THE ROAD', 'red');
      this.title = 'BLOATER COLUMN';
    }
    this.total = this.ids.size;
    g.audio.horn();
  }

  update(dt) {
    const h = this.E.g.horde;
    this.t += dt;
    let alive = 0;
    for (let i = 0; i < h.n; i++) if (!h.dead[i] && this.ids.has(h.id[i])) alive++;
    this.alive = alive;
    if (alive === 0 || this.t > 120) { this.E.report(this.kind, 'end', { total: this.total, left: alive, seconds: Math.round(this.t) }); return true; }
    return false;
  }

  end() {}
  objective() { return { title: this.title, text: `${this.alive ?? this.total} OF ${this.total} LEFT`, progress: (this.alive ?? this.total) / Math.max(1, this.total), cls: 'warn' }; }
}

// ─────────────────────────────────────────────────────────────────────────────
// A fuel tanker stalled on the road. The night's crowd comes down past it; a
// burst through the tank turns it, and everyone around it, into a fireball.
class Tanker {
  constructor(E) { this.E = E; this.P = EVENTS.tanker; this.blocking = true; }

  start() {
    const { E, P } = this, g = E.g, h = g.horde, plan = g.plan;
    const T = E.tanker;
    this.x = rand(-6, 6); this.z = rand(P.z[0], P.z[1]);
    this.yaw = rand(-0.5, 0.5) + Math.PI / 2;
    T.position.set(this.x, groundH(this.x, this.z) - 0.05, this.z);
    T.rotation.set(0, this.yaw, rand(-0.03, 0.03));
    T.visible = true;
    T.updateMatrixWorld(true);
    this.box = new THREE.Box3().setFromObject(T);
    if (E.tankerSolid) removeObstacle(E.tankerSolid);
    E.tankerSolid = addObstacle(this.x, this.z, this.yaw, TRUCK_SIZE[0], TRUCK_SIZE[1]);
    this.hp = P.hp; this.t = 0; this.state = 'wait'; this.leak = 0;
    // the crowd that will walk past it
    this.ids = new Set();
    const n = P.crowd + 6 * Math.max(0, g.run.night - 2);
    for (let k = 0; k < n; k++) {
      const i = h.spawn(R() < 0.85 ? ZT.SHAMBLER : ZT.RUNNER, this.x + rand(-14, 14), -205 - rand(0, 40), plan.hpMul, plan.speedMul);
      if (i >= 0) this.ids.add(h.id[i]);
    }
    this.target = { test: (o, d, maxT) => (this.state === 'wait' ? rayBox(o, d, this.box, maxT) : -1), hit: (p) => this.hit(p) };
    g.player.shootables.push(this.target);
    E.say('tanker', 'start', true);
    g.hud.alert('FUEL TANKER ON THE ROAD — SHOOT IT WHEN THEY CROWD AROUND IT');
  }

  hit(p) {
    const g = this.E.g;
    this.hp--;
    g.fx.spark(p.x, p.y, p.z, rand(-2, 2), rand(1, 3), rand(-2, 2), 6, 4, 2, 0.4);
    if (R() < 0.3) g.audio.wallGun && g.audio.crackle(p.x, p.z, 0.2);
    // a punctured tank spits burning fuel before it goes
    if (this.hp < this.P.hp * 0.6) this.leak = 1;
    if (this.hp <= 0) this.explode();
  }

  explode() {
    const { E, P } = this, g = E.g, a = g.arsenal;
    this.state = 'boom';
    const x = this.x, z = this.z, gy = groundH(x, z);
    E.tanker.visible = false;
    E.tankerWreck.position.copy(E.tanker.position); E.tankerWreck.rotation.copy(E.tanker.rotation); E.tankerWreck.visible = true;
    g.fx.bigExplosion(x, gy + 2, z, 1.1);
    g.audio.bigBlast(x, z);
    const kills = a.detonate(x, gy + 1, z, 2.2, P.radius, P.damage, 'tanker');
    // the fuel goes everywhere and burns
    a.firePool(x, z, P.fireRadius, P.fireBurn);
    for (const [dx, dz] of [[8, 3], [-7, 5], [3, -8], [-4, -6]]) a.firePool(x + dx, z + dz, P.fireRadius * 0.55, P.fireBurn * 0.8);
    this.kills = kills;
    E.say('tanker', 'boom', true);
    g.hud.alert(`TANKER DETONATED — ${kills} KILLED`);
    this.boomT = 0;
  }

  update(dt) {
    const { E, P } = this, g = E.g, h = g.horde;
    this.t += dt;
    if (this.state === 'wait') {
      if (this.leak) {
        const gy = groundH(this.x, this.z);
        if (R() < dt * 30) g.fx.flame(this.x + rand(-1.5, 1.5), gy + 1.5, this.z + rand(-1.5, 1.5), 0.9, 2.6);
        this.hp -= dt * 0.8; // it will go on its own soon
        if (this.hp <= 0) this.explode();
      }
      // the road crowd walks straight past it
      for (let i = 0; i < h.n; i++) if (!h.dead[i] && this.ids.has(h.id[i]) && h.z[i] < this.z - 6) { h.tgtX[i] = this.x + ((h.id[i] * 1.618) % 1 - 0.5) * 16; h.tgtZ[i] = this.z + 30; }
      if (this.t > P.timeout) {
        this.E.report('tanker', 'end', { blown: false, kills: 0 });
        E.say('tanker', 'wasted');
        return true;
      }
      return false;
    }
    this.boomT += dt;
    if (this.boomT > 2) {
      this.E.report('tanker', 'end', { blown: true, kills: this.kills });
      return true;
    }
    return false;
  }

  end() {
    const g = this.E.g;
    const k = g.player.shootables.indexOf(this.target);
    if (k >= 0) g.player.shootables.splice(k, 1);
    this.E.tanker.visible = false;
    for (let i = 0; i < g.horde.n; i++) if (this.ids.has(g.horde.id[i])) g.horde.resetLane(i);
  }

  objective() {
    if (this.state !== 'wait') return null;
    const near = this.E.g.horde.countNear(this.x, this.z, this.P.radius);
    return { title: 'FUEL TANKER', text: `${near} AROUND IT · ${this.leak ? 'IT IS LEAKING — ' : ''}SHOOT THE TANK`, progress: Math.max(0, this.hp / this.P.hp), cls: this.leak ? 'danger' : '' };
  }

  markers() {
    if (this.state !== 'wait') return [];
    return [{ x: this.x, y: groundH(this.x, this.z) + 4.5, z: this.z, label: 'FUEL TANKER', cls: 'objective' }];
  }
}

/** Distance along a ray (o + d t) to an axis-aligned box, or -1. */
function rayBox(o, d, b, maxT) {
  let t0 = 0, t1 = maxT;
  for (const k of ['x', 'y', 'z']) {
    const inv = 1 / (d[k] || 1e-9);
    let a = (b.min[k] - o[k]) * inv, c = (b.max[k] - o[k]) * inv;
    if (a > c) { const s = a; a = c; c = s; }
    t0 = Math.max(t0, a); t1 = Math.min(t1, c);
    if (t0 > t1) return -1;
  }
  return t0;
}

// ─────────────────────────────────────────────────────────────────────────────
// A truck full of survivors runs the road to the gate. The dead in front of it
// slow it down; the ones that reach it tear at it. Clear the road.
class Convoy {
  constructor(E) { this.E = E; this.P = EVENTS.convoy; this.blocking = true; }

  start() {
    const { E, P } = this, g = E.g, h = g.horde, plan = g.plan;
    this.x = rand(-3, 3); this.z = -235; this.hp = 100; this.t = 0; this.state = 'drive'; this.sp = P.speed; this.yaw = 0;
    const T = E.truck;
    T.visible = true;
    this.track = new Set();
    // a crowd on the road ahead, runners behind
    for (let k = 0; k < P.blockers + 4 * Math.max(0, g.run.night - 6); k++) {
      const i = h.spawn(ZT.SHAMBLER, rand(-8, 8), rand(-170, -60), plan.hpMul, plan.speedMul * 0.8);
      if (i >= 0) { h.fadeIn[i] = 0; }
    }
    for (let k = 0; k < P.chasers; k++) {
      const i = h.spawn(ZT.RUNNER, this.x + rand(-10, 10), this.z - rand(15, 40), plan.hpMul, plan.speedMul);
      if (i >= 0) { this.track.add(h.id[i]); h.fadeIn[i] = 0; }
    }
    this.loop = null;
    E.say('convoy', 'start', true);
    E.say('convoy', 'follow');
    g.hud.alert('SURVIVOR TRUCK ON THE ROAD — CLEAR A PATH');
  }

  friendlies() { return this.state === 'drive' ? [{ x: this.x, z: this.z }] : []; }

  update(dt) {
    const { E, P } = this, g = E.g, h = g.horde, fx = g.fx;
    this.t += dt;
    const T = E.truck;
    if (this.state === 'drive') {
      // what's on the road in front slows it; what's touching it tears at it
      let ahead = 0, touching = 0;
      const n = h.queryRadius(this.x, this.z + 4, 6, h._q);
      for (let k = 0; k < n; k++) { const j = h._q[k]; if (h.z[j] > this.z + 1) ahead += h.weight[j]; }
      const m = h.queryRadius(this.x, this.z, 3.4, h._q);
      for (let k = 0; k < m; k++) { touching++; this.track.add(h.id[h._q[k]]); }
      const want = P.speed / (1 + ahead * 0.45);
      this.sp += (want - this.sp) * Math.min(1, dt * 2);
      // ploughing through: the ones it hits go under the wheels
      if (this.sp > 2) for (let k = 0; k < n; k++) { const j = h._q[k]; if (Math.abs(h.x[j] - this.x) < 1.4 && h.z[j] > this.z + 2.5 && h.z[j] < this.z + 4.2) h.damage(j, 400 * dt * this.sp, 'truck', 0, 0.3, 1); }
      this.hp -= Math.min(P.maxTearing, touching) * P.tear * dt;
      let dx = GATE.x - this.x, dz = GATE.z - this.z;
      const d = Math.hypot(dx, dz) || 1;
      // the driver swerves round the wrecks on the road
      steer(this.x + Math.sin(this.yaw) * 3, this.z + Math.cos(this.yaw) * 3, dx / d * this.sp, dz / d * this.sp, 1.6, _w2, 1);
      const head = Math.atan2(_w2[0], _w2[1]);
      let dyaw = head - this.yaw; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      this.yaw += dyaw * Math.min(1, dt * 3);
      this.x += Math.sin(this.yaw) * this.sp * dt; this.z += Math.cos(this.yaw) * this.sp * dt;
      for (let i = 0; i < h.n; i++) if (!h.dead[i] && this.track.has(h.id[i])) { h.tgtX[i] = this.x; h.tgtZ[i] = this.z; }
      if (touching && R() < dt * 5) fx.spark(this.x + rand(-1, 1), groundH(this.x, this.z) + 1.5, this.z + rand(-2, 2), rand(-2, 2), rand(1, 3), rand(-2, 2), 4, 3, 2, 0.4);
      // headlights
      const gy = groundH(this.x, this.z);
      const L = URAL_LAMPS;
      for (const s of [-L.side, L.side]) fx.glowDot(this.x + Math.cos(this.yaw) * s + Math.sin(this.yaw) * L.x, gy + L.y, this.z - Math.sin(this.yaw) * s + Math.cos(this.yaw) * L.x, 0.7, 6, 5.5, 4, 0.05);
      if (!this.loop && g.audio.ready && g.audio.B.prop) this.loop = g.audio.loop(g.audio.B.prop[0], { ref: 30, rate: 0.45 });
      if (this.loop) this.loop.update(this.x, gy + 1, this.z, 0, 0, this.sp, 1.2);
      if (this.hp <= 0) return this.finish(false);
      if (this.z > GATE.z - 1.5 && Math.abs(this.x) < 6) return this.finish(true);
    }
    T.position.set(this.x, groundH(this.x, this.z), this.z);
    // the truck's nose is +x: face it down the road
    T.rotation.set(0, this.yaw - Math.PI / 2, Math.sin(this.t * 9) * 0.01 * this.sp);
    return false;
  }

  finish(ok) {
    const { E, P } = this, g = E.g, h = g.horde;
    E.report('convoy', 'end', { saved: ok, hp: Math.max(0, Math.round(this.hp)), seconds: Math.round(this.t) });
    for (let i = 0; i < h.n; i++) if (this.track.has(h.id[i])) h.resetLane(i);
    if (ok) {
      const run = g.run;
      run.survivors += P.reward.survivors;
      const sup = P.reward.supplies;
      run.supplies += sup; g.ns.supplies += sup;
      E.say('convoy', 'saved', true);
      g.hud.alert(`THE TRUCK IS IN · +${P.reward.survivors} ON THE WALL · +${sup} SUPPLIES`);
      E.truck.visible = false;
    } else {
      // it stops where it died, and burns
      g.fx.explosion(this.x, groundH(this.x, this.z) + 1.5, this.z, 0.7, { scorch: true });
      g.arsenal.firePool(this.x, this.z, 3.5, 25);
      E.say('convoy', 'lost', true);
      g.hud.alert('THE TRUCK IS DOWN — THEY GOT THEM', 'red');
    }
    this.done = true;
    return true;
  }

  end() {
    if (this.loop) { this.loop.stop(1); this.loop = null; }
    if (!this.done || this.hp > 0) this.E.truck.visible = false;
  }

  objective() {
    const d = Math.hypot(this.x - GATE.x, this.z - GATE.z);
    return { title: 'SURVIVOR TRUCK', text: `${Math.round(d)} M TO THE GATE · TRUCK ${Math.max(0, Math.round(this.hp))}%${this.sp < this.P.speed * 0.4 ? ' · ROAD BLOCKED' : ''}`,
      progress: Math.max(0, this.hp) / 100, cls: this.hp < 50 ? 'danger' : '' };
  }

  markers() { return [{ x: this.x, y: groundH(this.x, this.z) + 4.2, z: this.z, label: 'TRUCK', cls: this.hp < 50 ? 'danger' : 'friend' }]; }
}

// ─────────────────────────────────────────────────────────────────────────────
// They find the way round: down the mountain at the end of a wing, right onto the
// last section of wall, where nobody was looking. They show up high on the open
// slope, pick their way down to the foot of the rocks (slowly where it is steep,
// kicking stones loose), then run for the end of the wall.
const wallLine = (ax) => wallZ(Math.min(ax, WORLD.WING_END)); // z of the wall line, carried on past the wing end
class Cliffs {
  constructor(E) { this.E = E; this.P = EVENTS.cliffs; this.blocking = false; }

  /** A spot on the open mountainside, P.high[0]..P.high[1] m up. */
  slopePoint() {
    const { P } = this;
    for (let k = 0; k < 40; k++) {
      const ax = rand(P.spawnX[0], P.spawnX[1]), z = wallLine(ax) - rand(P.spawnOut[0], P.spawnOut[1]);
      const y = groundH(this.side * ax, z);
      if (y > P.high[0] && y < P.high[1]) return [this.side * ax, z];
    }
    return [this.side * 110, wallLine(110) - 35];
  }

  /** Where the slope meets the valley floor, clear of the boulders at the foot of the face. */
  footPoint() {
    for (let k = 0; k < 30; k++) {
      const ax = rand(82, 94), z = wallLine(ax) - rand(20, 34);
      if (groundH(this.side * ax, z) < 1.2) return [this.side * ax, z];
    }
    return [this.side * 86, wallLine(86) - 28];
  }

  start() {
    const { E, P } = this, g = E.g;
    this.side = R() < 0.5 ? -1 : 1;
    this.left = P.count + 8 * Math.max(0, g.run.night - 3);
    this.total = this.left;
    this.t = 0; this.acc = 0;
    this.ids = new Set();
    this.walk = new Map(); // id -> { foot: [x, z], base: speed, down: still on the mountain }
    E.say('cliffs', this.side < 0 ? 'left' : 'right', true);
    g.hud.alert(`THEY'RE COMING OVER THE ROCKS — ${this.side < 0 ? 'LEFT' : 'RIGHT'} WING`, 'red');
  }

  update(dt) {
    const { E, P } = this, g = E.g, h = g.horde, plan = g.plan;
    this.t += dt;
    this.acc += dt * this.total / P.over;
    while (this.acc >= 1 && this.left > 0) {
      this.acc -= 1; this.left--;
      const [x, z] = this.slopePoint();
      const i = h.spawn(R() < 0.7 ? ZT.RUNNER : ZT.SHAMBLER, x, z, plan.hpMul, plan.speedMul);
      if (i >= 0) {
        this.ids.add(h.id[i]);
        // (spawn() leaves them emerging out of the dark, not popping in)
        const foot = this.footPoint();
        this.walk.set(h.id[i], { foot, base: h.speed[i], down: true });
        h.tgtX[i] = foot[0]; h.tgtZ[i] = foot[1];
      }
    }
    let alive = 0;
    for (let i = 0; i < h.n; i++) {
      if (h.dead[i] || !this.ids.has(h.id[i])) continue;
      alive++;
      const w = this.walk.get(h.id[i]);
      if (!w || !w.down) continue;
      const x = h.x[i], z = h.z[i], y = groundH(x, z);
      if (y < 1.5 || Math.hypot(w.foot[0] - x, w.foot[1] - z) < 3) {
        // off the mountain: now for the end of the wall
        w.down = false; h.speed[i] = w.base;
        h.tgtX[i] = this.side * rand(58, 70); h.tgtZ[i] = wallZ(h.tgtX[i]) + 0.5;
        continue;
      }
      // how steep it is where they're going: a scramble, not a sprint, down the steep parts
      const dx = w.foot[0] - x, dz = w.foot[1] - z, d = Math.hypot(dx, dz) || 1;
      const drop = (y - groundH(x + dx / d * 1.5, z + dz / d * 1.5)) / 1.5;
      h.speed[i] = w.base * clamp(1.05 - Math.abs(drop) * P.steepSlow, 0.55, 1);
      // loose stones and dust where they slip
      if (Math.abs(drop) > 0.6 && R() < dt * 0.35) g.fx.groundHit(x, z);
    }
    this.alive = alive;
    if (this.left === 0 && (alive === 0 || this.t > P.over + 60)) { E.report('cliffs', 'end', { total: this.total, left: alive }); return true; }
    return false;
  }

  end() {}
  objective() { return { title: `OVER THE ROCKS — ${this.side < 0 ? 'LEFT' : 'RIGHT'}`, text: `${this.alive ?? 0} ON THE FLANK${this.left ? ` · ${this.left} MORE COMING` : ''}`, progress: 1 - this.t / (this.P.over + 20), cls: 'warn' }; }
}

// ─────────────────────────────────────────────────────────────────────────────
class FogBank {
  constructor(E) { this.E = E; this.P = EVENTS.fog; this.blocking = false; }
  start() {
    this.t = 0; this.saidSpectre = false;
    this.E.say('fog', 'start', true);
  }
  update(dt) {
    const g = this.E.g, P = this.P;
    this.t += dt;
    const k = Math.min(1, this.t / 9) * clamp((P.duration - this.t) / 10, 0, 1);
    g.env.fogBank = k;
    const air = g.arsenal.air;
    if (!this.saidSpectre && this.t > 7 && air.gs.active) { this.saidSpectre = true; this.E.say('fog', 'spectre'); }
    air.holdFire = this.t > 7 && this.t < P.duration - 6;
    if (this.t >= P.duration) { this.E.say('fog', 'clear', true); this.E.report('fog', 'end'); return true; }
    return false;
  }
  end() { this.E.g.env.fogBank = 0; this.E.g.arsenal.air.holdFire = false; }
  objective() { return this.t > 5 && this.t < this.P.duration - 5 ? { title: 'FOG BANK', text: 'VISIBILITY NEAR ZERO — SPECTRE IS BLIND', progress: 1 - this.t / this.P.duration, cls: '' } : null; }
}

class Blackout {
  constructor(E) { this.E = E; this.P = EVENTS.blackout; this.blocking = false; }
  start() {
    const g = this.E.g;
    this.t = 0; this.restored = false; this.saidSpectre = false;
    g.audio.powerDown();
    this.E.say('blackout', 'start', true);
    g.hud.alert('GENERATOR DOWN — LIGHTS OUT', 'red');
  }
  power(p) {
    const g = this.E.g;
    g.env.power = p;
    g.player.nestLight.intensity = 1.6 * p;
    g.audio.lampPower = p;
  }
  update(dt) {
    const g = this.E.g, P = this.P;
    this.t += dt;
    if (this.t < 1.4) this.power(R() < 0.5 * (1 - this.t / 1.4) ? 1 : 0.08 * R());
    else if (this.t < P.duration) this.power(0);
    else if (this.t < P.duration + 1.2) {
      if (!this.restored) { this.restored = true; g.audio.powerUp(); }
      this.power(R() < (this.t - P.duration) / 1.2 ? 1 : 0);
    } else {
      this.power(1);
      this.E.say('blackout', 'restored', true);
      this.E.report('blackout', 'end');
      return true;
    }
    if (!this.saidSpectre && this.t > 4 && g.arsenal.air.gs.active) { this.saidSpectre = true; this.E.say('blackout', 'spectre'); }
    return false;
  }
  end() { this.power(1); }
  objective() { return this.t < this.P.duration ? { title: 'BLACKOUT', text: `GENERATOR BACK IN ${Math.ceil(this.P.duration - this.t)} S`, progress: 1 - this.t / this.P.duration, cls: 'warn' } : null; }
}

class GunshipDown {
  constructor(E) { this.E = E; this.blocking = true; }
  start() {
    const g = this.E.g, air = g.arsenal.air;
    if (!air.crash()) { this.done = true; return; }
    this.E.say('gunshipDown', 'start', true);
    g.hud.alert('SPECTRE IS GOING DOWN', 'red');
    air.onCrash = (x, y, z) => {
      g.fx.bigExplosion(x, y, z, 1.3);
      g.audio.bigBlast(x, z);
      g.hud.announce(`${CALL.spectre} IS DOWN`, '', 4, 'red');
      this.done = true;
      this.E.report('gunshipDown', 'end');
      this.E.say('gunshipDown', 'down');
    };
  }
  update() { return !!this.done; }
  end() { this.E.g.arsenal.air.onCrash = null; }
}

// ─────────────────────────────────────────────────────────────────────────────
const _v = new THREE.Vector3(), _w3 = new THREE.Vector3();

export class NightEvents {
  constructor(game) {
    this.g = game;
    this.queue = [];
    this.active = [];
    const scene = game.scene;
    this.people = [];
    // the civilians on the road: four adults, then two children (the escort takes the first six)
    for (const m of ['man', 'woman', 'man2', 'woman', 'child', 'child', 'man', 'man2']) { const p = new Survivor(m); scene.add(p.root); this.people.push(p); }
    // our soldiers in the field: the patrol (0-3), the recovery team (4-7) and the gate squad (8-11)
    this.soldiers = [];
    for (let k = 0; k < 12; k++) { const s = new Soldier(); scene.add(s.root); this.soldiers.push(s); }
    this.cover = new GateCover(this);
    // supply drop: aircraft, crate and parachute
    this.c130 = buildGunship();
    this.c130.group.scale.setScalar(1.5);
    this.c130.group.visible = false;
    scene.add(this.c130.group);
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x4a4f36, roughness: 0.85 });
    const strap = new THREE.MeshStandardMaterial({ color: 0x1c1d18, roughness: 0.9 });
    // the load: ammunition crates stacked two wide and three high on a pallet, strapped down
    this.crate = new THREE.Group();
    const pallet = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 1.15), crateMat); pallet.position.y = -0.5; this.crate.add(pallet);
    for (let r = 0; r < 3; r++) for (const z of [-0.28, 0.28]) {
      const c = cloneModel('mcrate'); // the weapons crates the team carries home, stacked
      c.scale.setScalar(1.6);
      c.position.set((R() - 0.5) * 0.04, -0.45 + r * 0.39, z);
      c.rotation.y = (R() - 0.5) * 0.04;
      c.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.crate.add(c);
    }
    for (const x of [-0.45, 0.45]) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.24, 1.18), strap); s.position.set(x, 0.12, 0); this.crate.add(s); }
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 4, 5) }));
    lamp.position.y = 0.78; this.crate.add(lamp);
    this.crate.visible = false;
    scene.add(this.crate);
    // the same load as loose parts: when the team breaks it open, it falls apart where it lies
    this.crateParts = [];
    for (const o of [...this.crate.children]) {
      const m = o.clone(true);
      m.visible = false;
      scene.add(m);
      this.crateParts.push({ m, home: o.position.clone(), rot: o.rotation.clone(), v: new THREE.Vector3(), w: new THREE.Vector3(), rest: false });
    }
    // and what each man carries home: a weapons crate in his arms
    this.loads = Array.from({ length: 4 }, () => {
      const m = cloneModel('mcrate');
      m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      m.visible = false;
      scene.add(m);
      return m;
    });
    this.chute = new THREE.Group();
    const canopy = new THREE.Mesh(new THREE.SphereGeometry(4.2, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2.4),
      new THREE.MeshStandardMaterial({ color: 0x6f6c56, roughness: 0.95, side: THREE.DoubleSide }));
    canopy.scale.y = 0.55; canopy.position.y = 8;
    this.chute.add(canopy);
    const pts = [];
    for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; pts.push(Math.cos(a) * 3.6, 9.1, Math.sin(a) * 3.6, 0, 0.1, 0); }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.chute.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x2a2a24 })));
    this.chute.visible = false;
    scene.add(this.chute);
    // the fuel tanker (and what is left of it) and the survivors' truck
    const mats = game.env.mats;
    const tankerParts = (burnt) => {
      // a Ural with its canvas off and a fuel tank on the bed (burnt: the wreck, the tank scorched)
      const t = makeUral({ burnt, covered: false });
      const B = URAL_BED, r = 1.0, y = B.y + r;
      t.add(new THREE.Mesh(cylX(r, B.len - 0.1, 18, B.x, y, 0), burnt ? mats.burnt : (mats.steel || mats.darkSteel)));
      for (const x of [B.x - B.len / 2 + 0.1, B.x + B.len / 2 - 0.1]) t.add(new THREE.Mesh(cylX(r + 0.03, 0.12, 18, x, y, 0), mats.darkSteel));
      t.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      t.visible = false;
      scene.add(t);
      return t;
    };
    this.tanker = tankerParts(false);
    this.tankerWreck = tankerParts(true);
    this.truck = makeUral({ covered: true });
    this.truck.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.truck.visible = false;
    scene.add(this.truck);
  }

  /** Schedule tonight's events. */
  start(night, endless) {
    this.reset();
    this.log = []; // what happened tonight, for the chronicle at dawn
    const plan = endless
      ? [[pickOne(ENDLESS_EVENTS), rand(0.22, 0.32)], [pickOne(ENDLESS_EVENTS), rand(0.55, 0.65)]]
      : (NIGHT_EVENTS[night] || []);
    this.queue = plan.map(([kind, at]) => ({ kind, at }));
    if (endless && this.queue.length === 2 && this.queue[0].kind === this.queue[1].kind) this.queue.pop();
  }

  /** Fire an event now (also used by the test hooks). */
  trigger(kind) {
    let e;
    switch (kind) {
      case 'patrol': case 'civilians': e = new Escort(this, kind); break;
      case 'drop': e = new SupplyDrop(this); break;
      case 'giant': case 'behemoth': e = new Giant(this, kind); break;
      case 'stampede': case 'bloaters': e = new Wave(this, kind); break;
      case 'fog': e = new FogBank(this); break;
      case 'blackout': e = new Blackout(this); break;
      case 'gunshipDown': e = new GunshipDown(this); break;
      case 'tanker': e = new Tanker(this); break;
      case 'convoy': e = new Convoy(this); break;
      case 'cliffs': e = new Cliffs(this); break;
      default: return null;
    }
    // one escort / one drop at a time: the props are shared
    if (this.active.some((a) => a.constructor === e.constructor && (e instanceof Escort || e instanceof SupplyDrop || e instanceof Tanker || e instanceof Convoy))) return null;
    e.kind = e.kind || kind;
    e.start();
    this.active.push(e);
    this.report(kind, 'start');
    return e;
  }

  reset() {
    for (const e of this.active) e.end();
    this.active.length = 0;
    for (const p of [...this.people, ...this.soldiers]) p.root.visible = false; // the fallen from last night
    if (this.cover) this.cover.reset();
    if (this.tankerWreck) { this.tankerWreck.visible = false; this.tanker.visible = false; this.truck.visible = false; }
    if (this.tankerSolid) { removeObstacle(this.tankerSolid); this.tankerSolid = null; }
    this.queue.length = 0;
    const g = this.g;
    g.env.power = 1; g.env.fogBank = 0;
    g.audio.lampPower = 1;
    if (g.player.nestLight) g.player.nestLight.intensity = 1.6;
  }

  /** True while an event still needs the night to go on (escort running, giant alive...). */
  get busy() { return this.queue.length > 0 || this.active.some((e) => e.blocking); }

  update(dt) {
    const d = this.g.director;
    const frac = d.plan ? d.t / d.plan.duration : 0;
    for (let k = 0; k < this.queue.length; k++) {
      if (frac >= this.queue[k].at) { const q = this.queue.splice(k, 1)[0]; k--; this.trigger(q.kind); }
    }
    for (let k = 0; k < this.active.length; k++) {
      const e = this.active[k];
      if (e.done || e.update(dt)) { e.end(); this.active.splice(k, 1); k--; }
    }
    // anyone of ours coming in gets the gate squad
    const friends = [];
    for (const e of this.active) if (e.friendlies) friends.push(...e.friendlies());
    this.cover.update(dt, friends);
  }

  /** Play-test telemetry for an event (start / outcome). */
  report(kind, phase, data = {}) {
    (this.log || (this.log = [])).push({ kind, phase, data });
    if (this.g.telemetry) this.g.telemetry.event(kind, phase, data);
  }

  /** Radio a line from EVENT_LINES. prio: jump the queue (it's happening now). */
  say(kind, moment, prio = false) {
    const lines = EVENT_LINES[kind] && EVENT_LINES[kind][moment];
    if (!lines || !lines.length) return;
    const [w, text] = pickOne(lines);
    const who = w === '@spectre' ? this.g.arsenal.air.callsign : w;
    this.g.hud.radio(who, text, prio);
  }

  objective() {
    const pin = this.active.find((e) => e.pinned && e.objective);
    if (pin) return pin.objective();
    for (let k = this.active.length - 1; k >= 0; k--) {
      const o = this.active[k].objective && this.active[k].objective();
      if (o) return o;
    }
    return null;
  }

  boss() {
    for (const e of this.active) { const b = e.boss && e.boss(); if (b) return b; }
    return null;
  }

  markers() {
    const out = [];
    for (const e of this.active) if (e.markers) out.push(...e.markers());
    return out;
  }
}
