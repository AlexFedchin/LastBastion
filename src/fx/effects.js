// High-level visual effects: everything that makes killing feel heavy.
import * as THREE from 'three';
import { ParticleSystem } from './particles.js';
import { Decals } from './decals.js';
import { Debris } from './debris.js';
import { LightPool } from './lights.js';
import { PF, DF } from '../world/textures.js';
import { rand } from '../core/util.js';
import { WORLD } from '../config.js';
import { groundH, wetnessAt } from '../world/terrain.js';

const R = Math.random;

export class Effects {
  constructor(scene, textures, fogUniforms, quality) {
    this.scene = scene;
    const pcap = quality.particles;
    this.glow = new ParticleSystem(scene, { capacity: pcap, additive: true, atlas: textures.particles, fogUniforms, renderOrder: 12 });
    this.smoke = new ParticleSystem(scene, { capacity: Math.floor(pcap * 0.7), additive: false, atlas: textures.particles, fogUniforms, renderOrder: 11 });
    this.decals = new Decals(scene, textures.decals, quality.decals);
    this.lights = new LightPool(scene, quality.lights);

    const floorAt = (x, z) => {
      if (x > -2.8 && x < 2.8 && z > -4.0 && z < 3) return WORLD.TOWER_TOP;
      return groundH(x, z);
    };
    const gibMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.0 });
    const gibGeo = new THREE.IcosahedronGeometry(0.5, 0);
    this.gibs = new Debris(scene, gibGeo, gibMat, quality.gibs, floorAt);
    this.gibs.onTrail = (x, y, z) => {
      this.smoke.spawn(x, y, z, 0, -1, 0, 0.35, 0.12, 0.3, PF.BLOOD + 1, 0.16, 0.006, 0.004, 0.7, 0.08, 0.003, 0.002, 4, 2);
    };
    this.gibs.onLand = (x, z) => { if (R() < 0.6) this.blood(x, z, rand(0.5, 1.1)); };

    const casingMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.9, envMapIntensity: 1.6 });
    const casingGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 7);
    this.casings = new Debris(scene, casingGeo, casingMat, 300, floorAt);

    this.onShake = null; // (amount) => void
    this.fire = null;    // FireSystem (set by the game)
    this.shocks = [];    // recent blasts for the screen-space shockwave
  }

  update(dt) {
    for (let k = this.shocks.length - 1; k >= 0; k--) {
      const s = this.shocks[k];
      s.t += dt;
      if (s.t > 0.6) this.shocks.splice(k, 1);
    }
    this.glow.update(dt);
    this.smoke.update(dt);
    this.decals.update();
    this.gibs.update(dt);
    this.casings.update(dt);
    this.lights.update(dt);
  }

  clear() {
    this.glow.clear(); this.smoke.clear(); this.decals.clear(); this.gibs.clear(); this.casings.clear();
    this.lights.releaseAll();
  }

  shake(a) { if (this.onShake) this.onShake(a); }

  // ── Decals ────────────────────────────────────────────────────────────────
  blood(x, z, size = 1) {
    const k = 0.55 + R() * 0.5;
    this.decals.add(x, z, size * rand(0.8, 1.5), DF.BLOOD + ((R() * 8) | 0), k, k * 0.9, k * 0.9);
  }
  scorch(x, z, size) {
    this.decals.add(x, z, size, DF.SCORCH + ((R() * 2) | 0), 1, 1, 1);
    this.decals.add(x, z, size * 0.55, DF.CRATER, 1, 1, 1);
  }

  // ── Bullets ───────────────────────────────────────────────────────────────
  tracer(x0, y0, z0, x1, y1, z1, speed = 520, bright = 1, r = 6.5, g = 3.2, b = 1.2) {
    const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 0.5) return;
    const life = d / speed;
    const vx = dx / d * speed, vy = dy / d * speed, vz = dz / d * speed;
    this.glow.spawn(x0, y0, z0, vx, vy, vz, life, 0.07, 0.07, PF.GLOW, r * bright, g * bright, b * bright, 1, r * bright, g * bright, b * bright, 0, 0, 0.011, 0, 0, 0);
  }

  muzzle(x, y, z, dx, dy, dz, scale = 1) {
    // star flash
    this.glow.spawn(x, y, z, dx * 2, dy * 2, dz * 2, 0.045, 0.75 * scale, 0.95 * scale, PF.STAR, 7, 4.8, 2.4, 1, 6, 3, 1, 0, 0, 0, R() * 6.28, 0);
    // forward flame tongue
    this.glow.spawn(x + dx * 0.25, y + dy * 0.25, z + dz * 0.25, dx * 9, dy * 9, dz * 9, 0.05, 0.28 * scale, 0.35 * scale, PF.FIRE + ((R() * 4) | 0), 6, 3.2, 1.1, 1, 3, 1, 0.2, 0, 4, 0.03, 0, 0);
    // side vents
    for (let k = 0; k < 2; k++) {
      this.glow.spawn(x, y, z, (R() - 0.5) * 6, (R() - 0.5) * 6, (R() - 0.5) * 6, 0.05, 0.18 * scale, 0.3 * scale, PF.FIRE + ((R() * 4) | 0), 5, 2.6, 0.9, 0.8, 2, 0.6, 0.1, 0, 6);
    }
    // gun smoke
    this.smoke.spawn(x + dx * 0.3, y + dy * 0.3, z + dz * 0.3, dx * 2 + (R() - 0.5), dy * 2 + 0.6, dz * 2 + (R() - 0.5), rand(0.8, 1.5), 0.25 * scale, 1.4 * scale, PF.SMOKE + ((R() * 4) | 0), 0.11, 0.105, 0.1, 0.35, 0.08, 0.08, 0.08, -0.4, 1.6, 0, R() * 6, (R() - 0.5), 0.1);
  }

  casing(x, y, z, rx, rz) {
    this.casings.spawn(x, y, z, rx * rand(2.5, 4) + (R() - 0.5), rand(2, 3.5), rz * rand(2.5, 4) + (R() - 0.5), 0.024, 0.1, 0.024, 0.75, 0.5, 0.16, 5, 0.35, 0);
  }

  groundHit(x, z, big = false) {
    const n = big ? 5 : 2;
    const gy = groundH(x, z);
    if (wetnessAt(x, z) > 0.45) {
      // splash in standing water
      for (let k = 0; k < 4; k++) this.smoke.spawn(x, gy + 0.05, z, (R() - 0.5) * 1.5, rand(2.5, 5), (R() - 0.5) * 1.5, rand(0.3, 0.55), 0.06, rand(0.25, 0.5), PF.SMOKE + ((R() * 4) | 0), 0.22, 0.23, 0.25, 0.6, 0.15, 0.15, 0.16, 12, 0.5, 0.02, R() * 6, 0, 0, gy);
      this.glow.spawn(x, gy + 0.03, z, 0, 0, 0, 0.35, 0.1, 0.9, PF.RING, 0.25, 0.27, 0.3, 0.8, 0.1, 0.1, 0.1, 0, 0, 0);
      return;
    }
    for (let k = 0; k < n; k++) {
      this.smoke.spawn(x, gy + 0.1, z, (R() - 0.5) * 2, rand(1.5, 4), (R() - 0.5) * 2, rand(0.4, 0.8), 0.15, rand(0.6, 1.2), PF.DIRT, 0.07, 0.058, 0.045, 0.85, 0.05, 0.045, 0.04, 9, 1.2, 0, R() * 6, 0, 0, 0);
    }
    this.smoke.spawn(x, gy + 0.2, z, (R() - 0.5), rand(0.4, 1), (R() - 0.5), rand(0.8, 1.4), 0.3, 1.5, PF.SMOKE + ((R() * 4) | 0), 0.07, 0.065, 0.06, 0.35, 0.05, 0.05, 0.05, -0.2, 1.2, 0, R() * 6, 0, 0.1);
    if (R() < 0.3) this.glow.spawn(x, gy + 0.1, z, (R() - 0.5) * 6, rand(3, 7), (R() - 0.5) * 6, 0.25, 0.05, 0.03, PF.SPARK, 4, 2.4, 1, 1, 2, 0.8, 0.2, 14, 0, 0.02);
  }

  /** Bullet tearing through a body. d = bullet direction. */
  fleshHit(x, y, z, dx, dy, dz, power = 1) {
    // exit spray along the bullet
    const n = 3 + ((R() * 4 * power) | 0);
    for (let k = 0; k < n; k++) {
      const sp = rand(3, 9) * power;
      this.smoke.spawn(x, y, z, dx * sp + (R() - 0.5) * 3, dy * sp + rand(0, 3), dz * sp + (R() - 0.5) * 3, rand(0.35, 0.7), 0.06, 0.05, PF.BLOOD, 0.22, 0.008, 0.006, 1, 0.12, 0.004, 0.003, 16, 0.6, 0.035, 0, 0, 0, 0);
    }
    // mist
    this.smoke.spawn(x, y, z, dx * 2.5, dy * 2.5 + 0.4, dz * 2.5, rand(0.35, 0.6), 0.25 * power, 1.1 * power, PF.BLOOD + 1, 0.2, 0.008, 0.006, 0.8, 0.09, 0.004, 0.003, 0, 3.5, 0, R() * 6, 0, 0);
    // entry flash glint (wet)
    if (R() < 0.35) this.glow.spawn(x, y, z, 0, 0, 0, 0.04, 0.25, 0.1, PF.GLOW, 1.4, 0.3, 0.2, 0.7, 0.4, 0.05, 0.02);
  }

  headshot(x, y, z, dx, dy, dz) {
    for (let k = 0; k < 14; k++) {
      const sp = rand(3, 11);
      this.smoke.spawn(x, y, z, dx * sp * 0.7 + (R() - 0.5) * 6, rand(1, 6), dz * sp * 0.7 + (R() - 0.5) * 6, rand(0.4, 0.9), 0.07, 0.06, PF.BLOOD, 0.24, 0.008, 0.006, 1, 0.12, 0.004, 0.003, 18, 0.5, 0.03, 0, 0, 0, 0);
    }
    this.smoke.spawn(x, y, z, dx * 3, dy * 3 + 1, dz * 3, 0.7, 0.4, 2.2, PF.BLOOD + 1, 0.22, 0.01, 0.006, 0.9, 0.08, 0.004, 0.003, 0, 2.8, 0, R() * 6, 0, 0);
    for (let k = 0; k < 4; k++) {
      const s = rand(0.04, 0.09);
      const bone = R() < 0.3;
      this.gibs.spawn(x, y, z, dx * rand(2, 6) + (R() - 0.5) * 4, rand(2, 6), dz * rand(2, 6) + (R() - 0.5) * 4, s, s * rand(0.6, 1), s,
        bone ? 0.5 : 0.22, bone ? 0.45 : 0.02, bone ? 0.38 : 0.02, rand(5, 9), 0.3, 1);
    }
  }

  /** Body coming apart (explosive kill). */
  gibBurst(x, y, z, scale = 1, ix = 0, iy = 6, iz = 0, count = 8) {
    for (let k = 0; k < count; k++) {
      const s = rand(0.09, 0.22) * scale;
      const dark = R() < 0.4;
      this.gibs.spawn(x + (R() - 0.5) * 0.4, y + rand(0.3, 1.3) * scale, z + (R() - 0.5) * 0.4,
        ix * rand(0.4, 1.2) + (R() - 0.5) * 9, iy * rand(0.6, 1.3) + rand(2, 6), iz * rand(0.4, 1.2) + (R() - 0.5) * 9,
        s, s * rand(0.5, 1.4), s * rand(0.6, 1.2),
        dark ? 0.12 : 0.26, dark ? 0.03 : 0.035, dark ? 0.025 : 0.03, rand(7, 12), 0.25, 1);
    }
    for (let k = 0; k < 10; k++) {
      this.smoke.spawn(x, y + 1, z, (R() - 0.5) * 12 + ix * 0.3, rand(2, 10), (R() - 0.5) * 12 + iz * 0.3, rand(0.5, 1), 0.09, 0.08, PF.BLOOD, 0.24, 0.008, 0.006, 1, 0.12, 0.004, 0.003, 18, 0.6, 0.03, 0, 0, 0, 0);
    }
    this.smoke.spawn(x, y + 1, z, 0, 1, 0, 0.9, 0.8, 3.4, PF.BLOOD + 1, 0.2, 0.01, 0.006, 0.85, 0.08, 0.004, 0.003, -0.5, 2, 0, R() * 6, 0, 0);
    this.blood(x, z, 1.6 * scale);
  }

  // ── Explosions ────────────────────────────────────────────────────────────
  explosion(x, y, z, scale = 1, { dirt = true, scorch = true, light = true, color = 0 } = {}) {
    const s = scale;
    // white-hot flash
    this.glow.spawn(x, y + 1 * s, z, 0, 0, 0, 0.14, 6 * s, 14 * s, PF.GLOW, 9, 7, 5, 1, 6, 3, 1);
    this.glow.spawn(x, y + 0.5 * s, z, 0, 0, 0, 0.32, 3 * s, 16 * s, PF.RING, 3, 2.2, 1.4, 0.6, 1, 0.5, 0.2);
    // fireball
    const nf = Math.round(16 * Math.min(1.5, s));
    for (let k = 0; k < nf; k++) {
      const a = R() * 6.28, up = rand(0.2, 1);
      const sp = rand(4, 13) * s;
      const vx = Math.cos(a) * sp * (1 - up * 0.5), vz = Math.sin(a) * sp * (1 - up * 0.5), vy = up * sp * 1.1;
      const hot = color === 1 ? [1.6, 3.2, 1.0] : [5, 2.6, 0.9];
      this.glow.spawn(x, y + 0.5 * s, z, vx, vy, vz, rand(0.5, 1.0), rand(1.5, 2.6) * s, rand(4, 7) * s, PF.FIRE + ((R() * 4) | 0),
        hot[0], hot[1], hot[2], 1, 1.2, 0.25, 0.04, -2, 2.8, 0, R() * 6, (R() - 0.5) * 2, 0);
    }
    // sparks & embers
    for (let k = 0; k < 26 * Math.min(1.5, s); k++) {
      const a = R() * 6.28, sp = rand(12, 38) * Math.sqrt(s);
      this.glow.spawn(x, y + 0.5, z, Math.cos(a) * sp * 0.6, rand(0.4, 1) * sp, Math.sin(a) * sp * 0.6, rand(0.6, 1.6), 0.09, 0.05, PF.SPARK,
        6, 3, 1, 1, 2, 0.5, 0.1, 22, 0.8, 0.018, 0, 0, 0, 0);
    }
    // smoke column
    const ns = Math.round(12 * Math.min(1.6, s));
    for (let k = 0; k < ns; k++) {
      const a = R() * 6.28, sp = rand(1, 5) * s;
      const g = rand(0.035, 0.07);
      // starts lit from inside by the fireball, cools to soot
      this.smoke.spawn(x + Math.cos(a) * s, y + rand(0.5, 3) * s, z + Math.sin(a) * s, Math.cos(a) * sp, rand(2, 6) * s, Math.sin(a) * sp,
        rand(3, 6.5), rand(2.5, 4) * s, rand(8, 15) * s, PF.SMOKE + ((R() * 4) | 0), 0.42, 0.18, 0.07, 0.85, g * 0.8, g * 0.8, g * 0.8,
        -0.6, 0.9, 0, R() * 6, (R() - 0.5) * 0.3, 0.06);
    }
    if (dirt) {
      for (let k = 0; k < 14 * Math.min(1.5, s); k++) {
        const a = R() * 6.28, sp = rand(5, 18) * s;
        this.smoke.spawn(x, y + 0.3, z, Math.cos(a) * sp * 0.5, rand(8, 22) * Math.sqrt(s), Math.sin(a) * sp * 0.5, rand(0.9, 1.6), rand(0.6, 1.2) * s, rand(1.5, 3) * s, PF.DIRT,
          0.06, 0.05, 0.04, 0.95, 0.04, 0.035, 0.03, 20, 0.5, 0, R() * 6, (R() - 0.5) * 2, 0, 0);
      }
      for (let k = 0; k < 10 * Math.min(1.5, s); k++) {
        const a = R() * 6.28, sp = rand(4, 14) * s;
        const c = rand(0.05, 0.1), sz = rand(0.1, 0.32) * s;
        this.gibs.spawn(x, y + 0.5, z, Math.cos(a) * sp, rand(8, 20) * Math.sqrt(s), Math.sin(a) * sp, sz, sz * 0.7, sz, c, c * 0.85, c * 0.7, rand(4, 8), 0.2, 0);
      }
    }
    if (dirt) {
      // dust skirt racing out along the ground
      const nr = Math.round(18 * Math.min(1.6, s));
      for (let k = 0; k < nr; k++) {
        const a = (k / nr) * 6.28 + R() * 0.3, sp = rand(9, 16) * s;
        this.smoke.spawn(x + Math.cos(a) * s, y + 0.4, z + Math.sin(a) * s, Math.cos(a) * sp, rand(0.3, 1.2), Math.sin(a) * sp, rand(1.6, 2.6), 1.2 * s, 4.5 * s, PF.SMOKE + ((R() * 4) | 0),
          0.09, 0.08, 0.065, 0.55, 0.05, 0.045, 0.04, -0.1, 2.2, 0, R() * 6, (R() - 0.5) * 0.5, 0.05);
      }
    }
    if (scorch) this.scorch(x, z, 4.5 * s);
    if (light) this.lights.flash(x, y + 3 * s, z, 0xff8a3c, 420 * s * s, 60 * s, 0.6 + 0.2 * s, 0.25);
    this.shocks.push({ x, y: y + 1.5 * s, z, t: 0, s });
    if (this.shocks.length > 6) this.shocks.shift();
    // burning debris left behind
    if (this.fire && color === 0) {
      const nfire = s > 0.9 ? 2 + ((R() * 3) | 0) : (R() < 0.5 ? 1 : 0);
      for (let k = 0; k < nfire; k++) {
        const a = R() * 6.28, r = R() * 3.5 * s;
        const fx = x + Math.cos(a) * r, fz = z + Math.sin(a) * r;
        this.fire.add(fx, groundH(fx, fz), fz, rand(0.8, 1.4) * s, rand(0.7, 1.3) * s, rand(0.7, 1.1), { smoke: 0.7, embers: 1.5, life: rand(5, 11), fadeIn: 0.25 });
      }
    }
  }

  // ── Fire ──────────────────────────────────────────────────────────────────
  flame(x, y, z, size = 1, vy = 3) {
    this.glow.spawn(x + (R() - 0.5) * 0.5 * size, y, z + (R() - 0.5) * 0.5 * size, (R() - 0.5) * 0.8, vy * rand(0.6, 1.3), (R() - 0.5) * 0.8,
      rand(0.45, 0.9), rand(0.5, 0.9) * size, rand(1.2, 2.2) * size, PF.FIRE + ((R() * 4) | 0), 2.4, 1.0, 0.28, 0.85, 0.45, 0.07, 0.01, -1.5, 1.2, 0, R() * 6, (R() - 0.5) * 2, 0.15);
  }
  ember(x, y, z) {
    this.glow.spawn(x, y, z, (R() - 0.5) * 2, rand(1.5, 4), (R() - 0.5) * 2, rand(1, 2.5), 0.06, 0.03, PF.SPARK, 5, 2, 0.4, 1, 1.5, 0.3, 0.05, -0.3, 0.6, 0.01);
  }
  smokePuff(x, y, z, size = 2, dark = 0.05, life = 4, vy = 1.5) {
    this.smoke.spawn(x, y, z, (R() - 0.5) * 0.8, vy, (R() - 0.5) * 0.8, life, size * 0.5, size * 2, PF.SMOKE + ((R() * 4) | 0),
      dark, dark * 0.95, dark * 0.92, 0.7, dark * 0.7, dark * 0.7, dark * 0.7, -0.2, 0.4, 0, R() * 6, (R() - 0.5) * 0.3, 0.12);
  }

  // ── Misc ──────────────────────────────────────────────────────────────────
  spark(x, y, z, vx, vy, vz, r = 6, g = 3, b = 1, life = 0.5) {
    this.glow.spawn(x, y, z, vx, vy, vz, life, 0.08, 0.04, PF.SPARK, r, g, b, 1, r * 0.3, g * 0.2, b * 0.1, 12, 0.5, 0.02);
  }
  glowDot(x, y, z, size, r, g, b, life = 0.05) {
    this.glow.spawn(x, y, z, 0, 0, 0, life, size, size, PF.GLOW, r, g, b, 1, r, g, b);
  }
}
