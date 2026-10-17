// Quest tools: the quest window (in progress / available), quest items (kills, pickups, the pickup messages you
// taught), one trip for all your quests, the quest history, hand-in reminders, repeatable quests on the checklist,
// and the EXP split. Moved out of server.js; everything shared comes in through `ctx` and is looked up when used
// (the tracker builds some of it later than this module).
'use strict';

const questwin = require('../questwin');
const questplan = require('../questplan');

module.exports = function createQuests(ctx) {
  const { store, feat, addAlert, debugCapture, readerOk, zoneName, playerInfo, gameIndex, chatPrice } = ctx;
  const state = () => ctx.state(), db = () => ctx.db(), checklist = () => ctx.checklist(), questsDone = () => ctx.questsDone();

  // the quest window (Ctrl+Q, "Quest in progress"): what you're doing; a quest that drops off the list is ticked done
  const questWatch = new questwin.QuestWatch({ read: () => store.readJson('quests-active.json', null), save: (d) => store.writeJson('quests-active.json', d) });
  function onQuestWindow(qw, t, char = state().session.character) {
    if (!char || !feat('quests')) return;
    const matched = (qw.lines || []).map((l) => questwin.matchQuest(l, db().quests)).filter(Boolean);
    if (!matched.length && (qw.lines || []).length) { debugCapture('quest', t, { mode: qw.mode, lines: qw.lines }); return; } // nothing recognised: don't take it as "no quests"
    if (matched.length) readerOk(qw.mode === 'available' ? 'questAvailable' : 'questProgress', t);
    // the "Available Quest" tab: what you could pick up (ranked in the quest planner)
    if (qw.mode === 'available') {
      const k = String(char).toLowerCase(), ids = [...new Set(matched.map((m) => m.id))];
      if (ids.join() !== (questsAvailable[k]?.ids || []).join()) { questsAvailable[k] = { t, ids }; store.writeJson('quests-available.json', questsAvailable); }
      else questsAvailable[k].t = t;
      return;
    }
    if (qw.mode !== 'progress') return;
    const gone = questWatch.seen(char, matched, t, (qw.lines || []).length < 9);
    questViewCache.delete(String(char).toLowerCase());
    activeQuestViews(char); // also starts / stops the quest item counters
    // a daily / weekly quest in progress: on the checklist (ticked per character when you hand it in)
    for (const m of matched) repeatOnChecklist(m.id);
    if (gone.length) {
      // the quest history: how long it took (from first seen in the window) and the EXP it gives
      for (const id of gone) {
        const q = db().quests.find((x) => x.id === id);
        if (!q) continue;
        const exp = q.rewards.filter((r) => [909000001, 909100001, 909100002].includes(r.id)).reduce((s, r) => s + r.qty, 0);
        questLog.push({ char, id, name: q.name, level: q.level, start: questWatch.goneStarts?.[id] || null, end: t, exp });
        recapEvent(t, char, 'quest', 1);
      }
      questLog = questLog.slice(-3000); store.writeJson('quest-log.json', questLog);
      // repeatable quests are ticked on the checklist instead (they come back after the reset)
      const once = gone.filter((id) => !repeatOnChecklist(id));
      for (const id of gone) { const it = checklist().data.items.find((x) => x.quest === id); if (it) checklist().change({ action: 'toggle', id: it.id, done: true, char }, char); }
      if (once.length) {
        const set = new Set(questsDone()[char] || []);
        for (const id of once) set.add(id);
        questsDone()[char] = [...set]; store.writeJson('quests-done.json', questsDone());
      }
      const names = gone.map((id) => db().quests.find((q) => q.id === id)?.name).filter(Boolean);
      addAlert('goal', `Quest done: ${names[0] || gone[0]}${names.length > 1 ? ` (+${names.length - 1})` : ''}`, once.length ? `${char} · ticked in the quest planner (Undo if you only dropped it)` : `${char} · ticked on the checklist until the reset`,
        { undo: { kind: 'quests', char, ids: gone, at: t } });
    }
  }
  // Undo on an alert: a quest the tracker ticked as done (you only dropped it) goes back
  function undoAlert(a) {
    const u = a?.undo;
    if (!u || a.undone) return false;
    if (u.kind === 'quests') {
      questsDone()[u.char] = (questsDone()[u.char] || []).filter((id) => !u.ids.includes(id));
      store.writeJson('quests-done.json', questsDone());
      for (const id of u.ids) { const it = checklist().data.items.find((x) => x.quest === id); if (it) checklist().change({ action: 'toggle', id: it.id, done: false, char: u.char }, u.char); }
      // out of the quest history again
      questLog = questLog.filter((q) => !(q.char === u.char && u.ids.includes(q.id) && Math.abs(q.end - u.at) < 1000));
      store.writeJson('quest-log.json', questLog);
    } else return false;
    a.undone = true; store.writeJson('alerts.json', ctx.alerts());
    return true;
  }
  // a repeatable quest gets a checklist item (once); returns whether the quest is repeatable
  function repeatOnChecklist(id) {
    const q = db().quests.find((x) => x.id === id), kind = q && questplan.repeatKind(q);
    if (!kind) return false;
    if (!checklist().data.items.some((x) => x.quest === id)) {
      checklist().change({ action: 'add', text: `Quest: ${q.name}`.slice(0, 80), every: kind, perChar: true, quest: id, remind: kind === 'weekly' ? 720 : 120 });
    }
    return true;
  }
  // a quest whose items are all in: when you enter the zone of the NPC to hand it to, a reminder (once per quest)
  const handinReminded = new Set();
  function checkHandIn(zone, char = state().session.character) {
    if (!char || zone == null || !feat('quests')) return;
    for (const p of questProgView(char)) {
      const h = p.items[0];
      const key = `${char}|${p.id}`;
      if (!p.ready) { handinReminded.delete(key); continue; }
      if (!h || String(h.npcZone) !== String(zone) || handinReminded.has(key)) continue;
      handinReminded.add(key);
      addAlert('goal', `${h.npc} is here: hand in ${p.name}`, `${char} · all quest items are in`);
    }
  }
  let questLog = store.readJson('quest-log.json', []); // quests handed in: { char, id, name, level, start, end, exp }
  // things that happen during a session, for its recap: quests done, quest items picked up, EXP from monsters / quests
  let recapEvents = [];
  function recapEvent(t, char, kind, v) {
    recapEvents.push({ t, char: String(char || '').toLowerCase(), kind, v });
    if (recapEvents.length > 20000) recapEvents = recapEvents.filter((e) => t - e.t < 2 * 86400000);
  }
  const recapSum = (char, kind, from, to) => recapEvents.filter((e) => e.char === String(char || '').toLowerCase() && e.kind === kind && e.t >= from && e.t <= to).reduce((s, e) => s + e.v, 0);
  // where a character stands: the main window's, or one of your other windows'
  function charPosition(char) {
    const k = String(char || '').toLowerCase();
    if (String(state().session.character || '').toLowerCase() === k) return state().session.position || null;
    for (const o of ctx.others().values()) if (String(o.session?.character || '').toLowerCase() === k) return o.session.position || null;
    return null;
  }
  const altKills = new Map(); // character → recent kill times of your other windows (kill pace)
  let questsAvailable = store.readJson('quests-available.json', {}); // char -> { t, ids } from the "Available Quest" tab
  // the quests in progress with their steps (cached until the quest window is read again)
  const questViewCache = new Map();
  function activeQuestViews(char) {
    const k = String(char || '').toLowerCase(), a = questWatch.active(char);
    if (!a) return [];
    const c = questViewCache.get(k);
    if (c && c.t === a.t) return c.views;
    const views = a.quests.map((q) => ctx.questSearch(new URLSearchParams({ q: q.name, range: '999', character: char || '' })).quests.find((x) => x.id === q.id) || { ...q, steps: [], rewards: [] });
    questViewCache.set(k, { t: a.t, views });
    questProg.sync(char, views, Date.now()); // quests read before the counter existed start counting now
    for (const v of views) try { repeatOnChecklist(v.id); } catch { /* checklist not ready yet */ }
    return views;
  }
  // quest items: kills where they come from, pickups the chat reports; done → "hand it in"
  const questProg = new questplan.QuestProgress({ read: () => store.readJson('quest-progress.json', null), save: (d) => store.writeJson('quest-progress.json', d), onEvent: addAlert });
  const sameItemName = (a, b) => { const n = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, ''); return n(a) === n(b) || (n(a).length >= 6 && n(b).startsWith(n(a))) || !!ctx.bestMatch(a, [{ name: b }]); };
  const pickupSeen = new Map(); // line -> when (a chat line stays on screen for a while)
  // pickup messages the tracker was taught (a line you marked as "this is a pickup"), and lines that may be one
  let pickupPatterns = store.readJson('pickup-patterns.json', []); // [{ re, example }]
  let pickupCandidates = store.readJson('pickup-candidates.json', []).filter((c) => !/\bha[sd]\s+got|\bgott?en\b|obtain\s+today|Exp\s*obtain/i.test(c.line)); // [{ t, line, item, itemText }]
  const PICKUP_WORDS = /\b(obtain|acquir|receiv|loot|got|gain|pick|get|item)\w*/i;
  function notePickupCandidate(line, t, char) {
    const s = String(line || '').replace(/\s+/g, ' ').trim();
    if (s.length < 6 || s.length > 140 || /party\s+m\S*mber|announcement/i.test(s) || /^[^:]{2,20}:\s/.test(s)) return; // players' chat lines
    // the wrapped rest of a party drop announcement ("…has gotten [Black Sky Armo"), and the daily-quest notice
    if (/\bha[sd]\s+got|\bgott?en\b|obtain\s+today|Exp\s*obtain/i.test(s)) return;
    const norm = (x) => String(x).toLowerCase().replace(/[^a-z0-9]/g, '');
    const ns = norm(s);
    // an item your quests ask for, or a pickup-ish word
    const items = Object.values(questProg.data.chars[String(char || '').toLowerCase()] || {}).flatMap((q) => Object.values(q.items).map((i) => i.name));
    const item = items.find((n) => norm(n).length >= 6 && ns.includes(norm(n).slice(0, Math.min(12, norm(n).length))));
    if (!item && !PICKUP_WORDS.test(s)) return;
    const key = s.replace(/\d+/g, '#').toLowerCase();
    if (pickupCandidates.some((c) => c.key === key)) return;
    // the item's text as it is in the line: inside [ ], or the quest item's name found in it
    const br = /\[([^\]]{3,60})\]/.exec(s);
    const at = item ? s.toLowerCase().indexOf(item.toLowerCase()) : -1;
    const itemText = br ? br[1] : at >= 0 ? s.slice(at, at + item.length) : null;
    pickupCandidates.push({ t, key, line: s, item: item || null, itemText });
    pickupCandidates = pickupCandidates.slice(-40);
    debugCapture('pickup', t, { line: s, item });
    store.writeJson('pickup-candidates.json', pickupCandidates);
  }
  // "this line is a pickup": a pattern with the item's place (and any number as the amount)
  function learnPickup(line, itemText) {
    const s = String(line || '').replace(/\s+/g, ' ').trim(), re = questplan.pickupPattern(s, itemText);
    if (!pickupPatterns.some((p) => p.re === re)) pickupPatterns.push({ re, example: s });
    store.writeJson('pickup-patterns.json', pickupPatterns);
    pickupCandidates = pickupCandidates.filter((c) => c.line !== s);
    store.writeJson('pickup-candidates.json', pickupCandidates);
    return re;
  }
  function onPickupLines(lines, t, char) {
    if (!char || !feat('quests')) return;
    for (const l of lines || []) {
      const p = questplan.parsePickup(l, pickupPatterns);
      if (!p) { notePickupCandidate(l, t, char); continue; }
      readerOk('pickup', t);
      const key = String(l).replace(/\s+/g, ' ').trim();
      if (t - (pickupSeen.get(key) || 0) < 90000) continue;
      pickupSeen.set(key, t);
      const n = questProg.pickup(char, p, activeQuestViews(char), sameItemName);
      if (n) recapEvent(t, char, 'pickup', n);
    }
    if (pickupSeen.size > 200) for (const [k, at] of pickupSeen) if (t - at > 300000) pickupSeen.delete(k);
  }
  // quest items with the kills / minutes still to go at your kill pace (last 15 minutes, while you play that character)
  function questProgView(char) {
    const main = char === state().session.character;
    const kills = main ? ctx.recentKills() : (altKills.get(String(char || '').toLowerCase()) || []).filter((t) => Date.now() - t < 15 * 60000);
    return questProg.view(char, activeQuestViews(char), kills.length >= 3 ? kills.length / 15 : null);
  }
  // the stops of all your quests in one trip, from where you stand (main window or another of yours)
  function questRouteView(char) {
    const qv = activeQuestViews(char), prog = questProgView(char);
    const stops = questplan.questStops(qv, prog);
    const p = charPosition(char);
    const start = p && p.zone != null ? { zone: p.zone, x: p.x, z: p.z } : stops[0] ? { zone: stops[0].zone, x: stops[0].x, z: stops[0].z } : null;
    if (!start) return { stops: [], total: 0, from: null };
    const memo = new Map();
    const cost = (a, b) => {
      const k = `${a.zone}|${Math.round(a.x / 100)}|${Math.round(a.z / 100)}>${b.key}`;
      if (memo.has(k)) return memo.get(k);
      let c = null;
      if (String(a.zone) === String(b.zone)) c = Math.hypot(a.x - b.x, a.z - b.z);
      else { const r = ctx.views().planRoute(a, { zone: b.zone, x: b.x, z: b.z }); c = r?.found ? r.distance + r.hops * 400 : null; }
      memo.set(k, c); return c;
    };
    const r = questplan.orderStops(start, stops, cost);
    return { ...r, stops: r.stops.map((s) => ({ ...s, zoneName: s.zoneName || zoneName(s.zone) })), from: p ? { zone: p.zone, zoneName: zoneName(p.zone) } : null };
  }
  // the next stop of the quest trip (overlay, phone, Discord): worked out again every 30 s at most
  let questNextCache = { at: 0, key: '', v: null };
  function questNext(char) {
    if (!char) return null;
    const p = state().session.position, key = `${char}|${p?.zone}`;
    if (questNextCache.key === key && Date.now() - questNextCache.at < 30000) return questNextCache.v;
    const trip = questRouteView(char), s = trip.stops[0];
    let v = null;
    if (s) {
      const prog = questProgView(char).find((x) => x.id === s.quest);
      const it = s.kind === 'collect' ? prog?.items.find((i) => s.label.startsWith(i.name)) : null;
      v = { kind: s.kind, label: s.label, zoneName: s.zoneName || zoneName(s.zone), quest: s.questName, picked: it?.picked ?? null, need: it?.need ?? null,
        killsLeft: it?.killsLeft ?? null, minutesLeft: it?.minutesLeft ?? null, stops: trip.stops.length };
    }
    questNextCache = { at: Date.now(), key, v };
    return v;
  }
  // the "Available Quest" tab, ranked for your level: EXP, rewards worth something, quests that follow on
  function availableView(char) {
    const a = questsAvailable[String(char || '').toLowerCase()];
    if (!a) return { seenAt: null, quests: [] };
    const lv = playerInfo(char)?.level || null, ix = gameIndex();
    const list = a.ids.map((id) => db().quests.find((q) => q.id === id)).filter(Boolean).map((x) => {
      const q = ctx.views().questView(x, ix), exp = x.rewards.filter((r) => /^exp$/i.test(ix.item.get(r.id)?.name || '') || [909000001, 909100001, 909100002].includes(r.id)).reduce((s, r) => s + r.qty, 0);
      const endNpc = [...x.steps].reverse().find((s) => s.npc)?.npc;
      const followUps = endNpc ? db().quests.filter((o) => o.id !== x.id && o.level >= x.level && o.level <= x.level + 10 && o.steps[0]?.npc === endNpc && !/^\[GM\]/i.test(o.name)).length : 0;
      return { q, exp, followUps };
    });
    return { seenAt: a.t, level: lv, quests: questplan.rankAvailable(list, lv, (id) => chatPrice(id) || 0) };
  }
  // EXP from monsters or quests: a big gain next to an NPC is a quest handed in
  const expSplit = new questplan.ExpSplit();
  function nearNpc(pos) {
    if (!pos || pos.zone == null) return false;
    return (db().npcSpots || []).some((s) => String(s.zone) === String(pos.zone) && Math.hypot(s.x - pos.x, s.z - pos.z) < 250);
  }
  let lastMobTarget = null; // { id, t }: the monster you had targeted, for the kill that follows

  return {
    onQuestWindow, undoAlert, checkHandIn, recapEvent, recapSum, charPosition, altKills, activeQuestViews, questProg, questWatch,
    onPickupLines, learnPickup, questProgView, questRouteView, questNext, availableView, expSplit, nearNpc,
    questLog: () => questLog,
    setMobTarget: (x) => { lastMobTarget = x; }, mobTarget: () => lastMobTarget,
    resetNext: () => { questNextCache.at = 0; },
    pickupCandidates: () => pickupCandidates, pickupPatterns: () => pickupPatterns,
    dismissCandidate(line) { pickupCandidates = pickupCandidates.filter((c) => c.line !== line); store.writeJson('pickup-candidates.json', pickupCandidates); },
    forgetPattern(re) { pickupPatterns = pickupPatterns.filter((p) => p.re !== re); store.writeJson('pickup-patterns.json', pickupPatterns); },
  };
};
