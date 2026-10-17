// Screen reader: runs screenreader.ps1 next to the game, which looks at the game window (a screenshot, never the
// game's memory) and reads HP, MP and EXP from the HUD and loot announcements from the chat box with Windows' own
// text recognition. This module starts / stops it, makes sense of what it read, and keeps EXP per hour.
'use strict';

const { spawn } = require('child_process');
const path = require('path');

// "2366 / 2366" (OCR sometimes reads the slash as l, I, 1 or drops it)
function parsePair(s) {
  s = String(s || '').trim();
  // the separator: "/", or a slash read as l, I, | or \ between spaces
  let parts = s.split('/');
  if (parts.length !== 2) parts = s.split(/\s+[lI|\\]\s+/);
  if (parts.length !== 2) parts = s.split(/\s+/).filter(Boolean);
  if (parts.length !== 2) return null;
  // inside a number: O → 0, l / I → 1, S → 5, B → 8; dashes, dots and stray marks dropped; any other letter = unreadable
  const num = (p) => { const c = p.replace(/[Oo]/g, '0').replace(/[lI]/g, '1').replace(/S/g, '5').replace(/B/g, '8').replace(/[\s,.\-•·'`"]/g, ''); return /^\d{1,7}$/.test(c) ? +c : null; };
  const a = num(parts[0]), b = num(parts[1]);
  return a != null && b > 0 && a <= b ? [a, b] : null;
}

// letters and digits only, for comparing OCR text with names
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 6) return 99;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
// the best match for an OCR'd name in a list of { id, name }; null when nothing is close enough
function bestMatch(text, list) {
  const t = norm(text); if (t.length < 3) return null;
  let best = null, bestD = Infinity;
  for (const x of list) { const n = x._n || (x._n = norm(x.name)); const d = n === t ? 0 : editDistance(t, n); if (d < bestD) { bestD = d; best = x; } }
  return best && bestD <= Math.max(1, Math.floor(t.length * 0.2)) ? best : null;
}

// "Announcements: Ali's party member has gotten [Spear of the Cruel Sky(8th)] from Hooligan Dof" — wrapped over lines
function parseDrops(lines) {
  // lines kept apart: the item name may wrap onto the next line, the monster name ends its line
  const text = (lines || []).map((l) => String(l).replace(/[ \t]+/g, ' ').replace(/[•’`´]/g, "'")).join('\n');
  const out = [];
  // "<who>'s party member has gotten [<item>] from <monster>": the words in between are often misread
  // ("g%ttën"), so only "party m…mber", the brackets and "from" are relied on
  const re = /(?:Announcements\s*[:;]\s*)?([^\s:;]+?)\s*'\s*s\s*\S?\s*party\s+m\S*mber[^[\n]{0,24}\n?[^[\n]{0,12}\[([^\]\n]{2,60}(?:\n[^\]\n]{1,30})?)[\]I|l1]\s*f\s*r\s*[oa]\s*m\s+([^\n]+)/gi;
  let m;
  while ((m = re.exec(text))) {
    const item = m[2].replace(/\n/g, '').replace(/\s+(?=[a-z)\]])/g, (s, i, all) => (/\(\w*$/.test(all.slice(0, i)) ? '' : s)).trim();
    // a monster name that wraps mid-word goes on in a next line starting with a lower-case letter ("Leo" + "pard Hunter")
    let from = m[3].trim();
    const next = /^\n([a-z][^\n]{0,40})/.exec(text.slice(re.lastIndex));
    if (next) { from += next[1].trim(); re.lastIndex += next[0].length; }
    out.push({ who: m[1].trim(), item, from: from.replace(/[^\w\s'()-]+.*$/, '').trim() });
  }
  return out;
}

class ScreenReader {
  constructor({ script, onFrame, onState }) {
    this.script = script; this.onFrame = onFrame; this.onState = onState || (() => {});
    this.proc = null; this.pid = null; this.buf = ''; this.status = 'off'; this.error = null;
  }
  start(gamePid, interval = 3, extra = []) {
    if (this.proc && this.pid === gamePid) return;
    this.stop();
    this.pid = gamePid; this.status = 'starting'; this.error = null;
    this.proc = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', this.script, '-GamePid', String(gamePid), '-Interval', String(interval), ...extra], { windowsHide: true });
    this.proc.stdout.on('data', (c) => {
      this.buf += c;
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1);
        if (!line.startsWith('{')) continue;
        let f; try { f = JSON.parse(line); } catch { continue; }
        if (f.error) { this.status = 'error'; this.error = f.error; }
        else if (f.state) this.status = f.state; // hidden (minimised) / covered (no picture, not in front) / closed
        else { this.status = 'reading'; this.error = null; this.onFrame(f); }
        this.onState(this.status);
      }
    });
    this.proc.stderr.on('data', (c) => { this.error = String(c).trim().split('\n')[0]; });
    this.proc.on('exit', () => { if (this.proc) { this.proc = null; this.status = this.status === 'closed' ? 'off' : 'stopped'; } });
  }
  stop() {
    if (this.proc) { const p = this.proc; this.proc = null; try { p.kill(); } catch { /* gone */ } }
    this.pid = null; this.status = 'off';
  }
}

// EXP per hour from the EXP bar: samples of { t, exp (0-100), level }; a level-up adds 100 %
function expRate(samples, windowMs = 20 * 60000) {
  const now = samples.length ? samples[samples.length - 1].t : 0;
  const s = samples.filter((x) => now - x.t <= windowMs);
  if (s.length < 2 || now - s[0].t < 3 * 60000) return null;
  let gained = 0;
  for (let i = 1; i < s.length; i++) {
    const d = s[i].exp - s[i - 1].exp;
    if (d < -50) gained += 100 + d; // levelled up: the bar started again
    else if (d > 0) gained += d;
  }
  const hours = (now - s[0].t) / 3600000;
  const perHour = gained / hours;
  const last = s[s.length - 1].exp;
  return { perHour, toNextMs: perHour > 0.01 ? ((100 - last) / perHour) * 3600000 : null, since: s[0].t };
}

module.exports = { ScreenReader, parsePair, parseDrops, bestMatch, expRate, SCRIPT: path.join(__dirname, '..', 'screenreader.ps1') };
