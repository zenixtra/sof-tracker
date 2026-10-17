'use strict';

// lib/features/readertools.js in a temporary folder: reader check, a debug capture with its picture, the setup check
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const createReaderTools = require('../lib/features/readertools');

test('reader check, debug captures (one per kind per 10 minutes) and the setup check', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sof-rt-')), ring = path.join(dir, 'ring');
  fs.mkdirSync(ring);
  fs.writeFileSync(path.join(ring, 'f1.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const files = {};
  const store = { DIR: dir, readJson: (n, d) => (n in files ? files[n] : d), writeJson: (n, v) => { files[n] = v; } };
  const settings = { screenReader: true, debugCapture: true, syncDir: '', backupDir: '' };
  const rt = createReaderTools({
    store, VERSION: 'test', CLIENT_DIR: dir, settings: () => settings, state: () => ({ game: { running: false } }), db: () => ({ items: [1], quests: [] }),
    backupState: () => ({ error: null }), readerStats: () => ({ frames: 0, ocr: null }),
    ringFrames: () => [{ n: 'f1.jpg', dir: ring, t: Date.now() }], stamp: () => '2026-10-16_1200', zip: (f) => Buffer.from(JSON.stringify(f.map((x) => x.name))),
    pickupCandidates: () => [], pickupPatterns: () => [],
  });
  rt.readerOk('hud', Date.now());
  const v = rt.readerCheckView();
  assert.strictEqual(v.checks.find((c) => c.id === 'hud').status, 'ok');
  assert.strictEqual(v.checks.find((c) => c.id === 'gold').status, 'never');
  const t = Date.now();
  rt.debugCapture('quest', t, { lines: ['?'] });
  rt.debugCapture('quest', t + 1000, { lines: ['again'] }); // within 10 minutes: skipped
  rt.debugCapture('tooltip', t + 2000, { lines: ['x'] });
  const list = rt.debugList();
  assert.deepStrictEqual(list.map((d) => [d.kind, d.shot]).sort(), [['quest', true], ['tooltip', true]]);
  const names = JSON.parse(rt.debugBundle().toString());
  assert.ok(names.includes('reader-check.json') && names.filter((n) => n.startsWith('captures/')).length === 4);
  rt.trayPing(); rt.setTrayStatus({ at: t, keys: { M: true, O: true, L: true, S: true, I: false } });
  const sc = rt.setupCheck();
  assert.strictEqual(sc.rows.find((r) => r.id === 'tray').status, 'ok');
  assert.match(sc.rows.find((r) => r.id === 'hotkeys').detail, /Ctrl\+Shift\+I/);
  fs.rmSync(dir, { recursive: true, force: true });
});
