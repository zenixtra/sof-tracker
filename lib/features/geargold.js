// Gear & gold: the gear log from item tooltips, gear compare, the price check of a hovered item, gold and bag weight
// from the inventory, net worth, gear goals, gear score, gear offers in the trade chat (better gear for sale), the
// enhance budget and the gear check before the maze / pass zones. Moved out of server.js; shared things come in
// through `ctx` and are looked up when used.
'use strict';

const gear = require('../gear');
const inv = require('../inventory');
const ledger = require('../ledger');
const watch = require('../watch');
const market = require('../market');
const guideplan = require('../guideplan');
const { SLOTS } = require('../gamedb');

module.exports = function createGearGold(ctx) {
  const { store, feat, addAlert, debugCapture, readerOk, playerInfo, zoneName, chatPrice } = ctx;
  const state = () => ctx.state(), db = () => ctx.db(), settings = () => ctx.settings(), enhanceSession = () => ctx.enhanceSession();

  // the gear log: item tooltips the screen reader sees while you hover over your gear
  const gearLog = new gear.GearLog({ read: () => store.readJson('gear.json', null), save: (d) => store.writeJson('gear.json', d) });
  { const n = gearLog.clean(); if (n) console.log(`[tracker] gear log: ${n} junk rows removed`); }
  // a hovered item that isn't the one you wear in that slot: compared with yours (shown for a few minutes)
  let gearCompare = null;
  function onTooltip(tt, t, char = state().session.character) {
    if (!feat('gear')) return;
    // kind: the tooltip's own slot, when the first match turned out to be for another slot
    const g = gear.parseTooltip(tt.lines, tt.cols, (name, kind) => {
      const list = kind ? db().items.filter((it) => inv.gearKind(SLOTS[it.slot]) === kind || inv.gearKind(it.name) === kind) : db().items;
      const it = gear.matchItemName(name, list); return it && { ...it, slotName: SLOTS[it.slot] || null };
    });
    // a name plate or other text box that looks like a tooltip: no known item, slot or stats
    if (!g || (!g.itemId && !g.slot && !g.attack && g.defense == null)) { if ((tt.lines || []).length >= 3 && !(tt.lines || []).some((l) => /chi\s*cast|cool\s*time|mana\s*cost/i.test(l))) debugCapture('tooltip', t, { lines: tt.lines, cols: tt.cols, box: tt.box }); return; } // (a skill's tooltip isn't a stuck item)
    readerOk('tooltip', t);
    // the price check works for any item; the gear log only takes gear, and only for a known character
    const r = g.slot && char ? gearLog.seen(g, char, t) : null;
    if (r?.changed === 'plus' && char === state().session.character) ctx.timelineFor(ctx.sessionKey(state().session))?.event(t, 'drop', `${g.name}: +${r.before.plus} → +${g.plus}`);
    if (r?.changed === 'other') gearCompare = { t, char, mine: r.rec, other: g, ...inv.compareGear(r.rec, g), price: gearPrice(g) };
    if (r && r.changed !== 'other') { gearScores.note(char, charGearScore(char).score, t); noteNetWorth(char, t); }
    // the price check: any item you hover over (gear or not), shown for a minute
    if (!priceNow || priceNow.name !== g.name || priceNow.plus !== g.plus || t - priceNow.t > 20000) priceNow = { t, char, ...itemPriceCheck(g, tt.lines) };
    else priceNow.t = t;
  }
  // the open inventory: gold (also your Ascension gold) and weight
  const invWatch = new inv.InvWatch({ read: () => store.readJson('gold.json', null), save: (d) => store.writeJson('gold.json', d), onEvent: addAlert });
  // gear goals: the item you want per slot, per character (picked in the gear advisor)
  let gearGoals = store.readJson('gear-goals.json', {}); // char → { kind: itemId }
  function gearGoalsView(char) {
    const goals = gearGoals[String(char || '').toLowerCase()] || {}, mine = gearLog.list(char);
    return Object.entries(goals).map(([kind, id]) => {
      const it = db().items.find((x) => x.id === id);
      if (!it) return null;
      const cur = mine.find((g) => g.slot === kind);
      const have = !!cur && (cur.itemId === id || cur.name === it.name);
      const price = chatPrice(id) ?? gearPrice({ slot: kind, level: it.level, plus: 0 }).sell ?? null;
      return { kind, itemId: id, name: it.name, level: it.level, have, current: cur ? `${cur.name}${cur.plus ? ` +${cur.plus}` : ''}` : null, price, history: priceLine(id) };
    }).filter(Boolean);
  }
  // an item's usual price per day, last 30 days: [[t, price]] (selling price, else buying)
  const priceLine = (id) => watch.priceHistory(ctx.marketOffers(), id, { days: 30, dayOf: ctx.dayKey }).map((d) => [d.t, d.sell ?? d.buy]).filter((p) => p[1]);
  // the lowest asking price for an item in the last 30 days (before now)
  const lowest30 = (id, before) => { const l = ctx.marketOffers().filter((x) => x.itemId === id && x.side === 'sell' && x.price && x.t < before && before - x.t < 30 * 86400000).map((x) => x.price); return l.length >= 3 ? Math.min(...l) : null; };
  // a goal item offered in the trade chat (and whether it's the cheapest in 30 days)
  function checkGoalOffer(o) {
    const char = state().session.character;
    if (o.side !== 'sell' || !o.itemId || !char) return;
    const g = gearGoalsView(char).find((x) => x.itemId === o.itemId && !x.have);
    if (!g) return;
    const low = o.price ? lowest30(o.itemId, o.t || Date.now()) : null;
    addAlert('price', `🎯 ${o.who} sells ${o.item}${o.price ? ` for ${market.gold(o.price)}` : ''}${low != null && o.price <= low ? ' (lowest in 30 days)' : ''}`, `your ${g.kind} goal${g.price ? ` · usually ${market.gold(g.price)}` : ''} · ${o.raw}`);
  }
  // net worth: gold plus your gear at chat prices (pieces without offers count nothing)
  const netWorth = new ledger.NetWorth({ read: () => store.readJson('networth.json', null), save: (d) => store.writeJson('networth.json', d) });
  function gearValue(char) {
    // only offers that name a level ("Buy ring set 118B" says nothing about a level-4 ring)
    const list = gearLog.list(char).filter((g) => g.slot), withLevel = gearOffers.filter((o) => o.level);
    let gear = 0, priced = 0;
    for (const g of list) { const p = inv.gearPrice(withLevel, { kind: g.slot, level: g.level, plus: g.plus }), v = p.sell ?? p.buy; if (v && g.level) { gear += v; priced++; } }
    return { gear, priced, pieces: list.length };
  }
  function noteNetWorth(char, t = Date.now()) {
    const g = invWatch.last(char)?.gold;
    if (char && g != null) netWorth.note(char, { gold: g, gear: gearValue(char).gear }, t);
  }
  function onInventory(i, t, char = state().session.character) {
    if (!feat('gold')) i = { ...i, gold: null }; // gold switched off: only the bag weight
    const r = invWatch.frame(char, i, t, { weightAlert: settings().weightAlert });
    if (r.weight) readerOk('weight', t);
    if (String(i.gold || '').trim() && inv.parseGold(i.gold) == null) debugCapture('inventory', t, i); // gold text seen but not readable
    if (r.gold != null) { readerOk('gold', t); noteNetWorth(char, t); }
    if (r.gold != null && char) ctx.onGold(char, r.gold); // your Ascension gold
  }
  // gear score per character (and its history)
  const gearScores = new ledger.GearScores({ read: () => store.readJson('gear-scores.json', null), save: (d) => store.writeJson('gear-scores.json', d) });
  // the base attack / defense from the game data when the item is known (the tooltip shows totals with the + level
  // and options in, and misses lines), else what the tooltip said
  function gearWithStats(char) {
    return gearLog.list(char).map((g) => {
      const it = g.itemId ? db().items.find((x) => x.id === g.itemId) : null;
      return it ? { ...g, defense: it.def || g.defense || null, attack: it.atkMax ? [it.atkMin, it.atkMax] : g.attack } : g;
    });
  }
  const charGearScore = (char) => ledger.gearScore(gearWithStats(char));
  function gearScoreView(char) { return { char, ...charGearScore(char), history: gearScores.history(char).map((p) => [p.t, p.score]) }; }
  // the item you hover over now: what it goes for in the chat, at the NPC and (shop tooltips) what it costs here
  let priceNow = null;
  function itemPriceCheck(g, lines) {
    const it = g.itemId ? db().items.find((x) => x.id === g.itemId) : null;
    let chat = {};
    if (inv.gearKind(g.slot)) { const p = gearPrice(g); chat = { sell: p.sell, buy: p.buy, offers: p.offers }; }
    if (g.itemId && chat.sell == null && chat.buy == null) { const s = market.priceStats(ctx.marketOffers(), 90).find((x) => x.itemId === g.itemId); if (s) chat = { sell: s.sell, buy: s.buy, offers: s.offers }; }
    return ledger.priceCheck({ name: g.name, itemId: g.itemId, plus: g.plus, chat, npcPrice: it?.price || null, shown: ledger.tooltipPrice(lines.slice(1)) });
  }
  // gear offers in the trade chat ("SELL ROBE HBK 110 DEF7+8 7,5B")
  let gearOffers = store.readJson('gear-offers.json', []);
  function onGearOffer(line, t) {
    const o = inv.parseGearOffer(line);
    if (!o || !o.price) return;
    const raw = String(line).slice(0, 160);
    if (gearOffers.some((x) => t - x.t < 30 * 60000 && x.raw === raw)) return;
    gearOffers.push({ t, ...o, raw }); gearOffers = gearOffers.slice(-3000);
    store.writeJson('gear-offers.json', gearOffers);
    if (settings().gearOfferAlert && feat('gear')) try { checkBetterGear(o, raw); } catch { /* gear log not ready */ }
  }
  // someone sells a piece for one of your slots that beats yours: higher + (or 10+ levels newer at the same +)
  function checkBetterGear(o, raw) {
    const char = state().session.character;
    if (o.side !== 'sell' || !char) return;
    const mine = gearWithStats(char).find((g) => g.slot === o.kind);
    if (!mine) return;
    const lv = playerInfo(char)?.level;
    if (o.level && lv && o.level > lv) return;                         // you can't wear it yet
    if (o.level && mine.level && o.level < mine.level - 5) return;      // older gear
    const plus = o.plus ?? 0, mp = mine.plus || 0;
    const better = plus > mp || (o.level && mine.level && o.level >= mine.level + 10 && plus >= mp);
    if (!better) return;
    const gain = ledger.pieceScore({ ...mine, plus, level: o.level || mine.level }) - ledger.pieceScore(mine);
    addAlert('price', `Better ${o.kind} for sale: ${o.plus != null ? `+${o.plus} ` : ''}${o.level ? `lv ${o.level} ` : ''}for ${market.gold(o.price)}`,
      `yours: +${mp}${mine.level ? ` lv ${mine.level}` : ''} · gear score ${gain >= 0 ? '+' : ''}${gain} · ${raw}`);
  }
  // what your gold buys in enhancing: the charm you use (chat price, else the NPC price) per try, for the best +1
  function enhanceBudget(char, upgrades) {
    const g = invWatch.last(char)?.gold;
    const name = enhanceSession().sofCharm && enhanceSession().sofCharm !== 'No charm' ? enhanceSession().sofCharm : 'Mystic Charm of Luck (15%)';
    const it = db().items.find((x) => x.name === name);
    const price = it ? chatPrice(it.id) || it.price || null : null;
    if (!g || !price) return { gold: g ?? null, charm: name, price, tries: null };
    const tries = Math.floor(g / price);
    const plan = upgrades.slice(0, 3).map((u) => ({ name: u.name, slot: u.slot, plus: u.plus, to: u.to, chance: u.chance, risky: u.risky,
      // a safe level: the chance at least one of your tries works; a risky one: a fail breaks it, so it's one try
      reach: u.risky ? u.chance : 1 - Math.pow(1 - u.chance, Math.min(tries, 200)), triesNeeded: u.chance > 0 ? Math.ceil(1 / u.chance) : null }));
    return { gold: g, charm: name, price, priceFrom: chatPrice(it.id) ? 'chat' : 'npc', tries, plan };
  }
  const gearPrice = (g, plus = g.plus) => inv.gearPrice(gearOffers, { kind: g.slot, level: g.level, plus });
  // before the maze / a training area / a dungeon: your gear for it (once per visit)
  let gearCheckZone = null;
  function checkGearFor(zone) {
    if (zone === gearCheckZone) return;
    gearCheckZone = zone;
    const pass = guideplan.passOf(zone), maze = guideplan.isMaze(zone);
    if (!pass && !maze) return;
    const mine = gearLog.list(state().session.character), lv = playerInfo(state().session.character)?.level;
    if (!mine.length) return;
    const notes = [];
    const weapon = mine.find((g) => g.slot === 'Weapon');
    if (maze && weapon && !weapon.element) notes.push('your weapon has no element: maze monsters take full damage only from their own element (bring element pills)');
    if (lv) for (const g of mine) if (g.level && g.level < lv - 25) notes.push(`${g.slot || g.name} is level ${g.level}`);
    const low = mine.filter((g) => (g.plus || 0) < 5).map((g) => `${g.slot || g.name} +${g.plus || 0}`);
    if (low.length) notes.push(`low enhance: ${low.slice(0, 3).join(', ')}`);
    if (notes.length) addAlert('danger', `Gear check: ${zoneName(zone)}`, notes.slice(0, 4).join(' · '));
  }

  return {
    gearLog, invWatch, netWorth, gearScores, gearGoals,
    onTooltip, onInventory, onGearOffer, gearGoalsView, checkGoalOffer, gearValue, noteNetWorth, gearWithStats, charGearScore, gearScoreView,
    enhanceBudget, gearPrice, checkGearFor, priceLine,
    gearCompare: () => gearCompare, clearGearCompare: () => { gearCompare = null; },
    priceNow: () => priceNow, gearOffers: () => gearOffers,
  };
};
