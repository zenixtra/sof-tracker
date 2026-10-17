// The Status window (C): the Basic page's stats ("Attack 2525", "Int 396 Str 433 …") and the Skill page's three tabs
// (Ascension / Combat / Support) with the skills in them (matched by icon) and, on Ascension, their levels.
// Kept per character, with a history of the stats when they change.
'use strict';

const num = (s) => { const n = +String(s).replace(/[^\d]/g, ''); return Number.isFinite(n) ? n : null; };
// "Attack 2525  Skill Acc 16": one pattern per stat; the OCR may glue two columns into one line, or space out
// letters ("C h i", "P e t", "K i")
const STATS = [
  ['attack', /\bAtt?ack\s*[:;]?\s*(\d{1,6})/i], ['defense', /\bDefen[sc]e\s*[:;]?\s*(\d{1,6})/i], ['accuracy', /\bAccura\w*\s*[:;]?\s*(\d{1,6})/i],
  ['evasion', /(?<!Skill\s)\bEvasion\s*[:;]?\s*(\d{1,6})/i], ['skillEvasion', /\bSkill\s*Evasion\s*[:;]?\s*(\d{1,6})/i],
  ['skillAcc', /\bSkill\s*Acc\b\.?\s*[:;]?\s*(\d{1,6})/i], ['skillDef', /\bSkill\s*Def\b\.?\s*[:;]?\s*(\d{1,6})/i],
  ['pvp', /\bP\s*V\s*P\s*[:;]?\s*(\d{1,6})/i], ['monAtk', /\bMon\s*\.?\s*Atk\s*[:;]?\s*(\d{1,6})/i], ['monDef', /\bMon\s*\.?\s*Def\s*[:;]?\s*(\d{1,6})/i],
  ['pureDef', /\bPure\s*Def\s*[:;]?\s*(\d{1,6})/i], ['int', /\bInt\s*[:;]?\s*(\d{1,5})\b/i], ['str', /\bStr\s*[:;]?\s*(\d{1,5})\b/i],
  ['vit', /\bVit\s*[:;]?\s*(\d{1,5})\b/i], ['dex', /\bDex\s*[:;]?\s*(\d{1,5})\b/i], ['level', /\bLevel\s*[:;]?\s*(\d{1,3})\b/i],
  ['mastery', /\bMastery\s*[:;]?\s*(\d{1,6})/i], ['ki', /\bK\s*i\s*[:;]?\s*(\d{5,12})/i],
];
const PAIRS = [['health', /\bHealth\s*[:;]?\s*(\d+)\s*[/|lI]\s*(\d+)/i], ['chi', /\bC\s*h\s*i\s*[:;]?\s*(\d+)\s*[/|lI]\s*(\d+)/i],
  ['pet', /\bP\s*e\s*t\s*[:;]?\s*(\d+)\s*[/|lI]\s*(\d+)/i], ['dpoint', /\bD\s*\.?\s*point\s*[:;]?\s*(\d+)\s*[/|lI]\s*(\d+)/i]];
const PCTS = [['rage', /\bR\s*a\s*g\s*e\s*[:;]?\s*(\d{1,3}(?:[.,]\d+)?)\s*%/i], ['exp', /\bE\s*x\s*p\s*[:;]?\s*(\d{1,3}(?:[.,]\d+)?)\s*%/i]];

function parseBasic(lines) {
  const text = (lines || []).map((l) => String(l).replace(/\s+/g, ' ')).join('\n');
  const out = {};
  // ("Skill Evasion 51" isn't Evasion: its pattern skips an "Evasion" right after "Skill")
  for (const [k, re] of STATS) { const m = re.exec(text); if (m) out[k] = num(m[1]); }
  for (const [k, re] of PAIRS) { const m = re.exec(text); if (m) out[k] = [+m[1], +m[2]]; }
  for (const [k, re] of PCTS) { const m = re.exec(text); if (m) out[k] = +m[1].replace(',', '.'); }
  const f = /\b(Order|Chaos)\b/i.exec(text); if (f) out.faction = f[1][0].toUpperCase() + f[1].slice(1).toLowerCase();
  const c = /\bClass\s*[:;]?\s*(ASC\s*\d|[A-Z][\w ]{2,20}?)(?:\s{2,}|\s*$|\s+(?:Level|K\s*i)\b)/im.exec(text); if (c) out.cls = c[1].replace(/\s+/g, ' ').trim();
  const asc = /\bASC\s*(\d)\b/i.exec(text); if (asc) out.asc = +asc[1];
  return out;
}
const BASIC_MIN = 5; // fewer stats read than this: not trusted (a misread page)
// the reader's boxes, one number each: ["level=137", "attack=2525", "int=", …] → { level: 137, attack: 2525 }
const FIELD_MAX = { level: 300, ki: 1e12, mastery: 1e6 };
function parseFields(list) {
  const out = {};
  for (const f of list || []) {
    const m = /^(\w+)=(\d{1,12})$/.exec(String(f).trim());
    if (!m) continue;
    const v = +m[2];
    if (v <= (FIELD_MAX[m[1]] ?? 1e6)) out[m[1]] = v;
  }
  return out;
}

// "Honor ASC 3 Ki 426620802 A.P 335 Combo" → { asc, ki, ap }
function parseHeader(text) {
  const s = String(text || '');
  const asc = /ASC\s*(\d)/i.exec(s), ki = /K\s*i\s*[:;]?\s*(\d{4,12})/i.exec(s), ap = /A\s*\.?\s*P\s*\.?\s*[:;]?\s*(\d{1,6})/i.exec(s);
  return { asc: asc ? +asc[1] : null, ki: ki ? +ki[1] : null, ap: ap ? +ap[1] : null };
}
// "2:830101@300,109;…" → [{ id, x, y }] in reading order (rows, then columns)
function parseIcons(str) {
  return String(str || '').split(';').map((p) => /^(\d+):(\d+)@(\d+),(\d+)$/.exec(p.trim())).filter(Boolean)
    .map((m) => ({ set: +m[1], id: +m[2], x: +m[3], y: +m[4] })).sort((a, b) => (Math.abs(a.y - b.y) > 10 ? a.y - b.y : a.x - b.x));
}
// ["2:830101@300,109=10", …] → Map id → level ("1O", "lO" misread as 10)
function parseLevels(list) {
  const m = new Map();
  for (const l of list || []) {
    const r = /^\d+:(\d+)@\d+,\d+=(.*)$/.exec(String(l)); if (!r) continue;
    const v = r[2].replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').match(/\d{1,2}/);
    if (v && +v[0] >= 1 && +v[0] <= 99) m.set(+r[1], +v[0]);
  }
  return m;
}
const TABS = ['ascension', 'combat', 'support'];

class StatusLog {
  constructor({ read, save }) { this.data = read() || { chars: {} }; this.save = () => save(this.data); }
  _c(char) { return (this.data.chars[String(char || '?').toLowerCase()] ||= { stats: null, history: [], skills: {}, header: null }); }
  // the Basic page: the latest stats, and a history point when something changed (merged within 10 minutes)
  stats(char, st, t) {
    if (Object.keys(st).length < BASIC_MIN) return false;
    const c = this._c(char), prev = c.stats ? c.stats.v : null;
    // keep what this reading missed from the last one
    const v = { ...(prev || {}), ...st };
    c.stats = { t, v };
    const keyOf = (x) => JSON.stringify(['level', 'attack', 'defense', 'accuracy', 'evasion', 'int', 'str', 'vit', 'dex', 'asc'].map((k) => x?.[k] ?? null));
    const last = c.history[c.history.length - 1];
    if (!last || keyOf(last.v) !== keyOf(v)) {
      const point = { t, v: Object.fromEntries(['level', 'attack', 'defense', 'accuracy', 'evasion', 'skillEvasion', 'int', 'str', 'vit', 'dex', 'monAtk', 'monDef', 'asc'].map((k) => [k, v[k] ?? null])) };
      if (last && t - last.t < 10 * 60000) c.history[c.history.length - 1] = point; else c.history.push(point);
      if (c.history.length > 1000) c.history.splice(0, c.history.length - 1000);
    }
    this.save();
    return true;
  }
  // a Skill tab: the skills in it (ids in reading order), with levels on the Ascension tab; the header (ASC, Ki, A.P)
  skills(char, tab, ids, levels, header, t) {
    const name = TABS[tab]; if (!name || !ids.length) return false;
    const c = this._c(char), old = c.skills[name];
    const lv = Object.fromEntries(ids.map((id) => [id, levels.get(id) ?? old?.levels?.[id] ?? null]));
    c.skills[name] = { t, ids, levels: name === 'ascension' ? lv : undefined };
    if (header && (header.asc != null || header.ki != null)) c.header = { t, ...(c.header || {}), ...Object.fromEntries(Object.entries(header).filter(([, x]) => x != null)) };
    this.save();
    return true;
  }
  view(char) { return this.data.chars[String(char || '?').toLowerCase()] || null; }
}

module.exports = { parseBasic, parseFields, parseHeader, parseIcons, parseLevels, StatusLog, TABS, BASIC_MIN };
