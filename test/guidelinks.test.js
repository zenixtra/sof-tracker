'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { guideLinkGroups } = require('../lib/guidelinks');

test('official guide links: named in English, grouped, unknown pages kept under their Korean name', () => {
  const g = guideLinkGroups([
    { view: 909, names: ['각성'], link: 'http://yulgang.mgame.com/guide/game_guide/?view=909' },
    { view: 722, names: ['단무공'], link: 'http://yulgang.mgame.com/guide/game_guide/?view=722' },
    { view: 9999, names: ['새기능'], link: 'http://yulgang.mgame.com/guide/game_guide/?view=9999' },
  ]);
  assert.deepStrictEqual(g.map((x) => x.group), ['Gear & crafting', 'Class skills', 'More']);
  assert.strictEqual(g[0].pages[0].name, 'Awakening');
  assert.deepStrictEqual([g[1].pages[0].name, g[1].pages[0].cls], ['Ninja: skills', 'Ninja']);
  assert.strictEqual(g[2].pages[0].name, '새기능');
});
