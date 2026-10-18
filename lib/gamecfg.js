// The game client's own per-character and per-account files (in its Client folder), decoded:
//   <Character>~N.scs        the skill bar: 12-byte slots from offset 0x17, the skill / item id as a 32-bit number
//                            (a byte of 2 before it = skill, 5 = item or action such as Attack / Pick up)
//   <Character>.mhslot       the auto-combat setup: 24-byte slots from offset 0x0c with the skills it uses, then the
//                            HP / MP potions and the Charm of Return
//   ybopt2.cfg               the game settings (XML): windowed mode, shadows, effects, sight distance, chat …
//   ybopt2_<account>.cfg     per account: its characters (<N_Name>) and the Honor title they show
//   YBc.cfg                  the characters last chosen, per server
// Only read, never written.
'use strict';

const fs = require('fs');
const path = require('path');

const ACTION_IDS = new Set([8000003, 8000004, 8100019]); // Attack, Pick up, Take a rest (items in the game data)

const readSafe = (f) => { try { return fs.readFileSync(f); } catch { return null; } };
const nameOk = (n) => /^[A-Za-z0-9_]{2,16}$/.test(n);

// ids at fixed slot offsets; `known(id)` filters out what isn't a skill or item
function slotIds(buf, start, step, known) {
  const out = [];
  if (!buf) return out;
  for (let o = start, slot = 0; o + 4 <= buf.length; o += step, slot++) {
    const id = buf.readUInt32LE(o);
    if (id > 1000 && known(id)) out.push({ slot, id });
  }
  return out;
}

// per character (lowercased): the newest skill bar file and the auto-combat file
function readCharacterFiles(clientDir, known) {
  const out = new Map();
  let files = [];
  try { files = fs.readdirSync(clientDir); } catch { return out; }
  const get = (name) => { const k = name.toLowerCase(); if (!out.has(k)) out.set(k, { name, bar: null, auto: null }); return out.get(k); };
  for (const f of files) {
    let m;
    if ((m = /^(.+)~(\d+)\.scs$/i.exec(f)) && nameOk(m[1])) {
      const full = path.join(clientDir, f), t = fs.statSync(full).mtimeMs, c = get(m[1]);
      if (c.bar && c.bar.t >= t) continue;
      c.bar = { file: f, t, slots: slotIds(readSafe(full), 0x17, 12, known) };
    } else if ((m = /^(.+)\.mhslot$/i.exec(f)) && nameOk(m[1])) {
      const full = path.join(clientDir, f), c = get(m[1]);
      c.auto = { file: f, t: fs.statSync(full).mtimeMs, slots: slotIds(readSafe(full), 0x0c, 24, known) };
    }
  }
  return out;
}

// ybopt2.cfg: { Shadow: 1, Winmode: 1, … } (numbers where they are numbers)
function readOptions(clientDir) {
  const b = readSafe(path.join(clientDir, 'ybopt2.cfg'));
  if (!b) return null;
  const out = {};
  for (const m of b.toString('utf8').matchAll(/<([A-Za-z_]\w*)>\s*([^<]*?)\s*<\/\1>/g)) out[m[1]] = /^-?\d+$/.test(m[2]) ? +m[2] : m[2];
  return out;
}

// every account and character that logged in on this PC: { accounts: { account: [names] }, names: Set(lowercase) }
function readRoster(clientDir) {
  const accounts = {}, names = new Set();
  let files = [];
  try { files = fs.readdirSync(clientDir); } catch { return { accounts, names }; }
  for (const f of files) {
    const m = /^ybopt2_(.+)\.cfg$/i.exec(f);
    if (!m) continue;
    const text = String(readSafe(path.join(clientDir, f)) || '');
    const chars = [...text.matchAll(/<N_([A-Za-z0-9_]{2,16})>/g)].map((x) => x[1]);
    accounts[m[1].toLowerCase()] = chars;
    for (const c of chars) names.add(c.toLowerCase());
  }
  // YBc.cfg: names that start a record (after at least two zero bytes); bytes after a name's end are leftovers
  const y = readSafe(path.join(clientDir, 'YBc.cfg'));
  if (y) for (const m of y.toString('latin1').matchAll(/\0\0([A-Za-z0-9_]{2,16})\0/g)) names.add(m[1].toLowerCase());
  for (const f of files) { const m = /^(.+?)(?:~\d+\.scs|\.mhslot)$/i.exec(f); if (m && nameOk(m[1])) names.add(m[1].toLowerCase()); }
  return { accounts, names };
}

// a class name as the rankings / your notes write it → the game data's class number (lib/gamedb.js CLASSES)
const CLASS_IDS = { blade: 1, sword: 2, spear: 3, bow: 4, healer: 5, ninja: 11, busker: 12, hanbia: 13, hanbi: 13, damhwalyn: 14, hwalin: 14, fighter: 16, fist: 16, maeyujin: 17, noho: 18, migo: 19 };
const classIdOf = (name) => CLASS_IDS[String(name || '').toLowerCase().replace(/[^a-z]/g, '')] ?? null;

// a skill's family: the name without a trailing number or "(All)" (Weaken 1 / Weaken 2, Combat Discipline / … (All))
const family = (n) => String(n).replace(/\s*\((all|party)\)\s*$/i, '').replace(/\s+\d+\s*$/, '').replace(/\s+/g, ' ').trim().toLowerCase();

// what to improve on a character's bars: stronger versions of skills in use, and class skills not on any bar
// skills: the game's skill list [{ id, name, cls, level }]; level: the character's level; cls: its class number
// The class skill list holds both factions' versions: Holy / Divinity for The Order, Devilish / Fury for The Chaos
// (faction: 'The Order' / 'The Chaos', else guessed from the skills in use).
const ORDER_RE = /\b(holy|divinity|divine)\b/i, CHAOS_RE = /\b(devilish|fury)\b/i;
function factionOf(faction, used) {
  if (/order/i.test(faction || '')) return 'order';
  if (/chaos/i.test(faction || '')) return 'chaos';
  if (used.some((s) => CHAOS_RE.test(s.name))) return 'chaos';
  if (used.some((s) => ORDER_RE.test(s.name) && !/divine protection/i.test(s.name))) return 'order';
  return null;
}
function skillAdvice({ used, skills, cls, level, faction = null }) {
  if (!level || cls == null) return { upgrades: [], strongest: [], faction: null };
  const usedIds = new Set(used.map((s) => s.id));
  const side = factionOf(faction, used);
  const otherSide = (n) => (side === 'order' ? CHAOS_RE.test(n) : side === 'chaos' ? ORDER_RE.test(n) && !/divine protection/i.test(n) : false);
  const learnable = skills.filter((s) => s.cls === cls && s.level > 0 && s.level <= level && s.name && !otherSide(s.name));
  const upgrades = [];
  for (const s of used) {
    const better = learnable.filter((x) => family(x.name) === family(s.name) && x.level > s.level && !usedIds.has(x.id)).sort((a, b) => b.level - a.level)[0];
    if (better) upgrades.push({ from: { id: s.id, name: s.name, level: s.level }, to: { id: better.id, name: better.name, level: better.level } });
  }
  // the strongest skill of each family you can have at your level, highest first, marked when it is on a saved bar
  // (the game saves only some bar pages, so "not on a bar" may just mean another page)
  const best = new Map();
  for (const s of learnable) { const f = family(s.name); if (!best.has(f) || best.get(f).level < s.level) best.set(f, s); }
  const strongest = [...best.values()].sort((a, b) => b.level - a.level).slice(0, 10).map(({ id, name, level: lv }) => ({ id, name, level: lv, onBar: usedIds.has(id) }));
  return { upgrades, strongest, faction: side };
}

// the HP / MP potions a character uses (auto-combat first, then the skill bar), by the potion table's names
function potionsOf(items, potions) {
  const norm = (n) => String(n).replace(/\s*\((event|bound)\)\s*$/i, '').trim();
  const out = { hp: null, mp: null };
  for (const it of items) {
    const n = potions[it.name] ? it.name : potions[norm(it.name)] ? norm(it.name) : null;
    if (!n) continue;
    if (potions[n].hp && !out.hp) out.hp = n;
    if (potions[n].mp && !out.mp) out.mp = n;
  }
  return out;
}

// graphics settings that cost the most, highest first: { key, label, now, to }
const HEAVY = [
  { key: 'Shadow', label: 'Shadows', on: (v) => v === 1, to: 0 },
  { key: 'SightLevel', label: 'Sight distance', on: (v) => v >= 2, to: 1 },
  { key: 'LigthEffect', label: 'Light effects', on: (v) => v === 1, to: 0 },
  { key: 'Shader', label: 'Shaders', on: (v) => v === 1, to: 0 },
  { key: 'BackEffect', label: 'Background effects', on: (v) => v === 1, to: 0 },
  { key: 'Texture', label: 'Texture quality', on: (v) => v >= 1, to: 0 },
  { key: 'NPCEffect', label: 'NPC effects', on: (v) => v === 1, to: 0 },
  { key: 'MuhoonFX', label: 'Soul effects', on: (v) => v === 1, to: 0 },
];
const graphicsHeavy = (o) => (o ? HEAVY.filter((h) => o[h.key] != null && h.on(o[h.key])).map((h) => ({ key: h.key, label: h.label, now: o[h.key], to: h.to })) : []);

// settings that make the screen reader's job harder
function readerIssues(o) {
  if (!o) return [];
  const out = [];
  if (o.Winmode === 0) out.push({ key: 'Winmode', text: 'The game runs full screen: the screen reader needs a window or borderless window (game options → windowed).' });
  if (o.ChatBackgroundAlpha != null && o.ChatBackgroundAlpha < 60) out.push({ key: 'ChatBackgroundAlpha', text: `The chat background is see-through (${o.ChatBackgroundAlpha}): a darker chat background makes the chat easier to read.` });
  return out;
}

// what changed between two reads of ybopt2.cfg: [{ key, from, to }]
function optionChanges(a, b) {
  if (!a || !b) return [];
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !/^temp\d$/.test(k) && a[k] !== b[k]).map((k) => ({ key: k, from: a[k] ?? null, to: b[k] ?? null }));
}

module.exports = { classIdOf, readCharacterFiles, readOptions, readRoster, skillAdvice, potionsOf, graphicsHeavy, readerIssues, optionChanges, family, ACTION_IDS, slotIds };
