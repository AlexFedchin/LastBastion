# Last Bastion — model credits

Downloaded 3D models replace the game's earlier procedural ones. Each is
converted by `scripts/models/build_models.mjs`: reoriented to the game's axes,
scaled to metres, unseen parts removed, simplified, textures resized to WebP,
meshopt-compressed.

| File | What it is | Source | Author | License |
|---|---|---|---|---|
| `m2hb.glb` | M2HB .50 cal: the player's gun | _TODO_ | _TODO_ | _TODO_ |
| `ac130.glb` | AC-130 gunship (Spectre); also used for the resupply C-130 | _TODO_ | _TODO_ | _TODO_ |
| `b36.glb` | B-36 bomber | _TODO_ | _TODO_ | _TODO_ |
| `soldier.glb` | Rigged soldier (contractor kit, rifle): wall crews, the patrol, the recovery team, the men on the roof | _TODO_ | _TODO_ | _TODO_ |
| `grenade.glb` | Hand grenade, pin and ring | _TODO_ (Sketchfab) | _TODO_ | _TODO_ |
| `molotov.glb` | Molotov bottle with rag | _TODO_ (Sketchfab) | _TODO_ | _TODO_ |
| `crate.glb` | Wooden ammunition crate | _TODO_ | _TODO_ | _TODO_ |
| `sandbags.glb` | Two scanned sandbag piles ("Low poly Sandbag" 01, 02) | _TODO_ | _TODO_ | _TODO_ |

## What was changed

- **M2HB**: rotated from Z-up to the game's camera space (barrel along −z), scaled so the
  muzzle sits where the old gun's did. Geometry simplified to ~74k triangles. The five PBR texture
  sets are packed as colour, OpenGL normal, and occlusion/roughness/metalness, at 2048 px for the
  receiver and 1024 px for everything else.
- **AC-130**: re-centred, geometry thinned to ~85k triangles, textures reduced to 512 px.
  The four propellers are cut out of the airframe into separate nodes so they can spin.
- **B-36**: scaled to its real 70.1 m wingspan. The cockpit interior, seats, landing gear,
  open bomb-bay doors, landing flaps and jet turbine fans are removed. Simplified to ~43k
  triangles; paint texture at 1024 px. The six pusher propellers are separate nodes.
- **Soldier**: the skinned parts are baked into the rifle-ready pose the scene was in, merged with
  the rifle (now riding the right hand) and the pouches (the chest) into one skinned mesh with one
  material on a 2048 px atlas (texture sets resized to 512 px cells; the rifle is flat gunmetal),
  simplified to ~13k triangles. Loose rounds, spare magazines and the smoke card are dropped.
  The game poses the Mixamo skeleton procedurally (src/game/soldier.js).
- **Grenade, Molotov**: re-scaled to life size (10.5 cm, 34 cm), textures to WebP.
- **Ammo crate**: untextured source; scaled to 0.9 m and painted olive drab.
- **Sandbags**: two piles, 1.6 m long, PBR set at 1024/512 px, DirectX normal map converted, ~6k triangles each.
