# Textures needed

Every world texture in the game is currently generated in code at boot: canvas noise in [src/world/textures.js](../src/world/textures.js) and [src/world/textures2.js](../src/world/textures2.js). Scanned or photo-sourced textures would lift almost everything on screen, the terrain most of all.

The list is in order of importance (screen time × how far the generated version falls short). Each entry names the generator it replaces.

**I can get most of these myself:** the tiling PBR sets (1–12) all exist as CC0 scans on [Poly Haven](https://polyhaven.com/textures) and [ambientCG](https://ambientcg.com). Say the word and I'll pick and fetch them the way the yard kit was fetched. The ones I can't get as easily are the **effects** (13–15). If you have or can make better ones, or want to choose the look yourself, send any of them.

## What to send for any texture

- **Seamless tiling** for surfaces. Trim sheets are welcome for the concrete.
- **PBR set:**
  - colour (albedo, no baked lighting)
  - **OpenGL-style** normal map (green up)
  - roughness
  - optionally AO and height
- **Size:** each entry below gives a source resolution, what the game ships at each quality preset, and a minimum. Larger sources are always fine; I'll downscale. For comparison, the generated grass, rock and asphalt are only 512 px today.
- **Format:** PNG / JPG / EXR / TIFF, anything. I'll convert to WebP.
- **Real-world scale:** note how many metres one tile covers (e.g. "2 × 2 m"), so it lands at the right size.
- **Licence:** CC0 or CC-BY, with the source noted for the credits.
- **Look:** a ruined, rain-soaked war zone at night. Wet, dirty, worn and dull beats clean and saturated.

---

## Surfaces

### 1. Wet, churned mud

**Replaces:** `makeGroundTextures`.

**Where:** the base layer of all the terrain: the killing field, the trampled ground at the wall, the yard. It's what most of the screen is, most of the time.

**Need:** dark, wet, trampled mud with boot and tyre marks, small stones and puddle-prone hollows. If possible, a second variant: drier, cracked earth.

**Tile:** about 2–4 m.

**Resolution:** source **2048²** (4096 welcome). Ships at 1024 on LOW, 2048 on MEDIUM+. This is the most-seen surface, from 2 m to 200 m; with a 3 m tile, 2048 gives about 680 px/m, sharp right at the foot of the wall. Minimum acceptable: 1024.

### 2. Grass / meadow turf

**Replaces:** `makeTurfTextures`.

**Where:** grass patches on the field, the hills, the meadows and fallow plots behind the base.

**Need:** a patchy, late-autumn, flattened grass-and-soil ground texture: brownish-green, not lawn green.

**Tile:** about 2–3 m.

**Resolution:** source **2048²**. Ships at 1024 on LOW and MEDIUM, 2048 on HIGH+. Seen from about 15 m outwards, and mostly blended with the grass cards. Minimum: 1024.

### 3. Rock / cliff face

**Replaces:** `makeRockTextures`.

**Where:** the valley walls, the cliffs past the wings, every boulder. It is projected from three directions on steep slopes, so it must tile well on all axes.

**Need:** grey-brown weathered rock (granite or limestone), wet, with moss or dirt in the cracks.

**Tile:** about 3–5 m.

**Resolution:** source **2048²**. Ships at 1024. The valley walls are 60–200 m from the gun, but boulders and the cliffs by the wings come closer, and it's sampled three times per pixel, so it should stay crisp at 1024. Minimum: 1024.

### 4. Cracked asphalt road

**Replaces:** `makeAsphaltTextures`.

**Where:** the road through the killing field out to the city.

**Need:** old, cracked, potholed asphalt with mud tracked over it. The faded centre line is added by the game.

**Tile:** about 3–4 m.

**Resolution:** source **2048²**. Ships at 1024 on LOW, 2048 on MEDIUM+. The road starts about 10 m from the gun and runs straight away from it, so it's seen at grazing angles, where detail along the road matters. Minimum: 1024.

### 5. Dirt track / gravel

**New** (the rear track and the yard lanes are tinted mud right now).

**Need:** a rutted dirt or gravel farm track: compacted earth, gravel, tyre ruts.

**Tile:** about 2–4 m.

**Resolution:** source **1024²** (2048 welcome). Ships at 1024. Mostly seen from the air in cutscenes, plus the yard lanes in the landing-zone shots. Minimum: 512.

### 6. Farmland: ploughed soil and stubble

**New** (the field patchwork behind the base fakes these with stripes).

**Need:**
- ploughed furrowed soil (directional furrows)
- harvested stubble field (short straw rows)

Both directional, with the furrows or rows running along one axis.

**Tile:** about 3–5 m.

**Resolution:** source **1024²** per variant (2048 welcome). Ships at 512 on LOW, 1024 on MEDIUM+. Only seen from 50 m or more, from the air. Minimum: 512.

### 7. Concrete: wall, viaduct, slabs

**Replaces:** `makeConcreteTextures` and `makeSlabTextures`.

**Where:** the wall, the bunker until a tower model arrives, the broken viaduct, slabs and the floor slab of the ruins.

**Need:** weathered poured concrete with formwork lines, rain streaks and soot, plus a separate stained concrete slab or panel texture.

**Tile:** about 2–3 m.

**Resolution:** source **2048²**. Ships at 1024 on LOW, 2048 on MEDIUM+. The wall's walkway and parapet are 2–10 m from the gun all game; with a 2.5 m tile, 2048 gives about 800 px/m. The slab texture can be 1024. Minimum: 1024.

### 8. HESCO barrier: wire mesh and geotextile

**Replaces:** `makeHescoTextures`.

**Where:** the defensive barrier blocks along the wall.

**Need:** a welded-wire grid over beige or olive geotextile fabric, dirty and torn in places. An alpha mask for the wire alone is a bonus.

**Tile:** one barrier face (about 1 × 1 m).

**Resolution:** source **1024²** for one roughly 1 × 1 m face (2048 welcome). Ships at 1024, which gives about 1000 px/m: the wire grid stays readable on the nearest blocks a few metres from the gun. Minimum: 512.

### 9. Painted and rusted metal

**Replaces:** `makeMetalTextures` and `makeCorrugatedTextures`.

**Where:** all the procedural vehicles, wrecks, containers, the nest deck and steel parts.

**Need:**
- olive and grey painted steel, chipped and rusted
- a burnt, scorched metal variant for the wrecks
- corrugated container steel

**Tile:** about 1–2 m.

**Resolution:** source **2048²** for the painted/rusted steel (the nest deck is right under the gun), **1024²** for the burnt and corrugated variants. Ships at 1024 on LOW, 2048 on HIGH+ for the main steel. Minimum: 1024 / 512.

### 10. Plaster / brick wall

**Replaces:** `makePlasterTextures`.

**Where:** the village houses, farmsteads, ruins and the church.

**Need:** old rendered plaster over brick, cracked, with bare brick showing through, soot-stained.

**Tile:** about 2–3 m.

**Resolution:** source **1024²**. Ships at 1024 on MEDIUM+ and 512 on LOW. The buildings are 100–600 m away, except the ruins in the field (about 60 m+). Minimum: 512.

### 11. Bark and weathered wood

**Replaces:** `makeBarkTexture` and `makePlankTextures`.

**Where:** trees, burnt trees, telegraph poles, pallets, duckboards and the barns.

**Need:** pine bark (and a charred version), grey weathered planks.

**Tile:** about 1 m.

**Resolution:** source **1024²** for each of bark, charred bark and planks. Ships at 512 on LOW, 1024 on MEDIUM+. Poles, pallets and duckboards come within a few metres; the forests are far. Minimum: 512.

### 12. Burlap / canvas

**Replaces:** `makeBurlapTexture`.

**Where:** sandbags, tents, tarps and hay bales.

**Need:** coarse woven burlap, and olive military canvas.

**Tile:** about 0.5–1 m.

**Resolution:** source **1024²** each (burlap, canvas). Ships at 1024. The sandbags round the nest are within 1–2 m of the camera; with a 0.75 m tile, 1024 gives about 1360 px/m. Minimum: 512.

---

## Effects (the ones that are harder to find, and the most worth your choosing)

### 13. Smoke and fire flipbooks

**Replaces:** `makeParticleAtlas`.

**Where:** every explosion, burning wreck, molotov, muzzle smoke and city fire. The particles are big on screen.

**Need:** animated sprite sheets with alpha:
- billowing smoke puffs (dark and light)
- a fire / flame loop
- an explosion fireball
- dust bursts

Something like an 8 × 8 grid of 128–256 px frames each. Grey-on-black for smoke (I tint it), additive-friendly for fire.

**Resolution:** each sheet **2048²** as an 8 × 8 grid of **256 px** frames (64 frames). Ships at 2048 (1024 sheets of 128 px frames on LOW). For the explosion fireball, a **4096²** sheet of 512 px frames is welcome, since it fills the screen; I'll downscale it for lower presets. Minimum: 128 px frames.

### 14. Ground decals

**Replaces:** `makeDecalAtlas`.

**Where:** blood pools and splatters, scorch marks and blast craters on the ground, bullet impacts.

**Need:** an atlas (or separate PNGs with alpha) of 4–8 blood splatters, 3–4 scorch and burn marks, and a few bullet-hole or chip decals for concrete and metal.

**Resolution:** each decal **512²**, or one **2048²** atlas holding 16 of them (4 × 4 cells of 512). Ships as a 2048 atlas on MEDIUM+, 1024 on LOW. Blood at the wall is seen from 3–20 m, so 512 per decal covers a splat of about 2 m sharply. Minimum: 256 per decal.

### 15. Grass and weed clumps

**Replaces:** `makeGrassBladeTexture`.

**Where:** the grass cards scattered over the field near the wall.

**Need:** alpha-cutout textures of tall dry grass, weeds and nettle clumps, 2–4 variants on one sheet, roots at the bottom edge.

**Resolution:** a **1024²** sheet holding 2–4 clumps (about 512 × 1024 or 512 × 512 per clump), with alpha. Ships at 1024 (512 on LOW). Cards are under a metre tall and seen from 14 m outwards. Minimum: 512 sheet.

---

## Not needed

- Sky, fog, rain, lens dirt, glow sprites, the flag, window lights: these are fine generated, or are shaders rather than textures.
- Anything already covered by the models in [MODELS_NEEDED.md](MODELS_NEEDED.md) that comes with its own textures.
