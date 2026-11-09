// Menus, settings, the dawn resupply shop and the end screens.
import { DIFFICULTY, UPGRADES, UPGRADE_GROUPS, CLAYMORE, FINAL_NIGHT } from '../config.js';
import { QUALITY } from '../core/storage.js';
import { formatInt } from '../core/util.js';

const $ = (id) => document.getElementById(id);

export class Screens {
  constructor(game) {
    this.game = game;
    this.current = null;
    $('screens').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      game.audio.ui();
      game.onAction(b.dataset.act, b);
    });
    $('screens').addEventListener('mouseover', (e) => {
      const b = e.target.closest('button');
      if (b && b !== this._hover) { this._hover = b; game.audio.uiHover(); }
    });
    if (!window.bastion) $('btn-quit').classList.add('hidden');
    this.buildDifficulty();
  }

  show(name) {
    for (const s of document.querySelectorAll('.screen')) s.classList.remove('active');
    this.current = name;
    if (name) $('s-' + name).classList.add('active');
  }

  // ── Main menu ────────────────────────────────────────────────────────────
  refreshMenu(save) {
    const btn = $('btn-continue');
    if (save) {
      btn.disabled = false;
      const d = DIFFICULTY[save.difficulty]?.label ?? '';
      $('continue-info').textContent = `${save.atShop ? 'DAWN BEFORE ' : ''}NIGHT ${save.night} · ${d} · ${save.survivors} ALIVE`;
    } else {
      btn.disabled = true;
      $('continue-info').textContent = '';
    }
  }

  buildDifficulty() {
    const list = $('diff-list');
    list.innerHTML = Object.values(DIFFICULTY).map((d) => `
      <button class="diff" data-act="start" data-diff="${d.id}">
        <div class="dn">${d.label}</div>
        <div class="dd">${d.blurb}</div>
        <div class="dm">${d.survivors} SURVIVORS · HORDE ×${d.spawnMul.toFixed(2)} · TOUGHNESS ×${d.hpMul.toFixed(2)}</div>
      </button>`).join('');
  }

  // ── Settings ─────────────────────────────────────────────────────────────
  buildSettings(settings, inGame) {
    const f = $('settings-form');
    const seg = (key, opts) => `<div class="seg" data-key="${key}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(settings[key]) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    const slider = (key, min, max, step, fmt) => `<input type="range" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${settings[key]}"><span class="val" id="sv-${key}">${fmt(settings[key])}</span>`;
    const pct = (v) => `${Math.round(v * 100)}`;
    f.innerHTML = `
      <label>QUALITY</label>${seg('quality', Object.entries(QUALITY).map(([k, q]) => [k, q.label]))}
      <label>SENSITIVITY</label>${slider('sensitivity', 0.2, 3, 0.05, (v) => Number(v).toFixed(2))}
      <label>FIELD OF VIEW</label>${slider('fov', 55, 85, 1, (v) => v)}
      <label>INVERT Y</label>${seg('invertY', [[false, 'OFF'], [true, 'ON']])}
      <label>MASTER</label>${slider('master', 0, 1, 0.01, pct)}
      <label>MUSIC</label>${slider('music', 0, 1, 0.01, pct)}
      <label>EFFECTS</label>${slider('sfx', 0, 1, 0.01, pct)}
      <label>SHOW FPS</label>${seg('showFps', [[false, 'OFF'], [true, 'ON']])}
      ${window.bastion ? `<label>FULLSCREEN</label>${seg('fullscreen', [['toggle', 'TOGGLE (F11)']])}` : ''}
    `;
    const note = $('settings-note');
    note.textContent = '';
    const origQuality = settings.quality;
    f.querySelectorAll('input[type=range]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const k = inp.dataset.key;
        const v = Number(inp.value);
        this.game.applySetting(k, v);
        const fmt = ['master', 'music', 'sfx'].includes(k) ? `${Math.round(v * 100)}` : (k === 'sensitivity' ? v.toFixed(2) : v);
        $('sv-' + k).textContent = fmt;
      });
    });
    f.querySelectorAll('.seg').forEach((s) => {
      s.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        const k = s.dataset.key;
        if (k === 'fullscreen') { window.bastion?.setFullscreen(); return; }
        let v = b.dataset.v;
        if (v === 'true') v = true; else if (v === 'false') v = false;
        s.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        this.game.applySetting(k, v);
        if (k === 'quality') {
          note.textContent = v !== origQuality
            ? (inGame ? 'Quality applies on next launch / return to menu.' : 'Quality will apply when you go back — the valley is repainted.')
            : '';
        }
      });
    });
  }

  // ── Dawn resupply ────────────────────────────────────────────────────────
  buildShop(run, report) {
    const g = this.game;
    $('shop-pre').textContent = `DAWN · DAY ${run.night - 1} · ${DIFFICULTY[run.difficulty].label}`;
    $('shop-title').textContent = 'RESUPPLY';
    $('shop-surv').textContent = run.survivors;
    $('shop-supplies').textContent = formatInt(run.supplies);
    const n = run.night;
    $('btn-begin').textContent = n === FINAL_NIGHT && !run.endless ? 'BEGIN THE LAST NIGHT ▸' : `BEGIN NIGHT ${n} ▸`;

    // report
    const r = report || {};
    const acc = r.shots ? Math.round((r.hits / r.shots) * 100) : 0;
    $('shop-report').innerHTML = `
      <h3>LAST NIGHT</h3>
      <div class="st"><span>KILLS</span><b>${formatInt(r.kills || 0)}</b></div>
      <div class="st"><span>HEADSHOTS</span><b>${formatInt(r.headshots || 0)}</b></div>
      <div class="st"><span>BEST STREAK</span><b>${formatInt(r.bestStreak || 0)}</b></div>
      <div class="st"><span>ACCURACY</span><b>${acc}%</b></div>
      <div class="st"><span>LIVES LOST</span><b>${r.lost || 0}</b></div>
      <div class="st"><span>SUPPLIES EARNED</span><b>${formatInt(r.supplies || 0)}</b></div>
      <div class="st"><span>DAWN BONUS</span><b>+${formatInt(r.bonus || 0)}</b></div>
      <h3 style="margin-top:22px">CAMPAIGN</h3>
      <div class="st"><span>TOTAL KILLS</span><b>${formatInt(run.kills)}</b></div>
      <div class="st"><span>NIGHTS HELD</span><b>${run.night - 1}</b></div>
      <div class="log">${run.log.slice(-5).map((l) => `<p><em>${l[0]}:</em> ${l[1]}</p>`).join('')}</div>
    `;

    // upgrades
    const wrap = $('shop-upgrades');
    let html = '';
    for (const grp of UPGRADE_GROUPS) {
      html += `<div class="ugroup"><h3>${grp.title}</h3><div class="gsub">${grp.sub}</div>`;
      for (const u of UPGRADES.filter((x) => x.group === grp.id)) {
        const rank = run.upgrades[u.id] || 0;
        const max = u.costs.length;
        const cost = rank < max ? u.costs[rank] : null;
        const pips = Array.from({ length: max }, (_, i) => `<i class="${i < rank ? 'on' : ''}"></i>`).join('');
        const btn = cost === null
          ? `<button class="buy maxed" disabled>MAXED</button>`
          : `<button class="buy" data-act="buy" data-id="${u.id}" ${run.supplies < cost ? 'disabled' : ''}>${formatInt(cost)}</button>`;
        html += `<div class="card"><div class="nm">${u.name}</div>${btn}<div class="ds">${u.desc}</div><div class="pips">${pips}</div></div>`;
      }
      if (grp.id === 'support') {
        const canBuy = run.minesOwned + CLAYMORE.perBuy <= CLAYMORE.max;
        html += `<div class="card"><div class="nm">CLAYMORES ×${CLAYMORE.perBuy}</div>
          <button class="buy" data-act="buy-mines" ${!canBuy || run.supplies < CLAYMORE.cost ? 'disabled' : ''}>${CLAYMORE.cost}</button>
          <div class="ds">Buried in the approach. Detonate on contact. Persist until used. In the field: <b>${run.minesOwned}</b></div><div class="pips"></div></div>`;
      }
      html += '</div>';
    }
    wrap.innerHTML = html;
    void g;
  }

  // ── End screens ──────────────────────────────────────────────────────────
  buildGameOver(run, hasSave) {
    $('over-text').textContent = `${formatInt(run.kills)} of them will never walk again. It was not enough. On night ${run.night}, the last of Bastion-7 went quiet, and the valley belonged to the dead.`;
    $('over-stats').innerHTML = this.statsHtml(run);
    $('btn-retry').disabled = !hasSave;
  }

  buildVictory(run) {
    $('victory-pre').textContent = `DAY ${run.night} · 0614 HOURS · ${DIFFICULTY[run.difficulty].label}`;
    $('victory-text').textContent = `Seventy-two hours. ${run.survivors} souls still breathing behind the wall. The relief column never came. The city has stopped burning — there is nothing left in it to burn. The radio is silent. Tonight, they will come down the valley again.`;
    $('victory-stats').innerHTML = this.statsHtml(run);
  }

  statsHtml(run) {
    const t = run.totals;
    const acc = t.shots ? Math.round((t.hits / t.shots) * 100) : 0;
    return `<div><b>${formatInt(run.kills)}</b><span>KILLS</span></div>
      <div><b>${Math.max(0, run.night - 1)}</b><span>NIGHTS HELD</span></div>
      <div><b>${formatInt(t.headshots)}</b><span>HEADSHOTS</span></div>
      <div><b>${acc}%</b><span>ACCURACY</span></div>`;
  }
}
