// The first night's coaching: a few lines, each when it is true in front of you, that
// teach the one rule the game turns on. They don't have to get past the gun, only up
// the wall: where they reach it they pile on each other, the blood climbs the face,
// and every one that tops a pile kills a survivor. So: fire, watch the piles, look
// along the wall, cut the high one down.
//
// Runs on night 1 while settings.tips is on (Settings ▸ First-night tips), then turns
// the setting off so a second campaign isn't coached again. H hides it for the night.
import { WORLD, wallZ, sectionCenterX } from '../config.js';

const LABELS = ['L5', 'L4', 'L3', 'L2', 'L1', 'R1', 'R2', 'R3', 'R4', 'R5'];
const $ = (id) => document.getElementById(id);

export class Coach {
  constructor(game) {
    this.g = game;
    this.active = false;
    this.el = $('coach'); this.tag = $('coach-tag'); this.text = $('coach-text'); this.key = $('coach-key');
  }

  start() {
    const g = this.g;
    this.active = !!(g.settings.tips && g.run && g.run.night === 1 && !g.run.endless && !g.run.dev);
    this.step = 0; this.t = 0; this.stepT = 0; this.shownAt = null; this.sec = -1; this.breached = false; this.looked = 0; this.pileSec = -1;
    this.shots0 = g.player.shots;
    this.hide();
  }

  stop() { this.active = false; this.hide(); this.mark(-1); }

  /** H: no more tips tonight (they stay on for the next first night unless turned off). */
  dismiss() { if (this.active) this.stop(); }

  breach(sec) { if (this.active) { this.breached = true; this.breachSec = sec; } }

  show(tag, text, warn = false) {
    this.tag.textContent = tag;
    this.text.textContent = text;
    this.key.innerHTML = '<kbd>H</kbd> HIDE TIPS';
    this.el.className = 'coach show' + (warn ? ' warn' : '');
  }

  hide() { this.el.className = 'coach'; }

  /** Pulse a section on the wall map, and mark it in the world (-1: none). */
  mark(sec) {
    const hud = this.g.hud;
    for (let s = 0; s < 10; s++) if (hud.secEls[s]) hud.secEls[s].classList.toggle('coach', s === sec);
    this.sec = sec;
  }

  /** A world marker for the HUD's marker layer (merged with the night events' own). */
  marker() {
    if (!this.active || this.sec < 0) return null;
    const x = sectionCenterX(this.sec);
    return { x, y: WORLD.WALL_H + 2.2, z: wallZ(x) - 2, label: `▼ ${LABELS[this.sec]}`, cls: 'coach' };
  }

  /** The section with the highest pile, and how high it is (0..1). */
  worst() {
    const h = this.g.horde;
    let best = -1, p = 0;
    for (let s = 0; s < 10; s++) { const q = h.pressure(s); if (q > p) { p = q; best = s; } }
    return [best, p];
  }

  next() { this.step++; this.stepT = 0; this.shownAt = null; this.hide(); this.mark(-1); }

  update(dt) {
    if (!this.active) return;
    const g = this.g;
    if (g.state === 'paused') return;
    if (g.state !== 'night') { if (g.state !== 'intro') this.stop(); return; }
    this.t += dt; this.stepT += dt;
    const shots = g.player.shots - this.shots0;
    this.looked = Math.max(this.looked, Math.abs(g.player.yaw));
    const [ws, wp] = this.worst();
    // each tip waits for its moment, then stays up a while from when it appeared
    const up = (cond) => { if (this.shownAt === null && cond) this.shownAt = this.stepT; return this.shownAt === null ? -1 : this.stepT - this.shownAt; };
    switch (this.step) {
      case 0: { // fire
        const on = up(this.stepT > 1.5);
        if (on < 0) break;
        this.show('FIRST NIGHT · THE GUN', 'Hold LEFT MOUSE to fire. Keep it to bursts: the barrel heats, and an overheated gun stops firing until it cools.');
        if ((shots > 45 && on > 5) || on > 20) this.next();
        break;
      }
      case 1: { // the first pile
        const on = up(wp > 0.08);
        if (on < 0) { if (this.stepT > 70) this.next(); break; }
        if (on < 0.05) this.pileSec = ws;
        this.mark(this.pileSec);
        this.show(`FIRST NIGHT · THE PILE · ${LABELS[this.pileSec]}`, 'They don\'t have to get past you. They only have to get up the wall. Where they reach it, they climb on each other: that is a pile, and the blood on the wall climbs with it.');
        if (on > 11) this.next();
        break;
      }
      case 2: { // look along the wall
        const on = up(this.stepT > 1.2);
        if (on < 0) break;
        this.show('FIRST NIGHT · THE WALL', 'The wall runs away from you on both sides. Look left and right along it, and keep an eye on the wall map, bottom left: a section turns red as its pile climbs.');
        if ((this.looked > 0.55 && on > 6) || on > 14) this.next();
        break;
      }
      case 3: { // a pile half way up
        const on = up(wp > 0.45);
        if (on < 0) { if (this.breached) this.next(); else if (g.director.progress > 0.7) this.next(); break; }
        if (this.sec !== ws) this.mark(ws);
        this.show(`FIRST NIGHT · CUT IT DOWN · ${LABELS[ws]}`, `The pile at ${LABELS[ws]} is half way up the wall. Turn to it and shoot it down before it reaches the top.`, wp > 0.7);
        if ((wp < 0.25 && on > 4) || on > 16) this.next();
        break;
      }
      case 4: { // the cost
        const on = up(this.breached);
        if (on < 0) { if (g.director.progress > 0.55) this.next(); break; }
        if (this.sec !== (this.breachSec ?? -1)) this.mark(this.breachSec ?? -1);
        this.show('FIRST NIGHT · THE COST', 'One climbed over. Every one that tops a pile kills a survivor on the walkway. Lose them all and the bastion falls.', true);
        if (on > 9) this.next();
        break;
      }
      case 5: { // optics
        const on = up(g.director.progress > 0.5 && this.stepT > 2);
        if (on < 0) break;
        this.show('FIRST NIGHT · OPTICS', 'RIGHT MOUSE brings the optics up: zoom, and a tighter spread for the ones far down the valley.');
        if (on > 9) this.next();
        break;
      }
      default:
        // done: the setting turns itself off
        this.stop();
        g.applySetting('tips', false);
    }
  }
}
