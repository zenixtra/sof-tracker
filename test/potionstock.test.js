'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { PotionStock } = require('../lib/potionstock');

const M = 60000, T = 1.7e12;
const pill = (count) => [{ id: 1000000970, name: 'Healing Anchorite Heaing Pill', slot: 'F3', count }];

test('counts are believed once read twice; use per hour of play, time left, an alert below the limit', () => {
  const p = new PotionStock({ read: () => null, save: () => {} });
  assert.deepStrictEqual(p.update('Ana', T, pill(120), 50), []);
  assert.strictEqual(p.view('Ana').length, 0); // one reading: not yet
  p.update('Ana', T + 3000, pill(120), 50);
  assert.strictEqual(p.view('Ana')[0].count, 120);
  // a misread jump up (180) seen once is ignored
  p.update('Ana', T + 6000, pill(180), 50);
  assert.strictEqual(p.view('Ana')[0].count, 120);
  // use one a minute for 71 minutes: alert once when it drops below 50
  const alerts = [];
  for (let i = 1; i <= 71; i++) alerts.push(...p.update('Ana', T + i * M, pill(120 - i), 50));
  assert.deepStrictEqual(alerts.map((a) => a.count), [49]);
  const v = p.view('Ana', T + 71 * M)[0];
  assert.deepStrictEqual([v.count, v.batch.used, v.perHour], [49, 71, 60]);
  assert.strictEqual(Math.round(v.leftMs / M), 49); // 49 left at 60 an hour
});

test('a restock starts a new batch and remembers how long the last one lasted; time away does not count', () => {
  const p = new PotionStock({ read: () => null, save: () => {} });
  p.update('Ana', T, pill(100)); p.update('Ana', T + 1000, pill(100));
  for (let i = 1; i <= 30; i++) p.update('Ana', T + i * M, pill(100 - i));       // 30 used in 30 minutes
  for (let i = 31; i <= 60; i++) p.update('Ana', T + 120 * M + i * M, pill(100 - i)); // after 2 hours away: 30 more in 30 minutes
  // bought 300: read twice
  p.update('Ana', T + 200 * M, pill(340)); p.update('Ana', T + 200 * M + 3000, pill(340));
  const v = p.view('Ana', T + 201 * M)[0];
  assert.strictEqual(v.count, 340);
  assert.deepStrictEqual(v.last[0], { used: 60, playMs: 59 * M - 1000, from: 100, end: T + 180 * M, perHour: 61 }); // (the gap of 2 hours left out; counted from the second reading)
});
