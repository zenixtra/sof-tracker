// The game's own system messages (Ybmsg.cfg), turned into patterns for the chat lines the screen reader sees:
// item pickups ("Fish Scale obtained."), Ki and gold gains ("5000Ki obtained"), who killed you ("You died by %s and
// your honor point decreased."), Honor lost to an attack, EXP lost on death, a full bag. Built from the game's texts
// where they are there, with the same wording as a fallback.
'use strict';

// a template ("You died by %s and your honor point decreased.") → a pattern: %s any text, %d a number
function templateRe(text, names = []) {
  let n = 0;
  const src = String(text).trim().replace(/\.$/, '').split(/(%s|%d)/).map((p) => {
    if (p === '%s') return `(?<${names[n++] || `s${n}`}>.+?)`;
    if (p === '%d') return `(?<${names[n++] || `d${n}`}>\\d[\\d,.]*)`;
    return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
  }).join('');
  return new RegExp(`${src}\\.?$`, 'i');
}

const num = (s) => { const v = +String(s || '').replace(/[,.\s]/g, ''); return Number.isFinite(v) ? v : null; };
const GAINS = /\b(Exp|Ki|Gold)\b\s*(?:has been\s*)?obtained|gold received/i;

// msgs: [{ id, text }] from Ybmsg.cfg (or [] when it can't be read)
function buildMatchers(msgs = []) {
  const has = (re) => msgs.some((m) => re.test(m.text));
  const find = (re) => msgs.find((m) => re.test(m.text))?.text;
  // pickups: "<item> obtained.", "%s %d has been obtained.", "%s%s has been obtained.", "You have obtained a %s."
  // (the most specific first: "<item> 3 has been obtained." also ends in "obtained.")
  const pickups = [];
  if (!msgs.length || has(/^%s %d has been obtained/i)) pickups.push({ re: /^(?<item>.+?)\s+(?<qty>\d{1,4})\s+has\s+been\s+obtained\.?$/i });
  if (!msgs.length || has(/^%s%s has been obtained/i)) pickups.push({ re: /^(?<item>.+?)\s*has\s+been\s+obtained\.?$/i });
  if (!msgs.length || has(/You have obtained a %s/i)) pickups.push({ re: /You\s+have\s+obtained\s+an?\s+(?<item>.+?)\.?$/i });
  if (!msgs.length || has(/^\s*obtained\.\s*$/i)) pickups.push({ re: /^(?<item>[A-Za-z(\[][^.]{1,60}?)\s+obtained\.?$/i });
  const died = find(/You died by %s/i) || 'You died by %s and your honor point decreased.';
  const attacked = find(/You have been attacked by %s and lost %s honor/i) || 'You have been attacked by %s and lost %s honor points.';
  return {
    pickups,
    died: templateRe(died, ['who']),
    attacked: templateRe(attacked, ['who', 'honor']),
    expLost: /(?<n>\d[\d,.]*)\s*experience\s+has\s+been\s+lost|Exp\s+loss\s+in\s+death\s*[:;]?\s*(?<m>\d[\d,.]*)/i,
    bagFull: /Your\s+inventory\s+is\s+full|exceeded\s+your\s+weight\s+capacity|reached\s+your\s+weight\s+limit/i,
  };
}

// one chat line → what it is (null: none of these)
function classify(line, m) {
  const s = String(line || '').replace(/\s+/g, ' ').trim().replace(/^[^A-Za-z0-9[(]+/, '');
  if (!s) return null;
  let x;
  if ((x = /(\d[\d,.]{0,14})\s*Ki\s*obtained/i.exec(s))) return { kind: 'ki', n: num(x[1]) };
  if ((x = /(\d[\d,.]{0,14})\s*Gold\s*(?:has been\s*)?obtained|(\d[\d,.]{0,14})\s*gold\s+received/i.exec(s))) return { kind: 'gold', n: num(x[1] || x[2]) };
  if (/\bExp\s*obtained/i.test(s)) return null; // (EXP lines: counted by the EXP reader)
  if ((x = m.died.exec(s))) return { kind: 'killedBy', who: x.groups.who.replace(/[[\]]/g, '').trim() };
  if ((x = m.attacked.exec(s))) return { kind: 'attacked', who: x.groups.who.replace(/[[\]]/g, '').trim(), honor: num(x.groups.honor) };
  if ((x = m.expLost.exec(s))) return { kind: 'expLost', n: num(x.groups.n || x.groups.m) };
  if (m.bagFull.test(s)) return { kind: 'bagFull' };
  // your PvP kills, the kill feed, karma, trades, your house, Honor Pills
  if ((x = /You\s+defeated\s+(.+?)\s+and\s+your\s+honor\s+point\s+increased/i.exec(s))) return { kind: 'defeated', who: x[1].replace(/[[\]]/g, '').trim() };
  if ((x = /^(?:\[?(\S{2,20}?)\]?)'s\s+karma\s+has\s+dropped/i.exec(s))) return { kind: 'karmaDrop', who: x[1] };
  if ((x = /^(?:\[?(\S{2,20}?)\]?)'s\s+karma\s+has\s+been\s+restored/i.exec(s))) return { kind: 'karmaRestored', who: x[1] };
  if (/^Exchange\s+completed\s+successfully/i.test(s)) return { kind: 'trade' };
  if (/^You\s+have\s+left\s+the\s+House/i.test(s)) return { kind: 'houseLeave', who: null };
  if ((x = /^(\S{2,20})\s+has\s+left\s+the\s+House/i.exec(s))) return { kind: 'houseLeave', who: x[1] };
  if ((x = /^(\S{2,20})\s+has\s+become\s+a\s+house\s+member/i.exec(s))) return { kind: 'houseJoin', who: x[1] };
  if ((x = /(\d[\d,.]*)\s+honor\s+points\s+have\s+been\s+gained\s+after\s+using\s+Honor\s+Pill/i.exec(s))) return { kind: 'honorPill', n: num(x[1]) };
  // enchanting and combining, repairs, your pet's loyalty, EXP events, events starting, your party
  if ((x = /item\s+enchantment\s+has\s+(succee?d(?:ed)?|failed)/i.exec(s))) return { kind: 'enchant', ok: !/fail/i.test(x[1]) };
  if ((x = /^Combination\s+(succeeded|failed)/i.exec(s))) return { kind: 'combine', ok: /succe/i.test(x[1]) };
  if (/Equipment\s+is\s+damaged|Please\s+repair\s+equipment/i.test(s)) return { kind: 'repairNeeded' };
  if (/^Repair\s+has\s+been\s+completed/i.test(s)) return { kind: 'repaired' };
  if (/pet'?s\s+loyalty\s+(?:is\s+too\s+low|has\s+become\s+0)|pet\s+got\s+withdraw/i.test(s)) return { kind: 'petLoyalty', withdrawn: /withdraw|become\s+0/i.test(s) };
  if ((x = /Double\s+experience\s+event\s+is\s+being\s+held\s+from\s+(.+?)\s+to\s+(.+?)\.?$/i.exec(s))) return { kind: 'expEvent', what: 'Double EXP', from: x[1], to: x[2] };
  if ((x = /Attendance\s+EXP\s+event\s+is\s+in\s+progress.*?(\d+)\s*%/i.exec(s))) return { kind: 'expEvent', what: `Attendance EXP +${x[1]}%` };
  if ((x = /^(?:The\s+)?(.{3,45}?)\s+has\s+(?:started|begun)\b/i.exec(s)) && !/^(it|this|that|the event)$/i.test(x[1])) return { kind: 'eventStart', name: x[1].replace(/^\d+(?:st|nd|rd|th)\s+round\s+of\s+/i, '').trim() };
  if ((x = /^(\S{2,20})\s+has\s+left\s+the\s+party/i.exec(s))) return { kind: 'partyLeave', who: x[1] };
  if ((x = /^(\S{2,20})\s+has\s+become\s+the\s+party\s+leader/i.exec(s))) return { kind: 'partyLeader', who: x[1] };
  // "Alpha killed Beta": two names, nothing else (a player's chat line "Bob: I killed it" has a colon and more words)
  if (!/:/.test(s) && (x = /^\[?([A-Za-z0-9_]{2,16})\]?\s+killed\s+\[?([A-Za-z0-9_]{2,16})\]?\.?$/.exec(s))) return { kind: 'killFeed', killer: x[1], victim: x[2] };
  if (!GAINS.test(s) && !/party\s+m\S*mber|announcement/i.test(s)) {
    for (const p of m.pickups) {
      const r = p.re.exec(s);
      if (r?.groups?.item) {
        const item = r.groups.item.replace(/^\[|\]$/g, '').trim();
        if (item.length >= 3 && !/^(item|it|this|the)$/i.test(item)) return { kind: 'pickup', item, qty: r.groups.qty ? +r.groups.qty : 1 };
      }
    }
  }
  return null;
}

module.exports = { buildMatchers, classify, templateRe };
