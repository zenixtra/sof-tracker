'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseExpLine, ExpChat, questForGain } = require('../lib/expchat');

test('"Exp obtained" lines: the number, also with junk in front', () => {
  assert.strictEqual(parseExpLine('125120Exp obtained'), 125120);
  assert.strictEqual(parseExpLine('i 125120Exp obtained'), 125120);
  assert.strictEqual(parseExpLine('125,120 Exp obtained'), 125120);
  assert.strictEqual(parseExpLine('Announcements: iSenZ\'s party member has gotten [X]'), null);
});

// a look at the chat: rows of text, read by two passes (same rows, slightly different readings)
const look = (rows) => ({ chat: [...rows, ...rows.map((r) => r.replace('obtained', 'obtalned'))], chatY: [...rows.map((_, i) => 100 + i * 20), ...rows.map((_, i) => 101 + i * 20)] });

test('new EXP lines as the chat scrolls, identical lines counted one by one', () => {
  const x = new ExpChat();
  assert.deepStrictEqual(x.frame(look(['Announcements: drop', '125120Exp obtained', '125120Exp obtained'])), []); // the first look: old
  assert.deepStrictEqual(x.frame(look(['Announcements: drop', '125120Exp obtained', '125120Exp obtained'])), []); // nothing new
  // one more gain: the rows move up by one
  assert.deepStrictEqual(x.frame(look(['125120Exp obtained', '125120Exp obtained', '125120Exp obtained'])), [125120]);
  // a quest hand-in and a kill
  assert.deepStrictEqual(x.frame(look(['125120Exp obtained', '360000Exp obtained', '125120Exp obtained'])), [360000, 125120]);
  // chat read in a way that doesn't line up at all: nothing counted rather than a guess
  assert.deepStrictEqual(x.frame(look(['Bob: hello there', 'Ann: wts robe', 'Cid: lf party', 'Dan: hi', 'Eve: gg'])), []);
});

test('a gain that is exactly a quest\'s EXP reward is that quest', () => {
  const qs = [{ id: 1, name: 'Jade Tower', exp: 360000 }, { id: 2, name: 'Fame', exp: 0 }];
  assert.strictEqual(questForGain(360000, qs).id, 1);
  assert.strictEqual(questForGain(125120, qs), null);
});

test('the new lines of a look are passed on (for pickups, Ki, gold, deaths)', () => {
  const x = new ExpChat();
  x.frame(look(['Announcements: drop', '125120Exp obtained', 'Fish Scale obtained.']));
  assert.deepStrictEqual(x.frame(look(['125120Exp obtained', 'Fish Scale obtained.', '5000Ki obtained'])), []);
  assert.deepStrictEqual(x.fresh, ['5000Ki obtained']);
  x.frame(look(['Fish Scale obtained.', '5000Ki obtained', 'Fish Scale obtained.']));
  assert.deepStrictEqual(x.fresh, ['Fish Scale obtained.']); // the same item again: a second pickup
});
