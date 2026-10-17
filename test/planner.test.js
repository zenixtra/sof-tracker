'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { Checklist, resetTimes, icsCalendar } = require('../lib/planner');

const TZ = 'America/Los_Angeles';

test('daily reset at midnight server time, also across daylight saving', () => {
  // 2026-10-14 10:30 PDT = 17:30 UTC; last reset 2026-10-14 00:00 PDT = 07:00 UTC, next 2026-10-15 07:00 UTC
  const now = Date.UTC(2026, 9, 14, 17, 30);
  const { last, next } = resetTimes({ every: 'daily', resetHour: 0 }, now, TZ);
  assert.strictEqual(new Date(last).toISOString(), '2026-10-14T07:00:00.000Z');
  assert.strictEqual(new Date(next).toISOString(), '2026-10-15T07:00:00.000Z');
  // after the switch to PST (Nov 1) midnight is 08:00 UTC
  const winter = resetTimes({ every: 'daily', resetHour: 0 }, Date.UTC(2026, 10, 3, 12), TZ);
  assert.strictEqual(new Date(winter.last).toISOString(), '2026-11-03T08:00:00.000Z');
});

test('weekly reset on the chosen day', () => {
  const now = Date.UTC(2026, 9, 14, 17, 30); // Wednesday
  const { last, next } = resetTimes({ every: 'weekly', resetDay: 0, resetHour: 9 }, now, TZ); // Monday 09:00 PDT
  assert.strictEqual(new Date(last).toISOString(), '2026-10-12T16:00:00.000Z');
  assert.strictEqual(new Date(next).toISOString(), '2026-10-19T16:00:00.000Z');
});

test('checklist: done until the next reset, reminder once per reset', () => {
  let saved = null; const events = [];
  const c = new Checklist({ read: () => null, save: (d) => { saved = d; }, tz: 'UTC', onEvent: (k, t, b) => events.push(`${t} | ${b}`) });
  const [item] = c.change({ action: 'add', text: 'Daily boss', every: 'daily', resetHour: 0, remind: 60 });
  assert.ok(saved && !item.done);
  c.change({ action: 'toggle', id: item.id, done: true });
  assert.strictEqual(c.view()[0].done, true);
  // pretend it was done before the last reset
  c.data.done[item.id] = resetTimes(item, Date.now(), 'UTC').last - 1000;
  assert.strictEqual(c.view()[0].done, false);
  const next = c.view()[0].nextReset;
  c.tick(next - 30 * 60000); c.tick(next - 20 * 60000);
  assert.deepStrictEqual(events, ['Not done yet: Daily boss | resets in 30 min']);
  assert.throws(() => c.change({ action: 'add', text: '  ' }));
});

test('calendar feed is valid iCalendar with escaped text and alarms', () => {
  const ics = icsCalendar([{ uid: 'boss-1', start: Date.UTC(2026, 9, 14, 20), title: 'Boss, maybe; soon', alarmMin: 10 }]);
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART:20261014T200000Z/);
  assert.match(ics, /SUMMARY:Boss\\, maybe\\; soon/);
  assert.match(ics, /TRIGGER:-PT10M/);
  assert.ok(ics.split('\r\n').every((l) => l.length <= 75));
});
