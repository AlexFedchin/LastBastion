// Fixed pool of point lights. The count never changes, so shaders never
// recompile mid-fight; unused lights just sit at zero intensity.
import * as THREE from 'three';

export class LightPool {
  constructor(scene, count = 8) {
    this.items = [];
    for (let i = 0; i < count; i++) {
      const light = new THREE.PointLight(0xffaa66, 0, 40, 1.6);
      light.position.set(0, -100, 0);
      scene.add(light);
      this.items.push({ light, t: 0, dur: 1, i0: 0, flicker: 0, locked: false, active: false });
    }
  }

  /** Fire-and-forget flash that decays over `dur` seconds. */
  flash(x, y, z, color, intensity, distance, dur, flicker = 0) {
    let best = null, bestScore = Infinity;
    for (const it of this.items) {
      if (it.locked) continue;
      const score = it.active ? it.light.intensity : -1;
      if (score < bestScore) { bestScore = score; best = it; }
    }
    if (!best) return;
    best.light.position.set(x, y, z);
    best.light.color.set(color);
    best.light.distance = distance;
    best.i0 = intensity;
    best.light.intensity = intensity;
    best.t = 0;
    best.dur = dur;
    best.flicker = flicker;
    best.active = true;
  }

  /** Reserve a light for manual control (flares, Molotovs). Returns null if none free. */
  acquire() {
    let best = null;
    for (const it of this.items) {
      if (it.locked) continue;
      if (!best || (!it.active && best.active) || (it.active && best.active && it.light.intensity < best.light.intensity)) best = it;
    }
    if (!best) return null;
    best.locked = true;
    best.active = true;
    return best.light;
  }

  release(light) {
    const it = this.items.find((x) => x.light === light);
    if (!it) return;
    it.locked = false;
    it.active = false;
    it.light.intensity = 0;
  }

  update(dt) {
    for (const it of this.items) {
      if (it.locked || !it.active) continue;
      it.t += dt;
      const k = 1 - it.t / it.dur;
      if (k <= 0) { it.active = false; it.light.intensity = 0; continue; }
      const f = it.flicker > 0 ? 1 - it.flicker * Math.random() : 1;
      it.light.intensity = it.i0 * k * k * f;
    }
  }

  releaseAll() {
    for (const it of this.items) { it.locked = false; it.active = false; it.light.intensity = 0; }
  }
}
