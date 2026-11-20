// Crows (app/models/crow.glb: a low-poly carrion crow, body and wings as separate meshes,
// standing on its feet at the origin, beak toward +z, 0.46 m long). The model has no rig, so
// it is animated here: the bird's pose (where it is, its heading, a peck, a hop, a bank) is the
// instance matrix, and the wings are folded, spread and flapped in the vertex shader. Each wing
// turns about its shoulder from folded down the flank to spread out flat (one rotation, measured
// from the model: its shoulder-to-tip line out sideways, its outer face up), then beats about the
// body's axis. One instanced mesh per part of the model, every bird an instance.
//
// Crows: the drawing (any number of birds, posed by whoever owns them).
// CrowField: the birds of the valley. At night a few sit on the dead trees in the field and on
// the far ends of the wall, and go up when the gun or a blast comes near them; at first light
// a flock comes down among the dead to feed.
import * as THREE from 'three';
import { Fn, float, vec3, uniform, attribute, positionLocal, cos, sin, cross, dot, select } from 'three/tsl';
import { modelScene } from './models.js';
import { WORLD, wallZ } from '../config.js';
import { groundH } from './terrain.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler(0, 0, 0, 'YXZ');

export class Crows {
  constructor(scene, count, { fog = true } = {}) {
    this.n = count;
    this.meshes = [];
    const src = modelScene('crow');
    src.updateMatrixWorld(true);
    // the right wing as modelled (folded down the flank): its shoulder (the top front of it) and
    // its tip (the point furthest from the shoulder). The spread turn takes the shoulder-to-tip
    // line out sideways (a little back) and rolls the wing's outer face up to the sky; the left
    // wing is its mirror image.
    // (measured on the geometry in the model's frame: the stored positions are quantized, their
    // node carries the scale back)
    let wingGeo = null;
    src.traverse((o) => { if (o.isMesh && /wing/i.test(o.name)) wingGeo = o.geometry.clone().applyMatrix4(o.matrixWorld); });
    const shoulder = new THREE.Vector3(0.05, 0.27, 0.12), spreadAxis = new THREE.Vector3(0, 1, 0);
    let spreadAngle = 1.5;
    if (wingGeo) {
      const pa = wingGeo.attributes.position, v = new THREE.Vector3();
      let best = -Infinity;
      for (let i = 0; i < pa.count; i++) { v.fromBufferAttribute(pa, i); if (v.x <= 0) continue; const k = v.y + 0.6 * v.z; if (k > best) { best = k; shoulder.copy(v); } }
      const tip = shoulder.clone(); let far = -1;
      for (let i = 0; i < pa.count; i++) { v.fromBufferAttribute(pa, i); if (v.x <= 0) continue; const d = v.distanceTo(shoulder); if (d > far) { far = d; tip.copy(v); } }
      shoulder.x = Math.max(0.01, shoulder.x - 0.01);
      const df = tip.clone().sub(shoulder).normalize();
      const ds = new THREE.Vector3(1, 0.05, -0.28).normalize();
      const q1 = new THREE.Quaternion().setFromUnitVectors(df, ds);
      // roll about the spread wing's line so its outer face (+x when folded) turns up
      const flat = (w) => w.clone().sub(ds.clone().multiplyScalar(w.dot(ds))).normalize();
      const a = flat(new THREE.Vector3(1, 0, 0).applyQuaternion(q1)), b = flat(new THREE.Vector3(0, 1, 0));
      const roll = Math.atan2(ds.dot(new THREE.Vector3().crossVectors(a, b)), a.dot(b));
      const q = new THREE.Quaternion().setFromAxisAngle(ds, roll).multiply(q1);
      spreadAngle = 2 * Math.acos(Math.min(1, Math.abs(q.w)));
      const sn = Math.sqrt(Math.max(1e-8, 1 - q.w * q.w));
      spreadAxis.set(q.x / sn, q.y / sn, q.z / sn).multiplyScalar(Math.sign(q.w) || 1);
    }
    this.wing = new Float32Array(count * 2); // per bird: spread 0..1, flap (rad)
    this.wingAttr = new THREE.InstancedBufferAttribute(this.wing, 2).setUsage(THREE.DynamicDrawUsage);
    src.traverse((o) => {
      if (!o.isMesh) return;
      const isWing = /wing/i.test(o.name);
      const geo = o.geometry.clone().applyMatrix4(o.matrixWorld);
      const mat = o.material.clone();
      mat.fog = fog;
      if (isWing) {
        geo.setAttribute('aWing', this.wingAttr);
        mat.side = THREE.DoubleSide;
        const uShoulder = uniform(shoulder), uAxis = uniform(spreadAxis), uSpread = uniform(spreadAngle);
        const aWing = attribute('aWing', 'vec2');
        const rotAxis = (v, a, t) => { const c = cos(t), sn = sin(t); return v.mul(c).add(cross(a, v).mul(sn)).add(a.mul(dot(a, v)).mul(float(1).sub(c))); };
        mat.positionBeforeInstance = true; // (three-shim.js: the wing pose runs before the instance matrix)
        mat.positionNode = Fn(() => {
          const v = attribute('position', 'vec3');
          const side = select(v.x.greaterThanEqual(0), float(1), float(-1));
          const piv = vec3(side.mul(uShoulder.x), uShoulder.y, uShoulder.z);
          const ax = vec3(uAxis.x, uAxis.y.mul(side), uAxis.z.mul(side));
          const p1 = rotAxis(v.sub(piv), ax, aWing.x.mul(uSpread));
          return rotAxis(p1, vec3(0, 0, 1), side.mul(aWing.y)).add(piv);
        })();
      }
      const im = new THREE.InstancedMesh(geo, mat, count);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      im.castShadow = false; im.receiveShadow = false;
      im.count = 0;
      scene.add(im);
      this.meshes.push(im);
    });
    this.used = 0;
  }

  /**
   * Pose bird i: position, heading (yaw), pitch (+ nose down), roll, size, wings (spread 0..1,
   * flap rad). The model stands upright: with its wings out it leans forward into flight.
   */
  pose(i, p, yaw, pitch, roll, size, spread, flap) {
    _e.set(pitch + spread * 0.85, yaw, roll);
    _m.compose(p, _q.setFromEuler(_e), _s.set(size, size, size));
    for (const im of this.meshes) im.setMatrixAt(i, _m);
    this.wing[i * 2] = spread; this.wing[i * 2 + 1] = flap;
    if (i + 1 > this.used) this.used = i + 1;
  }

  /** After posing: draw the first `count` birds. */
  commit(count = this.used) {
    for (const im of this.meshes) { im.count = count; im.instanceMatrix.needsUpdate = true; }
    this.wingAttr.needsUpdate = true;
    this.used = 0;
  }

  hide() { for (const im of this.meshes) im.count = 0; this.used = 0; }
}

// ─────────────────────────────────────────────────────────────────────────────
const R = Math.random;
const rand = (a, b) => a + R() * (b - a);
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * The valley's crows. perches: [x, y, z] spots on the dead trees and the wall; the ground
 * among the dead is where the dawn flock feeds. Each bird is sitting (pecking, hopping,
 * looking round), going up, flying (out, round and back) or coming down to a spot.
 */
export class CrowField {
  constructor(scene, perches) {
    this.perches = perches;
    this.N = 34;
    this.draw = new Crows(scene, this.N);
    this.birds = [];
    this.night = []; // the few who sit out the night
    this.t = 0;
    this.dawnIn = false;
  }

  /** A new night: a handful on the dead trees and the wall, the dawn flock gone. */
  reset() {
    this.birds.length = 0;
    this.dawnIn = false;
    const spots = this.perches.slice().sort(() => R() - 0.5).slice(0, 11);
    for (const s of spots) this.birds.push(this.bird(s[0], s[1], s[2], 'sit'));
  }

  bird(x, y, z, state) {
    return { p: new THREE.Vector3(x, y, z), v: new THREE.Vector3(), home: new THREE.Vector3(x, y, z), yaw: R() * 6.28, pitch: 0, roll: 0,
      state, t: rand(0, 3), act: rand(1, 4), peck: 0, hop: 0, flapPh: R() * 6, spread: state === 'sit' ? 0 : 1, size: rand(0.9, 1.1), ground: false, circle: R() * 6.28 };
  }

  /** Something loud near (x, z) within r: whoever sits there goes up. */
  scare(x, z, r) {
    for (const b of this.birds) {
      if (b.state !== 'sit' && b.state !== 'land') continue;
      if (Math.hypot(b.p.x - x, b.p.z - z) > r) continue;
      b.state = 'up'; b.t = 0;
      const a = Math.atan2(b.p.x - x, b.p.z - z) + rand(-0.6, 0.6);
      b.v.set(Math.sin(a) * rand(3, 5), rand(2.6, 3.6), Math.cos(a) * rand(3, 5));
      b.away = rand(9, 16);
    }
  }

  /** First light: the flock comes over the hills and down among the dead. */
  dawnFlock() {
    this.dawnIn = true;
    for (let k = 0; k < 22 && this.birds.length < this.N; k++) {
      const side = R() < 0.5 ? -1 : 1;
      const b = this.bird(side * rand(120, 200), rand(40, 70), rand(-260, -160), 'fly');
      const tx = rand(-60, 60), tz = rand(-110, -24);
      b.home.set(tx, groundH(tx, tz), tz); b.ground = true;
      b.t = -k * rand(0.15, 0.5); // a straggling stream, not a block
      this.birds.push(b);
    }
  }

  update(dt, dawn) {
    this.t += dt;
    if (dawn > 0.45 && !this.dawnIn) this.dawnFlock();
    let i = 0;
    for (const b of this.birds) {
      b.t += dt;
      if (b.t < 0) continue;
      this.step(b, dt);
      // flight wings: a beat with glides; sitting: folded, a shuffle now and then
      let flap = 0;
      if (b.spread > 0.05) {
        const gliding = b.state === 'fly' && Math.sin(this.t * 0.7 + b.circle) > 0.45;
        b.flapPh += dt * (b.state === 'up' ? 26 : gliding ? 0 : 19);
        flap = gliding ? 0.18 : Math.sin(b.flapPh) * (b.state === 'up' ? 1.05 : 0.8) + 0.15;
      }
      const hop = Math.sin(Math.min(1, b.hop) * Math.PI) * 0.09;
      this.draw.pose(i++, b.p.clone().setY(b.p.y + hop), b.yaw, b.pitch + b.peck * 0.75, b.roll, b.size, b.spread, flap);
    }
    this.draw.commit(i);
  }

  step(b, dt) {
    const p = b.p;
    if (b.state === 'sit') {
      b.spread = Math.max(0, b.spread - dt * 4);
      b.pitch *= 1 - Math.min(1, dt * 6); b.roll *= 1 - Math.min(1, dt * 6);
      b.act -= dt;
      if (b.peck > 0) b.peck = Math.max(0, b.peck - dt * 3.5);
      if (b.hop > 0) { b.hop += dt * 3; if (b.hop >= 1) b.hop = 0; }
      if (b.act <= 0) {
        b.act = rand(0.6, 3.2);
        const r = R();
        if (b.ground && r < 0.45) b.peck = 1; // feeding
        else if (b.ground && r < 0.65) { b.hop = 0.01; const a = b.yaw; p.x += Math.sin(a) * 0.2; p.z += Math.cos(a) * 0.2; p.y = groundH(p.x, p.z); }
        else b.yaw += rand(-1.2, 1.2); // looking round
      }
      return;
    }
    if (b.state === 'up') {
      // straight up and away, wings hard at it
      b.spread = Math.min(1, b.spread + dt * 6);
      p.addScaledVector(b.v, dt);
      b.v.y = Math.max(1.2, b.v.y - dt * 0.6);
      this.face(b, b.v, dt);
      if (b.t > 1.6) { b.state = 'fly'; b.t = 0; b.circle = Math.atan2(p.x - b.home.x, p.z - b.home.z); }
      return;
    }
    if (b.state === 'fly') {
      b.spread = Math.min(1, b.spread + dt * 3);
      const T = b.home;
      if (b.away > 0 && !b.ground) {
        // round the place it left, wide and high, until things are quiet again
        b.away -= dt;
        b.circle += dt * 0.32;
        const r = 22, tgt = new THREE.Vector3(T.x + Math.sin(b.circle) * r, T.y + 14, T.z + Math.cos(b.circle) * r);
        const d = tgt.sub(p);
        b.v.lerp(d.clampLength(0, 9), Math.min(1, dt * 1.2));
      } else {
        // home: in on a long glide, a few beats to slow down at the end
        const d = new THREE.Vector3(T.x - p.x, T.y + 0.05 - p.y, T.z - p.z), L = d.length();
        const sp = Math.min(10, 2.2 + L * 0.35);
        b.v.lerp(d.multiplyScalar(sp / Math.max(L, 1e-3)), Math.min(1, dt * 1.5));
        if (L < 0.35) { b.state = 'sit'; b.act = rand(0.5, 2); p.copy(T); b.v.set(0, 0, 0); return; }
      }
      p.addScaledVector(b.v, dt);
      this.face(b, b.v, dt);
    }
  }

  /** Turn into the direction of flight, banking into the turn. */
  face(b, v, dt) {
    const h = Math.hypot(v.x, v.z);
    if (h < 0.05) return;
    const want = Math.atan2(v.x, v.z), d = wrapA(want - b.yaw);
    b.yaw += d * Math.min(1, dt * 4);
    b.roll += (-d * 1.2 - b.roll) * Math.min(1, dt * 4);
    b.pitch += (-Math.atan2(v.y, h) * 0.5 - b.pitch) * Math.min(1, dt * 4);
  }

  hide() { this.birds.length = 0; this.draw.hide(); }
}

/** Where the valley's crows sit at night: the dead trees in the field (their crowns) and the far ends of the wall. */
export function crowPerches(deadTrees) {
  const out = [];
  for (const [x, y, z, h] of deadTrees) out.push([x + rand(-0.6, 0.6), y + h * rand(0.62, 0.8), z + rand(-0.6, 0.6)]);
  for (const s of [-1, 1]) for (const ax of [44, 52, 61, 68]) { const x = s * ax; out.push([x, WORLD.WALL_H + 0.62, wallZ(x) - 0.15]); }
  return out;
}
