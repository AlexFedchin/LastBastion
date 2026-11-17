# Sounds needed

Every sound the game asks for is there today, as a recording or made in code at runtime. This list is of the
places where something is **standing in** for the real sound, or where there is no sound at all where there
should be one. Recordings from you would make these better. The list is in order of importance: how often or
how prominently the sound is heard, multiplied by how far the stand-in falls short.

Voice lines are a separate list ([TO_GENERATE.md](TO_GENERATE.md)).

## What to send for any sound

- **Format:** `.wav`, `.flac`, `.mp3` or `.ogg`. Any sample rate. Mono is fine (the game places sounds itself).
- **Where:** drop the file in `scripts/audio/user/` (like `helicopter.mp3` and `50cal.mp3`), and tell me which
  item it is for. `scripts/audio/build_audio.py` trims it, levels it and writes the game's `.ogg`.
- **Length:** a few clean takes of a one-shot are better than one. For a loop, 20–60 s of steady sound with no
  events in it (no voices, no cars, no one-off clanks).
- **Clean:** as little else in the background as possible, and no music. Reverb and distance are added in the game.
- **Licence:** your own recording, or CC0 / CC-BY (tell me the author and link for the credits).

---

## 1. Searchlight switching on

**Stand-in:** the door latch slowed right down, plus a short burst of steam hiss.

**Where:** the prologue's searchlight shot (the left tower's light comes on and swings out), and the second
tower's light a moment later in the same beat. It would also play when the lights come back after the
**blackout** event.

**Look for:** a big carbon-arc or high-power searchlight being switched on: a heavy electrical contactor or
knife switch slamming in, then the arc striking (a crackle or buzz settling into a steady hum). WWII
searchlight footage and stage "follow-spot" arc lamps are good sources. "Industrial breaker switch on" or
"large contactor" also works for the clunk alone.

## 2. Generator starting under load

**Stand-in:** a synthesized rising whine (`power_up`) and falling whine (`power_down`), made in code.

**Where:** the prologue as the wall's lights stutter on, and the **blackout** event, when the generator dies
(power down) and comes back (power up). Played from behind the wall, so heard from 20–30 m off.

**Look for:** a big diesel generator: cranking, catching and revving up as it takes the load (power up), and
coughing, stalling and running down (power down). Two separate files.

## 3. Searchlight traverse

**Missing:** no sound yet.

**Where:** the prologue's searchlight shot, while the light swings out from its tower over the field. It could
also play quietly when the searchlights jump to a crowd at night.

**Look for:** a heavy mount turning on its bearing: a geared electric motor whirring, with a little metallic
grind. A **loop** of 5–10 s, so it can run as long as the light moves. "Turret traverse", "radar dish motor",
"crane slewing" or "heavy gear motor" are good search terms.

## 4. Dusk ambience

**Stand-in:** the dawn bed (morning birds), which is heard as the sun goes down in the prologue.

**Where:** the first half of the prologue, fading out as the light goes.

**Look for:** a **loop** of open country at sunset: a few evening birds (blackbird, thrush, rooks), the first
crickets, a little wind in dry grass. No traffic or voices. 40–60 s.

## 5. Flag flapping in the wind

**Missing:** no sound yet.

**Where:** the B-7 flag on the nest. It's in the foreground of the prologue's pull-out from the sun and of
the gun view all game, so it could run as a quiet bed from that position.

**Look for:** a **loop** of a cloth flag snapping and rippling in a steady wind, with the halyard tapping
against the pole now and then. 20–40 s.

## 6. A distant air-raid siren

**Stand-in:** the game's own alarm siren (the one the wall sounds when a surge comes), slowed and muffled.

**Where:** the opening of the prologue, far off in the dead city behind the sun. Could also be added under
the city's ambience in the first nights.

**Look for:** a mechanical (rotating) air-raid siren winding up and down, recorded from a long way off: a slow,
mournful rise and fall that clearly isn't the wall's own horn. A full wind-up and wind-down, 20–40 s.

## 7. Machine gun belt loading (M240 or similar)

**Stand-in:** the latch and a dropped shell casing.

**Where:** the prologue's shot round the M240 gunner on the wall, where he opens the feed cover, lays a belt
in and shuts it. It could also be used when the dawn hangar delivers a new M240.

**Look for:** the handling sounds of a belt-fed machine gun (M240, MG3, PKM, M60): the feed cover opening, a
link belt being laid on the feed tray, the cover slapping shut, and the charging handle racked. Separate takes
of each are best. These are common on airsoft and firearms foley libraries.

## 8. A crow flock taking off and passing

**Missing:** no sound yet (the crows' calls are already in the game; their wings aren't).

**Where:** the prologue's opening, where about thirty crows cross the sun. It could also play at dawn when the
crows come down to the field.

**Look for:** a flock of crows, rooks or pigeons taking off together and flying past close: a rush of
wingbeats, ideally with a few calls in it. 5–10 s.

## 9. Gunship and bomber engines

**Stand-in:** engine loops made in code (`prop` for the AC-130's turboprops, `jet` for the B-36).

**Where:** Spectre circling over the valley through the night (heard for minutes at a time), the cargo plane
in the supply drop, the bomber run on call, and the bombers in the extraction.

**Look for:**
- **Turboprop:** a C-130 or other four-engine turboprop droning overhead at height, heard from the
  ground. A steady **loop** of 30–60 s.
- **Heavy bomber:** a B-52, Tu-95 or other big jet or propeller bomber passing low and slowly. Either a
  steady loop or a full pass.

## 10. Army truck engine

**Stand-in:** the synthesized propeller loop, slowed to under half speed.

**Where:** the **convoy** event (Lt. Hollis driving a truck of survivors down the road to the gate under fire),
and the survivors' truck crawling up the road in the ending.

**Look for:** a big diesel army truck (Ural, KrAZ, M35, Bedford or similar) driving slowly in low gear,
recorded from outside: a **loop** of steady driving, 20–40 s. If you can also get it idling, and pulling away
from a stop, send those as separate takes.
