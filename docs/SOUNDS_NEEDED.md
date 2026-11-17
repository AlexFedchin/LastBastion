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

## Freesound shortlist (the plan for later)

Each item below lists CC0 candidates found on [Freesound](https://freesound.org) by searching for it (CC0
licence filter, sorted by downloads, then narrowed by title and length). **None has been listened to or
checked yet**, and the licence was taken from the search results only. When you pick this up:

1. Download each candidate's high-quality preview and confirm on its page that it's CC0.
   `fs(id)` in `scripts/audio/build_audio.py` already does both: it refuses anything that isn't CC0 and
   records the title, author and link for the credits.
2. Check each file: length, clipping, background noise, and whether a loop holds steady.
3. Put the candidates on a page to listen to side by side, and pick one per item (or none, if all miss).
4. Wire the picks into `build_audio.py` like the existing Freesound sounds (trim, level, loop), regenerate
   `app/audio/CREDITS.md`, and replace the stand-ins in the code.

If an item has no good candidate, the fallbacks are your own recording, or a Sonniss GDC bundle
(royalty-free for games, but a manual multi-gigabyte download). Items 1, 7 and 10 had the thinnest results.

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

**Freesound candidates (not yet listened to):**
- [Kill Switch (Large Breaker Switch)](https://freesound.org/s/131599/) (2.3 s) — the clunk alone; the most downloaded result
- [Spotlight.aif](https://freesound.org/s/49013/) (5.1 s) — a stage spotlight switching on
- [Spotlight_clear.wav](https://freesound.org/s/338084/) (9.7 s)
- [Gym Lights Powering Up](https://freesound.org/s/262510/) (12.5 s) — big discharge lamps warming up: could follow the clunk
- [highvoltagearc.wav](https://freesound.org/s/210878/) (5.6 s) — for the arc striking

## 2. Generator starting under load

**Stand-in:** a synthesized rising whine (`power_up`) and falling whine (`power_down`), made in code.

**Where:** the prologue as the wall's lights stutter on, and the **blackout** event, when the generator dies
(power down) and comes back (power up). Played from behind the wall, so heard from 20–30 m off.

**Look for:** a big diesel generator: cranking, catching and revving up as it takes the load (power up), and
coughing, stalling and running down (power down). Two separate files.

**Freesound candidates (not yet listened to):**
- [Generator StartUp, Run, Shutdown.wav](https://freesound.org/s/169940/) (68.6 s) — start and stop in one take: both files from it
- [S03-18 Large industrial generator starting up.wav](https://freesound.org/s/675722/) (98.5 s)
- [Small Diesel Generator](https://freesound.org/s/516759/) (178.6 s) — running only; small

## 3. Searchlight traverse

**Missing:** no sound yet.

**Where:** the prologue's searchlight shot, while the light swings out from its tower over the field. It could
also play quietly when the searchlights jump to a crowd at night.

**Look for:** a heavy mount turning on its bearing: a geared electric motor whirring, with a little metallic
grind. A **loop** of 5–10 s, so it can run as long as the light moves. "Turret traverse", "radar dish motor",
"crane slewing" or "heavy gear motor" are good search terms.

**Freesound candidates (not yet listened to):**
- [Rotating tank turret planetary electric motor](https://freesound.org/s/607311/) (48.8 s) — the closest match by title
- [Electric Motor Whir.aif](https://freesound.org/s/125401/) (23.1 s)
- [boat crane .wav](https://freesound.org/s/570909/) (81.5 s)
- [ServoMotor.wav](https://freesound.org/s/824121/) (18.0 s)

## 4. Dusk ambience

**Stand-in:** the dawn bed (morning birds), which is heard as the sun goes down in the prologue.

**Where:** the first half of the prologue, fading out as the light goes.

**Look for:** a **loop** of open country at sunset: a few evening birds (blackbird, thrush, rooks), the first
crickets, a little wind in dry grass. No traffic or voices. 40–60 s.

**Freesound candidates (not yet listened to):**
- [Ambience-Rural-Early Evening-Birds Chirping, Light Wind](https://freesound.org/s/418271/) (215 s) — the closest match by title
- [evening grassland.WAV](https://freesound.org/s/434858/) (82 s)
- [Sussex Woodland & Meadow Bird Sounds, Evening](https://freesound.org/s/269559/) (145.5 s)
- [AMB_Mountain_ Pyrenees_early_evening_bird.wav](https://freesound.org/s/430588/) (265.9 s)

## 5. Flag flapping in the wind

**Missing:** no sound yet.

**Where:** the B-7 flag on the nest. It's in the foreground of the prologue's pull-out from the sun and of
the gun view all game, so it could run as a quiet bed from that position.

**Look for:** a **loop** of a cloth flag snapping and rippling in a steady wind, with the halyard tapping
against the pole now and then. 20–40 s.

**Freesound candidates (not yet listened to):**
- [A flag flapping in the wind, the wire is knocking the metal mast](https://freesound.org/s/146272/) (120.7 s) — has the halyard knocking
- [Flag flapping in the wind, cable knocking on the mast (close)](https://freesound.org/s/434079/) (254.9 s) — has the halyard knocking
- [A flag flapping in the wind, at the small village of Assem Sou…](https://freesound.org/s/154794/) (60.5 s) — the most downloaded

## 6. A distant air-raid siren

**Stand-in:** the game's own alarm siren (the one the wall sounds when a surge comes), slowed and muffled.

**Where:** the opening of the prologue, far off in the dead city behind the sun. Could also be added under
the city's ambience in the first nights.

**Look for:** a mechanical (rotating) air-raid siren winding up and down, recorded from a long way off: a slow,
mournful rise and fall that clearly isn't the wall's own horn. A full wind-up and wind-down, 20–40 s.

**Freesound candidates (not yet listened to):**
- [Alarm, Air Raid Siren, Test, Devonport](https://freesound.org/s/336640/) (77.2 s)
- [Air raid siren (Prague)](https://freesound.org/s/382611/) (80.5 s)
- [Civil Defence Siren.wav](https://freesound.org/s/22370/) (89.5 s)
- [Air Raid Siren](https://freesound.org/s/157463/) (167.9 s)

## 7. Machine gun belt loading (M240 or similar)

**Stand-in:** the latch and a dropped shell casing.

**Where:** the prologue's shot round the M240 gunner on the wall, where he opens the feed cover, lays a belt
in and shuts it. It could also be used when the dawn hangar delivers a new M240.

**Look for:** the handling sounds of a belt-fed machine gun (M240, MG3, PKM, M60): the feed cover opening, a
link belt being laid on the feed tray, the cover slapping shut, and the charging handle racked. Separate takes
of each are best. These are common on airsoft and firearms foley libraries.

**Freesound candidates (not yet listened to):**
- [Machine_Gun_Reload.wav](https://freesound.org/s/386777/) (3.8 s)
- [Machine gun reload](https://freesound.org/s/363168/) (2.8 s)
- [Gun Handling.wav](https://freesound.org/s/272394/) (38.3 s) — general handling foley to cut takes from

## 8. A crow flock taking off and passing

**Missing:** no sound yet (the crows' calls are already in the game; their wings aren't).

**Where:** the prologue's opening, where about thirty crows cross the sun. It could also play at dawn when the
crows come down to the field.

**Look for:** a flock of crows, rooks or pigeons taking off together and flying past close: a rush of
wingbeats, ideally with a few calls in it. 5–10 s.

**Freesound candidates (not yet listened to):**
- [121003 Pigeon flock fly away, wing flaps, Toronto.wav](https://freesound.org/s/616623/) (7.5 s)
- [Pigeons flying](https://freesound.org/s/532180/) (5.6 s) — the most downloaded
- [flock of crows.wav](https://freesound.org/s/565911/) (47.4 s) — crows, but it may be calls rather than wings

## 9. Gunship and bomber engines

**Stand-in:** engine loops made in code (`prop` for the AC-130's turboprops, `jet` for the B-36).

**Where:** Spectre circling over the valley through the night (heard for minutes at a time), the cargo plane
in the supply drop, the bomber run on call, and the bombers in the extraction.

**Look for:**
- **Turboprop:** a C-130 or other four-engine turboprop droning overhead at height, heard from the
  ground. A steady **loop** of 30–60 s.
- **Heavy bomber:** a B-52, Tu-95 or other big jet or propeller bomber passing low and slowly. Either a
  steady loop or a full pass.

**Freesound candidates (not yet listened to):**
- [C130TurboPropFlyBy.wav](https://freesound.org/s/239918/) (41 s) — turboprop: an actual C-130
- [Lockheed Electra turboprop flyover](https://freesound.org/s/464893/) (32.6 s) — turboprop: four-engine
- [Lancaster flyover](https://freesound.org/s/162240/) (22.7 s) — bomber: four-engine propeller bomber
- [G06-19_C-47 2 Engine Prop Slow Overhead.wav](https://freesound.org/s/437839/) (63 s) — bomber or cargo plane: slow, overhead

## 10. Army truck engine

**Stand-in:** the synthesized propeller loop, slowed to under half speed.

**Where:** the **convoy** event (Lt. Hollis driving a truck of survivors down the road to the gate under fire),
and the survivors' truck crawling up the road in the ending.

**Look for:** a big diesel army truck (Ural, KrAZ, M35, Bedford or similar) driving slowly in low gear,
recorded from outside: a **loop** of steady driving, 20–40 s. If you can also get it idling, and pulling away
from a stop, send those as separate takes.

**Freesound candidates (not yet listened to):**
- [truck large diesel or military tank APC armored personnel carrier](https://freesound.org/s/405086/) (91 s) — the closest match by title
- [Military Vehicle Humming.flac](https://freesound.org/s/182793/) (30 s)
- [Diesel Truck Idling Front.wav](https://freesound.org/s/128160/) (34.4 s) — idle only
- [Diesel Start-Idle-Revs MZ000004.wav](https://freesound.org/s/443319/) (26.6 s) — start, idle and revs

---

# New sounds for realism (highest impact first)

The ten items above replace stand-ins. These are sounds the game doesn't have at all, or covers with a
sample meant for something else, that would make it feel more real straight away. Ranked by impact: how
often each one would be heard, and how much it would add each time. None of them has been searched for yet;
the same plan applies (Freesound CC0 first, see the shortlist plan above), or send your own.

## 11. Rounds hitting the ground, concrete and metal

**Now:** nothing. A round that hits one of the dead makes a flesh sound; every other round, which is most of
them, lands in silence.

**Where:** every .50 round from the nest all night, and the M240s' and riflemen's rounds landing near the wall.

**Look for:** bullet impacts at 50–150 m, in several takes each: into wet mud and dirt (dull thuds and
spatter), on concrete (a sharp crack with grit), on sheet metal and car bodies (pings and clanks), and
ricochet whines. "Bullet impact dirt", "bullet hits metal", "ricochet" are common foley searches.

## 12. The pile at the wall

**Now:** only the horde beds (groaning, shuffling). The pile is the game's central mechanic, but you can't
hear it.

**Where:** at every wall section where a pile builds, louder as it climbs, and right under the nest when it
builds at the centre.

**Look for:** bodies slamming into a concrete wall, hands clawing and scraping up the face, a heap of bodies
shifting and sliding, nails and boots scrabbling on concrete. Short one-shots, plus a **loop** of a crowd
pressing against a wall or barricade (riot and crowd-crush foley works). Several takes of each.

## 13. Rifle shots for the riflemen

**Now:** the M240 recording, pitched up and turned down.

**Where:** the six riflemen along the walkway, firing all night on both sides of the nest.

**Look for:** single shots and doubles from an assault rifle (M4, AK, FAL), recorded outdoors from 20–60 m with
a natural echo, not a close studio report. A dozen takes, so it doesn't repeat.

## 14. Barbed wire catching a crowd and giving way

**Now:** the wire breaking is the door latch, pitched up; the wire holding a crowd is silent.

**Where:** the wire belts in the approach, every night they're out: a crowd caught on them, and
a stretch snapping.

**Look for:** barbed or razor wire being pulled taut and creaking, posts groaning, wire rattling as it's
shaken, and a wire snapping under tension with a twang and a whip. "Fence rattle", "wire twang", "cable snap".

## 15. Our artillery firing behind the base

**Now:** the shells are heard falling (a whistle) and landing, but not fired.

**Where:** every artillery call (Q) and the battery's salvos, a few seconds before the whistle, from far
behind the bastion.

**Look for:** a howitzer battery firing from a few kilometres away: deep thumps, one to four guns, with a long
rolling echo. Recorded from a distance, not next to the gun.

## 16. The fifty's belt

**Now:** only the brass dropping.

**Where:** under every burst from the nest, the sound you hear most in the game.

**Look for:** a link belt rattling through a heavy machine gun's feed, and spent links clinking onto the
floor. A short rattle per burst and a link-drop one-shot. Firearms foley libraries have it; recordings of
real M2 or M2HB fire sometimes have it audible between shots.

## 17. The hangar

**Now:** the dawn music and the morning birds; a delivery is the latch, the barrel seat and a body fall.

**Where:** the dawn resupply, where you spend a few minutes between every two nights.

**Look for:**
- a **loop** of rain drumming on a corrugated metal roof, heard from inside a large empty building;
- the room tone of a big hangar or warehouse (air, distant hum, the odd creak);
- a heavy crate or pallet set down on concrete, a pallet jack, and a chain hoist running, for deliveries.

## 18. Runners' footsteps

**Now:** runners shriek, but their feet don't make a sound; shamblers are covered by the shuffle bed.

**Where:** every runner sprinting at the wall, from the first nights on, and the stampede event.

**Look for:** bare and booted feet sprinting through mud and puddles, and a group of people running past.
Short one-shots of a few steps each, plus a **loop** of a crowd running.

## 19. People behind the wall

**Now:** silence behind you, apart from the radio.

**Where:** the yard behind the nest during the night, quiet, between surges: the survivors the wall is
counting.

**Look for:** quiet, distant life in a refugee camp at night: murmured voices, a child crying and being hushed,
a cough, a metal cup set down, someone hammering. Distant and non-verbal, so it doesn't compete with the radio.
A **loop** of 60 s or more, and a few one-shots.

## 20. Wind in the wire and the masts

**Now:** the wind beds are general and don't come from anything in view.

**Where:** the gun view all game: the antennas, the wire on the parapet and the floodlight masts near the nest.

**Look for:** wind whistling through wire, guy-lines and antennas, and a lamp or sign creaking on its mount.
A **loop** of 30–60 s.
