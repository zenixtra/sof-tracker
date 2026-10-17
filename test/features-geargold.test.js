'use strict';

// lib/features/geargold.js with a small fake game: a tooltip into the gear log and price check, gold from the
// inventory into net worth (and your Ascension gold), a better piece offered in the trade chat
const test = require('node:test');
const assert = require('node:assert');
const createGearGold = require('../lib/features/geargold');

const DB = { items: [{ id: 801016, name: 'Righteous Leader Boots', slot: 4, level: 130, def: 83, price: 1000 }, { id: 501015, name: 'Righteous Leader Bracer', slot: 2, level: 130, def: 86, price: 1000 }] };

function setup() {
  const files = {}, alerts = [], gold = [];
  const store = { readJson: (n, d) => (n in files ? files[n] : d), writeJson: (n, v) => { files[n] = JSON.parse(JSON.stringify(v)); } };
  const settings = { weightAlert: 90, gearOfferAlert: true };
  const g = createGearGold({
    store, state: () => ({ session: { character: 'Ana' } }), db: () => DB, settings: () => settings, enhanceSession: () => ({}),
    feat: () => true, addAlert: (kind, title, body) => alerts.push({ kind, title, body }), debugCapture: () => {}, readerOk: () => {},
    playerInfo: () => ({ level: 135 }), zoneName: (z) => `Zone ${z}`, chatPrice: () => null, marketOffers: () => [],
    timelineFor: () => null, sessionKey: () => 'k', dayKey: (t) => new Date(t).toISOString().slice(0, 10), onGold: (char, v) => gold.push([char, v]),
  });
  return { g, alerts, gold };
}

test('gear & gold: tooltip, the boots matched as boots, gold twice to count, a better pair for sale', () => {
  const { g, alerts, gold } = setup();
  // the boots tooltip: the first match is the bracer, the Equip line says shoes → matched again among boots
  g.onTooltip({ lines: ['Righteous Leader Boots[4]', 'Equip : Shoes', 'Defense : 120'], cols: ['#ffffff', '#f5f5f5', '#f5f5f5'] }, 1000, 'Ana');
  const mine = g.gearLog.list('Ana');
  assert.deepStrictEqual(mine.map((x) => [x.slot, x.name, x.plus]), [['Boots', 'Righteous Leader Boots', 4]]);
  assert.strictEqual(g.priceNow().name, 'Righteous Leader Boots');
  assert.ok(g.charGearScore('Ana').score > 0);
  // gold counts once read the same twice
  g.onInventory({ gold: '1,250,000Gold', weight: '100 / 1000' }, 2000, 'Ana');
  assert.deepStrictEqual(gold, []);
  g.onInventory({ gold: '1,250,000Gold', weight: '100 / 1000' }, 3000, 'Ana');
  assert.deepStrictEqual(gold, [['Ana', 1250000]]);
  assert.strictEqual(g.netWorth.history('Ana', 90, 4000)[0].gold, 1250000);
  // someone sells +8 boots of your level: better than your +4
  g.onGearOffer('Bob: SELL BOOTS 130 +8 2B', 5000);
  assert.strictEqual(g.gearOffers().length, 1);
  assert.ok(alerts.some((a) => /^Better Boots for sale: \+8/.test(a.title)));
  g.onGearOffer('Bob: SELL BOOTS 130 +2 1B', 6000); // worse: no alert
  assert.strictEqual(alerts.filter((a) => /^Better/.test(a.title)).length, 1);
});
