// Timers and calculators built on the Korean guide book (public/krguide.js) and on what the tracker saw itself:
//  - the field-boss schedule from the guide, until the tracker has learned SoF's own from the server notices
//  - enhancing: chance, expected tries and cost from the guide's odds (or your own logged results)
//  - Training Pass / Entry Bracelet countdowns, started when you walk into those zones
//  - how long the buffs the screen reader sees usually last, learned from earlier runs
//  - where to level: your own EXP per hour, the guide's training areas / dungeons and the monster levels
'use strict';

const { weekHour } = require('./social');
const H = 3600000;
const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const range = (s) => { const m = /(\d+)\s*[–-]\s*(\d+)/.exec(String(s)); return m ? [+m[1], +m[2]] : null; };
const plain = (s) => String(s || '').toLowerCase().replace(/\(probably\)/, '').replace(/[^a-z0-9]/g, '');

// ---------------------------------------------------------------- field bosses (guide schedule)
const GUIDE_BOSS_HOURS = [9, 13, 17, 21];
const BOSS_STAY_MS = 2 * H, BOSS_NOTICE_MS = 10 * 60000;

function guideBossNames(guide) {
  const sec = guide.sections.find((s) => s.id === 'bosses');
  return sec ? sec.table.rows.map((r) => r[0].replace(/\s*\(probably\)/, '')) : [];
}

// in server time: the slot that is on now (bosses stay 2 hours) and the next one
function bossSlots(now, tz, hours = GUIDE_BOSS_HOURS) {
  const hour0 = Math.floor(now / H) * H, isSlot = (t) => hours.includes(weekHour(t, tz)[1]);
  let current = null, next = null;
  for (let k = 0; k * H < BOSS_STAY_MS && current == null; k++) if (isSlot(hour0 - k * H) && now - (hour0 - k * H) < BOSS_STAY_MS) current = hour0 - k * H;
  for (let k = 1; k <= 48 && next == null; k++) if (isSlot(hour0 + k * H)) next = hour0 + k * H;
  return { current, next };
}

class GuideBosses {
  constructor({ guide, onEvent }) { this.names = guideBossNames(guide); this.onEvent = onEvent; this.warned = new Set(); }
  // learned: bosses.stats() — a guide boss the tracker has seen spawn twice or more has its own (real) prediction
  view(now, { tz, hours = GUIDE_BOSS_HOURS, learned = [] }) {
    const known = new Set(learned.filter((s) => s.intervals >= 2).map((s) => plain(s.boss)));
    const left = this.names.filter((n) => !known.has(plain(n)));
    const { current, next } = bossSlots(now, tz, hours);
    return { names: left, learned: this.names.filter((n) => known.has(plain(n))), hours, current, currentEnds: current && current + BOSS_STAY_MS, next };
  }
  // heads-up 10 minutes before a slot, once per slot
  tick(now, cfg) {
    if (!cfg.enabled) return;
    const v = this.view(now, cfg);
    if (!v.names.length || !v.next) return;
    const lead = v.next - now;
    if (lead > 0 && lead <= BOSS_NOTICE_MS && !this.warned.has(v.next)) {
      this.warned.add(v.next);
      this.onEvent('boss', `Field bosses in about ${Math.max(1, Math.round(lead / 60000))} min (guide schedule)`,
        `The Korean guide's times, not confirmed for Scions of Fate yet: ${v.names.slice(0, 4).join(', ')}${v.names.length > 4 ? '…' : ''}`);
    }
  }
}

// ---------------------------------------------------------------- enhancing
const CHARMS = { best: 'table', high: 'table2', mid: 'table3' };

// the guide's tiers for one charm: [{ tier, odds: [% for +1 … +10] }]
function enhanceTiers(guide, charm) {
  const sec = guide.sections.find((s) => s.id === 'enhance');
  const tb = sec && sec[CHARMS[charm]];
  return tb ? tb.rows.map((r) => ({ tier: r[0], odds: r.slice(1).map(Number) })) : [];
}

// odds: % per target level (+1 … +10); from / to: current and wanted level. A failure from +3 on is counted as the
// item being lost (the guide: it "can" break), so this is the careful estimate.
function enhancePlan({ odds, from, to, stones = 1, prices = {}, breakFrom = 3 }) {
  from = Math.max(0, Math.min(9, Math.round(from))); to = Math.max(from + 1, Math.min(10, Math.round(to)));
  const steps = [];
  let chance = 1, triesPerItem = 0;
  for (let L = from + 1; L <= to; L++) {
    const p = Math.max(0, Math.min(1, (odds[L - 1] ?? 0) / 100));
    triesPerItem += chance;           // you only get to try +L if all the earlier tries of this item worked
    steps.push({ level: L, p, risky: L >= breakFrom && p < 1, reach: chance * p });
    chance *= p;
  }
  if (!chance) return { from, to, steps, chance: 0, items: null, tries: null, stones: null, cost: null };
  const items = 1 / chance, tries = triesPerItem * items;
  const perTry = stones * (prices.stone || 0) + (prices.charm || 0) + (prices.fee || 0);
  const cost = tries * perTry + (items - 1) * (prices.item || 0);
  return { from, to, steps, chance, items, tries, stones: tries * stones, charms: tries, cost: perTry || prices.item ? cost : null };
}

// your own results: [{ t, level (the + you tried for), charm, ok }] → per charm and level
function enhanceStats(log) {
  const out = {};
  for (const r of log) {
    const e = ((out[r.charm] ||= {})[r.level] ||= { tries: 0, ok: 0 });
    e.tries++; if (r.ok) e.ok++;
  }
  for (const c of Object.values(out)) for (const e of Object.values(c)) e.rate = e.ok / e.tries;
  return out;
}

// the guide's odds with your own rate in place wherever you logged at least `min` tries
function ownOdds(guideOdds, stats, min = 5) {
  return guideOdds.map((p, i) => { const e = stats?.[i + 1]; return e && e.tries >= min ? Math.round(e.rate * 1000) / 10 : p; });
}

// ---------------------------------------------------------------- Training Pass / Entry Bracelet
const PASSES = {
  training: { label: 'Training Pass', zones: [30000, 30100, 30200, 30300], hours: 2 },
  outer: { label: 'Entry Bracelet', zones: [32101, 32102, 32103, 32104, 32105, 32106, 32107, 32108, 32109], hours: 24 },
  // Tiger Valley maze: the inner barrier (Inside Sanctuary Section 14 / 56 / 7Tunnel) — at most 2 hours
  maze: { label: 'Inner barrier', zones: [25301, 25501, 25701], hours: 2 },
};
const passOf = (zone) => Object.keys(PASSES).find((k) => PASSES[k].zones.includes(+zone)) || null;

class PassTimers {
  constructor({ read, save, onEvent }) {
    this.data = read() || {};
    this.save = () => save(this.data); this.onEvent = onEvent;
  }
  // you're in `zone` now: the first time in a pass zone (or after the last pass ran out) starts its countdown
  zone(zone, now, hoursFor = {}) {
    const kind = passOf(zone);
    if (!kind) return null;
    const cur = this.data[kind];
    if (cur && cur.end > now) return null;
    const hours = hoursFor[kind] || PASSES[kind].hours;
    this.data[kind] = { start: now, end: now + hours * H, hours, zone: +zone, warned: [] };
    this.save();
    return this.data[kind];
  }
  // set by hand: minutes left (0 = clear)
  set(kind, minutesLeft, now = Date.now()) {
    if (!PASSES[kind]) throw new Error('unknown pass');
    if (!minutesLeft) delete this.data[kind];
    else this.data[kind] = { start: now, end: now + minutesLeft * 60000, hours: minutesLeft / 60, zone: null, warned: [] };
    this.save();
  }
  tick(now) {
    for (const [kind, p] of Object.entries(this.data)) {
      if (!p || !PASSES[kind]) continue;
      const left = p.end - now;
      for (const m of [10, 1]) {
        if (left > 0 && left <= m * 60000 && !p.warned.includes(m)) {
          p.warned.push(m); this.save();
          this.onEvent('timer', `${PASSES[kind].label} ends in ${m} min`, kind === 'training' ? 'You leave the training area when it runs out.' : kind === 'maze' ? 'You can stay at most 2 hours in the inner barrier.' : 'You leave the dungeon when it runs out.');
        }
      }
      if (left <= -60000) { delete this.data[kind]; this.save(); }
    }
  }
  view(now = Date.now()) {
    return Object.entries(this.data).filter(([k, p]) => p && PASSES[k] && p.end > now - 60000).map(([kind, p]) => ({ kind, label: PASSES[kind].label, start: p.start, end: p.end, hours: p.hours, zone: p.zone }));
  }
}

// ---------------------------------------------------------------- how long buffs usually last
class BuffDurations {
  constructor({ read, save, onEvent }) {
    this.data = read() || {};       // { id: { label, ms: [last samples] } }
    this.save = () => save(this.data); this.onEvent = onEvent;
    this.lastLook = 0; this.watchFrom = 0; this.warned = new Map();
  }
  // every screen-reader look; a gap of 2 minutes or more means we didn't see what happened in between
  look(t) { if (t - this.lastLook > 120000) this.watchFrom = t; this.lastLook = t; }
  // a buff icon went away: keep its run time if we saw it start and saw it the whole time
  ended(e) {
    if (e.kind !== 'buff' || e.ms < 60000 || !(e.since > this.watchFrom)) return;
    const d = (this.data[e.id] ||= { label: e.label, ms: [] });
    d.label = e.label; d.ms.push(Math.round(e.ms)); d.ms = d.ms.slice(-8);
    this.save();
  }
  // usual run time: two or more runs within 10% of each other
  expected(id) {
    const d = this.data[id];
    if (!d || d.ms.length < 2) return null;
    const m = median(d.ms), close = d.ms.filter((x) => Math.abs(x - m) <= m * 0.1);
    return close.length >= 2 ? Math.round(median(close)) : null;
  }
  // active: [{ id, label, kind, since }] → the same with ends (when known); warns once a minute before
  active(list, now, warn = true) {
    return list.map((a) => {
      const ms = a.kind === 'buff' ? this.expected(a.id) : null;
      if (!ms) return a;
      const ends = a.since + ms, left = ends - now;
      if (warn && left > 0 && left <= 60000 && this.warned.get(a.id) !== a.since) {
        this.warned.set(a.id, a.since);
        this.onEvent('buff', `${a.label} ends in about 1 minute`, `It usually lasts ${Math.round(ms / 60000)} min`);
      }
      return { ...a, ends };
    });
  }
  list() { return Object.entries(this.data).map(([id, d]) => ({ id, label: d.label, runs: d.ms.length, usual: this.expected(id) })); }
}

// which Korean grade a SoF luck charm behaves like: your success rate per level with it (log rows with sofCharm),
// compared with each grade's odds for the lowest gear tier; levels where every grade is 100 % say nothing
const SOF_CHARMS = ['Lowest Charm of Luck', 'Low Charm of Luck', 'Medium Charm of Luck', 'Mystic Charm of Luck (5%)', 'Mystic Charm of Luck (10%)', 'Mystic Charm of Luck (15%)', 'No charm'];
function charmGrades(log, guide, min = 5) {
  const grades = Object.fromEntries(Object.keys(CHARMS).map((c) => [c, enhanceTiers(guide, c)[0]?.odds || []]));
  const out = [];
  for (const name of SOF_CHARMS) {
    const rows = log.filter((r) => r.sofCharm === name);
    if (!rows.length) continue;
    const by = {};
    for (const r of rows) { const e = (by[r.level] ||= { tries: 0, ok: 0 }); e.tries++; if (r.ok) e.ok++; }
    const useful = Object.entries(by).filter(([lv]) => Object.values(grades).some((o) => o[lv - 1] < 100));
    const tries = useful.reduce((a, [, e]) => a + e.tries, 0);
    let best = null;
    if (tries >= min) {
      for (const [grade, odds] of Object.entries(grades)) {
        // weighted squared difference between your rate and the grade's, in percentage points
        const err = useful.reduce((a, [lv, e]) => a + e.tries * ((e.ok / e.tries) * 100 - odds[lv - 1]) ** 2, 0) / tries;
        if (!best || err < best.err) best = { grade, err };
      }
    }
    out.push({ charm: name, tries: rows.length, usefulTries: tries, rate: rows.filter((r) => r.ok).length / rows.length, grade: best?.grade || null, off: best ? Math.round(Math.sqrt(best.err)) : null });
  }
  return out;
}

// ---------------------------------------------------------------- enhance results on screen
// The game's own texts (Ybmsg.cfg): "The item enhancement has succeeded." / "…has failed.", "Successfully enhanced." /
// "Failed to enhance.", and the server announcement "It is %s! %s %s enhanced %s's grade up to %d." (OCR may garble a little)
function enhanceResult(line) {
  const s = String(line || '');
  if (/enhanc\w*\s+(has\s+)?succe|success\w*\s+enhanc/i.test(s)) return { ok: true };
  if (/enhanc\w*\s+(has\s+)?fail|fail\w*\s+to\s+enhanc/i.test(s)) return { ok: false };
  return null;
}
function enhanceAnnouncement(line) {
  const m = /([A-Za-z0-9_]{3,16})\s+(.{2,60}?)\s+enhanced\W+(.{0,60}?)grade\s+up\s+to\s+(\d{1,2})/i.exec(String(line || ''));
  return m ? { who: m[1], item: m[2].replace(/^\W+|\W+$/g, '') || m[3].replace(/'s?\W*$/, '').trim(), level: +m[4] } : null;
}

// ---------------------------------------------------------------- potions
// HP / MP each potion gives (Korean guide, SoF names); the packages refill to 100 % from a pool, so their cost per
// point is price / pool
const POTIONS = {
  'Healing Salve (Small)': { hp: 70 }, 'Healing Salve (Medium)': { hp: 160 }, 'Healing Salve (Large)': { hp: 300 }, 'Healing Salve (Special)': { hp: 600 },
  'Healing Salve (Elite)': { hp: 1000 }, '(Y)Healing Salve': { hp: 1700 }, 'Hugh Heaing Pill': { hp: 700 }, 'Healing Anchorite Heaing Pill': { hp: 850 },
  'Healing Salve Package': { hp: 400000, pool: true },
  Ginseng: { mp: 70 }, 'Wild Ginseng': { mp: 160 }, 'Rare Ginseng': { mp: 300 }, 'Aged Rare Ginseng': { mp: 600 }, 'Human Shaped Ginseng': { mp: 1000 },
  'Hugh Aged Rare Ginseng': { mp: 700 }, 'Healing Anchorite  Aged Rare Ginseng': { mp: 850 }, 'Ginseng Package': { mp: 300000, pool: true },
};
// gained: HP (or MP) that came from potions per hour; potion: a POTIONS name; price: what one costs
function potionCost(gainedPerHour, potion, price) {
  const p = POTIONS[potion], amount = p && (p.hp || p.mp);
  if (!amount || !gainedPerHour) return { perHour: 0, cost: 0 };
  const perHour = gainedPerHour / amount;
  return { perHour, cost: price ? perHour * price : null };
}

// ---------------------------------------------------------------- Tiger Valley maze runs
const MAZE_ZONES = [25201, 25202, 25203, 25204, 25205, 25206, 25207, 25208, 25209, 25210, 25301, 25501, 25701];
const isMaze = (z) => MAZE_ZONES.includes(+z);
class MazeRuns {
  constructor({ read, save }) {
    this.data = read() || { runs: [], effects: {} }; // effects: { zone: { label: looks } } — what each part does to you
    this.save = () => save(this.data);
    this.cur = null; this.prevExp = null; this.outSince = null;
  }
  // one screen-reader look: where you are, EXP %, a kill / death, the effects on you now
  frame({ t, zone, exp, kill, died, effects = [] }) {
    const inside = zone != null && isMaze(zone);
    if (inside) {
      this.outSince = null;
      if (!this.cur) this.cur = { start: t, end: t, exp: 0, kills: 0, deaths: 0, zones: [], deepest: 0 };
      const r = this.cur;
      r.end = t;
      if (!r.zones.includes(+zone)) r.zones.push(+zone);
      if ([25301, 25501, 25701].includes(+zone)) r.deepest = Math.max(r.deepest, { 25301: 1, 25501: 2, 25701: 3 }[zone]);
      if (kill) r.kills++;
      if (died) r.deaths++;
      if (exp != null && this.prevExp != null) { let g = exp - this.prevExp; if (g < -50) g += 100; if (g > 0 && g <= 20) r.exp += g; }
      // the formation's debuffs, per part (debuffs only: your own buffs come along everywhere)
      for (const e of effects) if (e.kind === 'debuff') { const z = (this.data.effects[zone] ||= {}); z[e.label] = (z[e.label] || 0) + 1; }
    } else if (this.cur && zone != null) {
      this.outSince ||= t;
      if (t - this.outSince > 120000) this.finish();
    }
    if (exp != null) this.prevExp = exp;
  }
  finish() {
    const r = this.cur; this.cur = null;
    if (r && r.end - r.start >= 60000) { this.data.runs.push(r); this.data.runs = this.data.runs.slice(-100); }
    this.save();
  }
  view(zoneName = (z) => String(z)) {
    const run = (r) => r && ({ ...r, minutes: Math.round((r.end - r.start) / 60000), expPerHour: r.end > r.start ? r.exp / ((r.end - r.start) / 3600000) : 0, zoneNames: r.zones.map(zoneName) });
    const parts = Object.entries(this.data.effects).map(([zone, m]) => ({ zone: +zone, name: zoneName(zone), effects: Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([label, n]) => ({ label, looks: n })) }))
      .sort((a, b) => a.zone - b.zone);
    return { current: run(this.cur), runs: this.data.runs.slice(-20).reverse().map(run), parts };
  }
}

// ---------------------------------------------------------------- the next 24 hours in one list
// sources: { now, tz, bossHours, guideBossNames, learnedBosses: [{boss, next}], checklist: [{text, nextReset, done, every}],
//            events: [{name, start, end}], maintenance: [{start, end, title}], passes: [{label, end}], playHours: [24 weights] }
function dayPlan(src) {
  const { now } = src, until = now + 24 * H, out = [];
  const add = (t, kind, title, sub = '') => { if (t >= now - 5 * 60000 && t <= until) out.push({ t, kind, title, sub }); };
  if (src.guideBossNames?.length) {
    for (let k = 0; k <= 24; k++) {
      const t = Math.floor(now / H) * H + k * H;
      if ((src.bossHours || GUIDE_BOSS_HOURS).includes(weekHour(t, src.tz)[1])) add(t, 'boss', 'Field bosses (Korean guide times)', src.guideBossNames.slice(0, 3).join(', ') + (src.guideBossNames.length > 3 ? '…' : ''));
    }
  }
  for (const b of src.learnedBosses || []) if (b.next) add(b.next, 'boss', b.boss, 'learned from the server notices');
  for (const c of src.checklist || []) if (c.nextReset) add(c.nextReset, 'checklist', c.text, c.every === 'hours' ? 'due again' : c.done ? 'resets' : 'resets — not done yet');
  for (const e of src.events || []) { add(e.start, 'event', e.name, 'starts'); add(e.end, 'event', e.name, 'ends'); }
  for (const m of src.maintenance || []) { add(m.start, 'maintenance', 'Maintenance', m.title || ''); if (m.end) add(m.end, 'maintenance', 'Maintenance over', m.title || ''); }
  for (const p of src.passes || []) add(p.end, 'pass', `${p.label} runs out`, '');
  for (const x of src.extra || []) add(x.t, x.kind, x.title, x.sub || ''); // your own events…
  out.sort((a, b) => a.t - b.t);
  // when you usually play (share of your play time per hour of the day), for shading the timeline
  const hours = Array.isArray(src.playHours) && src.playHours.some((x) => x > 0) ? src.playHours : null;
  return { from: now, until, items: out.slice(0, 60), playHours: hours };
}

// ---------------------------------------------------------------- places the guide talks about
// NPCs the Korean guide sends you to, with their SoF names (found in the game's NPC positions)
const GUIDE_PLACES = [
  { npc: 'Gate of Training', label: 'Gate of Training', note: 'Training areas: enter with an active Training Pass (2 hours).', kind: 'npc' },
  { npc: 'Master WooHun', label: 'Master WooHun (dungeons)', note: 'Outer martial world dungeons: enter with an Entry Bracelet.', kind: 'npc' },
  { npc: 'Boatman Heo', label: 'Boatman Heo', note: 'Boat to the Tiger Valley dock (the way to the maze).', kind: 'npc', zone: 101 },
  { npc: 'Crescent Fairy', label: 'Crescent Fairy (ASC 1 quest)', note: 'Probably the Moon Palace maiden of the guide: the ASC 1 quest.', kind: 'npc' },
  { npc: 'The Eight Trigrams Old Man', label: 'The Eight Trigrams Old Man', note: 'Makes the maze barrier charm (Safe-Zone); resets crafting jobs (Central Valley).', kind: 'npc' },
  { npc: 'Fame Manager Kwan', label: 'Fame Manager Kwan', note: 'Probably the Honor shop / titles.', kind: 'npc' },
];
// npcSpots: [{ zone, npc, x, z, name }]; npcs: [{ id, name }] → map markers
function guidePlaces(npcSpots, npcs) {
  const out = [];
  for (const g of GUIDE_PLACES) {
    const ids = new Set(npcs.filter((n) => n.name === g.npc).map((n) => n.id));
    for (const s of npcSpots) if ((ids.has(s.npc) || s.name === g.npc) && (!g.zone || s.zone === g.zone)) out.push({ id: `guide:${g.npc}:${s.zone}:${Math.round(s.x)}`, zone: String(s.zone), x: s.x, z: s.z, label: g.label, kind: g.kind, note: g.note, owner: 'Korean guide', npc: s.npc });
  }
  return out;
}

// ---------------------------------------------------------------- where to level
// level: yours; guide: KR_GUIDE; zones: { id: name }; spots: farming.best() rows; mobZones: [{ zone, levels: [..] }]
// (spots older than 30 days are left out: you were probably a lot lower then)
function levelPlaces({ level, guide, zones, spots = [], mobZones = [], now = 0 }) {
  const zoneId = (name) => Object.keys(zones).find((id) => plain(zones[id]) === plain(name)) || null;
  const out = [];
  // the guide's training areas and dungeons
  for (const [secId, kind, nameCol, levelCol] of [['training', 'Training area', 2, 1], ['outer', 'Dungeon', 0, 2]]) {
    const sec = guide.sections.find((s) => s.id === secId);
    for (const r of sec?.table.rows || []) {
      const rg = range(r[levelCol]);
      if (!rg || level < rg[0] - 2 || level > rg[1]) continue;
      const id = zoneId(r[nameCol]);
      out.push({ kind, name: id ? zones[id] : r[nameCol], zone: id ? +id : null, levels: rg, note: secId === 'training' ? 'Training Pass, 2 h, no drops' : 'Entry Bracelet, no drops', fit: 1 - Math.abs(level - (rg[0] + rg[1]) / 2) / (rg[1] - rg[0] + 1) });
    }
  }
  // normal fields: how many kinds of monsters around your level (−3 … +5) live there
  for (const z of mobZones) {
    const fit = z.levels.filter((l) => l >= level - 3 && l <= level + 5);
    if (fit.length < 2 || passOf(z.zone)) continue;
    out.push({ kind: 'Field', name: zones[z.zone] || `Zone ${z.zone}`, zone: +z.zone, levels: [Math.min(...fit), Math.max(...fit)], note: `${fit.length} monster kinds for you`, fit: Math.min(1, fit.length / 8) * 0.9 });
  }
  // what you measured yourself beats everything
  const byZone = {};
  for (const s of spots.filter((x) => !now || now - x.last < 30 * 86400000)) { const b = (byZone[s.zone] ||= { expPerHour: 0, minutes: 0 }); b.expPerHour = Math.max(b.expPerHour, s.expPerHour); b.minutes += s.minutes; }
  for (const p of out) if (p.zone != null && byZone[p.zone]) Object.assign(p, { expPerHour: byZone[p.zone].expPerHour, minutes: byZone[p.zone].minutes });
  for (const [zone, b] of Object.entries(byZone)) if (!out.some((p) => String(p.zone) === zone)) out.push({ kind: 'Your spot', name: zones[zone] || `Zone ${zone}`, zone: +zone, levels: null, note: 'where you farmed before', fit: 0, ...b });
  return out.sort((a, b) => (b.expPerHour || 0) - (a.expPerHour || 0) || b.fit - a.fit).slice(0, 14);
}

module.exports = { GUIDE_BOSS_HOURS, bossSlots, guideBossNames, GuideBosses, enhanceTiers, enhancePlan, enhanceStats, ownOdds, PASSES, passOf, PassTimers, BuffDurations, levelPlaces,
  enhanceResult, enhanceAnnouncement, SOF_CHARMS, charmGrades, GUIDE_PLACES, guidePlaces, POTIONS, potionCost, MAZE_ZONES, isMaze, MazeRuns, dayPlan };
