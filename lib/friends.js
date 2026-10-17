// Friends sync through a shared folder (OneDrive, Dropbox, Google Drive, a network share…).
// Every tracker writes sof-share-<name>.json there and reads the files of the others.
// Nothing is sent anywhere else; friends' data is kept apart from your own files.
'use strict';

const fs = require('fs');
const path = require('path');

const FILE_RE = /^sof-share-([\w.-]{2,32})\.json$/i;
const safeName = (s) => String(s || '').replace(/[^\w.-]/g, '').slice(0, 32);

// "1.10.0" > "1.9.3"
function cmpVersion(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0), pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}

class Friends {
  constructor() {
    this.friends = {}; // name -> { name, updatedAt, watchlist, threats, notes, waypoints }
    this.error = null;
    this.lastSync = null;
  }

  sync({ dir, name }, mine) {
    if (!dir || !safeName(name)) { this.friends = {}; this.error = null; return; }
    try {
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error('Shared folder not found');
      const me = safeName(name);
      const file = path.join(dir, `sof-share-${me}.json`);
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ name: me, updatedAt: Date.now(), ...mine }));
      fs.renameSync(tmp, file);
      const friends = {};
      for (const f of fs.readdirSync(dir)) {
        const m = FILE_RE.exec(f);
        if (!m || m[1].toLowerCase() === me.toLowerCase()) continue;
        try {
          const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8').replace(/^﻿/, '')); // tolerate a BOM
          if (Date.now() - (d.updatedAt || 0) > 30 * 86400000) continue; // ignore friends gone for a month
          const live = d.live && typeof d.live === 'object' ? d.live : null;
          friends[m[1]] = {
            name: m[1], updatedAt: d.updatedAt,
            version: typeof d.version === 'string' ? d.version.slice(0, 20) : null,
            watchlist: Array.isArray(d.watchlist) ? d.watchlist.map(String).slice(0, 500) : [],
            threats: d.threats && typeof d.threats === 'object' ? d.threats : {},
            notes: d.notes && typeof d.notes === 'object' ? d.notes : {},
            waypoints: Array.isArray(d.waypoints) ? d.waypoints.slice(0, 500) : [],
            // live status for the party view: only trusted while the friend's file keeps being refreshed
            live: live ? {
              running: !!live.running, afk: !!live.afk, character: String(live.character || '').slice(0, 40) || null,
              zone: Number.isFinite(+live.zone) ? String(live.zone) : null,
              x: Number.isFinite(+live.x) ? +live.x : null, z: Number.isFinite(+live.z) ? +live.z : null,
              nearby: Number.isFinite(+live.nearby) ? +live.nearby : null,
            } : null,
            bosses: Array.isArray(d.bosses) ? d.bosses.filter((b) => b && typeof b.boss === 'string' && Number.isFinite(+b.at)).slice(-500) : [],
            // trade offers their screen reader read from the chat (shared market)
            offers: Array.isArray(d.offers) ? d.offers.filter((o) => o && Number.isFinite(+o.t) && Number.isFinite(+o.itemId) && +o.price > 0 && (o.side === 'sell' || o.side === 'buy'))
              .slice(-3000).map((o) => ({ t: +o.t, who: String(o.who || '').slice(0, 20), side: o.side, itemId: +o.itemId, item: String(o.item || '').slice(0, 80), price: +o.price })) : [],
            // their enhance tries (pooled for better odds) and the bosses they're coming to
            enhance: Array.isArray(d.enhance) ? d.enhance.filter((r) => r && Number.isFinite(+r.level) && +r.level >= 1 && +r.level <= 15 && ['best', 'high', 'mid'].includes(r.charm))
              .slice(-3000).map((r) => ({ t: +r.t || 0, level: +r.level, charm: r.charm, ok: !!r.ok, sofCharm: typeof r.sofCharm === 'string' ? r.sofCharm.slice(0, 40) : undefined })) : [],
            signups: Array.isArray(d.signups) ? d.signups.filter((s) => s && Number.isFinite(+s.t) && typeof s.label === 'string').slice(-50).map((s) => ({ t: +s.t, label: s.label.slice(0, 60) })) : [],
            // their characters' gear scores
            // their characters' quests in progress
            quests: Array.isArray(d.quests) ? d.quests.filter((q) => q && typeof q.char === 'string' && Array.isArray(q.ids)).slice(0, 20)
              .map((q) => ({ char: q.char.slice(0, 40), ids: q.ids.map(Number).filter(Number.isFinite).slice(0, 60) })) : [],
            gear: Array.isArray(d.gear) ? d.gear.filter((g) => g && typeof g.char === 'string' && Number.isFinite(+g.score)).slice(0, 20).map((g) => ({ char: g.char.slice(0, 40), score: Math.round(+g.score) })) : [],
          };
        } catch { /* a friend's file being written right now: try next time */ }
      }
      this.friends = friends;
      this.lastSync = Date.now();
      this.error = null;
    } catch (e) {
      this.error = e.message;
    }
  }

  list() {
    return Object.values(this.friends).map((f) => ({ name: f.name, updatedAt: f.updatedAt, version: f.version, watchlist: f.watchlist.length, threats: Object.keys(f.threats).length, notes: Object.keys(f.notes).length, waypoints: f.waypoints.length, bosses: f.bosses.length }));
  }

  // party view: friends whose file was refreshed in the last 2 minutes count as online
  party(now = Date.now()) {
    return Object.values(this.friends).map((f) => ({
      name: f.name, updatedAt: f.updatedAt, online: now - (f.updatedAt || 0) < 120000,
      live: now - (f.updatedAt || 0) < 120000 ? f.live : null,
    })).sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name));
  }

  // friends with the same quests in progress: questId → ["Friend (Character)", …]
  questMates(ids) {
    const want = new Set(ids), out = {};
    for (const f of Object.values(this.friends)) for (const q of f.quests || []) for (const id of q.ids) if (want.has(id)) (out[id] ||= []).push(`${f.name}${q.char && q.char !== f.name ? ` (${q.char})` : ''}`);
    return out;
  }
  gearScores() { return Object.values(this.friends).flatMap((f) => (f.gear || []).map((g) => ({ ...g, from: f.name }))); }

  // boss spawn records from all friends (merged into the boss predictions)
  bossRows() {
    return Object.values(this.friends).flatMap((f) => f.bosses.map((b) => ({ ...b, from: f.name })));
  }

  // highest tracker version among friends
  newestVersion() {
    let best = null;
    for (const f of Object.values(this.friends)) if (f.version && (!best || cmpVersion(f.version, best.version) > 0)) best = { version: f.version, from: f.name };
    return best;
  }

  // who flagged / watches / noted a player, across friends
  threatBy(name) { const k = String(name).toLowerCase(); return Object.values(this.friends).filter((f) => f.threats[k]).map((f) => f.name); }
  watchedBy(name) { const k = String(name).toLowerCase(); return Object.values(this.friends).filter((f) => f.watchlist.some((w) => w.toLowerCase() === k)).map((f) => f.name); }
  note(name) {
    const k = String(name).toLowerCase();
    for (const f of Object.values(this.friends)) if (f.notes[k]) return { ...f.notes[k], from: f.name };
    return null;
  }
  waypoints() { return Object.values(this.friends).flatMap((f) => f.waypoints.map((w) => ({ ...w, note: typeof w.note === 'string' ? w.note.slice(0, 300) : undefined, id: `${f.name}:${w.id}`, owner: f.name }))); }
  // friends' chat offers, tagged with who shared them
  offers() { return Object.values(this.friends).flatMap((f) => (f.offers || []).map((o) => ({ ...o, from: f.name }))); }
  enhanceRows() { return Object.values(this.friends).flatMap((f) => (f.enhance || []).map((r) => ({ ...r, from: f.name }))); }
  signups() { return Object.values(this.friends).flatMap((f) => (f.signups || []).map((s) => ({ ...s, from: f.name }))); }
}

// your offers plus your friends', each offer once: two trackers reading the same chat line see the same player,
// item, side and price within a few minutes
function mergeOffers(mine, theirs) {
  const key = (o) => `${String(o.who).toLowerCase()}|${o.itemId}|${o.side}|${o.price}`;
  const seen = new Map();
  for (const o of mine) { const k = key(o); (seen.get(k) || seen.set(k, []).get(k)).push(o.t); }
  const extra = theirs.filter((o) => { const ts = seen.get(key(o)); if (ts && ts.some((t) => Math.abs(t - o.t) < 10 * 60000)) return false; (ts || seen.set(key(o), []).get(key(o))).push(o.t); return true; });
  return extra.length ? [...mine, ...extra].sort((a, b) => a.t - b.t) : mine;
}

module.exports = { Friends, safeName, cmpVersion, mergeOffers };
