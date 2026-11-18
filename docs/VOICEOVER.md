# Radio voice-over: how it is made

Every radio line in the game (`allRadioLines()` in `src/config.js`) is performed by an
open-weight TTS model from a written direction, recorded in several takes, scored
automatically, and put through the game's radio chain. All of it runs locally.

```
voice_cast.py      who each character is, and how each line is played
      │
record_voice.py    Qwen3-TTS 1.7B VoiceDesign: 5 directed takes per line        (GPU env: venv-qwen)
      │
pick_voice.py --refs   choose each character's reference voice                  (venv-qwen)
      │
convert_voice.py   Chatterbox VC: each take also re-voiced onto that reference  (GPU env: venv-cb)
      │
pick_voice.py      score all 10 candidates per line, keep the best              (venv-qwen)
      │
build_voice.py     radio chain → app/audio/voice/*.ogg + lines.json             (any Python with numpy/scipy/soundfile)
```

## Why this pipeline

Tested in November 2026 on six lines spanning the emotional range, against Kokoro, the
engine it replaced. Measured arousal (audEERING
wav2vec2 emotion model; 0 = calm, 1 = screaming), mean over three takes:

| Line | Qwen3-TTS directed (A) | Qwen3-TTS clone (B) | Chatterbox (C) | A + voice conversion (D) |
|---|---|---|---|---|
| Kovac, panic | **0.93** | 0.65 | 0.70 | 0.73 |
| Kovac, dread | 0.54 | 0.65 | 0.62 | 0.52 |
| Kovac, anguish | **0.91** | 0.68 | 0.59 | 0.74 |
| Command, grim calm | 0.46 | 0.59 | 0.50 | 0.48 |
| Civilian, desperate | 0.51 | 0.43 | 0.64 | 0.44 |
| Spectre, cool | 0.68 | 0.61 | 0.51 | 0.59 |

Only directed Qwen3-TTS follows the script's emotional range. Its weakness is identity: every
line designs the voice afresh from the description, so a character drifts. Speaker similarity
(WavLM speaker verification) across Kovac's lines: A 0.85 (worst pair 0.69), B/C 0.955, D 0.92.
Picking the best of five takes per line, and letting the voice-converted twin win where the raw
take drifted, gets most of both.

## Running it

The recording environments are not part of the repo. Both live in the gitignored
`scripts/audio/.cache/`, along with the models (~40 GB; Qwen3-TTS VoiceDesign/Base/CustomVoice,
the tokenizer, Chatterbox, Whisper large-v3-turbo, WavLM-SV, the emotion model).

```bash
cd scripts/audio/.cache
# uv (https://github.com/astral-sh/uv) makes isolated Python 3.11 envs; UV_NATIVE_TLS=1 if an
# antivirus intercepts HTTPS
uv venv --python 3.11 venv-qwen
uv pip install --python venv-qwen/Scripts/python.exe torch torchaudio --index-url https://download.pytorch.org/whl/cu128
uv pip install --python venv-qwen/Scripts/python.exe qwen-tts openai-whisper truststore "torch==2.11.0+cu128" "torchaudio==2.11.0+cu128" \
    --extra-index-url https://download.pytorch.org/whl/cu128 --index-strategy unsafe-best-match
uv venv --python 3.11 venv-cb
uv pip install --python venv-cb/Scripts/python.exe chatterbox-tts "torch==2.6.0+cu124" "torchaudio==2.6.0+cu124" \
    --extra-index-url https://download.pytorch.org/whl/cu124 --index-strategy unsafe-best-match
```

Models go into `scripts/audio/.cache/models/<repo name>` (`huggingface_hub.snapshot_download(repo,
local_dir=...)`): `Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign`, `Qwen/Qwen3-TTS-12Hz-1.7B-Base`,
`Qwen/Qwen3-TTS-Tokenizer-12Hz`, `ResembleAI/chatterbox`, `microsoft/wavlm-base-plus-sv`,
`audeering/wav2vec2-large-robust-12-ft-emotion-msp-dim`, and Whisper `large-v3-turbo` into `models/whisper`.

Then, from the repo root (an 8 GB RTX 3070 Ti takes about two hours for all 111 lines):

```bash
Q=scripts/audio/.cache/venv-qwen/Scripts/python.exe
C=scripts/audio/.cache/venv-cb/Scripts/python.exe
$Q scripts/audio/record_voice.py            # or: record_voice.py KOVAC  (only matching lines)
$Q scripts/audio/pick_voice.py --refs
$C scripts/audio/convert_voice.py
$Q scripts/audio/pick_voice.py
$Q scripts/audio/build_voice.py
```

Each stage skips work already on disk. To re-record a line, delete its takes from
`.cache/voice_qwen/raw/` and `vc/` (files start with the speaker slug and a hash of the line) and
run the stages again. `build_voice.py --kokoro` rebuilds the original Kokoro voice-over.

Adding lines without touching the rest: pass the same filter to every stage, e.g. `NARRATOR`.
`pick_voice.py NARRATOR` re-picks only matching lines (the others keep the take they have, and
`selection.json` keeps their scores), and `pick_voice.py --refs` keeps every character's existing
reference voice and only chooses one for a new character. Their converted takes were made on that
reference, so changing it would split a voice in two.

### The narrator

The dawn chronicle (`CHRONICLE` in `src/config.js`, composed in `src/ui/chronicle.js`) is spoken by
`NARRATOR`, an old soldier telling the siege years later. Same recording, conversion and scoring as
the radio cast, but `build_voice.py` gives him no radio: a close voice-over chain (rumble filter,
gentle compression, a little body and presence, about −18 dBFS speech RMS) kept at 24 kHz.
`lines.json` records the rate (`"sr": 24000`) so the game decodes it at full bandwidth; radio lines
stay at 16 kHz.

## Directing a line

Edit `scripts/audio/voice_cast.py`:

- `PERSONA` is the character's voice, written as a casting note (age, register, accent, texture).
  Keep it identical for all of a character's lines; it is what keeps the voice recognisable.
- `DIRECTION[text] = (note, intensity)`. The note is how an actor would be told to play it
  ("starting low and shaken, then building to a fierce shouted order"). Intensity 0..1 sets the
  arousal the scorer looks for (target = 0.42 + 0.55 × intensity).
- A changed direction does not invalidate old takes on its own: delete the line's takes to record again.

## What the scorer checks

`pick_voice.py` scores each candidate (`voice_score.py`):

- **Words:** Whisper large-v3-turbo transcribes the take, and its word error rate against the
  script is the heaviest term. Numbers are normalised, so "72" counts as "seventy-two".
- **Same voice:** WavLM x-vector similarity to the character's typical voice, measured on the clean
  take. The radio chain squeezes every voice into the same narrow band (similarities 0.91–0.99), so
  measured after it the score barely separates takes.
- **Emotion:** arousal against the direction's target.
- **Shape:** pace in words per second, long silences, clipping.

The emotion model is CC BY-NC-SA 4.0. It is used only as a meter: nothing it outputs ships, and
the game contains no part of it. Whisper and WavLM are MIT.

`.cache/voice_qwen/selection.json` keeps every candidate's scores and Whisper transcript, for review.
