// Mandatory updates. The tracker fetches the signed update file (lib/manifest.js) at start and every few hours, and
// decides whether this version may still be used:
//   current  : the newest version (or newer)                         → normal use
//   optional : a newer version exists, not required                   → a banner, "Later" allowed
//   required : older than `minimum`, the newest release is mandatory, → blocked until updated
//   revoked  : this version was withdrawn                             → blocked until updated
//   offline  : no verified update file for longer than the offline grace (default 7 days) → blocked until a check works
//   dev      : no update key configured (a development copy)          → never blocked
// The last verified file is kept in data\update-state.json, so restarting the tracker without internet does not
// lift a block. Installers are downloaded over https from the allowed hosts only, checked against the SHA-256 and
// size in the signed file (again right before they run), and the new version is confirmed after the restart.
//
// Limits (also in SECURITY.md): everything runs on the user's own PC. A user who edits the tracker's own files can
// remove this check; the signature only guarantees that updates come from you and are not tampered with.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const version = require('./version');
const manifest = require('./manifest');

const H = 3600000;
const DEFAULT_GRACE_H = 168;
const DEFAULT_HOSTS = ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com', 'github-releases.githubusercontent.com'];

// the decision for one version against a verified update file (pure: tested in test/updater.test.js)
function decide(current, m, { verifiedAt = null, firstRunAt, now, configured = true }) {
  if (!configured) return { state: 'dev', blocked: false };
  const graceMs = (m?.offlineGraceHours ?? DEFAULT_GRACE_H) * H;
  const since = verifiedAt || firstRunAt || now;
  const deadline = since + graceMs;
  const find = (v) => m?.releases.find((r) => r.version === v) || null;
  if (m) {
    const rev = m.revoked.find((r) => r.version === current);
    if (rev) {
      const target = (rev.replacement && find(rev.replacement)) || find(m.latest);
      return { state: 'revoked', blocked: true, reason: rev.reason || 'This version was withdrawn.', target, deadline };
    }
    const latest = find(m.latest);
    if (version.lt(current, m.minimum)) return { state: 'required', blocked: true, reason: `Version ${m.minimum} or newer is required.`, target: latest, deadline };
    if (version.lt(current, m.latest) && latest?.mandatory) return { state: 'required', blocked: true, reason: `Version ${m.latest} is a required update.`, target: latest, deadline };
    if (now > deadline) return { state: 'offline', blocked: true, reason: 'The tracker could not check for updates for too long.', target: null, deadline };
    if (version.lt(current, m.latest)) return { state: 'optional', blocked: false, target: latest, deadline };
    return { state: 'current', blocked: false, target: null, deadline };
  }
  if (now > deadline) return { state: 'offline', blocked: true, reason: 'The tracker could not check for updates for too long.', target: null, deadline };
  return { state: 'unknown', blocked: false, target: null, deadline };
}

class Updater {
  // config: { manifestUrl, publicKeys: [{ id, pem }], downloadHosts, allowInsecureLocal }
  constructor({ current, config, dir, read, save, fetchImpl = globalThis.fetch, now = () => Date.now(), spawn = null, log = () => {} }) {
    this.current = current;
    this.config = { downloadHosts: DEFAULT_HOSTS, ...config };
    this.dir = dir;
    this.read = read; this.saveFn = save;
    this.fetch = fetchImpl; this.now = now; this.spawn = spawn; this.log = log;
    this.configured = !!(this.config.manifestUrl && this.config.publicKeys?.length);
    this.s = { envelope: null, sequence: 0, verifiedAt: null, lastAttemptAt: null, lastError: null, firstRunAt: null, maxSeenAt: 0, pending: null, failed: null, ...(read() || {}) };
    this.payload = null;
    if (this.s.envelope) try { this.payload = manifest.verify(this.s.envelope, this.config.publicKeys || []); } catch (e) { this.log(`stored update file rejected: ${e.message}`); this.s.envelope = null; this.s.sequence = 0; }
    if (!this.s.firstRunAt) this.s.firstRunAt = this.clock();
    this.download = { phase: 'idle', bytes: 0, total: 0, error: null, file: null };
    this.checking = null;
    this.save();
  }
  save() { this.saveFn(this.s); }
  // the clock, never earlier than what was already seen (moving the PC clock back does not stretch the offline grace)
  clock() { const t = this.now(); if (t > this.s.maxSeenAt) this.s.maxSeenAt = t; return Math.max(t, this.s.maxSeenAt - 6 * H); }

  async fetchText(url, maxBytes) {
    const res = await this.get(url, { hosts: null });
    const len = +res.headers.get('content-length') || 0;
    if (len > maxBytes) throw new Error('response too large');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > maxBytes) throw new Error('response too large');
    return buf.toString('utf8');
  }
  // GET over https, redirects followed by hand so each hop is checked (hosts: allowed host names, or null for any)
  async get(url, { hosts, timeoutMs = 20000 }) {
    let u = new URL(url);
    for (let hop = 0; hop < 5; hop++) {
      const local = this.config.allowInsecureLocal && u.protocol === 'http:' && /^(127\.0\.0\.1|localhost)$/.test(u.hostname);
      if (u.protocol !== 'https:' && !local) throw new Error(`refused a non-https address (${u.protocol}//${u.host})`);
      if (hosts && !local && !hosts.includes(u.hostname)) throw new Error(`refused a download from ${u.hostname}`);
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeoutMs);
      let res;
      try { res = await this.fetch(u.href, { redirect: 'manual', signal: ctl.signal, headers: { 'User-Agent': `sof-tracker/${this.current}`, Accept: '*/*' } }); }
      catch (e) { throw new Error(e.name === 'AbortError' ? 'timed out' : `no connection (${e.cause?.code || e.message})`); }
      finally { clearTimeout(timer); }
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { u = new URL(res.headers.get('location'), u); continue; }
      if (!res.ok) throw new Error(`the server answered ${res.status}`);
      return res;
    }
    throw new Error('too many redirects');
  }

  // fetch and verify the update file; a failure keeps the last good one
  check() {
    if (!this.configured) return Promise.resolve(this.status());
    if (this.checking) return this.checking;
    this.checking = (async () => {
      this.s.lastAttemptAt = this.clock();
      try {
        const text = await this.fetchText(this.config.manifestUrl, manifest.MAX_BYTES);
        const p = manifest.verify(text, this.config.publicKeys);
        if (p.sequence < this.s.sequence) throw new Error(`the server sent an older update file (number ${p.sequence}, this PC has ${this.s.sequence})`);
        this.payload = p; this.s.envelope = text; this.s.sequence = p.sequence;
        this.s.verifiedAt = this.clock(); this.s.lastError = null;
      } catch (e) {
        this.s.lastError = e.message;
        this.log(`update check failed: ${e.message}`);
      } finally { this.save(); this.checking = null; }
      return this.status();
    })();
    return this.checking;
  }

  status() {
    const now = this.clock();
    const d = decide(this.current, this.payload, { verifiedAt: this.s.verifiedAt, firstRunAt: this.s.firstRunAt, now, configured: this.configured });
    const t = d.target;
    return {
      ...d, current: this.current, latest: this.payload?.latest || null, minimum: this.payload?.minimum || null, message: this.payload?.message || '',
      target: t ? { version: t.version, notes: t.notes, instructions: t.instructions, url: t.url, size: t.size, date: t.date, mandatory: t.mandatory } : null,
      verifiedAt: this.s.verifiedAt, lastAttemptAt: this.s.lastAttemptAt, lastError: this.s.lastError, checking: !!this.checking,
      download: { ...this.download }, pending: this.s.pending, failed: this.s.failed, offlineGraceHours: this.payload?.offlineGraceHours ?? DEFAULT_GRACE_H,
    };
  }

  // download the target installer and check it against the signed file
  async fetchInstaller() {
    const st = this.status(), r = st.target && this.payload.releases.find((x) => x.version === st.target.version);
    if (!r) throw new Error('No update to download');
    if (this.download.phase === 'downloading') throw new Error('Already downloading');
    const name = `SoF-Tracker-Setup-${r.version}.exe`, file = path.join(this.dir, name), part = `${file}.part`;
    this.download = { phase: 'downloading', bytes: 0, total: r.size, error: null, file: null, version: r.version };
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      if (fs.existsSync(file) && (await hashFile(file)) === r.sha256) { this.download = { ...this.download, phase: 'ready', bytes: r.size, file }; return file; }
      const res = await this.get(r.url, { hosts: this.config.downloadHosts, timeoutMs: 120000 });
      const hash = crypto.createHash('sha256'), out = fs.openSync(part, 'w');
      try {
        for await (const chunk of res.body) {
          this.download.bytes += chunk.length;
          if (this.download.bytes > r.size) throw new Error(`the download is bigger than the ${r.size} bytes the update file names`);
          hash.update(chunk); fs.writeSync(out, chunk);
        }
      } finally { fs.closeSync(out); }
      if (this.download.bytes !== r.size) throw new Error(`the download stopped early (${this.download.bytes} of ${r.size} bytes)`);
      const got = hash.digest('hex');
      if (got !== r.sha256) throw new Error('the download does not match the signed fingerprint (SHA-256): it was not installed');
      fs.renameSync(part, file);
      for (const f of fs.readdirSync(this.dir)) if (f !== name && /^SoF-Tracker-Setup-.*\.exe(\.part)?$/.test(f)) try { fs.unlinkSync(path.join(this.dir, f)); } catch { /* in use */ }
      this.download = { ...this.download, phase: 'ready', file };
      return file;
    } catch (e) {
      try { fs.unlinkSync(part); } catch { /* nothing written */ }
      this.download = { ...this.download, phase: 'failed', error: e.message };
      throw e;
    }
  }

  // run the verified installer (checked once more right before), remembering what should be installed afterwards
  async install() {
    const st = this.status(), r = st.target && this.payload.releases.find((x) => x.version === st.target.version);
    if (!r) throw new Error('No update to install');
    const file = this.download.phase === 'ready' && this.download.version === r.version ? this.download.file : await this.fetchInstaller();
    if ((await hashFile(file)) !== r.sha256) { this.download = { ...this.download, phase: 'failed', error: 'the installer changed after it was downloaded' }; throw new Error(this.download.error); }
    this.s.pending = { version: r.version, from: this.current, startedAt: this.clock(), file };
    this.s.failed = null; this.save();
    if (!this.spawn) throw new Error('installing is not available here');
    this.spawn(file, ['-Update']);
    this.download = { ...this.download, phase: 'installing' };
    return { started: r.version };
  }

  // after a restart: did the update land? → { updated: { from, to } } or { failed }
  confirmInstall() {
    const p = this.s.pending;
    if (!p) return {};
    if (version.gte(this.current, p.version)) {
      this.s.pending = null; this.s.failed = null; this.save();
      try { fs.unlinkSync(p.file); } catch { /* already gone */ }
      return { updated: { from: p.from, to: this.current } };
    }
    if (this.clock() - p.startedAt > 5 * 60000) {
      this.s.failed = { version: p.version, at: this.clock(), reason: `Setup ran, but version ${this.current} is still installed.` };
      this.s.pending = null; this.save();
      return { failed: this.s.failed };
    }
    return {};
  }
}

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

module.exports = { Updater, decide, hashFile, DEFAULT_HOSTS, DEFAULT_GRACE_H };
