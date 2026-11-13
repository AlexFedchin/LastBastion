"""Last Bastion: record the radio lines with Qwen3-TTS (stage 1 of the voice build).

Every line is performed from a written direction (voice_cast.py): the Qwen3-TTS
1.7B VoiceDesign model (Apache 2.0, Alibaba Qwen) is given the character's voice
description plus how this line should be delivered, and records several takes.
Stage 2 (convert_voice.py, Chatterbox voice conversion) maps each take onto the
character's reference voice; stage 3 (pick_voice.py) scores all of them and
keeps the best; build_voice.py then puts the chosen takes through the radio chain.

Runs in the GPU environment (see docs/VOICEOVER.md):
    scripts/audio/.cache/venv-qwen/Scripts/python scripts/audio/record_voice.py [filter...] [--takes N]
Resumable: takes already on disk are kept.
"""
import hashlib
import os
import re
import sys

import numpy as np
import soundfile as sf
import torch

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from build_voice import SPOKEN, radio_lines  # noqa: E402
from voice_cast import PERSONA, REF_TEXT, SAME_VOICE, direction  # noqa: E402

CACHE = os.path.join(HERE, '.cache')
MODELS = os.path.join(CACHE, 'models')
WORK = os.path.join(CACHE, 'voice_qwen')
RAW = os.path.join(WORK, 'raw')
REFS = os.path.join(WORK, 'refs')
SR = 24000


def line_id(who, text):
    return re.sub(r'[^a-z0-9]+', '_', who.lower()).strip('_') + '_' + hashlib.sha1((who + '|' + text).encode()).hexdigest()[:10]


def segments(text):
    """The line as spoken text; '(static)' splits it where the signal breaks up."""
    out = []
    for chunk in re.split(r'\(static\)', text):
        t = chunk.strip()
        for pat, rep in SPOKEN:
            if pat == r'\s*—\s*':
                continue  # keep the dash: Qwen phrases it as a break
            t = re.sub(pat, rep, t)
        t = re.sub(r'\s*—\s*', ' — ', t)
        t = re.sub(r'^(\.\.\.|[ ,])+', '', t)          # leading trail-in
        t = re.sub(r'(\.\.\.|[-—,\s])+$', lambda m: '...' if '...' in m.group(0) else '', t)
        if t and not re.search(r'[.!?…]$', t):
            t += '...' if chunk.rstrip().endswith(('—', '...')) else '.'
        if re.search(r'[A-Za-z]', t):
            out.append(t[0].upper() + t[1:])
    return out


def instruct(who, text):
    d, intensity = direction(who, text)
    return PERSONA[who] + ' Delivery: ' + d


def load(name):
    from qwen_tts import Qwen3TTSModel
    return Qwen3TTSModel.from_pretrained(os.path.join(MODELS, name), device_map='cuda:0', dtype=torch.bfloat16, attn_implementation='sdpa')


def trim(a, thr=0.008):
    idx = np.where(np.abs(a) > thr)[0]
    if not len(idx):
        return a
    return a[max(0, idx[0] - int(0.03 * SR)): idx[-1] + int(0.08 * SR)]


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    n_takes = int(next((a.split('=')[1] for a in sys.argv if a.startswith('--takes=')), 5))
    os.makedirs(RAW, exist_ok=True)
    os.makedirs(REFS, exist_ok=True)
    model = load('Qwen3-TTS-12Hz-1.7B-VoiceDesign')

    # reference voice per character (what voice conversion maps onto): a few candidates, pick_voice chooses
    for who in PERSONA:
        if who in SAME_VOICE:
            continue
        for k in range(3):
            p = os.path.join(REFS, f'{line_id(who, "ref")}_{k}.wav')
            if os.path.exists(p):
                continue
            torch.manual_seed(7 + k)
            w, sr = model.generate_voice_design(text=REF_TEXT[who], language='English', instruct=PERSONA[who])
            sf.write(p, trim(w[0]), sr)
        print('  ref', who, flush=True)

    lines = radio_lines()
    for n, (who, text, _) in enumerate(lines):
        if args and not any(a.lower() in (who + ' ' + text).lower() for a in args):
            continue
        lid = line_id(who, text)
        todo = [k for k in range(n_takes) if not os.path.exists(os.path.join(RAW, f'{lid}_{k}.wav'))]
        if not todo:
            continue
        segs = segments(text)
        ins = instruct(who, text)
        seed = int(hashlib.sha1(lid.encode()).hexdigest()[:8], 16)
        torch.manual_seed(seed + todo[0])
        # one batch per segment: all the missing takes at once
        per_seg = []
        for s in segs:
            w, sr = model.generate_voice_design(text=[s] * len(todo), language=['English'] * len(todo), instruct=[ins] * len(todo))
            per_seg.append([trim(x.astype(np.float32)) for x in w])
        for j, k in enumerate(todo):
            parts = [per_seg[i][j] for i in range(len(segs))]
            gap = np.zeros(int(0.75 * SR), np.float32)  # where '(static)' goes
            a, marks = parts[0], []
            for p in parts[1:]:
                marks.append([len(a), len(a) + len(gap)])
                a = np.concatenate([a, gap, p])
            if marks:
                np.save(os.path.join(RAW, f'{lid}_marks.npy'), np.array(marks, np.int64))
            sf.write(os.path.join(RAW, f'{lid}_{k}.wav'), a, SR)
        print(f'  [{n + 1}/{len(lines)}] {who:12s} {text[:60]}', flush=True)


if __name__ == '__main__':
    main()
