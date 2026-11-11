# Voice-over: options for replacing Kokoro

The radio lines are currently voiced with **Kokoro-82M** (`scripts/audio/build_voice.py`).
It sounds clean, but the intonation, pauses and emotion are flat: a panicked sergeant
and a calm HQ operator are delivered the same way.

This note records what was tested (November 2026) and the options to try next.

## What was tested

Same lines, same character voices (each new model **cloned the character's current
Kokoro voice** from ~10 s of its existing takes), through the game's own radio chain
(`radio()` in `build_voice.py`), compared side by side with the in-game takes.

| Engine | Licence | Result |
|---|---|---|
| **Chatterbox** (Resemble AI, 0.5B) | MIT | **Clearly much better than Kokoro.** Tested on 3 Kovac lines (panic, dread, anguish) with emotion intensity ("exaggeration") at 0.7–0.95 |
| Chatterbox Turbo | MIT | Not tested: free GPU quota ran out |
| IndexTTS 2.5 (bilibili) | bilibili Model Use Licence (commercial use only by contacting bilibili) | Not tested: quota |
| Dia 1.6B (Nari Labs) | Apache 2.0 | Not tested: quota |

The tests ran on the free **Hugging Face Spaces** demos (ZeroGPU). Anonymous use is
capped at roughly 3 generations in total across all Spaces; a free HF account
token raises that, but the daily quota is still small.

## Plan A: Chatterbox (known good)

Swap Kokoro for Chatterbox inside `take()` in `build_voice.py`; everything else stays
(line list, caching, radio chain, `lines.json`).

- **Voices:** keep the current casting by cloning: per character, render ~10 s of
  its current Kokoro voice once and use it as the reference (`audio_prompt_path`).
  Or record/choose new reference voices per character.
- **Emotion per line:** `exaggeration` ~0.9–1.0 for shouts, pleas and panic (BARKS,
  the survivor, breaches), ~0.6–0.7 for tense lines, ~0.35–0.45 for Command, the
  battery and aircrew. A lower `cfg_weight` (~0.3) gives more dramatic pacing.
- **Pauses:** Chatterbox can rush `...`; keep `spoken_parts()`, which splits lines on
  `...` and inserts real silence.
- **Running it:**
  - **Locally, CPU only:** `pip install chatterbox-tts` (PyTorch CPU + ~2–3 GB of
    weights). Roughly 20–60 min for all ~180 lines on an 8-core CPU, one time only;
    the takes are cached.
  - **Locally with an NVIDIA GPU:** a few minutes for everything.
  - **Chatterbox Turbo** additionally understands inline cues such as `[sigh]`,
    `[gasp]`, `[groan]`, `[sniff]`, `[cough]`, `[chuckle]`. Worth A/B testing against
    the regular model on the emotional lines.
- **Credits:** add Chatterbox (MIT, Resemble AI) to `app/audio/CREDITS.md` and the
  README, replacing Kokoro.

## Plan B: stronger local models (needs a proper GPU)

These are likely **better than Chatterbox at emotion and delivery**, but need a GPU
to be practical. **Licences and VRAM figures below come from secondary sources:
check each model card before shipping anything made with it.**

| Model | Licence (verify) | VRAM (approx.) | Why it might beat Chatterbox |
|---|---|---|---|
| **IndexTTS-2 / 2.5** (bilibili) | bilibili Model Use Licence: **not free for commercial use** | ~8–12 GB | Best emotion control tested in papers: emotion is separate from the voice, set by sliders (happy/angry/sad/afraid/…), a reference clip or a text description. Also precise duration control |
| **Qwen3-TTS** (0.6B / 1.7B, Alibaba) | Apache 2.0 | 6 GB+ | Natural-language direction of delivery ("terrified, whispering", "barking orders over gunfire"), voice cloning, voice design from a description |
| **Step-Audio-EditX** (StepFun) | Apache 2.0 | ~7 GB | Generates, then *edits* a take: 14 emotions and 32 speaking styles, paralinguistics (breathing, laughing, sighing), iterative refinement of a line |
| **CosyVoice 3** (Alibaba FunAudioLLM, 0.5B) | Apache 2.0 | ~5–6 GB | Instruction control of emotion and style, paralinguistic tags, strong cloning |
| **Higgs Audio v2** (Boson AI, 3B on Llama 3.2) | unclear: Llama-based, check terms (v3 is research-only) | 16–24 GB | Very expressive, natural prosody, good at multi-speaker dialogue |
| **Orpheus TTS** (Canopy Labs, 3B on Llama) | Apache 2.0 (Llama base, check) | ~8–16 GB (GGUF via llama.cpp runs on less) | Human-like intonation and inline emotive tags (`<sigh>`, `<gasp>`, `<laugh>`…) |
| **Dia 1.6B** (Nari Labs) | Apache 2.0 | ~10 GB | Dramatic dialogue with nonverbals (screams, sobs, gasps). Can be over the top; best for the survivor/panic lines |

**Suggested order on a GPU PC:**
1. **Qwen3-TTS** and **CosyVoice 3**: permissive licences, modest VRAM, emotion by instruction.
2. **Step-Audio-EditX**: if a line needs fixing, edit the take instead of re-rolling it.
3. **IndexTTS-2**: as the quality benchmark. Only ship with it if bilibili's licence allows.
4. **Higgs Audio v2 / Orpheus**: if VRAM allows; check licences first.

**Easiest way to try many at once:** [TTS-Audio-Suite](https://github.com/diodiogod/TTS-Audio-Suite)
(ComfyUI nodes) runs Qwen3-TTS, CosyVoice 3, Step-Audio-EditX, IndexTTS-2,
Chatterbox, F5-TTS, Higgs Audio and VibeVoice from one install.

**Avoid for shipping:** F5-TTS and Fish Speech / OpenAudio weights are
non-commercial (CC-BY-NC).

## How to compare fairly

1. **Same test lines:** use these six, which cover the emotional range:
   - SGT. KOVAC: "It's at the wall! It's tearing the wall apart — kill it!" (panic)
   - SGT. KOVAC: "Something big coming down the road... my God, look at the size of it." (dread)
   - SGT. KOVAC: "Danger close! Everything on the wall line — God forgive us." (anguish)
   - COMMAND: "Bastion-7, relief column delayed. Bridge at Halden is down. Keep the gate shut." (grim, calm)
   - UNKNOWN: "...anyone on this frequency... we're at the overpass, we have children with us, please—" (desperate civilian)
   - SPECTRE 2-1: "Bastion-7, Spectre two-one on station overhead. We'll work the crowds in the field — you hold that wall." (cool aircrew)
2. **Same voices:** clone from each character's current takes, so you judge delivery, not casting.
3. **Same radio chain:** pass every take through `radio()` in `build_voice.py` (input:
   float32 mono at 24 kHz). Also listen to the clean take: the radio chain hides a
   lot, good and bad.
4. **Spell out call signs:** write "Bastion-7" as "Bastion Seven" (see `SPOKEN` in
   `build_voice.py`).

## Sources

- [Chatterbox model card](https://huggingface.co/ResembleAI/chatterbox) · [IndexTTS GitHub](https://github.com/index-tts/index-tts) · [IndexTTS-2 model card](https://huggingface.co/IndexTeam/IndexTTS-2)
- [TTS-Audio-Suite](https://github.com/diodiogod/TTS-Audio-Suite) · [Instavar: which TTS model (2026)](https://instavar.com/research/tts/choose-a-tts-model) · [Yaps: best local TTS, licences checked (2026)](https://www.yaps.ai/blog/best-local-tts-models)
- [Pinggy: self-hosted TTS 2026](https://pinggy.io/blog/best_open_source_self_hosted_text_to_speech_models/) · [texttolab: open-source TTS ranked](https://texttolab.com/blog/open-source-text-to-speech) · [localclaw: local TTS guide 2026](https://localclaw.io/blog/local-tts-guide-2026)
- [On the Emotion Understanding of Synthesized Speech (arXiv 2603.16483)](https://arxiv.org/pdf/2603.16483)
