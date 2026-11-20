// Air support: a bomber on call (throw a red marker flare, get a 2000 lb bomb
// on it) and an AC-130 gunship that circles the valley all night and works
// the crowds with its 25 mm GAU-12 Gatling.
import * as THREE from 'three';
import { WORLD, ABILITY, GUNSHIP, wallZ, wallDist, WING_COS, CALL, COMMS, isUnlocked } from '../config.js';
import { clamp, rand, lerp } from '../core/util.js';
import { PF } from '../world/textures.js';
import { groundH } from '../world/terrain.js';
import { cloneModel } from '../world/models.js';
import { NavLights } from '../fx/navlights.js';

const R = Math.random;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const GAU_SPEED = 1000; // m/s, 25 mm rounds coming down

const V = (x, y, z) => new THREE.Vector3(x, y, z);
/** Night tint: a faint glow so a dark airframe still reads against the clouds. */
function tint(group, hex) {
  group.traverse((o) => { if (o.isMesh && o.material.emissive) o.material.emissive.setHex(hex); });
}

/**
 * AC-130 (app/models/ac130.glb): metres, nose +z, port +x, Y up. The four
 * propellers are separate nodes on their hubs so they can spin.
 */
export function buildGunship() {
  const g = cloneModel('ac130');
  tint(g, 0x0b0d10);
  return {
    group: g,
    props: [0, 1, 2, 3].map((k) => g.getObjectByName('prop_' + k)),
    muzzle: V(2.7, -0.6, 7.6), // the GAU-12 port, ahead of the wing on the left side
    lights: { port: V(20.3, 2.4, 2.4), stbd: V(-20.3, 2.4, 2.4), tail: V(0, 9.5, -12.1), belly: V(0, -2.3, 0) },
    exhausts: [-10.15, -5.06, 5.06, 10.15].map((x) => V(x, 2.3, 0.2)),
  };
}

/**
 * B-36 (app/models/b36.glb): metres, nose +z, port +x. Six pusher props on
 * their hubs; the four jets ride in two pods outboard.
 */
export function buildBomber() {
  const g = cloneModel('b36');
  // a dark night finish rather than bare metal: the paint (its markings kept) and the metal parts
  // darkened to a gunmetal grey, and duller, so the sky doesn't silver them again
  g.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    if (m.userData.night || !/Fuselage|Metal/.test(m.name)) return;
    m.userData.night = true;
    m.color.setRGB(0.15, 0.155, 0.165);
    m.metalness = Math.min(m.metalness, 0.45);
    m.roughness = Math.max(m.roughness, 0.55);
    m.envMapIntensity = 0.6;
  });
  tint(g, 0x08090b);
  return {
    group: g,
    props: [0, 1, 2, 3, 4, 5].map((k) => g.getObjectByName('prop_' + k)),
    engines: [23.1, 24.5, -23.1, -24.5].map((x) => V(x, -2.6, -2.9)),
    lights: { port: V(35.1, -2.3, -1.6), stbd: V(-35.1, -2.3, -1.6), tail: V(0, 6.3, -20.9) },
  };
}

/**
 * A general-purpose bomb (app/models/bomb.glb: 2.2 m, nose +z), drawn at 2x so a
 * stick of them reads from the ground. Point it with lookAt.
 */
export function buildBomb() {
  const g = new THREE.Group();
  const m = cloneModel('bomb');
  m.scale.setScalar(2);
  g.add(m);
  return g;
}


export class AirSupport {
  constructor(arsenal) {
    this.a = arsenal;
    this.scene = arsenal.scene;
    this.fx = arsenal.fx;
    this.audio = arsenal.audio;
    this.horde = arsenal.horde;
    this.onRadio = null; // (who, text)
    this.callsign = CALL.spectre;
    this.holdFire = false;   // the gunship can't see (fog bank)
    this.priority = null;    // () => {x, z} | null — something the gunship must kill first
    this.onCrash = null;     // (x, y, z) the gunship hit the ground

    // bomber on call
    this.bomberCd = 0;
    this.marker = null;
    this.bomber = null;
    this.bombs = [];
    this.craters = [];
    const bm = buildBomber();
    bm.group.scale.setScalar(ABILITY.bomber.scale); // high up and small, like the gunship
    this.bomberModel = bm;
    this.bomberNav = new NavLights(bm, { lens: 0.14, pool: this.fx.lights });
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
    this.gsNav = new NavLights(gs, { lens: 0.13, pool: this.fx.lights, phase: 0.4 });
    gs.group.scale.setScalar(GUNSHIP.scale); // high and far: a small shape against the clouds
    this.scene.add(gs.group);
    this.inFlight = []; // gunship rounds on their way down
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────
  /** The gunship's check-in for tonight: a different one every night (COMMS.spectreIntro). */
  introLine() {
    const n = this.night || 3;
    if (this.callsign === CALL.spectre2) { const L = COMMS.spectreIntro2; return L[n] || pickLine(L.endless); }
    const L = COMMS.spectreIntro;
    return L[n] || L[Math.min(8, Math.max(3, n))];
  }

  startNight(menu = false, night = 1) {
    this.night = night;
    this.clearBomber();
    this.callsign = night > 8 ? CALL.spectre2 : CALL.spectre;
    this.holdFire = false;
    this.priority = null;
    this.gs.crash = null;
    this.bomberCd = ABILITY.bomber.firstDelay;
    this.craters.length = 0;
    this.inFlight.length = 0;
    const g = this.gs;
    g.active = true; g.leaving = 0; g.mode = 0;
    g.engageT = rand(6, 10);
    g.introDone = menu; g.radioCd = 30;
    g.theta = R() * Math.PI * 2;
    g.group.visible = true;
    // Spectre isn't on station until it's been introduced (night 3)
    if (!menu && !isUnlocked('gunship', night)) this.hide();
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

  radio(text, who = this.callsign, opts = {}) { if (this.onRadio) this.onRadio(who, text, opts); }

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
    // never on our own heads: too close to the wall and Hammer won't take it (nothing is thrown)
    if (wallDist(tx, tz) < B.minWallDist) return 'close';
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
        if (m.light) { m.light.color.setRGB(1, 0.16, 0.06); m.light.distance = 34; m.light.decay = 1.5; m.light.intensity = 0; }
        this.audio.markerIgnite(m.tx, m.tz);
        m.callT = 1.6;
      }
      return;
    }
    // burning on the ground like a road flare: a blinding pink-white core, a hard red glow
    // lighting the ground and the dead around it, sputtering sparks, a plume of red smoke
    const gy = groundH(m.tx, m.tz);
    const flick = 0.88 + R() * 0.12;
    const up = Math.min(1, m.t * 3);
    if (m.light) { m.light.position.set(m.tx, gy + 1.2, m.tz); m.light.intensity = 140 * flick * up; }
    fx.glowDot(m.tx, gy + 0.25, m.tz, 0.9 * flick, 14, 6, 5, 0.05);
    fx.glowDot(m.tx, gy + 0.35, m.tz, 2.6 * flick, 6, 0.6, 0.25, 0.05);
    fx.glowDot(m.tx, gy + 0.6, m.tz, 7 * flick, 1.1, 0.08, 0.03, 0.05);
    if (R() < 0.5) fx.flame(m.tx, gy + 0.15, m.tz, 0.35, 1.6);
    if (R() < 0.8) fx.spark(m.tx, gy + 0.2, m.tz, rand(-2, 2), rand(1.5, 4.5), rand(-2, 2), 8, 1.6, 0.6, 0.45);
    if (R() < dt * 9) {
      fx.smoke.spawn(m.tx, gy + 0.4, m.tz, rand(-0.3, 0.3) + 0.5, rand(1.2, 2.4), rand(-0.3, 0.3), rand(3.5, 6), 0.6, rand(3, 5), PF.SMOKE + ((R() * 4) | 0),
        0.55, 0.06, 0.04, 0.6, 0.14, 0.035, 0.03, -0.25, 0.4, 0, R() * 6, (R() - 0.5) * 0.3, 0.05);
    }
    if (m.callT > 0) {
      m.callT -= dt;
      if (m.callT <= 0) {
        this.radio(pickLine(COMMS.hammerIn), CALL.hammer, { valid: () => !!this.bomber && !this.bomber.released });
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
    for (const p of this.bomberModel.props) p.rotation.z += dt * 30;
    // engine glow and nav lights
    for (const e of this.bomberModel.engines) { _v.copy(e).applyMatrix4(grp.matrixWorld); fx.glowDot(_v.x, _v.y, _v.z, 1.3, 3.2, 1.4, 0.5, 0.05); }
    this.bomberNav.update(performance.now() / 1000);
    // sound: a roar that grows over the wall and tears away down the valley
    if (!b.loop && this.audio.ready) b.loop = this.audio.loop(this.audio.bomberBuf(), { ref: 140, reverb: 0.35 });
    if (b.loop) b.loop.update(x, y, z, b.dx * B.speed, 0, b.dz * B.speed, 3.2 * this.audio.bomberGain);
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
    setTimeout(() => this.radio(pickLine(kills > 25 ? COMMS.hammerGood : COMMS.hammerOff), CALL.hammer, { ttl: 7 }), 2500);
  }

  // ── AC-130 ─────────────────────────────────────────────────────────────────
  updateGunship(dt) {
    const g = this.gs;
    if (!g.active) return;
    const G = GUNSHIP;
    const grp = g.group;
    let x, y, z;
    if (g.crash) {
      // on fire, rolling off the orbit and down into the hills
      const c = g.crash;
      c.t += dt;
      g.vel.applyAxisAngle(_up, dt * 0.16);
      grp.position.addScaledVector(g.vel, dt);
      c.vy -= dt * 3.2;
      grp.position.y += c.vy * dt;
      x = grp.position.x; y = grp.position.y; z = grp.position.z;
      grp.lookAt(x + g.vel.x, y + c.vy, z + g.vel.z);
      c.roll += dt * (0.25 + c.t * 0.05);
      grp.rotateZ(-0.36 - c.roll);
      grp.updateMatrixWorld();
      const fx = this.fx;
      for (const k of [2, 3]) {
        _v.copy(g.exhausts[k]).applyMatrix4(grp.matrixWorld);
        fx.flame(_v.x, _v.y, _v.z, 3.5, 2);
        fx.glowDot(_v.x, _v.y, _v.z, 6, 9, 3.5, 0.8, 0.06);
        if (R() < 0.6) fx.smoke.spawn(_v.x, _v.y, _v.z, rand(-2, 2), rand(0, 2), rand(-2, 2), rand(5, 9), 4, 16, PF.SMOKE + ((R() * 4) | 0), 0.3, 0.12, 0.05, 0.85, 0.04, 0.035, 0.03, -0.1, 0.2, 0, R() * 6, 0.1, 0.05);
      }
      if (g.loop) g.loop.update(x, y, z, g.vel.x, c.vy, g.vel.z, 2.6 * (1 + 0.4 * Math.sin(c.t * 9)));
      const gy = groundH(x, z);
      if (y <= gy + 4 || c.t > 30) {
        if (g.loop) { g.loop.stop(0.05); g.loop = null; }
        g.active = false; g.crash = null; grp.visible = false;
        if (this.onCrash) this.onCrash(x, Math.max(gy, 0), z);
      }
      return;
    }
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
    const M = grp.matrixWorld, fx = this.fx;
    this.gsNav.update(performance.now() / 1000);
    for (const e of g.exhausts) { _v.copy(e).applyMatrix4(M); fx.glowDot(_v.x, _v.y, _v.z, 1.8, 2.2, 0.9, 0.3, 0.05); }
    // four turboprops droning overhead all night
    if (!g.loop && this.audio.ready) g.loop = this.audio.loop(this.audio.B.prop && this.audio.B.prop[0], { ref: 160, reverb: 0.4 });
    if (g.loop) g.loop.update(x, y, z, g.vel.x, g.vel.y, g.vel.z, g.leaving > 0 ? 2.6 * Math.max(0, 1 - g.leaving / 14) : 2.6);

    if (g.leaving > 0) return;
    g.radioCd -= dt;
    // engagements
    if (this.holdFire) { g.mode = 0; return; }
    if (!g.mode) {
      g.engageT -= dt;
      if (g.engageT <= 0) this.engage();
      return;
    }
    if (g.mode === 25) {
      g.burstT -= dt;
      g.acc += dt * G.gau.rate;
      while (g.acc >= 1 && g.burstT > -dt) {
        g.acc -= 1;
        // the burst walks across the target
        const u = clamp(1 - g.burstT / g.burstLen, 0, 1);
        const tx = g.tx + g.wx * (u - 0.5) + rand(-1, 1) * G.gau.scatter, tz = g.tz + g.wz * (u - 0.5) + rand(-1, 1) * G.gau.scatter;
        if (wallDist(tx, tz) > G.gau.minWall - 2) this.fire(tx, tz);
      }
      if (g.burstT <= 0) {
        // another burst on the same crowd now and then
        if (g.bursts-- > 0) this.startGau(true);
        else this.endEngagement();
      }
    } else if (g.mode === -25) {
      // between bursts: let the barrels stop, re-acquire (track the big one if it's out there)
      g.nextT -= dt;
      if (g.nextT <= 0) {
        const pr = this.priority && this.priority();
        const c = pr || this.horde.densest(G.gau.minWall, 240, 12, 7);
        if (c && (pr || Math.hypot(c.x - g.tx, c.z - g.tz) < 70)) { g.tx = c.x; g.tz = c.z; }
        this.startGau(false);
      }
    }
  }

  /** Open a GAU burst on (g.tx, g.tz); `pause` first waits a beat between bursts. */
  startGau(pause) {
    const g = this.gs, G = GUNSHIP.gau;
    if (pause) { g.mode = -25; g.nextT = rand(0.5, 1.1); return; }
    g.mode = 25;
    g.take = (R() * G.bursts.length) | 0;
    g.burstLen = g.burstT = G.bursts[g.take];
    g.acc = 1;
    const a = R() * Math.PI * 2, len = rand(10, 22);
    g.wx = Math.cos(a) * len; g.wz = Math.sin(a) * len;
    // the whole burst's sound, timed to the aircraft and to the impacts
    _v.copy(g.muzzle).applyMatrix4(g.group.matrixWorld);
    const flight = Math.hypot(g.tx - _v.x, groundH(g.tx, g.tz) - _v.y, g.tz - _v.z) / GAU_SPEED;
    this.audio.gauBurst(g.take, _v.x, _v.y, _v.z, g.tx, g.tz, flight);
  }

  engage() {
    const g = this.gs, G = GUNSHIP;
    // something big on the field takes priority
    const pr = this.priority && this.priority();
    if (pr && R() < 0.6 && wallDist(pr.x, pr.z) > G.gau.minWall) {
      g.tx = pr.x; g.tz = pr.z;
      g.bursts = 1 + ((R() * 2) | 0);
      this.startGau(false);
      return;
    }
    const c = this.horde.densest(G.gau.minWall, 240, 44, 7);
    if (!c || c.count < 2) { g.engageT = 1.5; return; }
    g.tx = c.x; g.tz = c.z;
    g.bursts = c.count >= 8 ? 1 + ((R() * 2) | 0) : (R() < 0.4 ? 1 : 0);
    this.startGau(false);
    if (!g.introDone) {
      g.introDone = true;
      g.radioCd = 35;
      this.radio(this.introLine());
      this.audio.radioStatic(0.8);
    } else if (g.radioCd <= 0 && R() < 0.35) {
      g.radioCd = 40;
      this.radio(pickLine(COMMS.spectre), this.callsign, { ttl: 10 });
    }
  }

  /** Night 8: an engine fire, and Spectre goes down in the hills. */
  crash() {
    const g = this.gs;
    if (!g.active || g.leaving > 0 || g.crash) return false;
    g.mode = 0;
    g.crash = { t: 0, vy: -2, roll: 0 };
    return true;
  }

  endEngagement() {
    const g = this.gs;
    g.mode = 0;
    g.engageT = rand(GUNSHIP.engageMin, GUNSHIP.engageMax);
  }

  fire(tx, tz) {
    const g = this.gs, fx = this.fx;
    _v.copy(g.muzzle).applyMatrix4(g.group.matrixWorld);
    const gy = groundH(tx, tz);
    const dist = _w.set(tx - _v.x, gy - _v.y, tz - _v.z).length();
    g.shots++;
    // a stream of long red-orange streaks coming down out of the dark
    if (g.shots % 2 === 0) fx.tracer(_v.x, _v.y, _v.z, tx, gy + 0.3, tz, GAU_SPEED, 2.4, 7, 2.4, 0.7, 0.22, 0.03);
    fx.glowDot(_v.x, _v.y, _v.z, 3.5, 10, 6, 3, 0.03);
    this.inFlight.push({ x: tx, z: tz, gy, t: dist / GAU_SPEED });
  }

  updateRounds(dt) {
    const G = GUNSHIP, a = this.a, fx = this.fx;
    for (let k = 0; k < this.inFlight.length; k++) {
      const r = this.inFlight[k];
      r.t -= dt;
      if (r.t > 0) continue;
      this.inFlight.splice(k, 1); k--;
      // 25 mm HE: a flash, a fountain of dirt, a small blast that throws bodies
      fx.glowDot(r.x, r.gy + 0.7, r.z, 3.2, 9, 5, 1.8, 0.09);
      fx.groundHit(r.x, r.z, true);
      if (R() < 0.45) fx.explosion(r.x, r.gy, r.z, 0.42, { scorch: R() < 0.5, light: R() < 0.1, fires: false });
      const kills = this.horde.explode(r.x, r.gy + 0.5, r.z, G.gau.radius, G.gau.damage, 'gunship', { push: 0.9 });
      if (R() < 0.12) this.audio.gunshipImpact(r.x, r.z);
      if (a.onShake) a.onShake(0.05, r.x, r.z);
      if (kills && a.onExplosionKills) a.onExplosionKills(kills, r.x, r.z, 'gunship');
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
