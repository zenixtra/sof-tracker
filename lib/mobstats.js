// Per monster type you fight: kills, the exact EXP per kill (the chat's "Exp obtained" while you had it targeted),
// how long a kill takes from targeting it (with the game's monster HP: your damage per second), and EXP per hour of
// fighting it. Kill times before and after your last gear change show whether the new gear helped.
'use strict';

const GAP = 120000; // longer than this between two kills of the same type: you stopped fighting it

class MobStats {
  constructor({ read, save }) { this.data = read() || { chars: {} }; this.save = () => save(this.data); this.tgt = new Map(); this.dirty = false; }
  _c(char) { return (this.data.chars[String(char || '?').toLowerCase()] ||= { mobs: {} }); }
  // the monster you have targeted now (each look): a new target starts its kill clock
  target(char, id, t) {
    const k = String(char || '?').toLowerCase(), cur = this.tgt.get(k);
    if (!cur || cur.id !== id) this.tgt.set(k, { id, since: t });
  }
  // an EXP gain from a kill of that monster
  kill(char, id, exp, t) {
    const m = (this._c(char).mobs[id] ||= { kills: 0, exp: 0, ms: 0, lastAt: 0, times: [] });
    m.kills++; m.exp += exp || 0;
    if (m.lastAt && t - m.lastAt < GAP) m.ms += t - m.lastAt;
    m.lastAt = t;
    const k = String(char || '?').toLowerCase(), cur = this.tgt.get(k);
    if (cur && cur.id === id) {
      const d = t - cur.since;
      if (d >= 800 && d <= GAP) { m.times.push([t, d]); if (m.times.length > 200) m.times.shift(); }
      cur.since = t; // the next kill's clock starts now (the box shows the next monster of the same kind)
    }
    this.dirty = true;
  }
  flush() { if (this.dirty) { this.save(); this.dirty = false; } }
  // per monster: mobs { id → { name, level, hp } } from the game data; gearAt: when your gear last changed
  view(char, mobs, gearAt = null) {
    const med = (a) => { const x = a.slice().sort((p, q) => p - q); return x.length ? x[x.length >> 1] : null; };
    const out = [];
    for (const [id, m] of Object.entries(this._c(char).mobs)) {
      const info = mobs.get(+id) || {}, all = m.times.map((x) => x[1]);
      const before = gearAt ? m.times.filter((x) => x[0] < gearAt).map((x) => x[1]) : [], after = gearAt ? m.times.filter((x) => x[0] >= gearAt).map((x) => x[1]) : [];
      const sec = med(all) != null ? med(all) / 1000 : null;
      out.push({ id: +id, name: info.name || `Monster #${id}`, level: info.level ?? null, hp: info.hp ?? null, kills: m.kills,
        expPerKill: m.kills ? Math.round(m.exp / m.kills) : null, expPerHour: m.ms > 60000 ? Math.round(m.exp / (m.ms / 3600000)) : null,
        secPerKill: sec != null ? Math.round(sec * 10) / 10 : null, dps: sec && info.hp ? Math.round(info.hp / sec) : null,
        gear: before.length >= 3 && after.length >= 3 ? { before: Math.round(med(before) / 100) / 10, after: Math.round(med(after) / 100) / 10 } : null, lastAt: m.lastAt });
    }
    return out.sort((a, b) => (b.expPerHour ?? -1) - (a.expPerHour ?? -1) || b.kills - a.kills);
  }
}

module.exports = { MobStats };
