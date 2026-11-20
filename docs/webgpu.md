# The WebGPU renderer (branch `webgpu`)

The game on three.js's `WebGPURenderer`, kept on its own branch so it can be compared with the
WebGL build on `main`:

```
git checkout webgpu   # WebGPU
git checkout main     # WebGL
npm start             # builds src/ and runs the game, either branch
```

## How it is put together

- **One shim, no rewrite of the game's scene code.** `scripts/build.mjs` points every bare
  `three` import at `src/render/three-shim.js`, which re-exports `three/webgpu` with the node
  materials under the classic names (`MeshStandardMaterial` is `MeshStandardNodeMaterial`, and so
  on, for GLTFLoader too). Every material the game makes is a node material.
- **Every GLSL patch is ported to TSL** (three's node shading language), keeping the same maths:
  the fog model (`render/atmosphere.js`, applied to every node material by a patched `setupFog`),
  the sky, rain, splashes, lightning, the terrain splat with its anti-tiling, potholes, cracks and
  ripples (`world/terrainShader.js`), grass, wall slabs, flag, light pools, the far city and its
  plumes, fire, particles, decals, the zombies' baked skinning and the giants' procedural pose,
  eyes and contact blobs, foliage, crows, the helicopters' beams, the hangar, and the whole post
  chain (`render/post.js`).
- **The wall lamps are real spot lights** (`world/lamplight.js`). They light everything, the dead
  and the soldiers included, where the WebGL build patched them into a few materials' shaders.
- **Volumetric searchlights** (`render/volumetric.js`): the searchlights light ray-marched fog
  and rain over the field, with their shadow maps cutting through it. A pass at half resolution
  (no finer than ~1100 px across), blurred, added after bloom. MEDIUM and up; LOW keeps the
  painted beam cones.

## Things the shim fixes in three (r187) for this game

- `positionBeforeInstance`: three applies an InstancedMesh's matrix *before* a material's
  `positionNode`; the zombies' skinning, the giants' pose and the crows' wings need it after, as
  the GLSL had it. A material with the flag runs its `positionNode` first (shadow pass included).
- Lights that contribute nothing are skipped: a dark light (colour 0) and any pixel past a light's
  cutoff distance branch over the light's BRDF and shadow lookups. Without it three evaluates all
  ~25 lights of a night on every lit pixel; with it the heavy night below went from ~13.5 ms to
  ~7-8.5 ms.
- The shadow pass's internal material gets a colour (through an accessor, not a prototype default:
  a prototype default made every node material share one `Color`).
- WebGPU allows 8 vertex buffers a draw and no `mat4` vertex attributes: the zombie geometry is
  interleaved into two buffers, and instance matrices are read as four `vec4` columns
  (`render/nodeUtil.js`).

## Performance (RTX 3070 Ti, Electron 45, GPU time per frame)

A heavy night from the gun: 700 dead walking, fires, both searchlights on the field, HIGH preset.
Median of 60 frames, three runs; WebGPU from timestamp queries, WebGL from timer queries.

| | WebGL (`main`) | WebGPU (`webgpu`) |
|---|---|---|
| 1920×1032 | 8.0 ms | 7.1-8.5 ms (volumetrics included) |
| 3840×2064 | 17.3 ms | 15.5 ms |

WebGPU runs vary more between launches (±1 ms at 1080p).

## Known differences and leftovers

- The hangar's open door glares less than under WebGL (the room light was cut to match the grade;
  the door's sky doesn't bloom as hard).
- The real lamps catch the razor wire and the walkway: small glints the WebGL lamps never made.
- `WebGPURenderer` falls back to WebGL2 where WebGPU is missing; the TSL shaders should run there,
  but that path hasn't been tested.
- The light skip throws a harmless "expected a vec3" node warning once if shadows are switched off
  at runtime.
- The spike (`src/spike/`, `app/spike.html`, `scripts/build-spike.mjs`) is still in the branch; it
  is the one-day test this port started from (`docs/webgpu-spike.md`).
