// Derived statistics: character comparison, play-time patterns, milestones.
'use strict';

const DAY = 86400000;
const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// ---- your characters side by side (from tracked sessions)
function characters(sessions, playerInfo, zoneName) {
  const by = {};
  for (const r of Object.values(sessions)) {
    if (!r.character) continue; // a login that never reached character select
    const name = r.character;
    const c = (by[name] ||= { name, account: r.account, sessions: 0, ms: 0, activeMs: 0, afkMs: 0, distance: 0, players: new Set(), zones: {}, first: r.startedAt, last: r.endedAt });
    c.sessions++; c.ms += Math.max(0, r.endedAt - r.startedAt); c.activeMs += r.activeMs || 0; c.afkMs += r.afkMs || 0; c.distance += r.distance || 0;
    for (const n of Object.keys(r.players || {})) c.players.add(n);
    for (const [z, ms] of Object.entries(r.zones || {})) c.zones[z] = (c.zones[z] || 0) + ms;
    c.first = Math.min(c.first, r.startedAt); c.last = Math.max(c.last, r.endedAt);
    c.account ||= r.account;
  }
  return Object.values(by).map((c) => {
    const top = Object.entries(c.zones).sort((a, b) => b[1] - a[1])[0];
    return { ...c, players: c.players.size, topZone: top ? zoneName(top[0]) : null, info: playerInfo(c.name), zones: undefined };
  }).sort((a, b) => b.last - a.last);
}

// ---- when you play: weekday x hour grid, streaks, session lengths (from login spans)
function patterns(spans) {
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0)); // [weekday Mon=0][hour] = ms
  const days = new Set();
  let total = 0;
  for (const s of spans) {
    let t = s.from;
    while (t < s.to) {
      const d = new Date(t);
      const nextHour = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime();
      const until = Math.min(nextHour, s.to);
      grid[(d.getDay() + 6) % 7][d.getHours()] += until - t;
      days.add(dayKey(t));
      total += until - t;
      t = until;
    }
  }
  const sorted = [...days].sort();
  let longest = 0, run = 0, prev = null;
  for (const k of sorted) {
    const t = new Date(k + 'T12:00:00').getTime();
    run = prev !== null && Math.round((t - prev) / DAY) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run); prev = t;
  }
  // current streak counts back from today (or yesterday, if you haven't played yet today)
  let current = 0;
  for (let t = Date.now(); ; t -= DAY) {
    if (days.has(dayKey(t))) current++;
    else if (current || dayKey(t) !== dayKey(Date.now())) break;
  }
  const lengths = spans.map((s) => s.to - s.from).sort((a, b) => a - b);
  const hourTotals = Array(24).fill(0);
  grid.forEach((row) => row.forEach((ms, h) => { hourTotals[h] += ms; }));
  const dayTotals = grid.map((row) => row.reduce((a, b) => a + b, 0));
  return {
    grid, total, daysPlayed: days.size, longestStreak: longest, currentStreak: current,
    sessions: spans.length, avgSession: lengths.length ? total / lengths.length : 0,
    medianSession: lengths.length ? lengths[Math.floor(lengths.length / 2)] : 0, longestSession: lengths[lengths.length - 1] || 0,
    favouriteHour: hourTotals.indexOf(Math.max(...hourTotals)), favouriteDay: dayTotals.indexOf(Math.max(...dayTotals)),
  };
}

// ---- milestones: each has a test over a context and, where possible, the moment it was reached
const MILESTONES = [
  ...[50, 100, 250, 500, 1000].map((n) => ({ id: `met-${n}`, group: 'Social', icon: '👥', title: `Met ${n} players`, test: (c) => c.playersMet >= n, at: (c) => c.metAt[n - 1] })),
  ...[10, 50, 100, 250, 500].map((n) => ({ id: `hours-${n}`, group: 'Play time', icon: '⏳', title: `${n} hours played`, test: (c) => c.totalMs >= n * 3600000 })),
  ...[10, 50, 100].map((n) => ({ id: `sessions-${n}`, group: 'Play time', icon: '🎮', title: `${n} tracked sessions`, test: (c) => c.sessionCount >= n })),
  ...[3, 7, 30].map((n) => ({ id: `streak-${n}`, group: 'Play time', icon: '🔥', title: `${n}-day play streak`, test: (c) => c.longestStreak >= n })),
  ...[3, 6, 11].map((n) => ({ id: `zones-${n}`, group: 'Explorer', icon: '🗺', title: n === 11 ? 'Visited every mapped zone' : `Visited ${n} zones`, test: (c) => c.zonesVisited >= n })),
  ...[10000, 100000, 1000000].map((n) => ({ id: `dist-${n}`, group: 'Explorer', icon: '🥾', title: `Walked ${n.toLocaleString('en-US')} distance`, test: (c) => c.distance >= n })),
  { id: 'marker-1', group: 'Explorer', icon: '📍', title: 'Placed your first map marker', test: (c) => c.markers >= 1 },
  { id: 'marker-10', group: 'Explorer', icon: '📍', title: 'Placed 10 map markers', test: (c) => c.markers >= 10 },
  { id: 'danger-1', group: 'Survival', icon: '⚠', title: 'Survived a danger alert', test: (c) => c.dangers >= 1 },
  { id: 'danger-10', group: 'Survival', icon: '🛡', title: 'Survived 10 danger alerts', test: (c) => c.dangers >= 10 },
  { id: 'watch-5', group: 'Social', icon: '★', title: 'Watching 5 players', test: (c) => c.watched >= 5 },
  { id: 'marathon', group: 'Play time', icon: '🏃', title: 'A 4-hour session', test: (c) => c.longestSessionMs >= 4 * 3600000 },
  { id: 'focused', group: 'Play time', icon: '🎯', title: '2+ hours at 90% active', test: (c) => c.focused },
  { id: 'night-owl', group: 'Play time', icon: '🦉', title: 'Night owl: playing at 3 AM', test: (c) => c.nightOwl },
  { id: 'early-bird', group: 'Play time', icon: '🐦', title: 'Early bird: playing at 6 AM', test: (c) => c.earlyBird },
  { id: 'trader-10', group: 'Trade', icon: '💰', title: 'Logged 10 trades or drops', test: (c) => c.trades >= 10 },
  { id: 'boss-5', group: 'Bosses', icon: '🐉', title: 'Saw 5 boss spawns announced', test: (c) => c.bossSpawns >= 5 },
];

function milestoneContext({ sessions, spans, alerts, waypoints, watchlist, trades, bossSpawns, knownZones }) {
  const firstSeen = {};
  for (const r of Object.values(sessions)) for (const [n, p] of Object.entries(r.players || {})) {
    const t = p.firstSeen || r.startedAt;
    if (!firstSeen[n] || t < firstSeen[n]) firstSeen[n] = t;
  }
  const metAt = Object.values(firstSeen).sort((a, b) => a - b);
  const zones = new Set();
  let distance = 0, longestSessionMs = 0, focused = false;
  for (const r of Object.values(sessions)) {
    for (const z of Object.keys(r.zones || {})) if (knownZones.includes(String(z))) zones.add(z);
    distance += r.distance || 0;
    longestSessionMs = Math.max(longestSessionMs, r.endedAt - r.startedAt);
    const tr = (r.activeMs || 0) + (r.afkMs || 0);
    if (r.activeMs >= 2 * 3600000 && tr && r.activeMs / tr >= 0.9) focused = true;
  }
  const hourHit = (h) => spans.some((s) => {
    for (let t = s.from; t < s.to; t += 15 * 60000) if (new Date(t).getHours() === h) return true;
    return false;
  });
  const p = patterns(spans);
  return {
    playersMet: metAt.length, metAt, totalMs: p.total, sessionCount: Object.keys(sessions).length, longestStreak: p.longestStreak,
    zonesVisited: zones.size, distance, markers: waypoints.length, dangers: alerts.filter((a) => a.kind === 'danger').length,
    watched: watchlist.length, longestSessionMs, focused, nightOwl: hourHit(3), earlyBird: hourHit(6), trades: trades.length, bossSpawns,
  };
}

module.exports = { characters, patterns, MILESTONES, milestoneContext };
