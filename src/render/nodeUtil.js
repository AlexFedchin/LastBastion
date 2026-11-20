// Small TSL helpers shared by the game's node materials.
import * as THREE from 'three';
import { mat4, instancedBufferAttribute, instancedDynamicBufferAttribute } from 'three/tsl';

/**
 * An InstancedMesh's instance matrices as a mat4 node, for a vertexNode that places its own
 * vertices (the zombies' eye billboards and contact blobs). A vertex attribute can't be a mat4
 * in WebGPU: it is read as four vec4 columns of the same buffer, the way three's own instancing
 * does it, so the horde's updates to instanceMatrix reach it unchanged.
 */
export function instanceMatrixNode(instanceMatrix) {
  const fn = instanceMatrix.usage === THREE.DynamicDrawUsage ? instancedDynamicBufferAttribute : instancedBufferAttribute;
  const cols = [0, 4, 8, 12].map((offset) => fn(new THREE.InterleavedBufferAttribute(instanceMatrix, 4, offset)));
  return mat4(...cols);
}
