// Your quests in progress put to work: how far along the "bring me 10 X" items are (kills where they come from,
// pickups when the chat says so), one trip for all of them, which quests on the "Available Quest" tab are worth it,
// and how much of your EXP comes from handing quests in.
'use strict';

const NEAR = 600;  // a kill this close to where a quest item comes from counts for it
const GIVEN = 150; // an item "found" right next to the quest's NPC is handed to you, not collected

// ---------------------------------------------------------------- what a quest asks you to collect
// quest view (gameviews.questView) → [{ itemId, name, need, mob, zone, x, z, npc… }]: items you collect yourself
function collectItems(q) {
  const out = [];
  for (const s of q.steps || []) for (const it of s.items || []) {
    if (!it.mob && (it.zone == null || it.x == null)) continue;
    if (!it.mob && String(it.zone) === String(s.zone) && s.x != null && Math.hypot(it.x - s.x, it.z - s.z) < GIVEN) continue;
    if (out.some((o) => o.itemId === it.id)) continue;
    out.push({ itemId: it.id, name: it.name, need: it.qty || 1, mob: it.mob || null, mobName: it.mobName || null, zone: it.zone, zoneName: it.zoneName, x: it.x, z: it.z,
      npc: s.npcName, npcZone: s.zone, npcX: s.x, npcZ: s.z });
  }
  return out;
}

// "You have obtained [Wolf Fang] x3", "Acquired Jade Tower bandits Paper." → { name, qty } (never a party announcement)
const PICKUP_RE = /(?:you\s+(?:have\s+)?)?(?:obtained|acquired|received|picked\s+up|looted)\s*[:;]?\s*\[?([A-Za-z][^\]\n]{2,60}?)\]?\s*(?:[x×*]\s*(\d{1,3}))?\s*[.!]?\s*$/i;
// a pickup message you marked ("You got 3 [Wolf Fang]" with item "Wolf Fang") → a pattern: the item's place
// becomes (?<item>), the first number (?<qty>), other numbers any number
function pickupPattern(line, itemText) {
  const s = String(line || '').replace(/\s+/g, ' ').trim(), i = itemText ? s.indexOf(itemText) : -1;
  if (i < 0) throw new Error('mark which part of the line is the item');
  let n = 0;
  const part = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\d+/g, () => (n++ ? '\\d+' : '(?<qty>\\d+)'));
  const before = part(s.slice(0, i)), after = part(s.slice(i + itemText.length));
  const re = `^${before}(?<item>.+?)${after}$`;
  new RegExp(re, 'i'); // throws if broken
  return re;
}
// learned: patterns you taught the tracker ({ re } with (?<item>) and maybe (?<qty>)), tried first
function parsePickup(line, learned = []) {
  const s = String(line || '').replace(/[ \t]+/g, ' ').trim();
  if (/party\s+m\S*mber|announcement/i.test(s)) return null;
  for (const p of learned) {
    try { const m = new RegExp(p.re, 'i').exec(s); if (m?.groups?.item) return { name: m.groups.item.replace(/^\[|\]$/g, '').trim(), qty: m.groups.qty ? +m.groups.qty : 1 }; } catch { /* a broken pattern */ }
  }
  const m = PICKUP_RE.exec(s);
  if (!m) return null;
  const name = m[1].replace(/\s*\(\s*\d+\s*\)\s*$/, '').trim();
  const qty = m[2] ? +m[2] : +((/\((\d{1,3})\)\s*\]?\s*[.!]?\s*$/.exec(s) || [])[1] || 1);
  return name.length >= 3 ? { name, qty } : null;
}

class QuestProgress {
  constructor({ read, save, onEvent }) {
    this.data = read() || { chars: {} }; // chars: { char: { questId: { since, name, items: { itemId: { kills, picked } } } } }
    this.save = () => save(this.data); this.onEvent = onEvent || (() => {});
  }
  _c(char) { return (this.data.chars[String(char || '?').toLowerCase()] ||= {}); }
  // the quests in progress now (views with steps): new ones start counting, gone ones are dropped
  sync(char, views, t) {
    const c = this._c(char), ids = new Set(views.map((v) => String(v.id)));
    let changed = false;
    for (const id of Object.keys(c)) if (!ids.has(id)) { this._learn(c[id]); delete c[id]; changed = true; }
    for (const v of views) {
      if (c[v.id]) continue;
      const items = collectItems(v);
      if (!items.length) continue;
      c[v.id] = { since: t, name: v.name, items: Object.fromEntries(items.map((i) => [i.itemId, { kills: 0, picked: 0, need: i.need, name: i.name }])) };
      changed = true;
    }
    if (changed) this.save();
  }
  // kills per item learned from earlier quests (kept when a quest is finished): itemId → { kills, picked }
  _learn(rec) {
    const rates = (this.data.rates ||= {});
    for (const [id, r] of Object.entries(rec.items || {})) {
      if (!(r.picked > 0) || !(r.kills > 0)) continue;
      const x = (rates[id] ||= { kills: 0, picked: 0 });
      x.kills += r.kills; x.picked += r.picked;
    }
  }
  // how many kills one item takes: this quest's own count once 2+ are in, else what earlier quests taught
  killsPerItem(itemId, r) {
    if (r && r.picked >= 2 && r.kills > 0) return r.kills / r.picked;
    const x = this.data.rates?.[itemId];
    return x && x.picked >= 3 ? x.kills / x.picked : null;
  }
  // a kill: counts for every quest item that comes from this monster, or from where you stand
  kill(char, { zone, x, z, mobId }, views) {
    const c = this._c(char);
    let n = 0;
    for (const v of views) {
      const rec = c[v.id];
      if (!rec) continue;
      for (const it of collectItems(v)) {
        const r = rec.items[it.itemId];
        if (!r || r.picked >= r.need) continue;
        const here = it.mob ? mobId != null && +mobId === +it.mob
          : zone != null && String(zone) === String(it.zone) && x != null && Math.hypot(x - it.x, z - it.z) <= NEAR;
        if (here) { r.kills++; n++; }
      }
    }
    if (n) this.save();
    return n;
  }
  // a pickup the chat (or the box in the middle) reported: matched to the items your quests ask for
  pickup(char, { name, qty = 1 }, views, matchName) {
    const c = this._c(char), done = [];
    let added = 0;
    for (const v of views) {
      const rec = c[v.id];
      if (!rec) continue;
      for (const r of Object.values(rec.items)) {
        if (!matchName(name, r.name) || r.picked >= r.need) continue;
        const before = r.picked;
        r.picked = Math.min(r.need, r.picked + qty); added += r.picked - before;
        if (r.picked >= r.need && Object.values(rec.items).every((x) => x.picked >= x.need)) done.push(v);
      }
    }
    this.save();
    for (const v of done) {
      const hand = collectItems(v)[0];
      this.onEvent('goal', `Quest items complete: ${v.name}`, `${char} · hand it in${hand?.npc ? ` to ${hand.npc}` : ''}`);
    }
    return added; // quest items counted
  }
  // set how many you have by hand (the counter can't see your bag)
  set(char, questId, itemId, picked) {
    const r = this._c(char)[questId]?.items?.[itemId];
    if (!r) return false;
    r.picked = Math.max(0, Math.min(r.need, Math.round(+picked || 0))); this.save();
    return true;
  }
  // per quest: the items with need / picked / kills / where, and (once learned) the kills and minutes still to go
  // killsPerMin: your kill pace right now
  view(char, views, killsPerMin = null) {
    const c = this._c(char);
    return views.map((v) => {
      const rec = c[v.id];
      if (!rec) return null;
      const items = collectItems(v).map((it) => {
        const r = rec.items[it.itemId], picked = r?.picked || 0, kills = r?.kills || 0;
        const per = this.killsPerItem(it.itemId, r), left = Math.max(0, it.need - picked);
        const killsLeft = per != null && left ? Math.ceil(left * per) : null;
        // the game prints no pickup message: how many the kills there probably gave (at the rate learned from your counts)
        const est = per != null && per > 0 ? Math.min(it.need, Math.floor(kills / per)) : null;
        return { ...it, picked, kills, est, killsPerItem: per != null ? Math.round(per * 10) / 10 : null, killsLeft,
          minutesLeft: killsLeft != null && killsPerMin > 0 ? Math.max(1, Math.round(killsLeft / killsPerMin)) : null };
      });
      return { id: v.id, name: v.name, since: rec.since, items, ready: items.every((i) => i.picked >= i.need) };
    }).filter(Boolean);
  }
}

// a quest you can do again: its text says "weekly" / "daily" / "once a day" (raw game quest or a view)
const REPEAT_RE = /\b(weekly|every\s+week|each\s+week|once\s+a\s+week)\b|\b(daily|every\s+day|each\s+day|once\s+a\s+day)\b/i;
function repeatKind(q) {
  const m = REPEAT_RE.exec([q.intro, ...(q.steps || []).map((s) => s.goal)].join(' '));
  if (!m || /rent\s+them\s+daily/i.test(q.intro || '')) return null;
  return m[1] ? 'weekly' : 'daily';
}

// ---------------------------------------------------------------- one trip for all your quests
// the stops: where to collect (unless you have them all), then the NPC to bring them to; a quest without items: its NPC
function questStops(views, progress = []) {
  const stops = [];
  for (const v of views) {
    const prog = progress.find((p) => p.id === v.id);
    const items = collectItems(v);
    if (items.length) {
      const need = items.filter((it) => { const p = prog?.items.find((x) => x.itemId === it.itemId); return !p || p.picked < p.need; });
      need.forEach((it, i) => stops.push({ key: `${v.id}:c${i}`, quest: v.id, questName: v.name, kind: 'collect', label: it.mobName ? `${it.name} (${it.mobName})` : it.name, zone: it.zone, zoneName: it.zoneName, x: it.x, z: it.z }));
      const h = items[0];
      if (h.npcZone != null && h.npcX != null) stops.push({ key: `${v.id}:h`, quest: v.id, questName: v.name, kind: 'handin', label: h.npc, zone: h.npcZone, x: h.npcX, z: h.npcZ, after: need.map((_, i) => `${v.id}:c${i}`) });
    } else {
      const s = [...(v.steps || [])].reverse().find((x) => x.zone != null && x.x != null);
      if (s) stops.push({ key: `${v.id}:t`, quest: v.id, questName: v.name, kind: 'talk', label: s.npcName, zone: s.zone, zoneName: s.zoneName, x: s.x, z: s.z });
    }
  }
  return stops;
}
// nearest stop next (by the route planner's walking distance), a hand-in only after its collecting stops
function orderStops(start, stops, cost) {
  const left = stops.slice(), out = [], done = new Set();
  let here = start, total = 0;
  while (left.length) {
    const ready = left.filter((s) => !(s.after || []).some((k) => !done.has(k)));
    let best = null;
    for (const s of ready) { const c = cost(here, s); if (c != null && (!best || c < best.c)) best = { s, c }; }
    if (!best) { for (const s of ready) out.push({ ...s, cost: null }); break; }
    out.push({ ...best.s, cost: Math.round(best.c) }); total += best.c; done.add(best.s.key);
    left.splice(left.indexOf(best.s), 1);
    here = { zone: best.s.zone, x: best.s.x, z: best.s.z };
  }
  return { stops: out, total: Math.round(total) };
}

// ---------------------------------------------------------------- the "Available Quest" tab, ranked
// quests: { q: questView, exp, followUps }; level: yours. EXP for your level counts most, then item rewards, then a chain
function rankAvailable(list, level, valueOf = () => 0) {
  return list.map((e) => {
    const items = (e.q.rewards || []).filter((r) => !/^exp$/i.test(r.name)).reduce((s, r) => s + (valueOf(r.id) || 0) * (r.qty || 1), 0);
    const gap = level && e.q.level ? level - e.q.level : 0;
    const why = [];
    if (e.exp) why.push('exp');
    if (items) why.push('items');
    if (e.followUps) why.push('chain');
    if (gap > 15) why.push('low');
    // EXP of a quest far under your level is worth less; a chain is worth a bit on its own
    const score = (e.exp || 0) * (gap > 15 ? 0.3 : 1) + items / 1000 + (e.followUps ? 1000 * e.followUps : 0);
    return { ...e.q, exp: e.exp || 0, itemValue: items, followUps: e.followUps || 0, gap, why, score };
  }).sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------- EXP: monsters or quests
// a gain many times a usual kill, while next to an NPC, is a quest handed in
class ExpSplit {
  constructor() { this.gains = []; }
  median() { const a = this.gains.slice().sort((p, q) => p - q); return a.length ? a[a.length >> 1] : null; }
  classify(gain, { nearNpc = false } = {}) {
    if (!(gain > 0)) return null;
    const med = this.median();
    if (nearNpc && gain >= 0.3 && (med == null ? gain >= 1 : gain >= med * 6)) return 'quest';
    if (gain > 20) return null; // a misread
    this.gains.push(gain); if (this.gains.length > 40) this.gains.shift();
    return 'mob';
  }
}

// ---------------------------------------------------------------- quest history
// one row per quest handed in: { char, id, name, level, start, end, exp } (start: first seen in the quest window)
const BAND = 10;
function questHistory(rows, char = null) {
  const mine = rows.filter((r) => !char || String(r.char).toLowerCase() === String(char).toLowerCase());
  const timed = mine.filter((r) => r.start != null && r.end > r.start).map((r) => ({ ...r, minutes: Math.round((r.end - r.start) / 60000) }));
  const bands = new Map();
  for (const r of timed) {
    const b = Math.floor((r.level || 0) / BAND) * BAND, e = bands.get(b) || { from: b, to: b + BAND - 1, n: 0, minutes: 0 };
    e.n++; e.minutes += r.minutes; bands.set(b, e);
  }
  // slow for what they give: least EXP per minute (only quests with EXP and a known time)
  const slow = timed.filter((r) => r.exp > 0 && r.minutes >= 5).map((r) => ({ ...r, expPerMin: Math.round(r.exp / r.minutes) })).sort((a, b) => a.expPerMin - b.expPerMin).slice(0, 5);
  return {
    rows: mine.slice().sort((a, b) => b.end - a.end).map((r) => ({ ...r, minutes: r.start != null && r.end > r.start ? Math.round((r.end - r.start) / 60000) : null })),
    bands: [...bands.values()].sort((a, b) => a.from - b.from).map((e) => ({ ...e, avgMinutes: Math.round(e.minutes / e.n) })),
    slow, done: mine.length,
  };
}

module.exports = { questHistory, pickupPattern, collectItems, parsePickup, QuestProgress, questStops, orderStops, rankAvailable, ExpSplit, repeatKind };
