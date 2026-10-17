'use strict';

// lib/features/quests.js with a small fake game and tracker around it: the quest window, a quest handed in, Undo
const test = require('node:test');
const assert = require('node:assert');
const createQuests = require('../lib/features/quests');

const STEP = (npc, items = []) => ({ npc, npcName: `NPC ${npc}`, zone: 301, zoneName: 'Riverside Plains', x: 0, z: 0, items, goal: '' });
const DB = { quests: [
  { id: 1, name: 'Jade Tower bandits Key Point', level: 45, intro: '', rewards: [{ id: 909000001, qty: 500 }], steps: [{ npc: 16, zone: 301, px: 0, py: 0, items: [], goal: '' }] },
  { id: 2, name: 'Fame Symbol Exchange', level: 80, intro: '', rewards: [], steps: [{ npc: 161, zone: 101, items: [], goal: 'Participate in a weekly Single Fame match' }] },
], items: [], npcSpots: [] };

function setup() {
  const alerts = [], checklistItems = [], done = {}, questsDone = {};
  const files = {};
  const store = { readJson: (n, d) => (n in files ? files[n] : d), writeJson: (n, v) => { files[n] = JSON.parse(JSON.stringify(v)); } };
  const checklist = { data: { items: checklistItems }, change(b, char) { if (b.action === 'add') checklistItems.push({ id: `c${checklistItems.length}`, ...b }); if (b.action === 'toggle') done[`${b.id}|${b.char || char}`] = b.done; } };
  const view = (q) => ({ id: q.id, name: q.name, level: q.level, rewards: [], steps: [STEP(16)] });
  const q = createQuests({
    store, state: () => ({ session: { character: 'Ana', position: { zone: 301, x: 0, z: 0 } } }), feat: () => true,
    addAlert: (kind, title, body, extra) => { const a = { id: alerts.length + 1, kind, title, body, ...(extra || {}) }; alerts.push(a); return a; },
    debugCapture: () => {}, readerOk: () => {}, zoneName: (z) => `Zone ${z}`, playerInfo: () => ({ level: 50 }), gameIndex: () => ({ item: new Map() }), chatPrice: () => null,
    bestMatch: () => null, db: () => DB, checklist: () => checklist, questsDone: () => questsDone, alerts: () => alerts,
    views: () => ({ planRoute: () => ({ found: false }), questView: view }),
    questSearch: (p) => ({ quests: DB.quests.filter((x) => x.name === p.get('q')).map(view) }), others: () => new Map(), recentKills: () => [],
  });
  return { q, alerts, checklistItems, done, questsDone };
}

test('quest window: quests in progress, one handed in, Undo puts it back', () => {
  const { q, alerts, checklistItems, done, questsDone } = setup();
  q.onQuestWindow({ mode: 'progress', lines: ['[45] Jade Tower bandits Key Point', '[80] Fame Symbol Exchange'] }, 1000);
  assert.deepStrictEqual(q.activeQuestViews('Ana').map((v) => v.id), [1, 2]);
  assert.deepStrictEqual(checklistItems.map((c) => [c.quest, c.every]), [[2, 'weekly']]); // the weekly one is on the checklist
  // the Jade Tower quest is gone from the (fully visible) list: done
  q.onQuestWindow({ mode: 'progress', lines: ['[80] Fame Symbol Exchange'] }, 5000);
  assert.deepStrictEqual(questsDone.Ana, [1]);
  assert.strictEqual(q.questLog().length, 1);
  assert.deepStrictEqual([q.questLog()[0].start, q.questLog()[0].end, q.questLog()[0].exp], [1000, 5000, 500]);
  const a = alerts.find((x) => /^Quest done/.test(x.title));
  assert.ok(a.undo);
  assert.ok(q.undoAlert(a));
  assert.deepStrictEqual(questsDone.Ana, []);
  assert.strictEqual(q.questLog().length, 0);
  assert.ok(!q.undoAlert(a)); // only once
  // the weekly quest handed in: ticked on the checklist, not in the quest planner
  q.onQuestWindow({ mode: 'progress', lines: [] }, 9000);
  assert.strictEqual(done['c0|Ana'], true);
  assert.deepStrictEqual(questsDone.Ana, []);
});

test('quest window: the "Available Quest" tab and pickup patterns you teach', () => {
  const { q } = setup();
  q.onQuestWindow({ mode: 'available', lines: ['[45] Jade Tower bandits Key Point'] }, 1000);
  assert.deepStrictEqual(q.availableView('Ana').quests.map((x) => x.id), [1]);
  const re = q.learnPickup('You have looted 3 Wolf Fang.', 'Wolf Fang');
  assert.ok(q.pickupPatterns().some((p) => p.re === re));
  q.forgetPattern(re);
  assert.strictEqual(q.pickupPatterns().length, 0);
});
