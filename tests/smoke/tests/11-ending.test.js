// After the tenth night: the ending plays through (every line recorded, the shots cut to them),
// then the end screen offers endless nights, which keep a record.
module.exports = {
  timeout: 240000,
  async run(t) {
    await t.start(10, { survivors: 999 });
    const info = await t.get(`(() => { const G = __LB; G.run.night = 11; G.test.ending(0);
      const A = G.audio, E = G.ending;
      return { state: G.state, screen: G.screens.current, end: E.end, shots: E.shots.map((s) => s.name),
        missing: E.cues.filter((c) => !(A.voices_ && A.voices_[c.who + '|' + c.text])).map((c) => c.text.slice(0, 40)),
        gunInWorld: G.player.gun.parent === G.scene };
    })()`);
    t.log(JSON.stringify(info));
    t.eq(info.state, 'ending', 'the ending starts');
    t.eq(info.screen, 'cine', 'over the cutscene overlay');
    t.eq(info.missing, [], 'every line of the ending is recorded');
    t.eq(info.shots, ['gun', 'radio', 'field', 'road', 'gate', 'crane'], 'all six shots');
    t.assert(info.end > 80 && info.end < 160, `a cutscene of sensible length (${Math.round(info.end)} s)`);
    t.assert(info.gunInWorld, 'the fifty stands in the nest for its close-up');

    // the column is on the road during its shot, the title comes up near the end
    const mid = await t.get(`(() => { const G = __LB, E = G.ending, s = E.shots.find((x) => x.name === 'road');
      G.test.advance(s.from + 3, 1/10, false);
      const walking = E.walkers.filter((w) => w.f.root.visible).length;
      G.test.advance(E.titleAt - E.t + 0.5, 1/10, false);
      return { walking, title: document.getElementById('cine-title').classList.contains('on'), dawn: G.env.dawn };
    })()`);
    t.log(JSON.stringify(mid));
    t.assert(mid.walking >= 40, `survivors on the road (${mid.walking})`);
    t.assert(mid.title, 'the title card comes up');
    t.assert(mid.dawn < 0.6, 'dusk has fallen by the title');
    await t.shot('ending-title');

    const done = await t.get(`(() => { const G = __LB; G.test.advance(G.ending.end + 4 - G.ending.t, 1/10, false);
      return { state: G.state, screen: G.screens.current, gunInNest: G.player.gun.parent === G.scene, fade: G.post.u.uFade.value,
        buttons: [...document.querySelectorAll('#s-victory button')].map((b) => b.dataset.act) };
    })()`);
    t.eq(done, { state: 'victory', screen: 'victory', gunInNest: true, fade: 1, buttons: ['endless', 'victory-new', 'menu'] }, 'end screen over the bastion, the gun left in the nest');
    await t.shot('ending-screen');

    // endless: on to the shop with every tool open; a dawn past the seventy-second hour sets the record
    const endless = await t.get(`(() => { const G = __LB; localStorage.removeItem('lastbastion.best.v1');
      G.onAction('endless'); G.test.advance(0.1, 1/30, false);
      const s = { state: G.state, endless: G.run.endless, locked: document.querySelectorAll('#shop-upgrades .card.locked').length, gunOnCam: G.player.gun.parent === G.camera };
      G.onAction('begin'); G.test.skipIntro(); G.test.advance(0.1, 1/30, false); G.horde.clearLiving(); G.director.spawningDone = true;
      G.test.advance(0.5, 1/30, false); if (G.state !== 'dawn') G.endNight();
      return { ...s, best: JSON.parse(localStorage.getItem('lastbastion.best.v1') || 'null') };
    })()`);
    t.log(JSON.stringify(endless));
    t.eq([endless.state, endless.endless, endless.locked, endless.gunOnCam], ['shop', true, 0, true], 'endless opens the shop with nothing locked, the gun back on the camera');
    t.eq(endless.best && endless.best.nights, 1, 'surviving night 11 sets a one-night record');
  },
};
