// Streak particles (tracers, sparks, ricochets, blood jets, bullet paths) must
// actually draw. They once didn't — the quad winding was mirrored and culled.
// (pixels come from the presented frame, so it holds for any renderer backend)
module.exports = {
  async run(t) {
    await t.start(2);
    await t.js(`(() => { const G = __LB; G.test.aim(0, -4); G.test.advance(0.05, 1/30, false);
      G.fx.glow.clear(); G.fx.smoke.clear(); G.render(0); })()`);
    const before = await t.capture();
    // bright test particles 60 m out: a vertical streak, a horizontal streak, a plain dot
    const probes = await t.get(`(() => {
      const G = __LB, V = G.camera.position.constructor;
      G.fx.glow.spawn(-10, 9, -60, 0, 10, 0, 30, 1.5, 1.5, 0, 20, 14, 7, 1, 20, 14, 7, 0, 0, 0.5);
      G.fx.glow.spawn(5, 7, -60, 10, 0, 0, 30, 1.5, 1.5, 0, 20, 14, 7, 1, 20, 14, 7, 0, 0, 0.5);
      G.fx.glow.spawn(12, 5, -60, 0, 0, 0, 30, 1.5, 1.5, 0, 20, 14, 7, 1, 20, 14, 7);
      G.fx.update(0.0001); G.render(0);
      const at = (x, y, z) => { const v = new V(x, y, z).project(G.camera); return [(v.x * 0.5 + 0.5), (0.5 - v.y * 0.5)]; };
      return { verticalStreak: at(-10, 6.5, -60), horizontalStreak: at(2.5, 7, -60), dot: at(12, 5, -60) };
    })()`);
    const after = await t.capture();
    const peak = ({ w, h, px }, [u, v]) => {
      const cx = Math.round(u * w), cy = Math.round(v * h); let m = 0;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const i = (y * w + x) * 4; m = Math.max(m, px[i] + px[i + 1] + px[i + 2]);
      }
      return m;
    };
    const r = {};
    for (const [k, p] of Object.entries(probes)) r[k] = peak(after, p) - peak(before, p);
    t.log('brightness gained:', JSON.stringify(r));
    for (const [k, v] of Object.entries(r)) t.assert(v > 60, `${k} draws (brightness gain ${v})`);
    await t.shot('render');
  },
};
