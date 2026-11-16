"""Last Bastion — radio voice build (final stage).

Takes the performance chosen for every line of radio traffic in the game
(src/config.js → allRadioLines) and puts it through a radio chain —
band-limiting, compression, overdriven transmitter, a cheap codec, carrier
hiss, fading and crackle — tuned per speaker: the sergeant's handheld on the
wall, HF from Command a long way off, aircrew talking over their engines.

The performances come from the directed Qwen3-TTS pipeline
(record_voice.py → convert_voice.py → pick_voice.py; see docs/VOICEOVER.md),
which leaves one take per line in .cache/voice_qwen/chosen/. With --kokoro the
lines are instead read by Kokoro-82M (Apache 2.0, via kokoro-onnx), the
original flat voice-over.

Writes app/audio/voice/*.ogg and app/audio/voice/lines.json ("WHO|text" → file).

Requirements: Python 3.10+, Node (to read the lines from config.js), and
    pip install soundfile scipy numpy          (+ kokoro-onnx for --kokoro)

    python scripts/audio/build_voice.py              # everything
    python scripts/audio/build_voice.py KOVAC        # only speakers/lines matching
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import urllib.request

import numpy as np
import soundfile as sf
from scipy import signal

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
CACHE = os.path.join(HERE, '.cache')
MODEL_DIR = os.path.join(CACHE, 'kokoro')
TAKES = os.path.join(CACHE, 'voice_takes')
OUT = os.path.join(ROOT, 'app', 'audio', 'voice')
MODEL_URL = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/'
SR_OUT = 16000

# ── casting ─────────────────────────────────────────────────────────────────
# voice: a Kokoro voice or a blend {voice: weight}; speed; radio profile
CAST = {
    'SGT. KOVAC': dict(voice={'am_fenrir': 0.6, 'am_onyx': 0.4}, speed=1.04, radio='handheld'),
    'PVT. ARAN': dict(voice='am_liam', speed=1.0, radio='handheld'),
    'COMMAND': dict(voice='bm_george', speed=0.95, radio='hf'),
    'UNKNOWN': dict(voice='af_nicole', speed=1.12, radio='broken'),
    'AUTOMATED': dict(voice='bf_emma', speed=0.9, radio='hf_clean'),
    'BATTERY': dict(voice='am_eric', speed=1.1, radio='field'),
    'SPECTRE 2-1': dict(voice='am_michael', speed=1.02, radio='aircraft'),
    'HAMMER 1-1': dict(voice='am_adam', speed=1.06, radio='jet'),
    'SPECTRE 2-2': dict(voice={'am_eric': 0.5, 'am_michael': 0.5}, speed=1.0, radio='aircraft'),
    'LT. HOLLIS': dict(voice='am_echo', speed=1.12, radio='field'),
    'REACH 3-1': dict(voice='bm_lewis', speed=1.05, radio='aircraft'),
    'NIGHTINGALE': dict(voice='bf_emma', speed=1.04, radio='aircraft'),  # the extraction: the lifters' lead
    'REAPER 1-1': dict(voice='am_adam', speed=1.08, radio='aircraft'),  # ...and the gunship helicopters
    'SURVIVOR': dict(voice='af_nicole', speed=1.05, radio='handheld'),  # the overpass woman, close now
    'THE RIDGE': dict(voice='bf_isabella', speed=1.0, radio='hf'),  # the ending: strangers on weak sets
    'THE QUARRY': dict(voice='bm_daniel', speed=0.95, radio='hf'),
    'NARRATOR': dict(voice='bm_lewis', speed=0.9, radio='narration'),  # the chronicle at dawn: no radio
}
# Kovac shouting over the gun (BARKS): faster, harder
SHOUT_SPEED = 1.07

# radio chains
PROFILES = {
    #               hp    lp   peak(f, dB, Q)     drive noise_dB flutter(depth, rate) crackle dropouts engine
    'handheld': dict(hp=300, lp=3400, peak=(1700, 5, 1.0), drive=2.5, noise=-34, flutter=(0.0, 0), crackle=0.6, drop=0.0, engine=None, bits=11),
    'field':    dict(hp=380, lp=3000, peak=(1500, 6, 1.1), drive=3.4, noise=-31, flutter=(0.08, 0.6), crackle=1.0, drop=0.0, engine=None, bits=10),
    'hf':       dict(hp=420, lp=2700, peak=(1300, 5, 0.9), drive=2.6, noise=-27, flutter=(0.35, 0.35), crackle=2.5, drop=0.02, engine=None, bits=9),
    'hf_clean': dict(hp=400, lp=2800, peak=(1400, 4, 0.9), drive=2.0, noise=-30, flutter=(0.18, 0.25), crackle=1.5, drop=0.0, engine=None, bits=10),
    'broken':   dict(hp=480, lp=2400, peak=(1200, 6, 0.8), drive=3.8, noise=-22, flutter=(0.55, 0.5), crackle=5.0, drop=0.08, engine=None, bits=8),
    'aircraft': dict(hp=350, lp=3100, peak=(1100, 7, 2.2), drive=3.6, noise=-33, flutter=(0.0, 0), crackle=0.5, drop=0.0, engine='prop', bits=10),
    'jet':      dict(hp=350, lp=3200, peak=(1250, 7, 2.0), drive=3.8, noise=-33, flutter=(0.0, 0), crackle=0.5, drop=0.0, engine='jet', bits=10),
}


# ── text → speech ───────────────────────────────────────────────────────────
SPOKEN = [
    (r'Bastion-(\d)', lambda m: 'Bastion ' + ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'][int(m.group(1))]),
    (r'\b0300\b', 'zero three hundred'),
    (r'\bHE\b', 'high explosive'),
    (r'\bGBU\b', 'G.B.U.'),
    (r'\bklicks\b', 'clicks'),
    (r'\s*—\s*', ', '),
    # single key letters read as words ('Q' -> 'she', 'E' -> 'he'): name the key
    (r'\bQ puts\b', 'The Q key puts'),
    (r'\bE throws\b', 'The E key throws'),
    (r"that's T\b", "that's the T key"),
]


def spoken_parts(text):
    """Split a line into spoken chunks; None marks a burst of static (the signal breaking up)."""
    parts = []
    for i, chunk in enumerate(re.split(r'\(static\)', text)):
        if i:
            parts.append(None)
        for j, piece in enumerate(re.split(r'\.\.\.', chunk)):
            if j:
                parts.append(0.0)  # a hesitant pause
            t = piece.strip(' ,')
            for pat, rep in SPOKEN:
                t = re.sub(pat, rep, t)
            t = re.sub(r'[-—]+$', '', t).strip()
            if re.search(r'[A-Za-z]', t):
                parts.append(t if re.search(r'[.!?]$', t) else t + ',')
    return parts


_kokoro = None


def kokoro():
    global _kokoro
    if _kokoro is None:
        os.makedirs(MODEL_DIR, exist_ok=True)
        for f in ('kokoro-v1.0.onnx', 'voices-v1.0.bin'):
            p = os.path.join(MODEL_DIR, f)
            if not os.path.exists(p):
                print('  downloading', f)
                urllib.request.urlretrieve(MODEL_URL + f, p)
        from kokoro_onnx import Kokoro
        _kokoro = Kokoro(os.path.join(MODEL_DIR, 'kokoro-v1.0.onnx'), os.path.join(MODEL_DIR, 'voices-v1.0.bin'))
    return _kokoro


def voice_style(v):
    k = kokoro()
    if isinstance(v, str):
        return v
    return sum(k.get_voice_style(name) * w for name, w in v.items())


CHOSEN = os.path.join(CACHE, 'voice_qwen', 'chosen')


def take(who, text, shout):
    """The performance: float32 mono at 24 kHz with markers for static bursts."""
    if '--kokoro' not in sys.argv:
        lid = re.sub(r'[^a-z0-9]+', '_', who.lower()).strip('_') + '_' + hashlib.sha1((who + '|' + text).encode()).hexdigest()[:10]
        p = os.path.join(CHOSEN, lid + '.npz')
        if not os.path.exists(p):
            sys.exit(f'no recorded take for {who}: {text}\n  run record_voice.py, convert_voice.py and pick_voice.py first (or pass --kokoro)')
        d = np.load(p)
        return d['a'], [tuple(x) for x in d['m']]
    return kokoro_take(who, text, shout)


def kokoro_take(who, text, shout):
    """Kokoro TTS (cached): float32 mono at 24 kHz with markers for static bursts."""
    c = CAST[who]
    key = hashlib.sha1(json.dumps([who, spoken_parts(text), c['voice'], c['speed'], shout]).encode()).hexdigest()[:16]
    path = os.path.join(TAKES, key + '.npz')
    if os.path.exists(path):
        d = np.load(path)
        return d['a'], [tuple(x) for x in d['m']]
    k = kokoro()
    speed = SHOUT_SPEED if shout else c['speed']
    sr = 24000
    out, marks = [], []
    n = 0
    for p in spoken_parts(text):
        if p is None:
            marks.append((n, n + int(0.75 * sr)))
            seg = np.zeros(int(0.75 * sr), np.float32)
        elif p == 0.0:
            seg = np.zeros(int(0.32 * sr), np.float32)
        else:
            a, sr = k.create(p, voice=voice_style(c['voice']), speed=speed, lang='en-gb' if c['voice'] in ('bm_george', 'bf_emma') else 'en-us')
            seg = trim(a.astype(np.float32), sr)
            seg = np.concatenate([seg, np.zeros(int(0.08 * sr), np.float32)])
        out.append(seg)
        n += len(seg)
    a = np.concatenate(out)
    os.makedirs(TAKES, exist_ok=True)
    np.savez(path, a=a, m=np.array(marks, dtype=np.int64).reshape(-1, 2))
    return a, marks


def trim(a, sr, thr=0.01):
    idx = np.where(np.abs(a) > thr)[0]
    if not len(idx):
        return a
    return a[max(0, idx[0] - int(0.02 * sr)): idx[-1] + int(0.06 * sr)]


# ── radio chain ─────────────────────────────────────────────────────────────
def env_follow(x, sr, att=0.003, rel=0.08):
    a_at, a_rl = np.exp(-1 / (att * sr)), np.exp(-1 / (rel * sr))
    e = np.zeros_like(x)
    v = 0.0
    ax = np.abs(x)
    for i in range(len(x)):
        s = ax[i]
        v = a_at * v + (1 - a_at) * s if s > v else a_rl * v + (1 - a_rl) * s
        e[i] = v
    return e


def compress(x, sr, thr_db=-22, ratio=5, makeup_db=10):
    e = env_follow(x, sr, 0.002, 0.06)
    lvl = 20 * np.log10(np.maximum(e, 1e-6))
    over = np.maximum(0, lvl - thr_db)
    g = 10 ** ((-over * (1 - 1 / ratio) + makeup_db) / 20)
    return x * g


def peaking(f, gain_db, q, sr):
    A = 10 ** (gain_db / 40)
    w = 2 * np.pi * f / sr
    al = np.sin(w) / (2 * q)
    b = [1 + al * A, -2 * np.cos(w), 1 - al * A]
    a = [1 + al / A, -2 * np.cos(w), 1 - al / A]
    return np.array(b) / a[0], np.array(a) / a[0]


def band(x, sr, hp, lp, order=4):
    x = signal.sosfilt(signal.butter(order, hp, 'highpass', fs=sr, output='sos'), x)
    return signal.sosfilt(signal.butter(order, lp, 'lowpass', fs=sr, output='sos'), x)


def engine_bed(n, sr, kind, rng):
    t = np.arange(n) / sr
    if kind == 'prop':
        # four turboprops through the airframe: blade-pass buzz
        s = sum(np.sin(2 * np.pi * f * h * t + rng.uniform(0, 6)) / h for f in (68, 68.6) for h in range(1, 12))
        s = s * 0.08 + rng.standard_normal(n) * 0.25
    else:
        s = rng.standard_normal(n) * 0.6 + np.sin(2 * np.pi * 2350 * t) * 0.03
    return band(s, sr, 120, 1800, 2)


def radio(a, marks, sr_in, prof, seed):
    P = PROFILES[prof]
    rng = np.random.default_rng(seed)
    x = a / (np.max(np.abs(a)) + 1e-9) * 0.9
    pre, post = int(0.1 * sr_in), int(0.22 * sr_in)
    x = np.concatenate([np.zeros(pre, np.float32), x, np.zeros(post, np.float32)])
    marks = [(s + pre, e + pre) for s, e in marks]
    n = len(x)
    sr = sr_in
    # mic: proximity and the operator's breath pushed into a cheap capsule
    x = compress(x, sr)
    x = band(x, sr, P['hp'], P['lp'])
    b, aa = peaking(*P['peak'], sr)
    x = signal.lfilter(b, aa, x)
    # overdriven transmitter
    x = x / (np.max(np.abs(x)) + 1e-9)
    d = P['drive']
    x = np.tanh(x * d) / np.tanh(d)
    x = np.clip(x * 1.15, -0.85, 0.85)
    # the engines leak in through the mic (aircrew)
    if P['engine']:
        eb = engine_bed(n, sr, P['engine'], rng)
        x = x + eb / (np.max(np.abs(eb)) + 1e-9) * 0.09
    # through a narrow, low-rate codec
    x = signal.resample_poly(x, 1, 3)  # 24k → 8k
    sr8 = sr // 3
    q = 2 ** (P['bits'] - 1)
    x = np.round(x * q) / q
    x = signal.resample_poly(x, 2, 1)  # 8k → 16k
    sr = SR_OUT
    n = len(x)
    scale = sr / sr_in
    marks = [(int(s * scale), int(e * scale)) for s, e in marks]
    x = band(x, sr, P['hp'] * 0.9, min(P['lp'] * 1.05, sr / 2 - 200), 2)
    t = np.arange(n) / sr
    # fading on a long path
    dep, rate = P['flutter']
    if dep > 0:
        wob = signal.sosfilt(signal.butter(2, rate * 3, 'lowpass', fs=sr, output='sos'), rng.standard_normal(n))
        wob = wob / (np.max(np.abs(wob)) + 1e-9)
        fade = 1 - dep * (0.5 + 0.5 * np.sin(2 * np.pi * rate * t + rng.uniform(0, 6) + wob * 2))
        x = x * fade
    else:
        fade = np.ones(n)
    # signal breaking up
    gate = np.ones(n)
    if P['drop'] > 0:
        k = 0
        while k < n:
            if rng.random() < P['drop'] * 0.02:
                L = int(rng.uniform(0.04, 0.16) * sr)
                gate[k:k + L] = rng.uniform(0.0, 0.25)
                k += L
            k += int(0.01 * sr)
        gate = signal.sosfiltfilt(signal.butter(2, 60, 'lowpass', fs=sr, output='sos'), gate)
    for s, e in marks:
        gate[s:e] = 0
    x = x * gate
    # carrier hiss — the receiver opens up when the signal fades
    hiss = band(rng.standard_normal(n), sr, 500, 3600, 2)
    hiss = hiss / (np.std(hiss) + 1e-9)
    sig_env = env_follow(x, sr, 0.01, 0.15)
    sig_env = sig_env / (np.max(sig_env) + 1e-9)
    hiss_lvl = 10 ** (P['noise'] / 20) * (1.0 - 0.55 * sig_env) * (1 + (1 - fade) * 2 + (1 - gate) * 4)
    for s, e in marks:  # proper static bursts
        hiss_lvl[s:e] *= 9
    y = x + hiss * hiss_lvl
    # crackle
    nc = int(P['crackle'] * n / sr) + len(marks) * 12
    for _ in range(nc):
        if marks and rng.random() < 0.5:
            s, e = marks[rng.integers(len(marks))]
            k = int(rng.integers(s, max(s + 1, e)))
        else:
            k = int(rng.integers(0, n - 200))
        L = int(rng.integers(20, 160))
        y[k:k + L] += rng.standard_normal(min(L, n - k)) * np.exp(-np.arange(min(L, n - k)) / (L * 0.3)) * rng.uniform(0.05, 0.3)
    # squelch: open on a breath of carrier, close with a short tail
    o = int(0.035 * sr)
    y[:o] += band(rng.standard_normal(o), sr, 600, 3500, 2) * 0.25 * np.linspace(1, 0.2, o)
    tail = int(0.09 * sr)
    y[-tail:] += band(rng.standard_normal(tail), sr, 600, 3500, 2) * 0.35 * np.linspace(0.3, 1, tail)
    fo = int(0.01 * sr)
    y[-fo:] *= np.linspace(1, 0, fo)
    # loudness: speech RMS to about -17 dBFS, peaks under -1 dBFS
    speech = np.abs(x) > 0.02
    rms = np.sqrt(np.mean(y[speech] ** 2)) if speech.any() else np.sqrt(np.mean(y ** 2))
    y = y * (10 ** (-17 / 20) / (rms + 1e-9))
    y = np.tanh(y * 1.2) / 1.2
    pk = np.max(np.abs(y))
    if pk > 0.89:
        y *= 0.89 / pk
    return y.astype(np.float32), sr


def narration(a, sr):
    """The chronicle is not a radio: a close, warm voice-over. Rumble out, a gentle
    compressor, a little body and presence, speech to about -18 dBFS RMS."""
    x = a / (np.max(np.abs(a)) + 1e-9) * 0.9
    x = np.concatenate([np.zeros(int(0.06 * sr), np.float32), x, np.zeros(int(0.3 * sr), np.float32)])
    x = signal.sosfilt(signal.butter(2, 70, 'highpass', fs=sr, output='sos'), x)
    x = compress(x, sr, thr_db=-20, ratio=2.2, makeup_db=4)
    for f, g, q in ((180, 1.5, 0.8), (350, -1.5, 1.0), (3200, 2.0, 0.9)):
        b, aa = peaking(f, g, q, sr)
        x = signal.lfilter(b, aa, x)
    speech = np.abs(x) > 0.02 * np.max(np.abs(x))
    rms = np.sqrt(np.mean(x[speech] ** 2)) if speech.any() else np.sqrt(np.mean(x ** 2))
    y = x * (10 ** (-18 / 20) / (rms + 1e-9))
    y = np.tanh(y * 1.1) / 1.1
    pk = np.max(np.abs(y))
    if pk > 0.89:
        y *= 0.89 / pk
    fo = int(0.02 * sr)
    y[-fo:] *= np.linspace(1, 0, fo)
    return y.astype(np.float32), sr


# ── main ────────────────────────────────────────────────────────────────────
def radio_lines():
    js = ("import(" + json.dumps('file://' + os.path.join(ROOT, 'src', 'config.js')) + ").then(m => {"
          "const b = new Set(Object.values(m.BARKS).flat());"
          "console.log(JSON.stringify(m.allRadioLines().map(([w, t]) => [w, t, b.has(t)])));})")
    r = subprocess.run(['node', '--no-warnings', '--input-type=module', '-e', js], capture_output=True, text=True, encoding='utf-8', check=True)
    return json.loads(r.stdout)


def slug(s):
    return re.sub(r'[^a-z0-9]+', '_', s.lower()).strip('_')


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    lines = radio_lines()
    os.makedirs(OUT, exist_ok=True)
    man_path = os.path.join(OUT, 'lines.json')
    manifest = json.load(open(man_path, encoding='utf-8')) if os.path.exists(man_path) and args else {}
    total = 0.0
    for who, text, shout in lines:
        if who not in CAST:
            print('  !! no voice cast for', who)
            continue
        if args and not any(a.lower() in (who + ' ' + text).lower() for a in args):
            continue
        h = hashlib.sha1((who + '|' + text).encode()).hexdigest()[:10]
        name = f'{slug(who)}_{h}.ogg'
        a, marks = take(who, text, shout)
        if CAST[who]['radio'] == 'narration':
            y, sr = narration(a, 24000)
        else:
            y, sr = radio(a, marks, 24000, CAST[who]['radio'], int(h, 16) & 0xffffffff)
        sf.write(os.path.join(OUT, name), y, sr, format='OGG', subtype='VORBIS')
        dur = len(y) / sr
        total += dur
        # the game decodes each line at its own rate (radio 16 kHz, narration 24 kHz)
        manifest[who + '|' + text] = {'file': name, 'dur': round(dur, 3), **({'sr': sr} if sr != SR_OUT else {})}
        print(f'  {who:12s} {dur:5.2f}s  {text[:70]}')
    # drop files nothing points at any more
    keep = {v['file'] for v in manifest.values()}
    for f in os.listdir(OUT):
        if f.endswith('.ogg') and f not in keep:
            os.remove(os.path.join(OUT, f))
    json.dump(manifest, open(man_path, 'w', encoding='utf-8'), indent=1, ensure_ascii=False, sort_keys=True)
    print(f'{len(manifest)} lines, {total:.0f} s of speech -> {os.path.relpath(OUT, ROOT)}')


if __name__ == '__main__':
    main()
