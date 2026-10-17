'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseBasic, parseFields, parseHeader, parseIcons, parseLevels, StatusLog } = require('../lib/statuswin');

test('Basic page: stats from OCR lines (glued columns, spaced-out labels)', () => {
  const s = parseBasic(['I.G.N Shadowcat', 'Health 7130 / 7130', 'C h i 2049 / 4992', 'R a g e 40 %', 'E x p 45.83 %', 'Faction Order Class ASC 3',
    'Level 137 K i 426620802', 'Craft te Pyrocraft Mastery 700', 'P e t 1 / 3 D.point 0 / 200', 'Attack 2525 Skill Acc 16', 'Defense 1749 Skill Def 183',
    'Accuracy 378 P V P 0', 'Evasion 703 Mon.Atk 100', 'Skill Evasion 51 Mon.Def 296', 'Pure Def 0', 'Int 396 Str 433 Vit 205 Dex 661']);
  assert.deepStrictEqual([s.level, s.attack, s.defense, s.accuracy, s.evasion, s.skillEvasion, s.skillAcc, s.skillDef], [137, 2525, 1749, 378, 703, 51, 16, 183]);
  assert.deepStrictEqual([s.monAtk, s.monDef, s.pureDef, s.pvp, s.int, s.str, s.vit, s.dex, s.ki, s.mastery], [100, 296, 0, 0, 396, 433, 205, 661, 426620802, 700]);
  assert.deepStrictEqual([s.health, s.chi, s.pet, s.dpoint, s.rage, s.exp, s.faction, s.asc], [[7130, 7130], [2049, 4992], [1, 3], [0, 200], 40, 45.83, 'Order', 3]);
});

test('Skill page: header, icons in reading order, red levels', () => {
  assert.deepStrictEqual(parseHeader('ASC 3 Ki 426620802 A.P 335'), { asc: 3, ki: 426620802, ap: 335 });
  assert.deepStrictEqual(parseHeader('ASC 3 Ki 426620802'), { asc: 3, ki: 426620802, ap: null });
  assert.deepStrictEqual(parseIcons('2:830301@300,201;2:830102@369,109;2:830101@300,109').map((i) => i.id), [830101, 830102, 830301]);
  assert.deepStrictEqual([...parseLevels(['2:830101@300,109=10', '2:830102@369,109=1O', '2:830201@300,155=']).entries()], [[830101, 10], [830102, 10]]);
});

test('status log: stats history when they change, skills per tab', () => {
  const log = new StatusLog({ read: () => null, save: () => {} });
  const base = { level: 137, attack: 2525, defense: 1749, accuracy: 378, evasion: 703, int: 396 };
  assert.ok(!log.stats('Ana', { level: 137 }, 1)); // too little read: not trusted
  assert.ok(log.stats('Ana', base, 1));
  log.stats('Ana', base, 2);                             // the same: no new point
  log.stats('Ana', { ...base, attack: 2600 }, 20 * 60000); // changed: a new point
  assert.deepStrictEqual(log.view('ana').history.map((p) => p.v.attack), [2525, 2600]);
  log.skills('Ana', 0, [830101, 830102], new Map([[830101, 10]]), { asc: 3, ki: 5, ap: 335 }, 3);
  log.skills('Ana', 0, [830101, 830102], new Map([[830102, 9]]), { asc: 3, ki: 6, ap: null }, 4); // keeps 830101's level
  const v = log.view('ana');
  assert.deepStrictEqual(v.skills.ascension.levels, { 830101: 10, 830102: 9 });
  assert.deepStrictEqual([v.header.ki, v.header.ap], [6, 335]);
});

// the real screen reader on the three skill window screenshots (Windows only: it uses the Windows text recognition)
const shots = ['status-ascension.png', 'status-combat.png', 'status-support.png'].map((f) => path.join(__dirname, 'fixtures', f));
const canRun = process.platform === 'win32' && shots.every((f) => fs.existsSync(f)) && fs.existsSync(path.join(__dirname, '..', 'data', 'icon-index.bin'));
test('the screen reader reads the Status window\'s skill tabs', { skip: canRun ? false : 'needs Windows, the screenshots and the icon index' }, () => {
  const read = (f) => JSON.parse(execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '..', 'screenreader.ps1'), '-Image', f], { encoding: 'utf8', timeout: 120000 })).status;
  const [a, c, s] = shots.map(read);
  assert.deepStrictEqual([a.page, a.tab, c.tab, s.tab], [2, 0, 1, 2]);
  assert.deepStrictEqual(parseHeader(a.header), { asc: 3, ki: 426620802, ap: 335 });
  assert.deepStrictEqual([parseIcons(a.icons).length, parseIcons(c.icons).length, parseIcons(s.icons).length], [6, 24, 9]);
  assert.deepStrictEqual([...parseLevels(a.levels).values()], [10, 10, 10, 10, 10, 10]);
});

test('Basic page boxes: one number each, nonsense left out', () => {
  assert.deepStrictEqual(parseFields(['level=137', 'attack=2525', 'int=', 'pvp=0', 'level2=x', 'mastery=9999999']), { level: 137, attack: 2525, pvp: 0 });
});

// the real screen reader on a real game frame with the Status window on Basic (from a debug capture)
const basic = path.join(__dirname, 'fixtures', 'status-basic.jpg');
test('the screen reader reads the Basic page\'s stats by their boxes', { skip: process.platform === 'win32' && fs.existsSync(basic) ? false : 'needs Windows and the frame' }, () => {
  const st = JSON.parse(execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '..', 'screenreader.ps1'), '-Image', basic], { encoding: 'utf8', timeout: 120000 })).status;
  assert.strictEqual(st.page, 0);
  const v = { ...parseBasic(st.lines), ...parseFields(st.fields) };
  const want = { level: 137, attack: 2525, defense: 1749, accuracy: 378, evasion: 703, skillEvasion: 51, skillAcc: 16, skillDef: 183, pvp: 0, monAtk: 100, monDef: 296, pureDef: 0, str: 433, vit: 205, dex: 661, mastery: 700 };
  // (a JPEG frame: one or two digits may blur; the live frames aren't compressed)
  const right = Object.keys(want).filter((k) => v[k] === want[k]);
  assert.ok(right.length >= Object.keys(want).length - 1, `read right: ${right.length} of ${Object.keys(want).length} (${JSON.stringify(v)})`);
  assert.strictEqual(v.faction, 'Order');
});
