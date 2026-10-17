'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { clustersFromSessions, findGroups, playerSchedule } = require('../lib/social');

const H = 3600000, T0 = Date.UTC(2026, 9, 12, 18, 0); // a Monday, 18:00 UTC

test('players who keep arriving together form a group; towns and one-offs do not', () => {
  const clusters = [];
  for (let i = 0; i < 4; i++) clusters.push({ t: T0 + i * H, zone: 2101, names: ['Ali', 'Veli', 'Can'] });
  clusters.push({ t: T0, zone: 101, names: ['Ali', 'Stranger'] });               // once together: no tie
  const g = findGroups(clusters, { Ali: 5, Veli: 4, Can: 4, Stranger: 1 });
  assert.strictEqual(g.length, 1);
  assert.deepStrictEqual(g[0].members, ['Ali', 'Can', 'Veli']);
  assert.strictEqual(g[0].together, 4);
  assert.strictEqual(g[0].zones[2101], 12);
});

test('pairs that are rarely together compared with how often you meet them are left out', () => {
  const clusters = [1, 2, 3].map((i) => ({ t: T0 + i * H, zone: 1, names: ['A', 'B'] }));
  assert.strictEqual(findGroups(clusters, { A: 30, B: 30 }).length, 0); // 3 of 30 times
  assert.strictEqual(findGroups(clusters, { A: 4, B: 3 }).length, 1);
});

test('session arrival times: shared log-read stamps and the first 30 s are ignored', () => {
  const players = { X: { firstSeen: T0 + 100000, zone: 1 }, Y: { firstSeen: T0 + 130000, zone: 1 }, Z: { firstSeen: T0 + 500000, zone: 1 } };
  for (const n of ['a', 'b', 'c', 'd']) players[n] = { firstSeen: T0 + 200000, zone: 1 }; // 4 on one stamp
  players.early = { firstSeen: T0 + 1000, zone: 1 };
  const c = clustersFromSessions({ s: { key: 's', startedAt: T0, players } });
  assert.deepStrictEqual(c.map((x) => x.names), [['X', 'Y']]);
});

test('schedule: busiest hours and days, zones, rank changes count', () => {
  const seen = [0, 7, 14].map((d) => ({ t: T0 + d * 24 * H + 2 * H, zone: 2101 })); // Mondays 20:00 UTC
  const rankPoints = [{ t: T0 + 2 * H, level: 50 }, { t: T0 + 2.5 * H, level: 51 }, { t: T0 + 30 * H, level: 52 }]; // last after a gap: ignored
  const s = playerSchedule({ seen, rankPoints, tz: 'UTC' });
  assert.deepStrictEqual(s.hours, [{ from: 20, to: 21 }]);
  assert.deepStrictEqual(s.days, [0]);
  assert.deepStrictEqual(s.zones, [{ zone: '2101', n: 3 }]);
  assert.deepStrictEqual(s.observations, { met: 3, rankChanges: 1 });
});
