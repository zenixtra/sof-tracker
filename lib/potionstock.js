// Potion and ginseng stock, from the counts on the hotbar (screenreader.ps1 reads the icons and their numbers):
//  - a count is believed only when two looks in a row agree (the small digits are sometimes misread)
//  - going up = you bought or picked up more: a new batch starts
//  - per batch: how many were used and over how much play (gaps of over 5 minutes between looks don't count),
//    so "your last 300 pills lasted 2h 10m" and "~45 min left at this pace"
//  - an alert once when the count drops below the limit (again after a restock)
'use strict';

const GAP = 5 * 60000;

class PotionStock {
  constructor({ read, save }) {
    this.d = { chars: {}, ...(read() || {}) }; // chars: { name: { items: { id: item } } }
    this.save = () => save(this.d);
    this.dirty = false;
  }
  item(char, id) {
    const c = (this.d.chars[String(char).toLowerCase()] ||= { name: char, items: {} });
    return (c.items[id] ||= { id, name: null, slot: null, count: null, seenAt: 0, pending: null, batch: null, batches: [], warned: false });
  }
  // one full look's hotbar: [{ id, name, slot, count }] (count null when unreadable). Returns alerts: [{ id, name, count, limit }]
  update(char, t, slots, limit = 0) {
    const out = [];
    if (!char) return out;
    for (const s of slots) {
      if (!Number.isInteger(s.count) || s.count < 0 || s.count > 9999) continue;
      const it = this.item(char, s.id);
      it.name = s.name || it.name; it.slot = s.slot || it.slot;
      // believed when the same number is read twice in a row (or it is one less / the same as before: normal use)
      const steady = it.count != null && s.count <= it.count && it.count - s.count <= 30;
      if (!steady && (!it.pending || it.pending.count !== s.count)) { it.pending = { count: s.count, t }; continue; }
      it.pending = null;
      this.accept(it, t, s.count, limit, out);
    }
    return out;
  }
  accept(it, t, n, limit, out) {
    const prev = it.count;
    const b = it.batch;
    if (prev == null || n > prev || !b) {
      // a restock (or the first reading): the old batch is done
      if (b && b.used > 0) { it.batches.unshift({ start: b.start, end: b.end, from: b.from, used: b.used, playMs: b.playMs }); it.batches = it.batches.slice(0, 20); }
      it.batch = { start: t, end: t, from: n, used: 0, playMs: 0 };
      it.warned = false; // (a new batch: alert again once it is below the limit, also right away)
    } else {
      if (t - b.end <= GAP) b.playMs += t - b.end; // play time, not time away
      b.used += prev - n; b.end = t;
    }
    it.count = n; it.seenAt = t; this.dirty = true;
    if (limit > 0 && n < limit && !it.warned) { it.warned = true; out.push({ id: it.id, name: it.name, count: n, limit, slot: it.slot }); }
  }
  // per character: what is on the hotbar now, usage per hour of play, time left, how long earlier batches lasted
  view(char, now = Date.now()) {
    const c = this.d.chars[String(char || '').toLowerCase()];
    if (!c) return [];
    return Object.values(c.items).filter((it) => it.count != null).map((it) => {
      const b = it.batch, perHour = b && b.playMs >= 5 * 60000 && b.used > 0 ? b.used / (b.playMs / 3600000) : null;
      return {
        id: it.id, name: it.name, slot: it.slot, count: it.count, seenAt: it.seenAt, stale: now - it.seenAt > 10 * 60000,
        batch: b ? { from: b.from, used: b.used, playMs: b.playMs, start: b.start } : null,
        perHour: perHour != null ? Math.round(perHour) : null, leftMs: perHour ? (it.count / perHour) * 3600000 : null,
        last: it.batches.slice(0, 5).map((x) => ({ used: x.used, playMs: x.playMs, from: x.from, end: x.end, perHour: x.playMs >= 5 * 60000 ? Math.round(x.used / (x.playMs / 3600000)) : null })),
      };
    }).sort((a, b) => String(a.slot).localeCompare(String(b.slot), undefined, { numeric: true }));
  }
  flush() { if (this.dirty) { this.save(); this.dirty = false; } }
}

module.exports = { PotionStock };
