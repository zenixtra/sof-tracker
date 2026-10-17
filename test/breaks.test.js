'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { BreakWatch } = require('../lib/breaks');

const M = 60000, B = 1.7e12; // real clock times (0 would read as "never")
const cfg = { everyMin: 120, pauseMin: 10, repeatMin: 30 };

test('a reminder after 2 hours of play in a row, then every 30 minutes', () => {
  const b = new BreakWatch({ read: () => null, save: () => {} });
  const hits = [];
  for (let t = 0; t <= 181 * M; t += M) { const r = b.tick(B + t, { running: true, lastActiveAt: B + t }, cfg); if (r) hits.push(Math.round(t / M)); }
  assert.deepStrictEqual(hits, [120, 150, 180]);
});

test('10 minutes AFK or with the game closed is a break: the count starts again', () => {
  const b = new BreakWatch({ read: () => null, save: () => {} });
  let t = 0;
  for (; t <= 100 * M; t += M) b.tick(B + t, { running: true, lastActiveAt: B + t }, cfg);
  // standing still for 12 minutes (the game open)
  const idleFrom = t - M;
  for (; t <= 112 * M; t += M) assert.strictEqual(b.tick(B + t, { running: true, lastActiveAt: B + idleFrom }, cfg), null);
  assert.strictEqual(b.view(B + t), null);
  for (; t <= 200 * M; t += M) assert.strictEqual(b.tick(B + t, { running: true, lastActiveAt: B + t }, cfg), null); // 87 min since the break
  // a short stop (game closed 5 minutes) is not a break
  const b2 = new BreakWatch({ read: () => null, save: () => {} });
  let hit = null;
  for (let s = 0; s <= 130 * M; s += M) {
    const closed = s > 60 * M && s < 65 * M;
    const r = b2.tick(B + s, { running: !closed, lastActiveAt: closed ? null : B + s }, cfg);
    if (r && hit == null) hit = s / M;
  }
  assert.strictEqual(hit, 120);
});

test('no reminder while you are away from the keyboard', () => {
  const b = new BreakWatch({ read: () => null, save: () => {} });
  let t = 0;
  for (; t <= 119 * M; t += M) b.tick(B + t, { running: true, lastActiveAt: B + t }, cfg);
  // idle for 2 minutes at the 2-hour mark: nothing
  assert.strictEqual(b.tick(B + 121 * M, { running: true, lastActiveAt: B + 119 * M }, cfg), null);
  assert.ok(b.tick(B + 122 * M, { running: true, lastActiveAt: B + 122 * M }, cfg));
});
