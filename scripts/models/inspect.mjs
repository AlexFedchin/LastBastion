// Print the node tree, materials and bounds of an FBX / OBJ / GLB model.
// usage: node scripts/models/inspect.mjs <file>
import { load } from './load.mjs';
import * as THREE from 'three';

const file = process.argv[2];
const root = await load(file);
root.updateMatrixWorld(true);
const box = new THREE.Box3().setFromObject(root);
console.log('bounds', box.min.toArray().map((v) => v.toFixed(3)), box.max.toArray().map((v) => v.toFixed(3)));
let verts = 0;
root.traverse((o) => {
  const depth = (() => { let d = 0, p = o.parent; while (p) { d++; p = p.parent; } return d; })();
  let line = `${'  '.repeat(depth)}${o.type} "${o.name}"`;
  if (o.isMesh) {
    const n = o.geometry.attributes.position.count; verts += n;
    const mats = (Array.isArray(o.material) ? o.material : [o.material]);
    const b = new THREE.Box3().setFromObject(o);
    const c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
    line += ` v=${n} groups=${o.geometry.groups.length} mats=[${mats.map((m) => m.name + (m.map ? '(map:' + (m.map.name || m.map.userData.src || '?') + ')' : '')).join(', ')}]`
      + ` c=(${c.toArray().map((v) => v.toFixed(2))}) s=(${s.toArray().map((v) => v.toFixed(2))})`;
  }
  console.log(line);
});
console.log('total verts', verts);
