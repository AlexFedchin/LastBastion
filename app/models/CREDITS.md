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
| `survivor_man.glb` | Civilian man (casual, vest): the escort, the ending's column | _TODO_ | _TODO_ | _TODO_ |
| `survivor_woman.glb` | Civilian woman ("Alison", RenderPeople free rigged sample) | RenderPeople | RenderPeople free-model EULA (check) | renderpeople.com |
| `survivor_man2.glb` | Civilian man ("Eric", RenderPeople free rigged sample) | RenderPeople | RenderPeople free-model EULA (check) | renderpeople.com |
| `survivor_child.glb` | Child ("Leo") | _TODO_ | _TODO_ | _TODO_ |
| `grenade.glb` | Hand grenade, pin and ring | _TODO_ (Sketchfab) | _TODO_ | _TODO_ |
| `molotov.glb` | Molotov bottle with rag | _TODO_ (Sketchfab) | _TODO_ | _TODO_ |
| `crate.glb` | Wooden ammunition crate (no longer used: the weapons crate replaced it) | _TODO_ | _TODO_ | _TODO_ |
| `sandbags.glb` | Two scanned sandbag piles ("Low poly Sandbag" 01, 02) | _TODO_ | _TODO_ | _TODO_ |
| `car_sedan.glb` | Rusted, stripped sedan (Car-1) | [Sketchfab](https://sketchfab.com/kryik1023) | Renafox | CC BY 4.0 |
| `car_police.glb`, `car_police_flip.glb` | Burnt police sedan, upright and on its roof (Car-2) | [Sketchfab](https://sketchfab.com/kryik1023) | Renafox | CC BY 4.0 |
| `car_hatch.glb`, `car_saloon.glb` | Two burnt-out cars, a compact MPV and a saloon (Car-3) | [Sketchfab](https://sketchfab.com/kryik1023) | Renafox | CC BY 4.0 |
| `apache.glb` | AH-64D Apache: the extraction's gunships | [Sketchfab](https://sketchfab.com/MirzaArrafiERV_45) | Muhamad Mirza Arrafi | CC BY 4.0 |
| `ch47.glb` | CH-47 Chinook: the extraction's lifters | [Sketchfab](https://sketchfab.com/MirzaArrafiERV_45) | Muhamad Mirza Arrafi | CC BY 4.0 |
| `ural.glb`, `ural_burnt.glb` | Ural-4320 army truck; the burnt-out wreck is derived from it | [Sketchfab](https://sketchfab.com/javanilga) | javanilga | CC BY 4.0 |
| `heliwreck.glb` | Crashed helicopter in the field | [Sketchfab](https://sketchfab.com/jigar6102021) | J1G4R | CC BY 4.0 |
| `container.glb` | Rusty 20 ft shipping container | [Sketchfab](https://sketchfab.com/sousinho) | Sousinho | CC BY 4.0 |
| `bale.glb` | Round hay bale | [Sketchfab](https://sketchfab.com/FrodoUndead) | FrodoUndead | CC BY 4.0 |
| `bomb.glb` | General-purpose aircraft bomb: the B-36s' sticks and the air strike | [Sketchfab](https://sketchfab.com/Youssef.Loukili) | Youssef.Loukili | CC BY 4.0 |
| `house.glb` | Single-storey house: the farmhouses and the village houses | [Sketchfab: House](https://sketchfab.com/3d-models/house-cfaf9a6c3a304dd9948044f8a63e391f) | Mateusz Woliński | CC BY 4.0 |
| `mcrate.glb` | Weapons crate: what each man of the recovery team carries home, the supply drop's load, the stacks on the nest roof | [Sketchfab: Weapons Crate](https://sketchfab.com/3d-models/weapons-crate-6597d3858df94da698ece8e0038f50b7) | Sousinho | CC BY 4.0 |
| `church.glb` | The village church and its bell tower, on the far hills | [Sketchfab: Church](https://sketchfab.com/3d-models/church-867a847b67364484bf44912e1af190af) | Tiago Lopes | CC BY 4.0 |
| `hedgehog.glb` | Czech hedgehogs in the killing field | [Sketchfab: Rusted Czech Hedgehog](https://sketchfab.com/3d-models/rusted-czech-hedgehog-cfa712e8851a4881989ea890bfc6910e) | GrostyBoi | CC BY 4.0 |

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
- **Survivors**: each auto-rigged in Mixamo (from scripts/models/export_unrigged.mjs zips), merged
  into one skinned mesh on one atlas and simplified to ~7k triangles (child ~9k). Animation: seven
  Mixamo clips (sad walk, arm-injured walk, limp, two runs, sad idle, fall-forward death), made on
  one character and retargeted onto each at build time.
- **Grenade, Molotov**: re-scaled to life size (10.5 cm, 34 cm), textures to WebP.
- **Ammo crate**: untextured source; scaled to 0.9 m and painted olive drab.
- **Sandbags**: two piles, 1.6 m long, PBR set at 1024/512 px, DirectX normal map converted, ~6k triangles each.

- **Vehicles and field props** (`scripts/models/build_vehicles.mjs`): each turned to the game's axes (length
  along +x, or nose +z for the helicopters), scaled to its real size, textures to WebP at 512-2048 px.
  - Cars: each wreck is its own file (Car-2 and Car-3 each held two), its long axis laid on x, 5.2 m (the sedans) or
    4.3-4.5 m; simplified to ~7k triangles.
  - Ural: scaled to 7.37 m; the canvas tilt is cut out into its own node so the open-bed trucks can drop it. The
    burnt wreck has no canvas and its paint repainted in code to soot and rust.
  - CH-47: fuselage scaled to 15.46 m. Both rotors are separate nodes on their hubs; the ramp's two treadway boards
    are cut out and hinged so they lower to the ground. Anchor points (ramp foot, lights) are in the root's extras.
  - Apache: scaled to 17.7 m rotor tip to tail. The main and tail rotor blades are cut out of the airframe mesh
    into nodes on their hubs; anchors for the chin gun, searchlight, rocket pods and lights.
  - Crashed helicopter: spec-gloss materials converted to metal-rough, simplified from 121k to 22k triangles.
  - Container: scaled to ISO 20 ft (6.06 x 2.59 x 2.44 m); the shipping line's painted logo is filled in from the rust
    around it. The game tints some olive.
  - Hay bale: the round bale only (the square one is dropped), 1.5 m across, ~700 triangles.
  - Bomb: laid nose +z, 2.2 m.
  - House: the ground plane dropped, scaled to 12 m, the roof a node of its own so burnt-out houses can stand
    open; simplified to ~5k triangles.
  - Weapons crate: scaled to 0.9 m long, ~1.5k triangles.
  - Church: the interior (pews, altar, candles, chalices) and the ground plate dropped, scaled up by half to a
    village church (12.6 x 18.8 m tall), ~3.8k triangles.
  - Czech hedgehog: scaled to 2.1 m across, simplified to ~1.8k triangles, a light night grade and rust.
  - CH-47 (second pass): the whole rear ramp is now a node hinged at the cabin floor, so it lowers to the ground and
    shuts; its treadway boards are a child node that slides back up it.
  - Night grade: every colour texture is darkened and desaturated in the build so the models sit in the night
    scene. The car wrecks, the burnt Ural, the crashed helicopter and the containers also get rust laid over
    them from ambientCG's CC0 [Rust009](https://ambientcg.com/a/Rust009) (colour), with
    [Metal041B](https://ambientcg.com/a/Metal041B) as the mask for where it gathers.

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
