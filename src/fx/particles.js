// GPU-billboarded particle system. CPU integrates, GPU orients quads.
// Supports round (rotating) billboards and velocity-stretched streaks
// (tracers, sparks, blood jets) with correct perspective.
import * as THREE from 'three';
import { FOG_CUSTOM_GLSL } from '../render/atmosphere.js';

const VERT = /* glsl */`
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iData;   // size, rotation, stretch, frame
attribute vec4 iColor;  // rgb (HDR), alpha
uniform vec2 uAtlas;
varying vec2 vUv;
varying vec4 vColor;
varying float vFog;
varying vec3 vFogCol;
${FOG_CUSTOM_GLSL}
void main() {
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  float size = iData.x;
  float stretch = iData.z;
  vec2 corner = position.xy;
  vec3 p = mv.xyz;
  if (stretch > 0.0) {
    vec3 vv = (modelViewMatrix * vec4(iVel, 0.0)).xyz;
    vec3 head = mv.xyz;
    vec3 tail = head - vv * stretch;
    vec3 axis = head - tail;
    float len = length(axis);
    axis = len > 1e-4 ? axis / len : vec3(0.0, 1.0, 0.0);
    vec3 viewDir = normalize(mix(head, tail, 0.5));
    vec3 perp = cross(axis, viewDir);
    float pl = length(perp);
    perp = pl > 1e-4 ? perp / pl : vec3(1.0, 0.0, 0.0);
    // extend the streak by half a size at both ends so it is never degenerate
    vec3 a = tail - axis * size * 0.5;
    vec3 b = head + axis * size * 0.5;
    p = mix(a, b, corner.y + 0.5) + perp * corner.x * size;
  } else {
    float c = cos(iData.y), s = sin(iData.y);
    p.xy += vec2(c * corner.x - s * corner.y, s * corner.x + c * corner.y) * size;
  }
  gl_Position = projectionMatrix * vec4(p, 1.0);
  float f = floor(iData.w + 0.5);
  vec2 cell = vec2(mod(f, uAtlas.x), uAtlas.y - 1.0 - floor(f / uAtlas.x));
  vUv = (cell + corner + 0.5) / uAtlas;
  vColor = iColor;
  float d = -p.z;
  vec4 lf = lbFog(iPos, cameraPosition, lbFogColor, lbTime, lbDawn);
  vFog = lf.a;
  vFogCol = lf.rgb;
  // fade particles that are right in the camera's face
  vColor.a *= smoothstep(0.15, 1.2, d);
}`;

const FRAG_ADD = /* glsl */`
uniform sampler2D uMap;
varying vec2 vUv;
varying vec4 vColor;
varying float vFog;
void main() {
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * vColor.a * (1.0 - vFog);
  gl_FragColor = vec4(t.rgb * vColor.rgb * a, 1.0);
}`;

const FRAG_ALPHA = /* glsl */`
uniform sampler2D uMap;
varying vec2 vUv;
varying vec4 vColor;
varying float vFog;
varying vec3 vFogCol;
void main() {
  vec4 t = texture2D(uMap, vUv);
  float a = t.a * vColor.a;
  if (a < 0.004) discard;
  vec3 col = mix(t.rgb * vColor.rgb, vFogCol, vFog);
  gl_FragColor = vec4(col, a * (1.0 - vFog * 0.6));
}`;

export class ParticleSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {object} opts { capacity, additive, atlas, fog: {color, density}, renderOrder }
   */
  constructor(scene, { capacity = 6000, additive = true, atlas, fogUniforms, renderOrder = 10 }) {
    this.cap = capacity;
    this.count = 0;
    const N = capacity;
    // simulation state (SoA)
    this.px = new Float32Array(N); this.py = new Float32Array(N); this.pz = new Float32Array(N);
    this.vx = new Float32Array(N); this.vy = new Float32Array(N); this.vz = new Float32Array(N);
    this.life = new Float32Array(N); this.maxLife = new Float32Array(N);
    this.s0 = new Float32Array(N); this.s1 = new Float32Array(N);
    this.rot = new Float32Array(N); this.rotV = new Float32Array(N);
    this.r0 = new Float32Array(N); this.g0 = new Float32Array(N); this.b0 = new Float32Array(N);
    this.r1 = new Float32Array(N); this.g1 = new Float32Array(N); this.b1 = new Float32Array(N);
    this.a0 = new Float32Array(N);
    this.frame = new Float32Array(N);
    this.stretch = new Float32Array(N);
    this.grav = new Float32Array(N);
    this.drag = new Float32Array(N);
    this.fadeIn = new Float32Array(N);
    this.floorY = new Float32Array(N);
    this._arrays = [this.px, this.py, this.pz, this.vx, this.vy, this.vz, this.life, this.maxLife, this.s0, this.s1,
      this.rot, this.rotV, this.r0, this.g0, this.b0, this.r1, this.g1, this.b1, this.a0, this.frame, this.stretch,
      this.grav, this.drag, this.fadeIn, this.floorY];

    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aData = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iVel', this.aVel);
    geo.setAttribute('iData', this.aData);
    geo.setAttribute('iColor', this.aColor);
    geo.instanceCount = 0;
    this.geo = geo;

    const uniforms = {
      uMap: { value: atlas },
      uAtlas: { value: new THREE.Vector2(4, 4) },
      ...fogUniforms,
    };
    this.material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERT,
      fragmentShader: additive ? FRAG_ADD : FRAG_ALPHA,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.CustomBlending : THREE.NormalBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    scene.add(this.mesh);
  }

  /**
   * Spawn one particle. Positional args avoid allocations in hot paths.
   * colour goes from (r,g,b) to (r2,g2,b2) over its life; alpha fades out.
   */
  spawn(x, y, z, vx, vy, vz, life, size0, size1, frame, r, g, b, a, r2, g2, b2, grav = 0, drag = 0, stretch = 0, rot = 0, rotV = 0, fadeIn = 0, floorY = -1e9) {
    let i;
    if (this.count < this.cap) i = this.count++;
    else i = (Math.random() * this.cap) | 0; // overwrite a random one when full
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = 0; this.maxLife[i] = life;
    this.s0[i] = size0; this.s1[i] = size1;
    this.frame[i] = frame;
    this.r0[i] = r; this.g0[i] = g; this.b0[i] = b; this.a0[i] = a;
    this.r1[i] = r2; this.g1[i] = g2; this.b1[i] = b2;
    this.grav[i] = grav; this.drag[i] = drag; this.stretch[i] = stretch;
    this.rot[i] = rot; this.rotV[i] = rotV; this.fadeIn[i] = fadeIn;
    this.floorY[i] = floorY;
    return i;
  }

  clear() { this.count = 0; this.geo.instanceCount = 0; }

  update(dt) {
    const P = this.aPos.array, V = this.aVel.array, D = this.aData.array, C = this.aColor.array;
    let n = this.count;
    for (let i = 0; i < n; i++) {
      let l = this.life[i] + dt;
      if (l >= this.maxLife[i]) {
        // swap-remove
        n--;
        if (i !== n) this._move(n, i);
        i--;
        continue;
      }
      this.life[i] = l;
      const dr = this.drag[i];
      if (dr > 0) {
        const k = Math.exp(-dr * dt);
        this.vx[i] *= k; this.vy[i] *= k; this.vz[i] *= k;
      }
      this.vy[i] -= this.grav[i] * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      if (this.py[i] < this.floorY[i]) { this.py[i] = this.floorY[i]; this.vy[i] *= -0.2; this.vx[i] *= 0.5; this.vz[i] *= 0.5; }
      this.rot[i] += this.rotV[i] * dt;
      const t = l / this.maxLife[i];
      const fi = this.fadeIn[i];
      let alpha = this.a0[i] * (1 - t) * (1 - t); // quadratic fade-out
      if (fi > 0 && t < fi) alpha *= t / fi;
      const j3 = i * 3, j4 = i * 4;
      P[j3] = this.px[i]; P[j3 + 1] = this.py[i]; P[j3 + 2] = this.pz[i];
      V[j3] = this.vx[i]; V[j3 + 1] = this.vy[i]; V[j3 + 2] = this.vz[i];
      D[j4] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      D[j4 + 1] = this.rot[i];
      D[j4 + 2] = this.stretch[i];
      D[j4 + 3] = this.frame[i];
      C[j4] = this.r0[i] + (this.r1[i] - this.r0[i]) * t;
      C[j4 + 1] = this.g0[i] + (this.g1[i] - this.g0[i]) * t;
      C[j4 + 2] = this.b0[i] + (this.b1[i] - this.b0[i]) * t;
      C[j4 + 3] = alpha;
    }
    this.count = n;
    this.geo.instanceCount = n;
    if (n > 0) {
      for (const a of [this.aPos, this.aVel, this.aData, this.aColor]) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, n * a.itemSize);
        a.needsUpdate = true;
      }
    }
  }

  _move(from, to) {
    const A = this._arrays;
    for (let k = 0; k < A.length; k++) A[k][to] = A[k][from];
  }
}
