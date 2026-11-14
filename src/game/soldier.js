// Soldiers on our side: the rigged contractor model (app/models/soldier.glb),
// posed by hand every frame. The model's own pose is the rifle at the ready,
// pointing ~25° up; everything here is a rotation away from that, applied in
// model space (x = his left, y = up, z = forward) so it doesn't depend on how
// each Mixamo bone happens to be oriented.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { modelScene } from '../world/models.js';

const REST_ELEV = 25 * Math.PI / 180;     // the rifle's elevation in the model's own pose
const MUZZLE = new THREE.Vector3(0.053, 1.59, 0.96); // printed by build_models.mjs soldier
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

// the sodium lamps on the wall light our men the way they light the dead (see zombieModel.js)
let lampUniforms = null;
export function setSoldierLamps(u) { lampUniforms = u; }
const patched = new WeakSet();
function patchLamps(mat) {
  if (patched.has(mat) || !lampUniforms) return;
  patched.add(mat);
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uLamps = lampUniforms.uLamps;
    sh.uniforms.uLampPow = lampUniforms.uLampPow;
    sh.fragmentShader = 'uniform vec3 uLamps[10]; uniform float uLampPow;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      #ifdef USE_FOG
      if (uLampPow > 0.001) {
        vec3 sWN = normalize(transpose(mat3(viewMatrix)) * normal);
        float sLamp = 0.0;
        for (int k = 0; k < 10; k++) {
          vec3 L = uLamps[k] - vLbFogW; float d = length(L);
          float att = clamp(1.0 - d / 17.0, 0.0, 1.0);
          sLamp += att * att * (0.25 + 0.75 * clamp(dot(sWN, L / max(d, 1e-3)), 0.0, 1.0));
        }
        totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.52, 0.18) * sLamp * uLampPow * 2.2;
      }
      #endif`);
  };
  mat.customProgramCacheKey = () => 'soldier-lamps-v1';
}

export class Soldier {
  constructor() {
    this.isSoldier = true;
    this.root = new THREE.Group();     // placed and turned by the caller; forward = +z
    this.body = new THREE.Group();     // falls over when he is killed
    this.root.add(this.body);
    const m = cloneSkinned(modelScene('soldier'));
    m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; patchLamps(o.material); } });
    this.body.add(m);
    this.bones = {};
    m.traverse((o) => { if (o.isBone) this.bones[o.name.replace('mixamorig', '')] = o; });
    // rest: each bone's local rotation and its rotation in model space
    m.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(m.matrixWorld).invert();
    this.rest = {};
    for (const [k, b] of Object.entries(this.bones)) {
      const w = new THREE.Quaternion();
      new THREE.Matrix4().multiplyMatrices(inv, b.matrixWorld).decompose(new THREE.Vector3(), w, new THREE.Vector3());
      this.rest[k] = { local: b.quaternion.clone(), model: w };
    }
    // the muzzle rides the right hand
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.copy(MUZZLE);
    this.body.add(this.muzzle);
    this.body.updateMatrixWorld(true);
    this.bones.RightHand.attach(this.muzzle);
    this.root.visible = false;
  }

  /** Rotate a bone by `angle` about a model-space axis, on top of its rest pose. */
  turn(name, axis, angle) {
    const b = this.bones[name], r = this.rest[name];
    if (!b) return;
    // local = rest * (W^-1 * R * W): a model-space rotation expressed in the bone's frame
    _q.setFromAxisAngle(axis, angle);
    _q2.copy(r.model).invert().multiply(_q).multiply(r.model);
    b.quaternion.copy(r.local).multiply(_q2);
  }

  reset() {
    for (const [k, r] of Object.entries(this.rest)) this.bones[k].quaternion.copy(r.local);
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
  }

  /**
   * Standing, rifle pointed `elev` radians above the horizon and `yaw` to his left;
   * kick (0..1) is the recoil of the last shot.
   */
  aim(elev, yaw = 0, kick = 0) {
    this.reset();
    const bend = THREE.MathUtils.clamp(REST_ELEV - elev - kick * 0.06, -0.5, 1.05);
    for (const s of ['Spine', 'Spine1', 'Spine2']) { this.turn(s, X, bend / 3); }
    if (yaw) this.turn('Spine', Y, yaw);
    // lean into it a little; knees soft
    this.turn('LeftUpLeg', X, -0.12); this.turn('RightUpLeg', X, 0.1);
  }

  /** A running (or, carrying, a heavy shuffling) step; ph is the stride phase. */
  run(ph, carry = false) {
    this.reset();
    const s = Math.sin(ph), c = Math.cos(ph), a = carry ? 0.4 : 0.75;
    this.turn('LeftUpLeg', X, -s * a - 0.1);
    this.turn('RightUpLeg', X, s * a - 0.1);
    this.turn('LeftLeg', X, Math.max(0, -c) * (carry ? 0.7 : 1.3) + 0.1);
    this.turn('RightLeg', X, Math.max(0, c) * (carry ? 0.7 : 1.3) + 0.1);
    // rifle low and across the chest when running; bent over the load when carrying
    const bend = carry ? 0.75 : REST_ELEV + 0.25;
    for (const sp of ['Spine', 'Spine1', 'Spine2']) this.turn(sp, X, bend / 3);
    this.turn('Spine', Y, s * 0.12);
    this.body.position.y = Math.abs(c) * (carry ? 0.03 : 0.06) - 0.04;
  }

  /** Bent over the crate, working the straps. */
  work(t) {
    this.reset();
    for (const sp of ['Spine', 'Spine1', 'Spine2']) this.turn(sp, X, 0.42 + Math.sin(t * 5) * 0.03);
    this.turn('LeftUpLeg', X, -0.5); this.turn('RightUpLeg', X, -0.3);
    this.turn('LeftLeg', X, 0.8); this.turn('RightLeg', X, 0.5);
    this.body.position.y = -0.12;
  }

  /** Down: k goes 0 -> 1 as he falls. */
  fall(k) {
    this.body.rotation.x = -k * Math.PI / 2;
    this.body.position.y = 0.12 * k;
  }
}
