// Aircraft lights: the position lights on the wingtips, the white anti-collision strobe and the
// red beacon, as real lamps on the airframe rather than glowing balls in the air.
//
// Each lamp is two things, both carried on the aircraft:
// - the lens itself, a small dome of glass that burns (HDR) when lit and is dark glass when not,
//   so up close you see the lamp on the wingtip, not a cloud of light around it;
// - a glint, a sprite of fixed size on screen: from far off a lamp is a point of light (the size
//   of the lens is under a pixel), and it stays a point however far it goes;
// - a halo, sized in metres: close up the lamp glows in the air round it, far off it shrinks
//   inside the glint.
// The strobe double-flashes the way the real ones do and, near the camera, lights the airframe
// for the length of the flash (a light from the effects pool).
import * as THREE from 'three';
import { fogMaterial } from '../render/atmosphere.js';

const COLOR = {
  red: new THREE.Color(1, 0.05, 0.025),
  green: new THREE.Color(0.08, 1, 0.32),
  white: new THREE.Color(1, 0.96, 0.9),
};
// how each kind of lamp burns over time: 0..1
const PATTERN = {
  steady: () => 1,
  // the anti-collision strobe: two quick flashes, then dark (period 1.2 s)
  strobe: (u) => (u < 0.04 || (u > 0.13 && u < 0.17) ? 1 : 0),
  // the red beacon: a rotating lamp, a soft pulse once a second
  beacon: (u) => Math.pow(Math.max(0, Math.cos(u * Math.PI * 2)), 10),
};
const PERIOD = { steady: 1, strobe: 1.2, beacon: 1.0 };

let glowTex = null;
function glow() {
  if (glowTex) return glowTex;
  // a tight core and a faint skirt: a lamp seen through a little haze
  const s = 64, c = document.createElement('canvas');
  c.width = c.height = s;
  const x = c.getContext('2d'), g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.12, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.18)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.04)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, s, s);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

const lensGeo = new THREE.SphereGeometry(1, 12, 8);
const _w = new THREE.Vector3(), _ws = new THREE.Vector3();

export class NavLights {
  /**
   * @param model    an aircraft from air.js / helis.js: { group, lights: { port, stbd, tail, belly? } }
   * @param opts.lens  the lens's radius in metres (world, whatever the model's scale)
   * @param opts.glint the glint's size on screen (fraction of the view's height)
   * @param opts.pool  the effects' light pool, for the strobe lighting the airframe (or null)
   * @param opts.phase offsets the flashing, so a formation doesn't flash as one
   */
  constructor(model, { lens = 0.12, glint = 0.015, pool = null, phase = 0 } = {}) {
    this.group = model.group;
    this.pool = pool;
    this.phase = phase;
    this.lensR = lens;
    this.glint = glint;
    this.lamps = [];
    const L = model.lights;
    const add = (at, color, kind, k = 1) => { if (at) this.lamps.push(this.make(at, color, kind, k)); };
    add(L.port, 'red', 'steady');
    add(L.stbd, 'green', 'steady');
    add(L.tail, 'white', 'strobe', 1.6);
    add(L.belly, 'red', 'beacon', 1.2);
    this.scale = -1;
  }

  make(at, color, kind, k) {
    const c = COLOR[color];
    const lens = new THREE.Mesh(lensGeo, new THREE.MeshBasicMaterial({ color: 0x050505, depthWrite: false }));
    lens.renderOrder = 6; // (no depth of its own: its glint sits at its centre and must show through it)
    lens.position.copy(at);
    const m = new THREE.SpriteMaterial({ map: glow(), color: 0x000000, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: false });
    fogMaterial(m, { add: true }); // (additive: the fog takes it away rather than tinting it)
    const sp = new THREE.Sprite(m);
    sp.position.copy(at);
    sp.renderOrder = 7;
    // the halo: light scattered in the air and the housing round the lamp, sized in metres, so
    // close up the lamp glows and far off it shrinks inside the glint
    const hm = new THREE.SpriteMaterial({ map: glow(), color: 0x000000, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    hm.defines = { LB_FOG_ADD: '' };
    const halo = new THREE.Sprite(hm);
    halo.position.copy(at);
    halo.renderOrder = 7;
    this.group.add(lens, sp, halo);
    return { lens, sp, halo, c, kind, k, was: 0 };
  }

  /** Light the lamps for time t (seconds); camera: to light the airframe with the strobe when close. */
  update(t, camera = null) {
    this.group.getWorldScale(_ws);
    const s = _ws.x || 1;
    if (Math.abs(s - this.scale) > 1e-6) {
      // (the lens and glint are children of the aircraft: undo its scale so they keep their sizes)
      this.scale = s;
      for (const l of this.lamps) {
        l.lens.scale.setScalar(this.lensR / s);
        l.base = this.glint / s;
        l.halo.scale.setScalar((this.lensR * 9) / s);
      }
    }
    for (const l of this.lamps) {
      const u = (((t / PERIOD[l.kind] + this.phase) % 1) + 1) % 1;
      const on = PATTERN[l.kind](u);
      // the lens: dark glass, burning when lit
      const e = 2.6 * l.k * on; // (bright, but not so far over that the tone curve bleaches the red to pink)
      l.lens.material.color.setRGB(0.02 + l.c.r * e, 0.02 + l.c.g * e, 0.022 + l.c.b * e);
      // the glint: brighter and a little bigger for the flash lamps
      l.sp.material.color.copy(l.c).multiplyScalar(4.5 * l.k * on);
      l.sp.scale.setScalar(l.base * (l.kind === 'steady' ? 1 : 1 + 0.8 * on));
      l.sp.visible = on > 0.01;
      l.halo.material.color.copy(l.c).multiplyScalar(1.4 * l.k * on);
      l.halo.visible = l.sp.visible;
      // the strobe lights the airframe up for its flash, near the camera only (the pool is small)
      if (l.kind === 'strobe' && on > 0 && !l.was && this.pool && camera) {
        l.lens.getWorldPosition(_w);
        if (_w.distanceTo(camera.position) < 140) this.pool.flash(_w.x, _w.y, _w.z, 0xf4f2ff, 26, 16, 0.06);
      }
      l.was = on;
    }
  }
}
