'use strict';

const test = require('node:test');
const assert = require('node:assert');
const guard = require('../lib/guard');

const cfg = { port: 7777, lanMode: false, lanKey: 'k'.repeat(24), pcNames: ['GAMEPC'] };
const req = (headers, remote = '127.0.0.1') => ({ headers, socket: { remoteAddress: remote } });
const run = (headers, { remote, path = '/api/state', ...c } = {}) => guard.check(req(headers, remote), new URL(path, 'http://x'), { ...cfg, ...c });

test('the tracker\'s own pages and local programs are allowed', () => {
  assert.ok(run({ host: 'localhost:7777' }).ok);
  assert.ok(run({ host: '127.0.0.1:7777', origin: 'http://127.0.0.1:7777', 'sec-fetch-site': 'same-origin' }).ok);
  assert.ok(run({ host: 'localhost:7777', 'sec-fetch-site': 'none' }).ok); // typed in the address bar / OBS
  assert.ok(run({ host: '[::1]:7777' }, { remote: '::1' }).ok);
});

test('DNS rebinding: an outside host name pointing at this PC is refused', () => {
  assert.strictEqual(run({ host: 'evil.example:7777' }).status, 403);
  assert.strictEqual(run({ host: 'localhost:8080' }).status, 403);
  assert.strictEqual(run({ host: '192.168.1.5:7777' }).status, 403); // phone mode off
});

test('cross-site requests are refused', () => {
  assert.strictEqual(run({ host: 'localhost:7777', origin: 'https://evil.example' }).status, 403);
  assert.strictEqual(run({ host: 'localhost:7777', origin: 'null' }).status, 403);
  assert.strictEqual(run({ host: 'localhost:7777', 'sec-fetch-site': 'cross-site' }).status, 403);
  assert.strictEqual(run({ host: 'localhost:7777', origin: 'http://localhost:9999' }).status, 403);
  assert.strictEqual(run({ host: '127.0.0.1:7777', origin: 'http://localhost:7777' }).status, 403); // a different name for the page than for the request
});

test('phone mode: other devices need the access key, then a cookie', () => {
  const lan = { lanMode: true, remote: '192.168.1.20' };
  assert.strictEqual(run({ host: '192.168.1.5:7777' }, lan).status, 401);
  const first = run({ host: '192.168.1.5:7777' }, { ...lan, path: `/phone?key=${cfg.lanKey}` });
  assert.ok(first.ok && /sof_key=/.test(first.setCookie) && /HttpOnly/.test(first.setCookie));
  assert.ok(run({ host: '192.168.1.5:7777', cookie: `a=1; sof_key=${cfg.lanKey}` }, lan).ok);
  assert.strictEqual(run({ host: '192.168.1.5:7777', cookie: 'sof_key=wrong' }, lan).status, 401);
  assert.ok(run({ host: 'gamepc.local:7777', cookie: `sof_key=${cfg.lanKey}` }, lan).ok);
  assert.strictEqual(run({ host: 'evil.example:7777', cookie: `sof_key=${cfg.lanKey}` }, lan).status, 403);
});
