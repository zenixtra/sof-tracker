// The decoders for the game's data files, run against the real client files.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { CLIENT_DIR, GAME_DIR, gameOnly } = require('./helpers');
const { loadGameDb, readTable, diffDb } = require('../lib/gamedb');
const { readQuests } = require('../lib/quests');
const terrain = require('../lib/terrain');

let db = null;
const getDb = () => (db ||= loadGameDb(CLIENT_DIR, path.join(os.tmpdir(), `sof-test-gamedb-${process.pid}.json`)));
test.after(() => { try { fs.unlinkSync(path.join(os.tmpdir(), `sof-test-gamedb-${process.pid}.json`)); } catch { /* not created */ } });

test('items decode with sane names and stats', gameOnly, () => {
  const { items } = getDb();
  assert.ok(items.length > 5000, `only ${items.length} items`);
  const feather = items.find((i) => i.id === 1);
  assert.strictEqual(feather?.name, 'Feather Earring');
  assert.strictEqual(feather.level, 10);
  const printable = items.filter((i) => /^[\x20-\x7e\u0080-￿]+$/.test(i.name)).length;
  assert.ok(printable / items.length > 0.99, 'item names look garbled');
  assert.ok(items.some((i) => i.slot === 3 && i.atkMax > 0), 'no weapon has attack');
  assert.ok(items.some((i) => i.def > 0), 'no item has defense');
});

test('monsters, NPCs, skills and zones decode', gameOnly, () => {
  const d = getDb();
  assert.ok(d.monsters.length > 500 && d.monsters.find((m) => m.name === 'Bobcat')?.level === 3, 'monsters');
  assert.ok(d.npcs.length > 100 && d.npcs.some((n) => n.name === 'Lady Tae'), 'NPCs');
  assert.ok(d.skills.length > 300 && d.skills.every((s) => s.level <= 300), 'skills');
  assert.strictEqual(d.zones[101], 'Central Valley');
  assert.ok(Object.keys(d.zones).length > 50, 'zones');
});

test('NPC spots and portals (XOR tables) decode', gameOnly, () => {
  const rows = readTable(path.join(CLIENT_DIR, 'ybmapinfo.cfg'));
  assert.ok(rows.length > 10 && 'mapid' in rows[0] && 'nearmap' in rows[0]);
  const d = getDb();
  assert.ok(d.npcSpots.length > 200 && d.npcSpots.every((s) => Number.isFinite(s.x) && Number.isFinite(s.z)));
  assert.ok(d.portals.some((p) => p.zone === 101 && p.to === 201), 'Central Valley → Hill Valley exit missing');
});

test('every quest parses, with steps and rewards', gameOnly, () => {
  const quests = readQuests(CLIENT_DIR);
  assert.ok(quests.length > 500, `only ${quests.length} quests`);
  const promo = quests.find((x) => x.id === 11);
  assert.strictEqual(promo?.name, '[Promo] Being Member of Order');
  assert.strictEqual(promo.steps[0].items[0].id, 900000664);
  // exchange / event quests have no steps (about 5%); far more would mean the step layout changed
  assert.ok(quests.filter((x) => x.steps.length).length / quests.length > 0.85);
});

test('terrain grids read for the zones that have one', gameOnly, () => {
  const t = terrain.readTerrain(GAME_DIR, 101);
  assert.ok(t && t.n === 129 && t.heights.length === 129 * 129 && t.size === 5120);
  assert.ok(t.max > t.min, 'flat terrain');
});

test('database diff finds added, changed and removed records', () => {
  const a = { items: [{ id: 1, name: 'A', level: 1 }, { id: 2, name: 'B', level: 5 }], monsters: [], skills: [], quests: [], zones: { 101: 'X' } };
  const b = { items: [{ id: 2, name: 'B', level: 6 }, { id: 3, name: 'C', level: 1 }], monsters: [], skills: [], quests: [], zones: { 101: 'X', 201: 'Y' } };
  const d = diffDb(a, b);
  assert.deepStrictEqual(d.items.counts, { added: 1, removed: 1, changed: 1 });
  assert.deepStrictEqual(d.items.changed[0].diffs, [{ field: 'level', from: 5, to: 6 }]);
  assert.strictEqual(d.zones.counts.added, 1);
});
