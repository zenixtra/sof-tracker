'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { buildMatchers, classify, templateRe } = require('../lib/sysmsg');
const { loadMessages } = require('../lib/gamedata');

const GAME = 'C:/NetGame/ScionsOfFate/Client';
const sets = [['fallback wording', buildMatchers([])]];
if (fs.existsSync(`${GAME}/Ybmsg.cfg`)) sets.push(['the game\'s own texts', buildMatchers(loadMessages(GAME))]);

for (const [name, m] of sets) {
  test(`system messages (${name}): pickups, Ki, gold, deaths, a full bag`, () => {
    assert.deepStrictEqual(classify('Fish Scale obtained.', m), { kind: 'pickup', item: 'Fish Scale', qty: 1 });
    assert.deepStrictEqual(classify('Zombie Cat sample 3 has been obtained.', m), { kind: 'pickup', item: 'Zombie Cat sample', qty: 3 });
    assert.deepStrictEqual(classify('5000Ki obtained', m), { kind: 'ki', n: 5000 });
    assert.deepStrictEqual(classify('12,500 Gold obtained', m), { kind: 'gold', n: 12500 });
    assert.strictEqual(classify('125120Exp obtained', m), null); // the EXP reader's
    assert.deepStrictEqual(classify('You died by Bloodfang and your honor point decreased.', m), { kind: 'killedBy', who: 'Bloodfang' });
    assert.deepStrictEqual(classify('You have been attacked by Bloodfang and lost 120 honor points.', m), { kind: 'attacked', who: 'Bloodfang', honor: 120 });
    assert.deepStrictEqual(classify('35400 experience has been lost.', m), { kind: 'expLost', n: 35400 });
    assert.deepStrictEqual(classify('Your inventory is full.', m), { kind: 'bagFull' });
    // not pickups: a party drop announcement, gold, chat
    assert.strictEqual(classify("Announcements: iSenZ's party member has gotten [Black Sky Armor]", m), null);
    assert.strictEqual(classify('Bob: hello there', m), null);
  });
}

test('a template becomes a pattern: %s any text, %d a number', () => {
  const re = templateRe('%s %d has been obtained.', ['item', 'qty']);
  assert.deepStrictEqual({ ...re.exec('Wolf Fang 2 has been obtained.').groups }, { item: 'Wolf Fang', qty: '2' });
});

test('more system messages: your PvP kills, the kill feed, karma, trades, your house, Honor Pills', () => {
  const m = buildMatchers([]);
  assert.deepStrictEqual(classify('You defeated Bloodfang and your honor point increased.', m), { kind: 'defeated', who: 'Bloodfang' });
  assert.deepStrictEqual(classify('Bloodfang killed Shadowcat', m), { kind: 'killFeed', killer: 'Bloodfang', victim: 'Shadowcat' });
  assert.strictEqual(classify('Bob: I killed it', m), null);
  assert.strictEqual(classify('The wolf killed the sheep', m), null);
  assert.deepStrictEqual(classify("Shadowcat's karma has dropped due to attacking the same faction.", m), { kind: 'karmaDrop', who: 'Shadowcat' });
  assert.deepStrictEqual(classify('Exchange completed successfully.', m), { kind: 'trade' });
  assert.deepStrictEqual(classify('Alpha has left the House.', m), { kind: 'houseLeave', who: 'Alpha' });
  assert.deepStrictEqual(classify('Beta has become a house member.', m), { kind: 'houseJoin', who: 'Beta' });
  assert.deepStrictEqual(classify('3000 honor points have been gained after using Honor Pill.', m), { kind: 'honorPill', n: 3000 });
});

test('more system messages: enchanting, combining, repairs, pet loyalty, EXP events, events starting, your party', () => {
  const m = buildMatchers([]);
  assert.deepStrictEqual(classify('The item enchantment has succeed.', m), { kind: 'enchant', ok: true });
  assert.deepStrictEqual(classify('The item enchantment has failed.', m), { kind: 'enchant', ok: false });
  assert.deepStrictEqual(classify('Combination failed.', m), { kind: 'combine', ok: false });
  assert.deepStrictEqual(classify('Equipment is damaged. It will need to be repaired.', m), { kind: 'repairNeeded' });
  assert.deepStrictEqual(classify('Repair has been completed.', m), { kind: 'repaired' });
  assert.deepStrictEqual(classify("Your pet's loyalty has become 0 and it has been withdrawn.", m), { kind: 'petLoyalty', withdrawn: true });
  assert.deepStrictEqual(classify('Double experience event is being held from 18:00 to 22:00.', m), { kind: 'expEvent', what: 'Double EXP', from: '18:00', to: '22:00' });
  assert.deepStrictEqual(classify('The Authority Clash has started.', m), { kind: 'eventStart', name: 'Authority Clash' });
  assert.deepStrictEqual(classify('The 2nd round of Last Man Standing matches has begun.', m), { kind: 'eventStart', name: 'Last Man Standing matches' });
  assert.deepStrictEqual(classify('Alpha has left the party.', m), { kind: 'partyLeave', who: 'Alpha' });
});
