// "Ask the tracker": a question in plain English, answered from your own saved data with simple rules
// (no AI service, nothing leaves the PC). Each rule recognises a kind of question and a time span in it.
'use strict';

const H = 3600000, D = 86400000;
const hm = (ms) => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`; };
const n0 = (v) => Math.round(v).toLocaleString('en-US');
const goldTxt = (v) => { const a = Math.abs(v), s = v < 0 ? '−' : ''; return a >= 1e9 ? `${s}${(a / 1e9).toFixed(1)}b` : a >= 1e6 ? `${s}${(a / 1e6).toFixed(1)}m` : a >= 1e3 ? `${s}${Math.round(a / 1e3)}k` : `${s}${Math.round(a)}`; };
const when = (t) => new Date(t).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const ago = (ms) => (ms < H ? `${Math.max(1, Math.round(ms / 60000))} minutes ago` : ms < 2 * D ? `${Math.round(ms / H)} hours ago` : `${Math.round(ms / D)} days ago`);

// a time span named in the question; `fallback` when it names none
function period(q, now, fallback = 'week') {
  const d0 = new Date(now); d0.setHours(0, 0, 0, 0);
  const day = +d0, mon = day - ((d0.getDay() + 6) % 7) * D;
  const month = new Date(d0.getFullYear(), d0.getMonth(), 1).getTime(), prevMonth = new Date(d0.getFullYear(), d0.getMonth() - 1, 1).getTime();
  let m;
  if (/\btoday\b|\bthis session\b/.test(q)) return { from: day, to: now, label: 'today' };
  if (/\byesterday\b/.test(q)) return { from: day - D, to: day, label: 'yesterday' };
  if (/\blast week\b|\bprevious week\b/.test(q)) return { from: mon - 7 * D, to: mon, label: 'last week' };
  if (/\bthis week\b/.test(q)) return { from: mon, to: now, label: 'this week' };
  if (/\blast month\b|\bprevious month\b/.test(q)) return { from: prevMonth, to: month, label: 'last month' };
  if (/\bthis month\b/.test(q)) return { from: month, to: now, label: 'this month' };
  if ((m = /\b(?:last|past)\s+(\d{1,3})\s+days?\b/.exec(q))) return { from: now - +m[1] * D, to: now, label: `the last ${m[1]} days` };
  if (/\b(ever|all time|in total|overall|so far)\b/.test(q)) return { from: 0, to: now, label: 'all time' };
  return { today: { from: day, to: now, label: 'today' }, week: { from: mon, to: now, label: 'this week' }, all: { from: 0, to: now, label: 'all time' } }[fallback];
}
// a character named in the question (or null); charIn: else the one you play
const namedChar = (q, ctx) => ctx.chars.find((c) => new RegExp(`(^|[^\\w])${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w])`, 'i').test(q)) || null;
const charIn = (q, ctx) => namedChar(q, ctx) || ctx.me;

const RULES = [
  { id: 'gold', test: (q) => /\bgold\b|\bmoney\b|\bprofit\b|\bincome\b/.test(q) && /\b(make|made|earn|earned|gain|gained|get|got|lose|lost|income|profit|much)\b/.test(q) && !/\b(spot|place|where|price)\b/.test(q),
    run(q, ctx, now) {
      const p = period(q, now, 'today'), c = charIn(q, ctx);
      if (!c) return { answer: 'No character is known yet: play once with the screen reader on.' };
      const g = ctx.gold(c, p.from, p.to);
      if (g == null) return { answer: `No gold readings for ${c} ${p.label}. The tracker reads gold when you open your inventory.` };
      const ms = ctx.sessions(p.from, p.to).filter((s) => s.character === c).reduce((a, s) => a + s.ms, 0);
      return { answer: `${c} ${g >= 0 ? 'made' : 'lost'} ${goldTxt(Math.abs(g))} gold ${p.label}${ms > 15 * 60000 ? ` (${goldTxt(g / (ms / H))} per hour played)` : ''}.`, understood: `gold change of ${c}, ${p.label}` };
    } },
  { id: 'price', test: (q) => /\b(price|prices|cost|costs|worth|sells? for|how much (?:is|are|does|do))\b/.test(q),
    run(q, ctx) {
      const name = q.replace(/\b(what(?:'s| is)?|the|usual|chat|current|price|prices|of|for|cost|costs|worth|is|are|how|much|does|do|a|an|sell|sells|selling|at|in|right now|now|\?)\b/g, ' ').replace(/[?!.]/g, ' ').replace(/\s+/g, ' ').trim();
      if (name.length < 3) return { answer: 'Which item? For example: "price of Special Sky Crystal".' };
      const p = ctx.price(name);
      if (!p) return { answer: `I don't know an item called "${name}".` };
      const parts = [p.sell && `usually sold for ${goldTxt(p.sell)}`, p.buy && `bought for ${goldTxt(p.buy)}`].filter(Boolean);
      return { answer: parts.length ? `${p.item}: ${parts.join(', ')} in the chat (${p.offers} offers, 90 days).${p.npc ? ` An NPC pays ${goldTxt(p.npc)}.` : ''}` : `${p.item}: no chat offers seen in 90 days.${p.npc ? ` An NPC pays ${goldTxt(p.npc)}.` : ''}`, understood: `chat price of ${p.item}` };
    } },
  { id: 'killer', test: (q) => /\bwho\b/.test(q) && /\bkill(?:s|ed)?\b/.test(q) && /\bme\b|\bmost\b/.test(q),
    run(q, ctx, now) {
      const p = period(q, now, 'all'), c = namedChar(q, ctx);
      const by = new Map();
      for (const d of ctx.deaths()) if (d.t >= p.from && d.t < p.to && (!c || d.character === c)) { const k = d.killer || (d.target ? `${d.target} (monster you fought)` : null); if (k) by.set(k, (by.get(k) || 0) + 1); }
      const top = [...by].sort((a, b) => b[1] - a[1]);
      if (!top.length) return { answer: `No known killers ${p.label}. The game names a killer in the chat after a death; the screen reader needs the chat box open.` };
      return { answer: `${top[0][0]} killed you most (${top[0][1]}×, ${p.label}).`, lines: top.slice(0, 5).map(([k, n]) => `${k}: ${n}×`), understood: `who killed you, ${p.label}` };
    } },
  { id: 'lastDeath', test: (q) => /\b(last|latest|recent)\b/.test(q) && /\b(die|died|death|dead)\b/.test(q) || /\bwhen did i die\b/.test(q),
    run(q, ctx, now) {
      const toPlayer = /\b(player|pvp|pk)\b/.test(q), c = namedChar(q, ctx);
      const list = ctx.deaths().filter((d) => (!toPlayer || d.killer) && (!c || d.character === c)).sort((a, b) => b.t - a.t);
      const d = list[0];
      if (!d) return { answer: toPlayer ? 'No death to a player is on record.' : 'No deaths on record. Deaths are seen by the screen reader (HP reaching 0).' };
      return { answer: `${d.character ? `${d.character} last died` : 'You last died'}${toPlayer ? ' to a player' : ''} ${ago(now - d.t)} (${when(d.t)}) in ${d.zoneName}${d.killer ? `, killed by ${d.killer}` : d.target ? `, fighting ${d.target}` : ''}.`, understood: toPlayer ? 'your last death to a player' : 'your last death' };
    } },
  { id: 'deaths', test: (q) => /\bhow many\b/.test(q) && /\b(death|deaths|die|died)\b/.test(q),
    run(q, ctx, now) {
      const p = period(q, now, 'week'), list = ctx.deaths().filter((d) => d.t >= p.from && d.t < p.to);
      const toPlayers = list.filter((d) => d.killer).length;
      return { answer: `${list.length} death${list.length === 1 ? '' : 's'} ${p.label}${toPlayers ? `, ${toPlayers} of them to players` : ''}.`, understood: `deaths, ${p.label}` };
    } },
  { id: 'spot', test: (q) => /\b(spot|spots|place|places|where)\b/.test(q) && /\b(best|most|top|good|farm|farming|exp|gold|profit)\b/.test(q),
    run(q, ctx) {
      const byGold = /\b(gold|profit|money)\b/.test(q);
      const spots = ctx.spots().filter((s) => (byGold ? s.profitPerHour != null : s.expPerHour > 0)).sort((a, b) => (byGold ? b.profitPerHour - a.profitPerHour : b.expPerHour - a.expPerHour));
      if (!spots.length) return { answer: 'No farming spots measured yet: farm 5 minutes or more in one place with the screen reader on.' };
      const s = spots[0], line = (x) => `${x.zoneName} (${Math.round(x.x)}, ${Math.round(x.z)}): ${byGold ? `${goldTxt(x.profitPerHour)} gold` : `${x.expPerHour.toFixed(2)}% EXP`} per hour, ${hm(x.minutes * 60000)} measured`;
      return { answer: `Best spot by ${byGold ? 'profit' : 'EXP'}: ${line(s)}.`, lines: spots.slice(1, 5).map(line), understood: `farming spots by ${byGold ? 'profit per hour' : 'EXP per hour'} (all you measured)` };
    } },
  { id: 'monster', test: (q) => /\b(monster|monsters|mob|mobs)\b/.test(q),
    run(q, ctx) {
      const c = charIn(q, ctx), mobs = c ? ctx.mobs(c).filter((m) => m.expPerHour) : [];
      if (!mobs.length) return { answer: 'No monster stats yet: fight with a monster targeted and the chat box open.' };
      const line = (m) => `${m.name}: ${n0(m.expPerHour)} EXP per hour, ${n0(m.expPerKill)} per kill${m.secPerKill ? `, ${m.secPerKill} s per kill` : ''}`;
      return { answer: `${c}'s best monster: ${line(mobs[0])}.`, lines: mobs.slice(1, 5).map(line), understood: `your monsters by EXP per hour (${c})` };
    } },
  { id: 'levelUp', test: (q) => /\blevel(?:\s|-)?up\b|\bnext level\b|\bwhen (?:will|do|can) i (?:reach|hit|get)\b.*\blevel\b/.test(q),
    run(q, ctx, now) {
      const f = ctx.forecast(), who = f?.character || ctx.me || 'You';
      if (!f || f.exp == null) return { answer: 'Your EXP is not known yet: play with the screen reader on.' };
      if (!f.perHour) return { answer: `${who}: ${f.exp.toFixed(2)}% EXP. Not enough play measured yet to say when the next level comes.` };
      return { answer: `${who} at ${f.exp.toFixed(2)}%: about ${hm(f.playHoursLeft * H)} more play at ${f.perHour.toFixed(2)}% per hour${f.etaAt ? `, around ${when(f.etaAt)} at your usual ${f.hoursPerDay ? `${f.hoursPerDay.toFixed(1)}h a day` : 'pace'}` : ''}.`, understood: 'time to the next level' };
    } },
  { id: 'next', test: (q) => /\b(next|when|upcoming|coming)\b/.test(q) && /\b(boss|bosses|event|events|maintenance|reset|war)\b/.test(q),
    run(q, ctx, now) {
      const kind = /\bboss/.test(q) ? 'boss' : /\bmaintenance\b/.test(q) ? 'maintenance' : /\breset\b/.test(q) ? 'checklist' : 'event';
      const items = ctx.plan(now).filter((x) => x.t > now - 60000 && (x.kind === kind || (kind === 'event' && x.kind === 'custom')));
      if (!items.length) return { answer: `Nothing of that kind in the next 24 hours that the tracker knows of.` };
      const line = (x) => `${x.title}: ${when(x.t)} (in ${hm(x.t - now)})`;
      return { answer: `Next: ${line(items[0])}.`, lines: items.slice(1, 5).map(line), understood: `the next ${kind === 'checklist' ? 'reset' : kind} (24-hour plan)` };
    } },
  { id: 'seen', test: (q) => /\b(see|saw|seen|meet|met|last seen)\b/.test(q) && /\b(last|when)\b/.test(q),
    run(q, ctx, now) {
      const m = /\b(?:see|saw|seen|meet|met)\s+([A-Za-z0-9_]{2,20})/i.exec(q);
      if (!m || /^(him|her|them|it|me)$/i.test(m[1])) return { answer: 'Who? For example: "when did I last see Zekez?"' };
      const s = ctx.lastSeen(m[1]);
      if (!s) return { answer: `${m[1]} is not in your sessions.` };
      return { answer: `${s.name} was last near you ${ago(now - s.t)} (${when(s.t)})${s.zoneName ? ` in ${s.zoneName}` : ''}${s.sessions > 1 ? `; met in ${s.sessions} sessions` : ''}.`, understood: `when you last saw ${s.name}` };
    } },
  { id: 'craft', test: (q) => /\b(enchant|enchanting|enchantment|combine|combining|combination|enhance|enhancing)\b/.test(q),
    run(q, ctx, now) {
      const p = period(q, now, 'all'), c = charIn(q, ctx), r = ctx.craft(c, p.from, p.to);
      const lines = Object.entries(r).filter(([, v]) => v.n).map(([k, v]) => `${k}: ${v.ok} of ${v.n} worked (${Math.round((v.ok / v.n) * 100)}%)`);
      if (!lines.length) return { answer: `No enchanting, combining or enhancing on record ${p.label}.` };
      return { answer: lines[0] + (lines.length > 1 ? '.' : `, ${p.label}.`), lines: lines.slice(1), understood: `your success rates, ${p.label}` };
    } },
  { id: 'quests', test: (q) => /\bquests?\b/.test(q) && /\bhow many\b|\bdone\b|\bfinished\b|\bcompleted\b/.test(q),
    run(q, ctx, now) {
      const p = period(q, now, 'week'), c = charIn(q, ctx);
      const n = c ? ctx.quests(c, p.from, p.to) : 0;
      return { answer: `${c || 'You'} handed in ${n} quest${n === 1 ? '' : 's'} ${p.label}.`, understood: `quests handed in, ${p.label}` };
    } },
  { id: 'kills', test: (q) => /\bkills?\b|\bhow much exp\b|\bexp did\b|\bexp (?:have|did) i\b|\bexp gained\b|\bhow many levels\b/.test(q),
    run(q, ctx, now) {
      const p = period(q, now, 'today'), ss = ctx.sessions(p.from, p.to);
      const sum = (k) => ss.reduce((a, s) => a + (s.screen?.[k] || 0), 0);
      if (!sum('exp') && !sum('kills')) return { answer: `No EXP or kills seen ${p.label}. They need the screen reader.` };
      return { answer: `${p.label[0].toUpperCase()}${p.label.slice(1)}: +${sum('exp').toFixed(1)}% EXP, ${n0(sum('kills'))} kills${sum('levels') ? `, ${sum('levels')} level-ups` : ''} in ${ss.length} session${ss.length === 1 ? '' : 's'}.`, understood: `EXP and kills, ${p.label}` };
    } },
  { id: 'play', test: (q) => /\bplay(?:ed|ing)?\b|\bplay ?time\b|\bhours\b|\bhow long\b/.test(q),
    run(q, ctx, now) {
      const p = period(q, now, 'week'), ms = ctx.playMs(p.from, p.to);
      const by = {}; for (const s of ctx.sessions(p.from, p.to)) if (s.character) by[s.character] = (by[s.character] || 0) + s.ms;
      const top = Object.entries(by).sort((a, b) => b[1] - a[1]);
      return { answer: `You played ${hm(ms)} ${p.label}.`, lines: top.slice(0, 6).map(([c, m]) => `${c}: ${hm(m)} tracked`), understood: `play time, ${p.label} (all accounts, from the game's login log)` };
    } },
  { id: 'level', test: (q) => /\bwhat level\b|\bmy level\b|\blevel am i\b/.test(q),
    run(q, ctx) {
      const c = charIn(q, ctx), l = c ? ctx.level(c) : null;
      return { answer: l?.level ? `${c} is level ${l.level}${l.cls ? ` (${l.cls})` : ''}, from the rankings.` : `The level of ${c || 'your character'} is not known (not in the rankings yet).`, understood: 'your level' };
    } },
];

function answer(question, ctx, now = Date.now()) {
  const q = ` ${String(question || '').toLowerCase().replace(/[’']/g, "'").trim()} `;
  if (q.trim().length < 3) return { answer: 'Ask something about your play, for example "how long did I play this week?"' };
  for (const r of RULES) {
    if (!r.test(q)) continue;
    try { return { rule: r.id, ...r.run(q, ctx, now) }; } catch (e) { return { rule: r.id, answer: `That one went wrong: ${e.message}` }; }
  }
  return { answer: "I don't know how to answer that yet. I can tell you about play time, EXP and kills, gold, deaths and killers, farming spots, your monsters, the next level, bosses and events, players you met, prices and enchant luck." };
}

module.exports = { answer, period, RULES };
