// The gunner: camera, the M2HB model, recoil, heat and every bullet.
import * as THREE from 'three';
import { raycastGround } from '../world/terrain.js';
import { WORLD, HEADSHOT_FRAC, HEADSHOT_MULT } from '../config.js';
import { clamp, damp, rand, fitFov } from '../core/util.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function mergeGeoms(list) {
  return mergeGeometries(list.map((g) => {
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    return g;
  }));
}

const DEG = Math.PI / 180;
const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _m = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();

export class Player {
  constructor(camera, scene, fx, audio, horde) {
    this.camera = camera;
    this.scene = scene;
    this.fx = fx;
    this.audio = audio;
    this.horde = horde;
    this.yaw = 0;
    this.pitch = -9 * DEG;
    this.yawLimit = 106 * DEG;
    this.pitchMin = -74 * DEG;
    this.pitchMax = 14 * DEG;
    this.recoilP = 0; this.recoilY = 0;
    this.trauma = 0;
    this.baseFov = 62;
    this.fov = 62;
    this.zoom = 0;
    this.sens = 0.0022;
    this.invertY = false;

    this.heat = 0;
    this.overheatT = 0;
    this.fireAcc = 0;
    this.sinceShot = 10;
    this.bloom = 0;
    this.shots = 0; this.hits = 0;
    this.firing = false;
    this.onHit = null;   // (killed, headshot)
    this.onOverheat = null;

    camera.rotation.order = 'YXZ';
    camera.position.set(WORLD.CAM.x, WORLD.CAM.y, WORLD.CAM.z);
    scene.add(camera);
    this.buildGun();

    this.muzzleLight = new THREE.PointLight(0xffa04a, 0, 28, 1.8);
    scene.add(this.muzzleLight);
    this.nestLight = new THREE.PointLight(0xff8040, 1.6, 7, 2);
    this.nestLight.position.set(0.5, WORLD.CAM.y + 0.9, WORLD.CAM.z + 1.4);
    scene.add(this.nestLight);
  }

  // ── M2HB model ───────────────────────────────────────────────────────────
  buildGun() {
    const g = new THREE.Group();
    // parkerized steel with object-space wear: dark and matte overall, so the
    // burning horizon never turns it into a mirror, bare metal on the edges
    const wear = (mat, k = 1) => {
      mat.onBeforeCompile = (sh) => {
        sh.vertexShader = 'varying vec3 vGP;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvGP = position;');
        sh.fragmentShader = `varying vec3 vGP;
          float gH(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
          float gN(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
            return mix(mix(mix(gH(i), gH(i + vec3(1,0,0)), f.x), mix(gH(i + vec3(0,1,0)), gH(i + vec3(1,1,0)), f.x), f.y),
                       mix(mix(gH(i + vec3(0,0,1)), gH(i + vec3(1,0,1)), f.x), mix(gH(i + vec3(0,1,1)), gH(i + vec3(1,1,1)), f.x), f.y), f.z); }
        ` + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
          float gw = gN(vGP * 60.0) * 0.55 + gN(vGP * 220.0) * 0.45;
          diffuseColor.rgb *= 0.82 + 0.3 * gw;
          float gScuff = smoothstep(0.62, 0.8, gN(vGP * 38.0 + 3.0)) * ${k.toFixed(2)};
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.32, 0.31, 0.3), gScuff * 0.6);`)
          .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = clamp(roughnessFactor * (0.85 + 0.3 * gw) - gScuff * 0.35, 0.18, 1.0);`)
          .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
          metalnessFactor = mix(metalnessFactor, 0.85, gScuff);`);
      };
      mat.customProgramCacheKey = () => 'gunwear' + k + mat.color.getHex();
      return mat;
    };
    const metal = wear(new THREE.MeshPhysicalMaterial({ color: 0x303234, metalness: 0.3, roughness: 0.78, specularIntensity: 0.14, envMapIntensity: 0.35 }));
    const worn = wear(new THREE.MeshPhysicalMaterial({ color: 0x5c5e60, metalness: 0.7, roughness: 0.42, specularIntensity: 0.3, envMapIntensity: 0.5 }), 0.4);
    const olive = wear(new THREE.MeshPhysicalMaterial({ color: 0x363b23, metalness: 0.05, roughness: 0.85, specularIntensity: 0.15 }), 0.6);
    const rubber = new THREE.MeshPhysicalMaterial({ color: 0x141414, metalness: 0, roughness: 0.92, specularIntensity: 0.1 });
    const brass = new THREE.MeshStandardMaterial({ color: 0x9a7a35, metalness: 0.95, roughness: 0.3, envMapIntensity: 2 });
    const tipMat = new THREE.MeshStandardMaterial({ color: 0x2a1a14, metalness: 0.6, roughness: 0.5 });
    const linkMat = new THREE.MeshStandardMaterial({ color: 0x1d1e1f, metalness: 0.7, roughness: 0.55 });
    this.barrelMat = new THREE.MeshPhysicalMaterial({ color: 0x2a2b2c, metalness: 0.25, roughness: 0.8, specularIntensity: 0.15, emissive: 0x000000, envMapIntensity: 0.3 });

    // perforated barrel jacket texture
    const jc = document.createElement('canvas'); jc.width = 256; jc.height = 64;
    const jx = jc.getContext('2d');
    jx.fillStyle = '#6a6c6e'; jx.fillRect(0, 0, 256, 64);
    for (let r = 0; r < 4; r++) for (let k = 0; k < 16; k++) {
      jx.fillStyle = '#050505'; jx.beginPath(); jx.ellipse(k * 16 + (r % 2) * 8 + 4, r * 16 + 8, 4.2, 5.2, 0, 0, 7); jx.fill();
      jx.strokeStyle = 'rgba(160,160,160,0.6)'; jx.lineWidth = 1; jx.stroke();
    }
    const jtex = new THREE.CanvasTexture(jc); jtex.colorSpace = THREE.SRGBColorSpace; jtex.wrapS = jtex.wrapT = THREE.RepeatWrapping; jtex.anisotropy = 8;
    const jacketMat = new THREE.MeshPhysicalMaterial({ map: jtex, color: 0x6a6c70, metalness: 0.35, roughness: 0.7, specularIntensity: 0.15, envMapIntensity: 0.35 });
    // ammo can stencil
    const ac = document.createElement('canvas'); ac.width = 256; ac.height = 128;
    const ax = ac.getContext('2d');
    ax.fillStyle = '#3b4126'; ax.fillRect(0, 0, 256, 128);
    ax.fillStyle = '#c9b77a'; ax.font = 'bold 22px Arial'; ax.textAlign = 'center';
    ax.fillText('CTG CAL .50', 128, 44); ax.font = '16px Arial'; ax.fillText('100 CTGS  M2  LINKED', 128, 70); ax.fillText('4 BALL  1 TRACER', 128, 92);
    const atex = new THREE.CanvasTexture(ac); atex.colorSpace = THREE.SRGBColorSpace;
    const canSide = new THREE.MeshPhysicalMaterial({ map: atex, metalness: 0.05, roughness: 0.82, specularIntensity: 0.15 });

    const parts = new Map();
    const put = (mat, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
      geo.rotateX(rx); geo.rotateY(ry); geo.rotateZ(rz); geo.translate(x, y, z);
      if (!parts.has(mat)) parts.set(mat, []);
      parts.get(mat).push(geo.index ? geo.toNonIndexed() : geo);
    };
    const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    const C = (r, l, seg = 14) => new THREE.CylinderGeometry(r, r, l, seg).rotateX(Math.PI / 2);   // along z
    const Cx = (r, l, seg = 10) => new THREE.CylinderGeometry(r, r, l, seg).rotateZ(Math.PI / 2);  // along x

    // receiver: chamfered side profile extruded across
    {
      const sh = new THREE.Shape();
      const P = [[-0.07, 0.105], [-0.85, 0.105], [-0.87, 0.085], [-0.87, -0.06], [-0.62, -0.105], [-0.09, -0.105], [-0.07, -0.085]];
      sh.moveTo(P[0][0], P[0][1]); for (let i = 1; i < P.length; i++) sh.lineTo(P[i][0], P[i][1]);
      const ex = new THREE.ExtrudeGeometry(sh, { depth: 0.19, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1 });
      ex.translate(0, 0, -0.095);
      ex.rotateY(-Math.PI / 2);
      put(metal, ex);
    }
    // side plates, rivets, the belt opening
    for (const s of [-1, 1]) {
      put(metal, B(0.006, 0.15, 0.5), s * 0.1, -0.005, -0.42);
      for (let k = 0; k < 7; k++) for (let r = 0; r < 2; r++) put(worn, Cx(0.0065, 0.214, 8), 0, -0.055 + r * 0.1, -0.2 - k * 0.075);
    }
    put(linkMat, B(0.012, 0.05, 0.12), -0.103, 0.05, -0.46);
    put(linkMat, B(0.012, 0.05, 0.12), 0.103, -0.06, -0.45);  // ejection port
    // feed cover with latch & hinge, top cover rails
    put(worn, B(0.2, 0.028, 0.34), 0, 0.123, -0.44);
    put(metal, B(0.06, 0.03, 0.045), 0, 0.142, -0.27);
    put(worn, Cx(0.012, 0.21, 10), 0, 0.12, -0.615);
    for (const s of [-1, 1]) put(metal, B(0.012, 0.012, 0.3), s * 0.09, 0.14, -0.45);
    // rear leaf sight (raised) and front post
    put(metal, B(0.05, 0.012, 0.05), 0, 0.118, -0.18);
    for (const s of [-1, 1]) put(metal, B(0.006, 0.09, 0.012), s * 0.02, 0.165, -0.18);
    put(worn, B(0.04, 0.012, 0.01), 0, 0.2, -0.18);
    put(worn, B(0.034, 0.03, 0.006), 0, 0.17, -0.18);
    put(metal, B(0.04, 0.02, 0.05), 0, 0.118, -0.82);
    put(worn, B(0.008, 0.06, 0.008), 0, 0.155, -0.82);
    for (const s of [-1, 1]) put(metal, B(0.006, 0.05, 0.03), s * 0.016, 0.145, -0.82);
    // backplate, buffer boss, spade grips and the butterfly trigger
    put(metal, B(0.214, 0.235, 0.045), 0, -0.002, -0.05);
    put(metal, C(0.034, 0.05, 14), 0, 0.0, -0.01);
    for (const s of [-1, 1]) {
      put(metal, B(0.05, 0.03, 0.08), s * 0.07, 0.06, -0.0);
      put(metal, B(0.05, 0.03, 0.08), s * 0.07, -0.08, -0.0);
      const grip = new THREE.CylinderGeometry(0.02, 0.022, 0.165, 12);
      put(rubber, grip, s * 0.088, -0.01, 0.045, 0.08, 0, s * 0.12);
      for (let k = 0; k < 5; k++) put(rubber, new THREE.TorusGeometry(0.021, 0.003, 4, 12).rotateX(Math.PI / 2), s * 0.088 + s * 0.12 * (-0.06 + k * 0.03) * 0.15, -0.07 + k * 0.03, 0.045);
    }
    put(worn, B(0.075, 0.012, 0.03), 0, 0.02, -0.0, 0.25);
    put(worn, B(0.03, 0.04, 0.012), 0, 0.03, 0.018);
    // charging handle on its rail (right side)
    put(metal, B(0.012, 0.03, 0.32), 0.108, 0.0, -0.48);
    put(worn, Cx(0.012, 0.06, 10), 0.14, 0.0, -0.44);
    put(worn, B(0.02, 0.05, 0.02), 0.168, 0.0, -0.44);
    // trunnion block & barrel support
    put(metal, B(0.22, 0.19, 0.07), 0, -0.005, -0.885);
    put(metal, C(0.07, 0.04, 18), 0, 0.02, -0.93);
    // perforated jacket
    const jacket = new THREE.CylinderGeometry(0.055, 0.055, 0.36, 24, 1, true).rotateX(Math.PI / 2);
    const juv = jacket.attributes.uv;
    for (let i = 0; i < juv.count; i++) juv.setXY(i, juv.getX(i) * 2, juv.getY(i) * 2.2);
    put(jacketMat, jacket, 0, 0.02, -1.13);
    put(metal, C(0.06, 0.03, 20), 0, 0.02, -0.96);
    put(metal, C(0.06, 0.03, 20), 0, 0.02, -1.3);
    // barrel, carrying handle, flash hider
    put(this.barrelMat, C(0.026, 0.86, 16), 0, 0.02, -1.72);
    put(this.barrelMat, C(0.031, 0.04, 14), 0, 0.02, -1.36);
    put(this.barrelMat, new THREE.CylinderGeometry(0.044, 0.03, 0.12, 14, 1, true).rotateX(Math.PI / 2), 0, 0.02, -2.13);
    put(worn, C(0.034, 0.03, 12), 0, 0.02, -1.38);
    put(olive, new THREE.TorusGeometry(0.075, 0.012, 6, 14, Math.PI).rotateY(Math.PI / 2), -0.0, 0.07, -1.38, 0, 0, 0.5);
    put(olive, C(0.016, 0.11, 8), -0.035, 0.135, -1.38);
    // cradle, pintle, traverse & elevation gear
    put(metal, B(0.13, 0.07, 0.42), 0, -0.145, -0.5);
    put(metal, B(0.17, 0.03, 0.12), 0, -0.19, -0.5);
    put(metal, new THREE.CylinderGeometry(0.045, 0.05, 0.62, 14), 0, -0.5, -0.52);
    put(metal, new THREE.CylinderGeometry(0.07, 0.07, 0.05, 16), 0, -0.21, -0.52);
    put(worn, new THREE.CylinderGeometry(0.012, 0.012, 0.22, 8), 0, -0.25, -0.22);
    put(metal, new THREE.TorusGeometry(0.05, 0.008, 6, 16).rotateX(Math.PI / 2), 0, -0.33, -0.22);
    for (let k = 0; k < 3; k++) put(metal, B(0.1, 0.006, 0.006).rotateY(k * Math.PI / 3), 0, -0.33, -0.22);
    // ammo can with lid, latch and handle; feed tray bracket
    put(olive, B(0.15, 0.19, 0.3), -0.24, -0.08, -0.46);
    put(olive, B(0.158, 0.025, 0.31), -0.24, 0.022, -0.46);
    put(worn, B(0.03, 0.03, 0.02), -0.24, 0.0, -0.31);
    put(olive, B(0.1, 0.01, 0.02), -0.24, 0.04, -0.46);
    put(canSide, new THREE.PlaneGeometry(0.28, 0.16).rotateY(-Math.PI / 2), -0.316, -0.085, -0.46);
    put(metal, B(0.12, 0.012, 0.16), -0.15, 0.018, -0.46);

    for (const [mat, list] of parts) {
      const geo = mergeGeoms(list);
      const m = new THREE.Mesh(geo, mat);
      g.add(m);
    }

    // the belt: rounds with links, animated as it feeds
    this.belt = new THREE.Group();
    g.add(this.belt);
    const caseG = C(0.011, 0.1, 8).translate(0, 0, 0).rotateY(Math.PI / 2);
    const tipG = new THREE.CylinderGeometry(0.0, 0.011, 0.045, 8).rotateZ(-Math.PI / 2).translate(0.072, 0, 0);
    const linkG = B(0.03, 0.026, 0.026).translate(-0.01, 0, 0);
    for (let k = 0; k < 11; k++) {
      const t = k / 10;
      const r = new THREE.Group();
      r.add(new THREE.Mesh(caseG, brass), new THREE.Mesh(tipG, k % 5 === 0 ? new THREE.MeshStandardMaterial({ color: 0x3a1a12, roughness: 0.55, metalness: 0.4 }) : tipMat), new THREE.Mesh(linkG, linkMat));
      r.rotation.y = Math.PI / 2;
      r.userData.t = t;
      this.belt.add(r);
    }

    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0.02, -2.19);
    g.add(this.muzzle);
    this.ejector = new THREE.Object3D();
    this.ejector.position.set(0.11, -0.05, -0.45);
    g.add(this.ejector);

    g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    this.gunBase = new THREE.Vector3(0.02, -0.43, 0.0);
    g.position.copy(this.gunBase);
    this.gun = g;
    this.camera.add(g);
  }

  reset() {
    this.yaw = 0; this.pitch = -9 * DEG;
    this.heat = 0; this.overheatT = 0; this.fireAcc = 0; this.wasFiring = false;
    this.recoilP = 0; this.recoilY = 0; this.trauma = 0; this.bloom = 0;
    this.shots = 0; this.hits = 0;
  }

  addTrauma(a) { this.trauma = Math.min(1, this.trauma + a); }

  /** Ground point under the crosshair (for artillery etc.) */
  aimPoint(maxDist = 320) {
    this.camera.getWorldDirection(_d);
    const o = this.camera.position;
    if (_d.y < -0.01) {
      const gt = raycastGround(o.x, o.y, o.z, _d.x, _d.y, _d.z, maxDist + 40);
      const t = Math.min(gt >= 0 ? gt : -o.y / _d.y, maxDist);
      return new THREE.Vector3(o.x + _d.x * t, 0, o.z + _d.z * t);
    }
    const h = Math.hypot(_d.x, _d.z) || 1;
    return new THREE.Vector3(o.x + (_d.x / h) * maxDist, 0, o.z + (_d.z / h) * maxDist);
  }

  update(dt, rdt, input, stats, controlsActive, time) {
    // look
    if (controlsActive) {
      const z = 1 - this.zoom * 0.55;
      this.yaw -= input.dx * this.sens * z;
      this.pitch -= input.dy * this.sens * z * (this.invertY ? -1 : 1);
    }
    this.yaw = clamp(this.yaw, -this.yawLimit, this.yawLimit);
    this.pitch = clamp(this.pitch, this.pitchMin, this.pitchMax);

    // zoom (RMB)
    const wantZoom = controlsActive && input.mouse(2) ? 1 : 0;
    this.zoom = damp(this.zoom, wantZoom, 12, rdt);
    this.fov = fitFov(this.baseFov, this.camera.aspect) * (1 - this.zoom * 0.52);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) { this.camera.fov = this.fov; this.camera.updateProjectionMatrix(); }

    // recoil recovery
    this.recoilP = damp(this.recoilP, 0, 9, dt);
    this.recoilY = damp(this.recoilY, 0, 9, dt);
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    const sh = this.trauma * this.trauma;
    const sy = sh * 0.035 * (Math.sin(time * 37.1) + Math.sin(time * 23.7) * 0.6);
    const sp = sh * 0.03 * (Math.sin(time * 41.3 + 1) + Math.sin(time * 19.1) * 0.6);
    const sr = sh * 0.04 * Math.sin(time * 29.3 + 2);
    this.camera.rotation.set(this.pitch + this.recoilP + sp, this.yaw + this.recoilY + sy, sr);
    this.camera.position.set(WORLD.CAM.x, WORLD.CAM.y, WORLD.CAM.z);
    this.camera.updateMatrixWorld(true);

    if (this.overheatT > 0) this.overheatT -= dt;

    // firing
    const canFire = controlsActive && this.overheatT <= 0;
    this.firing = canFire && input.mouse(0);
    if (this.firing) {
      this.fireAcc += dt * stats.hmgRate;
      while (this.fireAcc >= 1) {
        this.fireAcc -= 1;
        this.shoot(stats);
        if (this.heat >= 1) {
          this.overheatT = stats.overheatLock;
          this.fireAcc = 0;
          this.audio.overheat();
          if (this.onOverheat) this.onOverheat();
          break;
        }
      }
      this.sinceShot = 0;
    } else {
      this.fireAcc = Math.min(this.fireAcc, 0.999);
      if (!input.mouse(0)) this.fireAcc = 0.999; // first shot fires instantly
      this.sinceShot += dt;
    }
    // the barrel ticks and hisses as it cools after a burst
    if (this.firing && !this.wasFiring) this.audio.stopCool();
    else if (!this.firing && this.wasFiring) this.audio.barrelCool(this.heat);
    this.wasFiring = this.firing;
    // cooling
    const cool = stats.hmgCool + (this.sinceShot > 0.3 ? stats.hmgCoolIdle : 0);
    if (this.overheatT <= 0) this.heat = Math.max(0, this.heat - cool * dt);
    else this.heat = Math.max(0.6, this.heat - 0.12 * dt);
    this.bloom = damp(this.bloom, 0, this.firing ? 2 : 7, dt);

    // gun visuals: kickback, sway, glowing barrel, belt feed
    const kick = this.gunKick || 0;
    this.gunKick = damp(kick, 0, 18, dt);
    this.gun.position.set(this.gunBase.x + (Math.random() - 0.5) * kick * 0.15,
      this.gunBase.y + (Math.random() - 0.5) * kick * 0.1,
      this.gunBase.z + kick);
    this.gun.rotation.set(kick * 0.6, 0, 0);
    const h = this.heat;
    this.barrelMat.emissive.setRGB(h * h * 2.2, h * h * h * 0.55, h * h * h * h * 0.08);
    for (const r of this.belt.children) {
      const t = (r.userData.t + (this.beltPhase || 0)) % 1;
      r.position.set(-0.27 + t * 0.17, 0.035 + Math.sin(t * Math.PI) * 0.045, -0.46 + (t - 0.5) * 0.0);
      r.rotation.z = Math.cos(t * Math.PI) * 0.6;
    }
    this.muzzleLight.intensity = damp(this.muzzleLight.intensity, 0, 40, dt);
  }

  shoot(stats) {
    const cam = this.camera;
    const fx = this.fx, horde = this.horde;
    this.shots++;
    this.heat = Math.min(1, this.heat + stats.hmgHeat);

    // direction with spread
    const spread = (stats.hmgSpread + this.bloom) * (1 - this.zoom * 0.6);
    this.bloom = Math.min(0.028, this.bloom + 0.0011);
    cam.getWorldDirection(_d);
    _right.set(1, 0, 0).applyQuaternion(cam.quaternion);
    _up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
    _d.addScaledVector(_right, Math.cos(a) * r).addScaledVector(_up, Math.sin(a) * r).normalize();
    const o = cam.position;

    // hits
    const maxHits = 1 + stats.hmgPen;
    const gt = raycastGround(o.x, o.y, o.z, _d.x, _d.y, _d.z, 600);
    const groundT = gt >= 0 ? gt : 600;
    const cnt = horde.raycast(o.x, o.y, o.z, _d.x, _d.y, _d.z, Math.min(groundT, 600), maxHits);
    let endT = Math.min(groundT, 600);
    let stopped = false;
    let dmg = stats.hmgDamage;
    let anyHit = false;
    for (let k = 0; k < cnt; k++) {
      const t = horde.hitT[k];
      if (t > endT) break;
      const i = horde.hitIdx[k];
      const frac = horde.hitFrac[k];
      const head = frac > HEADSHOT_FRAC;
      const px = o.x + _d.x * t, py = o.y + _d.y * t, pz = o.z + _d.z * t;
      const killed = horde.damage(i, dmg * (head ? HEADSHOT_MULT : 1), 'hmg', _d.x, _d.y, _d.z, head && !stopped);
      fx.fleshHit(px, py, pz, _d.x, _d.y, _d.z, head ? 1.5 : 1);
      fx.bulletFlesh(px, py, pz, _d.x, _d.y, _d.z, clamp(t / 45, 1, 3), head);
      this.audio.flesh(px, pz, head && killed);
      if (stats.hmgIncendiary > 0 && Math.random() < stats.hmgIncendiary && !killed) horde.ignite(i, 4, 28);
      if (stats.hmgHE) {
        fx.explosion(px, py, pz, 0.22, { dirt: false, scorch: false, light: false });
        horde.explode(px, py, pz, 2.2, 32, 'he', { push: 0.4 });
      }
      anyHit = true;
      if (this.onHit) this.onHit(killed, head);
      dmg *= 0.72;
      if (k === maxHits - 1) { endT = t; stopped = true; }
    }
    if (anyHit) this.hits++;

    // visuals
    this.muzzle.getWorldPosition(_m);
    const ex = o.x + _d.x * endT, ey = Math.max(0, o.y + _d.y * endT), ez = o.z + _d.z * endT;
    // every round is a tracer; alternate brightness like a real belt mix
    fx.tracer(_m.x, _m.y, _m.z, ex, ey, ez, 560, this.shots % 3 === 0 ? 1.4 : 0.75);
    // the round's path, faintly, so you can see where the burst is going
    fx.bulletPath(_m.x, _m.y, _m.z, ex, ey, ez, this.zoom > 0.5 ? 0.6 : 1, this.zoom > 0.5 ? 20 : 12);
    if (!stopped && groundT < 600) fx.bulletGround(ex, ez, clamp(endT / 45, 1, 3));
    // a modest flash: it's in your face all night, so it shouldn't shout
    fx.muzzle(_m.x, _m.y, _m.z, _d.x, _d.y, _d.z, 0.7);
    this.muzzleLight.position.copy(_m);
    this.muzzleLight.intensity = rand(5, 8);
    // casing out to the right
    this.ejector.getWorldPosition(_v);
    _right.set(1, 0, 0).applyQuaternion(cam.quaternion);
    fx.casing(_v.x, _v.y, _v.z, _right.x, _right.z);
    this.audio.hmg();
    this.audio.casing();
    // recoil
    this.recoilP += 0.0045 + Math.random() * 0.002;
    this.recoilY += (Math.random() - 0.5) * 0.004;
    this.gunKick = 0.045;
    this.beltPhase = ((this.beltPhase || 0) + 0.11) % 1;
    this.addTrauma(0.06);
  }
}
