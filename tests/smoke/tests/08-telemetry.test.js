// A night played to dawn and a night lost both end up in the play-test log.
const fs = require('fs');
module.exports = {
  timeout: 300000,
  async run(t) {
    await t.start(2, { survivors: 999 });
    await t.js(`(() => { const G = __LB; G.test.spawn(40, -60, -30, 0); G.input.buttons |= 1;
      for (let k = 0; k < 60; k++) { G.player.heat = 0; G.test.aim(Math.sin(k * 0.3) * 10, -16); G.test.advance(1/30, 1/30, false); }
      G.input.buttons = 0; G.test.press('KeyE'); G.test.advance(0.2, 1/30, false); })()`);
    // fast-forward the night to dawn
    for (let k = 0; k < 60 && (await t.get('__LB.state')) === 'night'; k++) await t.js('__LB.horde.clearLiving(); __LB.director.t = 1e4; __LB.test.advance(1, 1/30, false)');
    t.eq(await t.get('__LB.state'), 'dawn', 'night 2 ends at dawn');
    await t.advance(12);
    t.eq(await t.get('__LB.state'), 'shop', 'the resupply opens');
    await t.js(`__LB.run.supplies = 5000; document.querySelector('[data-act="buy"]').click(); __LB.onAction('begin')`);
    await t.js(`(() => { const t = __LB.test; t.skipIntro(); t.advance(0.3, 1/30, false); __LB.run.survivors = 1; t.spawn(500, -60, -10, 0); for (let k = 0; k < 240 && __LB.state !== 'fallen'; k++) t.advance(1, 1/30, false); })()`);
    t.eq(await t.get('__LB.state'), 'fallen', 'night 3 is lost');
    const sums = await t.get(`__LB.telemetry.recent.filter((r) => r.type === 'night_summary').slice(-2).map((r) => ({ night: r.night, outcome: r.outcome, napalm: r.abilities.napalm ? r.abilities.napalm.used : 0, shots: r.gun.shots, kills: r.kills.total }))`);
    t.log(JSON.stringify(sums));
    t.eq(sums.map((s) => [s.night, s.outcome]), [[2, 'survived'], [3, 'fallen']], 'both nights are summarised');
    t.assert(sums[0].napalm === 1 && sums[0].shots > 0, 'ability use and shots are counted');
    // and it all reached the file
    await t.sleep(800);
    const file = t.telemetryFile();
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const types = new Set(lines.map((l) => l.type));
    for (const ty of ['session', 'night_start', 'sample', 'ability', 'breach', 'purchase', 'night_summary']) t.assert(types.has(ty), `log file has ${ty} records`);
  },
};
