"""Last Bastion: voice conversion of the recorded takes (stage 2 of the voice build).

Qwen3-TTS designs a fresh voice for every line from the same description, so
the same character can drift between lines. Chatterbox VC (MIT, Resemble AI)
re-voices a take onto one reference clip per character while keeping its
timing, pitch and emotion. pick_voice.py later decides per line whether the raw
take or the converted one is better.

Runs in the Chatterbox environment (see docs/VOICEOVER.md):
    scripts/audio/.cache/venv-cb/Scripts/python scripts/audio/convert_voice.py
Needs scripts/audio/.cache/voice_qwen/refs/chosen.json (written by pick_voice.py --refs).
"""
import json
import os
import sys

import soundfile as sf

import perth
if getattr(perth, 'PerthImplicitWatermarker', None) is None:  # its native part fails to load on some installs
    perth.PerthImplicitWatermarker = perth.DummyWatermarker
from chatterbox.vc import ChatterboxVC  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(HERE, '.cache', 'voice_qwen')
RAW, VC, REFS = (os.path.join(WORK, d) for d in ('raw', 'vc', 'refs'))


def main():
    chosen = json.load(open(os.path.join(REFS, 'chosen.json')))  # line-id prefix (speaker slug) -> ref wav
    os.makedirs(VC, exist_ok=True)
    vc = ChatterboxVC.from_local(os.path.join(HERE, '.cache', 'models', 'chatterbox'), 'cpu' if '--cpu' in sys.argv else 'cuda')
    files = sorted(f for f in os.listdir(RAW) if f.endswith('.wav') and not f.endswith('_marks.wav'))
    if '--limit' in sys.argv:
        files = files[:int(sys.argv[sys.argv.index('--limit') + 1])]
    cur = None
    for i, f in enumerate(files):
        out = os.path.join(VC, f)
        if os.path.exists(out):
            continue
        spk = f.rsplit('_', 2)[0]
        ref = os.path.join(REFS, chosen[spk])
        if ref != cur:
            vc.set_target_voice(ref)
            cur = ref
        w = vc.generate(os.path.join(RAW, f))
        sf.write(out, w[0].cpu().numpy(), vc.sr)
        if i % 25 == 0:
            print(f'  {i + 1}/{len(files)} {f}', flush=True)
    print('converted', len(files))


if __name__ == '__main__':
    sys.exit(main())
