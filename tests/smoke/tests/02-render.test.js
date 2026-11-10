// Streak particles (tracers, sparks, ricochets, blood jets, bullet paths) must
// actually draw. They once didn't — the quad winding was mirrored and culled.
module.exports = {
  async run(t) {
    await t.start(2);
    const r = await t.get(`(() => {
      const G = __LB, gl = G.renderer.getContext();
      G.test.aim(0, -4); G.test.advance(0.05, 1/30, false);
      G.fx.glow.clear(); G.fx.smoke.clear();
      const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight, V = G.camera.position.constructor;
      const grab = () => { G.render(0); const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
      const at = (x, y, z) => { const v = new V(x, y, z).project(G.camera); return [Math.round((v.x * 0.5 + 0.5) * W), Math.round((v.y * 0.5 + 0.5) * H)]; };
      const peak = (px, [cx, cy]) => { let m = 0; for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const x = cx + dx, y = cy + dy; if (x < 0 || y < 0 || x >= W || y >= H) continue; const i = (y * W + x) * 4; m = Math.max(m, px[i] + px[i + 1] + px[i + 2]); } return m; };
      const before = grab();
      // bright test particles 60 m out: a vertical streak, a horizontal streak, a plain dot
      G.fx.glow.spawn(-10, 9, -60, 0, 10, 0, 30, 1.5, 1.5, 0, 20, 14, 7, 1, 20, 14, 7, 0, 0, 0.5);
      G.fx.glow.spawn(5, 7, -60, 10, 0, 0, 30, 1.5, 1.5, 0, 20, 14, 7, 1, 20, 14, 7, 0, 0, 0.5);
      G.fx.glow.spawn(12, 5, -60, 0, 0, 0, 30, 1.5, 1.5, 0, 20, 14, 7, 1, 20, 14, 7);
      G.fx.update(0.0001);
      const after = grab();
      const probes = { verticalStreak: at(-10, 6.5, -60), horizontalStreak: at(2.5, 7, -60), dot: at(12, 5, -60) };
      const out = {};
      for (const [k, p] of Object.entries(probes)) out[k] = peak(after, p) - peak(before, p);
      return out;
    })()`);
    t.log('brightness gained:', JSON.stringify(r));
    for (const [k, v] of Object.entries(r)) t.assert(v > 60, `${k} draws (brightness gain ${v})`);
    await t.shot('render');
  },
};
