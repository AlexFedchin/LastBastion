# To generate

Assets the code already uses or expects, but which have not been generated yet. Nothing here is
generated automatically. Each item says how to make it once you decide to run it.

## 1. Voice takes for the hangar's crew lines (16 lines)

When a requisition is set down in its hangar bay, whoever brought it in says a line
(`DELIVERY_LINES` in `src/config.js`). They show as text with a radio click for now.

- **New speaker:** `CPL. VOSS`, the quartermaster. His persona, reference line and default direction
  are already in `scripts/audio/voice_cast.py`. The voice build designs his voice from them.
- **Lines:** 10 for Cpl. Voss, 3 for BATTERY, 2 for SGT. KOVAC, 2 for PVT. ARAN (all existing voices).
- **How:** `python scripts/audio/build_voice.py` (GPU; see `docs/VOICEOVER.md`). It picks the lines up from
  `allRadioLines()`; only the missing ones are recorded.
- **Until then:** `tests/smoke/tests/01-boot.test.js` fails and lists these 16 lines as missing takes.

## 2. Kovac's night-start line (optional)

At the start of a night, Kovac lists what came out of the hangar at dawn ("New on the line tonight:
a new match-grade barrel on the fifty, AP-T in the belt and…"). The sentence is assembled from
whatever was bought, so it can't be recorded as one take, and it shows as text only.

- **To voice it:** split it into fixed pieces, one opener ("New on the line tonight") plus one short
  clip per item (`ISSUE_LINES` in `src/config.js`, 16 phrases), and play them in sequence. That is
  a code change first, then 17 takes for SGT. KOVAC.

## Not needed

- **The first-night tips** (`src/ui/coach.js`) are a text panel, not radio, and mention mouse buttons
  and keys, so they are meant to be read, not voiced.
