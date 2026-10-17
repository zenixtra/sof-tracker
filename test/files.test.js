// Texture decoding and the patch watcher.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { decode, png, ddsToPng } = require('../lib/dds');
const { PatchWatcher, isVolatile } = require('../lib/patchwatch');
const { GAME_DIR, gameOnly } = require('./helpers');

// a 4x4 DXT1 texture: one block, colour 0 = pure red, all pixels index 0
function dxt1Red() {
  const b = Buffer.alloc(128 + 8);
  b.write('DDS ', 0, 'latin1'); b.writeUInt32LE(124, 4); b.writeUInt32LE(4, 12); b.writeUInt32LE(4, 16);
  b.writeUInt32LE(4, 80); b.write('DXT1', 84, 'latin1');
  b.writeUInt16LE(0xf800, 128); b.writeUInt16LE(0x0000, 130); b.writeUInt32LE(0, 132);
  return b;
}

test('DXT1 decodes to the right colour and encodes as PNG', () => {
  const { w, h, rgba } = decode(dxt1Red());
  assert.strictEqual(w, 4); assert.strictEqual(h, 4);
  assert.deepStrictEqual([...rgba.subarray(0, 4)], [255, 0, 0, 255]);
  const p = png(w, h, rgba);
  assert.deepStrictEqual([...p.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test('a real item icon converts', gameOnly, () => {
  const out = ddsToPng(fs.readFileSync(path.join(GAME_DIR, 'datas', 'interface', 'ITEM', '1.d2s')));
  assert.ok(out.length > 100 && out.readUInt32BE(16) === 32);
});

test('files the game rewrites while playing are ignored', () => {
  assert.ok(isVolatile('client\\log_123.txt'));
  assert.ok(isVolatile('client\\xigncode\\x.log'));
  assert.ok(isVolatile('launcher.ini'));
  assert.ok(!isVolatile('client\\ybi.cfg'));
  assert.ok(!isVolatile('datas\\interface\\data\\window_minimap\\101.bmp'));
});

test('patch watcher reports added and changed files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sof-pw-'));
  const game = path.join(dir, 'game'), data = path.join(dir, 'data');
  fs.mkdirSync(path.join(game, 'Client'), { recursive: true }); fs.mkdirSync(data);
  fs.writeFileSync(path.join(game, 'launcher.ini'), 'VERSION=1\n');
  fs.writeFileSync(path.join(game, 'Client', 'a.cfg'), 'one');
  const events = [];
  const w = new PatchWatcher({ gameDir: game, clientDir: path.join(game, 'Client'), dataDir: data, onEvent: (r) => events.push(r) });
  assert.strictEqual(await w.check('first'), null); // baseline only
  fs.writeFileSync(path.join(game, 'Client', 'a.cfg'), 'two!');
  fs.writeFileSync(path.join(game, 'Client', 'b.cfg'), 'new');
  fs.writeFileSync(path.join(game, 'launcher.ini'), 'VERSION=2\n');
  const r = await w.check('second');
  assert.ok(r);
  assert.deepStrictEqual(r.counts, { added: 1, changed: 1, removed: 0 });
  assert.strictEqual(r.versionFrom, '1'); assert.strictEqual(r.versionTo, '2');
  assert.strictEqual(events.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
