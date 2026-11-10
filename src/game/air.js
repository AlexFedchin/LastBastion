// Air support: a bomber on call (throw a red marker flare, get a 2000 lb bomb
// on it) and an AC-130 gunship that circles the valley all night and works
// the crowds with its 25 mm, 40 mm and 105 mm guns.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WORLD, ABILITY, GUNSHIP, wallZ, wallDist, WING_COS } from '../config.js';
import { clamp, rand, lerp } from '../core/util.js';
import { PF } from '../world/textures.js';
import { groundH } from '../world/terrain.js';

const R = Math.random;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

// ── geometry helpers ─────────────────────────────────────────────────────────
function clean(g) {
  g = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal'].includes(k)) g.deleteAttribute(k);
  return g;
}
const merge = (list) => mergeGeometries(list.map(clean));
function box(w, h, d, x, y, z, ry = 0, rz = 0, rx = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.rotateX(rx); g.rotateZ(rz); g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}
/** Cylinder along +z. */
function tube(r0, r1, len, x, y, z, seg = 12) {
  const g = new THREE.CylinderGeometry(r1, r0, len, seg);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}
function nose(r, len, x, y, z, dir = 1) {
  const g = new THREE.SphereGeometry(r, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  g.rotateX(dir * Math.PI / 2);
  g.scale(1, 1, len / r);
  g.translate(x, y, z);
  return g;
}

function propeller(mat) {
  const p = new THREE.Group();
  const blade = new THREE.BoxGeometry(0.28, 2.1, 0.06);
  blade.translate(0, 1.05, 0);
  const geo = merge([0, 1, 2, 3].map((k) => { const b = blade.clone(); b.rotateZ(k * Math.PI / 2); return b; }));
  p.add(new THREE.Mesh(geo, mat));
  return p;
}

/** AC-130: high wing, four turboprops, upswept tail, guns on the port side. Nose +z, port +x. */
function buildGunship() {
  const skin = new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.75, metalness: 0.35, emissive: 0x0b0d10 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6, metalness: 0.5 });
  const g = new THREE.Group();
  const body = merge([
    tube(2.1, 2.1, 20, 0, 0, 1),
    nose(2.1, 4.2, 0, 0, 11, 1),
    tube(2.1, 0.7, 11, 0, 0.9, -14.5),      // upswept tail cone
    box(3.6, 1.2, 9, 0, -1.7, 0),           // gear sponsons
    box(41, 0.5, 4.4, 0, 2.15, 2.2),        // wing
    box(3.2, 1.1, 5, 0, 2.3, 2.2),          // wing root fairing
    box(0.5, 7.5, 5.2, 0, 4.8, -16.2, 0, 0, -0.12), // fin
    box(15.5, 0.35, 3.8, 0, 1.6, -17),      // tailplane
  ]);
  g.add(new THREE.Mesh(body, skin));
  const nacelles = merge([-12.4, -6.6, 6.6, 12.4].map((x) => tube(0.85, 0.65, 6, x, 1.4, 3.9)));
  g.add(new THREE.Mesh(nacelles, skin));
  const guns = merge([
    tube(0.12, 0.12, 2.4, 2.2, -0.3, 6.6), tube(0.18, 0.18, 2.6, 2.2, -0.5, 0.5), tube(0.3, 0.3, 3.2, 2.3, -0.7, -3.8),
    box(0.3, 1.2, 2.8, 2.05, -0.5, -3.8), box(0.3, 0.9, 2.2, 2.05, -0.4, 0.5),
  ]);
  g.add(new THREE.Mesh(guns, dark));
  const props = [];
  for (const x of [-12.4, -6.6, 6.6, 12.4]) {
    const p = propeller(dark);
    p.position.set(x, 1.4, 7.05);
    g.add(p);
    props.push(p);
  }
  return {
    group: g, props,
    muzzles: { 25: new THREE.Vector3(2.4, -0.3, 7.8), 40: new THREE.Vector3(2.4, -0.5, 1.8), 105: new THREE.Vector3(2.5, -0.7, -2.2) },
    lights: { port: new THREE.Vector3(20.5, 2.2, 2), stbd: new THREE.Vector3(-20.5, 2.2, 2), tail: new THREE.Vector3(0, 8.5, -18), belly: new THREE.Vector3(0, -2.3, 0) },
    exhausts: [-12.4, -6.6, 6.6, 12.4].map((x) => new THREE.Vector3(x, 1.9, 0.6)),
  };
}

/** Swept-wing four-engine jet bomber. Nose +z. */
function buildBomber() {
  const skin = new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.7, metalness: 0.4, emissive: 0x08090b });
  const g = new THREE.Group();
  const wing = (side) => {
    const w = new THREE.BoxGeometry(24, 0.5, 6.5);
    w.translate(side * 12, 0, 0);
    w.rotateY(side * 0.55);
    w.translate(side * 1.5, 0.6, 1);
    return w;
  };
  const tail = (side) => {
    const w = new THREE.BoxGeometry(8, 0.3, 3.4);
    w.translate(side * 4, 0, 0);
    w.rotateY(side * 0.6);
    w.translate(side * 0.8, 1.2, -21);
    return w;
  };
  const geo = merge([
    tube(2.4, 2.4, 34, 0, 0, 0), nose(2.4, 7, 0, 0, 17, 1), tube(2.4, 0.6, 9, 0, 0.6, -21.5),
    wing(1), wing(-1), tail(1), tail(-1),
    box(0.4, 7, 6, 0, 4.3, -22, 0, 0, -0.35),
    tube(0.75, 0.6, 5.5, 8.5, -1.0, 0.5), tube(0.75, 0.6, 5.5, 14, -1.0, -3.8), tube(0.75, 0.6, 5.5, -8.5, -1.0, 0.5), tube(0.75, 0.6, 5.5, -14, -1.0, -3.8),
  ]);
  g.add(new THREE.Mesh(geo, skin));
  return {
    group: g,
    engines: [new THREE.Vector3(8.5, -1, -2.4), new THREE.Vector3(14, -1, -6.7), new THREE.Vector3(-8.5, -1, -2.4), new THREE.Vector3(-14, -1, -6.7)],
    lights: { port: new THREE.Vector3(23, 0.6, -14), stbd: new THREE.Vector3(-23, 0.6, -14), tail: new THREE.Vector3(0, 7.6, -24) },
  };
}

function buildBomb() {
  const mat = new THREE.MeshStandardMaterial({ color: 0x4a4f3a, roughness: 0.6, metalness: 0.3 });
  const geo = merge([
    tube(0.45, 0.45, 2.6, 0, 0, 0), nose(0.45, 0.9, 0, 0, 1.3, 1), tube(0.45, 0.2, 1.2, 0, 0, -1.9),
    box(1.5, 0.05, 0.6, 0, 0, -2.3), box(0.05, 1.5, 0.6, 0, 0, -2.3),
  ]);
  return new THREE.Mesh(geo, mat);
}

/** Point at perpendicular distance d in front of the wall at x. */
function offsetZ(x, d) {
  return wallZ(x) - (Math.abs(x) <= WORLD.GATE_HALF ? d : d / WING_COS);
}

const SPECTRE = 'SPECTRE 2-1';
const SPECTRE_LINES = [
  'Good hits, good hits. Lot of movement down there, Bastion.',
  'Shifting fire. Keep that fifty talking.',
  'Spectre still on station. We have you covered.',
  'Big group moving up the road — engaging.',
  'Sparkle on the treeline. Rounds away.',
];

export class AirSupport {
  constructor(arsenal) {
    this.a = arsenal;
    this.scene = arsenal.scene;
    this.fx = arsenal.fx;
    this.audio = arsenal.audio;
    this.horde = arsenal.horde;
    this.onRadio = null; // (who, text)

    // bomber on call
    this.bomberCd = 0;
    this.marker = null;
    this.bomber = null;
    this.bombs = [];
    this.craters = [];
    const bm = buildBomber();
    bm.group.scale.setScalar(1.3);
    this.bomberModel = bm;
    bm.group.visible = false;
    this.scene.add(bm.group);
    this.bombMesh = buildBomb();
    this.bombMesh.visible = false;
    this.scene.add(this.bombMesh);
    this.markerMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.35, 6), new THREE.MeshStandardMaterial({ color: 0x9a1d12, roughness: 0.6, emissive: 0x401008 }));
    this.markerMesh.visible = false;
    this.scene.add(this.markerMesh);

    // gunship
    const gs = buildGunship();
    this.gs = {
      ...gs, theta: Math.PI * 0.5, active: false, leaving: 0, engageT: 8, mode: 0,
      burstT: 0, acc: 0, rounds: 0, nextT: 0, tx: 0, tz: 0, wx: 0, wz: 0, shots: 0,
      vel: new THREE.Vector3(), loop: null, introDone: false, radioCd: 30,
    };
    gs.group.visible = false;
    gs.group.scale.setScalar(1.5); // a touch larger than life so you can find it at night
    this.scene.add(gs.group);
    this.inFlight = []; // gunship rounds on their way down
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────
  startNight(menu = false) {
    this.clearBomber();
    this.bomberCd = ABILITY.bomber.firstDelay;
    this.craters.length = 0;
    this.inFlight.length = 0;
    const g = this.gs;
    g.active = true; g.leaving = 0; g.mode = 0;
    g.engageT = rand(6, 10);
    g.introDone = menu; g.radioCd = 30;
    g.theta = R() * Math.PI * 2;
    g.group.visible = true;
  }

  endNight() {
    this.clearBomber();
    this.inFlight.length = 0;
    // the gunship heads home as the sky lightens
    if (this.gs.active) { this.gs.leaving = 0.001; this.gs.mode = 0; }
  }

  /** Nothing in the sky (shop, menus that don't update the arsenal). */
  hide() {
    this.clearBomber();
    const g = this.gs;
    g.active = false; g.group.visible = false;
    if (g.loop) { g.loop.stop(0.5); g.loop = null; }
  }

  clearBomber() {
    if (this.marker && this.marker.light) this.fx.lights.release(this.marker.light);
    this.marker = null;
    if (this.bomber && this.bomber.loop) this.bomber.loop.stop(1);
    this.bomber = null;
    this.bombs.length = 0;
    this.bomberModel.group.visible = false;
    this.bombMesh.visible = false;
    this.markerMesh.visible = false;
  }

  radio(text, who = SPECTRE) { if (this.onRadio) this.onRadio(who, text); }

  get bomberBusy() { return !!(this.marker || this.bomber || this.bombs.length); }

  // ── bomber on call ─────────────────────────────────────────────────────────
  /** Throw a red marker flare at the target. Returns false while the bomber is cycling. */
  throwMarker(target) {
    const B = ABILITY.bomber;
    if (this.bomberCd > 0 || this.bomberBusy) return false;
    const cx = WORLD.CAM.x, cz = WORLD.CAM.z;
    let tx = target.x, tz = target.z;
    let dx = tx - cx, dz = tz - cz;
    const d = Math.hypot(dx, dz);
    if (d > B.maxRange) { tx = cx + dx * B.maxRange / d; tz = cz + dz * B.maxRange / d; }
    // never on our own heads
    if (wallDist(tx, tz) < B.minWallDist) tz = Math.min(tz, offsetZ(tx, B.minWallDist));
    tx = clamp(tx, -230, 230);
    const dist = Math.hypot(tx - cx, tz - cz);
    this.marker = {
      phase: 'flight', t: 0, dur: 0.9 + dist * 0.0055, arc: 6 + dist * 0.16,
      sx: cx + 0.4, sy: WORLD.CAM.y + 0.3, sz: cz - 0.8, tx, tz, light: null, burnT: 0, callT: -1,
    };
    this.markerMesh.visible = true;
    this.bomberCd = B.cooldown;
    this.audio.throwGrenade();
    return true;
  }

  updateMarker(dt) {
    const m = this.marker;
    if (!m) return;
    const fx = this.fx;
    m.t += dt;
    if (m.phase === 'flight') {
      const u = Math.min(1, m.t / m.dur);
      const gy = groundH(m.tx, m.tz);
      const x = lerp(m.sx, m.tx, u), z = lerp(m.sz, m.tz, u);
      const y = lerp(m.sy, gy + 0.15, u) + Math.sin(u * Math.PI) * m.arc;
      this.markerMesh.position.set(x, y, z);
      this.markerMesh.rotation.x += dt * 14; this.markerMesh.rotation.z += dt * 9;
      fx.glowDot(x, y, z, 0.7, 9, 1.2, 0.5, 0.06);
      if (R() < 0.7) fx.spark(x, y, z, rand(-1, 1), rand(-1, 1), rand(-1, 1), 8, 1.5, 0.6, 0.35);
      if (R() < 0.4) fx.smoke.spawn(x, y, z, 0, 0.4, 0, rand(1, 1.8), 0.15, 0.8, PF.SMOKE + ((R() * 4) | 0), 0.35, 0.04, 0.03, 0.5, 0.08, 0.02, 0.02, -0.2, 0.6);
      if (u >= 1) {
        m.phase = 'burn';
        m.t = 0;
        this.markerMesh.position.set(m.tx, gy + 0.08, m.tz);
        this.markerMesh.rotation.set(Math.PI / 2, 0, R() * 6);
        m.light = fx.lights.acquire();
        if (m.light) { m.light.color.setRGB(1, 0.12, 0.05); m.light.distance = 55; m.light.decay = 1.4; m.light.intensity = 0; }
        this.audio.markerIgnite(m.tx, m.tz);
        m.callT = 1.6;
      }
      return;
    }
    // burning on the ground: red light, red smoke, spitting sparks
    const gy = groundH(m.tx, m.tz);
    const flick = 0.75 + R() * 0.25;
    if (m.light) { m.light.position.set(m.tx, gy + 1.2, m.tz); m.light.intensity = 420 * flick * Math.min(1, m.t * 3); }
    fx.glowDot(m.tx, gy + 0.25, m.tz, 1.1 * flick, 12, 1.2, 0.5, 0.05);
    if (R() < 0.6) fx.spark(m.tx, gy + 0.2, m.tz, rand(-2, 2), rand(1, 4), rand(-2, 2), 9, 1.4, 0.5, 0.5);
    if (R() < dt * 14) {
      fx.smoke.spawn(m.tx, gy + 0.4, m.tz, rand(-0.4, 0.4) + 0.6, rand(1.5, 3), rand(-0.4, 0.4), rand(4, 7), 0.8, rand(5, 8), PF.SMOKE + ((R() * 4) | 0),
        0.55, 0.06, 0.04, 0.65, 0.16, 0.035, 0.03, -0.25, 0.4, 0, R() * 6, (R() - 0.5) * 0.3, 0.05);
    }
    if (m.callT > 0) {
      m.callT -= dt;
      if (m.callT <= 0) {
        this.radio(pickLine(['Hammer one-one, I have your red smoke. One GBU, danger close. Heads down, Bastion.',
          'Hammer one-one, tally your mark. Two-thousand pounder inbound, ten seconds.',
          'Copy red flare. Hammer one-one is in hot — keep your heads down.']), 'HAMMER 1-1');
        this.audio.radioStatic(0.6);
        this.launchBomber(m.tx, m.tz);
      }
    }
  }

  launchBomber(tx, tz) {
    const B = ABILITY.bomber;
    // come in over the wall from the base, down the line of the throw
    let dx = tx - WORLD.CAM.x, dz = tz - WORLD.CAM.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    // a little crossing angle so it doesn't pass exactly through the camera
    const ang = rand(-0.18, 0.18);
    const c = Math.cos(ang), s = Math.sin(ang);
    const ddx = dx * c - dz * s, ddz = dx * s + dz * c;
    const S0 = 1000;
    this.bomber = {
      tx, tz, dx: ddx, dz: ddz, s: 0, S0, alt: B.alt + rand(-8, 12), released: false,
      release: B.speed * B.fall * 0.78, loop: null,
    };
    this.bomberModel.group.visible = true;
  }

  updateBomber(dt) {
    const b = this.bomber;
    if (!b) return;
    const B = ABILITY.bomber;
    const fx = this.fx;
    b.s += B.speed * dt;
    const along = b.s - b.S0;
    const x = b.tx + b.dx * along, z = b.tz + b.dz * along, y = b.alt;
    const grp = this.bomberModel.group;
    grp.position.set(x, y, z);
    grp.lookAt(x + b.dx, y, z + b.dz);
    grp.updateMatrixWorld();
    // engine glow and nav lights
    for (const e of this.bomberModel.engines) { _v.copy(e).applyMatrix4(grp.matrixWorld); fx.glowDot(_v.x, _v.y, _v.z, 1.3, 3.2, 1.4, 0.5, 0.05); }
    const L = this.bomberModel.lights;
    _v.copy(L.port).applyMatrix4(grp.matrixWorld); fx.glowDot(_v.x, _v.y, _v.z, 1.6, 6, 0.4, 0.3, 0.05);
    _v.copy(L.stbd).applyMatrix4(grp.matrixWorld); fx.glowDot(_v.x, _v.y, _v.z, 1.6, 0.3, 5, 0.8, 0.05);
    if ((performance.now() % 1000) < 90) { _v.copy(L.tail).applyMatrix4(grp.matrixWorld); fx.glowDot(_v.x, _v.y, _v.z, 3, 8, 8, 8, 0.05); }
    // sound: a roar that grows over the wall and tears away down the valley
    if (!b.loop && this.audio.ready) b.loop = this.audio.loop(this.audio.B.jet && this.audio.B.jet[0], { ref: 140, reverb: 0.35 });
    if (b.loop) b.loop.update(x, y, z, b.dx * B.speed, 0, b.dz * B.speed, 3.2);
    // bomb away
    if (!b.released && -along <= b.release) {
      b.released = true;
      const gy = groundH(b.tx, b.tz);
      const D = Math.hypot(b.tx - x, b.tz - z);
      const T = B.fall;
      this.bombs.push({ x0: x, y0: y, z0: z, dx: b.dx, dz: b.dz, v: B.speed, D, T, gy, t: 0, tx: b.tx, tz: b.tz, a: 2 * (B.speed * T - D) / (T * T) });
      this.bombMesh.visible = true;
      this.audio.bombWhistle(b.tx, b.tz, T);
    }
    if (along > 1100) {
      if (b.loop) b.loop.stop(2);
      this.bomber = null;
      grp.visible = false;
    }
  }

  updateBombs(dt) {
    const B = ABILITY.bomber;
    for (let k = 0; k < this.bombs.length; k++) {
      const m = this.bombs[k];
      m.t += dt;
      const t = Math.min(m.t, m.T);
      const s = m.v * t - 0.5 * m.a * t * t;
      const x = m.x0 + m.dx * s, z = m.z0 + m.dz * s;
      const y = m.y0 - (m.y0 - m.gy) * (t / m.T) * (t / m.T);
      const hv = m.v - m.a * t, vy = -2 * (m.y0 - m.gy) * t / (m.T * m.T);
      this.bombMesh.position.set(x, y, z);
      this.bombMesh.lookAt(x + m.dx * hv, y + vy, z + m.dz * hv);
      if (m.t >= m.T) {
        this.bombs.splice(k, 1); k--;
        this.bombMesh.visible = false;
        this.impact(m.tx, m.gy, m.tz, B);
      }
    }
  }

  impact(x, gy, z, B) {
    const a = this.a;
    this.fx.bigExplosion(x, gy, z, 1);
    const kills = this.horde.explode(x, gy + 0.5, z, B.radius, B.damage, 'bomb', { push: 2.6, ignite: true });
    this.audio.bigBlast(x, z);
    if (a.onShake) a.onShake(5.5, x, z);
    if (a.onExplosionKills) a.onExplosionKills(kills, x, z, 'bomb');
    this.craters.push({ x, z, t: 0, life: 34 });
    if (this.marker) {
      if (this.marker.light) this.fx.lights.release(this.marker.light);
      this.marker = null;
      this.markerMesh.visible = false;
    }
    setTimeout(() => this.radio(kills > 25 ? `Good effect on target. Looks like ${kills} down. Hammer one-one off and climbing.`
      : 'Bomb impact. Hammer one-one off target, re-arming.', 'HAMMER 1-1'), 2500);
  }

  // ── AC-130 ─────────────────────────────────────────────────────────────────
  updateGunship(dt) {
    const g = this.gs;
    if (!g.active) return;
    const G = GUNSHIP;
    const grp = g.group;
    let x, y, z;
    if (g.leaving > 0) {
      // straight out along the last heading, climbing
      g.leaving += dt;
      grp.position.addScaledVector(g.vel, dt);
      grp.position.y += dt * 6;
      x = grp.position.x; y = grp.position.y; z = grp.position.z;
      grp.lookAt(x + g.vel.x, y + 0.08 * G.speed, z + g.vel.z);
      if (g.leaving > 14) { this.hide(); return; }
    } else {
      // left-hand pylon turn: the guns on the port side always look into the circle
      g.theta -= (G.speed / G.radius) * dt;
      const c = Math.cos(g.theta), s = Math.sin(g.theta);
      x = G.center.x + c * G.radius; z = G.center.z + s * G.radius;
      y = G.alt + Math.sin(g.theta * 2) * 7;
      g.vel.set(s * G.speed, 0, -c * G.speed);
      grp.position.set(x, y, z);
      grp.lookAt(x + g.vel.x, y, z + g.vel.z);
      grp.rotateZ(-0.36); // banked into the turn, port wing down
    }
    grp.updateMatrixWorld();
    for (const p of g.props) p.rotation.z += dt * 40;
    // nav lights (dim — they fly blacked out, but we let you see your friends)
    const L = g.lights, M = grp.matrixWorld, fx = this.fx;
    _v.copy(L.port).applyMatrix4(M); fx.glowDot(_v.x, _v.y, _v.z, 3.2, 7, 0.4, 0.25, 0.05);
    _v.copy(L.stbd).applyMatrix4(M); fx.glowDot(_v.x, _v.y, _v.z, 3.2, 0.25, 5.5, 0.9, 0.05);
    for (const e of g.exhausts) { _v.copy(e).applyMatrix4(M); fx.glowDot(_v.x, _v.y, _v.z, 1.8, 2.2, 0.9, 0.3, 0.05); }
    const now = performance.now();
    if (now % 1500 < 100) { _v.copy(L.tail).applyMatrix4(M); fx.glowDot(_v.x, _v.y, _v.z, 4, 9, 9, 9, 0.05); }
    if ((now + 700) % 1500 < 100) { _v.copy(L.belly).applyMatrix4(M); fx.glowDot(_v.x, _v.y, _v.z, 3.5, 8, 0.5, 0.3, 0.05); }
    // four turboprops droning overhead all night
    if (!g.loop && this.audio.ready) g.loop = this.audio.loop(this.audio.B.prop && this.audio.B.prop[0], { ref: 160, reverb: 0.4 });
    if (g.loop) g.loop.update(x, y, z, g.vel.x, g.vel.y, g.vel.z, g.leaving > 0 ? 2.6 * Math.max(0, 1 - g.leaving / 14) : 2.6);

    if (g.leaving > 0) return;
    g.radioCd -= dt;
    // engagements
    if (!g.mode) {
      g.engageT -= dt;
      if (g.engageT <= 0) this.engage();
      return;
    }
    if (g.mode === 25) {
      g.burstT -= dt;
      g.acc += dt * G.g25.rate;
      while (g.acc >= 1) {
        g.acc -= 1;
        // the burst walks across the target
        const u = 1 - g.burstT / g.burstLen;
        const tx = g.tx + g.wx * (u - 0.5) + rand(-1, 1) * G.g25.scatter, tz = g.tz + g.wz * (u - 0.5) + rand(-1, 1) * G.g25.scatter;
        if (wallDist(tx, tz) > G.g25.minWall - 2) this.fire(25, tx, tz);
      }
      if (g.burstT <= 0) this.endEngagement();
    } else if (g.mode === 40) {
      g.nextT -= dt;
      if (g.nextT <= 0) {
        // re-acquire: track the crowd as it moves
        const c = this.horde.densest(G.g40.minWall, 240, 12, 6);
        if (c && Math.hypot(c.x - g.tx, c.z - g.tz) < 60) { g.tx = c.x; g.tz = c.z; }
        this.fire(40, g.tx + rand(-1, 1) * G.g40.scatter, g.tz + rand(-1, 1) * G.g40.scatter);
        g.rounds--;
        g.nextT = G.g40.interval * rand(0.85, 1.25);
        if (g.rounds <= 0) this.endEngagement();
      }
    } else if (g.mode === 105) {
      g.nextT -= dt;
      if (g.nextT <= 0) {
        this.fire(105, g.tx + rand(-1.5, 1.5), g.tz + rand(-1.5, 1.5));
        this.endEngagement();
      }
    }
  }

  engage() {
    const g = this.gs, G = GUNSHIP;
    const c = this.horde.densest(G.g25.minWall, 240, 44, 7);
    if (!c || c.count < 2) { g.engageT = 1.5; return; }
    const wd = wallDist(c.x, c.z);
    const r = R();
    g.tx = c.x; g.tz = c.z;
    if (c.count >= G.g105.minCluster && wd >= G.g105.minWall && r < 0.2) {
      g.mode = 105; g.nextT = 0.8;
      if (g.radioCd <= 0) { g.radioCd = 25; this.radio('Rifle, one-oh-five. Big group — splash in five.'); }
    } else if (r < 0.55 && wd >= G.g40.minWall) {
      g.mode = 40; g.rounds = Math.round(rand(G.g40.rounds[0], G.g40.rounds[1])); g.nextT = 0.2;
    } else {
      g.mode = 25;
      g.burstLen = g.burstT = rand(G.g25.burst[0], G.g25.burst[1]);
      g.acc = 0;
      const a = R() * Math.PI * 2, len = rand(8, 18);
      g.wx = Math.cos(a) * len; g.wz = Math.sin(a) * len;
    }
    if (!g.introDone) {
      g.introDone = true;
      g.radioCd = 35;
      this.radio('Bastion-7, Spectre two-one on station overhead. We\'ll work the crowds in the field — you hold that wall.');
      this.audio.radioStatic(0.8);
    } else if (g.radioCd <= 0 && R() < 0.35) {
      g.radioCd = 40;
      this.radio(pickLine(SPECTRE_LINES));
    }
  }

  endEngagement() {
    const g = this.gs;
    g.mode = 0;
    g.engageT = rand(GUNSHIP.engageMin, GUNSHIP.engageMax);
  }

  fire(kind, tx, tz) {
    const g = this.gs, fx = this.fx;
    _v.copy(g.muzzles[kind]).applyMatrix4(g.group.matrixWorld);
    const gy = groundH(tx, tz);
    const dist = _w.set(tx - _v.x, gy - _v.y, tz - _v.z).length();
    const speed = kind === 25 ? 1050 : kind === 40 ? 880 : 520;
    g.shots++;
    if (kind === 25) {
      if (g.shots % 2 === 0) fx.tracer(_v.x, _v.y, _v.z, tx, gy + 0.3, tz, speed, 1.6, 7, 3.4, 1.2);
      fx.glowDot(_v.x, _v.y, _v.z, 3.2, 9, 6, 3, 0.04);
      if (g.shots % 2 === 0) this.audio.gunshipShot(25, _v.x, _v.y, _v.z);
    } else if (kind === 40) {
      fx.tracer(_v.x, _v.y, _v.z, tx, gy + 0.3, tz, speed, 2.6, 7, 3.6, 1.2);
      fx.glowDot(_v.x, _v.y, _v.z, 6, 10, 7, 3.5, 0.07);
      fx.smokePuff(_v.x, _v.y, _v.z, 3, 0.05, 2, 0);
      this.audio.gunshipShot(40, _v.x, _v.y, _v.z);
    } else {
      fx.tracer(_v.x, _v.y, _v.z, tx, gy + 0.3, tz, speed, 1.2, 6, 3, 1.2);
      fx.glowDot(_v.x, _v.y, _v.z, 12, 12, 8, 4, 0.1);
      fx.lights.flash(_v.x, _v.y, _v.z, 0xffb070, 1600, 120, 0.25);
      fx.smokePuff(_v.x, _v.y, _v.z, 6, 0.05, 3, 0);
      this.audio.gunshipShot(105, _v.x, _v.y, _v.z);
    }
    this.inFlight.push({ kind, x: tx, z: tz, gy, t: dist / speed });
  }

  updateRounds(dt) {
    const G = GUNSHIP, a = this.a, fx = this.fx;
    for (let k = 0; k < this.inFlight.length; k++) {
      const r = this.inFlight[k];
      r.t -= dt;
      if (r.t > 0) continue;
      this.inFlight.splice(k, 1); k--;
      if (r.kind === 25) {
        fx.glowDot(r.x, r.gy + 0.7, r.z, 2.4, 8, 4.5, 1.6, 0.08);
        fx.groundHit(r.x, r.z, true);
        if (R() < 0.4) fx.explosion(r.x, r.gy, r.z, 0.3, { scorch: R() < 0.4, light: R() < 0.15, fires: false });
        const kills = this.horde.explode(r.x, r.gy + 0.5, r.z, G.g25.radius, G.g25.damage, 'gunship', { push: 0.5 });
        if (R() < 0.55) this.audio.gunshipImpact(r.x, r.z);
        if (kills && a.onExplosionKills) a.onExplosionKills(kills, r.x, r.z, 'gunship');
      } else if (r.kind === 40) {
        // no camera shake from the light guns — they're a long way off
        fx.explosion(r.x, r.gy, r.z, 0.8, { fires: R() < 0.3 });
        const kills = this.horde.explode(r.x, r.gy + 0.5, r.z, G.g40.radius, G.g40.damage, 'gunship', { push: 0.8 });
        this.audio.explosion(r.x, r.z, 0.8);
        if (a.onExplosionKills) a.onExplosionKills(kills, r.x, r.z, 'gunship');
      } else {
        a.detonate(r.x, r.gy, r.z, 1.75, G.g105.radius, G.g105.damage, 'gunship');
      }
    }
  }

  // ── per frame ──────────────────────────────────────────────────────────────
  update(dt) {
    this.bomberCd = Math.max(0, this.bomberCd - dt);
    this.updateMarker(dt);
    this.updateBomber(dt);
    this.updateBombs(dt);
    this.updateGunship(dt);
    this.updateRounds(dt);
    for (let k = 0; k < this.craters.length; k++) {
      const c = this.craters[k];
      c.t += dt;
      const f = 1 - c.t / c.life;
      if (f <= 0) { this.craters.splice(k, 1); k--; continue; }
      this.fx.bigSmoke(c.x, c.z, f, dt, Math.max(0, 1 - c.t / 8));
    }
  }
}

function pickLine(list) { return list[(Math.random() * list.length) | 0]; }
