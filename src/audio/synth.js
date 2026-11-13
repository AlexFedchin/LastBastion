// ─────────────────────────────────────────────────────────────────────────────
//  Synthesized layers, rendered once into AudioBuffers when the engine starts.
//
//  - punch:   the body of a .50 BMG report — chest-hit sub kick, muzzle blast,
//             supersonic crack and the bolt slamming home. Layered under the
//             recorded M2 so every round lands like a hammer.
//  - sizzle:  a hot barrel cooking off: hiss and spitting crackle.
//  - tick:    thermal-contraction pings of steel cooling down.
//  - blastSub: the ground-shaking low end of a 2000 lb bomb.
//  - prop / jet: seamless engine loops for the gunship and the bomber.
// ─────────────────────────────────────────────────────────────────────────────

const TAU = Math.PI * 2;

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 4294967296) * 2 - 1; };
}

function normalize(a, peak = 0.95) {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]));
  if (m > 0) { const k = peak / m; for (let i = 0; i < a.length; i++) a[i] *= k; }
  return a;
}

function toBuffer(ctx, chans) {
  const buf = ctx.createBuffer(chans.length, chans[0].length, ctx.sampleRate);
  chans.forEach((c, i) => buf.copyToChannel(c, i));
  return buf;
}

/** One-pole low-pass coefficient for a cutoff (Hz). */
const lpA = (fc, sr) => 1 - Math.exp(-TAU * fc / sr);

/** Make a noise loop seamless: crossfade its overrun back into the head. */
function loopify(src, len, xf) {
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) out[i] = src[i];
  for (let i = 0; i < xf; i++) {
    const k = i / xf;
    out[i] = src[i] * Math.sqrt(k) + src[len + i] * Math.sqrt(1 - k);
  }
  return out;
}

// ── the .50 cal ────────────────────────────────────────────────────────────
export function makePunch(ctx, seed) {
  const sr = ctx.sampleRate, n = Math.floor(0.5 * sr);
  const chans = [];
  const R0 = rng(seed * 7919 + 13);
  const subF = 36 + R0() * 4, subTop = 95 + R0() * 20;
  for (let c = 0; c < 2; c++) {
    const R = rng(seed * 104729 + c * 31 + 1);
    const sub = new Float32Array(n), body = new Float32Array(n), crack = new Float32Array(n), air = new Float32Array(n), mech = new Float32Array(n);
    let ph = 0, lb = 0, lc = 0, la1 = 0, la2 = 0;
    const aBody = lpA(520, sr), aCrack = lpA(2200, sr), aAir = lpA(140, sr);
    const mf = [1730, 2610, 3920, 5150].map((f) => f * (1 + R() * 0.04));
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      // sub kick: a fast pitch drop into the chest
      const f = subF + subTop * Math.exp(-t / 0.02);
      ph += TAU * f / sr;
      // (short: at 10 rounds a second a longer sub stacks into a drone)
      sub[i] = Math.sin(ph) * (1 - Math.exp(-t / 0.0007)) * Math.exp(-t / 0.045);
      const w = R();
      // muzzle blast body
      lb += aBody * (w - lb);
      body[i] = lb * Math.exp(-t / 0.03) * (1 - Math.exp(-t / 0.0004));
      // supersonic crack (high-passed, a few ms)
      lc += aCrack * (w - lc);
      crack[i] = (w - lc) * Math.exp(-t / 0.0022);
      // pressure wave rolling off — the heavy air
      la1 += aAir * (w - la1); la2 += aAir * (la1 - la2);
      air[i] = la2 * Math.min(1, t / 0.006) * Math.exp(-t / 0.06);
      // bolt slamming home ~28 ms later
      const tm = t - 0.028;
      if (tm > 0) {
        let s = 0;
        for (let k = 0; k < mf.length; k++) s += Math.sin(TAU * mf[k] * tm) * Math.exp(-tm / (0.03 - k * 0.005)) / (k + 1);
        mech[i] = s + (tm < 0.002 ? w * (1 - tm / 0.002) : 0);
      }
    }
    for (const a of [sub, body, crack, air, mech]) normalize(a, 1);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      // crack and the bolt's clack up front: that's what makes it read as a gun
      const x = sub[i] * 0.8 + body[i] * 0.6 + crack[i] * 0.7 + air[i] * 0.4 + mech[i] * 0.22;
      out[i] = Math.tanh(x * 1.5);
    }
    chans.push(normalize(out, 0.95));
  }
  return toBuffer(ctx, chans);
}

// ── barrel cooling ─────────────────────────────────────────────────────────
export function makeSizzle(ctx, seed = 3) {
  const sr = ctx.sampleRate, n = Math.floor(5.5 * sr);
  const chans = [];
  for (let c = 0; c < 2; c++) {
    const R = rng(seed * 977 + c * 17 + 5);
    const out = new Float32Array(n);
    let lp = 0, lp2 = 0, mod = 0, pop = 0, popA = 0;
    const aHi = lpA(9000, sr), aLo = lpA(2600, sr), aMod = lpA(6, sr);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const env = Math.min(1, t / 0.03) * Math.exp(-t / 1.7);
      const w = R();
      lp += aHi * (w - lp); lp2 += aLo * (lp - lp2);
      const hiss = lp - lp2; // band 2.6–9 kHz
      mod += aMod * (R() - mod);
      // spitting crackle: short, random pops, denser while hot
      if (Math.abs(R()) < 0.0009 * env + 0.00005) { pop = 1; popA = 0.4 + Math.abs(R()) * 0.9; }
      pop *= 0.985;
      out[i] = env * (hiss * (0.55 + mod * 1.6) + w * pop * popA * 0.6);
    }
    chans.push(normalize(out, 0.9));
  }
  return toBuffer(ctx, chans);
}

export function makeTick(ctx, seed) {
  const sr = ctx.sampleRate, n = Math.floor(0.18 * sr);
  const R = rng(seed * 3571 + 11);
  const f0 = 2300 + (R() * 0.5 + 0.5) * 2600;
  const parts = [[1, 0.05, 1], [1.47, 0.035, 0.6], [2.09, 0.025, 0.45], [2.76, 0.016, 0.3], [3.4, 0.01, 0.2]];
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let s = 0;
    for (const [r, d, a] of parts) s += Math.sin(TAU * f0 * r * t) * Math.exp(-t / d) * a;
    s += R() * Math.exp(-t / 0.0006) * 0.8;
    out[i] = s;
  }
  normalize(out, 0.9);
  return toBuffer(ctx, [out, out]);
}

// ── heavy ordnance ─────────────────────────────────────────────────────────
export function makeBlastSub(ctx) {
  const sr = ctx.sampleRate, n = Math.floor(4.2 * sr);
  const chans = [];
  for (let c = 0; c < 2; c++) {
    const R = rng(4441 + c * 7);
    const out = new Float32Array(n);
    let l1 = 0, l2 = 0, l3 = 0, ph = 0;
    const a = lpA(70, sr), a3 = lpA(260, sr);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const w = R();
      l1 += a * (w - l1); l2 += a * (l1 - l2);
      l3 += a3 * (w - l3);
      const f = 26 + 40 * Math.exp(-t / 0.08);
      ph += TAU * f / sr;
      const att = 1 - Math.exp(-t / 0.004);
      out[i] = att * (Math.sin(ph) * Math.exp(-t / 0.45) * 0.9 + l2 * 22 * Math.exp(-t / 1.1) + l3 * 2.2 * Math.exp(-t / 0.25));
    }
    for (let i = 0; i < n; i++) out[i] = Math.tanh(out[i] * 1.2);
    chans.push(normalize(out, 0.95));
  }
  return toBuffer(ctx, chans);
}

// ── engines ────────────────────────────────────────────────────────────────
/** Four turboprops: blade-pass hum beating between engines, turbine whine, wash. */
export function makeProp(ctx) {
  const sr = ctx.sampleRate, L = 4, n = Math.floor(L * sr), xf = Math.floor(0.4 * sr);
  const chans = [];
  for (let c = 0; c < 2; c++) {
    const R = rng(911 + c * 3);
    const noise = new Float32Array(n + xf);
    let l1 = 0, l2 = 0, h1 = 0;
    const a = lpA(380, sr), ah = lpA(1600, sr);
    for (let i = 0; i < n + xf; i++) {
      const w = R();
      l1 += a * (w - l1); l2 += a * (l1 - l2);
      h1 += ah * (w - h1);
      noise[i] = l2 * 5 + (h1 - l2) * 0.35;
    }
    const wash = loopify(noise, n, xf);
    const out = new Float32Array(n);
    // whole cycles per loop so the hum is seamless (0.25 Hz grid)
    const bp = [68, 68.5, 67.5, 69.25];
    const whine = [1412.5, 1418.75];
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      let s = 0;
      for (let e = 0; e < 4; e++) {
        const f = bp[e];
        for (let hN = 1; hN <= 6; hN++) s += Math.sin(TAU * f * hN * t + e * 1.3 + hN * 0.7) / (hN * 1.4);
      }
      s *= 0.16;
      s += (Math.sin(TAU * whine[0] * t) + Math.sin(TAU * whine[1] * t + 1)) * 0.025;
      out[i] = Math.tanh((s + wash[i] * 0.9) * 1.3);
    }
    chans.push(normalize(out, 0.9));
  }
  return toBuffer(ctx, chans);
}

/** Jet bomber: deep roar, tearing mid-range and a thin turbine scream. */
export function makeJet(ctx) {
  const sr = ctx.sampleRate, L = 4, n = Math.floor(L * sr), xf = Math.floor(0.5 * sr);
  const chans = [];
  for (let c = 0; c < 2; c++) {
    const R = rng(5003 + c * 9);
    const noise = new Float32Array(n + xf);
    let l1 = 0, l2 = 0, m1 = 0, m2 = 0, mod = 0;
    const a = lpA(160, sr), am = lpA(1400, sr), am2 = lpA(380, sr), amod = lpA(9, sr);
    for (let i = 0; i < n + xf; i++) {
      const w = R();
      l1 += a * (w - l1); l2 += a * (l1 - l2);
      m1 += am * (w - m1); m2 += am2 * (m1 - m2);
      mod += amod * (R() - mod);
      noise[i] = l2 * 7 + (m1 - m2) * (0.7 + mod * 3);
    }
    const roar = loopify(noise, n, xf);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const scream = Math.sin(TAU * 2350 * t) * 0.02 + Math.sin(TAU * 3120.25 * t) * 0.012;
      out[i] = Math.tanh((roar[i] + scream) * 1.2);
    }
    chans.push(normalize(out, 0.9));
  }
  return toBuffer(ctx, chans);
}

// ── the generator ───────────────────────────────────────────────────────────
/** Mains hum winding down (or spinning back up) with a relay clunk. */
export function makePower(ctx, up) {
  const sr = ctx.sampleRate, dur = up ? 2.2 : 3.0, n = Math.floor(dur * sr);
  const R = rng(up ? 77 : 78);
  const out = new Float32Array(n);
  let ph = 0, lp = 0;
  const a = lpA(1800, sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr, u = t / dur;
    const f = up ? 18 + 82 * Math.pow(u, 0.6) : 100 * Math.pow(1 - u, 1.6) + 6;
    ph += TAU * f / sr;
    const saw = ((ph / TAU) % 1) * 2 - 1;
    const env = up ? Math.min(1, u * 3) * (0.6 + 0.4 * u) : Math.pow(1 - u, 1.2);
    const w = R();
    lp += a * (w - lp);
    const clunk = t < 0.08 ? lp * 6 * Math.exp(-t / 0.02) + Math.sin(TAU * 70 * t) * Math.exp(-t / 0.03) * 1.5 : 0;
    out[i] = (saw * 0.5 + Math.sin(ph * 2) * 0.3) * env * 0.5 + clunk;
  }
  normalize(out, 0.9);
  return toBuffer(ctx, [out, out]);
}

// ── AC-130 GAU-12 ──────────────────────────────────────────────────────────
/**
 * A burst from the gunship's 25 mm Gatling as heard from the ground, a few
 * hundred metres off: the reports run together into one tearing BRRRRT
 * (~70 rounds a second), a spin-up stutter at the head, a rolling tail.
 * `dur` is the trigger time in seconds; the buffer runs on for the tail.
 */
export function makeGau(ctx, dur, seed = 1) {
  const sr = ctx.sampleRate, tail = 1.1, n = Math.floor((dur + tail) * sr);
  const chans = [];
  for (let c = 0; c < 2; c++) {
    const R = rng(seed * 6007 + c * 17 + 5);
    const out = new Float32Array(n);
    let ph = 0, pulseT = 1e9, amp = 0, l1 = 0, l2 = 0, r1 = 0, r2 = 0, b1 = 0, sph = 0;
    const aTone = lpA(1500, sr), aRum = lpA(85, sr), aBody = lpA(380, sr);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const firing = t < dur;
      // barrels spin up to speed in the first tenth of a second
      const rate = 70 * (1 - 0.45 * Math.exp(-t / 0.05));
      if (firing) {
        ph += rate / sr;
        if (ph >= 1) { ph -= 1 + R() * 0.04; pulseT = 0; amp = 0.85 + R() * 0.3; sph = 0; }
      }
      // each report: a hard noisy crack over a short low thump
      let p = 0;
      if (pulseT < 0.03) {
        sph += TAU * 120 / sr;
        p = amp * (R() * Math.exp(-pulseT / 0.0035) * 1.1 + Math.sin(sph) * Math.exp(-pulseT / 0.009) * 1.3);
      }
      pulseT += 1 / sr;
      l1 += aTone * (p - l1); l2 += aTone * (l1 - l2);
      b1 += aBody * (p - b1);
      // rumble of the stream, ringing on after the trigger lets go
      const w = R();
      r1 += aRum * (w - r1); r2 += aRum * (r1 - r2);
      const env = firing ? Math.min(1, t / 0.04) : Math.exp(-(t - dur) / 0.32);
      out[i] = l2 * 1.6 + b1 * 1.2 + r2 * 26 * env;
    }
    for (let i = 0; i < n; i++) out[i] = Math.tanh(out[i] * 1.5);
    chans.push(normalize(out, 0.95));
  }
  return toBuffer(ctx, chans);
}

/** 25 mm HE rounds walking across the ground: a dense, rolling crackle of small blasts. */
export function makeGauImpacts(ctx, dur, seed = 1) {
  const sr = ctx.sampleRate, tail = 1.2, n = Math.floor((dur + tail) * sr);
  const chans = [];
  for (let c = 0; c < 2; c++) {
    const R = rng(seed * 3301 + c * 11 + 9);
    const out = new Float32Array(n);
    const hits = [];
    for (let t = 0.02; t < dur; t += 0.012 + Math.abs(R()) * 0.03) hits.push([Math.floor(t * sr), 0.6 + Math.abs(R()) * 0.6, 40 + Math.abs(R()) * 35]);
    for (const [s0, a, f] of hits) {
      let lp = 0, sp = 0;
      const aa = lpA(900, sr);
      for (let k = 0, m = Math.floor(0.35 * sr); k < m && s0 + k < n; k++) {
        const t = k / sr;
        lp += aa * (R() - lp);
        sp += TAU * (f + 60 * Math.exp(-t / 0.02)) / sr;
        out[s0 + k] += a * (lp * 5 * Math.exp(-t / 0.03) + Math.sin(sp) * Math.exp(-t / 0.09) * 0.8);
      }
    }
    // the ground keeps rumbling for a moment
    let r1 = 0, r2 = 0;
    const ar = lpA(70, sr);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      r1 += ar * (R() - r1); r2 += ar * (r1 - r2);
      out[i] += r2 * 22 * (t < dur ? Math.min(1, t / 0.1) : Math.exp(-(t - dur) / 0.4));
    }
    for (let i = 0; i < n; i++) out[i] = Math.tanh(out[i] * 0.9);
    chans.push(normalize(out, 0.95));
  }
  return toBuffer(ctx, chans);
}
