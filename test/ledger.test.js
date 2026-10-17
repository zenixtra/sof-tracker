'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { pieceScore, gearScore, GearScores, goldLedger, tooltipPrice, priceCheck, NetWorth, marketFlips } = require('../lib/ledger');

const DAGGER = { slot: 'Weapon', name: 'Merciful Dagger (True)', plus: 7, attack: [793, 823], options: ['All abilities +2', 'All abilities +2', 'Attack +64'], souled: 5, level: 130, lastSeen: 2 };
const BOOTS = { slot: 'Boots', name: 'Boots', plus: 3, defense: 60, options: [], level: 120, lastSeen: 1 };

test('gear score: higher + level scores higher; non-gear tooltips count nothing', () => {
  assert.ok(pieceScore({ ...DAGGER, plus: 8 }) > pieceScore(DAGGER));
  assert.strictEqual(pieceScore({ slot: null, name: 'HP Potion' }), 0);
  const s = gearScore([DAGGER, BOOTS, { slot: null, name: 'HP Potion' }, { ...BOOTS, name: 'Old boots', plus: 0, lastSeen: 0 }]);
  assert.deepStrictEqual(s.pieces.map((p) => p.slot), ['Weapon', 'Boots']);
  assert.strictEqual(s.pieces[1].name, 'Boots'); // the latest seen
  assert.strictEqual(s.score, pieceScore(DAGGER) + pieceScore(BOOTS));
});

test('gear score history: a point only when it changes', () => {
  const g = new GearScores({ read: () => null, save: () => {} });
  assert.ok(g.note('Ana', 100, 1)); assert.ok(!g.note('Ana', 100, 2)); assert.ok(g.note('ana', 120, 3));
  assert.deepStrictEqual(g.history('ANA').map((p) => p.score), [100, 120]);
});

test('gold ledger: enhancing, trades, shops, loot', () => {
  const pts = [{ t: 0, gold: 1000000 }, { t: 100000, gold: 900000 }, { t: 200000, gold: 1400000 }, { t: 300000, gold: 1300000 }, { t: 400000, gold: 1350000 }];
  const r = goldLedger(pts, { enhance: [50000], trades: [{ t: 150000, type: 'sell', item: 'Robe', qty: 1, price: 500000 }] });
  assert.deepStrictEqual(r.rows.map((x) => x.cat).reverse(), ['Enhancing', 'Trades', 'Shops & other', 'Loot & sales']);
  assert.deepStrictEqual([r.income, r.spent, r.net], [550000, 200000, 350000]);
  assert.strictEqual(r.cats.Enhancing.out, 100000);
});

test('price check: tooltip price against the chat', () => {
  assert.strictEqual(tooltipPrice(['Level : 40', 'Price : 1,250,000']), 1250000);
  assert.strictEqual(tooltipPrice(['Level : 40']), null);
  const p = priceCheck({ name: 'Robe', chat: { sell: 1000000, offers: 4 }, npcPrice: 5000, shown: 800000 });
  assert.deepStrictEqual(p.verdict, { pct: -20, word: 'cheaper' });
  assert.strictEqual(priceCheck({ name: 'X', chat: {}, shown: 5 }).verdict, null);
});

test('net worth: a point when gold or gear changes, merged within 10 minutes', () => {
  const n = new NetWorth({ read: () => null, save: () => {} });
  const M = 60000;
  assert.ok(n.note('Ana', { gold: 100, gear: 50 }, 0));
  assert.ok(!n.note('Ana', { gold: 100, gear: 50 }, M));
  n.note('Ana', { gold: 120, gear: 50 }, 2 * M);  // merged into the first point
  n.note('Ana', { gold: 150, gear: 60 }, 20 * M); // a new point
  assert.deepStrictEqual(n.history('ana', 90, 30 * M).map((p) => p.gold), [120, 150]);
});

test('market flips: chat buyers over sellers, sellers under the NPC price', () => {
  const stats = [{ itemId: 1, item: 'Gem', sell: 100, buy: 150 }, { itemId: 2, item: 'Herb', sell: 10, buy: null }, { itemId: 3, item: 'Rare', sell: 100, buy: 200 }];
  const counts = new Map([[1, { sell: 3, buy: 2 }], [2, { sell: 4, buy: 0 }], [3, { sell: 1, buy: 1 }]]);
  const f = marketFlips(stats, counts, (id) => (id === 2 ? 25 : 0));
  assert.deepStrictEqual(f.map((x) => [x.item, x.kind, x.margin]), [['Herb', 'npc', 15], ['Gem', 'chat', 50]].sort((a, b) => b[2] - a[2]));
});

test('gold ledger: a gold change right around a completed trade is a trade, logged or not', () => {
  const pts = [{ t: 0, gold: 1000 }, { t: 100000, gold: 600 }, { t: 200000, gold: 500 }];
  const r = goldLedger(pts, { exchanges: [90000] });
  assert.deepStrictEqual(r.rows.map((x) => x.cat).reverse(), ['Trades', 'Shops & other']);
});
