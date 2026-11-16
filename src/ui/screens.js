// Menus, settings, the dawn resupply shop and the end screens.
import { DIFFICULTY, UPGRADES, UPGRADE_GROUPS, CLAYMORE, FINAL_NIGHT, UNLOCKS, isUnlocked } from '../config.js';
import { QUALITY } from '../core/storage.js';
import { formatInt } from '../core/util.js';

const $ = (id) => document.getElementById(id);

/** The endless record, as a line for the end screens. */
function recordText(b) {
  if (!b) return 'NO RECORD YET';
  return `RECORD <b>${b.nights} ${b.nights === 1 ? 'NIGHT' : 'NIGHTS'}</b> · ${formatInt(b.kills)} KILLS${DIFFICULTY[b.difficulty] ? ` · ${DIFFICULTY[b.difficulty].label}` : ''}`;
}

// What an upgrade gives: the next level's total in gold after the current one ("+20% → +40%
// bullet damage"). When the two read the same apart from their numbers, only the numbers that
// change get an arrow; otherwise both whole lines are shown. First level or maxed: one value.
const NUM = /((?<![A-Za-z\d])[+−-]?\d+(?:\.\d+)?%?)/; // not the 240 in "M240s"
function upgradeTotal(u, rank, maxed) {
  if (maxed) return u.total(rank);
  const next = u.total(rank + 1);
  if (rank === 0) {
    const p = next.split(NUM);
    return p.length > 1 ? p.map((t, i) => (i % 2 ? `<b>${t}</b>` : t)).join('') : `<b>${next}</b>`;
  }
  const now = u.total(rank);
  const a = now.split(NUM), b = next.split(NUM);
  const same = a.length === b.length && a.every((t, i) => i % 2 === 1 || t === b[i]);
  if (!same) return `${now} → <b>${next}</b>`;
  return a.map((t, i) => (i % 2 === 0 || t === b[i] ? t : `${t} → <b>${b[i]}</b>`)).join('');
}

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
      <label>QUALITY</label>${seg('quality', [...Object.entries(QUALITY).map(([k, q]) => [k, q.label]), ['auto', 'AUTO']])}
      <label>SENSITIVITY</label>${slider('sensitivity', 0.2, 3, 0.05, (v) => Number(v).toFixed(2))}
      <label>FIELD OF VIEW</label>${slider('fov', 55, 85, 1, (v) => v)}
      <label>INVERT Y</label>${seg('invertY', [[false, 'OFF'], [true, 'ON']])}
      <label>MASTER</label>${slider('master', 0, 1, 0.01, pct)}
      <label>MUSIC</label>${slider('music', 0, 1, 0.01, pct)}
      <label>EFFECTS</label>${slider('sfx', 0, 1, 0.01, pct)}
      <label>MACHINE GUN</label>${seg('gunSound', [['new', 'NEW'], ['classic', 'CLASSIC']])}
      <label>SHOW FPS</label>${seg('showFps', [[false, 'OFF'], [true, 'ON']])}
      ${window.bastion ? `<label>FULLSCREEN</label>${seg('fullscreen', [['toggle', 'TOGGLE (F11)']])}` : ''}
    `;
    const note = $('settings-note');
    note.textContent = settings.benchMs ? `Detected for this machine: a heavy fight costs ~${settings.benchMs} ms per frame at HIGH.` : '';
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
        if (k === 'quality' && v === 'auto') {
          // detect again: the benchmark runs on the next launch (or right away from the menu)
          this.game.settings.benchmarked = false;
          this.game.applySetting('quality', origQuality);
          note.textContent = inGame ? 'Graphics will be re-detected on the next launch.' : 'Graphics will be re-detected when you go back.';
          return;
        }
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
      ${run.chronicle ? `<div class="chron"><h3>${run.chronicle.title}</h3>${run.chronicle.lines.map((l) => `<p>${l}</p>`).join('')}</div>`
    : `<div class="log">${run.log.slice(-5).map((l) => `<p><em>${l[0]}:</em> ${l[1]}</p>`).join('')}</div>`}
    `;

    // upgrades
    const wrap = $('shop-upgrades');
    let html = '';
    // everything is listed; a tool's upgrades open at the first dawn after you have had it for a
    // night (see UNLOCKS), until then the card is greyed out with the night it arrives
    const had = (key) => !key || isUnlocked(key, n - 1);
    const arrives = (key) => (UNLOCKS[key] === n ? 'ARRIVES TONIGHT · UPGRADES FROM THE NEXT DAWN' : `ARRIVES ON NIGHT ${UNLOCKS[key]}`);
    for (const grp of UPGRADE_GROUPS) {
      const items = UPGRADES.filter((x) => x.group === grp.id);
      const mines = grp.id === 'support';
      if (!items.length && !mines) continue;
      html += `<div class="ugroup"><h3>${grp.title}</h3><div class="gsub">${grp.sub}</div>`;
      for (const u of items) {
        if (!had(u.unlock)) {
          const pips = u.costs.map(() => '<i></i>').join('');
          html += `<div class="card locked"><div class="nm">${u.name}</div><button class="buy" disabled>LOCKED</button><div class="ds">${u.desc}<br><span class="lock">${arrives(u.unlock)}</span></div><div class="pips">${pips}</div></div>`;
          continue;
        }
        const rank = run.upgrades[u.id] || 0;
        const max = u.costs.length;
        const cost = rank < max ? u.costs[rank] : null;
        const pips = Array.from({ length: max }, (_, i) => `<i class="${i < rank ? 'on' : ''}"></i>`).join('');
        const btn = cost === null
          ? `<button class="buy maxed" disabled>MAXED</button>`
          : `<button class="buy" data-act="buy" data-id="${u.id}" ${run.supplies < cost ? 'disabled' : ''}>${formatInt(cost)}</button>`;
        html += `<div class="card"><div class="nm">${u.name}</div>${btn}<div class="ds">${u.desc}<br><span class="tot">${upgradeTotal(u, rank, cost === null)}</span></div><div class="pips">${pips}</div></div>`;
      }
      // claymores are bought, not upgraded: on sale the dawn before the night they arrive
      if (mines && !isUnlocked('claymores', n)) {
        html += `<div class="card locked"><div class="nm">CLAYMORES ×${CLAYMORE.perBuy}</div><button class="buy" disabled>LOCKED</button>
          <div class="ds">Buried in the approach. Detonate on contact. Persist until used.<br><span class="lock">ON SALE THE DAWN BEFORE NIGHT ${UNLOCKS.claymores}</span></div><div class="pips"></div></div>`;
      } else if (mines) {
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
  buildGameOver(run, hasSave, epitaph, endless = null) {
    // the narrator's last words over the wall (voiced), or the old epitaph
    $('over-text').textContent = epitaph || `${formatInt(run.kills)} of them will never walk again. It was not enough. On night ${run.night}, the last of Bastion-7 went quiet, and the valley belonged to the dead.`;
    $('over-stats').innerHTML = this.statsHtml(run);
    $('btn-retry').disabled = !hasSave;
    // endless: how far past the seventy-second hour, against the record
    const held = Math.max(0, run.night - 1 - FINAL_NIGHT);
    $('over-record').innerHTML = endless
      ? `ENDLESS · ${held} ${held === 1 ? 'NIGHT' : 'NIGHTS'} PAST THE SEVENTY-SECOND HOUR · ${endless.fresh ? '<b>NEW RECORD</b>' : recordText(endless.best)}`
      : '';
  }

  buildVictory(run, best, extracted = false) {
    $('victory-pre').textContent = `THE END · ${extracted ? 'EXTRACTED' : 'SEVENTY-TWO HOURS'} · ${DIFFICULTY[run.difficulty].label}`;
    $('victory-text').textContent = extracted
      ? `${run.survivors} of the garrison were carried out of the valley at the seventy-second hour. ${formatInt(run.kills)} of the dead never walked again. The gun is still on the wall.`
      : `${run.survivors} of the garrison lived to see the seventy-second hour, but there were too few of them for the flight. ${formatInt(run.kills)} of the dead never walked again. The wall is still standing.`;
    $('victory-stats').innerHTML = this.statsHtml(run);
    $('victory-record').innerHTML = best ? recordText(best) : '';
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
