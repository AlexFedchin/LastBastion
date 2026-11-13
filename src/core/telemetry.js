// Play-test telemetry: one JSON object per line, appended to a file by the
// Electron main process (userData/telemetry/session-<date>.jsonl).
//
//   session        once per launch: quality, GPU, screen, settings
//   night_start    difficulty, plan, owned upgrades, what's unlocked
//   ability        every key press of an ability, and whether it went off
//   breach         a survivor lost: section and cause (climb / giant / ...)
//   event          night events starting and how they ended
//   sample         every 10 s: horde size, wall pressure, survivors, fps
//   night_summary  the night in numbers: kills by source, accuracy, heat,
//                  breaches, how close it got, abilities, events, fps
//   purchase       dawn resupply buys
//
// Kill sources are grouped so it's easy to see who is doing the work:
//   gun      the fifty itself (hmg, he)
//   called   what the player called in (arty, grenade, bomb, danger, fire*)
//   support  autonomous help (gunner, rifle, gunship, mortar, mine, wire)
//   chain    bloaters bursting, bodies at the wall
// (*fire is mostly Molotov pools, plus incendiary rounds and burning wrecks)
import { ZOMBIE_TYPES } from '../config.js';

const GROUP = {
  hmg: 'gun', he: 'gun',
  arty: 'called', grenade: 'called', bomb: 'called', danger: 'called', fire: 'called',
  gunner: 'support', rifle: 'support', gunship: 'support', mortar: 'support', mine: 'support', wire: 'support',
  bloater: 'chain', wall: 'chain',
};
const TYPE_NAMES = ZOMBIE_TYPES.map((t) => t.name.toLowerCase());
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

export class Telemetry {
  constructor(game) {
    this.g = game;
    this.t0 = performance.now();
    this.n = null;          // the current night's accumulators
    this.recent = [];       // last lines, for devtools: window.__LB.telemetry.recent
    this.path = null;
    try { window.bastion?.telemetryPath?.().then((p) => { this.path = p; }).catch(() => {}); } catch { /* browser */ }
  }

  write(type, data = {}) {
    const g = this.g;
    const rec = {
      type,
      at: new Date().toISOString(),
      t: round((performance.now() - this.t0) / 1000, 1),
      ...(this.n ? { night: this.n.night, nt: round(this.n.t, 1) } : (g.run ? { night: g.run.night } : {})),
      ...data,
    };
    const line = JSON.stringify(rec);
    this.recent.push(rec);
    if (this.recent.length > 400) this.recent.shift();
    try { window.bastion?.telemetry?.(line); } catch { /* no file sink (browser / tests) */ }
  }

  session() {
    const g = this.g;
    let gpu = '?';
    try {
      const gl = g.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) gpu = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL);
    } catch { /* ignore */ }
    this.write('session', {
      quality: g.settings.quality, gpu, screen: [window.innerWidth, window.innerHeight], dpr: window.devicePixelRatio,
      settings: { ...g.settings },
    });
  }

  // ── night lifecycle ──────────────────────────────────────────────────────
  startNight(run, plan, stats, unlocked) {
    this.n = {
      night: run.night, t: 0, fireT: 0, frames: 0, ftSum: 0, slow: 0, ftHist: new Uint32Array(60),
      survivorsStart: run.survivors, minSurvivors: run.survivors,
      kills: 0, byCause: {}, byType: {}, byGroup: { gun: 0, called: 0, support: 0, chain: 0, other: 0 }, gunHeadshots: 0,
      breaches: {}, breachBySection: new Array(10).fill(0),
      overheats: 0, swaps: 0,
      abilities: {},
      peakP: 0, peakSection: -1, above60: 0, above80: 0,
      events: [],
      sampleT: 0,
      shots0: this.g.player.shots, hits0: this.g.player.hits,
    };
    this.write('night_start', {
      difficulty: run.difficulty, endless: !!run.endless, survivors: run.survivors, supplies: Math.round(run.supplies),
      plan: { duration: plan.duration, total: plan.total, surges: plan.surges, hpMul: round(plan.hpMul), speedMul: round(plan.speedMul) },
      upgrades: { ...run.upgrades }, minesOwned: run.minesOwned, unlocked,
      stats: { gunners: stats.gunners, wireBands: stats.wireBands, hmgDamage: round(stats.hmgDamage), hmgRate: round(stats.hmgRate) },
    });
  }

  /** Every frame of a night in play (real time). */
  frame(rdt, maxP, maxS) {
    const n = this.n;
    if (!n) return;
    const g = this.g;
    n.t += rdt;
    n.frames++;
    n.ftSum += rdt;
    n.ftHist[Math.min(59, Math.floor(rdt * 1000 / 2))]++; // 2 ms buckets
    if (rdt > 1 / 30) n.slow++;
    if (g.player.firing) n.fireT += rdt;
    if (maxP > n.peakP) { n.peakP = maxP; n.peakSection = maxS; }
    if (maxP > 0.6) n.above60 += rdt;
    if (maxP > 0.8) n.above80 += rdt;
    if (g.run.survivors < n.minSurvivors) n.minSurvivors = g.run.survivors;
    n.sampleT += rdt;
    if (n.sampleT >= 10) {
      n.sampleT = 0;
      const h = g.horde;
      this.write('sample', {
        alive: h.alive, queued: g.director.queue.length, survivors: g.run.survivors, kills: n.kills,
        maxPressure: round(maxP), pressure: Array.from({ length: 10 }, (_, s) => round(h.pressure(s), 2)),
        heat: round(g.player.heat), fps: Math.round(n.frames / Math.max(0.001, n.ftSum)),
        grenades: g.arsenal.grenadesLeft,
      });
    }
  }

  kill(type, cause, headshot) {
    const n = this.n;
    if (!n) return;
    n.kills++;
    n.byCause[cause] = (n.byCause[cause] || 0) + 1;
    const tn = TYPE_NAMES[type] || String(type);
    n.byType[tn] = (n.byType[tn] || 0) + 1;
    n.byGroup[GROUP[cause] || 'other']++;
    if (headshot && GROUP[cause] === 'gun') n.gunHeadshots++;
  }

  breach(section, cause) {
    const n = this.n;
    if (n) {
      n.breaches[cause] = (n.breaches[cause] || 0) + 1;
      if (section >= 0 && section < 10) n.breachBySection[section]++;
    }
    this.write('breach', { section, cause, survivors: this.g.run?.survivors });
  }

  ability(name, ok, extra = {}) {
    const n = this.n;
    if (n) {
      const a = n.abilities[name] || (n.abilities[name] = { used: 0, refused: 0, at: [] });
      if (ok) { a.used++; a.at.push(round(n.t, 1)); } else a.refused++;
    }
    this.write('ability', { name, ok, ...extra });
  }

  overheat() { if (this.n) this.n.overheats++; }
  swap(heat) { if (this.n) this.n.swaps++; this.write('barrel_swap', { heat: round(heat) }); }

  event(kind, phase, data = {}) {
    if (this.n && phase !== 'start') this.n.events.push({ kind, phase, ...data });
    this.write('event', { kind, phase, ...data });
  }

  endNight(outcome) {
    const n = this.n;
    if (!n) return;
    const g = this.g, p = g.player;
    const shots = p.shots - n.shots0, hits = p.hits - n.hits0;
    // frame-time percentiles from the histogram
    const pct = (q) => {
      let acc = 0;
      for (let k = 0; k < n.ftHist.length; k++) { acc += n.ftHist[k]; if (acc >= n.frames * q) return (k + 1) * 2; }
      return 120;
    };
    const share = {};
    for (const [k, v] of Object.entries(n.byGroup)) share[k] = n.kills ? round(v / n.kills, 3) : 0;
    this.write('night_summary', {
      outcome,
      seconds: round(n.t, 1),
      survivors: { start: n.survivorsStart, end: g.run.survivors, min: n.minSurvivors },
      breaches: n.breaches, breachBySection: n.breachBySection,
      closest: { peakPressure: round(n.peakP), peakSection: n.peakSection, secondsAbove60: round(n.above60, 1), secondsAbove80: round(n.above80, 1) },
      kills: { total: n.kills, byGroup: n.byGroup, share, byCause: n.byCause, byType: n.byType },
      gun: {
        shots, hits, accuracy: shots ? round(hits / shots, 3) : 0, headshotKills: n.gunHeadshots,
        secondsFiring: round(n.fireT, 1), overheats: n.overheats, barrelSwaps: n.swaps,
      },
      abilities: n.abilities,
      events: n.events,
      supplies: { earned: Math.round(g.ns?.supplies || 0), bonus: g.ns?.bonus || 0, total: Math.round(g.run.supplies) },
      bestStreak: g.ns?.bestStreak || 0,
      perf: { quality: g.settings.quality, fpsAvg: Math.round(n.frames / Math.max(0.001, n.ftSum)), frameMsP50: pct(0.5), frameMsP95: pct(0.95), frameMsP99: pct(0.99), slowFrames: n.slow, frames: n.frames },
    });
    this.n = null;
  }

  purchase(item, rank, cost, suppliesLeft) { this.write('purchase', { item, rank, cost, suppliesLeft: Math.round(suppliesLeft) }); }
}
