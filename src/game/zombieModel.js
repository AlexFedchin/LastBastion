// The zombie: an instanced body animated entirely in the vertex shader so
// thousands of them can shamble, sprint, claw and burn in a few draw calls.
//
// Three levels of detail share one material and one skeleton:
//   0  close: rounded limbs, hands and fingers, face, torn shirt hem, gear
//   1  corpses: same silhouette with fewer segments
//   2  far: boxes
// Optional gear (helmet, plate carrier, pack, hair, cap, hi-vis) is baked into
// every mesh and collapsed per instance from a seed, so the horde is a mix of
// soldiers, workers and civilians without extra draw calls.
import * as THREE from 'three';
import { Fn, If, Discard, float, int, vec2, vec3, vec4, mat3, uniform, attribute, instancedBufferAttribute, varyingProperty, screenCoordinate, normalLocal, normalView, positionViewDirection, modelWorldMatrix, cameraViewMatrix, cameraProjectionMatrix, cameraPosition, mix, smoothstep, clamp, max, min, abs, exp, pow, sin, cos, dot, length, normalize, fract, floor, step, select } from 'three/tsl';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { lbFog } from '../render/atmosphere.js';

// Part ids (pivots in the pose code must match these positions)
// 0 hips · 1 chest · 2 head · 3 L upper arm · 4 R upper arm · 5 L thigh · 6 L shin
// 7 R thigh · 8 R shin · 9 L forearm · 10 R forearm
// Material ids: 0 shirt · 1 skin · 2 eye · 3 pants · 4 gore · 5 olive gear · 6 leather/boots · 7 hi-vis · 8 hair
// Gear ids: 0 always · 1 helmet · 2 vest · 3 pack · 4 hair · 5 cap · 6 hi-vis

const SH = 1.44, EL = 1.16, HIP = 0.9, KNEE = 0.48;

function builder() {
  const G = { pos: [], nor: [], part: [], mat: [], gear: [], idx: [] };
  G.add = (geo, part, mat, gear = 0) => {
    const p = geo.attributes.position, n = geo.attributes.normal;
    const base = G.pos.length / 3;
    for (let i = 0; i < p.count; i++) {
      G.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      G.nor.push(n.getX(i), n.getY(i), n.getZ(i));
      G.part.push(part); G.mat.push(mat); G.gear.push(gear);
    }
    if (geo.index) for (let i = 0; i < geo.index.count; i++) G.idx.push(geo.index.getX(i) + base);
    else for (let i = 0; i < p.count; i++) G.idx.push(base + i);
  };
  G.build = () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(G.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(G.nor, 3));
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(G.part, 1));
    g.setAttribute('aMat', new THREE.Float32BufferAttribute(G.mat, 1));
    g.setAttribute('aGear', new THREE.Float32BufferAttribute(G.gear, 1));
    g.setIndex(G.idx);
    g.computeBoundingSphere();
    return g;
  };
  return G;
}

const _up = new THREE.Vector3(0, 1, 0);
/** Tapered limb segment from a to b. */
function seg(r0, r1, a, b, radial, flatZ = 1, capped = false) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const g = new THREE.CylinderGeometry(r1, r0, len, radial, 1, !capped);
  g.translate(0, len / 2, 0);
  g.scale(1, 1, flatZ);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(_up, B.clone().sub(A).normalize()));
  g.translate(A.x, A.y, A.z);
  return g;
}
function sph(r, x, y, z, sx = 1, sy = 1, sz = 1, ws = 10, hs = 8, thetaLen = Math.PI) {
  const g = new THREE.SphereGeometry(r, ws, hs, 0, Math.PI * 2, 0, thetaLen);
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  return g;
}
function bx(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

export function createZombieGeometry(lod = 0) {
  if (lod >= 2) return createBoxyGeometry();
  const G = builder();
  const R = lod === 0 ? 9 : 6;
  const L = lod === 0 ? 7 : 5;
  // pelvis, torso, shoulders
  G.add(seg(0.155, 0.168, [0, 0.86, 0], [0, 1.06, 0], R, 0.72), 0, 3);
  G.add(seg(0.168, 0.2, [0, 1.04, 0], [0, 1.43, 0], R, 0.62), 1, 0);
  G.add(sph(0.2, 0, 1.43, 0, 1, 0.38, 0.62, R, lod === 0 ? 4 : 3, Math.PI / 2), 1, 0);
  if (lod === 0) for (const s of [-1, 1]) G.add(sph(0.068, s * 0.2, SH - 0.01, 0, 1, 1, 1, 6, 4), 1, 0);
  // wounds: ribs, bite, gut
  G.add(bx(0.12, 0.15, 0.03, 0.07, 1.26, 0.118), 1, 4);
  if (lod === 0) G.add(bx(0.08, 0.08, 0.03, -0.155, 1.13, 0.05, 0, 0.9), 1, 4);
  // torn shirt hem
  if (lod === 0) {
    for (let k = 0; k < 14; k++) {
      const a0 = (k / 14) * Math.PI * 2, a1 = ((k + 1) / 14) * Math.PI * 2;
      const drop = 0.05 + ((k * 7919) % 13) / 13 * 0.1;
      const p = new THREE.BufferGeometry();
      const x0 = Math.sin(a0) * 0.172, z0 = Math.cos(a0) * 0.112, x1 = Math.sin(a1) * 0.172, z1 = Math.cos(a1) * 0.112;
      const xm = (x0 + x1) / 2 * 1.04, zm = (z0 + z1) / 2 * 1.04;
      p.setAttribute('position', new THREE.Float32BufferAttribute([x0, 1.05, z0, x1, 1.05, z1, xm, 1.05 - drop, zm], 3));
      p.computeVertexNormals();
      const n = p.attributes.normal;
      for (let i = 0; i < 3; i++) n.setXYZ(i, xm * 5, 0, zm * 5);
      G.add(p, 1, 0);
    }
  }
  // neck & head
  G.add(seg(0.05, 0.045, [0, 1.45, 0.005], [0, 1.61, 0.012], L), 2, 1);
  G.add(sph(0.112, 0, 1.715, 0.012, 0.9, 1.06, 1.0, lod === 0 ? 10 : 7, lod === 0 ? 7 : 5), 2, 1);
  G.add(bx(0.118, 0.045, 0.1, 0, 1.628, 0.05, 0.28), 2, 1);              // slack jaw
  G.add(bx(0.08, 0.034, 0.02, 0, 1.652, 0.103, 0.2), 2, 4);              // open mouth
  if (lod === 0) {
    G.add(bx(0.026, 0.04, 0.03, 0, 1.712, 0.116, -0.2), 2, 1);           // nose
    G.add(bx(0.14, 0.022, 0.03, 0, 1.752, 0.098), 2, 1);                 // brow
  }
  for (const s of [-1, 1]) G.add(bx(0.032, 0.022, 0.012, s * 0.038, 1.733, 0.108), 2, 2);
  if (lod === 0) for (const s of [-1, 1]) G.add(bx(0.016, 0.045, 0.032, s * 0.1, 1.712, 0.0), 2, 1);
  G.add(bx(0.06, 0.04, 0.02, 0.05, 1.79, -0.09, 0.6, 0.3), 2, 4);        // head wound
  // arms
  for (const s of [-1, 1]) {
    const up = s > 0 ? 3 : 4, fo = s > 0 ? 9 : 10;
    G.add(seg(0.052, 0.044, [s * 0.225, SH, 0], [s * 0.24, EL, 0], L), up, 0);
    G.add(seg(0.043, 0.034, [s * 0.24, EL, 0], [s * 0.246, 0.915, 0.02], L), fo, 1);
    G.add(bx(0.03, 0.09, 0.056, s * 0.246, 0.862, 0.022), fo, 1);
    if (lod === 0) {
      G.add(bx(0.014, 0.07, 0.05, s * 0.246, 0.79, 0.022, 0.25), fo, 1);
      G.add(bx(0.012, 0.05, 0.012, s * 0.232, 0.83, 0.05, 0.6), fo, 1);
    }
  }
  // legs
  for (const s of [-1, 1]) {
    const th = s > 0 ? 5 : 7, sh = s > 0 ? 6 : 8;
    G.add(seg(0.085, 0.062, [s * 0.1, HIP, 0], [s * 0.1, KNEE, 0.01], L), th, 3);
    G.add(seg(0.058, 0.044, [s * 0.1, KNEE, 0.01], [s * 0.1, 0.09, 0], L), sh, 3);
    G.add(bx(0.096, 0.08, 0.24, s * 0.1, 0.045, 0.04), sh, 6);
    if (lod === 0) G.add(bx(0.09, 0.03, 0.08, s * 0.1, 0.1, 0.12, 0.5), sh, 6);
  }
  if (lod === 0) G.add(bx(0.07, 0.12, 0.03, -0.1, 0.7, 0.062), 7, 4);   // thigh wound

  // ── gear ──
  const HS = lod === 0 ? 10 : 7, HV = lod === 0 ? 4 : 3;
  G.add(sph(0.134, 0, 1.728, 0.0, 1, 0.84, 1.1, HS, HV, Math.PI / 2), 2, 5, 1);    // helmet
  G.add(seg(0.142, 0.142, [0, 1.722, 0.002], [0, 1.734, 0.002], HS, 1.1), 2, 5, 1);
  G.add(seg(0.205, 0.215, [0, 1.07, 0], [0, 1.41, 0], R, 0.72), 1, 5, 2);         // plate carrier
  if (lod === 0) {
    G.add(bx(0.07, 0.085, 0.045, -0.09, 1.16, 0.152), 1, 5, 2);
    G.add(bx(0.07, 0.085, 0.045, 0.0, 1.16, 0.158), 1, 5, 2);
    G.add(bx(0.07, 0.085, 0.045, 0.09, 1.16, 0.152), 1, 5, 2);
  }
  G.add(bx(0.28, 0.36, 0.14, 0, 1.27, -0.19), 1, 6, 3);                           // pack
  G.add(seg(0.05, 0.05, [-0.16, 1.48, -0.17], [0.16, 1.48, -0.17], 8), 1, 5, 3);
  G.add(sph(0.122, 0, 1.722, 0.004, 0.94, 1.0, 1.03, HS, HV, Math.PI * 0.55), 2, 8, 4); // hair
  G.add(bx(0.19, 0.2, 0.04, 0, 1.63, -0.088, 0.15), 2, 8, 4);
  G.add(sph(0.12, 0, 1.745, 0.004, 0.97, 0.62, 1.02, HS, 3, Math.PI / 2), 2, 6, 5);   // cap
  G.add(bx(0.13, 0.012, 0.085, 0, 1.748, 0.12, -0.1), 2, 6, 5);
  G.add(seg(0.174, 0.207, [0, 1.06, 0], [0, 1.42, 0], R, 0.645), 1, 7, 6);        // hi-vis
  return G.build();
}

// ── The giant (Goliath / Behemoth) ──────────────────────────────────────────
// Seen at four to five times human size, up close, for minutes: it gets its own
// sculpted mesh. Same part ids and joint pivots as the horde, so the shared pose
// shader walks, smashes and topples it; everything else is new: a hunched,
// lopsided mass of muscle with a bone-spined back, an opened rib cage, a hanging
// gut, one swollen club of an arm, long clawed hands, tumours, rebar through the
// chest and a lumpy, noise-displaced hide instead of clean cylinders.
// Material 9 is bone.

function vhash(x, y, z) { const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  let fx = x - ix, fy = y - iy, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  const h = (dx, dy, dz) => vhash(ix + dx, iy + dy, iz + dz);
  return l(l(l(h(0, 0, 0), h(1, 0, 0), fx), l(h(0, 1, 0), h(1, 1, 0), fx), fy),
    l(l(h(0, 0, 1), h(1, 0, 1), fx), l(h(0, 1, 1), h(1, 1, 1), fx), fy), fz);
}

/** Weld, push every vertex along its normal by layered noise, re-light: clean primitives become flesh. */
function organic(geo, amp = 0.012, freq = 9) {
  geo.deleteAttribute('uv');
  const g = mergeVertices(geo, 1e-4);
  g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const d = (vnoise(x * freq, y * freq, z * freq) - 0.5) * amp * 2
      + (vnoise(x * freq * 2.7 + 9, y * freq * 2.7, z * freq * 2.7) - 0.5) * amp * 0.8
      + (vnoise(x * freq * 7 + 3, y * freq * 7, z * freq * 7) - 0.5) * amp * 0.25;
    p.setXYZ(i, x + n.getX(i) * d, y + n.getY(i) * d, z + n.getZ(i) * d);
  }
  g.computeVertexNormals();
  return g;
}

/** A limb or trunk from a to b with a radius profile (muscle bellies, joints), rounded at both ends. */
function limb(a, b, radii, radial = 16, flatZ = 1, rows = 4) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const pts = [new THREE.Vector2(0, -radii[0] * 0.6)];
  const n = radii.length;
  for (let k = 0; k < (n - 1) * rows + 1; k++) {
    const t = k / ((n - 1) * rows), f = t * (n - 1), i = Math.min(n - 2, Math.floor(f)), u = f - i;
    const s = u * u * (3 - 2 * u);
    pts.push(new THREE.Vector2(radii[i] + (radii[i + 1] - radii[i]) * s, t * len));
  }
  pts.push(new THREE.Vector2(0, len + radii[n - 1] * 0.6));
  const g = new THREE.LatheGeometry(pts, radial);
  g.scale(1, 1, flatZ);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(_up, B.clone().sub(A).normalize()));
  g.translate(A.x, A.y, A.z);
  return g;
}

function spike(r, len, x, y, z, dir, radial = 7) {
  const g = new THREE.ConeGeometry(r, len, radial, 2);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(_up, new THREE.Vector3(...dir).normalize()));
  g.translate(x, y, z);
  return g;
}

/** A curved bone (rib, claw) along a quadratic arc. */
function arc(p0, p1, p2, r, segs = 10, radial = 5) {
  const c = new THREE.QuadraticBezierCurve3(new THREE.Vector3(...p0), new THREE.Vector3(...p1), new THREE.Vector3(...p2));
  return new THREE.TubeGeometry(c, segs, r, radial, false);
}

export function createGiantGeometry() {
  const G = builder();
  const skin = (geo, part, amp = 0.012, freq = 9) => G.add(organic(geo, amp * 2.2, freq), part, 1);

  // ── trunk ──
  // pelvis and a heavy, sagging lower belly
  skin(limb([0, 0.8, 0.0], [0, 1.08, 0.0], [0.17, 0.2, 0.21], 24, 0.8), 0);
  // a filthy loincloth of what were trousers
  G.add(organic(limb([0, 0.8, 0.02], [0, 0.97, 0.01], [0.2, 0.215, 0.21], 20, 0.85, 2), 0.02, 9), 0, 3);
  // barrel chest, broader than the shoulders, swelling into a hump
  skin(limb([0, 1.0, 0.0], [0, 1.53, -0.02], [0.2, 0.24, 0.27, 0.29, 0.27, 0.2], 32, 0.74), 1, 0.016, 7);
  skin(sph(0.2, 0, 1.39, -0.1, 1.25, 0.85, 0.75, 22, 14), 1, 0.02, 8);                 // hump
  skin(sph(0.21, 0, 1.02, 0.08, 1.0, 0.82, 0.85, 22, 14), 1, 0.014, 10);               // hanging gut
  G.add(organic(bx(0.03, 0.2, 0.05, 0.02, 1.02, 0.25, 0.15, 0, 0.12), 0.004, 20), 1, 4); // split in it
  // trapezius ridges up to a neck as wide as the head
  for (const s of [-1, 1]) skin(limb([s * 0.06, 1.5, -0.02], [s * 0.27, 1.43, -0.01], [0.1, 0.12, 0.09], 14, 0.9, 3), 1, 0.012, 10);
  // deltoids (the left one swollen)
  skin(sph(0.135, 0.29, 1.42, 0.0, 1.1, 1.0, 1.05, 18, 12), 1, 0.016, 9);
  skin(sph(0.105, -0.27, 1.43, 0.0, 1.0, 1.0, 1.0, 16, 12), 1, 0.012, 9);
  // pectorals
  for (const s of [-1, 1]) skin(sph(0.13, s * 0.11, 1.36, 0.1, 1.15, 0.75, 0.55, 16, 10), 1, 0.01, 10);

  // opened rib cage on the right side: a wet cavity with ribs across it
  G.add(organic(sph(0.11, -0.13, 1.22, 0.13, 0.9, 1.2, 0.5, 14, 10), 0.01, 12), 1, 4);
  for (let k = 0; k < 5; k++) {
    const y = 1.32 - k * 0.055, w = 0.1 - k * 0.006;
    G.add(arc([-0.05, y + 0.01, 0.2], [-0.13, y - 0.02, 0.24], [-0.13 - w, y - 0.045, 0.13], 0.011, 8, 5), 1, 9);
  }
  // spine breaking through the back: vertebra knobs and bone spikes
  for (let k = 0; k < 7; k++) {
    const y = 1.08 + k * 0.065, z = -0.17 - Math.sin(k / 6 * Math.PI) * 0.12;
    G.add(sph(0.032, 0, y, z, 1.2, 0.8, 1, 8, 6), 1, 9);
    if (k > 0 && k < 6) G.add(spike(0.022 + (k % 2) * 0.008, 0.09 + (k % 3) * 0.04, (k % 2 ? 0.02 : -0.02), y, z - 0.01, [k % 2 ? 0.25 : -0.25, 0.5, -1]), 1, 9);
  }
  // spikes out of the swollen shoulder
  G.add(spike(0.03, 0.16, 0.33, 1.5, -0.04, [0.6, 1, -0.3]), 1, 9);
  G.add(spike(0.022, 0.11, 0.38, 1.44, 0.02, [1, 0.5, 0.2]), 1, 9);
  // tumours clustered on the left side of the neck and chest
  for (const [r, x, y, z] of [[0.06, 0.15, 1.5, 0.07], [0.045, 0.21, 1.47, 0.1], [0.035, 0.12, 1.45, 0.15], [0.05, 0.2, 1.18, 0.16], [0.03, 0.25, 1.24, 0.13]]) {
    skin(sph(r, x, y, z, 1, 1, 1, 12, 9), 1, r * 0.25, 30);
  }
  // rebar driven through the chest, front to back
  G.add(seg(0.012, 0.012, [0.05, 1.12, 0.38], [-0.1, 1.42, -0.36], 6, 1, true), 1, 6);

  // ── head: small, sunk low between the shoulders, jaw hanging ──
  skin(sph(0.105, 0, 1.69, 0.07, 1.0, 1.05, 1.05, 18, 14), 2, 0.012, 14);
  skin(bx(0.19, 0.035, 0.07, 0, 1.745, 0.15, 0.25), 2, 0.008, 18);                 // heavy brow
  skin(limb([0, 1.6, 0.06], [0, 1.585, 0.2], [0.075, 0.08, 0.06], 12, 1.4, 2), 2, 0.008, 16); // jaw
  G.add(bx(0.09, 0.05, 0.03, 0, 1.63, 0.165, 0.3), 2, 4);                          // maw
  for (let k = 0; k < 6; k++) {
    const x = -0.04 + k * 0.016;
    G.add(spike(0.006, 0.026 + (k % 2) * 0.012, x, 1.605, 0.18 + (k % 3) * 0.004, [0, 1, 0.15], 4), 2, 9);
    G.add(spike(0.006, 0.022, x + 0.008, 1.66, 0.175, [0, -1, 0.1], 4), 2, 9);
  }
  for (const s of [-1, 1]) G.add(bx(0.03, 0.02, 0.012, s * 0.04, 1.715, 0.163), 2, 2);  // eyes, deep under the brow
  G.add(organic(sph(0.04, 0.06, 1.77, 0.02, 1.4, 0.6, 1.2, 10, 8), 0.006, 30), 2, 4);  // skull wound

  // ── arms: the left a swollen club, the right long and sinewy, both with claws ──
  for (const s of [-1, 1]) {
    const up = s > 0 ? 3 : 4, fo = s > 0 ? 9 : 10;
    const k = s > 0 ? 1.35 : 1.0;
    skin(limb([s * 0.27, 1.45, 0], [s * 0.27, 1.16, 0], [0.09 * k, 0.105 * k, 0.095 * k, 0.075 * k], 16, 0.95), up, 0.012 * k, 10);
    // forearm reaches down past the knee
    skin(limb([s * 0.27, 1.17, 0], [s * 0.29, 0.66, 0.06], [0.075 * k, 0.088 * k, 0.07 * k, 0.05 * k], 16, 0.9), fo, 0.012 * k, 10);
    // hand: a broad palm and long curled claws
    skin(sph(0.06 * k, s * 0.29, 0.62, 0.065, 0.9, 1.25, 0.6, 12, 10), fo, 0.008, 18);
    for (let f = 0; f < 4; f++) {
      const fx = s * (0.255 + f * 0.022 * k), fz = 0.08 + (f - 1.5) * 0.012;
      G.add(arc([fx, 0.58, fz], [fx + s * 0.01, 0.5, fz + 0.04], [fx, 0.45, fz + 0.09], 0.012 * k, 8, 5), fo, 1);
      G.add(spike(0.011 * k, 0.05, fx, 0.45, fz + 0.09, [0, -0.3, 1], 5), fo, 9);
    }
    // a thumb
    G.add(arc([s * 0.27, 0.62, 0.1], [s * 0.25, 0.58, 0.14], [s * 0.245, 0.54, 0.16], 0.014 * k, 6, 5), fo, 1);
  }
  // bone breaking out along the club arm's forearm
  for (let k = 0; k < 3; k++) G.add(spike(0.02, 0.08 + k * 0.03, 0.36, 1.05 - k * 0.12, -0.02 + k * 0.02, [1, 0.3, -0.4]), 9, 9);
  G.add(organic(sph(0.05, 0.36, 0.92, 0.06, 0.6, 1.4, 0.8, 10, 8), 0.006, 25), 9, 4);   // where it tore through

  // ── legs: thick, bowed, with splayed feet ──
  for (const s of [-1, 1]) {
    const th = s > 0 ? 5 : 7, sh = s > 0 ? 6 : 8;
    skin(limb([s * 0.12, 0.92, 0], [s * 0.13, 0.48, 0.02], [0.13, 0.14, 0.12, 0.095], 18, 0.95), th, 0.014, 9);
    // torn trouser leg with a ragged hem
    G.add(organic(limb([s * 0.12, 0.9, 0], [s * 0.125, 0.7, 0.01], [0.145, 0.15, 0.14], 16, 0.97, 2), 0.01, 12), th, 3);
    for (let k = 0; k < 10; k++) {
      const a0 = (k / 10) * Math.PI * 2, a1 = ((k + 1) / 10) * Math.PI * 2, drop = 0.03 + ((k * 7919) % 11) / 11 * 0.09;
      const r = 0.142, y = 0.7, cx = s * 0.125, cz = 0.01;
      const p = new THREE.BufferGeometry();
      const am = (a0 + a1) / 2;
      p.setAttribute('position', new THREE.Float32BufferAttribute([cx + Math.sin(a0) * r, y, cz + Math.cos(a0) * r, cx + Math.sin(a1) * r, y, cz + Math.cos(a1) * r,
        cx + Math.sin(am) * r * 1.03, y - drop, cz + Math.cos(am) * r * 1.03], 3));
      p.setAttribute('normal', new THREE.Float32BufferAttribute([Math.sin(am), 0, Math.cos(am), Math.sin(am), 0, Math.cos(am), Math.sin(am), 0, Math.cos(am)], 3));
      G.add(p, th, 3);
    }
    skin(sph(0.06, s * 0.13, 0.48, 0.08, 1, 0.9, 0.7, 10, 8), sh, 0.01, 14);       // knee
    skin(limb([s * 0.13, 0.48, 0.02], [s * 0.14, 0.08, 0.0], [0.1, 0.105, 0.08, 0.07], 16, 0.95), sh, 0.012, 10);
    // foot and toes
    skin(limb([s * 0.14, 0.06, -0.06], [s * 0.16, 0.05, 0.2], [0.06, 0.08, 0.075], 12, 0.6, 3), sh, 0.01, 14);
    for (let f = 0; f < 4; f++) {
      const fx = s * (0.12 + f * 0.025);
      G.add(organic(limb([fx, 0.035, 0.18], [fx + s * f * 0.006, 0.02, 0.26], [0.022, 0.02], 8, 0.8, 2), 0.003, 30), sh, 1);
    }
  }
  return G.build();
}

function createBoxyGeometry() {
  const G = builder();
  const b = (w, h, d, x, y, z, p, m, gear = 0) => G.add(bx(w, h, d, x, y, z), p, m, gear);
  b(0.34, 0.2, 0.22, 0, 0.96, 0, 0, 3);
  b(0.42, 0.42, 0.25, 0, 1.24, 0, 1, 0);
  b(0.1, 0.12, 0.1, 0, 1.52, 0, 2, 1);
  b(0.2, 0.24, 0.22, 0, 1.7, 0.012, 2, 1);
  b(0.2, 0.06, 0.04, 0, 1.73, 0.11, 2, 2);
  b(0.24, 0.12, 0.25, 0, 1.79, 0, 2, 5, 1);
  b(0.44, 0.36, 0.3, 0, 1.24, 0, 1, 5, 2);
  b(0.28, 0.36, 0.14, 0, 1.27, -0.19, 1, 6, 3);
  b(0.21, 0.12, 0.23, 0, 1.78, -0.01, 2, 8, 4);
  for (const s of [-1, 1]) {
    b(0.1, 0.3, 0.1, s * 0.232, 1.3, 0, s > 0 ? 3 : 4, 0);
    b(0.085, 0.3, 0.085, s * 0.243, 1.01, 0.01, s > 0 ? 9 : 10, 1);
    b(0.15, 0.42, 0.15, s * 0.1, 0.69, 0, s > 0 ? 5 : 7, 3);
    b(0.12, 0.4, 0.13, s * 0.1, 0.28, 0, s > 0 ? 6 : 8, 3);
    b(0.1, 0.08, 0.24, s * 0.1, 0.04, 0.04, s > 0 ? 6 : 8, 6);
  }
  return G.build();
}

// ── the pose (WebGPU / TSL): the procedural body (the giants, alive and dead) ────────
// aPart, aMat, aGear per vertex; per instance aAnim (phase, rate, type, lean), aState (flash,
// burn, attack, headless), aTint.
const zRX = (a) => { const c = cos(a), s = sin(a); return mat3(vec3(1, 0, 0), vec3(0, c, s), vec3(0, s.negate(), c)); };
const zRZ = (a) => { const c = cos(a), s = sin(a); return mat3(vec3(c, s, 0), vec3(s.negate(), c, 0), vec3(0, 0, 1)); };
const zRY = (a) => { const c = cos(a), s = sin(a); return mat3(vec3(c, 0, s.negate()), vec3(0, 1, 0), vec3(s, 0, c)); };

/** Pose position p and normal n (vars) in place. */
function zPose(p, n, uTime, corpse) {
  const aPart = attribute('aPart', 'float'), aGear = attribute('aGear', 'float');
  const aAnim = attribute('aAnim', 'vec4'), aState = attribute('aState', 'vec4');
  const rot = (m, piv) => { p.assign(m.mul(p.sub(piv)).add(piv)); n.assign(m.mul(n)); };
  const ip = int(aPart.add(0.5)).toVar();
  const seed = fract(aAnim.x.mul(0.15915)).toVar();
  const type = aAnim.z;
  // which outfit pieces this instance wears
  const brute0 = type.greaterThan(1.5).and(type.lessThan(2.5));
  const soldier = seed.lessThan(0.16).or(brute0);
  const s2 = fract(seed.mul(7.31));
  const g = aGear;
  const gearOn = select(g.lessThan(0.5), true,
    select(g.lessThan(1.5), soldier.and(brute0.not().or(s2.lessThan(0.6))),
      select(g.lessThan(2.5), soldier,
        select(g.lessThan(3.5), seed.lessThan(0.16).and(s2.lessThan(0.55)),
          select(g.lessThan(4.5), soldier.not().and(seed.greaterThan(0.45)).and(seed.lessThan(0.63)),
            select(g.lessThan(5.5), soldier.not().and(seed.greaterThan(0.3)).and(seed.lessThan(0.38)),
              soldier.not().and(seed.greaterThan(0.86)).and(seed.lessThan(0.93))))))));
  const isHead = ip.equal(2);
  const armL = ip.equal(3).or(ip.equal(9)), armR = ip.equal(4).or(ip.equal(10));
  const shL = vec3(0.225, SH, 0), shR = vec3(-0.225, SH, 0);
  const elL = vec3(0.24, EL, 0), elR = vec3(-0.24, EL, 0);
  const hipLp = vec3(0.1, HIP, 0), hipRp = vec3(-0.1, HIP, 0);
  const knLp = vec3(0.1, KNEE, 0.01), knRp = vec3(-0.1, KNEE, 0.01);
  If(gearOn.not(), () => { p.assign(vec3(0, 1.2, 0)); })
    .ElseIf(isHead.and(aState.w.greaterThan(0.5)), () => { p.assign(vec3(0, 1.5, 0)); })
    .Else(() => {
      if (corpse) {
        const s1 = sin(aAnim.x.mul(3.1)), s2b = sin(aAnim.x.mul(5.7)), s3 = sin(aAnim.x.mul(7.3));
        If(ip.equal(9), () => rot(zRX(float(-0.4).sub(abs(s3).mul(1.6))), elL));
        If(ip.equal(10), () => rot(zRX(float(-0.3).sub(abs(s1).mul(1.7))), elR));
        If(armL, () => rot(zRZ(s1.mul(0.9).add(1.1)).mul(zRX(s2b.mul(0.9))), shL))
          .ElseIf(armR, () => rot(zRZ(float(-1.1).sub(s2b.mul(0.9))).mul(zRX(s3.mul(0.9))), shR));
        If(ip.equal(6), () => rot(zRX(abs(s2b).mul(0.9)), knLp));
        If(ip.equal(8), () => rot(zRX(abs(s3).mul(0.7)), knRp));
        If(ip.equal(5).or(ip.equal(6)), () => rot(zRZ(s3.mul(0.2).add(0.22)).mul(zRX(s1.mul(0.35))), hipLp))
          .ElseIf(ip.equal(7).or(ip.equal(8)), () => rot(zRZ(float(-0.22).sub(s1.mul(0.2))).mul(zRX(s2b.mul(0.35))), hipRp))
          .ElseIf(isHead, () => rot(zRY(s1.mul(1.1)).mul(zRX(s2b.mul(0.35))), vec3(0, 1.58, 0)));
        return;
      }
      const t = uTime.mul(aAnim.y).add(aAnim.x).toVar();
      const sw = sin(t), cw = cos(t);
      const atk = aState.z;
      const burn = clamp(aState.y, 0, 1);
      const runner = type.greaterThan(0.5).and(type.lessThan(1.5));
      const brute = type.greaterThan(1.5).and(type.lessThan(2.5)).or(type.greaterThan(3.5)); // giants move like brutes
      const bloater = type.greaterThan(2.5).and(type.lessThan(3.5));
      // ── legs ──
      const amp = select(runner, float(0.95), select(brute, float(0.42), select(bloater, float(0.35), float(0.55)))).toVar();
      const limp = step(0.62, seed);
      const stomp = sin(uTime.mul(2.3).add(aAnim.x)).mul(0.5).add(0.5);
      const hipL = mix(sw.negate().mul(amp).mul(float(1).sub(limp.mul(0.55))), float(-0.25).sub(stomp.mul(0.1)), atk);
      const hipR = mix(sw.mul(amp), 0.2, atk);
      const kneeL = mix(max(0, cw).mul(amp).mul(1.5).mul(float(1).sub(limp.mul(0.5))).add(0.08), 0.5, atk);
      const kneeR = mix(max(0, cw.negate()).mul(amp).mul(1.5).add(0.08), stomp.mul(0.2).add(0.15), atk);
      If(ip.equal(6), () => rot(zRX(kneeL), knLp));
      If(ip.equal(8), () => rot(zRX(kneeR), knRp));
      If(ip.equal(5).or(ip.equal(6)), () => rot(zRX(hipL), hipLp));
      If(ip.equal(7).or(ip.equal(8)), () => rot(zRX(hipR), hipRp));
      // ── arms ──
      const aL = float(0).toVar(), aR = float(0).toVar(), sprL = float(0.12).toVar(), sprR = float(-0.12).toVar();
      const elbL = float(0.25).toVar(), elbR = float(0.25).toVar();
      If(runner, () => {
        aL.assign(sw.sub(0.3)); aR.assign(sw.negate().sub(0.3)); sprL.assign(0.15); sprR.assign(-0.15);
        elbL.assign(sw.mul(0.3).add(1.15)); elbR.assign(float(1.15).sub(sw.mul(0.3)));
      }).ElseIf(brute, () => {
        aL.assign(sw.mul(0.35).sub(0.25)); aR.assign(float(-0.25).sub(sw.mul(0.35))); sprL.assign(0.3); sprR.assign(-0.3); elbL.assign(0.45); elbR.assign(0.45);
      }).ElseIf(bloater, () => {
        aL.assign(sw.mul(0.15).sub(0.5)); aR.assign(float(-0.5).sub(sw.mul(0.15))); sprL.assign(0.7); sprR.assign(-0.7); elbL.assign(0.6); elbR.assign(0.6);
      }).Else(() => {
        aL.assign(sin(t.add(1.3)).mul(0.14).sub(1.3));
        aR.assign(sin(t.add(2.2)).mul(0.14).sub(1.25));
        elbL.assign(sin(t.mul(0.7).add(1)).mul(0.15).add(0.2)); elbR.assign(sin(t.mul(0.8)).mul(0.15).add(0.25));
        If(seed.greaterThan(0.78), () => { aR.assign(sw.mul(0.15).add(0.1)); sprR.assign(-0.05); elbR.assign(0.05); });
        If(seed.lessThan(0.12), () => { aL.assign(sw.mul(0.2).sub(0.6)); elbL.assign(0.9); });
      });
      const clawT = uTime.mul(7.5).add(aAnim.x);
      aL.assign(mix(aL, sin(clawT).mul(0.5).sub(2.45), atk));
      aR.assign(mix(aR, sin(clawT.add(2)).mul(0.5).sub(2.45), atk));
      elbL.assign(mix(elbL, sin(clawT.add(0.8)).mul(0.5).add(0.5), atk));
      elbR.assign(mix(elbR, sin(clawT.add(2.8)).mul(0.5).add(0.5), atk));
      sprL.assign(mix(sprL, 0.25, atk));
      sprR.assign(mix(sprR, -0.25, atk));
      aL.assign(mix(aL, sin(uTime.mul(13).add(aAnim.x)).mul(1.7).sub(1.3), burn.mul(0.85)));
      aR.assign(mix(aR, sin(uTime.mul(11).add(aAnim.x).add(1.7)).mul(1.7).sub(1.3), burn.mul(0.85)));
      elbL.assign(mix(elbL, sin(uTime.mul(15).add(aAnim.x)).mul(0.6).add(1.2), burn.mul(0.85)));
      elbR.assign(mix(elbR, sin(uTime.mul(12).add(aAnim.x)).mul(0.6).add(1.2), burn.mul(0.85)));
      If(ip.equal(9), () => rot(zRX(elbL.negate()), elL));
      If(ip.equal(10), () => rot(zRX(elbR.negate()), elR));
      If(armL, () => rot(zRX(aL).mul(zRZ(sprL)), shL));
      If(armR, () => rot(zRX(aR).mul(zRZ(sprR)), shR));
      // bloater belly pulses
      If(bloater.and(ip.equal(1)), () => {
        const b = sin(uTime.mul(3).add(aAnim.x)).mul(0.1).add(1);
        const belly = smoothstep(1.42, 1.15, p.y);
        p.x.mulAssign(mix(1, b.mul(1.12), belly));
        p.z.assign(p.z.mul(mix(1, b.mul(1.25), belly)).add(belly.mul(0.03)));
      });
      // ── head ──
      If(isHead, () => {
        const tilt = seed.sub(0.5).mul(0.9).add(sin(t.mul(0.5)).mul(0.08));
        rot(zRZ(tilt).mul(zRX(float(-0.15).add(atk.mul(-0.5)).add(sin(t.mul(2)).mul(0.05)))), vec3(0, 1.58, 0));
      });
      // ── upper body lean & sway ──
      If(ip.greaterThanEqual(1).and(ip.lessThanEqual(4)).or(ip.greaterThanEqual(9)), () => {
        const lean = aAnim.w.add(cos(t.mul(2)).mul(0.05)).add(atk.mul(0.2)).add(burn.mul(sin(uTime.mul(9).add(aAnim.x))).mul(0.2));
        const sway = sin(t).mul(select(brute, float(0.1), float(0.07))).add(seed.sub(0.5).mul(0.12));
        rot(zRX(lean).mul(zRZ(sway)), vec3(0, 0.95, 0));
      });
      p.y.addAssign(select(runner, float(0.06), float(0.03)).mul(cos(t.mul(2))).mul(float(1).sub(atk)));
    });
}

const zh3 = Fn(([p0]) => {
  const p = fract(p0.mul(0.3183099).add(0.1)).mul(17).toVar();
  return fract(p.x.mul(p.y).mul(p.z).mul(p.x.add(p.y).add(p.z)));
}).setLayout({ name: 'zh3', type: 'float', inputs: [{ name: 'p0', type: 'vec3' }] });
const zn3 = Fn(([x]) => {
  const i = floor(x), f0 = fract(x);
  const f = f0.mul(f0).mul(f0.mul(-2).add(3));
  const h = (o) => zh3(i.add(vec3(...o)));
  return mix(mix(mix(h([0, 0, 0]), h([1, 0, 0]), f.x), mix(h([0, 1, 0]), h([1, 1, 0]), f.x), f.y),
    mix(mix(h([0, 0, 1]), h([1, 0, 1]), f.x), mix(h([0, 1, 1]), h([1, 1, 1]), f.x), f.y), f.z);
}).setLayout({ name: 'zn3', type: 'float', inputs: [{ name: 'x', type: 'vec3' }] });

/** The procedural body's material (the giants): posed in the vertex stage, painted per pixel. */
export function createZombieMaterial(uniforms, { corpse = false } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0.0 });
  const uCorpse = corpse ? 1 : 0;
  const aMat = attribute('aMat', 'float'), aPart = attribute('aPart', 'float');
  const aAnim = attribute('aAnim', 'vec4'), aState = attribute('aState', 'vec4'), aTint = attribute('aTint', 'vec3');
  const vL = varyingProperty('vec3', 'vZL');
  mat.positionNode = Fn(() => {
    const p = vec3(attribute('position', 'vec3')).toVar();
    const n = vec3(attribute('normal', 'vec3')).toVar();
    vL.assign(p);
    zPose(p, n, uniforms.uTime, corpse);
    normalLocal.assign(n);
    return p;
  })();
  // everything the colour, roughness and glow share
  const paint = () => {
    const seed = fract(aAnim.x.mul(0.15915));
    const type = aAnim.z;
    const zEyeF = step(1.5, aMat).mul(step(aMat, 2.5));
    const zp = vL.add(seed.mul(13));
    const zN1 = zn3(zp.mul(9)), zN2 = zn3(zp.mul(23)), zN3 = zn3(zp.mul(4));
    return { seed, type, zEyeF, zp, zN1, zN2, zN3 };
  };
  mat.colorNode = Fn(() => {
    If(aState.w.lessThan(-0.002), () => {
      If(fract(sin(dot(floor(screenCoordinate.xy), vec2(12.9898, 78.233))).mul(43758.5453)).lessThan(aState.w.negate()), () => { Discard(); });
    });
    const P = paint();
    const { seed, type, zEyeF, zp, zN1, zN2, zN3 } = P;
    const zGore = float(0).toVar();
    const skin = mix(vec3(0.19, 0.2, 0.16), vec3(0.25, 0.22, 0.2), fract(seed.mul(3.7))).mul(zN1.mul(0.5).add(0.7)).toVar();
    skin.assign(mix(skin, vec3(0.16, 0.13, 0.15), smoothstep(0.62, 0.8, zN3).mul(0.6))); // bruising
    If(type.greaterThan(3.5), () => {
      // the giant's hide: grey-green, mottled with necrotic patches and dark veins
      skin.assign(vec3(0.085, 0.09, 0.075).mul(zN1.mul(0.6).add(0.6)));
      skin.assign(mix(skin, vec3(0.1, 0.07, 0.08), smoothstep(0.55, 0.78, zN3).mul(0.75)));
      const vein = float(1).sub(smoothstep(0, 0.035, abs(zn3(zp.mul(5)).sub(0.5))));
      skin.assign(mix(skin, vec3(0.09, 0.02, 0.03), vein.mul(0.7)));
      skin.assign(mix(skin, vec3(0.2, 0.03, 0.02), smoothstep(0.78, 0.9, zn3(zp.mul(11))).mul(0.8))); // raw sores
    });
    const sleeveLong = step(0.5, fract(seed.mul(5.3)));
    const mid = float(aMat).toVar();
    If(mid.greaterThan(0.5).and(mid.lessThan(1.5)).and(aPart.greaterThan(8.5)).and(sleeveLong.greaterThan(0.5)).and(vL.y.greaterThan(0.95)), () => { mid.assign(0); });
    const zc = vec3(0).toVar();
    If(mid.lessThan(0.5), () => {
      zc.assign(aTint.mul(zN2.mul(0.35).add(0.75)).mul(zN1.mul(0.3).add(0.85)));
      // tears reveal skin, stains spread from the mouth down the chest
      const tear = smoothstep(0.7, 0.76, zn3(zp.mul(13))).mul(step(0.3, fract(seed.mul(2.1))));
      zc.assign(mix(zc, skin.mul(0.8), tear));
      const stain = smoothstep(0.45, 0.75, zN3.add(select(vL.z.greaterThan(0.05), float(0.25), float(-0.2))).add(vL.y.sub(1.2).mul(0.6)));
      zGore.assign(max(zGore, stain.mul(0.8)));
      zc.mulAssign(mix(1, 0.55, smoothstep(1.2, 0.95, vL.y)));
    }).ElseIf(mid.lessThan(1.5), () => {
      zc.assign(skin);
      If(vL.y.greaterThan(1.6).and(vL.y.lessThan(1.67)).and(vL.z.greaterThan(0.04)), () => { zGore.assign(max(zGore, 0.75)); }); // chin
      If(aPart.greaterThan(8.5).and(vL.y.lessThan(0.95)), () => { zGore.assign(max(zGore, smoothstep(0.35, 0.7, zN1).mul(0.9))); }); // hands
    }).ElseIf(mid.lessThan(2.5), () => { zc.assign(vec3(0.9, 0.85, 0.7)); })
      .ElseIf(mid.lessThan(3.5), () => {
        zc.assign(aTint.mul(vec3(0.5, 0.55, 0.6)).mul(zN2.mul(0.35).add(0.8)));
        zc.assign(mix(zc, vec3(0.09, 0.07, 0.05), smoothstep(0.55, 0.2, vL.y).mul(zN1.mul(0.4).add(0.6)))); // mud
        zGore.assign(max(zGore, smoothstep(0.7, 0.85, zN3).mul(0.7)));
      })
      .ElseIf(mid.lessThan(4.5), () => { zc.assign(select(type.greaterThan(2.5).and(type.lessThan(3.5)), vec3(0.25, 0.32, 0.08), vec3(0.2, 0.015, 0.012))); })
      .ElseIf(mid.lessThan(5.5), () => { zc.assign(vec3(0.17, 0.19, 0.12).mul(zN2.mul(0.4).add(0.75)).mul(zN1.mul(0.3).add(0.8))); })
      .ElseIf(mid.lessThan(6.5), () => { zc.assign(vec3(0.07, 0.06, 0.05).mul(zN2.mul(0.4).add(0.8))); })
      .ElseIf(mid.lessThan(7.5), () => {
        zc.assign(vec3(0.55, 0.62, 0.08).mul(zN2.mul(0.3).add(0.7)));
        const band = step(abs(vL.y.sub(1.16)), 0.025).add(step(abs(vL.y.sub(1.3)), 0.025));
        zc.assign(mix(zc, vec3(0.7), clamp(band, 0, 1)));
        zGore.assign(max(zGore, smoothstep(0.5, 0.8, zN3).mul(0.6)));
      })
      .ElseIf(mid.lessThan(8.5), () => { zc.assign(mix(vec3(0.05, 0.035, 0.025), vec3(0.32, 0.24, 0.12), step(0.8, fract(seed.mul(9.1)))).mul(zN2.mul(0.5).add(0.7))); })
      .Else(() => {
        // bone: dirty ivory, darker and bloodied at the root
        zc.assign(vec3(0.42, 0.38, 0.3).mul(zN2.mul(0.45).add(0.7)));
        zGore.assign(max(zGore, smoothstep(0.55, 0.85, zN1).mul(0.55)));
      });
    zc.assign(mix(zc, vec3(0.13, 0.01, 0.008), zGore.mul(float(1).sub(zEyeF))));
    // cavity darkening: armpits, crotch, under the chin
    const zAO = smoothstep(0, 0.5, vL.y).mul(0.35).add(0.65)
      .mul(float(1).sub(smoothstep(0.17, 0, abs(vL.x)).mul(smoothstep(1.0, 0.85, vL.y)).mul(step(0.5, vL.y)).mul(0.25)));
    zc.mulAssign(zAO);
    zc.assign(mix(zc, vec3(0.025, 0.02, 0.018), clamp(aState.y.mul(1.2).add(corpse ? aState.y : 0), 0, 1)));
    S.gore = zGore;
    return vec4(zc, 1);
  })();
  const S = {};
  mat.roughnessNode = Fn(() => {
    const P = paint();
    const r = float(0.82).toVar();
    r.assign(mix(r, 0.28, max(step(3.5, aMat).mul(step(aMat, 4.5)), (S.gore || float(0)).mul(0.8))));
    r.assign(mix(r, 0.55, step(5.5, aMat).mul(step(aMat, 6.5))));
    r.assign(mix(r, 0.45, step(8.5, aMat)));
    // leathery, matte: the searchlights live on it
    If(P.type.greaterThan(3.5).and(aMat.greaterThan(0.5)).and(aMat.lessThan(1.5)), () => { r.assign(P.zN2.mul(0.2).add(0.78)); });
    return r;
  })();
  mat.emissiveNode = Fn(() => {
    const P = paint();
    const e = vec3(1.0, 0.82, 0.5).mul(P.zEyeF).mul(uniforms.uEyeGlow).mul(1 - uCorpse).toVar();
    const rim = pow(float(1).sub(clamp(dot(normalView, positionViewDirection), 0, 1)), 3);
    e.addAssign(uniforms.uRim.mul(rim).mul(1 - uCorpse * 0.7));
    // burning (living only): a steady smoulder in patches of the charring skin
    if (!corpse) e.addAssign(vec3(0.75, 0.24, 0.04).mul(clamp(aState.y, 0, 1)).mul(smoothstep(0.5, 0.85, P.zN1)));
    If(P.type.greaterThan(2.5).and(P.type.lessThan(3.5)), () => {
      e.addAssign(vec3(0.3, 0.6, 0.05).mul(step(3.5, aMat).mul(step(aMat, 4.5))).mul(sin(uniforms.uTime.mul(4).add(P.seed.mul(9))).mul(0.4).add(0.6)));
    });
    return e;
  })();
  return mat;
}

/** Under WebGPU, shadows draw with the material's own positionNode. */
export function createZombieDepthMaterial() { return null; }

// ── Glowing eyes that stay visible as pin-pricks at any distance ─────────────
/** Eye billboards for every living zombie (own instance buffers, all LODs). */
export function createEyeMesh(cap, uniforms, fogU, aAnimA, aStateA, aEyeA) {
  const geo = new THREE.BufferGeometry();
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
  geo.setAttribute('aAnim', aAnimA);
  geo.setAttribute('aState', aStateA);
  geo.setAttribute('aEye', aEyeA);
  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true, depthWrite: false, fog: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, cap);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const IM = instancedBufferAttribute(mesh.instanceMatrix, 'mat4');
  const aAnim = attribute('aAnim', 'vec4'), aState = attribute('aState', 'vec4'), aEye = attribute('aEye', 'vec3');
  const uColor = uniform(new THREE.Color(2.4, 1.9, 1.1));
  const vUv = varyingProperty('vec2', 'vEyeUv'), vA = varyingProperty('float', 'vEyeA');
  const corner = attribute('position', 'vec3');
  mat.vertexNode = Fn(() => {
    const world = modelWorldMatrix.mul(IM.mul(vec4(aEye, 1)));
    const fwd = normalize(IM.mul(vec4(0, 0, 1, 0)).xyz);
    const mv = cameraViewMatrix.mul(world).toVar();
    const dist = mv.z.negate();
    const toCam = normalize(cameraPosition.sub(world.xyz));
    const facing = smoothstep(-0.05, 0.45, dot(fwd, toCam));
    const scale = length(IM.mul(vec4(1, 0, 0, 0)).xyz);
    const worldSize = scale.mul(0.13);
    const minSize = uniforms.uPixel.mul(dist).mul(2.6);
    const size = max(worldSize, minSize);
    mv.addAssign(vec4(corner.xy.mul(size).mul(vec2(1.7, 0.7)), 0, 0));
    vUv.assign(corner.xy.mul(2));
    // eyes cut through ordinary haze; in a fog bank they still show, dim and smeared
    const fogA = lbFog(world.xyz, cameraPosition, fogU.lbFogColor, fogU.lbTime, fogU.lbDawn, float(1)).a;
    const fog = mix(fogA.mul(0.55), fogA.mul(0.4).add(0.45), clamp(fogU.lbDawn.sub(2), 0, 1));
    vA.assign(facing.mul(float(1).sub(step(0.5, aState.w))).mul(min(aState.w, 0).add(1)).mul(float(1).sub(fog)).mul(pow(worldSize.div(size), 0.55))
      .mul(smoothstep(12, 30, dist)).mul(uniforms.uEyeGlowBillboard).mul(float(1).sub(clamp(aState.y, 0, 1)))
      .mul(select(aAnim.z.greaterThan(3.5), smoothstep(90, 150, dist), float(1)))); // a giant's own eyes read up close
    return cameraProjectionMatrix.mul(mv);
  })();
  mat.colorNode = Fn(() => {
    const p = vUv;
    const d1 = length(p.sub(vec2(-0.42, 0)).mul(vec2(1, 1.3))), d2 = length(p.sub(vec2(0.42, 0)).mul(vec2(1, 1.3)));
    const g = exp(d1.mul(d1).mul(-14)).add(exp(d2.mul(d2).mul(-14))).add(exp(p.x.mul(p.x).mul(1.5).add(p.y.mul(p.y).mul(6)).negate()).mul(0.12));
    return vec4(uColor.mul(g).mul(vA), 1);
  })();
  mesh.frustumCulled = false;
  mesh.renderOrder = 13;
  return mesh;
}
