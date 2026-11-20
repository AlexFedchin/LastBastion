// The valley floor's material (WebGPU / TSL): one pass over the whole terrain that splats
// mud, turf, rock, asphalt and the fields behind the base, anti-tiles every layer, draws the
// road's potholes and cracks, the puddles and the rain rippling them.
//
// The port of the WebGL terrain patch (terrain.js T_COMMON + its onBeforeCompile), kept to
// the same maths. Layers that only show in places (turf, rock, road, fields) are sampled only
// where their weight is above zero; their texture reads use explicit gradients, so they are
// legal inside those branches.
import * as THREE from 'three';
import {
  Fn, If, Loop, float, int, vec2, vec3, vec4, uniform, texture, textureLoad, ivec2, positionWorld, normalWorld, cameraPosition,
  mix, clamp, max, min, abs, exp, pow, sin, cos, atan, length, normalize, dot, fract, floor, select, dFdx, dFdy,
  inverseSqrt, TBNViewMatrix, materialColor, step,
} from 'three/tsl';

// ── shared noise ──
export const tHash = Fn(([p0]) => {
  const p = fract(p0.mul(vec2(443.897, 441.423))).toVar();
  p.addAssign(dot(p, p.yx.add(19.19)));
  return fract(p.x.add(p.y).mul(p.x));
}).setLayout({ name: 'tHash', type: 'float', inputs: [{ name: 'p0', type: 'vec2' }] });

export const tNoise = Fn(([p]) => {
  const i = floor(p), q = fract(p);
  const u = q.mul(q).mul(q.mul(-2).add(3));
  return mix(mix(tHash(i), tHash(i.add(vec2(1, 0))), u.x), mix(tHash(i.add(vec2(0, 1))), tHash(i.add(vec2(1, 1))), u.x), u.y);
}).setLayout({ name: 'tNoise', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

/** smoothstep that also runs downhill (a > b), as the GLSL tS did. */
export const tS = (a, b, v) => {
  const t = clamp(float(v).sub(a).div(float(b).sub(a)), 0, 1);
  return t.mul(t).mul(t.mul(-2).add(3));
};
export const roadXg = (z) => tS(-110, -470, z).mul(-52).add(tS(-540, -930, z).mul(96));
const rearValleyXg = (z) => tS(80, 320, z).mul(sin(z.mul(0.0055).add(0.4)).mul(45).sub(10));
export const rearRoadXg = (z) => rearValleyXg(z).add(tS(40, 160, z).mul(15).mul(sin(z.mul(0.02))));

// ── anti-tiling (see the WebGL version's notes: whole tiles turned and shifted at random,
// a variance-preserving blend only in a thin band at the seams, the grid wobbling) ──
const NT_BAND = 0.08;
const ntRot = (v, cs) => vec2(cs.x.mul(v.x).sub(cs.y.mul(v.y)), cs.y.mul(v.x).add(cs.x.mul(v.y)));
const ntHash3 = Fn(([p]) => {
  const q = vec3(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)), dot(p, vec2(419.2, 371.9)));
  return fract(sin(q).mul(43758.5453));
}).setLayout({ name: 'ntHash3', type: 'vec3', inputs: [{ name: 'p', type: 'vec2' }] });

function ntTile(cell, uv, rot) {
  const h = ntHash3(cell).toVar();
  const a = h.z.sub(0.5).mul(6.2831853 * rot);
  const cs = vec2(cos(a), sin(a)).toVar();
  const u = ntRot(uv.sub(cell).sub(0.5), cs).add(h.xy.mul(9)).toVar();
  return { u, cs };
}

function ntBuild(uv0, dx, dy, rot = 1) {
  const uv = vec2(uv0).toVar();
  const q = uv.add(vec2(tNoise(uv.mul(0.55).add(3.1)), tNoise(uv.mul(0.55).add(7.7))).sub(0.5).mul(0.7));
  const c = floor(q).toVar(), f = fract(q).toVar();
  const side = vec2(select(f.x.lessThan(0.5), float(-1), float(1)), select(f.y.lessThan(0.5), float(-1), float(1))).toVar();
  const m = min(f, vec2(1).sub(f));
  const a = vec2(float(1).sub(tS(0, NT_BAND, m.x)), float(1).sub(tS(0, NT_BAND, m.y))).mul(0.5).toVar();
  const w = vec4(float(1).sub(a.x).mul(float(1).sub(a.y)), a.x.mul(float(1).sub(a.y)), float(1).sub(a.x).mul(a.y), a.x.mul(a.y)).toVar();
  const t0 = ntTile(c, uv, rot), t1 = ntTile(c.add(vec2(side.x, 0)), uv, rot);
  const t2 = ntTile(c.add(vec2(0, side.y)), uv, rot), t3 = ntTile(c.add(side), uv, rot);
  return { t: [t0, t1, t2, t3], w, dx: vec2(dx).toVar(), dy: vec2(dy).toVar() };
}
const ntSetupD = (uv, dx, dy) => ntBuild(uv, dx, dy, 1);
const ntSetupR = (uv, dx, dy, rot) => ntBuild(uv, dx, dy, rot);
const ntSetup = (uv) => { const u = vec2(uv).toVar(); return ntBuild(u, dFdx(u), dFdy(u), 1); };

const ntTap = (T, n, tile) => T.sample(tile.u).grad(ntRot(n.dx, tile.cs), ntRot(n.dy, tile.cs));
function ntSample(T, n) {
  const a = vec4(ntTap(T, n, n.t[0])).toVar();
  const r = vec4(a).toVar();
  If(n.w.x.lessThanEqual(0.999), () => {
    const b = ntTap(T, n, n.t[1]), c = ntTap(T, n, n.t[2]), d = ntTap(T, n, n.t[3]);
    const mean = T.sample(vec2(0.5)).level(12);
    const v = a.sub(mean).mul(n.w.x).add(b.sub(mean).mul(n.w.y)).add(c.sub(mean).mul(n.w.z)).add(d.sub(mean).mul(n.w.w));
    r.assign(clamp(mean.add(v.mul(inverseSqrt(dot(n.w, n.w)))), 0, 1));
  });
  return r;
}
// a normal map through the same tiles: each tile's normal turned back by its rotation
const ntTapN = (T, n, tile) => {
  const m = ntTap(T, n, tile).xyz.mul(2).sub(1).toVar();
  return vec3(ntRot(m.xy, vec2(tile.cs.x, tile.cs.y.negate())), m.z);
};
function ntSampleN(T, n) {
  const a = vec3(ntTapN(T, n, n.t[0])).toVar();
  const r = vec3(a).toVar();
  If(n.w.x.lessThanEqual(0.999), () => {
    r.assign(a.mul(n.w.x).add(ntTapN(T, n, n.t[1]).mul(n.w.y)).add(ntTapN(T, n, n.t[2]).mul(n.w.z)).add(ntTapN(T, n, n.t[3]).mul(n.w.w)));
  });
  return r;
}

export const rippleN = Fn(([p, t]) => {
  const acc = vec2(0).toVar();
  Loop(3, ({ i }) => {
    const fk = float(i);
    const q = p.mul(fk.mul(0.7).add(1.9)).add(fk.mul(7.13));
    const ii = floor(q), f = fract(q).sub(0.5);
    const rnd = tHash(ii.add(fk.mul(3.1)));
    const off = vec2(tHash(ii.add(1.7)), tHash(ii.add(4.3))).sub(0.5);
    const dv = f.sub(off.mul(0.5));
    const d = length(dv).add(1e-4);
    const ph = fract(t.mul(rnd.mul(0.5).add(0.8)).add(rnd));
    const r = ph.mul(0.42);
    const w = exp(pow(d.sub(r).div(0.03), 2).negate()).mul(float(1).sub(ph)).mul(float(1).sub(ph));
    acc.addAssign(dv.div(d).mul(w).mul(sin(d.sub(r).mul(90))));
  });
  return acc;
}).setLayout({ name: 'rippleN', type: 'vec2', inputs: [{ name: 'p', type: 'vec2' }, { name: 't', type: 'float' }] });

// ── the asphalt: cracks (Voronoi borders, after Quilez) and potholes ──
const crackVor = Fn(([x]) => {
  const n = floor(x), f = fract(x);
  const mg = vec2(0).toVar(), mr = vec2(0).toVar(), md = float(8).toVar();
  Loop({ start: -1, end: 1, condition: '<=' }, ({ i: j }) => {
    Loop({ start: -1, end: 1, condition: '<=' }, ({ i }) => {
      const g = vec2(float(i), float(j));
      const o = vec2(tHash(n.add(g)), tHash(n.add(g).add(17.31)));
      const r = g.add(o).sub(f);
      const d = dot(r, r);
      If(d.lessThan(md), () => { md.assign(d); mr.assign(r); mg.assign(g); });
    });
  });
  md.assign(8);
  const dir = vec2(1, 0).toVar();
  Loop({ start: -2, end: 2, condition: '<=' }, ({ i: j }) => {
    Loop({ start: -2, end: 2, condition: '<=' }, ({ i }) => {
      const g = mg.add(vec2(float(i), float(j)));
      const o = vec2(tHash(n.add(g)), tHash(n.add(g).add(17.31)));
      const r = g.add(o).sub(f);
      const e = r.sub(mr);
      If(dot(e, e).greaterThan(1e-5), () => {
        const nd = normalize(e);
        const d = dot(mr.add(r).mul(0.5), nd);
        If(d.lessThan(md), () => { md.assign(d); dir.assign(nd); });
      });
    });
  });
  return vec3(md, dir);
}).setLayout({ name: 'crackVor', type: 'vec3', inputs: [{ name: 'x', type: 'vec2' }] });

const crackLayer = Fn(([p, cell, width, fp, jag]) => {
  const q = p.div(cell).toVar();
  q.addAssign(vec2(tNoise(q.mul(2.3).add(1.3)), tNoise(q.mul(2.3).add(6.1))).sub(0.5).mul(jag));
  const v = crackVor(q);
  const d = v.x.mul(cell);
  const w = width.mul(tNoise(p.mul(1.7)).mul(0.8).add(0.6));
  const cov = float(1).sub(tS(w.mul(0.5), w.mul(0.5).add(fp), d)).mul(min(1, w.div(max(fp, 1e-4)))).toVar();
  const wall = tS(w.mul(0.5).add(fp).add(0.006), w.mul(0.5), d).mul(float(1).sub(cov.mul(0.7)));
  return vec3(cov, v.yz.negate().mul(wall));
}).setLayout({
  name: 'crackLayer', type: 'vec3',
  inputs: [{ name: 'p', type: 'vec2' }, { name: 'cell', type: 'float' }, { name: 'width', type: 'float' }, { name: 'fp', type: 'float' }, { name: 'jag', type: 'float' }],
});

// potholes: (inside, rim, slope x, slope z); the water in them comes from potholeWater
const potholeCell = (p) => {
  const cell = floor(p.div(7)).toVar();
  const h = vec3(tHash(cell.add(3.3)), tHash(cell.add(8.1)), tHash(cell.add(1.9))).toVar();
  const c = cell.add(0.25).add(vec2(h.y, h.z).mul(0.5)).mul(7);
  const dv = p.sub(c).toVar();
  const R = tHash(cell.add(5.7)).mul(0.8).add(0.4).toVar();
  return { cell, h, dv, R, dist: length(dv) };
};
const pothole = Fn(([p, fp]) => {
  const out = vec4(0).toVar();
  const P = potholeCell(p);
  If(P.h.x.lessThanEqual(0.34).and(P.dist.lessThanEqual(P.R.mul(1.9))), () => {
    const a = atan(P.dv.y, P.dv.x);
    const rag = tNoise(vec2(a.mul(2.2), 0).add(P.cell.mul(3.1))).sub(0.5).mul(0.55).add(1).add(tNoise(P.dv.mul(6)).sub(0.5).mul(0.18));
    const Re = P.R.mul(rag);
    const q = P.dist.div(Re);
    const inside = float(1).sub(tS(float(1).sub(fp.div(Re)), float(1).add(fp.div(Re)), q));
    const slope = tS(0.72, 0.86, q).mul(tS(1.0, 0.9, q)).mul(0.09 * 6).div(Re);
    const nrm = normalize(P.dv.add(1e-5)).negate().mul(slope);
    const rim = tS(1.35, 1.0, q).mul(float(1).sub(inside));
    out.assign(vec4(inside, rim, nrm));
  });
  return out;
}).setLayout({ name: 'pothole', type: 'vec4', inputs: [{ name: 'p', type: 'vec2' }, { name: 'fp', type: 'float' }] });
const potholeWater = Fn(([p]) => {
  const w = float(0).toVar();
  const P = potholeCell(p);
  If(P.h.x.lessThanEqual(0.34).and(P.dist.lessThanEqual(P.R.mul(1.9))).and(tHash(P.cell.add(9.4)).lessThan(0.6)), () => {
    const a = atan(P.dv.y, P.dv.x);
    const rag = tNoise(vec2(a.mul(2.2), 0).add(P.cell.mul(3.1))).sub(0.5).mul(0.55).add(1).add(tNoise(P.dv.mul(6)).sub(0.5).mul(0.18));
    w.assign(tS(0.78, 0.66, P.dist.div(P.R.mul(rag))));
  });
  return w;
}).setLayout({ name: 'potholeWater', type: 'float', inputs: [{ name: 'p', type: 'vec2' }] });

/**
 * Set the terrain material's nodes. T: textures { splat, mudA, mudR, mudN, turfA, turfN, rockA,
 * rockN, asphA, asphN, trackA, ploughA }, TS: tile sizes, flags { mudFile, ploughFile, trackFile },
 * U: uniforms { uSplatBox, uTime, uRain }.
 */
export function terrainNodes(mat, T, TS, flags, U) {
  const tex = {};
  for (const k in T) tex[k] = texture(T[k]);
  const S = {}; // per-pixel values shared by the colour, roughness and normal stages

  const colour = Fn(() => {
    const tw = positionWorld.toVar();
    const tn = normalize(normalWorld).toVar();
    const sp = tw.xz.sub(U.uSplatBox.xy).div(U.uSplatBox.zw);
    const inBox = step(0, sp.x).mul(step(sp.x, 1)).mul(step(0, sp.y)).mul(step(sp.y, 1));
    const SPL = tex.splat.sample(clamp(sp, 0, 1)).mul(inBox).toVar();
    const macro = tNoise(tw.xz.mul(0.021)).mul(0.6).add(tNoise(tw.xz.mul(0.0045).add(3.7)).mul(0.4)).toVar();
    const slope = float(1).sub(tn.y).toVar();
    const distC = length(tw.xz.sub(cameraPosition.xz)).toVar();
    const farGrass = clamp(macro.sub(0.34).mul(2.4), 0, 1).mul(0.9);
    const tGrass = mix(farGrass.mul(tS(-40, -120, tw.z)), SPL.r, inBox).toVar();
    const tWet = SPL.g, tBurn = SPL.b;
    const tTrample = SPL.a.toVar();
    const rdx = abs(tw.x.sub(roadXg(tw.z)));
    const tRoad = tS(tNoise(tw.xz.mul(0.35)).mul(1.4).add(4.4), 3.0, rdx).mul(step(tw.z, -2.5)).toVar();
    const tRock = clamp(tS(0.2, 0.42, slope.add(macro.sub(0.5).mul(0.18))).add(tS(30, 70, tw.y).mul(0.55)), 0, 1).mul(float(1).sub(tRoad)).toVar();
    const gX3 = dFdx(tw).toVar(), gY3 = dFdy(tw).toVar();
    const gX = gX3.xz, gY = gY3.xz;
    const hasTurf = tGrass.greaterThan(0.002).or(tw.z.greaterThan(40));
    const hasRoad = tRoad.greaterThan(0.002), hasRock = tRock.greaterThan(0.002);
    const mk = flags.mudFile ? [0.85, 0.15] : [0.7, 0.3];
    const ntMud = ntSetup(tw.xz.div(TS.mud));
    const ntMacro = ntSetup(tw.xz.div(TS.mudMacro).add(0.37));
    const macroC = ntSample(tex.mudA, ntMacro).rgb.toVar();
    const mudC = ntSample(tex.mudA, ntMud).rgb.mul(mk[0]).add(macroC.mul(mk[1])).toVar();
    const farK = tS(45, 220, distC).toVar();
    If(farK.greaterThan(0), () => {
      const s = TS.mud * 5.3;
      const ntFar = ntSetupD(tw.xz.div(s).add(63), gX.div(s), gY.div(s));
      mudC.assign(mix(mudC, ntSample(tex.mudA, ntFar).rgb.mul(mk[0]).add(macroC.mul(mk[1])), farK.mul(0.7)));
    });
    // large-scale tonal drift so the field never reads as one flat material
    mudC.mulAssign(tNoise(tw.xz.mul(0.013).add(7)).mul(0.4).add(0.8));
    const turfC = vec3(0).toVar();
    const turfNT = { n: null };
    If(hasTurf, () => {
      const s = TS.turf;
      const ntTurf = ntSetupD(tw.xz.div(s).add(31), gX.div(s), gY.div(s));
      turfNT.n = ntTurf;
      turfC.assign(ntSample(tex.turfA, ntTurf).rgb);
      If(farK.greaterThan(0), () => {
        const s2 = TS.turf * 5.3;
        const ntTurfFar = ntSetupD(tw.xz.div(s2).add(77), gX.div(s2), gY.div(s2));
        turfC.assign(mix(turfC, ntSample(tex.turfA, ntTurfFar).rgb, farK.mul(0.7)));
      });
      turfC.mulAssign(mix(0.36, 0.6, tNoise(tw.xz.mul(0.11))));
    });
    const rockC = vec3(0).toVar();
    If(hasRock, () => {
      const s = TS.rock;
      const ntRock = ntSetupD(tw.xz.div(s).add(5), gX.div(s), gY.div(s));
      const bw0 = pow(abs(tn), vec3(4));
      const bw = bw0.div(bw0.x.add(bw0.y).add(bw0.z));
      const ntRx = ntSetupD(tw.zy.div(s).add(13), gX3.zy.div(s), gY3.zy.div(s));
      const ntRz = ntSetupD(tw.xy.div(s).sub(29), gX3.xy.div(s), gY3.xy.div(s));
      rockC.assign(ntSample(tex.rockA, ntRx).rgb.mul(bw.x).add(ntSample(tex.rockA, ntRock).rgb.mul(bw.y)).add(ntSample(tex.rockA, ntRz).rgb.mul(bw.z)));
    });
    const asphC = vec3(0).toVar();
    const rdN = vec2(0).toVar(), rdWater = float(0).toVar(), rdCrack = float(0).toVar(), rdHole = float(0).toVar();
    If(hasRoad, () => {
      const s = TS.asph;
      const ntAsph = ntSetupD(tw.xz.div(s).sub(17), gX.div(s), gY.div(s));
      asphC.assign(ntSample(tex.asphA, ntAsph).rgb);
      asphC.mulAssign(tNoise(tw.xz.mul(0.045).add(4)).mul(0.32).add(0.82));
      // faded centre line on the road
      const paint = float(1).sub(tS(0.07, 0.12, abs(tw.x.sub(roadXg(tw.z))))).mul(step(0.45, fract(tw.z.div(7)))).mul(tS(0.35, 0.6, tNoise(tw.xz.mul(0.9))));
      asphC.assign(mix(asphC, vec3(0.32, 0.29, 0.2), paint.mul(0.7)));
      // potholes, then cracks: long ones in patches, fine "alligator" cracking in others and round the holes
      const fp = max(length(gX), length(gY)).mul(1.2).toVar();
      const ph = pothole(tw.xz, fp).toVar();
      const hw = potholeWater(tw.xz);
      rdHole.assign(ph.x);
      const near = float(1).sub(tS(35, 90, distC)).toVar();
      If(near.greaterThan(0), () => {
        const longK = tS(0.38, 0.6, tNoise(tw.xz.mul(0.06).add(2)));
        const alliK = max(tS(0.72, 0.86, tNoise(tw.xz.mul(0.11).add(9))).mul(0.6), ph.y.mul(1.2)).toVar();
        const cl = crackLayer(tw.xz.add(31), float(2.6), float(0.022), fp, float(0.55)).toVar();
        const ca = vec3(0).toVar();
        If(alliK.greaterThan(0), () => { ca.assign(crackLayer(tw.xz.sub(13), float(0.42), float(0.0075), fp, float(0.35))); });
        rdCrack.assign(clamp(cl.x.mul(longK).add(ca.x.mul(alliK)), 0, 1).mul(near).mul(float(1).sub(rdHole)));
        rdN.addAssign(cl.yz.mul(longK).add(ca.yz.mul(alliK)).mul(0.3).mul(near).mul(float(1).sub(rdHole)));
      });
      asphC.mulAssign(float(1).sub(rdCrack.mul(0.7)));
      asphC.mulAssign(float(1).sub(ph.y.mul(0.22)));
      // in the hole: wet gravel and mud, and rain water in some
      rdWater.assign(hw.mul(rdHole));
      const holeC = mudC.mul(vec3(0.62, 0.6, 0.58)).mul(float(1).sub(rdWater.mul(0.45)));
      asphC.assign(mix(asphC, holeC, rdHole));
      rdN.addAssign(ph.zw);
      S.ntAsph = ntAsph;
    });
    // ── behind the base: a patchwork of fields on the valley floor, a dirt track ──
    const rz = tS(40, 95, tw.z).toVar();
    const rRoad = float(0).toVar(), rRut = float(0).toVar(), fieldW = float(0).toVar(), hedge = float(0).toVar();
    const fieldC = vec3(0).toVar();
    If(rz.greaterThan(0), () => {
      const rrd = abs(tw.x.sub(rearRoadXg(tw.z))).toVar();
      rRoad.assign(tS(tNoise(tw.xz.mul(0.3)).mul(0.9).add(3.9), 2.6, rrd).mul(tS(24, 34, tw.z)));
      rRut.assign(exp(pow(rrd.sub(0.95).div(0.28), 2).negate()).mul(rRoad));
      const ca = Math.cos(0.32), sa = Math.sin(0.32);
      const fr = vec2(tw.x.mul(ca).sub(tw.z.mul(sa)), tw.x.mul(sa).add(tw.z.mul(ca))).toVar();
      const fc = fr.div(vec2(54, 36));
      const fid = floor(fc).toVar(), ff = fract(fc);
      const fh = tHash(fid.add(3.7)).toVar();
      const edge = min(min(ff.x, float(1).sub(ff.x)).mul(54), min(ff.y, float(1).sub(ff.y)).mul(36));
      fieldW.assign(rz.mul(tS(0.09, 0.035, slope)).mul(tS(16, 7, tw.y)).mul(tS(70, 110, tw.z)).mul(float(1).sub(tS(2.2, 6.5, rrd.sub(9).negate()))));
      const wob = tNoise(tw.xz.mul(0.21)).sub(0.5).toVar();
      hedge.assign(tS(2.6, 1.0, edge.add(wob.mul(1.6))).mul(fieldW));
      const tone = tHash(fid.add(9.1)).mul(0.3).add(0.85).toVar();
      If(fh.lessThan(0.3), () => {
        // ploughed: dark turned earth in furrows along the plot
        const fur = sin(fr.x.mul(3.1).add(wob.mul(0.6))).mul(0.5).add(0.5);
        if (flags.ploughFile) {
          const pu = fr.div(TS.plough);
          const rot = (g) => vec2(dot(g, vec2(0.94924, -0.31457)), dot(g, vec2(0.31457, 0.94924))).div(TS.plough);
          const pc = ntSample(tex.ploughA, ntSetupR(pu, rot(gX), rot(gY), 0.04)).rgb;
          fieldC.assign(pc.mul(mix(0.85, 1.0, fur)).mul(tone));
        } else {
          fieldC.assign(mudC.mul(mix(0.55, 0.95, fur)).mul(vec3(0.95, 0.88, 0.8)).mul(tone));
        }
      }).ElseIf(fh.lessThan(0.55), () => {
        // stubble: pale, combed in rows
        const row = sin(fr.y.mul(4.4)).mul(0.5).add(0.5);
        fieldC.assign(vec3(0.25, 0.21, 0.135).mul(mix(0.75, 1.05, row)).mul(tNoise(tw.xz.mul(0.6)).mul(0.4).add(0.8)).mul(tone));
      }).ElseIf(fh.lessThan(0.85), () => {
        fieldC.assign(mix(mudC, turfC.add(vec3(0.02, 0.025, 0)), 0.85).mul(tone));
      }).Else(() => {
        fieldC.assign(mix(mudC.mul(0.9), turfC.mul(0.8), tS(0.35, 0.65, tNoise(tw.xz.mul(0.09)))).mul(tone));
      });
      // meadow grass over the hills, thinning on the steep bits
      const rg = clamp(macro.sub(0.22).mul(2.2), 0, 1).mul(float(1).sub(tS(0.25, 0.45, slope))).mul(rz);
      tGrass.assign(mix(tGrass, max(tGrass, rg), rz).mul(float(1).sub(rRoad)));
      tTrample.mulAssign(float(1).sub(rz));
    });
    const tcol = mix(mudC, turfC, tGrass).toVar();
    If(rz.greaterThan(0), () => {
      tcol.assign(mix(tcol, fieldC, fieldW.mul(float(1).sub(rRoad))));
      tcol.assign(mix(tcol, turfC.mul(vec3(0.55, 0.6, 0.45)), hedge.mul(0.85)));
      // the track: wet packed mud, two darker ruts, a grassy crown
      const trackC = vec3(0).toVar();
      if (flags.trackFile) {
        const s = TS.track;
        trackC.assign(ntSample(tex.trackA, ntSetupR(tw.xz.div(s).add(5), gX.div(s), gY.div(s), 0.12)).rgb);
      } else trackC.assign(mudC.mul(vec3(0.82, 0.78, 0.72)));
      trackC.assign(mix(trackC, mudC.mul(0.45), rRut.div(max(rRoad, 1e-3)).mul(0.8)));
      trackC.assign(mix(trackC, turfC.mul(0.7), exp(pow(abs(tw.x.sub(rearRoadXg(tw.z))).div(0.35), 2).negate()).mul(0.6)));
      tcol.assign(mix(tcol, trackC, rRoad));
    });
    tcol.assign(mix(tcol, asphC, tRoad));
    tcol.assign(mix(tcol, rockC.mul(vec3(0.95, 0.93, 0.9)), tRock));
    tcol.mulAssign(macro.mul(0.56).add(0.72));
    // a broad wash of light and dark over hundreds of metres, for the wide shots from the air
    tcol.mulAssign(tNoise(tw.xz.mul(0.0023).add(1.3)).mul(0.32).add(0.84));
    tcol.mulAssign(mix(1, 0.22, tBurn));
    tcol.mulAssign(mix(1, 0.55, tTrample.mul(float(1).sub(tRoad))));
    const puddle = tS(0.5, 0.72, tWet.add(tNoise(tw.xz.mul(0.55)).sub(0.5).mul(0.18))).mul(float(1).sub(tRock)).toVar();
    tcol.mulAssign(mix(0.78, 0.42, max(tWet.mul(0.7), puddle)));

    // ── roughness ──
    const rough = float(ntSample(tex.mudR, ntMud)[flags.mudFile ? 'a' : 'g']).toVar();
    rough.assign(mix(rough, 0.93, tGrass));
    rough.assign(mix(rough, mix(mix(0.7, 0.88, rdCrack), mix(0.8, 0.04, rdWater), rdHole), tRoad));
    rough.assign(mix(rough, 0.78, tRock));
    rough.assign(mix(rough, rough.mul(0.72), tTrample));
    rough.assign(max(rough, 0.55).mul(mix(1.0, 0.86, U.uRain)));
    rough.assign(mix(rough, 0.35, tWet.mul(0.6)));
    rough.assign(mix(rough, 0.035, puddle));
    rough.assign(mix(rough, 0.4, rRut.mul(0.7)));

    // ── the normal ──
    const sN = TS.mudN;
    const mapN = ntSampleN(tex.mudN, ntSetupD(tw.xz.div(sN).add(41), gX.div(sN), gY.div(sN))).toVar();
    If(hasTurf, () => {
      const s = TS.turf;
      mapN.assign(mix(mapN, ntSampleN(tex.turfN, ntSetupD(tw.xz.div(s).add(31), gX.div(s), gY.div(s))), tGrass));
    });
    // the road: smooth asphalt, its own fine grain, the cracks' grooves and the holes' walls;
    // standing water in a hole lies flat (rippled by the rain)
    If(hasRoad, () => {
      const s = TS.asph;
      const aN0 = ntSampleN(tex.asphN, ntSetupD(tw.xz.div(s).sub(17), gX.div(s), gY.div(s)));
      const axy = aN0.xy.mul(1.1).add(rdN).mul(float(1).sub(rdWater)).toVar();
      If(rdWater.greaterThan(0.01).and(distC.lessThan(90)), () => {
        axy.addAssign(rippleN(tw.xz.mul(1.6), U.uTime).mul(rdWater).mul(0.7).mul(U.uRain));
      });
      mapN.assign(mix(mapN, vec3(axy, aN0.z), tRoad));
    });
    If(hasRock, () => {
      const s = TS.rock;
      mapN.assign(mix(mapN, ntSampleN(tex.rockN, ntSetupD(tw.xz.div(s).add(5), gX.div(s), gY.div(s))).mul(vec3(1.6, 1.6, 1.0)), tRock));
    });
    const nxy = mapN.xy.mul(float(1).sub(puddle)).mul(float(1).sub(tWet.mul(0.35))).toVar();
    If(puddle.greaterThan(0.01).and(distC.lessThan(90)), () => {
      nxy.addAssign(rippleN(tw.xz.mul(1.6), U.uTime).mul(puddle).mul(0.9).mul(U.uRain));
    });
    S.normal = vec3(nxy.mul(1.1), mapN.z);
    S.rough = rough;
    return vec4(tcol, 1);
  });

  // one Fn computes everything (colour, roughness and normal share the splat and the masks);
  // the roughness and normal nodes read the values it left in S
  const col = colour();
  mat.colorNode = vec4(col).mul(materialColor);
  mat.roughnessNode = Fn(() => { void col; return S.rough; })();
  mat.normalNode = Fn(() => { void col; return TBNViewMatrix.mul(S.normal).normalize(); })();
}
