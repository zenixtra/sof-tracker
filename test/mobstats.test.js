'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { MobStats } = require('../lib/mobstats');

test('monster stats: EXP per kill and per hour, time per kill, damage, before / after a gear change', () => {
  const s = new MobStats({ read: () => null, save: () => {} });
  const S = 1000;
  // Zombie Cats: target, then a kill every 5 s (before the gear change), then every 4 s
  let t = 0;
  s.target('Ana', 15391, t);
  for (let i = 0; i < 9; i++) { t += 5 * S; s.kill('Ana', 15391, 125120, t); }
  const gearAt = t + S;
  for (let i = 0; i < 11; i++) { t += 4 * S; s.kill('Ana', 15391, 125120, t); }
  const v = s.view('Ana', new Map([[15391, { name: 'Zombie Cat', level: 125, hp: 46970 }]]), gearAt)[0];
  assert.deepStrictEqual([v.name, v.kills, v.expPerKill], ['Zombie Cat', 20, 125120]);
  assert.strictEqual(v.secPerKill, 4); // the middle of the kill times
  assert.strictEqual(v.dps, Math.round(46970 / 4));
  assert.deepStrictEqual(v.gear, { before: 5, after: 4 });
  // fighting time: the gaps between kills, 8 × 5 s + 11 × 4 s = 84 s for 20 kills → EXP per hour (needs a minute+)
  assert.strictEqual(v.expPerHour, Math.round((20 * 125120) / (84 / 3600)));
});

test('a kill of a monster you did not have targeted: counted, but no kill time', () => {
  const s = new MobStats({ read: () => null, save: () => {} });
  s.target('Ana', 1, 0);
  s.kill('Ana', 2, 500, 3000);
  const v = s.view('Ana', new Map(), null)[0];
  assert.deepStrictEqual([v.id, v.kills, v.secPerKill], [2, 1, null]);
});
