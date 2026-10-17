#!/usr/bin/env node
// SoF Tracker release tool. Run from the project folder: node scripts/release.js <command> [options]
//
//   setup  --repo OWNER/REPO       once: makes your signing key (outside the project) and fills in release.config.json
//   build                          tests, builds dist\SoF-Tracker-Setup-<version>.exe, prints its SHA-256 and size
//   publish [--minimum X.Y.Z] [--mandatory] [--notes "…" | --notes-file FILE] [--instructions "…"]
//                                  after you uploaded the setup to the GitHub release: checks the upload, then writes
//                                  the signed updates\update.json (commit and push it to make the release live)
//   revoke  --version X.Y.Z --reason "…" [--replacement X.Y.Z]   withdraw a broken release
//   set     [--minimum X.Y.Z] [--grace HOURS] [--message "…"]     change the rules without a new release
//   verify                         reads the live update file like a tracker does and checks the newest download
//   status                         what updates\channel.json says now
//
// Files: updates\channel.json = what you publish (readable, edited by this tool); updates\update.json = the same,
// signed (what trackers read). The private key lives in %USERPROFILE%\.sof-tracker-release\ and never in the project.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const version = require('../lib/version');
const manifest = require('../lib/manifest');
const { Updater, hashFile } = require('../lib/updater');

const ROOT = path.join(__dirname, '..');
const CONFIG = path.join(ROOT, 'release.config.json');
const CHANNEL = path.join(ROOT, 'updates', 'channel.json');
const SIGNED = path.join(ROOT, 'updates', 'update.json');
const KEY_DIR = process.env.SOF_RELEASE_KEY_DIR || path.join(os.homedir(), '.sof-tracker-release');
const PRIVATE = path.join(KEY_DIR, 'update-signing-key.pem');
const pkgVersion = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, `${JSON.stringify(v, null, 2)}\n`); };
// (a thrown error, not process.exit: exiting with a download still open crashes Node on Windows)
class Stop extends Error {}
const die = (m) => { throw new Stop(m); };
const ok = (m) => console.log(`  ✔ ${m}`);

// --name value / --flag
function args(list) {
  const o = { _: [] };
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.startsWith('--')) { const k = a.slice(2); const v = list[i + 1] && !list[i + 1].startsWith('--') ? list[++i] : true; o[k] = v; } else o._.push(a);
  }
  return o;
}
function loadConfig(need = true) {
  const c = readJson(CONFIG, null);
  if (!c) die('release.config.json is missing.');
  if (need && (!c.repo || !c.manifestUrl || !c.publicKeys?.length)) die('Not set up yet: run  node scripts/release.js setup --repo YOUR-GITHUB-NAME/sof-tracker');
  return c;
}
function privateKey(cfg) {
  if (!fs.existsSync(PRIVATE)) die(`The signing key is not on this PC (${PRIVATE}). Restore it from your backup; without it no update can be published.`);
  const pem = fs.readFileSync(PRIVATE, 'utf8');
  const pub = crypto.createPublicKey(pem).export({ type: 'spki', format: 'pem' });
  const id = manifest.keyIdOf(pub);
  if (!cfg.publicKeys.some((k) => k.id === id)) die('The signing key on this PC does not match any public key in release.config.json.');
  return { pem, id };
}
const setupName = (v) => `SoF-Tracker-Setup-${v}.exe`;
const assetUrl = (cfg, v) => `https://github.com/${cfg.repo}/releases/download/v${v}/${setupName(v)}`;

// ---- setup: key + config
function cmdSetup(o) {
  if (typeof o.repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(o.repo)) die('Give your repository: --repo YOUR-GITHUB-NAME/sof-tracker');
  const cfg = loadConfig(false);
  if (!fs.existsSync(PRIVATE)) {
    fs.mkdirSync(KEY_DIR, { recursive: true });
    const { privateKey: k } = crypto.generateKeyPairSync('ed25519');
    fs.writeFileSync(PRIVATE, k.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600, flag: 'wx' });
    ok(`Signing key made: ${PRIVATE}`);
    console.log('    BACK IT UP NOW (USB stick, password manager). If it is lost, trackers can never be updated again;');
    console.log('    if someone else gets it, they can push updates to every user. Never put it in the project or on GitHub.');
  } else ok(`Using the signing key already in ${PRIVATE}`);
  const pub = crypto.createPublicKey(fs.readFileSync(PRIVATE, 'utf8')).export({ type: 'spki', format: 'pem' });
  const id = manifest.keyIdOf(pub);
  cfg.repo = o.repo;
  cfg.manifestUrl = `https://raw.githubusercontent.com/${o.repo}/main/updates/update.json`;
  cfg.releasesPage = `https://github.com/${o.repo}/releases`;
  cfg.publicKeys = [...(cfg.publicKeys || []).filter((k) => k.id !== id), { id, pem: pub }];
  writeJson(CONFIG, cfg);
  ok(`release.config.json: ${cfg.manifestUrl} (key ${id})`);
}

// ---- build
async function cmdBuild(o) {
  const cfg = loadConfig();
  const v = pkgVersion();
  if (!version.valid(v)) die(`package.json version "${v}" is not like 1.2.3`);
  const ch = readJson(CHANNEL, null);
  if (ch?.releases?.some((r) => r.version === v)) die(`${v} is already published. Raise the version first:  npm version patch --no-git-tag-version`);
  if (ch?.latest && !version.lt(ch.latest, v)) die(`${v} is not newer than the published ${ch.latest}.`);
  if (!o['skip-tests']) { console.log('  … running the tests'); execFileSync(process.execPath, ['--test', 'test/*.test.js'], { cwd: ROOT, stdio: 'inherit' }); ok('tests passed'); }
  console.log('  … building the setup');
  execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'installer', 'build.ps1')], { cwd: ROOT, stdio: 'inherit' });
  const file = path.join(ROOT, 'dist', setupName(v));
  const sha256 = await hashFile(file), size = fs.statSync(file).size;
  writeJson(path.join(ROOT, 'dist', `release-${v}.json`), { version: v, file: setupName(v), sha256, size, url: assetUrl(cfg, v), builtAt: new Date().toISOString() });
  ok(`${setupName(v)}  ${size} bytes  SHA-256 ${sha256}`);
  console.log(`\n  Next: create the GitHub release "v${v}" and upload dist\\${setupName(v)} to it`);
  console.log(`        (https://github.com/${cfg.repo}/releases/new, tag v${v}), then:  node scripts/release.js publish\n`);
}

// download the setup from GitHub the way trackers will, and compare it with what was built
async function checkDownload(cfg, r) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sof-release-'));
  const u = new Updater({ current: '0.0.0', dir, config: { manifestUrl: 'x', publicKeys: [{ id: 'x', pem: '' }], downloadHosts: cfg.downloadHosts }, read: () => null, save: () => {} });
  u.payload = { releases: [r], latest: r.version, minimum: r.version, revoked: [] };
  u.status = () => ({ target: r });
  try { await u.fetchInstaller(); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function signAndWrite(cfg, ch) {
  const key = privateKey(cfg);
  ch.sequence = (ch.sequence || 0) + 1;
  ch.issuedAt = new Date().toISOString();
  const payload = { product: manifest.PRODUCT, sequence: ch.sequence, issuedAt: ch.issuedAt, latest: ch.latest, minimum: ch.minimum, offlineGraceHours: ch.offlineGraceHours ?? 168,
    message: ch.message || '', releases: ch.releases, revoked: ch.revoked || [] };
  const text = manifest.sign(payload, key.pem, key.id);
  manifest.verify(text, cfg.publicKeys); // the file trackers will read must check out
  writeJson(CHANNEL, ch);
  fs.writeFileSync(SIGNED, text);
  ok(`updates\\update.json signed (number ${ch.sequence}): latest ${ch.latest}, minimum ${ch.minimum}${ch.revoked?.length ? `, withdrawn ${ch.revoked.map((r) => r.version).join(', ')}` : ''}`);
  console.log('\n  Nothing changes for users until you commit and push the updates folder:');
  console.log(`    git add updates && git commit -m "Release channel: ${ch.latest}" && git push\n`);
}

// ---- publish the built version
async function cmdPublish(o) {
  const cfg = loadConfig();
  const v = typeof o.version === 'string' ? o.version : pkgVersion();
  const info = readJson(path.join(ROOT, 'dist', `release-${v}.json`), null);
  if (!info) die(`No build of ${v} on this PC: run  node scripts/release.js build  first.`);
  const ch = readJson(CHANNEL, { sequence: 0, latest: null, minimum: null, offlineGraceHours: 168, message: '', releases: [], revoked: [] });
  const first = !ch.latest;
  if (ch.latest && !version.lt(ch.latest, v)) die(`${v} is not newer than the published ${ch.latest}.`);
  const minimum = typeof o.minimum === 'string' ? o.minimum : ch.minimum || v;
  if (!version.valid(minimum) || version.compare(minimum, v) > 0) die(`--minimum ${minimum} must be a version no newer than ${v}`);
  const notes = typeof o['notes-file'] === 'string' ? fs.readFileSync(o['notes-file'], 'utf8').trim() : typeof o.notes === 'string' ? o.notes : '';
  const r = { version: v, url: info.url, sha256: info.sha256, size: info.size, mandatory: !!o.mandatory, date: new Date().toISOString().slice(0, 10), notes, instructions: typeof o.instructions === 'string' ? o.instructions : '' };
  // the setup must be downloadable before anyone is told about it (otherwise required updates lock users out)
  if (!o['skip-download-check']) {
    console.log(`  … downloading ${info.url} to check it`);
    try { await checkDownload(cfg, r); } catch (e) { die(`The uploaded setup is not right yet: ${e.message}\n    Upload dist\\${info.file} to the GitHub release v${v} (not a zip, the .exe itself) and try again.`); }
    ok('the uploaded setup matches the build');
  }
  ch.releases = [r, ...ch.releases.filter((x) => x.version !== v)].slice(0, 10);
  ch.latest = v; ch.minimum = minimum;
  signAndWrite(cfg, ch);
  if (!first && (minimum === v || r.mandatory)) console.log(`  ⚠ This is a REQUIRED update: everyone below ${minimum} is blocked once you push.\n`);
}

function cmdRevoke(o) {
  const cfg = loadConfig();
  const ch = readJson(CHANNEL, null) || die('Nothing published yet.');
  if (!version.valid(o.version)) die('--version X.Y.Z');
  if (o.version === ch.latest) die(`${o.version} is the newest release: publish a fixed version first (it becomes latest), then withdraw this one.`);
  if (o.replacement && !ch.releases.some((r) => r.version === o.replacement)) die(`--replacement ${o.replacement} is not a published release.`);
  ch.revoked = [{ version: o.version, reason: typeof o.reason === 'string' ? o.reason : 'This version has a serious problem.', replacement: o.replacement || ch.latest }, ...(ch.revoked || []).filter((r) => r.version !== o.version)];
  signAndWrite(cfg, ch);
}

function cmdSet(o) {
  const cfg = loadConfig();
  const ch = readJson(CHANNEL, null) || die('Nothing published yet.');
  if (typeof o.minimum === 'string') { if (!version.valid(o.minimum) || version.compare(o.minimum, ch.latest) > 0) die(`--minimum must be a version no newer than ${ch.latest}`); ch.minimum = o.minimum; }
  if (o.grace !== undefined) { const h = Number(o.grace); if (!Number.isFinite(h) || h < 0 || h > 8760) die('--grace HOURS (0 to 8760)'); ch.offlineGraceHours = h; }
  if (typeof o.message === 'string') ch.message = o.message;
  if (o.unrevoke) ch.revoked = (ch.revoked || []).filter((r) => r.version !== o.unrevoke);
  signAndWrite(cfg, ch);
}

async function cmdVerify() {
  const cfg = loadConfig();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sof-verify-'));
  let saved = null;
  const u = new Updater({ current: '0.0.1', dir, config: { manifestUrl: cfg.manifestUrl, publicKeys: cfg.publicKeys, downloadHosts: cfg.downloadHosts }, read: () => saved, save: (s) => { saved = s; } });
  const st = await u.check();
  if (st.lastError) die(`The live update file does not check out: ${st.lastError}\n    (${cfg.manifestUrl})`);
  ok(`live update file: signed correctly, number ${u.payload.sequence}, latest ${u.payload.latest}, minimum ${u.payload.minimum}, offline grace ${u.payload.offlineGraceHours} h`);
  const local = readJson(CHANNEL, null);
  if (local && local.sequence !== u.payload.sequence) console.log(`  ⚠ GitHub still serves number ${u.payload.sequence}; this PC has ${local.sequence}. Pushed? GitHub can take up to 5 minutes.`);
  const r = u.payload.releases.find((x) => x.version === u.payload.latest);
  try { await checkDownload(cfg, r); ok(`download of ${r.version} matches its fingerprint`); } catch (e) { die(`The download of ${r.version} fails: ${e.message}`); }
  fs.rmSync(dir, { recursive: true, force: true });
}

function cmdStatus() {
  const ch = readJson(CHANNEL, null);
  if (!ch) return console.log('  Nothing published yet.');
  console.log(`  number ${ch.sequence} · latest ${ch.latest} · minimum ${ch.minimum} · offline grace ${ch.offlineGraceHours ?? 168} h`);
  for (const r of ch.releases) console.log(`   ${r.version}${r.mandatory ? ' (required)' : ''}  ${r.date}  ${r.url}`);
  for (const r of ch.revoked || []) console.log(`   withdrawn ${r.version} → ${r.replacement}: ${r.reason}`);
}

(async () => {
  const o = args(process.argv.slice(2));
  const cmd = o._[0];
  const map = { setup: cmdSetup, build: cmdBuild, publish: cmdPublish, revoke: cmdRevoke, set: cmdSet, verify: cmdVerify, status: cmdStatus };
  if (!map[cmd]) { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 17).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(cmd ? 1 : 0); }
  try { await map[cmd](o); } catch (e) { console.error(`\n  ✖ ${e.message}\n`); process.exitCode = 1; }
})();
