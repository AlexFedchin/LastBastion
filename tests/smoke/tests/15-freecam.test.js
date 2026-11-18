// The developer's free camera (F9): it flies, the game holds still with the dead hidden
// while the ambient world goes on, picking reports what is under the crosshair, and
// leaving puts the camera, the gun and the dead back.
module.exports = {
  timeout: 120000,
  async run(t) {
    await t.start(3);
    await t.js(`__LB.test.spawn(40, -120, -40); __LB.test.advance(1, 1/30, false)`);
    const before = await t.get(`(() => { const G = __LB, c = G.camera.position;
      G.freecam.enter();
      return { cam: [c.x, c.y, c.z], hx: G.horde.x[0], dir: G.director.t, time: G.time, alive: G.horde.alive };
    })()`);
    t.assert(before.alive > 0, 'the dead are on the field');

    // fly forward a second, then look over the tower from the road
    const fly = await t.get(`(() => { const G = __LB, F = G.freecam;
      F.keys.add('KeyW'); G.test.advance(1, 1/30, false); F.keys.clear(); G.test.advance(0.3, 1/30, false);
      const c = G.camera.position;
      return { on: F.on, cam: [c.x, c.y, c.z], hx: G.horde.x[0], dir: G.director.t, time: G.time, state: G.state,
        hidden: F.hordeMeshes().every((m) => !m.visible), gun: G.player.gun.visible, ui: document.body.classList.contains('freecam'), audioDead: G.audio.hordeAlive };
    })()`);
    t.log(JSON.stringify(fly));
    t.assert(fly.on && fly.state === 'night', 'flying, the night underneath');
    t.assert(Math.hypot(fly.cam[0] - before.cam[0], fly.cam[1] - before.cam[1], fly.cam[2] - before.cam[2]) > 8, 'W flies the camera forward');
    t.eq([fly.hx, fly.dir], [before.hx, before.dir], 'the dead and the night hold still');
    t.assert(fly.time > before.time, 'the ambient clock goes on');
    t.eq([fly.hidden, fly.gun, fly.ui, fly.audioDead], [true, false, true, 0], 'the dead, the gun and the game UI hidden, the horde quiet');

    const pick = await t.get(`(() => { const G = __LB, F = G.freecam;
      F.onKey({ code: 'Digit2', repeat: false, target: document.body, preventDefault() {}, stopImmediatePropagation() {} }, true);
      F.keys.clear(); G.test.advance(0.1, 1/30, false); F.doPick();
      const c = G.camera.position;
      return { cam: [c.x, c.y, c.z], pick: F.pick && { p: [F.pick.point.x, F.pick.point.y, F.pick.point.z], d: F.pick.dist, name: F.pick.name } };
    })()`);
    t.log(JSON.stringify(pick));
    t.assert(pick.pick && pick.pick.d > 5 && pick.pick.d < 60, 'from the road, the crosshair lands on the tower');
    await t.js(`__LB.freecam.toggleGrid(); __LB.freecam.bright = 2`);
    await t.shot('freecam-tower');

    const back = await t.get(`(() => { const G = __LB, F = G.freecam; F.exit(); const c = G.camera.position;
      return { on: F.on, cam: [c.x, c.y, c.z], shown: F.hordeMeshes().every((m) => m.visible), gun: G.player.gun.visible, ui: document.body.classList.contains('freecam'), grid: F.grid.visible, state: G.state };
    })()`);
    t.log(JSON.stringify(back));
    t.assert(!back.on && back.cam.every((v, i) => Math.abs(v - before.cam[i]) < 1e-3), 'the camera goes back to the gun');
    t.eq([back.shown, back.gun, back.ui, back.grid], [true, true, false, false], 'the dead, the gun and the UI back, the grid gone');
    t.eq(back.state, 'paused', 'the night waits behind the pause screen for the mouse');
  },
};
