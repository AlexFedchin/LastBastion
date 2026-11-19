// The dawn resupply as a place: the bastion's vehicle hangar, doors open on the first
// light, the depot laid out in four bays (the gun, the battery, the wall, support) and a
// duty board with last night's numbers. Every upgrade is a thing in its bay: a slot that
// holds one unit per rank (spare barrels on the bench, ammo cans on a pallet, men, wire,
// crates of bottles), so what you have bought is what you see; a new rank is delivered,
// dropped into its slot with a thud.
//
// Its own scene and camera, drawn through the game's post chain while the shop is open
// (main.js render). The building is an old factory hall (app/models/hangar.glb, built by
// scripts/models/build_field.mjs): open at the yard end (-z), the four bays in a row down its
// right wall between the pilasters, the duty board across from the third, the hall's old tanks
// and pipework still standing at the far end. The bays' surfaces are ambientCG CC0 scans (hg* sets,
// texlib.js); the props are the game's models and Poly Haven kit (app/models/kit).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { UPGRADES, UPGRADE_GROUPS, CLAYMORE, isUnlocked, UNLOCKS, DELIVERY_LINES, CALL } from '../config.js';
import { cloneModel } from './models.js';
import { fileTex } from './texlib.js';
import { concertinaGeo } from './kit.js';
import { Soldier } from '../game/soldier.js';
import { fitFov } from '../core/util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
// the hall (the model's frame): inner half-width, the open end, the far wall, under the trusses
// (measured by casting at the model: the wall faces at x -5.48 / +5.39, pilasters at z -7.75,
// -1, 5.75 and 19.25, side doorways at 3..5 (left), 11..14 and 24..27, the trusses at 4.69 m)
const HW = 5.45, XR = 5.39, XL = -5.48, OPEN_Z = -10.48, FAR_Z = 29.9, CEIL = 4.65;
// each bay stands with its back to the right wall between the pilasters, facing across the
// hall: x, z of its centre, ry its turn (its own +z is its front). From the open end: the gun,
// the battery, the wall, support.
export const BAYS = [
  { id: 'hmg', z: -4.25, key: 'Digit1' },
  { id: 'arty', z: 2.25, key: 'Digit2' },
  { id: 'wall', z: 8.4, key: 'Digit3' },
  { id: 'support', z: 16.4, key: 'Digit4' },
];
for (const b of BAYS) { b.x = XR - 3.2; b.ry = -Math.PI / 2; b.n = new THREE.Vector3(Math.sin(b.ry), 0, Math.cos(b.ry)); } // its front, into the hall
const BOARD = { x: XL + 0.06, y: 2.35, z: 8.5, n: new THREE.Vector3(1, 0, 0) }; // on the left wall, across from the third bay
/** Screen-right for a camera looking back along n at a thing facing n. */
const rightOf = (n) => new THREE.Vector3(-n.z, 0, n.x).negate();
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

// ── materials and geometry helpers ───────────────────────────────────────────

/** A material from a scanned set (texlib), or a flat colour if the set is missing. */
function surf(set, { color = 0xffffff, gain = 1, fallback = 0x777777, rough = 1, metal = 1, side } = {}) {
  const t = fileTex(set);
  // (the scans are dark in linear terms: the gain lifts them to the albedo the lighting wants)
  const m = new THREE.MeshStandardMaterial({ color: t ? new THREE.Color(color).multiplyScalar(gain) : fallback, roughness: rough, metalness: t ? metal : 0.2, side });
  if (t) {
    m.map = t.map; m.normalMap = t.normalMap;
    if (t.roughnessMap) { m.roughnessMap = t.roughnessMap; m.metalnessMap = t.roughnessMap; } else m.metalness = 0;
  }
  return m;
}

/** World-scaled UVs, picked per vertex by the face's normal (a box mapping): the scans tile at their real size. */
function wuv(geo, tile) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ax >= ay && ax >= az) { u = p.getZ(i); v = p.getY(i); } else if (ay >= az) { u = p.getX(i); v = p.getZ(i); } else { u = p.getX(i); v = p.getY(i); }
    uv.setXY(i, u / tile, v / tile);
  }
  uv.needsUpdate = true;
  return geo;
}

/** A box from min to max corner (world space). */
function box(x0, y0, z0, x1, y1, z1) {
  return new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
}

/** A beam of section w x h from a to b. */
function beam(a, b, w, h) {
  const d = b.clone().sub(a), L = d.length();
  const g = new THREE.BoxGeometry(w, h, L);
  const m = new THREE.Matrix4().lookAt(V(0, 0, 0), d, Math.abs(d.y / L) > 0.99 ? V(1, 0, 0) : V(0, 1, 0));
  g.applyMatrix4(m);
  return g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
}

/** Text painted on a transparent canvas, as a decal plane w x h metres (stencils, labels). */
function stencil(lines, w, h, { color = '#e8e2cc', bg = null, font = '700 120px "Bahnschrift Condensed", "Arial Narrow", sans-serif', px = 512, wear = 0.35 } = {}) {
  const c = document.createElement('canvas');
  c.width = px; c.height = Math.round(px * h / w);
  const x = c.getContext('2d');
  if (bg) { x.fillStyle = bg; x.fillRect(0, 0, c.width, c.height); }
  x.fillStyle = color; x.textAlign = 'center'; x.textBaseline = 'middle';
  const arr = Array.isArray(lines) ? lines : [lines];
  arr.forEach((l, i) => {
    const f = typeof l === 'object' ? l : { t: l };
    x.font = f.font || font;
    const sc = Math.min(1, (c.width * 0.9) / x.measureText(f.t).width);
    x.save(); x.translate(c.width / 2, c.height * (i + 0.5) / arr.length); x.scale(sc, sc);
    x.fillText(f.t, 0, 0); x.restore();
  });
  // worn: specks of the paint gone
  x.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 900 * wear; i++) { x.globalAlpha = Math.random() * 0.8; x.fillRect(Math.random() * c.width, Math.random() * c.height, 1 + Math.random() * 4, 1 + Math.random() * 3); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const m = new THREE.MeshStandardMaterial({ map: t, transparent: !bg, roughness: 0.9, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2 });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
}

/** A model copy with its shadows on and (optionally) its colour multiplied. */
function prop(name, tint = null) {
  const g = cloneModel(name);
  g.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    if (tint !== null && o.material.color) o.material.color.multiply(new THREE.Color(tint));
  });
  return g;
}

function place(o, x, y, z, ry = 0, s = 1) { o.position.set(x, y, z); o.rotation.y = ry; o.scale.setScalar(s); return o; }

// ── the hangar ───────────────────────────────────────────────────────────────

export class Hangar {
  constructor(game) {
    this.g = game;
    this.built = false;
    this.active = false;
    this.ranks = {};
    this.view = 'overview';
    this.hot = null;
    this.mouse = new THREE.Vector2(0, 0);
    this.mouseIn = false;
    this.ray = new THREE.Raycaster();
    this.t = 0;
  }

  build() {
    if (this.built) return;
    this.built = true;
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0a09);
    scene.fog = new THREE.FogExp2(0x1d1a17, 0.012);
    const cam = this.camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.05, 400);
    this.camPos = V(0, 6.8, 13); this.camLook = V(0, 1, -4);
    // a little of a room's light in every reflection: without it the steel reads black
    const pm = new THREE.PMREMGenerator(this.g.renderer);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    // the room's own soft light, bounced off every wall: it is what fills the shadows
    scene.environmentIntensity = 1.15;
    pm.dispose();

    this.mats = {
      floor: surf('hgFloor', { color: 0xf2ece2, gain: 2.2, fallback: 0x6d6a64 }),
      apron: surf('hgFloor', { color: 0xe0d8cc, gain: 1.5, fallback: 0x4a4744 }),
      wall: surf('hgWall', { color: 0xe8e0d2, gain: 1.6, metal: 0.4, fallback: 0x5c6264, side: THREE.DoubleSide }),
      roof: surf('hgWall', { color: 0xc8ccc8, gain: 0.9, metal: 0.4, fallback: 0x3a3e40, side: THREE.DoubleSide }),
      steel: surf('hgSteel', { color: 0xc4cabb, gain: 1.0, metal: 0.55, fallback: 0x4c5048 }),
      hazard: surf('hgHazard', { color: 0xffffff, gain: 1.3, fallback: 0xc9a227 }),
      plate: surf('hgPlate', { color: 0xf0ece4, gain: 1.25, metal: 0.45, fallback: 0x5a5c58 }),
      rubber: surf('hgRubber', { color: 0xffffff, gain: 1.6, fallback: 0x1d1d1d }),
      wood: surf('hgWood', { color: 0xd8c8ac, gain: 1.15, fallback: 0x6b5a44 }),
      pallet: surf('hgWood', { color: 0xbcb09a, gain: 0.95, fallback: 0x6b5a44 }),
      gun: new THREE.MeshStandardMaterial({ color: 0x45473f, roughness: 0.45, metalness: 0.6 }),
      brass: new THREE.MeshStandardMaterial({ color: 0xc09348, roughness: 0.3, metalness: 1 }),
      olive: new THREE.MeshStandardMaterial({ color: 0x4b5234, roughness: 0.62, metalness: 0.25 }),
      yellow: new THREE.MeshStandardMaterial({ color: 0xc9a227, roughness: 0.6 }),
      red: new THREE.MeshStandardMaterial({ color: 0x8e2219, roughness: 0.6 }),
      black: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.5, metalness: 0.4 }),
      wire: new THREE.MeshStandardMaterial({ color: 0x8a8d8f, roughness: 0.35, metalness: 1 }),
    };
    this.mats.floor.normalScale.setScalar(0.45); // (it sparkles at a grazing angle)
    this.buildShell();
    this.buildOutside();
    this.buildLights();
    this.buildDressing();
    this.buildBays();
    this.buildBoard();
    this.buildAtmosphere();
    this.buildTags();
  }

  // ── the building ───────────────────────────────────────────────────────────
  /** The building: the factory hall model, and the hazard paint on its floor. */
  buildShell() {
    const hall = prop('hangar');
    // its strip lights glow, but not so they blow out the trusses round them
    hall.traverse((o) => { if (o.isMesh && o.material.emissive && o.material.emissive.getHex() !== 0) o.material.emissiveIntensity = 0.35; });
    this.scene.add(hall);
    const M = this.mats, geos = { hazard: [] };
    // the walkway painted down the middle of the hall, and the line in front of each bay
    for (const s of [-1, 1]) geos.hazard.push(wuv(box(s * 1.05 - 0.09, 0, OPEN_Z + 1.2, s * 1.05 + 0.09, 0.006, FAR_Z - 12), 1));
    for (const b of BAYS) {
      const g = wuv(box(-2.9, 0, 3.45, 2.9, 0.006, 3.62), 1).rotateY(b.ry).translate(b.x, 0, b.z);
      geos.hazard.push(g);
    }
    const mesh = new THREE.Mesh(mergeGeometries(geos.hazard), M.hazard);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  /** Beyond the open end: the apron, the yard, sandbags and barriers, and a sky coming up pink over the wall. */
  buildOutside() {
    const M = this.mats, D = -OPEN_Z;
    const apron = new THREE.Mesh(wuv(new THREE.PlaneGeometry(80, 60).rotateX(-Math.PI / 2).translate(0, -0.01, -D - 30), 3), M.apron);
    apron.receiveShadow = true;
    this.scene.add(apron);
    const skyMat = new THREE.ShaderMaterial({
      fog: false, depthWrite: false,
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vP;
        void main(){
          float h = clamp((vP.y + 4.0) / 70.0, 0.0, 1.0);
          vec3 hor = vec3(2.2, 1.25, 0.72), mid = vec3(0.85, 0.55, 0.52), top = vec3(0.16, 0.2, 0.32);
          vec3 c = mix(hor, mid, smoothstep(0.0, 0.18, h));
          c = mix(c, top, smoothstep(0.15, 0.75, h));
          float sun = exp(-pow(length(vec2(vP.x + 18.0, vP.y - 3.0)) / 9.0, 2.0));
          c += vec3(3.0, 1.9, 1.0) * sun;
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(260, 90).translate(0, 38, 0), skyMat);
    sky.position.z = -95;
    this.scene.add(sky);
    // the ridge line and the bastion's wall against it, black
    const ridge = new THREE.Shape();
    ridge.moveTo(-130, -2);
    for (let x = -130; x <= 130; x += 6) ridge.lineTo(x, 5 + Math.sin(x * 0.05) * 3 + Math.sin(x * 0.17) * 1.4 + (Math.abs(x) < 40 ? -2.5 : 0));
    ridge.lineTo(130, -2);
    const dark = new THREE.MeshBasicMaterial({ color: 0x0c0c0e, fog: false });
    const r = new THREE.Mesh(new THREE.ShapeGeometry(ridge), dark);
    r.position.z = -90;
    this.scene.add(r);
    const wall = new THREE.Mesh(box(-60, 0, -45, 60, 7.5, -44), new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 1 }));
    this.scene.add(wall);
    // the yard: barriers, sandbags, a light tower, drums
    const dz = OPEN_Z + 13; // (laid out for a door at z = -13)
    const yard = [['barrier', -9, -19, 0.2], ['barrier', 8.5, -22, -0.3], ['barrierTall', 14, -18, 1.4], ['drumBlue', -7, -16.5, 0], ['drumRed', -6.3, -17.1, 1],
      ['floodlight', 12, -27, 2.4], ['generator', -12.5, -18, 0.6]];
    for (const [k, x, z, ry] of yard) this.scene.add(place(prop('kit/' + k), x, 0, z + dz, ry));
    for (let i = 0; i < 5; i++) this.scene.add(place(prop('sandbags'), -16 + i * 1.5, 0, -24 + dz - (i % 2) * 0.2, (i % 2) * 0.1));
  }

  buildLights() {
    const scene = this.scene, q = this.g.quality;
    scene.add(new THREE.HemisphereLight(0xc4bdb0, 0x6a5e4e, 1.2));
    // the sun's patch on the floor throws warm light back up into the hall
    const bounce = new THREE.PointLight(0xffb880, 26, 22, 1.4);
    bounce.position.set(1, 1.2, OPEN_Z + 4.5);
    scene.add(bounce);
    // the low sun through the open door: warm, raking, the one shadow-casting light
    const sun = this.sun = new THREE.DirectionalLight(0xffc49a, 2.5);
    const dir = V(0.32, -0.36, 1).normalize();
    sun.target.position.set(1, 0, -2);
    sun.position.copy(sun.target.position).addScaledVector(dir, -70);
    sun.castShadow = q.spotShadows > 0;
    if (sun.castShadow) {
      sun.shadow.mapSize.set(q.shadowMap * 2, q.shadowMap * 2);
      const c = sun.shadow.camera;
      c.left = -24; c.right = 24; c.top = 22; c.bottom = -22; c.near = 30; c.far = 120;
      sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
    }
    scene.add(sun, sun.target);
    this.sunDir = dir;
    // a lamp over each bay and over the duty board
    this.bayLights = [];
    for (const b of BAYS) {
      const l = new THREE.SpotLight(0xffd8b0, 60, 14, 0.95, 0.8, 1.4);
      l.position.set(b.x + b.n.x * 0.4, CEIL - 0.6, b.z);
      l.target.position.set(b.x + b.n.x * 0.4, 0, b.z);
      scene.add(l, l.target);
      this.bayLights.push(l);
    }
    const bl = new THREE.SpotLight(0xffe0b8, 30, 12, 0.75, 0.6, 1.4);
    bl.position.set(BOARD.x + 2.6, 4.4, BOARD.z);
    bl.target.position.set(BOARD.x, BOARD.y, BOARD.z);
    scene.add(bl, bl.target);
    // the hall's own ceiling lights, down the middle
    for (const z of [-4, 4, 12, 20]) {
      const p = new THREE.PointLight(0xe8ecf4, 8, 16, 1.5);
      p.position.set(-1.2, CEIL - 0.3, z);
      scene.add(p);
    }
    // work lights on stands in front of each bay, low, throwing light into it: the bays read from across the hall
    this.workLights = [];
    for (const b of BAYS) {
      const r = rightOf(b.n);
      const w = new THREE.SpotLight(0xffe6c2, 44, 14, 0.65, 0.85, 1.4);
      w.position.set(b.x + b.n.x * 4.6 - r.x * 1.6, 2.6, b.z + b.n.z * 4.6 - r.z * 1.6);
      w.target.position.set(b.x - b.n.x * 0.6, 0.6, b.z - b.n.z * 0.6);
      scene.add(w, w.target);
      this.workLights.push(w);
    }
    // warm washes along the side walls, a cool fill by the open end
    for (const x of [XL + 0.8, XR - 0.8]) for (const z of [-3, 9, 21]) {
      const p = new THREE.PointLight(0xffc890, 6, 8, 1.6);
      p.position.set(x, 4.2, z);
      scene.add(p);
    }
    const doorFill = new THREE.PointLight(0xd0d4dc, 16, 16, 1.4);
    doorFill.position.set(0, 4.2, OPEN_Z + 0.5);
    scene.add(doorFill);
    // the entrance, where the overview looks down the hall from
    const front = new THREE.PointLight(0xffe2c4, 18, 22, 1.4);
    front.position.set(0, CEIL - 0.5, OPEN_Z + 3);
    scene.add(front);
    // the pick light: follows what the cursor is over
    const pick = this.pick = new THREE.SpotLight(0xfff0d0, 0, 7, 0.38, 0.5, 1.4);
    scene.add(pick, pick.target);
  }

  /**
   * The working hangar round the bays: shelving, carts, drums and tools along the walls where
   * no bay or camera stands (by the open end, between the bays, and toward the far end), and a
   * lamp hung over each bay from the trusses.
   */
  buildDressing() {
    const S = this.scene;
    const add = (k, x, z, ry = 0, y = 0, tint = null) => { const o = place(prop(k, tint), x, y, z, ry); S.add(o); return o; };
    const R = XR - 0.5, L = XL + 0.5; // against the right (+x) and left (-x) walls
    // by the open end: shelving, the compressor, a ladder
    for (let i = 0; i < 2; i++) {
      const z = OPEN_Z + 1.6 + i * 1.12;
      add('kit/shelves', L + 0.05, z, Math.PI / 2);
      const loads = [['kit/ammo', 0.5], ['kit/toolbox', 1.0], ['kit/cardboard', 1.5], ['kit/foodCans', 0.5], ['kit/medbox', 1.0]];
      loads.forEach(([k, y], j) => { if ((i + j) % 2) add(k, L + 0.05, z + ((j % 3) - 1) * 0.25, Math.PI / 2, y * 0.98 + 0.02); });
    }
    add('kit/compressor', R - 0.5, OPEN_Z + 1.4, -0.5); add('kit/ladder', R + 0.3, OPEN_Z + 2.6, -Math.PI / 2);
    // along the left wall, under the cameras: the welder and its cart, drums, tyres
    add('kit/toolcart', L + 0.6, -6.0, 0.4); add('kit/welder', L + 0.4, -5.0, -0.3);
    add('kit/drumRed', L + 0.1, 0.4, 0); add('kit/drumBlue', L + 0.15, 1.1, 1); add('kit/drumPlastic', L + 0.6, 0.75, 2);
    add('kit/handtruck', L + 0.9, 1.9, -0.8);
    add('kit/tyre', L + 0.4, 5.3, 0.3); add('kit/tyre', L + 0.45, 5.3, 0.1, 0.22);
    // past the board: the tool chest, the drill press, shelving
    add('kit/toolchest', L + 0.25, 15.2, Math.PI / 2); add('kit/drillpress', L + 0.3, 16.4, Math.PI / 2);
    add('kit/shelves2', L + 0.05, 17.6, Math.PI / 2); add('kit/shelves2', L + 0.05, 18.4, Math.PI / 2);
    // the far end, among the old tanks: stores waiting to be sorted
    add('kit/storecart', 0.4, 20.4, 0.25); add('kit/crateLong', -2.0, 20.6, 0.1); add('kit/crateWood', -1.8, 20.6, 0.05, 0.58);
    add('kit/chalkboard', 1.8, 20.1, -0.4);
    for (const [x, z] of [[XL, -2.6], [XR, -0.5], [XL, 10.6], [XR, OPEN_Z + 0.6], [XR, 19.8]]) add('kit/extinguisher', x + (x < 0 ? 0.5 : -0.5), z, x < 0 ? Math.PI / 2 : -Math.PI / 2);
    // a lamp over each bay, hung from the trusses
    const cable = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });
    for (const b of BAYS) {
      const x = b.x + b.n.x * 0.4;
      add('kit/lampHang', x, b.z, 0, CEIL - 0.62);
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.3, 4), cable);
      c.position.set(x, CEIL - 0.15, b.z); S.add(c);
    }
  }

  // ── the bays ───────────────────────────────────────────────────────────────
  buildBays() {
    const M = this.mats, S = this.scene;
    this.slots = {};
    this.bayRoots = {};
    this.bayHits = [];
    this.soldiers = [];
    for (const b of BAYS) {
      const root = new THREE.Group();
      root.position.set(b.x, 0, b.z); root.rotation.y = b.ry;
      S.add(root);
      this.bayRoots[b.id] = root;
      // the mat and its striped border
      const mat = new THREE.Mesh(wuv(box(-2.95, 0, -3.2, 2.95, 0.025, 3.2), 1), M.plate);
      mat.receiveShadow = true; root.add(mat);
      // the bay's sign, hung from the lamp's beam
      const grp = UPGRADE_GROUPS.find((x) => x.id === b.id);
      const sign = stencil([{ t: grp.title, font: '700 130px "Bahnschrift Condensed", "Arial Narrow", sans-serif' }, { t: grp.sub.toUpperCase(), font: '500 64px "Bahnschrift Condensed", "Arial Narrow", sans-serif' }],
        2.6, 0.62, { bg: '#2b3020', color: '#e4dcc0', wear: 0.5 });
      sign.position.set(0, 4.05, 3.0); root.add(sign);
      const back = new THREE.Mesh(new THREE.BoxGeometry(2.7, 0.7, 0.04), M.steel);
      back.position.set(0, 4.05, 2.97); root.add(back);
      for (const s of [-1, 1]) {
        const ch = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, CEIL - 4.38, 3), M.black);
        ch.position.set(s * 1.2, (CEIL + 4.38) / 2, 3.0); root.add(ch);
      }
      const hit = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 6.6), new THREE.MeshBasicMaterial({ visible: false }));
      hit.position.y = 1.5; hit.userData.bay = b.id; root.add(hit);
      this.bayHits.push(hit);
    }
    this.bayHMG(); this.bayArty(); this.bayWall(); this.baySupport();
    this.slotHits = Object.values(this.slots).map((s) => s.hit);
  }

  /**
   * One upgrade's place in its bay: a base that is always there (a pallet, a bench, the
   * man already on the wall), and one unit per rank, shown as it is bought.
   */
  slot(id, bay, x, z, ry, { base = null, unit, max, tagY = 1.2 }) {
    const root = new THREE.Group();
    root.position.set(x, 0, z); root.rotation.y = ry;
    this.bayRoots[bay].add(root);
    if (base) root.add(base);
    const units = [];
    for (let i = 0; i < max; i++) { const u = unit(i); u.visible = false; u.userData.home = u.position.clone(); root.add(u); units.push(u); }
    // the hit box round the whole slot (everything shown for the measure)
    for (const u of units) u.visible = true;
    this.bayRoots[bay].updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(root);
    for (const u of units) u.visible = false;
    const size = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3());
    const hit = new THREE.Mesh(new THREE.BoxGeometry(size.x + 0.2, size.y + 0.2, size.z + 0.2), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.copy(c); hit.userData.slot = id;
    this.scene.add(hit);
    const s = { id, bay, root, units, hit, rank: -1, anchor: V(c.x, bb.max.y + 0.25, c.z), tagY, center: c };
    this.slots[id] = s;
    return s;
  }

  pallet() {
    const g = [];
    for (const z of [-0.4, 0, 0.4]) g.push(box(-0.5, 0, z - 0.05, 0.5, 0.09, z + 0.05));
    for (let i = 0; i < 5; i++) { const x = -0.45 + i * 0.225; g.push(box(x - 0.05, 0.09, -0.45, x + 0.05, 0.13, 0.45)); }
    const m = new THREE.Mesh(wuv(mergeGeometries(g), 2), this.mats.pallet);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }

  bench(w = 2.6, d = 0.9, h = 0.95) {
    const M = this.mats, grp = new THREE.Group();
    const top = new THREE.Mesh(wuv(box(-w / 2, h - 0.06, -d / 2, w / 2, h, d / 2), 2), M.wood);
    const legs = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) legs.push(box(sx * (w / 2 - 0.08) - 0.03, 0, sz * (d / 2 - 0.06) - 0.03, sx * (w / 2 - 0.08) + 0.03, h - 0.06, sz * (d / 2 - 0.06) + 0.03));
    legs.push(box(-w / 2 + 0.05, 0.22, -d / 2 + 0.04, w / 2 - 0.05, 0.26, d / 2 - 0.04));
    const frame = new THREE.Mesh(wuv(mergeGeometries(legs), 2), M.steel);
    for (const o of [top, frame]) { o.castShadow = true; o.receiveShadow = true; grp.add(o); }
    return grp;
  }

  /** The M2's spare barrel: a long tube, the flash hider and the carrying handle. */
  spareBarrel() {
    const M = this.mats, g = new THREE.Group();
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 1.14, 10).rotateZ(Math.PI / 2), M.gun);
    const hider = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.034, 0.12, 10).rotateZ(Math.PI / 2).translate(-0.6, 0, 0), M.gun);
    const jacket = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.2, 10).rotateZ(Math.PI / 2).translate(0.45, 0, 0), M.gun);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.008, 4, 10, Math.PI).translate(0.22, 0.03, 0), M.gun);
    for (const o of [tube, hider, jacket, handle]) { o.castShadow = true; g.add(o); }
    return g;
  }

  /** A 105 mm round standing on its base: brass case, olive projectile, the ogive and its fuze. */
  shell() {
    const M = this.mats, g = new THREE.Group();
    const pts = [V(0, 0, 0), V(0.053, 0, 0), V(0.053, 0.08, 0), V(0.05, 0.16, 0), V(0.042, 0.215, 0), V(0.024, 0.26, 0), V(0.012, 0.28, 0), V(0, 0.29, 0)].map((p) => new THREE.Vector2(p.x, p.y));
    const caseM = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.062, 0.37, 14).translate(0, 0.185, 0), M.brass);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.066, 0.066, 0.012, 14).translate(0, 0.006, 0), M.brass);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.053, 0.053, 0.12, 14).translate(0, 0.43, 0), M.olive);
    const nose = new THREE.Mesh(new THREE.LatheGeometry(pts, 14).translate(0, 0.49, 0), M.olive);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0545, 0.0545, 0.018, 14).translate(0, 0.462, 0), M.yellow);
    for (const o of [caseM, rim, body, nose, band]) { o.castShadow = true; g.add(o); }
    return g;
  }

  /** Stack things on a pallet: n per unit, cols x rows a layer. */
  stackOn(make, n, cols, rows, sx, sz, h, y0 = 0.13) {
    const g = new THREE.Group();
    for (let i = 0; i < n; i++) {
      const layer = Math.floor(i / (cols * rows)), k = i % (cols * rows), c = k % cols, r = Math.floor(k / cols);
      const o = make(i);
      o.position.set((c - (cols - 1) / 2) * sx, y0 + layer * h, (r - (rows - 1) / 2) * sz);
      g.add(o);
    }
    return g;
  }

  // M2HB .50 CAL: the gun on its tripod, the bench with spare barrels, pallets of belts and parts
  bayHMG() {
    const R = this.bayRoots.hmg, M = this.mats;
    // the gun on its own pedestal mount (the model carries it, and its ammo can), side-on to the door:
    // stood on the floor by its bounding box, centred on its spot
    const gun = new THREE.Group();
    const m2 = prop('m2hb');
    gun.add(m2);
    const bb = new THREE.Box3().setFromObject(m2), c = bb.getCenter(new THREE.Vector3());
    m2.position.set(-c.x, -bb.min.y + 0.5, -c.z);
    const plinth = new THREE.Mesh(wuv(box(-0.45, 0, -0.45, 0.45, 0.5, 0.45), 1), this.mats.plate);
    plinth.castShadow = true; plinth.receiveShadow = true;
    plinth.position.set(m2.position.x + (bb.min.x + bb.max.x) / 2 - c.x + c.x, 0, 0); gun.add(plinth);
    const st = stencil(['M2HB', 'CAL .50'], 0.7, 0.32, { color: '#e2d9bb' }); st.position.set(plinth.position.x, 0.27, 0.452); gun.add(st);
    place(gun, 0.1, 0, 1.0, Math.PI / 2 - 0.4);
    R.add(gun);
    const bench = this.bench(); bench.position.set(0, 0, -2.1); R.add(bench);
    R.add(place(prop('kit/toolbox'), 0.9, 0.95, -2.15, 0.2)); R.add(place(prop('kit/oilcan'), 0.4, 0.95, -1.9, -0.6));
    R.add(place(prop('kit/wrench'), 0.15, 0.95, -2.3, 0.4)); R.add(place(prop('kit/welder'), -2.4, 0, -2.4, 0.4));
    R.add(place(prop('kit/rack'), 2.45, 0, -2.6, -0.2));

    this.slot('hmgDmg', 'hmg', -0.55, -2.1, 0, {
      base: (() => { const g = new THREE.Group(); for (const x of [-0.42, 0.3]) { const r = new THREE.Mesh(wuv(box(x - 0.04, 0.95, -0.02, x + 0.04, 1.0, 0.42), 2), this.mats.wood); r.castShadow = true; g.add(r); } return g; })(),
      max: 4, unit: (i) => place(this.spareBarrel(), 0, 1.03, 0.04 + i * 0.11, 0),
    });
    this.slot('hmgRate', 'hmg', 2.4, 1.5, -0.2, {
      base: this.pallet(), max: 4, unit: (i) => place(prop('kit/plasticCrate', [0x3e4a2c, 0x5a4a2a, 0x3e4a2c, 0x2e3a3a][i]), (i % 2 - 0.5) * 0.5, 0.13 + Math.floor(i / 2) * 0.27, 0),
    });
    this.slot('hmgCool', 'hmg', 2.4, -0.45, -0.1, {
      base: this.pallet(), max: 3, unit: (i) => place(prop('kit/jerrySteel'), (i - 1) * 0.24, 0.13, 0, 0),
    });
    const can = (red) => (i) => {
      const g = new THREE.Group();
      g.add(prop('kit/ammo', red ? 0x8a8f78 : null));
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.335, 0.03, 0.115), red ? M.red : M.black);
      band.position.y = 0.15; g.add(band);
      g.position.set((i % 2 - 0.5) * 0.36, 0.13 + Math.floor(i / 2) * 0.235, 0);
      return g;
    };
    this.slot('hmgPen', 'hmg', -2.4, -0.45, 0.15, {
      base: this.pallet(), max: 3, unit: (i) => { const g = new THREE.Group(); for (let k = 0; k < 2; k++) { const c = can(false)(k); c.position.z = (k - 0.5) * 0.14; g.add(c); } g.position.y = i * 0.235; g.position.x = 0; return g; },
    });
    this.slot('hmgInc', 'hmg', -2.4, 1.5, -0.1, {
      base: this.pallet(), max: 2, unit: (i) => { const g = new THREE.Group(); for (let k = 0; k < 4; k++) { const c = can(true)(k % 2); c.position.z = (Math.floor(k / 2) - 0.5) * 0.14; g.add(c); } g.position.y = i * 0.235; return g; },
    });
    this.slot('hmgHE', 'hmg', -1.0, 2.45, 0.08, {
      max: 1, unit: () => {
        const g = new THREE.Group();
        g.add(prop('kit/crateLong', 0x8a8a70));
        const band = new THREE.Mesh(new THREE.BoxGeometry(1.46, 0.08, 0.89), M.yellow);
        band.position.y = 0.42; g.add(band);
        const st = stencil(['HE-I  .50 CAL', 'M8 · 105 RDS'], 1.0, 0.3, { color: '#e9e1c4' });
        st.position.set(0, 0.25, 0.44); g.add(st);
        return g;
      },
    });
  }

  // 105MM BATTERY: the fire direction centre's desk and map, pallets of rounds, powder charges
  bayArty() {
    const R = this.bayRoots.arty, M = this.mats;
    R.add(place(prop('kit/desk'), 0.4, 0, -2.3, 0));
    // the map board behind the desk
    const map = this.mapBoard();
    map.position.set(0.4, 1.9, -2.95); R.add(map);
    // the mission rounds: always here, four on their pallet
    const base = new THREE.Group(); base.add(this.pallet());
    base.add(this.stackOn(() => this.shell(), 4, 2, 2, 0.16, 0.16, 0));
    R.add(place(base, -2.35, 0, 1.6, 0.1));
    R.add(place(prop('kit/crateWood', 0x8c8c74), 2.3, 0, -2.4, -0.3));
    R.add(place(prop('kit/crateWood', 0x8c8c74), 2.3, 0.46, -2.4, -0.25));
    this.slot('artyShells', 'arty', -2.35, -0.4, 0.05, {
      max: 3, unit: (i) => {
        const g = new THREE.Group(); g.add(this.pallet());
        g.add(this.stackOn(() => this.shell(), 6, 3, 2, 0.15, 0.16, 0));
        g.position.set(i === 2 ? 1.25 : 0, 0, i === 2 ? 2.0 : -i * 1.1 + 0.0);
        return g;
      },
    });
    this.slot('artyCd', 'arty', 0.4, -2.3, 0, {
      max: 3, unit: (i) => [
        () => place(prop('kit/radio'), -0.55, 0.79, -0.05, 0.25),
        () => place(prop('kit/clipboard'), 0.15, 0.79, 0.12, -0.3),
        () => place(prop('kit/binoculars'), 0.6, 0.79, 0.05, 0.6),
      ][i](),
    });
    this.slot('artyHeavy', 'arty', 2.35, 0.9, -0.15, {
      base: this.pallet(), max: 2, unit: (i) => {
        const g = new THREE.Group();
        for (let k = 0; k < 3; k++) g.add(place(prop('kit/cement', 0x77744e), (k - 1) * 0.0, 0.13 + k * 0.17, 0, (k % 2) * 0.15));
        g.position.x = (i - 0.5) * 0.48; g.scale.set(0.95, 1, 1);
        return g;
      },
    });
    void M;
  }

  /** The battery's map: contour lines, the valley, the wall, and the night's target squares. */
  mapBoard() {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 640;
    const x = c.getContext('2d');
    x.fillStyle = '#b9b092'; x.fillRect(0, 0, 1024, 640);
    x.strokeStyle = 'rgba(120,90,50,0.55)'; x.lineWidth = 1.5;
    for (let k = 0; k < 22; k++) {
      x.beginPath();
      for (let i = 0; i <= 64; i++) {
        const u = i / 64, px = u * 1024;
        const py = 40 + k * 28 + Math.sin(u * 6 + k * 0.7) * 18 + Math.sin(u * 17 + k) * 5 - (Math.abs(u - 0.5) < 0.18 ? 60 * (1 - Math.abs(u - 0.5) / 0.18) * (k / 22) : 0);
        if (i) x.lineTo(px, py); else x.moveTo(px, py);
      }
      x.stroke();
    }
    x.strokeStyle = 'rgba(40,60,90,0.35)'; x.lineWidth = 1;
    for (let i = 0; i < 1024; i += 64) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 640); x.stroke(); }
    for (let i = 0; i < 640; i += 64) { x.beginPath(); x.moveTo(0, i); x.lineTo(1024, i); x.stroke(); }
    x.strokeStyle = '#1e2a40'; x.lineWidth = 6;
    x.beginPath(); x.moveTo(300, 560); x.lineTo(512, 470); x.lineTo(724, 560); x.stroke();
    x.fillStyle = '#1e2a40'; x.font = '700 30px "Bahnschrift Condensed", "Arial Narrow", sans-serif'; x.fillText('BASTION-7', 450, 610);
    x.strokeStyle = '#a3241a'; x.lineWidth = 4;
    for (const [px, py, n] of [[420, 300, 'AB 1001'], [610, 250, 'AB 1002'], [520, 160, 'AB 1003'], [700, 380, 'AB 1004']]) {
      x.strokeRect(px - 24, py - 24, 48, 48); x.beginPath(); x.moveTo(px - 30, py); x.lineTo(px + 30, py); x.moveTo(px, py - 30); x.lineTo(px, py + 30); x.stroke();
      x.fillStyle = '#a3241a'; x.font = '600 22px monospace'; x.fillText(n, px + 30, py - 28);
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    const g = new THREE.Group();
    const face = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.19), new THREE.MeshStandardMaterial({ map: t, roughness: 0.85 }));
    face.position.z = 0.03; g.add(face);
    const frame = new THREE.Mesh(wuv(new THREE.BoxGeometry(2.02, 1.3, 0.05), 2), this.mats.wood);
    frame.castShadow = true; g.add(frame);
    for (const s of [-1, 1]) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.9, 0.05), this.mats.steel); leg.position.set(s * 0.9, -0.95, -0.02); g.add(leg); }
    return g;
  }

  // THE WALL: the M240 on its sandbags, the gun crews, the range targets, coils of wire
  bayWall() {
    const R = this.bayRoots.wall, M = this.mats;
    for (const [x, z, ry] of [[-0.9, 1.9, 0.05], [0.75, 1.95, -0.05], [0, 2.35, 0]]) R.add(place(prop('sandbags', 0x8f8676), x, 0, z, ry));
    R.add(place(prop('sandbags', 0x8f8676), -0.1, 0.48, 1.95, 0.1));
    // the crews' gun (the MG4 standing in for the M240) on its bipod over the bags, muzzle out
    const mg = prop('mg4');
    mg.rotation.set(0, 1.2, 0);
    const mb = new THREE.Box3().setFromObject(mg);
    mg.position.set(-0.1, 0.99 - mb.min.y, 2.0); R.add(mg);
    R.add(place(prop('kit/ammo'), 0.55, 0.98, 1.95, 0.3));
    // the men already on the wall, at ease behind their guns
    const men = (n) => (i) => {
      const s = new Soldier();
      s.root.visible = true;
      s.root.position.set(0, 0, 0); s.root.rotation.y = 0.15 * (i % 2 ? 1 : -1);
      this.soldiers.push(s);
      return s.root;
    };
    for (let i = 0; i < 2; i++) { const r = men(2)(i); r.position.set(-1.9 + i * 1.0, 0, -1.6); r.rotation.y = 0.25 - i * 0.18; R.add(r); }
    this.slot('gunners', 'wall', 0.65, -1.6, 0, {
      max: 2, unit: (i) => { const r = men(2)(i + 2); r.position.set(i * 1.0, 0, (i % 2) * 0.25); r.rotation.y = -0.1 - i * 0.2; return r; },
    });
    // range targets for the crews: men who have shot at paper shoot straighter
    this.slot('crews', 'wall', -2.4, 0.2, 0.5, {
      max: 2, unit: (i) => { const t = this.target(i); t.position.set(0, 0, (i - 0.5) * 1.2); return t; },
    });
    const coil = concertinaGeo(1.7, 0.42, 0.11, 0.008);
    this.slot('wire', 'wall', 2.0, 0.5, -Math.PI / 2 + 0.2, {
      max: 3, unit: (i) => { const m = new THREE.Mesh(coil, M.wire); m.castShadow = true; m.position.set(0, 0, (i - 1) * 0.95); return m; },
    });
  }

  /** A range target: a post and a round paper target, holed. */
  target(seed) {
    const g = new THREE.Group();
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const x = c.getContext('2d');
    x.fillStyle = '#e8e0c8'; x.fillRect(0, 0, 256, 256);
    for (let r = 120; r > 0; r -= 22) { x.beginPath(); x.arc(128, 128, r, 0, Math.PI * 2); x.fillStyle = (r / 22) % 2 < 1 ? '#1b1b1b' : '#e8e0c8'; x.fill(); }
    x.fillStyle = '#e8e0c8';
    for (let i = 0; i < 14; i++) { const a = (i * 2.4 + seed) % 6.28, r = (i * 37 + seed * 11) % 50; x.beginPath(); x.arc(128 + Math.cos(a) * r, 128 + Math.sin(a) * r, 4, 0, 6.3); x.fill(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62), new THREE.MeshStandardMaterial({ map: t, roughness: 0.9, side: THREE.DoubleSide }));
    face.position.set(0, 1.25, 0.03); face.rotation.y = Math.PI / 2; g.add(face);
    const board = new THREE.Mesh(wuv(box(-0.02, 0.92, -0.34, 0.0, 1.58, 0.34), 2), this.mats.wood);
    const post = new THREE.Mesh(wuv(box(-0.04, 0, -0.04, 0.04, 0.95, 0.04), 2), this.mats.wood);
    const foot = new THREE.Mesh(wuv(box(-0.3, 0, -0.04, 0.3, 0.05, 0.04), 2), this.mats.wood);
    for (const o of [board, post, foot]) { o.castShadow = true; g.add(o); }
    face.position.x = 0.012;
    return g;
  }

  // SUPPORT: grenades by the crate, Molotovs by the crate, fuel, and the claymores
  baySupport() {
    const R = this.bayRoots.support, M = this.mats;
    const grenadeCrate = () => {
      const g = new THREE.Group(); g.add(prop('mcrate'));
      for (let k = 0; k < 6; k++) { const n = prop('grenade'); n.position.set(-0.3 + k * 0.12, 0.29, (k % 2) * 0.06 - 0.03); n.rotation.z = 1.4; g.add(n); }
      return g;
    };
    const bottleCrate = () => {
      const g = new THREE.Group(); g.add(prop('kit/woodCrate'));
      for (let k = 0; k < 10; k++) g.add(place(prop('molotov'), -0.3 + (k % 5) * 0.15, 0.35, (Math.floor(k / 5) - 0.5) * 0.16));
      return g;
    };
    // the night's issue, always here: a crate of each
    R.add(place(grenadeCrate(), -1.8, 0.95, -2.15, 0));
    R.add(place(bottleCrate(), 0.6, 0.95, -2.15, 0));
    const bench = this.bench(3.6); bench.position.set(-0.6, 0, -2.15); R.add(bench);
    R.add(place(prop('kit/jerry'), 2.5, 0, -2.4, 0.3)); R.add(place(prop('kit/medbox'), 1.7, 0.95, -2.15, -0.2));
    this.slot('grenades', 'support', -2.3, -0.2, 0.1, {
      base: this.pallet(), max: 2, unit: (i) => place(grenadeCrate(), 0, 0.13 + i * 0.25, (i - 0.5) * 0.0, i * 0.08),
    });
    this.slot('molotov', 'support', -2.3, 1.6, -0.1, {
      base: this.pallet(), max: 2, unit: (i) => place(bottleCrate(), (i - 0.5) * 0.0, 0.13, (i - 0.5) * 0.44, -i * 0.04),
    });
    this.slot('molotovFuel', 'support', 2.3, 0.0, -0.25, {
      max: 3, unit: (i) => place(prop('kit/drumRed', 0x8a8a8a), (i % 2) * 0.62 - 0.3, 0, Math.floor(i / 2) * 0.62 - (i < 2 ? 0.3 : -0.3), i),
    });
    // claymores: bought by the half-dozen, stacked in their bandoliers on the table
    const mine = new THREE.BoxGeometry(0.22, 0.14, 0.05);
    this.slot('claymores', 'support', 0.6, 1.7, 0, {
      base: (() => { const t = this.bench(1.2, 0.7, 0.75); return t; })(), max: CLAYMORE.max / CLAYMORE.perBuy, unit: (i) => {
        const g = new THREE.Group();
        for (let k = 0; k < CLAYMORE.perBuy; k++) {
          const m = new THREE.Mesh(mine, M.olive); m.castShadow = true;
          m.position.set((k % 3 - 1) * 0.24, 0.82 + Math.floor(k / 3) * 0.055, 0); m.rotation.x = -Math.PI / 2; g.add(m);
        }
        g.position.set(((i % 2) - 0.5) * 0.0, Math.floor(i / 2) * 0.11, (i % 2 - 0.5) * 0.3);
        return g;
      },
    });
  }

  // ── the duty board: last night's numbers in chalk ─────────────────────────────
  buildBoard() {
    const c = this.boardCanvas = document.createElement('canvas'); c.width = 1536; c.height = 900;
    const t = this.boardTex = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    const g = new THREE.Group();
    const face = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 1.93), new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 }));
    face.position.z = 0.035; g.add(face);
    const frame = new THREE.Mesh(wuv(new THREE.BoxGeometry(3.48, 2.1, 0.06), 2), this.mats.wood);
    frame.castShadow = true; g.add(frame);
    const tray = new THREE.Mesh(wuv(box(-1.7, -1.06, 0, 1.7, -1.02, 0.12), 2), this.mats.wood); g.add(tray);
    g.position.set(BOARD.x + 0.05, BOARD.y, BOARD.z); g.rotation.y = Math.PI / 2; // (facing +x, across the hall)
    this.scene.add(g);
    this.boardHit = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2.1, 3.5), new THREE.MeshBasicMaterial({ visible: false }));
    this.boardHit.position.set(BOARD.x + 0.2, BOARD.y, BOARD.z); this.boardHit.userData.bay = 'report';
    this.scene.add(this.boardHit);
    this.bayHits.push(this.boardHit);
  }

  drawBoard(run, report) {
    if (!this.boardCanvas) return;
    const c = this.boardCanvas, x = c.getContext('2d'), r = report || {};
    x.fillStyle = '#1f2620'; x.fillRect(0, 0, c.width, c.height);
    // old chalk, rubbed out
    for (let i = 0; i < 40; i++) { x.fillStyle = `rgba(220,225,215,${0.015 + Math.random() * 0.03})`; x.beginPath(); x.ellipse(Math.random() * c.width, Math.random() * c.height, 80 + Math.random() * 260, 20 + Math.random() * 60, Math.random(), 0, 6.3); x.fill(); }
    const chalk = (s, px, py, size, col = 'rgba(236,236,226,0.9)', align = 'left') => {
      x.font = `${size}px "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive`; x.fillStyle = col; x.textAlign = align;
      for (let k = 0; k < 2; k++) { x.globalAlpha = k ? 0.35 : 0.9; x.fillText(s, px + k * 1.5, py + k); }
      x.globalAlpha = 1;
    };
    const acc = r.shots ? Math.round((r.hits / r.shots) * 100) : 0;
    chalk(`DUTY BOARD — DAWN, DAY ${run.night - 1}`, 70, 110, 64, 'rgba(240,214,140,0.95)');
    x.strokeStyle = 'rgba(236,236,226,0.6)'; x.lineWidth = 4; x.beginPath(); x.moveTo(70, 140); x.lineTo(1150, 132); x.stroke();
    const n = (v) => Math.round(v || 0).toLocaleString('en-US');
    const rows = [['Killed last night', n(r.kills)], ['Headshots', n(r.headshots)], ['Best streak', n(r.bestStreak)], ['Accuracy', acc + '%'],
      ['Lost on the wall', n(r.lost)], ['Supplies scavenged', n(r.supplies)], ['Dawn bonus', '+' + n(r.bonus)]];
    rows.forEach(([k, v], i) => { chalk(k, 90, 230 + i * 82, 50); chalk(String(v), 1010, 230 + i * 82, 54, 'rgba(255,255,245,0.95)', 'right'); });
    chalk('ON THE WALL', 1110, 260, 44, 'rgba(240,214,140,0.95)');
    chalk(String(run.survivors), 1320, 400, 150, 'rgba(255,255,245,0.95)', 'center');
    // tally marks: the nights held
    const held = run.night - 1;
    for (let i = 0; i < held; i++) {
      const g5 = Math.floor(i / 5), k = i % 5, bx = 1130 + g5 * 150, by = 520;
      x.strokeStyle = 'rgba(236,236,226,0.85)'; x.lineWidth = 7; x.beginPath();
      if (k < 4) { x.moveTo(bx + k * 26, by); x.lineTo(bx + k * 26 + 4, by + 120); } else { x.moveTo(bx - 14, by + 100); x.lineTo(bx + 104, by + 20); }
      x.stroke();
    }
    chalk(`${held} ${held === 1 ? 'night' : 'nights'} held`, 1130, 700, 40);
    chalk(`Total kills: ${run.kills}`, 1130, 770, 40);
    this.boardTex.needsUpdate = true;
  }

  // ── dust in the light, the shaft through the door ───────────────────────────
  buildAtmosphere() {
    const dir = this.sunDir;
    // the shaft: the door's rectangle swept along the light, glowing faintly, fading inward
    const L = 30;
    const basis = new THREE.Matrix4().makeBasis(V(2 * HW, 0, 0), V(0, CEIL, 0), dir.clone().multiplyScalar(L));
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0.5, 0.5, 0.5);
    const shaft = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide, fog: false,
      uniforms: { uT: { value: 0 } },
      vertexShader: 'varying vec3 vL; void main(){ vL = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vL; uniform float uT;
        void main(){
          float edge = smoothstep(0.0, 0.18, vL.x) * smoothstep(1.0, 0.82, vL.x) * smoothstep(0.0, 0.25, vL.y) * smoothstep(1.0, 0.85, vL.y);
          float along = pow(1.0 - vL.z, 1.6) * smoothstep(0.0, 0.04, vL.z);
          float flick = 0.92 + 0.08 * sin(uT * 0.7 + vL.x * 9.0 + vL.z * 4.0);
          gl_FragColor = vec4(vec3(1.0, 0.72, 0.48) * edge * along * flick * 0.018, 1.0);
        }`,
    }));
    shaft.applyMatrix4(basis);
    shaft.position.set(-HW, 0, OPEN_Z - 4);
    shaft.renderOrder = 5;
    this.shaft = shaft;
    this.scene.add(shaft);
    // motes
    const N = 700, pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 2 * HW; pos[i * 3 + 1] = Math.random() * CEIL; pos[i * 3 + 2] = OPEN_Z + Math.random() * 26; seed[i] = Math.random() * 100; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    this.motes = new THREE.Points(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      uniforms: { uT: { value: 0 }, uPx: { value: 600 } },
      vertexShader: `attribute float seed; uniform float uT, uPx; varying float vA;
        void main(){
          vec3 p = position;
          p.x += sin(uT * 0.11 + seed) * 0.6; p.y += sin(uT * 0.07 + seed * 1.7) * 0.4; p.z += cos(uT * 0.09 + seed * 0.6) * 0.5;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uPx * 0.012 / -mv.z;
          vA = (0.4 + 0.6 * fract(seed * 7.13)) * smoothstep(0.5, 3.0, -mv.z);
        }`,
      fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vec3(1.0, 0.82, 0.6) * vA * smoothstep(0.5, 0.0, d) * 0.5, 1.0); }`,
    }));
    this.motes.frustumCulled = false;
    this.scene.add(this.motes);
    // the floor ring under whatever the cursor is over
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.7, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.1, 0.78, 0.36), transparent: true, opacity: 0, depthWrite: false, fog: false }));
    this.ring.position.y = 0.035;
    this.scene.add(this.ring);
    // dust kicked up where a delivery lands
    this.puffs = [];
  }

  // ── the HTML tags over the things ───────────────────────────────────────────
  buildTags() {
    this.tagLayer = document.getElementById('hangar-tags');
    this.tags = {};
    for (const s of Object.values(this.slots)) {
      const el = document.createElement('div');
      el.className = 'htag'; el.dataset.id = s.id;
      this.tagLayer.appendChild(el);
      this.tags[s.id] = el;
    }
    this.bayTags = {};
    for (const b of [...BAYS, { id: 'report' }]) {
      const el = document.createElement('div');
      el.className = 'htag bay'; el.dataset.bay = b.id;
      this.tagLayer.appendChild(el);
      this.bayTags[b.id] = el;
    }
  }

  // ── state ──────────────────────────────────────────────────────────────────

  /** The rank each slot shows (claymores: how many half-dozens are in the field), and the tags. */
  sync(run, report) {
    if (!this.built) return;
    const n = run.night;
    const had = (key) => !key || isUnlocked(key, n - 1);
    for (const u of UPGRADES) {
      const s = this.slots[u.id];
      if (!s) continue;
      this.setRank(s, run.upgrades[u.id] || 0);
      const rank = run.upgrades[u.id] || 0, max = u.costs.length;
      const locked = !had(u.unlock);
      const pips = Array.from({ length: max }, (_, i) => `<i class="${i < rank ? 'on' : ''}"></i>`).join('');
      s.locked = locked;
      this.tags[u.id].innerHTML = `<b>${u.name}</b><span class="pp">${pips}</span>${locked ? `<em>ARRIVES NIGHT ${UNLOCKS[u.unlock]}</em>` : rank >= max ? '<em class="ok">ISSUED IN FULL</em>' : `<em>${u.costs[rank]} SUPPLIES</em>`}`;
      this.tags[u.id].classList.toggle('locked', locked);
    }
    const ms = this.slots.claymores;
    if (ms) {
      this.setRank(ms, Math.round(run.minesOwned / CLAYMORE.perBuy));
      const locked = !isUnlocked('claymores', n);
      ms.locked = locked;
      this.tags.claymores.innerHTML = `<b>CLAYMORES</b><span class="cnt">${run.minesOwned} IN THE FIELD</span>${locked ? `<em>ON SALE BEFORE NIGHT ${UNLOCKS.claymores}</em>` : `<em>×${CLAYMORE.perBuy} · ${CLAYMORE.cost} SUPPLIES</em>`}`;
      this.tags.claymores.classList.toggle('locked', locked);
    }
    for (const b of BAYS) {
      const grp = UPGRADE_GROUPS.find((x) => x.id === b.id);
      const ids = UPGRADES.filter((u) => u.group === b.id);
      const owned = ids.reduce((a, u) => a + (run.upgrades[u.id] || 0), 0), total = ids.reduce((a, u) => a + u.costs.length, 0);
      this.bayTags[b.id].innerHTML = `<kbd>${BAYS.indexOf(b) + 1}</kbd><b>${grp.title}</b><span class="cnt">${owned} / ${total}</span>`;
    }
    this.bayTags.report.innerHTML = '<kbd>5</kbd><b>DUTY BOARD</b><span class="cnt">LAST NIGHT</span>';
    if (report !== undefined) this.drawBoard(run, report);
  }

  setRank(s, rank) {
    rank = Math.min(rank, s.units.length);
    const first = s.rank < 0;
    if (!first && rank > s.rank && this.active) {
      for (let i = s.rank; i < rank; i++) this.deliver(s, s.units[i], (i - s.rank) * 0.18);
      this.say(s.id);
    } else {
      s.units.forEach((u, i) => { u.visible = i < rank; u.position.copy(u.userData.home); u.userData.drop = null; });
    }
    s.rank = rank;
  }

  /** A new rank arrives: the unit drops into its place, a thud and a puff of dust. */
  deliver(s, u, delay) {
    u.visible = true;
    u.userData.drop = { t: -delay, h: 1.6 + Math.random() * 0.4, landed: false };
    u.position.copy(u.userData.home).y += 50; // out of sight until its turn
    s.flash = 1;
  }

  /** Whoever brought it in says a word (the line shows over the hangar, with the radio's click). */
  say(id) {
    const l = DELIVERY_LINES[id];
    if (!l) return;
    const who = CALL[l[0]] || l[0], el = document.getElementById('hangar-radio');
    document.getElementById('hr-who').textContent = who;
    document.getElementById('hr-text').textContent = l[1];
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
    clearTimeout(this._sayT);
    this._sayT = setTimeout(() => el.classList.remove('show'), 5200);
    const A = this.g.audio;
    if (A) { const v = A.radioVoice(who, l[1], 0.35); A.radioStatic(Math.max(0.5, v ? v + 0.1 : 0.5)); }
  }

  enter(run, report) {
    this.build();
    this.active = true;
    for (const s of Object.values(this.slots)) s.rank = -1; // set without the drop
    this.sync(run, report);
    this.camRate = 0;
    this.go('overview', true);
    this.tagLayer.classList.add('on');
    if (this.g.audio) this.g.audio.inside = true; // rain on the roof, the valley shut out
  }

  exit() {
    this.active = false;
    if (this.g.audio) this.g.audio.inside = false;
    const hr = document.getElementById('hangar-radio'); if (hr) hr.classList.remove('show');
    if (this.tagLayer) this.tagLayer.classList.remove('on');
    this.setHot(null);
  }

  /**
   * The night is called: the camera walks out through the open door into the dusk, slower than
   * a move between bays (the screen goes to the night's card meanwhile: main.leaveShop).
   */
  leave() {
    this.view = 'leave';
    this.wantPos = V(0.4, 1.75, OPEN_Z + 3.2); this.wantLook = V(0.8, 2.3, OPEN_Z - 30); this.wantFov = 58;
    this.camRate = 1.15;
    this.mouseIn = false;
    if (this.tagLayer) this.tagLayer.classList.remove('on');
    const hr = document.getElementById('hangar-radio'); if (hr) hr.classList.remove('show');
    this.setHot(null);
  }

  /** Fly to a bay ('hmg', 'arty', 'wall', 'support'), the duty board ('report') or the overview. */
  go(view, snap = false) {
    this.view = view;
    const b = BAYS.find((x) => x.id === view);
    // (the bay and the board are framed in the left of the screen: the panel is on the right)
    // (across the hall from it, framed in the left of the screen: the panel is on the right)
    const frame = (c, n, dist, h, lookH, side) => {
      const r = rightOf(n);
      this.wantPos = V(c.x + n.x * dist + r.x * side, h, c.z + n.z * dist + r.z * side);
      this.wantLook = V(c.x + r.x * (side + 0.05) - n.x * 0.4, lookH, c.z + r.z * (side + 0.05) - n.z * 0.4);
    };
    if (b) { frame(b, b.n, 6.6, 3.15, 0.8, 1.35); this.wantFov = 50; } else if (view === 'report') { frame(BOARD, BOARD.n, 4.4, 2.45, BOARD.y - 0.1, 1.45); this.wantFov = 46; } else { this.wantPos = V(-1.4, 3.5, OPEN_Z + 0.9); this.wantLook = V(0.9, 0.7, 11); this.wantFov = 64; }
    if (snap) { this.camPos.copy(this.wantPos); this.camLook.copy(this.wantLook); this.fov = this.wantFov; }
    const el = document.getElementById('s-shop');
    if (el) el.dataset.bay = view;
    this.setHot(null);
    this.g.screens && this.g.screens.shopView && this.g.screens.shopView(view);
  }

  /** Highlight one upgrade's slot (from the list or the cursor), or nothing. */
  setHot(id) {
    if (this.hot === id) return;
    this.hot = id;
    for (const [k, el] of Object.entries(this.tags || {})) el.classList.toggle('hot', k === id);
    document.querySelectorAll('#shop-upgrades .card').forEach((c) => c.classList.toggle('hot', c.dataset.id === id));
  }

  key(code) {
    const b = BAYS.find((x) => x.key === code);
    if (b) { this.go(b.id); return true; }
    if (code === 'Digit5') { this.go('report'); return true; }
    if (code === 'Escape' || code === 'Backspace' || code === 'Digit0') { this.go('overview'); return true; }
    const order = ['overview', ...BAYS.map((x) => x.id), 'report'];
    if (code === 'ArrowRight' || code === 'ArrowLeft') {
      const i = order.indexOf(this.view), j = (i + (code === 'ArrowRight' ? 1 : -1) + order.length) % order.length;
      this.go(order[j]); return true;
    }
    return false;
  }

  /**
   * The cursor, in client pixels. `over3d`: it is over the 3D view itself, not a panel or button
   * on top of it (only then does it pick things). The camera's drift follows it either way: a
   * cursor on a button is still where it is, and dropping the drift there made the view jump.
   */
  pointer(e, over3d = true) {
    const r = this.g.canvas.getBoundingClientRect();
    this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.mouse.clampScalar(-1, 1);
    this.mouseIn = over3d;
  }

  click() {
    if (!this.active || !this.mouseIn) return;
    const hit = this.pickAt();
    if (!hit) return;
    if (hit.slot) {
      const s = this.slots[hit.slot];
      if (this.view !== s.bay) this.go(s.bay);
      this.g.screens.focusCard && this.g.screens.focusCard(hit.slot);
      this.setHot(hit.slot);
    } else if (hit.bay && hit.bay !== this.view) this.go(hit.bay);
  }

  pickAt() {
    this.ray.setFromCamera(this.mouse, this.camera);
    if (this.view !== 'overview' && this.view !== 'report') {
      const hs = this.ray.intersectObjects(this.slotHits.filter((h) => this.slots[h.userData.slot].bay === this.view), false);
      if (hs.length) return { slot: hs[0].object.userData.slot };
    }
    const hb = this.ray.intersectObjects(this.bayHits, false);
    return hb.length ? { bay: hb[0].object.userData.bay } : null;
  }

  update(dt) {
    if (!this.active) return;
    this.t += dt;
    const cam = this.camera, t = this.t;
    // the camera: eased to where it is going, a little hand-held, a little toward the cursor
    const cr = this.camRate || 3.2, lr = this.camRate ? this.camRate * 1.4 : 3.8;
    this.camPos.x = damp(this.camPos.x, this.wantPos.x, cr, dt); this.camPos.y = damp(this.camPos.y, this.wantPos.y, cr, dt); this.camPos.z = damp(this.camPos.z, this.wantPos.z, cr, dt);
    this.camLook.x = damp(this.camLook.x, this.wantLook.x, lr, dt); this.camLook.y = damp(this.camLook.y, this.wantLook.y, lr, dt); this.camLook.z = damp(this.camLook.z, this.wantLook.z, lr, dt);
    this.fov = damp(this.fov, this.wantFov, 3, dt);
    // (eased, so even a cursor arriving from outside the window glides the view rather than snapping it)
    this.drift = this.drift || new THREE.Vector2();
    const lv = this.view === 'leave' ? 0 : 1; // walking out: the cursor lets go of the view
    this.drift.x = damp(this.drift.x, this.mouse.x * lv, 4, dt); this.drift.y = damp(this.drift.y, this.mouse.y * lv, 4, dt);
    const mx = this.drift.x, my = this.drift.y;
    cam.position.copy(this.camPos);
    cam.position.x += Math.sin(t * 0.31) * 0.05 + mx * 0.25; cam.position.y += Math.sin(t * 0.43) * 0.03 + my * 0.12;
    // a delivery landing jolts the camera, like a weight set down on the floor you stand on
    this.kick = Math.max(0, (this.kick || 0) * Math.exp(-dt * 5.5));
    const kk = this.kick;
    cam.position.y += Math.sin(t * 46) * 0.035 * kk - 0.04 * kk; cam.position.x += Math.sin(t * 39 + 1) * 0.02 * kk;
    cam.lookAt(_v.copy(this.camLook).add(_w.set(mx * 0.35, my * 0.2 - 0.05 * kk, 0)));
    const el = this.g.canvas, aspect = el.clientWidth / Math.max(1, el.clientHeight);
    const f = fitFov(this.fov, aspect);
    if (Math.abs(cam.aspect - aspect) > 1e-3 || Math.abs(cam.fov - f) > 0.01) { cam.aspect = aspect; cam.fov = f; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
    // the men stand easy
    for (const s of this.soldiers) { s.idle(); }
    // deliveries
    for (const s of Object.values(this.slots)) {
      for (const u of s.units) {
        const d = u.userData.drop;
        if (!d) continue;
        d.t += dt;
        if (d.t < 0) continue;
        const k = Math.min(1, d.t / 0.55);
        // falls, lands, settles with one small bounce
        const fall = 1 - k * k, bounce = k >= 1 ? 0 : 0;
        u.position.copy(u.userData.home).y += d.h * fall + bounce;
        if (k >= 1 && !d.landed) {
          d.landed = true; u.userData.drop = null;
          u.position.copy(u.userData.home);
          this.g.audio.delivery && this.g.audio.delivery();
          this.kick = Math.min(1.2, (this.kick || 0) + 0.7);
          u.updateMatrixWorld(true);
          this.puff(u.getWorldPosition(_v).clone());
        }
      }
      if (s.flash) s.flash = Math.max(0, s.flash - dt * 0.8);
    }
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i]; p.t += dt;
      const k = p.t / 1.1;
      p.m.scale.setScalar(0.6 + k * 2.2); p.m.material.opacity = 0.35 * (1 - k);
      if (k >= 1) { this.scene.remove(p.m); p.m.geometry.dispose(); p.m.material.dispose(); this.puffs.splice(i, 1); }
    }
    // the cursor: what it is over lights up
    const hit = this.mouseIn ? this.pickAt() : null;
    const over = hit && hit.slot ? hit.slot : null;
    if (over !== this.overSlot) { this.overSlot = over; if (over) this.g.audio.uiHover(); }
    const hotId = this.listHot || over;
    if (hotId !== this.hot) this.setHot(hotId);
    this.overBay = hit && hit.bay ? hit.bay : null;
    const hs = this.hot && this.slots[this.hot];
    this.pick.intensity = damp(this.pick.intensity, hs ? 26 : 0, 8, dt);
    this.ring.material.opacity = damp(this.ring.material.opacity, hs ? 0.4 + 0.15 * Math.sin(t * 5) : 0, 10, dt);
    if (hs) {
      this.pick.position.set(hs.center.x + 0.6, hs.center.y + 3.2, hs.center.z + 1.4);
      this.pick.target.position.copy(hs.center);
      this.ring.position.x = hs.center.x; this.ring.position.z = hs.center.z;
      const sz = new THREE.Box3().setFromObject(hs.hit).getSize(_w);
      this.ring.scale.setScalar(Math.min(1.8, Math.max(0.8, Math.hypot(sz.x, sz.z) * 0.5)));
    }
    this.shaft.material.uniforms.uT.value = t;
    this.motes.material.uniforms.uT.value = t;
    this.motes.material.uniforms.uPx.value = el.clientHeight;
    this.placeTags();
  }

  puff(at) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.55, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xb8a890, transparent: true, opacity: 0.35, depthWrite: false }));
    m.position.set(at.x, 0.05, at.z);
    this.scene.add(m);
    this.puffs.push({ m, t: 0 });
  }

  placeTags() {
    const cam = this.camera, el = this.g.canvas, w = el.clientWidth, h = el.clientHeight;
    const show = (tag, p, on) => {
      if (!on) { tag.style.opacity = 0; tag.style.pointerEvents = 'none'; return; }
      _v.copy(p).project(cam);
      if (_v.z > 1 || Math.abs(_v.x) > 1.1 || Math.abs(_v.y) > 1.1) { tag.style.opacity = 0; return; }
      tag.style.opacity = '';
      tag.style.transform = `translate(${((_v.x + 1) / 2 * w).toFixed(1)}px, ${((1 - _v.y) / 2 * h).toFixed(1)}px)`;
    };
    for (const s of Object.values(this.slots)) show(this.tags[s.id], s.anchor, this.view === s.bay);
    for (const b of BAYS) show(this.bayTags[b.id], _w.set(b.x + b.n.x * 2.2, 0.9, b.z + b.n.z * 2.2), this.view === 'overview');
    show(this.bayTags.report, _w.set(BOARD.x + 0.3, BOARD.y - 1.2, BOARD.z), this.view === 'overview');
    for (const [id, el2] of Object.entries(this.bayTags)) el2.classList.toggle('hot', this.overBay === id && this.view === 'overview');
  }
}
