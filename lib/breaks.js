// "Time for a break": a reminder after playing a while without a pause.
// A pause is the game closed, or no movement / skill use / map change, for `pauseMin` minutes.
'use strict';

class BreakWatch {
  constructor({ read, save }) {
    this.d = { since: null, lastAct: 0, nags: 0, ...(read() || {}) };
    this.save = () => save(this.d);
  }
  // running: a game window is open; lastActiveAt: the last time you did something in it.
  // Returns { ms, nag } when a reminder is due (first after everyMin, then every repeatMin), else null.
  tick(now, { running, lastActiveAt }, { everyMin, pauseMin = 10, repeatMin = 30 }) {
    const d = this.d;
    const act = running && lastActiveAt ? Math.min(now, lastActiveAt) : null;
    if (act && act > d.lastAct) d.lastAct = act;
    if (d.since != null && now - d.lastAct >= pauseMin * 60000) { d.since = null; d.nags = 0; this.save(); }
    if (d.since == null && act && now - act < 60000) { d.since = act; d.nags = 0; this.save(); }
    if (d.since == null || !everyMin || now - d.lastAct >= 60000) return null; // no reminders while you're away
    const ms = now - d.since;
    if (ms < (everyMin + d.nags * repeatMin) * 60000) return null;
    d.nags++; this.save();
    return { ms, nag: d.nags };
  }
  // the current run of play, for the Live card
  view(now) { return this.d.since != null ? { since: this.d.since, ms: now - this.d.since } : null; }
}

module.exports = { BreakWatch };
