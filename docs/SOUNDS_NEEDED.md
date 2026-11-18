# Sounds needed

Every sound the game asks for is there today, as a recording or made in code at runtime. This list was of the
places where something was **standing in** for the real sound, or where there was no sound at all. Most of them
were filled on 2026-11-18 from a Freesound CC0 shortlist picked by ear (below); two are still open.

Voice lines are a separate list ([TO_GENERATE.md](TO_GENERATE.md)).

## What to send for any sound

- **Format:** `.wav`, `.flac`, `.mp3` or `.ogg`. Any sample rate. Mono is fine (the game places sounds itself).
- **Where:** drop the file in `scripts/audio/user/` (like `helicopter.mp3` and `50cal.mp3`), and tell me which
  item it is for. `scripts/audio/build_audio.py` trims it, levels it and writes the game's `.ogg`.
- **Length:** a few clean takes of a one-shot are better than one. For a loop, 20–60 s of steady sound with no
  events in it (no voices, no cars, no one-off clanks).
- **Clean:** as little else in the background as possible, and no music. Reverb and distance are added in the game.
- **Licence:** your own recording, or CC0 / CC-BY (tell me the author and link for the credits).


## Done (2026-11-18): picked from the Freesound shortlist

About 170 CC0 candidates for the twenty items were put on a listening page, and these were picked by ear.
They are built by `scripts/audio/build_audio.py` (the "sound shortlist" section) and credited in
`app/audio/CREDITS.md`. The old stand-ins stay in the code as fallbacks in case a file fails to load.

| # | Sound | Recording (Freesound id) | Built as | Plays |
|---|---|---|---|---|
| 1 | Searchlight switching on | spotlight-stereo.aif (49023) | `sfx/searchlight_on` | prologue's lights; both towers when the blackout ends |
| 2 | Generator start / stop | water pump motor start-stop (406892): the second start, and a run-down | `sfx/gen_start`, `sfx/gen_stop` | prologue's lights; the blackout |
| 3 | Searchlight traverse | Animation Rostrum motor (327900), looped | `sfx/sl_motor` | whenever a beam slews fast (swinging out, jumping to a crowd), not on the slow sweep |
| 4 | Dusk ambience | evening grassland (434858) | `amb/dusk` | the first half of the prologue |
| 5 | Flag | flag in the wind, Assem Souk (154794) | `amb/flag` | a quiet bed placed at the nest's mast; prologue's pull-out |
| 6 | Distant air-raid siren | SIREN AIR RAID BIRDS (52040), first 40 s | `sfx/siren_far` | the prologue's opening |
| 7 | M240 belt loading | M16 empty reload (725397), cut in three | `sfx/m240_load_1..3` | the prologue's gunner |
| 8 | Crow flock taking off | pigeon flock flies away (616623) | `sfx/flock` | the crows crossing the sun; once at each dawn |
| 9 | Bomber engines | bombers fly in formation (437892), from 1.5 s | `sfx/bomber` | the bomber run and the extraction's bombers (Spectre and the supply plane keep the synthesized turboprop) |
| 10 | Army truck | diesel truck idling (128160), pitched down | `sfx/truck` | the convoy; the survivors' truck in the ending |
| 13 | Riflemen | M16 rifle shots (187677), five single shots | `sfx/rifle_1..5` | the six riflemen |
| 14 | Wire | fence rattle (189220), the voices cut | `sfx/wire_1..3` | a crowd caught on the wire; a stretch snapping (with the old latch under it) |
| 15 | Our artillery firing | Artillery Gunfire (239137), three reports | `sfx/arty_1..3` | every artillery call and danger close, far behind the base |
| 17 | The hangar | rain on roofing (521841), abandoned warehouse (240895), wooden crate dropped (456977) | `amb/hangar_rain`, `amb/hangar_room`, `sfx/crate_1..3` | the dawn resupply; a delivery landing |
| 18 | Runners' footsteps | group running in sync (250538) | `amb/run` | a bed that follows how many runners and brutes are sprinting in, toward their side |
| 20 | Wind in the wire | antenna wire in the wind (147599), with a creaking fence (217769) very faint | `amb/wire_wind`, `amb/wire_creak` | outdoors all game |

The set-dressing beds (flag, wire, dusk) sit low and step further back while the fifty is firing and as the
pressure on the wall rises, so they never compete with the action.

Dropped on review: **12. The pile at the wall** and **19. People behind the wall** (not needed).

---

# Still open

Nothing on the shortlist fitted these two. A recording of your own, or a Sonniss GDC bundle, would do it.

## 11. Rounds hitting the ground, concrete and metal

**Now:** nothing. A round that hits one of the dead makes a flesh sound; every other round, which is most of
them, lands in silence.

**Where:** every .50 round from the nest all night, and the M240s' and riflemen's rounds landing near the wall.

**Look for:** bullet impacts at 50–150 m, in several takes each: into wet mud and dirt (dull thuds and
spatter), on concrete (a sharp crack with grit), and on sheet metal and car bodies (pings and clanks). "Bullet impact dirt" and
"bullet hits metal" are common foley searches.


*Shortlist note:* nothing fitted. No ricochets, please: only the impacts themselves.

## 16. The fifty's belt

**Now:** only the brass dropping.

**Where:** under every burst from the nest, the sound you hear most in the game.

**Look for:** a link belt rattling through a heavy machine gun's feed, and spent links clinking onto the
floor. A short rattle per burst and a link-drop one-shot. Firearms foley libraries have it; recordings of
real M2 or M2HB fire sometimes have it audible between shots.


*Shortlist note:* nothing fitted. No candidate had a clean one-shot of the links.
