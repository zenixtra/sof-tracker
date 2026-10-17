// Official public rankings (JSON behind https://fate.netgame.com/ranking/) plus their history.
// Only top characters are published: top 10 per class and top 30 honor.
'use strict';

const store = require('./store');

const RANKING_URL = 'https://fate.netgame.com/component/main_ranking_display.mgame?tab_mn=';
const RANKING_TABS = {
  1: 'Honor', 2: 'All', 3: 'Blade', 4: 'Sword', 5: 'Spear', 6: 'Bow', 7: 'Healer', 8: 'Ninja',
  9: 'Busker', 10: 'Hanbia', 11: 'DamHwalyn', 12: 'Fighter', 13: 'Maeyujin', 14: 'Noho', 15: 'Migo',
};
const CLASS_NAMES = { Swords: 'Sword', Bows: 'Bow' }; // the site mixes singular and plural
const SNAP_FILE = 'rankings.jsonl';
const FORCE_SNAPSHOT_MS = 6 * 3600 * 1000; // store an unchanged snapshot at most this often

// snapshot rows are stored compactly: [name, cls, level, honor, house, faction, "Board:rank,..."]
const pack = (p) => [p.name, p.cls, p.level, p.honor, p.house, p.faction, p.ranks.map((r) => `${r.board}:${r.rank}`).join(',')];
const unpack = (r) => ({
  name: r[0], cls: r[1], level: r[2], honor: r[3], house: r[4], faction: r[5],
  ranks: r[6] ? r[6].split(',').map((x) => { const [board, rank] = x.split(':'); return { board, rank: +rank }; }) : [],
});
const rankOn = (p, board) => p?.ranks.find((r) => r.board === board)?.rank ?? null;

class Rankings {
  constructor({ onEvent }) {
    this.onEvent = onEvent;
    this.snapshots = store.readLines(SNAP_FILE); // [{ t, p: [packed rows] }]
    this.players = new Map();
    this.fetchedAt = null;
    this.error = null;
    const last = this.snapshots[this.snapshots.length - 1];
    if (last) {
      for (const row of last.p) { const p = unpack(row); this.players.set(p.name.toLowerCase(), p); }
      this.fetchedAt = last.t;
    }
  }

  async refresh(isWatched) {
    const players = new Map();
    try {
      for (const [tab, board] of Object.entries(RANKING_TABS)) {
        const res = await fetch(RANKING_URL + tab, { headers: { 'User-Agent': 'SOF-Tracker/1.0' } });
        if (!res.ok) throw new Error(`HTTP ${res.status} on ${board}`);
        const rows = [];
        (function walk(o) {
          if (!o || typeof o !== 'object') return;
          if ('charname' in o) { rows.push(o); return; }
          Object.values(o).forEach(walk);
        })(await res.json());
        const v = (x) => (x && typeof x === 'object' ? x['0'] : x);
        for (const r of rows) {
          const name = String(v(r.charname) ?? '').trim();
          if (!name) continue;
          const key = name.toLowerCase();
          const cls = v(r.type);
          const p = players.get(key) || {
            name, cls: CLASS_NAMES[cls] || cls, level: null, honor: null,
            house: v(r.house) || null, faction: v(r.faction) || null, ranks: [],
          };
          // the Honor board reuses the "level" field for honor points
          if (board === 'Honor') p.honor = Number(v(r.level)) || null;
          else p.level = Number(v(r.level)) || p.level;
          p.ranks.push({ board, rank: Number(v(r.rank)) });
          players.set(key, p);
        }
      }
    } catch (e) {
      this.error = String(e.message || e);
      console.log(`[tracker] rankings refresh failed: ${this.error}`);
      return;
    }

    this.diffWatched(this.players, players, isWatched);
    const changed = this.signature(this.players) !== this.signature(players);
    const now = Date.now();
    this.players = players;
    this.fetchedAt = now;
    this.error = null;
    const last = this.snapshots[this.snapshots.length - 1];
    if (changed || !last || now - last.t > FORCE_SNAPSHOT_MS) {
      const snap = { t: now, p: [...players.values()].map(pack) };
      this.snapshots.push(snap);
      store.appendLine(SNAP_FILE, snap);
    }
    console.log(`[tracker] rankings refreshed: ${players.size} characters${changed ? ' (changed, snapshot saved)' : ''}`);
  }

  signature(map) {
    return JSON.stringify([...map.values()].map(pack).sort());
  }

  diffWatched(prev, cur, isWatched) {
    if (!prev.size) return; // first fetch ever: nothing to compare against
    const keys = new Set([...prev.keys(), ...cur.keys()]);
    for (const key of keys) {
      const a = prev.get(key), b = cur.get(key);
      const name = (b || a).name;
      if (!isWatched(name)) continue;
      if (!a && b) this.onEvent('watch', `${name} entered the rankings`, `Lv ${b.level ?? '?'} ${b.cls}, ${b.faction}${rankOn(b, 'All') ? `, #${rankOn(b, 'All')} overall` : ''}`);
      else if (a && !b) this.onEvent('watch', `${name} dropped out of the rankings`, `Last seen at Lv ${a.level ?? '?'}`);
      else {
        if (b.level && a.level && b.level > a.level) this.onEvent('watch', `${name} reached level ${b.level}`, `Up from ${a.level}`);
        const ra = rankOn(a, 'All'), rb = rankOn(b, 'All');
        if (ra !== rb && rb) this.onEvent('watch', `${name} is now #${rb} overall`, ra ? `Was #${ra}` : 'New on the overall board');
        if (b.house !== a.house) this.onEvent('watch', `${name} changed house`, `${a.house || 'none'} → ${b.house || 'none'}`);
      }
    }
  }

  list() {
    return [...this.players.values()];
  }

  // Aggregates over the snapshots of the last `days` days.
  history(days) {
    return { ...this.historyRange(Date.now() - days * 86400000, Date.now()), days };
  }

  // Aggregates over the snapshots between `since` and `until` (used by the weekly report too).
  historyRange(since, until) {
    let snaps = this.snapshots.filter((s) => s.t >= since && s.t <= until);
    // include the snapshot right before the window so the comparison has a baseline
    const before = this.snapshots.filter((s) => s.t < since).pop();
    if (before) snaps = [before, ...snaps];

    const first = new Map(), last = new Map();
    for (const s of snaps) {
      for (const row of s.p) {
        const p = unpack(row), key = p.name.toLowerCase();
        if (!first.has(key)) first.set(key, { ...p, t: s.t });
        last.set(key, { ...p, t: s.t });
      }
    }
    const movers = [...last.entries()].map(([key, b]) => {
      const a = first.get(key);
      return {
        name: b.name, cls: b.cls, faction: b.faction, house: b.house, level: b.level, honor: b.honor,
        levelGain: a.level && b.level ? b.level - a.level : 0,
        honorGain: a.honor && b.honor ? b.honor - a.honor : 0,
        rankNow: rankOn(b, 'All'), rankThen: rankOn(a, 'All'),
        since: a.t,
      };
    });

    // faction balance per snapshot (down-sampled to <= 200 points)
    const step = Math.max(1, Math.ceil(snaps.length / 200));
    const factions = snaps.filter((_, i) => i % step === 0 || i === snaps.length - 1).map((s) => {
      const acc = { t: s.t, order: 0, chaos: 0, orderLv: 0, chaosLv: 0 };
      for (const row of s.p) {
        const p = unpack(row), k = /chaos/i.test(p.faction) ? 'chaos' : 'order';
        acc[k]++; if (p.level) acc[k + 'Lv'] += p.level;
      }
      acc.orderLv = acc.order ? acc.orderLv / acc.order : null;
      acc.chaosLv = acc.chaos ? acc.chaosLv / acc.chaos : null;
      return acc;
    });

    // houses: current strength plus change over the window
    const houseStats = (rows) => {
      const h = {};
      for (const p of rows) {
        if (!p.house) continue;
        const x = (h[p.house] ||= { house: p.house, faction: p.faction, members: 0, levels: 0, leveled: 0, honor: 0 });
        x.members++; x.honor += p.honor || 0;
        if (p.level) { x.levels += p.level; x.leveled++; } // honor-board-only entries have no level
      }
      return h;
    };
    const firstSnap = snaps[0] ? snaps[0].p.map(unpack) : [];
    const lastSnap = snaps.length ? snaps[snaps.length - 1].p.map(unpack) : this.list();
    const hNow = houseStats(lastSnap), hThen = houseStats(firstSnap);
    const houses = Object.values(hNow).map((h) => ({
      ...h, avgLevel: h.leveled ? h.levels / h.leveled : null,
      memberChange: h.members - (hThen[h.house]?.members || 0),
    })).sort((a, b) => b.members - a.members || b.honor - a.honor);

    // member count over time for the top 5 houses
    const top = houses.slice(0, 5).map((h) => h.house);
    const houseSeries = snaps.filter((_, i) => i % step === 0 || i === snaps.length - 1).map((s) => {
      const c = { t: s.t };
      for (const name of top) c[name] = 0;
      for (const row of s.p) if (top.includes(row[4])) c[row[4]]++;
      return c;
    });

    return {
      snapshots: snaps.length, from: snaps[0]?.t ?? null, to: snaps[snaps.length - 1]?.t ?? null,
      fastest: movers.filter((m) => m.levelGain > 0).sort((a, b) => b.levelGain - a.levelGain || (b.level || 0) - (a.level || 0)).slice(0, 15),
      honor: movers.filter((m) => m.honorGain > 0).sort((a, b) => b.honorGain - a.honorGain).slice(0, 15),
      climbers: movers.filter((m) => m.rankNow && m.rankThen !== m.rankNow)
        .map((m) => ({ ...m, rankDelta: m.rankThen ? m.rankThen - m.rankNow : null }))
        .sort((a, b) => (b.rankDelta ?? 99) - (a.rankDelta ?? 99)).slice(0, 15),
      factions, houses: houses.slice(0, 20), topHouses: top, houseSeries,
    };
  }

  // Level prediction from the moments a player's level changed in the snapshots.
  // Returns null until at least two level-ups have been seen.
  predict(name) {
    const pts = this.playerHistory(name).points.filter((p) => p.level);
    const ups = [];
    for (let i = 1; i < pts.length; i++) if (pts[i].level > pts[i - 1].level) ups.push({ t: pts[i].t, level: pts[i].level });
    if (ups.length < 2) return null;
    const first = ups[0], last = ups[ups.length - 1];
    const perLevel = (last.t - first.t) / (last.level - first.level);
    if (!(perLevel > 0)) return null;
    return {
      level: last.level, perLevelMs: perLevel, perDay: 86400000 / perLevel,
      nextLevelAt: last.t + perLevel, basedOn: ups.length,
      etaFor: (target) => (target > last.level ? last.t + perLevel * (target - last.level) : null),
    };
  }

  predictions() {
    const out = [];
    for (const p of this.players.values()) {
      const pr = this.predict(p.name);
      if (pr) out.push({ name: p.name, cls: p.cls, faction: p.faction, level: pr.level, perDay: pr.perDay, nextLevelAt: pr.nextLevelAt, basedOn: pr.basedOn, nextTen: pr.etaFor(Math.ceil((pr.level + 1) / 10) * 10) });
    }
    return out.sort((a, b) => b.perDay - a.perDay);
  }

  playerHistory(name) {
    const key = name.toLowerCase();
    const points = [];
    for (const s of this.snapshots) {
      const row = s.p.find((r) => r[0].toLowerCase() === key);
      if (row) { const p = unpack(row); points.push({ t: s.t, level: p.level, honor: p.honor, rank: rankOn(p, 'All') }); }
    }
    return { name, points };
  }
}

module.exports = { Rankings, RANKING_TABS };
