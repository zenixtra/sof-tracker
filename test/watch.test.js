'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { similar, chatMessages, ChatLog, chatAlert, AwayWatch, PartyWatch, priceHit, ScreenSession, dealOf, traderProfile, Timeline, levelForecast,
  priceHistory, marketMovers, chatWordHit, readingPace } = require('../lib/watch');

test('effect icons: names, start, and an end only after two looks without the icon', () => {
  const { EffectWatch, effectInfo } = require('../lib/watch');
  assert.deepStrictEqual(effectInfo('deburp_stun_mini'), { id: 'deburp_stun', label: 'Stunned', kind: 'debuff' });
  assert.deepStrictEqual(effectInfo('1000000839_mini', (id) => (id === 1000000839 ? 'Strong Elixir' : null)), { id: '1000000839', label: 'Strong Elixir', kind: 'buff' });
  const w = new EffectWatch();
  assert.deepStrictEqual(w.frame({ t: 0, effects: 'poison_mini@86,70;buff_defense_increase_mini@108,70' }).started.map((x) => x.label), ['Poisoned', 'Defense up']);
  assert.deepStrictEqual(w.frame({ t: 2000, effects: 'buff_defense_increase_mini@108,70' }).ended, []); // one look without: maybe covered
  const r = w.frame({ t: 4000, effects: 'buff_defense_increase_mini@108,70' });
  assert.deepStrictEqual(r.ended.map((x) => [x.label, x.ms]), [['Poisoned', 0]]);
  assert.deepStrictEqual(r.active.map((x) => [x.label, x.since]), [['Defense up', 0]]);
  // buffs from the right-edge column: item / skill icons, named by the icon index
  const b = new EffectWatch(null, (k) => ({ '2:501303': 'Divine Protection' }[k] || null));
  assert.deepStrictEqual(b.frame({ t: 0, buffs: '2:501303@1228,524;1:5@1228,561' }).started.map((x) => [x.id, x.label, x.kind]), [['icon:2:501303', 'Divine Protection', 'buff'], ['icon:1:5', 'Buff', 'buff']]);
});

test('minimap: dots by direction, and a crowd arriving while you are AFK', () => {
  const { minimapView, MinimapWatch } = require('../lib/watch');
  const v = minimapView('40,0;41,2;0,-30;-5,5', '13,37', '81,61,220');
  assert.deepStrictEqual([v.count, v.near, v.mostly, v.by.north], [4, 1, 'east', 1]);
  assert.deepStrictEqual([v.party, v.facing], [[[13, 37]], 220]);
  assert.strictEqual(minimapView('', '', '').facing, null);
  const m = new MinimapWatch();
  const dots = (n) => Array.from({ length: n }, (_, i) => `${10 + i},0`).join(';');
  assert.strictEqual(m.frame({ t: 0, minimap: dots(2) }, { surge: 5, watching: true }).alert, null);
  assert.match(m.frame({ t: 20000, minimap: dots(8) }, { surge: 5, watching: true }).alert.title, /^6 more players on your minimap$/);
  assert.strictEqual(m.frame({ t: 40000, minimap: dots(14) }, { surge: 5, watching: true }).alert, null); // once per 5 minutes
  assert.strictEqual(new MinimapWatch().frame({ t: 0, minimap: dots(9) }, { surge: 5, watching: false }).alert, null);
});

test('price history: per day the usual selling and buying price', () => {
  const day = 86400000, now = 10 * day;
  const offers = [[1, 'sell', 100], [1, 'sell', 120], [1, 'buy', 80], [3, 'sell', 90], [3, 'sell', 1e3, 2]].map(([d, side, p, id = 1]) => ({ t: d * day + 1000, itemId: id, side, price: p }));
  assert.deepStrictEqual(priceHistory(offers, 1, { now }).map((x) => [x.day, x.sell, x.buy, x.offers]), [['1970-01-02', 110, 80, 3], ['1970-01-04', 90, null, 1]]);
});

test('price movers: this week against last week, enough offers only', () => {
  const W = 7 * 86400000, ws = 10 * W;
  const o = (week, id, price) => ({ t: ws + week * W + 1000, itemId: id, item: `I${id}`, side: 'sell', price });
  const offers = [...[100, 100, 100].map((p) => o(-1, 1, p)), ...[150, 150, 150].map((p) => o(0, 1, p)), ...[50, 50].map((p) => o(-1, 2, p)), ...[10, 10, 10].map((p) => o(0, 2, p))];
  assert.deepStrictEqual(marketMovers(offers, ws).map((m) => [m.item, m.change]), [['I1', 50]]);
});

test('chat words: phrases anywhere, short words only as whole words', () => {
  assert.strictEqual(chatWordHit({ text: 'LFM boss run, need healer' }, ['lf party', 'LFM']), 'LFM');
  assert.strictEqual(chatWordHit({ text: 'selfish' }, ['lf']), null);
  assert.strictEqual(chatWordHit({ text: 'any1 LF party?' }, ['lf party']), 'lf party');
  assert.strictEqual(chatWordHit({ text: 'WTB Special Sky Crystal' }, ['special sky']), 'special sky');
});

test('reading pace: quick while fighting, slow while AFK', () => {
  const now = 1e9;
  assert.deepStrictEqual(readingPace({ base: 2, kills: [now - 30000], now }), { interval: 2, why: 'busy' });
  assert.deepStrictEqual(readingPace({ base: 2, hpPct: 60, now }), { interval: 2, why: 'busy' });
  assert.deepStrictEqual(readingPace({ base: 2, afk: true, now }), { interval: 10, why: 'quiet' });
  assert.deepStrictEqual(readingPace({ base: 2, now }), { interval: 4, why: 'normal' });
  assert.deepStrictEqual(readingPace({ base: 10, now }), { interval: 10, why: 'normal' });
});

// one look at the live game: a garbled colour pass and a clean brightness pass of the same chat
const look = (t, extra = {}) => ({
  t,
  chat: ['House Party Whisp', 'Norm', 'Oley; 5E4 Eend nF: ty', '1.1VdII; Huy MSC 2] 8 Eend nF: ty',
    'Info Ally', 'Oley: B DD 5B send me ty', 'Wdll: Buy MSC 21B send me ty', 'Ponkotsu: SELL ROBE HBK 110 DEF7+8 8B O', 'NLY MIDCV FAST'],
  chatCol: ['#f6f6f6', '#f4f4f4', '#c6c6c6', '#c6c6c6', '#f4f4f4', '#c0c0c0', '#c0c0c0', '#c0c0c0', '#c1c1c1'],
  chatPass: [4, 5], ...extra,
});

test('chat lines → messages: tab bar left out, wrapped lines joined, passes kept apart', () => {
  const m = chatMessages(look(0));
  assert.deepStrictEqual(m.map((x) => x.who), ['Oley', '1.1VdII', 'Oley', 'Wdll', 'Ponkotsu']);
  assert.strictEqual(m[4].text, 'SELL ROBE HBK 110 DEF7+8 8B O NLY MIDCV FAST');
  assert.deepStrictEqual(m.map((x) => x.clean), [false, false, true, true, true]);
});

test('the chat log keeps each message once, also when read again and again', () => {
  const log = new ChatLog();
  const a = log.add(look(1000));
  assert.deepStrictEqual(a.map((e) => e.who), ['Oley', 'Wdll', 'Ponkotsu']); // garbled readings start nothing
  assert.strictEqual(log.add(look(3000)).length, 0);
  assert.strictEqual(log.entries.length, 3);
  assert.strictEqual(log.entries[0].last, 3000);
  assert.ok(similar('Wdll: Buy MSC 21B send me ty', '1.1VdII; Huy MSC 2] 8 Eend nF: ty') < 0.58);
  assert.deepStrictEqual(log.search({ q: 'msc' }).map((e) => e.who), ['Wdll']);
  assert.deepStrictEqual(log.search({ who: 'oley' }).map((e) => e.text), ['B DD 5B send me ty']);
});

test('with line positions: the best reading per chat row, and look-alike offers kept apart', () => {
  // the live game: pass 1 garbles grey chat, pass 2 reads it; the same seller posts two offers in the same pattern
  const f = (t, y0 = 100) => ({ t,
    chat: ['IVdil: Huy dragon 608 ty', 'Oley; B pro 4E4 Eend nF: ty', 'Oley: B DD 5B Eend me ty', 'Wdll: Buy dragon 60B ty', 'Oley: B pro 4B send me ty', 'Oley: B DD 5B send me ty'],
    chatCol: Array(6).fill('#c0c0c0'), chatY: [y0, y0 + 20, y0 + 40, y0 + 1, y0 + 21, y0 + 40], chatPass: [3, 3] });
  assert.deepStrictEqual(chatMessages(f(0)).map((m) => `${m.who}: ${m.text}`), ['Wdll: Buy dragon 60B ty', 'Oley: B pro 4B send me ty', 'Oley: B DD 5B send me ty']);
  const log = new ChatLog();
  log.add(f(0)); log.add(f(2000, 80)); // the chat scrolled up a line
  assert.deepStrictEqual(log.entries.map((e) => e.text), ['Buy dragon 60B ty', 'B pro 4B send me ty', 'B DD 5B send me ty']);
});

test('whispers, mentions and chosen chat colours are alerts; your own lines are not', () => {
  const cfg = { me: 'ibuhexal', whispers: true, mentions: true, colors: [{ col: '#40ff40', label: 'House' }] };
  assert.deepStrictEqual(chatAlert({ who: 'From', text: '[Oley]: still selling DD?', col: '#c0c0c0' }, cfg), { kind: 'whisper', title: 'Whisper from Oley' });
  assert.deepStrictEqual(chatAlert({ who: 'Oley', text: 'hi', col: '#ff60ff' }, cfg), { kind: 'whisper', title: 'Whisper from Oley' });
  assert.deepStrictEqual(chatAlert({ who: 'Wdll', text: 'party up?', col: '#44f844' }, cfg), { kind: 'whisper', title: 'House: Wdll' });
  assert.deepStrictEqual(chatAlert({ who: 'Wdll', text: 'ibuhexal come here', col: '#c0c0c0' }, cfg), { kind: 'whisper', title: 'Wdll mentioned you' });
  assert.strictEqual(chatAlert({ who: 'ibuhexal', text: 'from me', col: '#ff60ff' }, cfg), null);
  assert.strictEqual(chatAlert({ who: 'Wdll', text: 'Buy MSC', col: '#c0c0c0' }, cfg), null);
  assert.strictEqual(chatAlert({ who: 'Oley', text: 'hi', col: '#ff60ff' }, { ...cfg, whispers: false }), null);
});

test('away watch: HUD gone for 2 min, a disconnect box, EXP stopped while farming', () => {
  const w = new AwayWatch(), cfg = { hud: true, stuckMinutes: 10 }, m = 60000;
  assert.deepStrictEqual(w.frame({ t: 0 }, { hud: true, cfg }), []);
  assert.deepStrictEqual(w.frame({ t: 1.5 * m }, { hud: false, cfg }), []);
  assert.strictEqual(w.frame({ t: 2 * m }, { hud: false, cfg })[0].title, 'Your character is not in the game');
  assert.deepStrictEqual(w.frame({ t: 3 * m }, { hud: false, cfg }), []); // once
  const dc = new AwayWatch();
  assert.strictEqual(dc.frame({ t: 0, center: ['You have been disconnected', 'from the server.'] }, { hud: false, cfg })[0].kind, 'disconnect');
  // as read from the live game: the notice box over a HUD that is still there, with world text around it
  const live = new AwayWatch().frame({ t: 0, center: ['v yugyug.', "'IHp:", 'Birthday', 'Natice', 'You have been disconnected', 'from the server.', 'Exiting the Scions of Fate.', '{1150,1979}', 'Ok'] }, { hud: true, cfg });
  assert.deepStrictEqual(live.map((a) => a.body), ['You have been disconnected from the server. Exiting the Scions of Fate.']);
  // farming: kills every minute, then the bar stands still
  const s = new AwayWatch();
  for (let i = 0; i < 5; i++) s.frame({ t: i * m, exp: 10 + i }, { hud: true, kill: i > 0, cfg });
  assert.deepStrictEqual(s.frame({ t: 13 * m, exp: 14 }, { hud: true, cfg }), []);
  assert.strictEqual(s.frame({ t: 14 * m, exp: 14 }, { hud: true, cfg })[0].title, 'No EXP for 10 min');
  assert.deepStrictEqual(s.frame({ t: 15 * m, exp: 14 }, { hud: true, cfg }), []);
  // not farming (no kills): no alert
  const idle = new AwayWatch();
  idle.frame({ t: 0, exp: 50 }, { hud: true, cfg });
  assert.deepStrictEqual(idle.frame({ t: 30 * m, exp: 50 }, { hud: true, cfg }), []);
});

test('party watch: low HP and deaths, once a minute per member', () => {
  const p = new PartyWatch();
  const f = (t, party) => p.frame({ t, party }, { below: 30 });
  assert.deepStrictEqual(f(0, [{ name: 'Oley', hp: 80 }, { name: '..', hp: 25 }]).map((a) => a.title), ['Party member 2: HP 25%']);
  assert.deepStrictEqual(f(30000, [{ name: 'Oley', hp: 0 }, { name: '..', hp: 20 }]).map((a) => a.title), ['Oley died']);
  assert.deepStrictEqual(f(70000, [{ name: 'Oley', hp: 0 }, { name: '..', hp: 20 }]).map((a) => a.title), ['Party member 2: HP 20%']);
});

test('price watches: cheap enough sellers, high enough buyers', () => {
  const w = [{ itemId: 1, side: 'sell', price: 150e6 }, { itemId: 2, side: 'buy', price: 5e9 }];
  assert.ok(priceHit({ itemId: 1, side: 'sell', price: 120e6 }, w));
  assert.strictEqual(priceHit({ itemId: 1, side: 'sell', price: 160e6 }, w), null);
  assert.strictEqual(priceHit({ itemId: 1, side: 'buy', price: 100e6 }, w), null);
  assert.ok(priceHit({ itemId: 2, side: 'buy', price: 6e9 }, w));
  assert.strictEqual(priceHit({ itemId: 2, side: 'buy', price: null }, w), null);
});

test('deals: well under the usual price for sellers, over it for buyers; typos are no deals', () => {
  const now = 1e12, h = 3600000;
  const past = [100, 110, 120, 130].map((p, i) => ({ t: now - (i + 1) * h, itemId: 1, side: 'sell', price: p * 1e6 }));
  const offer = (side, price) => ({ t: now, itemId: 1, side, price });
  assert.deepStrictEqual(dealOf(offer('sell', 70e6), past, 30), { pct: 39, usual: 115e6 });
  assert.strictEqual(dealOf(offer('sell', 100e6), past, 30), null);   // only 13 % under
  assert.strictEqual(dealOf(offer('sell', 1e6), past, 30), null);     // 100x under: a misread
  assert.strictEqual(dealOf(offer('sell', 70e6), past.slice(0, 2), 30), null); // too few offers to know
  const buys = past.map((o) => ({ ...o, side: 'buy' }));
  assert.strictEqual(dealOf(offer('buy', 160e6), buys, 30).pct, 39);
  assert.strictEqual(dealOf(offer('sell', 70e6), past, 0), null);     // switched off
});

test('trader profile: what someone buys and sells, at what price', () => {
  const offers = [{ t: 1, who: 'Oley', side: 'buy', itemId: 5, item: 'DD', price: 5e9, raw: 'B DD 5B' }, { t: 2, who: 'oley', side: 'buy', itemId: 5, item: 'DD', price: 6e9, raw: 'B DD 6B' },
    { t: 3, who: 'Oley', side: 'sell', itemId: null, item: null, price: null, raw: 'S pro' }, { t: 4, who: 'Wdll', side: 'buy', itemId: 5, item: 'DD', price: 1, raw: 'x' }];
  const p = traderProfile('Oley', offers, [{ t: 5, who: 'Oley', text: 'hi' }]);
  assert.strictEqual(p.offers, 3); assert.strictEqual(p.messages, 1); assert.deepStrictEqual([p.first, p.last], [1, 5]);
  assert.deepStrictEqual(p.items.map((x) => [x.side, x.item, x.count, x.price]), [['buy', 'DD', 2, 5.5e9], ['sell', null, 1, null]]);
});

test('timeline: one sample per 10 s, events kept', () => {
  const tl = new Timeline('k');
  for (let i = 0; i < 10; i++) tl.frame({ t: i * 3000, exp: 50 + i / 10 }, { hpPct: 100 - i, mpPct: 90 });
  assert.deepStrictEqual(tl.samples.map((s) => s[0]), [0, 12000, 24000]);
  tl.event(5000, 'kill'); tl.event(6000, 'whisper', 'Oley: hi');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(tl)).events, [[5000, 'kill', ''], [6000, 'whisper', 'Oley: hi']]);
  assert.deepStrictEqual(new Timeline('k', JSON.parse(JSON.stringify(tl))).samples.length, 3);
});

test('level forecast: EXP per played hour and hours played per day', () => {
  const day = 86400000, now = 10 * day;
  const s = (d, h, exp) => ({ startedAt: now - d * day, endedAt: now - d * day + h * 3600000, screen: { exp } });
  const f = levelForecast({ exp: 70, sessions: [s(1, 2, 10), s(2, 2, 10), s(3, 3, 0)], levels: [{ t: 1 }, { t: 1 + 3 * day }], now });
  assert.strictEqual(f.perHour, 5);                 // 20 % in 4 screen-read hours
  assert.ok(Math.abs(f.hoursPerDay - 1) < 1e-9);   // 7 hours in 7 days
  assert.strictEqual(f.playHoursLeft, 6);           // 30 % left
  assert.ok(Math.abs(f.etaMs - 6 * day) < 1);
  assert.deepStrictEqual(f.levels.map((l) => l.ms), [3 * day]);
  assert.strictEqual(levelForecast({ exp: 70, sessions: [], now }).etaMs, null);
});

test('screen totals per session: EXP across a level-up, kills, deaths, best zone', () => {
  const s = new ScreenSession('k');
  [[98, 101], [99.5, 101], [1.5, 101], [2, 102], [60, 102], [2.5, 102]].forEach(([exp, zone], i) => s.frame({ t: i, exp }, { kill: i > 0, died: i === 5, zone }));
  assert.deepStrictEqual(s.view(), { exp: 4.5, kills: 5, deaths: 1, drops: 0, levels: 1, bestZone: 101 });
  // the tracker restarted mid-session: it carries on from the saved totals
  const again = new ScreenSession('k', s.view());
  again.frame({ t: 9, exp: 3 }, { kill: true, zone: 102 }); again.frame({ t: 10, exp: 3.5 }, { kill: true, zone: 102 });
  assert.deepStrictEqual(again.view(), { exp: 5, kills: 7, deaths: 1, drops: 0, levels: 1, bestZone: 101 });
});
