// The shortlisted recordings (docs/SOUNDS_NEEDED.md): every one loads, each stand-in's call
// reaches its recording, and the set-dressing beds (the flag, the wire singing) stay well under
// the action: metered live on the master and on the ambience bus, quiet and under fire.
const SFX = ['searchlight_on', 'sl_motor', 'gen_start', 'gen_stop', 'siren_far', 'flock', 'm240_load', 'bomber', 'truck', 'rifle', 'wire', 'arty', 'crate'];
const BEDS = ['dusk', 'flag', 'wire_wind', 'wire_creak', 'hangar_rain', 'hangar_room', 'run'];

module.exports = {
  timeout: 240000,
  async run(t) {
    await t.start(3);
    await t.js('(() => { const A = __LB.audio; A.init(); return A.preload(); })()');
    const loaded = await t.get(`(() => { const A = __LB.audio;
      return { ready: A.ready, sfx: ${JSON.stringify(SFX)}.filter((k) => !(A.B[k] && A.B[k].length)), beds: ${JSON.stringify(BEDS)}.filter((k) => !A.bed[k]),
        counts: ${JSON.stringify(SFX)}.map((k) => k + ':' + (A.B[k] || []).length).join(' ') }; })()`);
    t.log(JSON.stringify(loaded));
    t.eq([loaded.sfx, loaded.beds], [[], []], 'every new recording loads');

    // the stand-ins' calls now reach the recordings (none of them may throw)
    const calls = await t.get(`(() => { const G = __LB, A = G.audio, sl = G.env.searchlights[0].spot.position;
      const before = A.voices;
      A.powerDown(); A.powerUp(); A.searchlightOn(sl.x, sl.y, sl.z); A.artyFire(6); A.wireRattle(0, -40, 1); A.wireSnap(10, -60); A.delivery(); A.rifle(-20, -2);
      return { voices: A.voices - before, bomber: A.bomberBuf() === A.B.bomber[0], truckGain: A.truckGain, bomberGain: A.bomberGain };
    })()`);
    t.log(JSON.stringify(calls));
    t.assert(calls.voices >= 9 && calls.bomber, 'the generator, searchlight, battery, wire, crate and rifle play their recordings');

    // live: a quiet stretch of night, then the fifty firing into a crowd
    const meter = (secs, fire) => t.js(`(async () => { const G = __LB, A = G.audio, ctx = A.ctx;
      const mk = (node) => { const a = ctx.createAnalyser(); a.fftSize = 2048; node.connect(a); return a; };
      const am = mk(A.limiter), ab = mk(A.ambBus), buf = new Float32Array(2048);
      const rms = (a) => { a.getFloatTimeDomainData(buf); let s = 0; for (const v of buf) s += v * v; return s / buf.length; };
      G.test.aim(0, -4); G.test.fire(${fire});
      G.test.freeze(false);
      let sm = 0, sb = 0, n = 0; const t0 = performance.now();
      while (performance.now() - t0 < ${secs * 1000}) { await new Promise((r) => setTimeout(r, 40)); sm += rms(am); sb += rms(ab); n++; }
      G.test.fire(false); G.test.freeze(true);
      am.disconnect(); ab.disconnect(); try { A.limiter.disconnect(am); A.ambBus.disconnect(ab); } catch {}
      const db = (v) => +(10 * Math.log10(v / n + 1e-12)).toFixed(1);
      const lv = {}; for (const k of ['flag', 'wire_wind', 'wire_creak', 'run', 'wind', 'rain_far', 'horde_far']) lv[k] = +A.beds[k].level.toFixed(3);
      return JSON.stringify({ master: db(sm), amb: db(sb), beds: lv, runners: +A.runners.toFixed(2) });
    })()`).then(JSON.parse);
    await t.js('__LB.test.spawn(160, -150, -60, 1); __LB.test.spawn(80, -140, -70, 0); __LB.test.advance(2, 1/30, false)');
    const quiet = await meter(4, false);
    t.log('quiet   ' + JSON.stringify(quiet));
    const fire = await meter(4, true);
    t.log('firing  ' + JSON.stringify(fire));
    t.assert(fire.beds.flag < quiet.beds.flag && fire.beds.wire_wind <= quiet.beds.wire_wind, 'the flag and the wire step back under fire');
    t.assert(fire.master - fire.amb > 8, `the beds sit well under the gun (${(fire.master - fire.amb).toFixed(1)} dB)`);
    t.assert(quiet.runners > 0 && quiet.beds.run > 0, 'runners sprinting in are heard');

    // the hangar: inside, the rain on the roof
    const inside = await t.get(`(() => { const A = __LB.audio; A.inside = true; A.updateBeds(0.1); A.updateBeds(0.1);
      const r = { rain: A.beds.hangar_rain.level, room: A.beds.hangar_room.level, outRain: A.beds.rain_far.level, flag: A.beds.flag.level };
      A.inside = false; return r; })()`);
    t.log(JSON.stringify(inside));
    t.assert(inside.rain > 0 && inside.room > 0 && inside.outRain === 0 && inside.flag === 0, 'the hangar swaps the valley for the roof');
  },
};
