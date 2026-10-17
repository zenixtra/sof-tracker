// Patch watcher: remembers every game file (size + date) and, after the launcher patched the game,
// reports what changed: version, new zones, changed maps, game data tables, message texts, new item icons.
// Only reads the game folder; the file list lives in data/patch/ (not in backups, it can always be rebuilt).
'use strict';

const fs = require('fs');
const path = require('path');
const { loadMessages } = require('./gamedata');

// files the client rewrites while you play (logs, options, chat, anti-cheat, screenshots, guild emblems)
const VOLATILE = [
  /^launcher\.ini$/,
  /^client\\(log[^\\]*\.txt|[^\\]*\.(scs|aut|mhslot|log)|ybopt[^\\]*|ybpos\d*\.cfg|ybc\.cfg|fontinfo\.txt|drvinfo\.inf)$/,
  /^client\\(xigncode|chatdata|guild|eos_sdk|ygonline\.exe\.webview2)\\/,
  /^datas\\(capture|webview2data)\\/,
  /^datas\\interface\\guild\\/,
];
const isVolatile = (rel) => VOLATILE.some((re) => re.test(rel));

// what the client data tables hold (names worked out from their contents / file names)
const TABLES = {
  'client\\ybi.cfg': 'Items', 'client\\ybq.cfg': 'Quests', 'client\\ybmsg.cfg': 'Messages', 'client\\ybdrop.cfg': 'Drops',
  'client\\resource_mob.cfg': 'Monsters', 'client\\resource_pet.cfg': 'Pets', 'client\\resource_soulpet.cfg': 'Soul pets',
  'client\\resource1.cfg': 'Resources', 'client\\ybnpcinfo.cfg': 'NPCs', 'client\\ybmapinfo.cfg': 'Map info', 'client\\cooltime.cfg': 'Cooldowns',
  'client\\ygonline.exe': 'Game program', 'ygonline.exe': 'Game program', 'launcher.exe': 'Launcher', 'ybi.cfg': 'Items',
};
// file groups shown in the report
const AREAS = [
  [/^datas\\interface\\data\\window_minimap\\/, 'Minimaps'], [/^datas\\interface\\map\\/, 'Map data'], [/^datas\\ncsdata\\/, 'Zone data'],
  [/^datas\\interface\\item\\/, 'Item icons'], [/^datas\\interface\\mugong\\/, 'Skill icons'], [/^datas\\interface\\/, 'Interface'],
  [/^datas\\mesh\\/, 'Models'], [/^datas\\texture\\/, 'Textures'], [/^datas\\animation\\/, 'Animations'], [/^datas\\(sound|sounds|music)\\/, 'Sound & music'],
  [/^datas\\(effect|fx)\\/, 'Effects'], [/^datas\\/, 'Other game data'], [/^client\\/, 'Client'], [/./, 'Game folder'],
];
const areaOf = (rel) => AREAS.find(([re]) => re.test(rel))[1];
const MAX_LIST = 400;

class PatchWatcher {
  constructor({ gameDir, clientDir, dataDir, onEvent }) {
    this.gameDir = gameDir;
    this.clientDir = clientDir;
    this.dir = path.join(dataDir, 'patch');
    this.historyFile = path.join(dataDir, 'patches.json'); // small, so it is part of backups
    this.onEvent = onEvent;
    fs.mkdirSync(this.dir, { recursive: true });
    this.history = this.read(this.historyFile, []);
    this.lastCheckAt = null;
    this.checking = false;
    this.error = null;
    this.baseline = null; // { at, version, files } of the stored list, loaded lazily
  }

  read(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
  write(file, data) { fs.writeFileSync(`${file}.tmp`, JSON.stringify(data)); fs.renameSync(`${file}.tmp`, file); }

  gameVersion() {
    try { return (/^VERSION=(\S+)/m.exec(fs.readFileSync(path.join(this.gameDir, 'launcher.ini'), 'latin1')) || [])[1] || null; } catch { return null; }
  }

  // every game file -> [size, mtime in whole seconds]
  async scan() {
    const files = {};
    const entries = await fs.promises.readdir(this.gameDir, { withFileTypes: true, recursive: true });
    const list = [];
    for (const e of entries) {
      if (!e.isFile()) continue;
      const full = path.join(e.parentPath ?? e.path, e.name);
      const rel = path.relative(this.gameDir, full).toLowerCase();
      if (!isVolatile(rel)) list.push([rel, full]);
    }
    for (let i = 0; i < list.length; i += 500) {
      await Promise.all(list.slice(i, i + 500).map(async ([rel, full]) => {
        try { const st = await fs.promises.stat(full); files[rel] = [st.size, Math.floor(st.mtimeMs / 1000)]; } catch { /* removed while scanning */ }
      }));
    }
    return files;
  }

  messages() {
    try { return Object.fromEntries(loadMessages(this.clientDir).map((m) => [m.id, m.text])); } catch { return null; }
  }

  // compare the game folder with the stored list; returns the new report or null when nothing changed
  async check(reason = 'scheduled') {
    if (this.checking) return null;
    this.checking = true;
    try {
      const manifestFile = path.join(this.dir, 'manifest.json'), msgFile = path.join(this.dir, 'messages.json');
      const before = this.baseline || this.read(manifestFile, null);
      const files = await this.scan();
      const version = this.gameVersion();
      const now = Date.now();
      let report = null;
      if (before) {
        const added = [], changed = [], removed = [];
        for (const [rel, v] of Object.entries(files)) {
          const o = before.files[rel];
          if (!o) added.push(rel); else if (o[0] !== v[0] || o[1] !== v[1]) changed.push(rel);
        }
        for (const rel of Object.keys(before.files)) if (!files[rel]) removed.push(rel);
        if (added.length || changed.length || removed.length || (version && before.version && version !== before.version)) {
          report = this.describe({ before, version, added, changed, removed, files, now, reason });
          if (report.messages) this.write(msgFile, report._msgs); // keep the new texts for next time
          delete report._msgs;
          this.history.unshift(report);
          this.history = this.history.slice(0, 50);
          this.write(this.historyFile, this.history);
          this.onEvent(report);
        }
      }
      if (!before || report) {
        if (!before || !fs.existsSync(msgFile)) { const m = this.messages(); if (m) this.write(msgFile, m); }
        this.baseline = { at: now, version, files };
        this.write(manifestFile, this.baseline);
      } else this.baseline = before;
      this.lastCheckAt = now;
      this.error = null;
      return report;
    } catch (e) {
      this.error = e.message;
      return null;
    } finally {
      this.checking = false;
    }
  }

  describe({ before, version, added, changed, removed, now, reason }) {
    const areas = {};
    const bump = (rel, k) => { const a = (areas[areaOf(rel)] ||= { area: areaOf(rel), added: 0, changed: 0, removed: 0 }); a[k]++; };
    added.forEach((r) => bump(r, 'added')); changed.forEach((r) => bump(r, 'changed')); removed.forEach((r) => bump(r, 'removed'));

    // zones: a new minimap or zone-data folder means a new map; a changed minimap means a reworked one
    const zoneOf = (rel) => (/^datas\\interface\\data\\window_minimap\\(\d+)\.bmp$/.exec(rel) || /^datas\\ncsdata\\(\d+)\\/.exec(rel) || /^datas\\interface\\map\\pathpoint_(\d+)\.pth$/.exec(rel) || [])[1];
    const oldZones = new Set(Object.keys(before.files).map(zoneOf).filter(Boolean));
    const newZones = [...new Set(added.map(zoneOf).filter((z) => z && !oldZones.has(z)))].sort((a, b) => a - b);
    const changedMaps = [...new Set(changed.map((r) => (/^datas\\interface\\data\\window_minimap\\(\d+)\.bmp$/.exec(r) || [])[1]).filter(Boolean))].sort((a, b) => a - b);
    const tables = [...added.map((r) => [r, 'added']), ...changed.map((r) => [r, 'changed']), ...removed.map((r) => [r, 'removed'])]
      .filter(([r]) => TABLES[r]).map(([r, change]) => ({ file: r, label: TABLES[r], change }));
    const itemIcons = added.filter((r) => /^datas\\interface\\item\\/.test(r)).length;

    // message texts: what was added / reworded
    let messages = null, msgs = null;
    if (changed.includes('client\\ybmsg.cfg') || added.includes('client\\ybmsg.cfg')) {
      const old = this.read(path.join(this.dir, 'messages.json'), null);
      msgs = this.messages();
      if (old && msgs) {
        const add = [], chg = [];
        let rem = 0;
        for (const [id, text] of Object.entries(msgs)) {
          if (!(id in old)) { if (text.trim()) add.push({ id: +id, text }); } else if (old[id] !== text) {
            if (!text.trim()) rem++; else if (!old[id].trim()) add.push({ id: +id, text }); else chg.push({ id: +id, from: old[id], to: text });
          }
        }
        for (const id of Object.keys(old)) if (!(id in msgs) && old[id].trim()) rem++;
        messages = { added: add.slice(0, MAX_LIST), changed: chg.slice(0, MAX_LIST), addedCount: add.length, changedCount: chg.length, removedCount: rem };
      }
    }
    const cut = (a) => a.slice().sort().slice(0, MAX_LIST);
    return {
      id: `${now.toString(36)}`, at: now, since: before.at, reason,
      versionFrom: before.version || null, versionTo: version || null,
      counts: { added: added.length, changed: changed.length, removed: removed.length },
      areas: Object.values(areas).sort((a, b) => (b.added + b.changed + b.removed) - (a.added + a.changed + a.removed)),
      newZones, changedMaps, tables, itemIcons, messages,
      files: { added: cut(added), changed: cut(changed), removed: cut(removed) },
      _msgs: msgs,
    };
  }

  status() {
    return {
      checking: this.checking, lastCheckAt: this.lastCheckAt, error: this.error,
      version: this.baseline?.version ?? this.gameVersion(), files: this.baseline ? Object.keys(this.baseline.files).length : null,
      baselineAt: this.baseline?.at ?? null,
      history: this.history.map(({ files, messages, ...r }) => ({ ...r, messages: messages ? { addedCount: messages.addedCount, changedCount: messages.changedCount, removedCount: messages.removedCount } : null })),
    };
  }

  report(id) { return this.history.find((r) => r.id === id) || null; }
}

module.exports = { PatchWatcher, isVolatile };
