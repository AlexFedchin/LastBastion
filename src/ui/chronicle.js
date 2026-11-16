// The chronicle: at every dawn, the story of the night that just ended, told
// years later by one of the men who held the wall. Not the numbers (the
// resupply screen has those) but what happened: how the night opened, how each
// of its events ended, the one thing worth remembering, what it cost, and how
// the morning found them. Every fragment is a voiced line (CHRONICLE in config).
import { CHRONICLE, CALL, FINAL_NIGHT } from '../config.js';

const $ = (id) => document.getElementById(id);
const pickOne = (a) => a[(Math.random() * a.length) | 0];

/** How one of tonight's events ended, as a line of the story (null: nothing to tell). */
function eventLine(kind, log) {
  const E = CHRONICLE.events[kind];
  if (!E) return null;
  const end = log.find((e) => e.kind === kind && e.phase === 'end');
  switch (kind) {
    case 'patrol': case 'civilians': {
      if (!end) return null;
      const { saved, of } = end.data;
      return saved >= of ? E.all : saved > 0 ? E.some : E.none;
    }
    case 'drop': return end ? (end.data.recovered ? E.saved : E.lost) : null;
    case 'giant': case 'behemoth': return end ? (end.data.reachedWall ? E.wall : E.field) : null;
    case 'gunshipDown': return end ? E.down : null; // no gunship up: it never happened
    case 'tanker': return end ? (end.data.blown ? E.boom : E.wasted) : null;
    case 'convoy': return end ? (end.data.saved ? E.saved : E.lost) : null;
    default: return E.held;
  }
}

/**
 * The night as a story.
 * @param {{night:number, endless:boolean, log:{kind,phase,data}[], ns:object, survivors:number, dangerUsed:boolean}} o
 * @returns {{night:number, title:string, lines:string[]}}
 */
export function composeChronicle({ night, endless, log = [], ns = {}, survivors = 99, dangerUsed = false }) {
  const C = CHRONICLE;
  const free = endless || night > FINAL_NIGHT;
  const lines = [free ? pickOne(C.open.endless) : C.open[night]];
  // the night's events, in the order they came
  const told = new Set();
  for (const e of log) {
    if (told.has(e.kind)) continue;
    const t = eventLine(e.kind, log);
    told.add(e.kind);
    if (t) lines.push(t);
  }
  // one deed, if the night had one worth remembering (play-test logs: an ordinary
  // night's best streak is 20-45 kills, a bomber's 100+; one bottle burns ~20)
  // (each night tells its own: the same words every dawn would wear thin)
  const per = (set, generic) => (!free && set[night]) || generic;
  const deed = dangerUsed ? C.deeds.danger
    : (ns.fireKills || 0) >= 150 ? per(C.deedNight.fire, C.deeds.fire)
      : (ns.bestStreak || 0) >= 80 ? per(C.deedNight.massacre, C.deeds.massacre) : null;
  if (deed) lines.push(deed);
  // the cost
  const lost = ns.lost || 0;
  const heavy = lost >= 10 || survivors <= 5;
  if (heavy) lines.push(C.toll.heavy);
  else if (!free && C.tollNight[night]) lines.push(lost === 0 ? C.tollNight[night].none : C.tollNight[night].lost);
  else lines.push(lost === 0 ? C.toll.none : lost >= 4 ? C.toll.many : C.toll.few);
  lines.push(free ? pickOne(C.close.endless) : C.close[night]);
  return { night, title: free ? C.title.endless : C.title[night], lines };
}

/** Plays a composed chronicle over the dawn: each line appears as the narrator starts it. */
export class Chronicle {
  constructor(game) {
    this.g = game;
    this.active = false;
    this.done = true;
  }

  /** Show and narrate a story. onDone runs once, when the player clicks on after the last line. */
  play(story, onDone) {
    this.story = story;
    this.onDone = onDone;
    this.active = true;
    this.done = false;
    this.i = -1;
    this.t = 0;
    this.next = 1.4; // let the card settle before the first words
    this.endT = -1;
    this.waiting = false;
    $('chr-kicker').textContent = `BASTION-7 · THE CHRONICLE · DAY ${story.night}`;
    $('chr-night').textContent = `NIGHT ${String(story.night).padStart(2, '0')}`;
    $('chr-title').textContent = story.title;
    $('chr-body').innerHTML = story.lines.map((l, k) => `<p id="chr-l${k}">${l}</p>`).join('');
    $('chr-next').classList.remove('on');
    this.g.screens.show('chronicle');
  }

  /** Real-time tick. */
  update(dt) {
    if (!this.active) return;
    this.t += dt;
    const L = this.story.lines;
    if (this.i < L.length - 1 && this.t >= this.next) {
      this.i++;
      const el = $('chr-l' + this.i);
      if (this.i > 0) $('chr-l' + (this.i - 1)).classList.add('past');
      el.classList.add('on');
      const words = L[this.i].split(/\s+/).length;
      const spoken = this.g.audio.narrate(CALL.narrator, L[this.i]);
      // no recording (or no sound): give the reader the time a narrator would take
      this.next = this.t + (spoken > 0 ? spoken + 0.6 : 1.2 + words / 2.6);
      if (this.i === L.length - 1) this.endT = this.next;
    }
    if (this.endT >= 0 && this.t >= this.endT && !this.waiting) this.prompt();
  }

  /** Every line is on the page: wait for the reader to click on. */
  prompt() {
    this.waiting = true;
    this.waitFrom = this.t;
    $('chr-next').textContent = 'CLICK OR PRESS SPACE TO CONTINUE ▸';
    $('chr-next').classList.add('on');
  }

  /**
   * Click / Space. While the story is being told, the first press shows the rest of it at
   * once (and stops the narrator); the screen then waits for one more press to move on.
   * Presses closer than a moment apart count once, so a double-click can't skip it all.
   */
  advance() {
    if (!this.active) return;
    if (!this.waiting) {
      this.g.audio.stopVoice();
      this.story.lines.forEach((_, k) => { const el = $('chr-l' + k); el.classList.add('on'); if (k < this.story.lines.length - 1) el.classList.add('past'); });
      this.i = this.story.lines.length - 1;
      this.endT = this.t;
      this.prompt();
      return;
    }
    if (this.t - this.waitFrom < 0.35) return;
    this.finish();
  }

  finish() {
    if (!this.active) return;
    this.active = false;
    this.done = true;
    this.g.audio.stopVoice();
    const cb = this.onDone;
    this.onDone = null;
    if (cb) cb();
  }

  stop() {
    this.active = false;
    this.done = true;
    this.onDone = null;
  }
}
