// Tiny JSON persistence for the tracker. Everything lives in ./data next to server.js.
'use strict';

const fs = require('fs');
const path = require('path');

const DIR = process.env.SOF_DATA_DIR || path.join(__dirname, '..', 'data'); // SOF_DATA_DIR: separate data folder (tests)
fs.mkdirSync(DIR, { recursive: true });

const file = (name) => path.join(DIR, name);

function readJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch { return fallback; }
}

// write-then-rename so a crash mid-write never leaves a half-written file
function writeJson(name, data) {
  const f = file(name);
  fs.writeFileSync(f + '.tmp', JSON.stringify(data));
  fs.renameSync(f + '.tmp', f);
}

function appendLine(name, obj) {
  fs.appendFileSync(file(name), JSON.stringify(obj) + '\n');
}

function readLines(name) {
  let text;
  try { text = fs.readFileSync(file(name), 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip a torn last line */ }
  }
  return out;
}

// Move a file from the project root into data/ (labels.json / players.json used to live there).
function migrate(name) {
  const old = path.join(__dirname, '..', name);
  if (fs.existsSync(old) && !fs.existsSync(file(name))) fs.renameSync(old, file(name));
}

module.exports = { DIR, readJson, writeJson, appendLine, readLines, migrate };
