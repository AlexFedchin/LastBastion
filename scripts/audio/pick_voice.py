"""Last Bastion: score every take and keep the best one per line (stage 3 of the voice build).

    python pick_voice.py --refs   # after record_voice.py: choose each character's reference voice
    python pick_voice.py          # after convert_voice.py: pick the take for every line

Candidates per line: each raw Qwen3-TTS take and its voice-converted twin. Each
is scored (voice_score.py) on the words (Whisper WER), the emotion (arousal
against the intensity the direction asks for) and whether it sounds like the
same person as the character's other lines (WavLM speaker-verification
embedding, measured on the clean take: the radio chain hides most of the
difference, and drift it hides on one line it may not hide on the next).

Writes voice_qwen/chosen/<line>.npz (float32 24 kHz + static marks, what
build_voice.py reads) and voice_qwen/selection.json (every score, for review).
Runs in the GPU environment (venv-qwen).
"""
import json
import os
import sys

import numpy as np
import soundfile as sf
import torch
from scipy import signal

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from build_voice import radio_lines  # noqa: E402
from record_voice import PERSONA, REFS, RAW, SAME_VOICE, WORK, line_id, segments  # noqa: E402
from voice_cast import direction  # noqa: E402
from voice_score import MODELS, wer  # noqa: E402

VC = os.path.join(WORK, 'vc')
CHOSEN = os.path.join(WORK, 'chosen')
SR = 24000


class Speaker:
    """WavLM x-vector (microsoft/wavlm-base-plus-sv, MIT): tells voices apart."""

    def __init__(self, dev):
        from transformers import AutoFeatureExtractor, WavLMForXVector
        p = os.path.join(MODELS, 'wavlm-base-plus-sv')
        self.fe = AutoFeatureExtractor.from_pretrained(p)
        self.m = WavLMForXVector.from_pretrained(p).to(dev).eval()
        self.dev = dev

    @torch.no_grad()
    def __call__(self, a16):
        x = self.fe(a16, sampling_rate=16000, return_tensors='pt').to(self.dev)
        e = self.m(**x).embeddings[0].float().cpu().numpy()
        return e / (np.linalg.norm(e) + 1e-9)


def read24(p):
    a, sr = sf.read(p, dtype='float32')
    if a.ndim > 1:
        a = a.mean(1)
    if sr != SR:
        from math import gcd
        g = gcd(sr, SR)
        a = signal.resample_poly(a, SR // g, sr // g).astype(np.float32)
    return a


def to16(a):
    return signal.resample_poly(a, 2, 3).astype(np.float32)


def slug_of(who):
    return line_id(who, 'x').rsplit('_', 1)[0]


def centroid(E, keep=0.6):
    """Mean embedding, refined on the takes nearest to it (outliers out)."""
    E = np.asarray(E)
    c = E.mean(0)
    c /= np.linalg.norm(c)
    for _ in range(2):
        s = E @ c
        top = E[np.argsort(-s)[:max(1, int(len(E) * keep))]]
        c = top.mean(0)
        c /= np.linalg.norm(c)
    return c


def voice_of(who):
    return SAME_VOICE.get(who, who)


def pick_refs(spk):
    by = {}
    for f in os.listdir(RAW):
        if f.endswith('.wav'):
            by.setdefault(f.rsplit('_', 2)[0], []).append(f)
    chosen = {}
    for v in PERSONA:
        if v in SAME_VOICE:
            continue
        files = [f for w in PERSONA if voice_of(w) == v for f in by.get(slug_of(w), [])]
        if not files:
            continue
        c = centroid([spk(to16(read24(os.path.join(RAW, f)))) for f in files])
        rs = sorted(f for f in os.listdir(REFS) if f.startswith(slug_of(v) + '_') and f.endswith('.wav'))
        sims = [float(spk(to16(read24(os.path.join(REFS, r)))) @ c) for r in rs]
        chosen[slug_of(v)] = rs[int(np.argmax(sims))]
        print(f'  {v:12s} ref {chosen[slug_of(v)]}  sims {np.round(sims, 3).tolist()}')
    for who, v in SAME_VOICE.items():
        chosen[slug_of(who)] = chosen[slug_of(v)]
    json.dump(chosen, open(os.path.join(REFS, 'chosen.json'), 'w'), indent=1)


def main():
    dev = 'cpu' if '--cpu' in sys.argv else 'cuda:0'
    spk = Speaker(dev)
    if '--refs' in sys.argv:
        return pick_refs(spk)
    from voice_score import Scorer
    sc = Scorer(dev, speaker=False)
    os.makedirs(CHOSEN, exist_ok=True)
    lines = radio_lines()
    cands = {}  # line id -> list of candidate dicts
    for who, text, shout in lines:
        lid = line_id(who, text)
        mk = os.path.join(RAW, f'{lid}_marks.npy')
        marks = [tuple(x) for x in np.load(mk)] if os.path.exists(mk) else []
        for k in range(20):
            for kind, d in (('raw', RAW), ('vc', VC)):
                p = os.path.join(d, f'{lid}_{k}.wav')
                if os.path.exists(p):
                    a = read24(p)
                    cands.setdefault(lid, []).append(dict(who=who, text=text, kind=kind, k=k, path=p, marks=marks,
                                                          a=a, emb=spk(to16(a))))
    # identity anchor per voice, over every candidate of that voice
    anchors = {}
    for v in {voice_of(w) for w, _, _ in lines}:
        E = [c['emb'] for cs in cands.values() for c in cs if voice_of(c['who']) == v]
        if E:
            anchors[v] = centroid(E)
    cache_path = os.path.join(WORK, 'score_cache.json')
    cache = json.load(open(cache_path, encoding='utf-8')) if os.path.exists(cache_path) else {}
    sel = {}
    for n, (who, text, shout) in enumerate(lines):
        lid = line_id(who, text)
        if lid not in cands:
            print('  !! no takes for', who, text)
            continue
        d, intensity = direction(who, text)
        target = 0.42 + 0.55 * intensity
        spoken = ' '.join(segments(text))
        rows = []
        for c in cands[lid]:
            ck = os.path.relpath(c['path'], WORK) + '@' + str(int(os.path.getmtime(c['path'])))
            if ck not in cache:
                cache[ck] = sc.score(c['a'], SR, spoken)
            s = dict(cache[ck])
            s['wer'] = round(wer(spoken, s['hyp']), 3)  # rescored from the transcript, so word rules can change
            s['sim'] = round(float(c['emb'] @ anchors[voice_of(who)]), 3)
            v = -10.0 * s['wer'] + 6.0 * s['sim'] - 3.0 * abs(s['arousal'] - target)
            v -= 1.0 if (s['wps'] > 5.0 or s['wps'] < 1.0) else 0
            v -= 1.0 if s['gap'] > (1.6 if c['marks'] else 1.3) else 0
            v -= 20 * s['clip']
            s.update(kind=c['kind'], k=c['k'], score=round(v, 3), file=os.path.relpath(c['path'], WORK))
            rows.append((v, s, c))
        rows.sort(key=lambda r: -r[0])
        best = rows[0][2]
        np.savez(os.path.join(CHOSEN, lid + '.npz'), a=best['a'], m=np.array(best['marks'], np.int64).reshape(-1, 2))
        sel[who + '|' + text] = dict(id=lid, direction=d, intensity=intensity, target_arousal=round(target, 3),
                                     takes=[r[1] for r in rows])
        b = rows[0][1]
        print(f"  [{n + 1}/{len(lines)}] {who:12s} {b['kind']:3s}#{b['k']} wer={b['wer']:.2f} sim={b['sim']:.2f} "
              f"aro={b['arousal']:.2f}/{target:.2f}  {text[:50]}", flush=True)
        if n % 10 == 9:
            json.dump(cache, open(cache_path, 'w', encoding='utf-8'), ensure_ascii=False)
    json.dump(cache, open(cache_path, 'w', encoding='utf-8'), ensure_ascii=False)
    json.dump(sel, open(os.path.join(WORK, 'selection.json'), 'w', encoding='utf-8'), indent=1, ensure_ascii=False)


if __name__ == '__main__':
    main()
