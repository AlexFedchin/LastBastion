// Everything that kills besides your own gun: artillery, napalm, flares,
// grenades, danger-close, wall gunners, the mortar pit, claymores and wire.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WORLD, wallZ, wallDist, WING_COS, ABILITY, CLAYMORE } from '../config.js';
import { clamp, rand, lerp } from '../core/util.js';
import { PF } from '../world/textures.js';
import { groundH, raycastGround } from '../world/terrain.js';
import { AirSupport } from './air.js';

const R = Math.random;
const _v = new THREE.Vector3();

/** Point at perpendicular distance d in front of the wall at x. */
function offsetZ(x, d) {
  const ax = Math.abs(x);
  return wallZ(x) - (ax <= WORLD.GATE_HALF ? d : d / WING_COS);
}

const GUNNER_POSTS = [-27, 27, -52, 52];

export class Arsenal {
  constructor(scene, fx, audio, horde, env) {
    this.scene = scene;
    this.fx = fx;
    this.audio = audio;
    this.horde = horde;
    this.env = env;
    this.shells = [];   // artillery & mortar rounds in flight
    this.grenades = [];
    this.flares = [];
    this.artyCd = 0;
    this.napalmCd = 0;
    this.napalmT = 0;
    this.napalmLights = [];
    this.napalmFires = [];
    this.napalmNext = WORLD.GATE_HALF + 1;
    this.flaresLeft = 0;
    this.grenadesLeft = 0;
    this.dangerUsed = false;
    this.mortarT = 4;
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

    // claymores
    const mineGeo = new THREE.BoxGeometry(0.24, 0.16, 0.06);
    const mineMat = new THREE.MeshStandardMaterial({ color: 0x3b4128, roughness: 0.8 });
    this.mineMesh = new THREE.InstancedMesh(mineGeo, mineMat, CLAYMORE.max);
    this.mineMesh.count = 0;
    this.mineMesh.frustumCulled = false;
    scene.add(this.mineMesh);

    this.buildGunners();
    this.buildWire();
    this.air = new AirSupport(this);
  }

  // ── Night lifecycle ──────────────────────────────────────────────────────
  startNight(stats, menu = false) {
    this.stats = stats;
    this.air.startNight(menu);
    this.artyCd = 6;
    this.napalmCd = 0;
    this.napalmT = 0;
    this.flaresLeft = stats.flares;
    this.grenadesLeft = stats.grenades;
    this.dangerUsed = false;
    this.mortarT = 5;
    this.shells.length = 0;
    this.grenades.length = 0;
    for (const f of this.flares) this.fx.lights.release(f.light);
    this.flares.length = 0;
    this.releaseNapalmLights();
    this.clearNapalmFires();
    this.placeMines();
    this.setGunners(stats.gunners);
    this.setWire(stats.wireBands, stats.wireHp);
    this.horde.ctx.fireAt = (x, dist) => this.fireAt(x, dist);
    this.horde.ctx.wireAt = (x, dist, w, dt) => this.wireAt(x, dist, w, dt);
    this.horde.ctx.flares = this.flareZones = [];
  }

  endNight() {
    this.air.endNight();
    this.releaseNapalmLights();
    this.clearNapalmFires();
    this.napalmT = 0;
    for (const f of this.flares) this.fx.lights.release(f.light);
    this.flares.length = 0;
    this.flareZones.length = 0;
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
    const spreadR = 6 + n * 0.7;
    for (let k = 0; k < n; k++) {
      const a = R() * Math.PI * 2, r = Math.sqrt(R()) * spreadR;
      this.shells.push({
        kind: 'arty', x: target.x + Math.cos(a) * r, z: target.z + Math.sin(a) * r,
        t: 2.4 + k * 0.2 + R() * 0.25, r: s.artyRadius, dmg: s.artyDamage, scale: 1.45, whistled: false, streak: false,
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

  // ── Napalm trench ────────────────────────────────────────────────────────
  igniteNapalm() {
    if (this.napalmCd > 0 || this.napalmT > 0) return false;
    this.napalmT = this.stats.napalmDuration;
    this.napalmCd = this.stats.napalmCooldown;
    this.napalmAge = 0;
    this.clearNapalmFires();
    this.audio.napalm(0, -12);
    this.releaseNapalmLights();
    for (const x of [-48, -22, 22, 48]) {
      const l = this.fx.lights.acquire();
      if (!l) continue;
      l.position.set(x, 2.5, offsetZ(x, 9));
      l.color.setRGB(1, 0.45, 0.12);
      l.distance = 45;
      l.decay = 1.6;
      this.napalmLights.push(l);
    }
    return true;
  }

  clearNapalmFires() {
    if (this.fx.fire) for (const id of this.napalmFires) this.fx.fire.remove(id);
    this.napalmFires.length = 0;
    this.napalmNext = WORLD.GATE_HALF + 1;
  }

  releaseNapalmLights() {
    for (const l of this.napalmLights) this.fx.lights.release(l);
    this.napalmLights.length = 0;
  }

  fireAt(x, dist) {
    if (this.napalmT <= 0) return 0;
    const ax = Math.abs(x);
    if (ax < WORLD.GATE_HALF + 1 || ax > 70) return 0;
    // fire races outward from the centre on ignition
    if (ax > 9 + this.napalmAge * 110) return 0;
    if (Math.abs(dist - 9) > 1.6) return 0;
    return this.stats.napalmDps;
  }

  // ── Flares ───────────────────────────────────────────────────────────────
  launchFlare(target) {
    if (this.flaresLeft <= 0) return false;
    this.flaresLeft--;
    const light = this.fx.lights.acquire();
    const f = {
      sx: 0, sy: WORLD.CAM.y + 1, sz: WORLD.CAM.z - 1.5,
      tx: target.x, tz: target.z, x: 0, y: 0, z: 0, t: 0, rise: 2.3, life: ABILITY.flare.duration,
      light, swayP: R() * 6,
    };
    if (light) { light.color.setRGB(1, 0.82, 0.68); light.distance = 280; light.decay = 1.25; light.intensity = 0; }
    this.flares.push(f);
    this.audio.flare();
    return true;
  }

  // ── Grenades ─────────────────────────────────────────────────────────────
  throwGrenades(target) {
    if (this.grenadesLeft <= 0) return false;
    this.grenadesLeft--;
    this.audio.throwGrenade();
    const G = ABILITY.grenade;
    // clamp range
    const cx = WORLD.CAM.x, cz = WORLD.CAM.z;
    let dx = target.x - cx, dz = target.z - cz;
    const d = Math.hypot(dx, dz);
    if (d > G.maxRange) { dx *= G.maxRange / d; dz *= G.maxRange / d; }
    for (let k = 0; k < G.count; k++) {
      const mesh = this.grenadeMeshes.find((m) => !m.visible);
      if (!mesh) break;
      mesh.visible = true;
      const tx = cx + dx + rand(-2.2, 2.2), tz = cz + dz + rand(-2.2, 2.2);
      this.grenades.push({ mesh, sx: rand(-0.6, 0.6), sy: WORLD.CAM.y + 0.2, sz: WORLD.CAM.z - 0.8, tx, tz, t: -k * 0.12, dur: 0.9 + Math.min(d, G.maxRange) * 0.012 });
    }
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
    const seg = (r0, r1, a, b) => {
      const A = new THREE.Vector3(...a), Bv = new THREE.Vector3(...b);
      const len = A.distanceTo(Bv);
      const g = new THREE.CylinderGeometry(r1, r0, len, 8);
      g.translate(0, len / 2, 0);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), Bv.clone().sub(A).normalize()));
      g.translate(A.x, A.y, A.z);
      return g;
    };
    const bx = (w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => { const g = new THREE.BoxGeometry(w, h, d); g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz); g.translate(x, y, z); return g; };
    const mg = (list) => mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => { for (const k of Object.keys(g.attributes)) if (!['position', 'normal'].includes(k)) g.deleteAttribute(k); return g; }));
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

  // ── Mortar ───────────────────────────────────────────────────────────────
  updateMortar(dt) {
    const s = this.stats;
    if (!s.mortar) return;
    this.mortarT -= dt;
    if (this.mortarT > 0) return;
    this.mortarT = s.mortarInterval;
    const c = this.horde.densest(14, 170, 40, 6);
    if (!c || c.count < 4) { this.mortarT = 1; return; }
    for (let k = 0; k < s.mortarShells; k++) {
      this.shells.push({
        kind: 'mortar', x: c.x + rand(-3, 3), z: c.z + rand(-3, 3), t: 3.0 + k * 0.4, flight: 3.0 + k * 0.4,
        sx: rand(-4, 4), sy: 6, sz: 22, r: s.mortarRadius, dmg: s.mortarDamage, scale: 0.85, whistled: false, streak: true,
      });
    }
    this.audio.mortarLaunch();
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
    this.napalmCd = Math.max(0, this.napalmCd - (this.napalmT > 0 ? 0 : dt));

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
      if (s.kind === 'mortar') {
        const u = clamp(1 - s.t / s.flight, 0, 1);
        const x = lerp(s.sx, s.x, u), z = lerp(s.sz, s.z, u);
        const y = lerp(s.sy, groundH(s.x, s.z), u) + Math.sin(u * Math.PI) * 70;
        fx.glowDot(x, y, z, 0.6, 5, 2.4, 0.8, 0.08);
        if (!s.whistled && s.t < 1.2) { s.whistled = true; this.audio.whistle(s.x, s.z, s.t); }
      } else {
        if (!s.whistled && s.t < 1.9) { s.whistled = true; this.audio.whistle(s.x, s.z, s.t); }
        if (!s.streak && s.t < 0.16) {
          s.streak = true;
          fx.tracer(s.x - 25, 140, s.z + 60, s.x, groundH(s.x, s.z) + 0.5, s.z, 900, 1.2, 4, 2.5, 1.2);
        }
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
      const y = lerp(g.sy, groundH(g.tx, g.tz) + 0.1, u) + Math.sin(u * Math.PI) * 6;
      g.mesh.position.set(x, y, z);
      g.mesh.rotation.x += dt * 12;
      if (R() < 0.5) fx.glowDot(x, y, z, 0.12, 3, 1.4, 0.4, 0.05);
      if (u >= 1) {
        g.mesh.visible = false;
        const G = ABILITY.grenade;
        this.detonate(x, groundH(x, z), z, 0.75, G.radius, G.damage, 'grenade');
        this.grenades.splice(k, 1); k--;
      }
    }

    // flares
    this.flareZones.length = 0;
    for (let k = 0; k < this.flares.length; k++) {
      const f = this.flares[k];
      f.t += dt;
      let x, y, z;
      if (f.t < f.rise) {
        const u = f.t / f.rise;
        x = lerp(f.sx, f.tx, u); z = lerp(f.sz, f.tz, u);
        y = lerp(f.sy, 72, Math.sin(u * Math.PI / 2));
        fx.glowDot(x, y, z, 0.8, 6, 3, 1.5, 0.05);
        fx.smokePuff(x, y, z, 0.6, 0.06, 2.5, 0);
      } else {
        const ht = f.t - f.rise;
        f.swayP += dt;
        x = f.tx + Math.sin(f.swayP * 0.8) * 3 + ht * 0.6; z = f.tz + Math.cos(f.swayP * 0.6) * 2;
        y = Math.max(2, 72 - ht * 2.4);
        const life = 1 - ht / f.life;
        const flick = 0.82 + R() * 0.18;
        if (f.light) { f.light.position.set(x, y, z); f.light.intensity = 2600 * Math.min(1, ht * 2) * Math.min(1, life * 4) * flick; }
        fx.glowDot(x, y, z, 2.6 * flick, 9, 6, 4.5, 0.05);
        if (R() < 0.4) fx.smokePuff(x, y, z, 1.2, 0.07, 6, 0.5);
        if (R() < 0.35) fx.spark(x, y, z, rand(-1, 1), rand(-2, 0), rand(-1, 1), 6, 4, 2, 1.2);
        this.flareZones.push({ x, z, r2: ABILITY.flare.radius * ABILITY.flare.radius });
        if (ht >= f.life) {
          if (f.light) this.fx.lights.release(f.light);
          this.flares.splice(k, 1); k--;
          continue;
        }
      }
      f.x = x; f.y = y; f.z = z;
    }

    // napalm trench
    if (this.napalmT > 0) {
      this.napalmT -= dt;
      this.napalmAge += dt;
      const reach = Math.min(70, 9 + this.napalmAge * 110);
      const fade = Math.min(1, this.napalmT * 0.8);
      const fire = fx.fire;
      if (fire) {
        // light the ditch progressively outward from the gate
        while (this.napalmNext <= reach) {
          const ax = this.napalmNext;
          for (const side of [-1, 1]) {
            const x = side * ax, z = offsetZ(x, 9) + rand(-0.4, 0.4);
            const id = fire.add(x, groundH(x, z) - 0.1, z, rand(1.8, 2.5), rand(3.0, 4.8), 0.95, { smoke: 0.3, embers: 2.0, fadeIn: 0.25 });
            if (id >= 0) this.napalmFires.push(id);
          }
          this.napalmNext += 2.6;
        }
        for (let k = 0; k < this.napalmFires.length; k++) fire.set(this.napalmFires[k], 0.95 * fade * (0.85 + R() * 0.3));
      }
      const n = Math.round(8 * fade * (reach / 70) + 1);
      for (let k = 0; k < n; k++) {
        const side = R() < 0.5 ? -1 : 1;
        const x = side * rand(WORLD.GATE_HALF + 1, reach);
        const z = offsetZ(x, 9) + rand(-0.9, 0.9);
        fx.flame(x, groundH(x, z) + 0.2, z, 1.5 * (0.7 + fade * 0.5), 4.2);
        if (R() < 0.08) fx.smokePuff(x, 3, z, 2.5, 0.025, 6, 3.5);
        if (R() < 0.1) fx.ember(x, 1.5, z);
      }
      for (const l of this.napalmLights) l.intensity = (230 + R() * 110) * fade;
      if (R() < dt * 2) this.audio.crackle(rand(-40, 40), -14, 0.5);
      if (this.napalmT <= 0) { this.releaseNapalmLights(); this.clearNapalmFires(); }
      this.audio.napalmLevel = this.napalmT > 0 ? fade : 0;
    } else this.audio.napalmLevel = 0;

    this.air.update(dt);
    this.updateGunners(dt);
    this.updateMortar(dt);
    this.updateMines(dt);
    void time;
  }
}
