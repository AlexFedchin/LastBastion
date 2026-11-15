// Civilians: the survivors on the road (the escort event, the column in the ending). Each is
// one of four Mixamo-rigged characters (app/models/survivor_*.glb, built by
// scripts/models/build_models.mjs survivors) moving to clips retargeted onto it at build time:
// three walks (sad, nursing an arm, limping), two runs, an idle and a death. Clips are sampled
// by hand, as for the soldiers.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { modelScene, modelClips } from '../world/models.js';
import { lampify, soldierClock } from './soldier.js';

export const ADULTS = ['man', 'woman', 'man2'];
export const WALKS = ['walk_sad', 'walk_arm', 'walk_leg'];

// ground speed (m/s) each in-place clip is played against: distance -> clip time
const GAIT = { walk_sad: 1.0, walk_arm: 1.0, walk_leg: 0.55, run_1: 3.0, run_2: 3.0 };

const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _v = new THREE.Vector3(), _w = new THREE.Vector3();
const wrap = (t, d) => ((t % d) + d) % d;

// clips per model: name -> { dur, times, tracks: [{ bone, pos, values }] }
const TABLES = {};
function clips(model) {
  if (TABLES[model]) return TABLES[model];
  const T = TABLES[model] = {};
  for (const c of modelClips('survivor_' + model)) {
    if (!c.tracks.length) continue;
    T[c.name] = {
      dur: c.duration, times: c.tracks[0].times,
      tracks: c.tracks.map((t) => { const [node, prop] = t.name.split('.'); return { bone: node.replace('mixamorig', ''), pos: prop === 'position', values: t.values }; }),
    };
  }
  return T;
}

let serial = 0;

export class Survivor {
  /** model: 'man' | 'woman' | 'man2' | 'child' */
  constructor(model) {
    this.isSurvivor = true;
    this.kind = model;
    this.child = model === 'child';
    this.root = new THREE.Group();     // placed and turned by the caller; forward = +z
    this.body = new THREE.Group();
    this.root.add(this.body);
    const m = cloneSkinned(modelScene('survivor_' + model));
    this.id = serial++;
    // a little variety in how washed-out each one's clothes are
    const shade = 0.78 + ((this.id * 0.37) % 1) * 0.22;
    m.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
      o.material = o.material.clone();
      o.material.color.setScalar(shade);
      lampify(o.material);
    });
    this.body.add(m);
    this.bones = {};
    m.traverse((o) => { if (o.isBone) this.bones[o.name.replace('mixamorig', '')] = o; });
    this.off = (this.id * 5.17) % 20;
    this.gait = 'walk_sad';
    this.runClip = this.id % 2 ? 'run_2' : 'run_1';
    this.root.visible = false;
  }

  dur(name) { const c = clips(this.kind)[name]; return c ? c.dur : 1; }

  /** Pose to clip `name` at time t. */
  play(name, t) {
    const c = clips(this.kind)[name];
    if (!c) return false;
    const T = c.times, n = T.length;
    let i = Math.min(n - 2, Math.max(0, Math.floor(t * 30)));
    while (i > 0 && T[i] > t) i--;
    while (i < n - 2 && T[i + 1] <= t) i++;
    const f = THREE.MathUtils.clamp((t - T[i]) / (T[i + 1] - T[i] || 1), 0, 1);
    for (const tr of c.tracks) {
      const b = this.bones[tr.bone];
      if (!b) continue;
      const v = tr.values;
      if (tr.pos) b.position.copy(_v.set(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]).lerp(_w.set(v[i * 3 + 3], v[i * 3 + 4], v[i * 3 + 5]), f));
      else b.quaternion.copy(_qa.fromArray(v, i * 4).slerp(_qb.fromArray(v, i * 4 + 4), f));
    }
    return true;
  }

  reset() { this.body.rotation.set(0, 0, 0); this.body.position.set(0, 0, 0); }

  /** Running for the gate; dist is how far they have come, in metres. */
  run(dist) { const c = this.runClip; this.play(c, wrap(dist / GAIT[c], this.dur(c))); }

  /** Walking in their own gait (this.gait); dist in metres. */
  walk(dist) { const c = this.gait; this.play(c, wrap(dist / GAIT[c], this.dur(c))); }

  /** How fast this gait carries them, relative to an ordinary walk (the limp is slow). */
  get pace() { return this.gait === 'walk_leg' ? 0.6 : 1; }

  idle() { this.play('idle_sad', wrap(soldierClock() + this.off, this.dur('idle_sad'))); }

  /** Caught t seconds ago: the death, played once and held. */
  die(t) { this.play('death', Math.min(t, this.dur('death') - 1e-3)); }
}
