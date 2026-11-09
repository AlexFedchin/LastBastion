// The fortification: precast T-wall wings over HESCO fill, duckboard
// walkways, razor wire on outriggers, sodium lamps, the central bunker with
// your gun nest on top, the searchlight towers and the base behind the wall.
import * as THREE from 'three';
import { WORLD, wallZ, sectionOf, sectionCenterX } from '../config.js';
import { makeRng, lerp } from '../core/util.js';
import { groundH, heightUniforms, HEIGHT_GLSL } from './terrain.js';
import {
  box, cylY, cylZ, merge, xf, sandbagGeo, concertinaGeo, extrude, weather, makeTruck,
} from './kit.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(0, 1, 0), _z = new THREE.Vector3();

export const GUNNER_POSTS = [-27, 27, -52, 52];

/** Local frame of a wing: X along the wall, Y up, Z inward (towards the base). */
function wingFrames() {
  const out = [];
  for (const side of [-1, 1]) {
    const A = side > 0 ? [WORLD.GATE_HALF, wallZ(WORLD.GATE_HALF)] : [-WORLD.WING_END, wallZ(-WORLD.WING_END)];
    const B = side > 0 ? [WORLD.WING_END, wallZ(WORLD.WING_END)] : [-WORLD.GATE_HALF, wallZ(-WORLD.GATE_HALF)];
    const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const tx = (B[0] - A[0]) / len, tz = (B[1] - A[1]) / len;
    out.push({ side, A, B, len, tx, tz, nx: -tz, nz: tx });
  }
  return out;
}
/** Matrix placing local (u along wall, y, w inward) on a wing. */
function wingMatrix(w, u, y, inward, out = _m, sx = 1, sy = 1, sz = 1, rotY = 0, rotX = 0) {
  _x.set(w.tx, 0, w.tz); _z.set(w.nx, 0, w.nz);
  out.makeBasis(_x, _y, _z);
  if (rotY || rotX) out.multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rotX, rotY, 0)));
  out.scale(_v.set(sx, sy, sz));
  out.setPosition(w.A[0] + w.tx * u + w.nx * inward, y, w.A[1] + w.tz * u + w.nz * inward);
  return out;
}

const SLAB_GLSL = /* glsl */`
float sHash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float sNoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(sHash(i), sHash(i + vec2(1.0, 0.0)), u.x), mix(sHash(i + vec2(0.0, 1.0)), sHash(i + vec2(1.0, 1.0)), u.x), u.y); }
`;

export function buildFortification(env) {
  const { scene, tex, mats } = env;
  const H = WORLD.WALL_H;
  const rng = makeRng(77);
  const wings = wingFrames();
  env.wings = wings;

  // ── T-wall slabs ───────────────────────────────────────────────────────
  const slabGeo = merge([
    box(1, H, 0.36, 0, H / 2, 0.18),
    box(1, 0.55, 1.5, 0, 0.275, 0.75 + 0.18),
    box(1, 0.12, 0.3, 0, H + 0.04, 0.18),
  ]);
  const slabMat = new THREE.MeshStandardMaterial({
    map: tex.slab.map, normalMap: tex.slab.normalMap, normalScale: new THREE.Vector2(1.2, 1.2),
    color: 0xa7a39b, roughness: 0.9, metalness: 0, envMapIntensity: 0.35,
  });
  slabMat.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute vec2 aSlab;\nvarying vec2 vSlab;\nvarying vec3 vSW;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      vSW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
      vSlab = aSlab;`);
    sh.fragmentShader = 'varying vec2 vSlab;\nvarying vec3 vSW;\n' + SLAB_GLSL + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      float su = vSW.x / 0.876;
      float sy = vSW.y;
      diffuseColor.rgb *= 0.82 + 0.3 * vSlab.y;
      float splash = smoothstep(1.6, 0.0, sy + (sNoise(vec2(su * 3.0, sy)) - 0.5) * 0.8);
      diffuseColor.rgb *= 1.0 - splash * 0.6;
      float soot = smoothstep(0.55, 0.85, sNoise(vec2(su * 0.15, sy * 0.1) + vSlab.y * 9.0)) * smoothstep(1.0, 4.0, sy);
      diffuseColor.rgb *= 1.0 - soot * 0.55;
      float bl = vSlab.x;
      float line = 0.4 + bl * 6.2;
      float streak = sNoise(vec2(su * 2.6, sy * 0.25));
      float bm = smoothstep(line, line - 1.6, sy + (streak - 0.5) * 2.2) * smoothstep(0.03, 0.2, bl);
      bm *= smoothstep(0.25, 0.6, sNoise(vec2(su * 1.3, sy * 0.9)) + bl * 0.4);
      // dragged hand smears
      float hand = smoothstep(0.72, 0.9, sNoise(vec2(su * 4.0, sy * 0.6))) * step(sy, line + 0.6) * smoothstep(0.1, 0.3, bl);
      bm = max(bm, hand * 0.8);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.12, 0.006, 0.004), bm * 0.92);
      float slabBlood = bm;
      float slabWet = splash;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, 0.5, slabWet * 0.6);
      roughnessFactor = mix(roughnessFactor, 0.22, slabBlood);`);
  };
  slabMat.customProgramCacheKey = () => 'lb-slab';
  let slabCount = 0;
  const slabsPer = wings.map((w) => Math.round(w.len / 1.52));
  slabsPer.forEach((n) => { slabCount += n; });
  const slabs = new THREE.InstancedMesh(slabGeo, slabMat, slabCount);
  const aSlab = new THREE.InstancedBufferAttribute(new Float32Array(slabCount * 2), 2);
  slabGeo.setAttribute('aSlab', aSlab);
  const slabSection = new Int8Array(slabCount);
  let si = 0;
  wings.forEach((w, wi) => {
    const n = slabsPer[wi], sw = w.len / n;
    for (let k = 0; k < n; k++) {
      const u = (k + 0.5) * sw;
      const hj = 1 + (rng() - 0.5) * 0.025;
      wingMatrix(w, u, 0, (rng() - 0.5) * 0.03, _m, sw * 0.982, hj, 1, (rng() - 0.5) * 0.01, (rng() - 0.5) * 0.012);
      slabs.setMatrixAt(si, _m);
      const x = w.A[0] + w.tx * u;
      slabSection[si] = sectionOf(x);
      aSlab.setXY(si, 0, rng());
      si++;
    }
  });
  slabs.castShadow = true;
  slabs.receiveShadow = true;
  scene.add(slabs);
  env.slabs = { mesh: slabs, aSlab, section: slabSection, blood: new Float32Array(10) };

  // ── HESCO fill, duckboard walkway, sandbags on the parapet ──────────────
  const deckY = H - 1.0;
  const hesco = weather(new THREE.MeshStandardMaterial({ map: tex.hesco.map, normalMap: tex.hesco.normalMap, color: 0xb8ad90, roughness: 1 }), { soot: 0.35, key: 'hesco' });
  const planks = new THREE.MeshStandardMaterial({ map: tex.planks.map, normalMap: tex.planks.normalMap, color: 0x9a8a74, roughness: 0.85 });
  const fillGeos = [], deckGeos = [];
  for (const w of wings) {
    const g = new THREE.BoxGeometry(w.len + 0.4, deckY, 3.0);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w.len / 2.2), uv.getY(i) * (deckY / 2.2));
    g.translate(w.len / 2, deckY / 2, 0.36 + 1.5);
    g.applyMatrix4(wingMatrix(w, 0, 0, 0, new THREE.Matrix4()));
    fillGeos.push(g);
    const d = new THREE.BoxGeometry(w.len + 0.4, 0.1, 2.9);
    const duv = d.attributes.uv;
    for (let i = 0; i < duv.count; i++) duv.setXY(i, duv.getY(i) * 1.2, duv.getX(i) * (w.len / 1.6));
    d.translate(w.len / 2, deckY + 0.05, 0.36 + 1.45);
    d.applyMatrix4(wingMatrix(w, 0, 0, 0, new THREE.Matrix4()));
    deckGeos.push(d);
  }
  const fill = new THREE.Mesh(merge(fillGeos), hesco);
  fill.receiveShadow = true;
  scene.add(fill);
  const deck = new THREE.Mesh(merge(deckGeos), planks);
  deck.receiveShadow = true;
  scene.add(deck);

  const bagGeo = sandbagGeo();
  const bagMs = [];
  for (const w of wings) {
    const n = Math.floor(w.len / 0.6);
    for (let k = 0; k < n; k++) {
      const u = (k + 0.5) * (w.len / n);
      if (rng() < 0.06) continue;
      wingMatrix(w, u, H + 0.1, 0.17 + (rng() - 0.5) * 0.04, _m, 1, 1, 1, (rng() - 0.5) * 0.25 + (rng() < 0.5 ? Math.PI : 0));
      bagMs.push(_m.clone());
      if (k % 4 === 0 && rng() < 0.6) {
        wingMatrix(w, u + 0.3, H + 0.26, 0.2, _m, 0.95, 1, 1, (rng() - 0.5) * 0.3);
        bagMs.push(_m.clone());
      }
    }
  }
  // firing steps for the wall gunners
  for (const px of GUNNER_POSTS) {
    const w = px < 0 ? wings[0] : wings[1];
    const u = (px - w.A[0]) / w.tx;
    for (let r = 0; r < 6; r++) for (let c = 0; c < 4; c++) {
      wingMatrix(w, u - 0.95 + c * 0.63 + (r % 2) * 0.3, deckY + 0.12 + r * 0.155, 1.0 + (rng() - 0.5) * 0.05, _m, 1, 1, 1.0, Math.PI / 2 + (rng() - 0.5) * 0.15);
      bagMs.push(_m.clone());
      wingMatrix(w, u - 0.95 + c * 0.63 + (r % 2) * 0.3, deckY + 0.12 + r * 0.155, 1.65, _m, 1, 1, 1.0, Math.PI / 2 + (rng() - 0.5) * 0.15);
      bagMs.push(_m.clone());
    }
  }
  const bags = new THREE.InstancedMesh(bagGeo, env.sandbagMat, bagMs.length);
  bagMs.forEach((m, i) => bags.setMatrixAt(i, m));
  bags.castShadow = true;
  bags.receiveShadow = true;
  scene.add(bags);

  // ── razor wire on Y-picket outriggers ──────────────────────────────────
  const wireMat = new THREE.MeshStandardMaterial({ color: 0x6b665e, metalness: 0.85, roughness: 0.42, envMapIntensity: 0.8 });
  const picketGeos = [];
  const strandGeos = [];
  for (const w of wings) {
    const n = Math.floor(w.len / 2.6);
    for (let k = 0; k <= n; k++) {
      const u = k * (w.len / n);
      const g = new THREE.BoxGeometry(0.05, 1.5, 0.05);
      g.translate(0, 0.75, 0);
      g.rotateX(-0.6);
      g.applyMatrix4(wingMatrix(w, u, H + 0.05, 0.1, new THREE.Matrix4()));
      picketGeos.push(g);
      const brace = new THREE.BoxGeometry(0.035, 0.7, 0.035);
      brace.translate(0, 0.35, 0);
      brace.rotateX(0.35);
      brace.applyMatrix4(wingMatrix(w, u, H + 0.05, 0.12, new THREE.Matrix4()));
      picketGeos.push(brace);
    }
    // three straight strands along the outriggers
    for (const t of [0.45, 0.85, 1.25]) {
      const s = new THREE.BoxGeometry(w.len, 0.012, 0.012);
      s.translate(w.len / 2, Math.cos(0.6) * t, 0.1 - Math.sin(0.6) * t);
      s.applyMatrix4(wingMatrix(w, 0, H + 0.05, 0, new THREE.Matrix4()));
      strandGeos.push(s);
    }
  }
  const pickets = new THREE.Mesh(merge([...picketGeos, ...strandGeos]), wireMat);
  scene.add(pickets);
  const coilGeo = concertinaGeo(3.0, 0.38, 0.13, 0.0065);
  const coilMs = [];
  for (const w of wings) {
    const n = Math.ceil(w.len / 3.0);
    for (let k = 0; k < n; k++) {
      wingMatrix(w, (k + 0.5) * (w.len / n), H + 0.3, -0.45, _m, (w.len / n) / 3.0, 1, 1, 0, (rng() - 0.5) * 0.15);
      coilMs.push(_m.clone());
    }
  }
  const coils = new THREE.InstancedMesh(coilGeo, wireMat, coilMs.length);
  coilMs.forEach((m, i) => coils.setMatrixAt(i, m));
  scene.add(coils);

  // ── sodium lamps on curved arms ────────────────────────────────────────
  const lampHeadGeo = merge([
    xf(new THREE.CylinderGeometry(0.1, 0.32, 0.3, 12, 1, true), 0, 0, 0),
    cylY(0.1, 0.12, 8, 0, 0.2, 0),
  ]);
  const lampGlass = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 2.3, 0.7) });
  env.lampSprites = [];
  const poleGeos = [], headGeos = [], glassGeos = [];
  for (const w of wings) {
    for (let k = 0; k < 5; k++) {
      const u = (k + 0.62) * (w.len / 5);
      const pole = new THREE.CylinderGeometry(0.06, 0.08, 3.4, 8);
      pole.translate(0, 1.7, 0);
      pole.applyMatrix4(wingMatrix(w, u, deckY, 2.6, new THREE.Matrix4()));
      poleGeos.push(pole);
      // arm reaching out over the parapet
      const arm = new THREE.CylinderGeometry(0.04, 0.04, 3.5, 6);
      arm.rotateX(Math.PI / 2 + 0.05);
      arm.translate(0, deckY + 3.2, 0.875);
      arm.applyMatrix4(wingMatrix(w, u, 0, 0, new THREE.Matrix4()));
      poleGeos.push(arm);
      const head = lampHeadGeo.clone();
      head.translate(0, deckY + 2.98, -0.85);
      head.applyMatrix4(wingMatrix(w, u, 0, 0, new THREE.Matrix4()));
      headGeos.push(head);
      const glass = new THREE.CircleGeometry(0.28, 12).rotateX(Math.PI / 2);
      glass.translate(0, deckY + 2.84, -0.85);
      glass.applyMatrix4(wingMatrix(w, u, 0, 0, new THREE.Matrix4()));
      glassGeos.push(glass);
      wingMatrix(w, u, deckY + 2.75, -0.85, _m);
      _v.setFromMatrixPosition(_m);
      const g = env.makeGlowSprite(0xffa040, 2.6, 0.9);
      g.position.copy(_v);
      scene.add(g);
      env.lampSprites.push(g);
      env.lightPools.push({ x: _v.x - w.nx * 4.5, z: _v.z - w.nz * 4.5, r: 9, color: [1.0, 0.5, 0.16], k: 0.11 });
    }
  }
  const poles = new THREE.Mesh(merge([...poleGeos, ...headGeos]), mats.darkSteel);
  scene.add(poles);
  scene.add(new THREE.Mesh(merge(glassGeos), lampGlass));

  buildStencils(env, wings);
  buildBunker(env);
}

function buildStencils(env, wings) {
  const cvs = document.createElement('canvas');
  cvs.width = 1024; cvs.height = 128;
  const ctx = cvs.getContext('2d');
  ctx.font = 'bold 96px "Bahnschrift", "Arial Narrow", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ['L5', 'L4', 'L3', 'L2', 'L1', 'R1', 'R2', 'R3', 'R4', 'R5'].forEach((l, i) => {
    ctx.fillStyle = 'rgba(205,195,165,0.82)';
    ctx.fillText(l, i * 102.4 + 51.2, 66);
  });
  ctx.globalCompositeOperation = 'destination-out';
  const rng = makeRng(31);
  for (let i = 0; i < 1800; i++) { ctx.fillStyle = `rgba(0,0,0,${rng() * 0.8})`; ctx.fillRect(rng() * 1024, rng() * 128, rng() * 6, rng() * 6); }
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  for (let s = 0; s < 10; s++) {
    const geo = new THREE.PlaneGeometry(3.0, 3.0);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, (s + uv.getX(i)) / 10);
    const x = sectionCenterX(s);
    const w = x < 0 ? wings[0] : wings[1];
    const u = (x - w.A[0]) / w.tx;
    geo.rotateY(Math.PI);
    geo.applyMatrix4(wingMatrix(w, u, 4.6, -0.012, new THREE.Matrix4()));
    env.scene.add(new THREE.Mesh(geo, mat));
  }
}

// ── central bunker & the nest ─────────────────────────────────────────────
function buildBunker(env) {
  const { scene, mats, tex } = env;
  const top = WORLD.TOWER_TOP;
  const z0 = WORLD.BASE_Z;
  const conc = weather(new THREE.MeshStandardMaterial({ map: tex.slab.map, normalMap: tex.slab.normalMap, color: 0x9a968e, roughness: 0.92 }), { soot: 0.6, rust: 0.15, scale: 0.35, key: 'bunker' });
  const G = [];
  const body = new THREE.BoxGeometry(16.5, top, 9);
  const buv = body.attributes.uv;
  for (let i = 0; i < buv.count; i++) buv.setXY(i, buv.getX(i) * 8, buv.getY(i) * 1.6);
  body.translate(0, top / 2, z0 + 4.5);
  G.push(body);
  // stepped blast plinth & buttresses
  G.push(box(17.6, 2.2, 1.6, 0, 1.1, z0 - 0.6));
  G.push(box(17.0, 0.9, 0.7, 0, 2.6, z0 - 0.2));
  for (const sx of [-8.4, 8.4]) G.push(box(1.0, top + 0.4, 1.8, sx, (top + 0.4) / 2, z0 + 0.5));
  // roof parapet
  G.push(box(16.5, 0.7, 0.4, 0, top + 0.35, z0 + 8.8));
  for (const sx of [-8.05, 8.05]) G.push(box(0.4, 0.7, 9, sx, top + 0.35, z0 + 4.5));
  // firing slit frames (slits themselves are dark insets)
  const slits = [];
  for (const sx of [-5.5, 5.5]) {
    G.push(box(3.6, 0.25, 0.3, sx, 8.25, z0 - 0.1));
    G.push(box(3.6, 0.25, 0.3, sx, 9.05, z0 - 0.1));
    slits.push(box(3.2, 0.55, 0.05, sx, 8.65, z0 + 0.02));
  }
  const bunker = new THREE.Mesh(merge(G), conc);
  bunker.castShadow = true;
  bunker.receiveShadow = true;
  scene.add(bunker);
  const slitMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.06, 0.025, 0.01) });
  scene.add(new THREE.Mesh(merge(slits), slitMat));

  // the nest deck
  const deckMat = weather(new THREE.MeshStandardMaterial({ color: 0x3a3c37, roughness: 0.55, metalness: 0.65, normalMap: tex.metal.normalMap }), { soot: 0.5, rust: 0.3, key: 'deck' });
  const D = [];
  D.push(box(5.6, 0.3, 3.4, 0, top - 0.15, -2.5));
  for (const sx of [-2.4, 2.4]) D.push(xf(new THREE.BoxGeometry(0.22, 0.3, 4.2), sx, top - 1.6, -2.2, -0.75));
  D.push(box(5.8, 0.08, 0.08, 0, top - 0.02, -4.22));
  const deck = new THREE.Mesh(merge(D), deckMat);
  deck.receiveShadow = true;
  scene.add(deck);

  // sandbag ring, two staggered courses
  const bagGeo = sandbagGeo();
  const rng = makeRng(404);
  const ms = [];
  const run = (x0, z0r, x1, z1, rows) => {
    const len = Math.hypot(x1 - x0, z1 - z0r), ang = Math.atan2(z1 - z0r, x1 - x0);
    const n = Math.max(1, Math.round(len / 0.6));
    for (let r = 0; r < rows; r++) for (let k = 0; k < n; k++) {
      const t = (k + 0.5 + (r % 2) * 0.5) / n;
      if (t > 1) continue;
      _q.setFromEuler(new THREE.Euler(0, -ang + (rng() - 0.5) * 0.18 + (rng() < 0.5 ? Math.PI : 0), (rng() - 0.5) * 0.06));
      _m.compose(_v.set(lerp(x0, x1, t), top + 0.09 + r * 0.155, lerp(z0r, z1, t)), _q, new THREE.Vector3(1, 1, 1.05));
      ms.push(_m.clone());
    }
  };
  run(-2.75, -4.05, -0.85, -4.2, 3);
  run(0.85, -4.2, 2.75, -4.05, 3);
  run(-2.8, -3.7, -2.8, -1.1, 3);
  run(2.8, -3.7, 2.8, -1.1, 3);
  run(-0.85, -4.2, 0.85, -4.2, 1);
  const bags = new THREE.InstancedMesh(bagGeo, env.sandbagMat, ms.length);
  ms.forEach((m, i) => bags.setMatrixAt(i, m));
  bags.castShadow = true;
  bags.receiveShadow = true;
  scene.add(bags);

  // ammo cans, radio, helmet, spent brass
  const olive = mats.olive;
  const A = [];
  const can = (x, z, ry, y = top) => {
    A.push(xf(new THREE.BoxGeometry(0.3, 0.19, 0.15), x, y + 0.095, z, 0, ry));
    A.push(xf(new THREE.BoxGeometry(0.31, 0.03, 0.16), x, y + 0.2, z, 0, ry));
    A.push(xf(new THREE.BoxGeometry(0.12, 0.02, 0.03), x, y + 0.225, z, 0, ry));
  };
  can(-1.95, -2.3, 0.2); can(-1.95, -2.3, 0.15, top + 0.22); can(-1.6, -2.35, -0.1); can(-1.75, -1.6, 1.4);
  can(2.0, -1.9, 0.5); can(1.9, -1.5, 0.3); can(2.0, -1.9, 0.6, top + 0.22);
  A.push(box(0.42, 0.3, 0.26, -2.2, top + 0.15, -1.4, 0, 0.3)); // radio
  A.push(box(0.04, 0.9, 0.04, -2.3, top + 0.7, -1.45)); // radio whip
  const ammo = new THREE.Mesh(merge(A), olive);
  ammo.receiveShadow = true;
  scene.add(ammo);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), olive);
  helmet.position.set(2.1, top + 0.01, -2.6); helmet.scale.set(1.15, 0.85, 1.25);
  scene.add(helmet);
  const brassMat = new THREE.MeshStandardMaterial({ color: 0x8a6a2c, metalness: 0.95, roughness: 0.35, envMapIntensity: 1.6 });
  const brass = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.011, 0.011, 0.1, 6), brassMat, 260);
  for (let i = 0; i < 260; i++) {
    const a = rng() * Math.PI * 2, r = Math.pow(rng(), 0.6) * 1.3;
    _q.setFromEuler(new THREE.Euler(Math.PI / 2, rng() * 6.28, 0));
    _m.compose(_v.set(0.9 + Math.cos(a) * r, top + 0.012, -2.2 + Math.sin(a) * r * 0.8), _q, new THREE.Vector3(1, 1, 1));
    brass.setMatrixAt(i, _m);
  }
  scene.add(brass);

  // flag, mast, beacon
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 8, 6), mats.darkSteel);
  pole.position.set(-6.8, top + 4, 1.5);
  scene.add(pole);
  const flagGeo = new THREE.PlaneGeometry(3.2, 2.1, 16, 8);
  flagGeo.translate(1.6, 0, 0);
  const flagTex = tex.flag;
  flagTex.repeat.set(1, 170 / 256);
  flagTex.offset.set(0, 1 - 170 / 256);
  const flagMat = new THREE.MeshStandardMaterial({ map: flagTex, side: THREE.DoubleSide, roughness: 0.95, transparent: true, alphaTest: 0.3 });
  env.flagUniforms = { uTime: { value: 0 } };
  flagMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = env.flagUniforms.uTime;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
      vec3 transformed = position;
      float k = position.x / 3.2;
      transformed.z += sin(position.x * 2.2 - uTime * 5.0) * 0.28 * k + sin(position.x * 4.1 - uTime * 8.3 + position.y) * 0.08 * k;
      transformed.y -= k * k * 0.35;`);
  };
  const flag = new THREE.Mesh(flagGeo, flagMat);
  flag.position.set(-6.8, top + 6.9, 1.5);
  flag.rotation.y = Math.PI * 0.85;
  scene.add(flag);
  const mast = new THREE.Mesh(merge([
    xf(new THREE.CylinderGeometry(0.03, 0.06, 11, 5), 0, 5.5, 0),
    box(0.9, 0.04, 0.04, 0, 8.5, 0), box(0.6, 0.04, 0.04, 0, 9.8, 0, 0, Math.PI / 2),
  ]), mats.darkSteel);
  mast.position.set(6.5, top, 3.5);
  scene.add(mast);
  env.beacon = env.makeGlowSprite(0xff2010, 1.6, 2.5);
  env.beacon.position.set(6.5, top + 11.1, 3.5);
  scene.add(env.beacon);

  // sandbagged shelter at the back of the roof with a lit doorway
  const S = [];
  for (let r = 0; r < 7; r++) for (let k = 0; k < 7; k++) {
    if (r < 5 && k >= 2 && k <= 3) continue;
    _q.setFromEuler(new THREE.Euler(0, (r % 2) * Math.PI + (rng() - 0.5) * 0.15, 0));
    _m.compose(_v.set(-2.4 + k * 0.62 + (r % 2) * 0.3, top + 0.09 + r * 0.155, z0 + 6.0), _q, new THREE.Vector3(1, 1, 1));
    S.push(_m.clone());
  }
  const shelter = new THREE.InstancedMesh(bagGeo, env.sandbagMat, S.length);
  S.forEach((m, i) => shelter.setMatrixAt(i, m));
  scene.add(shelter);
  const roof = new THREE.Mesh(box(5.2, 0.08, 3.2, -0.5, top + 1.18, z0 + 7.4, 0.05), weather(new THREE.MeshStandardMaterial({ map: tex.corr.map, normalMap: tex.corr.normalMap, color: 0x8a8578, roughness: 0.7, metalness: 0.5 }), { soot: 0.5, rust: 0.6, key: 'corr' }));
  scene.add(roof);
  const door = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.75), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.75, 0.25) }));
  door.position.set(-0.75, top + 0.42, z0 + 6.18);
  door.rotation.y = Math.PI;
  scene.add(door);
  const dg = env.makeGlowSprite(0xff9a40, 2.2, 0.35);
  dg.position.set(-0.75, top + 0.5, z0 + 5.9);
  scene.add(dg);
}

// ── searchlight towers at the wing ends ──────────────────────────────────
export function buildTowers(env) {
  const { scene, mats } = env;
  const G = [];
  const hgt = 16;
  const legAt = (y) => 1.75 - (y / hgt) * 0.6;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const a = new THREE.Vector3(sx * legAt(0), 0, sz * legAt(0)), b = new THREE.Vector3(sx * legAt(hgt), hgt, sz * legAt(hgt));
    const len = a.distanceTo(b);
    const g = new THREE.BoxGeometry(0.2, len, 0.2);
    g.translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
    g.translate(a.x, 0, a.z);
    G.push(g);
  }
  // X-bracing per bay on all four faces
  const bays = 5;
  for (let k = 0; k < bays; k++) {
    const y0 = k * hgt / bays + 0.3, y1 = (k + 1) * hgt / bays;
    const w0 = legAt(y0), w1 = legAt(y1);
    for (let f = 0; f < 4; f++) {
      const ry = f * Math.PI / 2;
      for (const s of [-1, 1]) {
        const a = new THREE.Vector3(-s * w0, y0, w0), b = new THREE.Vector3(s * w1, y1, w1);
        const len = a.distanceTo(b);
        const g = new THREE.BoxGeometry(0.08, len, 0.08);
        g.translate(0, len / 2, 0);
        g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
        g.translate(a.x, a.y, a.z);
        g.rotateY(ry);
        G.push(g);
      }
      G.push(xf(new THREE.BoxGeometry(w1 * 2, 0.1, 0.1), 0, y1, w1, 0, 0, 0).rotateY(ry));
    }
  }
  // ladder
  for (const s of [-0.22, 0.22]) G.push(box(0.05, hgt, 0.05, s, hgt / 2, legAt(0) + 0.35));
  for (let y = 0.4; y < hgt; y += 0.35) G.push(box(0.44, 0.03, 0.03, 0, y, legAt(0) + 0.35));
  // platform, railings, cabin, lamp housing
  G.push(box(4.2, 0.15, 4.2, 0, hgt, 0));
  for (const ry of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
    G.push(box(4.2, 0.05, 0.05, 0, hgt + 1.0, 2.05).rotateY(ry));
    G.push(box(4.2, 0.05, 0.05, 0, hgt + 0.5, 2.05).rotateY(ry));
    for (let k = -2; k <= 2; k++) G.push(box(0.05, 1.0, 0.05, k * 1.0, hgt + 0.5, 2.05).rotateY(ry));
  }
  G.push(box(1.6, 1.2, 1.4, 0.9, hgt + 0.7, 1.0));
  G.push(cylY(0.14, 0.9, 8, 0, hgt + 0.5, -0.4));
  const towerGeo = merge(G);
  for (const side of [-1, 1]) {
    const tx = side * 77, tz = wallZ(77) + 2;
    const mesh = new THREE.Mesh(towerGeo, mats.steel);
    mesh.position.set(tx, groundH(tx, tz), tz);
    mesh.receiveShadow = true;
    scene.add(mesh);
    // lamp housing (aims with the light in update)
    const housing = new THREE.Group();
    const shell = new THREE.Mesh(merge([
      cylZ(0.62, 1.2, 18, 0, 0, 0.2), cylZ(0.5, 0.25, 18, 0, 0, 0.9),
      box(0.1, 0.9, 0.1, -0.7, -0.3, 0.2), box(0.1, 0.9, 0.1, 0.7, -0.3, 0.2),
    ]), mats.darkSteel);
    housing.add(shell);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.56, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 9.5, 11) }));
    lens.position.z = 0.8;
    housing.add(lens);
    housing.position.set(tx, groundH(tx, tz) + 17.2, tz);
    scene.add(housing);
    env.towerHousings.push(housing);
  }
}

// ── the base behind the wall ─────────────────────────────────────────────
export function buildBase(env) {
  const { scene, mats, tex } = env;
  const rng = makeRng(909);
  const corr = weather(new THREE.MeshStandardMaterial({ map: tex.corr.map, normalMap: tex.corr.normalMap, color: 0x6c7058, roughness: 0.75, metalness: 0.45 }), { soot: 0.3, rust: 0.6, key: 'cont' });
  const corrRust = weather(new THREE.MeshStandardMaterial({ map: tex.corr.map, normalMap: tex.corr.normalMap, color: 0x7a4a34, roughness: 0.8, metalness: 0.4 }), { soot: 0.3, rust: 0.6, key: 'cont2' });
  const container = (x, z, ry, y = 0, mat = corr) => {
    const g = new THREE.BoxGeometry(6.06, 2.59, 2.44);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3, uv.getY(i));
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, groundH(x, z) + y + 1.3, z);
    m.rotation.y = ry;
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    // door bars
    const bars = new THREE.Mesh(merge([0, 1, 2, 3].map((k) => box(0.04, 2.3, 0.04, 3.04, 0, -0.9 + k * 0.6))), mats.darkSteel);
    bars.position.copy(m.position); bars.rotation.y = ry;
    scene.add(bars);
  };
  for (const side of [-1, 1]) {
    container(side * 30, 16, side * 0.55);
    container(side * 31, 19, side * 0.5, 0, corrRust);
    container(side * 30.5, 17.5, side * 0.52, 2.6);
    container(side * 50, 8, side * 0.58 + 0.05, 0, corrRust);
    container(side * 18, 24, side * 0.1);
  }

  // tents with lit doors
  const tentGeo = merge([
    extrude([[-2.2, 0], [-2.2, 1.4], [0, 2.7], [2.2, 1.4], [2.2, 0]], 6, 0),
  ]);
  for (const [x, z, ry] of [[-16, 10, 0.4], [-40, 12, 0.6], [15, 9, -0.35], [40, 14, -0.5], [-24, 26, 0.1]]) {
    const t = new THREE.Mesh(tentGeo, mats.canvas);
    t.position.set(x, groundH(x, z), z);
    t.rotation.y = ry + Math.PI / 2;
    t.castShadow = true; t.receiveShadow = true;
    scene.add(t);
    if (rng() < 0.75) {
      const door = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.6), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 0.62, 0.22) }));
      door.position.set(0, 0.8, 3.02);
      t.add(door);
      const g = env.makeGlowSprite(0xff9040, 3, 0.25);
      g.position.set(0, 1.0, 3.3);
      t.add(g);
      env.lightPools.push({ x: x + Math.sin(ry + Math.PI / 2) * 4.2, z: z + Math.cos(ry + Math.PI / 2) * 4.2, r: 5, color: [1, 0.5, 0.18], k: 0.06 });
    }
  }
  // trucks parked in the yard
  for (const [x, z, ry] of [[-55, 24, 1.2], [26, 30, -1.6], [57, 22, -1.0]]) {
    const t = makeTruck(mats, { body: mats.olive, burnt: false, seed: (x * 7) | 0, covered: true });
    t.position.set(x, groundH(x, z), z);
    t.rotation.y = ry;
    scene.add(t);
  }
  // generator and fuel drums
  const gen = new THREE.Mesh(merge([box(2.4, 1.4, 1.2, 0, 0.7, 0), cylY(0.08, 1.4, 8, 0.9, 2.0, 0.3)]), mats.olive);
  gen.position.set(-9, 0, 16);
  gen.castShadow = true;
  scene.add(gen);
  env.generator = { x: -9 + 0.9, y: 2.7, z: 16.3 };
  const drumGeo = merge([cylY(0.29, 0.88, 14, 0, 0.44, 0), cylY(0.3, 0.03, 14, 0, 0.3, 0), cylY(0.3, 0.03, 14, 0, 0.6, 0)]);
  const drumMs = [];
  const drumCluster = (cx, cz, n) => {
    for (let k = 0; k < n; k++) {
      const x = cx + (k % 3) * 0.62 + (rng() - 0.5) * 0.1, z = cz + Math.floor(k / 3) * 0.62;
      _m.compose(_v.set(x, groundH(x, z), z), _q.setFromEuler(new THREE.Euler(0, rng() * 6, 0)), new THREE.Vector3(1, 1, 1));
      drumMs.push(_m.clone());
    }
  };
  drumCluster(-12, 18, 7); drumCluster(36, 6, 5); drumCluster(-46, 4, 6);
  const drums = new THREE.InstancedMesh(drumGeo, mats.paintBlue, drumMs.length);
  drumMs.forEach((m, i) => drums.setMatrixAt(i, m));
  drums.castShadow = true; drums.receiveShadow = true;
  scene.add(drums);
  // floodlight masts
  for (const [x, z] of [[-34, 22], [34, 24]]) {
    const mst = new THREE.Mesh(merge([cylY(0.12, 9, 8, 0, 4.5, 0), box(2.4, 0.15, 0.15, 0, 9, 0), box(0.5, 0.35, 0.3, -0.9, 9.3, 0), box(0.5, 0.35, 0.3, 0.9, 9.3, 0)]), mats.darkSteel);
    mst.position.set(x, groundH(x, z), z);
    scene.add(mst);
    for (const dx of [-0.9, 0.9]) {
      const g = env.makeGlowSprite(0xdde6ff, 3.2, 0.6);
      g.position.set(x + dx, groundH(x, z) + 9.3, z - 0.2);
      scene.add(g);
      env.lampSprites.push(g);
    }
    env.lightPools.push({ x, z: z - 6, r: 16, color: [0.8, 0.85, 1.0], k: 0.07 });
  }
}

/** Additive pools of lamplight that hug the terrain. */
export function buildLightPools(env) {
  const pools = env.lightPools;
  if (!pools.length) return;
  const geo = new THREE.PlaneGeometry(2, 2, 8, 8).rotateX(-Math.PI / 2);
  const inst = new THREE.InstancedBufferGeometry().copy(geo);
  inst.instanceCount = pools.length;
  const P = new Float32Array(pools.length * 4), C = new Float32Array(pools.length * 3);
  pools.forEach((p, i) => { P.set([p.x, p.z, p.r, p.k], i * 4); C.set(p.color, i * 3); });
  inst.setAttribute('iPool', new THREE.InstancedBufferAttribute(P, 4));
  inst.setAttribute('iCol', new THREE.InstancedBufferAttribute(C, 3));
  env.poolUniforms = { uScale: { value: 1 }, ...heightUniforms() };
  const mat = new THREE.ShaderMaterial({
    uniforms: env.poolUniforms,
    vertexShader: HEIGHT_GLSL + /* glsl */`
      attribute vec4 iPool; attribute vec3 iCol;
      varying vec2 vUv2; varying vec3 vCol; varying float vK;
      void main(){
        vec3 p = position;
        vec2 xz = iPool.xy + p.xz * iPool.z;
        float y = lbTerrainH(xz) + 0.06;
        vUv2 = p.xz; vCol = iCol; vK = iPool.w;
        gl_Position = projectionMatrix * viewMatrix * vec4(xz.x, y, xz.y, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform float uScale;
      varying vec2 vUv2; varying vec3 vCol; varying float vK;
      void main(){
        float r = length(vUv2);
        float a = pow(max(0.0, 1.0 - r), 2.2) * vK * uScale;
        gl_FragColor = vec4(vCol * a, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  const mesh = new THREE.Mesh(inst, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  env.scene.add(mesh);
}

/** Pressure → blood on the wall face, per section. Called every frame. */
export function updateWallBlood(env, horde, dt) {
  const s = env.slabs;
  if (!s || !horde) return;
  let changed = false;
  for (let k = 0; k < 10; k++) {
    const p = horde.pressure(k);
    const target = Math.max(s.blood[k] - dt * 0.002, p * 1.05);
    if (Math.abs(target - s.blood[k]) > 0.004) { s.blood[k] = target; changed = true; }
  }
  if (!changed) return;
  const a = s.aSlab;
  for (let i = 0; i < s.section.length; i++) {
    const sec = s.section[i];
    a.setX(i, sec >= 0 ? s.blood[sec] : 0);
  }
  a.needsUpdate = true;
}
