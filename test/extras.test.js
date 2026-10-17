'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { goalProgress, beatRecords, rivalView, planSession, deathAnalysis, houseActivity } = require('../lib/extras');

const DAY = 86400000, dayOf = (t) => new Date(t).toISOString().slice(0, 10);
const now = Date.UTC(2026, 9, 14, 18);
const sess = (d, exp) => ({ startedAt: now - d * DAY, screen: { exp } });

test('daily EXP goal: today, the streak, the best day', () => {
  const g = goalProgress({ sessions: [sess(0, 12), sess(0, 9), sess(1, 25), sess(2, 20), sess(3, 5), sess(4, 30)], goal: 20, now, dayOf });
  assert.deepStrictEqual(g, { goal: 20, today: 21, pct: 100, reached: true, streak: 3, best: 30 }); // day 3 (5 %) breaks the streak
  const notYet = goalProgress({ sessions: [sess(0, 5), sess(1, 25)], goal: 20, now, dayOf });
  assert.deepStrictEqual([notYet.pct, notYet.reached, notYet.streak], [25, false, 1]); // yesterday still counts
  assert.strictEqual(goalProgress({ sessions: [], goal: 0, now, dayOf }).pct, null);
});

test('personal records: the first value is kept quietly, beating it is announced', () => {
  const rec = {};
  assert.deepStrictEqual(beatRecords(rec, { sessionKills: { v: 100 } }, 1), []);
  assert.deepStrictEqual(beatRecords(rec, { sessionKills: { v: 90 } }, 2), []);
  assert.deepStrictEqual(beatRecords(rec, { sessionKills: { v: 120 }, unknown: { v: 5 } }, 3), [{ id: 'sessionKills', label: 'Most kills in one session', v: 120, was: 100, text: null }]);
  assert.deepStrictEqual(rec, { sessionKills: { v: 120, t: 3, text: null } });
});

test('rivals: level now, gained this month and this week', () => {
  const hist = { Me: [[20, 95], [6, 96], [1, 97]], Oley: [[25, 100], [5, 101], [0, 103]] };
  const r = rivalView(['Me', 'Oley', 'Nobody'], (n) => ({ points: (hist[n] || []).map(([d, level]) => ({ t: now - d * DAY, level })) }), { now });
  assert.deepStrictEqual(r.map((x) => [x.name, x.level, x.gained, x.week]), [['Me', 97, 2, 1], ['Oley', 103, 3, 2], ['Nobody', null, 0, 0]]);
});

test('"I have 2 hours": your best measured spots and what they bring', () => {
  const spots = [{ zone: 101, expPerHour: 30, minutes: 40 }, { zone: 102, expPerHour: 20, minutes: 3 }, { zone: 103, expPerHour: 10, minutes: 60 }];
  const p = planSession({ hours: 2, spots, exp: 50 });
  assert.deepStrictEqual(p.spots.map((s) => [s.zone, s.expected]), [[101, 60], [103, 20]]); // 3 minutes is too little to trust
  assert.strictEqual(p.levelUp, true);
});

test('death analysis: zones, hours, alone or in a party, who was around', () => {
  const at = (h) => Date.UTC(2026, 9, 1, h) + new Date().getTimezoneOffset() * 60000;
  const a = deathAnalysis([{ t: at(21), zone: 101, near: ['Pk', 'Oley'], party: 0, target: 'Leopard Hunter' }, { t: at(21), zone: 101, near: ['Pk'], party: 2 }, { t: at(9), zone: 102, near: [] }], { zoneName: (z) => `Z${z}` });
  assert.deepStrictEqual(a.zones, [{ zone: 101, name: 'Z101', n: 2 }, { zone: 102, name: 'Z102', n: 1 }]);
  assert.strictEqual(a.worstHour, 21);
  assert.deepStrictEqual([a.alone, a.inParty], [1, 1]);
  assert.deepStrictEqual(a.players[0], { name: 'Pk', n: 2 });
  assert.deepStrictEqual(a.monsters, [{ name: 'Leopard Hunter', n: 1 }]);
});

test('house activity: days seen per member, sorted by how active', () => {
  const h = houseActivity({ members: [{ name: 'Quiet', level: 90 }, { name: 'Busy', level: 100 }], seen: [{ name: 'busy', t: now }, { name: 'Busy', t: now - DAY }, { name: 'Busy', t: now - DAY + 5 }, { name: 'Other', t: now }],
    levelGain: (n) => (n === 'Busy' ? 2 : 0), days: 3, now, dayOf });
  assert.deepStrictEqual(h.members.map((m) => [m.name, m.daysSeen, m.seenDays, m.gain]), [['Busy', 2, [false, true, true], 2], ['Quiet', 0, [false, false, false], 0]]);
});
