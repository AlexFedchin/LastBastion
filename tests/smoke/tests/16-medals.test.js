// The service record: every medal drawn, won through the game's own paths (a night held,
// a rescue, the extraction), the progress bars, the toast; developer runs never count.
module.exports = {
  timeout: 120000,
  async run(t) {
    // a clean record (earlier tests in the same run play real nights and win medals of their own)
    await t.js(`(() => { localStorage.removeItem('lastbastion.medals.v1'); const G = __LB; G.medals.state = G.medals.load(); G._medalQ = []; document.getElementById('medal-toast').className = ''; G.enterMenu(); })()`);
    const empty = await t.get(`(() => { const G = __LB; G.onAction('medals');
      return { screen: G.screens.current, cards: document.querySelectorAll('#md-list .md-card').length, won: document.querySelectorAll('#md-list .md-card.won').length,
        svgs: document.querySelectorAll('#md-list svg.medal-svg').length, bars: document.querySelectorAll('#md-list .md-bar').length,
        rack: document.getElementById('md-rack').textContent.trim(), info: document.getElementById('medals-info').textContent };
    })()`);
    t.log(JSON.stringify(empty));
    t.eq([empty.screen, empty.cards, empty.won, empty.svgs], ['medals', 26, 0, 26], 'the service record lists every medal, none won, each drawn');
    t.assert(empty.bars >= 12, 'progress bars where a medal builds up');
    await t.shot('medals-empty');
    await t.js(`__LB.onAction('back')`);

    // a dev run counts for nothing; a real night held wins the first medal and shows the toast
    const won = await t.get(`(() => { const G = __LB, M = G.medals;
      G.test.start(1); G.run.dev = true; G.medals.startNight(G.run); G.endNight();
      const devCount = M.count();
      G.test.start(1); G.test.skipIntro(); G.test.advance(0.2, 1/30, false);
      for (let i = 0; i < 40; i++) G.onKill(2, 'hmg', 0, 0, -50, true);
      G.endNight();
      const toast = document.getElementById('medal-toast');
      return { devCount, baptism: M.earned('baptism'), brutes: M.state.stats.brutes, heads: M.state.stats.headshots, toast: toast.className, toastName: toast.querySelector('.mt-name')?.textContent };
    })()`);
    t.log(JSON.stringify(won));
    t.eq(won.devCount, 0, 'a developer run wins nothing');
    t.eq([won.baptism, won.brutes, won.heads], [true, 40, 40], 'a night held: Baptism of Fire, and the kills counted');
    t.eq([won.toast, won.toastName], ['show bronze', 'BAPTISM OF FIRE'], 'the award slides in');
    await t.shot('medals-toast');

    // the rescue, the extraction on Last Stand with 30 alive
    const more = await t.get(`(() => { const G = __LB, M = G.medals;
      G.events.report('civilians', 'end', { saved: 6, lost: 0, of: 6 });
      G.run.difficulty = 'laststand'; G.run.survivors = 31; M.campaignEnd(G.run, true);
      return ['shepherd', 'nightingale', 'laststand', 'unbroken', 'seventytwo'].map((id) => M.earned(id));
    })()`);
    t.eq(more, [true, true, true, true, true], 'a full rescue and a Last Stand extraction with 30 alive: their medals');

    // a fuller record for the picture: some of each grade, some progress
    await t.js(`(() => { const M = __LB.medals; for (const id of ['marksman', 'firemission', 'salvage', 'steady', 'giant', 'hammer', 'colossus']) M.award(id);
      Object.assign(M.state.stats, { kills: 6420, fire: 182, upgrades: 9, dangerBest: 27, accuracyBest: 48, nightKillsBest: 1210, endlessBest: 3, cleanStreakBest: 1 }); M.save();
      __LB._medalQ = []; document.getElementById('medal-toast').className = ''; __LB.enterMenu(); __LB.onAction('medals'); })()`);
    const full = await t.get(`({ won: document.querySelectorAll('#md-list .md-card.won').length, rack: document.querySelectorAll('#md-rack .ribbon-bar').length })`);
    t.log(JSON.stringify(full));
    t.assert(full.won >= 12 && full.rack === full.won, 'every medal won has its ribbon on the rack');
    await t.shot('medals-record');
    await t.js(`(() => { document.querySelector('.medals-panel').scrollTop = 99999; })()`);
    await t.shot('medals-record-valour');
    // close up, one of each grade (and one not yet won)
    for (const id of ['marksman', 'steady', 'colossus', 'laststand', 'fiftyalone']) {
      const z = await t.get(`(() => { document.querySelector('[data-medal="${id}"]').click(); return document.getElementById('md-zoom').className; })()`);
      t.assert(z.includes('on'), 'a card opens its medal close up');
      await t.shot('medal-zoom-' + id);
    }
    const shut = await t.get(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' })); return [document.getElementById('md-zoom').classList.contains('on'), __LB.screens.current]; })()`);
    t.eq(shut, [false, 'medals'], 'Esc closes the close-up, not the screen');
    // every medal in full colour, for a look at the art
    await t.js(`(() => { const d = document.createElement('div'); d.id = 'sheet'; d.style.cssText = 'position:fixed;inset:0;z-index:999;background:#0c0c0b;display:grid;grid-template-columns:repeat(9,1fr);gap:4px 0;padding:8px;align-content:start';
      d.innerHTML = [...document.querySelectorAll('#md-list svg.medal-svg')].map((s) => '<div style="aspect-ratio:2/3">' + s.outerHTML + '</div>').join(''); document.body.appendChild(d); })()`);
    await t.shot('medals-sheet');
    await t.js(`document.getElementById('sheet').remove()`);
    await t.js(`(() => { localStorage.removeItem('lastbastion.medals.v1'); __LB.medals.state = __LB.medals.load(); __LB.enterMenu(); })()`);
  },
};
