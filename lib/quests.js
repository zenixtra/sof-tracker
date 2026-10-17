// Ybq.cfg (quests): a plain header ("english <date>", quest count), then every byte bit-shuffled (QUEST_BITS).
// Decoded it is a stream of numbers and length-prefixed texts ("<bytes> <text>"):
//   id, name, level, ?, <n> class ids, 9 flags, 4 dialogue texts, <n> rewards (item id, amount),
//   <n> steps: NPC id, ?, zone, x, y (minimap pixels), ?, <n> items (item id, amount, zone, x, y, monster id), 11 texts
'use strict';

const fs = require('fs');
const path = require('path');
const { QUEST_BITS } = require('./gamekeys');

const euckr = new TextDecoder('euc-kr');

function decodeBody(raw) {
  const map = new Uint8Array(256);
  for (let c = 0; c < 256; c++) { let y = 0; for (let i = 0; i < 8; i++) if ((c >> i) & 1) y |= 1 << QUEST_BITS[i]; map[c] = y; }
  let o = raw.indexOf(0x0a) + 1;           // after "english 20200114\r\n"
  while (o < raw.length && raw[o] !== 32) o++; // the plain quest count
  return Buffer.from(Uint8Array.from(raw.subarray(o + 1), (c) => map[c]));
}

function readQuests(clientDir) {
  const b = decodeBody(fs.readFileSync(path.join(clientDir, 'Ybq.cfg')));
  let p = 0;
  const ws = () => { while (b[p] === 32 || b[p] === 10 || b[p] === 13) p++; };
  const int = () => {
    ws(); const st = p; if (b[p] === 45) p++;
    while (b[p] >= 48 && b[p] <= 57) p++;
    if (st === p) throw new Error(`quest file: number expected at byte ${st}`);
    return +b.toString('latin1', st, p);
  };
  const str = () => { const n = int(); p++; const v = euckr.decode(b.subarray(p, p + n)); p += n; return v.replace(/\r\n/g, '\n').trim(); };
  const quests = [];
  for (;;) {
    ws(); if (p >= b.length) break;
    const q = { id: int(), name: str(), level: int() };
    int();
    q.classes = Array.from({ length: int() }, int);
    for (let i = 0; i < 9; i++) int();
    const talk = [str(), str(), str(), str()];
    q.intro = talk[0];
    q.rewards = Array.from({ length: int() }, () => ({ id: int(), qty: int() })).filter((r) => r.id);
    q.steps = Array.from({ length: int() }, () => {
      const s = { npc: int() }; int();
      s.zone = int(); s.px = int(); s.py = int(); int();
      s.items = Array.from({ length: int() }, () => ({ id: int(), qty: int(), zone: int(), px: int(), py: int(), mob: int() }));
      const texts = Array.from({ length: 11 }, str);
      s.say = texts[0]; s.goal = texts[10] || texts[5] || '';
      return s;
    });
    quests.push(q);
  }
  return quests;
}

module.exports = { readQuests };
