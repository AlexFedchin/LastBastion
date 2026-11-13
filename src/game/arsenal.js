// Everything that kills besides your own gun: artillery, Molotovs,
// grenades, danger-close, wall gunners, riflemen, claymores and wire.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WORLD, wallZ, wallDist, WING_COS, WING_SIN, ABILITY, CLAYMORE } from '../config.js';
import { clamp, rand, lerp } from '../core/util.js';
import { PF, DF } from '../world/textures.js';
import { groundH, raycastGround } from '../world/terrain.js';
import { AirSupport } from './air.js';

const R = Math.random;
const _v = new THREE.Vector3();

/** Point at perpendicular distance d in front of the wall at x. */
function offsetZ(x, d) {
  const ax = Math.abs(x);
  return wallZ(x) - (ax <= WORLD.GATE_HALF ? d : d / WING_COS);
}

/** Tapered limb segment from a to b. */
function segGeo(r0, r1, a, b) {
  const A = new THREE.Vector3(...a), Bv = new THREE.Vector3(...b);
  const len = A.distanceTo(Bv);
  const g = new THREE.CylinderGeometry(r1, r0, len, 8);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), Bv.clone().sub(A).normalize()));
  g.translate(A.x, A.y, A.z);
  return g;
}
function boxGeo(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) { const g = new THREE.BoxGeometry(w, h, d); g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz); g.translate(x, y, z); return g; }
function mergeCrew(list) {
  return mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal'].includes(k)) g.deleteAttribute(k); return g; }));
}

const GUNNER_POSTS = [-27, 27, -52, 52];
// riflemen along the wings, clear of the gun nest and the M240 firing steps.
// Atmosphere first: weak, inaccurate, and they spread their fire around.
const RIFLE_POSTS = [-15, 16, -38.5, 39.5, -63, 64];
const RIFLE = { damage: 5, spread: 0.05, mag: 30, range: 75 };

export class Arsenal {
  constructor(scene, fx, audio, horde, env) {
    this.scene = scene;
    this.fx = fx;
    this.audio = audio;
    this.horde = horde;
    this.env = env;
    this.shells = [];   // artillery rounds in flight
    this.grenades = [];
    this.artyCd = 0;
    this.molotovsLeft = 0;
    this.molotovCd = 0;
    this.molotovs = [];   // bottles in the air (or being lit)
    this.pools = [];      // burning fuel on the ground
    this.grenadesLeft = 0;
    this.grenadeCd = 0;
    this.dangerUsed = false;
    this.mines = [];
    this.minesOwned = 0;
    this.onExplosionKills = null; // (kills, x, z, source)
    this.onShake = null;          // (amount, x, z)
    this.onMessage = null;        // (text, kind)

    // grenade meshes
    const gGeo = new THREE.SphereGeometry(0.09, 8, 6);
    const gMat = new THREE.MeshStandardMaterial({ color: 0x2f3324, roughness: 0.7 });
    this.grenadeMeshes = [];
    for (let k = 0; k < 12; k++) {
      const m = new THREE.Mesh(gGeo, gMat);
      m.visible = false;
      scene.add(m);
      this.grenadeMeshes.push(m);
    }

    // Molotovs: a dark glass bottle, the rag stuffed in its neck burning
    const prof = [[0, 0], [0.043, 0], [0.046, 0.01], [0.046, 0.15], [0.04, 0.18], [0.017, 0.205], [0.016, 0.27], [0.019, 0.275], [0, 0.275]]
      .map(([r, y]) => new THREE.Vector2(r, y - 0.13));
    const bottleGeo = new THREE.LatheGeometry(prof, 10);
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x2c3a22, roughness: 0.12, metalness: 0.2, emissive: 0x2a0d02, emissiveIntensity: 0.6 });
    const ragGeo = new THREE.CylinderGeometry(0.022, 0.03, 0.09, 6);
    ragGeo.translate(0, 0.17, 0);
    ragGeo.rotateZ(0.25);
    const ragMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.0, 0.25) });
    this.bottleMeshes = [];
    for (let k = 0; k < 6; k++) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(bottleGeo, glassMat), new THREE.Mesh(ragGeo, ragMat));
      g.scale.setScalar(1.5); // read from the gun at 60 m
      g.visible = false;
      scene.add(g);
      this.bottleMeshes.push(g);
    }
    this._rag = new THREE.Vector3(0, 0.2, 0);

    // claymores
    const mineGeo = new THREE.BoxGeometry(0.24, 0.16, 0.06);
    const mineMat = new THREE.MeshStandardMaterial({ color: 0x3b4128, roughness: 0.8 });
    this.mineMesh = new THREE.InstancedMesh(mineGeo, mineMat, CLAYMORE.max);
    this.mineMesh.count = 0;
    this.mineMesh.frustumCulled = false;
    scene.add(this.mineMesh);

    this.buildGunners();
    this.buildRiflemen();
    this.buildWire();
    this.air = new AirSupport(this);
  }

  // ── Night lifecycle ──────────────────────────────────────────────────────
  startNight(stats, menu = false, night = 1) {
    this.stats = stats;
    this.air.startNight(menu, night);
    this.artyCd = 6;
    this.molotovsLeft = stats.molotovs;
    this.molotovCd = 0;
    this.grenadesLeft = stats.grenades;
    this.grenadeCd = 0;
    this.dangerUsed = false;
    this.shells.length = 0;
    this.grenades.length = 0;
    this.clearMolotovs();
    this.placeMines();
    this.setGunners(stats.gunners);
    this.setWire(stats.wireBands, stats.wireHp);
    this.horde.ctx.fireAt = (x, z) => (this.pools.length ? this.fireAt(x, z) : 0);
    this.horde.ctx.wireAt = (x, dist, w, dt) => this.wireAt(x, dist, w, dt);
  }

  endNight() {
    this.air.endNight();
    this.clearMolotovs();
    for (const m of this.grenadeMeshes) m.visible = false;
    this.grenades.length = 0;
    this.shells.length = 0;
  }

  // ── Artillery ────────────────────────────────────────────────────────────
  callArtillery(target) {
    const s = this.stats;
    if (this.artyCd > 0) return false;
    this.artyCd = s.artyCooldown;
    const n = s.artyShells;
    const spreadR = 8 + n * 1.1;
    for (let k = 0; k < n; k++) {
      const a = R() * Math.PI * 2, r = Math.sqrt(R()) * spreadR;
      this.shells.push({
        kind: 'arty', x: target.x + Math.cos(a) * r, z: target.z + Math.sin(a) * r,
        t: 2.4 + k * 0.22 + R() * 0.25, r: s.artyRadius, dmg: s.artyDamage, scale: 2.2, whistled: false, streak: false,
      });
    }
    // red marker smoke on the target
    this.marker = { x: target.x, z: target.z, t: 3.2 };
    this.audio.radioStatic(0.3);
    return true;
  }

  dangerClose() {
    if (this.dangerUsed) return false;
    this.dangerUsed = true;
    const D = ABILITY.dangerClose;
    for (let k = 0; k < D.shells; k++) {
      let x;
      do { x = rand(-70, 70); } while (Math.abs(x) < 10);
      const d = rand(2.5, 26);
      this.shells.push({
        kind: 'danger', x, z: offsetZ(x, d), t: 1.8 + R() * 3.8, r: D.radius, dmg: D.damage, scale: 1.5, whistled: false, streak: false,
      });
    }
    this.audio.klaxon();
    return true;
  }

  // ── Molotovs ─────────────────────────────────────────────────────────────
  /**
   * Light the rag and throw a bottle at the crosshair. 'empty' / 'rearm' / true.
   * The Zippo goes first; the bottle leaves the hand a beat later.
   */
  throwMolotov(target) {
    if (this.molotovsLeft <= 0) return 'empty';
    if (this.molotovCd > 0) return 'rearm';
    const mesh = this.bottleMeshes.find((m) => !m.visible && !this.molotovs.some((b) => b.mesh === m));
    if (!mesh) return 'rearm';
    const M = ABILITY.molotov;
    this.molotovsLeft--;
    this.molotovCd = M.rearm;
    this.audio.molotovLight();
    const cx = WORLD.CAM.x, cz = WORLD.CAM.z;
    let dx = target.x - cx, dz = target.z - cz;
    const d = Math.hypot(dx, dz) || 1;
    if (d > M.maxRange) { dx *= M.maxRange / d; dz *= M.maxRange / d; }
    const dd = Math.min(d, M.maxRange);
    const tx = cx + dx + rand(-0.7, 0.7), tz = cz + dz + rand(-0.7, 0.7);
    // thrown from the left hand, past the gun
    this.molotovs.push({
      mesh, t: -M.light, launched: false, light: null,
      sx: cx - 0.45, sy: WORLD.CAM.y + 0.15, sz: cz - 0.7, tx, tz,
      dur: 0.85 + dd * 0.015, arc: 3.5 + dd * 0.11, spin: rand(-7, 7), dirx: dx / d, dirz: dz / d,
    });
    return true;
  }

  /** Burning damage per second at a point (horde calls it for every zombie), 0 if none. */
  fireAt(x, z) {
    const P = this.pools;
    let best = 0;
    for (let k = 0; k < P.length; k++) {
      const p = P[k];
      if (p.k <= 0.15) continue;
      const dx = x - p.cx, dz = z - p.cz;
      if (dx * dx + dz * dz < p.r2 && p.dps * p.k > best) best = p.dps * p.k;
    }
    return best;
  }

  updateMolotovs(dt) {
    const fx = this.fx;
    for (let k = 0; k < this.molotovs.length; k++) {
      const b = this.molotovs[k];
      b.t += dt;
      if (b.t < 0) continue; // still lighting the rag
      const m = b.mesh;
      if (!b.launched) {
        b.launched = true;
        m.visible = true;
        this.audio.molotovThrow();
        b.light = fx.lights.acquire();
        if (b.light) { b.light.color.setRGB(1, 0.55, 0.2); b.light.distance = 16; b.light.decay = 1.8; }
      }
      const u = Math.min(1, b.t / b.dur);
      const x = lerp(b.sx, b.tx, u), z = lerp(b.sz, b.tz, u);
      const y = lerp(b.sy, groundH(b.tx, b.tz) + 0.15, u) + Math.sin(u * Math.PI) * b.arc;
      m.position.set(x, y, z);
      m.rotation.x += dt * 9;
      m.rotation.z += dt * b.spin;
      m.updateMatrixWorld();
      _v.copy(this._rag).applyMatrix4(m.matrixWorld);
      // the rag streams fire behind it
      fx.flame(_v.x, _v.y, _v.z, 0.32, 1.2);
      fx.glowDot(_v.x, _v.y, _v.z, 0.7, 3.2, 1.3, 0.35, 0.05);
      if (R() < 0.35) fx.ember(_v.x, _v.y, _v.z);
      if (b.light) { b.light.position.copy(_v); b.light.intensity = 40 + R() * 30; }
      if (u >= 1) {
        m.visible = false;
        if (b.light) { fx.lights.release(b.light); b.light = null; }
        this.splash(b.tx, b.tz, b.dirx, b.dirz);
        this.molotovs.splice(k, 1); k--;
      }
    }
  }

  /** The bottle bursts: glass, a sheet of burning fuel thrown forward, and a pool that burns. */
  splash(x, z, dirx, dirz) {
    const fx = this.fx, s = this.stats, M = ABILITY.molotov;
    const gy = groundH(x, z);
    const r = s.molotovRadius;
    this.audio.molotov(x, z);
    // glass
    for (let k = 0; k < 18; k++) {
      const a = R() * 6.28, sp = rand(2, 7);
      fx.glow.spawn(x, gy + 0.25, z, Math.cos(a) * sp, rand(1.5, 5), Math.sin(a) * sp, rand(0.35, 0.8), 0.05, 0.03, PF.SPARK,
        2.6, 3.0, 2.6, 1, 0.4, 0.5, 0.4, 16, 0.4, 0.012, 0, 0, 0, gy);
    }
    // the whoomph: a ball of flame rolling up off the ground
    fx.glow.spawn(x, gy + 1.2, z, 0, 0, 0, 0.22, 2.5 * r / 4.2, 7 * r / 4.2, PF.GLOW, 6, 3, 0.9, 1, 2, 0.6, 0.1);
    for (let k = 0; k < 14; k++) {
      const a = R() * 6.28, sp = rand(1, 3.5);
      fx.glow.spawn(x + dirx * rand(0, r * 0.6), gy + 0.5, z + dirz * rand(0, r * 0.6), Math.cos(a) * sp + dirx * 2, rand(3, 7), Math.sin(a) * sp + dirz * 2,
        rand(0.6, 1.1), rand(1.4, 2.2), rand(3.5, 5.5), PF.FIRE + ((R() * 4) | 0), 5, 2.5, 0.8, 1, 1.1, 0.22, 0.04, -2, 1.6, 0, R() * 6, (R() - 0.5) * 2, 0);
    }
    // burning fuel flung forward along the throw, raining back down
    for (let k = 0; k < 40; k++) {
      const a = Math.atan2(dirz, dirx) + (R() - 0.5) * 2.4, sp = rand(3, 10);
      fx.glow.spawn(x, gy + 0.35, z, Math.cos(a) * sp, rand(2, 6), Math.sin(a) * sp, rand(0.5, 1.0), rand(0.35, 0.7), rand(0.8, 1.4),
        PF.FIRE + ((R() * 4) | 0), 5, 2.2, 0.6, 1, 1.4, 0.3, 0.05, 11, 0.8, 0, R() * 6, (R() - 0.5) * 3, 0, gy + 0.1);
    }
    fx.smokePuff(x, gy + 2, z, 3, 0.04, 5, 2.5);
    fx.lights.flash(x, gy + 2.2, z, 0xff8a3c, 420, 36, 0.55, 0.3);
    fx.decals.add(x + dirx * r * 0.3, z + dirz * r * 0.3, r * 2.3, DF.SCORCH + ((R() * 2) | 0), 1, 1, 1);
    // the pool: one big fire, smaller ones spread forward and to the sides
    const life = s.molotovBurn * rand(0.92, 1.08);
    const cx = x + dirx * r * 0.3, cz = z + dirz * r * 0.3;
    const pool = { cx, cz, gy, r, r2: r * r, dps: s.molotovDps, t: 0, life, k: 0, fires: [], light: null, snd: null, acc: 0 };
    const fire = fx.fire, sc = r / 4.2;
    if (fire) {
      const add = (px, pz, w, h, fade) => {
        const id = fire.add(px, groundH(px, pz) - 0.05, pz, w, h, 0.95, { smoke: 0.6, embers: 2.2, life: life + rand(-1, 1.2), fadeIn: fade });
        if (id >= 0) pool.fires.push(id);
      };
      add(cx, cz, 3.0 * sc, 4.8 * sc, 0.08);
      const px = -dirz, pz = dirx; // across the throw
      for (let k = 0; k < 9; k++) {
        const along = rand(-0.55, 1.05) * r, across = (R() - 0.5) * 1.3 * r * (1 - Math.abs(along) / (r * 1.6));
        // the middle of the splash burns tallest, the fringes lick low
        const edge = Math.min(1, Math.hypot(along - r * 0.3, across) / r);
        add(x + dirx * along + px * across, z + dirz * along + pz * across, rand(1.4, 2.3) * sc, rand(2.6, 4.4) * sc * (1 - 0.45 * edge), rand(0.05, 0.4));
      }
    }
    pool.light = fx.lights.acquire();
    if (pool.light) { pool.light.color.setRGB(1, 0.48, 0.14); pool.light.distance = 30; pool.light.decay = 1.7; pool.light.position.set(cx, gy + 1.6, cz); }
    // too many fires: the oldest one burns out sooner
    if (this.pools.length >= M.maxPools) this.pools[0].life = Math.min(this.pools[0].life, this.pools[0].t + 1.5);
    this.pools.push(pool);
    // whoever was standing in it goes up at once
    const h = this.horde, n = h.queryRadius(cx, cz, r, h._q);
    for (let q = 0; q < n; q++) {
      const i = h._q[q];
      h.ignite(i, M.igniteSeconds + 1, M.igniteDps);
      h.damage(i, 12, 'fire', 0, 1, 0);
    }
  }

  updatePools(dt) {
    const fx = this.fx, fire = fx.fire;
    let level = 0;
    for (let k = 0; k < this.pools.length; k++) {
      const p = this.pools[k];
      p.t += dt;
      p.k = clamp((p.life - p.t) / 2.5, 0, 1) * Math.min(1, p.t / 0.15);
      level += p.k;
      if (fire) for (const id of p.fires) fire.set(id, 0.95 * (0.78 + R() * 0.4));
      // flames licking up across the pool, oily smoke, embers
      p.acc += dt * 32 * p.k * (p.r / 4.2);
      while (p.acc >= 1) {
        p.acc -= 1;
        const a = R() * 6.28, rr = Math.sqrt(R()) * p.r * 0.85;
        const x = p.cx + Math.cos(a) * rr, z = p.cz + Math.sin(a) * rr;
        fx.flame(x, groundH(x, z) + 0.15, z, rand(0.8, 1.3), 3.8);
      }
      // a column of fuel smoke, lit orange from beneath, cooling to soot as it climbs
      if (R() < dt * 7 * p.k) {
        const a = R() * 6.28, rr = R() * p.r * 0.5;
        fx.smoke.spawn(p.cx + Math.cos(a) * rr, p.gy + rand(2.5, 4), p.cz + Math.sin(a) * rr, rand(-0.4, 0.4) + 0.5, rand(2.4, 4), rand(-0.4, 0.4),
          rand(4, 6.5), rand(1.6, 2.6), rand(6, 10), PF.SMOKE + ((R() * 4) | 0), 0.34, 0.14, 0.045, 0.8, 0.035, 0.032, 0.03,
          -0.15, 0.35, 0, R() * 6, (R() - 0.5) * 0.3, 0.1);
      }
      if (R() < dt * 10 * p.k) fx.ember(p.cx + rand(-p.r, p.r) * 0.7, p.gy + 1.5, p.cz + rand(-p.r, p.r) * 0.7);
      if (p.light) p.light.intensity = (150 + R() * 110) * p.k * (p.r / 4.2);
      // sound: the closest few roar on their own, the rest are the bed
      if (!p.snd && p.k > 0.3 && this.pools.filter((o) => o.snd).length < 4) p.snd = this.audio.firePool();
      if (p.snd) p.snd.update(p.cx, p.gy + 1, p.cz, 0, 0, 0, 1.6 * p.k);
      if (R() < dt * 1.4 * p.k) this.audio.crackle(p.cx, p.cz, 0.3);
      if (p.t >= p.life) { this.endPool(p); this.pools.splice(k, 1); k--; }
    }
    this.audio.fireLevel = clamp(level * 0.3, 0, 1);
  }

  endPool(p) {
    if (p.light) { this.fx.lights.release(p.light); p.light = null; }
    if (p.snd) { p.snd.stop(1.2); p.snd = null; }
    if (this.fx.fire) for (const id of p.fires) this.fx.fire.remove(id);
    p.fires.length = 0;
  }

  clearMolotovs() {
    for (const b of this.molotovs) { b.mesh.visible = false; if (b.light) this.fx.lights.release(b.light); }
    this.molotovs.length = 0;
    for (const p of this.pools) this.endPool(p);
    this.pools.length = 0;
    this.audio.fireLevel = 0;
  }

  // ── Grenades ─────────────────────────────────────────────────────────────
  /** One grenade at the crosshair. 'empty' / 'rearm' / true. */
  throwGrenade(target) {
    if (this.grenadesLeft <= 0) return 'empty';
    if (this.grenadeCd > 0) return 'rearm';
    const mesh = this.grenadeMeshes.find((m) => !m.visible);
    if (!mesh) return 'rearm';
    const G = ABILITY.grenade;
    this.grenadesLeft--;
    this.grenadeCd = G.rearm;
    this.audio.throwGrenade();
    // clamp range
    const cx = WORLD.CAM.x, cz = WORLD.CAM.z;
    let dx = target.x - cx, dz = target.z - cz;
    const d = Math.hypot(dx, dz);
    if (d > G.maxRange) { dx *= G.maxRange / d; dz *= G.maxRange / d; }
    const dd = Math.min(d, G.maxRange);
    mesh.visible = true;
    const tx = cx + dx + rand(-0.8, 0.8), tz = cz + dz + rand(-0.8, 0.8);
    this.grenades.push({ mesh, sx: rand(0.1, 0.5), sy: WORLD.CAM.y + 0.2, sz: WORLD.CAM.z - 0.8, tx, tz, t: 0, dur: 0.8 + dd * 0.014, arc: 4 + dd * 0.12 });
    return true;
  }

  // ── Gunners ──────────────────────────────────────────────────────────────
  buildGunners() {
    this.gunners = [];
    const body = new THREE.MeshStandardMaterial({ color: 0x3a3f2c, roughness: 0.92 });
    const gear = new THREE.MeshStandardMaterial({ color: 0x2b3022, roughness: 0.8 });
    const helm = new THREE.MeshStandardMaterial({ color: 0x353b2a, roughness: 0.6, metalness: 0.15 });
    const skin = new THREE.MeshStandardMaterial({ color: 0x5a4a3e, roughness: 0.7 });
    const gunM = new THREE.MeshStandardMaterial({ color: 0x1a1b1c, roughness: 0.5, metalness: 0.7 });
    const seg = segGeo, bx = boxGeo, mg = mergeCrew;
    this.crewMats = { body, gear, helm, skin, gunM };
    // leaning into the parapet, shouldering a light machine gun
    const bodyGeo = mg([
      seg(0.075, 0.065, [0.12, 0.0, 0.25], [0.12, 0.48, 0.12]), seg(0.065, 0.055, [0.12, 0.48, 0.12], [0.11, 0.9, 0.1]),
      seg(0.075, 0.065, [-0.12, 0.0, 0.35], [-0.12, 0.45, 0.3]), seg(0.065, 0.055, [-0.12, 0.45, 0.3], [-0.11, 0.9, 0.12]),
      seg(0.17, 0.2, [0, 0.88, 0.12], [0, 1.3, -0.02]),
      seg(0.05, 0.045, [0.2, 1.28, -0.02], [0.2, 1.08, -0.25]), seg(0.045, 0.04, [0.2, 1.08, -0.25], [0.12, 1.14, -0.45]),
      seg(0.05, 0.045, [-0.2, 1.28, -0.02], [-0.16, 1.1, -0.2]), seg(0.045, 0.04, [-0.16, 1.1, -0.2], [0.08, 1.12, -0.12]),
    ]);
    const gearGeo = mg([
      bx(0.42, 0.34, 0.3, 0, 1.12, 0.04, -0.3), bx(0.08, 0.09, 0.05, -0.1, 1.0, -0.12, -0.3), bx(0.08, 0.09, 0.05, 0.0, 1.0, -0.13, -0.3), bx(0.08, 0.09, 0.05, 0.1, 1.0, -0.12, -0.3),
      bx(0.32, 0.38, 0.16, 0, 1.2, 0.26, -0.3), bx(0.12, 0.08, 0.26, 0, 0.3, 0.28),
      bx(0.1, 0.05, 0.24, 0.12, 0.03, 0.29), bx(0.1, 0.05, 0.24, -0.12, 0.03, 0.39),
    ]);
    const helmGeo = mg([
      (() => { const g = new THREE.SphereGeometry(0.15, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2); g.scale(1, 0.85, 1.12); g.translate(0, 1.43, -0.06); return g; })(),
      bx(0.06, 0.05, 0.04, 0, 1.5, -0.2), bx(0.05, 0.05, 0.08, 0, 1.45, -0.24),
    ]);
    const headGeo = mg([(() => { const g = new THREE.SphereGeometry(0.11, 10, 8); g.translate(0, 1.38, -0.07); return g; })()]);
    const lmgGeo = mg([
      bx(0.07, 0.11, 0.42, 0.12, 1.16, -0.42), bx(0.05, 0.12, 0.22, 0.12, 1.12, -0.05, 0.25),
      seg(0.016, 0.016, [0.12, 1.17, -0.62], [0.12, 1.17, -1.15]), seg(0.022, 0.018, [0.12, 1.17, -1.08], [0.12, 1.17, -1.15]),
      bx(0.1, 0.07, 0.14, 0.05, 1.11, -0.42), bx(0.02, 0.05, 0.02, 0.12, 1.24, -0.55),
      seg(0.008, 0.008, [0.12, 1.12, -0.9], [0.06, 0.92, -1.0]), seg(0.008, 0.008, [0.12, 1.12, -0.9], [0.18, 0.92, -1.0]),
    ]);
    for (const px of GUNNER_POSTS) {
      const g = new THREE.Group();
      for (const [geo, m] of [[bodyGeo, body], [gearGeo, gear], [helmGeo, helm], [headGeo, skin], [lmgGeo, gunM]]) g.add(new THREE.Mesh(geo, m));
      const x = px, z = wallZ(px);
      const nx = px > 0 ? 0.482 : -0.482;
      g.position.set(x + nx * 1.35, WORLD.WALL_H - 0.08, z + 0.876 * 1.35);
      g.visible = false;
      this.scene.add(g);
      const muzzle = new THREE.Object3D(); muzzle.position.set(0.12, 1.15, -1.15); g.add(muzzle);
      this.gunners.push({ group: g, muzzle, x, z, active: false, target: -1, targetId: 0, retarget: 0, burst: 0, pause: 0, acc: 0, shots: 0, yaw: Math.atan2(-nx, -0.876) });
    }
  }

  setGunners(count) {
    this.gunners.forEach((g, i) => { g.active = i < count; g.group.visible = g.active; });
  }

  updateGunners(dt) {
    const h = this.horde, s = this.stats;
    for (const g of this.gunners) {
      if (!g.active) continue;
      g.retarget -= dt;
      if (g.retarget <= 0 || g.target < 0 || g.target >= h.n || h.id[g.target] !== g.targetId || h.dead[g.target]) {
        g.retarget = 0.3;
        g.target = -1;
        let best = 1e9;
        for (let i = 0; i < h.n; i++) {
          if (h.dead[i]) continue;
          const dx = h.x[i] - g.x, dz = h.z[i] - g.z;
          const d2 = dx * dx + dz * dz;
          if (d2 > 90 * 90) continue;
          const wd = wallDist(h.x[i], h.z[i]);
          const lateral = Math.abs(h.x[i] - g.x);
          const score = wd * 1.2 - h.y[i] * 6 + Math.sqrt(d2) * 0.25 + lateral * 0.5 + (h.type[i] === 3 ? -20 : h.type[i] === 2 && wd < 25 ? -10 : 0) + Math.random() * 12;
          if (score < best) { best = score; g.target = i; }
        }
        if (g.target >= 0) g.targetId = h.id[g.target];
      }
      if (g.target < 0) continue;
      const i = g.target;
      // aim model
      const tx = h.x[i], tz = h.z[i];
      const want = Math.atan2(-(tx - g.group.position.x), -(tz - g.group.position.z));
      let dy = want - g.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      g.yaw += dy * Math.min(1, dt * 10);
      g.group.rotation.y = g.yaw;
      // bursts
      if (g.pause > 0) { g.pause -= dt; continue; }
      g.acc += dt * s.gunnerRate;
      while (g.acc >= 1) {
        g.acc -= 1;
        this.gunnerShot(g, i);
        g.burst++;
        if (g.burst >= 7) { g.burst = 0; g.pause = rand(0.35, 0.8); g.acc = 0; break; }
      }
    }
  }

  gunnerShot(g, i) {
    const h = this.horde, s = this.stats, fx = this.fx;
    g.group.updateMatrixWorld();
    g.muzzle.getWorldPosition(_v);
    const ox = _v.x, oy = _v.y, oz = _v.z;
    const ty = h.y[i] + 1.1 * h.scale[i] + rand(-0.3, 0.5);
    let dx = h.x[i] - ox, dy = ty - oy, dz = h.z[i] - oz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const sp = s.gunnerSpread;
    dx = dx / d + (R() - 0.5) * sp * 2; dy = dy / d + (R() - 0.5) * sp * 2; dz = dz / d + (R() - 0.5) * sp * 2;
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz); dx /= l; dy /= l; dz /= l;
    const gt = raycastGround(ox, oy, oz, dx, dy, dz, 300);
    const groundT = gt >= 0 ? gt : 300;
    const cnt = h.raycast(ox, oy, oz, dx, dy, dz, Math.min(groundT, 300), 1);
    let endT = Math.min(groundT, 300);
    if (cnt > 0 && h.hitT[0] < endT) {
      const j = h.hitIdx[0];
      endT = h.hitT[0];
      const head = h.hitFrac[0] > 0.83;
      h.damage(j, s.gunnerDamage * (head ? 2 : 1), 'gunner', dx, dy, dz, head);
      fx.fleshHit(ox + dx * endT, oy + dy * endT, oz + dz * endT, dx, dy, dz, 0.8);
    } else if (groundT < 300) {
      fx.groundHit(ox + dx * endT, oz + dz * endT);
    }
    g.shots++;
    if (g.shots % 2 === 0) fx.tracer(ox, oy, oz, ox + dx * endT, oy + dy * endT, oz + dz * endT, 480, 0.9, 6.5, 1.4, 0.6);
    fx.muzzle(ox, oy, oz, dx, dy, dz, 0.6);
    if (g.shots % 2 === 0) this.audio.wallGun(ox, oz);
  }

  // ── Riflemen ─────────────────────────────────────────────────────────────
  buildRiflemen() {
    this.riflemen = [];
    const { body, gear, helm, skin, gunM } = this.crewMats;
    const seg = segGeo, bx = boxGeo, mg = mergeCrew;
    const SH = 1.36; // shoulder pivot: arms and rifle swing about it
    // standing at the parapet, left foot forward
    const bodyGeo = mg([
      seg(0.08, 0.075, [0.1, 0.0, 0.18], [0.1, 0.47, 0.1]), seg(0.08, 0.095, [0.1, 0.47, 0.1], [0.1, 0.92, 0.06]),
      seg(0.08, 0.075, [-0.1, 0.0, -0.16], [-0.1, 0.47, -0.08]), seg(0.08, 0.095, [-0.1, 0.47, -0.08], [-0.1, 0.92, 0.04]),
      seg(0.16, 0.19, [0, 0.9, 0.05], [0, 1.4, -0.03]),
      bx(0.1, 0.05, 0.24, 0.1, 0.03, 0.12), bx(0.1, 0.05, 0.24, -0.1, 0.03, -0.2),
    ]);
    const gearGeo = mg([
      bx(0.4, 0.36, 0.3, 0, 1.18, 0.0, -0.1),
      bx(0.08, 0.1, 0.05, -0.1, 1.06, -0.16, -0.1), bx(0.08, 0.1, 0.05, 0.0, 1.06, -0.16, -0.1), bx(0.08, 0.1, 0.05, 0.1, 1.06, -0.16, -0.1),
      bx(0.3, 0.34, 0.15, 0, 1.2, 0.22, -0.1), bx(0.38, 0.06, 0.28, 0, 0.92, 0.04),
    ]);
    const helmGeo = mg([
      (() => { const g = new THREE.SphereGeometry(0.145, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2); g.scale(1, 0.85, 1.1); g.translate(0, 1.64, -0.04); return g; })(),
      bx(0.06, 0.05, 0.04, 0, 1.71, -0.18),
    ]);
    const headGeo = mg([(() => { const g = new THREE.SphereGeometry(0.105, 10, 8); g.translate(0, 1.59, -0.05); return g; })()]);
    // arms + rifle, modelled around the shoulder pivot (y = 0 at the shoulder)
    const armsGeo = mg([
      seg(0.05, 0.045, [0.2, 0, 0.02], [0.24, -0.16, -0.14]), seg(0.045, 0.04, [0.24, -0.16, -0.14], [0.08, 0.0, -0.22]),
      seg(0.05, 0.045, [-0.2, 0, 0.02], [-0.16, -0.17, -0.28]), seg(0.045, 0.04, [-0.16, -0.17, -0.28], [0.02, 0.02, -0.46]),
    ]);
    const rifleGeo = mg([
      bx(0.05, 0.08, 0.36, 0.05, 0.06, -0.3), bx(0.045, 0.07, 0.22, 0.05, 0.03, 0.0), bx(0.03, 0.05, 0.03, 0.05, 0.13, -0.24),
      bx(0.03, 0.15, 0.06, 0.05, -0.05, -0.3, 0.25), bx(0.03, 0.09, 0.04, 0.05, -0.02, -0.15, -0.3),
      bx(0.055, 0.06, 0.22, 0.05, 0.06, -0.58),
      seg(0.011, 0.011, [0.05, 0.065, -0.69], [0.05, 0.065, -0.92]),
    ]);
    const deckY = WORLD.WALL_H - 0.9;
    for (const px of RIFLE_POSTS) {
      const g = new THREE.Group();
      for (const [geo, m] of [[bodyGeo, body], [gearGeo, gear], [helmGeo, helm], [headGeo, skin]]) g.add(new THREE.Mesh(geo, m));
      const arms = new THREE.Group();
      arms.position.set(0, SH, 0);
      arms.add(new THREE.Mesh(armsGeo, body), new THREE.Mesh(rifleGeo, gunM));
      const muzzle = new THREE.Object3D(); muzzle.position.set(0.05, 0.065, -0.93); arms.add(muzzle);
      g.add(arms);
      const nx = px > 0 ? WING_SIN : -WING_SIN, nz = WING_COS; // inward wall normal
      const x = px + nx * 1.0, z = wallZ(px) + nz * 1.0;
      g.position.set(x, deckY, z);
      g.scale.setScalar(rand(0.95, 1.05));
      const home = Math.atan2(nx, nz); // facing out over the wall
      g.rotation.y = home;
      this.scene.add(g);
      this.riflemen.push({
        group: g, arms, muzzle, x, z, home, yaw: home, pitch: -0.25, target: -1, targetId: 0,
        retarget: rand(0, 1), shotT: rand(0.5, 2), burst: 0, ammo: 5 + ((RIFLE.mag * R()) | 0), reload: 0, kick: 0,
      });
    }
  }

  updateRiflemen(dt) {
    const h = this.horde;
    for (const r of this.riflemen) {
      r.kick = Math.max(0, r.kick - dt * 9);
      r.retarget -= dt;
      if (r.target >= 0 && (r.target >= h.n || h.id[r.target] !== r.targetId || h.dead[r.target])) { r.target = -1; r.retarget = Math.min(r.retarget, rand(0.15, 0.5)); }
      if (r.retarget <= 0) {
        // pick a random contact in the field ahead: spread the fire, cheap to find
        r.retarget = rand(0.8, 1.6);
        const cx = r.x - Math.sin(r.home) * 32, cz = r.z - Math.cos(r.home) * 32;
        const n = h.queryRadius(cx, cz, 38, h._q);
        r.target = n ? h._q[(R() * n) | 0] : -1;
        if (r.target >= 0) r.targetId = h.id[r.target];
      }
      let wantYaw = r.home, wantPitch = -0.3;
      const i = r.target;
      if (i >= 0) {
        const dx = h.x[i] - r.x, dz = h.z[i] - r.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        let dy = Math.atan2(-dx, -dz) - r.home; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        if (d > RIFLE.range || Math.abs(dy) > 1.1) { r.target = -1; r.retarget = Math.min(r.retarget, 0.2); }
        else {
          wantYaw = r.home + dy;
          wantPitch = clamp(Math.atan2(h.y[i] + h.scale[i] - (r.group.position.y + 1.4), d), -0.35, 0.15);
        }
      }
      if (r.reload > 0) { r.reload -= dt; wantPitch = -0.85; }
      r.yaw += (wantYaw - r.yaw) * Math.min(1, dt * 4);
      r.pitch += (wantPitch - r.pitch) * Math.min(1, dt * (r.reload > 0 ? 5 : 7));
      r.group.rotation.y = r.yaw;
      r.arms.rotation.x = r.pitch + r.kick * 0.09;
      r.arms.position.z = r.kick * 0.045;
      if (r.target < 0 || r.reload > 0) continue;
      r.shotT -= dt;
      if (r.shotT > 0) continue;
      this.rifleShot(r, r.target);
      r.kick = 1;
      if (--r.ammo <= 0) { r.ammo = RIFLE.mag; r.reload = rand(2.4, 3.6); r.burst = 0; r.shotT = rand(0.3, 0.8); continue; }
      if (++r.burst >= 2 + ((R() * 5) | 0)) { r.burst = 0; r.shotT = rand(0.7, 2.2); }
      else r.shotT = rand(0.16, 0.42);
    }
  }

  rifleShot(r, i) {
    const h = this.horde, fx = this.fx;
    r.group.updateMatrixWorld();
    r.muzzle.getWorldPosition(_v);
    const ox = _v.x, oy = _v.y, oz = _v.z;
    const ty = h.y[i] + 1.1 * h.scale[i] + rand(-0.4, 0.5);
    let dx = h.x[i] - ox, dy = ty - oy, dz = h.z[i] - oz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const sp = RIFLE.spread;
    dx = dx / d + (R() - 0.5) * sp * 2; dy = dy / d + (R() - 0.5) * sp * 2; dz = dz / d + (R() - 0.5) * sp * 2;
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz); dx /= l; dy /= l; dz /= l;
    const gt = raycastGround(ox, oy, oz, dx, dy, dz, 200);
    let endT = gt >= 0 ? gt : 200;
    const cnt = h.raycast(ox, oy, oz, dx, dy, dz, endT, 1);
    if (cnt > 0 && h.hitT[0] < endT) {
      endT = h.hitT[0];
      const head = h.hitFrac[0] > 0.83;
      h.damage(h.hitIdx[0], RIFLE.damage * (head ? 2 : 1), 'rifle', dx, dy, dz, head);
      fx.fleshHit(ox + dx * endT, oy + dy * endT, oz + dz * endT, dx, dy, dz, 0.5);
    } else if (gt >= 0) fx.groundHit(ox + dx * endT, oz + dz * endT);
    if (R() < 0.6) fx.tracer(ox, oy, oz, ox + dx * endT, oy + dy * endT, oz + dz * endT, 560, 0.55, 6.5, 1.6, 0.6);
    fx.muzzle(ox, oy, oz, dx, dy, dz, 0.3);
    this.audio.rifle(ox, oz);
  }

  // ── Claymores ────────────────────────────────────────────────────────────
  placeMines() {
    // keep untriggered ones, top up from stock
    while (this.mines.length < this.minesOwned) {
      let x;
      do { x = rand(-66, 66); } while (Math.abs(x) < 11);
      const d = rand(13, 70);
      this.mines.push({ x, z: offsetZ(x, d), armed: true, fuse: -1, blink: R() * 2 });
    }
    this.syncMineMesh();
  }

  syncMineMesh() {
    const m = new THREE.Matrix4();
    this.mines.forEach((mine, i) => {
      m.makeRotationY(Math.atan2(-mine.x, -mine.z) + Math.PI);
      m.setPosition(mine.x, groundH(mine.x, mine.z) + 0.1, mine.z);
      this.mineMesh.setMatrixAt(i, m);
    });
    this.mineMesh.count = this.mines.length;
    this.mineMesh.instanceMatrix.needsUpdate = true;
  }

  updateMines(dt) {
    let changed = false;
    for (let k = 0; k < this.mines.length; k++) {
      const m = this.mines[k];
      m.blink += dt;
      if (m.blink > 1.6) { m.blink = 0; this.fx.glowDot(m.x, groundH(m.x, m.z) + 0.25, m.z, 0.35, 4, 0.2, 0.1, 0.12); }
      if (m.fuse < 0) {
        if (this.horde.countNear(m.x, m.z, CLAYMORE.triggerR) > 0) { m.fuse = 0.12; this.audio.beep(1800, 0.05, 0.05); }
      } else {
        m.fuse -= dt;
        if (m.fuse <= 0) {
          this.detonate(m.x, groundH(m.x, m.z) + 0.3, m.z, 0.85, CLAYMORE.radius, CLAYMORE.damage, 'mine');
          this.mines.splice(k, 1); k--;
          this.minesOwned--;
          changed = true;
        }
      }
    }
    if (changed) this.syncMineMesh();
  }

  // ── Wire ─────────────────────────────────────────────────────────────────
  buildWire() {
    this.wireBands = [22, 45].map((d) => ({ d, active: false, segs: new Float32Array(20), maxHp: 1 }));
    const coilGeo = new THREE.TorusGeometry(0.5, 0.014, 3, 16);
    const coilMat = new THREE.MeshStandardMaterial({ color: 0x5a554c, metalness: 0.85, roughness: 0.45 });
    const stakeGeo = new THREE.BoxGeometry(0.08, 1.3, 0.08);
    const stakeMat = new THREE.MeshStandardMaterial({ color: 0x241c14, roughness: 1 });
    const perSeg = 14;
    for (const b of this.wireBands) {
      b.coils = new THREE.InstancedMesh(coilGeo, coilMat, 20 * perSeg * 2);
      b.stakes = new THREE.InstancedMesh(stakeGeo, stakeMat, 20 * 4);
      b.coils.frustumCulled = false; b.stakes.frustumCulled = false;
      b.coilMs = [];
      const m = new THREE.Matrix4();
      for (let s = 0; s < 20; s++) {
        for (let k = 0; k < perSeg; k++) {
          const x = -100 + s * 10 + (k + 0.5) * (10 / perSeg);
          const z = offsetZ(x, b.d);
          const ang = Math.abs(x) <= WORLD.GATE_HALF ? 0 : (x > 0 ? -0.503 : 0.503);
          for (let row = 0; row < 2; row++) {
            m.makeRotationY(ang + Math.PI / 2 + (R() - 0.5) * 0.25);
            m.setPosition(x, groundH(x, z) + 0.5 + row * 0.62, z + (row ? 0.15 : 0));
            if (row) m.multiply(new THREE.Matrix4().makeScale(0.8, 0.8, 0.8));
            b.coilMs.push(m.clone());
          }
        }
        for (let k = 0; k < 4; k++) {
          const x = -100 + s * 10 + k * 2.5 + 1.25;
          m.makeRotationZ((R() - 0.5) * 0.3);
          m.setPosition(x, groundH(x, offsetZ(x, b.d)) + 0.6, offsetZ(x, b.d));
          b.stakes.setMatrixAt(s * 4 + k, m);
        }
      }
      b.coilMs.forEach((mm, i) => b.coils.setMatrixAt(i, mm));
      b.coils.visible = b.stakes.visible = false;
      this.scene.add(b.coils);
      this.scene.add(b.stakes);
      b.perSeg = perSeg * 2;
    }
  }

  setWire(bands, hp) {
    this.wireBands.forEach((b, i) => {
      b.active = i < bands;
      b.maxHp = hp;
      b.segs.fill(hp);
      b.coils.visible = b.stakes.visible = b.active;
      if (b.active) {
        b.coilMs.forEach((mm, k) => b.coils.setMatrixAt(k, mm));
        b.coils.instanceMatrix.needsUpdate = true;
      }
    });
  }

  wireAt(x, dist, weight, dt) {
    for (const b of this.wireBands) {
      if (!b.active) continue;
      if (Math.abs(dist - b.d) > 1.1) continue;
      const s = Math.floor((x + 100) / 10);
      if (s < 0 || s >= 20 || b.segs[s] <= 0) continue;
      b.segs[s] -= weight * dt * 10;
      if (b.segs[s] <= 0) this.breakWire(b, s);
      return 0.32;
    }
    return 1;
  }

  breakWire(b, s) {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let k = 0; k < b.perSeg; k++) b.coils.setMatrixAt(s * b.perSeg + k, zero);
    b.coils.instanceMatrix.needsUpdate = true;
    const x = -100 + s * 10 + 5;
    for (let k = 0; k < 10; k++) this.fx.spark(x + rand(-5, 5), 0.8, offsetZ(x, b.d), rand(-3, 3), rand(2, 6), rand(-3, 3), 5, 4, 3, 0.4);
  }

  wireIntegrity() {
    let tot = 0, cur = 0;
    for (const b of this.wireBands) {
      if (!b.active) continue;
      for (const v of b.segs) { tot += b.maxHp; cur += Math.max(0, v); }
    }
    return tot > 0 ? cur / tot : -1;
  }

  // ── Shared detonation ────────────────────────────────────────────────────
  detonate(x, y, z, scale, radius, dmg, cause) {
    this.fx.explosion(x, y, z, scale);
    const kills = this.horde.explode(x, y + 0.5, z, radius, dmg, cause, { push: scale });
    this.audio.explosion(x, z, scale);
    if (this.onShake) this.onShake(scale, x, z);
    if (this.onExplosionKills) this.onExplosionKills(kills, x, z, cause);
    return kills;
  }

  // ── Per-frame ────────────────────────────────────────────────────────────
  update(dt, time) {
    const fx = this.fx;
    this.artyCd = Math.max(0, this.artyCd - dt);
    this.grenadeCd = Math.max(0, this.grenadeCd - dt);
    this.molotovCd = Math.max(0, this.molotovCd - dt);

    // marker smoke
    if (this.marker && this.marker.t > 0) {
      this.marker.t -= dt;
      if (R() < 0.6) fx.smoke.spawn(this.marker.x, groundH(this.marker.x, this.marker.z) + 0.3, this.marker.z, rand(-0.5, 0.5), rand(2, 4), rand(-0.5, 0.5), 3, 0.8, 4, PF.SMOKE + ((R() * 4) | 0), 0.5, 0.05, 0.03, 0.8, 0.2, 0.03, 0.02, -0.3, 0.5, 0, R() * 6, 0, 0.1);
      if (R() < 0.5) fx.glowDot(this.marker.x, 0.4, this.marker.z, 1.2, 6, 0.4, 0.2, 0.06);
    }

    // shells in flight
    for (let k = 0; k < this.shells.length; k++) {
      const s = this.shells[k];
      s.t -= dt;
      if (!s.whistled && s.t < 1.9) { s.whistled = true; this.audio.whistle(s.x, s.z, s.t); }
      if (!s.streak && s.t < 0.16) {
        s.streak = true;
        fx.tracer(s.x - 25, 140, s.z + 60, s.x, groundH(s.x, s.z) + 0.5, s.z, 900, 1.2, 4, 2.5, 1.2);
      }
      if (s.t <= 0) {
        this.detonate(s.x, groundH(s.x, s.z), s.z, s.scale, s.r, s.dmg, s.kind);
        this.shells.splice(k, 1); k--;
      }
    }

    // grenades
    for (let k = 0; k < this.grenades.length; k++) {
      const g = this.grenades[k];
      g.t += dt;
      if (g.t < 0) continue;
      const u = Math.min(1, g.t / g.dur);
      const x = lerp(g.sx, g.tx, u), z = lerp(g.sz, g.tz, u);
      const y = lerp(g.sy, groundH(g.tx, g.tz) + 0.1, u) + Math.sin(u * Math.PI) * g.arc;
      g.mesh.position.set(x, y, z);
      g.mesh.rotation.x += dt * 12;
      if (R() < 0.5) fx.glowDot(x, y, z, 0.12, 3, 1.4, 0.4, 0.05);
      if (u >= 1) {
        g.mesh.visible = false;
        const G = ABILITY.grenade;
        this.detonate(x, groundH(x, z), z, 1.05, G.radius, G.damage, 'grenade');
        this.grenades.splice(k, 1); k--;
      }
    }

    // Molotovs: bottles in flight, pools burning
    this.updateMolotovs(dt);
    this.updatePools(dt);

    this.air.update(dt);
    this.updateGunners(dt);
    this.updateRiflemen(dt);
    this.updateMines(dt);
    void time;
  }
}
