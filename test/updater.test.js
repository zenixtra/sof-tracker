'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const version = require('../lib/version');
const manifest = require('../lib/manifest');
const { Updater, decide } = require('../lib/updater');

const H = 3600000, NOW = Date.UTC(2026, 9, 17, 12);
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PUB = publicKey.export({ type: 'spki', format: 'pem' }), PRIV = privateKey.export({ type: 'pkcs8', format: 'pem' });
const KEY_ID = manifest.keyIdOf(PUB);
const INSTALLER = Buffer.from('MZ pretend installer '.repeat(500));
const SHA = crypto.createHash('sha256').update(INSTALLER).digest('hex');

const payload = (o = {}) => ({
  product: 'sof-tracker', sequence: 5, issuedAt: new Date(NOW).toISOString(), latest: '1.45.0', minimum: '1.44.0', offlineGraceHours: 168,
  releases: [{ version: '1.45.0', url: 'https://github.com/o/r/releases/download/v1.45.0/SoF-Tracker-Setup-1.45.0.exe', sha256: SHA, size: INSTALLER.length, mandatory: false, notes: 'New things' }],
  revoked: [], ...o,
});
const signed = (o) => manifest.sign(payload(o), PRIV, KEY_ID);

test('version numbers: compared part by part, malformed ones rejected', () => {
  assert.ok(version.compare('1.2.10', '1.2.9') > 0);
  assert.ok(version.compare('1.10.0', '1.9.99') > 0);
  assert.ok(version.compare('2.0.0', '1.99.99') > 0);
  assert.strictEqual(version.compare('1.2.3', '1.2.3'), 0);
  assert.ok(version.lt('1.0.0', '1.1.0'));
  for (const bad of ['1.2', '1.2.3.4', 'v1.2.3', '1.2.x', '01.2.3', '1.2.3-beta', '', null]) assert.strictEqual(version.valid(bad), false, String(bad));
  assert.throws(() => version.compare('1.2', '1.2.0'));
});

test('the update file: a correct signature passes; changed, forged or malformed files are refused', () => {
  const keys = [{ id: KEY_ID, pem: PUB }];
  assert.strictEqual(manifest.verify(signed(), keys).latest, '1.45.0');
  // changed after signing: minimum lowered
  const env = JSON.parse(signed());
  const p = JSON.parse(Buffer.from(env.payload, 'base64').toString()); p.minimum = '1.0.0';
  env.payload = Buffer.from(JSON.stringify(p)).toString('base64');
  assert.throws(() => manifest.verify(JSON.stringify(env), keys), /signature does not match/);
  // someone else's key
  const other = crypto.generateKeyPairSync('ed25519');
  assert.throws(() => manifest.verify(manifest.sign(payload(), other.privateKey.export({ type: 'pkcs8', format: 'pem' }), KEY_ID), keys), /signature does not match/);
  assert.throws(() => manifest.verify(signed(), [{ id: 'other', pem: PUB }]), /unknown key/);
  assert.throws(() => manifest.verify('{nope', keys), /not valid JSON/);
  assert.throws(() => manifest.verify('{"schema":1}', keys), /not a signed update file/);
  // invalid content can't even be signed
  assert.throws(() => signed({ minimum: '1.46.0' }), /minimum is newer than latest/);
  assert.throws(() => signed({ latest: '1.45' }), /not a version/);
  assert.throws(() => signed({ releases: [{ ...payload().releases[0], url: 'http://example.com/x.exe' }] }), /https/);
  assert.throws(() => signed({ releases: [{ ...payload().releases[0], sha256: 'abc' }] }), /sha256/);
  assert.throws(() => signed({ latest: '1.46.0' }), /no download for latest/);
});

test('decisions: current, newer optional, minimum higher, mandatory latest, revoked, offline', () => {
  const m = manifest.validate(payload());
  const at = { verifiedAt: NOW - H, firstRunAt: NOW - 100 * H, now: NOW };
  assert.strictEqual(decide('1.45.0', m, at).state, 'current');
  assert.strictEqual(decide('1.46.0', m, at).state, 'current'); // newer than published (your own test build)
  assert.deepStrictEqual([decide('1.44.5', m, at).state, decide('1.44.5', m, at).blocked], ['optional', false]);
  // 1.0.0 installed, minimum 1.1.0 published
  const m2 = manifest.validate(payload({ latest: '1.1.0', minimum: '1.1.0', releases: [{ ...payload().releases[0], version: '1.1.0' }] }));
  const r = decide('1.0.0', m2, at);
  assert.deepStrictEqual([r.state, r.blocked, r.target.version], ['required', true, '1.1.0']);
  assert.strictEqual(decide('1.1.0', m2, at).blocked, false);
  // the newest release marked mandatory
  const m3 = manifest.validate(payload({ releases: [{ ...payload().releases[0], mandatory: true }] }));
  assert.strictEqual(decide('1.44.5', m3, at).state, 'required');
  // a withdrawn release sends users to its replacement
  const m4 = manifest.validate(payload({ revoked: [{ version: '1.44.5', reason: 'Crashes at start', replacement: '1.45.0' }] }));
  assert.deepStrictEqual([decide('1.44.5', m4, at).state, decide('1.44.5', m4, at).target.version], ['revoked', '1.45.0']);
  // no successful check for longer than the grace: blocked; a known block stays even when offline
  assert.strictEqual(decide('1.45.0', m, { ...at, verifiedAt: NOW - 169 * H }).state, 'offline');
  assert.strictEqual(decide('1.0.0', m2, { ...at, verifiedAt: NOW - 1000 * H }).state, 'required');
  // never reached the server: the grace counts from the first start
  assert.strictEqual(decide('1.45.0', null, { firstRunAt: NOW - 10 * H, now: NOW }).state, 'unknown');
  assert.strictEqual(decide('1.45.0', null, { firstRunAt: NOW - 200 * H, now: NOW }).state, 'offline');
  // a development copy (no key configured) is never blocked
  assert.strictEqual(decide('0.0.1', m2, { ...at, configured: false }).blocked, false);
});

// a fake web: the update file, a redirect to the download host, the installer
function web(routes) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const r = routes[url];
    if (r === undefined) throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    if (r.redirect) return new Response(null, { status: 302, headers: { location: r.redirect } });
    if (r.status) return new Response('nope', { status: r.status });
    return new Response(r.body, { status: 200 });
  };
  return { fetchImpl, calls };
}
const URL_M = 'https://raw.githubusercontent.com/o/r/main/updates/update.json';
const DL = payload().releases[0].url, DL2 = 'https://objects.githubusercontent.com/asset/1';
function updater(routes, { stored = null, current = '1.44.0', now = () => NOW } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sof-upd-'));
  let saved = stored; const spawned = [];
  const w = web(routes);
  const u = new Updater({ current, dir, config: { manifestUrl: URL_M, publicKeys: [{ id: KEY_ID, pem: PUB }] }, read: () => saved, save: (s) => { saved = JSON.parse(JSON.stringify(s)); },
    fetchImpl: w.fetchImpl, now, spawn: (f, a) => spawned.push([f, a]) });
  return { u, dir, spawned, saved: () => saved, calls: w.calls };
}

test('check: an outdated version is blocked, and stays blocked after a restart without internet', async () => {
  const m = signed({ minimum: '1.45.0' });
  const a = updater({ [URL_M]: { body: m } });
  const st = await a.u.check();
  assert.deepStrictEqual([st.state, st.blocked, st.target.version], ['required', true, '1.45.0']);
  // restart, server unreachable: the stored, verified file still blocks
  const b = updater({}, { stored: a.saved() });
  const st2 = await b.u.check();
  assert.strictEqual(st2.blocked, true);
  assert.match(st2.lastError, /no connection/);
});

test('check: an unreachable server or a broken file keeps the last good one; an older file is refused', async () => {
  const good = updater({ [URL_M]: { body: signed({ sequence: 9 }) } });
  await good.u.check();
  for (const routes of [{}, { [URL_M]: { status: 500 } }, { [URL_M]: { body: '{"broken' } }, { [URL_M]: { body: signed({ sequence: 3, minimum: '1.0.0' }) } }]) {
    const x = updater(routes, { stored: good.saved() });
    const st = await x.u.check();
    assert.strictEqual(st.latest, '1.45.0');
    assert.ok(st.lastError, JSON.stringify(routes).slice(0, 40));
    assert.strictEqual(x.saved().sequence, 9);
  }
  const older = updater({ [URL_M]: { body: signed({ sequence: 3 }) } }, { stored: good.saved() });
  assert.match((await older.u.check()).lastError, /older update file/);
});

test('download and install: verified, run with -Update, confirmed after the restart', async () => {
  const a = updater({ [URL_M]: { body: signed({ minimum: '1.45.0' }) }, [DL]: { redirect: DL2 }, [DL2]: { body: INSTALLER } });
  await a.u.check();
  const r = await a.u.install();
  assert.strictEqual(r.started, '1.45.0');
  assert.strictEqual(a.spawned.length, 1);
  assert.deepStrictEqual(a.spawned[0][1], ['-Update']);
  assert.strictEqual(fs.readFileSync(a.spawned[0][0]).equals(INSTALLER), true);
  // the tracker restarts as 1.45.0: confirmed, unblocked
  const b = updater({ [URL_M]: { body: signed({ minimum: '1.45.0' }) } }, { stored: a.saved(), current: '1.45.0' });
  assert.deepStrictEqual(b.u.confirmInstall().updated, { from: '1.44.0', to: '1.45.0' });
  assert.strictEqual((await b.u.check()).blocked, false);
});

test('a failed update: still the old version 5 minutes after setup ran → explained, retry possible', async () => {
  let t = NOW;
  const a = updater({ [URL_M]: { body: signed({ minimum: '1.45.0' }) }, [DL]: { body: INSTALLER } }, { now: () => t });
  await a.u.check(); await a.u.install();
  const b = updater({}, { stored: a.saved(), now: () => t + 6 * 60000 });
  const r = b.u.confirmInstall();
  assert.match(r.failed.reason, /still installed/);
  const st = b.u.status();
  assert.strictEqual(st.blocked, true);
  assert.ok(st.failed);
});

test('an installer that fails the integrity check is never run', async () => {
  const tampered = Buffer.from(INSTALLER); tampered[10] ^= 1;
  for (const [what, body, re] of [['changed bytes', tampered, /fingerprint/], ['cut short', INSTALLER.subarray(0, 100), /stopped early/], ['too big', Buffer.concat([INSTALLER, INSTALLER]), /bigger/]]) {
    const a = updater({ [URL_M]: { body: signed({ minimum: '1.45.0' }) }, [DL]: { body } });
    await a.u.check();
    await assert.rejects(a.u.install(), re, what);
    assert.strictEqual(a.spawned.length, 0, what);
    assert.deepStrictEqual(fs.readdirSync(a.dir), [], `${what}: nothing left behind`);
  }
  // a download sent to a host that isn't allowed, or over http
  const b = updater({ [URL_M]: { body: signed({ minimum: '1.45.0' }) }, [DL]: { redirect: 'https://evil.example/x.exe' } });
  await b.u.check();
  await assert.rejects(b.u.install(), /refused a download from evil\.example/);
  const c = updater({ [URL_M]: { body: signed({ minimum: '1.45.0' }) }, [DL]: { redirect: 'http://objects.githubusercontent.com/x' } });
  await c.u.check();
  await assert.rejects(c.u.install(), /non-https/);
});

test('the offline grace can\'t be stretched by moving the PC clock back', async () => {
  let t = NOW;
  const a = updater({ [URL_M]: { body: signed() } }, { current: '1.45.0', now: () => t });
  await a.u.check();
  t = NOW + 180 * H; // a week and a half day later, no internet (the clock may drift back up to 6 hours)
  const b = updater({}, { stored: a.saved(), current: '1.45.0', now: () => t });
  assert.strictEqual(b.u.status().state, 'offline');
  t = NOW; // clock set back
  assert.strictEqual(b.u.status().state, 'offline');
});
