'use strict';

const test = require('node:test');
const assert = require('node:assert');
const i = require('../lib/inventory');

test('gold and weight from the inventory, as the OCR reads them', () => {
  assert.strictEqual(i.parseGold('1 318.033,090601,'), 1318033090); // "Gold" read as "601"
  assert.strictEqual(i.parseGold('1,318,033,090Gold'), 1318033090);
  assert.strictEqual(i.parseGold('45,000Gold'), 45000);
  assert.strictEqual(i.parseGold(''), null);
  assert.deepStrictEqual(i.parseWeight('9532 / 11993'), { cur: 9532, max: 11993, pct: 79.5 });
  assert.strictEqual(i.parseWeight('Gold'), null);
});

test('inventory watch: gold counts once read the same twice; a bag-weight alert; gold per hour', () => {
  const alerts = [];
  const w = new i.InvWatch({ read: () => null, save: () => {}, onEvent: (...a) => alerts.push(a) });
  const H = 3600000;
  assert.strictEqual(w.frame('Ana', { gold: '1,000,000Gold', weight: '9532 / 11993' }, 0).gold, undefined); // once: not yet
  assert.strictEqual(w.frame('Ana', { gold: '1,000,000Gold' }, 1000).gold, 1000000);
  w.frame('Ana', { gold: '1,500,000Gold' }, H); w.frame('Ana', { gold: '1,500,000Gold' }, H + 1000);
  assert.deepStrictEqual(w.rate('Ana', 0, 2 * H), { change: 500000, perHour: 500000 / ((H) / H) });
  assert.strictEqual(w.between('Ana', 500, 2 * H), 500000);
  w.frame('Ana', { weight: '11000 / 11993' }, 2 * H, { weightAlert: 90 });
  w.frame('Ana', { weight: '11000 / 11993' }, 2 * H + 5000, { weightAlert: 90 });
  assert.deepStrictEqual(alerts.map((a) => a[1]), ['Bag 91.7% full (Ana)']);
});

test('gear kinds, compare, and gear offers in the trade chat', () => {
  assert.deepStrictEqual(['Shoes', 'Weapon', 'Righteous Leader Boots', 'ROBE C100-120 SPEAR'].map(i.gearKind), ['Boots', 'Weapon', 'Boots', 'Robe']);
  const mine = { attack: [793, 823], plus: 7, options: ['a', 'b', 'c', 'd'], element: { name: 'Fire', level: 8, bonus: 2 }, souled: 5, level: 130 };
  const shop = { attack: [700, 720], plus: 3, options: ['a'], element: null, souled: null, level: 130 };
  const c = i.compareGear(mine, shop);
  assert.strictEqual(c.verdict, 'worse');
  assert.strictEqual(c.lines.find((l) => l.what === 'Attack').pct, -12);
  assert.deepStrictEqual(i.parseGearOffer('Ponkotsu: SELL ROBE HBK 110 DEF7+8 7,5B'), { side: 'sell', kind: 'Robe', level: 110, plus: 8, element: null, price: 7.5e9 });
  assert.strictEqual(i.parseGearOffer('Oley: B Artisan 8.5B send me ty'), null);
  const offers = [{ t: 1, side: 'sell', kind: 'Robe', level: 110, plus: 8, price: 7e9 }, { t: 1, side: 'sell', kind: 'Robe', level: 115, plus: 8, price: 8e9 }, { t: 1, side: 'sell', kind: 'Robe', level: 110, plus: 7, price: 3e9 }];
  assert.deepStrictEqual(i.gearPrice(offers, { kind: 'Robe', level: 112, plus: 8 }, 30, 2), { sell: 7.5e9, buy: null, offers: 2 });
});

test('cheapest upgrade: chance of the next +1, ranked by what it is worth', () => {
  const tiers = ['up to 5th promotion', 'ASC 1–2', 'ASC 3', 'ASC 4', 'ASC 5–7'];
  assert.deepStrictEqual(['ASC 3', 'ASC 6', '5th promotion', ''].map((c) => i.tierIndex(c, tiers)), [2, 4, 0, 0]);
  const odds = () => [100, 100, 100, 96, 86, 73.8, 36, 32, 29.6, 27.2];
  const plan = i.upgradePlan([{ key: 'w', name: 'Dagger', plus: 7, cls: 'ASC 3' }, { key: 'b', name: 'Boots', plus: 4, cls: 'ASC 3' }, { key: 'r', name: 'Ring', plus: 10 }], odds,
    (g, plus) => (g.key === 'w' ? { 7: 1e9, 8: 3e9 }[plus] ?? null : null));
  assert.deepStrictEqual(plan.map((u) => [u.key, u.to, u.chance]), [['w', 8, 0.32], ['b', 5, 0.86]]); // the +10 ring is done
  assert.strictEqual(plan[0].expected, 2e9 * 0.32);
});
