// The gear log: item tooltips the screen reader sees while you hover over your gear, turned into a record per
// character and slot (name, enhance level, combined options, element, awakening, special options), with a history of
// the enhance level. Tooltip lines come with their colour: white = basics, blue = combined options, red / magenta =
// element and special options, yellow = charm options. OCR misreads a little, so everything is matched loosely.
'use strict';

const { gearKind } = require('./inventory');
const ELEMENTS = ['Fire', 'Water', 'Wind', 'Poison', 'Inner', 'Outer'];
const hex = (c) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(c || '')); if (!m) return null; const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const isBlue = (c) => { const v = hex(c); return !!v && v[2] > 150 && v[2] - v[0] > 50 && v[2] - v[1] > 50; };
const isWhite = (c) => { const v = hex(c); return !!v && Math.min(...v) > 190; };
const clean = (s) => String(s || '').replace(/[•«»"']/g, '').replace(/\s+/g, ' ').trim();

// "Fatality of Limitations Suppress Dagger (Truei\7]" → { name: '… (True)', plus: 7 }
function parseTitle(t) {
  let s = clean(t);
  const m = /[[\\|(]\s*(\d{1,2})\s*\]?\s*$/.exec(s);
  const plus = m ? +m[1] : 0;
  if (m) s = s.slice(0, m.index);
  s = s.replace(/\(\s*tru\w*\s*\)?\s*$/i, '(True)').replace(/\s+/g, ' ').trim();
  return { name: s, plus };
}

// one combined-option line in plain words: "All abilities have been increased. 2 Increase" → "All abilities +2"
function optionText(line) {
  const s = clean(line), n = /(\d+(?:\.\d+)?)\s*%?\s*(?:increase|ignore)?\s*\.?$/i.exec(s);
  const v = n ? n[1] : null, pct = /%/.test(s);
  if (/abilit/i.test(s)) return v ? `All abilities +${v}` : 'All abilities';
  if (/attack/i.test(s) && !/skill/i.test(s)) return v ? `Attack +${v}${pct ? '%' : ''}` : 'Attack';
  if (/defen|def\b/i.test(s)) return v ? `Defense +${v}${pct ? '%' : ''}` : 'Defense';
  if (/hp|life|health/i.test(s)) return v ? `HP +${v}` : 'HP';
  if (/mp|inner power|ki\b/i.test(s)) return v ? `MP +${v}` : 'MP';
  if (/accura|hit/i.test(s)) return v ? `Accuracy +${v}` : 'Accuracy';
  if (/evas|dodge/i.test(s)) return v ? `Evasion +${v}` : 'Evasion';
  return s;
}

// lines / cols: the tooltip as read; matchItem(name) → { id, name, slot, level } | null
function parseTooltip(lines, cols = [], matchItem = () => null) {
  if (!lines?.length) return null;
  const { name: rawName, plus } = parseTitle(lines[0]);
  if (rawName.length < 4) return null;
  const item = matchItem(rawName);
  const out = { name: item?.name || rawName, itemId: item?.id ?? null, plus, slot: null, level: item?.level ?? null, cls: null, faction: null,
    attack: null, defense: null, options: [], element: null, souled: null, extras: [] };
  for (let i = 1; i < lines.length; i++) {
    const s = clean(lines[i]), c = cols[i];
    if (!s || s.length < 3) continue;
    let m;
    if ((m = /attack\s*[:;]\s*(\d+)\D+(\d+)/i.exec(s)) && !isBlue(c)) { out.attack = [+m[1], +m[2]]; continue; }
    if ((m = /defen\w*\s*[:;]\s*(\d+)/i.exec(s)) && !isBlue(c)) { out.defense = +m[1]; continue; }
    if ((m = /level\s*[:;]\s*(\d+)/i.exec(s)) && isWhite(c)) { out.level = +m[1]; continue; }
    if (/^level\s*[:;]?$/i.test(s)) continue;
    if ((m = /class\s*[:;]\s*(.+)$/i.exec(s))) { out.cls = m[1].trim(); continue; }
    if ((m = /(?:type|ty\w*)\s*[:;]\s*(order|chaos|all|common)/i.exec(s)) || (m = /^(order|chaos)$/i.exec(s))) { out.faction = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase(); continue; }
    if ((m = /equip\s*[:;]\s*(.+)$/i.exec(s))) { out.slot = m[1].trim(); continue; }
    if (/^equip\s*[:;]?$/i.test(s)) continue;
    if (/only good|can use this|cannot be|tradable|trade/i.test(s)) continue;
    if ((m = /soul\w*\s*stage\s*[:;]?\s*(\d+)/i.exec(s))) { out.souled = +m[1]; continue; }
    const el = ELEMENTS.find((e) => new RegExp(`\\b${e}\\b`, 'i').test(s));
    if (el && (m = /(\d+)\s*(?:\+\s*(\d+))?/.exec(s))) { out.element = { name: el, level: +m[1], bonus: m[2] ? +m[2] : 0 }; continue; }
    if (isBlue(c)) { out.options.push(optionText(s)); continue; }
    // misread noise ("; qncj't."): no number and no real word (5+ letters with a vowel) in it
    if (!/\d/.test(s) && !s.split(/[^a-z]+/i).some((w) => w.length >= 5 && /[aeiouy]/i.test(w))) continue;
    out.extras.push(s);
  }
  // the matched item is for another slot than the tooltip says ("Righteous Leader Bracer" for boots): match again
  // among items of that slot only
  const said = gearKind(out.slot), itemKind = item ? gearKind(item.slotName) || gearKind(item.name) : null;
  if (item && said && itemKind && said !== itemKind) {
    const again = matchItem(rawName, said);
    Object.assign(out, again ? { name: again.name, itemId: again.id, level: out.level ?? again.level } : { name: rawName, itemId: null });
  }
  if (!out.slot && item?.slotName && (out.itemId === item.id)) out.slot = item.slotName;
  // one name per kind of slot ("Shoes" in the game data, "Boots" on the tooltip)
  out.slot = gearKind(out.slot) || gearKind(out.name) || out.slot;
  return out;
}

// the game item a tooltip title is: the title can have a prefix ("Fatality of …") and the OCR can drop a word, so an
// item fits when its words appear in the title in order with at most one missing; the best fit covers most words.
// "(True)" has to agree.
function matchItemName(title, items) {
  const words = (s) => String(s).toLowerCase().replace(/\(true\)/g, ' ').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  const tw = words(title), isTrue = /\(true\)/i.test(title);
  let best = null;
  for (const it of items) {
    if (/\(true\)/i.test(it.name) !== isTrue) continue;
    const iw = words(it.name);
    if (iw.length < 2 || iw.length > tw.length + 1) continue;
    let k = 0, miss = 0;
    for (const w of iw) { const j = tw.indexOf(w, k); if (j < 0) miss++; else k = j + 1; if (miss > 1) break; }
    if (miss > 1 || iw.length - miss < 2) continue;
    const score = (iw.length - miss) * 10 - miss * 5 - (/^incomplete\b/i.test(it.name) && !/incomplete/i.test(title) ? 20 : 0);
    if (!best || score > best.score || (score === best.score && iw.length < best.len)) best = { it, score, len: iw.length };
  }
  return best ? best.it : null;
}

class GearLog {
  constructor({ read, save }) { this.data = read() || { items: {} }; this.save = () => save(this.data); this.last = null; }
  // a tooltip seen: kept per character and slot (or item when the slot isn't known); returns what changed
  seen(g, char, t = Date.now(), opts = {}) {
    if (!g) return null;
    const key = `${String(char || '?').toLowerCase()}|${(g.slot || g.name).toLowerCase()}`;
    const sig = `${key}|${g.name}|${g.plus}|${g.options.join(',')}`;
    if (this.last === sig) { const e = this.data.items[key]; if (e) e.lastSeen = t; return null; } // the same tooltip, still open
    this.last = sig;
    const old = this.data.items[key];
    // a different item for a slot you already have: probably not yours (a shop, a trade, a drop) — compared, not
    // stored, until you say you wear it now (equip())
    if (old && old.name !== g.name && !opts.replace) { this.other = { g, key, char: char || null, t }; return { changed: 'other', rec: old, other: g }; }
    const rec = { ...g, char: char || null, key, firstSeen: old && old.name === g.name ? old.firstSeen : t, lastSeen: t, history: old && old.name === g.name ? old.history.slice() : [] };
    // a better (or worse) enhance level than last time: kept in the history
    if (!old || old.name !== g.name) rec.history.push({ t, plus: g.plus });
    else if (old.plus !== g.plus) rec.history.push({ t, plus: g.plus });
    rec.history = rec.history.slice(-30);
    // a line the OCR missed this time is kept from the last reading of the same item
    if (old && old.name === g.name) for (const k of ['attack', 'defense', 'element', 'souled', 'level', 'cls', 'faction']) if (rec[k] == null && old[k] != null) rec[k] = old[k];
    this.data.items[key] = rec;
    this.save();
    return { rec, changed: !old ? 'new' : old.name !== g.name ? 'replaced' : old.plus !== g.plus ? 'plus' : null, before: old || null };
  }
  // you wear the item you last compared: it replaces the old one in its slot
  equip() { const o = this.other; if (!o) return null; this.other = null; this.last = null; return this.seen(o.g, o.char, Date.now(), { replace: true }); }
  list(char = null) { return Object.values(this.data.items).filter((r) => !char || String(r.char).toLowerCase() === String(char).toLowerCase()).sort((a, b) => b.lastSeen - a.lastSeen); }
  remove(key) { delete this.data.items[key]; this.save(); }
  // junk rows: no slot (a name plate read as a tooltip), no character, or an item name for another slot
  // (read wrongly; it's read again the next time you hover over it). Returns how many went.
  clean() {
    let n = 0;
    for (const [k, r] of Object.entries(this.data.items)) {
      const nameKind = gearKind(r.name);
      if (!r.slot || !r.char || r.char === '?' || (nameKind && gearKind(r.slot) && nameKind !== gearKind(r.slot))) { delete this.data.items[k]; n++; }
    }
    if (n) this.save();
    return n;
  }
}

module.exports = { parseTitle, parseTooltip, optionText, matchItemName, GearLog };
