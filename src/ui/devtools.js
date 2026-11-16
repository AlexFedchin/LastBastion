// Developer tools: F10 (or DEVELOPER in the main menu) opens a panel to start any night
// with any difficulty, survivors, supplies and upgrades, and, during a run, to trigger
// events, end the night or jump to the extraction. Dev runs never touch the campaign
// save or the endless record (run.dev).
import { DIFFICULTY, UPGRADES, FINAL_NIGHT, EXTRACTION } from '../config.js';

const EVENTS = ['patrol', 'civilians', 'drop', 'giant', 'behemoth', 'stampede', 'bloaters', 'fog', 'blackout', 'gunshipDown', 'tanker', 'convoy', 'cliffs'];
const GROUPS = { hmg: 'HEAVY MACHINE GUN', arty: 'ARTILLERY', wall: 'THE WALL', support: 'SUPPORT' };

const STYLE = `
#dev { position: fixed; top: 0; right: 0; bottom: 0; width: min(440px, 100vw); z-index: 90; background: rgba(8, 9, 8, 0.94);
  border-left: 1px solid var(--line); color: var(--bone); font-family: var(--cond); overflow-y: auto; padding: 18px 20px 28px;
  display: none; user-select: text; }
#dev.on { display: block; }
#dev h2 { font-size: 22px; letter-spacing: 0.3em; color: var(--amber); font-weight: 600; }
#dev h3 { font-size: 12px; letter-spacing: 0.3em; color: var(--bone-dim); margin: 18px 0 8px; font-weight: 500; }
#dev .sub { font-family: var(--mono); font-size: 11px; color: var(--muted); margin-top: 4px; }
#dev .row { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 10px; padding: 4px 0; font-size: 14px; letter-spacing: 0.08em; }
#dev .row small { display: block; font-size: 11px; color: var(--bone-dim); letter-spacing: 0.04em; }
#dev input[type=number], #dev select { background: #111210; color: var(--bone); border: 1px solid var(--line); font: 14px var(--mono); padding: 4px 6px; width: 110px; }
#dev input[type=checkbox] { width: 18px; height: 18px; accent-color: var(--amber); }
#dev .lv { display: flex; gap: 3px; }
#dev .lv button { width: 26px; height: 24px; background: #111210; color: var(--bone-dim); border: 1px solid var(--line); font: 12px var(--mono); cursor: pointer; }
#dev .lv button.on { background: var(--amber-dim); color: #fff; border-color: var(--amber); }
#dev .acts { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
#dev .acts button, #dev .go { background: #1a1b17; color: var(--bone); border: 1px solid var(--line); padding: 7px 12px; font: 13px var(--cond); letter-spacing: 0.18em; cursor: pointer; }
#dev .acts button:hover, #dev .go:hover { border-color: var(--amber); color: var(--amber); }
#dev .go { width: 100%; margin-top: 16px; padding: 12px; font-size: 16px; background: var(--amber-dim); color: #fff; border-color: var(--amber); }
#dev button:focus-visible, #dev input:focus-visible, #dev select:focus-visible { outline: 2px solid var(--amber); outline-offset: 1px; }
#dev .close { position: absolute; top: 14px; right: 16px; background: none; border: 0; color: var(--bone-dim); font-size: 22px; cursor: pointer; }
#dev .inrun[hidden] { display: none; }
`;

export class DevTools {
  constructor(game) {
    this.g = game;
    this.up = {};
    const st = document.createElement('style'); st.textContent = STYLE; document.head.appendChild(st);
    const el = this.el = document.createElement('aside');
    el.id = 'dev';
    el.innerHTML = this.html();
    document.body.appendChild(el);
    // keep the game's own key and click handlers out of the panel
    for (const ev of ['click', 'mousedown', 'keydown', 'wheel']) el.addEventListener(ev, (e) => { if (ev !== 'keydown' || e.code !== 'F10') e.stopPropagation(); });
    el.addEventListener('click', (e) => this.onClick(e));
    document.addEventListener('keydown', (e) => { if (e.code === 'F10') { e.preventDefault(); this.toggle(); } });
    this.$('#dv-diff').addEventListener('change', () => { this.$('#dv-surv').value = DIFFICULTY[this.$('#dv-diff').value].survivors; });
  }

  $(q) { return this.el.querySelector(q); }

  html() {
    const diffs = Object.values(DIFFICULTY).map((d) => `<option value="${d.id}"${d.id === 'veteran' ? ' selected' : ''}>${d.label}</option>`).join('');
    let ups = '', group = null;
    for (const u of UPGRADES) {
      if (u.group !== group) { group = u.group; ups += `<h3>${GROUPS[group] || group.toUpperCase()}</h3>`; }
      const lv = [0, ...u.costs.map((_, k) => k + 1)].map((k) => `<button data-up="${u.id}" data-lv="${k}" class="${k === 0 ? 'on' : ''}" aria-label="${u.name} level ${k}">${k}</button>`).join('');
      ups += `<div class="row"><span>${u.name}<small>${u.desc}</small></span><span class="lv">${lv}</span></div>`;
    }
    return `
      <button class="close" data-dev="close" aria-label="Close developer tools">×</button>
      <h2>DEVELOPER</h2>
      <div class="sub">F10 opens and closes this panel. Dev runs never save over your campaign.</div>
      <div class="inrun" id="dv-inrun" hidden>
        <h3>THIS RUN</h3>
        <div class="acts">
          <button data-dev="end">END THE NIGHT</button>
          <button data-dev="clear">KILL EVERY ZOMBIE</button>
          <button data-dev="supplies">+500 SUPPLIES</button>
          <button data-dev="souls">+10 SURVIVORS</button>
          <button data-dev="extract">PLAY THE EXTRACTION</button>
          <button data-dev="ending">PLAY THE ENDING</button>
        </div>
        <h3>TRIGGER AN EVENT</h3>
        <div class="acts">${EVENTS.map((k) => `<button data-ev="${k}">${k.toUpperCase()}</button>`).join('')}</div>
      </div>
      <h3>START A RUN</h3>
      <div class="row"><label for="dv-night">Night</label><input type="number" id="dv-night" min="1" max="40" value="1"></div>
      <div class="row"><label for="dv-diff">Difficulty</label><select id="dv-diff">${diffs}</select></div>
      <div class="row"><label for="dv-surv">Survivors on the wall<small>${EXTRACTION.souls}+ on night ${FINAL_NIGHT} calls the flight</small></label><input type="number" id="dv-surv" min="1" max="999" value="${DIFFICULTY.veteran.survivors}"></div>
      <div class="row"><label for="dv-sup">Supplies</label><input type="number" id="dv-sup" min="0" max="99999" value="0"></div>
      <div class="row"><label for="dv-mines">Claymores</label><input type="number" id="dv-mines" min="0" max="36" value="0"></div>
      <div class="row"><label for="dv-shop">Start at the dawn resupply<small>the shop before this night, to spend the supplies</small></label><input type="checkbox" id="dv-shop"></div>
      <div class="row"><label for="dv-endless">Endless (past the seventy-second hour)</label><input type="checkbox" id="dv-endless"></div>
      <h3>UPGRADES</h3>
      <div class="acts"><button data-dev="max">ALL MAXED</button><button data-dev="none">NONE</button></div>
      ${ups}
      <button class="go" data-dev="start">START</button>`;
  }

  setLevel(id, lv) {
    if (lv) this.up[id] = lv; else delete this.up[id];
    this.el.querySelectorAll(`[data-up="${id}"]`).forEach((b) => b.classList.toggle('on', +b.dataset.lv === lv));
  }

  onClick(e) {
    const b = e.target.closest('button');
    if (!b) return;
    const g = this.g;
    if (b.dataset.up) { this.setLevel(b.dataset.up, +b.dataset.lv); return; }
    if (b.dataset.ev) { if (g.events && g.inPlay()) g.events.trigger(b.dataset.ev); this.toggle(false); return; }
    switch (b.dataset.dev) {
      case 'close': this.toggle(false); break;
      case 'max': for (const u of UPGRADES) this.setLevel(u.id, u.costs.length); break;
      case 'none': for (const u of UPGRADES) this.setLevel(u.id, 0); break;
      case 'start': this.start(); break;
      case 'end': if (g.state === 'night') { g.horde.clearLiving(); g.director.spawningDone = true; } this.toggle(false); break;
      case 'clear': g.horde.clearLiving(); break;
      case 'supplies': if (g.run) g.run.supplies += 500; break;
      case 'souls': if (g.run) g.run.survivors += 10; break;
      case 'extract': if (g.run) { g.run.survivors = Math.max(g.run.survivors, EXTRACTION.souls); g.playExtraction(); } this.toggle(false); break;
      case 'ending': if (g.run) { g.victory = true; g.playEnding(); } this.toggle(false); break;
      default: break;
    }
  }

  /** Start a dev run with the panel's settings. */
  start() {
    const v = (id) => this.$(id).value, n = Math.max(1, Math.min(40, +v('#dv-night') || 1));
    const save = {
      difficulty: v('#dv-diff'), night: n, survivors: Math.max(1, +v('#dv-surv') || 1), supplies: Math.max(0, +v('#dv-sup') || 0), kills: 0,
      upgrades: { ...this.up }, minesOwned: Math.max(0, +v('#dv-mines') || 0), endless: this.$('#dv-endless').checked || n > FINAL_NIGHT,
      atShop: this.$('#dv-shop').checked, totals: { shots: 0, hits: 0, headshots: 0 }, log: [], dev: true,
    };
    this.toggle(false);
    const g = this.g;
    g.devSave = save;
    if (g.state !== 'menu') g.enterMenu();
    g.deploy(save, () => g.startRun(save));
  }

  toggle(on = !this.el.classList.contains('on')) {
    const g = this.g;
    this.el.classList.toggle('on', on);
    this.$('#dv-inrun').hidden = !(g.run && g.state !== 'menu');
    if (on) { if (g.state === 'night' && g.input.locked) g.input.unlock(); }
  }
}
