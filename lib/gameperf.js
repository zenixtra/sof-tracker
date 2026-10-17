// How the game itself runs: CPU and memory of YGOnline.exe and the moments its window froze ("Not Responding"),
// from the tasklist the tracker already runs every 5 seconds. (Frames per second can't be seen from outside the game
// without hooking into it, so freezes are what's measured.)
'use strict';

const MIN = 60000;

class GamePerf {
  constructor({ read, save, cores = 1 }) {
    this.d = { samples: [], freezes: [], ...(read() || {}) };
    this.save = () => save(this.d);
    this.cores = Math.max(1, cores);
    this.prev = new Map();  // pid -> { t, cpuSec }
    this.acc = null;        // this minute: { t, cpu, mem, n }
    this.cur = new Map();   // pid -> freeze start
    this.memStart = new Map(); // pid -> memory a few minutes after it started
    this.warned = new Set();
  }
  // one tasklist row per game window: { pid, cpuSec, memMb, responding }; returns what happened:
  // { froze: [{ pid, t, ms }], memGrew: [{ pid, from, to }] }
  sample(now, rows, ctx = () => ({})) {
    const out = { froze: [], memGrew: [] };
    let cpu = 0, mem = 0;
    for (const r of rows) {
      const p = this.prev.get(r.pid);
      if (p && r.cpuSec != null && now > p.t) cpu += Math.max(0, ((r.cpuSec - p.cpuSec) / ((now - p.t) / 1000) / this.cores) * 100);
      if (r.cpuSec != null) this.prev.set(r.pid, { t: now, cpuSec: r.cpuSec, first: p?.first ?? now });
      if (r.memMb) {
        mem += r.memMb;
        const first = this.prev.get(r.pid)?.first ?? now;
        if (!this.memStart.has(r.pid) && now - first >= 5 * MIN) this.memStart.set(r.pid, r.memMb);
        const m0 = this.memStart.get(r.pid);
        if (m0 && r.memMb >= m0 * 1.6 && r.memMb - m0 >= 700 && !this.warned.has(r.pid)) { this.warned.add(r.pid); out.memGrew.push({ pid: r.pid, from: m0, to: r.memMb }); }
      }
      // a freeze: from the first "Not Responding" look until it answers again
      if (!r.responding) { if (!this.cur.has(r.pid)) this.cur.set(r.pid, now); }
      else if (this.cur.has(r.pid)) {
        const t = this.cur.get(r.pid); this.cur.delete(r.pid);
        const f = { t, ms: now - t, ...ctx(r.pid) };
        this.d.freezes.push(f); if (this.d.freezes.length > 300) this.d.freezes.shift();
        out.froze.push({ pid: r.pid, ...f });
        this.save();
      }
    }
    for (const pid of [...this.prev.keys()]) if (!rows.some((r) => r.pid === pid)) { this.prev.delete(pid); this.cur.delete(pid); this.memStart.delete(pid); }
    // once a minute: the average CPU and the memory of all game windows
    if (rows.length) {
      const a = (this.acc ||= { t: now, cpu: 0, mem: 0, n: 0 });
      a.cpu += cpu; a.mem = mem; a.n++;
      if (now - a.t >= MIN) {
        this.d.samples.push([now, Math.round((a.cpu / a.n) * 10) / 10, Math.round(a.mem)]);
        while (this.d.samples.length && now - this.d.samples[0][0] > 24 * 60 * MIN) this.d.samples.shift();
        this.acc = null; this.save();
      }
    } else this.acc = null;
    return out;
  }
  // freezes in the last `ms` (for "keeps freezing")
  recentFreezes(now, ms = 10 * MIN) { return this.d.freezes.filter((f) => now - f.t <= ms); }
  view(now) {
    const day = this.d.freezes.filter((f) => now - f.t <= 7 * 24 * 60 * MIN);
    return {
      samples: this.d.samples,
      freezes: day.slice(-50).reverse(),
      frozenNow: [...this.cur.entries()].map(([pid, t]) => ({ pid, ms: now - t })),
      today: day.filter((f) => now - f.t <= 24 * 60 * MIN).length,
      longest: day.reduce((m, f) => Math.max(m, f.ms), 0),
    };
  }
}

// the game's rows in `tasklist /V /FO CSV /NH`: memory (K, with the PC's own thousands separator) and CPU time h:mm:ss
function parseTasklist(out) {
  return [...String(out).matchAll(/"YGOnline\.exe","(\d+)","[^"]*","[^"]*","([^"]*)","([^"]*)","[^"]*","(\d+):(\d+):(\d+)"/gi)].map((m) => ({
    pid: +m[1], memMb: Math.round(+m[2].replace(/[^\d]/g, '') / 1024) || null, responding: !/not responding/i.test(m[3]), cpuSec: +m[4] * 3600 + +m[5] * 60 + +m[6],
  }));
}

module.exports = { GamePerf, parseTasklist };
