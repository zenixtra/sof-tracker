// Packs the tracker program files (never the data folder) into app.zip for the installer.
// usage: node installer/pack.js <out.zip>
'use strict';
const fs = require('fs');
const path = require('path');
const { zip } = require('../lib/zip');

const root = path.join(__dirname, '..');
// release.config.json carries the update address and public key (never the private key)
const FILES = ['server.js', 'package.json', 'release.config.json', 'LICENSE', 'PRIVACY.md', 'tray.ps1', 'tray.vbs', 'overlay.ps1', 'overlay.bat', 'start.bat', 'start-phone.bat', 'screenreader.ps1'];
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'release.config.json'), 'utf8'));
if (!cfg.manifestUrl || !cfg.publicKeys?.length) console.log('  ! release.config.json has no update key: this setup never checks for updates (a development build)');
const DIRS = ['lib', 'public'];

const files = [];
// (a private key must never get in: refuse to pack if one turns up among the files)
const add = (rel, from = rel) => {
  if (/PRIVATE KEY/.test(fs.readFileSync(path.join(root, from), 'latin1'))) throw new Error(`${rel} contains a private key: not packing it`);
  const full = path.join(root, from);
  files.push({ name: rel.replace(/\\/g, '/'), data: fs.readFileSync(full), mtime: fs.statSync(full).mtime });
};
for (const f of FILES) add(f);
for (const d of DIRS) {
  (function walk(dir) {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) walk(rel); else add(rel);
    }
  })(d);
}
add('uninstall.ps1', path.join('installer', 'uninstall.ps1'));
fs.writeFileSync(process.argv[2], zip(files));
console.log(`packed ${files.length} files`);
