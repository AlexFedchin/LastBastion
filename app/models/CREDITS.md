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
  Animation: eleven clips from Adobe Mixamo (rifle run, walk, aiming idle, firing, three idles,
  two deaths, box carry, kneeling work), made on an auto-rigged copy of this mesh and retargeted
  onto its own skeleton at build time (scripts/models/retarget.mjs). Mixamo animations are
  royalty-free for use in games. The rifle rides its own joint so it can be slung on the back.
- **Grenade, Molotov**: re-scaled to life size (10.5 cm, 34 cm), textures to WebP.
- **Ammo crate**: untextured source; scaled to 0.9 m and painted olive drab.
- **Sandbags**: two piles, 1.6 m long, PBR set at 1024/512 px, DirectX normal map converted, ~6k triangles each.

## Bastion kit (`kit/*.glb`)

Set dressing for the walkway, the bunker roof and the yard: scanned props from [Poly Haven](https://polyhaven.com/models),
all **CC0** (public domain; credit not required, given anyway). Converted by `scripts/models/build_kit.mjs`: transforms baked,
primitives joined per material, origin on the floor, simplified to a triangle budget, textures to 256-1024 px WebP;
the ammo can is scaled 1.3x to .50 cal size. The Jersey barriers, cement sacks and food tins are darkened in the game.

| File | Poly Haven asset | Author(s) |
|---|---|---|
| `kit/ammo.glb` | [Ammo Box](https://polyhaven.com/a/ammo_box) | DanKit |
| `kit/radio.glb` | [Vintage Radio Transceiver](https://polyhaven.com/a/vintage_radio_transceiver) | Mateusz Sadek |
| `kit/binoculars.glb` | [Binoculars](https://polyhaven.com/a/binoculars) | Derek Wight |
| `kit/gasmask.glb` | [Old Gas Mask](https://polyhaven.com/a/old_gas_mask) | Michał Wiśniewski |
| `kit/jerry.glb` | [Metal Jerrycan Green](https://polyhaven.com/a/metal_jerrycan_green) | Ulan Cabanilla |
| `kit/jerrySteel.glb` | [Metal Jerrycan](https://polyhaven.com/a/metal_jerrycan) | Sean Buckley |
| `kit/jerryPlastic.glb` | [Plastic Jerrycan](https://polyhaven.com/a/plastic_jerrycan) | Ulan Cabanilla |
| `kit/medbox.glb` | [Medical Box](https://polyhaven.com/a/medical_box) | Ulan Cabanilla |
| `kit/thermos.glb` | [Modified Thermos](https://polyhaven.com/a/modified_thermos) | Alex Weber |
| `kit/searchlight.glb` | [Portable Searchlight](https://polyhaven.com/a/portable_searchlight) | Elijah Cragg |
| `kit/foodCans.glb` | [Russian Food Cans 01](https://polyhaven.com/a/russian_food_cans_01) | Kosan Aziz |
| `kit/rations.glb` | [Long Life Food](https://polyhaven.com/a/long_life_food) | Mia Pecina Zorko |
| `kit/trashbag.glb` | [Trashbag](https://polyhaven.com/a/trashbag) | Benny Weimer |
| `kit/crateLong.glb` | [Old Military Crate](https://polyhaven.com/a/old_military_crate) | Jack Mava |
| `kit/crateWood.glb` | [Wooden Military Crate](https://polyhaven.com/a/wooden_military_crate) | Prabhjinder Singh |
| `kit/crateSmall.glb` | [Wooden Crate 02](https://polyhaven.com/a/wooden_crate_02) | James Ray Cock, Jurita Burger |
| `kit/drumRed.glb` | [Barrel_01](https://polyhaven.com/a/Barrel_01) | Jorge Camacho |
| `kit/drumPlastic.glb` | [Barrel 02](https://polyhaven.com/a/Barrel_02) | Jorge Camacho |
| `kit/drumBlue.glb` | [Barrel 03](https://polyhaven.com/a/barrel_03) | Serhii Khromov |
| `kit/stove.glb` | [Barrel Stove](https://polyhaven.com/a/barrel_stove) | MP |
| `kit/cement.glb` | [Cement Bag](https://polyhaven.com/a/cement_bag) | PierreB3D |
| `kit/ladder.glb` | [Wooden Ladder](https://polyhaven.com/a/wooden_ladder) | Miroslav Turura |
| `kit/spade.glb` | [Rusted Spade 01](https://polyhaven.com/a/rusted_spade_01) | Blemonade |
| `kit/pick.glb` | [Picke Dirty 01](https://polyhaven.com/a/picke_dirty_01) | Dennis Halbeck |
| `kit/sledge.glb` | [Sledgehammer 01](https://polyhaven.com/a/sledgehammer_01) | Dylan Guzman |
| `kit/crowbar.glb` | [Crowbar 01](https://polyhaven.com/a/crowbar_01) | Alexander Otterbeck |
| `kit/generator.glb` | [Portable Generator](https://polyhaven.com/a/portable_generator) | James Ray Cock |
| `kit/lpg.glb` | [Small Lpg Tank](https://polyhaven.com/a/small_lpg_tank) | Ulan Cabanilla |
| `kit/propane.glb` | [Propane Tank](https://polyhaven.com/a/propane_tank) | Slinc |
| `kit/barrier.glb` | [Concrete Road Barrier](https://polyhaven.com/a/concrete_road_barrier) | Amal Kumar |
| `kit/barrierTall.glb` | [Concrete Road Barrier 02](https://polyhaven.com/a/concrete_road_barrier_02) | Amal Kumar |
| `kit/tyre.glb` | [Old Tyre](https://polyhaven.com/a/old_tyre) | MP |
| `kit/trashcans.glb` | [Metal Trash Can](https://polyhaven.com/a/metal_trash_can) | GurJas Studios |
| `kit/handtruck.glb` | [Hand Truck](https://polyhaven.com/a/hand_truck) | Mutanzom3D |
| `kit/cardboard.glb` | [Cardboard Box 01](https://polyhaven.com/a/cardboard_box_01) | Rahul Chaudhary |
| `kit/compressor.glb` | [Old Military Compressor](https://polyhaven.com/a/old_military_compressor) | Brian Speight |
| `kit/welder.glb` | [Portable Welding Cart](https://polyhaven.com/a/portable_welding_cart) | Georgii Gorbunov |
| `kit/toolcart.glb` | [Tool Cart](https://polyhaven.com/a/tool_cart) | Savva Zakharov |
| `kit/rack.glb` | [Worn Metal Rack](https://polyhaven.com/a/worn_metal_rack) | Luca B |
| `kit/picnic.glb` | [Wooden Picnic Table](https://polyhaven.com/a/wooden_picnic_table) | Ulan Cabanilla |
| `kit/stool.glb` | [Metal Stool 01](https://polyhaven.com/a/metal_stool_01) | Ulan Cabanilla |
| `kit/foldstool.glb` | [Folding Wooden Stool](https://polyhaven.com/a/folding_wooden_stool) | Ulan Cabanilla |
| `kit/car.glb` | [Covered Car](https://polyhaven.com/a/covered_car) | MP |
| `kit/utility.glb` | [Utility Box 01](https://polyhaven.com/a/utility_box_01) | James Ray Cock |
| `kit/aircon.glb` | [Exterior Aircon Unit](https://polyhaven.com/a/exterior_aircon_unit) | Monsta3D |
| `kit/toolbox.glb` | [Metal Toolbox](https://polyhaven.com/a/metal_toolbox) | Mateusz Sadek |
| `kit/rifle.glb` | [Bolt Action Rifle 7.62](https://polyhaven.com/a/bolt_action_rifle_7_62) | Mateusz Sadek |
| `kit/flashlight.glb` | [Signal Flashlight](https://polyhaven.com/a/signal_flashlight) | Jiří Ptáček |
