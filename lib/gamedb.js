// The game's own database, decoded from the client's data files:
//  - Ybi.cfg: items (852-byte records), NPCs & monsters (7864-byte records), zone names (104-byte records)
//  - ybnpcinfo.cfg: where every NPC stands; ybmapinfo.cfg: the portals between maps
// The keys are in lib/gamekeys.js. Results are cached in data/gamedb.json until the files change.
'use strict';

const fs = require('fs');
const path = require('path');
const { ITEM_BITS, TABLE_KEY } = require('./gamekeys');
const { readQuests } = require('./quests');

const DB_VERSION = 6; // 5: cooldowns and the official guide's links; 6: those links fixed
const euckr = new TextDecoder('euc-kr');

// ---- Ybi.cfg: undo the bit shuffle of every 32-bit word (lookup tables per byte position, so 44 MB takes ~0.3 s)
function unshuffle(raw) {
  const T = [0, 1, 2, 3].map((j) => {
    const t = new Uint32Array(256);
    for (let v = 0; v < 256; v++) { let y = 0; for (let i = 0; i < 8; i++) if ((v >> i) & 1) y |= 1 << ITEM_BITS[j * 8 + i]; t[v] = y >>> 0; }
    return t;
  });
  const n = raw.length - (raw.length % 4), out = Buffer.alloc(n);
  for (let p = 0; p < n; p += 4) out.writeUInt32LE((T[0][raw[p]] | T[1][raw[p + 1]] | T[2][raw[p + 2]] | T[3][raw[p + 3]]) >>> 0, p);
  return out;
}

const cstr = (b, o, max) => { let n = 0; while (n < max && o + n < b.length && b[o + n]) n++; return euckr.decode(b.subarray(o, o + n)).trim(); };
const printable = (s) => s.length >= 2 && !/[\x00-\x1f�]/.test(s);

const CLASSES = { 0: 'All', 1: 'Blade', 2: 'Sword', 3: 'Spear', 4: 'Bow', 5: 'Healer', 11: 'Ninja', 12: 'Busker', 13: 'Hanbi', 14: 'HwaLin', 16: 'Fist', 17: 'Maeyujin', 18: 'Noho', 19: 'Migo' };
const SLOTS = { 0: 'Other', 1: 'Robe', 2: 'Bracer', 3: 'Weapon', 4: 'Shoes', 5: 'Armor', 6: 'Necklace', 7: 'Earring', 8: 'Ring', 9: 'Costume', 10: 'Gem', 11: 'Charm', 23: 'Mount gear', 30: 'Soul pet' };
const ITEM_TYPES = new Set([0, 1, 2, 257, 258, 513, 514]);

function readItems(b) {
  const R = 852, items = [], seen = new Set();
  for (let o = 8 + R; o + R <= b.length; o += R) {
    const id = b.readUInt32LE(o);
    if (!id || id >= 2e9 || seen.has(id) || !ITEM_TYPES.has(b.readUInt16LE(o + 72))) continue;
    const level = b.readUInt16LE(o + 76), slot = b.readUInt16LE(o + 80);
    if (level > 400 || slot > 60) continue;
    const name = cstr(b, o + 8, 64);
    // leftovers of other sections look like items too: real names start with a capital, digit or bracket,
    // and real stats stay far below the random numbers those leftovers carry
    if (!printable(name) || !/^[A-Z0-9[(\u0080-￿]/.test(name)) continue;
    if (b.readUInt16LE(o + 88) > 20000 || b.readUInt16LE(o + 84) > 40000) continue;
    seen.add(id);
    const g = b[o + 79]; // costumes: 1 = male, 2 = female
    items.push({
      id, name, level, slot, cls: b.readUInt16LE(o + 74), gender: g === 1 ? 'M' : g === 2 ? 'F' : null,
      atkMax: b.readUInt16LE(o + 84), atkMin: b.readUInt16LE(o + 86), def: b.readUInt16LE(o + 88),
      price: b.readUInt32LE(o + 100), sell: b.readUInt32LE(o + 108),
      desc: cstr(b, o + 152, 280).replace(/\^/g, '\n'),
    });
  }
  return items;
}

// A section of fixed-size records "u32 id + name": find a run of well-formed records, then widen it
// record by record while the ids still look like ids (some names are Korean or empty).
function findSection(b, stride, from, strictOk, looseOk) {
  for (let o = from; o + stride * 6 < b.length; o += 4) {
    let ok = true;
    for (let k = 0; k < 6 && ok; k++) ok = strictOk(o + k * stride);
    if (!ok) continue;
    let first = o, last = o + 5 * stride;
    while (first - stride >= 0 && looseOk(first - stride)) first -= stride;
    while (last + 2 * stride <= b.length && looseOk(last + stride)) last += stride;
    return { first, last };
  }
  return null;
}
const nameOk = (b) => (o) => { const id = b.readUInt32LE(o); if (id < 1 || id > 2e6) return false; const c = b[o + 4]; if (c < 65 || c > 90) return false; let n = 0; while (n < 64 && b[o + 4 + n] >= 32 && b[o + 4 + n] < 127) n++; return n >= 3 && b[o + 4 + n] === 0; };
const idOk = (b, max) => (o) => { const id = b.readUInt32LE(o); return id >= 1 && id <= max; };

function readCharacters(b, itemsEnd) {
  const S = 7864, sec = findSection(b, S, itemsEnd, nameOk(b), idOk(b, 1e6));
  const npcs = [], monsters = [];
  if (!sec) return { npcs, monsters };
  for (let o = sec.first; o <= sec.last; o += S) {
    const id = b.readUInt32LE(o), name = cstr(b, o + 4, 64);
    if (!printable(name)) continue;
    const level = b.readUInt16LE(o + 70);
    if (level > 0 && level < 400) monsters.push({ id, name, level, hp: b.readUInt32LE(o + 72) });
    else npcs.push({ id, name });
  }
  return { npcs, monsters };
}

// Skills: 412-byte records (id, name, …, class @70, level @72, learning cost @76, description @104),
// in several runs through the file. A record counts when its neighbour 412 bytes away looks like one too.
function readSkills(b) {
  const S = 412, found = new Map();
  const looks = (r) => {
    if (r < 0 || r + S > b.length) return false;
    const id = b.readUInt32LE(r); if (id < 1000 || id > 1e8) return false;
    const c = b[r + 4]; if (c < 65 || c > 90) return false;
    if (b.readUInt16LE(r + 70) > 40 || b.readUInt16LE(r + 72) > 300) return false;
    const name = cstr(b, r + 4, 64); return name.length >= 3 && printable(name);
  };
  for (let r = 0; r + S <= b.length; r += 4) {
    const c = b[r + 4];
    if (c < 65 || c > 90 || !looks(r) || !(looks(r - S) || looks(r + S))) continue;
    const id = b.readUInt32LE(r);
    if (found.has(id)) continue;
    const name = cstr(b, r + 4, 64);
    if (/^Skill Combo$/i.test(name)) continue;
    found.set(id, { id, name, cls: b.readUInt16LE(r + 70), level: b.readUInt16LE(r + 72), cost: b.readUInt32LE(r + 76), desc: cstr(b, r + 104, 300).replace(/\^/g, '\n') });
  }
  return [...found.values()];
}

function readZones(b, from) {
  const S = 104, sec = findSection(b, S, from, nameOk(b), idOk(b, 99999));
  const zones = {};
  if (!sec) return zones;
  for (let o = sec.first; o <= sec.last; o += S) {
    const id = b.readUInt32LE(o), name = cstr(b, o + 4, 64);
    if (printable(name) && !zones[id]) zones[id] = name;
  }
  return zones;
}

// ---- XOR tables: header u32 version, f32 1.0, u32 rows, u32 columns; then every cell as <length byte><text>
function readTable(file) {
  const b = Buffer.from(fs.readFileSync(file));
  for (let i = 0; i < b.length; i++) b[i] ^= TABLE_KEY[i % TABLE_KEY.length];
  const rows = b.readUInt32LE(8), cols = b.readUInt32LE(12);
  // a file in another format (or changed by a patch) would read as millions of columns: refuse instead of running out of memory
  if (cols < 1 || cols > 400 || rows > 2000000) throw new Error(`not a table (${rows} rows x ${cols} columns)`);
  let o = 16;
  const cell = () => { const n = b[o++]; const s = euckr.decode(b.subarray(o, o + n)); o += n; return s; };
  const names = Array.from({ length: cols }, cell);
  const out = [];
  for (let r = 0; r < rows && o < b.length; r++) {
    const row = {};
    for (const c of names) row[c] = cell();
    out.push(row);
  }
  return out;
}

function sources(clientDir) {
  return ['Ybi.cfg', 'Ybq.cfg', 'ybnpcinfo.cfg', 'ybmapinfo.cfg', 'CoolTime.cfg', 'GuideLinkList.cfg'].map((f) => { try { const st = fs.statSync(path.join(clientDir, f)); return `${f}:${st.size}:${Math.floor(st.mtimeMs)}`; } catch { return `${f}:-`; } }).join('|');
}

function build(clientDir) {
  const t0 = Date.now();
  const b = unshuffle(fs.readFileSync(path.join(clientDir, 'Ybi.cfg')));
  const items = readItems(b);
  // the item section is followed by skills etc.; NPCs/monsters and zones come later in the file
  const { npcs, monsters } = readCharacters(b, 8 + 852 * 1000);
  const zones = readZones(b, Math.floor(b.length * 0.9) & ~3);
  // some NPCs (guards, event characters…) have a level, so they sit in the monster list: name them from both
  const npcName = new Map([...monsters, ...npcs].map((n) => [n.id, n.name]));
  let npcSpots = [], portals = [];
  try {
    npcSpots = readTable(path.join(clientDir, 'ybnpcinfo.cfg')).map((r) => ({ zone: +r.zoneid, npc: +r.npcid, x: +r.x, z: +r.z, name: npcName.get(+r.npcid) || null }))
      .filter((r) => Number.isFinite(r.x) && Number.isFinite(r.z));
  } catch (e) { console.log(`[gamedb] NPC positions unavailable: ${e.message}`); }
  try {
    portals = readTable(path.join(clientDir, 'ybmapinfo.cfg')).map((r) => ({ zone: +r.mapid, to: +r.nearmap, how: +r.how, x: +r.warp1, z: +r.warp2, npc: +r.npcid || null }))
      .filter((r) => Number.isFinite(r.x) && Number.isFinite(r.z));
  } catch (e) { console.log(`[gamedb] portals unavailable: ${e.message}`); }
  const skills = readSkills(b);
  let quests = [];
  try { quests = readQuests(clientDir); } catch (e) { console.log(`[gamedb] quests unavailable: ${e.message}`); }
  // cooldowns of skills (type 0) and usable items (type 3): [id, cooldown ms, casting ms]
  let cooldowns = [];
  try { cooldowns = readTable(path.join(clientDir, 'CoolTime.cfg')).map((r) => [+r.objectid, +r.selfcooltime, +r.castingtime]).filter((c) => c[0] > 0 && Number.isFinite(c[1])); }
  catch (e) { console.log(`[gamedb] cooldowns unavailable: ${e.message}`); }
  // the official (Korean) guide's pages the game links to, one per page: { view, names (Korean), link }
  let guideLinks = [];
  try {
    const seen = new Map();
    for (const r of readTable(path.join(clientDir, 'GuideLinkList.cfg'))) {
      const m = /view=(\d+)/.exec(r.link || '');
      if (!m || !/^https?:\/\/yulgang\.mgame\.com\/guide\/game_guide\//.test(r.link)) continue; // (the game's own guide pages only)
      const e = seen.get(m[1]) || { view: +m[1], names: [], link: r.link };
      if (!e.names.includes(r.name)) e.names.push(r.name);
      seen.set(m[1], e);
    }
    guideLinks = [...seen.values()];
  } catch (e) { console.log(`[gamedb] guide links unavailable: ${e.message}`); }
  console.log(`[gamedb] decoded ${items.length} items, ${monsters.length} monsters, ${npcs.length} NPCs, ${skills.length} skills, ${quests.length} quests, ${Object.keys(zones).length} zones, ${npcSpots.length} NPC spots, ${portals.length} portals in ${Date.now() - t0} ms`);
  return { items, monsters, npcs, skills, quests, zones, npcSpots, portals, cooldowns, guideLinks };
}

// What a patch changed in the database: new / removed / changed items, monsters, skills, quests, zones.
function diffDb(a, b) {
  const MAX = 300;
  const cmp = (oldList, newList, fields) => {
    const om = new Map(oldList.map((x) => [x.id, x])), nm = new Map(newList.map((x) => [x.id, x]));
    const added = newList.filter((x) => !om.has(x.id)), removed = oldList.filter((x) => !nm.has(x.id));
    const changed = [];
    for (const x of newList) {
      const o = om.get(x.id); if (!o) continue;
      const diffs = fields.filter((f) => JSON.stringify(o[f]) !== JSON.stringify(x[f])).map((f) => ({ field: f, from: o[f], to: x[f] }));
      if (diffs.length) changed.push({ id: x.id, name: x.name, diffs });
    }
    const brief = (x) => ({ id: x.id, name: x.name, level: x.level });
    return { added: added.slice(0, MAX).map(brief), removed: removed.slice(0, MAX).map(brief), changed: changed.slice(0, MAX), counts: { added: added.length, removed: removed.length, changed: changed.length } };
  };
  const zonesOld = Object.entries(a.zones || {}).map(([id, name]) => ({ id: +id, name })), zonesNew = Object.entries(b.zones || {}).map(([id, name]) => ({ id: +id, name }));
  return {
    items: cmp(a.items || [], b.items || [], ['name', 'level', 'cls', 'slot', 'atkMin', 'atkMax', 'def', 'price', 'sell']),
    monsters: cmp(a.monsters || [], b.monsters || [], ['name', 'level', 'hp']),
    skills: cmp(a.skills || [], b.skills || [], ['name', 'cls', 'level', 'cost']),
    quests: cmp(a.quests || [], b.quests || [], ['name', 'level']),
    zones: cmp(zonesOld, zonesNew, ['name']),
  };
}
const diffEmpty = (d) => Object.values(d).every((x) => !x.counts.added && !x.counts.removed && !x.counts.changed);

// cached: decoding again only when the game files change (e.g. after a patch).
// onChange(diff) is called when a rebuild after a game update changed the database.
function loadGameDb(clientDir, cacheFile, onChange) {
  const src = sources(clientDir);
  let old = null;
  try {
    const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (c.v === DB_VERSION && c.src === src) return c.db;
    if (c.v === DB_VERSION) old = c.db; // same decoder, new game files: compare afterwards
  } catch { /* no cache yet */ }
  const db = build(clientDir);
  try { fs.writeFileSync(`${cacheFile}.tmp`, JSON.stringify({ v: DB_VERSION, src, db })); fs.renameSync(`${cacheFile}.tmp`, cacheFile); } catch { /* read-only: fine */ }
  if (old && onChange) { const d = diffDb(old, db); if (!diffEmpty(d)) onChange(d); }
  return db;
}

module.exports = { loadGameDb, readTable, unshuffle, diffDb, CLASSES, SLOTS };
