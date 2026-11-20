// WebGPU build: every `import * as THREE from 'three'` in the game resolves here
// (scripts/build.mjs), so the game is built from three's WebGPU classes.
//
// The classic materials are the node materials under their old names: a
// `new THREE.MeshStandardMaterial({...})` anywhere in the game (or in GLTFLoader)
// is a MeshStandardNodeMaterial, whose colorNode / positionNode / ... the game's
// shader code sets in TSL, where the WebGL build patched GLSL in onBeforeCompile.
import * as W from 'three/webgpu';
import * as T from 'three/tsl';
export * from 'three/webgpu';
import { UniformsUtils as UU } from 'three/src/renderers/shaders/UniformsUtils.js';

export const MeshStandardMaterial = W.MeshStandardNodeMaterial;
export const MeshPhysicalMaterial = W.MeshPhysicalNodeMaterial;
export const MeshBasicMaterial = W.MeshBasicNodeMaterial;
export const MeshLambertMaterial = W.MeshLambertNodeMaterial;
export const MeshPhongMaterial = W.MeshPhongNodeMaterial;
export const SpriteMaterial = W.SpriteNodeMaterial;
export const PointsMaterial = W.PointsNodeMaterial;
export const LineBasicMaterial = W.LineBasicNodeMaterial;

// The shadow pass draws casters with an internal material and reads the caster's colorNode for
// its alpha; ours read the material's colour (materialColor), which that internal material lacks.
// Give that one material (isShadowPassMaterial) a white colour. It has to be an accessor: a
// plain default on the prototype would stop the node materials from making their own colour
// (setDefaultValues only fills properties that are undefined) and they'd all share one.
{
  const WHITE = new W.Color(1, 1, 1);
  if (!Object.getOwnPropertyDescriptor(W.NodeMaterial.prototype, 'color')) {
    Object.defineProperty(W.NodeMaterial.prototype, 'color', {
      configurable: true,
      get() { return this.isShadowPassMaterial ? WHITE : undefined; },
      set(v) { Object.defineProperty(this, 'color', { value: v, writable: true, configurable: true, enumerable: true }); },
    });
  }
}

// three applies an InstancedMesh's matrix to positionLocal before the material's positionNode.
// The game's vertex shaders that build the vertex from the raw geometry (the zombies' skinning,
// the giants' pose, the crows' wings) need it the other way round, as the GLSL did: such a
// material sets positionBeforeInstance, and its positionNode runs first, then the instancing.
// (The shadow pass draws with an override material carrying the same positionNode: the source
// material's flag is read off the render object.)
{
  const setupPosition = W.NodeMaterial.prototype.setupPosition;
  W.NodeMaterial.prototype.setupPosition = function (builder) {
    const ro = builder.renderObject;
    const src = (this.isShadowPassMaterial && ro && ro._sourceMaterial) || this;
    if (!src.positionBeforeInstance || this.positionNode === null) return setupPosition.call(this, builder);
    const { object } = builder;
    T.positionLocal.assign(T.subBuild(this.positionNode, 'POSITION', 'vec3'));
    if (object.isInstancedMesh && object.instanceMatrix && object.instanceMatrix.isInstancedBufferAttribute === true) T.instancedMesh(object);
    return T.positionLocal;
  };
}

// Skip lights that contribute nothing. The night is lit by ~25 point and spot lights (the wall
// lamps, the searchlights, the fixed pool for blasts and flares, most of it dark) and three
// evaluates every one of them, BRDF and shadow lookups included, on every lit pixel. Each point
// or spot light's contribution is wrapped in a branch: a dark light (colour 0, a uniform) is
// skipped outright, and a pixel past the light's cutoff distance skips it too. The WebGL build
// patched three's GLSL light loop the same way.
{
  const setupDirectLight = W.LightsNode.prototype.setupDirectLight;
  W.LightsNode.prototype.setupDirectLight = function (builder, lightNode, lightData) {
    const light = lightNode.light;
    if (!light || !(light.isPointLight || light.isSpotLight) || typeof lightNode.getLightVector !== 'function' || (builder.material && builder.material.isVolumeNodeMaterial)) {
      return setupDirectLight.call(this, builder, lightNode, lightData);
    }
    const lit = T.dot(lightNode.colorNode, T.vec3(1)).greaterThan(0);
    const cutoff = lightNode.cutoffDistanceNode;
    const inRange = cutoff
      ? cutoff.equal(0).or(T.length(lightNode.getLightVector(builder)).lessThan(cutoff))
      : T.bool(true);
    T.If(lit.and(inRange), () => { setupDirectLight.call(this, builder, lightNode, lightData); });
  };
}

// GLSL shader chunks don't exist under WebGPU; kept as empty objects for code that still reads them
export const ShaderChunk = { lights_fragment_begin: '' };
export const UniformsUtils = UU;
export const UniformsLib = {};

// ?nodetrace: node errors carry the stack of where the node was made (debugging the TSL ports)
if (typeof location !== 'undefined' && /[?&]nodetrace/.test(location.search)) W.Node.captureStackTrace = true;
if (typeof window !== 'undefined' && typeof location !== 'undefined' && /[?&]test/.test(location.search)) { window.__TSL = T; window.__THREE = W; }
