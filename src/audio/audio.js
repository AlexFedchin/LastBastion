// ─────────────────────────────────────────────────────────────────────────────
//  Sound engine.
//
//  Real recordings (app/audio, built by scripts/audio/build_audio.py — see
//  app/audio/CREDITS.md) played through one mix:
//
//    one-shots ─┬──────────────────────┐
//    reverb ────┤ (valley IR)          ├─ sfx ─ muffle ─ deafen ─ glue comp ─┐
//    beds ── ambDuck ─────────────────┘                                    ├─ master ─ limiter ─ out
//    score (streamed) ── musicDuck ── musicTone ───────────────────────────┘
//
//  The score is adaptive: a drone bed holds the night, a percussion layer
//  rises with the pressure on the wall and the tide brings in the drums.
// ─────────────────────────────────────────────────────────────────────────────
import { clamp, rand } from '../core/util.js';
import { makePunch, makeSizzle, makeTick, makeBlastSub, makeProp, makeJet } from './synth.js';

// name -> [variants (0 = single file), decode rate]
const SFX = {
  hmg: [4, 44100], hmg_tail: [2, 32000], mg: [5, 32000], casing: [6, 44100],
  boom: [5, 44100], boom_far: [3, 22050], boom_sub: [0, 22050], mortar: [3, 44100], incoming: [4, 32000],
  napalm: [0, 44100], flesh: [5, 32000], headshot: [3, 32000], gib: [4, 32000], bloater: [0, 32000],
  acid: [0, 32000], bodyfall: [0, 32000], groan: [27, 32000], brute: [5, 32000], shriek: [3, 32000],
  death: [4, 32000], thunder: [7, 22050], siren: [0, 32000], klaxon: [0, 32000], radio_in: [0, 22050],
  radio_out: [2, 22050], latch: [0, 44100], barrel_seat: [0, 44100], charge: [0, 44100], steam: [0, 32000],
  steam_long: [0, 32000], ui_click: [0, 44100], ui_hover: [0, 44100], ui_buy: [0, 44100],
  flare_launch: [0, 44100], flare_ignite: [0, 32000], throw: [2, 32000], heartbeat: [0, 22050],
  tinnitus: [0, 32000], crow: [5, 32000], bell: [0, 32000], dog: [3, 22050], distant_mg: [4, 22050],
};
const BEDS = {
  rain_far: 32000, rain_near: 32000, wind: 32000, wind_howl: 32000, fire_roar: 32000, fire_crackle: 32000,
  horde_far: 32000, horde_mid: 32000, horde_near: 32000, horde_surge: 32000, shuffle: 32000, war: 22050,
  dawn: 32000, flies: 32000, lamp: 32000, radio_static: 22050,
};
const HORDE_BEDS = ['horde_far', 'horde_mid', 'horde_near', 'horde_surge', 'shuffle'];
// score: file -> loops?
const SCORE = {
  menu: true, night_bed_1: true, night_bed_2: true, pressure_1: true, pressure_2: true, tide: true,
  dawn: false, resupply: true, fallen: true, victory: true,
};

async function readBytes(rel) {
  if (window.bastion && window.bastion.readAsset) {
    const u8 = await window.bastion.readAsset(rel);
    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  }
  const r = await fetch(rel);
  if (!r.ok) throw new Error(`${rel}: HTTP ${r.status}`);
  return r.arrayBuffer();
}

async function pool(items, n, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

// mix snapshots: how far the world's sound sits back in each part of the game
const SNAP = { menu: 0.4, night: 1, dawn: 0.85, gameover: 0.75, victory: 0.6 };
const MUSIC_TRIM = 1.8; // the score is mastered quiet; sit it against the guns
const OUTPUT_TRIM = 0.8; // ~-16 LUFS through a heavy night at default volume

const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ── streamed score track ─────────────────────────────────────────────────────
class Track {
  constructor(engine, name, loop) {
    this.e = engine; this.name = name; this.loop = loop;
    this.el = null; this.gain = null; this.loading = null;
    this.target = 0; this.idle = 0;
  }

  ensure() {
    if (!this.loading) {
      this.loading = readBytes(`audio/music/${this.name}.ogg`).then((ab) => {
        const ctx = this.e.ctx;
        const el = new Audio();
        el.src = URL.createObjectURL(new Blob([ab], { type: 'audio/ogg' }));
        el.loop = this.loop;
        el.preload = 'auto';
        const g = ctx.createGain(); g.gain.value = 0;
        ctx.createMediaElementSource(el).connect(g);
        g.connect(this.e.musicIn);
        this.el = el; this.gain = g;
      }).catch((err) => console.warn('[audio] music', this.name, err));
    }
    return this.loading;
  }

  /** Fade to a level over ~tc*3 seconds; starts playback as needed. */
  set(level, tc = 2, restart = false) {
    this.target = level;
    if (!this.el) { if (level > 0) this.ensure().then(() => this.el && this.set(this.target, tc, restart)); return; }
    const t = this.e.ctx.currentTime;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setTargetAtTime(level, t, tc);
    if (level > 0.001 && (this.el.paused || this.el.ended)) {
      if (restart || this.el.ended) this.el.currentTime = 0;
      this.el.play().catch(() => { /* autoplay blocked until a gesture */ });
    }
  }

  get ended() { return !!this.el && this.el.ended; }
  get remaining() { return this.el && isFinite(this.el.duration) ? this.el.duration - this.el.currentTime : 99; }

  tick(dt) {
    // park silent tracks so they stop decoding; they resume where they left off
    if (this.el && !this.el.paused && this.target <= 0.001) {
      this.idle += dt;
      if (this.idle > 10) { this.el.pause(); this.idle = 0; }
    } else this.idle = 0;
  }
}

// ── looping ambience bed ─────────────────────────────────────────────────────
class Bed {
  constructor(engine, name, out) {
    this.e = engine; this.name = name; this.out = out;
    this.src = null; this.gain = null; this.level = 0; this.idle = 0;
  }

  set(level, tc) {
    const e = this.e, ctx = e.ctx;
    const buf = e.bed[this.name];
    if (!buf) return;
    if (Math.abs(level - this.level) < 0.003 && (this.src || level <= 0.001)) return;
    this.level = level;
    if (!this.src) {
      if (level <= 0.001) return;
      this.gain = ctx.createGain(); this.gain.gain.value = 0;
      this.src = ctx.createBufferSource();
      this.src.buffer = buf; this.src.loop = true;
      this.src.connect(this.gain); this.gain.connect(this.out);
      this.src.start(0, Math.random() * buf.duration);
    }
    this.gain.gain.setTargetAtTime(level, ctx.currentTime, tc);
  }

  tick(dt) {
    if (this.src && this.level <= 0.001) {
      this.idle += dt;
      if (this.idle > 6) {
        try { this.src.stop(); this.src.disconnect(); this.gain.disconnect(); } catch { /* already gone */ }
        this.src = null; this.idle = 0;
      }
    } else this.idle = 0;
  }
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.voices = 0;
    this.maxVoices = 96;
    this.listenerYaw = 0;
    this.listenerX = 0; this.listenerZ = 0; this.listenerY = 13.2;
    this.settings = { master: 0.8, music: 0.55, sfx: 0.9 };
    this.B = {};       // one-shots: name -> AudioBuffer[]
    for (const k of Object.keys(SFX)) this.B[k] = [];
    this.bed = {};     // beds: name -> AudioBuffer
    this.loaded = null;
    this._last = {};   // no-immediate-repeat memory
    this._active = {}; // per-category voice counts

    // game state the mix follows (written by the game every frame)
    this.intensity = 0;   // 0..1 overall pressure
    this.pressure = 0;    // 0..1 worst pile on the wall
    this.hordeAlive = 0;
    this.dawn = 0;        // 0 night .. 1 day
    this.napalmLevel = 0;
    this.night = 1;
    this.tide = false;
    this.lowLife = false;

    this.musicMode = 'menu';
    this._mi = 0;         // smoothed music intensity
    this._tideOn = false;
    this._hmgLast = 0; this._hmgCount = 0;
    this._lastHitSound = 0;
    this._radioUntil = 0;
    this._gust = 0.4; this._gustV = 0;
    this._bedT = 0;
    this._nextBeat = 0;
    this._crowT = 6; this._dogT = 40; this._bellDone = false; this._bellT = 0;
    this._earT = 0;
    this._cool = [];      // barrel cool-down voices (cut when firing resumes)
    this._loops = new Set();
  }

  // ── loading ────────────────────────────────────────────────────────────────
  /** Fetch and decode every one-shot and bed. Safe to call before init(). */
  preload() {
    if (this.loaded) return this.loaded;
    const Off = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!Off) return (this.loaded = Promise.resolve());
    const dec = {};
    const decoder = (rate) => (dec[rate] = dec[rate] || new Off(2, 1, rate));
    const jobs = [];
    for (const [name, [n, rate]] of Object.entries(SFX)) {
      const files = n ? Array.from({ length: n }, (_, i) => `${name}_${i + 1}`) : [name];
      files.forEach((f, i) => jobs.push({ rel: `audio/sfx/${f}.ogg`, rate, put: (b) => { this.B[name][i] = b; } }));
    }
    for (const [name, rate] of Object.entries(BEDS)) {
      jobs.push({ rel: `audio/amb/${name}.ogg`, rate, put: (b) => { this.bed[name] = b; } });
    }
    let failed = 0;
    this.loaded = pool(jobs, 8, async (j) => {
      try { j.put(await decoder(j.rate).decodeAudioData(await readBytes(j.rel))); } catch (err) {
        if (failed++ < 3) console.warn('[audio] could not load', j.rel, err);
      }
    }).then(() => {
      for (const k of Object.keys(this.B)) this.B[k] = this.B[k].filter(Boolean);
      if (failed) console.warn(`[audio] ${failed} sound files missing`);
    });
    return this.loaded;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.preload();

    // output: master volume into a safety limiter
    this.master = ctx.createGain(); this.master.gain.value = this.settings.master * OUTPUT_TRIM;
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -2; this.limiter.knee.value = 0; this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002; this.limiter.release.value = 0.12;
    this.master.connect(this.limiter); this.limiter.connect(ctx.destination);

    // effects: glue compression, ear damage, pause muffling
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -12; this.comp.knee.value = 10; this.comp.ratio.value = 3;
    this.comp.attack.value = 0.004; this.comp.release.value = 0.25;
    this.comp.connect(this.master);
    this.deafen = ctx.createBiquadFilter(); this.deafen.type = 'lowpass'; this.deafen.frequency.value = 20000; this.deafen.Q.value = 0.4;
    this.deafen.connect(this.comp);
    this.muffle = ctx.createBiquadFilter(); this.muffle.type = 'lowpass'; this.muffle.frequency.value = 20000; this.muffle.Q.value = 0.5;
    this.muffle.connect(this.deafen);
    this.snap = ctx.createGain(); this.snap.gain.value = SNAP[this.musicMode] ?? 1;
    this.snap.connect(this.muffle);
    this.sfx = ctx.createGain(); this.sfx.gain.value = this.settings.sfx;
    this.sfx.connect(this.snap);

    // the valley answers every shot
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeValleyIR(3.4);
    this.reverb.connect(this.sfx);
    this.reverbSend = ctx.createGain(); this.reverbSend.gain.value = 0.55;
    this.reverbSend.connect(this.reverb);

    // ambience beds (ducked by close blasts); horde and the city sit in front
    this.ambDuck = ctx.createGain(); this.ambDuck.connect(this.sfx);
    this.ambBus = ctx.createGain(); this.ambBus.connect(this.ambDuck);
    this.frontPan = ctx.createStereoPanner(); this.frontPan.connect(this.ambBus);
    this.beds = {};
    for (const name of Object.keys(BEDS)) {
      const out = HORDE_BEDS.includes(name) || name === 'war' ? this.frontPan : this.ambBus;
      this.beds[name] = new Bed(this, name, out);
    }

    // score
    this.music = ctx.createGain(); this.music.gain.value = this.settings.music * MUSIC_TRIM;
    this.musicDuck = ctx.createGain();
    this.musicTone = ctx.createBiquadFilter(); this.musicTone.type = 'lowpass'; this.musicTone.frequency.value = 20000; this.musicTone.Q.value = 0.5;
    this.musicIn = this.music;
    this.music.connect(this.musicDuck); this.musicDuck.connect(this.musicTone); this.musicTone.connect(this.master);
    this.tracks = {};
    for (const [name, loop] of Object.entries(SCORE)) this.tracks[name] = new Track(this, name, loop);

    // the M2: its own heavy chain — low-end shelf, chest and bite EQ, tape-style
    // saturation and a fast compressor that keeps every round hitting hard
    this.hmgIn = ctx.createGain(); this.hmgIn.gain.value = 1;
    const shelf = ctx.createBiquadFilter(); shelf.type = 'lowshelf'; shelf.frequency.value = 120; shelf.gain.value = 7;
    const chest = ctx.createBiquadFilter(); chest.type = 'peaking'; chest.frequency.value = 230; chest.Q.value = 0.9; chest.gain.value = 3;
    const mud = ctx.createBiquadFilter(); mud.type = 'peaking'; mud.frequency.value = 600; mud.Q.value = 1.2; mud.gain.value = -2.5;
    const bite = ctx.createBiquadFilter(); bite.type = 'peaking'; bite.frequency.value = 3200; bite.Q.value = 0.8; bite.gain.value = 3;
    const drive = ctx.createGain(); drive.gain.value = 1.15;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) { const x = i / (curve.length - 1) * 2 - 1; curve[i] = Math.tanh(x * 2.4) / Math.tanh(2.4); }
    shaper.curve = curve; shaper.oversample = '4x';
    const hcomp = ctx.createDynamicsCompressor();
    hcomp.threshold.value = -16; hcomp.knee.value = 6; hcomp.ratio.value = 4; hcomp.attack.value = 0.003; hcomp.release.value = 0.08;
    const hout = ctx.createGain(); hout.gain.value = 0.6;
    this.hmgIn.connect(shelf); shelf.connect(chest); chest.connect(mud); mud.connect(bite); bite.connect(drive);
    drive.connect(shaper); shaper.connect(hcomp); hcomp.connect(hout); hout.connect(this.sfx);
    const hrev = ctx.createGain(); hrev.gain.value = 0.3; hout.connect(hrev); hrev.connect(this.reverbSend);

    // synthesized layers
    try {
      this.B.punch = [1, 2, 3, 4].map((k) => makePunch(ctx, k));
      this.B.sizzle = [makeSizzle(ctx)];
      this.B.tick = [1, 2, 3, 4, 5, 6].map((k) => makeTick(ctx, k));
      this.B.blast_sub = [makeBlastSub(ctx)];
      this.B.prop = [makeProp(ctx)];
      this.B.jet = [makeJet(ctx)];
    } catch (err) { console.warn('[audio] synth', err); }

    this.ready = true;
    this.setMusicMode(this.musicMode, true);
  }

  applySettings(s) {
    Object.assign(this.settings, s);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.settings.master * OUTPUT_TRIM, t, 0.05);
    this.music.gain.setTargetAtTime(this.settings.music * MUSIC_TRIM, t, 0.05);
    this.sfx.gain.setTargetAtTime(this.settings.sfx, t, 0.05);
  }

  /** Outdoor impulse response: the wall and bunker up close, the valley sides
   *  throwing slapbacks, then a long dark tail as the sound rolls off the hills. */
  makeValleyIR(seconds) {
    const ctx = this.ctx, sr = ctx.sampleRate, len = Math.floor(seconds * sr);
    const buf = ctx.createBuffer(2, len, sr);
    const taps = [
      [[0.017, 0.5], [0.044, 0.34], [0.088, 0.22], [0.29, 0.4], [0.61, 0.24], [1.04, 0.13], [1.62, 0.07]],
      [[0.024, 0.46], [0.053, 0.3], [0.101, 0.2], [0.36, 0.38], [0.73, 0.21], [1.19, 0.11], [1.85, 0.06]],
    ];
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      let lp = 0, lp2 = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const env = Math.exp(-t * 2.1) * Math.min(1, t / 0.03) * (0.75 + 0.25 * Math.sin(t * 3.7 + c * 1.9));
        const a = 0.7 * Math.exp(-t * 1.6) + 0.03; // air absorption: the tail darkens
        lp += a * (Math.random() * 2 - 1 - lp);
        lp2 += a * (lp - lp2);
        d[i] = lp2 * env * 0.5;
      }
      for (const [tt, amp] of taps[c]) {
        const i0 = Math.floor(tt * sr), n = Math.floor(0.02 * sr * (1 + tt * 1.5));
        const a = 0.55 * Math.exp(-tt * 1.8) + 0.05;
        let s = 0;
        for (let k = 0; k < n && i0 + k < len; k++) {
          s += a * (Math.random() * 2 - 1 - s);
          d[i0 + k] += s * amp * 2.2 * Math.exp(-k / (n * 0.3));
        }
      }
    }
    return buf;
  }

  // ── core player ────────────────────────────────────────────────────────────
  /** A variant of a sound, never the same one twice in a row. */
  pickVar(name) {
    const L = this.B[name];
    if (!L || !L.length) return null;
    if (L.length === 1) return L[0];
    let i = (Math.random() * L.length) | 0;
    if (i === this._last[name]) i = (i + 1 + ((Math.random() * (L.length - 1)) | 0)) % L.length;
    this._last[name] = i;
    return L[i];
  }

  /**
   * @param {AudioBuffer} buf
   * @param {object} o gain, rate, pan, delay, offset, duration, lowpass, reverb, x, z (world pos: pan,
   *   distance, air absorption), ref (distance scale), sos (speed-of-sound delay), force, key+max
   *   (per-category voice cap), fadeIn/fadeOut (s, for slices of longer files), bus ('amb')
   */
  play(buf, o = {}) {
    if (!this.ready || !buf) return null;
    if (this.voices >= this.maxVoices && !o.force) return null;
    if (o.key && (this._active[o.key] || 0) >= (o.max || 8)) return null;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const rate = o.rate ?? 1;
    src.playbackRate.value = rate;
    let gain = o.gain ?? 1;
    let pan = o.pan ?? 0;
    let delay = o.delay ?? 0;
    let lpf = o.lowpass ?? 0;
    if (o.x !== undefined) {
      const dx = o.x - this.listenerX, dz = o.z - this.listenerZ;
      const dy = o.y !== undefined ? o.y - this.listenerY : 0;
      const dist = Math.sqrt(dx * dx + dz * dz + dy * dy);
      const az = Math.atan2(dx, -dz) - this.listenerYaw;
      pan = clamp(Math.sin(az) * 0.85, -0.95, 0.95);
      gain *= 1 / (1 + dist / (o.ref ?? 40));
      if (o.sos) delay += dist / 343;
      if (!lpf) lpf = clamp(22000 * Math.exp(-dist / 160), 900, 20000);
    }
    let node = src;
    if (lpf && lpf < 19000) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = lpf;
      node.connect(f); node = f;
    }
    const g = ctx.createGain();
    const t0 = ctx.currentTime + delay;
    if (o.fadeIn || o.fadeOut) {
      const len = (o.duration ?? buf.duration - (o.offset ?? 0)) / rate;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(gain, t0 + (o.fadeIn || 0.005));
      g.gain.setValueAtTime(gain, Math.max(t0 + (o.fadeIn || 0.005), t0 + len - (o.fadeOut || 0.005)));
      g.gain.linearRampToValueAtTime(0, t0 + len);
    } else g.gain.value = gain;
    node.connect(g);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    g.connect(p);
    p.connect(o.bus === 'amb' ? this.ambBus : o.bus === 'hmg' ? this.hmgIn : this.sfx);
    if (o.reverb) {
      const rs = ctx.createGain(); rs.gain.value = o.reverb;
      p.connect(rs); rs.connect(this.reverbSend);
    }
    this.voices++;
    if (o.key) this._active[o.key] = (this._active[o.key] || 0) + 1;
    src.onended = () => {
      this.voices--;
      if (o.key) this._active[o.key]--;
      try { p.disconnect(); } catch { /* noop */ }
    };
    src.start(t0, o.offset ?? 0, o.duration);
    return { src, gain: g };
  }

  setListener(x, z, yaw, y) { this.listenerX = x; this.listenerZ = z; this.listenerYaw = yaw; if (y !== undefined) this.listenerY = y; }

  /**
   * A looping, moving sound source (aircraft). Returns a handle:
   * update(x, y, z, vx, vy, vz, level) once per frame, stop() to fade it out.
   */
  loop(buf, { ref = 120, reverb = 0.25, rate = 1 } = {}) {
    if (!this.ready || !buf) return null;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf; src.loop = true; src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2000; f.Q.value = 0.6;
    const g = ctx.createGain(); g.gain.value = 0;
    const p = ctx.createStereoPanner();
    src.connect(f); f.connect(g); g.connect(p); p.connect(this.sfx);
    const rs = ctx.createGain(); rs.gain.value = reverb; p.connect(rs); rs.connect(this.reverbSend);
    src.start(0, Math.random() * buf.duration);
    const e = this;
    const h = {
      dead: false,
      update(x, y, z, vx, vy, vz, level = 1) {
        if (h.dead) return;
        const t = ctx.currentTime;
        const dx = x - e.listenerX, dy = y - e.listenerY, dz = z - e.listenerZ;
        const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy + dz * dz));
        const az = Math.atan2(dx, -dz) - e.listenerYaw;
        const vr = (vx * dx + vy * dy + vz * dz) / dist; // + receding
        const dop = clamp(343 / (343 + vr), 0.7, 1.4);
        g.gain.setTargetAtTime(level / (1 + dist / ref), t, 0.06);
        p.pan.setTargetAtTime(clamp(Math.sin(az) * 0.85, -0.95, 0.95), t, 0.06);
        f.frequency.setTargetAtTime(clamp(26000 * Math.exp(-dist / 210), 380, 20000), t, 0.08);
        src.playbackRate.setTargetAtTime(rate * dop, t, 0.08);
      },
      stop(fade = 1.5) {
        if (h.dead) return;
        h.dead = true;
        e._loops.delete(h);
        const t = ctx.currentTime;
        g.gain.cancelScheduledValues(t);
        g.gain.setTargetAtTime(0, t, fade / 4);
        try { src.stop(t + fade + 0.1); } catch { /* gone */ }
        src.onended = () => { try { p.disconnect(); rs.disconnect(); } catch { /* noop */ } };
      },
    };
    this._loops.add(h);
    return h;
  }

  setMuffle(amount) {
    if (!this.ctx) return;
    const f = 20000 * Math.pow(0.03, amount);
    this.muffle.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.05);
    this.musicTone.frequency.setTargetAtTime(20000 * Math.pow(0.12, amount), this.ctx.currentTime, 0.08);
  }

  /** Pull the beds and the score down for a moment (a blast up close). */
  duck(amount, hold = 0.15, recover = 0.6) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    for (const g of [this.ambDuck.gain, this.musicDuck.gain]) {
      g.cancelScheduledValues(t);
      g.setTargetAtTime(1 - amount, t, 0.015);
      g.setTargetAtTime(1, t + hold, recover);
    }
  }

  /** Ears ringing after a very close blast. */
  ringEars(strength = 1) {
    if (!this.ready || this._earT > 0) return;
    this._earT = 9;
    const t = this.ctx.currentTime;
    const f = this.deafen.frequency;
    f.cancelScheduledValues(t);
    f.setTargetAtTime(700 + 900 * (1 - strength), t, 0.02);
    f.setTargetAtTime(20000, t + 0.6, 1.1);
    this.play(this.B.tinnitus[0], { gain: 0.16 * strength, force: true });
    this.duck(0.55 * strength, 0.5, 1.2);
  }

  // ── the gun ────────────────────────────────────────────────────────────────
  hmg() {
    if (!this.ready) return;
    const pan = rand(-0.04, 0.04);
    // recorded report, pitched a touch down for weight, through the heavy chain
    this.play(this.pickVar('hmg'), { gain: 0.5, rate: rand(0.86, 0.93), pan, reverb: 0.2, bus: 'hmg', force: true });
    // the punch: sub kick, blast, crack and the bolt
    this.play(this.pickVar('punch'), { gain: 0.62, rate: rand(0.94, 1.04), pan, bus: 'hmg', force: true });
    this._hmgLast = this.ctx.currentTime;
    this._hmgCount++;
  }

  /** Steel cooling down after a burst: hiss, spitting and contraction pings. */
  barrelCool(heat) {
    if (!this.ready) return;
    this.stopCool(0.01);
    const h = clamp(heat, 0, 1);
    if (h < 0.18) return;
    const dur = 1.0 + h * 4.6;
    const v = this._cool;
    const sz = this.B.sizzle && this.B.sizzle[0];
    if (sz) v.push(this.play(sz, { gain: 0.03 + 0.26 * h * h, rate: rand(0.95, 1.06), pan: 0.06, duration: Math.min(sz.duration, dur), fadeIn: 0.06, fadeOut: Math.min(2, dur * 0.55), force: true }));
    if (h > 0.5) {
      const st = this.B.steam_long[0];
      if (st) v.push(this.play(st, { gain: 0.1 * h, rate: rand(0.8, 0.9), pan: 0.1, lowpass: 3800, duration: Math.min(st.duration * 0.9, dur * 0.8), fadeIn: 0.25, fadeOut: 1.2, delay: 0.08, force: true }));
    }
    const n = Math.round(3 + h * 13);
    let t = rand(0.12, 0.3);
    for (let k = 0; k < n; k++) {
      v.push(this.play(this.pickVar('tick'), { gain: rand(0.04, 0.11) * (0.45 + h * 0.7), rate: rand(0.85, 1.2), pan: rand(-0.15, 0.25), delay: t, reverb: 0.06, force: true }));
      t += rand(0.06, 0.26) * (1 + k * 0.3);
      if (t > dur + 1) break;
    }
  }

  /** Firing again: cut the cool-down. */
  stopCool(fade = 0.04) {
    if (!this._cool.length) return;
    const t = this.ctx.currentTime;
    for (const v of this._cool) {
      if (!v) continue;
      try {
        v.gain.gain.cancelScheduledValues(t);
        v.gain.gain.setTargetAtTime(0, t, fade);
        v.src.stop(t + fade * 5 + 0.02);
      } catch { /* already stopped */ }
    }
    this._cool.length = 0;
  }

  casing() {
    if (Math.random() < 0.55) {
      this.play(this.pickVar('casing'), { gain: 0.07, rate: rand(0.88, 1.15), pan: rand(0.25, 0.6), delay: rand(0.28, 0.55), key: 'casing', max: 5 });
    }
  }

  barrelSwap(swapTime = 2) {
    const B = this.B;
    this.play(B.latch[0], { gain: 0.55, pan: 0.15, force: true });
    this.play(B.steam[0], { gain: 0.3, rate: 1.1, pan: 0.2, delay: 0.14, force: true });
    this.play(B.barrel_seat[0], { gain: 0.55, pan: 0.1, delay: swapTime * 0.55, force: true });
    this.play(B.charge[0], { gain: 0.6, pan: 0.18, delay: Math.max(0.25, swapTime * 0.82), force: true });
  }

  overheat() {
    this.play(this.B.steam[0], { gain: 0.5, force: true });
    this.play(this.B.steam_long[0], { gain: 0.45, delay: 0.25, force: true });
  }

  wallGun(x, z) { this.play(this.pickVar('mg'), { gain: 0.3, rate: rand(0.94, 1.08), x, z, ref: 25, reverb: 0.45, key: 'mg', max: 10 }); }

  // ── ordnance ───────────────────────────────────────────────────────────────
  explosion(x, z, size = 1) {
    if (!this.ready) return;
    const dx = x - this.listenerX, dz = z - this.listenerZ;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const g = Math.min(1.7, 0.7 + size * 0.45);
    const rate = rand(0.9, 1.06) / Math.sqrt(Math.max(0.6, size));
    if (dist < 170) this.play(this.pickVar('boom'), { gain: 1.25 * g, rate, x, z, ref: 70, sos: true, reverb: 0.5, force: true });
    else this.play(this.pickVar('boom_far'), { gain: 1.3 * g, rate, x, z, ref: 90, sos: true, reverb: 0.6, force: true });
    if (size >= 1.2) this.play(this.B.boom_sub[0], { gain: 0.9 * g, rate: rand(0.9, 1.1), x, z, ref: 90, sos: true, force: true });
    if (dist < 60) this.duck(clamp(0.5 * size * (1 - dist / 60), 0, 0.6), 0.2, 0.7);
    if (dist < 24 && size >= 1.2) this.ringEars(clamp(1.2 - dist / 30, 0.4, 1));
  }

  /** Incoming shell: the rush of air ends on impact. */
  whistle(x, z, flight) {
    const buf = this.pickVar('incoming');
    if (!buf) return;
    const rate = rand(0.94, 1.06), dur = buf.duration / rate;
    this.play(buf, { gain: 0.5, rate, x, z, ref: 80, delay: Math.max(0, flight - dur), offset: Math.max(0, dur - flight) * rate, reverb: 0.2, force: true });
  }

  mortarLaunch() { this.play(this.pickVar('mortar'), { gain: 0.5, rate: rand(0.95, 1.05), x: rand(-4, 4), z: 22, ref: 30, reverb: 0.55, force: true }); }

  napalm(x, z) { this.play(this.B.napalm[0], { gain: 1.0, x, z, ref: 40, reverb: 0.4, force: true }); }

  /** A burst of crackle somewhere along the burning ditch. */
  crackle(x, z, gain = 0.3) {
    const buf = this.bed.fire_crackle;
    if (!buf) return;
    const d = rand(1.2, 2.2);
    this.play(buf, { gain: gain * 1.6, rate: rand(0.85, 1.15), x, z, ref: 40, offset: rand(0, buf.duration - d - 0.1), duration: d, fadeIn: 0.15, fadeOut: 0.5, key: 'crackle', max: 4 });
  }

  flare() {
    this.play(this.B.flare_launch[0], { gain: 0.55, reverb: 0.4, force: true });
    this.play(this.B.flare_ignite[0], { gain: 0.22, delay: 2.3, lowpass: 7000, pan: rand(-0.3, 0.3), reverb: 0.6, force: true });
  }

  /** Heavy bomb: the crack, the sub-bass punch through the ground, the valley rolling it back. */
  bigBlast(x, z) {
    if (!this.ready) return;
    const dist = Math.hypot(x - this.listenerX, z - this.listenerZ);
    const B = this.B;
    const o = { x, z, ref: 220, sos: true, force: true };
    this.play(this.pickVar('boom'), { ...o, gain: 1.9, rate: rand(0.6, 0.66), reverb: 0.7 });
    this.play(this.pickVar('boom'), { ...o, gain: 1.4, rate: rand(0.46, 0.5), delay: 0.03, reverb: 0.5 });
    if (B.boom_sub[0]) this.play(B.boom_sub[0], { ...o, gain: 1.8, rate: 0.72 });
    if (B.blast_sub) this.play(B.blast_sub[0], { ...o, gain: 1.9, lowpass: 19500 });
    this.play(this.pickVar('boom_far'), { ...o, gain: 1.2, rate: 0.55, delay: 0.35, reverb: 0.9 });
    this.play(this.pickVar('thunder'), { ...o, gain: 0.9, rate: 0.72, delay: 0.5, reverb: 0.5, lowpass: 2500 });
    // clods and rock raining back down
    for (let k = 0; k < 4; k++) this.play(this.pickVar('gib'), { x: x + rand(-15, 15), z: z + rand(-15, 15), ref: 60, gain: 0.25, rate: rand(0.45, 0.6), sos: true, delay: rand(2.2, 4.2), force: true });
    const close = clamp(1 - dist / 260, 0, 1);
    this.duck(0.5 + 0.4 * close, 0.4 + dist / 343, 1.8);
    if (dist < 150) setTimeout(() => this.ringEars(clamp(1.25 - dist / 160, 0.35, 1)), (dist / 343) * 1000);
  }

  /** Falling bomb: a long, deep shriek that ends on impact. */
  bombWhistle(x, z, flight) {
    const buf = this.pickVar('incoming');
    if (!buf) return;
    const rate = 0.7, dur = buf.duration / rate;
    this.play(buf, { gain: 0.95, rate, x, z, ref: 140, delay: Math.max(0, flight - dur), offset: Math.max(0, dur - flight) * rate, reverb: 0.3, force: true });
  }

  /** A gunship weapon report, heard from the aircraft after the light arrives. */
  gunshipShot(kind, x, y, z) {
    if (!this.ready) return;
    const o = { x, y, z, sos: true, reverb: 0.55 };
    if (kind === 25) this.play(this.pickVar('hmg'), { ...o, gain: 0.55, rate: rand(0.66, 0.74), ref: 140, lowpass: 2600, key: 'gs25', max: 16 });
    else if (kind === 40) {
      this.play(this.pickVar('mortar'), { ...o, gain: 1.2, rate: rand(1.15, 1.3), ref: 160, force: true });
      this.play(this.pickVar('boom_far'), { ...o, gain: 0.7, rate: rand(1.0, 1.15), ref: 160, lowpass: 1800, force: true });
    } else {
      this.play(this.pickVar('boom'), { ...o, gain: 1.3, rate: rand(0.78, 0.86), ref: 180, lowpass: 1500, force: true });
      if (this.B.boom_sub[0]) this.play(this.B.boom_sub[0], { ...o, gain: 1.0, ref: 180, force: true });
    }
  }

  /** 25 mm HE rounds bursting in the field. */
  gunshipImpact(x, z) {
    this.play(this.pickVar('boom'), { gain: 0.32, rate: rand(1.7, 2.2), x, z, ref: 50, sos: true, reverb: 0.25, key: 'gsi', max: 7 });
  }

  /** Marker flare popping on the ground. */
  markerIgnite(x, z) {
    this.play(this.B.flare_ignite[0], { gain: 0.6, x, z, ref: 40, reverb: 0.5, force: true });
  }

  throwGrenade() { this.play(this.pickVar('throw'), { gain: 0.5, rate: rand(0.9, 1.1), pan: rand(-0.1, 0.2), force: true }); }

  // ── bodies ─────────────────────────────────────────────────────────────────
  flesh(x, z, headshot = false) {
    const now = this.ctx ? this.ctx.currentTime : 0;
    if (now - this._lastHitSound < 0.035) return;
    this._lastHitSound = now;
    if (headshot) this.play(this.pickVar('headshot'), { gain: 0.6, rate: rand(0.9, 1.1), x, z, ref: 35, key: 'flesh', max: 6 });
    else this.play(this.pickVar('flesh'), { gain: 0.5, rate: rand(0.82, 1.18), x, z, ref: 30, key: 'flesh', max: 6 });
  }

  gib(x, z, gain = 0.55) { this.play(this.pickVar('gib'), { gain, rate: rand(0.8, 1.15), x, z, ref: 40, reverb: 0.15, key: 'gib', max: 4 }); }
  bloater(x, z) { this.play(this.B.bloater[0], { gain: 0.8, rate: rand(0.85, 1.05), x, z, ref: 40, reverb: 0.25, force: true }); }
  acid(x, z) { this.play(this.B.acid[0], { gain: 0.7, x, z, ref: 30, reverb: 0.2, force: true }); }
  bodyfall(x, z) { this.play(this.B.bodyfall[0], { gain: 0.6, rate: rand(0.75, 0.9), x, z, ref: 30, delay: rand(0.25, 0.45) }); }

  /** One of them, out in the dark. type: 0 shambler, 1 runner, 2 brute, 3 bloater */
  groan(x, z, type = 0) {
    if (!this.ready || this.voices > this.maxVoices - 10) return;
    if (type === true) type = 2;
    let name = 'groan', rate = rand(0.86, 1.08), gain = 0.4;
    if (type === 2) { name = 'brute'; rate = rand(0.76, 0.94); gain = 0.6; }
    else if (type === 1 && Math.random() < 0.4) { name = 'shriek'; rate = rand(0.94, 1.12); gain = 0.34; }
    else if (type === 3) { rate = rand(0.68, 0.8); gain = 0.44; }
    this.play(this.pickVar(name), { gain, rate, x, z, ref: 16, reverb: 0.3, key: 'voice', max: 9 });
  }

  /** One of them got over the wall. */
  scream(x, z) {
    if (!this.ready) return;
    this.play(this.pickVar('shriek'), { gain: 0.5, rate: rand(0.85, 0.95), x, z, ref: 25, reverb: 0.4, force: true });
    this.play(this.pickVar('death'), { gain: 0.75, rate: rand(0.95, 1.05), x, z, ref: 25, delay: 0.12, reverb: 0.5, force: true });
    this.play(this.pickVar('gib'), { gain: 0.35, x, z, ref: 25, delay: 0.35, force: true });
  }

  // ── base, radio, UI ────────────────────────────────────────────────────────
  /** The base siren winds up for a surge. */
  horn() { this.play(this.B.siren[0], { gain: 0.5, rate: rand(0.97, 1.03), pan: rand(-0.25, 0.25), reverb: 0.7, force: true }); }
  klaxon() {
    const now = this.ctx ? this.ctx.currentTime : 0;
    if (now - (this._klaxonT ?? -9) < 4) return; // ten wall sections, one alarm
    this._klaxonT = now;
    this.play(this.B.klaxon[0], { gain: 0.32, pan: rand(-0.2, 0.2), reverb: 0.25, force: true });
  }

  /** Squelch in, a hiss of carrier while the message runs, squelch out. */
  radioStatic(dur = 0.4) {
    if (!this.ready) return;
    this.play(this.B.radio_in[0], { gain: 0.32, pan: -0.25, force: true });
    const end = this.ctx.currentTime + Math.max(0.35, dur);
    this._radioUntil = Math.max(this._radioUntil, end);
    this.play(this.pickVar('radio_out'), { gain: 0.3, pan: -0.25, delay: Math.max(0.35, dur), force: true });
  }

  ui() { this.play(this.B.ui_click[0], { gain: 0.38, rate: rand(0.97, 1.03), force: true }); }
  uiHover() { this.play(this.B.ui_hover[0], { gain: 0.14, rate: rand(0.95, 1.05), force: true }); }
  uiBuy() { this.play(this.B.ui_buy[0], { gain: 0.55, force: true }); }

  thunder(delay = 2) {
    this.play(this.pickVar('thunder'), { gain: 0.42 * (1 - this.dawn * 0.5), rate: rand(0.85, 1.05), delay, pan: rand(-0.7, 0.7), reverb: 0.12, bus: 'amb', force: true });
  }

  distantBoom(delay = 3) {
    this.play(this.pickVar('boom_far'), { gain: rand(0.04, 0.08) * (1 - 0.6 * this.dawn), rate: rand(0.55, 0.75), delay, pan: rand(-0.7, 0.7), lowpass: 650, reverb: 0.45, bus: 'amb', key: 'dboom', max: 3 });
  }

  distantGunfire(delay = 3) {
    this.play(this.pickVar('distant_mg'), { gain: 0.12, rate: rand(0.9, 1.1), delay, pan: rand(-0.6, 0.6), lowpass: 1800, reverb: 0.5, bus: 'amb', key: 'dmg', max: 3 });
  }

  beep(freq = 1000, dur = 0.08, gain = 0.12, delay = 0) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = freq;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.005); g.gain.setValueAtTime(gain, t + dur); g.gain.linearRampToValueAtTime(0, t + dur + 0.01);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 3000;
    o.connect(f); f.connect(g); g.connect(this.sfx);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // ── compatibility setters (the game also writes the fields directly) ───────
  setHordeLevel(level) { this.hordeAlive = level * 350; }
  setRain() { /* rain follows the dawn */ }
  setTide(on) { this.tide = !!on; }

  // ── score ──────────────────────────────────────────────────────────────────
  setMusicMode(mode, force = false) {
    const prev = this.musicMode;
    this.musicMode = mode;
    if (!this.ready || (prev === mode && !force)) return;
    const T = this.tracks;
    const only = (keep) => { for (const [k, tr] of Object.entries(T)) if (!keep.includes(k)) tr.set(0, 1.4); };
    this.snap.gain.setTargetAtTime(SNAP[mode] ?? 1, this.ctx.currentTime, 1.2);
    if (mode === 'menu') { only(['menu']); T.menu.set(1.2, 2.5); }
    else if (mode === 'night') {
      this.tide = false; this._tideOn = false; this._mi = 0;
      only([this.bedTrack]);
      T[this.bedTrack].set(1.0, 3.5);
    } else if (mode === 'dawn') {
      only(['dawn']);
      T.dawn.set(1.1, 1.2, true);
      this._bellDone = false; this._bellT = 2.5; this._crowT = rand(3, 7);
    } else if (mode === 'gameover') { only(['fallen']); T.fallen.set(1.15, 1.5, true); }
    else if (mode === 'victory') { only(['victory']); T.victory.set(1.15, 2, true); }
  }

  get bedTrack() { return this.night % 2 ? 'night_bed_1' : 'night_bed_2'; }
  get pressureTrack() { return Math.floor((this.night - 1) / 2) % 2 ? 'pressure_2' : 'pressure_1'; }

  updateScore(dt) {
    const T = this.tracks;
    if (this.musicMode === 'night') {
      // fast to rise, slow to settle
      const target = clamp(this.intensity, 0, 1);
      this._mi += (target - this._mi) * (1 - Math.exp(-dt / (target > this._mi ? 1.5 : 7)));
      if (!this._tideOn && (this.tide || this._mi > 0.88)) {
        this._tideOn = true;
        T.tide.set(1.1, 1.2, T.tide.remaining < 20);
      } else if (this._tideOn && !this.tide && this._mi < 0.55) {
        this._tideOn = false;
        T.tide.set(0, 3);
      }
      const tideMix = this._tideOn ? 1 : 0;
      T[this.bedTrack].set(1.0 * (1 - 0.45 * tideMix), 2.5);
      T[this.pressureTrack].set(smooth(0.2, 0.65, this._mi) * 1.05 * (1 - tideMix), 2);
    } else if (this.musicMode === 'dawn') {
      // the sting opens out into the resupply theme
      if (T.dawn.el && (T.dawn.ended || T.dawn.remaining < 4) && T.resupply.target === 0) {
        T.resupply.set(0.9, 3, false);
        T.dawn.set(0, 2.5);
      }
    }
    for (const tr of Object.values(T)) tr.tick(dt);
  }

  // ── ambience ───────────────────────────────────────────────────────────────
  updateBeds(dt) {
    const b = this.beds, m = this.musicMode;
    const day = this.dawn, night = 1 - day;
    // wind wanders
    this._gustV += (rand(-1, 1) * 0.6 - this._gustV * 0.5) * dt;
    this._gust = clamp(this._gust + this._gustV * dt, 0, 1);
    const alive = this.hordeAlive, p = this.pressure;
    const inPlay = m === 'night' || m === 'gameover';
    const tc = 1.2;
    b.rain_far.set(0.21 * (1 - 0.5 * day), 2);
    b.rain_near.set(0.12 * (1 - 0.65 * day), 2);
    b.wind.set(0.12 + 0.06 * this._gust, 1.5);
    b.wind_howl.set(0.13 * this._gust * this._gust * (0.4 + 0.6 * night), 1.5);
    b.war.set(0.15 * (1 - 0.75 * day), 3);
    b.horde_far.set(smooth(0, 70, alive) * 0.3, tc);
    b.horde_mid.set(smooth(40, 300, alive) * 0.26, tc);
    b.horde_near.set(inPlay ? clamp(p * 1.3 + alive / 1200, 0, 1) * 0.36 : 0, tc);
    b.horde_surge.set(inPlay ? smooth(0.45, 0.85, p) * 0.42 : 0, 0.8);
    b.shuffle.set(inPlay ? clamp(p * 1.5, 0, 1) * 0.3 : 0, tc);
    b.fire_roar.set(this.napalmLevel * 0.6, 0.6);
    b.fire_crackle.set(this.napalmLevel * 0.45 + 0.035 * night, 0.8);
    b.lamp.set(0.05 * clamp(1 - day * 1.7, 0, 1), 1);
    b.dawn.set(0.3 * day, 2.5);
    b.flies.set(0.1 * day, 3);
    b.radio_static.set(this.ctx.currentTime < this._radioUntil ? 0.03 : 0, 0.08);
    for (const bed of Object.values(b)) bed.tick(dt);
    this.frontPan.pan.setTargetAtTime(clamp(Math.sin(-this.listenerYaw) * 0.5, -0.5, 0.5), this.ctx.currentTime, 0.2);
  }

  /** Called every frame (real time). */
  update(dt) {
    if (!this.ready) return;
    const now = this.ctx.currentTime;
    this._earT = Math.max(0, this._earT - dt);

    // the valley throws the end of a burst back at you
    if (this._hmgCount > 0 && now - this._hmgLast > 0.13) {
      const k = Math.min(1, this._hmgCount / 12);
      this.play(this.pickVar('hmg_tail'), { gain: 0.24 + 0.32 * k, rate: rand(0.86, 0.94), reverb: 0.35, bus: 'hmg', force: true });
      // a long burst comes back off the hills like distant thunder
      if (this._hmgCount >= 5) this.play(this.pickVar('boom_far'), { gain: 0.12 + 0.2 * k, rate: rand(0.5, 0.6), pan: rand(-0.4, 0.4), lowpass: 900, delay: rand(0.15, 0.3), reverb: 0.8, force: true });
      this._hmgCount = 0;
    }

    // heartbeat when the wall is nearly empty
    if (this.lowLife && this.musicMode === 'night') {
      this._nextBeat -= dt;
      if (this._nextBeat <= 0) {
        this._nextBeat = 60 / (58 + this.intensity * 40);
        this.play(this.B.heartbeat[0], { gain: 0.5, force: true });
      }
    } else this._nextBeat = 0;

    // the world between the fighting
    if (this.dawn > 0.4) {
      this._crowT -= dt;
      if (this._crowT <= 0) {
        this._crowT = rand(5, 14);
        this.play(this.pickVar('crow'), { gain: rand(0.12, 0.25), rate: rand(0.95, 1.05), pan: rand(-0.8, 0.8), lowpass: rand(5000, 12000), reverb: 0.35, bus: 'amb' });
      }
      if (!this._bellDone && this.musicMode === 'dawn') {
        this._bellT -= dt;
        if (this._bellT <= 0) {
          this._bellDone = true;
          this.play(this.B.bell[0], { gain: 0.3, pan: -0.35, lowpass: 5000, reverb: 0.6, bus: 'amb' });
        }
      }
    } else if (this.intensity < 0.2) {
      this._dogT -= dt;
      if (this._dogT <= 0) {
        this._dogT = rand(45, 110);
        this.play(this.pickVar('dog'), { gain: 0.1, pan: rand(-0.9, 0.9), lowpass: 2500, reverb: 0.7, bus: 'amb' });
      }
    }

    this._bedT -= dt;
    if (this._bedT <= 0) {
      this.updateBeds(0.1 - this._bedT);
      this._bedT = 0.1;
    }
    this.updateScore(dt);
  }
}
