// Alerts merge instead of stacking, and urgent ones push minor ones out.
module.exports = {
  async run(t) {
    await t.start(3, { survivors: 999 });
    const texts = () => t.get(`[...document.querySelectorAll('#alerts .alert')].map((e) => e.textContent + (e.classList.contains('red') ? ' [red]' : ''))`);
    await t.js(`__LB.hud.clearAlerts(); __LB.onBreach(3, 0, 7, -10); __LB.onBreach(6, 0, 7, -10); __LB.onBreach(3, 0, 7, -10)`);
    let a = await texts();
    t.eq(a, ['BREACH — L2 · R2 — WE LOST 3 [red]'], 'breaches merge into one line with their sections');
    await t.js(`(() => { const h = __LB.hud; h.clearAlerts(); h.alert('NO FLARES LEFT'); h.alert('NO FLARES LEFT'); h.alert('NO FLARES LEFT'); })()`);
    t.eq(await texts(), ['NO FLARES LEFT  ×3'], 'repeats count up');
    await t.js(`(() => { const h = __LB.hud; h.clearAlerts(); h.alert('MINOR A'); h.alert('MINOR B'); h.alert('MINOR C'); h.alert('URGENT', 'red'); h.alert('MINOR D'); h.alert('MINOR E'); })()`);
    a = await texts();
    t.assert(a.length <= 3, `at most three alerts on screen (${a.length})`);
    t.assert(a.includes('URGENT [red]'), 'the urgent alert survives a flood of minor ones: ' + JSON.stringify(a));
    await t.advance(5);
    t.eq((await texts()).length, 0, 'alerts expire');
  },
};
