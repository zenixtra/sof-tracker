// Who travels together, and when players are usually around.
//  - Groups: players who arrive near you within a minute of each other, again and again. Arrivals right after you
//    change maps (everyone "arrives" at once) and big crowds (towns) are left out.
//  - Schedules: when a player is usually active, from the times you met them and from the public rankings
//    (a level / honor change between two snapshots means they played in that half hour).
'use strict';

const WINDOW = 60000;      // arrivals this close together count as "together"
const MAX_CLUSTER = 8;     // bigger crowds are towns / events, not a group

// one arrival cluster per entry: { t, zone, names: [...] }  (recorded live by the tracker)
function clustersFromSessions(sessions) {
  const out = [];
  for (const r of Object.values(sessions)) {
    const ps = Object.entries(r.players || {}).filter(([, p]) => p.firstSeen);
    // coarse stamps shared by many players come from reading a log afterwards: not real arrival times
    const per = {}; for (const [, p] of ps) per[p.firstSeen] = (per[p.firstSeen] || 0) + 1;
    const real = ps.filter(([, p]) => per[p.firstSeen] <= 3 && p.firstSeen > r.startedAt + 30000).sort((a, b) => a[1].firstSeen - b[1].firstSeen);
    let cur = [];
    const flush = () => { if (cur.length >= 2 && cur.length <= MAX_CLUSTER) out.push({ t: cur[0][1].firstSeen, zone: cur[0][1].zone, names: cur.map(([n]) => n), session: r.key }); cur = []; };
    for (const e of real) { if (cur.length && e[1].firstSeen - cur[0][1].firstSeen > WINDOW) flush(); cur.push(e); }
    flush();
  }
  return out;
}

/**
 * Groups of players seen arriving together at least `min` times, where "together" is most of the times you saw them.
 * met: name -> number of sessions you met them in (for the "usually together" ratio).
 */
function findGroups(clusters, met = {}, { min = 3, ratio = 0.5 } = {}) {
  const pairs = new Map();
  const key = (a, b) => (a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`);
  for (const c of clusters) {
    const names = [...new Set(c.names)];
    for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
      const k = key(names[i], names[j]);
      const p = pairs.get(k) || { a: names[i], b: names[j], n: 0, last: 0, zones: {} };
      p.n++; p.last = Math.max(p.last, c.t); if (c.zone != null) p.zones[c.zone] = (p.zones[c.zone] || 0) + 1;
      pairs.set(k, p);
    }
  }
  // strong ties: often together, and together most of the times you met either of them
  const strong = [...pairs.values()].filter((p) => p.n >= min && p.n / Math.max(1, Math.min(met[p.a] || p.n, met[p.b] || p.n)) >= ratio);
  // groups = connected sets of strong ties
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) x = parent.get(x); return x; };
  for (const p of strong) for (const n of [p.a, p.b]) if (!parent.has(n)) parent.set(n, n);
  for (const p of strong) parent.set(find(p.a), find(p.b));
  const groups = new Map();
  for (const p of strong) {
    const g = groups.get(find(p.a)) || { members: new Set(), together: 0, last: 0, zones: {} };
    g.members.add(p.a); g.members.add(p.b); g.together = Math.max(g.together, p.n); g.last = Math.max(g.last, p.last);
    for (const [z, n] of Object.entries(p.zones)) g.zones[z] = (g.zones[z] || 0) + n;
    groups.set(find(p.a), g);
  }
  return [...groups.values()].map((g) => ({ members: [...g.members].sort(), together: g.together, last: g.last, zones: g.zones }))
    .sort((a, b) => b.members.length - a.members.length || b.together - a.together);
}

// weekday (Mon = 0) and hour of a time, in the PC's time zone or another one
function weekHour(t, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return [{ Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[p.weekday], +p.hour % 24];
}

/**
 * When is a player usually around? seen: [{ t, zone }] times you met them; rankPoints: [{ t, level, honor }].
 * Returns a weekday x hour grid of observations, the busiest hour ranges, usual zones and how much it rests on.
 */
function playerSchedule({ seen = [], rankPoints = [], tz } = {}) {
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const zones = {};
  for (const s of seen) { const [d, h] = weekHour(s.t, tz); grid[d][h] += 2; if (s.zone != null) zones[s.zone] = (zones[s.zone] || 0) + 1; }
  let changes = 0;
  for (let i = 1; i < rankPoints.length; i++) {
    const a = rankPoints[i - 1], b = rankPoints[i];
    if (b.t - a.t > 3 * 3600000) continue; // a gap in the snapshots says nothing about when
    if ((b.level || 0) !== (a.level || 0) || (b.honor || 0) !== (a.honor || 0)) { const [d, h] = weekHour(b.t, tz); grid[d][h] += 1; changes++; }
  }
  // busiest hours of the day, merged into ranges
  const byHour = Array.from({ length: 24 }, (_, h) => grid.reduce((s, row) => s + row[h], 0));
  const total = byHour.reduce((a, b) => a + b, 0);
  const ranges = [];
  if (total) {
    const top = byHour.map((v, h) => [v, h]).filter(([v]) => v >= Math.max(1, Math.max(...byHour) * 0.5)).map(([, h]) => h).sort((a, b) => a - b);
    for (const h of top) { const last = ranges[ranges.length - 1]; if (last && h === last[1] + 1) last[1] = h; else ranges.push([h, h]); }
  }
  const byDay = grid.map((row) => row.reduce((a, b) => a + b, 0));
  return {
    grid, byHour, byDay, total, observations: { met: seen.length, rankChanges: changes },
    hours: ranges.map(([a, b]) => ({ from: a, to: (b + 1) % 24 })),
    days: byDay.map((v, d) => [v, d]).filter(([v]) => v && v >= Math.max(...byDay) * 0.6).map(([, d]) => d),
    zones: Object.entries(zones).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([zone, n]) => ({ zone, n })),
  };
}

module.exports = { clustersFromSessions, findGroups, playerSchedule, weekHour, WINDOW, MAX_CLUSTER };
