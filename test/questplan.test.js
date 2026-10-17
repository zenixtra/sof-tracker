'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { collectItems, parsePickup, QuestProgress, questStops, orderStops, rankAvailable, ExpSplit, repeatKind, questHistory, pickupPattern } = require('../lib/questplan');

// shaped like gameviews.questView
const JADE = { id: 530, name: 'Jade Tower bandits- Empire Building', level: 44, rewards: [], steps: [
  { npc: 12, npcName: 'Lady Jolie', zone: 301, x: -7080, z: 50, items: [] },
  { npc: 16, npcName: 'Jeno', zone: 301, x: -7130, z: 70, items: [{ id: 900000684, name: 'Jade Tower bandits Paper', qty: 3, mob: null, zone: 301, zoneName: 'Riverside Plains', x: -3590, z: 2260 }] },
  { npc: 16, npcName: 'Jeno', zone: 301, x: -7130, z: 70, items: [] }] };
const FAME = { id: 388, name: 'Fame Symbol Exchange', level: 80, rewards: [], steps: [
  { npc: 161, npcName: 'Fame Manager Kwan', zone: 101, x: 1040, z: 1530, items: [{ id: 900000785, name: 'Fame Token', qty: 1, mob: null, zone: 101, x: 1040, z: 1550 }] },
  { npc: 161, npcName: 'Fame Manager Kwan', zone: 101, x: 1040, z: 1540, items: [] }] };

test('quest items you collect: not the ones the NPC hands you', () => {
  assert.deepStrictEqual(collectItems(JADE).map((i) => [i.itemId, i.need, i.npc]), [[900000684, 3, 'Jeno']]);
  assert.deepStrictEqual(collectItems(FAME), []);
});

test('pickup lines from the chat, never party announcements', () => {
  assert.deepStrictEqual(parsePickup('You have obtained [Wolf Fang] x3'), { name: 'Wolf Fang', qty: 3 });
  assert.deepStrictEqual(parsePickup('Acquired Jade Tower bandits Paper.'), { name: 'Jade Tower bandits Paper', qty: 1 });
  assert.strictEqual(parsePickup("Announcements: Ali's party member has gotten [Spear] from Dof"), null);
  assert.strictEqual(parsePickup('hello there'), null);
});

test('quest progress: kills near the spot, pickups, "hand it in" once complete', () => {
  const alerts = [];
  const p = new QuestProgress({ read: () => null, save: () => {}, onEvent: (k, title, body) => alerts.push(title + ' | ' + body) });
  p.sync('Ana', [JADE, FAME], 1);
  assert.strictEqual(p.kill('Ana', { zone: 301, x: -3500, z: 2300 }, [JADE]), 1);
  assert.strictEqual(p.kill('Ana', { zone: 301, x: 0, z: 0 }, [JADE]), 0); // far from the spot
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  p.pickup('Ana', { name: 'Jade Tower bandits Paper', qty: 2 }, [JADE], same);
  assert.strictEqual(alerts.length, 0);
  p.pickup('Ana', { name: 'Jade Tower bandits Paper', qty: 1 }, [JADE], same);
  assert.match(alerts[0], /Quest items complete: Jade Tower.*Jeno/);
  const v = p.view('Ana', [JADE]);
  assert.deepStrictEqual([v[0].items[0].picked, v[0].items[0].kills, v[0].ready], [3, 1, true]);
  assert.ok(p.set('Ana', '530', '900000684', 1));
  assert.strictEqual(p.view('Ana', [JADE])[0].ready, false);
  p.sync('Ana', [FAME], 2); // the Jade Tower quest is gone
  assert.deepStrictEqual(p.view('Ana', [JADE]), []);
});

test('quest trip: collect before the hand-in, nearest stop first', () => {
  const stops = questStops([JADE, FAME], []);
  assert.deepStrictEqual(stops.map((s) => s.kind), ['collect', 'handin', 'talk']);
  const cost = (a, b) => (String(a.zone) === String(b.zone) ? Math.hypot(a.x - b.x, a.z - b.z) : 10000);
  // starting next to Jeno: the items first anyway, then back to Jeno, then the other zone
  const r = orderStops({ zone: 301, x: -7130, z: 70 }, stops, cost);
  assert.deepStrictEqual(r.stops.map((s) => s.kind), ['collect', 'handin', 'talk']);
  // with the items already picked up: straight to Jeno
  const r2 = orderStops({ zone: 301, x: -7130, z: 70 }, questStops([JADE], [{ id: 530, items: [{ itemId: 900000684, picked: 3, need: 3 }] }]), cost);
  assert.deepStrictEqual(r2.stops.map((s) => s.kind), ['handin']);
});

test('available quests ranked: EXP, a chain, far-under-level quests last', () => {
  const q = (id, level, rewards = []) => ({ id, name: `Q${id}`, level, rewards });
  const r = rankAvailable([{ q: q(1, 40), exp: 1000 }, { q: q(2, 90), exp: 900 }, { q: q(3, 20), exp: 2000 }, { q: q(4, 88), exp: 0, followUps: 2 }], 92);
  assert.strictEqual(r[0].id, 4); // a chain of 2
  assert.ok(r.find((x) => x.id === 1).why.includes('low'));
  assert.ok(r.findIndex((x) => x.id === 2) < r.findIndex((x) => x.id === 1));
});

test('EXP split: a big gain next to an NPC is a quest', () => {
  const s = new ExpSplit();
  for (let i = 0; i < 10; i++) assert.strictEqual(s.classify(0.2), 'mob');
  assert.strictEqual(s.classify(3, { nearNpc: false }), 'mob');
  assert.strictEqual(s.classify(3, { nearNpc: true }), 'quest');
  assert.strictEqual(s.classify(0.25, { nearNpc: true }), 'mob');
  assert.strictEqual(s.classify(35, { nearNpc: false }), null); // a misread
});

test('kills left: learned from your own pickups, with minutes at your pace', () => {
  const p = new QuestProgress({ read: () => null, save: () => {} });
  const big = { ...JADE, steps: JADE.steps.map((s) => ({ ...s, items: s.items.map((i) => ({ ...i, qty: 10 })) })) };
  p.sync('Ana', [big], 1);
  for (let i = 0; i < 8; i++) p.kill('Ana', { zone: 301, x: -3590, z: 2260 }, [big]);
  p.set('Ana', '530', '900000684', 2);
  const it = p.view('Ana', [big], 2)[0].items[0];
  assert.deepStrictEqual([it.killsPerItem, it.killsLeft, it.minutesLeft], [4, 32, 16]);
  // finished: what it learned stays for the next quest asking for the same item
  p.sync('Ana', [], 2); p.sync('Ana', [big], 3);
  assert.strictEqual(p.view('Ana', [big])[0].items[0].killsLeft, null); // only 2 learned pickups: not enough yet
  assert.strictEqual(p.killsPerItem('900000684', { picked: 0, kills: 0 }), null);
});

test('repeatable quests: weekly, daily, not the rest', () => {
  assert.strictEqual(repeatKind({ intro: 'x', steps: [{ goal: 'Participate in a weekly Single Fame match' }] }), 'weekly');
  assert.strictEqual(repeatKind({ intro: '*This quest is available daily', steps: [] }), 'daily');
  assert.strictEqual(repeatKind({ intro: 'See Woody once a day!', steps: [] }), 'daily');
  assert.strictEqual(repeatKind({ intro: 'You may rent them daily.', steps: [] }), null);
  assert.strictEqual(repeatKind({ intro: 'Kill the bandits', steps: [{ goal: 'Go to Jeno' }] }), null);
});

test('quest history: time per quest, per level range, slow ones', () => {
  const M = 60000;
  const rows = [{ char: 'Ana', id: 1, name: 'A', level: 41, start: 0, end: 30 * M, exp: 3000 }, { char: 'Ana', id: 2, name: 'B', level: 45, start: 0, end: 10 * M, exp: 9000 },
    { char: 'Ana', id: 3, name: 'C', level: 52, start: null, end: 5 * M, exp: 100 }, { char: 'Bo', id: 4, name: 'D', level: 41, start: 0, end: M, exp: 1 }];
  const h = questHistory(rows, 'ana');
  assert.strictEqual(h.done, 3);
  assert.deepStrictEqual(h.bands.map((b) => [b.from, b.n, b.avgMinutes]), [[40, 2, 20]]);
  assert.deepStrictEqual(h.slow.map((s) => [s.name, s.expPerMin]), [['A', 100], ['B', 900]]);
  assert.strictEqual(h.rows.find((r) => r.id === 3).minutes, null);
});

test('pickup messages you teach: the item and the amount come out of new lines', () => {
  const re = pickupPattern('You have looted 3 Wolf Fang.', 'Wolf Fang');
  assert.deepStrictEqual(parsePickup('You have looted 12 Zombie Cat sample.', [{ re }]), { name: 'Zombie Cat sample', qty: 12 });
  const re2 = pickupPattern('[System] Wolf Fang was put in your bag (1)', 'Wolf Fang');
  assert.deepStrictEqual(parsePickup('[System] UnJung supply was put in your bag (1)', [{ re: re2 }]), { name: 'UnJung supply', qty: 1 });
  assert.throws(() => pickupPattern('You got it', 'Wolf Fang'));
});
