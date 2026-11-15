// A minimal reader for old binary FBX (6.x, which three's FBXLoader refuses): the node tree,
// and each Mesh model's vertices, polygons and UVs in its own transform.
import fs from 'node:fs';
import zlib from 'node:zlib';

export function parseTree(buf) {
  let off = 27;
  const ver = buf.readUInt32LE(23);
  const big = ver >= 7500;
  function readNode() {
    const end = big ? Number(buf.readBigUInt64LE(off)) : buf.readUInt32LE(off);
    const nProps = big ? Number(buf.readBigUInt64LE(off + 8)) : buf.readUInt32LE(off + 4);
    off += big ? 24 : 12;
    const nameLen = buf[off]; off += 1;
    if (end === 0) return null;
    const name = buf.toString('latin1', off, off + nameLen); off += nameLen;
    const props = [];
    for (let i = 0; i < nProps; i++) props.push(readProp());
    const children = [];
    while (off < end) { const c = readNode(); if (!c) break; children.push(c); }
    off = end;
    return { name, props, children };
  }
  function readProp() {
    const t = String.fromCharCode(buf[off]); off += 1;
    switch (t) {
      case 'Y': { const v = buf.readInt16LE(off); off += 2; return v; }
      case 'C': { const v = buf[off]; off += 1; return !!v; }
      case 'I': { const v = buf.readInt32LE(off); off += 4; return v; }
      case 'F': { const v = buf.readFloatLE(off); off += 4; return v; }
      case 'D': { const v = buf.readDoubleLE(off); off += 8; return v; }
      case 'L': { const v = Number(buf.readBigInt64LE(off)); off += 8; return v; }
      case 'S': case 'R': { const n = buf.readUInt32LE(off); off += 4; const v = t === 'S' ? buf.toString('latin1', off, off + n) : buf.subarray(off, off + n); off += n; return v; }
      default: {
        const len = buf.readUInt32LE(off), enc = buf.readUInt32LE(off + 4), clen = buf.readUInt32LE(off + 8); off += 12;
        let data = buf.subarray(off, off + clen); off += clen;
        if (enc === 1) data = zlib.inflateSync(data);
        const out = [];
        const size = { f: 4, d: 8, l: 8, i: 4, b: 1 }[t];
        for (let i = 0; i < len; i++) {
          const p = i * size;
          out.push(t === 'f' ? data.readFloatLE(p) : t === 'd' ? data.readDoubleLE(p) : t === 'l' ? Number(data.readBigInt64LE(p)) : t === 'i' ? data.readInt32LE(p) : data[p]);
        }
        return out;
      }
    }
  }
  const nodes = [];
  while (off < buf.length - 160) { const n = readNode(); if (!n) break; nodes.push(n); }
  return { ver, nodes };
}

const child = (n, name) => n.children.find((c) => c.name === name);
// FBX 6 stores arrays as runs of scalar properties; 7.x as one packed array
const arr = (n) => !n ? null : n.props.length === 1 && Array.isArray(n.props[0]) ? n.props[0] : n.props;

/** Meshes of an FBX 6 file: [{ name, pos: [x,y,z...] (model transform applied), uv, faces: [[i,j,k, uvi,uvj,uvk, mat]...] }] */
export function readFbx6(file) {
  const { ver, nodes } = parseTree(fs.readFileSync(file));
  const objects = nodes.find((n) => n.name === 'Objects');
  const meshes = [];
  for (const m of objects.children) {
    if (m.name !== 'Model' || m.props[1] !== 'Mesh') continue;
    const V = arr(child(m, 'Vertices')), PI = arr(child(m, 'PolygonVertexIndex'));
    if (!V || !V.length || !PI) continue;
    // transform (Properties60: Lcl Translation / Rotation (deg, XYZ) / Scaling)
    const P = {};
    for (const p of child(m, 'Properties60')?.children || []) P[p.props[0]] = p.props.slice(-3);
    const t = P['Lcl Translation'] || [0, 0, 0], r = (P['Lcl Rotation'] || [0, 0, 0]).map((x) => x * Math.PI / 180), s = P['Lcl Scaling'] || [1, 1, 1];
    const [cx, cy, cz, sx, sy, sz] = [Math.cos(r[0]), Math.cos(r[1]), Math.cos(r[2]), Math.sin(r[0]), Math.sin(r[1]), Math.sin(r[2])];
    // R = Rz * Ry * Rx (FBX eEulerXYZ)
    const R = [
      [cy * cz, sx * sy * cz - cx * sz, cx * sy * cz + sx * sz],
      [cy * sz, sx * sy * sz + cx * cz, cx * sy * sz - sx * cz],
      [-sy, sx * cy, cx * cy],
    ];
    const pos = [];
    for (let i = 0; i < V.length; i += 3) {
      const x = V[i] * s[0], y = V[i + 1] * s[1], z = V[i + 2] * s[2];
      for (let k = 0; k < 3; k++) pos.push(R[k][0] * x + R[k][1] * y + R[k][2] * z + t[k]);
    }
    const L = child(m, 'LayerElementUV'), uvA = L && arr(child(L, 'UV')), uvI = L && arr(child(L, 'UVIndex'));
    const uvMap = L && child(L, 'MappingInformationType')?.props[0];
    const LM = child(m, 'LayerElementMaterial'), matA = LM && arr(child(LM, 'Materials'));
    const matMap = LM && child(LM, 'MappingInformationType')?.props[0];
    const faces = [];
    let poly = [], pv = 0, pIdx = 0;
    for (let k = 0; k < PI.length; k++) {
      let vi = PI[k]; const last = vi < 0; if (last) vi = ~vi;
      const uvIndex = !uvA ? -1 : uvMap === 'ByPolygonVertex' ? (uvI ? uvI[k] : k) : vi;
      poly.push([vi, uvIndex]);
      if (last) {
        const mat = matA ? (matMap === 'AllSame' ? matA[0] : matA[pIdx]) : 0;
        for (let j = 1; j < poly.length - 1; j++) faces.push([poly[0][0], poly[j][0], poly[j + 1][0], poly[0][1], poly[j][1], poly[j + 1][1], mat]);
        poly = []; pIdx++;
      }
    }
    meshes.push({ name: m.props[0].split('\0')[0].replace(/^Model::/, ''), pos, uv: uvA || [], faces });
  }
  return { ver, meshes };
}
