// Route planner, gear advisor, leveling plan and item details on a small made-up database.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createGameViews } = require('../lib/gameviews');
const { q } = require('./helpers');

const DB = {
  items: [
    { id: 1, name: 'Old Spear', level: 10, slot: 3, cls: 3, atkMin: 10, atkMax: 12, def: 0, price: 100 },
    { id: 2, name: 'Good Spear', level: 40, slot: 3, cls: 3, atkMin: 50, atkMax: 60, def: 0, price: 900 },
    { id: 3, name: 'Great Spear', level: 60, slot: 3, cls: 3, atkMin: 90, atkMax: 99, def: 0, price: 5000 },
    { id: 4, name: 'Event Spear (Event)', level: 40, slot: 3, cls: 3, atkMin: 500, atkMax: 600, def: 0, price: 0 },
    { id: 5, name: 'Blade of Somebody', level: 40, slot: 3, cls: 1, atkMin: 80, atkMax: 90, def: 0, price: 0 },
    { id: 909000001, name: 'EXP', level: 0, slot: 0, cls: 0, atkMin: 0, atkMax: 0, def: 0, price: 0 },
    { id: 7, name: 'Wolf Fang', level: 0, slot: 0, cls: 0, atkMin: 0, atkMax: 0, def: 0, price: 0 },
  ],
  monsters: [{ id: 10009, name: 'Wolf', level: 12, hp: 180 }],
  npcs: [{ id: 6, name: 'Lady Tae' }, { id: 124, name: 'Boatman' }],
  zones: { 101: 'Central Valley', 201: 'Hill Valley', 301: 'Riverside Plains', 5001: 'Northern Sea' },
  npcSpots: [{ zone: 101, npc: 6, x: 100, z: 2000, name: 'Lady Tae' }],
  portals: [
    { zone: 101, to: 201, how: 0, x: 2440, z: -336, npc: null }, { zone: 201, to: 101, how: 0, x: 2700, z: -300, npc: null },
    { zone: 101, to: 301, how: 0, x: -2350, z: -459, npc: null }, { zone: 301, to: 101, how: 0, x: -2700, z: -400, npc: null },
    { zone: 101, to: 5001, how: 1, x: 652, z: 1061, npc: 124 },
  ],
  quests: [
    { id: 1, name: 'Wolf Hunt', level: 38, classes: [0], intro: '', rewards: [{ id: 909000001, qty: 5000 }], steps: [{ npc: 6, zone: 101, px: 266, py: 56, goal: '', items: [{ id: 7, qty: 5, zone: 101, px: 300, py: 300, mob: 10009 }] }] },
    { id: 2, name: 'Far Away', level: 39, classes: [0], intro: '', rewards: [{ id: 909000001, qty: 9000 }], steps: [{ npc: 6, zone: 301, px: 256, py: 256, goal: '', items: [] }] },
    { id: 3, name: '[GM] Test', level: 38, classes: [0], intro: '', rewards: [{ id: 909000001, qty: 1e9 }], steps: [] },
  ],
};
const views = (over = {}) => createGameViews({
  db: () => DB, guide: () => ({ monsters: [] }), zoneMaps: () => ({ 101: { cx: 0, cz: 0 }, 201: { cx: 5120, cz: 0 }, 301: { cx: -5120, cz: 0 } }),
  zoneName: (z) => DB.zones[z] || `Zone ${z}`, trades: () => [{ item: 'Wolf Fang' }], questsDone: () => ({}),
  position: () => ({ zone: 101, x: 0, z: 0 }), character: () => 'Me', levelOf: () => 40, isRealZone: (z) => z < 1e6, ...over,
});

test('route through one exit to an NPC in another zone', () => {
  const r = views({ position: () => ({ zone: 201, x: 5000, z: 0 }) }).routeRequest(q({ npc: 6 }));
  assert.ok(r.found);
  assert.strictEqual(r.hops, 1);
  assert.deepStrictEqual(r.legs.map((l) => l.zone), [201, 101]);
  assert.strictEqual(r.legs[1].label, 'Lady Tae');
  assert.strictEqual(r.legs[0].via, 'exit');
});

test('NPC teleports are routes too', () => {
  const r = views().routeRequest(q({ toZone: 5001 }));
  assert.ok(r.found);
  assert.strictEqual(r.legs[0].via, 'npc');
  assert.match(r.legs[0].label, /^Boatman → Northern Sea$/);
});

test('no route without a position or to an unknown zone', () => {
  assert.strictEqual(views({ position: () => null }).routeRequest(q({ toZone: 201 })).reason, 'no-position');
  assert.strictEqual(views().routeRequest(q({ toZone: 777 })).found, false);
});

test('gear advisor: best item for the level and class, events left out, next upgrade', () => {
  const weapon = views().gearAdvice(q({ cls: 3, level: 45 })).find((s) => s.slot === 3);
  assert.strictEqual(weapon.best[0].name, 'Good Spear');
  assert.strictEqual(weapon.next.name, 'Great Spear');
  const withEvents = views().gearAdvice(q({ cls: 3, level: 45, events: 1 })).find((s) => s.slot === 3);
  assert.strictEqual(withEvents.best[0].name, 'Event Spear (Event)');
});

test('leveling plan: EXP quests, this zone first, GM quests left out', () => {
  const plan = views().levelingPlan(q({ level: 40 }));
  assert.deepStrictEqual(plan.quests.map((x) => x.name), ['Wolf Hunt', 'Far Away']);
  assert.strictEqual(plan.quests[0].hops, 0);
  assert.strictEqual(plan.quests[1].total, 14000);
});

test('quest coordinates (minimap pixels) become world coordinates', () => {
  const v = views();
  assert.deepStrictEqual(v.pxToWorld(101, 256, 256), { x: 0, z: 0 });
  assert.deepStrictEqual(v.pxToWorld(201, 266, 56), { x: 5220, z: 2000 });
});

test('item details: dropped by, needed for, in your trades', () => {
  const it = views().itemInfo(q({ name: 'wolf fang' }));
  assert.strictEqual(it.dropsFrom[0].name, 'Wolf');
  assert.strictEqual(it.neededBy[0].name, 'Wolf Hunt');
  assert.strictEqual(it.traded, 1);
  assert.deepStrictEqual(views().gameIndex().spots.get(10009)[0], { zone: 101, x: 440, z: -440, drop: 'Wolf Fang' });
});
