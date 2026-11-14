// The loading screen: painted key art (app/art, made by scripts/art) split into
// a far and a near layer that drift against each other, rain, mist and embers
// over it, all in CSS so it keeps moving while the game builds the world on the
// main thread; a belt of .50 rounds for progress, a radio-log of the steps and
// rotating field notes.
//
// Used at boot, before a reload (graphics change), and as a short deployment
// card when a run starts — while the shaders for things not yet seen compile.
const $ = (id) => document.getElementById(id);

const TIPS = [
  'The pile is the enemy, not the horde. Watch the wall map and cut down whatever is climbing.',
  'A barrel past 75% is a barrel about to cook. Short bursts, or it locks up to cool.',
  'Headshots do more than double damage. Optics (RMB) tighten the spread.',
  'Bloaters burst and take their neighbours with them. If one reaches the wall, its acid melts a ramp.',
  'A brute weighs as much as three men on a pile. Kill them before they get there.',
  'A Molotov on the wall base burns right where the piles grow — and whatever walks through it catches.',
  'Artillery takes three seconds to land. Lead the crowd.',
  'Danger close clears the whole wall line. It also kills three of ours.',
  'The tide comes at the end of every night. Save something for it.',
  'Red smoke marks the spot for the bomber. Throw it far — two thousand pounds lands there.',
  'Spectre works the far field. What reaches the wall is yours.',
  'Supplies come from kills. Every night survived pays a bonus for every man still standing.',
  'Claymores stay in the ground until something walks over them.',
  'Kovac has been on this wall since the first night. He has not slept since the second.',
  'Seventy-two hours. Command said seventy-two hours.',
  'If the radio goes quiet, keep firing.',
];

// the paintings, and what each is for: nest (boot), wall / gunship / drop / giant (nights), dawn (resupply)
export const ART = ['nest', 'wall', 'gunship', 'drop', 'giant', 'dawn'];

export class Loader {
  constructor() {
    this.el = $('loading');
    this.ui = {
      kicker: $('ld-kicker'), title: $('ld-title'), tag: $('ld-tag'),
      belt: $('ld-belt'), sub: $('ld-sub'), log: $('ld-log'), tip: $('ld-tip'),
    };
    this.far = $('ld-far'); this.near = $('ld-near');
    this.art = 'nest';
    this.lines = [];
    this.tipIdx = (Math.random() * TIPS.length) | 0;
    this.ui.tip.textContent = TIPS[this.tipIdx];
    this.startTips();
  }

  get visible() { return !this.el.classList.contains('done'); }

  startTips() {
    clearInterval(this.tipTimer);
    this.tipTimer = setInterval(() => {
      const p = this.ui.tip;
      p.classList.add('out');
      setTimeout(() => {
        this.tipIdx = (this.tipIdx + 1 + ((Math.random() * 3) | 0)) % TIPS.length;
        p.textContent = TIPS[this.tipIdx];
        p.classList.remove('out');
      }, 500);
    }, 6500);
  }

  /** Which painting is behind the words (a name in ART). */
  setArt(name) {
    if (!ART.includes(name) || name === this.art) return;
    this.art = name;
    this.far.style.backgroundImage = `url("art/${name}.webp")`;
    this.near.style.backgroundImage = `url("art/${name}-near.webp")`;
    // start the slow drift over from the beginning
    for (const e of [this.far, this.near]) { e.style.animation = 'none'; void e.offsetWidth; e.style.animation = ''; }
  }

  /**
   * Bring the loading screen up. Resolves once it covers the screen.
   * opts: { kicker, title (HTML), tag, sub, art }
   */
  show(opts = {}) {
    const u = this.ui;
    if (opts.art) this.setArt(opts.art);
    if (opts.kicker) u.kicker.textContent = opts.kicker;
    if (opts.title) u.title.innerHTML = opts.title;
    if (opts.tag !== undefined) u.tag.textContent = opts.tag;
    this.lines = [];
    u.log.innerHTML = '';
    u.belt.style.width = '0%';
    u.sub.textContent = opts.sub || '';
    // restart the entrance animations
    for (const e of [u.kicker, u.title, u.tag]) { e.style.animation = 'none'; void e.offsetWidth; e.style.animation = ''; }
    const wasVisible = this.visible;
    this.el.classList.remove('done');
    this.startTips();
    return new Promise((r) => setTimeout(r, wasVisible ? 0 : 1150));
  }

  /** A step of work: the last one moves into the log, the belt fills to `progress` (0..1). */
  step(text, progress) {
    const u = this.ui;
    const prev = u.sub.textContent;
    if (prev) {
      this.lines.push(prev.replace(/…$/, ''));
      if (this.lines.length > 4) this.lines.shift();
      u.log.innerHTML = this.lines.map((l) => `<p>${l}</p>`).join('');
    }
    u.sub.textContent = text;
    if (progress !== undefined) u.belt.style.width = `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
  }

  /** Fade it away. */
  hide() {
    this.ui.belt.style.width = '100%';
    this.el.classList.add('done');
    clearInterval(this.tipTimer);
  }
}
