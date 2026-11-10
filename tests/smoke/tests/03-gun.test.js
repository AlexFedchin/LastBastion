// The fifty fires, hits, kills, heats up, and leaves a visible path and impacts.
module.exports = {
  async run(t) {
    await t.start(2, { survivors: 999 });
    await t.js('__LB.test.spawn(70, -48, -26, 0)');
    const s0 = await t.get(`({ shots: __LB.player.shots, hits: __LB.player.hits, kills: __LB.run.kills, decals: __LB.fx.decals.count })`);
    const r = await t.get(`(() => {
      const G = __LB; let paths = 0, tracers = 0, maxHeat = 0;
      G.input.buttons |= 1;
      for (let k = 0; k < 75; k++) {
        G.test.aim(Math.sin(k * 0.25) * 10, -19);
        G.test.advance(1 / 30, 1 / 30, false);
        maxHeat = Math.max(maxHeat, G.player.heat);
        const g = G.fx.glow;
        for (let i = 0; i < g.count; i++) { if (g.frame[i] === 15) paths++; else if (g.stretch[i] > 0) tracers++; }
      }
      G.input.buttons = 0;
      G.test.advance(0.1, 1 / 30, false);
      return { shots: G.player.shots, hits: G.player.hits, kills: G.run.kills, decals: G.fx.decals.count, paths, tracers, maxHeat, firing: G.player.firing };
    })()`);
    t.log(JSON.stringify(r));
    t.assert(r.shots - s0.shots >= 20, `the gun fires (${r.shots - s0.shots} shots)`);
    t.assert(r.hits > s0.hits, 'rounds hit zombies');
    t.assert(r.kills > s0.kills, 'and kill them');
    t.assert(r.maxHeat > 0.25, `the barrel heats up (${r.maxHeat.toFixed(2)})`);
    t.assert(r.paths > 0, 'bullet paths are spawned');
    t.assert(r.tracers > 0, 'tracers / sparks are spawned');
    t.assert(r.decals > s0.decals, 'impacts leave marks');
    t.assert(!r.firing, 'stops firing when the trigger is released');
  },
};
