// Self-check: after a game update (and at start-up, daily, or on demand) test every reader the tracker relies on
// and say plainly what stopped working. Each check: { id, area, label, level: ok | warn | fail, detail }.
'use strict';

const fs = require('fs');
const path = require('path');

const MIN = { items: 5000, monsters: 500, npcs: 100, skills: 300, quests: 500, zones: 50, npcSpots: 200, portals: 10 };

/**
 * ctx: { clientDir, gameDir, gameDb, previous (last result or null), templates (count), zoneMaps (count),
 *        worldZones (count | null), guideMonsters (count), logins (count), parseLog(file) -> session,
 *        readTerrain(zone), iconTest() -> bytes, rankings: { fetchedAt, error }, news: { fetchedAt, error } }
 */
function runSelfCheck(ctx, reason = 'manual') {
  const checks = [];
  const add = (id, area, label, level, detail = '') => checks.push({ id, area, label, level, detail });
  const safe = (id, area, label, fn) => { try { fn(); } catch (e) { add(id, area, label, 'fail', e.message); } };

  // ---- the game folder and its logs
  const hasClient = fs.existsSync(path.join(ctx.clientDir, 'Ybi.cfg'));
  add('folder', 'Game files', 'Game folder', hasClient ? 'ok' : 'fail', hasClient ? ctx.clientDir : `Not found: ${ctx.clientDir}`);

  safe('log', 'Game logs', 'Session log (positions, players, character)', () => {
    const logs = fs.readdirSync(ctx.clientDir).filter((f) => /^log(_\d+|2)\.txt$/i.test(f))
      .map((f) => ({ f, t: fs.statSync(path.join(ctx.clientDir, f)).mtimeMs, size: fs.statSync(path.join(ctx.clientDir, f)).size }))
      .filter((x) => x.size > 1000).sort((a, b) => b.t - a.t);
    // test the newest log in which a map was loaded (a game closed at the login screen has nothing to read)
    let s = null, file = null;
    // (zones 1000001/2 are the login and character-select screens)
    for (const l of logs.slice(0, 6)) { const p = ctx.parseLog(l.f); if (p.zoneHistory.some((z) => z.zone < 1000000)) { s = p; file = l.f; break; } }
    if (!s) return add('log', 'Game logs', 'Session log (positions, players, character)', 'warn', 'No played session to test yet: enter the game once');
    logs[0] = { f: file };
    const positions = s.track.length, players = Object.keys(s.players).length;
    const missing = [!s.startedAt && 'start time', !s.character && 'character', !positions && 'positions'].filter(Boolean);
    add('log', 'Game logs', 'Session log (positions, players, character)', missing.length ? (missing.includes('positions') && missing.length === 1 ? 'warn' : 'fail') : 'ok',
      missing.length ? `${logs[0].f}: could not read ${missing.join(', ')}` : `${logs[0].f}: ${s.character}, ${positions} positions, ${players} players`);
  });
  add('notices', 'Game logs', 'Timed server notices (boss & event timers)', ctx.templates > 0 ? 'ok' : 'fail', `${ctx.templates} timer texts from Ybmsg.cfg`);
  add('logins', 'Game logs', 'Login log (play time)', ctx.logins > 0 ? 'ok' : 'warn', ctx.logins > 0 ? `${ctx.logins} logins read` : 'No logins found in log3.txt');

  // ---- the decoded game database: enough records, and not suddenly fewer than last time
  const db = ctx.gameDb || {};
  const before = ctx.previous?.counts || {};
  const counts = {};
  for (const [k, min] of Object.entries(MIN)) {
    const n = k === 'zones' ? Object.keys(db.zones || {}).length : (db[k] || []).length;
    counts[k] = n;
    const dropped = before[k] && n < before[k] * 0.7;
    add(`db-${k}`, 'Game database', `Decoded ${k === 'npcSpots' ? 'NPC positions' : k}`, n < min || dropped ? 'fail' : 'ok',
      `${n.toLocaleString('en-US')}${before[k] && before[k] !== n ? ` (was ${before[k].toLocaleString('en-US')})` : ''}${n < min ? ` · expected at least ${min}` : ''}${dropped ? ' · much fewer than before: the file format probably changed' : ''}`);
  }
  const feather = (db.items || []).find((i) => i.id === 1);
  add('db-sample', 'Game database', 'Known records still read correctly', feather?.name === 'Feather Earring' && db.zones?.[101] === 'Central Valley' ? 'ok' : 'fail',
    feather ? `item 1 = "${feather.name}", zone 101 = "${db.zones?.[101]}"` : 'item 1 not found');

  // ---- maps, icons, the guide
  safe('terrain', '3D & maps', '3D terrain', () => {
    const t = ctx.readTerrain(101);
    add('terrain', '3D & maps', '3D terrain', t && t.n === 129 && t.max > t.min ? 'ok' : 'fail', t ? `Central Valley: ${t.n}×${t.n} heights` : 'Central Valley terrain not readable');
  });
  add('minimaps', '3D & maps', 'Zone maps', ctx.zoneMaps >= 5 ? 'ok' : 'fail', `${ctx.zoneMaps} zones with a minimap and position`);
  if (ctx.worldZones != null) add('world', '3D & maps', 'Zones in the 3D view', ctx.worldZones >= 5 ? 'ok' : 'warn', `${ctx.worldZones} zones`);
  safe('icons', '3D & maps', 'Item icons', () => { const n = ctx.iconTest(); add('icons', '3D & maps', 'Item icons', n > 100 ? 'ok' : 'fail', `test icon: ${n} bytes`); });
  add('guide', 'Guide', 'Game guide (CHM)', ctx.guideMonsters > 0 ? 'ok' : 'warn', `${ctx.guideMonsters} monsters`);

  // ---- the official website
  const web = (id, label, s) => {
    const age = s.fetchedAt ? Date.now() - s.fetchedAt : null;
    add(id, 'Website', label, s.error ? 'warn' : age != null && age < 3 * 3600000 ? 'ok' : 'warn',
      s.error ? `Last try failed: ${s.error}` : age != null ? `Updated ${Math.round(age / 60000)} min ago` : 'Not loaded yet');
  };
  web('rankings', 'Rankings', ctx.rankings);
  web('news', 'News & maintenance', ctx.news);

  // ---- the screen reader (only while it is on and the game runs: it can't be tested otherwise)
  const sc = ctx.screen;
  if (sc?.on && sc.gameRunning) {
    const A = 'Screen reader', now = Date.now(), ago = (t) => (t ? `${Math.max(0, Math.round((now - t) / 60000))} min ago` : 'never');
    const warmedUp = sc.since && now - sc.since > 3 * 60000; // give it a few minutes after start-up before calling anything broken
    const status = sc.status === 'hidden' ? 'the game window is minimised' : sc.status === 'covered' ? 'no picture of the game window (bring it to the front once)' : sc.status === 'error' ? sc.error : null;
    add('sr-looks', A, 'Looking at the game window', status ? (sc.status === 'error' ? 'fail' : 'warn') : sc.lastFrameAt && now - sc.lastFrameAt < 2 * 60000 ? 'ok' : warmedUp ? 'fail' : 'warn',
      status || (sc.lastFrameAt ? `${sc.frames} looks, last ${ago(sc.lastFrameAt)} · window ${sc.w}×${sc.h}` : 'starting…'));
    if (sc.lastFrameAt && !status) {
      const read = (id, label, t, hint, limit = 10) => add(id, A, label, t && now - t < limit * 60000 ? 'ok' : warmedUp ? 'fail' : 'warn', t && now - t < limit * 60000 ? `last read ${ago(t)}` : `${warmedUp ? 'Not read' : 'Not read yet'} (last: ${ago(t)}). ${hint}`);
      read('sr-hp', 'HP / MP numbers', sc.lastHpAt, 'The HUD may have moved: a different window size or interface scale than 1024×768 / 100 %?');
      read('sr-exp', 'EXP bar', sc.lastExpAt, 'The EXP bar along the bottom edge was not found.');
      read('sr-chat', 'Chat messages', sc.lastChatAt, 'The chat may just be quiet, or the chat box was moved, resized or closed.', 30);
    }
    if (sc.ocr) add('sr-ocr', A, 'Text recognition language', /^en/i.test(sc.ocr) ? 'ok' : 'warn',
      /^en/i.test(sc.ocr) ? sc.ocr : `${sc.ocr}: reading works, but English text recognition reads the chat better. Add it in Windows Settings → Time & Language → Language → Add a language → English (United States).`);
  }

  const fails = checks.filter((c) => c.level === 'fail').length, warns = checks.filter((c) => c.level === 'warn').length;
  return { at: Date.now(), reason, ok: !fails, fails, warns, counts, checks };
}

module.exports = { runSelfCheck };
