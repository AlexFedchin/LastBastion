// Load FBX / OBJ / GLB into a three.js scene graph under Node. Images are
// not decoded: each texture keeps its source path in userData.src so the
// build can re-attach (resized) image files itself.
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';

THREE.ImageLoader.prototype.load = function (url, onLoad) {
  const img = { width: 1, height: 1, src: url };
  if (onLoad) setTimeout(() => onLoad(img), 0);
  return img;
};
const origTexLoad = THREE.TextureLoader.prototype.load;
THREE.TextureLoader.prototype.load = function (url, ...rest) {
  const t = origTexLoad.call(this, url, ...rest);
  t.userData.src = decodeURIComponent(url);
  return t;
};
globalThis.self ??= globalThis;
globalThis.window ??= globalThis;

const toAB = (buf) => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);

export async function load(file) {
  const ext = path.extname(file).toLowerCase();
  const dir = path.dirname(path.resolve(file)) + '/';
  if (ext === '.fbx') {
    const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
    return new FBXLoader().parse(toAB(fs.readFileSync(file)), dir);
  }
  if (ext === '.obj') {
    const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
    return new OBJLoader().parse(fs.readFileSync(file, 'utf8'));
  }
  if (ext === '.glb') {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const g = await new GLTFLoader().parseAsync(toAB(fs.readFileSync(file)), dir);
    return g.scene;
  }
  throw new Error('unsupported ' + ext);
}
