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
- the wall crews' machine guns (the HK MG4 you sent, standing in for the M240; also in bay 3 of the hangar)
- the woods on the hills (spruce, pine and birch from the tree pack), the bushes and rocks in the field and on the farmland, and the dead trees standing in the killing field
- the crows: on the dead trees and the wall at night, in a flock among the dead at dawn, across the sun in the prologue (the model has no rig: the wings are folded, spread and flapped in the game's shader)
- the dawn resupply's hall (the old factory you sent; its front half cleared for the four bays)
- 48 Poly Haven props in the yard and on the walkway
- 17 more Poly Haven props for the dawn resupply hangar: steel shelving, hanging and wall lamps, the tool chest, drill press, office desk, storage cart, extinguishers, a flood light and crates

See [app/models/CREDITS.md](../app/models/CREDITS.md) for those.

Surface textures don't need to be sent any more: the scanned sets come from Poly Haven
(`scripts/textures/build_textures.py fetch`) and ambientCG (`scripts/textures/build_ambientcg.py`), both CC0,
and are downloaded and built directly. The same goes for any CC0 prop Poly Haven has
(`scripts/models/build_kit.mjs` downloads missing sources itself). The list below is what neither library has.

Everything below is still built from boxes, cylinders and cones in code. The list is in order of importance: how much screen time a thing gets, multiplied by how far its current look falls short.

Two of the files in the folder aren't used yet: `Searchlight.glb` (a Suez Canal searchlight, CC BY, Fishboe) and `House-2.glb` (a second house by Mateusz Woliński, CC BY). `House-3.glb` is the same house as `House-1`. Say if they should go in (the wing towers' lamps; the villages, see below).

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

**The pack you sent (`3D Models/Zombies`), looked at 2026-11-19:**
- one rigged zombie: about 3,600 triangles (inside the budget), a 137-bone HumanIK rig (`Zombie_Hips`, `Zombie_Spine`, ..., with full fingers), in centimetres
- three 4K texture sets on the same UVs (albedo, normal, metal/gloss, AO, height, emission): three looks from one mesh
- twelve clips, in place: walk, run, idle ×2, attack ×4, roar, get-hit, death ×2
- missing for this game: climbing, clawing at a wall, the burning flail, a crawl. The rig is a standard humanoid, so Mixamo clips for those can be retargeted onto it the way the soldier's are.
- source and licence aren't in the archives: send the page it came from so it can go into the credits.

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

## 3. Fuel tanker truck

**Where:** the tanker event: a fuel truck stalled on the road in front of the wall, which you shoot to blow up the crowd around it. It sits close to the gun, in plain view.

**Now:** the open-bed Ural with a plain cylinder for a tank.

**Need:** a military fuel bowser (an ATZ on a Ural or KrAZ chassis, an M49 or M978 class), with the tank as part of the model. A burnt-out version after the blast is a bonus.

**Budget:** about 10-25k triangles.

## 4. Burnt-out truck wreck

**Where:** the burning truck everybody remembers at the foot of the field, a second burnt truck further out, and the one in the ditch on the rear road.

**Now:** the Ural with its paint repainted to soot and rust in code. It still has its tyres and glass, so it reads as a dirty truck rather than a burnt one.

**Need:** a properly burnt-out military truck: tyres burnt off to the rims, the cab glass gone, the paint blistered, the bed frame bare. A Ural, KrAZ or ZIL to match the others is ideal, but any 6x6 will do.

**Budget:** about 10-25k triangles.

## 5. Wrecked main battle tank

**Where:** a burnt tank out on the killing field, in plain view from the gun.

**Now:** procedural hull, turret and barrel.

**Need:** a burnt-out or knocked-out MBT (T-72 / M60 / Leopard class): scorched, a track off, turret slewed.

**Budget:** about 20–40k triangles.

## 6. HESCO / defensive barrier unit

**Where:** the wall itself, the thing you defend all game.

**Now:** procedural fill-barrier blocks with a mesh texture.

**Need:**
- a HESCO-style mesh and fabric gabion unit (single and stacked)
- optionally a concrete T-wall section

It has to tile seamlessly along a wall.

**Budget:** about 1–4k triangles per unit.

## 7. Rural buildings set

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

## 8. Supply-drop parachute and pallet

**Where:** the night's supply drop: a crate comes down under a parachute in front of the wall, and the canopy collapses when it lands.

**Now:** a flat dome with line segments for the rigging, and the ammo crate.

**Need:** a cargo parachute (open canopy with rigging) and a strapped cargo pallet or A-22 bag. A collapsed-canopy version is a bonus.

**Budget:** about 3-8k triangles.

## 9. Van or minibus wreck

**Where:** the abandoned column on the road out, and the rear road. The cars cover the sedans and hatchbacks, but nothing taller breaks up the line.

**Now:** nothing: there are five car wrecks and no vans.

**Need:** a burnt or abandoned panel van or minibus (Transit or Sprinter class, a UAZ or a RAF minibus).

**Budget:** about 5-15k triangles.

## 10. Military tents

**Where:** five tents in the yard, with lit doorways. Seen in the yard, landing-zone and run shots.

**Now:** an extruded pentagon in canvas.

**Need:** a military canvas tent (modular or GP-medium style) with a door flap.

**Budget:** about 3–8k triangles.

## 11. Guard / searchlight tower

**Where:** the two searchlight towers at the wing ends, which carry the sweeping beams.

**Now:** procedural lattice, platform and lamp.

**Need:** a steel or timber watchtower with a platform. The lamp head should be separate so it can rotate.

**Budget:** about 5–15k triangles.

## 12. Utility poles and power pylon

**Where:**
- telephone poles along the field road and the new rear track
- a line of steel lattice pylons across the far valley

**Now:** a cylinder with crossarms, and a procedural box-beam pylon.

**Need:** a wooden telegraph pole with crossarm and insulators, and a steel lattice transmission pylon. I generate the wires myself.

**Budget:** pole about 300–1,000 triangles, pylon about 2–6k.

## 13. Portable toilets and water tank

**Where:** the yard's latrine row and the water tanks.

**Now:** boxes.

**Need:** a portable toilet cabin and an IBC tote or upright water tank.

**Budget:** about 1–3k triangles each.
