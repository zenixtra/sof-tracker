// Goals, records and analysis over what the tracker already keeps: the daily EXP goal and its streak, personal
// records, rivals' levels next to yours, "I have N hours" farming suggestions, what kills you, and your house's activity.
'use strict';

// ---- EXP gained per day, from the screen reader totals of each session (a session counts on the day it started)
function expByDay(sessions, dayOf) {
  const out = {};
  for (const r of sessions) if (r.screen?.exp > 0) { const d = dayOf(r.startedAt); out[d] = (out[d] || 0) + r.screen.exp; }
  return out;
}

// ---- the daily EXP goal: today's progress and the streak of days in a row that reached it (today counts once reached)
function goalProgress({ sessions, goal, now = Date.now(), dayOf }) {
  const by = expByDay(sessions, dayOf), today = dayOf(now), got = by[today] || 0;
  let streak = 0;
  for (let t = now - (got >= goal ? 0 : 86400000); ; t -= 86400000) { if ((by[dayOf(t)] || 0) >= goal && goal > 0) streak++; else break; }
  const best = Math.max(0, ...Object.values(by));
  return { goal, today: Math.round(got * 100) / 100, pct: goal > 0 ? Math.min(100, Math.round((got / goal) * 100)) : null, reached: goal > 0 && got >= goal, streak, best: Math.round(best * 100) / 100 };
}

// ---- personal records: { id: { v, t, text } }. values: { id: { v, text } } for what was just measured;
// returns the records that were beaten (higher is better for all of them)
const RECORDS = {
  expHour: 'Most EXP in an hour',
  sessionExp: 'Most EXP in one session',
  sessionKills: 'Most kills in one session',
  cleanSession: 'Longest session without dying',
  rareDrop: 'Rarest drop for you or your party',
};
function beatRecords(records, values, t = Date.now()) {
  const beaten = [];
  for (const [id, x] of Object.entries(values)) {
    if (!RECORDS[id] || x == null || !(x.v > 0)) continue;
    const old = records[id];
    if (old && x.v <= old.v) continue;
    records[id] = { v: x.v, t, text: x.text || null };
    if (old) beaten.push({ id, label: RECORDS[id], v: x.v, was: old.v, text: x.text || null }); // the first value is no "record broken"
  }
  return beaten;
}

// ---- rivals: level over time for you and the players you picked, from the ranking snapshots
//   history(name) → { points: [{ t, level }] }
function rivalView(names, history, { days = 30, now = Date.now() } = {}) {
  return names.map((name) => {
    const pts = history(name).points.filter((p) => p.level && now - p.t <= days * 86400000);
    const first = pts[0], last = pts[pts.length - 1], week = pts.find((p) => now - p.t <= 7 * 86400000);
    return { name, level: last?.level ?? null, gained: first && last ? last.level - first.level : 0, week: week && last ? last.level - week.level : 0, points: pts.map((p) => [p.t, p.level]) };
  });
}

// ---- "I have N hours": your own best spots (EXP per hour measured there), what that many hours would bring,
// and the leveling plan's suggestions when you have no farming data yet
function planSession({ hours, spots, exp = null }) {
  const best = spots.filter((s) => s.minutes >= 5).slice(0, 3).map((s) => ({ ...s, expected: Math.round(s.expPerHour * hours * 10) / 10 }));
  return { hours, spots: best, levelUp: exp != null && best[0] ? best[0].expected >= 100 - exp : null };
}

// ---- what kills you: by zone, hour of day, alone or with a party, which players were around, which monster targeted
function deathAnalysis(deaths, { zoneName = (z) => String(z) } = {}) {
  const count = (arr) => { const m = new Map(); for (const k of arr) if (k != null && k !== '') m.set(k, (m.get(k) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
  const hours = Array(24).fill(0);
  for (const d of deaths) hours[new Date(d.t).getHours()]++;
  const withParty = deaths.filter((d) => d.party > 0).length, known = deaths.filter((d) => d.party != null).length;
  return {
    total: deaths.length,
    zones: count(deaths.map((d) => d.zone)).slice(0, 8).map(([zone, n]) => ({ zone, name: zoneName(zone), n })),
    hours,
    worstHour: deaths.length ? hours.indexOf(Math.max(...hours)) : null,
    alone: known ? known - withParty : null, inParty: known ? withParty : null,
    players: count(deaths.flatMap((d) => d.near || [])).slice(0, 8).map(([name, n]) => ({ name, n })),
    monsters: count(deaths.map((d) => d.target)).slice(0, 8).map(([name, n]) => ({ name, n })),
  };
}

// ---- your house: per member the days they were seen (met near you or writing in the chat) and their level gain
//   members: [{ name, level }], seen: [{ name, t }], levelGain(name) → number | null
function houseActivity({ members, seen, levelGain = () => null, days = 14, now = Date.now(), dayOf }) {
  const dayList = Array.from({ length: days }, (_, i) => dayOf(now - (days - 1 - i) * 86400000));
  const by = new Map(members.map((m) => [m.name.toLowerCase(), new Set()]));
  const last = new Map();
  for (const s of seen) {
    const k = String(s.name).toLowerCase();
    if (!by.has(k) || now - s.t > days * 86400000) continue;
    by.get(k).add(dayOf(s.t));
    if (!last.has(k) || s.t > last.get(k)) last.set(k, s.t);
  }
  return {
    days: dayList,
    members: members.map((m) => {
      const k = m.name.toLowerCase(), set = by.get(k);
      return { name: m.name, level: m.level ?? null, seenDays: dayList.map((d) => set.has(d)), daysSeen: set.size, lastSeen: last.get(k) || null, gain: levelGain(m.name) };
    }).sort((a, b) => b.daysSeen - a.daysSeen || (b.lastSeen || 0) - (a.lastSeen || 0)),
  };
}

module.exports = { expByDay, goalProgress, RECORDS, beatRecords, rivalView, planSession, deathAnalysis, houseActivity };
