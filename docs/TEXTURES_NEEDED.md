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
- **Size:** 2048² source is ideal (4096 is fine; I'll downscale). The game ships 512–2048 depending on the quality preset.
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

### 2. Grass / meadow turf

**Replaces:** `makeTurfTextures`.

**Where:** grass patches on the field, the hills, the meadows and fallow plots behind the base.

**Need:** a patchy, late-autumn, flattened grass-and-soil ground texture: brownish-green, not lawn green.

**Tile:** about 2–3 m.

### 3. Rock / cliff face

**Replaces:** `makeRockTextures`.

**Where:** the valley walls, the cliffs past the wings, every boulder. It is projected from three directions on steep slopes, so it must tile well on all axes.

**Need:** grey-brown weathered rock (granite or limestone), wet, with moss or dirt in the cracks.

**Tile:** about 3–5 m.

### 4. Cracked asphalt road

**Replaces:** `makeAsphaltTextures`.

**Where:** the road through the killing field out to the city.

**Need:** old, cracked, potholed asphalt with mud tracked over it. The faded centre line is added by the game.

**Tile:** about 3–4 m.

### 5. Dirt track / gravel

**New** (the rear track and the yard lanes are tinted mud right now).

**Need:** a rutted dirt or gravel farm track: compacted earth, gravel, tyre ruts.

**Tile:** about 2–4 m.

### 6. Farmland: ploughed soil and stubble

**New** (the field patchwork behind the base fakes these with stripes).

**Need:**
- ploughed furrowed soil (directional furrows)
- harvested stubble field (short straw rows)

Both directional, with the furrows or rows running along one axis.

**Tile:** about 3–5 m.

### 7. Concrete: wall, viaduct, slabs

**Replaces:** `makeConcreteTextures` and `makeSlabTextures`.

**Where:** the wall, the bunker until a tower model arrives, the broken viaduct, slabs and the floor slab of the ruins.

**Need:** weathered poured concrete with formwork lines, rain streaks and soot, plus a separate stained concrete slab or panel texture.

**Tile:** about 2–3 m.

### 8. HESCO barrier: wire mesh and geotextile

**Replaces:** `makeHescoTextures`.

**Where:** the defensive barrier blocks along the wall.

**Need:** a welded-wire grid over beige or olive geotextile fabric, dirty and torn in places. An alpha mask for the wire alone is a bonus.

**Tile:** one barrier face (about 1 × 1 m).

### 9. Painted and rusted metal

**Replaces:** `makeMetalTextures` and `makeCorrugatedTextures`.

**Where:** all the procedural vehicles, wrecks, containers, the nest deck and steel parts.

**Need:**
- olive and grey painted steel, chipped and rusted
- a burnt, scorched metal variant for the wrecks
- corrugated container steel

**Tile:** about 1–2 m.

### 10. Plaster / brick wall

**Replaces:** `makePlasterTextures`.

**Where:** the village houses, farmsteads, ruins and the church.

**Need:** old rendered plaster over brick, cracked, with bare brick showing through, soot-stained.

**Tile:** about 2–3 m.

### 11. Bark and weathered wood

**Replaces:** `makeBarkTexture` and `makePlankTextures`.

**Where:** trees, burnt trees, telegraph poles, pallets, duckboards and the barns.

**Need:** pine bark (and a charred version), grey weathered planks.

**Tile:** about 1 m.

### 12. Burlap / canvas

**Replaces:** `makeBurlapTexture`.

**Where:** sandbags, tents, tarps and hay bales.

**Need:** coarse woven burlap, and olive military canvas.

**Tile:** about 0.5–1 m.

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

### 14. Ground decals

**Replaces:** `makeDecalAtlas`.

**Where:** blood pools and splatters, scorch marks and blast craters on the ground, bullet impacts.

**Need:** an atlas (or separate PNGs with alpha) of 4–8 blood splatters, 3–4 scorch and burn marks, and a few bullet-hole or chip decals for concrete and metal.

### 15. Grass and weed clumps

**Replaces:** `makeGrassBladeTexture`.

**Where:** the grass cards scattered over the field near the wall.

**Need:** alpha-cutout textures of tall dry grass, weeds and nettle clumps, 2–4 variants on one sheet, roots at the bottom edge.

---

## Not needed

- Sky, fog, rain, lens dirt, glow sprites, the flag, window lights: these are fine generated, or are shaders rather than textures.
- Anything already covered by the models in [MODELS_NEEDED.md](MODELS_NEEDED.md) that comes with its own textures.
