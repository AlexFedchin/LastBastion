# WebGPU spike (2026-11-20)

A one-day test of moving the renderer to three.js `WebGPURenderer`: the valley and the wall
alone (no horde, no HUD), with the searchlights as ray-marched, shadowed volumetric fog in the rain.
Branch `webgpu-spike`; the game on `main` is untouched.

## How to run it

```
node scripts/build-spike.mjs        # src/spike/webgpu.js -> app/build/spike.js
```

Open `app/spike.html` in Electron (it is not wired into the game's window). Query parameters:
`cam=gun|wide|beam`, `vol=0|1`, `steps=24`, `res=0.5`, `dens=0.8`, `still`.
`window.__SPIKE.bench(frames, 'vol'|'novol')` returns the GPU time per frame from timestamp queries.

`scripts/build-spike.mjs` points every bare `three` import at `src/spike/three-shim.js`, which
re-exports `three/webgpu` and stubs the WebGL-only `ShaderChunk`, so the game's own world code
builds unchanged against the WebGPU classes.

## Results (RTX 3070 Ti, Electron 45, GPU time per frame, median)

| | Game (WebGL) | WebGPU, no volumetrics | WebGPU + volumetrics |
|---|---|---|---|
| 1920×1032, gun | 7.0 ms | ~3.8–4.3 ms | ~5.1 ms |
| 1920×1032, wide | 13.2 ms | ~4.3 ms | ~4.9 ms |
| 1920×1032, beam | 6.7 ms | ~4.2 ms | ~5.2 ms |
| 3840×2064, gun | 15.0 ms | 6.8 ms | 10.0 ms |
| 3840×2064, wide | 29.5 ms | 7.3 ms | 10.4 ms |
| 3840×2064, beam | 14.9 ms | 7.2 ms | 10.4 ms |

Volumetrics: 24 ray-march steps at half resolution, blurred. They cost about **+3.1 ms at 4K**
(clean numbers; the GPU is at full clock there) and about **+0.5–1.3 ms at 1080p** (noisy, since the
GPU drops its clocks under that light a load).

**The base frames do not compare.** The spike has no MSAA, none of the game's GLSL patches
(terrain splatting, the lamplight loop, the drifting fog noise, the city windows), no lens and
grade shader, and no sky, fire, rain or beam meshes (all GLSL ShaderMaterials, hidden). The
WebGPU base frame being faster says nothing yet about the ported game. The CPU side wasn't measured
reliably either.

## What it showed

- The game's world code builds and draws under WebGPU with a shim, apart from its GLSL:
  10 ShaderMaterial meshes hidden, 131 materials drawn without their `onBeforeCompile` patches.
- Volumetric searchlights work with the game's own spot lights and shadow maps, and are cheap.
- Missing stand-ins in the spike (rough): a TSL height fog, a gradient sky, 10 real spot lights for
  the wall lamps, the mud texture tiled straight on the terrain.

## Next steps if we go ahead

1. Port the shared pieces to TSL first: the fog (atmosphere.js), the lamplight (lamplight.js), the
   terrain splat, the sky dome. These touch most of the frame and decide the real base cost.
2. Port the horde's VAT zombie shader and run the heavy-night benchmark: that is the CPU and
   draw-call test the spike didn't cover.
3. Then the post chain (bloom, lens, grade) as TSL nodes, with GTAO and TRAA from three's nodes.
4. Quality tiers: volumetrics at quarter resolution or off on LOW.

The numbers and screenshots come from `scripts/spike-bench.cjs` (run it with Electron: `electron scripts/spike-bench.cjs <repo> <outdir>`).
