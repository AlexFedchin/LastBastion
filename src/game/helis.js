// The extraction's helicopters, built from primitives: a two-seat attack gunship
// (stub wings, rocket pods, a chin gun, a searchlight under the nose) and a
// tandem-rotor heavy lifter with a rear ramp. Nose +z, up +y, metres.
import * as THREE from 'three';
import { box, cylX, cylY, cylZ, merge, xf } from '../world/kit.js';

/** Group geometries by material, one merged mesh per material. */
function assemble(list) {
  const by = new Map();
  for (const [g, m] of list) { if (!by.has(m)) by.set(m, []); by.get(m).push(g); }
  const grp = new THREE.Group();
  for (const [m, gs] of by) {
    const mesh = new THREE.Mesh(merge(gs), m);
    mesh.castShadow = true; mesh.receiveShadow = true;
    grp.add(mesh);
  }
  return grp;
}

/** A tapered, rounded body along z from z0 to z1: radius profile r(t), height scale hy. */
function lathe(z0, z1, prof, hy = 1, segs = 14, rings = 12) {
  const g = new THREE.CylinderGeometry(1, 1, 1, segs, rings, false);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) + 0.5; // 0 tail .. 1 nose
    const [rx, ry, dy = 0] = prof(t);
    p.setXYZ(i, p.getX(i) * rx, p.getZ(i) * ry * hy + dy, z0 + (z1 - z0) * t);
  }
  g.computeVertexNormals();
  return g;
}

/** A spinning rotor: blades (and a faint disc for the blur when it is turning fast). */
function rotor(radius, blades, chord, mat, discMat) {
  const hub = new THREE.Group();
  const geo = merge(Array.from({ length: blades }, (_, k) => xf(new THREE.BoxGeometry(radius, 0.06, chord), radius / 2, 0, 0, 0, (k / blades) * Math.PI * 2, 0)));
  const b = new THREE.Mesh(geo, mat);
  b.castShadow = true;
  hub.add(b);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 40).rotateX(-Math.PI / 2), discMat);
  disc.renderOrder = 4;
  hub.add(disc);
  hub.userData.blades = b;
  return hub;
}

function materials() {
  const body = new THREE.MeshStandardMaterial({ color: 0x2c3126, roughness: 0.62, metalness: 0.35 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.5, metalness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x0b1014, roughness: 0.08, metalness: 0.9 });
  const blade = new THREE.MeshStandardMaterial({ color: 0x1b1d1f, roughness: 0.7, metalness: 0.2 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0f0f0f, roughness: 0.95 });
  const disc = new THREE.MeshBasicMaterial({ color: 0x3a3f46, transparent: true, opacity: 0.03, depthWrite: false, side: THREE.DoubleSide });
  const cabin = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.07, 0.035) }); // red night lighting inside
  const hold = new THREE.MeshBasicMaterial({ map: holdTexture() }); // the cabin seen through the ramp
  return { body, dark, glass, blade, rubber, disc, cabin, hold };
}
let M = null;

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

/** Attack gunship, ~16 m long with the rotor turning. */
export function makeAttackHeli() {
  M = M || materials();
  const L = [];
  // fuselage: narrow, tall at the cockpits, tapering into the tail boom
  L.push([lathe(-2.6, 4.6, (t) => [0.55 + 0.35 * Math.sin(Math.PI * Math.min(1, t * 1.1)), 0.9 * Math.sin(Math.PI * (0.15 + 0.85 * t)) + 0.25, 0]), M.body]);
  L.push([lathe(-9.6, -2.4, (t) => [0.22 + 0.3 * t * t, 0.3 + 0.35 * t * t, 0.25 * t]), M.body]);
  // tandem canopy
  L.push([xf(new THREE.SphereGeometry(1, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0.72, 2.2, 0, 0, 0, 0.62, 0.65, 1.9), M.glass]);
  // engines either side of the rotor mast, with exhausts
  for (const s of [-1, 1]) {
    L.push([cylZ(0.42, 2.4, 12, s * 0.85, 0.85, -0.4), M.body]);
    L.push([cylZ(0.3, 0.5, 10, s * 0.95, 0.9, -1.75), M.dark]);
    // stub wings with two pods
    L.push([box(1.7, 0.12, 0.9, s * 1.35, 0.05, 0.3, 0, 0, s * -0.08), M.body]);
    L.push([cylZ(0.24, 1.6, 10, s * 1.55, -0.25, 0.4), M.dark]);
    L.push([cylZ(0.24, 1.6, 10, s * 2.15, -0.3, 0.4), M.dark]);
    // landing gear
    L.push([box(0.08, 0.7, 0.08, s * 0.7, -0.95, 2.0), M.dark]);
    L.push([cylX(0.22, 0.14, 10, s * 0.7, -1.3, 2.0), M.rubber]);
  }
  L.push([cylY(0.2, 0.9, 8, 0, 1.6, 0.2), M.dark]); // mast
  // chin gun and the searchlight beside it
  L.push([xf(new THREE.SphereGeometry(0.3, 10, 8), 0, -0.6, 3.9), M.dark]);
  L.push([cylZ(0.05, 1.3, 6, 0, -0.75, 4.6), M.dark]);
  L.push([cylZ(0.22, 0.4, 10, 0.55, -0.55, 3.3), M.dark]);
  // tail: fin and the tail rotor's hub
  L.push([box(0.12, 1.9, 1.2, 0, 1.3, -9.2, -0.35, 0, 0), M.body]);
  L.push([box(1.8, 0.1, 0.6, 0, 0.3, -8.4), M.body]);
  const g = assemble(L);
  const main = rotor(7.2, 4, 0.5, M.blade, M.disc);
  main.position.set(0, 2.1, 0.2);
  g.add(main);
  const tail = rotor(1.35, 4, 0.22, M.blade, M.disc);
  tail.rotation.z = Math.PI / 2;
  tail.position.set(0.25, 1.55, -9.4);
  g.add(tail);
  return {
    group: g, rotors: [main], tail,
    gun: new THREE.Vector3(0, -0.8, 5.2), lamp: new THREE.Vector3(0.55, -0.65, 3.5), pods: [new THREE.Vector3(-1.85, -0.28, 1.3), new THREE.Vector3(1.85, -0.28, 1.3)],
    lights: { port: new THREE.Vector3(2.3, 0.05, 0.3), stbd: new THREE.Vector3(-2.3, 0.05, 0.3), tail: new THREE.Vector3(0, 2.2, -9.6) },
  };
}

/** Tandem-rotor heavy lifter, ~16 m fuselage, rear ramp that lowers to the ground. */
export function makeLifter() {
  M = M || materials();
  const L = [];
  const W = 1.95, H = 1.9; // half width, half height of the cabin
  // cabin: a long rounded box
  const cab = new THREE.BoxGeometry(W * 2, H * 2, 12, 2, 2, 6);
  {
    const p = cab.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i);
      // round the top corners
      if (y > 0) p.setX(i, x * (1 - 0.18 * (y / H) ** 3));
    }
    cab.computeVertexNormals();
  }
  L.push([xf(cab, 0, 0, 0.2), M.body]);
  // nose: cockpit, glass
  L.push([lathe(6.2, 8.6, (t) => [W * (1 - 0.45 * t * t), H * (1 - 0.5 * t), -0.35 * t]), M.body]);
  L.push([xf(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2.2), 0, 0.35, 7.3, -0.5, 0, 0, W * 0.92, 1.2, 1.3), M.glass]);
  // aft pylon (tall, carries the rear rotor) and the forward one over the cockpit
  L.push([extrudeZ([[-1.2, 0], [-0.9, 2.6], [0.9, 2.6], [1.2, 0]], 3.2), M.body]);
  L.push([box(1.6, 0.9, 2.2, 0, H + 0.4, 6.0), M.body]);
  // engines on the aft pylon
  for (const s of [-1, 1]) {
    L.push([cylZ(0.55, 3.2, 12, s * 1.55, H + 1.1, -4.4), M.body]);
    L.push([cylZ(0.38, 0.4, 10, s * 1.55, H + 1.1, -6.1), M.dark]);
    // sponsons with the main wheels
    L.push([box(0.7, 0.9, 4.2, s * (W + 0.35), -H + 0.5, 0.6), M.body]);
    L.push([cylX(0.42, 0.3, 12, s * (W + 0.3), -H - 0.05, -0.3), M.rubber]);
    L.push([cylX(0.42, 0.3, 12, s * (W + 0.3), -H - 0.05, 1.5), M.rubber]);
    L.push([cylX(0.38, 0.28, 12, s * 1.1, -H - 0.1, 5.4), M.rubber]);
    // windows down the cabin, lit red from inside
    for (let k = 0; k < 4; k++) L.push([box(0.04, 0.42, 0.42, s * (W + 0.005), 0.45, -3.5 + k * 2.4), M.cabin]);
  }
  // the red-lit inside of the cabin, seen through the open ramp
  L.push([xf(new THREE.PlaneGeometry(W * 2 - 0.3, H * 2 - 0.4), 0, -0.1, -5.82, 0, Math.PI, 0), M.hold]);
  const g = assemble(L);
  // rear ramp, hinged at the bottom of the cabin's back edge
  const rampG = new THREE.Group();
  rampG.position.set(0, -H, -5.8);
  const ramp = new THREE.Mesh(box(W * 2 - 0.1, 0.14, 3.4, 0, 0, -1.7), M.body);
  ramp.castShadow = true;
  rampG.add(ramp);
  g.add(rampG);
  const fore = rotor(9.1, 3, 0.75, M.blade, M.disc);
  fore.position.set(0, H + 1.05, 6.0);
  const aft = rotor(9.1, 3, 0.75, M.blade, M.disc);
  aft.position.set(0, H + 3.05, -4.6);
  g.add(fore, aft);
  return {
    group: g, rotors: [fore, aft], ramp: rampG, gear: H + 0.47, // ground to body centre on the wheels
    rampFoot: new THREE.Vector3(0, -H, -9.2), inside: new THREE.Vector3(0, -H + 0.2, -3),
    lights: { port: new THREE.Vector3(W + 0.4, -H + 0.9, 0.6), stbd: new THREE.Vector3(-W - 0.4, -H + 0.9, 0.6), tail: new THREE.Vector3(0, H + 5.7, -5.5) },
  };
}

function extrudeZ(pts, depth) {
  const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false });
  g.translate(0, 1.9, -6.2);
  return g;
}

/** Spin a heli's rotors: speed 0..1 (fraction of flight rpm). Blades blur into the disc when fast. */
export function spinRotors(h, dt, speed = 1, flip = false) {
  h.rotors.forEach((r, k) => {
    r.rotation.y += dt * speed * 32 * (k % 2 || flip ? -1 : 1);
    r.userData.blades.material.opacity = 1;
    r.children[1].material.opacity = 0.012 + 0.025 * speed;
  });
  if (h.tail) h.tail.rotation.y += dt * speed * 90;
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
