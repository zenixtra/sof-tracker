// Translation tables: every row complete, placeholders kept, alert patterns working.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { DICT, PATTERNS } = require('../public/i18n-dict.js');
const i18n = require('../lib/i18n');

const LANGS = ['tr', 'vi', 'id', 'zh', 'th', 'es'];
const holes = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('every language has every text', () => {
  const keys = Object.keys(DICT.tr);
  for (const l of LANGS) {
    const missing = keys.filter((k) => !DICT[l][k]);
    assert.deepStrictEqual(missing, [], `${l} is missing ${missing.length} texts`);
  }
});

test('translations keep their {placeholders}', () => {
  const bad = [];
  for (const l of LANGS) for (const [en, tr] of Object.entries(DICT[l])) if (holes(en) !== holes(tr)) bad.push(`${l}: ${en}`);
  assert.deepStrictEqual(bad, []);
});

test('alert patterns translate generated alerts', () => {
  for (const l of LANGS) assert.ok(PATTERNS[l].length > 40, `${l} has few patterns`);
  assert.strictEqual(i18n.tAlert('tr', 'Game updated to version 781'), 'Oyun 781 sürümüne güncellendi');
  assert.strictEqual(i18n.tAlert('es', '12 new items · 3 monsters changed'), '12 objetos nuevos · 3 monstruos cambiados');
  assert.strictEqual(i18n.tAlert('en', 'anything'), 'anything');
  assert.strictEqual(i18n.tAlert('zh', 'Unknown game text'), 'Unknown game text');
});
