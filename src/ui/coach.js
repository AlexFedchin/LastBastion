// The first night's coaching: a few lines, each when it is true in front of you, that
// teach the one rule the game turns on. They don't have to get past the gun, only up
// the wall: where they reach it they pile on each other, the blood climbs the face,
// and every one that tops a pile kills a survivor. So: fire, watch the piles, look
// along the wall, cut the high one down.
//
// Runs on night 1 while settings.tips is on (Settings ▸ First-night tips), then turns
// the setting off so a second campaign isn't coached again. H hides it for the night.
//
// On a night that brings something new (UNLOCKS), the same panel teaches each new tool
// once, one after another: the radio says what arrived, the tip says which key and how.
import { WORLD, wallZ, sectionCenterX, ABILITY } from '../config.js';

/** How to use each new tool, shown on the night it arrives. */
export const UNLOCK_TIPS = {
  molotov: ['NEW · MOLOTOVS', 'Press E to throw a Molotov where you aim. Put it on the foot of the wall: it burns the pile, and anything that walks through the fire comes out alight.'],
  grenades: ['NEW · GRENADES', 'Press G to throw a grenade where you aim. Save it for a pile: one blast takes out the bodies the others are climbing on.'],
  claymores: ['NEW · CLAYMORES', 'Claymores are dug in along the approach. They go off on their own when the dead walk over them. More can be bought at the dawn resupply.'],
  artillery: ['NEW · 105MM BATTERY', 'Press Q to call a fire mission where you aim. The shells land a few seconds later, so lead a moving crowd. The battery needs time to reload between missions.'],
  gunship: ['NEW · SPECTRE', 'A Spectre gunship circles the valley tonight. It works the big crowds out in the field on its own. Keep your gun on the wall.'],
  bomber: ['NEW · BOMBER', 'Press T to throw a red flare where you aim. The bomber puts one heavy bomb on it a few seconds later. Keep the flare well out from the wall.'],
  dangerClose: ['NEW · DANGER CLOSE', `Press B only if the wall is lost: the battery fires on the whole wall line at once. Once a night, and it costs ${ABILITY.dangerClose.cost} of the men on the wall.`],
};

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
    // tonight's new tools, taught one at a time (any night, whatever the first-night setting)
    this.newTips = (g.newUnlocks || []).filter((k) => UNLOCK_TIPS[k]);
    this.tipI = 0; this.tipT = 0;
    if (!this.active && this.newTips.length) { this.active = true; this.unlocks = true; } else this.unlocks = false;
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

  /** The new tools' tips: after the intro, each up for a while, a short gap between. */
  updateUnlocks(dt) {
    this.tipT += dt;
    const k = this.newTips[this.tipI];
    if (!k) { this.stop(); return; }
    const first = this.tipI === 0 ? 3.5 : 1.2, dur = 11;
    if (this.tipT < first) { this.hide(); return; }
    const [tag, text] = UNLOCK_TIPS[k];
    this.show(tag, text);
    if (this.tipT > first + dur) { this.tipI++; this.tipT = 0; this.hide(); }
  }

  update(dt) {
    if (!this.active) return;
    const g = this.g;
    if (g.state === 'paused') return;
    if (g.state !== 'night') { if (g.state !== 'intro') this.stop(); return; }
    if (this.unlocks) { this.updateUnlocks(dt); return; }
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
