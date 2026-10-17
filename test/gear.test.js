'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseTitle, parseTooltip, optionText, GearLog } = require('../lib/gear');

// the weapon tooltip as the screen reader read it from a real screenshot (OCR mistakes included)
const LINES = ['Fatality of Limitations Suppress Dagger (Truei\\7]', 'Attack: 793 823', 'Level:', 'Class: ASC 3', 'TYF; Order', 'Equip:',
  'AtF abilitles have 2 Increase', 'A" abilities have incveasa:f. 2 Increase', 'All abilities have Epen increase•d. 2 Increase', 'All abilities have mcreasa:f. 2 Increase',
  'Attack power increase 64', '; qncj\'t.•', 'Souled Stage : 5LeveI', '[Mid G,] Fatal Slash 4%', 'Skill Dadge 9% :lncrease', 'Only good can use this one.'];
const COLS = ['#40dbb8', '#b9dae2', '#f6f6ee', '#f5f5f1', '#f7f7ee', '#f3f5f3', '#7b79ce', '#7c7ad2', '#7c7ad4', '#7b7ad0', '#7b7ace', '#9d199a', '#bcdde7', '#4ad9bb', '#e9eb62', '#f5f6f2'];

test('tooltip title: name and enhance level, even half read', () => {
  assert.deepStrictEqual(parseTitle('Fatality of Limitations Suppress Dagger (Truei\\7]'), { name: 'Fatality of Limitations Suppress Dagger (True)', plus: 7 });
  assert.deepStrictEqual(parseTitle('Righteous Leader Boots[4]'), { name: 'Righteous Leader Boots', plus: 4 });
  assert.deepStrictEqual(parseTitle('Plain Ring'), { name: 'Plain Ring', plus: 0 });
});

test('tooltip: basics, combined options, awakening and special options', () => {
  const item = { id: 42, name: 'Fatality of Limitations Suppress Merciful Dagger (True)', level: 130, slotName: 'Weapon' };
  const g = parseTooltip(LINES, COLS, () => item);
  assert.strictEqual(g.name, item.name);
  assert.deepStrictEqual([g.itemId, g.plus, g.level, g.slot, g.cls, g.faction], [42, 7, 130, 'Weapon', 'ASC 3', 'Order']);
  assert.deepStrictEqual(g.attack, [793, 823]);
  assert.deepStrictEqual(g.options, ['All abilities +2', 'All abilities +2', 'All abilities +2', 'All abilities +2', 'Attack +64']);
  assert.strictEqual(g.souled, 5);
  assert.ok(g.extras.some((x) => /Fatal Slash 4%/.test(x)));
  assert.ok(!g.extras.some((x) => /only good/i.test(x)));
  assert.ok(!g.extras.some((x) => /qncj/.test(x))); // misread noise is dropped
});

test('options in plain words; element with its bonus', () => {
  assert.strictEqual(optionText('Defensive Power 14 Increase'), 'Defense +14');
  assert.strictEqual(optionText('Defensive power increase 12'), 'Defense +12');
  const g = parseTooltip(['Righteous Leader Boots[4]', 'Defense: 151', 'Level: 130', 'Equip: Boots', 'Fire 8+2Level'], ['#e0d0a0', '#7c7ad2', '#ffffff', '#ffffff', '#9d199a']);
  assert.deepStrictEqual([g.plus, g.slot, g.element], [4, 'Boots', { name: 'Fire', level: 8, bonus: 2 }]);
  assert.strictEqual(g.defense, null); // a blue "Defense: …" line is an option, not the base value
});

test('gear log: one record per character and slot, the enhance history, lines the OCR missed kept', () => {
  let saves = 0;
  const log = new GearLog({ read: () => null, save: () => { saves++; } });
  const g = (plus, attack) => ({ name: 'Dagger', plus, slot: 'Weapon', options: [], attack, extras: [] });
  assert.strictEqual(log.seen(g(6, [700, 720]), 'Ana', 1).changed, 'new');
  assert.strictEqual(log.seen(g(6, [700, 720]), 'Ana', 2), null); // still hovering
  const r = log.seen(g(7, null), 'Ana', 3);
  assert.strictEqual(r.changed, 'plus');
  assert.deepStrictEqual(r.rec.history.map((h) => h.plus), [6, 7]);
  assert.deepStrictEqual(r.rec.attack, [700, 720]);
  assert.strictEqual(log.list('Ana').length, 1);
  assert.strictEqual(log.list('Bo').length, 0);
  assert.strictEqual(saves, 2);
  // another dagger hovered (a shop): compared, your own stays, until you say you wear it
  const o = log.seen({ name: 'Shop Dagger', plus: 3, slot: 'Weapon', options: [], extras: [] }, 'Ana', 4);
  assert.strictEqual(o.changed, 'other');
  assert.strictEqual(log.list('Ana')[0].name, 'Dagger');
  assert.strictEqual(log.equip().changed, 'replaced');
  assert.strictEqual(log.list('Ana')[0].name, 'Shop Dagger');
});

test('a match for another slot than the tooltip says is matched again among that slot', () => {
  const items = [{ id: 1, name: 'Righteous Leader Bracer', slotName: 'Bracer' }, { id: 2, name: 'Righteous Leader Boots', slotName: 'Shoes' }];
  const match = (name, kind) => (kind === 'Boots' ? items[1] : items[0]);
  const g = parseTooltip(['Righteous Leader Bo0ts[4]', 'Equip : Shoes'], ['#ffffff', '#f5f5f5'], match);
  assert.deepStrictEqual([g.name, g.itemId, g.slot, g.plus], ['Righteous Leader Boots', 2, 'Boots', 4]);
});

test('gear log clean-up: name plates, unknown characters and wrong-slot names go', () => {
  const data = { items: {
    'ana|boots': { name: 'Righteous Leader Bracer', slot: 'Boots', char: 'Ana' }, 'ana|weapon': { name: 'Dagger', slot: 'Weapon', char: 'Ana' },
    'ana|kurotsume': { name: 'Shadowcat', slot: null, char: 'Ana' }, '?|ring': { name: 'Plain Ring', slot: 'Ring', char: null } } };
  const log = new GearLog({ read: () => data, save: () => {} });
  assert.strictEqual(log.clean(), 3);
  assert.deepStrictEqual(Object.keys(log.data.items), ['ana|weapon']);
});
