// Volumetric searchlights: the beams are light scattered by the rain and mist in the air,
// ray-marched through a box round the camera and lit by the searchlights' own spot lights,
// shadow maps included (the wall, the dead and the wrecks cut dark shafts through them).
//
// Drawn in its own pass at a fraction of the resolution (scene depth stops the march at
// whatever is in front), blurred, and added to the HDR scene before bloom (post.js).
// The spot lights that light it are tagged by environment.js (layer VOL_LAYER).
import * as THREE from 'three';
import { fogMaterial } from './atmosphere.js';
import { Fn, vec3, uniform, pass, screenUV, screenCoordinate, texture3D, smoothstep, exp, min, pow, clamp, distance, cameraPosition } from 'three/tsl';
import { bayer16 } from 'three/examples/jsm/tsl/math/Bayer.js';
import { gaussianBlur } from 'three/examples/jsm/tsl/display/GaussianBlurNode.js';
import { ImprovedNoise } from 'three/examples/jsm/math/ImprovedNoise.js';

export const VOL_LAYER = 10;

// the air's density per quality preset: ray-march steps and the pass's resolution scale
const TIERS = {
  LOW: null,
  MEDIUM: { steps: 16, res: 0.25 },
  HIGH: { steps: 24, res: 0.5 },
  ULTRA: { steps: 32, res: 0.5 },
};

function noise3D(size = 96) {
  const data = new Uint8Array(size * size * size);
  const perlin = new ImprovedNoise();
  let i = 0;
  for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    data[i++] = 128 + 127 * perlin.noise((x / size) * 8, (y / size) * 8, (z / size) * 8); // tiles every 8 cells
  }
  const t = new THREE.Data3DTexture(data, size, size, size);
  t.format = THREE.RedFormat;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

/** Shared knobs the game moves (a fog bank thickens the air, dawn thins it). */
export const VOL = {
  density: uniform(0.8),   // overall scattering
  rain: uniform(1),        // rain streak strength
  time: uniform(0),
  // the searchlights' lamps (environment.js): the air right at a lamp would take the light's full
  // 1/d falloff and burn the frame white whenever a beam swings past the camera, so within NEAR
  // metres of a lamp the scattering is thinned by the same falloff, and a beam reads evenly bright
  // from the lamp out, the way the eye (and a camera's exposure) sees one
  src0: uniform(new THREE.Vector3(-77, 17, 0)),
  src1: uniform(new THREE.Vector3(77, 17, 0)),
};
const NEAR = 40;
// the box of air: the field and the slopes either side, the bastion and the base behind it;
// The box of air: its floor just under the valley floor, its lid at TOP, well above the highest
// camera there is (riding with the bombers, ~125 m), and it goes with the camera across the
// ground, RANGE metres out to each side. So no camera ever sees a lid, and the sides are no wall
// either: the mist fades out with distance across the ground from the camera over FADE, a circle
// round wherever the camera is, well inside the box. The mist itself thins with height (low,
// below).
// (The march spreads its steps evenly from the camera to the box's far side and drops those
// behind the scene: a floor deep underground would spend most of them under the field, where the
// beams are, and the beams would fall between the rest.)
const FLOOR = -8, TOP = 280;
const RANGE = 300;
const FADE = [190, 290];

/**
 * Build the volumetric pass for `scene` seen by `camera`, using `scenePass`'s depth.
 * Returns { sample(uv), update(time) } or null on presets without it.
 */
export function volumetricPass(scene, camera, scenePass, quality, renderer = null) {
  const tier = TIERS[quality.label] || TIERS.HIGH;
  if (!tier) return null;
  const nTex = noise3D();
  const mat = new THREE.VolumeNodeMaterial();
  // the air is added on top of the frame, so the fog only dims it with distance: fogged the normal
  // way it added the fog's own colour over the whole valley (nothing at night, a grey sheet over
  // everything at dawn and in the prologue's sunset)
  fogMaterial(mat, { add: true });
  mat.steps = tier.steps;
  mat.offsetNode = bayer16(screenCoordinate); // dithered start: banding becomes noise the blur removes
  mat.scatteringNode = Fn(({ positionRay }) => {
    const t = VOL.time;
    // rain: thin streaks falling fast through the light
    const fall = vec3(t.mul(0.6), t.mul(9.0), t.mul(0.25));
    const streak = texture3D(nTex, positionRay.add(fall).mul(vec3(0.25, 0.012, 0.25)).mod(1), 0).r;
    const rain = smoothstep(0.55, 0.85, streak).mul(VOL.rain).mul(exp(positionRay.y.max(0).mul(-0.012))); // (thinning with height too)
    // slow drifting mist, heavier near the ground
    const mist = texture3D(nTex, positionRay.mul(0.006).add(vec3(t.mul(0.002), 0, t.mul(0.001))).mod(1), 0).r;
    const low = exp(positionRay.y.mul(-0.04));
    const dl = min(distance(positionRay, VOL.src0), distance(positionRay, VOL.src1));
    const near = pow(clamp(dl.div(NEAR), 0.02, 1), 1.15);
    // (1 - smoothstep(near, far): WGSL leaves a smoothstep with its edges reversed undefined)
    const fade = smoothstep(FADE[0], FADE[1], distance(positionRay.xz, cameraPosition.xz)).oneMinus();
    return mist.mul(0.9).add(0.55).mul(0.35).mul(low).add(rain.mul(0.35)).mul(VOL.density).mul(near).mul(fade);
  });
  mat.depthNode = scenePass.getTextureNode('depth').sample(screenUV);
  // the field in front of the wall, out past where the beams reach
  const box = new THREE.Mesh(new THREE.BoxGeometry(RANGE * 2, TOP - FLOOR, RANGE * 2), mat);
  box.position.y = (TOP + FLOOR) / 2;
  box.receiveShadow = true;
  box.frustumCulled = false;
  box.layers.disableAll();
  box.layers.enable(VOL_LAYER);
  box.name = 'volumetric-air';
  scene.add(box);

  const layers = new THREE.Layers();
  layers.disableAll();
  layers.enable(VOL_LAYER);
  const volPass = pass(scene, camera, { depthBuffer: false, samples: 0 });
  volPass.setLayers(layers);
  volPass.setResolutionScale(tier.res);
  const blurred = gaussianBlur(volPass, uniform(0.6));
  const tex = blurred.getTextureNode();
  return {
    box,
    pass: volPass,
    // follow the scene pass (the hangar swaps it for its own scene, which has no searchlights)
    sample: (uv) => tex.sample(uv),
    update(time) {
      VOL.time.value = time;
      // the air is soft: no finer than ~1100 px across, whatever the screen (a 4K buffer at half
      // resolution would march four times the rays for nothing the blur keeps)
      if (renderer) {
        const w = renderer.domElement.width || 1920;
        const k = Math.min(tier.res, 1100 / w);
        if (Math.abs(k - volPass.getResolutionScale()) > 1e-3) volPass.setResolutionScale(k);
      }
      volPass.scene = scenePass.scene;
      volPass.camera = scenePass.camera;
      box.position.x = scenePass.camera.position.x; box.position.z = scenePass.camera.position.z; // (with the camera, across the ground)
    },
  };
}
