'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { messages, parsePrices, parseTrades, buildIndex, priceStats } = require('../lib/market');
const { Farming } = require('../lib/farming');

const ITEMS = [{ id: 1, name: 'Hard Iron Crystal' }, { id: 2, name: 'Special Sky Crystal' }, { id: 3, name: 'Spear of the Cruel Sky(8th)' }];
const index = buildIndex(ITEMS);

test('chat lines are joined into messages, announcements left out', () => {
  const m = messages(['MrNohoMaster: B>speciai sky crystal 150m send pack', 'age to me', 'Announcements: something happened', 'NhatNhat: B>Hard Iron Crystal 20m']);
  assert.deepStrictEqual(m.map((x) => x.who), ['MrNohoMaster', 'NhatNhat']);
  assert.strictEqual(m[0].text, 'B>speciai sky crystal 150m send pack age to me');
});

test('two chat lines run together by the OCR are split again', () => {
  const m = messages(["Oley: B DD 5B send me ty 'Wdll: Buy MSC 2 IB send me ty", '• wobulin: B> ANY COS =8B send me ty']);
  assert.deepStrictEqual(m.map((x) => x.who), ['Oley', 'Wdll', 'wobulin']);
  assert.strictEqual(m[0].text, 'B DD 5B send me ty');
});

test('prices with k / m / kk / b', () => {
  assert.deepStrictEqual(parsePrices('20m').map((p) => p.value), [20e6]);
  assert.deepStrictEqual(parsePrices('MSC = 18b, KNAP = 3,8b').map((p) => p.value), [18e9, 3.8e9]);
  assert.deepStrictEqual(parsePrices('500kk or 750k').map((p) => p.value), [500e6, 750e3]);
});

test('trade offers: side, item (also misread), one price', () => {
  const t = parseTrades(['NhatNhat: B>Hard Iron Crystal 20m', 'MrNohoMaster: WTS speciai sky crystal 150m', 'Someone: hello there', 'JumpingNote: BUY MSC = 18b, KNAP = 3.8b'], index);
  assert.strictEqual(t.length, 3);
  assert.deepStrictEqual([t[0].side, t[0].itemId, t[0].price], ['buy', 1, 20e6]);
  assert.deepStrictEqual([t[1].side, t[1].itemId, t[1].price], ['sell', 2, 150e6]);
  assert.strictEqual(t[2].itemId, null); // abbreviations: kept as text only
  assert.strictEqual(t[2].price, null);  // two prices: not one item price
});

test('usual prices are medians per side', () => {
  const now = Date.now();
  const s = priceStats([10, 20, 30].map((p, i) => ({ t: now - i, itemId: 1, item: 'X', side: 'sell', price: p * 1e6 })).concat([{ t: now, itemId: 1, item: 'X', side: 'buy', price: 15e6 }, { t: now - 40 * 86400000, itemId: 1, item: 'X', side: 'buy', price: 1 }]));
  assert.deepStrictEqual(s[0], { itemId: 1, item: 'X', sell: 20e6, buy: 15e6, offers: 4, last: now });
});

test('farming: kills from EXP gains, level-ups, deaths, best spots', () => {
  const f = new Farming();
  const at = (i, exp, hp = 100) => f.frame({ t: i * 30000, exp, hp, hpMax: 100, zone: 101, x: 900, z: 900 });
  [10, 10.5, 11, 11.5, 12].forEach((e, i) => at(i, e));
  at(5, 99.8); at(6, 0.3);                    // a big jump is a misread; then a level-up (0.5 gained)
  const ev = at(7, 0.3, 0);                   // died
  assert.ok(ev.died);
  assert.strictEqual(f.data.kills, 5);
  const best = f.best(0);
  assert.strictEqual(best[0].zone, 101);
  assert.ok(Math.abs(best[0].expPerHour - 2.5 / (150000 / 3600000)) < 0.01);
  assert.strictEqual(f.data.deaths.length, 1);
});
