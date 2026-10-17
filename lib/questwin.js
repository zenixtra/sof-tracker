// The quest window (Ctrl+Q, "Quest in progress"): its lines "[100]JungMu House Army Vice Presi…" (cut off, misread
// a little) matched to the game's quests, and quests that drop off the list counted as done.
'use strict';

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
// letter pairs in common: how alike two strings are (0 … 1)
function dice(a, b) {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const pairs = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const p = s.slice(i, i + 2); m.set(p, (m.get(p) || 0) + 1); } return m; };
  const A = pairs(a), B = pairs(b); let n = 0;
  for (const [p, c] of A) n += Math.min(c, B.get(p) || 0);
  return (2 * n) / (a.length - 1 + b.length - 1);
}
// "[45] Jade Tower bandits Key Point" → { level: 45, name }; a misread level ("[O]", "[m]") is left out
function parseLine(line) {
  const s = String(line || '').replace(/^\W*\w{0,3}\W*(?=\[)/, '').trim();
  const m = /^\[\s*([^\]\s]{1,3})\s*\]\s*(.+)$/.exec(s);
  if (!m) return s.length >= 6 ? { level: null, name: s } : null;
  const lv = m[1].replace(/[Oo]/g, '0').replace(/[Il]/g, '1');
  return { level: /^\d+$/.test(lv) ? +lv : null, name: m[2].trim() };
}
// the game's quest a line is: same level (when read), and the name's start alike enough (the window cuts names off)
function matchQuest(line, quests) {
  const p = parseLine(line);
  if (!p) return null;
  const want = norm(p.name);
  if (want.length < 4) return null;
  let best = null;
  for (const q of quests) {
    if (p.level != null && q.level !== p.level) continue;
    const name = norm(q.name).slice(0, want.length + 2);
    const sc = dice(want, name) + (p.level != null ? 0.05 : 0);
    if (!best || sc > best.score) best = { q, score: sc };
  }
  // a misread level: try again on the name alone
  if ((!best || best.score < 0.55) && p.level != null) return matchQuest(p.name, quests);
  return best && best.score >= 0.55 ? { id: best.q.id, name: best.q.name, level: best.q.level, score: Math.round(best.score * 100) / 100 } : null;
}

// what you have in progress, per character; a quest that was in progress and no longer is (while the list is seen
// again) is done — or dropped; the tracker can't tell, so the quest planner shows it ticked and you can untick it
class QuestWatch {
  constructor({ read, save }) { this.data = read() || { active: {} }; this.save = () => save(this.data); }
  // list: matched quests seen now in "Quest in progress"; full: the list fits the window (fewer than 9 lines: nothing hidden)
  seen(char, list, t, full) {
    const k = String(char || '?').toLowerCase(), before = this.data.active[k];
    const ids = [...new Set(list.map((x) => x.id))];
    this.data.active[k] = { t, ids, quests: list.map(({ id, name, level }) => ({ id, name, level })) };
    // when each quest was first seen in progress (for the quest history)
    const first = ((this.data.first ||= {})[k] ||= {});
    for (const id of ids) first[id] ||= t;
    // only when the whole list is visible: a quest scrolled out of view isn't gone
    const gone = before && full ? before.ids.filter((id) => !ids.includes(id)) : [];
    this.goneStarts = Object.fromEntries(gone.map((id) => [id, first[id] || null]));
    for (const id of gone) delete first[id];
    this.save();
    return gone;
  }
  active(char) { return this.data.active[String(char || '?').toLowerCase()] || null; }
}

module.exports = { parseLine, matchQuest, dice, QuestWatch };
