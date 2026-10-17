'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { answer, period } = require('../lib/ask');

const H = 3600000, D = 86400000;
const NOW = new Date(2026, 9, 16, 20, 0, 0).getTime(); // a Friday evening
const ctx = {
  me: 'Ana', chars: ['Ana', 'Para7'],
  playMs: (from) => (from >= NOW - 5 * D ? 7.5 * H : 40 * H),
  sessions: () => [{ character: 'Ana', ms: 5 * H, screen: { exp: 12.5, kills: 900, levels: 1 } }, { character: 'Para7', ms: 2 * H, screen: { exp: 3, kills: 100 } }],
  gold: (c) => (c === 'Ana' ? 2500000 : null),
  deaths: () => [
    { t: NOW - 3 * H, zoneName: 'Tiger Valley', character: 'Ana', killer: 'Zekez' },
    { t: NOW - 2 * D, zoneName: 'Hill Valley', character: 'Ana', target: 'Zombie Cat' },
    { t: NOW - 4 * D, zoneName: 'Tiger Valley', character: 'Para7', killer: 'Zekez' },
  ],
  spots: () => [{ zoneName: 'Tiger Valley', x: 100, z: 200, expPerHour: 3.2, minutes: 40, profitPerHour: 900000 }, { zoneName: 'Hill Valley', x: 0, z: 0, expPerHour: 4.1, minutes: 20, profitPerHour: 100000 }],
  mobs: () => [{ name: 'Zombie Cat', expPerHour: 4500000, expPerKill: 125120, secPerKill: 4 }],
  forecast: () => ({ character: 'Ana', exp: 45.26, perHour: 1.77, playHoursLeft: 30.8, etaAt: NOW + 11 * D, hoursPerDay: 2.6 }),
  plan: () => [{ t: NOW + 40 * 60000, kind: 'boss', title: 'Black Dragon' }, { t: NOW + 3 * H, kind: 'event', title: 'House war (usual time)' }],
  price: (name) => (/sky crystal/.test(name) ? { item: 'Special Sky Crystal', sell: 750000, buy: 600000, offers: 14, npc: 100 } : null),
  lastSeen: (n) => (n.toLowerCase() === 'zekez' ? { name: 'Zekez', t: NOW - 3 * H, zoneName: 'Tiger Valley', sessions: 4 } : null),
  craft: () => ({ enchant: { ok: 3, n: 4 }, combine: { ok: 0, n: 0 } }),
  quests: () => 6,
  level: () => ({ level: 137, cls: 'Ninja' }),
};
const ask = (q) => answer(q, ctx, NOW);

test('time spans named in a question', () => {
  const p = period(' last week ', NOW);
  assert.strictEqual(new Date(p.from).getDay(), 1); // a Monday
  assert.strictEqual(p.to - p.from, 7 * D);
  assert.strictEqual(period(' in the last 3 days ', NOW).from, NOW - 3 * D);
  assert.strictEqual(period(' anything ', NOW, 'today').label, 'today');
});

test('each kind of question finds its answer', () => {
  assert.match(ask('How long did I play this week?').answer, /^You played 7h 30m this week\./);
  assert.match(ask('Which spot gave the most EXP?').answer, /Hill Valley .* 4\.10% EXP per hour/);
  assert.match(ask('best spot for gold').answer, /Tiger Valley .* 900k gold per hour/);
  assert.match(ask('When did I last die?').answer, /Ana last died 3 hours ago .* in Tiger Valley, killed by Zekez/);
  assert.match(ask('When did Para7 last die?').answer, /^Para7 last died 4 days ago/);
  assert.match(ask('Who killed me most?').answer, /^Zekez killed you most \(2×/);
  assert.match(ask('How much gold did I make today?').answer, /^Ana made 2\.5m gold today/);
  assert.match(ask('When is the next boss?').answer, /^Next: Black Dragon: .* \(in 40m\)/);
  assert.match(ask('What is my best monster?').answer, /Zombie Cat: 4,500,000 EXP per hour, 125,120 per kill, 4 s per kill/);
  assert.match(ask('When will I level up?').answer, /about 30h 48m more play at 1\.77% per hour/);
  assert.match(ask('Price of Special Sky Crystal').answer, /^Special Sky Crystal: usually sold for 750k, bought for 600k .*\(14 offers/);
  assert.match(ask('When did I last see Zekez?').answer, /^Zekez was last near you 3 hours ago .* in Tiger Valley; met in 4 sessions/);
  assert.match(ask('What is my enchant success rate?').answer, /^enchant: 3 of 4 worked \(75%\)/);
  assert.match(ask('how many quests did I do this week').answer, /^Ana handed in 6 quests this week/);
  assert.match(ask('how many kills today').answer, /^Today: \+15\.5% EXP, 1,000 kills, 1 level-ups in 2 sessions/);
  assert.match(ask('what level am I').answer, /^Ana is level 137 \(Ninja\)/);
  assert.match(ask('how many deaths this week').answer, /deaths? this week/);
});

test('an unknown question or item says so', () => {
  assert.match(ask('what is the meaning of life').answer, /^I don't know how to answer that yet/);
  assert.match(ask('price of Dragon Tooth').answer, /^I don't know an item called "dragon tooth"/);
});
