// Molotovs go one per press, leave a pool that burns and sets the dead alight;
// every dawn tells the night as a story, which the player can read or skip.
module.exports = {
  timeout: 240000,
  async run(t) {
    await t.start(2, { survivors: 999 });
    // a crowd walking in on the right wing; the bottle goes in front of it (about x 12, z -30)
    await t.js(`(() => { const G = __LB; for (let k = 0; k < 120; k++) G.horde.spawn(0, 6 + Math.random() * 14, -44 + Math.random() * 16, 1, 1);
      G.test.aim(-24, -24); G.test.advance(0.1, 1/30, false); })()`);

    const m = await t.get(`(() => {
      const G = __LB, a = G.arsenal, step = () => G.test.advance(1 / 30, 1 / 30, false);
      const n0 = a.molotovsLeft, fires0 = G.env.fire.free.length;
      G.test.press('KeyE'); step();
      const lit = a.molotovs.length;
      G.test.press('KeyE'); step();
      const still = a.molotovs.length;
      let pool = 0, burning = 0;
      for (let k = 0; k < 75; k++) {
        step();
        pool = Math.max(pool, a.pools.length);
        let b = 0; for (let i = 0; i < G.horde.n; i++) if (G.horde.burn[i] > 0 && !G.horde.dead[i]) b++;
        burning = Math.max(burning, b);
      }
      return { n0, left: a.molotovsLeft, lit, still, pool, fires: fires0 - G.env.fire.free.length, burning,
        fireKills: G.ns.fireKills, hud: document.querySelector('#h-abilities .ab .nm').textContent };
    })()`);
    t.log(JSON.stringify(m));
    t.eq(m.n0 - m.left, 1, 'one bottle per press');
    t.eq(m.lit, 1, 'a single bottle lit');
    t.eq(m.still, 1, 'a second press right away waits for the re-arm');
    t.eq(m.pool, 1, 'the bottle leaves a burning pool');
    t.assert(m.fires >= 5, `the pool is a spread of fires (${m.fires})`);
    t.assert(m.burning >= 3, `the dead catch fire (${m.burning} alight at once)`);
    t.assert(m.fireKills >= 5, `and burn to death (${m.fireKills})`);
    t.eq(m.hud, 'MOLOTOV', 'E is the Molotov on the ability bar');
    await t.shot('molotov');

    // the pool burns out and lets go of its fires and light
    const out = await t.get(`(() => { const G = __LB; G.test.advance(14, 1/30, false); return { pools: G.arsenal.pools.length, fire: G.audio.fireLevel }; })()`);
    t.eq(out, { pools: 0, fire: 0 }, 'the fire burns out');

    // dawn: the night is told as a story
    await t.js(`__LB.events.log = [{ kind: 'fog', phase: 'start', data: {} }, { kind: 'fog', phase: 'end', data: {} }]`);
    for (let k = 0; k < 60 && (await t.get('__LB.state')) === 'night'; k++) await t.js('__LB.horde.clearLiving(); __LB.director.t = 1e4; __LB.test.advance(1, 1/30, false)');
    t.eq(await t.get('__LB.state'), 'dawn', 'night 2 ends at dawn');
    await t.advance(7);
    const c = await t.get(`({ screen: __LB.screens.current, title: document.getElementById('chr-title').textContent,
      lines: [...document.querySelectorAll('#chr-body p')].map((p) => p.textContent), on: document.querySelectorAll('#chr-body p.on').length })`);
    t.log(JSON.stringify(c));
    t.eq(c.screen, 'chronicle', 'the chronicle comes up over the dawn');
    t.eq(c.title, 'THE FOG', 'titled for the night');
    t.assert(c.lines.length >= 4 && c.lines[0].startsWith('On the second night'), 'opens on the night');
    t.assert(c.lines.some((l) => l.startsWith('Then the fog rolled')), "tells the night's event");
    t.assert(c.lines.some((l) => l.includes('Sixty-four') || l.includes('gate was still shut')), 'closes on the morning');
    t.assert(c.on >= 1, 'the first line is up');
    await t.shot('chronicle');
    // Space: everything at once; Space again: on to the resupply
    await t.js(`document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }))`);
    t.eq(await t.get(`document.querySelectorAll('#chr-body p.on').length`), c.lines.length, 'skipping shows the whole story');
    await t.js(`document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' })); __LB.test.advance(5, 1/30, false)`);
    t.eq(await t.get('__LB.state'), 'shop', 'then the resupply opens');
    t.assert(await t.get(`document.querySelector('#shop-report .chron h3').textContent === 'THE FOG'`), 'the resupply keeps the story');
  },
};
