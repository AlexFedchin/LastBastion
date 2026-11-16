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
    const { data, info } = await sharp(Buffer.from(tex.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let y = 0, i = 0; y < info.height; y++) for (let x = 0; x < info.width; x++, i += 3) {
      const o = fn(data[i], data[i + 1], data[i + 2], x / info.width, y / info.height);
      data[i] = o[0]; data[i + 1] = o[1]; data[i + 2] = o[2];
    }
    tex.setImage(await sharp(data, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer()).setMimeType('image/png');
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
    // the ramp is modelled lowered to level, its top welded into the cabin floor, so it
    // stays put (lifters fly ramp-level); what moves are the two treadway boards on its
    // tip, which reach down to the ground: node 'ramp', hinged at their root, laid level
    const hinge = P(0.25, 5.35, -76.65);
    const drop = Math.atan2(5.35 - 1.3, 97.8 - 76.65); // the boards' slope as modelled
    splitByTriangles(doc, (tri) => tri.every((v) => new THREE.Vector3(...v).applyMatrix4(Minv).z < -76.4) ? 0 : -1, [{ name: 'ramp', pivot: hinge.toArray() }], root);
    const ramp = doc.getRoot().listNodes().find((n) => n.getName() === 'ramp');
    transformMesh(ramp.getMesh(), new THREE.Matrix4().makeRotationX(drop).elements); // level at rotation 0; lowered at -drop
    // rotors (whole meshes): fore = Object_6 + 9, aft = Object_7 + 8
    pivotGroup(doc, root, 'rotor_fore', (n) => n === 'Object_6' || n === 'Object_9');
    pivotGroup(doc, root, 'rotor_aft', (n) => n === 'Object_7' || n === 'Object_8');
    anchors(doc, {
      rampFoot: P(0.25, 1.0, -98), inside: P(0.25, 6, -40),
      lightPort: P(26, 12, 4), lightStbd: P(-25, 12, 4), lightTail: P(0.4, 72, -86), hold: P(0.25, 20, -70),
    });
    await grade(doc, { dark: 0.68, sat: 0.7 });
    await texWebp(doc, 2048);
    console.log('ch47 scale', s.toFixed(4), 'ramp drop', drop.toFixed(3), 'tris', triCount(doc));
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

  return { cars, ural, ch47, apache, heliwreck, container, bale, bomb, house, mcrate };
}
