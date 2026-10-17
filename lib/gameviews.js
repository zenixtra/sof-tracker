// Views over the decoded game database (lib/gamedb.js): item search, quests, gear advice, routes, leveling plan,
// item details. Pure functions of the database plus a few things the tracker knows (position, notes), passed in
// through `ctx` so they can be tested without a running tracker.
'use strict';

const { CLASSES, SLOTS } = require('./gamedb');

const TILE = 5120;             // every zone is a 5120 x 5120 tile of the world
const HOP_COST = 400;          // a zone change costs about this much walking (loading, finding the exit)
const GEAR_SLOTS = [3, 5, 1, 2, 4, 6, 7, 8];
const EVENT_RE = /\b(event|gm|temporary|test)\b|\(\d+\s*days?\)|\[event\]|\(c\)|\(b\)/i;
const EXP_IDS = new Set([909000001, 909100001, 909100002]);

/**
 * ctx: {
 *   db(): game database, guide(): CHM guide, zoneMaps(): { zone: { cx, cz } }, zoneName(zone),
 *   trades(): trades log, questsDone(): { character: [quest ids] },
 *   position(): { zone, x, z } | null, character(): name | null, levelOf(name): level | null, isRealZone(zone)
 * }
 */
function createGameViews(ctx) {
  const db = () => ctx.db();
  const zoneName = (z) => ctx.zoneName(z);

  function itemSearch(q) {
    const text = String(q.get('q') || '').trim().toLowerCase();
    const cls = q.get('cls'), slot = q.get('slot');
    const min = +q.get('min') || 0, max = +q.get('max') || 0;
    const sort = q.get('sort') || 'level';
    let list = db().items.filter((it) => (!text || it.name.toLowerCase().includes(text) || String(it.id) === text)
      && (cls == null || cls === '' || String(it.cls) === cls) && (slot == null || slot === '' || String(it.slot) === slot)
      && (!min || it.level >= min) && (!max || it.level <= max));
    const by = { level: (a, b) => a.level - b.level || a.name.localeCompare(b.name), name: (a, b) => a.name.localeCompare(b.name), atk: (a, b) => b.atkMax - a.atkMax, def: (a, b) => b.def - a.def, price: (a, b) => b.price - a.price };
    list = list.slice().sort(by[sort] || by.level);
    return { total: list.length, items: list.slice(0, 300) };
  }

  // a zone's world position: from the waypoint files (zoneMaps), else from its NPCs / portals, else 0
  function zoneCenter(zone) {
    const m = ctx.zoneMaps()[zone];
    if (m) return { cx: m.cx, cz: m.cz };
    const pts = [...db().npcSpots, ...db().portals].filter((p) => String(p.zone) === String(zone));
    if (!pts.length) return { cx: 0, cz: 0 };
    const avg = (k) => pts.reduce((s, p) => s + p[k], 0) / pts.length;
    return { cx: Math.round(avg('x') / TILE) * TILE, cz: Math.round(avg('z') / TILE) * TILE };
  }

  // quest coordinates are minimap pixels: 512 px = the 5120-unit zone tile, y pointing south
  function pxToWorld(zone, px, py) {
    const c = zoneCenter(zone);
    return { x: c.cx + (px - 256) * 10, z: c.cz + (256 - py) * 10 };
  }

  // names for ids, built once per database
  let index = null;
  function gameIndex() {
    const d = db(), g = ctx.guide();
    if (index?.db === d && index.guide === g) return index;
    const item = new Map(d.items.map((i) => [i.id, i]));
    const who = new Map([...d.monsters, ...d.npcs].map((m) => [m.id, m.name]));
    const mob = new Map(d.monsters.map((m) => [m.id, m]));
    // where monsters live, from the quests that send you to collect their drops
    const spots = new Map();
    for (const q of d.quests) for (const s of q.steps) for (const it of s.items) {
      if (!it.mob || !mob.has(it.mob) || !it.zone || (!it.px && !it.py)) continue; // some steps name an NPC to bring things to
      const w = pxToWorld(it.zone, it.px, it.py);
      const list = spots.get(it.mob) || []; spots.set(it.mob, list);
      if (!list.some((p) => p.zone === it.zone && Math.hypot(p.x - w.x, p.z - w.z) < 150)) list.push({ zone: it.zone, x: w.x, z: w.z, drop: item.get(it.id)?.name || null });
    }
    const guideArea = new Map((g?.monsters || []).map((m) => [m.name.toLowerCase(), m.area]));
    index = { db: d, guide: g, item, who, mob, spots, guideArea };
    return index;
  }

  function questView(q, ix) {
    const iname = (id) => ix.item.get(id)?.name || `#${id}`;
    return {
      id: q.id, name: q.name, level: q.level, classes: q.classes, intro: q.intro,
      rewards: q.rewards.map((r) => ({ id: r.id, name: iname(r.id), qty: r.qty })),
      steps: q.steps.map((s) => ({
        npc: s.npc, npcName: ix.who.get(s.npc) || `NPC #${s.npc}`, zone: s.zone, zoneName: s.zone ? zoneName(s.zone) : null,
        ...(s.zone && (s.px || s.py) ? pxToWorld(s.zone, s.px, s.py) : {}), goal: s.goal,
        items: s.items.map((it) => ({
          id: it.id, name: iname(it.id), qty: it.qty, mob: it.mob || null, mobName: it.mob ? ix.who.get(it.mob) || `#${it.mob}` : null,
          zone: it.zone || null, zoneName: it.zone ? zoneName(it.zone) : null, ...(it.zone && (it.px || it.py) ? pxToWorld(it.zone, it.px, it.py) : {}),
        })),
      })),
    };
  }

  function questSearch(q) {
    const ix = gameIndex();
    const lv = +q.get('level') || 0, range = +q.get('range') || 999, cls = q.get('cls'), text = String(q.get('q') || '').trim().toLowerCase();
    const done = new Set(ctx.questsDone()[q.get('character') || ctx.character()] || []);
    const hideDone = q.get('hideDone') === '1';
    let list = db().quests.filter((x) => (!/^\[GM\]/i.test(x.name) || text.includes('gm')) // GM test quests only when searched for
      && (!lv || range >= 999 || Math.abs(x.level - lv) <= range)
      && (!cls || !x.classes.length || x.classes.includes(+cls) || x.classes.includes(0))
      && (!hideDone || !done.has(x.id))
      && (!text || x.name.toLowerCase().includes(text) || x.steps.some((s) => s.items.some((it) => (ix.item.get(it.id)?.name || '').toLowerCase().includes(text)))));
    list = list.slice().sort((a, b) => a.level - b.level || a.id - b.id);
    return { total: list.length, quests: list.slice(0, 250).map((x) => ({ ...questView(x, ix), done: done.has(x.id) })) };
  }

  // best gear per slot for a class and level: weapons by attack, armour by defense, the rest by level then price
  function gearAdvice(q) {
    const cls = +q.get('cls') || 0, level = +q.get('level') || 1, events = q.get('events') === '1', gender = q.get('gender') || '';
    // level 0/1 entries with real stats are special (event / reward / GM) items whose requirement lives elsewhere
    // gender: M / F items only for that gender (robes \"(M)\" / \"(F)\"); others for everyone
    const fits = (it) => (it.cls === 0 || it.cls === cls) && (events || !EVENT_RE.test(it.name)) && (it.level > 1 || level <= 5) && (!gender || !it.gender || it.gender === gender);
    const score = (it) => (it.slot === 3 ? it.atkMax * 2 + it.atkMin : it.def) * 1e6 + it.level * 1e3 + Math.min(999, it.price / 1e6);
    return GEAR_SLOTS.map((slot) => {
      const all = db().items.filter((it) => it.slot === slot && fits(it));
      const now = all.filter((it) => it.level <= level).sort((a, b) => score(b) - score(a));
      const best = now[0];
      const next = all.filter((it) => it.level > level && (!best || score(it) > score(best))).sort((a, b) => a.level - b.level || score(b) - score(a))[0] || null;
      return { slot, best: now.slice(0, 3), next };
    });
  }

  // ---- route planner: the exits between maps (ybmapinfo) form a graph; inside a map you walk in a straight line
  const zoneExits = (zone) => db().portals.filter((p) => String(p.zone) === String(zone));
  // where you arrive in a zone coming from another one: at its exit back, else in the middle
  function arrivalPoint(zone, fromZone) {
    const back = zoneExits(zone).find((p) => String(p.to) === String(fromZone));
    if (back) return { x: back.x, z: back.z };
    const c = zoneCenter(zone); return { x: c.cx, z: c.cz };
  }
  function planRoute(from, target) {
    if (!from?.zone || !target?.zone) return null;
    const key = (z) => String(z), dist = new Map([[key(from.zone), 0]]), prev = new Map(), pos = new Map([[key(from.zone), { x: from.x, z: from.z }]]);
    const todo = [key(from.zone)];
    while (todo.length) {
      todo.sort((a, b) => dist.get(a) - dist.get(b));
      const z = todo.shift(), here = pos.get(z);
      if (z === key(target.zone)) break;
      for (const e of zoneExits(z)) {
        const to = key(e.to), walk = Math.hypot(e.x - here.x, e.z - here.z), d = dist.get(z) + walk + HOP_COST;
        if (!dist.has(to) || d < dist.get(to)) { dist.set(to, d); prev.set(to, { zone: z, exit: e }); pos.set(to, arrivalPoint(to, z)); if (!todo.includes(to)) todo.push(to); }
      }
    }
    if (!dist.has(key(target.zone))) return { found: false };
    const chain = [];
    for (let z = key(target.zone); prev.has(z); z = prev.get(z).zone) chain.unshift(prev.get(z));
    const legs = [];
    let cur = { x: from.x, z: from.z };
    for (const step of chain) {
      const e = step.exit, npc = e.how && e.npc ? gameIndex().who.get(e.npc) : null;
      legs.push({ zone: +step.zone, zoneName: zoneName(step.zone), from: cur, to: { x: e.x, z: e.z }, dist: Math.round(Math.hypot(e.x - cur.x, e.z - cur.z)),
        label: npc ? `${npc} → ${zoneName(e.to)}` : `→ ${zoneName(e.to)}`, via: npc ? 'npc' : 'exit', next: +e.to });
      cur = arrivalPoint(e.to, step.zone);
    }
    if (target.x != null) legs.push({ zone: +target.zone, zoneName: zoneName(target.zone), from: cur, to: { x: target.x, z: target.z }, dist: Math.round(Math.hypot(target.x - cur.x, target.z - cur.z)), label: target.label || zoneName(target.zone), via: 'target' });
    return { found: true, hops: chain.length, distance: legs.reduce((s, l) => s + l.dist, 0), legs };
  }
  // "from" defaults to where you stand; "to" can be a zone (+x/z), an NPC id or a quest step
  function routeRequest(q) {
    const p = ctx.position();
    const from = q.get('fromZone') ? { zone: +q.get('fromZone'), x: +q.get('fx') || 0, z: +q.get('fz') || 0 } : p && ctx.isRealZone(p.zone) ? { zone: p.zone, x: p.x, z: p.z } : null;
    let target = null;
    if (q.get('npc')) {
      const spot = db().npcSpots.find((s) => s.npc === +q.get('npc'));
      if (spot) target = { zone: spot.zone, x: spot.x, z: spot.z, label: spot.name || `NPC #${spot.npc}` };
    } else if (q.get('toZone')) {
      const x = q.get('x'), z = q.get('z');
      target = { zone: +q.get('toZone'), x: x != null && x !== '' ? +x : null, z: z != null && z !== '' ? +z : null, label: q.get('label') || null };
      if (target.x == null) { const c = zoneCenter(target.zone); target.label ||= zoneName(target.zone); if (String(target.zone) === String(from?.zone)) { target.x = c.cx; target.z = c.cz; } }
    }
    if (!from) return { found: false, reason: 'no-position' };
    if (!target) return { found: false, reason: 'no-target' };
    return { from, target, ...planRoute(from, target) };
  }

  // ---- leveling plan: open quests around your level that give EXP, nearby zones first
  function levelingPlan(q) {
    const lv = +q.get('level') || ctx.levelOf(ctx.character()) || 1;
    const cls = +q.get('cls') || 0, who = q.get('character') || ctx.character();
    const done = new Set(ctx.questsDone()[who] || []), ix = gameIndex(), here = ctx.position()?.zone;
    // zone distance in hops from where you are (breadth-first over the exits)
    const hops = new Map();
    if (here) { hops.set(String(here), 0); const queue = [String(here)]; while (queue.length) { const z = queue.shift(); for (const e of zoneExits(z)) if (!hops.has(String(e.to))) { hops.set(String(e.to), hops.get(z) + 1); queue.push(String(e.to)); } } }
    const list = db().quests.filter((x) => !done.has(x.id) && !/^\[GM\]/i.test(x.name) && x.level <= lv + 1 && x.level >= lv - 10
      && (!cls || !x.classes.length || x.classes.includes(cls) || x.classes.includes(0)))
      .map((x) => {
        const exp = x.rewards.filter((r) => EXP_IDS.has(r.id) || /^exp$/i.test(ix.item.get(r.id)?.name || '')).reduce((s, r) => s + r.qty, 0);
        const zone = x.steps.find((s) => s.zone)?.zone || null;
        return { x, exp, zone, hops: zone != null && hops.has(String(zone)) ? hops.get(String(zone)) : 99 };
      })
      .filter((e) => e.exp > 0)
      .sort((a, b) => a.hops - b.hops || b.exp - a.exp)
      .slice(0, 40);
    let total = 0;
    return { level: lv, quests: list.map((e) => ({ ...questView(e.x, ix), exp: e.exp, total: (total += e.exp), hops: e.hops === 99 ? null : e.hops, zoneName: e.zone ? zoneName(e.zone) : null })) };
  }

  // ---- item lookup: everything the game data says about one item
  function itemInfo(q) {
    const ix = gameIndex();
    const it = q.get('id') ? ix.item.get(+q.get('id')) : db().items.find((i) => i.name.toLowerCase() === String(q.get('name') || '').trim().toLowerCase());
    if (!it) return null;
    const rewardOf = [], neededBy = [], dropsFrom = new Map();
    for (const qu of db().quests) {
      if (qu.rewards.some((r) => r.id === it.id)) rewardOf.push({ id: qu.id, name: qu.name, level: qu.level });
      for (const s of qu.steps) for (const need of s.items) if (need.id === it.id) {
        if (!neededBy.some((n) => n.id === qu.id)) neededBy.push({ id: qu.id, name: qu.name, level: qu.level, qty: need.qty });
        if (need.mob && ix.mob.has(need.mob)) {
          const w = need.zone && (need.px || need.py) ? pxToWorld(need.zone, need.px, need.py) : null;
          dropsFrom.set(`${need.mob}|${need.zone}`, { mob: need.mob, name: ix.who.get(need.mob), level: ix.mob.get(need.mob).level, zone: need.zone, zoneName: need.zone ? zoneName(need.zone) : null, ...(w || {}) });
        }
      }
    }
    const traded = ctx.trades().filter((t) => t.item.toLowerCase() === it.name.toLowerCase()).length;
    return { ...it, clsName: CLASSES[it.cls] || null, slotName: SLOTS[it.slot] || null, rewardOf: rewardOf.slice(0, 30), neededBy: neededBy.slice(0, 30), dropsFrom: [...dropsFrom.values()].slice(0, 20), traded };
  }

  return { itemSearch, zoneCenter, pxToWorld, gameIndex, questView, questSearch, gearAdvice, planRoute, routeRequest, levelingPlan, itemInfo, zoneExits };
}

module.exports = { createGameViews, TILE };
