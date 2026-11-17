// A new campaign: the prologue plays at sunset, the light goes down to full dark across
// it, the wall's lights come on, and night 1 takes over from the last shot (the camera
// moves into the gun as usual). A still from every shot.
module.exports = {
  timeout: 240000,
  async run(t) {
    await t.start(1);
    const info = await t.get(`(() => { const G = __LB; G.test.prologue(0);
      const A = G.audio, P = G.prologue;
      return { state: G.state, screen: G.screens.current, end: P.end, shots: P.shots.map((s) => [s.name, +s.from.toFixed(1), +s.to.toFixed(1)]),
        missing: P.cues.filter((c) => c.text && !(A.voices_ && A.voices_[c.who + '|' + c.text])).length, power: G.env.power, dusk: G.env.dusk, dawn: +G.env.dawn.toFixed(2) };
    })()`);
    t.log(JSON.stringify(info));
    t.eq(info.state, 'prologue', 'the prologue starts');
    t.eq(info.screen, 'cine', 'over the cutscene overlay');
    t.eq(info.shots.map((s) => s[0]), ['sunTele', 'sun', 'valley', 'wall', 'sentry', 'searchlight', 'lights', 'dead', 'nest'], 'all nine shots');
    t.assert(info.end > 50 && info.end < 120, `a prologue of sensible length (${Math.round(info.end)} s)`);
    t.eq([info.power, info.dusk], [0, 1], 'sunset, the wall lights off');
    if (info.missing) t.log(`${info.missing} lines not recorded yet (docs/TO_GENERATE.md): subtitles only`);

    // through it in order (the dead walk down the valley meanwhile), a still from each shot
    for (const [name, from, to] of info.shots) {
      const s = await t.get(`(() => { const G = __LB, P = G.prologue; const at = ${from} + ({ sunTele: 4.2, searchlight: 3.4, dead: 2.55 }[${JSON.stringify(name)}] ?? (${to} - ${from}) * (${name === 'nest' ? 0.85 : 0.6}));
        const t0 = performance.now(); G.test.advance(Math.max(0, at - P.t), 1/10, false); const ms = Math.round(performance.now() - t0);
        return { ms, t: +P.t.toFixed(1), dawn: +G.env.dawn.toFixed(2), dusk: +G.env.dusk.toFixed(2), power: +G.env.power.toFixed(2), sun: +G.env.sunDir.y.toFixed(3), flash: +G.env.flash.toFixed(2), crows: G.prologue.flock.mesh.visible, scape: G.audio.scape && Object.entries(G.audio.scape).filter(([, v]) => v > 0.001).map(([k, v]) => k + ':' + v.toFixed(2)).join(' '),
          title: document.getElementById('cine-title').classList.contains('on'), sub: document.getElementById('cine-txt').textContent.slice(0, 50) };
      })()`);
      t.log(name + ' ' + JSON.stringify(s));
      await t.shot('prologue-' + name);
    }

    // (the live frame each still needs can run on past the end: the night may already have begun)
    const done = await t.get(`(() => { const G = __LB, P = G.prologue; if (P.active) G.test.advance(P.end + 0.2 - P.t, 1/10, false);
      const ended = !P.active && (G.state === 'intro' || G.state === 'night');
      G.test.advance(3.5, 1/10, false);
      return { ended, state: G.state, dusk: G.env.dusk, dawn: G.env.dawn, power: G.env.power, gunOnCam: G.player.gun.parent === G.camera, screen: G.screens.current };
    })()`);
    t.log(JSON.stringify(done));
    t.eq(done, { ended: true, state: 'night', dusk: 0, dawn: 0, power: 1, gunOnCam: true, screen: null }, 'night 1 takes over: dark, lights on, the gun back on the camera');
    await t.shot('prologue-night1');
  },
};
