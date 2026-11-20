// ─────────────────────────────────────────────────────────────────────────────
//  WebGPU spike: the valley and the wall alone on WebGPURenderer, with the
//  searchlights as lit volumetric fog in the rain. Not part of the game: this is
//  a one-day test of what the move to WebGPU would look like and cost.
//
//  app/spike.html?cam=gun|wide&vol=0|1&steps=24&res=0.5
//  window.__SPIKE.bench(frames) -> GPU ms per frame (timestamp queries)
//
//  What it leaves out (the port's real work, not done here): every GLSL patch
//  in the game. The terrain's splatting, the sky dome, the beams, rain, fire
//  and the custom fog are WebGL shaders; under WebGPU they are hidden or
//  replaced by rough node stand-ins below.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three/webgpu';
import {
  Fn, vec3, vec4, float, uniform, pass, screenUV, screenCoordinate, texture3D, time, mix, smoothstep,
  positionWorld, cameraPosition, positionWorldDirection, exp, max, length, normalize, fog, luminance, clamp, pow,
} from 'three/tsl';
import { bayer16 } from 'three/examples/jsm/tsl/math/Bayer.js';
import { gaussianBlur } from 'three/examples/jsm/tsl/display/GaussianBlurNode.js';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { ImprovedNoise } from 'three/examples/jsm/math/ImprovedNoise.js';
import { WORLD } from '../config.js';
import { QUALITY } from '../core/storage.js';
import { Environment } from '../world/environment.js';
import { loadModels, modelMesh } from '../world/models.js';
import { loadTextures } from '../world/texlib.js';
import { setSoldierLamps } from '../game/soldier.js';

const params = new URLSearchParams(location.search);
const VOL = params.get('vol') !== '0';
const STEPS = +(params.get('steps') || 24);
const RES = +(params.get('res') || 0.5);
const CAM = params.get('cam') || 'gun';
const LAYER_VOL = 10;

function noise3D(size = 96) {
  const data = new Uint8Array(size * size * size);
  const perlin = new ImprovedNoise();
  let i = 0;
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const n = perlin.noise((x / size) * 8, (y / size) * 8, (z / size) * 8); // tiles every 8 cells
    data[i++] = 128 + 127 * n;
  }
  const t = new THREE.Data3DTexture(data, size, size, size);
  t.format = THREE.RedFormat;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

async function main() {
  const log = (s) => { document.getElementById('log').textContent += s + '\n'; console.log('[spike]', s); };
  const quality = QUALITY.high;
  const canvas = document.getElementById('game');
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, powerPreference: 'high-performance', trackTimestamp: true });
  renderer.setPixelRatio(1);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  await renderer.init();
  const backend = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2 fallback';
  log(`backend: ${backend}, ${window.innerWidth}x${window.innerHeight}`);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.6;
  renderer.shadowMap.enabled = true;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(64, window.innerWidth / window.innerHeight, 0.1, 3200);

  const modelsLoaded = loadModels();
  await loadTextures(quality);
  const env = new Environment(scene, renderer, quality);
  await modelsLoaded;
  setSoldierLamps({ uTime: { value: 0 }, uLamps: { value: [] }, uLampPow: { value: 1 } });
  env.dressWithModels(modelMesh);
  env.setStory(1);

  // ── what WebGPU can't draw yet: the GLSL ShaderMaterials (sky, beams, rain, fire, plumes) ──
  const hidden = {};
  scene.traverse((o) => {
    const m = o.material;
    if (!m) return;
    const list = Array.isArray(m) ? m : [m];
    if (list.some((x) => x.isShaderMaterial || x.isRawShaderMaterial)) {
      o.visible = false;
      const k = o.name || o.type;
      hidden[k] = (hidden[k] || 0) + 1;
    }
  });
  // GLSL-patched standard materials render unpatched; the city's lit windows are emissive white
  // that its patch masks per window, so unpatched it glows solid white: switch that off
  let unpatched = 0;
  scene.traverse((o) => {
    const m = o.material;
    if (!m || Array.isArray(m) || !m.onBeforeCompile || m.onBeforeCompile === THREE.Material.prototype.onBeforeCompile) return;
    unpatched++;
    if (m.emissive && m.emissive.r > 0.9 && m.emissive.g > 0.9) m.emissive.setRGB(0, 0, 0);
  });
  log(`GLSL-patched materials drawn unpatched: ${unpatched}`);
  log('hidden (GLSL): ' + Object.entries(hidden).map(([k, n]) => `${k}×${n}`).join(', '));

  // ── stand-ins ──
  // the environment map is a PMREM of the GLSL sky dome, which WebGPU can't draw: drop it
  scene.environment = null;
  // the terrain's mud comes from its GLSL splat patch (the material itself is plain white):
  // the mud set tiled straight on the mesh instead, puddles and tracks left out
  {
    const tm = env.terrain.mesh.material, mud = env.tex.ground;
    if (mud && mud.map) {
      const rep = +(params.get('mudrep') || 90);
      tm.map = mud.map.clone(); tm.map.repeat.set(rep, rep); tm.map.needsUpdate = true;
      if (tm.normalMap) { tm.normalMap = tm.normalMap.clone(); tm.normalMap.repeat.set(rep, rep); tm.normalMap.needsUpdate = true; }
      tm.color.setScalar(+(params.get('mudk') || 0.55));
      tm.needsUpdate = true;
    }
  }
  // fog: the game's haze + ground mist, without the drifting noise (atmosphere.js lbFog, night)
  // (scene.fog stays: env.update writes its colour, which this uniform reads; fogNode overrides it)
  const fogCol = uniform(scene.fog.color);
  const glowCol = vec3(0.2, 0.05, 0.012);
  scene.fogNode = Fn(() => {
    const rv = positionWorld.sub(cameraPosition);
    const d = length(rv);
    const rd = rv.div(max(d, 1e-4));
    const b = float(0.15);
    const k = b.mul(rd.y).mul(d);
    const hi = float(1).sub(exp(k.negate())).div(b.mul(rd.y).add(1e-5));
    const th = float(0.0085).mul(exp(b.negate().mul(cameraPosition.y))).mul(hi).mul(0.6);
    const tb = float(0.00155).mul(d);
    const toward = max(0, rd.z.negate());
    const glow = toward.mul(toward).mul(exp(max(rd.y, 0).mul(-13))).mul(0.5).mul(float(1).sub(exp(max(d.sub(120), 0).div(-700))));
    const col = fogCol.add(glowCol.mul(glow));
    return fog(col, float(1).sub(exp(tb.add(th).negate())));
  })();
  // sky: horizon glow from the burning city to a near-black zenith (sky.js, much simplified)
  scene.backgroundNode = Fn(() => {
    const dir = normalize(positionWorldDirection);
    const toward = max(0, dir.z.negate());
    const horizon = fogCol.add(glowCol.mul(toward.mul(toward).mul(exp(max(dir.y, 0).mul(-13))).mul(0.36)));
    return mix(horizon, vec3(0.0025, 0.003, 0.0055), smoothstep(0.0, 0.35, dir.y));
  })();

  // the sodium lamps: lamplight.js lights them inside a GLSL patch; here they are ten real spot lights
  const lampP = env.wallLamps || [], lampD = env.wallLampAims || [];
  for (let i = 0; i < Math.min(10, lampP.length); i++) {
    const s = new THREE.SpotLight(0xff8030, 60, 26, 1.1, 0.6, 2);
    s.position.copy(lampP[i]);
    s.target.position.copy(lampP[i]).addScaledVector(lampD[i], 10);
    scene.add(s, s.target);
  }

  // ── the searchlights in the rain: ray-marched, shadowed, lit fog ──
  const volIntensity = uniform(1.0);
  let volMat = null, density = null;
  if (VOL) {
    for (const sl of env.searchlights) {
      sl.spot.layers.enable(LAYER_VOL);
      sl.spot.shadow.autoUpdate = true;
    }
    const nTex = noise3D();
    const rainK = uniform(1.0), haze = uniform(0.35);
    density = uniform(+(params.get('dens') || 0.8));
    volMat = new THREE.VolumeNodeMaterial();
    volMat.steps = STEPS;
    volMat.offsetNode = bayer16(screenCoordinate);
    volMat.scatteringNode = Fn(({ positionRay }) => {
      // rain: thin vertical streaks falling fast (noise stretched along y, scrolled down)
      const fall = vec3(time.mul(0.6), time.mul(9.0), time.mul(0.25));
      const streak = texture3D(nTex, positionRay.add(fall).mul(vec3(0.25, 0.012, 0.25)).mod(1), 0).r;
      const rain = smoothstep(0.55, 0.85, streak).mul(rainK);
      // slow drifting mist, heavier near the ground
      const mist = texture3D(nTex, positionRay.mul(0.006).add(vec3(time.mul(0.002), 0, time.mul(0.001))).mod(1), 0).r;
      const low = exp(positionRay.y.mul(-0.04));
      return haze.mul(mist.mul(0.9).add(0.55)).mul(low).add(rain.mul(0.35)).mul(density);
    });
    // the field in front of the wall, out past where the beams reach
    const vol = new THREE.Mesh(new THREE.BoxGeometry(360, 70, 300), volMat);
    vol.position.set(0, 30, -150);
    vol.receiveShadow = true;
    vol.layers.disableAll();
    vol.layers.enable(LAYER_VOL);
    scene.add(vol);
  }

  // ── post: scene + volumetrics (quarter/half res, blurred) + bloom, ACES at output ──
  // two pipelines over the same scene, so with/without volumetrics can be timed back to back
  const scenePass = pass(scene, camera);
  const finish = (n) => {
    const o = n.add(bloom(n, 0.42, 0.22, 1.0));
    // the game's grade, roughly: drained colour (post.js uDesat 0.28)
    return Fn(() => { const c = vec4(o).rgb; return vec4(mix(vec3(luminance(c)), c, 0.72), 1); })();
  };
  const pipes = { novol: new THREE.RenderPipeline(renderer) };
  pipes.novol.outputNode = finish(scenePass);
  if (VOL) {
    volMat.depthNode = scenePass.getTextureNode('depth').sample(screenUV);
    const layers = new THREE.Layers(); layers.disableAll(); layers.enable(LAYER_VOL);
    const volPass = pass(scene, camera, { depthBuffer: false });
    volPass.setLayers(layers);
    volPass.setResolutionScale(RES);
    pipes.vol = new THREE.RenderPipeline(renderer);
    pipes.vol.outputNode = finish(scenePass.add(gaussianBlur(volPass, uniform(0.6)).mul(volIntensity)));
  }
  let pipeline = pipes.vol || pipes.novol;
  const usePipe = (k) => { pipeline = pipes[k] || pipeline; };

  // ── cameras ──
  const poses = {
    gun: () => { camera.position.set(WORLD.CAM.x, WORLD.CAM.y, WORLD.CAM.z); camera.rotation.set(-0.16, 0, 0, 'YXZ'); },
    wide: () => { camera.position.set(-38, 26, 24); camera.lookAt(10, 2, -90); },
    beam: () => { camera.position.set(52, 15, 7); camera.lookAt(0, 3, -100); },
  };
  const setCam = (k) => { (poses[k] || poses.gun)(); camera.updateMatrixWorld(true); };
  setCam(CAM);

  // searchlights aimed at fixed spots for repeatable shots (env.update would sweep them)
  const aims = [new THREE.Vector3(-35, 0, -75), new THREE.Vector3(40, 0, -105)];
  let t = 10;
  const step = (dt = 1 / 60) => {
    t += dt;
    env.update(dt, t, null, null, null);
    env.searchlights.forEach((sl, k) => {
      sl.spot.target.position.copy(aims[k]); sl.spot.target.updateMatrixWorld();
      if (env.towerHousings[k]) env.towerHousings[k].lookAt(aims[k]);
      sl.spot.shadow.needsUpdate = true;
    });
    pipeline.render();
  };

  // gpuMs: the sum of every render pass's GPU time in a frame (timestamp queries), median;
  // frameMs: back-to-back throughput (bounded by CPU or GPU, whichever is slower)
  async function bench(frames = 120, pipe = null) {
    if (pipe) usePipe(pipe);
    const device = renderer.backend.device;
    for (let i = 0; i < 30; i++) step();
    await device.queue.onSubmittedWorkDone();
    await renderer.resolveTimestampsAsync(THREE.TimestampQuery.RENDER);
    const gpu = [];
    for (let i = 0; i < frames; i++) {
      step();
      await device.queue.onSubmittedWorkDone();
      const ms = await renderer.resolveTimestampsAsync(THREE.TimestampQuery.RENDER);
      if (ms > 0) gpu.push(ms);
    }
    // CPU: the JS time to update the world and record/submit the frame
    const cpu = [];
    for (let i = 0; i < frames; i++) {
      const a = performance.now(); step(); cpu.push(performance.now() - a);
      await device.queue.onSubmittedWorkDone();
    }
    const frameMs = cpu.sort((x, y) => x - y)[cpu.length >> 1];
    const s = gpu.sort((x, y) => x - y);
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    return { backend, pipe: pipeline === pipes.vol ? 'vol' : 'novol', steps: STEPS, res: RES, w: size.x, h: size.y,
      gpuMs: s[s.length >> 1] ?? null, gpuP10: s[(s.length * 0.1) | 0] ?? null, gpuP90: s[(s.length * 0.9) | 0] ?? null, frameMs, samples: s.length };
  }

  for (let i = 0; i < 4; i++) step();
  // n frames rendered inside requestAnimationFrame, so the canvas is presented (for screenshots)
  const frames = (n) => new Promise((done) => { const f = () => { step(); if (--n > 0) requestAnimationFrame(f); else setTimeout(done, 50); }; requestAnimationFrame(f); });
  window.__SPIKE = { renderer, scene, camera, env, step, frames, bench, setCam, usePipe, volIntensity, density, volMat, ready: true };
  log('ready');
  const loop = () => { if (!window.__SPIKE.paused) step(); requestAnimationFrame(loop); };
  if (!params.has('still')) requestAnimationFrame(loop);
}

main().catch((e) => { console.error(e); document.getElementById('log').textContent += 'ERROR ' + (e.stack || e); window.__SPIKE = { error: String(e.stack || e) }; });
