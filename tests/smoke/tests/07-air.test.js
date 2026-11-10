// The bomber puts a bomb on the marker; Spectre works the far field only.
module.exports = {
  timeout: 300000,
  async run(t) {
    await t.start(4, { survivors: 999 });
    await t.js(`__LB.test.spawn(150, -110, -70, 0); __LB.arsenal.air.bomberCd = 0; __LB.test.aim(0, -8); __LB.test.advance(0.1, 1/30, false); __LB.test.press('KeyT'); __LB.test.advance(0.1, 1/30, false)`);
    t.assert(await t.get('!!__LB.arsenal.air.marker'), 'T throws a marker on night 4');
    let crater = false;
    for (let s = 0; s < 30 && !crater; s++) { await t.advance(1); crater = await t.get('__LB.arsenal.air.craters.length > 0'); }
    t.assert(crater, 'the bomb lands');
    // Spectre: never closer than its minimum distance to the wall
    await t.start(3, { survivors: 999 });
    await t.js('__LB.test.spawn(400, -190, -15, 0)');
    const r = await t.get(`(() => {
      const G = __LB, air = G.arsenal.air; let shots = 0, closest = 1e9;
      const wd = (x, z) => { const ax = Math.abs(x); return (-1.5 - (ax <= 8 ? 0 : (ax - 8) * 0.55)) - z; };
      for (let k = 0; k < 90 * 15; k++) {
        G.test.advance(1 / 15, 1 / 15, false);
        for (const r of air.inFlight) closest = Math.min(closest, wd(r.x, r.z));
        shots = air.gs.shots;
      }
      return { shots, closest };
    })()`);
    t.log(JSON.stringify(r));
    t.assert(r.shots > 0, 'Spectre engages');
    t.assert(r.closest > 35, `Spectre stays off the wall (closest round ${r.closest.toFixed(1)} m out)`);
  },
};
