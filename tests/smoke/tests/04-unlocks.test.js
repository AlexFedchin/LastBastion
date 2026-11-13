// Tools arrive night by night: night 1 is the fifty and two wall gunners.
module.exports = {
  async run(t) {
    const state = () => t.get(`({
      rows: [...document.querySelectorAll('#h-abilities .ab .key')].map((e) => e.textContent).join(''),
      gunners: __LB.arsenal.gunners.filter((g) => g.active).length,
      gunship: __LB.arsenal.air.gs.active, grenades: __LB.arsenal.grenadesLeft,
    })`);
    await t.start(1);
    await t.js(`['KeyQ','KeyE','KeyT','KeyG','KeyB'].forEach((k) => __LB.test.press(k)); __LB.test.advance(0.2, 1/30, false)`);
    const n1 = await state();
    const used = await t.get(`({ napalm: __LB.arsenal.napalmT > 0, marker: !!__LB.arsenal.air.marker, shells: __LB.arsenal.shells.length, danger: __LB.arsenal.dangerUsed })`);
    t.eq(n1, { rows: '', gunners: 2, gunship: false, grenades: 0 }, 'night 1 loadout');
    t.eq(used, { napalm: false, marker: false, shells: 0, danger: false }, 'locked keys do nothing on night 1');
    const expect = { 2: 'EG', 3: 'QEG', 4: 'QETG', 5: 'QETGB' };
    for (const n of [2, 3, 4, 5]) {
      await t.start(n);
      const s = await state();
      t.eq(s.rows, expect[n], `night ${n} ability bar`);
      t.eq(s.gunship, n >= 3, `night ${n} gunship on station`);
    }
    // the shop only offers what the coming night has
    const shop = await t.get(`(() => {
      const G = __LB, run = { ...G.run, night: 3, supplies: 0, upgrades: {}, log: [] };
      G.screens.buildShop(run, {}); const a = [...document.querySelectorAll('#shop-upgrades .ugroup h3')].map((e) => e.textContent);
      run.night = 2; G.screens.buildShop(run, {}); const b = [...document.querySelectorAll('#shop-upgrades .ugroup h3')].map((e) => e.textContent);
      return { before3: a, before2: b };
    })()`);
    t.assert(shop.before3.some((h) => h.includes('105MM')), 'battery upgrades on sale before night 3');
    t.assert(!shop.before2.some((h) => h.includes('105MM')), 'not before night 2');
  },
};
