// The game boots to the menu with its sound and every radio line voiced.
module.exports = {
  async run(t) {
    t.eq(await t.get('__LB.state'), 'menu', 'boots to the main menu');
    await t.js('__LB.audio.loaded'); // all one-shots, beds and voice takes decoded
    const a = await t.get(`(() => {
      const A = __LB.audio, lines = __LB.test.radioLines();
      return {
        lines: lines.length,
        missing: lines.filter(([w, txt]) => !A.voices_[w + '|' + txt]).map(([w, txt]) => w + ': ' + txt.slice(0, 40)),
        sfxLoaded: Object.values(A.B).filter((v) => v.length).length,
        beds: Object.keys(A.bed).length,
      };
    })()`);
    t.log(`${a.lines} radio lines, ${a.sfxLoaded} sound groups, ${a.beds} beds`);
    t.eq(a.missing, [], 'every radio line has a voice take (run scripts/audio/build_voice.py)');
    t.assert(a.sfxLoaded >= 40, `sound effects loaded (${a.sfxLoaded})`);
    t.assert(a.beds >= 14, `ambience beds loaded (${a.beds})`);
  },
};
