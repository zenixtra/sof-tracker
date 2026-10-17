// Draws the app icons (public/icons/*.png): a gold ring with a sword on the dark dashboard colour.
// usage: node installer/make-icons.js
'use strict';
const fs = require('fs');
const path = require('path');
const { png } = require('../lib/dds');

function draw(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const bg = [22, 24, 31], gold = [214, 168, 74], dim = [138, 106, 42];
  const c = size / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = x + 0.5 - c, dy = y + 0.5 - c, r = Math.hypot(dx, dy) / size;
    // the sword is drawn upright in (u, v) and turned 45° so it lies diagonally across the ring
    const a = Math.PI / 4, u = 0.5 + (dx * Math.cos(a) + dy * Math.sin(a)) / size, v = 0.5 + (-dx * Math.sin(a) + dy * Math.cos(a)) / size;
    let col = bg;
    if (r > 0.31 && r < 0.36) col = gold;                                           // ring
    else if (r <= 0.31 && r > 0.29) col = dim;
    if (Math.abs(u - 0.5) < 0.028 && v > 0.24 && v < 0.66) col = gold;              // blade
    if (Math.abs(u - 0.5) < 0.012 && v > 0.27 && v < 0.64) col = [240, 214, 150];   // edge light
    if (Math.abs(v - 0.66) < 0.022 && Math.abs(u - 0.5) < 0.13) col = gold;         // cross-guard
    if (Math.abs(u - 0.5) < 0.02 && v > 0.68 && v < 0.77) col = dim;                // grip
    if (Math.hypot(u - 0.5, v - 0.79) < 0.03) col = gold;                           // pommel
    const i = (y * size + x) * 4;
    rgba[i] = col[0]; rgba[i + 1] = col[1]; rgba[i + 2] = col[2]; rgba[i + 3] = 255;
  }
  return png(size, size, rgba);
}

const dir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(dir, { recursive: true });
for (const s of [180, 192, 512]) fs.writeFileSync(path.join(dir, `icon-${s}.png`), draw(s));
console.log('icons written to', dir);
