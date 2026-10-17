// Monsters, quests, NPCs and items from the game's own help file (Scions_of_Fate_guide.chm).
// The .chm is unpacked once with Windows' hh.exe; the parsed data and pictures are cached in data/guide.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const store = require('./store');

const GUIDE_DIR = path.join(store.DIR, 'guide');
const IMG_DIR = path.join(GUIDE_DIR, 'img');
const CACHE = path.join(GUIDE_DIR, 'guide.json');
const CACHE_VERSION = 2;

const strip = (s) => String(s).replace(/<br\s*\/?>/gi, ', ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim();

// copy a picture referenced by a guide page into data/guide/img and return its file name
function keepImage(pageFile, src) {
  const from = path.resolve(path.dirname(pageFile), src);
  if (!fs.existsSync(from)) return null;
  const name = path.relative(path.join(path.dirname(pageFile), '..', 'images'), from).replace(/[\\/]/g, '_').replace(/[^\w.-]/g, '_');
  const to = path.join(IMG_DIR, name);
  if (!fs.existsSync(to)) fs.copyFileSync(from, to);
  return name;
}

// ---- monsters: <f4>Name</f4> ... Area_ <k2>Area</k2> ... <k2>Level</k2> ... Type_ <k2>Type</k2> ... <img> ... <f1>Description</f1>
const MONSTER = /<font class="f4">([\s\S]*?)<\/font>[\s\S]*?Area_\s*<\/font>\s*<font class="k2">([\s\S]*?)<\/font>[\s\S]*?<font class="k2">\s*(\d+)\s*<\/font>[\s\S]*?Type_\s*<\/font>\s*<font class="k2">([\s\S]*?)<\/font>[\s\S]*?<img src="([^"]+)"[\s\S]*?<font class="f1">([\s\S]*?)<\/font>/g;

// ---- NPCs: <img src=".../npc/x.jpg"> ... <f8>Name</f8> ... <f1>Description</f1>
const NPC = /<img src="([^"]*\/npc\/[^"]+)"[^>]*>[\s\S]*?<font class="f8">([\s\S]*?)<\/font>[\s\S]*?<font class="f1">([\s\S]*?)<\/font>/g;

// ---- data tables (quests, items): <table ... bgcolor="#92bfd8"> with a header row of f8 cells
function tables(html) {
  const out = [];
  for (const t of html.matchAll(/<table[^>]*bgcolor="#92bfd8"[^>]*>([\s\S]*?)<\/table>/gi)) {
    let headers = null;
    const rows = [];
    for (const r of t[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]);
      if (!cells.length) continue;
      if (!headers && /class="f8"/.test(r[1])) { headers = cells.map(strip); continue; }
      if (headers) rows.push({ cells: cells.map(strip), img: (/<img src="([^"]+)"/.exec(r[1]) || [])[1] || null });
    }
    if (headers && rows.length) out.push({ headers, rows });
  }
  return out;
}

const ITEM_GROUP = { weapon: 'Weapon', armor: 'Armor', dress: 'Robe', etc: 'Other' };

function parse(root) {
  const dec = new TextDecoder('euc-kr');
  const monsters = new Map(), npcs = new Map(), quests = new Map(), items = new Map();
  const areas = new Set();
  const pages = [];
  (function walk(dir) {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, f.name);
      if (f.isDirectory()) walk(full);
      else if (/\.html?$/i.test(f.name)) pages.push(full);
    }
  })(root);

  for (const file of pages) {
    const html = dec.decode(fs.readFileSync(file));
    const section = path.basename(path.dirname(file));
    if (section === 'monster' || section === 'map') {
      for (const m of html.matchAll(MONSTER)) {
        const name = strip(m[1]), area = strip(m[2]), level = +m[3];
        if (!name || !level) continue;
        areas.add(area);
        const key = `${name.toLowerCase()}|${area.toLowerCase()}`;
        if (!monsters.has(key)) monsters.set(key, { name, area, level, type: strip(m[4]), img: keepImage(file, m[5]), desc: strip(m[6]) });
      }
    }
    if (section === 'npc') {
      for (const m of html.matchAll(NPC)) {
        const name = strip(m[2]);
        if (!name || name.length > 40 || npcs.has(name.toLowerCase())) continue;
        npcs.set(name.toLowerCase(), { name, desc: strip(m[3]), img: keepImage(file, m[1]), page: path.basename(file, '.htm') });
      }
    }
    if (section === 'quest') {
      for (const t of tables(html)) {
        const h = t.headers.map((x) => x.toLowerCase());
        const col = (re) => h.findIndex((x) => re.test(x));
        const iName = col(/quest/), iLv = col(/level/), iFac = col(/faction/), iNpc = col(/npc/), iItems = col(/item/);
        if (iName < 0) continue;
        for (const r of t.rows) {
          const name = r.cells[iName];
          if (!name) continue;
          const q = { name, level: parseInt(r.cells[iLv], 10) || null, faction: iFac >= 0 ? r.cells[iFac] : null, npc: iNpc >= 0 ? r.cells[iNpc] : null, items: iItems >= 0 ? r.cells[iItems] : null };
          quests.set(`${name.toLowerCase()}|${q.faction}|${q.level}`, q);
        }
      }
    }
    if (section === 'item') {
      const group = ITEM_GROUP[(/item_([a-z]+)_/.exec(path.basename(file)) || [])[1]] || 'Item';
      const gender = /_man\./.test(file) ? 'Male' : /_woman\./.test(file) ? 'Female' : null;
      for (const t of tables(html)) {
        const nameCol = t.headers.findIndex((x) => /^items?$|name/i.test(x));
        for (const r of t.rows) {
          const fields = {};
          t.headers.forEach((hd, i) => { if (!/^icon$/i.test(hd) && r.cells[i]) fields[hd] = r.cells[i]; });
          const name = nameCol >= 0 ? r.cells[nameCol] : Object.values(fields)[0];
          if (!name) continue;
          const key = `${group}|${gender}|${name.toLowerCase()}`;
          if (!items.has(key)) items.set(key, { name, group, gender, fields, img: r.img ? keepImage(file, r.img) : null });
        }
      }
    }
  }

  // NPC areas: the guide only says where they are in their description
  const areaList = [...areas].sort((a, b) => b.length - a.length);
  for (const n of npcs.values()) n.area = areaList.find((a) => n.desc.toLowerCase().includes(a.toLowerCase())) || null;

  const byLevel = (a, b) => (a.level || 0) - (b.level || 0) || a.name.localeCompare(b.name);
  return {
    monsters: [...monsters.values()].sort(byLevel),
    quests: [...quests.values()].sort(byLevel),
    npcs: [...npcs.values()].sort((a, b) => a.name.localeCompare(b.name)),
    items: [...items.values()],
  };
}

function decompile(chm) {
  return new Promise((resolve, reject) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sof-guide-'));
    const copy = path.join(tmp, 'guide.chm'); // hh.exe is picky about the source path, so work on a copy
    fs.copyFileSync(chm, copy);
    const out = path.join(tmp, 'out');
    execFile(path.join(process.env.WINDIR || 'C:\\Windows', 'hh.exe'), ['-decompile', out, copy], { windowsHide: true }, () => {
      // hh.exe returns before it is always done writing; give it a moment
      setTimeout(() => (fs.existsSync(out) ? resolve({ out, tmp }) : reject(new Error('hh.exe could not unpack the guide'))), 1500);
    });
  });
}

async function loadGuide(gameDir) {
  const chm = path.join(gameDir, 'Scions_of_Fate_guide.chm');
  const empty = { monsters: [], quests: [], npcs: [], items: [] };
  try {
    const cached = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
    if (cached.version === CACHE_VERSION && (!fs.existsSync(chm) || cached.chmMtime === fs.statSync(chm).mtimeMs)) return cached.guide;
  } catch { /* build it */ }
  if (!fs.existsSync(chm)) return empty;
  fs.mkdirSync(IMG_DIR, { recursive: true });
  const { out, tmp } = await decompile(chm);
  try {
    const guide = parse(out);
    fs.writeFileSync(CACHE, JSON.stringify({ version: CACHE_VERSION, chmMtime: fs.statSync(chm).mtimeMs, guide }));
    try { fs.unlinkSync(path.join(GUIDE_DIR, 'monsters.json')); } catch { /* old cache format */ }
    console.log(`[tracker] guide built: ${guide.monsters.length} monsters, ${guide.quests.length} quests, ${guide.npcs.length} NPCs, ${guide.items.length} items`);
    return guide;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

module.exports = { loadGuide, IMG_DIR };
