// Market prices from trade messages in the chat (read by the screen reader):
//   "NhatNhat: B>Hard Iron Crystal 20m", "MrNohoMaster: WTS special sky crystal 150m", "X: S> DHL 1.5b"
// A message is a trade when it says WTS/WTB/S>/B>/sell/buy; prices are numbers with k / m (kk) / b (kkk).
'use strict';

const { bestMatch } = require('./screenreader');

const UNIT = { k: 1e3, m: 1e6, kk: 1e6, b: 1e9, kkk: 1e9, g: 1 };
// (OCR sometimes puts a stray mark between the letter and the ">": B'>)
const SIDE = [[/\b(?:WTS|S\s*['`’]?\s*>|SELL(?:ING)?|SELLS)/i, 'sell'], [/\b(?:WTB|B\s*['`’]?\s*>|BUY(?:ING)?|BUYS)/i, 'buy']];

// chat lines wrap: a line without "Name:" at the start continues the previous message
function messages(lines) {
  const out = [];
  // OCR sometimes runs two chat lines together: split before "<mark> Name:" inside a line
  const parts = (lines || []).flatMap((raw) => String(raw).replace(/\s+/g, ' ').split(/\s+(?=[•'"`·]+\s*[A-Za-z0-9_]{2,20}\s*[:;]\s)/));
  for (const raw of parts) {
    const line = raw.replace(/^[^A-Za-z0-9[]+/, '').trim(); // stray marks before the name
    if (!line) continue;
    const m = /^\[?([A-Za-z0-9_\-.]{2,20})\]?\s*[:;]\s*(.+)$/.exec(line);
    // announcements / whispers start a block of their own (dropped below), so their wrapped lines don't join a trade
    if (m) out.push({ who: /^(announcements?|annauncements?|whisp(er)?)$/i.test(m[1]) ? null : m[1], text: m[2] });
    else if (out.length) out[out.length - 1].text += ` ${line}`;
  }
  return out.filter((x) => x.who);
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function parsePrices(text) {
  const out = [];
  const re = /(\d{1,4}(?:[.,]\d{1,3})?)\s*(kkk|kk|k|m|b)\b/gi;
  let m;
  while ((m = re.exec(text))) out.push({ value: Math.round(parseFloat(m[1].replace(',', '.')) * UNIT[m[2].toLowerCase()]), at: m.index, len: m[0].length });
  return out;
}

// item names in a message: exact (normalised) word runs first, then close OCR misreads of longer runs
function findItem(text, index) {
  const words = text.replace(/[^\w()'\- ]+/g, ' ').split(/\s+/).filter(Boolean);
  let best = null;
  for (let n = Math.min(6, words.length); n >= 1 && !best; n--) {
    for (let i = 0; i + n <= words.length; i++) {
      const phrase = words.slice(i, i + n).join(' '), key = norm(phrase);
      if (key.length < 4) continue;
      const hit = index.exact.get(key);
      if (hit) { best = hit; break; }
      if (key.length >= 8) {
        const cands = index.byStart.get(key.slice(0, 2)) || [];
        const m = bestMatch(phrase, cands.filter((c) => Math.abs(c._n.length - key.length) <= 3));
        if (m) { best = m; break; }
      }
    }
  }
  return best;
}

function buildIndex(items) {
  const exact = new Map(), byStart = new Map();
  for (const it of items) {
    const k = norm(it.name); it._n ||= k;
    if (k.length >= 4 && !exact.has(k)) exact.set(k, it);
    const s = k.slice(0, 2); if (!byStart.has(s)) byStart.set(s, []); byStart.get(s).push(it);
  }
  return { exact, byStart };
}

// trade offers in a batch of chat / shout lines
function parseTrades(lines, index) {
  const out = [];
  for (const msg of messages(lines)) {
    const side = SIDE.find(([re]) => re.test(msg.text))?.[1];
    if (!side) continue;
    const prices = parsePrices(msg.text);
    const item = findItem(msg.text, index);
    out.push({ who: msg.who, side, item: item?.name || null, itemId: item?.id || null, price: prices.length === 1 ? prices[0].value : null, raw: msg.text.slice(0, 160) });
  }
  return out;
}

const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

// per item: usual sell / buy price over the last `days`
function priceStats(offers, days = 30, now = Date.now()) {
  const by = new Map();
  for (const o of offers) {
    if (!o.itemId || !o.price || now - o.t > days * 86400000) continue;
    const e = by.get(o.itemId) || { itemId: o.itemId, item: o.item, sell: [], buy: [], last: 0 };
    e[o.side].push(o.price); e.last = Math.max(e.last, o.t);
    by.set(o.itemId, e);
  }
  return [...by.values()].map((e) => ({ itemId: e.itemId, item: e.item, sell: median(e.sell), buy: median(e.buy), offers: e.sell.length + e.buy.length, last: e.last }))
    .sort((a, b) => b.offers - a.offers || b.last - a.last);
}

// 150000000 → "150m", 3800000000 → "3.8b" (the way the chat writes prices)
const gold = (v) => { const f = (x) => String(Math.round(x * 10) / 10); return v == null ? '?' : v >= 1e9 ? `${f(v / 1e9)}b` : v >= 1e6 ? `${f(v / 1e6)}m` : v >= 1e3 ? `${f(v / 1e3)}k` : String(v); };

module.exports = { messages, parsePrices, parseTrades, buildIndex, priceStats, median, gold };
