// The night director: paces the horde — a steady trickle, warned surges
// down one side of the valley, and the final tide before dawn.
import { WORLD } from '../config.js';
import { rand, randn } from '../core/util.js';

export class Director {
  constructor(horde) {
    this.horde = horde;
    this.plan = null;
    this.t = 0;
    this.queue = [];
    this.events = [];
    this.onEvent = null; // (kind, data)
  }

  start(plan) {
    this.plan = plan;
    this.t = 0;
    this.queue.length = 0;
    this.trickleAcc = 0;
    this.spawned = 0;
    const L = plan.duration;
    const surgeFrac = Math.min(0.11, 0.5 / plan.surges);
    const tideFrac = plan.tide ?? 0.2;
    this.surgeSize = Math.round(plan.total * surgeFrac);
    this.tideSize = Math.round(plan.total * tideFrac);
    this.trickleTotal = Math.max(0, plan.total - this.surgeSize * plan.surges - this.tideSize);
    this.events = [];
    for (let k = 0; k < plan.surges; k++) {
      const at = L * (0.14 + 0.62 * (k + 0.5) / plan.surges) + rand(-5, 5);
      const side = Math.random() < 0.5 ? -1 : 1;
      const cx = side * rand(25, 105);
      this.events.push({ kind: 'surge', at, warned: false, done: false, cx, size: this.surgeSize });
    }
    this.events.push({ kind: 'tide', at: L * 0.8, warned: false, done: false, size: this.tideSize });
    this.events.sort((a, b) => a.at - b.at);
  }

  get remaining() { return Math.max(0, this.plan.duration - this.t); }
  get progress() { return Math.min(1, this.t / this.plan.duration); }
  get spawningDone() { return this.t >= this.plan.duration && this.queue.length === 0 && this.events.every((e) => e.done); }
  get pending() { return this.queue.length + Math.max(0, Math.round(this.trickleTotal - this.trickleSpawned())); }

  trickleSpawned() { return this._tsp || 0; }

  pickType() {
    const m = this.plan.mix;
    let r = Math.random();
    for (let k = 0; k < m.length; k++) { r -= m[k]; if (r <= 0) return k; }
    return 0;
  }

  update(dt) {
    const p = this.plan;
    if (!p) return;
    this.t += dt;
    const L = p.duration;

    // trickle, ramping up through the night
    if (this.t < L) {
      const u = this.t / L;
      const pdf = (0.35 + 1.3 * u) / L;
      this.trickleAcc += this.trickleTotal * pdf * dt;
      while (this.trickleAcc >= 1) {
        this.trickleAcc -= 1;
        this._tsp = (this._tsp || 0) + 1;
        const x = rand(-WORLD.SPAWN_X, WORLD.SPAWN_X);
        this.queue.push({ type: this.pickType(), x, z: rand(WORLD.SPAWN_Z_FAR, WORLD.SPAWN_Z_NEAR), side: 0, delay: 0 });
      }
    }

    // scripted events
    for (const e of this.events) {
      if (e.done) continue;
      if (!e.warned && this.t >= e.at - 6) {
        e.warned = true;
        if (this.onEvent) this.onEvent(e.kind === 'tide' ? 'tideWarn' : 'surgeWarn', e);
      }
      if (this.t >= e.at) {
        e.done = true;
        if (e.kind === 'surge') {
          for (let k = 0; k < e.size; k++) {
            const x = e.cx + randn() * 24;
            this.queue.push({ type: this.pickType(), x, z: WORLD.SPAWN_Z_NEAR - rand(0, 40), side: Math.sign(e.cx), delay: rand(0, 5) });
          }
        } else {
          for (let k = 0; k < e.size; k++) {
            this.queue.push({ type: this.pickType(), x: rand(-WORLD.SPAWN_X, WORLD.SPAWN_X), z: WORLD.SPAWN_Z_NEAR - rand(0, 50), side: 0, delay: rand(0, 14) });
          }
        }
        if (this.onEvent) this.onEvent(e.kind, e);
      }
    }

    // drain the queue into the world as room allows
    if (this.queue.length) {
      const h = this.horde;
      let budget = Math.max(0, h.cap - h.n);
      let spawnedThisFrame = 0;
      for (let k = 0; k < this.queue.length && budget > 0 && spawnedThisFrame < 60; k++) {
        const q = this.queue[k];
        if (q.delay > 0) { q.delay -= dt; continue; }
        h.spawn(q.type, q.x, q.z, p.hpMul, p.speedMul, q.side);
        this.spawned++;
        budget--; spawnedThisFrame++;
        this.queue[k] = this.queue[this.queue.length - 1];
        this.queue.pop();
        k--;
      }
    }
  }
}
