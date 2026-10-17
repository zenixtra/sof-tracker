// Daily / weekly checklist with resets in server time, and an iCalendar (.ics) feed of boss spawns, events,
// maintenance and checklist resets for calendar apps.
'use strict';

const { weekHour } = require('./social');
const H = 3600000;

// the latest / next moment an item resets: daily at resetHour, weekly on resetDay (Mon = 0) at resetHour, server time
function resetTimes(item, now, tz) {
  const matches = (t) => { const [d, h] = weekHour(t, tz); return h === item.resetHour && (item.every !== 'weekly' || d === item.resetDay); };
  const hour0 = Math.floor(now / H) * H;
  let last = null, next = null;
  for (let k = 0; k <= 24 * 8 && last == null; k++) if (matches(hour0 - k * H)) last = hour0 - k * H;
  for (let k = 1; k <= 24 * 8 && next == null; k++) if (matches(hour0 + k * H)) next = hour0 + k * H;
  return { last, next };
}

function cleanItem(b, old = {}) {
  const num = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const text = String(b.text ?? old.text ?? '').trim().slice(0, 80);
  if (!text) throw new Error('Give the item a name');
  return {
    id: old.id || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, text,
    every: ['weekly', 'hours'].includes(b.every ?? old.every) ? (b.every ?? old.every) : 'daily',
    resetHour: num(b.resetHour ?? old.resetHour, 0, 23, 0), resetDay: num(b.resetDay ?? old.resetDay, 0, 6, 0),
    hours: num(b.hours ?? old.hours, 1, 72, 3), // every: 'hours' — due again this long after you ticked it (feeding a pet…)
    remind: num(b.remind ?? old.remind, 0, 720, 60),
    perChar: !!(b.perChar ?? old.perChar), // ticked separately for every character (dailies on several accounts)
    // a repeatable quest the tracker added: ticked when the quest window shows it handed in
    ...(Number.isFinite(+(b.quest ?? old.quest)) && (b.quest ?? old.quest) != null ? { quest: +(b.quest ?? old.quest) } : {}),
  };
}

// a per-character item is ticked under "<id>|<character>"
const doneKey = (it, char) => (it.perChar ? `${it.id}|${String(char || '').toLowerCase()}` : it.id);

class Checklist {
  constructor({ read, save, tz, onEvent }) {
    this.tz = tz; this.save = () => save(this.data); this.onEvent = onEvent;
    this.data = read() || { items: [], done: {}, reminded: {} };
  }

  // one item's state for a character (only matters for per-character items)
  state(it, now, char) {
    const at = this.data.done[doneKey(it, char)] || null;
    if (it.every === 'hours') { const due = at ? at + it.hours * H : null; return { done: !!due && now < due, doneAt: at, nextReset: due }; }
    const { last, next } = resetTimes(it, now, this.tz);
    return { done: (at || 0) >= (last ?? Infinity), doneAt: at, nextReset: next };
  }

  // char: whose ticks per-character items show; chars: everyone, for the "who still has it to do" row
  view(now = Date.now(), char = null, chars = []) {
    return this.data.items.map((it) => ({ ...it, ...this.state(it, now, char), char: it.perChar ? char : null,
      byChar: it.perChar ? chars.map((c) => ({ name: c, done: this.state(it, now, c).done })) : undefined }));
  }

  change(b, char = null) {
    const items = this.data.items;
    if (b.action === 'add') items.push(cleanItem(b));
    else if (b.action === 'update') { const i = items.findIndex((x) => x.id === b.id); if (i < 0) throw new Error('not found'); items[i] = cleanItem(b, items[i]); }
    else if (b.action === 'delete') { this.data.items = items.filter((x) => x.id !== b.id); for (const k of Object.keys(this.data.done)) if (k === b.id || k.startsWith(`${b.id}|`)) delete this.data.done[k]; }
    else if (b.action === 'toggle') {
      const it = items.find((x) => x.id === b.id); if (!it) throw new Error('not found');
      const k = doneKey(it, b.char ?? char);
      if (b.done) this.data.done[k] = Date.now(); else delete this.data.done[k];
    }
    else if (b.action === 'move') { const i = items.findIndex((x) => x.id === b.id), j = i + (b.dir < 0 ? -1 : 1); if (i >= 0 && j >= 0 && j < items.length) [items[i], items[j]] = [items[j], items[i]]; }
    else throw new Error('bad action');
    this.save();
    return this.view(Date.now(), char);
  }

  // reminders: "X resets in 60 min" for unfinished items, once per reset; per-character items for each character
  // in the game right now (`chars`), named in the reminder
  tick(now = Date.now(), chars = []) {
    let changed = false;
    for (const it of this.data.items) {
      for (const c of it.perChar ? chars : [null]) {
        const st = this.state(it, now, c), key = doneKey(it, c), who = c ? ` (${c})` : '';
        // every few hours: a reminder `remind` minutes before it's due again (or when it's due, with remind 0)
        if (it.every === 'hours') {
          const due = st.nextReset;
          if (due && now >= due - it.remind * 60000 && this.data.reminded[key] !== due) {
            this.data.reminded[key] = due; changed = true;
            this.onEvent('checklist', now >= due ? `Due now: ${it.text}${who}` : `Due in ${Math.max(1, Math.round((due - now) / 60000))} min: ${it.text}${who}`, `every ${it.hours} h`);
          }
          continue;
        }
        if (st.done || !it.remind || !st.nextReset) continue;
        const left = st.nextReset - now;
        if (left > 0 && left <= it.remind * 60000 && this.data.reminded[key] !== st.nextReset) {
          this.data.reminded[key] = st.nextReset; changed = true;
          this.onEvent('checklist', `Not done yet: ${it.text}${who}`, `resets in ${Math.max(1, Math.round(left / 60000))} min`);
        }
      }
    }
    if (changed) this.save();
  }
}

// ---- iCalendar
const icsDate = (t) => new Date(t).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const fold = (line) => { const out = []; let s = line; while (s.length > 74) { out.push(s.slice(0, 74)); s = ` ${s.slice(74)}`; } out.push(s); return out.join('\r\n'); };

// events: [{ uid, start, end?, title, description?, url?, alarmMin? }]
function icsCalendar(events, name = 'SoF Tracker') {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SoF Tracker//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${icsText(name)}`, 'REFRESH-INTERVAL;VALUE=DURATION:PT30M'];
  const stamp = icsDate(Date.now());
  for (const e of events) {
    if (!Number.isFinite(e.start)) continue;
    lines.push('BEGIN:VEVENT', `UID:${icsText(e.uid)}@sof-tracker`, `DTSTAMP:${stamp}`, `DTSTART:${icsDate(e.start)}`, `DTEND:${icsDate(Number.isFinite(e.end) && e.end > e.start ? e.end : e.start + 15 * 60000)}`,
      `SUMMARY:${icsText(e.title)}`);
    if (e.description) lines.push(`DESCRIPTION:${icsText(e.description)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    if (e.alarmMin) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(e.title)}`, `TRIGGER:-PT${e.alarmMin}M`, 'END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

module.exports = { Checklist, resetTimes, icsCalendar, cleanItem };
