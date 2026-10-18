// The real screen reader on a real game screenshot with potions on the hotbar (F3: 1553 pills, F4: 2248 ginseng).
// Windows only (PowerShell and its drawing), and it needs the icon index made from the game files.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const shot = path.join(__dirname, 'fixtures', 'hotbar-1553-2248.png');
const index = path.join(ROOT, 'data', 'icon-index.bin'), db = path.join(ROOT, 'data', 'gamedb.json');
const canRun = process.platform === 'win32' && [shot, index, db].every((f) => fs.existsSync(f));

test('potion and ginseng counts on the hotbar: icons recognised, 4-digit counts read', { skip: canRun ? false : 'needs Windows, the screenshot and the icon index' }, () => {
  const items = JSON.parse(fs.readFileSync(db, 'utf8')).db.items;
  const ids = items.filter((i) => /salve|ginseng|pill|potion|elixir|tonic|remedy|hong acid/i.test(i.name)).map((i) => i.id).join(',');
  const out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'screenreader.ps1'), '-Image', shot, '-HotbarIds', ids], { encoding: 'utf8', timeout: 120000 });
  const hb = JSON.parse(out.trim().split('\n').pop()).hotbar;
  const got = Object.fromEntries(hb.map((h) => [h.slot, [h.icon, h.count]]));
  assert.deepStrictEqual(got.F3, ['1:1000000970', 1553]); // Healing Anchorite Heaing Pill
  assert.deepStrictEqual(got.F4, ['1:1000000972', 2248]); // Healing Anchorite  Aged Rare Ginseng
});
