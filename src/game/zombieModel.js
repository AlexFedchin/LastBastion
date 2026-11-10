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
import { FOG_CUSTOM_GLSL } from '../render/atmosphere.js';

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

const POSE_HEADER = /* glsl */`
uniform float uTime;
uniform float uCorpse;
attribute float aPart;
attribute float aMat;
attribute float aGear;
attribute vec4 aAnim;   // phase, rate, type, lean
attribute vec4 aState;  // flash, burn, attack, headless
attribute vec3 aTint;
mat3 zRX(float a){ float c = cos(a), s = sin(a); return mat3(1.0,0.0,0.0, 0.0,c,s, 0.0,-s,c); }
mat3 zRZ(float a){ float c = cos(a), s = sin(a); return mat3(c,s,0.0, -s,c,0.0, 0.0,0.0,1.0); }
mat3 zRY(float a){ float c = cos(a), s = sin(a); return mat3(c,0.0,-s, 0.0,1.0,0.0, s,0.0,c); }
void zRot(inout vec3 p, inout vec3 n, mat3 m, vec3 piv){ p = m * (p - piv) + piv; n = m * n; }

// which outfit pieces this instance wears
bool zGearOn(float gear, float seed, float type){
  if (gear < 0.5) return true;
  bool brute = type > 1.5 && type < 2.5;
  bool soldier = seed < 0.16 || brute;
  float s2 = fract(seed * 7.31);
  if (gear < 1.5) return soldier && (!brute || s2 < 0.6);
  if (gear < 2.5) return soldier;
  if (gear < 3.5) return seed < 0.16 && s2 < 0.55;
  if (gear < 4.5) return !soldier && seed > 0.45 && seed < 0.63;
  if (gear < 5.5) return !soldier && seed > 0.3 && seed < 0.38;
  return !soldier && seed > 0.86 && seed < 0.93;
}

void zPose(inout vec3 p, inout vec3 n) {
  int ip = int(aPart + 0.5);
  float seed = fract(aAnim.x * 0.15915);
  float type = aAnim.z;
  if (!zGearOn(aGear, seed, type)) { p = vec3(0.0, 1.2, 0.0); return; }
  bool isHead = ip == 2;
  if (isHead && aState.w > 0.5) { p = vec3(0.0, 1.5, 0.0); return; }
  bool armL = ip == 3 || ip == 9, armR = ip == 4 || ip == 10;
  vec3 shL = vec3(0.225, ${SH.toFixed(3)}, 0.0), shR = vec3(-0.225, ${SH.toFixed(3)}, 0.0);
  vec3 elL = vec3(0.24, ${EL.toFixed(3)}, 0.0), elR = vec3(-0.24, ${EL.toFixed(3)}, 0.0);
  vec3 hipLp = vec3(0.1, ${HIP.toFixed(3)}, 0.0), hipRp = vec3(-0.1, ${HIP.toFixed(3)}, 0.0);
  vec3 knLp = vec3(0.1, ${KNEE.toFixed(3)}, 0.01), knRp = vec3(-0.1, ${KNEE.toFixed(3)}, 0.01);

  if (uCorpse > 0.5) {
    float s1 = sin(aAnim.x * 3.1), s2 = sin(aAnim.x * 5.7), s3 = sin(aAnim.x * 7.3);
    if (ip == 9) zRot(p, n, zRX(-0.4 - abs(s3) * 1.6), elL);
    if (ip == 10) zRot(p, n, zRX(-0.3 - abs(s1) * 1.7), elR);
    if (armL) zRot(p, n, zRZ(1.1 + s1 * 0.9) * zRX(s2 * 0.9), shL);
    else if (armR) zRot(p, n, zRZ(-1.1 - s2 * 0.9) * zRX(s3 * 0.9), shR);
    if (ip == 6) zRot(p, n, zRX(abs(s2) * 0.9), knLp);
    if (ip == 8) zRot(p, n, zRX(abs(s3) * 0.7), knRp);
    if (ip == 5 || ip == 6) zRot(p, n, zRZ(0.22 + s3 * 0.2) * zRX(s1 * 0.35), hipLp);
    else if (ip == 7 || ip == 8) zRot(p, n, zRZ(-0.22 - s1 * 0.2) * zRX(s2 * 0.35), hipRp);
    else if (isHead) zRot(p, n, zRY(s1 * 1.1) * zRX(0.35 * s2), vec3(0.0, 1.58, 0.0));
    return;
  }

  float t = uTime * aAnim.y + aAnim.x;
  float sw = sin(t), cw = cos(t);
  float atk = aState.z;
  float burn = clamp(aState.y, 0.0, 1.0);
  bool runner = type > 0.5 && type < 1.5;
  bool brute = (type > 1.5 && type < 2.5) || type > 3.5; // giants move like brutes
  bool bloater = type > 2.5 && type < 3.5;

  // ── legs ──
  float amp = runner ? 0.95 : (brute ? 0.42 : (bloater ? 0.35 : 0.55));
  float limp = step(0.62, seed);
  float hipL = -sw * amp * (1.0 - limp * 0.55);
  float hipR = sw * amp;
  float kneeL = max(0.0, cw) * amp * 1.5 * (1.0 - limp * 0.5) + 0.08;
  float kneeR = max(0.0, -cw) * amp * 1.5 + 0.08;
  float stomp = 0.5 + 0.5 * sin(uTime * 2.3 + aAnim.x);
  hipL = mix(hipL, -0.25 - 0.1 * stomp, atk);
  hipR = mix(hipR, 0.2, atk);
  kneeL = mix(kneeL, 0.5, atk);
  kneeR = mix(kneeR, 0.15 + 0.2 * stomp, atk);
  if (ip == 6) zRot(p, n, zRX(kneeL), knLp);
  if (ip == 8) zRot(p, n, zRX(kneeR), knRp);
  if (ip == 5 || ip == 6) zRot(p, n, zRX(hipL), hipLp);
  if (ip == 7 || ip == 8) zRot(p, n, zRX(hipR), hipRp);

  // ── arms ──
  float aL, aR, sprL = 0.12, sprR = -0.12, elbL = 0.25, elbR = 0.25;
  if (runner) {
    aL = sw * 1.0 - 0.3; aR = -sw * 1.0 - 0.3; sprL = 0.15; sprR = -0.15;
    elbL = 1.15 + sw * 0.3; elbR = 1.15 - sw * 0.3;
  } else if (brute) {
    aL = -0.25 + sw * 0.35; aR = -0.25 - sw * 0.35; sprL = 0.3; sprR = -0.3; elbL = 0.45; elbR = 0.45;
  } else if (bloater) {
    aL = -0.5 + sw * 0.15; aR = -0.5 - sw * 0.15; sprL = 0.7; sprR = -0.7; elbL = 0.6; elbR = 0.6;
  } else {
    aL = -1.3 + sin(t + 1.3) * 0.14;
    aR = -1.25 + sin(t + 2.2) * 0.14;
    elbL = 0.2 + 0.15 * sin(t * 0.7 + 1.0); elbR = 0.25 + 0.15 * sin(t * 0.8);
    if (seed > 0.78) { aR = 0.1 + sw * 0.15; sprR = -0.05; elbR = 0.05; }
    if (seed < 0.12) { aL = -0.6 + sw * 0.2; elbL = 0.9; }
  }
  float clawT = uTime * 7.5 + aAnim.x;
  aL = mix(aL, -2.45 + sin(clawT) * 0.5, atk);
  aR = mix(aR, -2.45 + sin(clawT + 2.0) * 0.5, atk);
  elbL = mix(elbL, 0.5 + 0.5 * sin(clawT + 0.8), atk);
  elbR = mix(elbR, 0.5 + 0.5 * sin(clawT + 2.8), atk);
  sprL = mix(sprL, 0.25, atk);
  sprR = mix(sprR, -0.25, atk);
  aL = mix(aL, sin(uTime * 13.0 + aAnim.x) * 1.7 - 1.3, burn * 0.85);
  aR = mix(aR, sin(uTime * 11.0 + aAnim.x + 1.7) * 1.7 - 1.3, burn * 0.85);
  elbL = mix(elbL, 1.2 + sin(uTime * 15.0 + aAnim.x) * 0.6, burn * 0.85);
  elbR = mix(elbR, 1.2 + sin(uTime * 12.0 + aAnim.x) * 0.6, burn * 0.85);
  if (ip == 9) zRot(p, n, zRX(-elbL), elL);
  if (ip == 10) zRot(p, n, zRX(-elbR), elR);
  if (armL) zRot(p, n, zRX(aL) * zRZ(sprL), shL);
  if (armR) zRot(p, n, zRX(aR) * zRZ(sprR), shR);

  // bloater belly pulses
  if (bloater && ip == 1) {
    float b = 1.0 + 0.1 * sin(uTime * 3.0 + aAnim.x);
    float belly = smoothstep(1.42, 1.15, p.y);
    p.x *= mix(1.0, b * 1.12, belly); p.z = p.z * mix(1.0, b * 1.25, belly) + 0.03 * belly;
  }

  // ── head ──
  if (isHead) {
    float tilt = (seed - 0.5) * 0.9 + sin(t * 0.5) * 0.08;
    zRot(p, n, zRZ(tilt) * zRX(-0.15 + atk * -0.5 + sin(t * 2.0) * 0.05), vec3(0.0, 1.58, 0.0));
  }

  // ── upper body lean & sway ──
  if (ip >= 1 && ip <= 4 || ip >= 9) {
    float lean = aAnim.w + 0.05 * cos(2.0 * t) + atk * 0.2 + burn * sin(uTime * 9.0 + aAnim.x) * 0.2;
    float sway = sin(t) * (brute ? 0.1 : 0.07) + (seed - 0.5) * 0.12;
    zRot(p, n, zRX(lean) * zRZ(sway), vec3(0.0, 0.95, 0.0));
  }
  p.y += (runner ? 0.06 : 0.03) * cos(2.0 * t) * (1.0 - atk);
}
`;

/** Patch a MeshStandardMaterial into the animated zombie material. */
export function createZombieMaterial(uniforms, { corpse = false } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0.0 });
  const local = { uCorpse: { value: corpse ? 1 : 0 } };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uEyeGlow = uniforms.uEyeGlow;
    shader.uniforms.uRim = uniforms.uRim;
    shader.uniforms.uCorpse = local.uCorpse;
    shader.vertexShader = POSE_HEADER + `
      varying float vZMat; varying vec3 vZTint; varying vec4 vZState; varying float vZType; varying float vZSeed; varying vec3 vZL; varying float vZPart;
    ` + shader.vertexShader
      .replace('#include <beginnormal_vertex>', `
        vec3 zPP = position; vec3 objectNormal = normal; zPose(zPP, objectNormal);
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3( tangent.xyz );
        #endif`)
      .replace('#include <begin_vertex>', `
        // posed once above (with the normal); reuse it instead of skinning the vertex twice
        vec3 transformed = zPP;
        vZMat = aMat; vZTint = aTint; vZState = aState; vZType = aAnim.z; vZSeed = fract(aAnim.x * 0.15915); vZL = position; vZPart = aPart;`);

    shader.fragmentShader = `
      uniform float uTime; uniform float uEyeGlow; uniform float uCorpse; uniform vec3 uRim;
      varying float vZMat; varying vec3 vZTint; varying vec4 vZState; varying float vZType; varying float vZSeed; varying vec3 vZL; varying float vZPart;
      float zh3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float zn3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(zh3(i), zh3(i + vec3(1,0,0)), f.x), mix(zh3(i + vec3(0,1,0)), zh3(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(zh3(i + vec3(0,0,1)), zh3(i + vec3(1,0,1)), f.x), mix(zh3(i + vec3(0,1,1)), zh3(i + vec3(1,1,1)), f.x), f.y), f.z); }
    ` + shader.fragmentShader
      .replace('#include <color_fragment>', `
        if (vZState.w < -0.002) {
          float zd = fract(sin(dot(floor(gl_FragCoord.xy), vec2(12.9898, 78.233))) * 43758.5453);
          if (zd < -vZState.w) discard;
        }
        vec3 zc;
        float zEyeF = step(1.5, vZMat) * step(vZMat, 2.5);
        float zGore = 0.0;
        vec3 zp = vZL + vZSeed * 13.0;
        float zN1 = zn3(zp * 9.0), zN2 = zn3(zp * 23.0), zN3 = zn3(zp * 4.0);
        vec3 skin = mix(vec3(0.19, 0.2, 0.16), vec3(0.25, 0.22, 0.2), fract(vZSeed * 3.7)) * (0.7 + 0.5 * zN1);
        skin = mix(skin, vec3(0.16, 0.13, 0.15), smoothstep(0.62, 0.8, zN3) * 0.6);  // bruising
        float sleeveLong = step(0.5, fract(vZSeed * 5.3));
        float mid = vZMat;
        if (mid > 0.5 && mid < 1.5 && (vZPart > 8.5) && sleeveLong > 0.5 && vZL.y > 0.95) mid = 0.0;
        if (mid < 0.5) {
          zc = vZTint * (0.75 + 0.35 * zN2) * (0.85 + 0.3 * zN1);
          // tears reveal skin, stains spread from the mouth down the chest
          float tear = smoothstep(0.7, 0.76, zn3(zp * 13.0)) * step(0.3, fract(vZSeed * 2.1));
          zc = mix(zc, skin * 0.8, tear);
          float stain = smoothstep(0.45, 0.75, zN3 + (vZL.z > 0.05 ? 0.25 : -0.2) + (vZL.y - 1.2) * 0.6);
          zGore = max(zGore, stain * 0.8);
          zc *= mix(1.0, 0.55, smoothstep(1.2, 0.95, vZL.y));
        } else if (mid < 1.5) {
          zc = skin;
          if (vZL.y > 1.6 && vZL.y < 1.67 && vZL.z > 0.04) zGore = max(zGore, 0.75);   // chin
          if (vZPart > 8.5 && vZL.y < 0.95) zGore = max(zGore, smoothstep(0.35, 0.7, zN1) * 0.9); // hands
        } else if (mid < 2.5) zc = vec3(0.9, 0.85, 0.7);
        else if (mid < 3.5) {
          zc = vZTint * vec3(0.5, 0.55, 0.6) * (0.8 + 0.35 * zN2);
          zc = mix(zc, vec3(0.09, 0.07, 0.05), smoothstep(0.55, 0.2, vZL.y) * (0.6 + 0.4 * zN1)); // mud
          zGore = max(zGore, smoothstep(0.7, 0.85, zN3) * 0.7);
        } else if (mid < 4.5) { zc = (vZType > 2.5 && vZType < 3.5) ? vec3(0.25, 0.32, 0.08) : vec3(0.2, 0.015, 0.012); }
        else if (mid < 5.5) zc = vec3(0.17, 0.19, 0.12) * (0.75 + 0.4 * zN2) * (0.8 + 0.3 * zN1);
        else if (mid < 6.5) zc = vec3(0.07, 0.06, 0.05) * (0.8 + 0.4 * zN2);
        else if (mid < 7.5) {
          zc = vec3(0.55, 0.62, 0.08) * (0.7 + 0.3 * zN2);
          float band = step(abs(vZL.y - 1.16), 0.025) + step(abs(vZL.y - 1.3), 0.025);
          zc = mix(zc, vec3(0.7), clamp(band, 0.0, 1.0));
          zGore = max(zGore, smoothstep(0.5, 0.8, zN3) * 0.6);
        } else zc = mix(vec3(0.05, 0.035, 0.025), vec3(0.32, 0.24, 0.12), step(0.8, fract(vZSeed * 9.1))) * (0.7 + 0.5 * zN2);
        zc = mix(zc, vec3(0.13, 0.01, 0.008), zGore * (1.0 - zEyeF));
        // cavity darkening: armpits, crotch, under the chin
        float zAO = 0.65 + 0.35 * smoothstep(0.0, 0.5, vZL.y);
        zAO *= 1.0 - 0.25 * smoothstep(0.17, 0.0, abs(vZL.x)) * smoothstep(1.0, 0.85, vZL.y) * step(0.5, vZL.y);
        zc *= zAO;
        zc = mix(zc, vec3(0.025, 0.02, 0.018), clamp(vZState.y * 1.2 + (uCorpse > 0.5 ? vZState.y : 0.0), 0.0, 1.0));
        diffuseColor.rgb *= zc;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.28, max(step(3.5, vZMat) * step(vZMat, 4.5), zGore * 0.8));
        roughnessFactor = mix(roughnessFactor, 0.55, step(5.5, vZMat) * step(vZMat, 6.5));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += zEyeF * vec3(1.0, 0.82, 0.5) * uEyeGlow * (1.0 - uCorpse);
        float zRim = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
        totalEmissiveRadiance += zRim * uRim * (1.0 - uCorpse * 0.7);
        totalEmissiveRadiance += vZState.x * vec3(1.6, 0.25, 0.15) * (1.0 - zEyeF);
        float zFlick = 0.55 + 0.45 * sin(uTime * 31.0 + vZSeed * 40.0);
        totalEmissiveRadiance += clamp(vZState.y, 0.0, 1.0) * vec3(1.4, 0.45, 0.08) * zFlick * (1.0 - uCorpse * 0.8) * (0.4 + zN1);
        if (vZType > 2.5 && vZType < 3.5) totalEmissiveRadiance += step(3.5, vZMat) * step(vZMat, 4.5) * vec3(0.3, 0.6, 0.05) * (0.6 + 0.4 * sin(uTime * 4.0 + vZSeed * 9.0));`)
      .replace('#include <fog_fragment>', `
        #ifdef USE_FOG
          vec4 lbF = lbFog(vLbFogW, cameraPosition, fogColor, fogNear, fogFar);
          lbF.a *= 1.0 - 0.65 * zEyeF * (1.0 - uCorpse);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, lbF.rgb, lbF.a);
        #endif`);
  };
  mat.customProgramCacheKey = () => 'zombie-v2';
  return mat;
}

export function createZombieDepthMaterial(uniforms, { corpse = false } = {}) {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  const local = { uCorpse: { value: corpse ? 1 : 0 } };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uCorpse = local.uCorpse;
    shader.vertexShader = POSE_HEADER + shader.vertexShader.replace('#include <begin_vertex>', `
      vec3 transformed = position; vec3 zNN = vec3(0.0, 1.0, 0.0); zPose(transformed, zNN);`);
  };
  mat.customProgramCacheKey = () => 'zombie-depth-v2';
  return mat;
}

// ── Glowing eyes that stay visible as pin-pricks at any distance ─────────────
const EYE_VERT = /* glsl */`
attribute vec4 aAnim;
attribute vec4 aState;
uniform float uPixel;
uniform float uEyeGlow;
varying vec2 vUv;
varying float vA;
${FOG_CUSTOM_GLSL}
void main() {
  float lean = aAnim.w + aState.z * 0.2;
  vec3 local = vec3(0.0, 0.95 + 0.785 * cos(lean), 0.12 + 0.785 * sin(lean));
  vec4 world = modelMatrix * instanceMatrix * vec4(local, 1.0);
  vec3 fwd = normalize((instanceMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
  vec4 mv = viewMatrix * world;
  float dist = -mv.z;
  vec3 toCam = normalize(cameraPosition - world.xyz);
  float facing = smoothstep(-0.05, 0.45, dot(fwd, toCam));
  float scale = length(instanceMatrix[0].xyz);
  float worldSize = 0.13 * scale;
  float minSize = uPixel * dist * 2.6;
  float size = max(worldSize, minSize);
  mv.xy += position.xy * size * vec2(1.7, 0.7);
  gl_Position = projectionMatrix * mv;
  vUv = position.xy * 2.0;
  float fog = lbFog(world.xyz, cameraPosition, lbFogColor, lbTime, lbDawn).a * 0.55;
  vA = facing * (1.0 - step(0.5, aState.w)) * (1.0 + min(aState.w, 0.0)) * (1.0 - fog) * pow(worldSize / size, 0.55)
     * smoothstep(12.0, 30.0, dist) * uEyeGlow * (1.0 - clamp(aState.y, 0.0, 1.0));
}`;

const EYE_FRAG = /* glsl */`
uniform vec3 uColor;
varying vec2 vUv;
varying float vA;
void main() {
  vec2 p = vUv;
  float d1 = length((p - vec2(-0.42, 0.0)) * vec2(1.0, 1.3));
  float d2 = length((p - vec2(0.42, 0.0)) * vec2(1.0, 1.3));
  float g = exp(-d1 * d1 * 14.0) + exp(-d2 * d2 * 14.0);
  g += 0.12 * exp(-(p.x * p.x * 1.5 + p.y * p.y * 6.0));
  gl_FragColor = vec4(uColor * g * vA, 1.0);
}`;

/** Eye billboards for every living zombie (own instance buffers, all LODs). */
export function createEyeMesh(cap, uniforms, fogU, aAnim, aState) {
  const geo = new THREE.BufferGeometry();
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
  geo.setAttribute('aAnim', aAnim);
  geo.setAttribute('aState', aState);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uPixel: uniforms.uPixel,
      uEyeGlow: uniforms.uEyeGlowBillboard,
      uColor: { value: new THREE.Color(2.4, 1.9, 1.1) },
      ...fogU,
    },
    vertexShader: EYE_VERT,
    fragmentShader: EYE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, cap);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 13;
  return mesh;
}
