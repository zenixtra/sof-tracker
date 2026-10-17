// "125120Exp obtained" in the chat: the exact EXP of each gain. The chat box scrolls (new lines at the bottom push the
// old ones up), so a look's lines are lined up with the last look's: what's below the overlap is new.
'use strict';

// "125120Exp obtained", "i 125120Exp obtained", "125,120 Exp obtained" → 125120 (a misread digit → null)
function parseExpLine(text) {
  const m = /(\d[\d,.]{1,14})\s*E\s*x\s*p\s*\.?\s*obtain/i.exec(String(text || ''));
  if (!m) return null;
  const n = +m[1].replace(/[,.]/g, '');
  return n > 0 && n < 1e13 ? n : null;
}
const isExpLine = (t) => /E\s*x\s*p\s*\.?\s*obtain/i.test(String(t || ''));
// a row's reading as a key to line looks up with: "E125120" for an EXP line, the first letters otherwise
const keyOf = (t) => { const n = parseExpLine(t); if (n != null) return `E${n}`; const s = String(t || '').toLowerCase().replace(/[^a-z0-9]/g, ''); return s.length >= 4 ? `T${s.slice(0, 14)}` : null; };

// how clean a reading looks: letters, digits and normal punctuation, fewer odd characters
const cleanness = (t) => t.length - 6 * (t.match(/[^A-Za-z0-9 .,:!?'()\[\]%+-]/g) || []).length;
// two looks' readings of one row: EXP lines match each other (a digit may read differently), other lines by their start
// (one digit different, dropped or added still counts as the same: a misread)
function oneEdit(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const ra = a.slice(i + (a.length >= b.length ? 1 : 0)), rb = b.slice(i + (b.length >= a.length ? 1 : 0));
  return ra === rb;
}
const sameRow = (a, b) => (a[0] === 'E' ? b[0] === 'E' && a.length >= 5 && oneEdit(a.slice(1), b.slice(1)) : b[0] === 'T' && a.slice(0, 7) === b.slice(0, 7));

class ExpChat {
  constructor() { this.prev = null; this.fresh = []; }
  // one look: chat lines with their rows (f.chat, f.chatY); returns the EXP gains that are new since the last look
  frame(f) {
    const lines = f.chat || [], ys = f.chatY || [];
    if (!lines.length || ys.length !== lines.length) return [];
    // per row (lines within 5 px are the same row, read by several passes): the reading with a number wins
    const rows = [];
    lines.forEach((t, i) => {
      const y = ys[i], k = keyOf(t);
      if (k == null) return;
      const r = rows.find((x) => Math.abs(x.y - y) <= 5);
      const text = String(t).replace(/\s+/g, ' ').trim();
      if (!r) rows.push({ y, k, text });
      else if (k[0] === 'E' && (r.k[0] !== 'E' || k.length > r.k.length)) { r.k = k; r.text = text; } // the reading with the most digits
      else if (k[0] !== 'E' && r.k[0] !== 'E' && cleanness(text) > cleanness(r.text)) r.text = text; // the cleaner reading
    });
    rows.sort((a, b) => a.y - b.y);
    const cur = rows.map((r) => r.k), prev = this.prev;
    this.prev = cur; this.fresh = [];
    if (!prev) return []; // the first look: what's on screen is old
    // the smallest scroll that lines the old rows up with the new ones (the old ones moved up by `s` rows)
    let s = -1;
    for (let k = 0; k <= prev.length; k++) {
      const n = prev.length - k;
      if (n > cur.length) continue;
      let ok = n > 0 || cur.length > 0;
      for (let i = 0; i < n && ok; i++) if (!sameRow(prev[k + i], cur[i])) ok = false;
      // (with nothing to line up with, everything would be new: only trust that if few rows moved)
      if (ok && (n >= 1 || cur.length <= 3)) { s = k; break; }
    }
    if (s < 0) return []; // can't tell (the chat was scrolled by hand, or read too differently): count nothing
    const fresh = cur.slice(prev.length - s);
    // every new line (for the game's other messages: pickups, Ki, gold, deaths…), the EXP gains returned
    this.fresh = rows.slice(prev.length - s).map((r) => r.text);
    return fresh.filter((k) => k[0] === 'E').map((k) => +k.slice(1));
  }
}

// an EXP gain that is exactly a quest's EXP reward: that quest was handed in. quests: [{ id, name, exp }]
function questForGain(n, quests) {
  return quests.find((q) => q.exp > 0 && Math.abs(q.exp - n) <= Math.max(1, q.exp * 0.002)) || null;
}

module.exports = { parseExpLine, isExpLine, ExpChat, questForGain };
