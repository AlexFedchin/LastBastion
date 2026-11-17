// The extraction's helicopters: an AH-64 attack gunship (app/models/apache.glb: chin
// gun, rocket pods, a searchlight under the nose) and a CH-47 tandem-rotor lifter
// (app/models/ch47.glb) with its ramp, which lowers to the ground and shuts. Nose +z, up +y, metres. The rotors and the
// ramp (with its treadway boards) are nodes of their own; anchors in the root's extras mark
// where the game hangs its lights, guns and paths (scripts/models/build_vehicles.mjs).
import * as THREE from 'three';
import { cloneModel } from '../world/models.js';

let M = null;
function materials() {
  const disc = new THREE.MeshBasicMaterial({ color: 0x3a3f46, transparent: true, opacity: 0.03, depthWrite: false, side: THREE.DoubleSide });
  const hold = new THREE.MeshBasicMaterial({ map: holdTexture(), side: THREE.DoubleSide }); // the cabin seen through the ramp
  return { disc, hold };
}

/** The hold of a lifter at night, as seen up the ramp: red-lit, ribbed, seats down both sides. */
function holdTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(128, 70, 10, 128, 120, 190);
  g.addColorStop(0, '#d0301c'); g.addColorStop(0.35, '#6a1209'); g.addColorStop(1, '#120201');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  // the far bulkhead (a darker rectangle in perspective), ribs converging on it
  x.fillStyle = 'rgba(20,3,2,0.75)'; x.fillRect(92, 70, 72, 92);
  x.strokeStyle = 'rgba(15,2,1,0.6)'; x.lineWidth = 5;
  for (let k = 0; k <= 6; k++) { const u = k / 6; x.beginPath(); x.moveTo(u * 256, 0); x.lineTo(92 + u * 72, 70); x.stroke(); x.beginPath(); x.moveTo(u * 256, 256); x.lineTo(92 + u * 72, 162); x.stroke(); }
  // seat rows down both sides
  x.fillStyle = 'rgba(30,6,3,0.9)';
  for (let k = 0; k < 6; k++) { const u = k / 6; x.fillRect(8 + u * 70, 150 - u * 20, 20 - u * 8, 40 - u * 16); x.fillRect(228 - u * 70, 150 - u * 20, 20 - u * 8, 40 - u * 16); }
  // the floor, lighter where the lamp falls
  const f = x.createLinearGradient(0, 162, 0, 256); f.addColorStop(0, 'rgba(120,20,10,0.5)'); f.addColorStop(1, 'rgba(40,6,3,0.9)');
  x.fillStyle = f; x.beginPath(); x.moveTo(92, 162); x.lineTo(164, 162); x.lineTo(256, 256); x.lineTo(0, 256); x.fill();
  // the lamp
  x.fillStyle = '#ffb090'; x.fillRect(118, 60, 20, 5);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
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

/** Tandem-rotor heavy lifter, 15.5 m fuselage; its ramp flies level and the boards on it lower to the ground. */
export function makeLifter() {
  M = M || materials();
  const g = cloneModel('ch47');
  shadows(g);
  const fore = hub(g, 'rotor_fore', 7.9), aft = hub(g, 'rotor_aft', 7.9);
  // the red-lit hold, seen up the ramp: a backdrop at the forward end of the cabin
  const hold = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 2.1), M.hold);
  hold.position.set(0, -1.05, 1.5);
  hold.rotation.y = Math.PI;
  g.add(hold);
  // the ramp (node 'ramp', hinged at the cabin floor): rotation 0 is down on the ground as
  // modelled, +1.35 rad shuts it; its treadway boards are a child that slides back up it
  const ramp = g.getObjectByName('ramp'), boards = ramp.getObjectByName('boards');
  ramp.traverse((o) => { if (o.isMesh) o.material.side = THREE.DoubleSide; });
  return {
    group: g, rotors: [fore, aft], ramp, boards, boardsHome: boards ? boards.position.clone() : null,
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
  const mat = new THREE.ShaderMaterial({
    uniforms: { uK: { value: 1 } },
    vertexShader: /* glsl */`
      varying float vY; varying vec3 vN; varying vec3 vV;
      void main(){
        vY = -position.y;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vV = normalize(cameraPosition - w.xyz);
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      uniform float uK; varying float vY; varying vec3 vN; varying vec3 vV;
      void main(){
        float edge = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
        float a = edge * (1.0 - vY * 0.8) * 0.075 * uK;
        gl_FragColor = vec4(vec3(0.85, 0.9, 1.0) * a, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
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
