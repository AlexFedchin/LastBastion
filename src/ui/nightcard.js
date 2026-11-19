// The card between the dawn resupply and the night: the hangar fades to black, the night's
// number comes up with the tally of nights on the line, and it opens onto the valley.
// (main.leaveShop runs the sequence; the styles are .night-card in app/style.css.)

const MARKS = 10;

export class NightCard {
  constructor() {
    const el = this.el = document.createElement('div');
    el.className = 'night-card';
    el.innerHTML = `<div class="nc-in">
      <div class="nc-kicker"></div>
      <div class="nc-title"><span class="nc-word">NIGHT</span> <b class="nc-num"></b></div>
      <div class="nc-rule"></div>
      <div class="nc-marks"></div>
      <div class="nc-sub"></div>
      <div class="nc-tag"></div>
    </div>`;
    document.body.appendChild(el);
    this.q = (s) => el.querySelector(s);
  }

  /**
   * Fade to black and bring the card up. opts: { night, kicker, sub, tag, past (endless) }.
   * Resolves once the screen is black (the card itself is still coming in).
   */
  show({ night, kicker = '', sub = '', tag = '', past = false }) {
    this.q('.nc-kicker').textContent = kicker;
    this.q('.nc-num').textContent = String(night).padStart(2, '0');
    this.q('.nc-sub').textContent = sub;
    this.q('.nc-tag').textContent = tag;
    // the nights on the line: held ones struck through, tonight lit, the rest still to come
    const marks = this.q('.nc-marks');
    marks.style.display = past ? 'none' : '';
    marks.innerHTML = Array.from({ length: MARKS }, (_, i) => {
      const n = i + 1, cls = n < night ? 'held' : n === night ? 'now' : '';
      return `<i class="${cls}" style="--d:${(0.9 + i * 0.07).toFixed(2)}s"><span>${n}</span></i>`;
    }).join('');
    const el = this.el;
    el.classList.remove('on', 'out');
    void el.offsetWidth; // restart the entrance animations
    el.classList.add('black');
    return new Promise((r) => setTimeout(() => { el.classList.add('on'); r(); }, 1250));
  }

  /** Fade the card away onto whatever is behind it. Resolves when it is gone. */
  hide() {
    const el = this.el;
    el.classList.add('out');
    return new Promise((r) => setTimeout(() => { el.classList.remove('black', 'on', 'out'); r(); }, 1700));
  }
}
