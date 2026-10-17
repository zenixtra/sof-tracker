'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseLine, matchQuest, QuestWatch } = require('../lib/questwin');

const QUESTS = [{ id: 1, name: 'Show me the Golden Bar~!', level: 1 }, { id: 2, name: "JungMu House Army Vice President's Armor", level: 100 },
  { id: 3, name: "Zombie Trainer's sample collection 1 (Order)", level: 116 }, { id: 4, name: 'Horrible Woody', level: 0 }, { id: 5, name: 'Fame Symbol Exchange', level: 80 },
  { id: 6, name: 'Better safe than sorry', level: 133 }, { id: 7, name: 'Better safe than ever', level: 120 }];

test('quest window lines: level and name, misread bits tolerated', () => {
  assert.deepStrictEqual(parseLine('[45] Jade Tower bandits Key Point'), { level: 45, name: 'Jade Tower bandits Key Point' });
  assert.deepStrictEqual(parseLine('lel [1] Shaw me the Golden Bar•v!'), { level: 1, name: 'Shaw me the Golden Bar•v!' });
  assert.deepStrictEqual(parseLine('[O] Horrible Waady'), { level: 0, name: 'Horrible Waady' });
  assert.deepStrictEqual(parseLine('[m] Fame Symbol Exchange'), { level: null, name: 'Fame Symbol Exchange' });
  assert.strictEqual(parseLine('ok'), null);
});

test('quest window lines matched to the game\'s quests (cut off and misread names too)', () => {
  const ids = ['lel [1] Shaw me the Golden Bar•v!', 'House Army Vice Presi', '[116]Zambfe Trainers sample collec', '[O] Horrible Waady', '[m] Fame Symbol Exchange', '[133] Better safe than sorry']
    .map((l) => matchQuest(l, QUESTS)?.id);
  assert.deepStrictEqual(ids, [1, 2, 3, 4, 5, 6]);
  assert.strictEqual(matchQuest('[133] Something else entirely', QUESTS), null);
});

test('quest watch: a quest that drops off a fully visible list is done', () => {
  const w = new QuestWatch({ read: () => null, save: () => {} });
  assert.deepStrictEqual(w.seen('Ana', [{ id: 1 }, { id: 2 }], 1, true), []);
  assert.deepStrictEqual(w.seen('Ana', [{ id: 2 }], 2, false), []); // a long, scrolled list: nothing counts as gone
  w.seen('Ana', [{ id: 1 }, { id: 2 }], 3, true);
  assert.deepStrictEqual(w.seen('Ana', [{ id: 2 }, { id: 9 }], 4, true), [1]);
  assert.deepStrictEqual(w.active('ana').ids, [2, 9]);
});
