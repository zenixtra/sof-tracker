// What the open inventory shows (gold, weight), gear compared with what you wear, gear prices from the trade chat,
// and which piece of gear is the cheapest to enhance next.
'use strict';

const { parsePrices } = require('./market');

// ---------------------------------------------------------------- gold and weight
// "1 318.033,090601," (OCR of "1,318,033,090Gold") → 1318033090: a group of 1–3 digits, then groups of exactly 3;
// a longer last group is the word "Gold" read as digits
function parseGold(text) {
  const toks = String(text || '').split(/[^0-9]+/).filter(Boolean);
  if (!toks.length || toks[0].length > 3) {
    // no separators read at all: only a plain number of a sensible length
    const m = /^(\d{4,12})/.exec(String(text || '').replace(/\s/g, ''));
    return m ? +m[1] : null;
  }
  let s = toks[0];
  for (let i = 1; i < toks.length; i++) { if (toks[i].length < 3) break; s += toks[i].slice(0, 3); if (toks[i].length > 3) break; }
  return s.length >= 4 ? +s : null;
}
// "9532 / 11993 (79.5%)" → { cur, max, pct }
function parseWeight(text) {
  const m = /(\d[\d,.]*)\s*[/|]\s*(\d[\d,.]*)/.exec(String(text || ''));
  if (!m) return null;
  const cur = +m[1].replace(/\D/g, ''), max = +m[2].replace(/\D/g, '');
  return max > 0 && cur <= max * 1.5 ? { cur, max, pct: Math.round((cur / max) * 1000) / 10 } : null;
}

class InvWatch {
  constructor({ read, save, onEvent }) {
    this.data = read() || { gold: {} }; // gold: { char: [{ t, gold }] } — a point when it changes
    this.save = () => save(this.data); this.onEvent = onEvent;
    this.pending = new Map(); this.weight = new Map(); this.warnedAt = new Map();
  }
  // one look at the open inventory of a character: gold only counts once read the same twice in a row
  frame(char, inv, t, { weightAlert = 90 } = {}) {
    const key = String(char || '?').toLowerCase(), out = {};
    const g = parseGold(inv.gold), w = parseWeight(inv.weight);
    if (w) {
      this.weight.set(key, { ...w, t });
      out.weight = w;
      if (weightAlert && w.pct >= weightAlert && t - (this.warnedAt.get(key) || 0) > 30 * 60000) {
        this.warnedAt.set(key, t);
        this.onEvent('danger', `Bag ${w.pct}% full${char ? ` (${char})` : ''}`, `weight ${w.cur} / ${w.max}: time to sell or store`);
      }
    }
    if (g != null) {
      const p = this.pending.get(key);
      this.pending.set(key, g);
      if (p === g) {
        const list = (this.data.gold[key] ||= []), last = list[list.length - 1];
        if (!last || last.gold !== g) { list.push({ t, gold: g }); if (list.length > 2000) list.splice(0, list.length - 2000); this.save(); }
        else last.seen = t;
        out.gold = g;
      }
    }
    return out;
  }
  last(char) { const l = this.data.gold[String(char || '?').toLowerCase()] || []; return l[l.length - 1] || null; }
  // gold change between two moments (the last reading before each)
  between(char, from, to) {
    const l = this.data.gold[String(char || '?').toLowerCase()] || [];
    const at = (t) => { let v = null; for (const p of l) { if (p.t > t) break; v = p.gold; } return v; };
    const a = at(from) ?? l.find((p) => p.t >= from && p.t <= to)?.gold ?? null, b = at(to);
    return a != null && b != null ? b - a : null;
  }
  // gold per hour over [from, to): first and last reading inside, at least 10 minutes apart
  rate(char, from, to = Date.now()) {
    const l = (this.data.gold[String(char || '?').toLowerCase()] || []).filter((p) => p.t >= from && p.t <= to);
    if (l.length < 2 || l[l.length - 1].t - l[0].t < 10 * 60000) return null;
    return { change: l[l.length - 1].gold - l[0].gold, perHour: (l[l.length - 1].gold - l[0].gold) / ((l[l.length - 1].t - l[0].t) / 3600000) };
  }
  history(char, days = 30) { const since = Date.now() - days * 86400000; return (this.data.gold[String(char || '?').toLowerCase()] || []).filter((p) => p.t >= since); }
}

// ---------------------------------------------------------------- gear: kind, compare
// (armour first: "ROBE … SPEAR" is a robe for spear users, not a spear)
const KIND_WORDS = [['Robe', /\b(robe|armou?r|clothe?s?|dress|suit)\b/i], ['Boots', /\b(boots?|shoes?)\b/i], ['Bracer', /\b(bracers?|gloves?|gauntlets?|bracelets?)\b/i],
  ['Inner', /\binner\b/i], ['Necklace', /\b(neck(?:lace)?|amulet)\b/i], ['Earring', /\b(earrings?|ear)\b/i], ['Ring', /\brings?\b/i],
  ['Weapon', /\b(weapon|blade|sword|spear|bow|dagger|staff|fan|harp|guitar|lute|fist|claw|knuckle|gun|wand)\b/i]];
// a slot ("Weapon", "Shoes", "Boots"…) or an item name → one of the kinds above
function gearKind(s) { const k = KIND_WORDS.find(([, re]) => re.test(String(s || ''))); return k ? k[0] : null; }
const mid = (a) => (a ? (a[0] + a[1]) / 2 : null);
// what changes if you wear `other` instead of `mine` (both gear records)
function compareGear(mine, other) {
  const lines = [];
  const pct = (a, b) => (a && b ? Math.round(((b - a) / a) * 100) : null);
  if (mine.attack || other.attack) { const p = pct(mid(mine.attack), mid(other.attack)); lines.push({ what: 'Attack', mine: mine.attack ? mine.attack.join('–') : '—', other: other.attack ? other.attack.join('–') : '—', better: p == null ? null : p > 0, pct: p }); }
  if (mine.defense != null || other.defense != null) { const p = pct(mine.defense, other.defense); lines.push({ what: 'Defense', mine: mine.defense ?? '—', other: other.defense ?? '—', better: p == null ? null : p > 0, pct: p }); }
  lines.push({ what: 'Enhance', mine: `+${mine.plus || 0}`, other: `+${other.plus || 0}`, better: (other.plus || 0) === (mine.plus || 0) ? null : (other.plus || 0) > (mine.plus || 0) });
  lines.push({ what: 'Options', mine: mine.options.length, other: other.options.length, better: other.options.length === mine.options.length ? null : other.options.length > mine.options.length });
  const el = (g) => (g.element ? `${g.element.name} ${g.element.level}${g.element.bonus ? `+${g.element.bonus}` : ''}` : '—');
  if (mine.element || other.element) lines.push({ what: 'Element', mine: el(mine), other: el(other), better: !!other.element && (!mine.element || other.element.level + other.element.bonus > mine.element.level + mine.element.bonus) ? true : !other.element ? false : null });
  if (mine.souled != null || other.souled != null) lines.push({ what: 'Awakening', mine: mine.souled ?? '—', other: other.souled ?? '—', better: (other.souled || 0) === (mine.souled || 0) ? null : (other.souled || 0) > (mine.souled || 0) });
  if (mine.level || other.level) lines.push({ what: 'Level', mine: mine.level ?? '—', other: other.level ?? '—', better: null });
  const score = lines.reduce((a, l) => a + (l.better === true ? 1 : l.better === false ? -1 : 0), 0);
  return { lines, verdict: score > 0 ? 'better' : score < 0 ? 'worse' : 'mixed' };
}

// ---------------------------------------------------------------- gear offers in the trade chat
// "SELL ROBE HBK 110 DEF7+8 7,5B", "B: ROBE C100-120 SPEAR MALE DEF+8 WMWMWM" → { side, kind, level, plus, element, price }
const ELEMENT_WORDS = [['Fire', /\b(fire|fi)\b/i], ['Water', /\b(water|wa)\b/i], ['Wind', /\b(wind|wi)\b/i], ['Poison', /\b(poison|poi|po)\b/i], ['Inner', /\binner\b/i], ['Outer', /\bouter\b/i]];
function parseGearOffer(line) {
  const s = String(line || '').replace(/^[^:]{1,20}:\s*/, '');
  const side = /\b(sell|selling|wts|s>|s:)/i.test(s) ? 'sell' : /\b(buy|buying|wtb|b>|b:)/i.test(s) || /^b\b/i.test(s) ? 'buy' : null;
  const kind = gearKind(s);
  if (!side || !kind) return null;
  const plus = /\+\s*(\d{1,2})\b/.exec(s);
  const lv = [...s.matchAll(/\b[Cc]?(\d{2,3})(?:\s*[-~]\s*(\d{2,3}))?\b(?!\s*[,.]?\d*\s*[bmk]\b)/gi)].map((m) => +m[1]).find((n) => n >= 30 && n <= 180) ?? null;
  const element = ELEMENT_WORDS.find(([, re]) => re.test(s))?.[0] || null;
  const price = (parsePrices(s) || []).map((p) => p.value).filter((p) => p > 1e5).pop() ?? null;
  return { side, kind, level: lv, plus: plus ? +plus[1] : null, element, price };
}
// what gear like this goes for: same kind, level within 10, same enhance level (±0) → median asking / buying price
function gearPrice(offers, { kind, level, plus }, days = 30, now = Date.now()) {
  const med = (a) => { if (!a.length) return null; const x = a.slice().sort((p, q) => p - q), m = x.length >> 1; return x.length % 2 ? x[m] : (x[m - 1] + x[m]) / 2; };
  const like = offers.filter((o) => o.kind === kind && o.price && now - o.t < days * 86400000 && (o.plus ?? 0) === (plus ?? 0) && (!level || !o.level || Math.abs(o.level - level) <= 10));
  return { sell: med(like.filter((o) => o.side === 'sell').map((o) => o.price)), buy: med(like.filter((o) => o.side === 'buy').map((o) => o.price)), offers: like.length };
}

// ---------------------------------------------------------------- the cheapest upgrade
// the guide's enhance tier for gear of an Ascension ("ASC 3") with a charm's tier list
function tierIndex(cls, tiers) {
  const n = +(/asc\s*(\d)/i.exec(String(cls || '')) || [])[1] || 0;
  const i = tiers.findIndex((t) => { const m = /ASC\s*(\d)(?:\s*[–-]\s*(\d))?/i.exec(t); return n && m && n >= +m[1] && n <= +(m[2] || m[1]); });
  return i >= 0 ? i : 0;
}
// gear: records; oddsFor(cls) → % per target level; value(g, plus) → chat price or null. Ranks +1 by chance × worth.
function upgradePlan(gear, oddsFor, value = () => null) {
  return gear.filter((g) => (g.plus || 0) < 10).map((g) => {
    const to = (g.plus || 0) + 1, p = (oddsFor(g.cls)[to - 1] ?? 0) / 100;
    const now = value(g, g.plus || 0), next = value(g, to);
    const gain = now != null && next != null ? next - now : null;
    return { key: g.key, name: g.name, slot: g.slot, plus: g.plus || 0, to, chance: p, tries: p > 0 ? Math.round((1 / p) * 10) / 10 : null, risky: to >= 3 && p < 1, gain, expected: gain != null ? gain * p : null };
  }).sort((a, b) => (b.expected ?? -Infinity) - (a.expected ?? -Infinity) || b.chance - a.chance);
}

module.exports = { parseGold, parseWeight, InvWatch, gearKind, compareGear, parseGearOffer, gearPrice, tierIndex, upgradePlan };
