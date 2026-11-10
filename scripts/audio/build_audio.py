"""Last Bastion — sound build.

Turns stock recordings into the game's audio assets (app/audio/**.ogg):
slicing, layering, seamless loop crossfades, loudness matching, limiting and
Vorbis encoding. Every recipe below is the single source of truth for what the
game ships, and CREDITS.md is generated from the same data.

Sources
  * Freesound.org — CC0 recordings (HQ previews), fetched by sound id.
  * incompetech.com — Kevin MacLeod, CC BY 4.0 (attribution in CREDITS.md).

Requirements: Python 3.10+, numpy, ffmpeg (with libvorbis) on PATH.

    python scripts/audio/build_audio.py            # build everything (cached sources)
    python scripts/audio/build_audio.py hmg boom   # only recipes whose name contains these
"""
import html
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import urllib.error

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
CACHE = os.path.join(HERE, '.cache')
OUT = os.path.join(ROOT, 'app', 'audio')
UA = {'User-Agent': 'LastBastion-audio-build/1.0'}

# ── source fetching ──────────────────────────────────────────────────────────

def _get(url, binary=False):
    for k in range(6):
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60)
            d = r.read()
            return (d if binary else d.decode('utf8', 'replace')), r.geturl()
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(6 + 6 * k)
                continue
            raise
    raise RuntimeError('rate limited: ' + url)


_meta = None


def fs_meta():
    global _meta
    if _meta is None:
        p = os.path.join(CACHE, 'fs', 'meta.json')
        _meta = json.load(open(p, encoding='utf8')) if os.path.exists(p) else {}
    return _meta


def fs(sid):
    """Local path of a Freesound sound (HQ preview), downloading it if needed."""
    sid = str(sid)
    path = os.path.join(CACHE, 'fs', sid + '.mp3')
    meta = fs_meta()
    if os.path.exists(path) and sid in meta:
        return path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    page, final = _get(f'https://freesound.org/s/{sid}/')
    mp3 = re.search(r'data-mp3="([^"]+)"', page).group(1).replace('-lq.mp3', '-hq.mp3')
    lic = re.search(r'href="(https?://creativecommons\.org/[^"]+)"', page)
    meta[sid] = {
        'title': html.unescape(re.search(r'data-title="([^"]*)"', page).group(1)),
        'user': re.search(r'/people/([^/]+)/sounds/', final).group(1),
        'license': lic.group(1) if lic else '?',
        'url': final,
    }
    if 'publicdomain/zero' not in meta[sid]['license']:
        raise RuntimeError(f'freesound {sid} is not CC0: {meta[sid]["license"]}')
    data, _ = _get(mp3, binary=True)
    open(path, 'wb').write(data)
    json.dump(meta, open(os.path.join(CACHE, 'fs', 'meta.json'), 'w', encoding='utf8'), indent=1, ensure_ascii=False)
    time.sleep(1.5)
    return path


def km(title, filename=None):
    """Local path of a Kevin MacLeod track from incompetech."""
    path = os.path.join(CACHE, 'music', title + '.mp3')
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        fn = urllib.parse.quote(filename or title + '.mp3')
        data, _ = _get('https://incompetech.com/music/royalty-free/mp3-royaltyfree/' + fn, binary=True)
        open(path, 'wb').write(data)
    return path


# ── rendering ────────────────────────────────────────────────────────────────

def run(args):
    r = subprocess.run(['ffmpeg', '-v', 'error', '-y'] + args, capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(r.stderr)


def read_f32(path, ch):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-'], capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, ch)


def measure(x, sr):
    mono = x.mean(1)
    peak = float(np.abs(x).max()) + 1e-9
    rms = float(np.sqrt((mono ** 2).mean())) + 1e-9
    n = max(1, int(0.4 * sr))
    if len(mono) > n:
        c = np.cumsum(np.concatenate([[0], mono.astype(np.float64) ** 2]))
        mom = float(np.sqrt(((c[n:] - c[:-n]) / n).max())) + 1e-9
    else:
        mom = rms
    db = lambda v: 20 * np.log10(v)
    return db(peak), db(rms), db(mom)


def lufs(path):
    r = subprocess.run(['ffmpeg', '-v', 'info', '-nostats', '-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-'],
                       capture_output=True, text=True)
    m = re.findall(r'I:\s+(-?[\d.]+) LUFS', r.stderr)
    return float(m[-1])


def chain(src_label, o, sr):
    """Per-layer processing: resample, pitch (rate), filters, fades, gain."""
    f = [f'aresample={sr}']
    if o.get('rate', 1) != 1:
        f += [f'asetrate={sr * o["rate"]:.3f}', f'aresample={sr}']
    for _ in range(o.get('hp_order', 1)):
        if o.get('hp'): f.append(f'highpass=f={o["hp"]}')
    for _ in range(o.get('lp_order', 1)):
        if o.get('lp'): f.append(f'lowpass=f={o["lp"]}')
    if o.get('bp'): f.append(f'bandpass=f={o["bp"][0]}:width_type=q:w={o["bp"][1]}')
    dur = o['t'] / o.get('rate', 1)
    fi, fo = o.get('fi', 0.003), o.get('fo', min(0.25, dur * 0.3))
    f.append(f'afade=t=in:d={fi}')
    f.append(f'afade=t=out:st={max(0, dur - fo):.4f}:d={fo:.4f}')
    if o.get('vol'): f.append(f'volume={o["vol"]}dB')
    if o.get('delay'): f.append(f'adelay={int(o["delay"] * 1000)}:all=1')
    return f'[{src_label}]' + ','.join(f)


RECIPES = []
USED = {}  # source id -> set(recipe names)


def _src(s):
    return fs(s) if isinstance(s, int) else s


def oneshot(name, layers, sr=44100, ch=1, norm='mom', target=-14.0, limit=4.0, q=5):
    """layers: list of dicts {src, ss, t, rate, hp, lp, fi, fo, vol, delay}."""
    RECIPES.append(dict(kind='oneshot', name=name, layers=layers, sr=sr, ch=ch, norm=norm, target=target, limit=limit, q=q))


def clip(name, src, ss, t, sr=44100, ch=1, norm='mom', target=-14.0, limit=4.0, q=5, **o):
    oneshot(name, [dict(src=src, ss=ss, t=t, **o)], sr, ch, norm, target, limit, q)


def loop(name, src, ss, D, X=1.5, sr=32000, ch=2, target=-24.0, q=4, **o):
    RECIPES.append(dict(kind='loop', name=name, src=src, ss=ss, D=D, X=X, sr=sr, ch=ch, target=target, q=q, o=o))


def music(name, title, target=-18.0, filename=None, q=3):
    RECIPES.append(dict(kind='music', name=name, title=title, filename=filename, target=target, q=q))


def finish(tmp, out_path, sr, ch, gain_db, limit_db, q):
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    lim = 10 ** (limit_db / 20)
    run(['-i', tmp, '-af', f'volume={gain_db:.2f}dB,alimiter=limit={lim:.4f}:attack=3:release=60:level=false:latency=true',
         '-ar', str(sr), '-ac', str(ch), '-c:a', 'libvorbis', '-q:a', str(q), out_path])


def build_oneshot(r, tmp):
    args, graphs = [], []
    for k, L in enumerate(r['layers']):
        # (no input seek at 0: seeking an MP3 can drop its first frame)
        args += (['-ss', f'{L["ss"]:.4f}'] if L['ss'] > 0 else []) + ['-t', f'{L["t"]:.4f}', '-i', _src(L['src'])]
        graphs.append(chain(f'{k}:a', L, r['sr']) + f',aformat=channel_layouts={"stereo" if r["ch"] == 2 else "mono"}[l{k}]')
    n = len(r['layers'])
    mix = ''.join(f'[l{k}]' for k in range(n)) + (f'amix=inputs={n}:normalize=0:duration=longest[o]' if n > 1 else 'anull[o]')
    run(args + ['-filter_complex', ';'.join(graphs) + ';' + mix, '-map', '[o]', '-c:a', 'pcm_f32le', tmp])
    peak, rms, mom = measure(read_f32(tmp, r['ch']), r['sr'])
    if r['norm'] == 'peak':
        gain = -1.0 - peak
    else:  # loudest 400 ms window to target, allowing `limit` dB of peak limiting
        gain = min(r['target'] - mom, -1.0 - peak + r['limit'])
    return gain


def build_loop(r, tmp):
    D, X, o, sr = r['D'], r['X'], r['o'], r['sr']
    pre = [f'aresample={sr}']
    if o.get('rate'): pre += [f'asetrate={sr * o["rate"]:.3f}', f'aresample={sr}']
    if o.get('hp'): pre.append(f'highpass=f={o["hp"]}')
    if o.get('lp'): pre.append(f'lowpass=f={o["lp"]}')
    if o.get('bp'): pre.append(f'bandpass=f={o["bp"][0]}:width_type=q:w={o["bp"][1]}')
    lay = 'stereo' if r['ch'] == 2 else 'mono'
    g = (f'[0:a]{",".join(pre)},aformat=channel_layouts={lay},asplit=3[a][b][c];'
         f'[a]atrim=0:{X},asetpts=PTS-STARTPTS,afade=t=in:d={X}:curve=qsin[h1];'
         f'[b]atrim={D}:{D + X},asetpts=PTS-STARTPTS,afade=t=out:d={X}:curve=qsin[h2];'
         f'[h1][h2]amix=inputs=2:normalize=0[head];'
         f'[c]atrim={X}:{D},asetpts=PTS-STARTPTS[body];'
         f'[head][body]concat=n=2:v=0:a=1[o]')
    span = (D + X) * (o.get('rate') or 1)
    run(['-ss', f'{r["ss"]}', '-t', f'{span + 0.2}', '-i', _src(r['src']), '-filter_complex', g, '-map', '[o]',
         '-c:a', 'pcm_f32le', tmp])
    peak, rms, mom = measure(read_f32(tmp, r['ch']), sr)
    return min(r['target'] - rms, -1.0 - peak + 3)


def build(only=()):
    os.makedirs(OUT, exist_ok=True)
    with tempfile.TemporaryDirectory() as td:
        tmp = os.path.join(td, 'x.wav')
        for r in RECIPES:
            if only and not any(s in r['name'] for s in only):
                continue
            out = os.path.join(OUT, r['name'] + '.ogg')
            if r['kind'] == 'music':
                src = km(r['title'], r['filename'])
                gain = r['target'] - lufs(src)
                os.makedirs(os.path.dirname(out), exist_ok=True)
                run(['-i', src, '-af', f'volume={gain:.2f}dB,alimiter=limit=0.89:attack=5:release=80:level=false:latency=true',
                     '-ar', '44100', '-c:a', 'libvorbis', '-q:a', str(r['q']), out])
                print(f'  {r["name"]:28} music  gain {gain:+5.1f} dB')
                continue
            gain = build_oneshot(r, tmp) if r['kind'] == 'oneshot' else build_loop(r, tmp)
            finish(tmp, out, r['sr'], r['ch'], gain, -1.0, r['q'])
            print(f'  {r["name"]:28} {r["kind"]:7} gain {gain:+5.1f} dB')
    write_credits()


def write_credits():
    used = {}
    for r in RECIPES:
        if r['kind'] == 'music':
            continue
        srcs = [L['src'] for L in r['layers']] if r['kind'] == 'oneshot' else [r['src']]
        for s in srcs:
            if isinstance(s, int):
                used.setdefault(str(s), set()).add(r['name'].split('/')[-1].rstrip('0123456789_'))
    meta = fs_meta()
    lines = ['# Last Bastion — audio credits', '',
             '## Music', '',
             'All music by **Kevin MacLeod** (incompetech.com), licensed under',
             '[Creative Commons: By Attribution 4.0](http://creativecommons.org/licenses/by/4.0/).', '']
    seen = set()
    for r in RECIPES:
        if r['kind'] == 'music' and r['title'] not in seen:
            seen.add(r['title'])
            lines.append(f'- "{r["title"]}" Kevin MacLeod (incompetech.com) — Licensed under Creative Commons: '
                         f'By Attribution 4.0 License, http://creativecommons.org/licenses/by/4.0/')
    lines += ['', '## Sound effects', '',
              'Recordings from [Freesound](https://freesound.org), all released under',
              '[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (no attribution required — credited anyway,',
              'with thanks). Sounds were edited, layered and processed for the game.', '',
              '| Sound | Author | Used for |', '|---|---|---|']
    for sid in sorted(used, key=int):
        m = meta.get(sid, {})
        lines.append(f'| [{m.get("title", sid)}]({m.get("url", "https://freesound.org/s/" + sid)}) | {m.get("user", "?")} | '
                     f'{", ".join(sorted(used[sid]))} |')
    lines += [''] + ['## Radio voice-over', '', 'Every radio line is spoken by [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (hexgrad),', 'an open-weight text-to-speech model released under the', '[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0), run through', '[kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx) (MIT). The takes were processed into', 'radio transmissions for the game by `scripts/audio/build_voice.py`.']
    open(os.path.join(OUT, 'CREDITS.md'), 'w', encoding='utf8').write('\n'.join(lines) + '\n')


# ═════════════════════════════════════════════════════════════════════════════
#  RECIPES
# ═════════════════════════════════════════════════════════════════════════════

# ── M2HB .50 cal ─────────────────────────────────────────────────────────────
# Close .50 BMG report (crack + blast) layered over the low weight of a real M2
# firing (low-passed: that recording is clipped, the lows survive), with a
# third layer from an isolated .50 shot for the outdoor reflection.
CRACK = 668071   # single .50 BMG shot, outdoor range
M2 = 239138      # M2 bursts (US Army footage)
# Body slices start on the muzzle blast (the M2 recording was made downrange:
# the bullet's supersonic crack arrives ~40 ms ahead of the blast and is cut),
# so every layer's rise lands within a millisecond of the close report's.
for k, (body, rate) in enumerate([
    (dict(src=M2, ss=1.7339, t=0.85, lp=1500, lp_order=2, vol=-1.5, fo=0.35), 1.00),
    (dict(src=M2, ss=0.4531, t=0.62, lp=1500, lp_order=2, vol=-1.5, fo=0.25), 0.965),
    (dict(src=162258, ss=0.0, t=0.9, rate=1.12, lp=2200, lp_order=2, vol=-4, fo=0.4, delay=0.003), 1.035),
    (dict(src=M2, ss=3.2295, t=0.5, lp=1500, lp_order=2, vol=-1.5, fo=0.2), 0.985),
]):
    oneshot(f'sfx/hmg_{k + 1}', [
        dict(src=CRACK, ss=0.0154, t=0.42, rate=rate, hp=90, fo=0.14),
        body,
        dict(src=160355, ss=3.2896, t=0.9, lp=3500, vol=-9, fo=0.45),
    ], sr=44100, ch=2, target=-11, limit=5, q=6)
# burst release: the valley throws the last rounds back
clip('sfx/hmg_tail_1', 160355, 3.36, 0.95, ch=2, fi=0.03, fo=0.55, lp=4000, target=-20, sr=32000)
clip('sfx/hmg_tail_2', M2, 1.80, 0.9, ch=2, fi=0.03, fo=0.5, lp=1800, target=-20, sr=32000)

# ── M240 wall gunners ────────────────────────────────────────────────────────
for k, (ss, t) in enumerate([(0.5509, 0.2), (0.7789, 0.2), (1.4728, 0.2), (1.6979, 0.25), (2.0968, 0.5)]):
    clip(f'sfx/mg_{k + 1}', 238916, ss, t, sr=32000, lp=7000, fo=t * 0.5, target=-13, limit=5)

# ── brass ────────────────────────────────────────────────────────────────────
for k, (src, ss, t) in enumerate([(668071, 0.755, 0.55), (210102, 0.05, 0.9), (210102, 2.15, 0.78),
                                  (210102, 7.55, 0.55), (210102, 9.9, 0.9), (834236, 1.85, 0.5)]):
    clip(f'sfx/casing_{k + 1}', src, ss, t, hp=500, norm='peak', fo=t * 0.4)

# ── explosions ───────────────────────────────────────────────────────────────
for k, (src, ss, t, fo) in enumerate([(182429, 0, 3.0, 0.8), (609587, 0, 5.3, 1.6), (231765, 0, 7.27, 2.2),
                                      (262436, 1.28, 2.65, 0.4), (262436, 3.92, 3.9, 1.2)]):
    clip(f'sfx/boom_{k + 1}', src, ss, t, ch=2, fo=fo, target=-9, limit=6, q=5)
for k, (src, ss, t, fo) in enumerate([(372086, 0, 4.38, 1.4), (149966, 0, 5.1, 1.8), (142598, 4.9, 5.1, 1.5)]):
    clip(f'sfx/boom_far_{k + 1}', src, ss, t, ch=2, sr=22050, fo=fo, target=-12)
clip('sfx/boom_sub', 255111, 0, 7.7, sr=22050, lp=180, fo=3, target=-10)

# artillery & mortar
for k, (src, ss, t, fo) in enumerate([(529239, 0.28, 3.0, 1.6), (184382, 0.985, 1.4, 0.7), (187542, 1.98, 1.6, 0.8)]):
    clip(f'sfx/mortar_{k + 1}', src, ss, t, fo=fo, target=-14)
for k, sid in enumerate([241837, 241838, 241839, 241840]):
    clip(f'sfx/incoming_{k + 1}', sid, 0, 2.2, sr=32000, fi=0.08, fo=0.06, target=-14)

# napalm: the igniter's blast, then the ditch goes up with a roar
oneshot('sfx/napalm', [dict(src=447941, ss=0.27, t=1.6, fo=0.8),
                       dict(src=33943, ss=2.9, t=6.0, fi=0.02, fo=3.0, vol=-2)], ch=2, target=-10, limit=4)

# ── bodies ───────────────────────────────────────────────────────────────────
for k, (src, ss, t) in enumerate([(423301, 1.41, 0.26), (423301, 1.75, 0.25), (423301, 2.11, 0.36),
                                  (779805, 0.0, 0.3), (555420, 0.04, 0.5)]):
    clip(f'sfx/flesh_{k + 1}', src, ss, t, sr=32000, target=-13, limit=5)
for k, (src, ss, t) in enumerate([(511194, 0.05, 0.65), (641046, 0.0, 1.0), (697829, 0.12, 1.1)]):
    clip(f'sfx/headshot_{k + 1}', src, ss, t, sr=32000, target=-12, limit=5)
for k, (src, ss, t) in enumerate([(414296, 0, 2.0), (176549, 0, 0.45), (360942, 0, 0.3), (495118, 0.07, 0.25)]):
    clip(f'sfx/gib_{k + 1}', src, ss, t, sr=32000, target=-12, limit=5)
oneshot('sfx/bloater', [dict(src=414296, ss=0, t=2.0, rate=0.8), dict(src=176549, ss=0, t=0.45, rate=0.7, vol=-3),
                        dict(src=202094, ss=0.05, t=2.0, vol=-8, delay=0.15)], sr=32000, target=-11)
clip('sfx/acid', 202094, 0.05, 2.06, sr=32000, target=-16)
clip('sfx/bodyfall', 504626, 0.07, 1.3, sr=32000, target=-15)

# ── the dead ─────────────────────────────────────────────────────────────────
GROANS = [(58626, 3.0, 2.7), (58626, 6.6, 1.7), (58626, 8.9, 2.4), (58626, 14.3, 2.2), (58626, 17.3, 4.0),
          (58626, 22.4, 4.4), (58626, 27.0, 4.5),
          (173128, 0.55, 4.4), (173128, 5.8, 1.5), (173128, 7.5, 1.5), (173128, 9.2, 4.0), (173128, 18.0, 4.5),
          (173128, 22.6, 4.9),
          (245466, 8.4, 2.4), (245466, 11.9, 1.7), (245466, 20.8, 1.8), (245466, 26.2, 3.8), (245466, 30.0, 4.2),
          (245466, 34.9, 2.9),
          (426628, 0.25, 3.4), (754438, 0.14, 0.88), (754441, 0.13, 0.5), (196722, 0.32, 2.15), (196722, 2.72, 0.9),
          (555417, 0.03, 2.6), (133974, 0.27, 2.2), (323819, 0.06, 3.3)]
for k, (src, ss, t) in enumerate(GROANS):
    clip(f'sfx/groan_{k + 1}', src, ss, t, sr=32000, hp=70, fi=0.06, fo=min(0.6, t * 0.35), target=-16, q=4)
for k, (src, ss, t) in enumerate([(222523, 0.3, 3.1), (344903, 0.05, 2.2), (536761, 0.1, 4.85),
                                  (170454, 10.44, 1.1), (170454, 8.43, 1.37)]):
    clip(f'sfx/brute_{k + 1}', src, ss, t, sr=32000, fi=0.04, fo=min(0.6, t * 0.35), target=-14, q=4)
for k, (src, ss, t) in enumerate([(435651, 0.08, 2.15), (396797, 0.2, 1.1), (179345, 0.04, 2.65)]):
    clip(f'sfx/shriek_{k + 1}', src, ss, t, sr=32000, fi=0.02, fo=min(0.5, t * 0.3), target=-14, q=4)
# a man on the walkway, when one of them gets over
for k, (src, ss, t) in enumerate([(813310, 0, 0.9), (178313, 0.98, 2.0), (166944, 0.0, 0.76), (166944, 2.71, 0.65)]):
    clip(f'sfx/death_{k + 1}', src, ss, t, sr=32000, fi=0.01, fo=t * 0.3, target=-14, q=4)

# ── sky ──────────────────────────────────────────────────────────────────────
for k, (src, ss, t, fo) in enumerate([(581124, 0.45, 6.9, 2.0), (581125, 3.45, 7.5, 2.5), (193170, 0.65, 5.5, 2.0),
                                      (486557, 1.85, 11.0, 4.0), (717845, 1.55, 7.0, 2.5), (717845, 20.1, 8.5, 3.0),
                                      (717845, 105.4, 10.0, 3.0)]):
    clip(f'sfx/thunder_{k + 1}', src, ss, t, ch=2, sr=22050, fi=0.15, fo=fo, target=-14, q=4)

# ── base, gun handling, radio ────────────────────────────────────────────────
clip('sfx/siren', 336640, 0.3, 9.0, ch=2, sr=32000, fi=0.2, fo=3.5, target=-14)
clip('sfx/klaxon', 832414, 0, 3.0, sr=32000, fo=0.3, target=-15)
clip('sfx/radio_in', 760245, 0, 0.45, sr=22050, target=-18)
clip('sfx/radio_out_1', 47646, 0, 0.4, sr=22050, target=-18)
clip('sfx/radio_out_2', 524205, 0, 0.45, sr=22050, target=-18)
clip('sfx/latch', 386777, 0.76, 0.36, target=-14)
clip('sfx/barrel_seat', 263513, 1.55, 0.22, target=-14)
clip('sfx/charge', 855599, 0.0, 0.86, target=-13)
clip('sfx/steam', 234782, 0.03, 1.36, sr=32000, target=-18)
clip('sfx/steam_long', 211096, 0.0, 5.0, sr=32000, fi=0.1, fo=2.5, target=-22)
clip('sfx/ui_click', 448394, 0.52, 0.28, target=-16)
clip('sfx/ui_hover', 256116, 0.0, 0.045, fi=0.0003, fo=0.02, target=-20, norm='peak')
oneshot('sfx/ui_buy', [dict(src=586544, ss=28.46, t=0.2), dict(src=320353, ss=2.69, t=0.3, vol=-3, delay=0.06)], target=-14)
oneshot('sfx/flare_launch', [dict(src=529239, ss=0.28, t=1.4, rate=1.5, fo=0.6),
                             dict(src=463763, ss=2.09, t=0.46, vol=-4, delay=0.05)], target=-14)
oneshot('sfx/flare_ignite', [dict(src=348766, ss=0.72, t=0.4), dict(src=348766, ss=2.0, t=3.0, fi=0.2, fo=2.0, vol=-6)],
        sr=32000, target=-16)
clip('sfx/throw_1', 463763, 2.09, 0.46, sr=32000, target=-16)
clip('sfx/throw_2', 523230, 0.0, 0.45, sr=32000, target=-16)
clip('sfx/heartbeat', 22440, 0.0, 0.7, sr=22050, target=-12)
clip('sfx/tinnitus', 365956, 3.0, 4.8, sr=32000, fi=0.05, fo=2.5, target=-20)

# ── dawn & far away ──────────────────────────────────────────────────────────
for k, (ss, t) in enumerate([(3.9, 3.2), (14.9, 3.2), (25.9, 4.2), (40.9, 3.7), (54.9, 3.8)]):
    clip(f'sfx/crow_{k + 1}', 404687, ss, t, sr=32000, fi=0.05, fo=0.6, target=-16, q=4)
clip('sfx/bell', 824588, 0, 12.0, ch=2, sr=32000, fi=0.05, fo=4.0, target=-18, q=4)
for k, (ss, t) in enumerate([(0.7, 2.0), (8.6, 1.2), (11.4, 1.9)]):
    clip(f'sfx/dog_{k + 1}', 440865, ss, t, sr=22050, fi=0.05, fo=0.4, target=-18, q=4)
for k, (src, ss, t) in enumerate([(675591, 0.1, 3.0), (675591, 5.9, 3.1), (675591, 11.6, 3.4), (854635, 0.0, 1.2)]):
    clip(f'sfx/distant_mg_{k + 1}', src, ss, t, sr=22050, lp=3500, fi=0.02, fo=0.5, target=-16, q=4)

# ── ambience beds (seamless loops) ───────────────────────────────────────────
loop('amb/rain_far', 704395, 40, 24)
loop('amb/rain_near', 507902, 10, 20)
loop('amb/wind', 30444, 20, 24)
loop('amb/wind_howl', 159509, 8, 22)
loop('amb/fire_roar', 387924, 1, 14)
loop('amb/fire_crackle', 813328, 5, 16)
loop('amb/horde_far', 669845, 2, 22)
loop('amb/horde_mid', 483592, 1, 20)
loop('amb/horde_near', 165872, 2, 24)
loop('amb/horde_surge', 763806, 12.8, 8.4, X=1.0)
loop('amb/shuffle', 189231, 3, 16)
loop('amb/war', 479568, 8, 40, X=2.0, sr=22050)
loop('amb/dawn', 427840, 2, 20)
loop('amb/flies', 46938, 2, 22, ch=1)
loop('amb/lamp', 553075, 2, 8, ch=1, X=1.0)
loop('amb/radio_static', 50750, 40, 10, ch=1, sr=22050, X=1.0, bp=(1200, 0.7))

# ── score ────────────────────────────────────────────────────────────────────
music('music/menu', 'Night Vigil', -19)
music('music/night_bed_1', 'Echoes of Time v2', -21)
music('music/night_bed_2', 'Ossuary 6 - Air', -21)
music('music/pressure_1', 'Satiate - only percussion', -19, filename='Satiate Percussion.mp3')
music('music/pressure_2', 'Steel Rods', -19)
music('music/tide', 'Stormfront', -17)
music('music/dawn', 'Peaceful Desolation', -19)
music('music/resupply', 'Thunder Dreams', -20)
music('music/fallen', 'Lost Time', -18)
music('music/victory', 'Long Road Ahead', -18)

if __name__ == '__main__':
    build(tuple(sys.argv[1:]))
