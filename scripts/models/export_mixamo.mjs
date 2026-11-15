// The soldier as an unrigged OBJ for Mixamo's auto-rigger: the skinned body in its bind
// pose (the rifle and pouches are loose props modelled in the ready pose, so they're left
// out), with an .mtl pointing at the base-colour textures. Writes
// source/soldier/mixamo/soldier.obj|.mtl + textures, and soldier_mixamo.zip of the lot.
//   node scripts/models/export_mixamo.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { load } from './load.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const D = path.join(here, 'source', 'soldier');
const OUT = path.join(D, 'mixamo');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const fbx = await load(path.join(D, 'soldier.fbx'));
fbx.updateMatrixWorld(true);

const COLOR = {
  body: 'privage_military_contractor_body_BaseColor.jpg',
  vest: 'privage_military_contractor2_vest_BaseColo.jpg',
  'mag pouch': 'privage_military_contractor_mag_pouch_Base.jpg',
  'l glove': 'private_contractor1_gloves_BaseColor.jpg',
  'r glove': 'private_contractor1_gloves_BaseColor.jpg',
  helmet: 'scp_operator_helmet_BaseColor.jpg',
  facemask: 'scp_operator_mask_BaseColor.jpg',
  face: 'swat_face_BaseColor.jpg',
  googles: 'googles_googles_BaseColor.png',
  kneepad: 'kneepad_kneepad_BaseColor.jpg',
  boots: 'boot_color.jpg',
};

const obj = ['mtllib soldier.mtl'], used = new Set();
let base = 1;
const v = new THREE.Vector3(), box = new THREE.Box3();
fbx.traverse((o) => {
  if (!o.isSkinnedMesh) return;
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  const g = o.geometry, P = g.attributes.position, U = g.attributes.uv;
  obj.push(`o ${o.name.replace(/\s+/g, '_')}`);
  for (let i = 0; i < P.count; i++) {
    // bind pose, in metres
    v.fromBufferAttribute(P, i).applyMatrix4(o.bindMatrix).multiplyScalar(0.01);
    box.expandByPoint(v);
    obj.push(`v ${v.x.toFixed(5)} ${v.y.toFixed(5)} ${v.z.toFixed(5)}`);
  }
  for (let i = 0; i < P.count; i++) obj.push(U ? `vt ${U.getX(i).toFixed(5)} ${U.getY(i).toFixed(5)}` : 'vt 0.5 0.5');
  const idx = g.index ? g.index.array : [...Array(P.count).keys()];
  const groups = g.groups.length ? g.groups : [{ start: 0, count: idx.length, materialIndex: 0 }];
  for (const gr of groups) {
    const m = mats[gr.materialIndex] || mats[0];
    const name = (m.name || 'default').replace(/\s+/g, '_');
    used.add(m.name);
    obj.push(`usemtl ${name}`);
    for (let k = gr.start; k < gr.start + gr.count; k += 3) {
      const a = idx[k] + base, b = idx[k + 1] + base, c = idx[k + 2] + base;
      obj.push(`f ${a}/${a} ${b}/${b} ${c}/${c}`);
    }
  }
  base += P.count;
});

const mtl = [];
for (const name of used) {
  mtl.push(`newmtl ${(name || 'default').replace(/\s+/g, '_')}`, 'Kd 1 1 1');
  const tex = COLOR[name];
  if (tex) { fs.copyFileSync(path.join(D, 'textures', tex), path.join(OUT, tex)); mtl.push(`map_Kd ${tex}`); }
  mtl.push('');
}
fs.writeFileSync(path.join(OUT, 'soldier.obj'), obj.join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'soldier.mtl'), mtl.join('\n'));
const s = box.getSize(new THREE.Vector3());
console.log('materials:', [...used].join(', '));
console.log('bind-pose size (m): width', s.x.toFixed(2), 'height', s.y.toFixed(2), 'depth', s.z.toFixed(2));

const zip = path.join(D, 'soldier_mixamo.zip');
fs.rmSync(zip, { force: true });
execFileSync('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${OUT}\\*' -DestinationPath '${zip}'`]);
console.log('wrote', zip, (fs.statSync(zip).size / 1e6).toFixed(1), 'MB');
