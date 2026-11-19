// The zombie: the user's rigged zombie pack (3D Models/Zombies, extracted into
// source/zombie/) baked for the horde.
//
//   app/models/zombie.glb        the mesh at three levels of detail, skinned to 23 bones
//                                (JOINTS_0 / WEIGHTS_0, no glTF skin: the game skins it itself),
//                                with the three looks side by side in one texture
//   app/models/zombie_anim.bin   every clip, every frame: 23 skinning matrices (3 rows × vec4)
//   app/models/zombie_anim.json  the clips: first row, frames, fps, loop, ground speed
//
// The horde draws thousands of them in a few instanced calls: each instance picks two rows of
// the animation texture and a blend (src/game/zombieSkin.js).
//
// Clips: the pack's own twelve, and the ones it doesn't have, keyed by hand on its rig
// (zombie_clips.mjs). A Mixamo clip dropped in as source/zombie/mixamo/<name>.fbx (Without Skin,
// 30 fps, In Place) replaces the hand-keyed clip of the same name (see docs/MODELS_NEEDED.md).
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Document } from '@gltf-transform/core';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { load } from './load.mjs';
import { readTga } from './tga.mjs';
import { BONES, BI, PARENT, srcName, Rig, Pose } from './zombie_pose.mjs';
import { handClips } from './zombie_clips.mjs';
import { makeRetargeter } from './retarget.mjs';

const HEIGHT = 1.8;          // the game's zombie (ZOMBIE_HEIGHT), feet at 0
const FPS = 30;
const LOOK = 1536;           // each look's texture in the atlas
const NORMAL = 2048;
// the pack's clips: [file, name, loop]
const PACK = [
  ['walk', 'walk', true], ['run', 'run', true], ['idle1', 'idle1', true], ['idle2', 'idle2', true],
  ['atack1', 'attack1', true], ['atack2', 'attack2', true], ['atack3', 'attack3', true],
  ['roar', 'roar', true], ['gethit', 'gethit', false], ['death1', 'death1', false], ['death2', 'death2', false],
];
const LODS = [{ ratio: 1, error: 0 }, { ratio: 0.3, error: 0.02 }, { ratio: 0.1, error: 0.08 }];

export async function makeZombie({ io, SRC, OUT, finish }) {
  const Z = path.join(SRC, 'zombie');
  const animFile = (n) => path.join(Z, 'Zombie+animation', 'animation fbx', `zombie@${n}.fbx`);

  // ── the rig and the mesh, from the walk file (its meshes and bind pose go together) ──
  const base = await load(animFile('walk'));
  base.updateMatrixWorld(true);
  const meshes = []; base.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); });
  const main = meshes.reduce((a, b) => (b.geometry.attributes.position.count > a.geometry.attributes.position.count ? b : a));
  // bind world matrix of each source bone, by name (from the inverse bind matrices)
  const bindOf = (mesh) => {
    const out = {};
    mesh.skeleton.bones.forEach((b, i) => { if (!out[b.name]) out[b.name] = mesh.skeleton.boneInverses[i].clone().invert(); });
    return out;
  };
  // (the body mesh first; a bone it isn't skinned to comes from another part's skeleton)
  const B0 = Object.assign({}, ...meshes.filter((m) => m !== main).map(bindOf), bindOf(main));
  const missing = BONES.filter((b) => !B0[srcName(b)]);
  if (missing.length) console.log('zombie: no bind matrix for', missing.join(' '), '(taken from the scene)');
  base.traverse((o) => { if (o.isBone && !B0[o.name]) B0[o.name] = o.matrixWorld.clone(); });
  // character space: metres, feet on 0, centred on the hips
  let minY = Infinity, maxY = -Infinity;
  const v = new THREE.Vector3();
  for (const m of meshes) {
    const p = m.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(m.bindMatrix); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y); }
  }
  const hipsW = new THREE.Vector3().setFromMatrixPosition(B0[srcName('Hips')]);
  const k = HEIGHT / (maxY - minY);
  const C = new THREE.Matrix4().makeScale(k, k, k).premultiply(new THREE.Matrix4().makeTranslation(-hipsW.x * k, -minY * k, -hipsW.z * k));
  const Cinv = C.clone().invert();
  const toChar = (m) => C.clone().multiply(m).multiply(Cinv);
  const rotOf = (m) => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(m));
  // each source bone -> the game bone it folds into (itself, or its nearest kept ancestor)
  const game = {};
  for (const b of BONES) game[srcName(b)] = BI[b];
  const foldOf = (bone) => { for (let o = bone; o; o = o.parent) if (game[o.name] !== undefined) return game[o.name]; return 0; };
  const bindPos = {};
  for (const b of BONES) bindPos[b] = new THREE.Vector3().setFromMatrixPosition(toChar(B0[srcName(b)]));
  const rig = new Rig(bindPos);
  const bindRot = BONES.map((b) => rotOf(B0[srcName(b)]));

  // merged geometry in character space
  const pos = [], nor = [], uv = [], ji = [], jw = [];
  let worst = 0;
  for (const m of meshes) {
    const g = m.geometry, P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv, SI = g.attributes.skinIndex, SW = g.attributes.skinWeight;
    const nm = new THREE.Matrix3().getNormalMatrix(C.clone().multiply(m.bindMatrix));
    const bm = bindOf(m);
    for (const b of BONES) { const a = bm[srcName(b)]; if (a) worst = Math.max(worst, new THREE.Vector3().setFromMatrixPosition(a).distanceTo(new THREE.Vector3().setFromMatrixPosition(B0[srcName(b)]))); }
    const idx = g.index ? g.index.array : null;
    const n = idx ? idx.length : P.count;
    for (let t = 0; t < n; t++) {
      const i = idx ? idx[t] : t;
      v.fromBufferAttribute(P, i).applyMatrix4(m.bindMatrix).applyMatrix4(C); pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nor.push(v.x, v.y, v.z);
      uv.push(U.getX(i), 1 - U.getY(i)); // glTF: top-left origin
      const w = new Map();
      for (let c = 0; c < 4; c++) {
        const wt = SW.getComponent(i, c); if (wt <= 0) continue;
        const gb = foldOf(m.skeleton.bones[SI.getComponent(i, c)]);
        w.set(gb, (w.get(gb) || 0) + wt);
      }
      const top = [...w.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
      const sum = top.reduce((s, e) => s + e[1], 0) || 1;
      for (let c = 0; c < 4; c++) { ji.push(top[c] ? top[c][0] : 0); jw.push(top[c] ? top[c][1] / sum : 0); }
    }
  }
  if (worst > 0.5) console.warn(`zombie: the meshes' skeletons disagree at bind by ${worst.toFixed(2)} source units`);
  let geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('skinIndex', new THREE.Float32BufferAttribute(ji, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(jw, 4));
  geo = mergeVertices(geo, 1e-4);

  // ── clips ──
  const clips = [];
  const sampleFile = async (file, name, loop) => {
    const a = await load(file);
    a.updateMatrixWorld(true);
    const clip = a.animations[0];
    const mixer = new THREE.AnimationMixer(a);
    const act = mixer.clipAction(clip); act.play();
    const bones = {}; a.traverse((o) => { if (o.isBone && !bones[o.name]) bones[o.name] = o; });
    const n = Math.max(2, Math.round(clip.duration * FPS));
    const poses = [];
    for (let f = 0; f < (loop ? n : n + 1); f++) {
      mixer.setTime(Math.min(clip.duration - 1e-4, f / FPS));
      a.updateMatrixWorld(true);
      const Dw = BONES.map((b, i) => rotOf(bones[srcName(b)].matrixWorld).multiply(bindRot[i].clone().invert()));
      const hp = new THREE.Vector3().setFromMatrixPosition(bones[srcName('Hips')].matrixWorld).applyMatrix4(C);
      poses.push(rig.fromWorld(Dw, hp));
    }
    return { name, loop, poses };
  };
  const src = {};
  for (const [f, name, loop] of PACK) { src[name] = await sampleFile(animFile(f), name, loop); clips.push(src[name]); }
  // the hand-keyed ones (built on the pack's where they lean on them), or Mixamo replacements
  const hand = handClips({ rig, src, FPS, Pose });
  const mixDir = path.join(Z, 'mixamo');
  for (const h of hand) {
    const mf = path.join(mixDir, h.name + '.fbx');
    if (fs.existsSync(mf)) { clips.push(await mixamoClip(mf, h.name, h.loop)); console.log(`zombie: ${h.name} from Mixamo`); } else clips.push(h);
  }

  async function mixamoClip(file, name, loop) {
    // the same retargeter as the soldier's: Mixamo world rotations onto this rig's bind frames
    const gameBones = {}; base.traverse((o) => { if (o.isBone) { const s = o.name.replace('Zombie_', ''); if (!gameBones[s]) gameBones[s] = o; } });
    const bindW = {}; for (const s in gameBones) bindW[s] = B0[gameBones[s].name] || gameBones[s].matrixWorld;
    const r = await makeRetargeter(gameBones, bindW, { gamePrefix: 'Zombie_' })(file, { fps: FPS });
    // its local rotations -> world rotations from bind -> a pose
    const poses = [];
    const nf = r.times.length;
    for (let f = 0; f < (loop ? nf - 1 : nf); f++) {
      const W = {};
      const Dw = BONES.map((b) => {
        const chain = []; for (let o = b; o; o = PARENT[o]) chain.unshift(o);
        let q = new THREE.Quaternion();
        for (const c of chain) {
          const L = r.rot[c] ? new THREE.Quaternion().fromArray(r.rot[c], f * 4) : rotOf(gameBones[c === 'Jaw' ? 'low_jaw1' : c].matrix);
          q = q.multiply(L);
        }
        W[b] = q;
        return q.clone().multiply(bindRot[BI[b]].clone().invert());
      });
      const hp = new THREE.Vector3(r.hips[f * 3], r.hips[f * 3 + 1], r.hips[f * 3 + 2]).applyMatrix4(C);
      poses.push(rig.fromWorld(Dw, hp));
    }
    return { name, loop, poses };
  }

  // ── bake ──
  const rowFloats = BONES.length * 12;
  let rows = 0;
  for (const c of clips) rows += c.poses.length + 1; // + the wrap (loop) or hold (one-shot) frame
  const data = new Float32Array(rows * rowFloats);
  const meta = { bones: BONES, fps: FPS, rows, width: BONES.length * 3, clips: {} };
  let r = 0;
  for (const c of clips) {
    const n = c.poses.length;
    for (let f = 0; f <= n; f++) rig.skin(c.poses[f < n ? f : (c.loop ? 0 : n - 1)], data, (r + f) * rowFloats);
    // ground speed of a loop: how fast the planted foot slides back (m/s at rate 1), measured
    // only while a foot is on the ground (not in a flight phase)
    let speed = 0;
    if (c.loop) {
      const F = [[BI.LeftFoot, BI.LeftToeBase], [BI.RightFoot, BI.RightToeBase]];
      let s = 0, k2 = 0;
      for (let f = 0; f < n; f++) {
        const A = rig.solve(c.poses[f]).P, Bp = rig.solve(c.poses[(f + 1) % n]).P;
        const h = F.map(([ft, toe]) => Math.min(A[ft].y - rig.bind[ft].y, A[toe].y - rig.bind[toe].y));
        const side = h[0] < h[1] ? 0 : 1;
        if (h[side] > 0.025) continue;
        const d = A[F[side][0]].z - Bp[F[side][0]].z;
        if (Math.abs(d) < 0.3) { s += d * FPS; k2++; }
      }
      speed = k2 ? Math.max(0, s / k2) : 0;
    }
    if (c.speed !== undefined) speed = c.speed;
    meta.clips[c.name] = { row: r, frames: n, loop: c.loop, speed: +speed.toFixed(3), dur: +(n / FPS).toFixed(3) };
    r += n + 1;
  }
  // where things are on the body, for the game: the eyes on the head bone, the head's top
  const head = bindPos.Head;
  meta.eyes = [0, +(head.y - 0.08).toFixed(3), +(head.z + 0.095).toFixed(3)];
  // where a head shot off leaves the stump (the head's vertices pinch to it)
  const nk = bindPos.Neck;
  meta.stump = [0, +(nk.y + 0.06).toFixed(3), +(nk.z + 0.01).toFixed(3)];
  meta.headBone = BI.Head;
  meta.bind = BONES.map((b) => bindPos[b].toArray().map((x) => +x.toFixed(4)));
  fs.writeFileSync(path.join(OUT, 'zombie_anim.bin'), Buffer.from(data.buffer));
  fs.writeFileSync(path.join(OUT, 'zombie_anim.json'), JSON.stringify(meta, null, 1));
  console.log(`zombie_anim: ${clips.length} clips, ${rows} frames, ${(data.byteLength / 1048576).toFixed(2)} MB`);
  for (const c of clips) console.log(`  ${c.name.padEnd(10)} ${meta.clips[c.name].dur}s${c.loop ? ' loop' : ''}${meta.clips[c.name].speed ? ` ${meta.clips[c.name].speed} m/s` : ''}`);

  // ── textures: three looks side by side (albedo × AO, gloss -> alpha as roughness) ──
  const T = (s, m) => {
    const dir = path.join(Z, `Texture+set+${s}`, `Texture set ${s}`);
    const f = fs.readdirSync(dir).find((x) => x.toLowerCase().endsWith(`_${m.toLowerCase()}.tga`));
    const t = readTga(path.join(dir, f));
    return sharp(Buffer.from(t.data), { raw: { width: t.width, height: t.height, channels: 4 } });
  };
  const looks = [];
  for (const s of [1, 2, 3]) {
    const [alb, ao, gl] = await Promise.all(['Albedo', 'Occlusion', 'gloss'].map((m) => T(s, m).resize(LOOK, LOOK).raw().toBuffer()));
    const px = Buffer.alloc(LOOK * LOOK * 4);
    for (let i = 0; i < LOOK * LOOK; i++) {
      const o = 0.35 + 0.65 * ao[i * 4] / 255;
      px[i * 4] = alb[i * 4] * o; px[i * 4 + 1] = alb[i * 4 + 1] * o; px[i * 4 + 2] = alb[i * 4 + 2] * o;
      px[i * 4 + 3] = 255 - gl[i * 4]; // roughness
    }
    looks.push({ input: await sharp(px, { raw: { width: LOOK, height: LOOK, channels: 4 } }).png().toBuffer(), left: (s - 1) * LOOK, top: 0 });
  }
  const atlas = await sharp({ create: { width: LOOK * 3, height: LOOK, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } })
    .composite(looks).webp({ quality: 86, alphaQuality: 80 }).toBuffer();
  const normal = await T(1, 'Normal').resize(NORMAL, NORMAL).removeAlpha().webp({ quality: 88 }).toBuffer();

  // ── the glb ──
  const doc = new Document();
  const buffer = doc.createBuffer();
  const mat = doc.createMaterial('zombie')
    .setBaseColorTexture(doc.createTexture('zombie_looks').setImage(atlas).setMimeType('image/webp'))
    .setNormalTexture(doc.createTexture('zombie_normal').setImage(normal).setMimeType('image/webp'))
    .setRoughnessFactor(1).setMetallicFactor(0);
  const scene = doc.createScene();
  const idx0 = geo.index.array;
  const P = geo.attributes.position.array;
  const acc = (arr, type) => doc.createAccessor().setArray(arr).setType(type).setBuffer(buffer);
  LODS.forEach((L, li) => {
    let idx = new Uint32Array(idx0);
    if (L.ratio < 1) {
      const target = Math.floor(idx.length * L.ratio / 3) * 3;
      [idx] = MeshoptSimplifier.simplify(idx, new Float32Array(P), 3, target, L.error);
    }
    // keep only the vertices this level uses
    const used = new Int32Array(geo.attributes.position.count).fill(-1);
    let nv = 0; for (const i of idx) if (used[i] < 0) used[i] = nv++;
    const take = (name, size, Ctor) => {
      const a = geo.attributes[name].array, o = new Ctor(nv * size);
      for (let i = 0; i < used.length; i++) if (used[i] >= 0) for (let c = 0; c < size; c++) o[used[i] * size + c] = a[i * size + c];
      return o;
    };
    const p = doc.createPrimitive().setMaterial(mat)
      .setAttribute('POSITION', acc(take('position', 3, Float32Array), 'VEC3'))
      .setAttribute('NORMAL', acc(take('normal', 3, Float32Array), 'VEC3'))
      .setAttribute('TEXCOORD_0', acc(take('uv', 2, Float32Array), 'VEC2'))
      .setAttribute('JOINTS_0', acc(take('skinIndex', 4, Uint8Array), 'VEC4'))
      .setAttribute('WEIGHTS_0', acc(take('skinWeight', 4, Float32Array), 'VEC4'))
      .setIndices(acc(nv > 65535 ? Uint32Array.from(idx, (i) => used[i]) : Uint16Array.from(idx, (i) => used[i]), 'SCALAR'));
    const mesh = doc.createMesh('lod' + li).addPrimitive(p);
    scene.addChild(doc.createNode('lod' + li).setMesh(mesh));
    console.log(`  lod${li}: ${idx.length / 3} triangles, ${nv} vertices`);
  });
  await finish(doc, 'zombie.glb');
}
