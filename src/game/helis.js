// The extraction's helicopters: an AH-64 attack gunship (app/models/apache.glb: chin
// gun, rocket pods, a searchlight under the nose) and a CH-47 tandem-rotor lifter
// (app/models/ch47.glb) with its ramp, which lowers to the ground and shuts. Nose +z, up +y, metres. The rotors and the
// ramp (with its treadway boards) are nodes of their own; anchors in the root's extras mark
// where the game hangs its lights, guns and paths (scripts/models/build_vehicles.mjs).
import * as THREE from 'three';
import { Fn, float, vec3, uniform, positionLocal, positionWorld, normalWorld, cameraPosition, pow, abs, dot, normalize } from 'three/tsl';
import { cloneModel } from '../world/models.js';

let M = null;
function materials() {
  const disc = new THREE.MeshBasicMaterial({ color: 0x3a3f46, transparent: true, opacity: 0.03, depthWrite: false, side: THREE.DoubleSide });
  return { disc };
}

/** A point the model carries in its root's extras (its own frame): where a light, gun or path goes. */
function anchor(g, name) {
  let a = null;
  g.traverse((o) => { if (!a && o.userData.anchors) a = o.userData.anchors[name]; });
  return new THREE.Vector3(...a);
}

/**
 * Wrap a rotor node in a hub that spins about its local y, with a faint disc for the
 * blur when it turns fast. tilt: a rotation of the hub's axis (the tail rotor's is +x).
 */
function hub(g, name, radius, tilt = null) {
  const node = g.getObjectByName(name);
  const h = new THREE.Group();
  h.position.copy(node.position);
  node.parent.add(h);
  node.position.set(0, 0, 0);
  const inner = new THREE.Group();
  h.add(inner);
  inner.add(node);
  if (tilt) { h.quaternion.copy(tilt); inner.quaternion.copy(tilt).invert(); }
  node.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 40).rotateX(-Math.PI / 2), M.disc);
  disc.renderOrder = 4;
  h.add(disc);
  h.userData.disc = disc;
  return h;
}

function shadows(g) { g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); }

/** Attack gunship, 17.7 m with the rotor turning. */
export function makeAttackHeli() {
  M = M || materials();
  const g = cloneModel('apache');
  shadows(g);
  const main = hub(g, 'rotor_main', 7.0);
  const tail = hub(g, 'rotor_tail', 1.1, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2));
  return {
    group: g, rotors: [main], tail,
    gun: anchor(g, 'gun'), lamp: anchor(g, 'lamp'), pods: [anchor(g, 'podL'), anchor(g, 'podR')],
    lights: { port: anchor(g, 'lightPort'), stbd: anchor(g, 'lightStbd'), tail: anchor(g, 'lightTail') },
  };
}

/** Tandem-rotor heavy lifter, 15.5 m fuselage; its ramp lowers to the ground with its boards run out, and shuts. */
export function makeLifter() {
  M = M || materials();
  const g = cloneModel('ch47');
  shadows(g);
  const fore = hub(g, 'rotor_fore', 7.9), aft = hub(g, 'rotor_aft', 7.9);
  // (the red-lit hold is a light deep in the cabin, extraction.js; no backdrop card any more:
  // it stood below the belly and showed under the airframe in flight)
  // the ramp (node 'ramp', hinged at the cabin floor's end): rotation 0 is down on the ground
  // as modelled, angles.x shuts it along the tail's lines; its treadway boards are a child that
  // retracts into it (boardsSlide); the upper door (node 'door') folds up under the aft pylon
  // when open (angles.y) and swings down onto the shut ramp's end
  const ramp = g.getObjectByName('ramp'), boards = ramp.getObjectByName('boards'), door = g.getObjectByName('door');
  for (const part of [ramp, door]) part.traverse((o) => { if (o.isMesh) o.material.side = THREE.DoubleSide; });
  const ang = anchor(g, 'angles');
  return {
    group: g, rotors: [fore, aft], ramp, boards, door, boardsHome: boards.position.clone(), boardsSlide: anchor(g, 'boardsSlide'),
    rampShut: ang.x, doorOpen: ang.y,
    gear: 2.4, // ground to the model's origin on its wheels
    rampFoot: anchor(g, 'rampFoot'), inside: anchor(g, 'inside'),
    lights: { port: anchor(g, 'lightPort'), stbd: anchor(g, 'lightStbd'), tail: anchor(g, 'lightTail') },
  };
}

/** Spin a heli's rotors: speed 0..1 (fraction of flight rpm). Blades blur into the disc when fast. */
export function spinRotors(h, dt, speed = 1, flip = false) {
  h.rotors.forEach((r, k) => {
    r.rotation.y += dt * speed * 32 * (k % 2 || flip ? -1 : 1);
    r.userData.disc.material.opacity = 0.012 + 0.025 * speed;
  });
  if (h.tail) h.tail.rotateY(dt * speed * 90);
}

/** The searchlight beam: an additive cone from the lamp to the ground, soft at the edges. */
export function makeBeam() {
  const geo = new THREE.CylinderGeometry(0.12, 1, 1, 24, 1, true);
  geo.translate(0, -0.5, 0); // apex at the origin, opening down -y
  const uK = uniform(1);
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  mat.uniforms = { uK };
  mat.colorNode = Fn(() => {
    const vY = positionLocal.y.negate();
    const edge = pow(abs(dot(normalize(normalWorld), normalize(cameraPosition.sub(positionWorld)))), 1.6);
    return vec3(0.85, 0.9, 1.0).mul(edge.mul(float(1).sub(vY.mul(0.8))).mul(0.075).mul(uK));
  })();
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  m.renderOrder = 5;
  return m;
}

const _up = new THREE.Vector3(0, -1, 0), _d = new THREE.Vector3();
/** Point a beam from `from` to `to` (world), its radius at the ground `r`. */
export function aimBeam(beam, from, to, r = 4) {
  _d.subVectors(to, from);
  const len = _d.length();
  beam.position.copy(from);
  beam.quaternion.setFromUnitVectors(_up, _d.normalize());
  beam.scale.set(r, len, r);
}
