// Gear score (one rough number for what a character wears, with its history), the gold ledger (each change of
// gold between two looks at the inventory, sorted into what it probably was) and the price check of a hovered item.
'use strict';

const DAY = 86400000;
const mid = (a) => (a ? (a[0] + a[1]) / 2 : 0);

// ---------------------------------------------------------------- gear score
const SCORE_SLOTS = ['Weapon', 'Robe', 'Boots', 'Bracer', 'Inner', 'Necklace', 'Earring', 'Ring'];
// one piece: its attack or defense, raised by its enhance level, plus options, element and awakening
function pieceScore(g) {
  if (!g || !SCORE_SLOTS.includes(g.slot)) return 0;
  const base = g.slot === 'Weapon' ? mid(g.attack) : (g.defense || 0) * 3;
  const el = g.element ? (g.element.level + (g.element.bonus || 0)) * 10 : 0;
  return Math.round(base * (1 + 0.08 * (g.plus || 0)) + (g.options?.length || 0) * 15 + el + (g.souled || 0) * 20 + (g.level || 0));
}
// a character's gear log → { score, pieces: [{ slot, name, plus, score }] } (one piece per slot: the latest seen)
function gearScore(items) {
  const bySlot = new Map();
  for (const g of items) if (SCORE_SLOTS.includes(g.slot) && (!bySlot.has(g.slot) || (g.lastSeen || 0) > (bySlot.get(g.slot).lastSeen || 0))) bySlot.set(g.slot, g);
  const pieces = [...bySlot.values()].map((g) => ({ slot: g.slot, name: g.name, plus: g.plus || 0, score: pieceScore(g) })).sort((a, b) => b.score - a.score);
  return { score: pieces.reduce((s, p) => s + p.score, 0), pieces };
}
// a point per character when the score changes
class GearScores {
  constructor({ read, save }) { this.data = read() || { chars: {} }; this.save = () => save(this.data); }
  note(char, score, t) {
    if (!char || !score) return false;
    const l = (this.data.chars[String(char).toLowerCase()] ||= []);
    if (l.length && l[l.length - 1].score === score) return false;
    l.push({ t, score }); if (l.length > 500) l.splice(0, l.length - 500);
    this.save(); return true;
  }
  history(char) { return this.data.chars[String(char || '').toLowerCase()] || []; }
}

// ---------------------------------------------------------------- the gold ledger
const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
// points: [{ t, gold }] (one character); ctx: { enhance: [t], trades: [{ t, type, qty, price }] }
// a loss with enhance tries in between is enhancing; a change the size of a logged trade is that trade;
// the rest: spent in shops (and repairs, fees…) or earned from loot and NPC sales
// exchanges: times the game said "Exchange completed successfully." (a trade, logged or not)
function goldLedger(points, { enhance = [], trades = [], exchanges = [] } = {}, { from = 0, to = Infinity } = {}) {
  const rows = [];
  const cats = {};
  const days = new Map();
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], d = b.gold - a.gold;
    if (!d || b.t < from || b.t > to) continue;
    const inGap = (t) => t > a.t && t <= b.t + 60000;
    const trade = trades.find((x) => inGap(x.t) && x.price && (d < 0 ? x.type === 'buy' : x.type === 'sell') && [x.price, x.price * (x.qty || 1)].some((p) => Math.abs(p - Math.abs(d)) <= Math.abs(d) * 0.1));
    const cat = d < 0
      ? (enhance.some(inGap) ? 'Enhancing' : trade || exchanges.some(inGap) ? 'Trades' : 'Shops & other')
      : (trade || exchanges.some(inGap) ? 'Trades' : 'Loot & sales');
    rows.push({ t: b.t, change: d, gold: b.gold, cat, trade: trade ? trade.item : undefined });
    const c = (cats[cat] ||= { in: 0, out: 0 });
    if (d > 0) c.in += d; else c.out -= d;
    const k = dayKey(b.t), dy = days.get(k) || { day: k, in: 0, out: 0, cats: {} };
    if (d > 0) dy.in += d; else dy.out -= d;
    dy.cats[cat] = (dy.cats[cat] || 0) + d;
    days.set(k, dy);
  }
  const income = rows.filter((r) => r.change > 0).reduce((s, r) => s + r.change, 0), spent = rows.filter((r) => r.change < 0).reduce((s, r) => s - r.change, 0);
  return { rows: rows.reverse(), cats, days: [...days.values()].sort((x, y) => (x.day < y.day ? 1 : -1)), income, spent, net: income - spent };
}

// ---------------------------------------------------------------- price check of a hovered item
// "Price : 1,250,000" / "Sell price: 12 500" on a shop tooltip → 1250000
function tooltipPrice(lines) {
  for (const l of lines || []) {
    const m = /(?:price|cost|gold)\s*[:;]?\s*(\d[\d.,\s]{0,16}\d|\d)/i.exec(String(l));
    if (m) { const n = +m[1].replace(/\D/g, ''); if (n > 0) return n; }
  }
  return null;
}
// what an item goes for: the chat (sell / buy asking prices), NPC price from the game data, the price on the tooltip
function priceCheck({ name, itemId, plus = 0, chat = {}, npcPrice = null, shown = null }) {
  const ref = chat.sell ?? chat.buy ?? null;
  let verdict = null;
  if (shown && ref) {
    const pct = Math.round(((shown - ref) / ref) * 100);
    verdict = { pct, word: pct <= -10 ? 'cheaper' : pct >= 10 ? 'dearer' : 'usual' };
  }
  return { name, itemId, plus, sell: chat.sell ?? null, buy: chat.buy ?? null, offers: chat.offers ?? null, npcPrice: npcPrice || null, shown, verdict };
}

// ---------------------------------------------------------------- net worth
// gold plus gear at chat prices, a point per character when it changes (at most one every 10 minutes)
class NetWorth {
  constructor({ read, save }) { this.data = read() || { chars: {} }; this.save = () => save(this.data); }
  note(char, { gold, gear }, t) {
    if (!char || gold == null) return false;
    const l = (this.data.chars[String(char).toLowerCase()] ||= []), last = l[l.length - 1];
    if (last && last.gold === gold && last.gear === gear) return false;
    if (last && t - last.t < 10 * 60000) { Object.assign(last, { t, gold, gear }); this.save(); return true; }
    l.push({ t, gold, gear }); if (l.length > 1000) l.splice(0, l.length - 1000);
    this.save(); return true;
  }
  history(char, days = 90, now = Date.now()) { return (this.data.chars[String(char || '').toLowerCase()] || []).filter((p) => p.t >= now - days * DAY); }
}

// ---------------------------------------------------------------- market flips
// stats: market.priceStats rows ({ itemId, item, sell, buy, offers }); counts: itemId → { sell, buy } number of offers;
// npcSell(itemId): what an NPC pays you. Two kinds: buyers in the chat pay more than sellers ask, and sellers ask
// less than an NPC pays.
function marketFlips(stats, counts, npcSell = () => 0) {
  const out = [];
  for (const s of stats) {
    const c = counts.get(s.itemId) || { sell: 0, buy: 0 };
    if (s.sell && s.buy && s.buy > s.sell && c.sell >= 2 && c.buy >= 2) out.push({ kind: 'chat', itemId: s.itemId, item: s.item, buyAt: s.sell, sellAt: s.buy, margin: s.buy - s.sell, pct: Math.round(((s.buy - s.sell) / s.sell) * 100), offers: c.sell + c.buy });
    const n = npcSell(s.itemId);
    if (s.sell && n && n > s.sell && c.sell >= 2) out.push({ kind: 'npc', itemId: s.itemId, item: s.item, buyAt: s.sell, sellAt: n, margin: n - s.sell, pct: Math.round(((n - s.sell) / s.sell) * 100), offers: c.sell });
  }
  return out.sort((a, b) => b.margin * Math.min(b.offers, 10) - a.margin * Math.min(a.offers, 10));
}

module.exports = { NetWorth, marketFlips, pieceScore, gearScore, GearScores, goldLedger, tooltipPrice, priceCheck, SCORE_SLOTS, DAY };
