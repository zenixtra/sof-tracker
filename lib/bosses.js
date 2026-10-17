// Boss spawn history and predictions, built from the server's own notices
// ("... will appear after 5 min ...", "Field boss X has spawned!!", "... is caught.").
'use strict';

const store = require('./store');

const FILE = 'bosses.jsonl';
const CLUSTER_MS = 20 * 60000; // announcements this close together belong to one spawn

function bossName(text) {
  let m = /Field Boss (.+?) will spawn/i.exec(text) || /Field boss (.+?) has spawned/i.exec(text);
  if (m) return m[1].trim();
  if (/Premier Liu/i.test(text)) return 'Tribulation Premier Liu';
  m = /^(?:A |The )?(.{3,40}?) (?:will appear|has appeared|has spawned|appears|is caught|was caught)/i.exec(text);
  return m ? m[1].replace(/^.*thief\s+/i, '').trim() : null;
}

const earthOf = (text) => { const m = /(\d+)\s*Earth/i.exec(text); return m ? +m[1] : null; };

class Bosses {
  constructor({ onEvent }) {
    this.onEvent = onEvent;
    this.log = store.readLines(FILE); // [{ t, boss, kind: 'announce'|'spawn'|'caught', at, earth, text }]
    this.extra = [];                  // friends' records (shared folder), used for predictions but not saved
    this.warned = new Set();
  }

  setExtra(rows) {
    this.extra = rows.filter((r) => ['announce', 'spawn', 'caught'].includes(r.kind)).map((r) => ({ t: +r.t || +r.at, boss: r.boss, kind: r.kind, at: +r.at, earth: r.earth ?? null, from: r.from }));
  }

  // your own records of the last 30 days, compact, for friends
  shareRows() {
    const since = Date.now() - 30 * 86400000;
    return this.log.filter((r) => r.t >= since).map(({ t, boss, kind, at, earth }) => ({ t, boss, kind, at, earth }));
  }

  all() { return this.extra.length ? [...this.log, ...this.extra] : this.log; }

  // called for every live server notice; `minutes` is set when it was a countdown
  onNotice(text, now, minutes) {
    const boss = bossName(text);
    if (!boss) return;
    let kind = null, at = now;
    if (minutes) { kind = 'announce'; at = now + minutes * 60000; }
    else if (/has spawned|has appeared|appears/i.test(text)) kind = 'spawn';
    else if (/caught|defeated|killed/i.test(text)) kind = 'caught';
    if (!kind) return;
    const row = { t: now, boss, kind, at, earth: earthOf(text), text: text.slice(0, 200) };
    this.log.push(row);
    store.appendLine(FILE, row);
  }

  // one entry per actual spawn: clusters of countdown notices / spawn notices
  spawns(boss) {
    const rows = this.all().filter((r) => r.boss === boss && r.kind !== 'caught').sort((a, b) => a.at - b.at);
    const out = [];
    for (const r of rows) {
      const last = out[out.length - 1];
      if (last && r.at - last.at < CLUSTER_MS) {
        // a "has spawned" notice is exact; otherwise the latest countdown gives the best estimate
        if (r.kind === 'spawn') { last.at = r.at; last.confirmed = true; } else if (!last.confirmed) last.at = r.at;
        last.earth = r.earth ?? last.earth;
      } else out.push({ at: r.at, earth: r.earth, confirmed: r.kind === 'spawn' });
    }
    const caught = this.all().filter((r) => r.boss === boss && r.kind === 'caught');
    for (const s of out) s.caught = caught.some((c) => c.t >= s.at - 60000 && c.t - s.at < 3 * 3600000) || undefined;
    return out;
  }

  stats(now = Date.now()) {
    const names = [...new Set(this.all().map((r) => r.boss))];
    return names.map((boss) => {
      const sp = this.spawns(boss);
      const gaps = [];
      for (let i = 1; i < sp.length; i++) {
        const g = sp[i].at - sp[i - 1].at;
        if (g > 15 * 60000 && g < 36 * 3600000) gaps.push(g);
      }
      gaps.sort((a, b) => a - b);
      const median = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null;
      const last = sp[sp.length - 1];
      let next = null;
      if (median && last) { next = last.at + median; while (next < now - 10 * 60000) next += median; }
      const hours = Array(24).fill(0);
      for (const s of sp) hours[new Date(s.at).getHours()]++;
      return {
        boss, spawns: sp.length, lastAt: last?.at ?? null, lastEarth: last?.earth ?? null,
        intervalMs: median, intervals: gaps.length, next,
        confidence: gaps.length >= 4 ? 'good' : gaps.length >= 2 ? 'rough' : gaps.length === 1 ? 'guess' : null,
        hours, recent: sp.slice(-12).reverse(),
        shared: this.extra.some((r) => r.boss === boss), // includes spawns your friends saw
      };
    }).sort((a, b) => (a.next ?? Infinity) - (b.next ?? Infinity) || b.spawns - a.spawns);
  }

  // heads-up 5 minutes before a predicted spawn (only with 2+ intervals seen), unless a countdown is already running
  tick(now, activeTimerTexts) {
    for (const s of this.stats(now)) {
      if (!s.next || s.intervals < 2) continue;
      const left = s.next - now;
      const key = `${s.boss}|${Math.round(s.next / 60000)}`;
      if (left <= 5 * 60000 && left > 0 && !this.warned.has(key) && !activeTimerTexts.some((t) => bossName(t) === s.boss)) {
        this.warned.add(key);
        const every = Math.round(s.intervalMs / 60000);
        this.onEvent('boss', `${s.boss} expected in about ${Math.max(1, Math.round(left / 60000))} min`, `Usually every ${every >= 60 ? `${Math.floor(every / 60)}h ${every % 60}m` : `${every} min`} (seen ${s.spawns}×)`);
      }
    }
  }
}

module.exports = { Bosses, bossName };
