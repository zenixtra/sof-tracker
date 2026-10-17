// Starts a real tracker on a separate port with its own data folder, a fake game folder and a fake process list,
// then checks the main endpoints, the dashboard files and following two game windows.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 7792;
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'sof-smoke-'));
const client = path.join(T, 'game', 'Client'), data = path.join(T, 'data'), tasks = path.join(T, 'tasklist.txt');
fs.mkdirSync(client, { recursive: true }); fs.mkdirSync(data);

const d = new Date(Date.now() - 10 * 60000), p2 = (n) => String(n).padStart(2, '0');
const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}_${p2(d.getSeconds())}`;
const writeLog = (pid, char, lines) => fs.writeFileSync(path.join(client, `log_${pid}.txt`), [`start time:${stamp}`, `Char_Count = 1, Name = ${char}, weaponClass = 3`, ...lines, ''].join('\r\n'));
writeLog(1111, 'Alpha', ['w:3 s:1 zone:101 x:100.0 z:200.0', '1 /2 Char: Alpha 900 900']);
writeLog(2222, 'Beta', ['w:3 s:1 zone:201 x:50.0 z:60.0', '1 /2 Char: Beta 800 800', '2 /2 Char: Stranger 555 800']);
const row = (pid) => `"YGOnline.exe","${pid}","Console","1","100.000 K","Running","u","0:00:01","Yulgang"`;
fs.writeFileSync(tasks, [row(1111), row(2222)].join('\r\n'));
fs.utimesSync(path.join(client, 'log_2222.txt'), new Date(Date.now() - 60000), new Date(Date.now() - 60000));

// screen readings: the saved real ones, then a death; the frame ring already holds two looks
const frames = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'frames.json'), 'utf8'));
const tEnd = frames[frames.length - 1].t;
frames.push({ t: tEnd + 2000, hp: '1200 / 2366', mp: '', exp: 45, chat: [], party: [{ name: 'Beta', hp: 40, y: 150 }] }, { t: tEnd + 4000, hp: '0 / 2366', mp: '', exp: 45, chat: [], effects: 'poison_mini@86,70', buffs: '2:501303@1228,524', minimap: '40,0;41,2;0,-30', minimapParty: '13,37', minimapMe: '81,61,220' });
const framesFile = path.join(T, 'frames.json');
fs.writeFileSync(framesFile, JSON.stringify(frames));
fs.mkdirSync(path.join(data, 'shots', 'ring'), { recursive: true });
for (const n of ['f0.jpg', 'f1.jpg']) fs.writeFileSync(path.join(data, 'shots', 'ring', n), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

let srv, out = '';
const get = (u) => fetch(`http://127.0.0.1:${PORT}${u}`);
const json = async (u) => (await get(u)).json();

test.before(async () => {
  srv = spawn(process.execPath, ['server.js'], { cwd: ROOT, env: { ...process.env, PORT, SOF_CLIENT_DIR: client, SOF_DATA_DIR: data, SOF_TEST_TASKLIST: tasks, SOF_OFFLINE: '1', SOF_TEST_FRAMES: framesFile }, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.stdout.on('data', (c) => (out += c)); srv.stderr.on('data', (c) => (out += c));
  for (let i = 0; i < 50; i++) { try { await get('/api/state'); return; } catch { await new Promise((r) => setTimeout(r, 200)); } }
  throw new Error(`tracker did not start:\n${out}`);
});
test.after(() => { srv?.kill(); fs.rmSync(T, { recursive: true, force: true }); });

test('state: follows the newest game window and tracks the other one', async () => {
  await new Promise((r) => setTimeout(r, 1500));
  const s = await json('/api/state');
  assert.strictEqual(s.game.count, 2);
  assert.strictEqual(s.session.character, 'Alpha');
  assert.deepStrictEqual(s.others.map((o) => o.character), ['Beta']);
  assert.strictEqual(s.others[0].seen, 1); // read from the log before start-up: seen, not "nearby now"
});

test('new lines in the second window are followed live', async () => {
  fs.appendFileSync(path.join(client, 'log_2222.txt'), ['w:3 s:1 zone:201 x:60.0 z:70.0', '3 /3 Char: Newcomer 444 800', ''].join('\r\n'));
  await new Promise((r) => setTimeout(r, 1500));
  const s = await json('/api/state');
  assert.strictEqual(s.others[0].nearby, 1);
  assert.deepStrictEqual(s.others[0].players.map((p) => p.name), ['Newcomer']);
  assert.strictEqual(s.others[0].x, 60);
});

test('the dashboard and all its scripts are served', async () => {
  const html = await (await get('/')).text();
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 8, 'dashboard scripts missing');
  for (const s of [...scripts, '/css/app.css', '/world.js', '/manifest.webmanifest', '/sw.js', '/icons/icon-192.png', '/icons/icon-512.png', '/calendar.ics']) assert.strictEqual((await get(s)).status, 200, s);
  assert.strictEqual((await get('/js/../server.js')).status, 404);
});

test('screen readings from real screenshots end up as drops, trade offers and a target', async () => {
  await new Promise((r) => setTimeout(r, 1500)); // the replay starts 2.5 s after start-up
  const drops = await json('/api/drops');
  assert.ok(drops.total >= 2, `drops: ${drops.total}`);
  assert.ok(drops.recent.some((d) => /Hooligan|Hoofigan/i.test(d.from)), JSON.stringify(drops.recent.map((d) => d.from)));
  const m = await json('/api/market');
  assert.ok(m.recent.some((o) => o.who === 'MrNohoMaster' && o.side === 'buy' && o.price === 150e6), JSON.stringify(m.recent));
  assert.ok(m.recent.some((o) => o.who === 'JumpingNote' || o.who === 'JumpEngNote'));
  const f = await json('/api/farming');
  assert.ok(Array.isArray(f.best) && Array.isArray(f.deaths));
  // the chat log keeps the trade messages once each
  const c = await json('/api/chat?who=MrNohoMaster');
  assert.ok(c.entries.length >= 1, JSON.stringify(c));
  assert.strictEqual(new Set(c.entries.map((e) => e.text)).size, c.entries.length);
});

test('a death keeps the last looks as a replay', async () => {
  const s = await json('/api/shots');
  assert.strictEqual(s.deaths.length, 1, JSON.stringify(s));
  assert.strictEqual(s.deaths[0].frames, 2);
  const img = await get(`/shots/${s.deaths[0].id}/01.jpg`);
  assert.strictEqual(img.status, 200);
  assert.strictEqual(img.headers.get('content-type'), 'image/jpeg');
  assert.strictEqual((await get('/shots/../settings.json.jpg')).status, 404);
  const a = await json('/api/alerts');
  assert.ok(a.some((x) => /^You died in/.test(x.title)), JSON.stringify(a.map((x) => x.title)));
});

test('peek, trader profile, drop table by monster, level forecast, bot previews', async () => {
  const peek = await get('/api/peek.jpg');
  assert.strictEqual(peek.status, 200);
  assert.strictEqual(peek.headers.get('content-type'), 'image/jpeg');
  const tr = await json('/api/trader?name=MrNohoMaster');
  assert.ok(tr.offers >= 1 && tr.items.some((x) => x.side === 'buy'), JSON.stringify(tr));
  const d = await json('/api/drops');
  assert.ok(d.mobs.some((m) => /Hooligan|Hoofigan/i.test(m.from) && m.items.length), JSON.stringify(d.mobs));
  const fc = await json('/api/level-forecast');
  assert.ok('perHour' in fc && Array.isArray(fc.levels));
  for (const cmd of ['screen', 'chat', 'whispers', 'price']) {
    const r = await json(`/api/discord-bot/try?cmd=${cmd}&arg=x`);
    assert.strictEqual(typeof r.text, 'string', cmd);
  }
  const h = await json('/api/heatmap');
  assert.ok(Array.isArray(h.deaths));
});

test('phone page, CSV exports, storage view, digest and weekly price changes', async () => {
  const p = await get('/phone');
  assert.strictEqual(p.status, 200);
  assert.match(await p.text(), /EventSource\('\/events(\?delta=1)?'\)/);
  const c = await get('/api/export/offers.csv');
  assert.match(c.headers.get('content-type'), /text\/csv/);
  const raw = Buffer.from(await c.arrayBuffer());
  assert.deepStrictEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf]); // UTF-8 mark, so Excel shows names right
  const lines = raw.toString('utf8').replace(/^﻿/, '').split('\r\n');
  assert.match(lines[0], /^time,player,side,item/);
  assert.ok(lines.some((l) => l.includes('MrNohoMaster')));
  const s = await json('/api/storage');
  assert.deepStrictEqual(s.parts.map((x) => x.what), ['chat', 'offers', 'drops', 'pictures', 'timelines', 'overlay', 'slim']);
  assert.ok(s.parts.find((x) => x.what === 'pictures').count >= 1); // the death replay
  const d = await json('/api/digest');
  assert.match(d.title, /^Today: /);
  assert.ok(Array.isArray((await json('/api/report')).movers));
});

test('setup export and import: markers with notes, watchlist and quiet hours come over', async () => {
  const file = await json('/api/setup-export');
  assert.strictEqual(file.format, 'sof-tracker-setup');
  assert.ok(!('notify' in file), 'no tokens unless asked for');
  file.waypoints.push({ id: 'imp1', zone: '101', x: 1, z: 2, label: 'Imported spot', kind: 'farm', note: 'from a friend' });
  file.watchlist.push('ImportedPlayer');
  file.settings.quietFrom = 1; file.settings.quietTo = 7; file.settings.backupDir = 'Z:\\not-on-this-pc';
  const r = await fetch(`http://127.0.0.1:${PORT}/api/setup-import`, { method: 'POST', body: JSON.stringify(file) });
  assert.strictEqual(r.status, 200, await r.clone().text());
  const sum = await r.json();
  assert.deepStrictEqual(sum.map((x) => x.what).slice(0, 2), ['Watchlist', 'Map markers']);
  const s = await json('/api/state');
  assert.ok(s.waypoints.some((w) => w.label === 'Imported spot' && w.note === 'from a friend'));
  assert.ok(s.watchlist.includes('ImportedPlayer'));
  const st = await json('/api/settings');
  assert.deepStrictEqual([st.quietFrom, st.quietTo, st.backupDir], [1, 7, '']); // another PC's folder left out
  const bad = await fetch(`http://127.0.0.1:${PORT}/api/setup-import`, { method: 'POST', body: '{"x":1}' });
  assert.strictEqual(bad.status, 400);
});

test('records, rivals, farming plan, death analysis, house activity, status voice, health, widgets', async () => {
  const rec = await json('/api/records');
  assert.deepStrictEqual(rec.map((r) => r.id), ['expHour', 'sessionExp', 'sessionKills', 'cleanSession', 'rareDrop']);
  const rv = await json('/api/rivals');
  assert.ok(Array.isArray(rv.list));
  const pl = await json('/api/plan-session?hours=2');
  assert.strictEqual(pl.hours, 2); assert.ok(Array.isArray(pl.spots));
  const da = await json('/api/death-analysis');
  assert.strictEqual(da.total, 1); // the replayed death
  assert.strictEqual(da.hours.length, 24);
  assert.ok((await get('/api/house-activity?name=')).status === 200);
  const v = await json('/api/voice-status');
  assert.strictEqual(typeof v.text, 'string'); assert.ok(v.text.length > 5);
  assert.ok(Array.isArray((await json('/api/health')).samples));
  for (const w of ['exph', 'kills', 'drop', 'hp', 'goal']) assert.strictEqual((await get(`/widget?show=${w}`)).status, 200);
  const s = await json('/api/state');
  assert.ok('expGoal' in s && 'sessionKills' in (s.screen || { sessionKills: 0 }));
});

test('effect icons and minimap dots from the screen end up in the live state', async () => {
  // the test tracker replays saved looks and never starts a real reader, so switching it on only shows what was read
  const on = await fetch(`http://127.0.0.1:${PORT}/api/settings`, { method: 'POST', body: JSON.stringify({ screenReader: true }) });
  assert.strictEqual(on.status, 200);
  const sc = (await json('/api/state')).screen;
  // (the test game folder has no icons, so the buff has no name here)
  assert.deepStrictEqual(sc.effects.map((e) => [e.label, e.kind]), [['Poisoned', 'debuff'], ['Buff', 'buff']]);
  assert.deepStrictEqual([sc.minimap.count, sc.minimap.mostly, sc.minimap.party.length, sc.minimap.facing], [3, 'east', 1, 220]);
  await fetch(`http://127.0.0.1:${PORT}/api/settings`, { method: 'POST', body: JSON.stringify({ screenReader: false }) });
});

test('price watches: unknown items are refused, deleting works', async () => {
  // (the test game folder has no item database: every item is unknown here)
  const bad = await fetch(`http://127.0.0.1:${PORT}/api/price-watch`, { method: 'POST', body: JSON.stringify({ item: 'Hard Iron Crystal', side: 'sell', price: '20m' }) });
  assert.strictEqual(bad.status, 400);
  assert.match(await bad.text(), /Pick an item/);
  const del = await (await fetch(`http://127.0.0.1:${PORT}/api/price-watch`, { method: 'POST', body: JSON.stringify({ action: 'delete', id: 'nope' }) })).json();
  assert.deepStrictEqual(del, []);
});

test('main endpoints answer', async () => {
  for (const u of ['/api/sessions', '/api/calendar', '/api/encounters', '/api/stats', '/api/alerts', '/api/gamedb', '/api/activity', '/api/patches', '/api/selfcheck', '/api/report', '/api/screens', '/api/shots', '/api/chat', '/api/price-watch', '/api/price-history?item=1', '/api/announcements', '/api/digest', '/api/storage']) {
    const r = await get(u);
    assert.strictEqual(r.status, 200, u);
    await r.json();
  }
});

test('live updates: slow parts are sent once, then left out while they stay the same', async () => {
  const ctl = new AbortController();
  const r = await fetch(`http://127.0.0.1:${PORT}/events?delta=1`, { signal: ctl.signal });
  const reader = r.body.getReader(), dec = new TextDecoder();
  let buf = '';
  const next = async () => { while (!buf.includes('\n\n')) { const { value } = await reader.read(); buf += dec.decode(value); } const i = buf.indexOf('\n\n'), m = buf.slice(6, i); buf = buf.slice(i + 2); return JSON.parse(m); };
  const a = await next(), b = await next();
  ctl.abort();
  assert.ok(a.rankings && !a.same);
  assert.ok(b.same.includes('rankings') && !('rankings' in b));
});

test('setup check, phone plan and the PC-only debug routes answer', async () => {
  const s = await json('/api/setup-check');
  assert.ok(s.rows.some((r) => r.id === 'game' && r.status === 'ok'));
  assert.ok(['ok', 'warn', 'fail'].includes(s.rows.find((r) => r.id === 'tray').status));
  const p = await json('/api/phone-plan');
  assert.ok(Array.isArray(p.checklist) && Array.isArray(p.trip) && Array.isArray(p.goals));
  assert.strictEqual((await get('/api/debug')).status, 200); // from this PC
  const st = await json('/api/storage');
  assert.ok(st.parts.some((x) => x.what === 'slim'));
});

test('"try these": the readers not seen working yet, while the game runs', async () => {
  const s = await json('/api/state');
  assert.ok(s.tryNext === null || Array.isArray(s.tryNext));
});
