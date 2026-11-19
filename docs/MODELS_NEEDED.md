# Models needed

The game already loads real models for:
- the M2HB
- the AC-130 and the B-36
- the CH-47 lifters and the Apache gunships in the extraction
- the soldier and the four survivors
- the Ural trucks (covered, open, burnt out) and five wrecked cars
- the crashed helicopter in the field
- the shipping containers, the round hay bales and the bombs
- the farmhouse and the village church
- the czech hedgehogs in the field
- the weapons crates (the recovery team's loads, the supply drop, the stacks on the nest roof)
- the grenade and the molotov
- the central tower (your own model)
- the sandbags
- 48 Poly Haven props in the yard and on the walkway
- 17 more Poly Haven props for the dawn resupply hangar: the overhead crane, steel shelving, hanging and wall lamps, the tool chest, drill press, office desk, storage cart, extinguishers, a flood light and crates

See [app/models/CREDITS.md](../app/models/CREDITS.md) for those.

Surface textures don't need to be sent any more: the scanned sets come from Poly Haven
(`scripts/textures/build_textures.py fetch`) and ambientCG (`scripts/textures/build_ambientcg.py`), both CC0,
and are downloaded and built directly. The same goes for any CC0 prop Poly Haven has
(`scripts/models/build_kit.mjs` downloads missing sources itself). The list below is what neither library has.

Everything below is still built from boxes, cylinders and cones in code. The list is in order of importance: how much screen time a thing gets, multiplied by how far its current look falls short.

## What to send for any model

- **Format:** `.glb` / `.gltf` preferred. `.fbx` and `.blend` are fine; I'll convert them with `scripts/models/build_models.mjs`.
- **Licence:** CC0 or CC-BY (or one you own). Note the source, author and licence so it can go into `CREDITS.md`.
- **Scale:** real-world size. Any up-axis is fine; I'll reorient it.
- **Detail:** anything up to a few hundred thousand triangles is fine; I'll simplify it. The budgets below are what I'll reduce each model to in-game.
- **Textures:** PBR (colour, normal, roughness/metal, optional AO), any resolution. I'll resize them to 512–2048 px WebP.
- **Moving parts:** rotors, ramps, doors and turrets as separate objects (or at least separate meshes), each pivoting at its hinge or hub.
- **Damage:** the setting is a war zone at night in the rain. Worn, dirty or battle-damaged versions beat clean showroom ones. Where both are listed, an intact and a burnt-out variant is ideal.

---

## 1. Zombie (infected civilian / soldier)

**Where:** everywhere. The horde is what you look at for the entire game: hundreds to thousands on screen, close up at the wall, as corpses piled at its foot.

**Now:** a procedural mannequin with rounded limbs, a simple face, and gear (helmet, vest, pack, cap, hi-vis) switched per instance. It is animated in the vertex shader so thousands can draw in a few calls.

**Need:**
- 2–4 rigged humanoid zombies on one shared skeleton: a mix of civilians, workers and soldiers, with torn clothing and gore.
- Mixamo-compatible rigs, or meshes I can auto-rig on Mixamo.
- Animations wanted: shamble walk, sprint, clawing at a wall, climbing, a couple of deaths and a burning flail. Mixamo clips work; I'll retarget them like the soldier's.

**Budget:** about 3–6k triangles each, one material and one texture atlas per variant. They will be baked into an animation texture, so they stay instanced.

**Note:** this is the biggest visual upgrade, but also the biggest engineering job. The renderer has to move from shader-posed parts to baked skinned animation.

## 2. The central tower — done (your own model)

The tower is the hand-made `3D Models/Tower/Tower.glb` (the folder next to the repo), built into `app/models/tower.glb` by
`node scripts/models/build_models.mjs tower` (it reads the file straight from that folder, so after an
edit in Blender just export over it and run that command). The build keeps the model's frame and prints a
warning if a new export moves what the game is laid out to:
- the front face of the body (`Cube`) at z = −4.64 (the game puts it on the wall line)
- the roof (`Cube.006`) and the nest platform (`Cube.001`) at 9.0 m (`WORLD.TOWER_TOP`; the gun camera is 1.6 m above)
- the parapet top at 9.95 m (the roof's sandbags sit on it)

Its concrete is painted in the game with the wall's own (`slab`: ambientCG Concrete044C, the texture the
model was made with), so materials named `…Concrete…` can keep any texture in Blender. Every other
material ships as exported, graded darker for the night.

### Planned: the taller remake, with the roof dressed in Blender

The tower will be remade at the original height: roof and nest platform at 11.6 m (the gun camera at
13.2 m), same footprint and front face. The roof's decorations will be placed in the model too. When
that export arrives:
- set the build's expected roof/platform height to the new one, and `WORLD.TOWER_TOP` / `WORLD.CAM.y`
  to match (the cutscenes and the audio listener read them)
- delete the static props from `dressRoof` (`src/world/dressing.js`) that the model now has: the hatch,
  vents, dish, scope, drains, tar patches, cable runs, tarp, kit, generator, jerrycans, stretcher and the
  parapet and blast-wall sandbags
- keep in code what moves or lights up, unless the model marks a spot for it with an empty: the gun and
  its nest sandbags, the two roof soldiers (`env.roofSoldiers`, animated), the work lamp's light, the
  flag and the blinking beacon
- re-shoot the roof and gun views before/after

## 3. Trees and vegetation set

**Where:**
- forests on every hill around the valley
- dead trees in the killing field
- the new woods, hedgerows and copses behind the base

These show in the gun view and in every cutscene.

**Now:** stacked cones (conifers), bare procedural branch trees, poles with stubs for burnt pines, and lumpy blobs for bushes.

**Need:**
- 2–3 conifers (spruce/pine)
- 1–2 burnt or dead pines
- 2–3 bare, dead deciduous trees for the field
- 1–2 shrubs or bushes

They will be instanced by the thousand, so they must be low-poly: impostor-friendly, or with LODs.

**Budget:** about 500–2,000 triangles per tree, alpha-cut foliage cards are fine. Bushes about 200–800.

## 4. Fuel tanker truck

**Where:** the tanker event: a fuel truck stalled on the road in front of the wall, which you shoot to blow up the crowd around it. It sits close to the gun, in plain view.

**Now:** the open-bed Ural with a plain cylinder for a tank.

**Need:** a military fuel bowser (an ATZ on a Ural or KrAZ chassis, an M49 or M978 class), with the tank as part of the model. A burnt-out version after the blast is a bonus.

**Budget:** about 10-25k triangles.

## 5. Burnt-out truck wreck

**Where:** the burning truck everybody remembers at the foot of the field, a second burnt truck further out, and the one in the ditch on the rear road.

**Now:** the Ural with its paint repainted to soot and rust in code. It still has its tyres and glass, so it reads as a dirty truck rather than a burnt one.

**Need:** a properly burnt-out military truck: tyres burnt off to the rims, the cab glass gone, the paint blistered, the bed frame bare. A Ural, KrAZ or ZIL to match the others is ideal, but any 6x6 will do.

**Budget:** about 10-25k triangles.

## 6. M240 machine gun

**Where:**
- the crewed M240s on the wall (two to four, firing all night beside you)
- bay 3 of the dawn resupply hangar, on its sandbags, where you buy wall gunners

**Now:** the soldier's rifle stands in for it on the wall, and the bolt-action rifle prop lies on the sandbags in the hangar.

**Need:** an M240B/G (or a PKM, if that fits the setting better) with its bipod, ideally with the feed cover and an ammo belt as separate meshes.

**Budget:** about 3-8k triangles.

## 7. Wrecked main battle tank

**Where:** a burnt tank out on the killing field, in plain view from the gun.

**Now:** procedural hull, turret and barrel.

**Need:** a burnt-out or knocked-out MBT (T-72 / M60 / Leopard class): scorched, a track off, turret slewed.

**Budget:** about 20–40k triangles.

## 8. HESCO / defensive barrier unit

**Where:** the wall itself, the thing you defend all game.

**Now:** procedural fill-barrier blocks with a mesh texture.

**Need:**
- a HESCO-style mesh and fabric gabion unit (single and stacked)
- optionally a concrete T-wall section

It has to tile seamlessly along a wall.

**Budget:** about 1–4k triangles per unit.

## 9. Rural buildings set

**Where:**
- the dead village and church on the far hills
- the hamlet on the right hills
- the farmsteads along the rear road
- the ruins near the field

**Now:** the farmhouses and village houses use the single-storey house you sent (some with the roof burnt off), and each village has the church you sent. The barns and the ruins are still boxes with extruded gable roofs and wall strips.

**Need:**
- a timber or brick barn
- 1–2 ruined, shelled houses
- a second farmhouse (two storeys, or a different plan) so the village isn't one house repeated

**Budget:** about 5–20k triangles each. They're seen from 100–600 m away, so silhouette and texture matter more than detail.

## 10. Supply-drop parachute and pallet

**Where:** the night's supply drop: a crate comes down under a parachute in front of the wall, and the canopy collapses when it lands.

**Now:** a flat dome with line segments for the rigging, and the ammo crate.

**Need:** a cargo parachute (open canopy with rigging) and a strapped cargo pallet or A-22 bag. A collapsed-canopy version is a bonus.

**Budget:** about 3-8k triangles.

## 11. Van or minibus wreck

**Where:** the abandoned column on the road out, and the rear road. The cars cover the sedans and hatchbacks, but nothing taller breaks up the line.

**Now:** nothing: there are five car wrecks and no vans.

**Need:** a burnt or abandoned panel van or minibus (Transit or Sprinter class, a UAZ or a RAF minibus).

**Budget:** about 5-15k triangles.

## 12. Military tents

**Where:** five tents in the yard, with lit doorways. Seen in the yard, landing-zone and run shots.

**Now:** an extruded pentagon in canvas.

**Need:** a military canvas tent (modular or GP-medium style) with a door flap.

**Budget:** about 3–8k triangles.

## 13. Guard / searchlight tower

**Where:** the two searchlight towers at the wing ends, which carry the sweeping beams.

**Now:** procedural lattice, platform and lamp.

**Need:** a steel or timber watchtower with a platform. The lamp head should be separate so it can rotate.

**Budget:** about 5–15k triangles.

## 14. Utility poles and power pylon

**Where:**
- telephone poles along the field road and the new rear track
- a line of steel lattice pylons across the far valley

**Now:** a cylinder with crossarms, and a procedural box-beam pylon.

**Need:** a wooden telegraph pole with crossarm and insulators, and a steel lattice transmission pylon. I generate the wires myself.

**Budget:** pole about 300–1,000 triangles, pylon about 2–6k.

## 15. Portable toilets and water tank

**Where:** the yard's latrine row and the water tanks.

**Now:** boxes.

**Need:** a portable toilet cabin and an IBC tote or upright water tank.

**Budget:** about 1–3k triangles each.

## 16. Crow (animated)

**Where:**
- flocks on the killing field at dawn, picking at the dead, lifting off when the gun fires
- a few on the wall's parapet and the dead trees during the night
- birds circling over the field in the dawn chronicle and the ending shots

The sound is already in: crows call over the valley at dawn and a flock's wings go up after first light, but there is nothing to see. The chronicle's lines talk about them ("The crows had learned where to find us").

**Now:** nothing (sound only).

**Need:** a carrion crow or raven, rigged, with these clips: idle (standing, head turns), peck at the ground, hop, take-off, flap (a flying loop), glide. One model is enough; I tint and scale copies for variety and instance them by the dozen.

**Budget:** about 500–2,000 triangles (they are small and many), one 512–1024 px texture.
