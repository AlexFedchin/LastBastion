// WebGPU build: every `import * as THREE from 'three'` in the game resolves here
// (scripts/build.mjs), so the game is built from three's WebGPU classes.
//
// The classic materials are the node materials under their old names: a
// `new THREE.MeshStandardMaterial({...})` anywhere in the game (or in GLTFLoader)
// is a MeshStandardNodeMaterial, whose colorNode / positionNode / ... the game's
// shader code sets in TSL, where the WebGL build patched GLSL in onBeforeCompile.
import * as W from 'three/webgpu';
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

// GLSL shader chunks don't exist under WebGPU; kept as empty objects for code that still reads them
export const ShaderChunk = { lights_fragment_begin: '' };
export const UniformsUtils = UU;
export const UniformsLib = {};
