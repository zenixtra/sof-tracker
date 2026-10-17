'use strict';

const test = require('node:test');
const assert = require('node:assert');
const p = require('../lib/plans');

const H = 3600000, DAY = 86400000, TZ = 'UTC';
const at = (d, h, m = 0) => Date.UTC(2026, 9, d, h, m); // 2026-10-12 is a Monday

test('own events: the next start on the right weekday, reminders before and at the start', () => {
  assert.strictEqual(p.nextOccurrence({ days: [], hour: 13, minute: 20 }, at(15, 12), TZ), at(15, 13, 20));
  assert.strictEqual(p.nextOccurrence({ days: [], hour: 13, minute: 20 }, at(15, 14), TZ), at(16, 13, 20));
  assert.strictEqual(p.nextOccurrence({ days: [5], hour: 20, minute: 0 }, at(15, 12), TZ), at(17, 20)); // Saturday
  const alerts = []; let saved = null;
  const ev = new p.CustomEvents({ read: () => null, save: (d) => { saved = d; }, tz: TZ, onEvent: (...a) => alerts.push(a) });
  ev.change({ action: 'preset', index: 0 }); ev.change({ action: 'preset', index: 0 }); // both times, added once
  assert.strictEqual(saved.length, 2);
  ev.tick(at(15, 13, 5)); ev.tick(at(15, 13, 12)); ev.tick(at(15, 13, 20)); ev.tick(at(15, 13, 20, 30));
  assert.deepStrictEqual(alerts.map((a) => a[1]), ['Extreme duel stage in 8 min', 'Extreme duel stage now']);
  assert.throws(() => ev.change({ action: 'add', name: ' ' }), /name/);
});

test('boss sign-ups: who is coming to a slot, and toggling yours', () => {
  const slot = { t: at(15, 17), label: 'Field bosses (Korean guide times)' };
  let mine = p.toggleSignup([], slot, true, at(15, 12));
  const friends = [{ t: at(15, 17, 5), label: 'field bosses (korean guide times)', from: 'Ana' }, { t: at(15, 21), label: slot.label, from: 'Bo' }, { t: at(15, 17), label: 'Liu', from: 'Cy' }];
  assert.deepStrictEqual(p.coming(slot, mine, friends), ['you', 'Ana']);
  mine = p.toggleSignup(mine, slot, false, at(15, 12));
  assert.deepStrictEqual(p.coming(slot, mine, friends), ['Ana']);
  assert.deepStrictEqual(p.toggleSignup([{ t: at(14, 1), label: 'old' }], slot, false, at(15, 12)), []); // past ones are dropped
});

test('Honor: rank, next rank, pace and when you get there (at most 1,000 a day)', () => {
  const now = at(15, 12);
  const h = p.honorProgress(40000, [{ t: now - 7 * DAY, honor: 33000 }, { t: now - 3 * DAY, honor: 37000 }, { t: now, honor: 40000 }], now);
  assert.deepStrictEqual([h.rank, h.next.rank, h.next.toGo, h.perDay, h.etaDays], [3, 4, 10001, 1000, 11]);
  assert.strictEqual(h.next.pct, Math.round(((40000 - 15001) / (50001 - 15001)) * 100));
  assert.strictEqual(p.honorProgress(6e6).next, null);
  assert.strictEqual(p.honorProgress(null), null);
});

test('Ascension: what the next one needs and how close you are', () => {
  const a = p.ascProgress({ level: 115, exp: 40, asc: 1, have: { gold: 1e8, ki: 5e6, stones: 60 }, expPerHour: 5 });
  assert.strictEqual(a.next.asc, 2);
  assert.deepStrictEqual([a.level.toGo, a.level.hours], [5, (500 - 40) / 5]);
  assert.deepStrictEqual([a.gold.pct, a.ki.pct, a.stones.pct, a.ready], [50, 100, 100, false]);
  assert.strictEqual(p.ascProgress({ level: 120, asc: 1, have: { gold: 2e8, ki: 5e6, stones: 50 } }).ready, true);
  assert.strictEqual(p.ascProgress({ level: 175, asc: 7 }).done, true);
});

test('price times: cheapest weekday / time to buy, best to sell', () => {
  const now = at(30, 12), off = [];
  const add = (d, h, side, price) => off.push({ t: Date.UTC(2026, 9, d, h) + new Date().getTimezoneOffset() * 60000, side, price });
  add(19, 10, 'sell', 100); add(26, 10, 'sell', 110);   // Mondays, morning: cheap
  add(24, 21, 'sell', 200); add(17, 21, 'sell', 220);   // Saturdays, evening: dear
  add(24, 22, 'buy', 180); add(17, 22, 'buy', 170); add(19, 9, 'buy', 90); add(26, 9, 'buy', 95);
  const r = p.priceTimes(off, now);
  assert.strictEqual(r.offers, 8);
  assert.deepStrictEqual([r.buyAt.day.day, r.buyAt.day.price], ['Mon', 105]);
  assert.deepStrictEqual([r.sellAt.day.day, r.sellAt.day.price], ['Sat', 175]);
  assert.strictEqual(r.buyAt.block.block, '08–12');
  assert.strictEqual(r.sellAt.block.block, '20–24');
  assert.strictEqual(p.priceTimes([], now).buyAt.day, null);
});

test('party finder: LF posts with class, levels and zone; trade posts are not parties', () => {
  const zones = [{ id: 6001, name: 'Southern Forest' }, { id: 25100, name: 'Tiger Valley' }];
  assert.deepStrictEqual(p.lfgParse('LF healer 120+ SF', zones), { classes: ['Healer'], levels: [120, 200], zone: { id: 6001, name: 'Southern Forest' } });
  assert.deepStrictEqual(p.lfgParse('LFM Tiger Valley 125-135 need busker', zones), { classes: ['Busker'], levels: [125, 135], zone: { id: 25100, name: 'Tiger Valley' } });
  assert.strictEqual(p.lfgParse('wts healer pill 5m', zones), null);
  assert.strictEqual(p.lfgParse('hello everyone', zones), null);
  const post = p.lfgParse('LF healer 120+', zones);
  assert.ok(p.lfgFits(post, { level: 130, cls: 'Healer' }));
  assert.ok(!p.lfgFits(post, { level: 130, cls: 'Blade' }));
  assert.ok(!p.lfgFits(post, { level: 110, cls: 'Healer' }));
  assert.ok(p.lfgFits(p.lfgParse('LFG anyone', zones), { level: 50, cls: 'Bow' }));
});

test('goals: progress, on pace or behind, what you need per day', () => {
  const g = { target: 140, by: at(22, 12), start: { t: at(15, 12), value: 133 } };
  const mid = p.goalPace(g, 137, at(18, 12)); // 3 of 7 days gone: should be at 136
  assert.deepStrictEqual([mid.onPace, mid.expected, mid.pct, mid.daysLeft], [true, 136, 57, 4]);
  assert.strictEqual(mid.perDayNeeded, 0.75);
  const late = p.goalPace(g, 134, at(20, 12));
  assert.deepStrictEqual([late.onPace, late.done, late.overdue], [false, false, false]);
  assert.deepStrictEqual([p.goalPace(g, 141, at(23, 1)).done, p.goalPace(g, 139, at(23, 1)).overdue], [true, true]);
});

test('checklist: per-character items are ticked and reminded for each character', () => {
  const { Checklist } = require('../lib/planner');
  const alerts = [], c = new Checklist({ read: () => null, save: () => {}, tz: TZ, onEvent: (...a) => alerts.push(a) });
  c.change({ action: 'add', text: 'Daily boss', every: 'daily', resetHour: 0, remind: 60, perChar: true });
  const id = c.data.items[0].id;
  c.change({ action: 'toggle', id, done: true }, 'Ana');
  const v = c.view(at(15, 12), 'Ana', ['Ana', 'Bo']);
  assert.deepStrictEqual([v[0].done, v[0].byChar], [true, [{ name: 'Ana', done: true }, { name: 'Bo', done: false }]]);
  assert.strictEqual(c.view(at(15, 12), 'Bo')[0].done, false);
  c.tick(at(15, 23, 30), ['Ana', 'Bo']);
  assert.deepStrictEqual(alerts.map((a) => a[1]), ['Not done yet: Daily boss (Bo)']);
});

test('daily counters: added per day, summed over a range', () => {
  const d = new p.DailyStats({ read: () => null, save: () => {}, dayOf: (t) => new Date(t).toISOString().slice(0, 10) });
  d.add(at(13, 10), { potHp: 900, enhOk: 1 }); d.add(at(14, 10), { potHp: 600, enhFail: 1, mazeRuns: 1, mazeExp: 2.5 }); d.add(at(20, 10), { potHp: 1 });
  assert.deepStrictEqual(d.range(at(12, 0), at(19, 0)), { potHp: 1500, enhOk: 1, enhFail: 1, mazeRuns: 1, mazeExp: 2.5 });
});
