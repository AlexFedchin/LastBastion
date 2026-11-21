# The WebGPU renderer

Since 2026-11-21 the game runs on three.js's `WebGPURenderer` on `main` (it was developed on the
`webgpu` branch, kept for history). The last WebGL build is the commit before the merge, tagged
`last-webgl`:

```
npm start                 # builds src/ and runs the game (WebGPU)
git checkout last-webgl   # the old WebGL build, for comparison
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

## Fog and uniforms (why the valley went grey and white)

- **The fog's uniforms live in the shared render group** (`setGroup(renderGroup)` in
  `render/atmosphere.js`). In three's default per-object group a uniform is only re-uploaded when
  the render object refreshes, and a material without a node property of its own (a plain model
  taking the fog through the patched `setupFog`) never refreshes once drawn: the far ranges and
  plain models kept the fog of the first frame they were drawn in (the night's black fog at dawn,
  the prologue's bright sunset fog all through night 1). Any `uniform()` read only through an
  overridden `setup*` function needs the same treatment.
- **The volumetric air takes additive fog** (dimmed with distance, no fog colour mixed in): it is
  added on top of the frame, and fogged the normal way it laid the fog's colour over the whole
  valley, invisible at night and a grey sheet at dawn and in the sunset.
- **`fogMaterial` adds its scale and mode to the material's shader key**: three keys compiled
  shaders on properties and nodes, and an overridden function is the same source text for every
  material, so a thinned fog could share a shader with a plain one.

## Stalls: shaders and pipelines (what made the game freeze for seconds)

WebGPU builds a shader (TSL → WGSL, on the CPU) and a render pipeline (compiled by the driver)
for every new combination of material, geometry, lights, shadow pass and render target. three does
both the first time something is drawn, and the pipeline compile behind `createRenderPipeline`
holds up the next frame: ~0.3 s for a new prop, 13-24 s when every material rebuilds at once.

- **The set of lights is part of every shader's key.** Hiding or showing a light rebuilds every
  lit material. The wall lamps used to be hidden at the blackout and at dawn (13-24 s freezes):
  now they only go dark (`intensity` 0, which the light skip above makes free). Never toggle
  `visible` or `castShadow` on a light mid-game; dim it.
- **Pipelines compile in the background** (`asyncPipelines` in `render/three-shim.js`): for the
  game's own scenes (`renderer.asyncScenes`: the night and the hangar) a new pipeline is made with
  `createRenderPipelineAsync` and the object is drawn from the frame it's ready. Internal one-off
  renders (three's PMREM baking the sky's environment map) stay synchronous: async, they baked a
  black map and every reflection lost the sky. A failed pipeline is retried.
- **Precompile through the scene pass.** The render target and its outputs are part of the key:
  compiling for the canvas built shaders no frame used. `main.compileScene` compiles for the post
  chain's scene pass (and puts the renderer's target straight back: three's `compileAsync` takes it
  at the start, then restores it after every step, and frames drawn between steps went into the
  pass's own texture; `post.render` also resets the target every frame).
- **`main.warmScene`** compiles a scene with everything shown and nothing culled (lights excepted:
  they stay as they are, or the key is wrong), uploads its textures and draws one frame of it
  through the post chain (that builds the shadow-pass shaders). `precompile` runs it under the
  deploy loader with a copy of every model added (so an event's aircraft, props and people are
  ready), again after the night has been set up, under the night card leaving the hangar, and on
  the hangar itself the first time. The loader waits for the pipelines (`pipelinesSettled`).
- compileAsync's node builds are made in one go (not in yielding steps): a texture changing state
  between the steps gave a shader and its bind group that disagreed, and a grenade never drawn.

Measured with a scripted night (every event and support call, 300-2000 dead, HIGH, 1920×1080,
GPU-synced frame time): before, the worst frame was 13.3 s (the blackout) with ~35 s of freezes
in 90 s of play, and the first seconds after the loader froze for ~5 s; dawn → hangar → next night
froze for 12.8 s + 2.9 s + 13.7 s + 5.3 s. After, no frame of play over 40 ms; the deploy loader
went from ~17 s to ~8 s.

## Draw calls

A model placed with `env.addModel` is one instanced mesh per *material* now, not per mesh: its
meshes that share a material are merged (de-quantized to floats and baked into the model's space;
every part of a model that merges is baked, so coinciding layers still round alike), the parts are
made in the order of their last mesh and share one bounding sphere, so a layer over another (the
house's roof over its charred one) draws last and wins as before. The church went from 49 draws
to 5, the house 43 to 4; with both searchlights' shadow maps a night went from ~700 draws to ~450.

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
