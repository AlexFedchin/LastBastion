// Medals: the service record across every campaign. Some come with the first night, some
// only to the few who carry everyone out on Last Stand.
//
// Each medal has a grade (bronze, silver, gold, valour), a ribbon (stripes, inside out)
// and an emblem for its medallion (src/ui/medalArt.js), the requirement as the player
// reads it, and, where it builds up, a progress readout:
//   count  a running total across all campaigns (kills, headshots, calls...)
//   best   the best single night or blast so far (shown as best / target)
// The record lives in localStorage beside the save. Developer-tools runs never count.
import { ZT, FINAL_NIGHT } from '../config.js';

const KEY = 'lastbastion.medals.v1';

export const GRADES = {
  bronze: { label: 'BRONZE', order: 0 },
  silver: { label: 'SILVER', order: 1 },
  gold: { label: 'GOLD', order: 2 },
  valor: { label: 'VALOUR', order: 3 },
};

// Ribbon colours (a small, consistent palette, so the rack reads as one service's ribbons)
const C = {
  olive: '#4f5a2e', khaki: '#a8935c', sand: '#cdb98a', rust: '#8a3b22', red: '#a82820', crimson: '#6f1420',
  navy: '#1d2a4a', blue: '#2f5a8c', sky: '#6f97b8', black: '#141414', white: '#e8e2d2', gold: '#c9a13c',
  green: '#2f5a37', orange: '#c2641f', purple: '#4a2a5a', grey: '#6d6a62', teal: '#2a5f5c',
};

/**
 * stripes: [colour, width] from the edge to the centre (mirrored), widths in ribbon units (sum 50).
 * stat: what the progress bar reads from the record; target: where the medal is won.
 */
export const MEDALS = [
  // ── bronze: the first steps ─────────────────────────────────────────────
  { id: 'baptism', grade: 'bronze', name: 'BAPTISM OF FIRE', icon: 'dawn', req: 'Hold the wall through the first night.',
    stripes: [[C.olive, 10], [C.sand, 4], [C.olive, 8], [C.red, 6], [C.olive, 22]] },
  { id: 'marksman', grade: 'bronze', name: 'MARKSMAN BADGE', icon: 'crosshair', req: 'Land 250 headshots with the fifty.',
    stat: 'headshots', kind: 'count', target: 250, stripes: [[C.navy, 12], [C.white, 3], [C.navy, 10], [C.white, 3], [C.blue, 22]] },
  { id: 'firemission', grade: 'bronze', name: 'FIRE MISSION', icon: 'shell', req: 'Call the 105s down on the field 15 times.',
    stat: 'artillery', kind: 'count', target: 15, stripes: [[C.red, 8], [C.khaki, 10], [C.red, 4], [C.khaki, 28]] },
  { id: 'bruteforce', grade: 'bronze', name: 'BRUTE FORCE', icon: 'skullCrack', req: 'Put down 50 Brutes.',
    stat: 'brutes', kind: 'count', target: 50, stripes: [[C.black, 8], [C.rust, 16], [C.black, 4], [C.rust, 22]] },
  { id: 'shepherd', grade: 'bronze', name: 'GOOD SHEPHERD', icon: 'people', req: 'Bring every last one of a group through the gate: a patrol or the civilians.',
    stripes: [[C.white, 6], [C.sky, 14], [C.white, 4], [C.sky, 26]] },
  { id: 'quartermaster', grade: 'bronze', name: 'QUARTERMASTER', icon: 'wrench', req: 'Fit 12 upgrades at the dawn resupply.',
    stat: 'upgrades', kind: 'count', target: 12, stripes: [[C.khaki, 10], [C.olive, 6], [C.khaki, 6], [C.green, 28]] },
  { id: 'scorched', grade: 'bronze', name: 'SCORCHED EARTH', icon: 'flame', req: 'Burn 300 of the dead.',
    stat: 'fire', kind: 'count', target: 300, stripes: [[C.orange, 10], [C.black, 4], [C.orange, 8], [C.red, 28]] },
  { id: 'salvage', grade: 'bronze', name: 'SALVAGE', icon: 'crate', req: 'Recover an airdrop crate before the dead tear it open.',
    stripes: [[C.olive, 6], [C.white, 3], [C.olive, 14], [C.sand, 27]] },

  // ── silver: holding it together ─────────────────────────────────────────
  { id: 'steady', grade: 'silver', name: 'STEADY HANDS', icon: 'thermo', req: 'Hold a night, from night 3 on, without overheating the fifty once.',
    stripes: [[C.sky, 10], [C.white, 6], [C.sky, 6], [C.navy, 28]] },
  { id: 'nobody', grade: 'silver', name: 'NO ONE LEFT BEHIND', icon: 'shield', req: 'Hold a night, from night 4 on, without losing a single survivor.',
    stripes: [[C.green, 8], [C.gold, 4], [C.green, 12], [C.white, 4], [C.green, 22]] },
  { id: 'giant', grade: 'silver', name: 'GIANT KILLER', icon: 'footprint', req: 'Bring down Goliath, the giant that walks out of the city.',
    stripes: [[C.crimson, 10], [C.grey, 8], [C.crimson, 6], [C.black, 26]] },
  { id: 'danger', grade: 'silver', name: 'DANGER CLOSE', icon: 'burst', req: 'Kill 40 of the dead with a single danger-close call.',
    stat: 'dangerBest', kind: 'best', target: 40, stripes: [[C.red, 12], [C.white, 3], [C.black, 6], [C.white, 3], [C.red, 26]] },
  { id: 'hammer', grade: 'silver', name: 'HAMMER DOWN', icon: 'bomb', req: 'Kill 30 of the dead with one 2,000 lb bomb.',
    stat: 'bombBest', kind: 'best', target: 30, stripes: [[C.sky, 8], [C.navy, 10], [C.gold, 4], [C.navy, 28]] },
  { id: 'warden', grade: 'silver', name: 'ROAD WARDEN', icon: 'truck', req: 'Bring the convoy in through the gate.',
    stripes: [[C.khaki, 8], [C.rust, 6], [C.khaki, 10], [C.olive, 26]] },
  { id: 'sharpshooter', grade: 'silver', name: 'SHARPSHOOTER', icon: 'target', req: 'Hold a night, from night 3 on, with at least 55% of your rounds on target.',
    stat: 'accuracyBest', kind: 'best', target: 55, unit: '%', stripes: [[C.blue, 6], [C.white, 6], [C.blue, 6], [C.white, 6], [C.navy, 26]] },
  { id: 'bloody', grade: 'silver', name: 'BLOODY NIGHT', icon: 'skull', req: 'Kill 1,500 of the dead in a single night.',
    stat: 'nightKillsBest', kind: 'best', target: 1500, stripes: [[C.black, 12], [C.red, 10], [C.black, 4], [C.crimson, 24]] },

  // ── gold: the campaign ──────────────────────────────────────────────────
  { id: 'seventytwo', grade: 'gold', name: 'SEVENTY-TWO HOURS', icon: 'seventyTwo', req: `Hold the wall through all ${FINAL_NIGHT} nights.`,
    stat: 'nightBest', kind: 'best', target: FINAL_NIGHT, unit: ' nights', stripes: [[C.gold, 8], [C.crimson, 8], [C.gold, 4], [C.crimson, 30]] },
  { id: 'nightingale', grade: 'gold', name: "NIGHTINGALE'S WINGS", icon: 'helicopter', req: 'Make the extraction flight: fifteen or more alive when the lifters land.',
    stripes: [[C.sky, 6], [C.white, 4], [C.sky, 10], [C.gold, 4], [C.blue, 26]] },
  { id: 'colossus', grade: 'gold', name: 'COLOSSUS', icon: 'mountain', req: 'Bring down the Behemoth, the biggest of them all.',
    stripes: [[C.black, 6], [C.gold, 4], [C.black, 10], [C.grey, 30]] },
  { id: 'tenthousand', grade: 'gold', name: 'TEN THOUSAND', icon: 'tenK', req: 'Kill 10,000 of the dead, across every campaign.',
    stat: 'kills', kind: 'count', target: 10000, stripes: [[C.crimson, 12], [C.gold, 4], [C.crimson, 6], [C.black, 28]] },
  { id: 'longwatch', grade: 'gold', name: 'THE LONG WATCH', icon: 'hourglass', req: 'Hold five nights past the seventy-second hour, in endless nights.',
    stat: 'endlessBest', kind: 'best', target: 5, unit: ' nights', stripes: [[C.purple, 10], [C.gold, 4], [C.purple, 8], [C.black, 28]] },

  // ── valour: for the very few ────────────────────────────────────────────
  { id: 'ironwall', grade: 'valor', name: 'IRON WALL', icon: 'wall', req: 'Hold three nights in a row, from night 6 on, without a single breach.',
    stat: 'cleanStreakBest', kind: 'best', target: 3, unit: ' nights', stripes: [[C.grey, 8], [C.black, 4], [C.grey, 8], [C.red, 4], [C.black, 26]] },
  { id: 'laststand', grade: 'valor', name: 'LAST STAND', icon: 'laurelStar', req: 'Make the extraction flight on Last Stand.',
    stripes: [[C.crimson, 14], [C.gold, 3], [C.crimson, 6], [C.gold, 3], [C.crimson, 24]] },
  { id: 'unbroken', grade: 'valor', name: 'UNBROKEN', icon: 'flag', req: 'Make the extraction with 30 or more alive, on Veteran or Last Stand.',
    stripes: [[C.white, 6], [C.red, 6], [C.white, 6], [C.blue, 32]] },
  { id: 'fiftyalone', grade: 'valor', name: 'THE FIFTY ALONE', icon: 'gun', req: 'Hold the fifth night without fitting a single upgrade or buying a claymore.',
    stripes: [[C.black, 14], [C.khaki, 4], [C.black, 6], [C.khaki, 4], [C.black, 22]] },
  { id: 'lastbastion', grade: 'valor', name: 'THE LAST BASTION', icon: 'tower', req: 'Hold ten nights past the seventy-second hour, in endless nights.',
    stat: 'endlessBest', kind: 'best', target: 10, unit: ' nights', stripes: [[C.gold, 6], [C.black, 6], [C.gold, 4], [C.crimson, 34]] },
];

const blank = () => ({
  earned: {},          // id -> time it was won
  stats: {},           // the running totals and bests the progress bars read
  campaign: { purchases: 0 }, // per campaign: what was bought (the fifty alone)
  streak: { night: 0, n: 0 }, // nights in a row without a breach, from night 6 on
});

export class Medals {
  constructor() {
    this.state = this.load();
    this.onAward = null; // (medal) when one is won
    this.night = null;   // this night's tally
  }

  load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (s && s.earned) return { ...blank(), ...s, stats: { ...(s.stats || {}) }, campaign: { purchases: 0, ...(s.campaign || {}) }, streak: { night: 0, n: 0, ...(s.streak || {}) } };
    } catch { /* fresh record */ }
    return blank();
  }

  save() { try { localStorage.setItem(KEY, JSON.stringify(this.state)); } catch { /* storage full or off */ } }

  // ── reading ───────────────────────────────────────────────────────────────
  earned(id) { return !!this.state.earned[id]; }
  count() { return Object.keys(this.state.earned).length; }

  /** The progress bar for a medal, or null if it is won in one go. */
  progress(m) {
    if (!m.stat) return null;
    const v = Math.max(0, Math.round(this.state.stats[m.stat] || 0));
    return { value: this.earned(m.id) ? Math.max(v, m.target) : v, target: m.target, kind: m.kind, unit: m.unit || '' };
  }

  // ── writing ───────────────────────────────────────────────────────────────
  add(stat, n = 1) { this.state.stats[stat] = (this.state.stats[stat] || 0) + n; }
  best(stat, v) { if (v > (this.state.stats[stat] || 0)) this.state.stats[stat] = v; }

  award(id) {
    if (this.earned(id)) return;
    this.state.earned[id] = Date.now();
    this.save();
    const m = MEDALS.find((x) => x.id === id);
    if (m && this.onAward) this.onAward(m);
  }

  /** Award every medal whose running total or best has reached its target. */
  sweep() {
    for (const m of MEDALS) if (m.stat && !this.earned(m.id) && (this.state.stats[m.stat] || 0) >= m.target) this.award(m.id);
    this.save();
  }

  // ── what happens in the game (main.js calls these) ────────────────────────
  active(run) { return !!run && !run.dev; }

  newCampaign() { this.state.campaign = { purchases: 0 }; this.state.streak = { night: 0, n: 0 }; this.save(); }

  startNight(run) {
    if (!this.active(run)) { this.night = null; return; }
    this.night = { overheats: 0, danger: 0, breaches: 0 };
  }

  kill(run, type, cause, headshot) {
    if (!this.active(run)) return;
    this.add('kills');
    if (headshot && (cause === 'hmg' || cause === 'he')) this.add('headshots');
    if (type === ZT.BRUTE) this.add('brutes');
    if (cause === 'fire') this.add('fire');
    if (cause === 'danger' && this.night) this.night.danger++;
    // the totals are swept every few kills, not on every one (and at dawn)
    if ((this.state.stats.kills & 31) === 0) this.sweep();
  }

  blast(run, kills, cause) {
    if (!this.active(run)) return;
    if (cause === 'bomb') { this.best('bombBest', kills); this.sweep(); }
  }

  ability(run, name, ok) {
    if (!this.active(run) || !ok) return;
    if (name === 'artillery') { this.add('artillery'); this.sweep(); }
  }

  overheat(run) { if (this.active(run) && this.night) this.night.overheats++; }
  breach(run) { if (this.active(run) && this.night) this.night.breaches++; }

  purchase(run, what) {
    if (!this.active(run)) return;
    this.state.campaign.purchases++;
    if (what !== 'claymores') this.add('upgrades');
    this.sweep();
  }

  event(run, kind, data) {
    if (!this.active(run)) return;
    if ((kind === 'patrol' || kind === 'civilians') && data.of > 0 && data.saved === data.of) this.award('shepherd');
    if (kind === 'drop' && data.recovered) this.award('salvage');
    if (kind === 'convoy' && data.saved) this.award('warden');
    if (kind === 'giant' && data.killed) this.award('giant');
    if (kind === 'behemoth' && data.killed) { this.award('giant'); this.award('colossus'); }
  }

  /** A night held: ns is the night's report (kills, lost, shots, hits). */
  nightHeld(run, night, ns) {
    if (!this.active(run)) return;
    const n = this.night || { overheats: 0, danger: 0, breaches: 0 };
    this.award('baptism');
    this.best('nightBest', night);
    this.best('nightKillsBest', ns.kills);
    this.best('dangerBest', n.danger);
    if (night >= 3 && ns.shots >= 100) this.best('accuracyBest', Math.floor(100 * ns.hits / ns.shots));
    if (night >= 3 && n.overheats === 0) this.award('steady');
    if (night >= 4 && ns.lost === 0) this.award('nobody');
    // three clean nights in a row from night 6 on
    const st = this.state.streak;
    if (night >= 6 && n.breaches === 0) { st.n = st.night === night - 1 ? st.n + 1 : 1; st.night = night; } else st.n = 0;
    this.best('cleanStreakBest', st.n);
    if (night >= 5 && this.state.campaign.purchases === 0) this.award('fiftyalone');
    if (run.endless && night > FINAL_NIGHT) this.best('endlessBest', night - FINAL_NIGHT);
    this.sweep();
  }

  /** The campaign's end: the ending after night 10 (extracted, or not). */
  campaignEnd(run, extracted) {
    if (!this.active(run)) return;
    this.best('nightBest', FINAL_NIGHT);
    if (extracted) {
      this.award('nightingale');
      if (run.difficulty === 'laststand') this.award('laststand');
      if ((run.difficulty === 'veteran' || run.difficulty === 'laststand') && run.survivors >= 30) this.award('unbroken');
    }
    this.sweep();
  }
}
