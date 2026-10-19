'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { PhoneApp } = require('../lib/phoneapp');

test('pairing link: the home-network address and key for the live view, a private topic for alerts', () => {
  const p = new PhoneApp({ read: () => null, save: () => {} });
  const r = p.pairing({ name: 'GAMEPC', lan: ['http://192.168.1.5:7777'], key: 'k'.repeat(24), repo: 'zenixtra/sof-tracker' });
  assert.match(r.link, /^sofapp:\/\/pair\?d=[\w-]+$/);
  const back = JSON.parse(Buffer.from(r.code, 'base64url').toString());
  assert.deepStrictEqual([back.v, back.name, back.lan, back.key, back.repo], [1, 'GAMEPC', ['http://192.168.1.5:7777'], 'k'.repeat(24), 'zenixtra/sof-tracker']);
  assert.match(back.ntfy.topic, /^sof-[\w-]{24}$/);
  // the same topic until unpaired; then a new one
  assert.strictEqual(p.pairing({ name: 'x', lan: [] }).payload.ntfy.topic, back.ntfy.topic);
  assert.notStrictEqual(p.reset(), back.ntfy.topic);
  // phone view off: no addresses or key in the code (alerts only)
  assert.deepStrictEqual(p.pairing({ name: 'x', lan: ['http://192.168.1.5:7777'], key: null }).payload.lan, []);
});

test('alerts go to the topic as JSON (emoji and any language intact), urgent ones with priority 4; "away only" keeps the rest back', async () => {
  const sent = [];
  let away = false;
  const p = new PhoneApp({ read: () => null, save: () => {}, isAway: () => away, fetchImpl: async (url, o) => { sent.push({ url, body: JSON.parse(o.body) }); return { ok: true, status: 200 }; } });
  p.send({ kind: 'boss', title: 'nothing yet: not paired' });
  p.ensureTopic();
  p.send({ kind: 'danger', title: '⚠ 3 enemies just arrived', body: 'in Tiger Valley' });
  p.send({ kind: 'potion', title: 'Sadece 40 iksir kaldı' });
  await new Promise((r) => setTimeout(r, 2300));
  assert.deepStrictEqual(sent.map((s) => [s.url, s.body.priority, s.body.title, s.body.message]), [
    ['https://ntfy.sh', 4, '⚠️ ⚠ 3 enemies just arrived', 'in Tiger Valley'],
    ['https://ntfy.sh', 3, '🧪 Sadece 40 iksir kaldı', 'Sadece 40 iksir kaldı'],
  ]);
  assert.strictEqual(sent[0].body.topic, p.d.topic);
  // only while away: a boss alert while playing is kept back, danger still goes
  p.setSendWhen('away'); sent.length = 0;
  p.send({ kind: 'boss', title: 'Boss soon' }); p.send({ kind: 'disconnect', title: 'Disconnected' });
  await new Promise((r) => setTimeout(r, 1300));
  assert.deepStrictEqual(sent.map((s) => s.body.title), ['🔌 Disconnected']);
  away = true; p.send({ kind: 'boss', title: 'Boss soon' });
  await new Promise((r) => setTimeout(r, 1300));
  assert.strictEqual(sent.length, 2);
});
