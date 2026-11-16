# Models needed

The game already loads real models for:
- the M2HB
- the AC-130 and the B-36
- the soldier and the four survivors
- the grenade and the molotov
- the ammo crate and the sandbags
- 48 Poly Haven props in the yard and on the walkway

See [app/models/CREDITS.md](../app/models/CREDITS.md) for those.

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

## 2. Heavy-lift tandem-rotor transport helicopter (CH-47 class)

**Where:** the extraction cutscene. Three of them fly in over the hills, land in the yard, lower their ramps and take the garrison out. They fill the frame in the landing-zone, run, ramp and liftoff shots.

**Now:** a rounded box with two rotor discs. In the cutscene it reads as a white block.

**Need:**
- Military tandem-rotor transport.
- Both rotor heads as separate objects.
- The rear loading ramp as a separate object hinged at its bottom edge.
- A simple cabin interior visible through the open ramp (bench seats, red night lighting) is a big bonus.

**Budget:** about 40–60k triangles.

## 3. Attack helicopter (Apache / Cobra / Mi-24 class)

**Where:** the extraction cutscene. Two gunships sweep the field with searchlights; the "helos" shot follows the lead one from close behind.

**Now:** a procedural fuselage with stub wings, pods and rotors.

**Need:**
- Military attack helicopter.
- Main and tail rotors as separate objects.
- A chin turret or a mount point where the searchlight can sit.
- Rocket pods or stub wings.

**Budget:** about 30–50k triangles.

## 4. Military cargo truck (M35 / Ural / KrAZ class)

**Where:**
- parked in the yard
- wrecks on the field road
- the burnt-out truck on the rear road
- the truck in the ending's column

**Now:** procedural boxes and wheels, in covered and uncovered variants.

**Need:**
- Canvas-covered cargo truck.
- Ideally three versions: intact olive, uncovered, and a burnt-out wreck (rusty, no tyres, scorched).

**Budget:** about 15–30k triangles per variant.

## 5. Wrecked civilian cars

**Where:** about 16 abandoned cars along the road through the killing field, plus a few on the rear road. Visible from the gun all game.

**Now:**
- procedural sedans
- `kit/car` (a covered car from Poly Haven) in the yard

**Need:**
- 2–4 cars (sedan, hatchback, estate, a van).
- Abandoned and burnt versions: broken glass, flat or missing tyres, rust, soot.

**Budget:** about 5–15k triangles each.

## 6. Trees and vegetation set

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

## 7. Wrecked main battle tank

**Where:** a burnt tank out on the killing field, in plain view from the gun.

**Now:** procedural hull, turret and barrel.

**Need:** a burnt-out or knocked-out MBT (T-72 / M60 / Leopard class): scorched, a track off, turret slewed.

**Budget:** about 20–40k triangles.

## 8. Crashed helicopter wreck

**Where:** a downed helicopter lying in the field.

**Now:** a procedural fuselage with a broken tail.

**Need:** a crashed or burnt utility helicopter (UH-1 / UH-60 class), rotor blades bent or snapped.

**Budget:** about 15–30k triangles.

## 9. Rural buildings set

**Where:**
- the dead village and church on the far hills
- the hamlet on the right hills
- the farmsteads along the rear road
- the ruins near the field

**Now:** boxes with extruded gable roofs, plus a procedural ruin made of wall strips.

**Need:**
- an Eastern-European-style farmhouse (intact and ruined variants)
- a timber or brick barn
- a small village church with a spire
- 1–2 ruined, shelled houses

**Budget:** about 5–20k triangles each. They're seen from 100–600 m away, so silhouette and texture matter more than detail.

## 10. Shipping container (20 ft)

**Where:** a stack of them in the yard, plus single ones by the walls. Seen in the yard and cutscene shots.

**Now:** textured boxes with corrugated UVs and door bars.

**Need:** a rusty 20 ft ISO container with door details. 2–3 paint colours, or one I can tint.

**Budget:** about 2–5k triangles.

## 11. HESCO / defensive barrier unit

**Where:** the wall itself, the thing you defend all game.

**Now:** procedural fill-barrier blocks with a mesh texture.

**Need:**
- a HESCO-style mesh and fabric gabion unit (single and stacked)
- optionally a concrete T-wall section

It has to tile seamlessly along a wall.

**Budget:** about 1–4k triangles per unit.

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

## 16. Aircraft bomb

**Where:** the B-36's falling bomb sticks in the bombing-run shot.

**Now:** a procedural cylinder with fins.

**Need:** a Mk 82 / M117-style general-purpose bomb.

**Budget:** about 1–2k triangles.

## 17. Round hay bale

**Where:** the stubble fields behind the base, seen from the air in the extraction flyaway.

**Now:** a textured cylinder.

**Need:** a round straw bale, optionally wrapped.

**Budget:** about 300–800 triangles.
