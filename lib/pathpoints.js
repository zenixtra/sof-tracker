// Reads the client's auto-path waypoint files (datas/interface/MAP/PathPoint_<zone>.pth).
// They are text obfuscated byte-wise as (~b ^ 0x79); newlines are left as-is.
// Decoded: a header "@ <zone> <count> 0" then rows "# <x> <height> <z>" in world coordinates.
'use strict';

const fs = require('fs');
const path = require('path');

function decode(buf) {
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = buf[i] === 0x0a ? 0x0a : (~buf[i] & 0xff) ^ 0x79;
  return out.toString('latin1');
}

function readPathPoints(file) {
  const pts = [];
  for (const line of decode(fs.readFileSync(file)).split('\n')) {
    const m = /^#\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/.exec(line.trim());
    if (m) pts.push([+m[1], +m[3]]); // x, z (height dropped)
  }
  return pts;
}

// zone -> [[x, z], ...] for every PathPoint file in the client
function allPathPoints(gameDir) {
  const dir = path.join(gameDir, 'datas', 'interface', 'MAP');
  const out = {};
  try {
    for (const f of fs.readdirSync(dir)) {
      const m = /^PathPoint_(\d+)\.pth$/i.exec(f);
      if (m) out[m[1]] = readPathPoints(path.join(dir, f));
    }
  } catch { /* client layout differs: no waypoints */ }
  return out;
}

module.exports = { allPathPoints, readPathPoints };
