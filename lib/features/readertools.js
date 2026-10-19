// Reader tools: the reader check (when each part of the screen reading last worked), debug captures of a reader
// that got stuck (with the game picture), the debug bundle, and the setup check. Moved out of server.js; shared
// things come in through `ctx` and are looked up when used.
'use strict';

const fs = require('fs');
const path = require('path');

module.exports = function createReaderTools(ctx) {
  const { store, VERSION, CLIENT_DIR } = ctx;
  const settings = () => ctx.settings(), state = () => ctx.state(), db = () => ctx.db(), backupState = () => ctx.backupState(), readerStats = () => ctx.readerStats();

  // the reader check: when each part of the screen reading last worked (kept across restarts)
  const readerSeen = store.readJson('reader-seen.json', {});
  let readerSeenSaved = 0;
  function readerOk(key, t = Date.now()) {
    readerSeen[key] = t;
    if (t - readerSeenSaved > 60000) { readerSeenSaved = t; store.writeJson('reader-seen.json', readerSeen); }
  }
  const READER_CHECKS = [
    ['hud', 'HP / MP bars', 'Keep the game window visible (not minimised) with the screen reader on.'],
    ['exp', 'EXP bar', 'The EXP bar at the bottom of the game window has to be visible.'],
    ['chat', 'Chat', 'Keep the chat box open; the reader reads its lines.'],
    ['target', 'Target name', 'Click a monster or player.'],
    ['tooltip', 'Item tooltips (gear log, price check)', 'Rest the mouse on an item for 2–3 seconds.'],
    ['gold', 'Inventory: gold', 'Open your inventory.'],
    ['weight', 'Inventory: bag weight', 'Open your inventory.'],
    ['questProgress', 'Quest window: in progress', 'Open the quest window (Ctrl+Q) on "Quest in progress".'],
    ['questAvailable', 'Quest window: available', 'Switch the quest window to the "Available Quest" tab.'],
    ['center', 'Message box in the middle', 'Messages in the middle of the screen (enhancing, pickups) show here once one appears.'],
    ['enhance', 'Enhance results', 'Enhance something: "succeeded / failed" in the middle of the screen.'],
    ['pickup', 'Pickup messages (quest items)', 'Pick up a quest item. If this stays grey, teach the tracker the message below.'],
    ['expChat', 'EXP lines in the chat ("Exp obtained")', 'Kill something with the chat box open: the game writes each EXP gain there.'],
    ['sysChat', 'Game messages in the chat (Ki, gold, pickups, deaths)', 'Play as usual with the chat box open: the game writes these there.'],
    ['statusBasic', 'Status window: your stats', 'Open the Status window (C) on Basic.'],
    ['statusSkills', 'Status window: your skills', 'Open Status → Skill and click each tab once (Ascension, Combat, Support).'],
    ['alt', 'Second game window', 'Start a 2nd client and switch on "also read my other game windows".'],
  ];
  // ---- debug captures: when a reader saw something but couldn't make sense of it, the game picture of that moment
  // and what was read are kept in data/debug (a few per kind, the newest 40 in all), for tuning the readers
  const DEBUG_DIR = path.join(store.DIR, 'debug');
  const debugLast = new Map();
  function debugCapture(kind, t, what) {
    if (!settings().debugCapture) return;
    if (t - (debugLast.get(kind) || 0) < 10 * 60000) return; // one per kind every 10 minutes
    debugLast.set(kind, t);
    try {
      fs.mkdirSync(DEBUG_DIR, { recursive: true });
      const name = `${kind}-${ctx.stamp()}-${String(t).slice(-5)}`;
      const shot = ctx.ringFrames(t - 15000).pop();
      if (shot) fs.copyFileSync(path.join(shot.dir, shot.n), path.join(DEBUG_DIR, `${name}.jpg`));
      fs.writeFileSync(path.join(DEBUG_DIR, `${name}.json`), JSON.stringify({ kind, t, version: VERSION, what }, null, 1));
      // keep the newest 40 captures
      const files = fs.readdirSync(DEBUG_DIR).filter((f) => /\.json$/.test(f)).map((f) => ({ f, t: fs.statSync(path.join(DEBUG_DIR, f)).mtimeMs })).sort((a, b) => b.t - a.t);
      for (const x of files.slice(40)) for (const ext of ['.json', '.jpg']) try { fs.unlinkSync(path.join(DEBUG_DIR, x.f.replace(/\.json$/, ext))); } catch { /* gone */ }
    } catch (e) { console.log(`[tracker] debug capture: ${e.message}`); }
  }
  function debugList() {
    try {
      return fs.readdirSync(DEBUG_DIR).filter((f) => /\.json$/.test(f)).map((f) => { const d = JSON.parse(fs.readFileSync(path.join(DEBUG_DIR, f), 'utf8')); return { name: f.replace(/\.json$/, ''), kind: d.kind, t: d.t, shot: fs.existsSync(path.join(DEBUG_DIR, f.replace(/\.json$/, '.jpg'))) }; }).sort((a, b) => b.t - a.t);
    } catch { return []; }
  }
  // the debug bundle: reader check, unrecognised lines, captures and the end of the log, as one zip (no tokens, webhooks
  // or folders: only the screen reading settings)
  function debugBundle() {
    const files = [];
    const add = (name, data) => files.push({ name, data: typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data, null, 1) });
    add('readme.txt', `SoF Tracker ${VERSION} debug bundle, ${new Date().toISOString()}\nreader-check.json: when each reader last worked\npickup-candidates.json: lines that may be pickup messages\ncaptures/: the game picture and what was read when a reader got stuck\ntracker-log.txt: the end of the tracker's log\n`);
    add('reader-check.json', readerCheckView());
    add('pickup-candidates.json', { candidates: ctx.pickupCandidates(), patterns: ctx.pickupPatterns() });
    add('settings().json', Object.fromEntries(['screenReader', 'screenInterval', 'screenReaderAlts', 'adaptivePace', 'lang', 'debugCapture'].map((k) => [k, settings()[k]])));
    add('reader-stats.json', { ...readerStats(), game: { running: state().game.running }, window: { w: readerStats().w, h: readerStats().h } });
    for (const d of debugList()) {
      add(`captures/${d.name}.json`, fs.readFileSync(path.join(DEBUG_DIR, `${d.name}.json`)));
      if (d.shot) add(`captures/${d.name}.jpg`, fs.readFileSync(path.join(DEBUG_DIR, `${d.name}.jpg`)));
    }
    try { const log = fs.readFileSync(path.join(store.DIR, 'tracker.log'), 'utf8'); add('tracker-log.txt', log.slice(-60000)); } catch { /* no log */ }
    return ctx.zip(files);
  }
  // ---- setup check (first run, or after installing on a friend's PC): what works, what to fix
  let trayStatus = store.readJson('tray-status.json', null), lastTrayAt = 0;
  function setupCheck(now = Date.now()) {
    const rows = [];
    const add = (id, label, ok, detail, fix = '') => rows.push({ id, label, status: ok === true ? 'ok' : ok === false ? 'fail' : 'warn', detail, fix });
    const edge = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles].filter(Boolean).map((p) => path.join(p, 'Microsoft', 'Edge', 'Application', 'msedge.exe')).find((p) => fs.existsSync(p));
    add('game', 'Game folder', fs.existsSync(CLIENT_DIR), CLIENT_DIR, 'Reinstall the tracker and pick the folder with launcher.exe in it.');
    add('db', 'Game data decoded', db().items.length > 0 ? true : null, db().items.length ? `${db().items.length} items, ${db().quests.length} quests` : 'not yet (takes a few seconds after start-up)');
    add('node', 'Node.js', +process.versions.node.split('.')[0] >= 22, `version ${process.versions.node}`, 'Install Node.js 22 or newer (LTS) from nodejs.org.');
    const trayOn = now - lastTrayAt < 30000;
    add('tray', 'Tray icon (watchdog, hotkeys, notifications)', trayOn, trayOn ? 'running' : 'not running', 'Start "SoF Tracker" from the Start menu (or tray.vbs in the tracker folder), or switch on Start with Windows.');
    const keys = trayStatus?.keys, taken = keys ? Object.entries(keys).filter(([, v]) => !v).map(([k]) => `Ctrl+Shift+${k}`) : null;
    add('hotkeys', 'In-game hotkeys', !keys ? null : !taken.length, !keys ? 'not reported yet (needs the tray)' : taken.length ? `taken by another program: ${taken.join(', ')}` : 'all 5 work', 'Close the program that uses the same shortcut, then restart the tray icon.');
    const ocr = readerStats().ocr;
    add('reader', 'Screen reader', settings().screenReader ? (readerStats().frames ? true : null) : false, !settings().screenReader ? 'off' : readerStats().frames ? `reading (${readerStats().frames} looks)` : 'on, waits for the game', 'Switch it on in Settings → Screen reader.');
    add('ocr', 'Windows text recognition language', !ocr ? null : /^en/i.test(ocr) ? true : null, ocr ? `${ocr}${/^en/i.test(ocr) ? '' : ' (works; English reads game text a little better)'}` : 'known once the screen reader has run', 'Optional: add English in Windows Settings → Time & language → Language, with "Optical character recognition".');
    add('edge', 'Microsoft Edge (overlay window)', !!edge, edge ? 'found' : 'not found', 'Install Microsoft Edge, or open http://localhost:7777/overlay in any browser.');
    let syncOk = null, syncDetail = 'not set up (optional)';
    if (settings().syncDir) { try { fs.accessSync(settings().syncDir, fs.constants.W_OK); syncOk = true; syncDetail = `${settings().syncDir} as ${settings().syncName}`; } catch { syncOk = false; syncDetail = `can't write to ${settings().syncDir}`; } }
    add('friends', 'Friends folder', syncOk, syncDetail, 'Pick a shared folder (OneDrive, Google Drive, Dropbox…) in Settings → Friends sync.');
    add('backup', 'Daily backup', settings().backupDir ? (backupState().error ? false : true) : null, settings().backupDir ? (backupState().error || `to ${settings().backupDir}`) : 'off (backups only inside the tracker folder)', 'Pick a folder outside this PC in Settings → Export & backup.');
    return { at: now, rows, problems: rows.filter((r) => r.status === 'fail').length, warnings: rows.filter((r) => r.status === 'warn').length };
  }
  function readerCheckView(now = Date.now()) {
    return { on: !!settings().screenReader, running: !!state().game.running, checks: READER_CHECKS.map(([id, label, tip]) => {
      const at = readerSeen[id] || null;
      return { id, label, tip, at, status: !at ? 'never' : now - at < 3 * 86400000 ? 'ok' : 'old' };
    }) };
  }

  return {
    readerOk, debugCapture, debugList, debugBundle, setupCheck, readerCheckView, DEBUG_DIR,
    setTrayStatus(x) { trayStatus = x; store.writeJson('tray-status.json', trayStatus); },
    trayPing() { lastTrayAt = Date.now(); },
    trayOn: (now = Date.now()) => now - lastTrayAt < 30000,
  };
};
