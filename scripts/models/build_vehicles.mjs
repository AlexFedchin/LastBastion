// Vehicles and field props from Sketchfab GLBs (source/vehicles/, credits in
// app/models/CREDITS.md): the wrecked cars, the Ural, the CH-47 and the Apache,
// the crashed helicopter, the shipping container, the hay bale and the bomb.
// Each is read as one rigid frame, turned to the game's axes, scaled to its real
// size, simplified to its budget and its textures re-encoded as WebP. Moving
// parts (rotors, the lifter's ramp, the Ural's canvas) become nodes of their own;
// points the game hangs effects on are `anchors` in the root node's extras.
//
// Used by build_models.mjs: node scripts/models/build_models.mjs cars ural ch47 ...
import path from 'node:path';
import * as THREE from 'three';
import sharp from 'sharp';
import { flatten, getBounds, prune, transformMesh, metalRough } from '@gltf-transform/functions';

export function make({ io, SRC, finish, splitByTriangles, bakeNodes }) {
  const V = (f) => path.join(SRC, 'vehicles', f);

  /** A Sketchfab GLB as one rigid frame: spec-gloss converted, node transforms baked, only the mesh nodes `keep` accepts. */
  async function readRigid(file, keep = null) {
    const doc = await io.read(file);
    if (doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === 'KHR_materials_pbrSpecularGlossiness')) await doc.transform(metalRough());
    await doc.transform(flatten());
    bakeNodes(doc);
    if (keep) for (const n of doc.getRoot().listNodes()) if (n.getMesh() && !keep(n.getName())) n.setMesh(null);
    await doc.transform(prune());
    return doc;
  }
  const scene = (doc) => doc.getRoot().listScenes()[0];
  const meshNodes = (doc) => doc.getRoot().listNodes().filter((n) => n.getMesh());
  /** Apply a THREE.Matrix4 to every mesh (the nodes are identity after readRigid). */
  const xformAll = (doc, m) => { for (const mesh of doc.getRoot().listMeshes()) transformMesh(mesh, m.elements); };
  /** Every vertex (world space), for measuring. */
  function verts(doc, filter = () => true) {
    const out = [];
    for (const n of meshNodes(doc)) {
      if (!filter(n.getName())) continue;
      const M = new THREE.Matrix4().fromArray(n.getWorldMatrix());
      for (const p of n.getMesh().listPrimitives()) {
        const a = p.getAttribute('POSITION'), v = [];
        for (let i = 0; i < a.getCount(); i++) { a.getElement(i, v); out.push(new THREE.Vector3(...v).applyMatrix4(M)); }
      }
    }
    return out;
  }
  const centroid = (vs) => vs.reduce((a, v) => a.add(v), new THREE.Vector3()).multiplyScalar(1 / vs.length);
  /** Yaw that lays the longest horizontal axis along x (principal axis of the vertices). */
  function pcaYaw(doc) {
    const vs = verts(doc), c = centroid(vs);
    let xx = 0, zz = 0, xz = 0;
    for (const v of vs) { const x = v.x - c.x, z = v.z - c.z; xx += x * x; zz += z * z; xz += x * z; }
    return 0.5 * Math.atan2(2 * xz, xx - zz);
  }
  /** Uniform scale so the extent along `ax` is `len`; then centred on x/z with its base at y = 0. */
  function fit(doc, ax, len) {
    let b = getBounds(scene(doc));
    const s = len / (b.max[ax] - b.min[ax]);
    xformAll(doc, new THREE.Matrix4().makeScale(s, s, s));
    b = getBounds(scene(doc));
    xformAll(doc, new THREE.Matrix4().makeTranslation(-(b.min[0] + b.max[0]) / 2, -b.min[1], -(b.min[2] + b.max[2]) / 2));
    return s;
  }
  /** Every texture to WebP, at most `size` px wide (normal maps a little higher quality). */
  async function texWebp(doc, size, { normalSize = size } = {}) {
    const normals = new Set(doc.getRoot().listMaterials().map((m) => m.getNormalTexture()).filter(Boolean));
    for (const t of doc.getRoot().listTextures()) {
      const img = Buffer.from(t.getImage());
      const meta = await sharp(img).metadata();
      const w = Math.min(normals.has(t) ? normalSize : size, meta.width), h = Math.round(w * meta.height / meta.width);
      t.setImage(await sharp(img).resize(w, h).webp({ quality: normals.has(t) ? 90 : 84 }).toBuffer()).setMimeType('image/webp').setURI('');
    }
  }
  /** Points the game reads (name -> [x, y, z] in the model's frame), kept as extras on the root node (userData.anchors in three). */
  function anchors(doc, pts) {
    const root = scene(doc).listChildren()[0];
    const a = {};
    for (const [name, p] of Object.entries(pts)) a[name] = (p.toArray ? p.toArray() : p).map((v) => +v.toFixed(3));
    root.setExtras({ ...root.getExtras(), anchors: a });
  }
  /** Rewrite one texture's pixels: fn(r, g, b, x, y) -> [r, g, b] on 0..255 values. */
  async function repaint(tex, fn) {
    // (a cut-out's alpha is kept: foliage cards carry their shape in it)
    const img = sharp(Buffer.from(tex.getImage())), meta = await img.metadata();
    const ch = meta.hasAlpha ? 4 : 3;
    const { data, info } = await (meta.hasAlpha ? img.ensureAlpha() : img.removeAlpha()).raw().toBuffer({ resolveWithObject: true });
    for (let y = 0, i = 0; y < info.height; y++) for (let x = 0; x < info.width; x++, i += ch) {
      const o = fn(data[i], data[i + 1], data[i + 2], x / info.width, y / info.height);
      data[i] = o[0]; data[i + 1] = o[1]; data[i + 2] = o[2];
    }
    tex.setImage(await sharp(data, { raw: { width: info.width, height: info.height, channels: ch } }).png().toBuffer()).setMimeType('image/png');
  }
  // ambientCG CC0 rust (Rust009 colour; Metal041B's rust spots as the mask), for weathering
  const ACG = (a, m) => path.join(SRC, 'ambientcg', a, `${a}_1K-JPG_${m}.jpg`);
  let rustTex = null;
  async function rustLayers() {
    if (rustTex) return rustTex;
    const R = 512, raw = async (f) => (await sharp(f).resize(R, R).removeAlpha().raw().toBuffer());
    const col = await raw(ACG('Rust009', 'Color')), spot = await raw(ACG('Metal041B', 'Color'));
    // the mask: how orange (rust) rather than grey (bare steel) Metal041B is there
    const mask = new Float32Array(R * R);
    for (let i = 0; i < R * R; i++) { const r = spot[i * 3], g = spot[i * 3 + 1], b = spot[i * 3 + 2]; mask[i] = Math.min(1, Math.max(0, (r - b) / 90)); }
    rustTex = { R, col, mask };
    return rustTex;
  }
  /**
   * Grade every opaque material's colour texture for the night: darker (dark), greyer (sat),
   * rust from ambientCG laid over it where its mask says (rust: amount; tile: repeats over
   * the atlas), soot blotches (soot). Untextured materials get the same darkening on their factor.
   */
  async function grade(doc, { dark = 0.6, sat = 0.8, rust = 0, tile = 3, soot = 0, tint = [1, 1, 1] } = {}) {
    const L = rust ? await rustLayers() : null;
    const done = new Set();
    for (const m of doc.getRoot().listMaterials()) {
      if (m.getAlphaMode() === 'BLEND') continue;
      const t = m.getBaseColorTexture();
      if (!t) { const f = m.getBaseColorFactor(); m.setBaseColorFactor([f[0] * dark, f[1] * dark, f[2] * dark, f[3]]); continue; }
      if (done.has(t)) continue; done.add(t);
      await repaint(t, (r, g, b, u, v) => {
        let c = [r / 255, g / 255, b / 255];
        const l = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
        c = c.map((x) => l + (x - l) * sat);
        if (L) {
          const px = Math.floor(((u * tile) % 1) * L.R), py = Math.floor(((v * tile) % 1) * L.R), j = py * L.R + px;
          // the rust spots, opened up by low-frequency noise so it gathers in patches
          const k = Math.min(1, L.mask[j] * (0.55 + 0.9 * fbm(u * 7 + 3, v * 7 + 1))) * rust;
          const rc = [L.col[j * 3] / 255, L.col[j * 3 + 1] / 255, L.col[j * 3 + 2] / 255];
          c = c.map((x, i) => x * (1 - k) + rc[i] * 0.7 * k);
        }
        if (soot) { const s = THREE.MathUtils.smoothstep(fbm(u * 11 + 7, v * 11), 0.4, 0.75) * soot; c = c.map((x) => x * (1 - 0.8 * s)); }
        return c.map((x, i) => Math.round(255 * Math.min(1, x * dark * tint[i])));
      });
    }
  }
  /** Smooth value noise in 0..1, for soot and rust blotches. */
  function noise2(x, y) {
    const h = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
    const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
    return (h(i, j) * (1 - su) + h(i + 1, j) * su) * (1 - sv) + (h(i, j + 1) * (1 - su) + h(i + 1, j + 1) * su) * sv;
  }
  const fbm = (x, y) => noise2(x, y) * 0.55 + noise2(x * 2.3, y * 2.3) * 0.3 + noise2(x * 5.1, y * 5.1) * 0.15;
  const triCount = (doc) => doc.getRoot().listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((t, p) => t + (p.getIndices() || p.getAttribute("POSITION")).getCount() / 3, 0), 0);
  const centre3 = (tri) => new THREE.Vector3((tri[0][0] + tri[1][0] + tri[2][0]) / 3, (tri[0][1] + tri[1][1] + tri[2][1]) / 3, (tri[0][2] + tri[1][2] + tri[2][2]) / 3);
  /** A parent node for everything in the scene, so splitByTriangles has somewhere to hang new nodes. */
  function rootNode(doc, name) {
    const s = scene(doc), root = doc.createNode(name);
    for (const n of s.listChildren()) { s.removeChild(n); root.addChild(n); }
    s.addChild(root);
    return root;
  }
  /** Move whole meshes (by node name) under a new node pivoted at their vertex centroid (a rotor's hub). */
  function pivotGroup(doc, parent, name, test, hubFix = null) {
    const ns = meshNodes(doc).filter((n) => test(n.getName()));
    const hub = centroid(verts(doc, test));
    if (hubFix) hubFix(hub);
    const g = doc.createNode(name).setTranslation(hub.toArray());
    for (const n of ns) { transformMesh(n.getMesh(), new THREE.Matrix4().makeTranslation(-hub.x, -hub.y, -hub.z).elements); g.addChild(n); }
    parent.addChild(g);
    return hub;
  }

  // ── wrecked cars: five variants, each its own file. Long axis on x, base at 0. ──
  // Car-1 a rusted sedan (hood up, doors open); Car-2 a burnt police sedan and its
  // overturned twin; Car-3 a burnt-out compact hatchback and a burnt saloon.
  const CARS = [
    // [name, source, node, length, triangle budget]; grades for the night below
    ['car_sedan', 'Car-1.glb', null, 5.2, 7000],
    ['car_police', 'Car-2.glb', 'Object004', 5.2, 7000],
    ['car_police_flip', 'Car-2.glb', 'Object005', 5.2, 7000],
    ['car_hatch', 'Car-3.glb', 'default001', 4.3, 4000],
    ['car_saloon', 'Car-3.glb', 'default002', 4.5, 4000],
  ];
  async function cars() {
    for (const [name, file, node, len, budget] of CARS) {
      const doc = await readRigid(V(file), node ? (n) => n.startsWith(node) : null);
      xformAll(doc, new THREE.Matrix4().makeRotationY(pcaYaw(doc)));
      fit(doc, 0, len);
      await grade(doc, name === 'car_sedan' ? { dark: 0.5, sat: 0.7, rust: 0.5, soot: 0.25 } : { dark: 0.36, sat: 0.5, rust: 0.65, soot: 0.55 });
      await texWebp(doc, 1024, { normalSize: 512 });
      const t = triCount(doc);
      const b = getBounds(scene(doc));
      console.log(name, 'size', b.max.map((v, i) => (v - b.min[i]).toFixed(2)).join(' x '), 'tris', t);
      await finish(doc, name + '.glb', { ratio: Math.min(1, budget / t), error: 0.004 });
    }
  }

  // ── Ural-4320 6x6 truck: nose +x, 7.37 m, base at 0. The canvas tilt is its own node
  // ('canvas') so the game can show the open-bed version; ural_burnt.glb is the wreck
  // (no canvas, scorched paint). Source: nose +z, metres.
  async function uralDoc() {
    const doc = await readRigid(V('Ural.glb'));
    const root = rootNode(doc, 'ural');
    // the tilt: everything over the bed's side boards behind the cab
    splitByTriangles(doc, (tri) => { const c = centre3(tri); return c.z < 0.6 && c.y > 1.98 ? 0 : -1; }, [{ name: 'canvas', pivot: [0, 0, 0] }], root);
    xformAll(doc, new THREE.Matrix4().makeRotationY(Math.PI / 2));
    fit(doc, 0, 7.37);
    return doc;
  }
  async function ural() {
    let doc = await uralDoc();
    await grade(doc, { dark: 0.48, sat: 0.65, soot: 0.3 });
    // the untextured windscreen: dark glass, not a white sheet
    for (const m of doc.getRoot().listMaterials()) if (!m.getBaseColorTexture()) m.setBaseColorFactor([0.03, 0.035, 0.04, 1]).setRoughnessFactor(0.25).setMetallicFactor(0.3);
    await texWebp(doc, 2048, { normalSize: 1024 });
    let b = getBounds(scene(doc));
    console.log('ural size', b.max.map((v, i) => (v - b.min[i]).toFixed(2)).join(' x '));
    await finish(doc, 'ural.glb', { ratio: 0.75, error: 0.002 });

    // the burnt-out wreck: no canvas, paint scorched to soot and rust, glass gone dark
    doc = await uralDoc();
    for (const n of doc.getRoot().listNodes()) if (n.getName() === 'canvas') { n.getMesh().dispose(); n.dispose(); }
    for (const m of doc.getRoot().listMaterials()) {
      m.setMetallicFactor(0.15).setRoughnessFactor(0.95);
      const t = m.getBaseColorTexture();
      if (!t) { m.setBaseColorFactor([0.03, 0.03, 0.03, 1]); continue; }
      await repaint(t, (r, g, b, u, v) => {
        const l = (0.3 * r + 0.59 * g + 0.11 * b) / 255;
        const soot = THREE.MathUtils.smoothstep(fbm(u * 9, v * 9), 0.35, 0.65);
        const rust = [0.36 * l + 0.1, 0.2 * l + 0.05, 0.12 * l + 0.03];
        const k = 0.25 + 0.75 * soot;
        return rust.map((c, i) => Math.round(255 * (c * (1 - k) + [0.035, 0.032, 0.03][i] * k)));
      });
    }
    await doc.transform(prune());
    await grade(doc, { dark: 0.85, sat: 0.8, rust: 0.45 });
    await texWebp(doc, 1024, { normalSize: 1024 });
    await finish(doc, 'ural_burnt.glb', { ratio: 0.75, error: 0.002 });
  }

  // ── CH-47 tandem-rotor lifter: nose +z, 15.5 m fuselage. Origin 2.4 m over its
  // wheels (the game's `gear`), centred on the fuselage. Two rotor nodes on their hubs,
  // and the ramp's treadway boards on their hinge. Source: nose +z, about 1/14 scale.
  async function ch47() {
    const doc = await readRigid(V('CH-47.glb'));
    const src = new THREE.Box3(); for (const v of verts(doc, (n) => n === 'Object_3')) src.expandByPoint(v);
    const s = 15.46 / (src.max.z - src.min.z);
    const gear = 2.4;
    const cx = (src.min.x + src.max.x) / 2, cz = (src.min.z + src.max.z) / 2;
    const ground = verts(doc).reduce((a, v) => Math.min(a, v.y), Infinity);
    const M = new THREE.Matrix4().makeTranslation(0, -gear, 0).multiply(new THREE.Matrix4().makeScale(s, s, s)).multiply(new THREE.Matrix4().makeTranslation(-cx, -ground, -cz));
    const P = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(M); // a source point in the final frame
    const Minv = M.clone().invert();
    xformAll(doc, M);
    const root = rootNode(doc, 'ch47');
    // The ramp is modelled lowered, its treadway boards out on the ground. It is the whole
    // plate aft of the cabin floor's end (source z -43.4): the tread on top, the belly skin
    // under it, the full width of the belly (±22 tapering to ±17). Node 'ramp' is hinged at
    // the floor's end; rotation 0 is down as modelled, +RAMP_SHUT lays it along the tail's
    // upswept side contour (24° up; the plate lies 10.8° down). The plate's own plane:
    const rampTop = (z) => 12.1 + (z + 43.4) * 0.19; // its tread surface (source units)
    const RAMP_SHUT = Math.atan(0.19) + Math.atan(0.444);
    const hinge = P(0.25, 12.05, -43.3), boardsAt = P(0.25, 1.3, -76.4);
    const inRamp = (c) => c.z < -42.6 && Math.abs(c.x - 0.25) < 25 && c.y < rampTop(c.z) + 1.0 && c.y > rampTop(c.z) - 6.5;
    // The rear landing gear stands right beside the hinge, inside that box: its wheels, struts,
    // hubs and the fairings over them would go up with the ramp (the wheels torn in half when it
    // shut). They are islands of their own in the mesh, wholly outboard of |x| 14 by the hinge:
    // left on the airframe.
    const gearTris = new Set();
    {
      const key = (v) => v.map((c) => c.toFixed(3)).join(',');
      for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
        const pos = p.getAttribute('POSITION'), idx = p.getIndices(), n = idx ? idx.getCount() : pos.getCount(), I = (k) => (idx ? idx.getScalar(k) : k);
        const par = new Map(), find = (a) => { while (par.get(a) !== a) { par.set(a, par.get(par.get(a))); a = par.get(a); } return a; };
        const tris = [];
        for (let t = 0; t < n; t += 3) {
          const tri = [0, 1, 2].map((j) => pos.getElement(I(t + j), []));
          const c = centre3(tri).applyMatrix4(Minv);
          if (!inRamp(c)) continue;
          const ks = tri.map(key);
          for (const k of ks) if (!par.has(k)) par.set(k, k);
          par.set(find(ks[1]), find(ks[0])); par.set(find(ks[2]), find(ks[0]));
          tris.push([ks[0], key(centre3(tri).toArray()), c]);
        }
        const isl = new Map();
        for (const [k, ck, c] of tris) { const r = find(k); if (!isl.has(r)) isl.set(r, { box: new THREE.Box3(), keys: [] }); const s = isl.get(r); s.box.expandByPoint(c); s.keys.push(ck); }
        for (const { box, keys } of isl.values()) {
          const inner = box.min.x > 0 ? box.min.x : box.max.x < 0 ? -box.max.x : 0;
          if (inner >= 14 && box.min.z >= -56.5 && box.max.z <= -42) for (const k of keys) gearTris.add(k);
        }
      }
      console.log('ch47 gear tris kept off the ramp', gearTris.size);
    }
    const onRamp = (tri) => { const c = centre3(tri); return inRamp(c.clone().applyMatrix4(Minv)) && !gearTris.has(c.toArray().map((v) => v.toFixed(3)).join(',')); };
    // the treadway boards first (they slide into the ramp as it comes up), then the ramp
    splitByTriangles(doc, (tri) => { const c = centre3(tri).applyMatrix4(Minv); return onRamp(tri) && c.z < -76.4 && Math.abs(c.x - 0.25) < 12 ? 0 : -1; }, [{ name: 'boards', pivot: boardsAt.toArray() }], root);
    splitByTriangles(doc, (tri) => onRamp(tri) ? 0 : -1, [{ name: 'ramp', pivot: hinge.toArray() }], root);
    const nodes = doc.getRoot().listNodes(), rampN = nodes.find((n) => n.getName() === 'ramp'), boardsN = nodes.find((n) => n.getName() === 'boards');
    root.removeChild(boardsN);
    rampN.addChild(boardsN.setTranslation(boardsAt.clone().sub(hinge).toArray()));
    // the boards retract into the ramp along its plane (21 source units) as it comes up
    const slide = P(0.25, rampTop(-43.4 + 21), -43.4 + 21).sub(P(0.25, rampTop(-43.4), -43.4));
    // The upper ramp door: on the real aircraft a panel stows up under the aft pylon and
    // swings down to close the opening above the shut ramp. The model has none, so it is
    // built here: a trapezoid hinged at the pylon's lower rear edge, reaching down to where the
    // shut ramp's end lies, skinned with the belly's paint. It has to fit inside the opening's
    // arch: at the hinge (z -90.6) the arch's crown is at y 32.7 and ±9.9 wide; by the ramp's
    // end (z -73..-78) the walls are ±14.4 apart at y 26. (Hinged at y 33.4 and ±11 at the top,
    // ±16 at the foot, its corners came out through the roof and the sides.)
    let doorOpen = 0;
    {
      const top = P(0.25, 31.7, -87.2);
      const L = 33.6; // the ramp's tread length, along its plane
      const endZ = -43.4 - L * Math.cos(Math.atan(0.444)), endY = 12.1 + L * Math.sin(Math.atan(0.444));
      const bot = P(0.25, endY + 0.6, endZ + 1.2);
      // a uv on the belly skin: the centre of the ramp's largest downward-facing triangle
      let uv = [0.5, 0.5], best = 0, mat = null;
      const rampMesh = rampN.getMesh();
      for (const p of rampMesh ? rampMesh.listPrimitives() : []) {
        const pos = p.getAttribute('POSITION'), tc = p.getAttribute('TEXCOORD_0'), idx = p.getIndices(), I = (k) => (idx ? idx.getScalar(k) : k), cnt = idx ? idx.getCount() : pos.getCount();
        if (!tc) continue;
        const a = [], b = [], c = [];
        for (let i = 0; i < cnt; i += 3) {
          pos.getElement(I(i), a); pos.getElement(I(i + 1), b); pos.getElement(I(i + 2), c);
          const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), C = new THREE.Vector3(...c);
          const nrm = B.clone().sub(A).cross(C.clone().sub(A)); const area = nrm.length() / 2; nrm.normalize();
          if (nrm.y < -0.8 && area > best) {
            best = area; mat = p.getMaterial();
            const u = [], v = [], w = [];
            tc.getElement(I(i), u); tc.getElement(I(i + 1), v); tc.getElement(I(i + 2), w);
            uv = [(u[0] + v[0] + w[0]) / 3, (u[1] + v[1] + w[1]) / 3];
          }
        }
      }
      const s3 = s; // source units to metres
      const wTop = 8.3 * s3, wBot = 13.6 * s3, th = 0.06;
      // in the door's frame: hinge at the origin, the panel running from it to `bot`
      const d = bot.clone().sub(top);
      const pts = [[-wTop, 0, 0], [wTop, 0, 0], [wBot + 0, d.y, d.z], [-wBot, d.y, d.z]];
      const nrm = new THREE.Vector3(0, d.z, -d.y).normalize(); // facing out and back
      const P8 = [...pts.map((p) => p.map((v, i) => v + nrm.getComponent(i) * th / 2)), ...pts.map((p) => p.map((v, i) => v - nrm.getComponent(i) * th / 2))];
      const posArr = new Float32Array(P8.flat()), uvArr = new Float32Array(16);
      for (let i = 0; i < 8; i++) { uvArr[i * 2] = uv[0]; uvArr[i * 2 + 1] = uv[1]; }
      const ind = new Uint16Array([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2, 0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7]);
      const buf = doc.getRoot().listBuffers()[0];
      const prim = doc.createPrimitive()
        .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(posArr).setBuffer(buf))
        .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(uvArr).setBuffer(buf))
        .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array([0, 1, 2, 3, 4, 5, 6, 7].flatMap((i) => (i < 4 ? nrm : nrm.clone().negate()).toArray()))).setBuffer(buf))
        .setIndices(doc.createAccessor().setType('SCALAR').setArray(ind).setBuffer(buf))
        .setMaterial(mat);
      const door = doc.createNode('door').setTranslation(top.toArray()).setMesh(doc.createMesh('door').addPrimitive(prim));
      root.addChild(door);
      // how far it swings up under the pylon when open (the pylon's underside rises 8.5° forward)
      doorOpen = -(Math.atan2(-d.y, d.z) + Math.atan(7 / 47));
      console.log('ch47 door', d.toArray().map((v) => v.toFixed(2)), 'uv', uv.map((v) => v.toFixed(3)), 'open', doorOpen.toFixed(3));
    }
    // rotors (whole meshes): fore = Object_6 + 9, aft = Object_7 + 8
    pivotGroup(doc, root, 'rotor_fore', (n) => n === 'Object_6' || n === 'Object_9');
    pivotGroup(doc, root, 'rotor_aft', (n) => n === 'Object_7' || n === 'Object_8');
    anchors(doc, {
      rampFoot: P(0.25, 1.0, -98), inside: P(0.25, 12.1, -40), boardsSlide: slide, angles: [RAMP_SHUT, doorOpen, 0],
      lightPort: P(26, 12, 4), lightStbd: P(-25, 12, 4), lightTail: P(0.4, 72, -86), hold: P(0.25, 20, -70),
    });
    await grade(doc, { dark: 0.68, sat: 0.7 });
    await texWebp(doc, 2048);
    console.log('ch47 scale', s.toFixed(4), 'tris', triCount(doc));
    await finish(doc, 'ch47.glb', { ratio: 0.8, error: 0.001 });
  }

  // ── AH-64D attack helicopter: nose +z, 17.7 m rotor tip to tail. Origin under the
  // mast. Main and tail rotors are nodes on their hubs (main spins about y, the tail
  // one about x). Source: nose +x, about 1/7 scale; the blades are in the airframe mesh.
  async function apache() {
    const doc = await readRigid(V('AH-64D-Apache.glb'));
    const s = 17.73 / 2.49, hub = new THREE.Vector3(0.262, 0.15, 0);
    const M = new THREE.Matrix4().makeScale(s, s, s).multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 2)).multiply(new THREE.Matrix4().makeTranslation(-hub.x, 0.05, -hub.z));
    const P = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(M);
    const Minv = M.clone().invert();
    xformAll(doc, M);
    const root = rootNode(doc, 'apache');
    const tailHub = P(-1.063, 0.076, -0.102);
    splitByTriangles(doc, (tri) => {
      const c = centre3(tri).applyMatrix4(Minv);
      // main blades: the thin layer at the mast top, clear of the hub and the tail fin
      if (c.y > 0.118 && c.y < 0.19 && Math.hypot(c.x - hub.x, c.z - hub.z) > 0.075 && c.x > -0.8) return 0;
      // tail rotor: the disc on the port side of the fin
      if (c.x < -0.94 && c.z < -0.075 && c.z > -0.13 && c.y > -0.05) return 1;
      return -1;
    }, [{ name: 'rotor_main', pivot: P(hub.x, hub.y, hub.z).toArray() }, { name: 'rotor_tail', pivot: tailHub.toArray() }], root);
    anchors(doc, {
      gun: P(0.86, -0.27, 0), lamp: P(0.78, -0.24, 0.1),
      podL: P(0.42, -0.2, 0.255), podR: P(0.42, -0.2, -0.255),
      lightPort: P(0.27, -0.12, -0.42), lightStbd: P(0.27, -0.12, 0.42), lightTail: P(-1.22, 0.17, 0), // port is the model's +x
    });
    await grade(doc, { dark: 0.68, sat: 0.7 });
    await texWebp(doc, 1024);
    console.log('apache scale', s.toFixed(3), 'tris', triCount(doc));
    await finish(doc, 'apache.glb', { ratio: 0.8, error: 0.001 });
  }

  // ── crashed helicopter: long axis on x, base at 0, ~15 m with its debris. Source:
  // 121k triangles in spec-gloss; simplified hard (it is seen from 100+ m).
  async function heliwreck() {
    const doc = await readRigid(V('Crashed-Heliscopter.glb'));
    xformAll(doc, new THREE.Matrix4().makeRotationY(pcaYaw(doc)));
    const b0 = getBounds(scene(doc));
    fit(doc, 0, b0.max[0] - b0.min[0]); // metres already: centre and ground it
    for (const m of doc.getRoot().listMaterials()) m.setDoubleSided(true);
    await grade(doc, { dark: 0.7, sat: 0.7, rust: 0.3 });
    await texWebp(doc, 1024, { normalSize: 512 });
    const b = getBounds(scene(doc));
    console.log('heliwreck size', b.max.map((v, i) => (v - b.min[i]).toFixed(2)).join(' x '), 'tris', triCount(doc));
    await finish(doc, 'heliwreck.glb', { ratio: 22000 / triCount(doc), error: 0.003 });
  }

  // ── 20 ft ISO container: 6.06 x 2.59 x 2.44 m, doors at +x, base at 0. The
  // shipping line's painted logo is filled in with the rust around it.
  async function container() {
    const doc = await readRigid(V('ShippingContainer.glb'));
    const b = getBounds(scene(doc));
    const d = b.max.map((v, i) => v - b.min[i]);
    xformAll(doc, new THREE.Matrix4().makeScale(6.058 / d[0], 2.591 / d[1], 2.438 / d[2]));
    fit(doc, 0, 6.058);
    for (const m of doc.getRoot().listMaterials()) if (m.getName() === 'corrugated_sides') await inpaintWhite(m.getBaseColorTexture());
    await grade(doc, { dark: 0.55, sat: 0.75, rust: 0.25, soot: 0.25 });
    await texWebp(doc, 1024, { normalSize: 1024 });
    await finish(doc, 'container.glb');
  }
  /** Paint out white lettering: masked pixels filled from the unmasked ones around them, edge inwards. */
  async function inpaintWhite(tex) {
    const { data, info } = await sharp(Buffer.from(tex.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = info.width, H = info.height;
    let mask = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx > 120 && (mx - mn) < 0.35 * mx) mask[i] = 1;
    }
    // grow the mask a little to take the paint's soft edge
    for (let pass = 0; pass < 2; pass++) {
      const m2 = mask.slice();
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const i = y * W + x; if (!mask[i] && (mask[i - 1] || mask[i + 1] || mask[i - W] || mask[i + W])) m2[i] = 1; }
      mask = m2;
    }
    // fill: each pass, masked pixels with known neighbours take the mean of a 5x5 window's known pixels
    let left = mask.reduce((a, b) => a + b, 0);
    while (left > 0) {
      const done = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x; if (!mask[i]) continue;
        let n = 0; const acc = [0, 0, 0];
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const j = yy * W + xx; if (mask[j]) continue;
          n++; acc[0] += data[j * 3]; acc[1] += data[j * 3 + 1]; acc[2] += data[j * 3 + 2];
        }
        if (n >= 3) done.push([i, acc[0] / n, acc[1] / n, acc[2] / n]);
      }
      if (!done.length) break;
      for (const [i, r, g, b] of done) { data[i * 3] = r; data[i * 3 + 1] = g; data[i * 3 + 2] = b; mask[i] = 0; }
      left -= done.length;
    }
    tex.setImage(await sharp(data, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer()).setMimeType('image/png');
  }

  // ── round straw bale: 1.5 m across, 1.2 m wide, axis along x, base at 0. The
  // source's small square bale is dropped.
  async function bale() {
    const doc = await readRigid(V('Hay-Bale.glb'), (n) => n === 'Object_4');
    const b = getBounds(scene(doc)), d = b.max.map((v, i) => v - b.min[i]);
    // source: axis along z, diameter on x/y
    xformAll(doc, new THREE.Matrix4().makeScale(1.5 / d[0], 1.5 / d[1], 1.2 / d[2]));
    xformAll(doc, new THREE.Matrix4().makeRotationY(Math.PI / 2));
    fit(doc, 1, 1.5);
    await texWebp(doc, 512);
    await finish(doc, 'bale.glb', { ratio: 700 / triCount(doc), error: 0.01 });
  }

  // ── B-2 Spirit: the extraction's bombers. Metres (52.4 m span), nose +z, port +x, centred
  // on its bounds. The landing gear is dropped (it is only ever seen in flight) and its doors,
  // modelled hanging open, are swung shut over the wheel wells; the four bomb-bay doors (two bays, a pair of doors each) are nodes of their own,
  // 'door_0'..'door_3', pivoted on their hinge lines (the outer and the centre keel edges) so
  // the game can swing them down. Anchors: the four engine exhausts, the lamps, the bays.
  async function b2() {
    const GEAR = new Set(['Object_20', 'Object_11', 'Object_14']); // wheels, struts, the nose's open front doors (Object_8 lies shut; 17 is swung shut below)
    const DOORS = ['Object_32', 'Object_35', 'Object_38', 'Object_41'];
    const doc = await readRigid(V('B-2-Spirit.glb'), (n) => !GEAR.has(n));
    // source: nose -z, port -x, span 110.2 units
    xformAll(doc, new THREE.Matrix4().makeRotationY(Math.PI));
    let b = getBounds(scene(doc));
    const s = 52.4 / (b.max[0] - b.min[0]);
    xformAll(doc, new THREE.Matrix4().makeScale(s, s, s));
    // the gear doors, shut (before centring: open, they hang below the airframe). The main gear's
    // doors hang off their outboard hinges and swing inboard, flat under the wells; the nose
    // gear's front doors hang off the front of its well and swing back along the skin
    const swing = (name, side, axis, angle) => {
      const n = meshNodes(doc).find((x) => x.getName() === name);
      if (!n) return;
      for (const p of n.getMesh().listPrimitives()) {
        const P = p.getAttribute('POSITION'), N = p.getAttribute('NORMAL'), v = [], bb = new THREE.Box3();
        const on = (i) => { P.getElement(i, v); return side(v[0]); };
        for (let i = 0; i < P.getCount(); i++) if (on(i)) bb.expandByPoint(new THREE.Vector3(...v));
        if (bb.isEmpty()) continue;
        const piv = axis === 'z' ? new THREE.Vector3((bb.min.x + bb.max.x) / 2, bb.max.y, 0) : new THREE.Vector3(0, bb.max.y, (bb.min.z + bb.max.z) / 2);
        const q = new THREE.Quaternion().setFromAxisAngle(axis === 'z' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0), angle);
        for (let i = 0; i < P.getCount(); i++) {
          if (!on(i)) continue;
          P.setElement(i, new THREE.Vector3(...v).sub(piv).applyQuaternion(q).add(piv).toArray());
          if (N) { const w = []; N.getElement(i, w); N.setElement(i, new THREE.Vector3(...w).applyQuaternion(q).toArray()); }
        }
      }
    };
    swing('Object_17', (x) => x > 0, 'z', -Math.PI / 2);
    swing('Object_17', (x) => x < 0, 'z', Math.PI / 2);
    b = getBounds(scene(doc));
    xformAll(doc, new THREE.Matrix4().makeTranslation(-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2, -(b.min[2] + b.max[2]) / 2));
    b = getBounds(scene(doc));
    // the nose gear's front door, hanging open, is part of the airframe mesh itself: cut it out
    for (const n of meshNodes(doc)) for (const p of n.getMesh().listPrimitives()) {
      const P = p.getAttribute('POSITION'), I = p.getIndices(), keep = [], v = [];
      for (let t = 0; t < I.getCount(); t += 3) {
        let cx = 0, cy = 0, cz = 0;
        for (let j = 0; j < 3; j++) { P.getElement(I.getScalar(t + j), v); cx += v[0] / 3; cy += v[1] / 3; cz += v[2] / 3; }
        // (anything under the nose well's cap: below the line of the skin there, -1.0 at z 8.42 to -0.47 at 9.95)
        if (Math.abs(cx) < 0.7 && cz > 8.9 && cy < -1.0 + (cz - 8.42) * 0.346 - 0.06) continue;
        keep.push(I.getScalar(t), I.getScalar(t + 1), I.getScalar(t + 2));
      }
      if (keep.length < I.getCount()) p.setIndices(doc.createAccessor().setType('SCALAR').setBuffer(doc.getRoot().listBuffers()[0]).setArray(new Uint32Array(keep)));
    }
    const root = rootNode(doc, 'b2');
    // the nose wheel well, behind its (shut) front doors: capped by a panel in the line of the skin
    {
      const skin = doc.getRoot().listMaterials()[0], buf = doc.getRoot().listBuffers()[0];
      const cap = doc.createMaterial('wellCap').setBaseColorFactor([0.1, 0.105, 0.115, 1]).setMetallicFactor(0.2).setRoughnessFactor(0.8);
      void skin;
      const yb = -1.0, yf = -0.47, za = 8.42, zb = 9.95, w = 0.68;
      const pos = [-w, yb, za, w, yb, za, w, yf, zb, -w, yb, za, w, yf, zb, -w, yf, zb];
      const ny = -(zb - za), nz = (yf - yb), l = Math.hypot(ny, nz);
      const nrm = []; for (let i = 0; i < 6; i++) nrm.push(0, ny / l, nz / l);
      const acc = (a, t) => doc.createAccessor().setType(t).setBuffer(buf).setArray(new Float32Array(a));
      const prim = doc.createPrimitive().setMaterial(cap).setAttribute('POSITION', acc(pos, 'VEC3')).setAttribute('NORMAL', acc(nrm, 'VEC3'));
      root.addChild(doc.createNode('noseWellCap').setMesh(doc.createMesh('noseWellCap').addPrimitive(prim)));
    }
    const box = (n) => { const vs = verts(doc, (x) => x === n.getName()); const bb = new THREE.Box3(); for (const v of vs) bb.expandByPoint(v); return bb; };
    // the bay doors: each hinged on its outboard edge if it is the outer door of its bay, else on the keel
    const doorOpen = [];
    DOORS.map((name) => meshNodes(doc).find((n) => n.getName() === name)).sort((a, c) => box(a).getCenter(new THREE.Vector3()).x - box(c).getCenter(new THREE.Vector3()).x)
      .forEach((n, k) => {
        const bb = box(n), cx = (bb.min.x + bb.max.x) / 2, outer = Math.abs(cx) > 1.25;
        const outerEdge = cx > 0 ? bb.max.x : bb.min.x, innerEdge = cx > 0 ? bb.min.x : bb.max.x;
        const hx = outer ? outerEdge : innerEdge;
        const pivot = [hx, bb.max.y, (bb.min.z + bb.max.z) / 2];
        transformMesh(n.getMesh(), new THREE.Matrix4().makeTranslation(-pivot[0], -pivot[1], -pivot[2]).elements);
        n.setName('door_' + k).setTranslation(pivot);
        // swinging down: the free edge lies toward the bay's other door
        const free = (outer ? innerEdge : outerEdge) - hx;
        doorOpen.push(+(-Math.sign(free) * 1.45).toFixed(3));
        console.log('b2 door', k, 'x', bb.min.x.toFixed(2), bb.max.x.toFixed(2), 'y', bb.max.y.toFixed(2), 'z', bb.min.z.toFixed(2), bb.max.z.toFixed(2), outer ? 'outer' : 'keel');
      });
    // measured off the airframe: the wingtips, the top and belly of the centre body, the engines
    const all = verts(doc, (x) => !x.startsWith('door'));
    const near = (test) => { const vs = all.filter(test); return centroid(vs); };
    const port = near((v) => v.x > b.max[0] - 0.25), stbd = port.clone().setX(-port.x);
    const top = all.filter((v) => Math.abs(v.x) < 0.3).reduce((a, v) => (v.y > a.y ? v : a));
    const belly = all.filter((v) => Math.abs(v.x) < 0.3 && v.z < 0 && v.z > -4).reduce((a, v) => (v.y < a.y ? v : a));
    // the exhausts: the slots at the back of each nacelle hump (two engines a side)
    const exh = [];
    for (const name of ['Object_29', 'Object_80']) {
      const vs = verts(doc, (x) => x === name), zmin = Math.min(...vs.map((v) => v.z));
      const bb = new THREE.Box3(); for (const v of vs) if (v.z < zmin + 0.35) bb.expandByPoint(v);
      console.log('b2 exhaust', name, bb.min.toArray().map((v) => v.toFixed(2)).join(','), '..', bb.max.toArray().map((v) => v.toFixed(2)).join(','));
      for (const u of [0.3, 0.7]) exh.push(new THREE.Vector3(THREE.MathUtils.lerp(bb.min.x, bb.max.x, u), THREE.MathUtils.lerp(bb.min.y, bb.max.y, 0.4), zmin));
    }
    exh.sort((p, q) => p.x - q.x);
    console.log('b2 bounds', b.min.map((v) => v.toFixed(2)).join(','), '..', b.max.map((v) => v.toFixed(2)).join(','), 'lamps', port.toArray().map((v) => v.toFixed(2)), top.toArray().map((v) => v.toFixed(2)), belly.toArray().map((v) => v.toFixed(2)));
    anchors(doc, {
      doorOpen, port: port.add(new THREE.Vector3(0.05, 0, 0)), stbd: stbd.add(new THREE.Vector3(-0.05, 0, 0)), top: top.add(new THREE.Vector3(0, 0.08, 0)), belly: belly.add(new THREE.Vector3(0, -0.08, 0)),
      exhaust: exh.flatMap((p) => p.toArray()),
      bays: [-1.23, 1.23].flatMap((x) => [x, -1.5, 1.0]), // the middle of each bay, under the doors
    });
    await grade(doc, { dark: 0.85, sat: 0.55 });
    await texWebp(doc, 2048, { normalSize: 2048 });
    console.log('b2 scale', s.toFixed(4), 'tris', triCount(doc));
    await finish(doc, 'b2.glb');
  }

  // ── general-purpose bomb: 2.2 m, laid along z with the nose at +z, centred.
  async function bomb() {
    const doc = await readRigid(V('Aircraft-Bomb.glb'));
    // source: upright, nose down (-y), fins up
    xformAll(doc, new THREE.Matrix4().makeRotationX(-Math.PI / 2)); // -y (nose) -> +z
    const b = getBounds(scene(doc));
    const s = 2.2 / (b.max[2] - b.min[2]);
    xformAll(doc, new THREE.Matrix4().makeScale(s, s, s));
    const c = getBounds(scene(doc));
    xformAll(doc, new THREE.Matrix4().makeTranslation(-(c.min[0] + c.max[0]) / 2, -(c.min[1] + c.max[1]) / 2, -(c.min[2] + c.max[2]) / 2));
    await texWebp(doc, 512);
    await finish(doc, 'bomb.glb');
  }

  // ── farmhouse (House-1): single storey, 12 m across its long side, base at 0, its long
  // front along +x facing +z. The ground plane is dropped; the roof is a node of its own
  // ('roof') so burnt-out houses can stand open to the sky.
  async function house() {
    const doc = await readRigid(V('House-1.glb'));
    for (const n of meshNodes(doc)) {
      const mesh = n.getMesh();
      for (const p of mesh.listPrimitives()) if (p.getMaterial()?.getName() === 'ground') { mesh.removePrimitive(p); p.dispose(); }
      if (!mesh.listPrimitives().length) { n.setMesh(null); mesh.dispose(); }
    }
    await doc.transform(prune());
    const b = getBounds(scene(doc)), d = b.max.map((v, i) => v - b.min[i]);
    if (d[2] > d[0]) xformAll(doc, new THREE.Matrix4().makeRotationY(Math.PI / 2));
    fit(doc, 0, 12);
    const root = rootNode(doc, 'house');
    const roof = doc.createNode('roof'); root.addChild(roof);
    for (const n of meshNodes(doc)) {
      const mesh = n.getMesh();
      const rp = mesh.listPrimitives().filter((p) => p.getMaterial()?.getName() === 'roof');
      if (!rp.length) continue;
      const rm = doc.createMesh(n.getName() + '_roof');
      for (const p of rp) { mesh.removePrimitive(p); rm.addPrimitive(p); }
      roof.addChild(doc.createNode(n.getName() + '_roof').setMesh(rm));
      if (!mesh.listPrimitives().length) n.setMesh(null);
    }
    await grade(doc, { dark: 0.42, sat: 0.6, soot: 0.45 });
    await texWebp(doc, 1024, { normalSize: 512 });
    const bb = getBounds(scene(doc));
    console.log('house size', bb.max.map((v, i) => (v - bb.min[i]).toFixed(2)).join(' x '), 'tris', triCount(doc));
    await finish(doc, 'house.glb', { ratio: Math.min(1, 9000 / triCount(doc)), error: 0.002 });
  }

  // ── a soldier's load: the weapons crate, 0.9 m long along x, base at 0
  async function mcrate() {
    const doc = await readRigid(V('MilitaryCrate.glb'));
    const b = getBounds(scene(doc)), d = b.max.map((v, i) => v - b.min[i]);
    if (d[2] > d[0]) xformAll(doc, new THREE.Matrix4().makeRotationY(Math.PI / 2));
    fit(doc, 0, 0.9);
    await grade(doc, { dark: 0.55, sat: 0.75 });
    await texWebp(doc, 512);
    const bb = getBounds(scene(doc));
    console.log('mcrate size', bb.max.map((v, i) => (v - bb.min[i]).toFixed(2)).join(' x '), 'tris', triCount(doc));
    await finish(doc, 'mcrate.glb', { ratio: Math.min(1, 1500 / triCount(doc)), error: 0.002 });
  }

  // ── the village church: nave and bell tower, 16 m, base at 0. The interior
  // (pews, altar, candles, chalices) and the ground plate are dropped: it is seen
  // from the wall, half a kilometre off. Grade like the houses.
  async function church() {
    const doc = await readRigid(V('Church.glb'));
    const drop = new Set(['ground', 'bancos', 'altar', 'calices', 'velas', 'lambert1']);
    for (const n of meshNodes(doc)) {
      const mesh = n.getMesh();
      for (const p of mesh.listPrimitives()) if (drop.has(p.getMaterial()?.getName())) { mesh.removePrimitive(p); p.dispose(); }
      if (!mesh.listPrimitives().length) { n.setMesh(null); mesh.dispose(); }
    }
    await doc.transform(prune());
    const b0 = getBounds(scene(doc));
    fit(doc, 2, (b0.max[2] - b0.min[2]) * 1.5); // bigger than modelled: a village church, not a chapel
    rootNode(doc, 'church');
    await grade(doc, { dark: 0.45, sat: 0.6, soot: 0.4 });
    await texWebp(doc, 1024, { normalSize: 512 });
    const bb = getBounds(scene(doc));
    console.log('church size', bb.max.map((v, i) => (v - bb.min[i]).toFixed(2)).join(' x '), 'tris', triCount(doc));
    await finish(doc, 'church.glb', { ratio: Math.min(1, 12000 / triCount(doc)), error: 0.002 });
  }

  // ── a czech hedgehog: three steel angles, about 2 m across, base at 0
  async function hedgehog() {
    const doc = await readRigid(V('Czech-Hedgehog.glb'));
    const b = getBounds(scene(doc)), d = b.max.map((v, i) => v - b.min[i]);
    fit(doc, d[0] > d[2] ? 0 : 2, 2.1);
    rootNode(doc, 'hedgehog');
    await grade(doc, { dark: 0.8, sat: 0.7, rust: 0.35 });
    await texWebp(doc, 512);
    const bb = getBounds(scene(doc));
    console.log('hedgehog size', bb.max.map((v, i) => (v - bb.min[i]).toFixed(2)).join(' x '), 'tris', triCount(doc));
    await finish(doc, 'hedgehog.glb', { ratio: Math.min(1, 1200 / triCount(doc)), error: 0.002 });
  }

  // ── the central tower: the user's own model (Blender), read straight from
  // F:\LastBastion\3D Models\Tower\Tower.glb so a re-export only needs this build run
  // again (falls back to source/vehicles/Tower.glb). Kept in its own frame (metres,
  // front face towards -z, ground at y = 0); the game places it (structures.js, TOWER).
  // Its concrete ships as one material named 'concrete' (a stand-in texture): the game paints it
  // with the wall's own concrete (the `slab` set, ambientCG Concrete044C, the same one
  // the model was made with) so the tower and the wall always match. Every texture set
  // is moved to the first UV channel.
  async function tower() {
    const own = path.resolve(SRC, '..', '..', '..', '..', '3D Models', 'Tower', 'Tower.glb');
    const fs = await import('node:fs');
    const doc = await io.read(fs.existsSync(own) ? own : V('Tower.glb'));
    const root = doc.getRoot();
    await doc.transform(flatten());
    // Blender's linked duplicates share a mesh: give each node its own before baking, or it moves twice
    const seen = new Set();
    for (const n of root.listNodes()) { const m = n.getMesh(); if (!m) continue; if (seen.has(m)) n.setMesh(m.clone()); else seen.add(m); }
    bakeNodes(doc);
    // one UV channel: a primitive whose textures read TEXCOORD_1 gets it as TEXCOORD_0
    for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
      const m = p.getMaterial();
      const infos = m ? [m.getBaseColorTextureInfo(), m.getNormalTextureInfo(), m.getMetallicRoughnessTextureInfo(), m.getOcclusionTextureInfo(), m.getEmissiveTextureInfo()].filter(Boolean) : [];
      const tc = infos.length ? infos[0].getTexCoord() : 0;
      if (tc === 1 && p.getAttribute('TEXCOORD_1')) {
        p.setAttribute('TEXCOORD_0', p.getAttribute('TEXCOORD_1'));
        for (const i of infos) i.setTexCoord(0);
      }
      if (p.getAttribute('TEXCOORD_1')) p.setAttribute('TEXCOORD_1', null);
    }
    // the concrete: one material the game swaps for its own. It keeps a 2 px stand-in texture
    // (two greys: prune flattens a single-colour one), or prune would drop its UVs as unused.
    const stand = doc.createTexture('concrete').setMimeType('image/png')
      .setImage(await sharp(Buffer.from([138, 135, 128, 128, 125, 118]), { raw: { width: 2, height: 1, channels: 3 } }).png().toBuffer());
    const concrete = doc.createMaterial('concrete').setBaseColorTexture(stand).setRoughnessFactor(0.9).setMetallicFactor(0).setDoubleSided(true);
    for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) if (/concrete/i.test(p.getMaterial()?.getName() || '')) p.setMaterial(concrete);
    await doc.transform(prune());
    rootNode(doc, 'tower');
    await grade(doc, { dark: 0.62, sat: 0.7, soot: 0.25 });
    await texWebp(doc, 1024, { normalSize: 1024 });
    // the measurements the game is laid out to (structures.js): warn if a new export moves them
    const node = (name) => meshNodes(doc).find((n) => n.getName() === name);
    const yTop = (name) => { const vs = verts(doc, (n) => n === name); return vs.length ? Math.max(...vs.map((v) => v.y)) : NaN; };
    const body = verts(doc, (n) => n === 'Cube');
    const front = body.length ? Math.min(...body.map((v) => v.z)) : NaN;
    const roof = yTop('Cube.006'), deck = Math.max(...verts(doc, (n) => n.startsWith('Cube.001')).map((v) => v.y));
    const b = getBounds(scene(doc));
    console.log('tower size', b.max.map((v, i) => (v - b.min[i]).toFixed(2)).join(' x '), 'front z', front.toFixed(2), 'roof y', roof.toFixed(2), 'deck y', deck.toFixed(2), 'tris', triCount(doc), node('Cube') ? '' : '(no "Cube" node: front unknown)');
    const want = { front: -4.64, roof: 9.0, deck: 9.0 };
    for (const [k, v] of Object.entries({ front, roof, deck })) if (!(Math.abs(v - want[k]) < 0.06)) console.warn(`tower: ${k} is ${v.toFixed(2)}, the game expects ${want[k]} (src/world/structures.js TOWER, src/config.js TOWER_TOP)`);
    await finish(doc, 'tower.glb');
  }


  // ── per-texel model positions: what each texel of a texture covers on the model ──
  /**
   * For one texture, the model-space position under each of its R x R texels, rasterised
   * from every triangle drawn with it (UVs wrapped into 0..1). Texels no triangle covers
   * are filled from their neighbours (a few passes), the rest read null.
   */
  function texelPositions(doc, tex, R = 512) {
    const P = new Float32Array(R * R * 3).fill(NaN);
    for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
      const m = p.getMaterial(); if (!m || m.getBaseColorTexture() !== tex) continue;
      const pos = p.getAttribute('POSITION'), tc = p.getAttribute('TEXCOORD_0'); if (!tc) continue;
      const idx = p.getIndices(), n = idx ? idx.getCount() : pos.getCount(), I = (k) => (idx ? idx.getScalar(k) : k);
      const v = [[], [], []], t = [[], [], []];
      for (let k = 0; k < n; k += 3) {
        for (let j = 0; j < 3; j++) { pos.getElement(I(k + j), v[j]); tc.getElement(I(k + j), t[j]); }
        // wrap the triangle as a whole (by its first corner's tile)
        const ou = Math.floor(t[0][0]), ov = Math.floor(t[0][1]);
        const x = t.map((q) => (q[0] - ou) * R), y = t.map((q) => (q[1] - ov) * R);
        const d = (x[1] - x[0]) * (y[2] - y[0]) - (x[2] - x[0]) * (y[1] - y[0]); if (Math.abs(d) < 1e-9) continue;
        const x0 = Math.max(0, Math.floor(Math.min(...x))), x1 = Math.min(R - 1, Math.ceil(Math.max(...x)));
        const y0 = Math.max(0, Math.floor(Math.min(...y))), y1 = Math.min(R - 1, Math.ceil(Math.max(...y)));
        for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
          const cx = px + 0.5, cy = py + 0.5;
          const b1 = ((cx - x[0]) * (y[2] - y[0]) - (x[2] - x[0]) * (cy - y[0])) / d;
          const b2 = ((x[1] - x[0]) * (cy - y[0]) - (cx - x[0]) * (y[1] - y[0])) / d;
          const b0 = 1 - b1 - b2; if (b0 < -0.02 || b1 < -0.02 || b2 < -0.02) continue;
          const o = (py * R + px) * 3;
          for (let a = 0; a < 3; a++) P[o + a] = b0 * v[0][a] + b1 * v[1][a] + b2 * v[2][a];
        }
      }
    }
    for (let pass = 0; pass < 4; pass++) {
      const Q = P.slice();
      for (let py = 0; py < R; py++) for (let px = 0; px < R; px++) {
        const o = (py * R + px) * 3; if (!Number.isNaN(P[o])) continue;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const qx = px + dx, qy = py + dy; if (qx < 0 || qy < 0 || qx >= R || qy >= R) continue;
          const q = (qy * R + qx) * 3; if (Number.isNaN(P[q])) continue;
          Q[o] = P[q]; Q[o + 1] = P[q + 1]; Q[o + 2] = P[q + 2]; break;
        }
      }
      P.set(Q);
    }
    return { R, at: (u, v) => { const px = Math.min(R - 1, Math.floor(u * R)), py = Math.min(R - 1, Math.floor(v * R)), o = (py * R + px) * 3; return Number.isNaN(P[o]) ? null : [P[o], P[o + 1], P[o + 2]]; } };
  }
  /** An ambientCG colour map as a sampler (wrapping coordinates -> [r, g, b] 0..1). */
  async function acgSampler(asset, R = 512) {
    const px = await sharp(ACG(asset, 'Color')).resize(R, R).removeAlpha().raw().toBuffer();
    return (u, v) => { const x = Math.floor((((u % 1) + 1) % 1) * R), y = Math.floor((((v % 1) + 1) % 1) * R), o = (y * R + x) * 3; return [px[o] / 255, px[o + 1] / 255, px[o + 2] / 255]; };
  }
  const ckey = (c) => c.toArray().map((v) => v.toFixed(4)).join(',');
  /** Keep only the triangles `keep(centre, tri)` accepts, in the mesh nodes `test` names. */
  function cullTris(doc, test, keep) {
    for (const n of meshNodes(doc)) {
      if (!test(n.getName())) continue;
      for (const p of n.getMesh().listPrimitives()) {
        const pos = p.getAttribute('POSITION'), idx = p.getIndices(), cnt = idx.getCount(), out = [];
        for (let k = 0; k < cnt; k += 3) {
          const tri = [0, 1, 2].map((j) => pos.getElement(idx.getScalar(k + j), []));
          if (keep(centre3(tri), tri)) out.push(idx.getScalar(k), idx.getScalar(k + 1), idx.getScalar(k + 2));
        }
        if (out.length < cnt) p.setIndices(doc.createAccessor().setType('SCALAR').setBuffer(doc.getRoot().listBuffers()[0]).setArray(new Uint32Array(out)));
      }
    }
  }
  /** Connected pieces (by shared vertex positions) of the mesh nodes `test` names: [{ box, tris: Set of centre keys, node }]. */
  function islands(doc, test) {
    const key = (v) => v.map((c) => c.toFixed(4)).join(',');
    const out = [];
    for (const n of meshNodes(doc)) {
      if (!test(n.getName())) continue;
      for (const p of n.getMesh().listPrimitives()) {
        const pos = p.getAttribute('POSITION'), idx = p.getIndices(), cnt = idx.getCount();
        const par = new Map(), find = (a) => { while (par.get(a) !== a) { par.set(a, par.get(par.get(a))); a = par.get(a); } return a; };
        const tris = [];
        for (let k = 0; k < cnt; k += 3) {
          const tri = [0, 1, 2].map((j) => pos.getElement(idx.getScalar(k + j), []));
          const ks = tri.map(key);
          for (const q of ks) if (!par.has(q)) par.set(q, q);
          par.set(find(ks[1]), find(ks[0])); par.set(find(ks[2]), find(ks[0]));
          tris.push([ks[0], tri]);
        }
        const m = new Map();
        for (const [k0, tri] of tris) {
          const r = find(k0); if (!m.has(r)) m.set(r, { box: new THREE.Box3(), tris: new Set(), node: n.getName() });
          const s = m.get(r); for (const v of tri) s.box.expandByPoint(new THREE.Vector3(...v)); s.tris.add(ckey(centre3(tri)));
        }
        out.push(...m.values());
      }
    }
    return out;
  }
  /** Burn every material: soot and rust over the texture's own shading (the burnt Ural's recipe), the soot heaviest high up. */
  async function burnTextures(doc, { sootTop = 1.2, sootK = 0.75 } = {}) {
    for (const m of doc.getRoot().listMaterials()) {
      m.setMetallicFactor(0.15).setRoughnessFactor(0.95);
      if (m.getMetallicRoughnessTexture()) m.setMetallicRoughnessTexture(null);
      if (m.getEmissiveTexture()) m.setEmissiveTexture(null).setEmissiveFactor([0, 0, 0]);
      const t = m.getBaseColorTexture();
      if (!t) { m.setBaseColorFactor([0.03, 0.03, 0.03, 1]); continue; }
      const tp = texelPositions(doc, t);
      await repaint(t, (r, g, b, u, v) => {
        const l = (0.3 * r + 0.59 * g + 0.11 * b) / 255;
        const P = tp.at(u, v) || [0, 0, 0];
        const soot = THREE.MathUtils.smoothstep(fbm(P[0] * 1.1 + 5, P[1] * 1.1 + P[2] * 0.9), 0.35, 0.65);
        const up = THREE.MathUtils.smoothstep(P[1], sootTop - 0.8, sootTop + 0.6);
        const rust = [0.36 * l + 0.1, 0.2 * l + 0.05, 0.12 * l + 0.03];
        const k = Math.min(1, 0.2 + sootK * soot * 0.7 + 0.45 * up);
        return rust.map((c, i) => Math.round(255 * (c * (1 - k) + [0.035, 0.032, 0.03][i] * k)));
      });
    }
    await doc.transform(prune());
  }

  // ── GAZ-51 fuel truck: the tanker stalled on the road (the night event). Nose +x, 5.8 m,
  // base at 0. Its factory orange is buried under road mud (ambientCG Ground051, thick on the
  // wheels and sills, splashed up the tank in streaks), rust (Rust009 through Metal041B's
  // spots) and grime, and darkened for the night; the white stencils fade into the paint.
  // fueltruck_burnt.glb is what is left once it goes up. Source: nose +z, metres.
  async function fuelDoc() {
    const doc = await readRigid(V('Fuel-Truck.glb'));
    xformAll(doc, new THREE.Matrix4().makeRotationY(Math.PI / 2));
    fit(doc, 0, 5.8);
    rootNode(doc, 'fueltruck');
    return doc;
  }
  async function fueltruck() {
    let doc = await fuelDoc();
    const mud = await acgSampler('Ground051');
    const L = await rustLayers();
    const OXIDE = [0.6, 0.33, 0.16];
    for (const m of doc.getRoot().listMaterials()) {
      // (dull all over: the source's gloss map and its glowing lamps go)
      m.setMetallicRoughnessTexture(null).setMetallicFactor(0.25).setRoughnessFactor(0.88).setEmissiveTexture(null).setEmissiveFactor([0, 0, 0]);
      const t = m.getBaseColorTexture(); if (!t) continue;
      const tp = texelPositions(doc, t);
      const body = /Body/.test(m.getName());
      await repaint(t, (r, g, b, u, v) => {
        let c = [r / 255, g / 255, b / 255];
        const P = tp.at(u, v) || [0, 1.5, 0];
        // the stencils (white on the tank, the plate): pulled down to the paint around them
        const white = body ? Math.min(1, Math.max(0, (Math.min(c[0], c[1], c[2]) - 0.42) / 0.2)) : 0;
        if (white > 0) c = c.map((x, i) => x * (1 - 0.85 * white) + OXIDE[i] * 0.85 * white);
        // the orange taken down to a dull oxide brown, most of its colour gone
        const l = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
        c = c.map((x) => l + (x - l) * 0.42);
        // rust where Metal041B's spots fall, gathered in patches (laid by model position, so it runs across seams)
        const tu = P[0] * 0.35 + P[2] * 0.21, tv = P[1] * 0.35 - P[2] * 0.13;
        const j = Math.floor((((tv % 1) + 1) % 1) * L.R) * L.R + Math.floor((((tu % 1) + 1) % 1) * L.R);
        const kr = Math.min(1, L.mask[j] * (0.5 + 0.9 * fbm(P[0] * 0.9 + 3, P[1] * 0.9 + P[2] * 0.7))) * 0.9;
        c = c.map((x, i) => x * (1 - kr) + (L.col[j * 3 + i] / 255) * 0.55 * kr);
        // road mud: thick below the axles and on the sills, thrown up in streaks, a film of dust over everything
        const h = P[1], streak = fbm(P[0] * 2.5 + P[2] * 0.7, h * 0.6 + 4) * 0.8 + fbm(P[0] * 9 + P[2] * 3, h * 1.8) * 0.4;
        const km = Math.min(1, THREE.MathUtils.smoothstep(1.45 + 0.6 * streak - h, 0, 0.55) * (0.6 + 0.5 * streak)) * 0.82 + 0.18;
        const mc = mud(P[0] * 0.45 + P[2] * 0.3, h * 0.45 + P[2] * 0.2).map((x) => x * 0.55);
        c = c.map((x, i) => x * (1 - km) + mc[i] * km);
        // grime in blotches
        const s = THREE.MathUtils.smoothstep(fbm(P[0] * 1.3 + 7, P[1] * 1.3 + P[2]), 0.42, 0.8) * 0.55;
        return c.map((x) => Math.round(255 * Math.min(1, x * (1 - 0.75 * s) * 0.55)));
      });
    }
    await texWebp(doc, 1024, { normalSize: 1024 });
    const b = getBounds(scene(doc));
    console.log('fueltruck size', b.max.map((v, i) => (v - b.min[i]).toFixed(2)).join(' x '), 'tris', triCount(doc));
    await finish(doc, 'fueltruck.glb', { ratio: Math.min(1, 16000 / triCount(doc)), error: 0.002 });

    // what is left once it has gone up: the paint burnt off to soot and rust, the glass gone
    doc = await fuelDoc();
    await burnTextures(doc);
    await grade(doc, { dark: 0.85, sat: 0.8, rust: 0.45 });
    await texWebp(doc, 1024, { normalSize: 1024 });
    await finish(doc, 'fueltruck_burnt.glb', { ratio: Math.min(1, 16000 / triCount(doc)), error: 0.002 });
  }

  // ── Leopard 2: the knocked-out tank in the field. The source is intact; this makes it a
  // burnt-out hulk: the turret blown askew on its ring (slewed round, lifted on one side), the
  // gun dropped, the antennas gone, the port track snapped (its upper run and front curve gone,
  // a length of it lying out in front), the front wheels on that side lost, the turret ring open
  // and black, everything scorched to soot and rust. Nose +x, hull centred, tracks on y = 0.
  // Source: metres, nose +x, track bottoms at y -1.1.
  async function leopard() {
    // (Object_5 is a second copy of the hull, Object_4)
    const doc = await readRigid(V('Leopard.glb'), (n) => n !== 'Object_5');
    const G = 1.108; // the source's ground under the tracks
    const isl = islands(doc, () => true);
    const drop = new Set();
    // the antennas: tall thin pieces
    for (const s of isl) { const d = s.box.getSize(new THREE.Vector3()); if ((d.y > 0.7 && d.x < 0.3 && d.z < 0.3) || (s.node === 'Object_4' && s.box.min.y > 1.5)) for (const k of s.tris) drop.add(k); }
    // the port (+z) side's front road wheels and idler, off with the track
    for (const s of isl) if (s.node === 'Object_3' && s.box.min.z > 1 && s.box.min.x > 1.7) for (const k of s.tris) drop.add(k);
    cullTris(doc, () => true, (c) => !drop.has(ckey(c)));
    // the port track: its upper run and front curve forward of x 0.6 gone (the bottom run still
    // lies where it was); a length of the upper run is kept to lie in front of the hull
    const thrown = [];
    cullTris(doc, (n) => n === 'Object_6', (c, tri) => {
      if (!(c.z > 1 && c.x > 0.6)) return true;
      if (c.y < -0.85) return true;
      if (c.y > 0.0 && c.x < 3.0) thrown.push(tri);
      return false;
    });
    {
      const src = meshNodes(doc).find((n) => n.getName() === 'Object_6').getMesh().listPrimitives()[0];
      const m = new THREE.Matrix4().makeTranslation(4.2, 0, 2.6).multiply(new THREE.Matrix4().makeRotationY(-1.1)).multiply(new THREE.Matrix4().makeTranslation(-1.8, -G + 0.02, -1.44));
      const pos = src.getAttribute('POSITION'), nrm = src.getAttribute('NORMAL'), tc = src.getAttribute('TEXCOORD_0');
      const at = new Map(); for (let i = 0; i < pos.getCount(); i++) at.set(pos.getElement(i, []).map((c) => c.toFixed(5)).join(','), i);
      const posA = [], nrmA = [], uvA = [];
      for (const tri of thrown) for (const v of tri) {
        const i = at.get(v.map((c) => c.toFixed(5)).join(','));
        posA.push(...new THREE.Vector3(...v).applyMatrix4(m).toArray());
        nrmA.push(...(i !== undefined && nrm ? new THREE.Vector3(...nrm.getElement(i, [])).transformDirection(m).toArray() : [0, 1, 0]));
        uvA.push(...(i !== undefined && tc ? tc.getElement(i, []) : [0, 0]));
      }
      const buf = doc.getRoot().listBuffers()[0], acc = (a, t) => doc.createAccessor().setType(t).setBuffer(buf).setArray(new Float32Array(a));
      const pr = doc.createPrimitive().setMaterial(src.getMaterial()).setAttribute('POSITION', acc(posA, 'VEC3')).setAttribute('NORMAL', acc(nrmA, 'VEC3')).setAttribute('TEXCOORD_0', acc(uvA, 'VEC2'))
        .setIndices(doc.createAccessor().setType('SCALAR').setBuffer(buf).setArray(new Uint32Array(posA.length / 3).map((_, i) => i)));
      scene(doc).addChild(doc.createNode('thrown').setMesh(doc.createMesh('thrown').addPrimitive(pr)));
      console.log('leopard thrown track tris', thrown.length);
    }
    // the turret (Object_8 and the commander's sight, Object_2) and its gun, each on its own pivot
    const ring = new THREE.Vector3(-0.6, 0.76, 0), trunnion = new THREE.Vector3(1.3, 0.94, 0);
    const barrel = isl.find((s) => s.node === 'Object_8' && s.box.min.x > 1 && s.box.max.x > 5.5);
    const onGun = (c) => (barrel && barrel.tris.has(ckey(c))) || (c.x > 2.18 && Math.abs(c.z) < 0.3 && c.y > 0.7 && c.y < 1.2);
    const turretTris = new Set();
    for (const n of meshNodes(doc)) if (n.getName() === 'Object_8' || n.getName() === 'Object_2') for (const p of n.getMesh().listPrimitives()) {
      const pos = p.getAttribute('POSITION'), idx = p.getIndices();
      for (let k = 0; k < idx.getCount(); k += 3) turretTris.add(ckey(centre3([0, 1, 2].map((j) => pos.getElement(idx.getScalar(k + j), [])))));
    }
    // (Object_8 also carries a copy of the hull's slat-armour cage, reaching down the hull sides: it stays)
    for (const s of isl) if (s.node === 'Object_8' && s.box.min.y < 0.5) for (const k of s.tris) turretTris.delete(k);
    const root = rootNode(doc, 'leopard');
    splitByTriangles(doc, (tri) => { const c = centre3(tri); if (!turretTris.has(ckey(c))) return -1; return onGun(c) ? 1 : 0; },
      [{ name: 'turret', pivot: ring.toArray() }, { name: 'gun', pivot: trunnion.toArray() }], root);
    const nodes = doc.getRoot().listNodes(), turretN = nodes.find((n) => n.getName() === 'turret'), gunN = nodes.find((n) => n.getName() === 'gun');
    root.removeChild(gunN); turretN.addChild(gunN.setTranslation(trunnion.clone().sub(ring).toArray()));
    // the blast: slewed round to starboard, the port side lifted off the ring and dropped back on the deck
    turretN.setTranslation(ring.clone().add(new THREE.Vector3(-0.25, 0.14, 0.1)).toArray())
      .setRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.15, -0.66, 0.05, 'YXZ')).toArray());
    gunN.setRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.3)).toArray());
    // the open turret ring: a black disc on the deck
    {
      const buf = doc.getRoot().listBuffers()[0], seg = 28, r = 1.05, pos = [ring.x, ring.y + 0.02, ring.z], ind = [];
      for (let i = 0; i < seg; i++) { const a = (i / seg) * Math.PI * 2; pos.push(ring.x + Math.cos(a) * r, ring.y + 0.02, ring.z + Math.sin(a) * r); ind.push(0, 1 + ((i + 1) % seg), 1 + i); }
      const black = doc.createMaterial('hole').setBaseColorFactor([0.008, 0.007, 0.006, 1]).setRoughnessFactor(1).setMetallicFactor(0);
      const pr = doc.createPrimitive().setMaterial(black)
        .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setBuffer(buf).setArray(new Float32Array(pos)))
        .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setBuffer(buf).setArray(new Float32Array(pos.length).map((_, i) => (i % 3 === 1 ? 1 : 0))))
        .setIndices(doc.createAccessor().setType('SCALAR').setBuffer(buf).setArray(new Uint16Array(ind)));
      root.addChild(doc.createNode('ring').setMesh(doc.createMesh('ring').addPrimitive(pr)));
    }
    // to the game's frame: hull centred on x/z, tracks on y = 0
    const hull = new THREE.Box3(); for (const v of verts(doc, (n) => n === 'Object_4')) hull.expandByPoint(v);
    const off = [-(hull.min.x + hull.max.x) / 2, G, -(hull.min.z + hull.max.z) / 2];
    root.setTranslation(off);
    await burnTextures(doc, { sootTop: 1.3, sootK: 0.9 });
    await grade(doc, { dark: 0.8, sat: 0.75, rust: 0.4 });
    await texWebp(doc, 1024, { normalSize: 1024 });
    console.log('leopard hull', hull.min.toArray().map((v) => v.toFixed(2)), hull.max.toArray().map((v) => v.toFixed(2)), 'offset', off.map((v) => v.toFixed(2)), 'tris', triCount(doc));
    await finish(doc, 'leopard_wreck.glb', { ratio: Math.min(1, 16000 / triCount(doc)), error: 0.002 });
  }

  return { cars, ural, ch47, apache, heliwreck, container, bale, bomb, b2, house, mcrate, church, hedgehog, tower, fueltruck, leopard, helpers: { grade, texWebp, anchors, triCount, repaint } };
}
