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
    t.assert(pick.pick && Math.abs(pick.pick.p[2] - -1.5) < 0.5, 'from the road, the crosshair lands on the tower face');
    await t.js(`__LB.freecam.toggleGrid(); __LB.freecam.bright = 2`);
    await t.shot('freecam-tower');

    // the world from the panel: sunset, the generator down, a fog bank, the city burnt out
    const world = await t.get(`(() => { const G = __LB, F = G.freecam, env = G.env;
      F.over.time = 0.04; F.over.power = 0; G.test.advance(0.2, 1/30, false);
      const sunset = { dusk: +env.dusk.toFixed(2), dawn: +env.dawn.toFixed(2), sun: +env.sunDir.y.toFixed(3), power: env.power, nest: G.player.nestLight.intensity };
      F.over.time = 0.5; F.over.fog = 1; F.panel.querySelector('#fc-story').value = '8'; F.panel.querySelector('#fc-story').dispatchEvent(new Event('change'));
      G.test.advance(0.2, 1/30, false); F.syncPanel();
      return { sunset, night: { dusk: env.dusk, dawn: env.dawn, fog: env.fogBank, burn: env.burn }, label: F.panel.querySelector('#fc-time-l').textContent };
    })()`);
    t.log(JSON.stringify(world));
    t.assert(world.sunset.dusk > 0.9 && world.sunset.dawn > 0.6 && world.sunset.sun > 0, 'SUNSET: the sun above the hills');
    t.eq([world.sunset.power, world.sunset.nest], [0, 0], 'the generator down: the lights out');
    t.eq([world.night.dusk, world.night.dawn, world.night.fog], [0, 0, 1], 'midnight in a fog bank');
    t.assert(world.night.burn < 0.1, 'the city burnt out, as on night 8');
    t.eq(world.label, '00:00', 'the clock on the panel');
    await t.shot('freecam-fog');

    const back = await t.get(`(() => { const G = __LB, F = G.freecam; F.exit(); const c = G.camera.position;
      return { on: F.on, cam: [c.x, c.y, c.z], shown: F.hordeMeshes().every((m) => m.visible), gun: G.player.gun.visible, ui: document.body.classList.contains('freecam'), grid: F.grid.visible, state: G.state };
    })()`);
    t.log(JSON.stringify(back));
    t.assert(!back.on && back.cam.every((v, i) => Math.abs(v - before.cam[i]) < 1e-3), 'the camera goes back to the gun');
    t.eq([back.shown, back.gun, back.ui, back.grid], [true, true, false, false], 'the dead, the gun and the UI back, the grid gone');
    t.eq(back.state, 'paused', 'the night waits behind the pause screen for the mouse');
    const env = await t.get(`(() => { const e = __LB.env; return { dusk: e.dusk, dawn: e.dawn, fog: e.fogBank, power: e.power, story: e.storyNight, burn: e.burn }; })()`);
    t.eq([env.dusk, env.dawn, env.fog, env.power, env.story], [0, 0, 0, 1, 3], 'the world back as night 3 had it');
    t.assert(env.burn > 0.9, 'the city burning again');

    // a cutscene under the free camera: it plays on, pauses, seeks; the camera stays ours
    const cine = await t.get(`(() => { const G = __LB, F = G.freecam, P = G.prologue;
      G.test.prologue(0); G.test.advance(0.5, 1/30, false);
      F.enter({ follow: true });
      const a = { on: F.on, cine: !!F.cine, follow: F.follow, dead: F.deadShown };
      G.test.advance(1, 1/30, false);
      const followT = P.t, camFollow = G.camera.position.toArray();
      F.setFollow(false); F.go(new THREE_V(0, 30, -60), null, null);
      return { a, followT, camFollow };
    })()`.replace('new THREE_V(0, 30, -60)', 'G.camera.position.clone().set(0, 30, -60)'));
    t.log(JSON.stringify(cine));
    t.eq(cine.a, { on: true, cine: true, follow: true, dead: true }, 'over the prologue: it plays on, through its own camera, the dead shown');
    t.assert(cine.followT > 1.4, 'the prologue runs on under the camera');
    const run = await t.get(`(() => { const G = __LB, F = G.freecam, P = G.prologue;
      const t0 = P.t; G.test.advance(1, 1/30, false); const t1 = P.t, cam = G.camera.position.toArray();
      F.cinePaused = true; G.test.advance(1, 1/30, false); const t2 = P.t;
      F.cinePaused = false; F.cineSpeed = 2; G.test.advance(1, 1/30, false); const t3 = P.t; F.cineSpeed = 1;
      F.seek(30); const t4 = P.t, lights = P.lightsOn;
      F.seek(5); const t5 = P.t;
      return { ran: +(t1 - t0).toFixed(2), held: +(t2 - t1).toFixed(2), fast: +(t3 - t2).toFixed(2), t4: +t4.toFixed(2), t5: +t5.toFixed(2), cam, camAfter: G.camera.position.toArray(), state: G.state, uFade: G.post.u.uFade.value };
    })()`);
    t.log(JSON.stringify(run));
    t.assert(Math.abs(run.ran - 1) < 0.05 && run.held === 0 && Math.abs(run.fast - 2) < 0.1, 'plays, pauses, plays at double speed');
    t.eq([run.t4, run.t5, run.state], [30, 5, 'prologue'], 'seeks on, and back (from the start again)');
    t.eq(run.cam.map((v) => Math.round(v)), [0, 30, -60], 'the free camera stays where it was put while the shots cut');
    t.eq(run.camAfter.map((v) => Math.round(v)), [0, 30, -60], '... and through a seek');
    await t.shot('freecam-prologue');
    const done = await t.get(`(() => { const G = __LB, F = G.freecam, P = G.prologue;
      F.seek(P.end + 5); const held = P.active && G.state === 'prologue';
      G.test.advance(1, 1/30, false); const still = P.active && F.cinePaused;
      F.exit(); G.test.advance(0.5, 1/30, false);
      return { held, still, after: G.state };
    })()`);
    t.log(JSON.stringify(done));
    t.eq([done.held, done.still], [true, true], 'it holds at the end instead of handing over to the night');
    t.assert(['prologue', 'intro', 'night'].includes(done.after), 'leaving, the prologue finishes and the night follows');
  },
};
