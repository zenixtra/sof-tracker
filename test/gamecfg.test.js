'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const gc = require('../lib/gamecfg');
const { POTIONS } = require('../lib/guideplan');

const skills = [
  { id: 801201, name: 'Swift Attack', cls: 11, level: 10 }, { id: 801202, name: 'Swift Attack(All)', cls: 11, level: 110 },
  { id: 6002101, name: 'Weaken 1', cls: 11, level: 10 }, { id: 6002102, name: 'Weaken 2', cls: 11, level: 60 }, { id: 6002103, name: 'Weaken 3', cls: 11, level: 150 },
  { id: 540001, name: 'Sagacity of Divinity Dagger-Rob', cls: 11, level: 130 }, { id: 540002, name: 'Sagacity of Devilish Dagger-Rob', cls: 11, level: 130 },
  { id: 601103, name: 'Celestial Walk', cls: 0, level: 100 }, { id: 501203, name: 'Touch of Regeneration', cls: 5, level: 35 },
];
const items = [{ id: 8000004, name: 'Pick up' }, { id: 1000000970, name: 'Healing Anchorite Heaing Pill' }, { id: 1000000972, name: 'Healing Anchorite  Aged Rare Ginseng' }, { id: 1008000174, name: 'Healing Salve Package(Event)' }];
const known = (id) => skills.some((s) => s.id === id) || items.some((s) => s.id === id);

// files laid out like the game's (see lib/gamecfg.js)
function client() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sof-cfg-'));
  const bar = Buffer.alloc(403); bar.write('Shadowcat', 0);
  const put = (b, off, type, id) => { b[off - 4] = type; b.writeUInt32LE(id, off); };
  put(bar, 0x17 + 12 * 5, 2, 601103); put(bar, 0x17 + 12 * 9, 2, 801201); put(bar, 0x17 + 12 * 2, 5, 8000004); put(bar, 0x17 + 12 * 3, 5, 1008000174);
  fs.writeFileSync(path.join(d, 'Shadowcat~0.scs'), bar);
  const old = Buffer.alloc(403); put(old, 0x17, 2, 501203); fs.writeFileSync(path.join(d, 'Shadowcat~3.scs'), old);
  fs.utimesSync(path.join(d, 'Shadowcat~3.scs'), new Date(2020, 0, 1), new Date(2020, 0, 1)); // an older bar file: ignored
  const auto = Buffer.alloc(292); auto.writeUInt32LE(6002101, 0x0c); auto.writeUInt32LE(1000000970, 0x84); auto.writeUInt32LE(1000000972, 0x9c);
  fs.writeFileSync(path.join(d, 'Shadowcat.mhslot'), auto);
  fs.writeFileSync(path.join(d, 'ybopt2.cfg'), '<?xml version="1.0" encoding="UTF-8" ?>\n<GameOption>\n  <Shadow>1</Shadow>\n  <SightLevel>2</SightLevel>\n  <Winmode>0</Winmode>\n  <ChatBackgroundAlpha>30</ChatBackgroundAlpha>\n  <temp0>0</temp0>\n</GameOption>\n');
  fs.writeFileSync(path.join(d, 'ybopt2_acc1.cfg'), '<GameOption> <honorTitle>2 <N_Shadowcat>99</N_Shadowcat> <N_Alt_2>99</N_Alt_2> </honorTitle> </GameOption>');
  const y = Buffer.alloc(120); y.write('Bank7', 8); y.write('omaru_', 14); fs.writeFileSync(path.join(d, 'YBc.cfg'), y);
  return d;
}

test('skill bar and auto-combat setup: slots, ids, newest bar file', () => {
  const d = client();
  const c = gc.readCharacterFiles(d, known).get('shadowcat');
  assert.deepStrictEqual(c.bar.slots, [{ slot: 2, id: 8000004 }, { slot: 3, id: 1008000174 }, { slot: 5, id: 601103 }, { slot: 9, id: 801201 }]);
  assert.strictEqual(c.bar.file, 'Shadowcat~0.scs');
  assert.deepStrictEqual(c.auto.slots.map((s) => s.id), [6002101, 1000000970, 1000000972]);
});

test('potions from the setup, by the potion table (event versions too)', () => {
  const byId = new Map(items.map((i) => [i.id, i]));
  assert.deepStrictEqual(gc.potionsOf([1000000970, 1000000972].map((id) => byId.get(id)), POTIONS), { hp: 'Healing Anchorite Heaing Pill', mp: 'Healing Anchorite  Aged Rare Ginseng' });
  assert.deepStrictEqual(gc.potionsOf([byId.get(1008000174)], POTIONS), { hp: 'Healing Salve Package', mp: null });
});

test('skill advice: stronger versions you can use now, your faction only', () => {
  const used = [skills[0], skills[2]]; // Swift Attack, Weaken 1
  const a = gc.skillAdvice({ used, skills, cls: 11, level: 137, faction: 'The Order' });
  assert.deepStrictEqual(a.upgrades.map((u) => `${u.from.name} → ${u.to.name}`), ['Swift Attack → Swift Attack(All)', 'Weaken 1 → Weaken 2']); // not Weaken 3 (level 150)
  assert.deepStrictEqual(a.strongest.map((s) => s.name), ['Sagacity of Divinity Dagger-Rob', 'Swift Attack(All)', 'Weaken 2']);
  assert.strictEqual(gc.skillAdvice({ used: [skills[6]], skills, cls: 11, level: 137 }).strongest[0].name, 'Sagacity of Devilish Dagger-Rob'); // Chaos, guessed from the bar
  assert.strictEqual(gc.classIdOf('DamHwalyn'), 14);
  assert.strictEqual(gc.classIdOf('Ninja'), 11);
});

test('game settings: heavy graphics, reader problems, what changed', () => {
  const d = client();
  const o = gc.readOptions(d);
  assert.deepStrictEqual(o, { Shadow: 1, SightLevel: 2, Winmode: 0, ChatBackgroundAlpha: 30, temp0: 0 });
  assert.deepStrictEqual(gc.graphicsHeavy(o).map((h) => h.key), ['Shadow', 'SightLevel']);
  assert.deepStrictEqual(gc.readerIssues(o).map((i) => i.key), ['Winmode', 'ChatBackgroundAlpha']);
  assert.deepStrictEqual(gc.optionChanges(o, { ...o, Shadow: 0, temp0: 5 }), [{ key: 'Shadow', from: 1, to: 0 }]);
});

test('your accounts and characters on this PC', () => {
  const r = gc.readRoster(client());
  assert.deepStrictEqual(r.accounts, { acc1: ['Shadowcat', 'Alt_2'] });
  assert.ok(r.names.has('bank7') && r.names.has('alt_2') && r.names.has('shadowcat'));
  assert.ok(!r.names.has('omaru_')); // leftover bytes after a name
});
