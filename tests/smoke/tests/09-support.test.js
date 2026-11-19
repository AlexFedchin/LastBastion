// Grenades go one per press; artillery hits hard; explosions throw bodies.
module.exports = {
  timeout: 180000,
  async run(t) {
    await t.start(3, { survivors: 999 });
    await t.js(`__LB.arsenal.air.hide(); __LB.test.spawn(250, -62, -42, 0); __LB.test.aim(0, -15); __LB.test.advance(0.1, 1/30, false)`);

    const g = await t.get(`(() => {
      const G = __LB, a = G.arsenal, step = () => G.test.advance(1 / 30, 1 / 30, false);
      const n0 = a.grenadesLeft;
      G.test.press('KeyG'); step();
      const one = a.grenades.length;
      G.test.press('KeyG'); step();
      const still = a.grenades.length;
      // follow the bodies: the highest one in the air while the grenade goes off
      let flyMax = 0;
      const C = G.horde.corpses;
      for (let k = 0; k < 90; k++) {
        step();
        for (const L of C.pools) for (const i of L.active) if (L.mode[i] === 2) flyMax = Math.max(flyMax, L.y[i]);
      }
      return { n0, left: a.grenadesLeft, one, still, flyMax };
    })()`);
    t.log(JSON.stringify(g));
    t.eq(g.n0 - g.left, 1, 'one grenade per press');
    t.eq(g.one, 1, 'a single grenade in the air');
    t.eq(g.still, 1, 'a second press right away waits for the re-arm');
    t.assert(g.flyMax > 2, `bodies are thrown by the blast (highest ${g.flyMax.toFixed(1)} m)`);

    const arty = await t.get(`(() => {
      const G = __LB, a = G.arsenal;
      // a crowd where the shells land (test.spawn scatters over x ±70 m and made this flaky)
      const p = G.player.aimPoint(330);
      for (let i = 0; i < 150; i++) G.horde.spawn(0, p.x - 12 + Math.random() * 24, p.z - 14 + Math.random() * 24, 1, 1);
      G.test.advance(0.1, 1 / 30, false);
      const before = G.horde.alive;
      a.artyCd = 0; G.test.press('KeyQ'); G.test.advance(1 / 30, 1 / 30, false);
      let flyMax = 0;
      const C = G.horde.corpses;
      for (let k = 0; k < 150; k++) {
        G.test.advance(1 / 30, 1 / 30, false);
        for (const L of C.pools) for (const i of L.active) if (L.mode[i] === 2) flyMax = Math.max(flyMax, L.y[i]);
      }
      return { before, after: G.horde.alive, flyMax };
    })()`);
    t.log(JSON.stringify(arty));
    t.assert(arty.before - arty.after > 40, `a fire mission takes out a crowd (${arty.before - arty.after} of ${arty.before})`);
    t.assert(arty.flyMax > 6, `shells throw bodies high (${arty.flyMax.toFixed(1)} m)`);
  },
};
