// In-game HUD. Plain DOM, updated only when values change.
import { WORLD, wallZ, sectionCenterX, ABILITY, isUnlocked } from '../config.js';
import { formatInt, formatTime } from '../core/util.js';
import * as THREE from 'three';

const $ = (id) => document.getElementById(id);
const LABELS = ['L5', 'L4', 'L3', 'L2', 'L1', 'R1', 'R2', 'R3', 'R4', 'R5'];
const MAX_ALERTS = 3;

export class HUD {
  constructor() {
    this.root = $('hud');
    this.el = {
      night: $('h-night'), dawn: $('h-dawn'), dawnLbl: $('h-dawn-lbl'), dawnBar: $('h-dawn-bar'), contacts: $('h-alive'),
      kills: $('h-kills'), carnage: $('h-carnage'),
      surv: $('h-surv'), survIcons: $('h-surv-icons'), supplies: $('h-supplies'),
      radio: $('h-radio'), radioWho: $('h-radio-who'), radioText: $('h-radio-text'),
      heat: $('h-heat'), gunState: $('h-gunstate'),
      abilities: $('h-abilities'),
      hit: $('hitmarker'), cross: $('crosshair'),
      announce: $('announce'), annBig: $('announce-big'), annSmall: $('announce-small'),
      alerts: $('alerts'), fps: $('fps'), hint: $('hint'), wire: $('h-wire'),
      edgeL: $('edge-l'), edgeR: $('edge-r'),
      obj: $('h-obj'), objTitle: $('h-obj-title'), objText: $('h-obj-text'), objBar: $('h-obj-bar'),
      boss: $('h-boss'), bossName: $('h-boss-name'), bossBar: $('h-boss-bar'), markers: $('h-markers'),
    };
    this.markerEls = [];
    this._mv = new THREE.Vector3();
    this.cache = {};
    this.buildWallMap();
    this.radioQueue = [];
    this.radioT = 0;
    this.announceT = 0;
    this.carnageT = 0;
    this.alerts = [];
    this.hitT = 0;
    this.killPulse = 0;
  }

  show(v) { this.root.classList.toggle('hidden', !v); }

  set(key, el, value, prop = 'textContent') {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    if (prop === 'class') el.setAttribute('class', value);
    else el[prop] = value;
  }

  buildWallMap() {
    const svg = $('h-wall');
    const mapX = (x) => 150 + x * 1.85;
    const mapZ = (z) => 92 + z * 2.0;
    let html = '';
    // valley lines
    html += `<polyline points="${mapX(-150)},${mapZ(wallZ(-150))} ${mapX(-72)},${mapZ(wallZ(-72))}" class="wm-cliff"/>`;
    html += `<polyline points="${mapX(72)},${mapZ(wallZ(72))} ${mapX(150)},${mapZ(wallZ(150))}" class="wm-cliff"/>`;
    for (let s = 0; s < 10; s++) {
      const x0 = s < 5 ? -72 + s * 12.8 : 8 + (s - 5) * 12.8;
      const x1 = x0 + 12.8;
      html += `<line id="wm-${s}" x1="${mapX(x0) + 1}" y1="${mapZ(wallZ(x0))}" x2="${mapX(x1) - 1}" y2="${mapZ(wallZ(x1))}" class="wm-sec"/>`;
      const cx = (x0 + x1) / 2;
      html += `<text x="${mapX(cx)}" y="${mapZ(wallZ(cx)) + 13}" class="wm-lbl">${LABELS[s]}</text>`;
    }
    html += `<rect x="${mapX(-8)}" y="${mapZ(-1.5) - 3}" width="${16 * 1.85}" height="7" class="wm-tower"/>`;
    html += `<path id="wm-view" class="wm-view" d=""/>`;
    svg.innerHTML = html;
    this.secEls = [];
    for (let s = 0; s < 10; s++) this.secEls.push(document.getElementById('wm-' + s));
    this.viewEl = document.getElementById('wm-view');
    this.mapX = mapX; this.mapZ = mapZ;
  }

  /**
   * Queue a radio call. prio: it is about something happening now (jumps the queue).
   * opts.ttl: seconds it stays worth saying (prio calls default to 6, others 40);
   * opts.valid: checked when its turn comes; false drops it (the bomb already fell...).
   */
  radio(who, text, prio = false, opts = {}) {
    const m = { who, text, at: this.clock || 0, ttl: opts.ttl ?? (prio ? 6 : 40), valid: opts.valid || null };
    if (prio) this.radioQueue.unshift(m); else this.radioQueue.push(m);
    if (this.radioQueue.length > 4) this.radioQueue.length = 4;
  }

  /** The next call still worth making, dropping the ones overtaken by events. */
  nextRadio() {
    while (this.radioQueue.length) {
      const m = this.radioQueue.shift();
      if ((this.clock || 0) - m.at > m.ttl) continue;
      if (m.valid && !m.valid()) continue;
      return m;
    }
    return null;
  }

  announce(big, small = '', dur = 3.2, cls = '') {
    this.el.annBig.textContent = big;
    this.el.annSmall.textContent = small;
    this.el.announce.className = 'show ' + cls;
    this.announceT = dur;
  }

  /**
   * Show an alert. Alerts with the same key merge instead of stacking: a plain
   * repeat shows "×N", a grouped alert (opts.item + opts.format) collects its
   * items — "BREACH — L2 · L5 — WE LOST 2". At most MAX_ALERTS are on screen;
   * when there are too many, the least urgent (then oldest) goes first, so red
   * alerts push amber ones out rather than the other way round.
   * opts: { key, item, format(items, count), priority, life, plain (no ×N: the text itself updates) }
   */
  alert(text, cls = '', opts = {}) {
    const key = opts.key || text;
    const pri = opts.priority ?? (cls.includes('red') ? 2 : 1);
    let a = this.alerts.find((x) => x.key === key);
    if (a) {
      a.count++;
      a.t = 0;
      a.pri = Math.max(a.pri, pri);
      if (cls.includes('red')) a.cls = cls;
      a.el.classList.remove('fade');
    } else {
      const el = document.createElement('div');
      a = { key, el, count: 1, t: 0, pri, cls, items: [] };
      this.alerts.push(a);
    }
    a.text = text;
    a.format = opts.format;
    a.life = opts.life ?? (pri >= 2 ? 3.6 : 2.8);
    if (opts.item !== undefined && !a.items.includes(opts.item)) a.items.push(opts.item);
    a.el.className = 'alert ' + a.cls;
    a.el.textContent = a.format ? a.format(a.items, a.count) : (a.count > 1 && !opts.plain ? `${text}  ×${a.count}` : text);
    this.el.alerts.prepend(a.el); // newest / refreshed on top
    while (this.alerts.length > MAX_ALERTS) {
      let drop = 0;
      for (let k = 1; k < this.alerts.length; k++) {
        const x = this.alerts[k], d = this.alerts[drop];
        if (x === a) continue;
        if (d === a || x.pri < d.pri || (x.pri === d.pri && x.t > d.t)) drop = k;
      }
      this.alerts[drop].el.remove();
      this.alerts.splice(drop, 1);
    }
  }

  updateAlerts(dt) {
    for (let k = this.alerts.length - 1; k >= 0; k--) {
      const a = this.alerts[k];
      a.t += dt;
      if (a.t > a.life) a.el.classList.add('fade');
      if (a.t > a.life + 0.8) { a.el.remove(); this.alerts.splice(k, 1); }
    }
  }

  clearAlerts() {
    for (const a of this.alerts) a.el.remove();
    this.alerts.length = 0;
  }

  carnage(text, cls = '') {
    this.el.carnage.textContent = text;
    this.el.carnage.className = 'carnage show ' + cls;
    this.carnageT = 1.6;
  }

  hitmarker(killed, head) {
    this.el.hit.className = killed ? (head ? 'kill head' : 'kill') : 'hit';
    this.hitT = killed ? 0.22 : 0.09;
  }

  kill() { this.killPulse = 1; }

  hint(text) { this.el.hint.textContent = text; this.el.hint.classList.toggle('show', !!text); }

  /** Night events: objective panel, boss bar and world markers. */
  updateEvents(g) {
    const el = this.el, ev = g.events;
    const ob = ev && g.inPlay() ? ev.objective() : null;
    this.set('objc', el.obj, 'objective' + (ob ? ' show ' + (ob.cls || '') : ''), 'className');
    if (ob) {
      this.set('objt', el.objTitle, ob.title);
      this.set('objx', el.objText, ob.text);
      this.set('objb', el.objBar.style, `${clamp01(ob.progress) * 100}%`, 'width');
    }
    const boss = ev && g.inPlay() ? ev.boss() : null;
    this.set('bossc', el.boss, boss ? 'boss show' : 'boss', 'className');
    if (boss) {
      this.set('bossn', el.bossName, boss.name);
      this.set('bossb', el.bossBar.style, `${clamp01(boss.hp) * 100}%`, 'width');
    }
    const mk = ev && g.inPlay() ? ev.markers() : [];
    const W = window.innerWidth, H = window.innerHeight, v = this._mv;
    while (this.markerEls.length < mk.length) {
      const d = document.createElement('div');
      d.className = 'mk';
      el.markers.appendChild(d);
      this.markerEls.push({ el: d, label: null, cls: null });
    }
    this.markerEls.forEach((m, k) => {
      const t = mk[k];
      if (!t) { if (m.el.style.display !== 'none') m.el.style.display = 'none'; return; }
      v.set(t.x, t.y, t.z).project(g.camera);
      if (v.z > 1 || v.x < -1.05 || v.x > 1.05 || v.y < -1.05 || v.y > 1.05) { m.el.style.display = 'none'; return; }
      m.el.style.display = '';
      m.el.style.left = `${(v.x * 0.5 + 0.5) * W}px`;
      m.el.style.top = `${(-v.y * 0.5 + 0.5) * H}px`;
      if (m.label !== t.label) { m.label = t.label; m.el.textContent = t.label; }
      if (m.cls !== t.cls) { m.cls = t.cls; m.el.className = 'mk ' + (t.cls || ''); }
    });
  }

  update(dt, g) {
    this.updateAlerts(dt);
    this.updateEvents(g);
    const { run, director, player, arsenal, horde, stats } = g;
    const el = this.el;
    const isDawn = g.state === 'dawn';
    this.set('night', el.night, String(isDawn ? run.night - 1 : run.night).padStart(2, '0'));
    // the last night with the flight coming: the clock counts to the extraction, not the dawn
    const hold = g.extracting && g.events.active.find((e) => e.kind === 'extraction');
    const rem = hold ? hold.left : director.plan ? director.remaining : 0;
    this.set('dawnl', el.dawnLbl, isDawn ? 'DAWN' : hold ? 'FLIGHT IN' : rem > 0 ? 'DAWN IN' : 'CLEAR THE FIELD');
    this.set('dawn', el.dawn, isDawn ? '' : rem > 0 ? formatTime(rem) : '');
    this.set('dawnbar', el.dawnBar.style, `${(hold ? hold.t / hold.P.hold : director.plan ? director.progress : 0) * 100}%`, 'width');
    const contacts = horde.alive + director.queue.length;
    this.set('contacts', el.contacts, `CONTACTS ${formatInt(contacts)}`);
    this.set('kills', el.kills, formatInt(run.kills));
    this.set('surv', el.surv, String(run.survivors));
    this.set('supplies', el.supplies, formatInt(run.supplies));
    // survivor ticks
    const sv = Math.min(run.survivors, 60);
    if (this.cache.survIcons !== sv) {
      this.cache.survIcons = sv;
      el.survIcons.innerHTML = '<i></i>'.repeat(sv);
    }
    this.killPulse = Math.max(0, this.killPulse - dt * 6);
    el.kills.style.transform = `scale(${1 + this.killPulse * 0.08})`;

    // gun
    const heat = player.heat;
    this.set('heat', el.heat.style, `${heat * 100}%`, 'width');
    const hot = player.overheatT > 0;
    let state = 'READY';
    let cls = '';
    if (hot) { state = `OVERHEATED — COOLING ${player.overheatT.toFixed(1)}s`; cls = 'danger'; }
    else if (heat > 0.75) { state = 'BARREL HOT'; cls = 'warn'; }
    else if (player.zoom > 0.5) state = 'OPTICS';
    this.set('gs', el.gunState, state);
    this.set('gsc', el.gunState, 'small ' + cls, 'className');
    this.set('heatc', el.heat, heat > 0.75 || hot ? 'hot' : '', 'className');

    // abilities
    const a = arsenal;
    const all = [
      ['Q', 'ARTILLERY', a.artyCd > 0 ? `${Math.ceil(a.artyCd)}s` : `READY ×${stats.artyShells}`, a.artyCd > 0 ? 1 - a.artyCd / stats.artyCooldown : 1, a.artyCd <= 0],
      ['E', 'MOLOTOV', `×${a.molotovsLeft}`, a.molotovsLeft > 0 ? 1 - a.molotovCd / ABILITY.molotov.rearm : 0, a.molotovsLeft > 0 && a.molotovCd <= 0],
      ['T', 'BOMBER', a.air.bomberBusy ? 'INBOUND' : (a.air.bomberCd > 0 ? `${Math.ceil(a.air.bomberCd)}s` : 'READY'), a.air.bomberBusy ? 1 : (a.air.bomberCd > 0 ? 1 - a.air.bomberCd / ABILITY.bomber.cooldown : 1), a.air.bomberCd <= 0 && !a.air.bomberBusy],
      ['G', 'GRENADES', `×${a.grenadesLeft}`, a.grenadesLeft > 0 ? 1 : 0, a.grenadesLeft > 0],
      ['B', 'DANGER CLOSE', a.dangerUsed ? 'SPENT' : `−3 LIVES`, a.dangerUsed ? 0 : 1, !a.dangerUsed && run.survivors > 3],
    ];
    const UNLOCK_KEY = { Q: 'artillery', E: 'molotov', T: 'bomber', G: 'grenades', B: 'dangerClose' };
    const night = g.state === 'dawn' ? run.night - 1 : run.night;
    const rows = all.filter((r) => isUnlocked(UNLOCK_KEY[r[0]], night));
    const sig = rows.map((r) => r[0]).join('');
    if (this.abSig !== sig) { this.abSig = sig; this.abRows = null; }
    if (!this.abRows) {
      el.abilities.innerHTML = rows.map((r, i) => `<div class="ab" id="ab-${i}"><span class="key">${r[0]}</span><span class="nm">${r[1]}</span><span class="st"></span><div class="cd"><div></div></div></div>`).join('');
      this.abRows = rows.map((_, i) => {
        const row = document.getElementById('ab-' + i);
        return { row, st: row.querySelector('.st'), cd: row.querySelector('.cd > div') };
      });
    }
    rows.forEach((r, i) => {
      const ar = this.abRows[i];
      this.set('abst' + i, ar.st, r[2]);
      this.set('abcd' + i, ar.cd.style, `${Math.max(0, Math.min(1, r[3])) * 100}%`, 'width');
      this.set('abrd' + i, ar.row, 'ab' + (r[4] ? ' ready' : ''), 'className');
    });

    const support = [];
    if (arsenal.air.gs.active && !arsenal.air.gs.leaving) support.push('SPECTRE OVERHEAD');
    if (stats.gunners) support.push(`GUNNERS ${stats.gunners}`);
    if (arsenal.mines.length) support.push(`CLAYMORES ${arsenal.mines.length}`);
    const wi = arsenal.wireIntegrity();
    if (wi >= 0) support.push(`WIRE ${Math.round(wi * 100)}%`);
    this.set('wire', el.wire, support.join('  ·  '));

    // wall pressure map
    for (let s = 0; s < 10; s++) {
      const p = horde.pressure(s);
      const c = p > 0.85 ? 'crit' : p > 0.55 ? 'high' : p > 0.25 ? 'mid' : 'low';
      this.set('wm' + s, this.secEls[s], 'wm-sec ' + c, 'class');
      this.set('wmw' + s, this.secEls[s].style, String(2.5 + p * 5), 'strokeWidth');
    }
    // off-screen threat indicators
    const halfFov = Math.atan(Math.tan((g.camera.fov * Math.PI) / 360) * g.camera.aspect) * 0.92;
    let left = '', right = '';
    for (let s = 0; s < 10; s++) {
      if (horde.pressure(s) < 0.5) continue;
      const x = sectionCenterX(s), z = wallZ(x) - 1;
      const yawTo = Math.atan2(-(x - WORLD.CAM.x), -(z - WORLD.CAM.z));
      const rel = yawTo - player.yaw;
      if (rel > halfFov && !left) left = LABELS[s];
      if (rel < -halfFov && !right) right = LABELS[s];
    }
    this.set('edl', el.edgeL, left ? 'edge l on' : 'edge l', 'className');
    this.set('edr', el.edgeR, right ? 'edge r on' : 'edge r', 'className');
    this.set('edlt', el.edgeL.querySelector('b'), left);
    this.set('edrt', el.edgeR.querySelector('b'), right);

    // view cone on the map
    const yaw = player.yaw, fov = Math.atan(Math.tan((g.camera.fov * Math.PI) / 360) * g.camera.aspect);
    const cx = this.mapX(WORLD.CAM.x), cy = this.mapZ(WORLD.CAM.z);
    const r = 42;
    const a1 = yaw - fov, a2 = yaw + fov;
    const d = `M${cx},${cy} L${cx - Math.sin(a1) * r},${cy - Math.cos(a1) * r} L${cx - Math.sin(a2) * r},${cy - Math.cos(a2) * r} Z`;
    if (this.cache.view !== d) { this.cache.view = d; this.viewEl.setAttribute('d', d); }

    // radio ticker
    this.clock = (this.clock || 0) + dt;
    if (this.radioT > 0) {
      this.radioT -= dt;
      const full = this.radioFull;
      const el2 = this.radioDur - this.radioT;
      // type along with the voice when there is one
      const shown = this.radioVoice > 0
        ? Math.min(full.length, Math.floor(full.length * Math.max(0, el2 - 0.12) / Math.max(0.5, this.radioVoice - 0.35)))
        : Math.min(full.length, Math.floor(el2 * 55));
      this.set('rtext', el.radioText, full.slice(0, shown));
      if (this.radioT <= 0) el.radio.classList.remove('show');
    } else if (this.radioQueue.length && (this._rm = this.nextRadio())) {
      const { who, text } = this._rm;
      this.radioFull = text;
      this.radioVoice = g.audio ? g.audio.radioVoice(who, text) : 0;
      this.radioDur = this.radioT = Math.max(4.5, text.length * 0.065 + 2.5, this.radioVoice + 1.4);
      el.radioWho.textContent = who;
      el.radioText.textContent = '';
      this.cache.rtext = '';
      el.radio.classList.add('show');
      if (g.audio) g.audio.radioStatic(this.radioVoice > 0 ? this.radioVoice + 0.1 : this.radioDur);
    }

    if (this.announceT > 0) {
      this.announceT -= dt;
      if (this.announceT <= 0) el.announce.className = '';
    }
    if (this.carnageT > 0) {
      this.carnageT -= dt;
      if (this.carnageT <= 0) el.carnage.className = 'carnage';
    }
    if (this.hitT > 0) {
      this.hitT -= dt;
      if (this.hitT <= 0) el.hit.className = '';
    }
    // crosshair spread
    const spread = (stats.hmgSpread + player.bloom) * (1 - player.zoom * 0.6);
    const px = 6 + spread * 900;
    const gap = `${px.toFixed(1)}px`;
    if (this.cache.gap !== gap) { this.cache.gap = gap; el.cross.style.setProperty('--gap', gap); }
    el.cross.classList.toggle('zoom', player.zoom > 0.5);
  }

  fps(v) { this.el.fps.textContent = v; }
}

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
