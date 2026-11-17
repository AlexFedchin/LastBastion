// Night 10 with enough of us left: the extraction plays through. Every line is recorded,
// the shots run in the directed order, the gunships fire rockets, the lead lifter lands
// and shuts its ramp, the dead come over the wall at it, the gunships leave last, and the
// end screen sits over the bastion with the gun left in the nest.
module.exports = {
  timeout: 300000,
  async run(t) {
    await t.start(10, { survivors: 30 });
    const info = await t.get(`(() => { const G = __LB; G.test.extraction(0);
      const A = G.audio, E = G.extraction;
      return { state: G.state, shots: E.shots.map((s) => s.name), end: E.end,
        missing: E.cues.filter((c) => c.text && !(A.voices_ && A.voices_[c.who + '|' + c.text])).map((c) => c.text.slice(0, 40)) };
    })()`);
    t.log(JSON.stringify(info));
    t.eq(info.state, 'extraction', 'the extraction starts');
    t.eq(info.missing, [], 'every line of the extraction is recorded');
    t.eq(info.shots, ['bombersIn', 'bombing', 'helosIn', 'helosFire', 'liftersIn', 'landing', 'run', 'ramp', 'doorClose', 'liftoff', 'helosLeave', 'away'], 'the shots in order');
    t.assert(info.end > 90 && info.end < 160, `a cutscene of sensible length (${Math.round(info.end)} s)`);

    // step through it, watching what happens when
    const r = await t.get(`(() => { const G = __LB, E = G.extraction, T = E.T, h = G.horde; const o = { rockets: 0, chain: 0 };
      const at = (s) => G.test.advance(s - E.t, 1/20, false);
      const fired = () => E.rockets.filter((x) => x.on).length;
      // the bombers come in from the south, head-on, and are over the base before the first bombs fall
      at(T.bombersIn + 3); o.bomberZ = Math.round(E.bomberRuns[1].b.group.position.z); o.bombersSeen = E.bomberRuns.every((r) => r.b.group.visible);
      at(T.bombing + 3); o.blasts = E.drops.filter((d) => d.done).length;
      // the gunships come in under the nest and fire rockets on the run the camera rides
      at(T.helosIn + 1); o.heloY = +E.helos[0].att.pos.y.toFixed(1); o.heloZ = Math.round(E.helos[0].att.pos.z);
      for (let k = 0; k < 400 && E.t < T.helosFire + 5; k++) { G.test.advance(0.05, 1/20, false); o.rockets = Math.max(o.rockets, fired()); }
      // the lead lifter is down, ramp open, then shut before it lifts
      at(E.lifters[0].touch + 4); const L = E.lifters[0];
      o.down = +(L.group.position.y - L.base).toFixed(2); o.open = +(1 - L.shut).toFixed(2);
      at(T.liftoff); o.shut = +L.shut.toFixed(2);
      o.inside = (() => { let n = 0; for (let i = 0; i < h.n; i++) if (!h.dead[i] && h.inside[i]) n++; return n; })();
      at(T.liftoff + 5);
      let near = 0; for (let i = 0; i < h.n; i++) if (!h.dead[i] && h.inside[i] && Math.hypot(h.x[i] - L.lz.x, h.z[i] - L.lz.z) < 20) near++; o.nearLifter = near;
      at(T.liftoff + 8); o.climbed = +(L.group.position.y - L.base).toFixed(1);
      // the gunships stay until the lifters are gone, then turn round and follow
      at(T.helosLeave + 1); o.helosStill = E.helos.every((x) => x.group.visible);
      at(T.helosLeave + 12); o.heloGoneZ = Math.round(E.helos[0].att.pos.z);
      o.voiceUp = G.audio._cine === true;
      return o; })()`);
    t.log(JSON.stringify(r));
    t.assert(r.bombersSeen && r.bomberZ > 150, 'the bombers come in from the south, all three in sight');
    t.assert(r.blasts >= 20, `the field erupts (${r.blasts} bombs down)`);
    t.assert(r.heloY < 13.5 && r.heloZ > -20, 'the gunships come in under the nest roof camera');
    t.assert(r.rockets >= 1, 'rockets in the air on the gun run');
    t.assert(Math.abs(r.down) < 0.2 && r.open > 0.9, 'the lead lifter is on its wheels with the ramp down');
    t.assert(r.shut > 0.99, 'the ramp is shut before it lifts');
    t.assert(r.inside >= 60 && r.nearLifter >= 12, `the dead come over the wall at the lifters (${r.inside} inside, ${r.nearLifter} near)`);
    t.assert(r.climbed > 4, `it climbs away (${r.climbed} m up)`);
    t.assert(r.helosStill, 'the gunships are still over the field when the lifters have gone');
    t.assert(r.heloGoneZ > 60, 'then they turn round and follow');
    t.assert(r.voiceUp, 'the cutscene mix is up');
    await t.shot('extraction-liftoff');

    const done = await t.get(`(() => { const G = __LB, E = G.extraction; G.test.advance(E.end + 4 - E.t, 1/10, false);
      return { state: G.state, gunInNest: G.player.gun.parent === G.scene, overWall: G.horde.overWall === null, cine: G.audio._cine };
    })()`);
    t.eq(done, { state: 'victory', gunInNest: true, overWall: true, cine: false }, 'the end screen over the bastion; the cutscene state is cleared');
  },
};
