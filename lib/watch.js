// What the screen reader's looks add up to while you're away from the game: the chat log (and whispers / mentions /
// chat colours you asked to be told about), "the game is gone" (no HUD, a disconnect box), "EXP stopped" while
// farming, party members' HP, price watches on trade offers, and screen totals per play session.
'use strict';

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// how alike two texts are (0..1): shared letter pairs, cheap enough to compare every chat line with the recent log
function similar(a, b) {
  a = norm(a); b = norm(b);
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const pairs = new Map();
  for (let i = 0; i < a.length - 1; i++) { const p = a.slice(i, i + 2); pairs.set(p, (pairs.get(p) || 0) + 1); }
  let hit = 0;
  for (let i = 0; i < b.length - 1; i++) { const p = b.slice(i, i + 2), n = pairs.get(p); if (n) { hit++; pairs.set(p, n - 1); } }
  return (2 * hit) / (a.length + b.length - 2);
}

const hex = (s) => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(s || '')); return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null; };
function colorDist(a, b) { const x = hex(a), y = hex(b); return x && y ? Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) : Infinity; }
// pink / magenta: the colour games like this one usually give whispers
const isPink = (c) => { const x = hex(c); return !!x && x[0] > 170 && x[2] > 140 && x[1] < x[0] - 50 && x[1] < x[2] - 30; };

// the chat box's tab bar and buttons, read as text: not chat
const TAB_WORDS = /^(?:(?:all|norm(?:al)?|roar|shout|house|party|whisp?|sell|trade|info|ally|war|system)\s*)+$/i;

// how readable a reading is: known player name, a real ":" and few odd characters win
function quality(m, known) {
  const odd = (m.text.match(/[^A-Za-z0-9 .,:!?'()+=>%/&-]/g) || []).length;
  return (known && known(m.who) ? 4 : 0) + (m.clean ? 2 : 0) - (10 * odd) / Math.max(10, m.text.length);
}

// chat lines of one look → messages { who, text, col, clean, y }. Every reading pass sees the same chat rows, each
// reads some of them better: per row (same height on screen) the best reading is kept.
function chatMessages(f, known = null) {
  const lines = f.chat || [], cols = f.chatCol || [], ys = f.chatY || [], counts = f.chatPass?.length ? f.chatPass : [lines.length];
  const passes = [];
  let i = 0;
  for (const n of counts) {
    const out = [];
    let cur = null; // continuation lines join the message before them, within one pass only
    for (const end = i + n; i < end; i++) {
      const raw = String(lines[i] || '').replace(/\s+/g, ' ').trim(), col = cols[i] || '';
      if (!raw || TAB_WORDS.test(raw)) { cur = null; continue; }
      const line = raw.replace(/^[^A-Za-z0-9[]+/, '');
      const m = /^\[?([A-Za-z0-9_\-.]{2,20})\]?\s*([:;])\s*(.+)$/.exec(line);
      if (m) {
        cur = { who: m[1], text: m[3], col, y: ys[i] ?? null, clean: m[2] === ':' && /^[A-Za-z0-9_]{2,16}$/.test(m[1]) };
        out.push(cur);
      } else if (cur && (!col || !cur.col || colorDist(col, cur.col) < 40)) cur.text += ` ${line}`;
      else cur = null;
    }
    passes.push(out);
  }
  // the pass that read the most clean lines this time is trusted a little more on ties
  const bestPass = passes.reduce((b, p, k) => (p.filter((m) => m.clean).length > passes[b].filter((m) => m.clean).length ? k : b), 0);
  const all = passes.flatMap((p, k) => p.map((m) => ({ ...m, score: quality(m, known) + (k === bestPass ? 1 : 0) })));
  if (!all.length || all.some((m) => m.y == null)) return all;
  const rows = [];
  for (const m of all.sort((a, b) => b.score - a.score)) if (!rows.some((r) => Math.abs(r.y - m.y) <= 5)) rows.push(m);
  return rows.sort((a, b) => a.y - b.y);
}

// The chat log: each message once (the same line is read in every look while it stays on screen, by several passes,
// differently each time) with the best reading kept.
class ChatLog {
  constructor(entries = [], { max = 20000, known = null } = {}) {
    this.entries = entries; this.max = max; this.known = known; this.seq = entries.reduce((m, e) => Math.max(m, e.id || 0), 0);
  }
  // returns the messages that are new
  add(f) {
    const fresh = [], recent = [];
    for (let i = this.entries.length - 1; i >= 0 && f.t - this.entries[i].last < 20 * 60000; i--) recent.push(this.entries[i]);
    // with line positions one reading per chat row is left, and the same pixels read the same way look after look:
    // only near-identical readings are the same message (the same seller's offers can look much alike)
    const rowed = (f.chatY || []).length > 0;
    for (const m of chatMessages(f, this.known)) {
      const full = `${m.who}: ${m.text}`;
      let same = null, best = rowed ? 0.86 : 0.58;
      for (const e of recent) { const s = similar(full, `${e.who}: ${e.text}`); if (s > best) { best = s; same = e; } }
      if (same) {
        same.last = f.t;
        const q = quality(m, this.known);
        if (q > same.q) { same.who = m.who; same.text = m.text.slice(0, 300); same.q = q; if (m.col) same.col = m.col; }
        continue;
      }
      if (!m.clean) continue; // a garbled reading only improves a message already in the log, never starts one
      const e = { id: ++this.seq, t: f.t, last: f.t, who: m.who, text: m.text.slice(0, 300), col: m.col, q: quality(m, this.known) };
      this.entries.push(e); recent.push(e); fresh.push(e);
    }
    if (this.entries.length > this.max) this.entries.splice(0, this.entries.length - this.max);
    return fresh;
  }
  search({ q = '', who = '', limit = 300, before = Infinity } = {}) {
    const qq = String(q).toLowerCase(), ww = norm(who), out = [];
    for (let i = this.entries.length - 1; i >= 0 && out.length < limit; i--) {
      const e = this.entries[i];
      if (e.t >= before) continue;
      if (ww && !norm(e.who).includes(ww)) continue;
      if (qq && !`${e.who}: ${e.text}`.toLowerCase().includes(qq)) continue;
      out.push(e);
    }
    return out;
  }
}

// is a new chat message one to tell you about? → { kind, title } or null
//   cfg: { me, whispers, mentions, colors: [{ col, label }] }
function chatAlert(e, cfg) {
  const me = norm(cfg.me);
  if (me && norm(e.who) === me) return null; // your own messages
  if (/^(announcements?|annauncements?)$/i.test(e.who)) return null;
  const c = (cfg.colors || []).find((x) => colorDist(x.col, e.col) < 30);
  // whispers: "From X: …", "[Whisper] X: …", "X whispers: …", or pink text
  const w = /^(?:from|whisper|whisp)$/i.test(e.who) || /\bwhispers?\b\s*:?/i.test(e.text.slice(0, 30)) || (isPink(e.col) && !c);
  if (cfg.whispers && w) {
    const from = /^(?:from|whisper|whisp)$/i.test(e.who) ? (/^\[?([A-Za-z0-9_]{2,16})\]?\s*[:;]?/.exec(e.text)?.[1] || '?') : e.who;
    return { kind: 'whisper', title: `Whisper from ${from}` };
  }
  if (c) return { kind: 'whisper', title: `${c.label || 'Chat'}: ${e.who}` };
  if (cfg.mentions && me && me.length >= 3 && norm(e.text).includes(me)) return { kind: 'whisper', title: `${e.who} mentioned you` };
  return null;
}

// "is the game still going?" from the looks: the HUD gone for a while (logged out, a disconnect box, stuck
// loading), a disconnect message in the middle of the screen, or EXP standing still while you were farming
class AwayWatch {
  constructor() { this.hudAt = 0; this.hadHud = false; this.noHudAlerted = false; this.dcAt = -Infinity; this.expAt = 0; this.exp = null; this.kills = []; this.stuckAlerted = false; }
  // f: the look; kill: an EXP kill was counted in it; cfg: { hud, stuckMinutes } → alerts [{ kind, title, body }]
  frame(f, { hud, kill, cfg }) {
    const out = [];
    if (hud) { this.hudAt = f.t; this.hadHud = true; this.noHudAlerted = false; }
    const lines = f.center || [], DC = /disconnect|connection|lost the server|kicked out/i, at = lines.findIndex((l) => DC.test(l));
    if (cfg.hud && at >= 0 && f.t - this.dcAt > 10 * 60000) {
      this.dcAt = f.t; this.noHudAlerted = true;
      // the message itself: its line and the two after it (names and world text around the box are left out)
      out.push({ kind: 'disconnect', title: 'Disconnected from the server', body: lines.slice(at, at + 3).join(' ').slice(0, 160) });
    } else if (cfg.hud && this.hadHud && !hud && !this.noHudAlerted && f.t - this.hudAt >= 2 * 60000) {
      this.noHudAlerted = true;
      out.push({ kind: 'disconnect', title: 'Your character is not in the game', body: 'No HP bar on screen for 2 minutes: logged out, loading or a message box?' });
    }
    if (kill) { this.kills.push(f.t); while (this.kills.length && f.t - this.kills[0] > 60 * 60000) this.kills.shift(); }
    if (f.exp > 0) {
      if (this.exp == null || Math.abs(f.exp - this.exp) > 0.004) { this.exp = f.exp; this.expAt = f.t; this.stuckAlerted = false; }
      const mins = cfg.stuckMinutes, idle = f.t - this.expAt;
      const farming = this.kills.filter((t) => t <= this.expAt + 1 && this.expAt - t < 15 * 60000).length >= 3;
      if (mins > 0 && hud && farming && !this.stuckAlerted && idle >= mins * 60000) {
        this.stuckAlerted = true;
        out.push({ kind: 'stuck', title: `No EXP for ${Math.round(idle / 60000)} min`, body: 'You were farming, but the EXP bar has stopped moving.' });
      }
    }
    return out;
  }
}

// party members' HP from their gauges: an alert when one drops below the line, or dies (once a minute each)
class PartyWatch {
  constructor() { this.at = new Map(); this.members = []; }
  frame(f, { below }) {
    const out = [];
    this.members = (f.party || []).map((p, i) => ({ name: /[A-Za-z0-9]{3}/.test(p.name || '') ? String(p.name).replace(/[^\w-]/g, '').slice(0, 20) : `Party member ${i + 1}`, hp: p.hp }));
    if (!below) return out;
    for (const m of this.members) {
      if (m.hp >= below) continue;
      const k = norm(m.name);
      if (this.at.has(k) && f.t - this.at.get(k) < 60000) continue;
      this.at.set(k, f.t);
      out.push(m.hp === 0 ? { kind: 'party', title: `${m.name} died`, body: '' } : { kind: 'party', title: `${m.name}: HP ${m.hp}%`, body: '' });
    }
    return out;
  }
}

// a trade offer that meets one of your price watches: { item, itemId, side: 'sell' (someone sells at or under)
// | 'buy' (someone buys at or over), price }
const priceHit = (o, watches) => (o.itemId && o.price ? watches.find((w) => w.itemId === o.itemId && w.side === o.side && (o.side === 'sell' ? o.price <= w.price : o.price >= w.price)) || null : null);

// screen totals for one play session: EXP gained (a level-up counts the rest of the bar), kills, deaths, drops
class ScreenSession {
  // seed: the totals saved for this session before (the tracker restarted mid-session)
  constructor(key = null, seed = null) {
    this.key = key; this.exp = seed?.exp || 0; this.kills = seed?.kills || 0; this.deaths = seed?.deaths || 0; this.drops = seed?.drops || 0; this.levels = seed?.levels || 0;
    this.zones = seed?.bestZone != null ? { [seed.bestZone]: seed.exp || 0 } : {}; this.last = null;
  }
  frame(f, { kill, died, zone }) {
    const d = f.exp > 0 && this.last != null ? f.exp - this.last : 0;
    if (f.exp > 0 && d < 20) { // (a bigger jump no kill gives: a misread, skipped)
      const gain = d < -50 ? 100 + d : d > 0 ? d : 0;
      if (d < -50) this.levels++;
      if (gain) { this.exp += gain; if (zone != null) this.zones[zone] = (this.zones[zone] || 0) + gain; }
      this.last = f.exp;
    }
    if (kill) this.kills++;
    if (died) this.deaths++;
    return { levelUp: d < -50 };
  }
  view() {
    const best = Object.entries(this.zones).sort((a, b) => b[1] - a[1])[0];
    return { exp: Math.round(this.exp * 100) / 100, kills: this.kills, deaths: this.deaths, drops: this.drops, levels: this.levels, bestZone: best ? +best[0] : null };
  }
}

// ---- deals: an offer well under (sellers) or over (buyers) the usual price of the last 30 days.
// Returns how far off the usual price it is (0.35 = 35 %) and that price, or null. Needs 3 earlier offers.
function dealOf(o, offers, minPct, now = o.t) {
  if (!o.itemId || !o.price || !minPct) return null;
  const same = offers.filter((x) => x !== o && x.itemId === o.itemId && x.side === o.side && x.price && now - x.t < 30 * 86400000 && x.t <= now).map((x) => x.price).sort((a, b) => a - b);
  if (same.length < 3) return null;
  const m = same.length >> 1, usual = same.length % 2 ? same[m] : (same[m - 1] + same[m]) / 2;
  const off = o.side === 'sell' ? 1 - o.price / usual : o.price / usual - 1;
  // more than 10x off is a typo or a misread price, not a deal
  return off >= minPct / 100 && o.price > usual / 10 && o.price < usual * 10 ? { pct: Math.round(off * 100), usual } : null;
}

// ---- a player as a trader: what they buy and sell in the chat, at what prices, how often
function traderProfile(name, offers, chat) {
  const k = norm(name);
  const mine = offers.filter((o) => norm(o.who) === k);
  const by = new Map();
  for (const o of mine) {
    const key = `${o.side}|${o.itemId || o.item || o.raw}`;
    const e = by.get(key) || { side: o.side, item: o.item, itemId: o.itemId, prices: [], count: 0, last: 0, raw: o.raw };
    e.count++; e.last = Math.max(e.last, o.t); if (o.price) e.prices.push(o.price); if (o.t >= e.last) e.raw = o.raw;
    by.set(key, e);
  }
  const lines = chat.filter((e) => norm(e.who) === k);
  const ts = [...mine.map((o) => o.t), ...lines.map((e) => e.t)];
  const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  return {
    name, offers: mine.length, messages: lines.length, first: ts.length ? Math.min(...ts) : null, last: ts.length ? Math.max(...ts) : null,
    items: [...by.values()].map(({ prices, ...e }) => ({ ...e, price: median(prices) })).sort((a, b) => b.count - a.count || b.last - a.last).slice(0, 30),
    recent: lines.slice(-8).reverse().map((e) => ({ t: e.t, text: e.text })),
  };
}

// ---- one session as the screen reader saw it: HP / MP / EXP every 10 s, and what happened when
class Timeline {
  constructor(key, data = null) { this.key = key; this.samples = data?.samples || []; this.events = data?.events || []; this.lastT = this.samples.length ? this.samples[this.samples.length - 1][0] : -Infinity; this.dirty = false; }
  frame(f, { hpPct, mpPct }) {
    if (f.t - this.lastT < 10000) return;
    this.lastT = f.t; this.dirty = true;
    this.samples.push([f.t, hpPct ?? null, mpPct ?? null, f.exp > 0 ? Math.round(f.exp * 100) / 100 : null]);
    if (this.samples.length > 8640) this.samples.splice(0, this.samples.length - 8640); // a day of 10 s steps
  }
  // kind: kill | death | drop | whisper | level | alert
  event(t, kind, text = '') {
    this.events.push([t, kind, String(text).slice(0, 120)]); this.dirty = true;
    if (this.events.length > 5000) this.events.splice(0, this.events.length - 5000);
  }
  toJSON() { return { key: this.key, samples: this.samples, events: this.events }; }
}

// ---- when the next level comes: EXP gained per played hour (screen reader sessions of the last days) and how many
// hours a day you play. sessions: [{ startedAt, endedAt, activeMs, afkMs, screen: { exp } }]; levels: [{ t }]
function levelForecast({ exp, sessions, levels = [], now = Date.now(), days = 7 }) {
  const recent = sessions.filter((s) => s.screen?.exp > 0 && now - s.startedAt < days * 86400000);
  const gained = recent.reduce((a, s) => a + s.screen.exp, 0);
  const hours = recent.reduce((a, s) => a + Math.max(0, (s.endedAt || now) - s.startedAt), 0) / 3600000;
  const playedDays = new Set(sessions.filter((s) => now - s.startedAt < days * 86400000).map((s) => new Date(s.startedAt).toDateString())).size;
  const allHours = sessions.filter((s) => now - s.startedAt < days * 86400000).reduce((a, s) => a + Math.max(0, (s.endedAt || now) - s.startedAt), 0) / 3600000;
  const perHour = hours >= 0.25 ? gained / hours : null;
  const hoursPerDay = allHours / days;
  const left = exp != null ? Math.max(0, 100 - exp) : null;
  const playHoursLeft = perHour && left != null ? left / perHour : null;
  const etaMs = playHoursLeft != null && hoursPerDay > 0 ? (playHoursLeft / hoursPerDay) * 86400000 : null;
  const ups = levels.slice(-11).map((l, i, a) => (i ? { t: l.t, ms: l.t - a[i - 1].t, level: l.level ?? null } : null)).filter(Boolean).reverse();
  return { exp, perHour, hoursPerDay, playedDays, playHoursLeft, etaMs, etaAt: etaMs != null ? now + etaMs : null, sessions: recent.length, levels: ups };
}

const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// ---- an item's price over time: per day the usual (median) selling and buying price. dayOf(t) → 'YYYY-MM-DD'
function priceHistory(offers, itemId, { days = 90, now = Date.now(), dayOf = (t) => new Date(t).toISOString().slice(0, 10) } = {}) {
  const by = new Map();
  for (const o of offers) {
    if (o.itemId !== itemId || !o.price || now - o.t > days * 86400000) continue;
    const d = dayOf(o.t), e = by.get(d) || { day: d, t: o.t, sell: [], buy: [] };
    e[o.side].push(o.price); by.set(d, e);
  }
  return [...by.values()].sort((a, b) => a.t - b.t).map((e) => ({ day: e.day, t: e.t, sell: median(e.sell), buy: median(e.buy), offers: e.sell.length + e.buy.length }));
}

// ---- the week's biggest price changes: usual selling price this week against the week before (3+ offers in both)
function marketMovers(offers, weekStart, weekMs = 7 * 86400000, min = 3) {
  const cur = new Map(), prev = new Map();
  for (const o of offers) {
    if (!o.itemId || !o.price || o.side !== 'sell') continue;
    const m = o.t >= weekStart && o.t < weekStart + weekMs ? cur : o.t >= weekStart - weekMs && o.t < weekStart ? prev : null;
    if (!m) continue;
    const e = m.get(o.itemId) || { item: o.item, prices: [] }; e.prices.push(o.price); m.set(o.itemId, e);
  }
  const out = [];
  for (const [id, e] of cur) {
    const p = prev.get(id);
    if (!p || e.prices.length < min || p.prices.length < min) continue;
    const now = median(e.prices), before = median(p.prices);
    out.push({ itemId: id, item: e.item, now, before, change: Math.round(((now - before) / before) * 100), offers: e.prices.length });
  }
  return out.filter((x) => x.change).sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 12);
}

// ---- words in the chat you want to hear about ("LF party", an item name…): the first one a message contains
function chatWordHit(e, words) {
  const text = ` ${String(e.text || '').toLowerCase().replace(/\s+/g, ' ')} `;
  return (words || []).find((w) => { const k = String(w).trim().toLowerCase(); return k.length >= 2 && (k.length <= 3 ? new RegExp(`[^a-z0-9]${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^a-z0-9]`).test(text) : text.includes(k)); }) || null;
}

// ---- how often to look: quickly while something happens, slowly while nothing does
//   { base, kills: [t], hpPct, target, partyLow, afk, now } → { interval, why }
function readingPace({ base, kills = [], hpPct = null, target = null, partyLow = false, afk = false, now = Date.now() }) {
  const recentKill = kills.some((t) => now - t < 2 * 60000);
  if (recentKill || (hpPct != null && hpPct < 95) || target?.kind === 'monster' || target?.kind === 'player' || partyLow) return { interval: base, why: 'busy' };
  if (afk && !kills.some((t) => now - t < 10 * 60000)) return { interval: Math.max(base, 10), why: 'quiet' };
  return { interval: Math.max(base, Math.min(5, base * 2)), why: 'normal' };
}

// ---- effect icons on screen (the game's own *_mini.bmp pictures): readable names, and how long each was on you
const EFFECTS = [
  [/^deburp_stun/i, 'Stunned', 'debuff'], [/^deburp_fear/i, 'Fear', 'debuff'], [/^deburp_ice/i, 'Frozen', 'debuff'], [/^deburp_nomove/i, "Can't move", 'debuff'],
  [/^deburp_forcemove/i, 'Pushed away', 'debuff'], [/^poison/i, 'Poisoned', 'debuff'], [/^deburp_green/i, 'Poisoned', 'debuff'], [/^deburp_dan_bleeding/i, 'Bleeding', 'debuff'],
  [/^deburp_dan_confusion/i, 'Confused', 'debuff'], [/^deburp_dan_decrease_defense/i, 'Defense down', 'debuff'], [/^deburp_hp_decrese/i, 'Losing HP', 'debuff'],
  [/^deburp_mp_decrese/i, 'Losing MP', 'debuff'], [/^potion_decrese/i, 'Potions weaker', 'debuff'], [/^deburp_aging/i, 'Aging', 'debuff'], [/^deburp_musician/i, 'Busker curse', 'debuff'],
  [/^deburp_(red|white|yellow)/i, 'Weakened', 'debuff'], [/^migo_debuff/i, 'Migo curse', 'debuff'], [/^buff_defense_increase/i, 'Defense up', 'buff'], [/^buff_mobattack/i, 'Attack up (monsters)', 'buff'],
  [/^force_war_2nd_[js]flag/i, 'War flag', 'buff'],
];
function effectInfo(file, itemName = () => null) {
  const base = String(file).replace(/_mini(_m)?$/i, '');
  const e = EFFECTS.find(([re]) => re.test(base));
  if (e) return { id: base.toLowerCase(), label: e[1], kind: e[2] };
  if (/^\d+$/.test(base)) return { id: base, label: itemName(+base) || `Item effect ${base}`, kind: 'buff' }; // an item's effect: its icon is named after the item
  return { id: base.toLowerCase(), label: base.replace(/_/g, ' '), kind: 'buff' };
}
// effects: "file@x,y;…" per look → { started: [...], ended: [{ ..., ms }], active: [{ id, label, kind, since }] }
// buffs: "set:id@x,y;…" (item / skill icons in the buff column), named by buffName("set:id")
class EffectWatch {
  constructor(itemName, buffName = () => null) { this.itemName = itemName; this.buffName = buffName; this.active = new Map(); }
  frame(f) {
    const now = f.t, seen = new Set(), started = [], ended = [];
    const found = [
      ...String(f.effects || '').split(';').filter(Boolean).map((p) => effectInfo(p.split('@')[0], this.itemName)),
      ...String(f.buffs || '').split(';').filter(Boolean).map((p) => { const key = p.split('@')[0]; return { id: `icon:${key}`, label: this.buffName(key) || 'Buff', kind: 'buff' }; }),
    ];
    for (const info of found) {
      seen.add(info.id);
      const a = this.active.get(info.id);
      if (a) { a.last = now; a.missed = 0; } else { const x = { ...info, since: now, last: now, missed: 0 }; this.active.set(info.id, x); started.push(x); }
    }
    // gone for two looks in a row: ended (one missed look is a moment the icon was covered or blinking)
    for (const [id, a] of this.active) if (!seen.has(id) && ++a.missed >= 2) { this.active.delete(id); ended.push({ ...a, ms: a.last - a.since }); }
    return { started, ended, active: [...this.active.values()].map(({ id, label, kind, since }) => ({ id, label, kind, since })) };
  }
}

// ---- the minimap's player dots: "dx,dy;…" from the centre → count, by direction, and a sudden crowd
const DIRS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];
// dots: other players (red); party: party members (orange); me: "x,y,angle" of your arrow (angle: where you face)
function minimapView(dots, party = '', me = '') {
  const parse = (str) => String(str || '').split(';').filter(Boolean).map((p) => p.split(',').map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite));
  const pts = parse(dots), mates = parse(party);
  const by = {};
  for (const [dx, dy] of pts) { const d = DIRS[(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8]; by[d] = (by[d] || 0) + 1; }
  const top = Object.entries(by).sort((a, b) => b[1] - a[1])[0];
  const m = String(me || '').split(',').map(Number);
  return { count: pts.length, near: pts.filter(([dx, dy]) => Math.hypot(dx, dy) <= 25).length, by, mostly: top ? top[0] : null, dots: pts, party: mates,
    facing: m.length === 3 && Number.isFinite(m[2]) ? m[2] : null };
}
class MinimapWatch {
  constructor() { this.hist = []; this.alertAt = -Infinity; }
  // → an alert when at least `surge` more dots show up within a minute (only asked for while you're AFK)
  frame(f, { surge, watching }) {
    const v = minimapView(f.minimap, f.minimapParty, f.minimapMe);
    this.hist.push({ t: f.t, n: v.count });
    while (this.hist.length && f.t - this.hist[0].t > 60000) this.hist.shift();
    const low = Math.min(...this.hist.map((h) => h.n));
    let alert = null;
    if (watching && surge > 0 && v.count - low >= surge && f.t - this.alertAt > 5 * 60000) {
      this.alertAt = f.t;
      alert = { kind: 'danger', title: `${v.count - low} more players on your minimap`, body: `${v.count} around you now${v.mostly ? `, mostly ${v.mostly}` : ''}` };
    }
    return { view: v, alert };
  }
}

module.exports = { effectInfo, EffectWatch, minimapView, MinimapWatch, similar, colorDist, isPink, chatMessages, ChatLog, chatAlert, AwayWatch, PartyWatch, priceHit, ScreenSession, dealOf, traderProfile, Timeline, levelForecast,
  priceHistory, marketMovers, chatWordHit, readingPace };
