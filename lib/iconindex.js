// The icons a buff can show with (skill icons and the icons of usable items), shrunk to 16 x 16 for the screen reader:
// it looks for them in the buff column at the right edge of the game window and names what it finds.
// File (data/icon-index.bin): "SOFI" u32 count, then per icon: u8 set (1 item, 2 skill, 3 skill icon), u32 id,
// 16 x 16 x RGB averaged from the 32 x 32 icon, 32 bytes of "opaque" bits.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { decode } = require('./dds');

const SETS = { ITEM: 1, MUGONG: 2, SKILL: 3 };

function shrink(img) {
  // 2 x 2 blocks averaged; a block counts as opaque when most of it is
  const rgb = Buffer.alloc(16 * 16 * 3), mask = Buffer.alloc(32);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const p = ((y * 2 + dy) * img.w + (x * 2 + dx)) * 4, al = img.rgba[p + 3];
      a += al; if (al >= 128) { r += img.rgba[p]; g += img.rgba[p + 1]; b += img.rgba[p + 2]; n++; }
    }
    const c = (y * 16 + x) * 3;
    if (n) { rgb[c] = Math.round(r / n); rgb[c + 1] = Math.round(g / n); rgb[c + 2] = Math.round(b / n); }
    if (a >= 2 * 255) mask[(y * 16 + x) >> 3] |= 1 << ((y * 16 + x) & 7);
  }
  return { rgb, mask };
}

// items: every item of the database (charms and event items show in the buff column too, not only potions)
function buildIconIndex(gameDir, { items = [], out }) {
  const t0 = Date.now(), parts = [], seen = new Map(), groups = {};
  const want = { ITEM: new Set(items.map((i) => String(i.id))), MUGONG: null, SKILL: null };
  let n = 0;
  for (const [dir, set] of Object.entries(SETS)) {
    const p = path.join(gameDir, 'datas', 'interface', dir);
    let files = [];
    try { files = fs.readdirSync(p); } catch { continue; }
    for (const f of files) {
      const m = /^(\d+)\.d2s$/i.exec(f);
      if (!m || (want[dir] && !want[dir].has(m[1]))) continue;
      try {
        const img = decode(fs.readFileSync(path.join(p, f)));
        if (img.w !== 32 || img.h !== 32) continue;
        const { rgb, mask } = shrink(img);
        // the game reuses one picture for several items / skill ranks: keep it once, remember the others
        const key = crypto.createHash('sha1').update(rgb).update(mask).digest('hex'), id = `${set}:${m[1]}`;
        if (seen.has(key)) { (groups[seen.get(key)] ||= [seen.get(key)]).push(id); continue; }
        seen.set(key, id);
        const head = Buffer.alloc(5); head[0] = set; head.writeUInt32LE(+m[1], 1);
        parts.push(head, rgb, mask); n++;
      } catch { /* not a texture we can read */ }
    }
  }
  const header = Buffer.alloc(8); header.write('SOFI', 0, 'latin1'); header.writeUInt32LE(n, 4);
  fs.writeFileSync(out, Buffer.concat([header, ...parts]));
  fs.writeFileSync(out.replace(/\.bin$/, '-groups.json'), JSON.stringify(groups));
  return { icons: n, shared: Object.keys(groups).length, ms: Date.now() - t0 };
}

// a readable name for a found icon "set:id": the item or skill, or what icons sharing the picture have in common
//   ("Charm of Minimap (30 days)" + "… (No Trade)" → "Charm of Minimap"; unrelated ones → "A or B")
function iconName(key, groups, { item = () => null, skill = () => null } = {}) {
  const ids = groups[key] || [key];
  const names = [...new Set(ids.map((k) => { const [set, id] = k.split(':'); return set === '1' ? item(+id) : skill(+id); }).filter(Boolean))];
  if (!names.length) return null;
  if (names.length === 1) return names[0];
  let p = names[0];
  for (const n of names) while (p && !n.startsWith(p)) p = p.slice(0, -1);
  p = p.replace(/[\s(\-:]+$/, '');
  return p.length >= 6 ? p : names.length === 2 ? `${names[0]} or ${names[1]}` : `${names[0]} (or ${names.length - 1} others)`;
}

module.exports = { buildIconIndex, iconName, shrink, SETS };
