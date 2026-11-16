// Everything beyond the killing ground: forested hills, a dead village with
// its church, a broken highway viaduct across the valley, power pylons, a
// radio mast, the far mountains and the burning city with its smoke plumes
// and the street fighting still going on inside it.
import * as THREE from 'three';
import { makeRng, lerp } from '../core/util.js';
import { groundH, groundNormal, heightFn, roadX, valleyEdge, vnoise } from './terrain.js';
import { box, cylY, merge, xf, worldUV, makeHouseGeo, makePylonGeo, sagWire, weather } from './kit.js';
import { FOG_CUSTOM_GLSL, fogUniforms } from '../render/atmosphere.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// ── smoke plume shader (cylindrical billboard, wind-bent) ───────────────────
const PLUME_VERT = /* glsl */`
uniform float uTime;
uniform vec2 uWind;
attribute vec4 iP;   // x, y, z, seed
attribute vec4 iS;   // width, height, lit, unused
varying vec2 vUv;
varying float vSeed;
varying float vLit;
varying float vFog;
varying vec3 vFogCol;
${FOG_CUSTOM_GLSL}
void main(){
  vec3 c = iP.xyz;
  vec2 tc = normalize(cameraPosition.xz - c.xz + 1e-4);
  vec3 right = vec3(tc.y, 0.0, -tc.x);
  float y = position.y;
  float w = iS.x * mix(0.25, 1.0, pow(y, 0.6));
  vec3 p = c + right * position.x * w + vec3(0.0, y * iS.y, 0.0);
  p.xz += uWind * pow(y, 1.6) * iS.y * 0.55;
  vUv = vec2(position.x + 0.5, y);
  vSeed = iP.w; vLit = iS.z;
  vec4 f = lbFog(p, cameraPosition, lbFogColor, lbTime, lbDawn);
  vFog = 1.0 - exp(log(max(1.0 - f.a, 1e-4)) * 0.5);
  vFogCol = f.rgb;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const PLUME_FRAG = /* glsl */`
uniform float uTime;
uniform float uBurn;
uniform float uDawn;
varying vec2 vUv;
varying float vSeed;
varying float vLit;
varying float vFog;
varying vec3 vFogCol;
float pHash(vec2 p){ p = fract(p * vec2(127.1, 311.7)); p += dot(p, p + 34.5); return fract(p.x * p.y); }
float pNoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(pHash(i), pHash(i + vec2(1.0, 0.0)), u.x), mix(pHash(i + vec2(0.0, 1.0)), pHash(i + vec2(1.0, 1.0)), u.x), u.y); }
float pFbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ v += a * pNoise(p); p = p * 2.02 + 7.7; a *= 0.5; } return v; }
void main(){
  float t = uTime * 0.035;
  vec2 q = vec2(vUv.x * 2.2, vUv.y * 3.0 - t * 2.0) + vSeed * 13.0;
  float n = pFbm(q + vec2(pFbm(q * 0.7 + t), 0.0) * 0.8);
  float x = (vUv.x - 0.5) * 2.0;
  float body = 1.0 - smoothstep(0.35, 1.0, abs(x + (n - 0.5) * 0.9));
  body *= smoothstep(0.0, 0.06, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
  float a = clamp(body * (0.45 + n * 0.9), 0.0, 1.0) * 0.92;
  // lit from below by the fires, sooty above
  float lit = exp(-vUv.y * 6.0) * vLit * uBurn * (0.6 + n * 0.6) * (1.0 - uDawn * 0.7);
  vec3 col = mix(vec3(0.012, 0.011, 0.011), vec3(0.05, 0.048, 0.05), uDawn) * (0.7 + n * 0.6) + vec3(0.9, 0.28, 0.06) * lit;
  col = mix(col, vFogCol, vFog);
  gl_FragColor = vec4(col, a * (1.0 - vFog * 0.5));
}`;

/** A layered conifer (pivot at the root). */
export function makeConiferGeo() {
  return merge([
    cylY(0.25, 4, 5, 0, 2, 0),
    xf(new THREE.ConeGeometry(2.6, 5.5, 7), 0, 4.6, 0),
    xf(new THREE.ConeGeometry(2.0, 4.8, 7), 0, 7.2, 0, 0, 0.5),
    xf(new THREE.ConeGeometry(1.3, 4.0, 7), 0, 9.8, 0, 0, 1.0),
  ]);
}
/** A burnt pine: a bare pole and a few snapped limbs. */
export function makeDeadPineGeo() {
  return merge([
    xf(new THREE.CylinderGeometry(0.12, 0.35, 12, 5), 0, 6, 0),
    box(2.2, 0.12, 0.12, 0.6, 7, 0, 0, 0.3, 0.2), box(1.8, 0.1, 0.1, -0.4, 8.6, 0, 0, 1.9, -0.25),
    box(1.4, 0.1, 0.1, 0.3, 10, 0, 0, 3.6, 0.3), box(2.4, 0.12, 0.12, -0.5, 5.6, 0, 0, 4.4, -0.15),
  ]);
}
let _pineMat = null;
export function makePineMat() {
  return _pineMat || (_pineMat = weather(new THREE.MeshStandardMaterial({ color: 0x1b2318, roughness: 0.95, flatShading: true }), { soot: 0.6, key: 'pine' }));
}

export function buildFar(env) {
  const { scene, mats, fire } = env;
  const q = env.quality;
  const rng = makeRng(9090);

  // ── forests on the hills ────────────────────────────────────────────────
  const conifer = makeConiferGeo();
  const deadPine = makeDeadPineGeo();
  const pineMat = makePineMat();
  const NT = q.texSize >= 1024 ? 5200 : 2600;
  const cMs = [], dMs = [];
  let tries = 0;
  while (cMs.length + dMs.length < NT && tries < NT * 12) {
    tries++;
    const x = (rng() - 0.5) * 2900, z = rng() < 0.16 ? 90 + rng() * 700 : -150 - rng() * 1400;
    if (z > 0) continue; // the country behind the base is dressed in rear.js
    const inField = Math.abs(x) < valleyEdge(z) + 8 && z > -430;
    if (inField) continue;
    if (z < -930 && Math.abs(x) < 820) continue; // the city
    if (Math.abs(x - roadX(z)) < 14) continue;
    const dens = vnoise(x * 0.0055 + 3, z * 0.0055);
    if (dens < 0.42 + rng() * 0.2) continue;
    const y = heightFn(x, z);
    if (y < 2.5) continue;
    const gn = [0, 1, 0];
    groundNormal(x, z, gn);
    if (gn[1] < 0.72) continue;
    const s = 0.75 + rng() * 0.8;
    const dead = rng() < 0.38 + (z > -500 ? 0.4 : 0);
    _q.setFromEuler(new THREE.Euler((rng() - 0.5) * 0.08, rng() * 6.28, (rng() - 0.5) * 0.08));
    _m.compose(_v.set(x, y - 0.4, z), _q, _s.set(s, s * (0.85 + rng() * 0.4), s));
    (dead ? dMs : cMs).push(_m.clone());
  }
  const forest = new THREE.InstancedMesh(conifer, pineMat, cMs.length);
  cMs.forEach((m, i) => forest.setMatrixAt(i, m));
  scene.add(forest);
  const dead = new THREE.InstancedMesh(deadPine, mats.charred, dMs.length);
  dMs.forEach((m, i) => dead.setMatrixAt(i, m));
  scene.add(dead);

  // ── a dead village on the left hills, a hamlet on the right ─────────────
  const houseParts = [], roofParts = [];
  const village = (cx, cz, n, seed) => {
    const r = makeRng(seed);
    for (let k = 0; k < n; k++) {
      const a = r() * 6.28, d = Math.sqrt(r()) * 60;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d * 0.7;
      const w = 6 + r() * 5, dd = 5 + r() * 4, h = 3 + r() * 3;
      const [g1, roof] = makeHouseGeo(w, dd, h, 2 + r() * 1.5);
      const ry = r() * 6.28;
      const y = groundH(x, z) - 0.5;
      for (const [g, list] of [[g1, houseParts], [roof, roofParts]]) {
        if (list === roofParts && r() < 0.3) continue; // roof burnt away
        g.rotateY(ry); g.translate(x, y, z);
        list.push(g);
      }
      if (r() < 0.22) fire.add(x, y + h * 0.6, z, w * 0.7, h * 1.6, 3.2, { smoke: 0, glow: false, fogScale: 0.75 });
      if (r() < 0.08) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.1), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.2, 0.45) }));
        win.position.set(x + Math.sin(ry) * (dd / 2 + 0.05), y + 1.8, z + Math.cos(ry) * (dd / 2 + 0.05));
        win.rotation.y = ry;
        scene.add(win);
        env.flickerWindows.push(win);
      }
    }
    // church with a spire
    const y = groundH(cx + 20, cz - 10) - 0.5;
    houseParts.push(box(9, 8, 18, cx + 20, y + 4, cz - 10));
    houseParts.push(box(5, 18, 5, cx + 20, y + 9, cz - 21));
    roofParts.push(xf(new THREE.ConeGeometry(3.8, 12, 4), cx + 20, y + 24, cz - 21, 0, Math.PI / 4));
    const [, croof] = makeHouseGeo(9, 18, 8, 4);
    croof.translate(cx + 20, y, cz - 10);
    roofParts.push(croof);
  };
  village(-430, -610, 16, 1);
  village(520, -470, 9, 2);
  const houseMesh = new THREE.Mesh(merge(houseParts), mats.plaster);
  houseMesh.receiveShadow = true;
  scene.add(houseMesh);
  scene.add(new THREE.Mesh(merge(roofParts), mats.roofTile));

  // ── the broken viaduct ───────────────────────────────────────────────────
  {
    const G = [];
    const zb = (x) => -505 + x * 0.1;
    const deckY = 30;
    const gapA = -66, gapB = -18;
    let xStart = -560, xEnd = 600;
    for (let x = -560; x < 0; x += 5) if (heightFn(x, zb(x)) < deckY - 1) { xStart = x; break; }
    for (let x = 600; x > 0; x -= 5) if (heightFn(x, zb(x)) < deckY - 1) { xEnd = x; break; }
    const span = (x0, x1, tilt = 0, drop = 0) => {
      const len = x1 - x0, cx = (x0 + x1) / 2;
      const ang = Math.atan(0.1);
      const g = merge([
        box(len, 1.6, 13, 0, 0, 0),
        box(len, 1.1, 0.35, 0, 1.3, 6.3), box(len, 1.1, 0.35, 0, 1.3, -6.3),
        box(len, 0.25, 0.2, 0, 0.9, 0),
      ]);
      g.rotateZ(tilt);
      g.rotateY(-ang);
      g.translate(cx, deckY - drop, zb(cx));
      G.push(g);
    };
    span(xStart - 10, gapA);
    span(gapB, xEnd + 10);
    // collapsed pieces hanging into the gap
    span(gapA - 2, gapA + 16, -0.55, 6.5);
    span(gapB - 14, gapB + 2, 0.7, 7.5);
    for (let x = xStart + 20; x < xEnd - 10; x += 46) {
      if (x > gapA - 6 && x < gapB + 6) continue;
      const z = zb(x), gy = heightFn(x, z);
      const h = deckY - gy + 2;
      if (h < 3) continue;
      G.push(box(3.2, h, 5.5, x, gy - 2 + h / 2, z));
      G.push(box(4.2, 1.4, 12, x, deckY - 1.4, z));
    }
    const vMat = weather(new THREE.MeshStandardMaterial({ map: env.tex.concrete.map, normalMap: env.tex.concrete.normalMap, color: 0x8a8680, roughness: 0.95 }), { soot: 0.5, key: 'viaduct' });
    const via = new THREE.Mesh(env.tex.concrete.file ? worldUV(merge(G), 4.0) : merge(G), vMat);
    scene.add(via);
    // rebar dangling from the broken ends
    const R = [];
    for (let k = 0; k < 10; k++) {
      const x = gapA + 14 + rng() * 2, z = zb(x) + (rng() - 0.5) * 11;
      R.push(sagWire(new THREE.Vector3(x, deckY - 6, z), new THREE.Vector3(x + 2 + rng() * 3, deckY - 12 - rng() * 6, z + (rng() - 0.5) * 2), -0.6, 0.06, 6));
    }
    scene.add(new THREE.Mesh(merge(R), mats.darkSteel));
    // a burning truck stranded on the deck
    fire.add(110, deckY + 1.5, zb(110), 4, 7, 4, { smoke: 0, glow: false, fogScale: 0.7 });
    env.viaductFire = { x: 110, y: deckY + 1.5, z: zb(110) };
  }

  // ── power pylons marching across the far valley ──────────────────────────
  {
    const pyl = makePylonGeo(30);
    const tops = [];
    const ms = [];
    for (let k = 0; k <= 16; k++) {
      const x = -1250 + k * 160, z = -840 + Math.sin(k * 0.7) * 30;
      if (Math.abs(x) < 820 && z < -930) continue;
      const y = heightFn(x, z) - 0.5;
      const lean = k === 9 ? 0.45 : (rng() - 0.5) * 0.04;
      _q.setFromEuler(new THREE.Euler(0, Math.atan2(30, 160) * 0.2, lean));
      _m.compose(_v.set(x, y, z), _q, _s.set(1, 1, 1));
      ms.push(_m.clone());
      tops.push(k === 9 ? null : [-5.6, 5.6].map((dx) => new THREE.Vector3(dx, 26, 0).applyMatrix4(_m)));
    }
    const pm = new THREE.InstancedMesh(pyl, mats.darkSteel, ms.length);
    ms.forEach((m, i) => pm.setMatrixAt(i, m));
    scene.add(pm);
    const C = [];
    for (let k = 0; k + 1 < tops.length; k++) {
      const a = tops[k], b = tops[k + 1];
      if (!a || !b) continue;
      for (let c = 0; c < 2; c++) C.push(sagWire(a[c], b[c], 9, 0.09, 18));
    }
    if (C.length) scene.add(new THREE.Mesh(merge(C), mats.darkSteel));
  }

  // ── radio mast on the right hills ────────────────────────────────────────
  {
    const x = 640, z = -575, y = heightFn(x, z);
    const G = [];
    for (let k = 0; k < 12; k++) {
      const hy = k * 6;
      G.push(box(0.15, 6, 0.15, -0.6, hy + 3, -0.6), box(0.15, 6, 0.15, 0.6, hy + 3, -0.6), box(0.15, 6, 0.15, 0, hy + 3, 0.6));
      G.push(box(1.4, 0.1, 0.1, 0, hy + 1, -0.6, 0, 0, 0.7));
    }
    const mast = new THREE.Mesh(merge(G), mats.darkSteel);
    mast.position.set(x, y, z);
    scene.add(mast);
    for (const hy of [24, 48, 72]) {
      const s = env.makeGlowSprite(0xff1a0a, hy === 72 ? 10 : 7, 2.4, true);
      s.position.set(x, y + hy, z);
      scene.add(s);
      env.blinkers.push({ sprite: s, ph: rng() * 6, rate: 1.1 });
    }
  }

  // ── far mountains beyond everything ──────────────────────────────────────
  {
    const pos = [], idx = [];
    const segs = 220;
    for (let i = 0; i <= segs; i++) {
      const a = lerp(-1.75, 1.75, i / segs);
      const r = 2350 + Math.sin(i * 0.37) * 120;
      const h = 140 + 170 * Math.pow(vnoise(i * 0.06, 3) * 0.7 + vnoise(i * 0.21, 7) * 0.3, 1.4) * (0.6 + 0.4 * Math.abs(Math.sin(a * 1.3)));
      const x = Math.sin(a) * r, z = -Math.cos(a) * r;
      pos.push(x, -60, z, x, h, z);
      if (i < segs) { const b = i * 2; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const mm = new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 1, side: THREE.DoubleSide });
    mm.defines = { LB_FOG_SCALE: '0.42' };
    const mtn = new THREE.Mesh(g, mm);
    mtn.frustumCulled = false;
    scene.add(mtn);
  }

  buildCity(env, rng);
}

// ── the burning city ────────────────────────────────────────────────────────
function buildCity(env, rng) {
  const { scene, fire } = env;
  const parts = [];
  const tall = [];
  let bid = 0;
  const addBox = (w, h, d, x, y, z, ry = 0, rz = 0, id = bid) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(0, h / 2, 0);
    g.rotateZ(rz);
    g.rotateY(ry);
    g.translate(x, y, z);
    const n = g.attributes.position.count;
    g.setAttribute('aBld', new THREE.Float32BufferAttribute(new Float32Array(n).fill(id), 1));
    parts.push(g.toNonIndexed());
  };
  const cityGround = (x, z) => heightFn(x, z) - 1.5;
  const building = (x, z, w, d, h, opts = {}) => {
    bid++;
    const y = cityGround(x, z);
    const ry = opts.ry || 0;
    const rz = opts.tilt || 0;
    if (opts.broken) {
      // jagged stump: main block cut short, a few columns sticking up
      addBox(w, h * 0.6, d, x, y, z, ry, rz);
      for (let k = 0; k < 5; k++) addBox(w * 0.12, h * (0.62 + rng() * 0.3), d * 0.12, x + (rng() - 0.5) * w * 0.8, y, z + (rng() - 0.5) * d * 0.8, ry, rz);
      return;
    }
    addBox(w, h, d, x, y, z, ry, rz);
    let top = h;
    if (h > 70) {
      const tiers = 1 + ((rng() * 2.5) | 0);
      let tw = w, td = d;
      for (let k = 0; k < tiers; k++) {
        tw *= 0.62 + rng() * 0.2; td *= 0.62 + rng() * 0.2;
        const th = h * (0.12 + rng() * 0.15);
        addBox(tw, th, td, x, y + top, z, ry, rz);
        top += th;
      }
      tall.push([x, y + top, z, rz]);
    }
    // roof clutter
    const nr = h > 30 ? 2 + ((rng() * 3) | 0) : 1;
    for (let k = 0; k < nr; k++) addBox(2 + rng() * 6, 1.5 + rng() * 4, 2 + rng() * 6, x + (rng() - 0.5) * w * 0.5, y + top, z + (rng() - 0.5) * d * 0.5, ry, rz);
    if (h > 120) addBox(0.8, 25 + rng() * 25, 0.8, x, y + top, z, ry, rz);
  };
  // blocks on a rough grid, downtown in the middle
  for (let gx = -16; gx <= 16; gx++) {
    for (let gz = 0; gz < 6; gz++) {
      if (rng() < 0.18) continue;
      const x = gx * 48 + (rng() - 0.5) * 16, z = -1000 - gz * 52 - (rng() - 0.5) * 14;
      const down = Math.exp(-Math.pow((x - 60) / 230, 2)) * Math.exp(-Math.pow((z + 1140) / 120, 2));
      const h = 12 + Math.pow(rng(), 1.8) * 34 + down * (30 + rng() * 115) * (rng() < 0.75 ? 1 : 0.4);
      const w = 18 + rng() * 22, d = 16 + rng() * 22;
      const tilt = rng() < 0.1 ? (rng() - 0.5) * 0.4 : 0;
      building(x, z, w, d, h, { broken: rng() < 0.09 && h > 40, tilt, ry: (rng() - 0.5) * 0.12 });
    }
  }
  // merge keeps aBld only if we do it by hand
  const total = parts.reduce((a, g) => a + g.attributes.position.count, 0);
  const P = new Float32Array(total * 3), N = new Float32Array(total * 3), B = new Float32Array(total);
  let o = 0;
  for (const g of parts) {
    g.computeVertexNormals();
    P.set(g.attributes.position.array, o * 3);
    N.set(g.attributes.normal.array, o * 3);
    B.set(g.attributes.aBld.array, o);
    o += g.attributes.position.count;
  }
  const cg = new THREE.BufferGeometry();
  cg.setAttribute('position', new THREE.BufferAttribute(P, 3));
  cg.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  cg.setAttribute('aBld', new THREE.BufferAttribute(B, 1));
  cg.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ color: 0x24221f, roughness: 0.9, metalness: 0.1, emissive: 0xffffff });
  mat.defines = { LB_FOG_SCALE: '0.5' };
  env.cityUniforms = { uTime: { value: 0 }, uDawn: { value: 0 }, uBurn: { value: 1 } };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = env.cityUniforms.uTime;
    sh.uniforms.uDawn = env.cityUniforms.uDawn;
    sh.uniforms.uBurn = env.cityUniforms.uBurn;
    sh.vertexShader = 'attribute float aBld;\nvarying float vBld;\nvarying vec3 vCW;\nvarying vec3 vCN;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vBld = aBld; vCW = (modelMatrix * vec4(transformed, 1.0)).xyz; vCN = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = `uniform float uTime;\nuniform float uDawn;\nuniform float uBurn;\nvarying float vBld;\nvarying vec3 vCW;\nvarying vec3 vCN;
      float cHash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float cNoise(float x){ float i = floor(x), f = fract(x); return mix(cHash(vec3(i, 1.0, 2.0)), cHash(vec3(i + 1.0, 1.0, 2.0)), f * f * (3.0 - 2.0 * f)); }
    ` + sh.fragmentShader.replace('#include <emissivemap_fragment>', `
      {
        vec3 em = vec3(0.0);
        float vert = 1.0 - abs(vCN.y);
        if (vert > 0.5) {
          float hc = abs(vCN.x) > abs(vCN.z) ? vCW.z : vCW.x;
          vec2 cell = vec2(floor(hc / 3.2), floor(vCW.y / 3.8));
          vec2 f = vec2(fract(hc / 3.2), fract(vCW.y / 3.8));
          float win = step(0.18, f.x) * step(f.x, 0.82) * step(0.25, f.y) * step(f.y, 0.78);
          float r = cHash(vec3(cell, vBld));
          float lit = step(0.982, r);
          float fireLit = step(0.985, r);
          float fl = 0.7 + 0.3 * sin(uTime * (3.0 + r * 9.0) + r * 40.0);
          // once the city has stopped burning (env.setStory): no fire in the windows, no glow in
          // the streets, and only the odd lamp left on
          lit *= min(1.0, step(0.996, r) + step(0.3, uBurn));
          em += win * lit * mix(vec3(1.1, 0.55, 0.2), vec3(0.6, 0.65, 0.75), step(0.993, r)) * 0.6;
          em += win * fireLit * vec3(4.0, 1.4, 0.3) * fl * uBurn;
          // burning districts light the facades from street level
          float district = smoothstep(0.55, 0.85, cNoise(vCW.x * 0.006 + 3.0)) * uBurn;
          em += vec3(1.0, 0.35, 0.08) * exp(-max(vCW.y, 0.0) / 28.0) * district * 0.55 * (0.85 + 0.15 * sin(uTime * 2.0 + vCW.x * 0.05));
        }
        totalEmissiveRadiance = em * (1.0 - uDawn * 0.85);
      }`);
  };
  mat.customProgramCacheKey = () => 'lb-city';
  const city = new THREE.Mesh(cg, mat);
  city.frustumCulled = false;
  scene.add(city);

  // aviation lights on the tallest towers
  tall.sort((a, b) => b[1] - a[1]);
  for (const [x, y, z] of tall.slice(0, 14)) {
    const s = env.makeGlowSprite(0xff2410, 9, 2.6, true);
    s.position.set(x, y + 2, z);
    scene.add(s);
    env.blinkers.push({ sprite: s, ph: rng() * 6, rate: 0.8 + rng() * 0.6 });
  }

  // tower cranes (one with its jib snapped)
  const C = [];
  for (const [x, z, broken] of [[-180, -1060, false], [240, -1180, true], [410, -1040, false]]) {
    const y = cityGround(x, z);
    const h = 110 + rng() * 40;
    for (const [dx, dz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) C.push(box(0.5, h, 0.5, x + dx, y + h / 2, z + dz));
    for (let k = 0; k < h / 5; k++) C.push(box(3.4, 0.25, 0.25, x, y + k * 5, z, 0, (k % 2) * Math.PI / 2, 0.6));
    const ry = rng() * 6.28;
    if (!broken) {
      C.push(xf(new THREE.BoxGeometry(70, 2.2, 1.6), x + Math.cos(ry) * 25, y + h, z - Math.sin(ry) * 25, 0, ry));
      C.push(xf(new THREE.BoxGeometry(20, 2.6, 2), x - Math.cos(ry) * 10, y + h, z + Math.sin(ry) * 10, 0, ry));
      C.push(box(6, 5, 4, x - Math.cos(ry) * 18, y + h - 3, z + Math.sin(ry) * 18));
    } else {
      C.push(xf(new THREE.BoxGeometry(60, 2.2, 1.6), x + Math.cos(ry) * 12, y + h - 25, z - Math.sin(ry) * 12, 0, ry, 1.1));
    }
  }
  scene.add(new THREE.Mesh(merge(C), new THREE.MeshStandardMaterial({ color: 0x1c1b1a, roughness: 0.8, metalness: 0.4 })));

  // street fires, district glow and smoke plumes
  env.cityFires = [];
  const plumes = [];
  for (let i = 0; i < 16; i++) {
    const x = (rng() - 0.5) * 1300, z = -995 - rng() * 230;
    const y = cityGround(x, z);
    const big = i < 7;
    const fk = big ? 7 : 5;
    const args = [x, y, z, big ? 50 + rng() * 40 : 22 + rng() * 20, big ? 70 + rng() * 60 : 30 + rng() * 25, fk, { glow: false, fogScale: 0.42, fadeIn: 0 }];
    const fid = fire.add(...args);
    const g = env.makeGlowSprite(0xff5a14, big ? 230 + rng() * 120 : 110, big ? 0.17 : 0.11, false);
    g.position.set(x, y + 30, z + 20);
    g.renderOrder = -3;
    scene.add(g);
    env.cityFires.push({ sprite: g, base: g.material.color.clone(), ph: rng() * 10, fid, fk, big, args });
    if (big) plumes.push([x, y + 20, z, 160 + rng() * 120, 520 + rng() * 380, 1]);
  }
  plumes.push([-640, cityGround(-640, -1100), -1100, 220, 700, 0.6]);
  plumes.push([700, cityGround(700, -1050), -1050, 200, 620, 0.6]);
  const pg = new THREE.InstancedBufferGeometry();
  const plane = new THREE.PlaneGeometry(1, 1, 1, 16);
  plane.translate(0, 0.5, 0);
  pg.index = plane.index;
  pg.setAttribute('position', plane.attributes.position);
  const IP = new Float32Array(plumes.length * 4), IS = new Float32Array(plumes.length * 4);
  plumes.forEach(([x, y, z, w, h, lit], i) => { IP.set([x, y, z, rng()], i * 4); IS.set([w, h, lit, 0], i * 4); });
  pg.setAttribute('iP', new THREE.InstancedBufferAttribute(IP, 4));
  pg.setAttribute('iS', new THREE.InstancedBufferAttribute(IS, 4));
  pg.instanceCount = plumes.length;
  env.plumeUniforms = { uTime: { value: 0 }, uDawn: { value: 0 }, uBurn: { value: 1 }, uWind: { value: new THREE.Vector2(0.55, 0.12) }, ...fogUniforms };
  const plumeMesh = new THREE.Mesh(pg, new THREE.ShaderMaterial({
    uniforms: env.plumeUniforms, vertexShader: PLUME_VERT, fragmentShader: PLUME_FRAG,
    transparent: true, depthWrite: false,
  }));
  plumeMesh.frustumCulled = false;
  plumeMesh.renderOrder = -1;
  scene.add(plumeMesh);

  env.combatSites = [[-260, -1080], [80, -1130], [380, -1060], [-520, -1150], [600, -1200]].map(([x, z]) => ({ x, z, y: cityGround(x, z), t: rng() * 3 }));
}
