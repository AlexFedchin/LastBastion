// Tools arrive night by night: night 1 is the fifty and two wall gunners.
module.exports = {
  async run(t) {
    const state = () => t.get(`({
      rows: [...document.querySelectorAll('#h-abilities .ab .key')].map((e) => e.textContent).join(''),
      gunners: __LB.arsenal.gunners.filter((g) => g.active).length,
      gunship: __LB.arsenal.air.gs.active, grenades: __LB.arsenal.grenadesLeft, bottles: __LB.arsenal.molotovsLeft,
    })`);
    await t.start(1);
    await t.js(`['KeyQ','KeyE','KeyT','KeyG','KeyB'].forEach((k) => __LB.test.press(k)); __LB.test.advance(0.2, 1/30, false)`);
    const n1 = await state();
    const used = await t.get(`({ molotov: __LB.arsenal.molotovs.length + __LB.arsenal.pools.length > 0, marker: !!__LB.arsenal.air.marker, shells: __LB.arsenal.shells.length, danger: __LB.arsenal.dangerUsed })`);
    t.eq(n1, { rows: '', gunners: 2, gunship: false, grenades: 0, bottles: 0 }, 'night 1 loadout');
    t.eq(used, { molotov: false, marker: false, shells: 0, danger: false }, 'locked keys do nothing on night 1');
    const expect = { 2: 'EG', 3: 'QEG', 4: 'QETG', 5: 'QETGB' };
    for (const n of [2, 3, 4, 5]) {
      await t.start(n);
      const s = await state();
      t.eq(s.rows, expect[n], `night ${n} ability bar`);
      t.eq(s.gunship, n >= 3, `night ${n} gunship on station`);
    }
    // the shop lists everything; a tool's upgrades open the dawn after the first night you had it
    const shop = await t.get(`(() => {
      const G = __LB, run = { ...G.run, supplies: 99999, upgrades: {}, log: [] };
      const at = (n) => { run.night = n; G.screens.buildShop(run, {}); return [...document.querySelectorAll('#shop-upgrades .card')].map((c) => [c.querySelector('.nm').textContent, c.classList.contains('locked')]); };
      return { 2: at(2), 3: at(3), 4: at(4) };
    })()`);
    const locked = (n, name) => (shop[n].find((c) => c[0].includes(name)) || [0, null])[1];
    t.eq(locked(2, 'MOLOTOV CRATE'), true, 'molotov upgrades locked the dawn before you first get them');
    t.eq(locked(3, 'MOLOTOV CRATE'), false, 'molotov upgrades open after night 2');
    t.eq(locked(3, 'SECOND GUN SECTION'), true, 'battery upgrades locked before night 3');
    t.eq(locked(4, 'SECOND GUN SECTION'), false, 'battery upgrades open after night 3');
    t.eq(locked(2, 'MATCH-GRADE BARREL'), false, 'the fifty is always open');
    t.eq(locked(2, 'CLAYMORES'), false, 'claymores on sale the dawn before night 2');
    t.assert(shop[2].some((c) => c[0].includes('SECOND GUN SECTION')), 'locked upgrades are still listed');
  },
};
