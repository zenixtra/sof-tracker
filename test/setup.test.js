'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { exportSetup, mergeSetup, settingsToApply } = require('../lib/setup');
const { mergeOffers } = require('../lib/friends');

const cur = () => ({ watchlist: ['Oley'], threats: { bad: { name: 'Bad', count: 2 } }, notes: { oley: { name: 'Oley', note: 'old', updatedAt: 1 } },
  waypoints: [{ id: 'a', zone: '101', x: 100, z: 100, label: 'Fox spot', kind: 'farm' }], priceWatches: [{ id: 'p', itemId: 5, side: 'sell', price: 10 }],
  labels: { zones: { 101: 'Valley' }, buffs: {} }, checklist: [{ text: 'Daily boss' }] });

test('setup import: adds what is new, keeps what is here, newer notes win', () => {
  const file = exportSetup({ version: '1.16.0', settings: { afkMinutes: 5 }, watchlist: ['oley', 'Wdll'], threats: { bad: { name: 'Bad', count: 5 }, pk: { name: 'Pk', count: 1 } },
    notes: { oley: { name: 'Oley', note: 'new', updatedAt: 2 }, wdll: { name: 'Wdll', note: 'trader', updatedAt: 1 } },
    waypoints: [{ id: 'z', zone: '101', x: 110, z: 95, label: 'fox spot', kind: 'farm' }, { id: 'b', zone: '201', x: 5, z: 5, label: 'Boss', kind: 'boss', note: 'every 2h' }],
    priceWatches: [{ itemId: 5, side: 'sell', price: 99 }, { itemId: 6, side: 'buy', price: 50 }], labels: { zones: { 101: 'X', 201: 'Hill' } },
    checklist: [{ text: 'daily boss', every: 'daily' }, { text: 'Arena', every: 'weekly', day: 3, hour: 0, remind: 60 }] });
  const m = mergeSetup(cur(), JSON.parse(JSON.stringify(file)));
  assert.deepStrictEqual(m.watchlist, ['Oley', 'Wdll']);
  assert.strictEqual(m.threats.bad.count, 5); assert.ok(m.threats.pk);
  assert.strictEqual(m.notes.oley.note, 'new');
  assert.deepStrictEqual(m.waypoints.map((w) => w.label), ['Fox spot', 'Boss']); // the same spot only once
  assert.strictEqual(m.waypoints[1].note, 'every 2h');
  assert.deepStrictEqual(m.priceWatches.map((w) => [w.itemId, w.price]), [[5, 10], [6, 50]]); // yours kept
  assert.deepStrictEqual(m.labels.zones, { 101: 'Valley', 201: 'Hill' });
  assert.deepStrictEqual(m.checklist.map((c) => c.text), ['Arena']);
  assert.deepStrictEqual(m.summary.map((s) => s.what), ['Watchlist', 'Danger flags', 'Player notes', 'Map markers', 'Price watches', 'Labels', 'Checklist']);
  assert.throws(() => mergeSetup(cur(), { hello: 1 }), /not a SoF Tracker setup/);
});

test('setup import: folders of another PC are left out', () => {
  const s = settingsToApply({ settings: { afkMinutes: 5, backupDir: 'D:\\gone', syncDir: 'E:\\Share', syncName: 'Lev' } }, (p) => p === 'E:\\Share');
  assert.deepStrictEqual(s, { afkMinutes: 5, syncDir: 'E:\\Share', syncName: 'Lev' });
  assert.deepStrictEqual(settingsToApply({ settings: { syncDir: 'X:\\no', syncName: 'Lev' } }, () => false), {});
});

test('shared market: friends offers added, the same chat line read by both counted once', () => {
  const mine = [{ t: 1000, who: 'Oley', itemId: 5, side: 'buy', price: 5e9 }];
  const theirs = [{ t: 61000, who: 'oley', itemId: 5, side: 'buy', price: 5e9, from: 'Ali' }, { t: 2000, who: 'Wdll', itemId: 5, side: 'sell', price: 6e9, from: 'Ali' }, { t: 3 * 3600000, who: 'Oley', itemId: 5, side: 'buy', price: 5e9, from: 'Ali' }];
  const m = mergeOffers(mine, theirs);
  assert.deepStrictEqual(m.map((o) => `${o.who}@${o.t}`), ['Oley@1000', 'Wdll@2000', 'Oley@10800000']);
  assert.strictEqual(mergeOffers(mine, []), mine);
});
