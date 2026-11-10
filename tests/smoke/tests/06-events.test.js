// Every night event starts, plays out and cleans up after itself.
module.exports = {
  timeout: 420000,
  async run(t) {
    const until = async (cond, maxS, step = 1) => { for (let s = 0; s < maxS; s += step) { if (await t.get(cond)) return true; await t.advance(step); } return t.get(cond); };
    const done = 'Number(__LB.events.active.length === 0)';
    const trigger = (k) => t.js(`__LB.test.event('${k}')`);

    // escorts
    for (const [kind, n] of [['patrol', 1], ['civilians', 3]]) {
      await t.start(n, { survivors: 999 });
      await trigger(kind);
      const units = await t.get('__LB.events.active[0].units.length');
      t.assert(await until(done, 90), `${kind} finishes`);
      const rec = await t.get(`__LB.telemetry.recent.filter((r) => r.type === 'event' && r.kind === '${kind}' && r.phase === 'end').pop()`);
      t.assert(rec && rec.saved + rec.lost === units, `${kind}: everyone either made it or didn't (${JSON.stringify(rec)})`);
    }

    // supply drop
    await t.start(4, { survivors: 999 });
    await trigger('drop');
    t.assert(await until(`Number(__LB.events.active[0] && __LB.events.active[0].phase === 'hold')`, 40, 0.5), 'the crate lands');
    t.assert(await until(done, 60), 'the drop resolves');

    // the giant: walks to the wall, smashes it, falls
    await t.start(5, { survivors: 999 });
    await t.js('__LB.arsenal.air.hide()');
    await trigger('giant');
    t.assert(await until('Number(__LB.events.active[0].smashes >= 2)', 220), 'the giant reaches the wall and smashes it');
    t.assert(await t.get('Math.max(...__LB.horde.acid) > 1'), 'its blows leave a climbable ramp');
    const corpses = await t.get('__LB.horde.corpses.count');
    await t.js(`(() => { const h = __LB.horde; h.damage(h.indexOf(__LB.events.active[0].id), 1e7, 'arty', 0, 1, 1); })()`);
    t.assert(await until(done, 8), 'the giant event ends when it dies');
    t.assert(await t.get('__LB.horde.corpses.count') > corpses, 'and leaves a body');
    t.eq(await t.get('__LB.events.busy'), false, 'nothing keeps the night open afterwards');

    // behemoth: bigger than the giant
    await t.start(10, { survivors: 999 });
    await trigger('behemoth');
    const b = await t.get(`(() => { const e = __LB.events.active[0]; return { scale: e.scale, hp: e.maxHp }; })()`);
    t.assert(b.scale > 5 && b.hp > 30000, `behemoth is big (${JSON.stringify(b)})`);

    // waves
    await t.start(6, { survivors: 999 });
    await trigger('stampede'); await trigger('bloaters');
    const tot = await t.get('__LB.events.active.map((e) => e.total)');
    t.assert(tot[0] >= 14 && tot[1] >= 40, `stampede and bloater column spawn (${tot})`);
    await t.js('__LB.horde.clearLiving()');
    t.assert(await until(done, 4), 'waves end when they are dead');

    // fog
    await t.start(3, { survivors: 999 });
    await trigger('fog');
    await t.advance(15);
    t.assert(await t.get('__LB.env.fogBank') > 0.9, 'fog rolls in');
    t.assert(await t.get('__LB.arsenal.air.holdFire'), 'Spectre holds fire in the fog');
    t.assert(await until(done, 60), 'fog lifts');
    t.eq(await t.get('[__LB.env.fogBank, __LB.arsenal.air.holdFire]'), [0, false], 'and everything is back');

    // blackout
    await t.start(7, { survivors: 999 });
    const f0 = await t.get('__LB.arsenal.flaresLeft');
    await trigger('blackout');
    await t.advance(4);
    t.eq(await t.get('__LB.env.power'), 0, 'the lights go out');
    t.eq(await t.get('__LB.arsenal.flaresLeft'), f0 + 2, 'two flares are issued');
    t.assert(await until(done, 60), 'the generator comes back');
    t.eq(await t.get('__LB.env.power'), 1, 'and so do the lights');

    // Spectre goes down
    await t.start(8, { survivors: 999 });
    t.assert(await t.get('__LB.arsenal.air.gs.active'), 'Spectre is up before');
    await trigger('gunshipDown');
    t.assert(await until(done, 45), 'Spectre crashes');
    t.eq(await t.get('__LB.arsenal.air.gs.active'), false, 'and stays down');

    // the schedule fires the night's event on its own
    await t.start(1, { keepEvents: true, survivors: 999 });
    t.assert(await until('Number(__LB.events.active.some((e) => e.kind === "patrol"))', 80), 'night 1 brings the patrol by itself');
  },
};
