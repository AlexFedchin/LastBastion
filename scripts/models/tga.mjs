// Minimal TGA reader (uncompressed and RLE true-colour, 24/32 bpp) for sharp, which can't read TGA.
import fs from 'node:fs';

/** { data: RGBA Uint8Array (top row first), width, height } */
export function readTga(file) {
  const b = fs.readFileSync(file);
  const idLen = b[0], type = b[2], w = b.readUInt16LE(12), h = b.readUInt16LE(14), bpp = b[16], desc = b[17];
  if (type !== 2 && type !== 10) throw new Error(`${file}: TGA type ${type} not supported`);
  const px = bpp / 8, out = new Uint8Array(w * h * 4);
  let p = 18 + idLen + (b[1] ? b.readUInt16LE(5) * Math.ceil(b[7] / 8) : 0);
  const put = (i, o) => { out[o] = b[i + 2]; out[o + 1] = b[i + 1]; out[o + 2] = b[i]; out[o + 3] = px === 4 ? b[i + 3] : 255; };
  if (type === 2) for (let k = 0; k < w * h; k++, p += px) put(p, k * 4);
  else {
    let k = 0;
    while (k < w * h) {
      const c = b[p++], n = (c & 127) + 1;
      if (c & 128) { for (let j = 0; j < n; j++) put(p, (k++) * 4); p += px; } else for (let j = 0; j < n; j++, p += px) put(p, (k++) * 4);
    }
  }
  if (!(desc & 0x20)) { // bottom-left origin: flip to top row first
    const row = w * 4, tmp = new Uint8Array(row);
    for (let y = 0; y < h >> 1; y++) {
      const a = y * row, c = (h - 1 - y) * row;
      tmp.set(out.subarray(a, a + row)); out.copyWithin(a, c, c + row); out.set(tmp, c);
    }
  }
  return { data: out, width: w, height: h };
}
