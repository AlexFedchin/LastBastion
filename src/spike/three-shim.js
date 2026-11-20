// WebGPU spike: every `import * as THREE from 'three'` in the game resolves here, so the
// world is built from the WebGPU build's classes. The WebGL-only pieces the world code
// touches at build time are stubbed: the shader-chunk patches (fog, lights) have nothing
// to patch under WebGPURenderer, which compiles node materials, not GLSL chunks.
export * from 'three/webgpu';
import { UniformsUtils as UU } from 'three/src/renderers/shaders/UniformsUtils.js';

export const ShaderChunk = { lights_fragment_begin: '' };
export const UniformsUtils = UU;
export const UniformsLib = {};
