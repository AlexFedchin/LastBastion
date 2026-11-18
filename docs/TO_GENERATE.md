# To generate

Assets the code already uses or expects, but which have not been generated yet. Nothing here is
generated automatically. Each item says how to make it once you decide to run it.

Nothing is outstanding right now. Every line in `allRadioLines()` (286 on 2026-11-18) has a take in
`app/audio/voice/lines.json`; `tests/smoke/tests/01-boot.test.js` fails and lists any that don't.

## Done (2026-11-18)

- **The hangar's crew lines** (16, `DELIVERY_LINES`): 9 for Cpl. Voss, the quartermaster (a new voice,
  designed from his persona in `voice_cast.py`, on the handheld radio chain), 3 for the battery, 2 for
  Kovac, 2 for Aran.
- **The prologue** (8, `PROLOGUE`): 5 for the narrator, 2 for Kovac and 1 for Aran over the radio. The shots
  re-time themselves to the takes.
- **Kovac's night-start line** (17 pieces): the sentence is assembled from what was bought, so it is
  voiced in pieces: `ISSUE_OPEN` plus one sentence per item (`issueSpoken(ISSUE_LINES[id])`), played
  back to back by `audio.radioParts`. If any piece is missing, the line stays text-only.

Review page with all 41 takes: https://claude.ai/artifact/E4pGBEH7KFxduCYMQXeCGv

## How to record new lines

Add the line to the code (it must come out of `allRadioLines()`), give it a direction in
`scripts/audio/voice_cast.py` and, for a new speaker, a persona, reference line and default direction
there plus a radio chain in `CAST` in `scripts/audio/build_voice.py` (a speaker missing from `CAST` is
skipped by the build with "no voice cast"). Then run every stage (GPU; environments and models as in
`docs/VOICEOVER.md`). Each one skips work already on disk:

```bash
Q=scripts/audio/.cache/venv-qwen/Scripts/python.exe
C=scripts/audio/.cache/venv-cb/Scripts/python.exe
$Q scripts/audio/record_voice.py
$Q scripts/audio/pick_voice.py --refs     # designs reference voices only for new speakers
$C scripts/audio/convert_voice.py
$Q scripts/audio/pick_voice.py
$Q scripts/audio/build_voice.py "<phrase unique to the new lines>"
```

Pass `build_voice.py` a filter. Without one it rebuilds every line: every .ogg gets new bytes, and
`pick_voice.py` can settle on a different take for a few old lines. On 2026-11-18 that happened to 8
lines; the old takes were restored from git.

## Not needed

- **The first-night tips** (`src/ui/coach.js`) are a text panel, not radio, and mention mouse buttons
  and keys, so they are meant to be read, not voiced.
