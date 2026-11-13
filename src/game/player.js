// The gunner: camera, the M2HB model, recoil, heat and every bullet.
import * as THREE from 'three';
import { raycastGround } from '../world/terrain.js';
import { WORLD, HEADSHOT_FRAC, HEADSHOT_MULT } from '../config.js';
import { clamp, damp, rand, fitFov } from '../core/util.js';
import { cloneModel } from '../world/models.js';

const DEG = Math.PI / 180;
const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _m = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

export class Player {
  constructor(camera, scene, fx, audio, horde) {
    this.camera = camera;
    this.scene = scene;
    this.fx = fx;
    this.audio = audio;
    this.horde = horde;
    this.yaw = 0;
    this.pitch = -9 * DEG;
    this.yawLimit = 106 * DEG;
    this.pitchMin = -74 * DEG;
    this.pitchMax = 14 * DEG;
    this.recoilP = 0; this.recoilY = 0;
    this.trauma = 0;
    this.baseFov = 62;
    this.fov = 62;
    this.zoom = 0;
    this.sens = 0.0022;
    this.invertY = false;

    this.heat = 0;
    this.overheatT = 0;
    this.fireAcc = 0;
    this.sinceShot = 10;
    this.bloom = 0;
    this.shots = 0; this.hits = 0;
    this.firing = false;
    this.onHit = null;   // (killed, headshot)
    this.onOverheat = null;

    camera.rotation.order = 'YXZ';
    camera.position.set(WORLD.CAM.x, WORLD.CAM.y, WORLD.CAM.z);
    scene.add(camera);
    this.buildGun();

    this.muzzleLight = new THREE.PointLight(0xffa04a, 0, 28, 1.8);
    scene.add(this.muzzleLight);
    this.nestLight = new THREE.PointLight(0xff8040, 1.6, 7, 2);
    this.nestLight.position.set(0.5, WORLD.CAM.y + 0.9, WORLD.CAM.z + 1.4);
    scene.add(this.nestLight);
  }

  // ── M2HB model (app/models/m2hb.glb: camera space, barrel along -z) ───────
  buildGun() {
    const g = cloneModel('m2hb');
    g.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = false; o.receiveShadow = false;
      // parkerized steel: keep the burning horizon from turning it into a mirror
      o.material.envMapIntensity = 0.35;
    });
    this.barrelMat = g.getObjectByName('barrel').material; // glows as it heats
    this.barrelMat.emissive.setRGB(0, 0, 0);

    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0.02, -2.19);
    g.add(this.muzzle);

    this.gunBase = new THREE.Vector3(0.02, -0.43, 0.0);
    g.position.copy(this.gunBase);
    this.gun = g;
    this.camera.add(g);
  }

  reset() {
    this.yaw = 0; this.pitch = -9 * DEG;
    this.heat = 0; this.overheatT = 0; this.fireAcc = 0; this.wasFiring = false;
    this.recoilP = 0; this.recoilY = 0; this.trauma = 0; this.bloom = 0;
    this.shots = 0; this.hits = 0;
  }

  addTrauma(a) { this.trauma = Math.min(1, this.trauma + a); }

  /** Ground point under the crosshair (for artillery etc.) */
  aimPoint(maxDist = 320) {
    this.camera.getWorldDirection(_d);
    const o = this.camera.position;
    if (_d.y < -0.01) {
      const gt = raycastGround(o.x, o.y, o.z, _d.x, _d.y, _d.z, maxDist + 40);
      const t = Math.min(gt >= 0 ? gt : -o.y / _d.y, maxDist);
      return new THREE.Vector3(o.x + _d.x * t, 0, o.z + _d.z * t);
    }
    const h = Math.hypot(_d.x, _d.z) || 1;
    return new THREE.Vector3(o.x + (_d.x / h) * maxDist, 0, o.z + (_d.z / h) * maxDist);
  }

  update(dt, rdt, input, stats, controlsActive, time) {
    // look
    if (controlsActive) {
      const z = 1 - this.zoom * 0.55;
      this.yaw -= input.dx * this.sens * z;
      this.pitch -= input.dy * this.sens * z * (this.invertY ? -1 : 1);
    }
    this.yaw = clamp(this.yaw, -this.yawLimit, this.yawLimit);
    this.pitch = clamp(this.pitch, this.pitchMin, this.pitchMax);

    // zoom (RMB)
    const wantZoom = controlsActive && input.mouse(2) ? 1 : 0;
    this.zoom = damp(this.zoom, wantZoom, 12, rdt);
    this.fov = fitFov(this.baseFov, this.camera.aspect) * (1 - this.zoom * 0.52);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) { this.camera.fov = this.fov; this.camera.updateProjectionMatrix(); }

    // recoil recovery
    this.recoilP = damp(this.recoilP, 0, 9, dt);
    this.recoilY = damp(this.recoilY, 0, 9, dt);
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    const sh = this.trauma * this.trauma;
    const sy = sh * 0.035 * (Math.sin(time * 37.1) + Math.sin(time * 23.7) * 0.6);
    const sp = sh * 0.03 * (Math.sin(time * 41.3 + 1) + Math.sin(time * 19.1) * 0.6);
    const sr = sh * 0.04 * Math.sin(time * 29.3 + 2);
    this.camera.rotation.set(this.pitch + this.recoilP + sp, this.yaw + this.recoilY + sy, sr);
    this.camera.position.set(WORLD.CAM.x, WORLD.CAM.y, WORLD.CAM.z);
    this.camera.updateMatrixWorld(true);

    if (this.overheatT > 0) this.overheatT -= dt;

    // firing
    const canFire = controlsActive && this.overheatT <= 0;
    this.firing = canFire && input.mouse(0);
    if (this.firing) {
      this.fireAcc += dt * stats.hmgRate;
      while (this.fireAcc >= 1) {
        this.fireAcc -= 1;
        this.shoot(stats);
        if (this.heat >= 1) {
          this.overheatT = stats.overheatLock;
          this.fireAcc = 0;
          this.audio.overheat();
          if (this.onOverheat) this.onOverheat();
          break;
        }
      }
      this.sinceShot = 0;
    } else {
      this.fireAcc = Math.min(this.fireAcc, 0.999);
      if (!input.mouse(0)) this.fireAcc = 0.999; // first shot fires instantly
      this.sinceShot += dt;
    }
    // the barrel ticks and hisses as it cools after a burst
    if (this.firing && !this.wasFiring) this.audio.stopCool();
    else if (!this.firing && this.wasFiring) this.audio.barrelCool(this.heat);
    this.wasFiring = this.firing;
    // cooling
    const cool = stats.hmgCool + (this.sinceShot > 0.3 ? stats.hmgCoolIdle : 0);
    if (this.overheatT <= 0) this.heat = Math.max(0, this.heat - cool * dt);
    else this.heat = Math.max(0.6, this.heat - 0.12 * dt);
    this.bloom = damp(this.bloom, 0, this.firing ? 2 : 7, dt);

    // gun visuals: kickback, sway, glowing barrel
    const kick = this.gunKick || 0;
    this.gunKick = damp(kick, 0, 18, dt);
    this.gun.position.set(this.gunBase.x + (Math.random() - 0.5) * kick * 0.15,
      this.gunBase.y + (Math.random() - 0.5) * kick * 0.1,
      this.gunBase.z + kick);
    this.gun.rotation.set(kick * 0.6, 0, 0);
    const h = this.heat;
    this.barrelMat.emissive.setRGB(h * h * 2.2, h * h * h * 0.55, h * h * h * h * 0.08);
    this.muzzleLight.intensity = damp(this.muzzleLight.intensity, 0, 40, dt);
  }

  shoot(stats) {
    const cam = this.camera;
    const fx = this.fx, horde = this.horde;
    this.shots++;
    this.heat = Math.min(1, this.heat + stats.hmgHeat);

    // direction with spread
    const spread = (stats.hmgSpread + this.bloom) * (1 - this.zoom * 0.6);
    this.bloom = Math.min(0.028, this.bloom + 0.0011);
    cam.getWorldDirection(_d);
    _right.set(1, 0, 0).applyQuaternion(cam.quaternion);
    _up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
    _d.addScaledVector(_right, Math.cos(a) * r).addScaledVector(_up, Math.sin(a) * r).normalize();
    const o = cam.position;

    // hits
    const maxHits = 1 + stats.hmgPen;
    const gt = raycastGround(o.x, o.y, o.z, _d.x, _d.y, _d.z, 600);
    const groundT = gt >= 0 ? gt : 600;
    const cnt = horde.raycast(o.x, o.y, o.z, _d.x, _d.y, _d.z, Math.min(groundT, 600), maxHits);
    let endT = Math.min(groundT, 600);
    let stopped = false;
    let dmg = stats.hmgDamage;
    let anyHit = false;
    for (let k = 0; k < cnt; k++) {
      const t = horde.hitT[k];
      if (t > endT) break;
      const i = horde.hitIdx[k];
      const frac = horde.hitFrac[k];
      const head = frac > HEADSHOT_FRAC;
      const px = o.x + _d.x * t, py = o.y + _d.y * t, pz = o.z + _d.z * t;
      const killed = horde.damage(i, dmg * (head ? HEADSHOT_MULT : 1), 'hmg', _d.x, _d.y, _d.z, head && !stopped);
      fx.fleshHit(px, py, pz, _d.x, _d.y, _d.z, head ? 1.5 : 1);
      fx.bulletFlesh(px, py, pz, _d.x, _d.y, _d.z, clamp(t / 45, 1, 3), head);
      this.audio.flesh(px, pz, head && killed);
      if (stats.hmgIncendiary > 0 && Math.random() < stats.hmgIncendiary && !killed) horde.ignite(i, 4, 28);
      if (stats.hmgHE) {
        fx.explosion(px, py, pz, 0.22, { dirt: false, scorch: false, light: false });
        horde.explode(px, py, pz, 2.2, 32, 'he', { push: 0.4 });
      }
      anyHit = true;
      if (this.onHit) this.onHit(killed, head);
      dmg *= 0.72;
      if (k === maxHits - 1) { endT = t; stopped = true; }
    }
    if (anyHit) this.hits++;

    // visuals
    this.muzzle.getWorldPosition(_m);
    const ex = o.x + _d.x * endT, ey = Math.max(0, o.y + _d.y * endT), ez = o.z + _d.z * endT;
    // every round is a tracer; alternate brightness like a real belt mix
    fx.tracer(_m.x, _m.y, _m.z, ex, ey, ez, 560, this.shots % 3 === 0 ? 1.4 : 0.75);
    // the round's path, faintly, so you can see where the burst is going
    fx.bulletPath(_m.x, _m.y, _m.z, ex, ey, ez, this.zoom > 0.5 ? 0.6 : 1, this.zoom > 0.5 ? 20 : 12);
    if (!stopped && groundT < 600) fx.bulletGround(ex, ez, clamp(endT / 45, 1, 3));
    // a modest flash: it's in your face all night, so it shouldn't shout
    fx.muzzle(_m.x, _m.y, _m.z, _d.x, _d.y, _d.z, 0.7);
    this.muzzleLight.position.copy(_m);
    this.muzzleLight.intensity = rand(5, 8);
    this.audio.hmg();
    this.audio.casing();
    // recoil
    this.recoilP += 0.0045 + Math.random() * 0.002;
    this.recoilY += (Math.random() - 0.5) * 0.004;
    this.gunKick = 0.045;
    this.addTrauma(0.06);
  }
}
