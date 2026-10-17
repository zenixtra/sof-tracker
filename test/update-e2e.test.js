// The real tracker against a pretend update server: blocked when outdated, the block holds after a restart without
// the server, data routes refuse while blocked, and access comes back once the version is allowed again.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const manifest = require('../lib/manifest');

const ROOT = path.join(__dirname, '..');
const PORT = 7793, UPD_PORT = 7794;
const CURRENT = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const [maj, min] = CURRENT.split('.').map(Number);
const NEXT = `${maj}.${min + 1}.0`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sof-e2e-'));
const data = path.join(tmp, 'data'); fs.mkdirSync(data);
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PUB = publicKey.export({ type: 'spki', format: 'pem' }), PRIV = privateKey.export({ type: 'pkcs8', format: 'pem' }), KEY = manifest.keyIdOf(PUB);
const cfgFile = path.join(tmp, 'release.config.json');
fs.writeFileSync(cfgFile, JSON.stringify({ manifestUrl: `http://127.0.0.1:${UPD_PORT}/update.json`, publicKeys: [{ id: KEY, pem: PUB }] }));

let seq = 0, served = null, tracker = null, updSrv = null;
const publish = (minimum, latest = NEXT) => {
  served = manifest.sign({ product: 'sof-tracker', sequence: ++seq, issuedAt: new Date().toISOString(), latest, minimum, offlineGraceHours: 168,
    releases: [{ version: latest, url: `https://github.com/o/r/releases/download/v${latest}/SoF-Tracker-Setup-${latest}.exe`, sha256: 'a'.repeat(64), size: 1000, notes: 'Fixes' }], revoked: [] }, PRIV, KEY);
};
const base = `http://127.0.0.1:${PORT}`;
const get = (u, o) => fetch(base + u, o);
async function startTracker() {
  tracker = spawn(process.execPath, ['server.js'], { cwd: ROOT, stdio: 'ignore', env: { ...process.env, PORT: String(PORT), SOF_DATA_DIR: data, SOF_CLIENT_DIR: path.join(tmp, 'nogame'),
    SOF_OFFLINE: '1', SOF_UPDATE_URL: `http://127.0.0.1:${UPD_PORT}/update.json`, SOF_UPDATE_INSECURE_LOCAL: '1', SOF_RELEASE_CONFIG: cfgFile, SOF_TREAT_AS_INSTALLED: '1', SOF_TEST_TASKLIST: path.join(tmp, 'none.txt') } });
  for (let i = 0; i < 100; i++) { try { if ((await get('/api/update')).ok) return; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 150)); }
  throw new Error('tracker did not start');
}
async function stopTracker() { if (!tracker) return; const t = tracker; tracker = null; if (t.exitCode !== null) return; await new Promise((r) => { t.on('exit', r); t.kill(); }); }
async function waitFor(fn, ms = 15000) { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 200)); } }

test.before(async () => {
  updSrv = http.createServer((req, res) => { if (req.url === '/update.json' && served) { res.writeHead(200); res.end(served); } else { res.writeHead(404); res.end(); } });
  await new Promise((r) => updSrv.listen(UPD_PORT, '127.0.0.1', r));
});
test.after(async () => { await stopTracker(); updSrv?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

test(`an outdated version (${CURRENT}, minimum ${NEXT}) is blocked; data routes refuse; the block holds after a restart without the server`, { timeout: 60000 }, async () => {
  publish(NEXT);
  await startTracker();
  const u = await waitFor(async () => { const j = await (await get('/api/update')).json(); return j.blocked && j; });
  assert.deepStrictEqual([u.state, u.current, u.target.version], ['required', CURRENT, NEXT]);
  // every data route answers 426, the live feed only carries the update screen
  for (const r of ['/api/sessions', '/api/stats', '/api/chat', '/api/settings']) assert.strictEqual((await get(r)).status, 426, r);
  assert.strictEqual((await get('/api/settings', { method: 'POST', body: '{"lang":"tr"}' })).status, 426);
  const st = await (await get('/api/state')).json();
  assert.strictEqual(st.blocked, true); assert.strictEqual(st.session, undefined);
  // the pages still load (they show the update screen)
  assert.strictEqual((await get('/')).status, 200);
  // restart with the update server gone: still blocked (the signed file is kept)
  await stopTracker();
  served = null;
  await startTracker();
  const again = await (await get('/api/update')).json();
  assert.strictEqual(again.blocked, true);
  assert.strictEqual((await get('/api/sessions')).status, 426);
});

test('a forged update file is ignored; publishing this version as the minimum lifts the block', { timeout: 60000 }, async () => {
  // someone serves a file that unblocks, signed with a different key: refused
  const other = crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
  served = manifest.sign({ product: 'sof-tracker', sequence: 99, issuedAt: new Date().toISOString(), latest: CURRENT, minimum: CURRENT, releases: [{ version: CURRENT, url: 'https://github.com/x', sha256: 'b'.repeat(64), size: 1 }] }, other, KEY);
  const f = await (await get('/api/update/check', { method: 'POST', body: '{}' })).json();
  assert.strictEqual(f.blocked, true); assert.match(f.lastError, /signature/);
  // the real publisher lowers the minimum to this version: allowed again
  publish(CURRENT);
  const ok = await (await get('/api/update/check', { method: 'POST', body: '{}' })).json();
  assert.deepStrictEqual([ok.blocked, ok.state], [false, 'optional']);
  assert.strictEqual((await get('/api/sessions')).status, 200);
});

test('cross-site requests are refused, also while blocked', async () => {
  assert.strictEqual((await get('/api/update/check', { method: 'POST', body: '{}', headers: { Origin: 'https://evil.example' } })).status, 403);
  // (fetch won't send a made-up Host header: a plain request does, like a DNS-rebinding page would)
  const status = await new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port: PORT, path: '/api/state', headers: { Host: 'evil.example' } }, (r) => { r.resume(); resolve(r.statusCode); }).on('error', reject));
  assert.strictEqual(status, 403);
});
