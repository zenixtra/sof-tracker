'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { parsePair, parseDrops, bestMatch, expRate, SCRIPT } = require('../lib/screenreader');
const { GAME_DIR } = require('./helpers');

test('HP / MP text as OCR reads it', () => {
  assert.deepStrictEqual(parsePair('2366 / 2366'), [2366, 2366]);
  assert.deepStrictEqual(parsePair('1607 l 1806'), [1607, 1806]);
  assert.deepStrictEqual(parsePair('1607 1806'), [1607, 1806]);
  assert.strictEqual(parsePair('2366 2266'), null); // current above max: misread
  assert.strictEqual(parsePair(''), null);
  assert.deepStrictEqual(parsePair('9-40 / 940'), [940, 940]);
  assert.deepStrictEqual(parsePair('-2817/•.2817'), [2817, 2817]);
  assert.deepStrictEqual(parsePair('0 / 2345'), [0, 2345]);   // dead
  assert.strictEqual(parsePair('16G7 / 1806'), null);         // G could be 0 or 6: don't guess
  assert.strictEqual(parsePair('/ 2371'), null);
});

test('loot announcements wrapped over chat lines', () => {
  const lines = ['w] from Newfand Swd', "Announcements: StabUncle's party member has g", 'otten [Red Dragon Bow (8th)] f', 'rom Invader Leader',
    'Announcements: XTwotwo•s party member has got', 'ten [Spear of the Cruel Sky(8t', 'h)] from Hooligan Dof'];
  const d = parseDrops(lines);
  assert.deepStrictEqual(d.map((x) => x.who), ['StabUncle', 'XTwotwo']);
  assert.deepStrictEqual(d.map((x) => x.from), ['Invader Leader', 'Hooligan Dof']);
  assert.strictEqual(d[0].item, 'Red Dragon Bow (8th)');
  assert.strictEqual(d[1].item, 'Spear of the Cruel Sky(8th)');
});

test('loot announcement as read from a live game window (colour-keyed OCR)', () => {
  const d = parseDrops(["Announcements: wuaifaa's party member has g%ttën", '[White Dragon Blade t9th)] from Leo', 'pard Hunter', 'Dbtained', "Jaehyun's• party member has gotten", '[Hwayean from R']);
  assert.deepStrictEqual(d, [{ who: 'wuaifaa', item: 'White Dragon Blade t9th)', from: 'Leopard Hunter' }]); // the 2nd lost its "]": skipped
});

test('OCR names are matched to the game database, small misreads allowed', () => {
  const list = [{ id: 1, name: 'Spear of the Cruel Sky(8th)' }, { id: 2, name: 'Red Dragon Bow (8th)' }, { id: 3, name: 'Hooligan Dof' }];
  assert.strictEqual(bestMatch('Spear of the Cruef Sky(8th)', list).id, 1);
  assert.strictEqual(bestMatch('Hoofigan Oof', list).id, 3);
  assert.strictEqual(bestMatch('Something else entirely', list), null);
});

test('EXP per hour, across a level-up', () => {
  const t0 = 1e12, m = 60000;
  const s = [{ t: t0, exp: 90 }, { t: t0 + 5 * m, exp: 95 }, { t: t0 + 10 * m, exp: 2 }, { t: t0 + 15 * m, exp: 5 }];
  const r = expRate(s);
  assert.ok(Math.abs(r.perHour - 60) < 0.01, `got ${r.perHour}`); // 15 % in 15 min
  assert.ok(Math.abs(r.toNextMs - 95 * 60000) < 1);
  assert.strictEqual(expRate(s.slice(0, 1)), null);
});

test('the reader script reads a real game screenshot', { skip: process.platform !== 'win32' || !fs.existsSync(path.join(GAME_DIR, 'datas', 'capture', 'YBcapture00030.jpg')) ? 'no screenshot' : false }, () => {
  const out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Image', path.join(GAME_DIR, 'datas', 'capture', 'YBcapture00030.jpg')], { encoding: 'utf8', windowsHide: true });
  const f = JSON.parse(out.trim().split('\n').pop());
  assert.deepStrictEqual(parsePair(f.hp), [2366, 2366]);
  assert.deepStrictEqual(parsePair(f.mp), [1607, 1806]);
  assert.ok(f.exp > 42 && f.exp < 48, `exp ${f.exp}`); // the bar in this screenshot is filled to about 46 %
  assert.ok(parseDrops(f.chat).length >= 1);
});
