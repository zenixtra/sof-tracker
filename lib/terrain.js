// Zone terrain for the 3D view, from the client's map files in datas/NCSData/<zone>/.
// The height grid is 129 x 129 vertices of 48 bytes (x, height, z, normal, ARGB colour, …), 40 units apart,
// row 0 at z = +2560 (north), x from -2560 to +2560 (zone-local coordinates). It sits in test.TER, or inside the
// zone's .YOM after the ints 128, 128. Some zones use another (packed) layout: those get a flat map instead.
'use strict';

const fs = require('fs');
const path = require('path');

const zoneDir = (gameDir, zone) => path.join(gameDir, 'datas', 'NCSData', String(zone));
const listDir = (dir) => { try { return fs.readdirSync(dir); } catch { return []; } };
const STRIDE = 48;

// where the grid starts in a file (cached per file size + date)
const gridCache = new Map();
function locateGrid(file) {
  const st = fs.statSync(file), key = `${file}|${st.size}|${st.mtimeMs}`;
  if (gridCache.has(key)) return gridCache.get(key);
  const b = fs.readFileSync(file);
  let at = null;
  for (let o = 0; o + 24 < b.length; o += 4) {
    if (b.readInt32LE(o) === 128 && b.readInt32LE(o + 4) === 128 && b.readFloatLE(o + 8) === -2560 && b.readFloatLE(o + 16) === 2560) { at = o; break; }
  }
  gridCache.set(key, at);
  return at;
}

function gridFile(gameDir, zone) {
  const dir = zoneDir(gameDir, zone), files = listDir(dir);
  const ter = files.find((f) => /\.ter$/i.test(f));
  if (ter) return { file: path.join(dir, ter), at: 0 };
  for (const f of files.filter((x) => /\.yom$/i.test(x) && !/_(pov|reg|fog)/i.test(x))) {
    const at = locateGrid(path.join(dir, f));
    if (at != null) return { file: path.join(dir, f), at };
  }
  return null;
}

function readTerrain(gameDir, zone) {
  const g = gridFile(gameDir, zone);
  if (!g) return null;
  const fd = fs.openSync(g.file, 'r');
  try {
    const head = Buffer.alloc(8);
    fs.readSync(fd, head, 0, 8, g.at);
    const cells = head.readInt32LE(0), n = cells + 1;
    const b = Buffer.alloc(n * n * STRIDE);
    fs.readSync(fd, b, 0, b.length, g.at + 8);
    const heights = new Array(n * n), colors = new Array(n * n * 3);
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < n * n; i++) {
      const o = i * STRIDE, h = b.readFloatLE(o + 4);
      heights[i] = Math.round(h * 10) / 10;
      if (h < min) min = h; if (h > max) max = h;
      colors[i * 3] = b[o + 26]; colors[i * 3 + 1] = b[o + 25]; colors[i * 3 + 2] = b[o + 24]; // ARGB, little-endian
    }
    return { n, x0: b.readFloatLE(0), z0: b.readFloatLE(8), size: b.readFloatLE((n - 1) * STRIDE) - b.readFloatLE(0), min: Math.round(min), max: Math.round(max), heights, colors };
  } finally { fs.closeSync(fd); }
}

// the best picture of the zone: the 2048 px colour map, else the 512 px minimap
function zoneImage(gameDir, zone) {
  const dir = zoneDir(gameDir, zone), big = listDir(dir).find((f) => /^totalmap\.bmp$/i.test(f));
  if (big) return path.join(dir, big);
  const mini = path.join(gameDir, 'datas', 'interface', 'DATA', 'window_minimap', `${zone}.bmp`);
  return fs.existsSync(mini) ? mini : null;
}

// zones the 3D view can show: a height grid and/or a map image
function worldZones(gameDir) {
  return listDir(path.join(gameDir, 'datas', 'NCSData')).filter((z) => /^\d+$/.test(z) && z.length < 7)
    .map((z) => ({ zone: z, terrain: !!gridFile(gameDir, z), image: !!zoneImage(gameDir, z) }))
    .filter((z) => z.terrain || z.image);
}

module.exports = { readTerrain, zoneImage, worldZones };
