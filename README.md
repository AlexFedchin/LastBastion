# LAST BASTION

*Seventy-two hours. One gun. No relief.*

A brutal last-stand siege game. You man an M2HB .50 cal on the apex of a V-shaped
wall at the mouth of a valley. Every night the dead come down that valley in their
thousands. Hold until dawn. Spend what you scavenged. Do it again.

Built with **three.js** in an **Electron** shell. Every texture is generated
procedurally at startup; the sound is real — field recordings and an adaptive score
(see *Sound* below).

### What you're looking at

- **Terrain**: a real heightfield valley — shell craters with standing water and
  rain ripples, the napalm ditch, an old forward trench, a cratered road out to
  the city, cliffs past the wings, valley walls, forested hills and the city plain.
  Layered mud / dead turf / rock / asphalt materials, wind-blown grass.
- **The wall**: precast T-wall slabs over HESCO fill, duckboard walkways, razor
  wire on outriggers, sodium lamps, and blood that climbs the face as the pile does.
- **The field**: a column of abandoned cars, burnt-out trucks, a tank hulk, a downed
  helicopter, hedgehogs, wire fences, dead trees, telephone poles, ruined farms.
- **The horizon**: a dead village and church, a broken highway viaduct, power
  pylons, a radio mast, far mountains, and a burning city with smoke plumes,
  searchlights in the clouds, tracer fire and flak.
- **Atmosphere**: one fog model for every material — thin haze, drifting ground
  mist and in-scattered firelight that matches the sky; storm clouds lit from below,
  lightning bolts, rain glittering in the searchlights.
- **Fire**: per-pixel procedural flames with ground glow, smoke and embers —
  napalm, wrecks, burning barrels, burning dead, lingering blast fires.
- **Zombies**: three LODs, elbows and knees, faces, hands, torn clothes, gear
  (helmets, plate carriers, packs, caps, hi-vis), mud and blood shading.
- **Lens**: heat haze over fires, blast shockwaves, ghosts and halo, anamorphic
  streaks, a dirty lens catching bright light, gentle barrel distortion.
- **Sound**: a real .50 BMG report layered over US Army M2 footage, valley
  reverb with slapback off the hillsides, brass on the platform, artillery that
  arrives at the speed of sound, a horde mixed in three distances, rain, wind,
  the war in the city a kilometre off, and an adaptive score that rises with the
  pressure on the wall.

---

## Run it from VS Code

1. Install **Node.js 22 or newer** (https://nodejs.org).
2. Open this folder in VS Code.
3. Press **F5** (or *Run ▸ Start Debugging*) and pick **Play Last Bastion**.

The first launch installs dependencies and downloads Electron (~1 minute). After
that, F5 rebuilds the bundle and starts the game in a couple of seconds.

Other ways to start:

| How | What |
|---|---|
| `Ctrl+Shift+B` | VS Code build task **Play Last Bastion** |
| `run.cmd` / `run.sh` | Double-click launcher (Windows / macOS / Linux) |
| `npm start` | Bundle + launch from a terminal |
| `npm run watch` | Rebuild on save while you tweak (`Ctrl+R` in the game window reloads) |

*Play Last Bastion (windowed)* starts in a window instead of fullscreen.
`F11` toggles fullscreen, `F12` opens DevTools.

## Build a Windows .exe

**GitHub Actions** (`.github/workflows/build-windows.yml`) builds on every push to
`main`/`master`, on pull requests, on manual dispatch, and on `v*` tags:

* `LastBastion-1.0.0-portable.exe` — single launchable .exe, no install
* `LastBastion-1.0.0-setup.exe` — regular installer

Download them from the run's **Artifacts** section. Pushing a tag like `v1.0.0`
also attaches both files to a GitHub Release.

Locally on Windows: `npm run dist:win` (output in `release/`).

---

## How to play

| Input | Action |
|---|---|
| Mouse | Traverse the gun |
| LMB | Fire |
| RMB | Optics — zoom and tighter spread |
| R | Swap barrel (instantly resets heat; takes ~2 s) |
| Q | 105 mm fire mission on the crosshair |
| E | Ignite the napalm trench in front of the wall |
| F | Illumination flare — lit zombies take +25 % damage |
| T | Red marker flare anywhere on the field — a bomber puts a 2000 lb bomb on it (75 s re-arm) |
| G | Grenade bundle (short range — for the wall base) |
| B | **Danger close** — carpet the wall line. Costs 3 survivors. Once per night. |
| Esc | Pause |

**The pile.** Zombies that reach the wall press against it and climb on each
other. Each wall section (L1–L5, R1–R5, painted on the wall and shown on the
*Wall Pressure* map) builds a pile. When a pile reaches the top of the wall,
they climb over — every one that makes it kills a survivor. Lose them all and
Bastion-7 falls. Look left and right along the wall faces and cut the piles down.

**The horde.** Shamblers, Runners (night 2+), Brutes (night 3+, worth three bodies
on a pile) and Bloaters (night 4+, they burst and chain-react — and if one reaches
the wall its acid melts a ramp the others can climb). Surges are
announced with a siren and the side they're coming from. The last stretch of
every night is **the tide**.

**Spectre.** An AC-130 gunship circles the valley all night and works the
crowds in the field with its 25 mm, 40 mm and 105 mm guns. It won't fire close
to the wall — that part is still yours.

**Dawn.** Survive the night and clear the field. Every kill earns supplies;
spend them on the gun, the artillery battery, wall gunners, wire, the mortar pit,
claymores, flares and grenades. Ten nights to the end of the story — then you
can keep holding for as long as you last.

Difficulties: **Recruit**, **Veteran** (intended), **Last Stand**.

## Tuning

Everything gameplay-related lives in `src/config.js`: zombie stats, the
pile/breach rules, night plans, difficulty, upgrade costs and effects, radio
script. Graphics presets (Low / Medium / High / Ultra) are in
`src/core/storage.js` and selectable in Settings.

## Project layout

```
electron/        main process + preload (window, fullscreen, quit)
app/             index.html, style.css, bundled game (app/build/)
src/
  main.js        game state machine and main loop
  config.js      all tunables
  game/          horde simulation, zombie model/shaders, player gun, arsenal, director
  world/         environment (wiring + per-frame life), terrain, structures (wall,
                 bunker, towers, base), props, far (hills, village, viaduct, city),
                 sky (clouds, lightning, rain), kit (models/materials), textures
  fx/            particles, procedural fire, decals, gibs/casings, light pool, effects
  render/        atmosphere (shared fog), post (bloom, lens, haze, grading)
  audio/         sound engine: mix bus, valley reverb, ambience beds, adaptive score
  ui/            HUD and menus/shop
scripts/         build (esbuild), VS Code pre-launch, audio/ sound build
.vscode/         launch + tasks
.github/         Windows .exe workflow
```

## Sound

All audio lives in `app/audio/` (Ogg Vorbis, ~32 MB) and is loaded at boot:
one-shots and ambience beds are decoded into memory, the score is streamed.

| Folder | What |
|---|---|
| `sfx/` | one-shots — the M2HB (4 layered variants + burst tails), wall M240s, brass, explosions near/far, incoming rounds, mortar, napalm, impacts, gore, 27 zombie voices, brutes, runners, the men on the wall, thunder, siren, radio, gun handling, UI, crows, a church bell |
| `amb/` | seamless loops — rain near/far, wind, the horde at three distances, bodies against the wall, fire, the distant battle, dawn air, flies, sodium lamps, radio carrier |
| `music/` | the score — menu, two night drones, two percussion layers that follow the pressure on the wall, the tide, dawn, resupply, the fall, victory |
| `voice/` | every radio line, spoken and run through a radio chain (`lines.json` maps speaker + text to a take) |

**Mix** (`src/audio/audio.js`): everything is spatialised against the gun (pan,
distance, air absorption, speed-of-sound delay on blasts). Close explosions duck
the world and the score and can leave your ears ringing. Each part of the game
has a mix snapshot (the menu sits the battle back behind the theme). Music sits
roughly 10 dB under sustained fire; the whole thing lands around −16 LUFS.

**Credits**: music by Kevin MacLeod (incompetech.com), CC BY 4.0; sound effects
from Freesound contributors, CC0. The full list — every recording, its author and
what it became — is in [`app/audio/CREDITS.md`](app/audio/CREDITS.md) and is
shipped with the game. A short credit is on the *Field Manual* screen.

**Rebuilding the sound** (Python 3 + numpy + ffmpeg with libvorbis):

```
python scripts/audio/build_audio.py          # everything
python scripts/audio/build_audio.py hmg boom # only matching recipes
```

The script downloads its sources (cached in `scripts/audio/.cache/`), then slices,
layers, loop-crossfades, loudness-matches, limits and encodes every asset, and
regenerates `CREDITS.md`. Every recipe is in that one file.

**Radio voice-over** (Python 3 + Node; `pip install kokoro-onnx soundfile scipy numpy`):

```
python scripts/audio/build_voice.py          # every line in src/config.js (allRadioLines)
python scripts/audio/build_voice.py KOVAC    # only matching speakers / lines
```

Lines are voiced with Kokoro-82M, a free open-weight TTS model (Apache 2.0; the ~350 MB
model is downloaded into `scripts/audio/.cache/` on first run), then band-limited,
compressed, overdriven and pushed through a low-rate codec with hiss, fading and crackle —
a different set per speaker (handheld on the wall, field radio, long-range HF from
Command, a dying civilian set, aircrew over their engines). Casting and radio profiles
are at the top of the script. Add or change a line in `config.js`, rerun the script, and
the game picks it up; a line without a take still shows on the HUD, just silently.

## Troubleshooting

* **F5 does nothing / "electron is not recognized"** — run `npm install` once in the
  VS Code terminal, then press F5 again.
* **Low frame rate** — Settings ▸ Quality ▸ Medium or Low (fewer simultaneous
  zombies, no shadows, lower bloom resolution). Laptops: make sure the game runs on
  the discrete GPU (the app already asks for it).
* **Mouse not captured** — click the game window ("CLICK TO TAKE THE GUN"). `Esc`
  releases the mouse and pauses.
* **Progress** is saved automatically at every dawn (stored in the app's local
  storage). *Continue* on the main menu picks it up.
