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

const R = Math.random;
const pickOne = (a) => a[(R() * a.length) | 0];
const GATE = { x: 0, z: -10.5 };

function offsetZ(x, d) {
  return wallZ(x) - (Math.abs(x) <= WORLD.GATE_HALF ? d : d / WING_COS);
}

// ── people: a small articulated runner (soldier or civilian) ────────────────
const box = (w, h, d, y = 0) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(0, y, 0); return g; };

function buildPerson() {
  const mats = {
    cloth: new THREE.MeshStandardMaterial({ color: 0x3c4230, roughness: 0.9 }),
    pants: new THREE.MeshStandardMaterial({ color: 0x2f3326, roughness: 0.9 }),
    skin: new THREE.MeshStandardMaterial({ color: 0x8a6a55, roughness: 0.75 }),
    gear: new THREE.MeshStandardMaterial({ color: 0x23261c, roughness: 0.8 }),
    gun: new THREE.MeshStandardMaterial({ color: 0x151617, roughness: 0.5, metalness: 0.6 }),
  };
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const torso = new THREE.Mesh(box(0.42, 0.58, 0.25, 0.29), mats.cloth); torso.position.y = 0.9; body.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), mats.skin); head.position.y = 0.73; torso.add(head);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.145, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mats.gear); helmet.position.y = 0.77; torso.add(helmet);
  const pack = new THREE.Mesh(box(0.34, 0.4, 0.18, 0.28), mats.gear); pack.position.set(0, 0.05, 0.2); torso.add(pack);
  const rifle = new THREE.Mesh(box(0.06, 0.09, 0.85), mats.gun); rifle.position.set(-0.05, 0.3, -0.25); rifle.rotation.set(0.25, 0.35, 0); torso.add(rifle);
  const limb = (x, y, parent, w, len, mat) => {
    const pivot = new THREE.Group(); pivot.position.set(x, y, 0); parent.add(pivot);
    const upper = new THREE.Mesh(box(w, len, w, -len / 2), mat); pivot.add(upper);
    const joint = new THREE.Group(); joint.position.y = -len; pivot.add(joint);
    const lower = new THREE.Mesh(box(w * 0.9, len, w * 0.9, -len / 2), mat); joint.add(lower);
    return { pivot, joint };
  };
  const legL = limb(0.11, 0.92, body, 0.15, 0.45, mats.pants), legR = limb(-0.11, 0.92, body, 0.15, 0.45, mats.pants);
  const armL = limb(0.27, 0.54, torso, 0.1, 0.3, mats.cloth), armR = limb(-0.27, 0.54, torso, 0.1, 0.3, mats.cloth);
  root.visible = false;
  return { root, body, torso, helmet, pack, rifle, legL, legR, armL, armR, mats };
}

const CIV_COLORS = [0x5b2a24, 0x2b3550, 0x6a6458, 0x3b4a3a, 0x7a5a2a, 0x2a2a2e, 0x6b3d5a];

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
      const f = E.people[k];
      const soldier = this.kind === 'patrol';
      f.helmet.visible = f.pack.visible = f.rifle.visible = soldier;
      const c = soldier ? 0x3c4230 : pickOne(CIV_COLORS);
      f.mats.cloth.color.setHex(c);
      f.mats.pants.color.setHex(soldier ? 0x2f3326 : pickOne([0x1e2230, 0x2a2622, 0x3a3a3e]));
      const small = !soldier && k >= P.count - 2; // children
      f.root.scale.setScalar(small ? 0.68 : rand(0.97, 1.05));
      f.root.visible = true;
      f.body.rotation.set(0, 0, 0);
      this.units.push({
        f, x: x0 + rand(-3, 3), z: z0 + rand(-5, 5), sp: rand(P.speed[0], P.speed[1]) * (small ? 0.92 : 1), ph: R() * 6,
        state: 'run', t: 0, shootT: rand(0.2, 0.6), light: soldier || k % 2 === 0, yaw: Math.PI,
      });
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
        u.x += vx * dt; u.z += vz * dt;
        u.yaw = Math.atan2(vx, vz);
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
        if (this.kind === 'patrol') {
          u.shootT -= dt;
          if (u.shootT <= 0) {
            u.shootT = rand(0.18, 0.4);
            const n = h.queryRadius(u.x, u.z, 32, h._q);
            let best = -1, bd = 1e9;
            for (let k = 0; k < n; k++) { const j = h._q[k]; const dd = (h.x[j] - u.x) ** 2 + (h.z[j] - u.z) ** 2; if (dd < bd) { bd = dd; best = j; } }
            if (best >= 0) {
              const gy = groundH(u.x, u.z);
              const ox = u.x, oy = gy + 1.35, oz = u.z;
              const tx = h.x[best], ty = groundH(tx, h.z[best]) + 1.2 * h.scale[best], tz = h.z[best];
              fx.tracer(ox, oy, oz, tx, ty, tz, 420, 0.8, 6.5, 1.4, 0.6);
              fx.muzzle(ox, oy, oz, (tx - ox) / Math.sqrt(bd), 0, (tz - oz) / Math.sqrt(bd), 0.4);
              if (R() < 0.6) {
                const ddd = Math.sqrt(bd) || 1;
                h.damage(best, 26, 'gunner', (tx - ox) / ddd, 0, (tz - oz) / ddd, R() < 0.2);
                fx.fleshHit(tx, ty, tz, (tx - ox) / ddd, 0, (tz - oz) / ddd, 0.7);
              }
              if (R() < 0.5) g.audio.wallGun(ox, oz);
            }
          }
        }
      } else u.t += dt;
      // pose
      const gy = groundH(u.x, u.z);
      f.root.position.set(u.x, gy, u.z);
      f.root.rotation.y = u.yaw;
      if (u.state === 'run') {
        const s = Math.sin(u.ph), c = Math.cos(u.ph);
        f.legL.pivot.rotation.x = s * 0.85; f.legR.pivot.rotation.x = -s * 0.85;
        f.legL.joint.rotation.x = -Math.max(0, c) * 1.2 - 0.1; f.legR.joint.rotation.x = -Math.max(0, -c) * 1.2 - 0.1;
        f.armL.pivot.rotation.x = -s * 0.7; f.armR.pivot.rotation.x = s * 0.7;
        f.armL.joint.rotation.x = 1.1; f.armR.joint.rotation.x = 1.1;
        f.torso.rotation.x = 0.28;
        f.body.position.y = Math.abs(c) * 0.06;
        if (u.light) {
          const sc = f.root.scale.x;
          if (this.kind === 'patrol') fx.glowDot(u.x, gy + 1.45 * sc, u.z, 0.32, 0.4, 5, 0.8, 0.05);
          else fx.glowDot(u.x + Math.sin(u.yaw) * 0.4, gy + 1.0 * sc, u.z + Math.cos(u.yaw) * 0.4, 0.35, 5, 4, 2.4, 0.05);
        }
      } else if (u.state === 'down') {
        f.body.rotation.x = -Math.min(1, u.t / 0.5) * Math.PI / 2;
        f.body.position.y = 0.1 * Math.min(1, u.t / 0.5);
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
class SupplyDrop {
  constructor(E) { this.E = E; this.P = EVENTS.drop; this.blocking = true; }

  start() {
    const E = this.E;
    const x = rand(-34, 34);
    this.tx = x; this.tz = offsetZ(x, rand(55, 85));
    this.phase = 'inbound'; this.t = 0; this.integrity = 100; this.hold = this.P.hold; this.hurtSaid = false;
    // the C-130 comes in from behind the wall, low, across the drop zone
    const p = E.c130;
    p.group.visible = true;
    this.plane = { x: this.tx - 40, y: 110, z: 560, vx: 0, vz: -85, loop: null };
    this.plane.vx = (this.tx - this.plane.x) / ((this.plane.z - this.tz) / 85) * 0.3;
    this.crate = null;
    this.track = new Set();
    E.say('drop', 'start', true);
    E.g.hud.alert('RESUPPLY INBOUND — WATCH FOR THE STROBE');
  }

  update(dt) {
    const E = this.E, g = E.g, h = g.horde, fx = g.fx;
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
        this.crate = { x: pl.x, y: pl.y - 3, z: pl.z, vy: 0, t: 0, sx: pl.x, sz: pl.z };
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
        fx.groundHit(c.x, c.z, true);
        g.audio.giantStep(c.x, c.z, 0.4);
        E.say('drop', 'land', true);
        g.hud.alert('CRATE DOWN — HOLD THE DROP ZONE');
      }
    } else if (this.phase === 'hold') {
      c.t += dt;
      // the canopy collapses and drapes away
      if (E.chute.visible) {
        const k = Math.min(1, c.t / 2);
        E.chute.position.set(c.x + k * 3, c.y + 0.5 - k * 5.5, c.z);
        E.chute.rotation.set(k * 1.3, 0, 0);
        if (k >= 1) E.chute.visible = false;
      }
      // the strobe draws them in
      const near = h.queryRadius(c.x, c.z, this.P.pull, h._q);
      for (let k = 0; k < near; k++) this.track.add(h.id[h._q[k]]);
      let tearing = 0;
      for (let i = 0; i < h.n; i++) {
        if (h.dead[i] || !this.track.has(h.id[i])) continue;
        const a = (h.id[i] * 2.399) % 6.283;
        h.tgtX[i] = c.x + Math.cos(a) * 1.4; h.tgtZ[i] = c.z + Math.sin(a) * 1.4;
        if ((h.x[i] - c.x) ** 2 + (h.z[i] - c.z) ** 2 < 2.6 * 2.6) tearing++;
      }
      this.integrity -= Math.min(this.P.maxTearing, tearing) * this.P.tear * dt;
      if (tearing && R() < dt * 6) fx.spark(c.x + rand(-0.6, 0.6), c.y + 0.4, c.z + rand(-0.6, 0.6), rand(-2, 2), rand(1, 3), rand(-2, 2), 4, 3, 2, 0.4);
      if (!this.hurtSaid && this.integrity < 60) { this.hurtSaid = true; E.say('drop', 'hurt', true); }
      this.hold -= dt;
      if (this.integrity <= 0) return this.finish(false);
      if (this.hold <= 0) return this.finish(true);
    }
    // crate + strobe
    E.crate.position.set(c.x, c.y, c.z);
    if ((this.t % 0.9) < dt) {
      fx.glowDot(c.x, c.y + 0.8, c.z, 2.2, 14, 14, 16, 0.08);
      fx.lights.flash(c.x, c.y + 1.5, c.z, 0xe0ecff, 260, 40, 0.1);
    }
    return false;
  }

  finish(ok) {
    const E = this.E, g = E.g, h = g.horde, c = this.crate, P = this.P;
    E.report('drop', 'end', { recovered: ok, integrity: Math.max(0, Math.round(this.integrity)), pulled: this.track.size });
    for (let i = 0; i < h.n; i++) if (this.track.has(h.id[i])) h.resetLane(i);
    E.crate.visible = false; E.chute.visible = false;
    if (ok) {
      // green smoke: recovered
      for (let k = 0; k < 12; k++) g.fx.smoke.spawn(c.x, c.y, c.z, rand(-1, 1), rand(1.5, 3), rand(-1, 1), rand(4, 7), 1, 6, PF.SMOKE + ((R() * 4) | 0), 0.05, 0.3, 0.08, 0.7, 0.02, 0.06, 0.02, -0.2, 0.4);
      const a = g.arsenal, run = g.run;
      a.flaresLeft += P.reward.flares;
      a.grenadesLeft += P.reward.grenades;
      a.artyCd = 0;
      a.air.bomberCd = 0;
      const sup = Math.round(P.reward.supplies * (1 + 0.1 * (run.night - 1)));
      run.supplies += sup; g.ns.supplies += sup;
      E.say('drop', 'saved', true);
      g.hud.alert(`RESUPPLY: +${P.reward.flares} FLARES · +${P.reward.grenades} GRENADES · BATTERY & BOMBER READY · +${sup} SUPPLIES`);
      g.audio.uiBuy();
    } else {
      g.fx.explosion(c.x, c.y - 0.5, c.z, 0.5, { fires: false, scorch: false });
      E.say('drop', 'lost', true);
      g.hud.alert('THE CRATE IS GONE', 'red');
    }
    return true;
  }

  end() {
    const E = this.E;
    E.crate.visible = false; E.chute.visible = false;
    if (this.plane) { if (this.plane.loop) this.plane.loop.stop(1); this.plane = null; }
    E.c130.group.visible = false;
  }

  objective() {
    if (this.phase === 'hold') {
      return { title: 'HOLD THE DROP ZONE', text: `RECOVERY IN ${Math.ceil(this.hold)} S · CRATE ${Math.max(0, Math.round(this.integrity))}%`, progress: this.integrity / 100, cls: this.integrity < 50 ? 'danger' : '' };
    }
    return { title: 'RESUPPLY INBOUND', text: this.phase === 'fall' ? 'CHUTE OPEN — WATCH WHERE IT LANDS' : 'C-130 ON APPROACH', progress: 1, cls: '' };
  }

  markers() {
    const c = this.crate;
    if (!c) return [];
    return [{ x: c.x, y: c.y + 2.2, z: c.z, label: 'SUPPLY CRATE', cls: this.integrity < 50 ? 'danger' : 'objective' }];
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
    h.acid[sec] = Math.min(h.acid[sec] + 2.2, 7.6); // smashed concrete: a ramp the others climb
    g.audio.giantSmash(x, z);
    g.player.addTrauma(0.4);
    g.hud.alert(`${['L5', 'L4', 'L3', 'L2', 'L1', 'R1', 'R2', 'R3', 'R4', 'R5'][sec]} — THE WALL IS BREAKING`, 'red');
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
    g.arsenal.flaresLeft += this.P.flares;
    g.hud.alert(`GENERATOR DOWN — +${this.P.flares} FLARES ISSUED`, 'red');
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
const _v = new THREE.Vector3();

export class NightEvents {
  constructor(game) {
    this.g = game;
    this.queue = [];
    this.active = [];
    const scene = game.scene;
    this.people = [];
    for (let k = 0; k < 8; k++) { const p = buildPerson(); scene.add(p.root); this.people.push(p); }
    // supply drop: aircraft, crate and parachute
    this.c130 = buildGunship();
    this.c130.group.scale.setScalar(1.5);
    this.c130.group.visible = false;
    scene.add(this.c130.group);
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x4a4f36, roughness: 0.85 });
    const strap = new THREE.MeshStandardMaterial({ color: 0x1c1d18, roughness: 0.9 });
    this.crate = new THREE.Group();
    this.crate.add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.1, 1.2), crateMat));
    for (const x of [-0.45, 0.45]) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.14, 1.24), strap); s.position.x = x; this.crate.add(s); }
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 4, 5) }));
    lamp.position.y = 0.62; this.crate.add(lamp);
    this.crate.visible = false;
    scene.add(this.crate);
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
  }

  /** Schedule tonight's events. */
  start(night, endless) {
    this.reset();
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
      default: return null;
    }
    // one escort / one drop at a time: the props are shared
    if (this.active.some((a) => a.constructor === e.constructor && (e instanceof Escort || e instanceof SupplyDrop))) return null;
    e.kind = e.kind || kind;
    e.start();
    this.active.push(e);
    this.report(kind, 'start');
    return e;
  }

  reset() {
    for (const e of this.active) e.end();
    this.active.length = 0;
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
  }

  /** Play-test telemetry for an event (start / outcome). */
  report(kind, phase, data = {}) { if (this.g.telemetry) this.g.telemetry.event(kind, phase, data); }

  /** Radio a line from EVENT_LINES. prio: jump the queue (it's happening now). */
  say(kind, moment, prio = false) {
    const lines = EVENT_LINES[kind] && EVENT_LINES[kind][moment];
    if (!lines || !lines.length) return;
    const [w, text] = pickOne(lines);
    const who = w === '@spectre' ? this.g.arsenal.air.callsign : w;
    this.g.hud.radio(who, text, prio);
  }

  objective() {
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
