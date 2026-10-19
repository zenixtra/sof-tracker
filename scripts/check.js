#!/usr/bin/env node
// Pre-release checks (npm run check): every script parses, no secrets or personal files are about to be shipped or
// committed, the version is valid, and the tests pass.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const version = require('../lib/version');

const ROOT = path.join(__dirname, '..');
const SKIP = new Set(['data', 'dist', 'backups', 'node_modules', '.git', 'build', '.gradle', 'samples']); // (build, .gradle: Android build output)
const files = (function walk(d) { return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (SKIP.has(e.name) ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)])); })(ROOT);
const rel = (f) => path.relative(ROOT, f);
let problems = 0;
const bad = (m) => { problems++; console.log(`  ✖ ${m}`); };
const good = (m) => console.log(`  ✔ ${m}`);

// 1. JavaScript parses
const js = files.filter((f) => /\.js$/.test(f));
for (const f of js) try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) { bad(`${rel(f)} does not parse: ${String(e.stderr).split('\n').slice(0, 3).join(' ')}`); }
good(`${js.length} scripts parse`);

// 2. nothing secret in the files that go into the repository or the setup
const SECRET = [/-----BEGIN (?:ENCRYPTED )?PRIVATE KEY-----/, /\bghp_[A-Za-z0-9]{30,}/, /\bgithub_pat_[A-Za-z0-9_]{30,}/, /discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]{20,}/, /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/, /\b[MN][A-Za-z\d]{23}\.[\w-]{6}\.[\w-]{27,}\b/];
for (const f of files.filter((x) => !/\.(png|jpg|ico|bin|exe)$/i.test(x) && !rel(x).startsWith('test'))) {
  const t = fs.readFileSync(f, 'utf8');
  for (const re of SECRET) if (re.test(t)) bad(`${rel(f)} looks like it contains a secret (${re.source.slice(0, 30)}…)`);
}
for (const f of files) if (/\.(pem|pfx|p12|key)$/i.test(f) || path.basename(f) === '.env') bad(`${rel(f)} must not be in the project folder (keep it outside, or in .gitignore)`);
good('no keys, tokens or webhooks in the project files');

// 3. version and release settings
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
if (!version.valid(pkg.version)) bad(`package.json version "${pkg.version}" is not like 1.2.3`); else good(`version ${pkg.version}`);
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'release.config.json'), 'utf8'));
if (!cfg.manifestUrl || !cfg.publicKeys?.length) console.log('  ! release.config.json has no update key yet: builds are development builds (node scripts/release.js setup)');
else if (!/^https:\/\//.test(cfg.manifestUrl)) bad('release.config.json manifestUrl must be https');
else good(`updates from ${cfg.manifestUrl}`);
const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
for (const p of ['/data/', '/dist/', '/backups/', '.env', '*.pem']) if (!gi.includes(p)) bad(`.gitignore does not exclude ${p}`);

// 4. tests
if (!process.argv.includes('--no-tests')) {
  try { execFileSync(process.execPath, ['--test', 'test/*.test.js'], { cwd: ROOT, stdio: 'pipe' }); good('tests pass'); } catch (e) { bad(`tests fail:\n${String(e.stdout).split('\n').filter((l) => /✖|not ok|Error/.test(l)).slice(0, 15).join('\n')}`); }
}
console.log(problems ? `\n  ${problems} problem(s): fix them before releasing.\n` : '\n  All checks passed.\n');
process.exit(problems ? 1 : 0);
