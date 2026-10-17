'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { GamePerf, parseTasklist } = require('../lib/gameperf');

test('the game rows of tasklist /V: memory, window status and CPU time', () => {
  const out = '"YGOnline.exe","11444","Console","1","1.234.567 K","Running","PC\\Player","0:12:30","Scions of Fate"\r\n'
    + '"YGOnline.exe","9000","Console","1","812,000 K","Not Responding","PC\\Player","1:00:05","Scions of Fate"\r\n';
  assert.deepStrictEqual(parseTasklist(out), [
    { pid: 11444, memMb: 1206, responding: true, cpuSec: 750 },
    { pid: 9000, memMb: 793, responding: false, cpuSec: 3605 },
  ]);
});

test('CPU per minute, a freeze from "Not Responding" until it answers, memory that keeps growing', () => {
  const p = new GamePerf({ read: () => null, save: () => {}, cores: 4 });
  const S = 1000, T = 1.7e12;
  let cpu = 0, froze = null, grew = null;
  for (let s = 0; s <= 6 * 60; s += 5) {
    cpu += 2; // 2 s of CPU every 5 s on 4 cores = 10%
    const frozen = s >= 100 && s < 120;
    const mem = s < 330 ? 800 : 1600;
    const r = p.sample(T + s * S, [{ pid: 1, cpuSec: cpu, memMb: mem, responding: !frozen }], () => ({ zone: 101 }));
    if (r.froze.length) froze = r.froze[0];
    if (r.memGrew.length) grew = r.memGrew[0];
  }
  assert.strictEqual(p.d.samples.length, 5); // a new minute starts with the look after the last one
  assert.strictEqual(p.d.samples[1][1], 10);
  assert.deepStrictEqual(froze, { pid: 1, t: T + 100 * S, ms: 20 * S, zone: 101 });
  assert.deepStrictEqual(grew, { pid: 1, from: 800, to: 1600 });
  assert.strictEqual(p.view(T + 361 * S).today, 1);
});
