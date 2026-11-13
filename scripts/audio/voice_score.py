"""Last Bastion: automatic checks for recorded voice takes.

Used by record_voice.py to choose the best of several takes per line. Each take is
scored on:
  * words: Whisper (large-v3-turbo) transcribes it; word error rate against the
    script, so slurred, skipped, repeated or invented words lose.
  * voice: cosine similarity of its speaker embedding (Qwen3-TTS speaker encoder)
    to the character's reference, so every line sounds like the same person.
  * emotion: arousal and valence from audEERING's wav2vec2 MSP-Podcast model
    (CC BY-NC-SA 4.0; used as a meter only, nothing it outputs ships) compared
    with the arousal the line's direction calls for.
  * shape: silence, clipping and a length that is plausible for the words.
"""
import os
import re

import numpy as np
import torch
import torch.nn as nn

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.join(HERE, '.cache', 'models')

NUM = {'0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four', '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine'}


ONES = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split()
TENS = 'x x twenty thirty forty fifty sixty seventy eighty ninety'.split()


def say_number(n):
    if n < 20:
        return ONES[n]
    if n < 100:
        return TENS[n // 10] + ('' if n % 10 == 0 else ' ' + ONES[n % 10])
    if n < 1000:
        if 100 < n < 200 and n % 100 < 10:  # 105 → one oh five, as radio callers say it
            return 'one oh ' + ONES[n % 100]
        return ONES[n // 100] + ' hundred' + ('' if n % 100 == 0 else ' ' + say_number(n % 100))
    if n < 10000:
        return say_number(n // 1000) + ' thousand' + ('' if n % 1000 == 0 else ' ' + say_number(n % 1000))
    return ' '.join(ONES[int(c)] for c in str(n))


def norm_words(s):
    s = s.lower().replace('-', ' ').replace('—', ' ').replace(',', '')
    s = re.sub(r'\b0300\b', 'zero three hundred', s)
    s = re.sub(r'\d+', lambda m: ' ' + say_number(int(m.group(0))) + ' ', s)
    s = re.sub(r"[^a-z' ]+", ' ', s)
    s = s.replace("'", '')
    return [w for w in s.split() if w]


# words Whisper is free to spell its own way
EQUIV = {'okay': 'ok', 'honor': 'honour', 'oh': 'o', 'sergeant': 'sarge', 'gee': 'g',
         'clicks': 'klicks', 'one-oh-five': 'one',
         # homophones: the take is right, Whisper just spells it its own way
         'shaq': 'shack', 'flair': 'flare', 'shoot': 'chute', 'friendlys': 'friendlies', 'batteries': 'batterys'}
# Whisper splits or joins compounds differently from the script
COMPOUND = [('g b u', 'gbu'), ('tree line', 'treeline'), ('re arming', 'rearming'), ('e key', 'e'), ('the e', 'e')]


def _canon(words):
    s = ' ' + ' '.join(EQUIV.get(w, w) for w in words) + ' '
    for a, b in COMPOUND:
        s = s.replace(' ' + a + ' ', ' ' + b + ' ')
    return s.split()


def wer(ref, hyp):
    r = _canon(norm_words(ref))
    h = _canon(norm_words(hyp))
    d = np.zeros((len(r) + 1, len(h) + 1), int)
    d[:, 0] = np.arange(len(r) + 1)
    d[0, :] = np.arange(len(h) + 1)
    for i in range(1, len(r) + 1):
        for j in range(1, len(h) + 1):
            d[i, j] = min(d[i - 1, j] + 1, d[i, j - 1] + 1, d[i - 1, j - 1] + (r[i - 1] != h[j - 1]))
    return d[len(r), len(h)] / max(1, len(r))


class _Head(nn.Module):
    def __init__(self, config):
        super().__init__()
        self.dense = nn.Linear(config.hidden_size, config.hidden_size)
        self.dropout = nn.Dropout(config.final_dropout)
        self.out_proj = nn.Linear(config.hidden_size, config.num_labels)

    def forward(self, x):
        return self.out_proj(torch.tanh(self.dense(self.dropout(x))))


def _emotion_model():
    from transformers.models.wav2vec2.modeling_wav2vec2 import Wav2Vec2Model, Wav2Vec2PreTrainedModel

    class EmotionModel(Wav2Vec2PreTrainedModel):
        def __init__(self, config):
            super().__init__(config)
            self.wav2vec2 = Wav2Vec2Model(config)
            self.classifier = _Head(config)
            self.init_weights()

        def forward(self, x):
            return self.classifier(self.wav2vec2(x)[0].mean(1))
    return EmotionModel


def resample(a, sr, to):
    if sr == to:
        return a.astype(np.float32)
    from scipy import signal
    from math import gcd
    g = gcd(sr, to)
    return signal.resample_poly(a, to // g, sr // g).astype(np.float32)


class Scorer:
    def __init__(self, device='cuda:0', speaker=True):
        import whisper
        from transformers import Wav2Vec2Processor
        self.dev = device
        self.asr = whisper.load_model(os.path.join(MODELS, 'whisper', 'large-v3-turbo.pt'), device=device)
        p = os.path.join(MODELS, 'wav2vec2-large-robust-12-ft-emotion-msp-dim')
        self.emo_proc = Wav2Vec2Processor.from_pretrained(p)
        self.emo = _emotion_model().from_pretrained(p).to(device).eval()
        self.spk = None
        if speaker:
            # only the speaker encoder of the Base model, on the CPU
            from qwen_tts import Qwen3TTSModel
            base = Qwen3TTSModel.from_pretrained(os.path.join(MODELS, 'Qwen3-TTS-12Hz-1.7B-Base'), device_map='cpu', dtype=torch.float32)
            self.spk_model = base.model
            self.spk_sr = base.model.speaker_encoder_sample_rate

    def transcribe(self, a, sr):
        x = resample(a, sr, 16000)
        r = self.asr.transcribe(x, language='en', fp16=self.dev != 'cpu', temperature=0.0, condition_on_previous_text=False)
        return r['text'].strip()

    @torch.no_grad()
    def emotion(self, a, sr):
        """(arousal, dominance, valence), each roughly 0..1."""
        x = resample(a, sr, 16000)
        v = self.emo_proc(x, sampling_rate=16000)['input_values'][0]
        y = self.emo(torch.from_numpy(np.asarray(v)[None]).to(self.dev))
        return [float(t) for t in y[0].cpu()]

    @torch.no_grad()
    def embed(self, a, sr):
        x = resample(a, sr, self.spk_sr)
        e = self.spk_model.extract_speaker_embedding(audio=x, sr=self.spk_sr)
        e = e.detach().float().cpu().numpy().reshape(-1)
        return e / (np.linalg.norm(e) + 1e-9)

    def score(self, a, sr, text, ref_emb=None, target_arousal=None):
        a = np.asarray(a, np.float32)
        hyp = self.transcribe(a, sr)
        w = wer(text, hyp)
        aro, dom, val = self.emotion(a, sr)
        sim = float(np.dot(self.embed(a, sr), ref_emb)) if ref_emb is not None and self.spk_model is not None else None
        nw = len(norm_words(text))
        dur = len(a) / sr
        # longest internal silence
        fr = int(0.02 * sr)
        env = np.array([np.sqrt(np.mean(a[i:i + fr] ** 2)) for i in range(0, max(1, len(a) - fr), fr)])
        thr = max(1e-4, np.max(env) * 0.03)
        gaps, run = [], 0
        for v in env:
            run = run + 1 if v < thr else 0
            gaps.append(run)
        longest_gap = max(gaps) * 0.02 if gaps else 0
        clip = float(np.mean(np.abs(a) > 0.99))
        return dict(hyp=hyp, wer=round(w, 3), arousal=round(aro, 3), dominance=round(dom, 3), valence=round(val, 3),
                    sim=None if sim is None else round(sim, 3), dur=round(dur, 2), wps=round(nw / max(dur, 0.1), 2),
                    gap=round(longest_gap, 2), clip=round(clip, 4))


def pick_score(s, target_arousal=None):
    """Higher is better: words must be right, then voice, then emotion."""
    v = -6.0 * s['wer']
    if s['sim'] is not None:
        v += 3.0 * s['sim']
    if target_arousal is not None:
        v -= 2.5 * abs(s['arousal'] - target_arousal)
    if s['wps'] > 4.8 or s['wps'] < 1.2:
        v -= 1.0
    if s['gap'] > 1.4:
        v -= 1.0
    v -= 20 * s['clip']
    return v
