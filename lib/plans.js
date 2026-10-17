// Planning helpers:
//  - your own recurring events (arena times, house wars…) with reminders
//  - boss sign-ups shared through friends sync ("I'm coming to the 17:00 boss")
//  - Honor progress against the Korean guide's Honor ranks
//  - what the next Ascension needs and how close you are
//  - the best weekday / time of day to buy or sell an item, from the chat's offers
//  - daily counters (potions, enhance results, maze runs) for the weekly report and the digest
'use strict';

const { weekHour } = require('./social');
const H = 3600000, DAY = 86400000;
const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ---------------------------------------------------------------- your own recurring events
// ev: { days: [0..6] (Mon = 0; empty = every day), hour, minute } in server time → the next start at or after `from`
function nextOccurrence(ev, from, tz) {
  const days = ev.days?.length ? ev.days : [0, 1, 2, 3, 4, 5, 6];
  const hour0 = Math.floor(from / H) * H;
  for (let k = -1; k <= 24 * 8; k++) {
    const t = hour0 + k * H, [d, h] = weekHour(t, tz);
    if (h === ev.hour && days.includes(d) && t + ev.minute * 60000 >= from) return t + ev.minute * 60000;
  }
  return null;
}
// PvP and war times from the Korean guide book, as presets: one preset adds all its times (Korean server times)
const WEEKDAYS5 = [0, 1, 2, 3, 4];
const EVENT_PRESETS = [
  { name: 'Extreme duel stage', note: '1-on-1, level 35+', slots: [{ days: [], hour: 13, minute: 20 }, { days: [0, 2, 4, 6], hour: 21, minute: 10 }] },
  { name: 'Teamwork duel stage', note: '1-on-1 with an NPC ally', slots: [{ days: [], hour: 23, minute: 0 }] },
  { name: 'Soul War', note: 'Blue / Red team PvP, any level', slots: [{ days: WEEKDAYS5, hour: 11, minute: 0 }, { days: WEEKDAYS5, hour: 12, minute: 0 }, { days: [], hour: 15, minute: 20 }, { days: [], hour: 22, minute: 20 }] },
  { name: 'Jindol War', note: 'team PvP, 3rd promotion / level 60+', slots: [{ days: WEEKDAYS5, hour: 14, minute: 0 }, { days: [5], hour: 16, minute: 10 }, { days: [], hour: 18, minute: 0 },
    { days: [], hour: 19, minute: 0 }, { days: [], hour: 20, minute: 10 }, { days: [1, 3, 5], hour: 21, minute: 10 }, { days: [], hour: 0, minute: 10 }] },
  { name: 'Martial Blood War', note: 'last one standing; per promotion tier', slots: [{ days: [], hour: 22, minute: 0 }, ...[11, 12, 13, 14, 15].map((hour) => ({ days: [5, 6], hour, minute: 0 }))] },
  { name: 'House war', note: 'Blood Battle Hall, house rank 4+; sign up 10 min before', slots: [{ days: [], hour: 19, minute: 0 }, { days: [], hour: 22, minute: 20 }] },
];
function cleanEvent(b, old = {}) {
  const num = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const name = String(b.name ?? old.name ?? '').trim().slice(0, 60);
  if (!name) throw new Error('Give the event a name');
  const days = (Array.isArray(b.days) ? b.days : old.days || []).map(Number).filter((d) => d >= 0 && d <= 6);
  return { id: old.id || newId(), name, days: [...new Set(days)].sort(), hour: num(b.hour ?? old.hour, 0, 23, 20), minute: num(b.minute ?? old.minute, 0, 59, 0), remind: num(b.remind ?? old.remind, 0, 240, 10) };
}
class CustomEvents {
  constructor({ read, save, tz, onEvent }) {
    this.list = read() || []; this.tz = tz; this.onEvent = onEvent;
    this.save = () => save(this.list); this.fired = new Set();
  }
  change(b) {
    if (b.action === 'add') this.list.push(cleanEvent(b));
    else if (b.action === 'preset') {
      const p = EVENT_PRESETS[+b.index]; if (!p) throw new Error('unknown preset');
      for (const s of p.slots) if (!this.list.some((e) => e.name === p.name && e.hour === s.hour && e.minute === s.minute && String(e.days) === String(s.days))) this.list.push(cleanEvent({ name: p.name, ...s, remind: 10 }));
    }
    else if (b.action === 'delete') this.list = this.list.filter((e) => e.id !== b.id);
    else throw new Error('bad action');
    this.save();
    return this.view();
  }
  view(now = Date.now()) { return this.list.map((e) => ({ ...e, next: nextOccurrence(e, now - 60000, this.tz) })).sort((a, b) => (a.next ?? Infinity) - (b.next ?? Infinity)); }
  // a reminder `remind` minutes before, and one at the start
  tick(now = Date.now()) {
    for (const e of this.view(now)) {
      if (!e.next) continue;
      const left = e.next - now;
      if (e.remind && left > 0 && left <= e.remind * 60000 && !this.fired.has(`${e.id}|${e.next}|r`)) {
        this.fired.add(`${e.id}|${e.next}|r`);
        this.onEvent('event', `${e.name} in ${Math.max(1, Math.round(left / 60000))} min`, 'your own event');
      }
      if (left <= 0 && left > -60000 && !this.fired.has(`${e.id}|${e.next}|s`)) { this.fired.add(`${e.id}|${e.next}|s`); this.onEvent('event', `${e.name} now`, 'your own event'); }
    }
  }
}

// ---------------------------------------------------------------- boss sign-ups
// mine: [{ t, label }]; friends: [{ t, label, from }] → who is coming to a slot (within 20 minutes, same label)
const sameSlot = (a, b) => Math.abs(a.t - b.t) < 20 * 60000 && String(a.label).toLowerCase() === String(b.label).toLowerCase();
function coming(slot, mine, friends, me = 'you') {
  const who = [];
  if (mine.some((m) => sameSlot(m, slot))) who.push(me);
  for (const f of friends) if (sameSlot(f, slot) && !who.includes(f.from)) who.push(f.from);
  return who;
}
function toggleSignup(list, slot, on, now = Date.now()) {
  const keep = list.filter((m) => m.t > now - 3 * H && !sameSlot(m, slot));
  if (on) keep.push({ t: Math.round(slot.t), label: String(slot.label).slice(0, 60) });
  return keep.slice(-50);
}

// ---------------------------------------------------------------- Honor (Korean guide: 무훈)
const HONOR_RANKS = [
  { rank: 1, from: 0, bonus: 'no bonus' }, { rank: 2, from: 1001, bonus: '+5 attack and defence' }, { rank: 3, from: 15001, bonus: '+10 attack and defence' },
  { rank: 4, from: 50001, bonus: '+20 attack and defence, +250 HP and MP' }, { rank: 5, from: 100001, bonus: '+30 attack and defence, +500 HP and MP' },
  { rank: 6, from: 600000, bonus: '+70 attack and defence, +750 HP and MP, all abilities +1' }, { rank: 7, from: 1200000, bonus: '+180 attack and defence, +1,300 HP, +1,200 MP, all abilities +2' },
  { rank: 8, from: 1500000, bonus: '+280 attack and defence, +1,800 HP, +1,400 MP, +20 % PvP power (and 50,000 spent in 30 days)' },
  { rank: 9, from: 5000000, bonus: '+400 attack and defence, +2,400 HP, +2,100 MP, +20 % PvP power (and 150,000 spent in 30 days)' },
];
// honor: now; points: [{ t, honor }] from the rankings → rank, next rank, pace over the last 7 days, when you get there
function honorProgress(honor, points = [], now = Date.now()) {
  if (honor == null) return null;
  const cur = HONOR_RANKS.filter((r) => honor >= r.from).pop(), next = HONOR_RANKS.find((r) => r.from > honor) || null;
  const pts = points.filter((p) => p.honor != null).sort((a, b) => a.t - b.t);
  const since = pts.filter((p) => p.t >= now - 7 * DAY)[0] || pts[0];
  const last = pts[pts.length - 1];
  const days = since && last && last.t - since.t >= DAY / 2 ? (last.t - since.t) / DAY : null;
  const perDay = days ? Math.max(0, (last.honor - since.honor) / days) : null;
  const toGo = next ? next.from - honor : 0;
  return {
    honor, rank: cur.rank, bonus: cur.bonus, next: next && { rank: next.rank, from: next.from, bonus: next.bonus, toGo, pct: Math.round(((honor - cur.from) / (next.from - cur.from)) * 100) },
    perDay: perDay != null ? Math.round(perDay) : null, etaDays: next && perDay > 0 ? Math.ceil(toGo / Math.min(perDay, 1000)) : null, // at most 1,000 a day
    history: pts.slice(-60).map(({ t, honor: h }) => [t, h]),
  };
}

// ---------------------------------------------------------------- Ascension
const ASC_REQS = [
  { asc: 1, level: 110, needs: '5th promotion', gold: 1e8, ki: 5e6, stones: 0, quest: 'Get the quest from the Moon Palace maiden in the Southern Forest and bring her the secret book of the corrupted Moon Palace maiden (a monster at one of five spots in the Southern Forest; only the first to hit it gets the book).' },
  { asc: 2, level: 120, needs: 'ASC 1', gold: 2e8, ki: 5e6, stones: 50, quest: '"The role of the Sky Stones": bring 50 Sky Stones to the Moon Palace maiden.' },
  { asc: 3, level: 130, needs: 'ASC 2', gold: 3e8, ki: 5e6, stones: 50, quest: 'A chain of quests from the Moon Palace maiden (crystals of evil, herbs, Sky Stones).' },
  { asc: 4, level: 140, needs: 'ASC 3', gold: 5e8, ki: 5e6, stones: 50, quest: 'Four quests from different masters (tokens, 900 upper soul crystals, 1 b gold among others).' },
  { asc: 5, level: 150, needs: 'ASC 4', gold: 1e9, ki: 5e6, stones: 100, quest: '"Hero\'s qualifications": 25 fame items, then 100 Sky Stones and 700 upper soul crystals.' },
  { asc: 6, level: 160, needs: 'ASC 5', gold: 5e9, ki: 1e9, stones: 0, quest: 'Meet the masters: a token of victory (ASC 6).' },
  { asc: 7, level: 170, needs: 'ASC 6', gold: 5e9, ki: 1.5e9, stones: 0, quest: 'Several quests: tokens of victory, 5 b gold and 1.5 b Ki.' },
];
// level / exp now; asc: your Ascension (0 = none); have: { gold, ki, stones }; expPerHour: EXP % per hour of play
function ascProgress({ level, exp = 0, asc = 0, have = {}, expPerHour = null }) {
  const next = ASC_REQS.find((r) => r.asc === asc + 1);
  if (!next) return { asc, done: true };
  const part = (need, got) => (need ? { need, have: got || 0, pct: Math.min(100, Math.round(((got || 0) / need) * 100)) } : null);
  const levels = level ? Math.max(0, next.level - level) : null;
  const hours = levels && expPerHour > 0 ? (levels * 100 - (exp || 0)) / expPerHour : levels === 0 ? 0 : null;
  return { asc, next: { ...next }, level: { need: next.level, have: level || null, toGo: levels, hours: hours != null ? Math.round(hours) : null },
    gold: part(next.gold, have.gold), ki: part(next.ki, have.ki), stones: part(next.stones, have.stones),
    ready: levels === 0 && [next.gold, next.ki, next.stones].every((n, i) => !n || (have[['gold', 'ki', 'stones'][i]] || 0) >= n) };
}

// ---------------------------------------------------------------- when to buy / sell
const BLOCKS = ['00–04', '04–08', '08–12', '12–16', '16–20', '20–24'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// offers: [{ t, side, price }] of one item → per weekday and 4-hour block (your time): median price and count
function priceTimes(offers, now = Date.now(), days = 90) {
  const recent = offers.filter((o) => o.price > 0 && now - o.t < days * DAY);
  const cell = (side, key) => { const l = recent.filter((o) => o.side === side && key(o)); return { price: median(l.map((o) => o.price)), n: l.length }; };
  const dayOf = (t) => (new Date(t).getDay() + 6) % 7, blockOf = (t) => Math.floor(new Date(t).getHours() / 4);
  const make = (side) => ({
    days: WEEKDAYS.map((d, i) => ({ day: d, ...cell(side, (o) => dayOf(o.t) === i) })),
    blocks: BLOCKS.map((b, i) => ({ block: b, ...cell(side, (o) => blockOf(o.t) === i) })),
  });
  const sell = make('sell'), buy = make('buy');
  const pick = (list, hi) => { const l = list.filter((x) => x.n >= 2 && x.price); return l.length >= 2 ? l.sort((a, b) => (hi ? b.price - a.price : a.price - b.price))[0] : null; };
  // to buy: when sellers ask the least; to sell: when buyers pay the most (or sellers ask the most, if there are few buyers)
  const buyAt = { day: pick(sell.days, false), block: pick(sell.blocks, false) };
  const sellAt = { day: pick(buy.days, true) || pick(sell.days, true), block: pick(buy.blocks, true) || pick(sell.blocks, true) };
  return { offers: recent.length, sell, buy, buyAt, sellAt };
}

// ---------------------------------------------------------------- party finder
// "LF healer 120+ SF", "LFM tv 125-135", "need busker for maze" → { wants, classes, levels, zone }
const TRADE_RE = /\b(wts|wtb|wtt|selling|buying|sell|buy|price)\b/i; // a trade post, not a party
const LFG_RE = /\b(lf\d?m|lfg|lfp|lf\s*(?:party|pt|group|grp)|lf\s+(?:\d\s+)?(?:healers?|heal|doc|buskers?|buff(?:er)?|tank|dps|blades?|swords?|spears?|bows?|archers?|ninjas?|fist|fighters?|members?|more|ppl)|looking\s+for\s+(?:a\s+)?(?:party|pt|group|members?|healer|heal)|need(?:s|ing)?\s+(?:a\s+|\d\s+)?(?:healer|heal|doc|busker|buff(?:er)?|tank|dps|members?|ppl|people|party)|recruit\w*|pt\s+for|party\s+for|join\s+(?:my|our)\s+(?:party|pt))\b/i;
const CLASS_WORDS = [['Healer', /\b(healers?|heal|doc|medic)\b/i], ['Busker', /\b(buskers?|bard|music)\b/i], ['Blade', /\bblades?\b/i], ['Sword', /\bswords?\b/i], ['Spear', /\bspears?\b/i],
  ['Bow', /\b(bows?|archers?)\b/i], ['Ninja', /\bninjas?\b/i], ['Fist', /\b(fist|fighters?)\b/i], ['Hanbi', /\bhanbi\w*\b/i], ['HwaLin', /\bhwa\s?lin\b/i], ['Maeyujin', /\bmaeyujin\b/i], ['Noho', /\bnoho\b/i], ['Migo', /\bmigo\b/i]];
const ZONE_ABBR = { sf: 'Southern Forest', tv: 'Tiger Valley', cv: 'Central Valley', gp: 'Garden Plain', nip: 'Northern Ice Palace', ns: 'Northern Ice Palace', maze: 'Nine Treasure Labyrinth Part1', pb: 'Pirate Bay' };
// zones: [{ id, name }]
function lfgParse(text, zones = []) {
  const s = String(text || '');
  if (!LFG_RE.test(s) || TRADE_RE.test(s)) return null;
  const classes = CLASS_WORDS.filter(([, re]) => re.test(s)).map(([c]) => c);
  let levels = null;
  const rg = /\b(\d{2,3})\s*[-~]\s*(\d{2,3})\b/.exec(s), plus = /\b(\d{2,3})\s*\+/.exec(s), lv = /\blv\.?l?\s*(\d{2,3})\b/i.exec(s);
  if (rg && +rg[1] <= +rg[2] && +rg[2] <= 200) levels = [+rg[1], +rg[2]];
  else if (plus && +plus[1] <= 200) levels = [+plus[1], 200];
  else if (lv && +lv[1] <= 200) levels = [+lv[1] - 10, +lv[1] + 10];
  const low = s.toLowerCase();
  let zone = zones.filter((z) => z.name && z.name.length >= 5 && low.includes(z.name.toLowerCase())).sort((a, b) => b.name.length - a.name.length)[0] || null;
  if (!zone) { const ab = Object.keys(ZONE_ABBR).find((k) => new RegExp(`\\b${k}\\b`, 'i').test(s)); if (ab) zone = zones.find((z) => z.name === ZONE_ABBR[ab]) || { id: null, name: ZONE_ABBR[ab] }; }
  return { classes, levels, zone: zone ? { id: zone.id ?? null, name: zone.name } : null };
}
// does a post fit you? (no level / class in it = anyone)
function lfgFits(p, me = {}) {
  const lvOk = !p.levels || !me.level || (me.level >= p.levels[0] && me.level <= p.levels[1]);
  const clsOk = !p.classes.length || !me.cls || p.classes.some((c) => c.toLowerCase() === String(me.cls).toLowerCase());
  return lvOk && clsOk;
}

// ---------------------------------------------------------------- goals with pace
// goal: { kind: level | honor | gold | custom, target, by, start: { t, value } }; value: where you are now
function goalPace(goal, value, now = Date.now()) {
  const start = goal.start || { t: now, value };
  const span = Math.max(1, goal.by - start.t), done = value != null && value >= goal.target;
  const expected = start.value + (goal.target - start.value) * Math.min(1, Math.max(0, (now - start.t) / span));
  const left = Math.max(0, goal.by - now), daysLeft = left / DAY;
  const perDayNeeded = value != null && !done && daysLeft > 0 ? (goal.target - value) / daysLeft : null;
  const pct = value != null && goal.target !== start.value ? Math.max(0, Math.min(100, Math.round(((value - start.value) / (goal.target - start.value)) * 100))) : done ? 100 : 0;
  // (a hair of slack, so a goal set a moment ago doesn't count as behind)
  const slack = Math.abs(goal.target - start.value) * 0.001 + 1e-9;
  return { done, pct, expected: Math.round(expected * 100) / 100, onPace: done || (value != null && value + slack >= expected), overdue: !done && now > goal.by, daysLeft: Math.round(daysLeft * 10) / 10, perDayNeeded };
}

// ---------------------------------------------------------------- daily counters
class DailyStats {
  constructor({ read, save, dayOf }) { this.data = read() || {}; this.save = () => save(this.data); this.dayOf = dayOf; this.dirty = false; }
  // totals per day, and per character under d.c[name] when a character is given
  add(t, fields, char = null) {
    const d = (this.data[this.dayOf(t)] ||= {}), c = char ? ((d.c ||= {})[String(char).toLowerCase()] ||= {}) : null;
    for (const [k, v] of Object.entries(fields)) if (v) { d[k] = Math.round(((d[k] || 0) + v) * 100) / 100; if (c) c[k] = Math.round(((c[k] || 0) + v) * 100) / 100; }
    this.dirty = true;
  }
  flush() {
    if (!this.dirty) return;
    const keys = Object.keys(this.data).sort(); for (const k of keys.slice(0, Math.max(0, keys.length - 400))) delete this.data[k];
    this.save(); this.dirty = false;
  }
  // summed over [from, to): everything, or one character's
  range(from, to, char = null) {
    const out = {};
    for (let t = from; t < to; t += DAY) {
      const d = this.data[this.dayOf(t)] || {}, src = char ? d.c?.[String(char).toLowerCase()] || {} : d;
      for (const [k, v] of Object.entries(src)) if (typeof v === 'number') out[k] = Math.round(((out[k] || 0) + v) * 100) / 100;
    }
    return out;
  }
}

module.exports = { lfgParse, lfgFits, goalPace, nextOccurrence, EVENT_PRESETS, CustomEvents, cleanEvent, coming, toggleSignup, HONOR_RANKS, honorProgress, ASC_REQS, ascProgress, priceTimes, WEEKDAYS, BLOCKS, DailyStats };
