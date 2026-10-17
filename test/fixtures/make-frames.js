// Rebuilds frames.json: real screen-reader output for a few of the game's own screenshots (needs the game folder).
// usage: node test/fixtures/make-frames.js
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const DIR = 'C:/NetGame/ScionsOfFate/datas/capture/';
const t0 = Date.now() - 600000;
const frames = ['YBcapture00055.jpg', 'YBcapture00057.jpg', 'YBcapture00022.jpg', 'YBcapture00030.jpg'].map((f, i) => {
  const out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '..', '..', 'screenreader.ps1'), '-Image', DIR + f], { encoding: 'utf8', windowsHide: true });
  return { ...JSON.parse(out.trim().split('\n').pop()), t: t0 + i * 30000, src: f };
});
fs.writeFileSync(path.join(__dirname, 'frames.json'), JSON.stringify(frames, null, 1));
console.log(frames.map((f) => `${f.src}: target "${f.target}", ${f.chat.length} chat lines`).join('\n'));
