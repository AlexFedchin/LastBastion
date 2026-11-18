# To generate

Assets the code already uses or expects, but which have not been generated yet. Nothing here is
generated automatically. Each item says how to make it once you decide to run it.

## Voice: the full list is items 1 and 2 (24 lines)

Checked against the code on 2026-11-18: of the 269 lines in `allRadioLines()`, 245 have a take in
`app/audio/voice/lines.json`, and the 24 without one are exactly the lines in items 1 and 2. No code
path speaks any text outside `allRadioLines()`, except Kovac's assembled night-start line (item 3).
Each of the 24 lines now has its own direction in `scripts/audio/voice_cast.py`, like every other line.

**How to record them** (GPU; environments and models as in `docs/VOICEOVER.md`). `build_voice.py` on
its own is not enough: it only builds from takes that are already recorded, and it stops at the first
line that has none. Run every stage. Each one skips work already on disk, so only the 24 new lines
are recorded:

```bash
Q=scripts/audio/.cache/venv-qwen/Scripts/python.exe
C=scripts/audio/.cache/venv-cb/Scripts/python.exe
$Q scripts/audio/record_voice.py
$Q scripts/audio/pick_voice.py --refs     # designs a reference voice for CPL. VOSS only; keeps the others
$C scripts/audio/convert_voice.py
$Q scripts/audio/pick_voice.py
$Q scripts/audio/build_voice.py           # no filter: rebuilds lines.json and drops the 10 stale takes
```

`lines.json` still holds 10 takes for lines that have since been cut (the old "relief column" Command
and narrator lines). The game ignores them. `build_voice.py` with no filter deletes them; with a filter
it keeps them.

## 1. Voice takes for the hangar's crew lines (16 lines)

When a requisition is set down in its hangar bay, whoever brought it in says a line
(`DELIVERY_LINES` in `src/config.js`). They show as text with a radio click for now.

- **New speaker:** `CPL. VOSS`, the quartermaster. His persona, reference line and default direction
  are already in `scripts/audio/voice_cast.py`. The voice build designs his voice from them.
- **Lines:** 10 for Cpl. Voss, 3 for BATTERY, 2 for SGT. KOVAC, 2 for PVT. ARAN (all existing voices).
- **How:** the voice pipeline above.
- **Until then:** `tests/smoke/tests/01-boot.test.js` fails and lists these 16 lines as missing takes.

## 2. Voice takes for the prologue (8 lines)

A new campaign opens with a sunset prologue before night 1 (`PROLOGUE` in `src/config.js`, staged by
`src/game/prologue.js`). It plays now with subtitles only: each cue lasts a reading pace, and once a line
is recorded the cue lasts as long as its take, so the shots re-time themselves.

- **Lines:** 5 for the NARRATOR, 2 for SGT. KOVAC (over the radio) and 1 for PVT. ARAN (over the radio),
  all existing voices.
  1. NARRATOR: "When the cities fell, Command drew a line across the hills: a string of walls on the valley roads, to hold the dead back while the last flights got out."
  2. NARRATOR: "Ours was the seventh. A wall of concrete across the road, a gate, one heavy gun, and whoever was left to man it."
  3. NARRATOR: "Seventy-two hours, Command told us. Hold the valley for seventy-two hours, and the birds would come for us."
  4. PVT. ARAN: "Sarge... sun's going down."
  5. SGT. KOVAC: "Then they'll be up soon. Lights on. Everybody on the wall."
  6. NARRATOR: "Every night the sun went down behind the burning city. And every night, the dead came out of it."
  7. SGT. KOVAC: "Movement on the road. Here they come. Gunner — on the fifty."
  8. NARRATOR: "That first night, there was only the wall, the dark, and the gun."
- **Direction:** the narrator as in the endings (an old soldier remembering, quiet, unhurried); Aran
  uneasy, half to himself; Kovac flat and steady, giving orders he has given before.
- **How:** the voice pipeline above, in the same run as item 1.
- **Until then:** the boot test lists these 8 with the 16 above as missing takes (24 in all).

## 3. Kovac's night-start line (optional)

At the start of a night, Kovac lists what came out of the hangar at dawn ("New on the line tonight:
a new match-grade barrel on the fifty, AP-T in the belt and…"). The sentence is assembled from
whatever was bought, so it can't be recorded as one take, and it shows as text only.

- **To voice it:** split it into fixed pieces, one opener ("New on the line tonight") plus one short
  clip per item (`ISSUE_LINES` in `src/config.js`, 16 phrases), and play them in sequence. That is
  a code change first, then 17 takes for SGT. KOVAC.

## Not needed

- **The first-night tips** (`src/ui/coach.js`) are a text panel, not radio, and mention mouse buttons
  and keys, so they are meant to be read, not voiced.
