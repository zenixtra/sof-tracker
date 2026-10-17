'use strict';

const test = require('node:test');
const assert = require('node:assert');
const gp = require('../lib/guideplan');
const KR = require('../public/krguide.js');

const H = 3600000, TZ = 'UTC';
const at = (h, m = 0) => Date.UTC(2026, 9, 14, h, m);

test('field bosses: the guide slot that is on and the next one, in server time', () => {
  assert.deepStrictEqual(gp.bossSlots(at(10, 30), TZ), { current: at(9), next: at(13) });   // 09:00 boss stays until 11:00
  assert.deepStrictEqual(gp.bossSlots(at(11, 30), TZ), { current: null, next: at(13) });
  assert.deepStrictEqual(gp.bossSlots(at(22), TZ).next, Date.UTC(2026, 9, 15, 9));          // tomorrow morning
  assert.strictEqual(gp.guideBossNames(KR).length, 11);
  assert.ok(gp.guideBossNames(KR).includes('Titan Tunneler'));                               // "(probably)" dropped
});

test('field bosses: one heads-up 10 minutes before, and none for a boss SoF already taught the tracker', () => {
  const alerts = [], g = new gp.GuideBosses({ guide: KR, onEvent: (...a) => alerts.push(a) });
  const cfg = { enabled: true, tz: TZ, learned: [{ boss: 'Yum Mun Gil', intervals: 3 }] };
  g.tick(at(12, 45), cfg); assert.strictEqual(alerts.length, 0);
  g.tick(at(12, 52), cfg); g.tick(at(12, 55), cfg);
  assert.strictEqual(alerts.length, 1);
  assert.match(alerts[0][1], /in about 8 min/);
  const v = g.view(at(12, 52), cfg);
  assert.deepStrictEqual(v.learned, ['Yum Mun Gil']);
  assert.ok(!v.names.includes('Yum Mun Gil'));
  g.tick(at(16, 55), { ...cfg, enabled: false }); assert.strictEqual(alerts.length, 1);
});

test('enhancing: chance, items and tries from the guide odds', () => {
  const high = gp.enhanceTiers(KR, 'high');
  assert.strictEqual(high.length, 5);
  assert.deepStrictEqual(high[0].odds.slice(5, 8), [95.4, 36, 32]);
  // two steps of 50 %: 25 % in one go → 4 items; per item 1 + 0.5 tries → 6 tries
  const p = gp.enhancePlan({ odds: [100, 100, 100, 100, 100, 100, 50, 50, 50, 50], from: 6, to: 8, stones: 2, prices: { stone: 10, charm: 100, fee: 5, item: 1000 } });
  assert.strictEqual(p.chance, 0.25);
  assert.strictEqual(p.items, 4);
  assert.strictEqual(p.tries, 6);
  assert.strictEqual(p.stones, 12);
  assert.strictEqual(p.cost, 6 * (2 * 10 + 100 + 5) + 3 * 1000);
  assert.deepStrictEqual(p.steps.map((s) => [s.level, s.p, s.reach, s.risky]), [[7, 0.5, 0.5, true], [8, 0.5, 0.25, true]]);
  // +1 and +2 always work and never break anything
  const easy = gp.enhancePlan({ odds: high[0].odds, from: 0, to: 2 });
  assert.deepStrictEqual([easy.chance, easy.tries, easy.cost, easy.steps.some((s) => s.risky)], [1, 2, null, false]);
  assert.strictEqual(gp.enhancePlan({ odds: [0, 0], from: 0, to: 1 }).items, null);
});

test('enhancing: your own results replace the guide odds once there are 5 tries', () => {
  const log = [...Array(4).fill({ level: 7, charm: 'high', ok: true }), { level: 7, charm: 'high', ok: false }, { level: 8, charm: 'high', ok: true }];
  const s = gp.enhanceStats(log);
  assert.deepStrictEqual(s.high[7], { tries: 5, ok: 4, rate: 0.8 });
  const odds = gp.ownOdds(gp.enhanceTiers(KR, 'high')[0].odds, s.high);
  assert.strictEqual(odds[6], 80);     // +7: 5 tries logged
  assert.strictEqual(odds[7], 32);     // +8: only 1, still the guide's
});

test('passes: a countdown starts in a training area, keeps running when you come back, warns at 10 and 1 min', () => {
  const alerts = []; let saved = null;
  const p = new gp.PassTimers({ read: () => null, save: (d) => { saved = d; }, onEvent: (...a) => alerts.push(a) });
  assert.strictEqual(p.zone(101, at(10)), null);                        // a normal field
  assert.strictEqual(p.zone(30100, at(10)).end, at(12));               // S.Forest Training area: 2 h
  assert.strictEqual(p.zone(30100, at(11)), null);                      // back in: same pass
  assert.strictEqual(p.zone(32105, at(11), { outer: 4 }).end, at(15)); // a dungeon with the 4-hour bracelet
  p.tick(at(11, 51)); p.tick(at(11, 52)); p.tick(at(11, 59, 30));
  assert.deepStrictEqual(alerts.map((a) => a[1]), ['Training Pass ends in 10 min', 'Training Pass ends in 1 min']);
  assert.ok(saved.training);
  p.tick(at(12, 2)); assert.ok(!p.data.training);                      // gone a minute after it ran out
  assert.deepStrictEqual(p.view(at(12, 2)).map((x) => x.kind), ['outer']);
  p.set('outer', 0); assert.deepStrictEqual(p.view(at(12, 2)), []);
});

test('buff run times: learned from runs seen from start to end, then a warning a minute before', () => {
  const alerts = [], b = new gp.BuffDurations({ read: () => null, save: () => {}, onEvent: (...a) => alerts.push(a) });
  b.look(at(10));
  b.ended({ id: 'icon:x', label: 'Pill', kind: 'buff', since: at(10), ms: 30 * 60000 });         // there at the first look: start unknown
  assert.strictEqual(b.expected('icon:x'), null);
  b.ended({ id: 'icon:x', label: 'Pill', kind: 'buff', since: at(10, 1), ms: 30 * 60000 });
  b.ended({ id: 'icon:x', label: 'Pill', kind: 'buff', since: at(10, 40), ms: 29.5 * 60000 });
  assert.strictEqual(b.expected('icon:x'), 29.75 * 60000);
  const act = b.active([{ id: 'icon:x', label: 'Pill', kind: 'buff', since: at(11, 30) }], at(11, 59, 20));
  assert.strictEqual(act[0].ends, at(11, 30) + 29.75 * 60000);
  b.active([{ id: 'icon:x', label: 'Pill', kind: 'buff', since: at(11, 30) }], at(11, 59, 30));
  assert.strictEqual(alerts.length, 1);
  b.look(at(13)); // a gap: what ends now may have ended any time
  b.ended({ id: 'icon:y', label: 'Other', kind: 'buff', since: at(12, 30), ms: 5 * 60000 });
  assert.ok(!b.data['icon:y']);
});

test('enhance results: the game\'s own texts (a little garbled is fine) and the server announcement', () => {
  assert.deepStrictEqual(gp.enhanceResult('The item enhancement has succeeded.'), { ok: true });
  assert.deepStrictEqual(gp.enhanceResult('The item enhancernent has failed'), { ok: false }); // OCR garbled the end of the word
  assert.deepStrictEqual(gp.enhanceResult('The item enhancement has failed.'), { ok: false });
  assert.deepStrictEqual(gp.enhanceResult('Successfully enhanced.'), { ok: true });
  assert.deepStrictEqual(gp.enhanceResult('Failed to enhance.'), { ok: false });
  assert.strictEqual(gp.enhanceResult('anyone selling enhance stones?'), null);
  assert.deepStrictEqual(gp.enhanceAnnouncement('It is amazing! Dragoon Dragon Blade enhanced Dragoon\'s grade up to 9.'), { who: 'Dragoon', item: 'Dragon Blade', level: 9 });
});

test('luck charms: which Korean grade your SoF charm behaves like', () => {
  const log = [];
  const add = (sofCharm, level, ok, n) => { for (let i = 0; i < n; i++) log.push({ sofCharm, level, ok }); };
  // +7 with the high grade is 36 %, mid 30 %, best 50 %: 5 of 10 worked → best
  add('Medium Charm of Luck', 7, true, 5); add('Medium Charm of Luck', 7, false, 5);
  add('Low Charm of Luck', 3, true, 9);   // +3 is 100 % for every grade at the lowest tier: says nothing
  const g = gp.charmGrades(log, KR);
  assert.deepStrictEqual(g.map((x) => [x.charm, x.tries, x.grade]), [['Low Charm of Luck', 9, null], ['Medium Charm of Luck', 10, 'best']]);
  assert.strictEqual(g[1].off, 0);
});

test('potions: what they cost per hour', () => {
  assert.deepStrictEqual(gp.potionCost(3000, 'Healing Salve (Large)', 250), { perHour: 10, cost: 2500 });
  assert.deepStrictEqual(gp.potionCost(3000, 'Healing Salve (Large)', null), { perHour: 10, cost: null });
  assert.strictEqual(gp.potionCost(200000, 'Healing Salve Package', 1e6).cost, 5e5);   // half a 400,000 pool
  assert.deepStrictEqual(gp.potionCost(0, 'Ginseng', 60), { perHour: 0, cost: 0 });
});

test('maze runs: EXP, kills and the debuffs of each part; a run ends 2 minutes after leaving', () => {
  let saved = null;
  const m = new gp.MazeRuns({ read: () => null, save: (d) => { saved = d; } });
  m.frame({ t: at(20), zone: 25100, exp: 10 });
  m.frame({ t: at(20, 1), zone: 25202, exp: 10, effects: [{ label: 'Attack down', kind: 'debuff' }, { label: 'Pill', kind: 'buff' }] });
  m.frame({ t: at(20, 2), zone: 25202, exp: 11.5, kill: true, effects: [{ label: 'Attack down', kind: 'debuff' }] });
  m.frame({ t: at(20, 20), zone: 25301, exp: 13 });
  assert.strictEqual(m.view().current.deepest, 1);
  m.frame({ t: at(20, 30), zone: 25100, exp: 13 });
  m.frame({ t: at(20, 33), zone: 25100, exp: 13 });
  const v = m.view((z) => `Z${z}`);
  assert.strictEqual(v.current, null);
  assert.strictEqual(v.runs.length, 1);
  assert.deepStrictEqual([v.runs[0].kills, Math.round(v.runs[0].exp * 10) / 10, v.runs[0].minutes], [1, 3, 19]);
  assert.deepStrictEqual(v.parts, [{ zone: 25202, name: 'Z25202', effects: [{ label: 'Attack down', looks: 2 }] }]);
  assert.ok(saved.runs.length === 1);
});

test('day plan: the next 24 hours in order', () => {
  const p = gp.dayPlan({ now: at(12), tz: TZ, guideBossNames: ['Yum Mun Gil'], learnedBosses: [{ boss: 'Liu', next: at(12, 40) }],
    checklist: [{ text: 'Feed pet', every: 'hours', nextReset: at(14) }], events: [{ name: 'Double EXP', start: at(18), end: at(22) }], passes: [{ label: 'Training Pass', end: at(13) }],
    playHours: [0, 0, 5] });
  assert.deepStrictEqual(p.items.map((x) => [new Date(x.t).getUTCHours(), x.kind]).slice(0, 6), [[12, 'boss'], [13, 'boss'], [13, 'pass'], [14, 'checklist'], [17, 'boss'], [18, 'event']]);
  assert.ok(p.items.every((x, i) => !i || x.t >= p.items[i - 1].t));
  assert.deepStrictEqual(p.playHours, [0, 0, 5]);
});

test('farming: potions are big HP / MP jumps between close looks, not a revive or a level-up', () => {
  const { Farming } = require('../lib/farming');
  const f = new Farming();
  const look = (t, hp, hpMax, mp = 500, mpMax = 1000) => f.frame({ t, exp: 10, hp, hpMax, mp, mpMax, zone: 501, x: 100, z: 100 });
  look(0, 5000, 7000);
  assert.strictEqual(look(3000, 5100, 7000).potHp, 0);    // regeneration
  assert.strictEqual(look(6000, 6100, 7000).potHp, 1000); // a potion
  look(9000, 0, 7000);
  assert.strictEqual(look(12000, 7000, 7000).potHp, 0);   // revived
  assert.strictEqual(look(15000, 3000, 7000).potHp, 0);
  assert.strictEqual(look(18000, 7500, 7500).potHp, 0);   // level-up: the bar grew
  assert.strictEqual(look(40000, 7500, 7500, 900).potMp, 0); // too long since the last look
  assert.deepStrictEqual([f.data.potHp, f.data.potMp || 0], [1000, 0]);
});

test('checklist: "every few hours" items are due again some hours after you tick them', () => {
  const { Checklist } = require('../lib/planner');
  const alerts = [], c = new Checklist({ read: () => null, save: () => {}, tz: TZ, onEvent: (...a) => alerts.push(a) });
  c.change({ action: 'add', text: 'Feed my pet', every: 'hours', hours: 3, remind: 0 });
  const id = c.data.items[0].id;
  assert.deepStrictEqual([c.view(at(10))[0].done, c.view(at(10))[0].nextReset], [false, null]);
  c.data.done[id] = at(10);
  assert.deepStrictEqual([c.view(at(12))[0].done, c.view(at(12))[0].nextReset], [true, at(13)]);
  c.tick(at(12, 59)); assert.strictEqual(alerts.length, 0);
  c.tick(at(13)); c.tick(at(13, 5));
  assert.deepStrictEqual(alerts.map((a) => a[1]), ['Due now: Feed my pet']);
});

test('guide places: the NPCs the guide sends you to, found in the game\'s NPC positions', () => {
  const npcs = [{ id: 1010, name: 'Gate of Training' }, { id: 243, name: 'Boatman Heo' }, { id: 5, name: 'Somebody' }];
  const spots = [{ zone: 101, npc: 1010, x: 969, z: 1255 }, { zone: 101, npc: 243, x: 569, z: 1025 }, { zone: 26000, npc: 243, x: 1, z: 2 }, { zone: 101, npc: 5, x: 0, z: 0 }];
  const p = gp.guidePlaces(spots, npcs);
  assert.deepStrictEqual(p.map((x) => [x.label, x.zone]), [['Gate of Training', '101'], ['Boatman Heo', '101']]); // the boatman only in Central Valley
  assert.ok(p.every((x) => x.owner === 'Korean guide' && x.note));
});

test('farming: your drops are kept per spot for the profit per hour', () => {
  const { Farming } = require('../lib/farming');
  const f = new Farming();
  f.addLoot({ zone: 501, x: 100, z: 100, itemId: 7 }); f.addLoot({ zone: 501, x: 120, z: 90, itemId: 7 }); f.addLoot({ zone: 501, x: 100, z: 100, itemId: null });
  assert.deepStrictEqual(Object.values(f.data.spots)[0].loot, { 7: 2 });
});

test('where to level: your measured spots first, then the guide areas for your level', () => {
  const zones = { 30200: 'Eastern MT Training area', 30300: 'Tiger Valley Training area', 30100: 'S.Forest Training area', 30000: 'North shore Training area', 501: 'Southern Forest' };
  const now = at(12);
  const r = gp.levelPlaces({ level: 112, guide: KR, zones, now,
    spots: [{ zone: 501, expPerHour: 9, minutes: 40, last: now - 86400000 }, { zone: 30200, expPerHour: 4, minutes: 20, last: now - 3600000 }],
    mobZones: [{ zone: 501, levels: [110, 111, 113, 60] }] });
  assert.deepStrictEqual(r.map((p) => [p.name, p.kind]).slice(0, 2), [['Southern Forest', 'Field'], ['Eastern MT Training area', 'Training area']]);
  assert.ok(r.some((p) => p.zone === 30300) && r.some((p) => p.zone === 30100));
  assert.ok(!r.some((p) => p.zone === 30000));                       // North shore is 60–105
});
