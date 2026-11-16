# Models needed

The game already loads real models for:
- the M2HB
- the AC-130 and the B-36
- the CH-47 lifters and the Apache gunships in the extraction
- the soldier and the four survivors
- the Ural trucks (covered, open, burnt out) and five wrecked cars
- the crashed helicopter in the field
- the shipping containers, the round hay bales and the bombs
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

## 2. The central tower (the bastion's bunker, your gun position)

**Where:** the heart of the base. You sit on its roof behind the M2 all game. It is the centre of the gun view's foreground and of almost every cutscene shot: overrun, bombers, ramp, liftoff, flyaway and the ending's crane.

**Now:** a single concrete box with:
- a stepped blast plinth and two buttresses
- a roof parapet
- two firing-slit frames on the front
- a ladder down the back

It uses one tiled concrete material.

**Need:** a fortified reinforced-concrete bunker or blockhouse tower:
- weathered, rain-stained and scarred by fire and bullets, with exposed rebar here and there
- firing slits (embrasures) in the front face
- a flat roof that serves as the gun position: walkable, with a low parapet

Nice to have:
- blast plinth or buttresses at the base
- a steel door at the back
- an external ladder or stairs up to the roof
- vents, cable runs and drainage stains

The roof stays mostly clear: the nest deck, the sandbag ring, the shelter, crates and the crew are placed on it by the game.

**Fixed dimensions** (the gun camera, the nest and the roof dressing are placed relative to them; a model that differs will be scaled or adapted to fit):
- footprint about 16.5 m wide (along the wall) × 9 m deep
- roof deck 11.6 m above the ground
- the front face is flush with the wall line, and the wall wings join its two front corners at a 29° sweep back

**Budget:** about 20–50k triangles. It is seen from metres away (from the roof) up to a few hundred metres (from the air), so a high-resolution or trim-sheet concrete texture matters more than polygons.

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

## 4. Wrecked main battle tank

**Where:** a burnt tank out on the killing field, in plain view from the gun.

**Now:** procedural hull, turret and barrel.

**Need:** a burnt-out or knocked-out MBT (T-72 / M60 / Leopard class): scorched, a track off, turret slewed.

**Budget:** about 20–40k triangles.

## 5. Rural buildings set

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

## 6. HESCO / defensive barrier unit

**Where:** the wall itself, the thing you defend all game.

**Now:** procedural fill-barrier blocks with a mesh texture.

**Need:**
- a HESCO-style mesh and fabric gabion unit (single and stacked)
- optionally a concrete T-wall section

It has to tile seamlessly along a wall.

**Budget:** about 1–4k triangles per unit.

## 7. Military tents

**Where:** five tents in the yard, with lit doorways. Seen in the yard, landing-zone and run shots.

**Now:** an extruded pentagon in canvas.

**Need:** a military canvas tent (modular or GP-medium style) with a door flap.

**Budget:** about 3–8k triangles.

## 8. Guard / searchlight tower

**Where:** the two searchlight towers at the wing ends, which carry the sweeping beams.

**Now:** procedural lattice, platform and lamp.

**Need:** a steel or timber watchtower with a platform. The lamp head should be separate so it can rotate.

**Budget:** about 5–15k triangles.

## 9. Utility poles and power pylon

**Where:**
- telephone poles along the field road and the new rear track
- a line of steel lattice pylons across the far valley

**Now:** a cylinder with crossarms, and a procedural box-beam pylon.

**Need:** a wooden telegraph pole with crossarm and insulators, and a steel lattice transmission pylon. I generate the wires myself.

**Budget:** pole about 300–1,000 triangles, pylon about 2–6k.

## 10. Portable toilets and water tank

**Where:** the yard's latrine row and the water tanks.

**Now:** boxes.

**Need:** a portable toilet cabin and an IBC tote or upright water tank.

**Budget:** about 1–3k triangles each.

---

## New asks

Things I noticed while putting the last batch in. Same rules as above.

## 11. Fuel tanker truck

**Where:** the tanker event: a fuel truck stalled on the road in front of the wall, which you shoot to blow up the crowd around it. It sits close to the gun, in plain view.

**Now:** the open-bed Ural with a plain cylinder for a tank.

**Need:** a military fuel bowser (an ATZ on a Ural or KrAZ chassis, an M49 or M978 class), with the tank as part of the model. A burnt-out version after the blast is a bonus.

**Budget:** about 10-25k triangles.

## 12. Burnt-out truck wreck

**Where:** the burning truck everybody remembers at the foot of the field, a second burnt truck further out, and the one in the ditch on the rear road.

**Now:** the Ural with its paint repainted to soot and rust in code. It still has its tyres and glass, so it reads as a dirty truck rather than a burnt one.

**Need:** a properly burnt-out military truck: tyres burnt off to the rims, the cab glass gone, the paint blistered, the bed frame bare. A Ural, KrAZ or ZIL to match the others is ideal, but any 6x6 will do.

**Budget:** about 10-25k triangles.

## 13. Czech hedgehog (anti-tank obstacle)

**Where:** 46 of them scattered across the killing field, right in front of the gun.

**Now:** three crossed L-section beams in flat steel.

**Need:** a welded steel hedgehog, rusty, ideally with a bit of wire caught on it.

**Budget:** about 300-1,500 triangles. It is instanced.

## 14. Supply-drop parachute and pallet

**Where:** the night's supply drop: a crate comes down under a parachute in front of the wall, and the canopy collapses when it lands.

**Now:** a flat dome with line segments for the rigging, and the ammo crate.

**Need:** a cargo parachute (open canopy with rigging) and a strapped cargo pallet or A-22 bag. A collapsed-canopy version is a bonus.

**Budget:** about 3-8k triangles.

## 15. Van or minibus wreck

**Where:** the abandoned column on the road out, and the rear road. The cars cover the sedans and hatchbacks, but nothing taller breaks up the line.

**Now:** nothing: there are five car wrecks and no vans.

**Need:** a burnt or abandoned panel van or minibus (Transit or Sprinter class, a UAZ or a RAF minibus).

**Budget:** about 5-15k triangles.
