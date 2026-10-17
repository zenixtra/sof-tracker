'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { runSelfCheck } = require('../lib/selfcheck');

// just enough of the tracker for the self-check to run (the game folder does not exist here)
const ctx = (screen) => ({ clientDir: 'nowhere', gameDir: 'nowhere', gameDb: {}, templates: 0, zoneMaps: 0, worldZones: null, guideMonsters: 0, logins: 0,
  parseLog: () => ({}), readTerrain: () => null, iconTest: () => 0, rankings: {}, news: {}, screen });
const sr = (r) => Object.fromEntries(r.checks.filter((c) => c.area === 'Screen reader').map((c) => [c.id, c.level]));

test('screen reader checks: only while it reads, broken parts named', () => {
  const now = Date.now(), min = 60000;
  assert.deepStrictEqual(sr(runSelfCheck(ctx({ on: false }))), {});
  assert.deepStrictEqual(sr(runSelfCheck(ctx({ on: true, gameRunning: false }))), {});
  // reading for 10 minutes: HP fine, the EXP bar never found, chat quiet for an hour, Dutch text recognition
  const r = runSelfCheck(ctx({ on: true, gameRunning: true, status: 'reading', since: now - 10 * min, frames: 300, lastFrameAt: now - 2000, lastHpAt: now - 2000, lastExpAt: null, lastChatAt: now - 60 * min, ocr: 'nl-NL', w: 1024, h: 768 }));
  assert.deepStrictEqual(sr(r), { 'sr-looks': 'ok', 'sr-hp': 'ok', 'sr-exp': 'fail', 'sr-chat': 'fail', 'sr-ocr': 'warn' });
  assert.match(r.checks.find((c) => c.id === 'sr-ocr').detail, /English/);
  // just started: nothing is called broken yet
  assert.deepStrictEqual(sr(runSelfCheck(ctx({ on: true, gameRunning: true, status: 'reading', since: now - min, frames: 5, lastFrameAt: now, lastHpAt: now, ocr: 'en-US' }))), { 'sr-looks': 'ok', 'sr-hp': 'ok', 'sr-exp': 'warn', 'sr-chat': 'warn', 'sr-ocr': 'ok' });
  // minimised: a warning that says so
  const m = runSelfCheck(ctx({ on: true, gameRunning: true, status: 'hidden', since: now - 10 * min }));
  assert.deepStrictEqual(sr(m), { 'sr-looks': 'warn' });
  assert.match(m.checks.find((c) => c.id === 'sr-looks').detail, /minimised/);
});
