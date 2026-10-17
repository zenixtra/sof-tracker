// The client's .d2s textures are plain DDS files (DXT1/3/5 or 32-bit). Decode one to RGBA and write it as PNG,
// so item icons can be shown in the browser. No dependencies: zlib does the PNG compression.
'use strict';

const zlib = require('zlib');

function rgb565(c) {
  const r = (c >> 11) & 31, g = (c >> 5) & 63, b = c & 31;
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)];
}

// colour part of a DXT block (8 bytes at o) into a 4x4 RGBA block
function colorBlock(buf, o, out, dxt1) {
  const c0 = buf.readUInt16LE(o), c1 = buf.readUInt16LE(o + 2);
  const a = rgb565(c0), b = rgb565(c1);
  const pal = [[...a, 255], [...b, 255]];
  if (c0 > c1 || !dxt1) {
    pal.push([0, 1, 2].map((i) => Math.round((2 * a[i] + b[i]) / 3)).concat(255));
    pal.push([0, 1, 2].map((i) => Math.round((a[i] + 2 * b[i]) / 3)).concat(255));
  } else {
    pal.push([0, 1, 2].map((i) => Math.round((a[i] + b[i]) / 2)).concat(255));
    pal.push([0, 0, 0, 0]);
  }
  const bits = buf.readUInt32LE(o + 4);
  for (let i = 0; i < 16; i++) out.set(pal[(bits >>> (2 * i)) & 3], i * 4);
}

function decode(buf) {
  if (buf.toString('latin1', 0, 4) !== 'DDS ') throw new Error('not a DDS texture');
  const h = buf.readUInt32LE(12), w = buf.readUInt32LE(16);
  const pfFlags = buf.readUInt32LE(80), fourCC = buf.toString('latin1', 84, 88);
  const rgba = Buffer.alloc(w * h * 4);
  let o = 128;
  if (pfFlags & 4) {
    if (!/^DXT[135]$/.test(fourCC)) throw new Error(`unsupported texture format ${fourCC}`);
    const blk = new Uint8Array(64), size = fourCC === 'DXT1' ? 8 : 16;
    for (let by = 0; by < h; by += 4) for (let bx = 0; bx < w; bx += 4, o += size) {
      if (o + size > buf.length) break;
      colorBlock(buf, fourCC === 'DXT1' ? o : o + 8, blk, fourCC === 'DXT1');
      if (fourCC === 'DXT3') {
        for (let i = 0; i < 16; i++) { const v = (buf[o + (i >> 1)] >> ((i & 1) * 4)) & 15; blk[i * 4 + 3] = v * 17; }
      } else if (fourCC === 'DXT5') {
        const a0 = buf[o], a1 = buf[o + 1];
        const pal = [a0, a1];
        if (a0 > a1) for (let i = 1; i < 7; i++) pal.push(Math.round(((7 - i) * a0 + i * a1) / 7));
        else { for (let i = 1; i < 5; i++) pal.push(Math.round(((5 - i) * a0 + i * a1) / 5)); pal.push(0, 255); }
        let bits = 0n; for (let i = 0; i < 6; i++) bits |= BigInt(buf[o + 2 + i]) << BigInt(8 * i);
        for (let i = 0; i < 16; i++) blk[i * 4 + 3] = pal[Number((bits >> BigInt(3 * i)) & 7n)];
      }
      for (let y = 0; y < 4 && by + y < h; y++) for (let x = 0; x < 4 && bx + x < w; x++) {
        const s = (y * 4 + x) * 4, d = ((by + y) * w + bx + x) * 4;
        rgba[d] = blk[s]; rgba[d + 1] = blk[s + 1]; rgba[d + 2] = blk[s + 2]; rgba[d + 3] = blk[s + 3];
      }
    }
  } else {
    // uncompressed 32-bit (A8R8G8B8 with masks ff0000 / ff00 / ff)
    const bits = buf.readUInt32LE(88);
    if (bits !== 32) throw new Error(`unsupported ${bits}-bit texture`);
    const hasAlpha = pfFlags & 1;
    for (let i = 0; i < w * h && o + 4 <= buf.length; i++, o += 4) {
      rgba[i * 4] = buf[o + 2]; rgba[i * 4 + 1] = buf[o + 1]; rgba[i * 4 + 2] = buf[o]; rgba[i * 4 + 3] = hasAlpha ? buf[o + 3] : 255;
    }
  }
  return { w, h, rgba };
}

function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const ddsToPng = (buf) => { const { w, h, rgba } = decode(buf); return png(w, h, rgba); };

module.exports = { decode, png, ddsToPng };
