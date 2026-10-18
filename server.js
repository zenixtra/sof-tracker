// Scions of Fate live stats tracker.
// Reads only the log files and data files the game client writes to disk, plus the official
// public rankings. It never touches the game process (XIGNCODE blocks that).
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFile, spawn } = require('child_process');

// optional settings in a .env file next to this one (see .env.example); real environment variables win
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch { /* no .env: the defaults */ }

const store = require('./lib/store');
const { Rankings, RANKING_TABS } = require('./lib/rankings');
const { timerTemplates, zoneNames, KNOWN_ZONES, loadMessages } = require('./lib/gamedata');
const { workbook } = require('./lib/xlsx');
const { allPathPoints } = require('./lib/pathpoints');
const { loadGuide, IMG_DIR: GUIDE_IMG_DIR } = require('./lib/guide');
const { News } = require('./lib/news');
const { zip } = require('./lib/zip');
const { Notifier } = require('./lib/notify');
const { Bosses, bossName } = require('./lib/bosses');
const stats = require('./lib/stats');
const { Friends, safeName, mergeOffers } = require('./lib/friends');
const version = require('./lib/version');
const { Updater } = require('./lib/updater');
const i18n = require('./lib/i18n');
const { PatchWatcher } = require('./lib/patchwatch');
const { loadGameDb, CLASSES, SLOTS } = require('./lib/gamedb');
const terrain = require('./lib/terrain');
const { createGameViews } = require('./lib/gameviews');
const { runSelfCheck } = require('./lib/selfcheck');
const social = require('./lib/social');
const { Checklist, icsCalendar } = require('./lib/planner');
const screenreader = require('./lib/screenreader');
const watch = require('./lib/watch');
const setup = require('./lib/setup');
const extras = require('./lib/extras');
const { buildIconIndex, iconName } = require('./lib/iconindex');
const { DiscordBot, buttons: discordButtons } = require('./lib/discordbot');
const market = require('./lib/market');
const { Farming } = require('./lib/farming');
const { ddsToPng } = require('./lib/dds');
const guideplan = require('./lib/guideplan');
const plans = require('./lib/plans');
const gear = require('./lib/gear');
const inv = require('./lib/inventory');
const questwin = require('./lib/questwin');
const statuswin = require('./lib/statuswin');
const expchat = require('./lib/expchat');
const sysmsg = require('./lib/sysmsg');
const { MobStats } = require('./lib/mobstats');
const { BreakWatch } = require('./lib/breaks');
const ask = require('./lib/ask');
const { GamePerf, parseTasklist } = require('./lib/gameperf');
const { reportPage } = require('./lib/reportpage');
const gamecfg = require('./lib/gamecfg');
const guard = require('./lib/guard');
const { guideLinkGroups } = require('./lib/guidelinks');
const questplan = require('./lib/questplan');
const ledger = require('./lib/ledger');
const KR_GUIDE = require('./public/krguide.js');

const VERSION = require('./package.json').version;
// game folder: environment variable, then data/config.json (written by the installer), then the default install path
const CONFIG = store.readJson('config.json', {});
const CLIENT_DIR = process.env.SOF_CLIENT_DIR || CONFIG.clientDir || 'C:\\NetGame\\ScionsOfFate\\Client';
const GAME_DIR = path.dirname(CLIENT_DIR);
const LAUNCHER = process.env.SOF_LAUNCHER || path.join(GAME_DIR, 'launcher.exe');
const PORT = Number(process.env.PORT) || 7777;
const HOST = process.env.SOF_HOST || '127.0.0.1'; // start-phone.bat sets 0.0.0.0 for LAN access
const PUBLIC_DIR = path.join(__dirname, 'public');
// The official server announces its times in US Pacific time (PDT/PST in maintenance notices).
const SERVER_TZ = process.env.SOF_SERVER_TZ || 'America/Los_Angeles';

const decoder = new TextDecoder('euc-kr'); // client logs are CP949/EUC-KR
const TELEPORT_THRESHOLD = 150; // jumps bigger than this between samples are not counted as walking
// The client logs a player when they come into view, not continuously (seen live: 2 lines in 25 s
// with players standing around), so "nearby" has to stay true for a while after the last sighting.
const NEARBY_WINDOW_MS = 90000;
const REENCOUNTER_MS = 5 * 60000; // a player gone this long counts as a new encounter / watch alert
const MAX_TRAIL = 3000;
const MAX_NOTICES = 100;
const MAX_ALERTS = 200;
const HEAT_CELL = 16; // world units per heatmap cell
const BUFF_REMIND_MIN_MS = 5 * 60000; // only remind for buffs at least this long
const BUFF_REMIND_BEFORE_MS = 60000;
const TIMER_WARN_BEFORE_MS = 60000;
const RANKING_REFRESH_MS = 30 * 60000;

store.migrate('labels.json');
store.migrate('players.json');

// ---------------------------------------------------------------- persistent data

let labels = store.readJson('labels.json', { zones: {}, buffs: {} });
let playerNotes = store.readJson('players.json', {}); // lowercased name -> { name, level, cls, faction, house, note, updatedAt }
let watchlist = store.readJson('watchlist.json', []); // [name]
const sessions = store.readJson('sessions.json', {}); // key -> session record
const heatmap = store.readJson('heatmap.json', {}); // zone -> { "cx,cz": seconds }
const alerts = store.readJson('alerts.json', []); // newest last
let alertSeq = alerts.reduce((m, a) => Math.max(m, a.id), 0);
let screenSession = new watch.ScreenSession(); // screen reader totals for the session being played (see sessionRecord)

const DEFAULT_SETTINGS = {
  afkMinutes: 3,        // no movement / skill use / map change for this long counts as AFK
  goalHours: 0,         // daily play-time goal (0 = off)
  limitHours: 0,        // daily play-time limit (0 = off)
  remindEveryHours: 1,  // "you've played Xh today" every N hours (0 = off)
  breakMinutes: 120,    // "take a break" after this many minutes of play in a row, then every 30 minutes (0 = off)
  breakPauseMinutes: 10, // AFK or the game closed this long counts as a break
  autoOverlay: false,   // open the overlay when the game starts, close it when the game exits
  dangerCount: 3,       // alert when this many enemy-faction players arrive near you...
  dangerWindowSec: 30,  // ...within this many seconds
  dangerUnknown: false, // also count players whose faction is unknown
  myFaction: '',        // '' = take it from your character's notes / the rankings
  myHouse: '',          // your house (guild) for the House tab
  backupDir: '',        // automatic daily backup folder ('' = off)
  backupKeep: 14,       // how many daily backups to keep there
  syncDir: '',          // shared folder for friends sync ('' = off)
  syncName: '',         // your name in the shared folder
  lang: '',             // interface language shared with the overlay and tray ('' = follow Windows)
  voice: 'off',         // voice alerts in the overlay: off | important | all
  shareLive: true,      // friends sync: share your live zone / position / in-game status (party view)
  screenReader: false,  // read HP / MP / EXP and loot announcements from the game window (screenreader.ps1)
  screenInterval: 3,    // seconds between looks
  lowHpAlert: 0,        // alert below this HP % (0 = off; needs the screen reader)
  // what the screen reader tells you about while you're away
  whisperAlert: true,   // whispers (and lines in the chat colours you picked)
  mentionAlert: true,   // someone writes your character's name in the chat
  hudAlert: true,       // logged out / disconnected (the HUD is gone, a disconnect box)
  stuckMinutes: 10,     // EXP stopped this many minutes while you were farming (0 = off)
  partyHpAlert: 0,      // a party member's HP below this % (0 = off)
  deathReplay: true,    // keep the last looks before each death
  dropShots: 'mine',    // a picture of announced drops: off | mine (you, your party, friends) | all
  chatLog: true,        // keep the chat the screen reader sees (Trades tab)
  chatColors: [],       // [{ col: '#rrggbb', label }] chat colours to be alerted about
  screenReaderAlts: true, // also read your other game windows
  dealAlert: 30,        // alert for chat offers this % better than the usual price (0 = off)
  peekLan: false,       // show the game screen to other devices (phone) too, not only on this PC
  adaptivePace: true,   // look quickly while fighting, slowly while AFK
  chatWords: [],        // words / phrases in the chat to be alerted about ("LF party", an item…)
  watchOnline: true,    // alert when a watched player writes in the chat (they're online)
  digestHour: 22,       // the daily digest (phone / Discord) at this hour (-1 = off)
  shareMarket: true,    // friends sync: pool trade offers read from the chat
  quietFrom: -1,        // quiet hours for phone / Discord alerts, e.g. 0 … 8 (-1 = off); disconnects and deaths still come through
  quietTo: -1,
  effectAlert: true,    // a debuff icon (stunned, poisoned…) shows up while you're AFK
  buffEndAlert: true,   // a buff icon that was on for a minute or more goes away
  minimapSurge: 5,      // this many more players on the minimap within a minute while you're AFK (0 = off)
  expGoal: 0,           // daily EXP goal in % of a level (0 = off)
  rivals: [],           // players whose levels you follow next to yours
  guideBossAlert: true, // heads-up 10 min before the Korean guide's field-boss times (until SoF's own are learned)
  guideBossHours: [9, 13, 17, 21], // those times, in server time
  braceletHours: 24,    // Entry Bracelet you use: 24 or 4 hours
  potionHp: 'Healing Salve (Special)', // the potions you drink, for the cost of a farming spot
  potionMp: 'Aged Rare Ginseng',
  shareEnhance: true,   // friends sync: pool enhance tries for better odds
  viewCharacter: '',    // the character Honor, Ascension and "your week" show ('' = the one in the game / last played)
  dangerForecast: true, // entering a zone where you often died or met enemies at this hour: a warning
  partyFinder: true,    // "LF party / need healer" posts in the chat that fit your characters: an alert
  weightAlert: 90,      // the open inventory shows the bag this % full or more: an alert (0 = off)
  features: {},         // switched-off features: { quests: false, … } (see FEATURES)
  alertMute: {},        // alert types you don't want to hear about: { price: true, … } (still in the alert log)
  alertCap: 0,          // at most this many pop-ups per alert type per day (0 = no cap)
  quietFarming: false,  // only deaths, disconnects, whispers and danger make noise
  myGender: '',         // 'M' / 'F' for the gear advisor ('': from the robe you wear)
  layout: { order: {}, hidden: [] }, // your own dashboard: panel order per tab and hidden panels (the ▦ button)
  sounds: {},           // a sound per alert type (Alerts → Sounds): { danger: { s: 'alarm', v: 80 } }
  tidyMB: 0,            // pictures, debug captures and timelines: delete the oldest above this many MB (0 = no limit)
  tidyDays: 0,          // … and those older than this many days (0 = keep)
  debugCapture: true,   // keep the game picture when a reader saw something it couldn't read (data/debug, newest 40)
  gearOfferAlert: true, // the trade chat sells gear that beats yours (higher +, or newer at the same +): an alert
};
const LANG_CODES = ['en', 'tr', 'vi', 'id', 'zh', 'th', 'es'];
let updateBlocked = false; // an update is required (set by updateStatus(), see "updates" below): readers, alerts and the bot stop
let settings = { ...DEFAULT_SETTINGS, ...store.readJson('settings.json', {}) };
let goalState = store.readJson('goals.json', { date: null, reminded: 0, goalHit: false, limitHit: false, lastNag: 0 });
let zoneNameList = zoneNames(CLIENT_DIR);
const STARTUP_LNK = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'SoF Tracker.lnk');
const BACKUP_DIR = path.join(__dirname, 'backups');

// Zone minimaps (512x512 px, 10 world units per px). Each zone is a 5120x5120 tile of one shared world;
// the tile centre comes from the client's waypoint files (e.g. Hill Valley sits at x = +5120).
const MINIMAP_DIR = path.join(GAME_DIR, 'datas', 'interface', 'DATA', 'window_minimap');
const TILE = 5120;
const zoneMaps = {};
function loadZoneMaps() {
  for (const k of Object.keys(zoneMaps)) delete zoneMaps[k];
  for (const [zone, pts] of Object.entries(allPathPoints(GAME_DIR))) {
    if (!fs.existsSync(path.join(MINIMAP_DIR, `${zone}.bmp`)) || !pts.length) continue;
    const avg = (i) => pts.reduce((s, p) => s + p[i], 0) / pts.length;
    zoneMaps[zone] = { cx: Math.round(avg(0) / TILE) * TILE, cz: Math.round(avg(1) / TILE) * TILE, size: TILE };
  }
}
loadZoneMaps();

// the game's own database (items, monsters, NPCs, zone names, NPC spots, portals), decoded from the client files
let gameDb = { items: [], monsters: [], npcs: [], skills: [], quests: [], zones: {}, npcSpots: [], portals: [] };
let dbChanges = store.readJson('gamedb-changes.json', []); // [{ at, version, diff }] newest first
function reloadGameDb() {
  try {
    gameDb = loadGameDb(CLIENT_DIR, path.join(store.DIR, 'gamedb.json'), (diff) => {
      // a game update changed the database: remember what, and say so
      dbChanges.unshift({ at: Date.now(), version: patches?.gameVersion?.() || null, diff });
      dbChanges = dbChanges.slice(0, 30);
      store.writeJson('gamedb-changes.json', dbChanges);
      const c = (k) => diff[k].counts;
      addAlert('patch', 'Game database changed', [
        c('items').added && `${c('items').added} new items`, c('items').changed && `${c('items').changed} items changed`,
        c('monsters').added && `${c('monsters').added} new monsters`, c('monsters').changed && `${c('monsters').changed} monsters changed`,
        c('skills').added && `${c('skills').added} new skills`, c('quests').added && `${c('quests').added} new quests`, c('zones').added && `${c('zones').added} new zones`,
      ].filter(Boolean).join(' · '));
    });
  } catch (e) { console.log(`[tracker] game database unavailable: ${e.message}`); }
}
let worldZoneList = null; // filled in the background (scanning the map files takes a moment)
setTimeout(() => { try { worldZoneList = terrain.worldZones(GAME_DIR); } catch { worldZoneList = []; } }, 3000);

let guide = { monsters: [], quests: [], npcs: [], items: [] };
loadGuide(GAME_DIR).then((g) => { guide = g; }).catch((e) => console.log(`[tracker] game guide unavailable: ${e.message}`));

let trades = store.readJson('trades.json', []); // [{ id, t, type, item, qty, price, with, note, zone, character }]
const busy = store.readJson('busy.json', {});   // zone -> hour -> { sec, near }  (average players nearby)
// server activity: per clock hour (start time in ms) how long you played, how many players were around you
// (live only) and how many different players you met. cur = names met in the current hour.
let activity = store.readJson('activity.json', { v: 2, backfilled: false, hours: {}, cur: { h: 0, names: [] } });
if (activity.v !== 2) activity = { v: 2, backfilled: false, hours: {}, cur: { h: 0, names: [] } }; // first build counted duplicate sessions
let activityNames = new Set(activity.cur.names), activityDirty = false;
const hourStart = (t) => Math.floor(t / 3600000) * 3600000;
function activityHour(t) { return (activity.hours[hourStart(t)] ||= { sec: 0, nsec: 0, near: 0, met: 0 }); }
function activityMet(name, now) {
  const h = hourStart(now);
  if (activity.cur.h !== h) { activity.cur = { h, names: [] }; activityNames = new Set(); }
  if (activityNames.has(name)) return;
  activityNames.add(name); activity.cur.names.push(name);
  activityHour(now).met++;
  activityDirty = true;
}
let milestoneState = store.readJson('milestones.json', null); // id -> earnedAt (null until first evaluation)
const friends = new Friends();

const isWatched = (name) => watchlist.some((w) => w.toLowerCase() === String(name).toLowerCase());

// features you can switch off (Settings → Features): the tracker skips their work, the dashboard hides them
const FEATURES = [
  { id: 'quests', label: 'Quest tools: item counter, trip, available quests, quest history' },
  { id: 'gear', label: 'Gear log, gear score, gear compare and price check' },
  { id: 'gold', label: 'Gold, net worth and the gold ledger' },
  { id: 'enhance', label: 'Enhance auto-log' },
  { id: 'maze', label: 'Tiger Valley maze runs' },
  { id: 'market', label: 'Market flips and deal alerts' },
  { id: 'party', label: 'Party finder' },
  { id: 'danger', label: 'Danger forecast for zones' },
];
const feat = (id) => settings.features?.[id] !== false;
// alerts that always make noise, also in quiet farming
const ALWAYS_LOUD = (a) => a.kind === 'disconnect' || a.kind === 'whisper' || a.kind === 'danger' || a.kind === 'update';
// extra: e.g. { undo: {…} } for a tick the tracker made by itself (an Undo button in the dashboard)
function addAlert(kind, title, body = '', extra = null) {
  const a = { id: ++alertSeq, t: Date.now(), kind, title, body, ...(extra || {}) };
  // noise control: muted types, a daily cap per type and quiet farming keep the alert in the log, without a pop-up
  if (!ALWAYS_LOUD(a)) {
    const d0 = new Date(a.t); d0.setHours(0, 0, 0, 0);
    if (settings.alertMute?.[kind] || (settings.quietFarming && kind !== 'recap')
      || (settings.alertCap > 0 && alerts.filter((x) => x.kind === kind && !x.silent && x.t >= +d0).length >= settings.alertCap)) a.silent = true;
  }
  alerts.push(a);
  if (alerts.length > MAX_ALERTS) alerts.splice(0, alerts.length - MAX_ALERTS);
  store.writeJson('alerts.json', alerts);
  console.log(`[alert] ${title}${body ? ' - ' + body : ''}`);
  // quiet hours: nothing to the phone / Discord, except disconnects and deaths (the dashboard still shows everything)
  if (quietNow() && !(kind === 'disconnect' || (kind === 'danger' && /\bdied\b/i.test(title)))) return;
  if (a.silent) return; // muted / capped / quiet farming: in the log only
  if (updateBlocked && kind !== 'update') return; // blocked until updated: nothing goes out
  // phone / Discord get the alert in the interface language
  notifier.send({ ...a, title: i18n.tAlert(uiLang(), title), body: i18n.tAlert(uiLang(), body) });
}
// e.g. from 0 to 8: 00:00 – 07:59; from 23 to 7 runs over midnight
function quietNow(h = new Date().getHours()) {
  const { quietFrom: a, quietTo: b } = settings;
  if (a < 0 || b < 0 || a === b) return false;
  return a < b ? h >= a && h < b : h >= a || h < b;
}
const uiLang = () => settings.lang || 'en';

// "away" = game closed, or idle long enough to count as AFK (for "only notify me when I'm away")
const notifier = new Notifier({
  isAway: () => !state.game.running || (state.session.lastActiveAt && Date.now() - state.session.lastActiveAt >= settings.afkMinutes * 60000),
});
const bosses = new Bosses({ onEvent: addAlert });
// from the Korean guide book: the field-boss schedule until SoF's own is learned, pass countdowns, buff run times
const guideBosses = new guideplan.GuideBosses({ guide: KR_GUIDE, onEvent: addAlert });
const passTimers = new guideplan.PassTimers({ read: () => store.readJson('passes.json', null), save: (d) => store.writeJson('passes.json', d), onEvent: addAlert });
const buffDurations = new guideplan.BuffDurations({ read: () => store.readJson('buff-durations.json', null), save: (d) => store.writeJson('buff-durations.json', d), onEvent: addAlert });
let enhanceLog = store.readJson('enhance-log.json', []);
// quest tools (lib/features/quests.js): the quest window, quest items, the trip, history, hand-in reminders
const quests = require('./lib/features/quests')({
  store, state: () => state, feat: (id) => feat(id), addAlert: (...x) => addAlert(...x), debugCapture: (...x) => debugCapture(...x), readerOk: (...x) => readerOk(...x),
  zoneName: (z) => zoneName(z), playerInfo: (n) => playerInfo(n), gameIndex: () => gameIndex(), chatPrice: (id) => chatPrice(id), bestMatch: (t, l) => screenreader.bestMatch(t, l),
  db: () => gameDb, checklist: () => checklist, questsDone: () => questsDone, alerts: () => alerts, views: () => views,
  questSearch: (q) => questSearch(q), others: () => others, recentKills: () => recentKills,
});
const { onQuestWindow, undoAlert, checkHandIn, recapEvent, recapSum, charPosition, altKills, activeQuestViews, questProg, questWatch,
  onPickupLines, learnPickup, questProgView, questRouteView, questNext, availableView, expSplit, nearNpc } = quests;
// gear & gold (lib/features/geargold.js): gear log, price check, gold, net worth, goals, gear score, gear offers
const gearGold = require('./lib/features/geargold')({
  store, state: () => state, db: () => gameDb, settings: () => settings, enhanceSession: () => enhanceSession,
  feat: (id) => feat(id), addAlert: (...x) => addAlert(...x), debugCapture: (...x) => debugCapture(...x), readerOk: (...x) => readerOk(...x),
  playerInfo: (n) => playerInfo(n), zoneName: (z) => zoneName(z), chatPrice: (id) => chatPrice(id), marketOffers: () => marketOffers(),
  timelineFor: (k) => timelineFor(k), sessionKey: (x) => sessionKey(x), dayKey: (t) => dayKey(t),
  // your Ascension gold, read from the inventory
  onGold(char, gold) {
    const k = String(char).toLowerCase();
    if (!ascState.byChar) ascState = { byChar: {} };
    const cur = ascFor(char);
    if (cur.gold !== gold) { ascState.byChar[k] = { ...cur, gold }; store.writeJson('asc.json', ascState); }
  },
});
const { gearLog, invWatch, netWorth, gearScores, gearGoals, onTooltip, onInventory, onGearOffer, gearGoalsView, checkGoalOffer, gearValue, noteNetWorth,
  gearWithStats, charGearScore, gearScoreView, enhanceBudget, gearPrice, checkGearFor, priceLine } = gearGold;
// the game's other system messages in the chat (patterns from its own texts, Ybmsg.cfg): item pickups (quest items),
// Ki and gold gains, who killed you, Honor lost to an attack, EXP lost on death, a full bag
const sysMatchers = sysmsg.buildMatchers((() => { try { return loadMessages(CLIENT_DIR); } catch { return []; } })());
let lastKiller = null, bagFullAt = 0;
const pickupSeenCenter = new Map(); // the message box in the middle keeps a message for a few looks
function onSysLines(lines, t, char, { fromCenter = false } = {}) {
  if (!char) return;
  for (const line of lines || []) {
    const c = sysmsg.classify(line, sysMatchers);
    if (!c) { onPickupLines([line], t, char); continue; } // (lines it doesn't know: the pickups you taught, and candidates)
    if (fromCenter) { const k = String(line).replace(/\s+/g, ' ').trim(); if (t - (pickupSeenCenter.get(k) || 0) < (c.kind === 'pickup' ? 90000 : 8000)) continue; pickupSeenCenter.set(k, t); if (pickupSeenCenter.size > 300) pickupSeenCenter.clear(); }
    readerOk('sysChat', t);
    if (['enchant', 'combine', 'repairNeeded', 'repaired', 'petLoyalty', 'expEvent', 'eventStart', 'partyLeave', 'partyLeader'].includes(c.kind)) { onSysExtra(c, t, char); continue; }
    if (c.kind === 'pickup') {
      readerOk('pickup', t);
      if (feat('quests')) { const n = questProg.pickup(char, { name: c.item, qty: c.qty }, activeQuestViews(char), sameItemName); if (n) recapEvent(t, char, 'pickup', n); }
      if (char === state.session.character && state.session.position) {
        const it = screenreader.bestMatch(c.item, gameDb.items), p = state.session.position;
        if (it) for (let k = 0; k < Math.min(c.qty || 1, 50); k++) { farming.addLoot({ zone: p.zone, x: p.x, z: p.z, itemId: it.id }); farmingDirty = true; }
      }
    } else if (c.kind === 'ki' && c.n) {
      dailyStats.add(t, { ki: c.n }, char); recapEvent(t, char, 'ki', c.n);
      const cur = ascFor(char); noteAscFrom(char, { ki: (cur.ki || 0) + c.n }); // your Ki, kept up to date between Status window reads
    } else if (c.kind === 'gold' && c.n) {
      dailyStats.add(t, { goldLoot: c.n }, char); recapEvent(t, char, 'goldLoot', c.n);
    } else if (c.kind === 'killedBy' && c.who) {
      const d = farming.data.deaths[farming.data.deaths.length - 1];
      if (d && t - d.t < 3 * 60000 && !d.killer) { d.killer = c.who; farmingDirty = true; } else lastKiller = { who: c.who, t };
      flagThreats([c.who], t); pvpNote(c.who, 'deaths', t, char);
      const i = playerInfo(c.who);
      addAlert('danger', `Killed by ${c.who}`, [i?.level && `Lv ${i.level}`, i?.cls, i?.faction, i?.house, 'remembered as a threat'].filter(Boolean).join(' · '));
    } else if (c.kind === 'attacked' && c.who) {
      flagThreats([c.who], t);
      addAlert('danger', `${c.who} attacked you`, c.honor ? `you lost ${c.honor} Honor` : '');
    } else if (c.kind === 'expLost' && c.n) {
      const d = farming.data.deaths[farming.data.deaths.length - 1];
      if (d && t - d.t < 5 * 60000) { d.expLostPts = c.n; farmingDirty = true; }
    } else if (c.kind === 'bagFull' && t - bagFullAt > 10 * 60000) {
      bagFullAt = t;
      addAlert('danger', `Bag full (${char})`, 'the game says your inventory is full: time to sell or store');
    } else if (c.kind === 'defeated' && c.who) {
      pvpNote(c.who, 'kills', t, char); dailyStats.add(t, { pvpKills: 1 }, char); recapEvent(t, char, 'pvpKill', 1);
      const r = pvp[c.who.toLowerCase()];
      addAlert('goal', `You defeated ${c.who}`, `you ${r.kills} – ${r.deaths} ${c.who}${playerInfo(c.who)?.level ? ` · Lv ${playerInfo(c.who).level}` : ''}`);
    } else if (c.kind === 'killFeed') onKillFeed(c.killer, c.victim, t, char);
    else if (c.kind === 'karmaDrop' && (!c.who || c.who.toLowerCase() === String(char).toLowerCase() || /^\d+$/.test(c.who))) {
      addAlert('danger', `Karma dropped (${char})`, 'attacking your own faction: with karma, shop prices go up 30 / 50 / 100 % and storage 100 / 400 / 800 % by phase; at the 4th phase no shop or storage');
    } else if (c.kind === 'karmaRestored' && (!c.who || c.who.toLowerCase() === String(char).toLowerCase() || /^\d+$/.test(c.who))) {
      addAlert('goal', `Karma restored (${char})`, '');
    } else if (c.kind === 'trade') {
      // a trade done: remembered for the gold ledger, and a reminder to log what it was
      exchanges.push({ t, char }); if (exchanges.length > 500) exchanges.shift();
      store.writeJson('exchanges.json', exchanges);
      addAlert('price', `Trade completed (${char})`, 'log it in Trades (item, price, with whom) to keep the gold ledger and your price history right');
    } else if (c.kind === 'houseJoin' || c.kind === 'houseLeave') {
      houseLog.push({ t, char, kind: c.kind === 'houseJoin' ? 'joined' : 'left', who: c.who || char }); houseLog = houseLog.slice(-500);
      store.writeJson('house-log.json', houseLog);
      if (c.kind === 'houseLeave' && c.who) addAlert('watch', `${c.who} left the House`, char);
      else if (c.kind === 'houseJoin') addAlert('watch', `${c.who} joined the House`, char);
    } else if (c.kind === 'honorPill' && c.n) {
      dailyStats.add(t, { honorPill: c.n }, char); recapEvent(t, char, 'honorPill', c.n);
    }
  }
}
// enchanting / combining results, EXP events, events starting (their usual times learned), repairs, pet loyalty
let craftLog = store.readJson('craft-log.json', []);   // { t, char, kind: enchant | combine, ok }
let eventLog = store.readJson('event-log.json', []);   // { t, name }: "The Authority Clash has started."
let expBoost = null;                                   // { what, from, to, seenAt }: a double / bonus EXP event seen
const warnedAt = new Map();                            // alert kind → when (repairs, pet loyalty, EXP events)
const warnOnce = (key, t, every) => { if (t - (warnedAt.get(key) || 0) < every) return false; warnedAt.set(key, t); return true; };
function onSysExtra(c, t, char) {
  if (c.kind === 'enchant' || c.kind === 'combine') {
    craftLog.push({ t, char, kind: c.kind, ok: c.ok }); craftLog = craftLog.slice(-3000); store.writeJson('craft-log.json', craftLog);
    dailyStats.add(t, { [`${c.kind === 'enchant' ? 'ench' : 'comb'}${c.ok ? 'Ok' : 'Fail'}`]: 1 }, char);
  } else if (c.kind === 'repairNeeded') { if (warnOnce('repair', t, 30 * 60000)) addAlert('danger', `Repair your gear (${char})`, 'the game says your equipment is damaged'); }
  else if (c.kind === 'repaired') warnedAt.delete('repair');
  else if (c.kind === 'petLoyalty') { if (warnOnce('pet', t, 30 * 60000)) addAlert('checklist', c.withdrawn ? `Your pet was withdrawn (${char})` : `Your pet's loyalty is low (${char})`, c.withdrawn ? 'resummoning costs 1,000,000 gold: feed it in time' : 'feed your pet before it is withdrawn (resummoning costs 1,000,000 gold)'); }
  else if (c.kind === 'expEvent') {
    expBoost = { what: c.what, from: c.from || null, to: c.to || null, seenAt: t };
    if (warnOnce(`boost:${c.what}`, t, 3 * 3600000)) addAlert('event', `${c.what} event`, c.from ? `from ${c.from} to ${c.to}` : 'EXP per hour now is boosted: farming spots measured now will look better than usual');
  } else if (c.kind === 'eventStart') {
    if (!eventLog.some((e) => e.name === c.name && t - e.t < 30 * 60000)) { eventLog.push({ t, name: c.name }); eventLog = eventLog.slice(-2000); store.writeJson('event-log.json', eventLog); }
  } else if (c.kind === 'partyLeave' || c.kind === 'partyLeader') {
    if (char === state.session.character) timelineFor(sessionKey(state.session))?.event(t, 'party', c.kind === 'partyLeave' ? `${c.who} left the party` : `${c.who} is the party leader`);
  }
}
// the usual times of events, learned from when they started: the same weekday and hour in 2+ weeks, or the same hour
// on 3+ different days; the next ones in the coming 24 hours
function eventPredictions(now = Date.now()) {
  const since = now - 60 * 86400000, out = [];
  const byName = new Map();
  for (const e of eventLog) if (e.t >= since) { const l = byName.get(e.name) || []; l.push(e); byName.set(e.name, l); }
  for (const [name, list] of byName) {
    const slots = new Map(); // "d|h" → [minutes]
    for (const e of list) { const d = new Date(e.t), k = `${d.getDay()}|${d.getHours()}`; (slots.get(k) || slots.set(k, []).get(k)).push({ m: d.getMinutes(), week: Math.floor(e.t / (7 * 86400000)) }); }
    const hours = new Map(); for (const [k, v] of slots) { const h = +k.split('|')[1]; hours.set(h, (hours.get(h) || 0) + 1); }
    const med = (a) => { const x = a.slice().sort((p, q) => p - q); return x[x.length >> 1]; };
    for (let ahead = 0; ahead < 24; ahead++) {
      const at = new Date(now + ahead * 3600000), k = `${at.getDay()}|${at.getHours()}`, s = slots.get(k);
      const weekly = s && new Set(s.map((x) => x.week)).size >= 2, daily = (hours.get(at.getHours()) || 0) >= 3;
      if (!weekly && !daily) continue;
      const mins = s ? s.map((x) => x.m) : [...slots.entries()].filter(([kk]) => +kk.split('|')[1] === at.getHours()).flatMap(([, v]) => v.map((x) => x.m));
      at.setMinutes(med(mins), 0, 0);
      if (at.getTime() > now - 5 * 60000) out.push({ t: at.getTime(), name, how: weekly ? 'weekly' : 'daily', seen: list.length });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}
function checkEventPredictions(now = Date.now()) {
  for (const p of eventPredictions(now)) if (p.t - now > 0 && p.t - now <= 10 * 60000 && warnOnce(`ev:${p.name}:${p.t}`, now, 3600000)) addAlert('event', `${p.name} usually starts at ${new Date(p.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, `learned from ${p.seen} times it started (${p.how})`);
}
// your PvP record per player: { name: { name, kills, deaths, lastAt } } (kills: you killed them; deaths: they killed you)
let pvp = store.readJson('pvp.json', {});
function pvpNote(who, field, t, char) {
  const k = String(who).toLowerCase(), r = (pvp[k] ||= { name: who, kills: 0, deaths: 0, lastAt: 0, chars: {} });
  r[field]++; r.lastAt = t; r.chars[String(char || '?').toLowerCase()] = (r.chars[String(char || '?').toLowerCase()] || 0) + 1;
  store.writeJson('pvp.json', pvp);
}
let exchanges = store.readJson('exchanges.json', []);   // "Exchange completed successfully.": { t, char }
let houseLog = store.readJson('house-log.json', []);    // members joining / leaving: { t, char, kind, who }
// the kill feed ("Alpha killed Beta"): a player who kills two or more around you in 10 minutes is on a spree
const killFeed = [];
const spreeWarned = new Map();
function onKillFeed(killer, victim, t, char) {
  if (!killer || String(killer).toLowerCase() === String(char || '').toLowerCase()) return; // your own kills: "You defeated"
  killFeed.push({ t, killer, victim }); while (killFeed.length && t - killFeed[0].t > 10 * 60000) killFeed.shift();
  const k = killer.toLowerCase(), n = killFeed.filter((x) => x.killer.toLowerCase() === k).length;
  const mine = myFaction(), fac = playerInfo(killer)?.faction;
  const enemy = !mine || !fac || fac !== mine;
  if (n >= 2 && enemy && t - (spreeWarned.get(k) || 0) > 10 * 60000) {
    spreeWarned.set(k, t); flagThreats([killer], t);
    addAlert('danger', `${killer} is killing nearby`, `${n} kills in 10 min (last: ${victim})${fac ? ` · ${fac}` : ''}${playerInfo(killer)?.level ? ` · Lv ${playerInfo(killer).level}` : ''}`);
  }
}
// "125120Exp obtained" in the chat: each gain's exact EXP. A gain that is exactly a quest's EXP reward is that quest;
// gains against how far the EXP bar moved tell how many EXP points a level takes (time to level in real numbers)
const expChat = new expchat.ExpChat();
const mobStats = new MobStats({ read: () => store.readJson('mob-stats.json', null), save: (d) => store.writeJson('mob-stats.json', d) });
setInterval(() => mobStats.flush(), 60000);
// your monsters: EXP per kill / per hour, time per kill and damage per second, before and after your last gear change
function mobStatsView(char) {
  const mobs = new Map(gameDb.monsters.map((m) => [m.id, m])), gs = gearScores.history(char);
  const gearAt = gs.length >= 2 ? gs[gs.length - 1].t : null;
  return { character: char, gearAt, mobs: mobStats.view(char, mobs, gearAt).slice(0, 40) };
}
let expLevel = store.readJson('exp-level.json', {}); // char → { level, perPct: [samples] }
const questExp = (v) => (v.rewards || []).filter((r) => [909000001, 909100001, 909100002].includes(r.id) || /^exp$/i.test(r.name || '')).reduce((s, r) => s + (r.qty || 0), 0);
function onExpGains(gains, t, char, barGain) {
  if (!char || !gains.length) return;
  const qv = activeQuestViews(char).map((v) => ({ id: v.id, name: v.name, exp: questExp(v) }));
  let sum = 0;
  for (const n of gains) {
    sum += n;
    const q = expchat.questForGain(n, qv);
    if (!q) { const mt = quests.mobTarget(); if (mt && t - mt.t < 30000 && mt.id != null) mobStats.kill(char, mt.id, n, t); }
    dailyStats.add(t, q ? { expPts: n, expPtsQuest: n } : { expPts: n, expPtsMob: n }, char);
    recapEvent(t, char, 'expPts', n);
    if (q) recapEvent(t, char, 'expPtsQuest', n);
  }
  readerOk('expChat', t);
  // points per 1 % of the bar: only from looks where the bar moved a fair bit without a level-up
  if (barGain > 0.05 && barGain < 20) {
    const lv = playerInfo(char)?.level || null, k = String(char).toLowerCase();
    const e = expLevel[k] && expLevel[k].level === lv ? expLevel[k] : (expLevel[k] = { level: lv, perPct: [] });
    e.perPct.push(sum / barGain); if (e.perPct.length > 60) e.perPct.shift();
    store.writeJson('exp-level.json', expLevel);
  }
}
// EXP points: per hour (last hour), a level's size and the time to the next level, for the character
function expPtsView(char, now = Date.now()) {
  if (!char) return null;
  const perHour = recapSum(char, 'expPts', now - 3600000, now), e = expLevel[String(char).toLowerCase()];
  const med = (a) => { const x = a.slice().sort((p, q) => p - q); return x.length ? x[x.length >> 1] : null; };
  const perPct = e && e.perPct.length >= 5 ? med(e.perPct) : null, bar = char === state.session.character ? screen?.exp : null;
  const toGo = perPct && bar != null ? Math.round((100 - bar) * perPct) : null;
  return { perHour: perHour || null, levelSize: perPct ? Math.round(perPct * 100) : null, toGo, etaMs: toGo && perHour ? Math.round((toGo / perHour) * 3600000) : null };
}
// "try these" (Live tab, overlay): the readers that haven't worked yet in a session, with what to do in the game; each
// drops off by itself once the tracker sees it work. (Pickup messages: the game doesn't print them; the second window
// only if you play two.) Also the sharp picture of the Status window for the digit reader.
const TRY_ORDER = ['expChat', 'tooltip', 'statusSkills', 'questAvailable', 'statusBasic', 'enhance'];
function tryNextList(now = Date.now()) {
  const v = readerTools.readerCheckView(now), by = new Map(v.checks.map((c) => [c.id, c]));
  const out = TRY_ORDER.map((id) => by.get(id)).filter((c) => c && c.status !== 'ok').map(({ id, label, tip }) => ({ id, label, tip }));
  let sharp = false; try { sharp = fs.readdirSync(readerTools.DEBUG_DIR).some((f) => /^status-sharp-.*\.png$/.test(f)); } catch { /* none yet */ }
  if (!sharp && !out.some((x) => x.id === 'statusBasic')) out.push({ id: 'sharp', label: 'A sharp picture of your stats', tip: 'Open the Status window (C) on Basic for a few seconds (it teaches the digit reader the live font).' });
  return out;
}
// the Status window (C): your stats (Basic page) over time, and your skills per tab (Skill page) with Ascension levels
const statusLog = new statuswin.StatusLog({ read: () => store.readJson('status.json', null), save: (d) => store.writeJson('status.json', d) });
function onStatusWindow(sw, t, char = state.session.character) {
  if (!char) return;
  if (sw.page === 0) {
    // the numbers from their boxes, the rest (name, faction, class, Health …) from the page's text
    const st = { ...statuswin.parseBasic(sw.lines), ...statuswin.parseFields(sw.fields) };
    // (Ki for the Ascension tracker comes from the Skill page's header: it reads more reliably there)
    if (statusLog.stats(char, st, t)) { readerOk('statusBasic', t); noteAscFrom(char, { asc: st.asc }); }
    else if ((sw.lines || []).length) debugCapture('status', t, { page: 0, lines: sw.lines });
  } else if (sw.page === 2 && sw.tab >= 0) {
    const ids = statuswin.parseIcons(sw.icons).map((i) => i.id), header = statuswin.parseHeader(sw.header);
    if (statusLog.skills(char, sw.tab, ids, statuswin.parseLevels(sw.levels), header, t)) { readerOk('statusSkills', t); noteAscFrom(char, header); }
    else debugCapture('status', t, { page: 2, tab: sw.tab, header: sw.header, icons: sw.icons });
  }
}
// your Ascension level and Ki, read from the Status window: the Ascension tracker fills itself in
function noteAscFrom(char, { asc, ki }) {
  const cur = ascFor(char), next = { ...cur, ...(asc != null ? { asc } : {}), ...(ki != null ? { ki } : {}) };
  if (next.asc === cur.asc && next.ki === cur.ki) return;
  if (!ascState.byChar) ascState = { byChar: {} };
  ascState.byChar[String(char).toLowerCase()] = next; store.writeJson('asc.json', ascState);
}
// skill / item cooldowns from the game data (CoolTime.cfg): id → ms
let cdCache = { db: null, map: new Map() };
function cooldownMap() { if (cdCache.db !== gameDb) cdCache = { db: gameDb, map: new Map((gameDb.cooldowns || []).filter((c) => c[1] > 0).map((c) => [c[0], c[1]])) }; return cdCache.map; }
// your skills: per tab with names and Ascension levels, and the skills of your class you don't have yet at your level
function skillsView(char) {
  const v = statusLog.view(char);
  if (!v) return { character: char, seen: false };
  const byId = new Map(gameDb.skills.map((s) => [s.id, s])), cd = cooldownMap();
  const tabs = {};
  for (const name of statuswin.TABS) {
    const s = v.skills[name];
    tabs[name] = s ? { t: s.t, skills: s.ids.map((id) => ({ id, name: byId.get(id)?.name || `Skill #${id}`, level: s.levels?.[id] ?? null, req: byId.get(id)?.level ?? null, cooldown: cd.get(id) || null })) } : null;
  }
  const learned = new Set(Object.values(v.skills).flatMap((s) => s.ids));
  // your class: the one most of your skills belong to (0 is "everyone")
  const count = {}; for (const id of learned) { const c = byId.get(id)?.cls; if (c) count[c] = (count[c] || 0) + 1; }
  const cls = +(Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0]) || null;
  const lv = v.stats?.v?.level || playerInfo(char)?.level || null;
  const allTabs = statuswin.TABS.every((n) => tabs[n]);
  // the other faction's version of a skill you have (Order 81…/83…, Chaos 82…/84…: the second digit) isn't missing;
  // level-0 / free entries are descriptions and pet skills, not skills to learn
  const twin = (id) => { const s = String(id), d = { 1: '2', 2: '1', 3: '4', 4: '3' }[s[1]]; return d ? +(s[0] + d + s.slice(2)) : null; };
  const missing = cls && allTabs ? gameDb.skills.filter((s) => (s.cls === cls || s.cls === 0) && !learned.has(s.id) && !learned.has(twin(s.id))
    && s.name && !/\^/.test(s.name) && s.level >= 1 && s.cost > 0 && (!lv || s.level <= lv))
    .sort((a, b) => a.level - b.level).map(({ id, name, level, cost }) => ({ id, name, level, cost })) : null;
  const asc = tabs.ascension?.skills || [];
  return { character: char, seen: true, header: v.header, stats: v.stats, history: v.history.slice(-300), tabs, cls, level: lv, allTabs,
    missing: missing ? missing.slice(0, 80) : null, ascMaxed: asc.filter((s) => s.level >= 10).length, ascCount: asc.length };
}
// auto-logging: you say what you're enhancing; the screen reader logs every "succeeded / failed" it sees
let enhanceSession = store.readJson('enhance-session.json', { active: false, level: 1, charm: 'high', item: '', seen: 0 });
let enhanceSeenAt = 0, enhanceAnnounced = store.readJson('enhance-announced.json', []);
const mazeRuns = new guideplan.MazeRuns({ read: () => store.readJson('maze.json', null), save: (d) => store.writeJson('maze.json', d) });
let shopping = store.readJson('shopping.json', []); // [{ id, qty, note }]
const customEvents = new plans.CustomEvents({ read: () => store.readJson('custom-events.json', null), save: (d) => store.writeJson('custom-events.json', d), tz: SERVER_TZ, onEvent: addAlert });
let signups = store.readJson('signups.json', []); // [{ t, label }] bosses you're coming to (shared with friends)
const signupWarned = new Set();
let ascState = store.readJson('asc.json', { asc: 0, gold: 0, ki: 0, stones: 0 });
// potions, enhance results and maze runs per day, for the weekly report and the digest
const dailyStats = new plans.DailyStats({ read: () => store.readJson('daily-stats.json', null), save: (d) => store.writeJson('daily-stats.json', d), dayOf: (t) => dayKey(t) });
// a reminder 10 minutes before a boss you signed up for, with who else is coming
function checkSignups(now) {
  for (const s of signups) {
    const left = s.t - now, key = `${s.label}|${s.t}`;
    if (left > 0 && left <= 10 * 60000 && !signupWarned.has(key)) {
      signupWarned.add(key);
      const who = plans.coming(s, signups, friends.signups(), 'you');
      addAlert('boss', `${s.label} in ${Math.max(1, Math.round(left / 60000))} min`, `Coming: ${who.join(', ')}`);
    }
  }
}

// a result seen on screen (chat or the box in the middle); `line` for the alert
function onEnhanceResult(ok, t, line) {
  if (t - enhanceSeenAt < 4000) return; // the same message read twice (chat line + middle box, or two looks)
  enhanceSeenAt = t;
  const s = enhanceSession;
  if (!s.active) { s.seen = (s.seen || 0) + 1; store.writeJson('enhance-session.json', s); return; }
  enhanceLog.push({ t, level: s.level, charm: s.charm, sofCharm: s.sofCharm || undefined, ok, item: s.item || undefined, auto: true, character: state.session.character || undefined });
  dailyStats.add(t, ok ? { enhOk: 1 } : { enhFail: 1 }, state.session.character);
  enhanceLog = enhanceLog.slice(-2000);
  store.writeJson('enhance-log.json', enhanceLog);
  addAlert('goal', ok ? `Enhanced to +${s.level}` : `Enhancing to +${s.level} failed`, s.item ? `${s.item} · logged` : 'logged in the Enhance calculator');
  // worked: the next try is one higher; failed: the item may be gone or lower — stop until you say what's next
  if (ok && s.level < 15) s.level++; else if (!ok) s.active = false;
  store.writeJson('enhance-session.json', s);
}
const guideBossCfg = (now) => ({ enabled: settings.guideBossAlert, tz: SERVER_TZ, hours: settings.guideBossHours, learned: bosses.stats(now) });

const rankings = new Rankings({ onEvent: addAlert });
const news = new News({ onEvent: addAlert, readAlerted: () => store.readJson('news-alerted.json', []), saveAlerted: (keys) => store.writeJson('news-alerted.json', keys) });
let templates = timerTemplates(CLIENT_DIR);

// ---- patch watcher: after the launcher patched the game, report what changed and reload the game data
const patches = new PatchWatcher({
  gameDir: GAME_DIR, clientDir: CLIENT_DIR, dataDir: store.DIR,
  onEvent: (r) => {
    const updated = r.versionTo && r.versionFrom && r.versionTo !== r.versionFrom;
    const files = r.counts.added + r.counts.changed + r.counts.removed;
    addAlert('patch', updated ? `Game updated to version ${r.versionTo}` : 'Game files changed', [
      files && `${files} files changed`,
      r.newZones.length && `${r.newZones.length} new zones`,
      r.changedMaps.length && `${r.changedMaps.length} maps changed`,
      r.messages?.addedCount && `${r.messages.addedCount} new messages`,
      r.itemIcons && `${r.itemIcons} new item icons`,
    ].filter(Boolean).join(' · '));
    // pick up new maps, timer texts and place names without a restart
    try { loadZoneMaps(); templates = timerTemplates(CLIENT_DIR); zoneNameList = zoneNames(CLIENT_DIR); reloadGameDb(); worldZoneList = terrain.worldZones(GAME_DIR); ensureIconIndex(); } catch (e) { console.log(`[tracker] reloading game data failed: ${e.message}`); }
    doSelfCheck('game update'); // did the update break any of the readers?
  },
});
reloadGameDb(); // after the alerts and the patch watcher exist: a patch installed while the tracker was off is reported too

// Your own notes win over the published rankings, field by field.
function playerInfo(name) {
  if (!name) return null;
  const key = name.toLowerCase();
  const r = rankings.players.get(key), own = playerNotes[key];
  const fr = own ? null : friends.note(name); // a friend's notes fill in when you have none yourself
  const n = own || fr;
  if (!r && !n) return null;
  const pick = (f) => (n && n[f] != null && n[f] !== '' ? n[f] : r ? r[f] : null);
  return {
    level: pick('level'), cls: pick('cls'), faction: pick('faction'), house: pick('house'), honor: r?.honor ?? null,
    note: n?.note || null, ranks: r?.ranks || [], ranked: !!r, noted: !!own, friendNote: fr ? fr.from : null,
  };
}

// ---------------------------------------------------------------- file tailing

class Tailer {
  constructor(file, { fromEnd, onLine }) {
    this.file = file;
    this.onLine = onLine;
    this.offset = 0;
    this.rest = Buffer.alloc(0);
    if (fromEnd) {
      try { this.offset = fs.statSync(file).size; } catch { /* not created yet */ }
    }
  }

  poll(replay = false) {
    let size;
    try { size = fs.statSync(this.file).size; } catch { return; }
    if (size < this.offset) { this.offset = 0; this.rest = Buffer.alloc(0); } // truncated / recreated
    if (size === this.offset) return;

    const fd = fs.openSync(this.file, 'r');
    try {
      const buf = Buffer.alloc(size - this.offset);
      fs.readSync(fd, buf, 0, buf.length, this.offset);
      this.offset = size;
      const data = Buffer.concat([this.rest, buf]);
      const lastNl = data.lastIndexOf(0x0a);
      if (lastNl === -1) { this.rest = data; return; }
      this.rest = data.subarray(lastNl + 1);
      const text = decoder.decode(data.subarray(0, lastNl));
      for (const line of text.split('\n')) this.onLine(line.replace(/\r$/, ''), replay);
    } finally {
      fs.closeSync(fd);
    }
  }
}

// ---------------------------------------------------------------- session log parsing

function freshSession(file) {
  return {
    file,
    startedAt: null,
    clock: null,             // best known wall time while replaying (from map-load stamps)
    clientVersion: null,
    account: null,
    character: null,
    weaponClass: null,
    serverId: null,
    channelId: null,
    position: null,          // { w, s, zone, x, z, at }
    distance: 0,
    distanceByZone: {},
    moveSamples: [],         // [{ at, d }] live samples for speed
    trails: {},              // zone -> [[x, z]]
    zoneHistory: [],         // [{ zone, at, loadMs }]
    players: {},             // name -> { name, id, firstSeen, lastSeen, sightings, zone, nearMs }
    notices: [],
    lineCount: 0,
    lastActiveAt: null,      // last live sign of activity: movement, map change, skill use, own buff
    activeMs: 0,
    afkMs: 0,
    track: [],               // [[t|null, zone, x, z]] for session replay
    buffLog: [],             // [{ id, start, end }] for the buff timeline (live only)
  };
}
const MAX_TRACK = 20000;

const RE = {
  startTime: /^start time:(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})_(\d{2})/,
  version: /^CLIENT VERSION : (\S+)/,
  server: /^SEVERID\s*:\s*(\d+)/,
  channel: /^CHNNELID\s*:\s*(\d+)/,
  account: /^(?:\[ACCOUNTID\]|ACCOUNTID)\s*:\s*(\S+)/,
  charId: /^CHARID\s*:\s*(\S+)/,
  charSelect: /^Char_Count = \d+, Name = (\S+), weaponClass = (\d+)/,
  pos: /^w:(-?\d+) s:(-?\d+) zone:(\d+) x:(-?[\d.]+) z:(-?[\d.]+)/,
  char: /^\d+ \/\d+\s+Char: (\S+) (\d+) (\d+)/,
  mapLoad: /^Load map time:(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})_(\d{2}) - (\d+) : (\d+)/,
  notice: /^ShowGameNotice :\s+\d+\s+\d+\s+\d+ - (.*)$/,
  skill: /^MugongH\s+source over/, // written when you use a martial-arts skill
};

const toDate = (m, i) => new Date(+m[i], +m[i + 1] - 1, +m[i + 2], +m[i + 3], +m[i + 4], +m[i + 5]).getTime();
const isRealZone = (zone) => zone < 1000000; // 1000001/1000002 are the login / character-select screens

// `live` is true only for new lines of the session being followed right now.
function parseSessionLine(s, line, live) {
  const now = Date.now();
  s.lineCount++;
  let m;

  if ((m = RE.pos.exec(line))) {
    const zone = +m[3], x = +m[4], z = +m[5];
    const prev = s.position;
    if (live && (!prev || prev.zone !== zone || prev.x !== x || prev.z !== z)) s.lastActiveAt = now;
    if (prev && prev.zone === zone) {
      const d = Math.hypot(x - prev.x, z - prev.z);
      if (d > 0 && d < TELEPORT_THRESHOLD) {
        s.distance += d;
        s.distanceByZone[zone] = (s.distanceByZone[zone] || 0) + d;
        if (live) s.moveSamples.push({ at: now, d });
      }
    }
    const trail = (s.trails[zone] ||= []);
    const last = trail[trail.length - 1];
    if (!last || last[0] !== x || last[1] !== z) {
      trail.push([x, z]);
      if (trail.length > MAX_TRAIL) trail.splice(0, trail.length - MAX_TRAIL);
    }
    s.position = { w: +m[1], s: +m[2], zone, x, z, at: live ? now : null };
    const lt = s.track[s.track.length - 1];
    if (!lt || lt[1] !== zone || lt[2] !== x || lt[3] !== z) {
      s.track.push([live ? now : null, zone, Math.round(x * 10) / 10, Math.round(z * 10) / 10]);
      if (s.track.length > MAX_TRACK) s.track.splice(0, s.track.length - MAX_TRACK);
    }
  } else if ((m = RE.char.exec(line))) {
    const [, name, id, myId] = m;
    if (+id === +myId) { s.character ||= name; return; }
    const seenAt = live ? now : s.clock;
    let p = s.players[name];
    if (!p) p = s.players[name] = { name, id: +id, firstSeen: seenAt, lastSeen: null, sightings: 0, zone: s.position?.zone ?? null, nearMs: 0 };
    // one of your own characters (another game window, an alt): kept, but never a threat, a watch alert or "met"
    if (p.own ?? (p.own = isOwnChar(name))) { if (live) p.lastSeen = now; p.sightings++; return; }
    if (live) {
      if (p.lastSeen === null || now - p.lastSeen > NEARBY_WINDOW_MS) { p.nearSince = now; onThreatArrival(p.name, now, s); } // just arrived
      const away = p.lastSeen === null || now - p.lastSeen > REENCOUNTER_MS;
      if (away && isWatched(name)) {
        const info = playerInfo(name);
        addAlert('watch', `${name} is near ${nearWho(s)}`, [info?.level && `Lv ${info.level}`, info?.cls, info?.faction, s.position && zoneName(s.position.zone)].filter(Boolean).join(' · '));
      }
      p.lastSeen = now;
      if (s === state.session) activityMet(name, now);
    }
    p.id = +id;
    p.sightings++;
    if (p.zone == null && s.position) p.zone = s.position.zone; // seen before our first position line
  } else if ((m = RE.mapLoad.exec(line))) {
    const at = toDate(m, 1);
    s.clock = at;
    if (live) s.lastActiveAt = now;
    s.zoneHistory.push({ zone: +m[7], at, loadMs: +m[8] });
  } else if ((m = RE.notice.exec(line))) {
    const text = m[1].trim();
    s.notices.unshift({ text, at: live ? now : null });
    if (s.notices.length > MAX_NOTICES) s.notices.length = MAX_NOTICES;
    if (live && s === state.session) onLiveNotice(text, now); // every client gets the same server notices: handle them once
  } else if (RE.skill.test(line)) {
    if (live) s.lastActiveAt = now;
  } else if ((m = RE.startTime.exec(line))) { s.startedAt = toDate(m, 1); s.clock = s.startedAt; }
  else if ((m = RE.version.exec(line))) s.clientVersion = m[1];
  else if ((m = RE.server.exec(line))) s.serverId = +m[1];
  else if ((m = RE.channel.exec(line))) s.channelId = +m[1];
  else if ((m = RE.account.exec(line))) s.account = m[1];
  else if ((m = RE.charId.exec(line))) s.character = m[1];
  else if ((m = RE.charSelect.exec(line))) { s.character = m[1]; s.weaponClass = +m[2]; }
}

// alerts from a second game window name the character instead of "you"
const nearWho = (s) => (s === state.session ? 'you' : s.character || 'your other character');

// names from the game's own zone table, overridden by any name you set yourself
const zoneLabels = () => ({ ...KNOWN_ZONES, ...gameDb.zones, ...(labels.zones || {}) });
const zoneName = (z) => labels.zones?.[z] || gameDb.zones[z] || KNOWN_ZONES[z] || `Zone ${z}`;
const buffName = (id) => labels.buffs?.[id] || `Effect #${id}`;

function timeByZone(s, end) {
  const zones = s.zoneHistory.filter((z) => isRealZone(z.zone));
  const out = {};
  zones.forEach((z, i) => {
    const until = i + 1 < zones.length ? zones[i + 1].at : end;
    out[z.zone] = (out[z.zone] || 0) + Math.max(0, until - z.at);
  });
  return out;
}

// ---------------------------------------------------------------- timers from server notices

const state = {
  game: { running: false, pid: null, logFile: null },
  session: freshSession(null),
  buffs: {},                 // id -> { id, subId, durationMs, startedAt, expiresAt, reminded }
  buffHistory: {},           // id -> { count, lastAt, lastDurationMs }
  timers: [],                // [{ id, text, endsAt, warned, fired }]
  logins: [],                // from log3.txt
  trackerStartedAt: Date.now(),
};
let timerSeq = 0;

function onLiveNotice(text, now) {
  for (const { re, minuteGroup } of templates) {
    const m = re.exec(text);
    if (!m) continue;
    const minutes = +m[minuteGroup];
    if (!(minutes > 0 && minutes < 24 * 60)) continue;
    // a repeated countdown for the same event replaces the older timer
    const title = text.replace(/\d+\s*mins?/i, '…').slice(0, 160);
    // servers repeat the countdown every minute ("in 5 min", "in 4 min", …): update the timer, alert only once
    const existing = state.timers.find((t) => t.title === title && !t.fired);
    state.timers = state.timers.filter((t) => t.title !== title);
    state.timers.push({ id: existing?.id ?? ++timerSeq, title, text, endsAt: now + minutes * 60000, warned: existing?.warned || minutes <= 1, fired: false });
    if (!existing) addAlert('timer', `Timer started: ${minutes} min`, text);
    bosses.onNotice(text, now, minutes);
    return;
  }
  bosses.onNotice(text, now, null);
  if (/has spawned|is caught|has appeared|has started/i.test(text)) addAlert('event', 'Server event', text);
}

// ---------------------------------------------------------------- buff / status parsing

const STATUS_RE = /^Time : (\d+) ID : (-?\d+)\s+SubId : (-?\d+)\s+OnOff: (\d+)/;

function onStatusLine(line) {
  const m = STATUS_RE.exec(line);
  if (!m) return;
  const durationMs = +m[1], id = m[2], subId = +m[3];
  const now = Date.now();
  const log = state.session.buffLog;
  const close = (bid) => { for (const b of log) if ((bid === null || b.id === bid) && b.end > now) b.end = now; };
  if (id === '-1') { state.buffs = {}; close(null); return; } // client clears all statuses (zone change / death)
  if (durationMs === 0) { delete state.buffs[id]; close(id); return; }
  state.session.lastActiveAt = now;
  close(id);
  log.push({ id, start: now, end: now + durationMs });
  if (log.length > 400) log.splice(0, log.length - 400);
  state.buffs[id] = { id, subId, durationMs, startedAt: now, expiresAt: now + durationMs, reminded: false };
  const h = (state.buffHistory[id] ||= { count: 0, lastAt: null, lastDurationMs: 0 });
  h.count++; h.lastAt = now; h.lastDurationMs = durationMs;
}

// ---------------------------------------------------------------- login history (log3.txt)

const LOGIN_RE = /^\[(\S+) (로그인|로그아웃) 시간: (\d+)년 (\d+)월 (\d+)일 (\d+)시 (\d+)분 (\d+)초\]/;

function onLoginLine(line) {
  const m = LOGIN_RE.exec(line);
  if (!m) return;
  const account = m[1];
  const at = new Date(+m[3], +m[4] - 1, +m[5], +m[6], +m[7], +m[8]).getTime();
  if (m[2] === '로그인') {
    state.logins.push({ account, loginAt: at, logoutAt: null });
  } else {
    for (let i = state.logins.length - 1; i >= 0; i--) {
      const l = state.logins[i];
      if (l.account === account && l.logoutAt === null) { l.logoutAt = at; break; }
    }
  }
}

// ---------------------------------------------------------------- session records (history)

function sessionKey(s) {
  return `${s.file}@${s.startedAt}`;
}

function sessionRecord(s, endedAt, live) {
  const old = sessions[sessionKey(s)];
  const players = {};
  for (const p of Object.values(s.players)) {
    const prev = old?.players?.[p.name];
    players[p.name] = {
      zone: p.zone ?? prev?.zone ?? null,
      firstSeen: prev?.firstSeen ?? p.firstSeen ?? null,
      sightings: Math.max(p.sightings, prev?.sightings || 0),
      nearMs: Math.max(p.nearMs, prev?.nearMs || 0), // near time is only measured live; keep the best value
    };
  }
  return {
    key: sessionKey(s), file: s.file, character: s.character, account: s.account,
    serverId: s.serverId, channelId: s.channelId, startedAt: s.startedAt,
    endedAt, live,
    zones: timeByZone(s, endedAt), distanceByZone: s.distanceByZone, distance: s.distance,
    // active / AFK time is only measured live, so keep the best value across tracker restarts
    activeMs: Math.max(s.activeMs, old?.activeMs || 0), afkMs: Math.max(s.afkMs, old?.afkMs || 0),
    players, notices: s.notices.length,
    recap: old?.recap,
    // what the screen reader added up this session (EXP, kills, deaths, drops); kept across tracker restarts
    screen: (screenSession.key === sessionKey(s) && (screenSession.exp || screenSession.kills || screenSession.deaths) ? screenSession.view() : null) || old?.screen || null,
    // buffs are only seen live; keep whichever log is longer across tracker restarts
    buffLog: (s.buffLog.length >= (old?.buffLog?.length || 0) ? s.buffLog : old.buffLog).slice(-400),
  };
}

// ---- routes for session replay live in data/trails/<session>.json, apart from sessions.json
const TRAIL_DIR = path.join(store.DIR, 'trails');
fs.mkdirSync(TRAIL_DIR, { recursive: true });
const trailFile = (key) => path.join(TRAIL_DIR, `${String(key).replace(/[^\w.-]/g, '_')}.json`);
function saveTrack(s) {
  if (!s.file || !s.startedAt || !s.track.length) return;
  const f = trailFile(sessionKey(s));
  fs.writeFileSync(f + '.tmp', JSON.stringify(s.track));
  fs.renameSync(f + '.tmp', f);
}
// after re-reading a log, put back the timestamps an earlier tracker run had recorded live
function restoreTrackTimes(s) {
  let saved;
  try { saved = JSON.parse(fs.readFileSync(trailFile(sessionKey(s)), 'utf8')); } catch { return; }
  const n = Math.min(saved.length, s.track.length);
  for (let i = 0; i < n; i++) {
    const a = saved[i], b = s.track[i];
    if (a[1] !== b[1] || a[2] !== b[2] || a[3] !== b[3]) break;
    if (a[0] && !b[0]) b[0] = a[0];
  }
  if (saved.length > s.track.length) for (let i = s.track.length; i < saved.length; i++) s.track.push(saved[i]);
}

// a finished session ended when the game last wrote its log, not when the tracker happens to save it
const logEnd = (file) => { try { return fs.statSync(path.join(CLIENT_DIR, file)).mtimeMs; } catch { return null; } };

function saveSession(s, live) {
  if (!s.file || !s.startedAt) return;
  const now = Date.now();
  sessions[sessionKey(s)] = sessionRecord(s, live ? now : Math.min(now, logEnd(s.file) ?? now), live);
  store.writeJson('sessions.json', sessions);
  saveTrack(s);
}
const saveCurrentSession = (live) => saveSession(state.session, live);

// ---- session recap: one summary alert when a session you played (2+ minutes) ends
function sessionRecap(r) {
  const len = r.endedAt - r.startedAt;
  const tracked = (r.activeMs || 0) + (r.afkMs || 0);
  const zones = Object.entries(r.zones || {}).sort((a, b) => b[1] - a[1]);
  const names = Object.keys(r.players || {});
  const watched = names.filter(isWatched);
  const dangers = alerts.filter((a) => a.kind === 'danger' && a.t >= r.startedAt && a.t <= r.endedAt + 60000).length;
  const parts = [
    hm(len),
    tracked ? `${Math.round((r.activeMs / tracked) * 100)}% active` : null,
    zones[0] ? `mostly ${zoneName(zones[0][0])}${zones.length > 1 ? ` (+${zones.length - 1} more zone${zones.length > 2 ? 's' : ''})` : ''}` : null,
    `met ${names.length} player${names.length === 1 ? '' : 's'}`,
    watched.length ? `${watched.length} watched (${watched.slice(0, 3).join(', ')}${watched.length > 3 ? '…' : ''})` : null,
    dangers ? `${dangers} danger alert${dangers === 1 ? '' : 's'}` : null,
    r.distance ? `${Math.round(r.distance).toLocaleString('en-US')} distance` : null,
    // from the screen reader
    r.screen?.exp ? `EXP +${r.screen.exp.toFixed(1)}%${r.screen.levels ? ` (${r.screen.levels} level-up${r.screen.levels === 1 ? '' : 's'})` : ''}` : null,
    r.screen?.kills ? `${r.screen.kills} kills` : null,
    r.screen?.deaths ? `${r.screen.deaths} death${r.screen.deaths === 1 ? '' : 's'}` : null,
    r.screen?.drops ? `${r.screen.drops} drops announced for your party` : null,
    r.screen?.bestZone != null && r.screen.exp >= 1 ? `most EXP in ${zoneName(r.screen.bestZone)}` : null,
  ];
  // quests, quest items, gold, gear and what deaths cost (from the screen reader's windows)
  try { parts.push(...recapExtras(r.character, r.startedAt, r.endedAt)); } catch { /* data not ready */ }
  return parts.filter(Boolean).join(' · ');
}
function recapExtras(char, from, to) {
  if (!char) return [];
  const signed = (v) => `${v >= 0 ? '+' : '−'}${market.gold(Math.abs(v))}`;
  const quests = recapSum(char, 'quest', from, to), picked = recapSum(char, 'pickup', from, to);
  const mob = recapSum(char, 'expMob', from, to), quest = recapSum(char, 'expQuest', from, to);
  const pts = invWatch.history(char, 3).filter((p) => p.t >= from - 60000 && p.t <= to + 60000);
  const gold = pts.length >= 2 ? pts[pts.length - 1].gold - pts[0].gold : null;
  const gs = gearScores.history(char), before = gs.filter((p) => p.t < from).pop(), after = gs.filter((p) => p.t <= to).pop();
  const deathExp = farming.data.deaths.filter((d) => d.t >= from && d.t <= to && (!d.character || d.character === char)).reduce((s, d) => s + (d.expLost || 0), 0);
  return [
    quests ? `${quests} quest${quests === 1 ? '' : 's'} handed in` : null,
    picked ? `${picked} quest items` : null,
    recapSum(char, 'pvpKill', from, to) ? `${recapSum(char, 'pvpKill', from, to)} player${recapSum(char, 'pvpKill', from, to) === 1 ? '' : 's'} defeated` : null,
    recapSum(char, 'ki', from, to) ? `Ki +${market.gold(recapSum(char, 'ki', from, to))}` : null,
    recapSum(char, 'goldLoot', from, to) ? `gold picked up ${market.gold(recapSum(char, 'goldLoot', from, to))}` : null,
    mob + quest >= 0.5 ? `EXP ${Math.round((quest / (mob + quest)) * 100)}% from quests` : null,
    gold ? `gold ${signed(gold)}` : null,
    before && after && after.score !== before.score ? `gear score ${after.score - before.score > 0 ? '+' : ''}${after.score - before.score}` : null,
    deathExp ? `deaths cost ${Math.round(deathExp * 100) / 100}% EXP` : null,
  ];
}

function endSession(s = state.session) {
  saveSession(s, false);
  const r = s.file && s.startedAt ? sessions[sessionKey(s)] : null;
  if (!r || r.recap || r.endedAt - r.startedAt < 2 * 60000) return;
  r.recap = sessionRecap(r);
  store.writeJson('sessions.json', sessions);
  addAlert('recap', `Session recap: ${r.character || 'your character'}`, r.recap);
}

// Import sessions from older log_<pid>.txt files the tracker has not seen yet.
// the client also copies the running session's log to log2.txt: the same session must not count twice
const sameSession = (a, b) => a.startedAt === b.startedAt && a.character === b.character && a.file !== b.file;

function backfillSessions(skipFile) {
  let added = 0;
  // per-window logs (log_<pid>.txt) first, so they win over the log2.txt copy of the same session
  // (no game folder yet, e.g. installed to an unusual place: nothing to read; the setup check says where to set it)
  let names = []; try { names = fs.readdirSync(CLIENT_DIR); } catch (e) { console.log(`[tracker] game folder not readable (${CLIENT_DIR}): ${e.code || e.message}`); }
  const files = names.filter((f) => /^log(_\d+|\d*)\.txt$/i.test(f) && !/^log3\.txt$/i.test(f) && f !== skipFile)
    .sort((a, b) => (/^log_/i.test(b) - /^log_/i.test(a)) || a.localeCompare(b));
  for (const f of files) {
    const full = path.join(CLIENT_DIR, f);
    const s = freshSession(f);
    const t = new Tailer(full, { fromEnd: false, onLine: (line) => parseSessionLine(s, line, false) });
    t.poll(true);
    if (!s.startedAt || !s.character) continue;
    const key = sessionKey(s);
    if (sessions[key] && !sessions[key].live) continue;
    if (Object.values(sessions).some((r) => sameSession(r, s))) continue;
    sessions[key] = sessionRecord(s, fs.statSync(full).mtimeMs, false);
    if (!fs.existsSync(trailFile(key))) saveTrack(s);
    added++;
  }
  if (added) { store.writeJson('sessions.json', sessions); console.log(`[tracker] imported ${added} past session(s) from old logs`); }
}

// Older versions stored the log2.txt copy as a second session and let a finished session's end time
// move to whenever the tracker last saved it. Undo both (after a backup).
function repairSessions() {
  const list = Object.values(sessions);
  const pidLog = (r) => /^log_\d+\.txt$/i.test(r.file || '');
  const drop = list.filter((r) => !pidLog(r) && list.some((o) => pidLog(o) && o.startedAt === r.startedAt && o.character === r.character));
  const fix = list.filter((r) => { const m = r.file && logEnd(r.file); return m && Date.now() - m > 10 * 60000 && r.endedAt > m + 60000; });
  if (!drop.length && !fix.length) return;
  const backup = makeBackup().name;
  for (const r of drop) { delete sessions[r.key]; try { fs.unlinkSync(trailFile(r.key)); } catch { /* no route file */ } }
  for (const r of fix) if (sessions[r.key]) sessions[r.key].endedAt = logEnd(r.file);
  store.writeJson('sessions.json', sessions);
  console.log(`[tracker] repaired sessions: ${drop.length} duplicate(s) removed, ${fix.length} end time(s) corrected (backup ${backup})`);
}

// ---------------------------------------------------------------- game process detection

let sessionTailer = null;
const statusTailer = new Tailer(path.join(CLIENT_DIR, 'logStatusChange.txt'), { fromEnd: true, onLine: onStatusLine });
const loginTailer = new Tailer(path.join(CLIENT_DIR, 'log3.txt'), { fromEnd: false, onLine: onLoginLine });

function newestSessionLog() {
  try {
    return fs.readdirSync(CLIENT_DIR)
      .filter((f) => /^log_\d+\.txt$/.test(f))
      .map((f) => ({ f, t: fs.statSync(path.join(CLIENT_DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)[0]?.f ?? null;
  } catch { return null; }
}

// Read a client log from the start and keep following it.
function openSession(file) {
  const s = freshSession(file);
  const tailer = new Tailer(path.join(CLIENT_DIR, file), { fromEnd: false, onLine: (line, replay) => parseSessionLine(s, line, !replay) });
  tailer.poll(true); // replay what happened before the tracker started
  s.lastActiveAt = Date.now();
  const saved = sessions[sessionKey(s)]; // carry on counting from an earlier tracker run
  if (saved) { s.activeMs = saved.activeMs || 0; s.afkMs = saved.afkMs || 0; s.buffLog = (saved.buffLog || []).slice(); }
  restoreTrackTimes(s);
  return { session: s, tailer };
}

// Several game windows: the dashboard follows one (state.session); the others are tracked alongside.
const others = new Map(); // pid -> { pid, session, tailer, responding }
let focusPid = null;      // the window you picked to follow (null = keep the current one / the newest)
const logPid = (file) => +((/^log_(\d+)\.txt$/.exec(file || '') || [])[1]) || null;

function attachSession(pid, running, alive = []) {
  const file = pid ? `log_${pid}.txt` : newestSessionLog();
  if (!file || file === state.game.logFile) return;
  const oldPid = logPid(state.game.logFile);
  // the window we followed is still open: keep tracking it as a second character
  if (oldPid && alive.includes(oldPid) && !others.has(oldPid)) others.set(oldPid, { pid: oldPid, session: state.session, tailer: sessionTailer, responding: true });
  else if (state.game.logFile) endSession(); // close the previous session record
  state.game.logFile = file;
  const o = pid && others.get(pid);
  if (o) { others.delete(pid); state.session = o.session; sessionTailer = o.tailer; }
  else ({ session: state.session, tailer: sessionTailer } = openSession(file));
  state.buffs = {};
  console.log(`[tracker] following ${file}${running ? ` (pid ${pid})` : ' (game not running)'}`);
}

// the window whose log was written last
function newestPid(pids) {
  let best = null, bestT = -1;
  for (const pid of pids) {
    let t = 0;
    try { t = fs.statSync(path.join(CLIENT_DIR, `log_${pid}.txt`)).mtimeMs; } catch { /* log not created yet */ }
    if (t > bestT) { best = pid; bestT = t; }
  }
  return best;
}

// ---- disconnect / crash detection
let hang = { since: null, alerted: false };
let exitCheck = null; // { at, account, character, afk } while we wait to see whether a logout was logged

function checkExit(now) {
  if (!exitCheck || now - exitCheck.at < 20000) return;
  const { at, account, character, afk } = exitCheck;
  exitCheck = null;
  const loggedOut = state.logins.some((l) => l.account === account && l.logoutAt && l.logoutAt >= at - 3 * 60000);
  if (!loggedOut) {
    addAlert('disconnect', `${character || 'The game'} closed without logging out`,
      `No logout was recorded for ${account || 'your account'}${afk ? ' while you were AFK' : ''}. If you didn't close it yourself, the game crashed or lost its connection.`);
  }
}

function checkGameProcess() {
  // /V adds the window status ("Running" / "Not Responding"); SOF_TEST_TASKLIST: a file with fake output (tests)
  const tasklist = (cb) => (process.env.SOF_TEST_TASKLIST
    ? fs.readFile(process.env.SOF_TEST_TASKLIST, 'utf8', (e, out) => cb(null, e ? '' : out))
    : execFile('tasklist', ['/V', '/FI', 'IMAGENAME eq YGOnline.exe', '/FO', 'CSV', '/NH'], { windowsHide: true }, cb));
  tasklist((err, out) => {
    const rows = err ? [] : [...out.matchAll(/"YGOnline\.exe","(\d+)"(?:,"[^"]*"){3},"([^"]*)"/gi)].map((m) => ({ pid: +m[1], responding: !/not responding/i.test(m[2]) }));
    const pids = rows.map((r) => r.pid);
    const now = Date.now();
    const wasRunning = state.game.running;
    const prevPid = state.game.pid;
    // follow the window you picked, else the one already followed, else the newest
    if (focusPid && !pids.includes(focusPid)) focusPid = null;
    const pid = focusPid || (pids.includes(prevPid) ? prevPid : newestPid(pids));
    if (prevPid && !pids.includes(prevPid)) { // the followed window closed
      const s = state.session;
      exitCheck = { at: now, account: s.account, character: s.character, afk: s.lastActiveAt && now - s.lastActiveAt >= settings.afkMinutes * 60000 };
    }
    for (const [opid, o] of others) if (!pids.includes(opid)) { others.delete(opid); endSession(o.session); } // a second window closed
    state.game.running = !!pid;
    state.game.pid = pid;
    state.game.count = pids.length;
    state.game.responding = rows.find((r) => r.pid === pid)?.responding ?? true;
    if (pid) attachSession(pid, true, pids);
    else if (prevPid) endSession(); // last window closed: keep showing its log
    else if (!state.game.logFile) attachSession(null, false);
    for (const r of rows) {
      if (r.pid !== pid && !others.has(r.pid)) { others.set(r.pid, { pid: r.pid, ...openSession(`log_${r.pid}.txt`), responding: true }); console.log(`[tracker] also tracking log_${r.pid}.txt`); }
      const o = others.get(r.pid);
      if (o) o.responding = r.responding;
    }
    if (wasRunning && !pid && settings.autoOverlay) closeOverlay();
    if (!wasRunning && pid && settings.autoOverlay) openOverlay();
    if (!wasRunning && pid && Date.now() - state.trackerStartedAt > 60000) patches.check('game started'); // the launcher patches right before the game starts
    syncScreenReader();
    // how the game runs: CPU, memory, freezes (on the session timeline; an alert when it keeps freezing or its memory balloons)
    if (!err && !process.env.SOF_TEST_TASKLIST) {
      const sessOf = (p) => (p === pid ? state.session : others.get(p)?.session);
      const perf = gamePerf.sample(now, parseTasklist(out), (p) => ({ char: sessOf(p)?.character || null, zone: sessOf(p)?.position?.zone ?? null }));
      for (const f of perf.froze) {
        const s = sessOf(f.pid);
        if (s?.startedAt && f.ms >= 10000 && s === state.session) timelineFor(sessionKey(s))?.event(f.t, 'freeze', `${Math.round(f.ms / 1000)} s`);
      }
      if (perf.froze.length && gamePerf.recentFreezes(now).length >= 3 && warnOnce('freezes', now, 30 * 60000)) addAlert('patch', 'The game keeps freezing', `${gamePerf.recentFreezes(now).length} times in 10 minutes. Closing other programs, or restarting the game, often helps.`);
      for (const g of perf.memGrew) addAlert('patch', 'The game uses a lot more memory than at the start', `${g.from} MB → ${g.to} MB${sessOf(g.pid)?.character ? ` (${sessOf(g.pid).character})` : ''}. If it starts to stutter, restarting the game frees it.`);
    }
    // frozen window: alert once after 30 s
    if (pid && !state.game.responding) {
      hang.since ||= now;
      if (!hang.alerted && now - hang.since > 30000) { hang.alerted = true; addAlert('disconnect', 'The game is not responding', `${state.session.character || 'Your character'} has been frozen for over 30 seconds.`); }
    } else hang = { since: null, alerted: false };
    checkExit(now);
  });
}

// ---------------------------------------------------------------- overlay window

function openOverlay() {
  execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'overlay.ps1')], { windowsHide: true }, (err) => {
    if (err) console.log(`[tracker] overlay failed to open: ${err.message}`);
  });
}

function closeOverlay() {
  // the overlay runs as an Edge app window with its own profile folder, so only those Edge processes match
  const ps = "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | Where-Object { $_.CommandLine -like '*overlay-profile*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";
  execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true }, () => {});
}

// ---------------------------------------------------------------- daily play-time goals

const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function playedToday() {
  const key = dayKey(Date.now());
  return Object.values(calendar().days).reduce((sum, d) => sum + (d[key] || 0), 0);
}

const hm = (ms) => { const m = Math.round(ms / 60000); return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`; };

function checkGoals() {
  if (!state.game.running) return;
  const today = dayKey(Date.now());
  if (goalState.date !== today) goalState = { date: today, reminded: 0, goalHit: false, limitHit: false, lastNag: 0 };
  const ms = playedToday(), H = 3600000;
  let changed = false;
  if (settings.remindEveryHours > 0) {
    const n = Math.floor(ms / (settings.remindEveryHours * H));
    if (n > goalState.reminded) { goalState.reminded = n; changed = true; addAlert('goal', `You've played ${hm(ms)} today`, settings.limitHours ? `Daily limit: ${settings.limitHours}h` : ''); }
  }
  if (settings.goalHours > 0 && !goalState.goalHit && ms >= settings.goalHours * H) {
    goalState.goalHit = true; changed = true;
    addAlert('goal', 'Daily play goal reached', `${settings.goalHours}h played today`);
  }
  if (settings.limitHours > 0 && ms >= settings.limitHours * H) {
    if (!goalState.limitHit) { goalState.limitHit = true; goalState.lastNag = Date.now(); changed = true; addAlert('goal', 'Daily limit reached', `You've played ${hm(ms)} today. Time for a break?`); }
    else if (Date.now() - goalState.lastNag > 15 * 60000) { goalState.lastNag = Date.now(); changed = true; addAlert('goal', `Over your daily limit by ${hm(ms - settings.limitHours * H)}`, `${hm(ms)} played today`); }
  }
  if (changed) store.writeJson('goals.json', goalState);
}
// play in a row without a break (game open and not AFK): a reminder after settings.breakMinutes, then every 30 minutes
const breakWatch = new BreakWatch({ read: () => store.readJson('breaks.json', null), save: (d) => store.writeJson('breaks.json', d) });
function checkBreak(now) {
  const r = breakWatch.tick(now, { running: state.game.running, lastActiveAt: state.session.lastActiveAt }, { everyMin: settings.breakMinutes, pauseMin: settings.breakPauseMinutes });
  if (r) addAlert('goal', `You've played ${hm(r.ms)} without a break`, r.nag === 1 ? 'Stand up, stretch and rest your eyes for 5 minutes' : `Still going: a break of ${settings.breakPauseMinutes} minutes resets this`);
}

// ---------------------------------------------------------------- danger: enemy groups arriving

const myFaction = () => settings.myFaction || playerInfo(state.session.character)?.faction || null;

function nearbyThreats(now) {
  const mine = myFaction();
  const out = { enemies: [], unknown: [] };
  for (const p of Object.values(state.session.players)) {
    if (!p.lastSeen || now - p.lastSeen >= NEARBY_WINDOW_MS || p.own) continue; // (your own characters never count)
    const f = playerInfo(p.name)?.faction;
    if (!f) out.unknown.push(p);
    else if (mine && f !== mine) out.enemies.push(p);
  }
  return out;
}

// ---- danger memory: everyone who arrived in a danger alert is remembered and announced when seen again
let threats = store.readJson('threats.json', {}); // lowercased name -> { name, count, firstAt, lastAt, zones: { zone: n } }
const threatWarned = {};                           // lowercased name -> last "is back" warning (this run)
const isThreat = (name) => !!threats[String(name).toLowerCase()];

function flagThreats(names, now) {
  const zone = state.session.position?.zone;
  for (const name of names) {
    const k = name.toLowerCase();
    const t = (threats[k] ||= { name, count: 0, firstAt: now, lastAt: now, zones: {} });
    t.count++; t.lastAt = now;
    if (zone != null) t.zones[zone] = (t.zones[zone] || 0) + 1;
    threatWarned[k] = now; // they are here right now; don't also announce them as "back"
  }
  store.writeJson('threats.json', threats);
}

function onThreatArrival(name, now, s) {
  const k = name.toLowerCase(), t = threats[k];
  const byFriends = friends.threatBy(name);
  if ((!t && !byFriends.length) || now - (threatWarned[k] || 0) < 10 * 60000) return;
  threatWarned[k] = now;
  const i = playerInfo(name);
  addAlert('danger', t ? `⚠ ${name} is back` : `⚠ ${name} is near ${nearWho(s)}`, [
    t && s !== state.session && s.character && `near ${s.character}`,
    t && `in ${t.count} danger alert${t.count === 1 ? '' : 's'} before`,
    byFriends.length && `flagged by ${byFriends.join(', ')}`,
    i?.level && `Lv ${i.level}`, i?.faction, s.position && zoneName(s.position.zone),
  ].filter(Boolean).join(' · '));
}

let lastDangerAt = 0;
function checkDanger(now) {
  if (!state.game.running || now - lastDangerAt < 2 * 60000) return;
  const t = nearbyThreats(now);
  const pool = settings.dangerUnknown ? [...t.enemies, ...t.unknown] : t.enemies;
  const arrived = pool.filter((p) => p.nearSince && now - p.nearSince <= settings.dangerWindowSec * 1000);
  if (arrived.length < settings.dangerCount) return;
  lastDangerAt = now;
  flagThreats(arrived.map((p) => p.name), now);
  const known = arrived.filter((p) => t.enemies.includes(p)).length;
  const where = state.session.position ? ` in ${zoneName(state.session.position.zone)}` : '';
  addAlert('danger', `⚠ ${arrived.length} ${known === arrived.length ? 'enemies' : 'possible enemies'} just arrived${where}`,
    arrived.slice(0, 6).map((p) => { const i = playerInfo(p.name); return `${p.name}${i?.level ? ` Lv ${i.level}` : ''}${i?.faction ? '' : ' (?)'}`; }).join(', '));
}

// ---------------------------------------------------------------- per-second tick

let heatDirty = false, busyDirty = false;

function tick() {
  const now = Date.now();
  updateStatus();
  if (updateBlocked) return; // blocked until updated: no timers, alerts or counting
  const s = state.session;

  for (const [id, b] of Object.entries(state.buffs)) {
    if (b.expiresAt < now) { delete state.buffs[id]; continue; }
    if (!b.reminded && b.durationMs >= BUFF_REMIND_MIN_MS && b.expiresAt - now <= BUFF_REMIND_BEFORE_MS) {
      b.reminded = true;
      addAlert('buff', `${buffName(id)} ends in 1 minute`, 'Time to refresh it');
    }
  }

  for (const t of state.timers) {
    if (!t.warned && t.endsAt - now <= TIMER_WARN_BEFORE_MS) { t.warned = true; addAlert('timer', 'Starts in 1 minute', t.text); }
    if (!t.fired && t.endsAt <= now) { t.fired = true; addAlert('timer', 'Starting now', t.text); }
  }
  state.timers = state.timers.filter((t) => now - t.endsAt < 3 * 60000);
  news.tick();
  checkDanger(now);
  if (state.game.running) checkArrivals(now);
  bosses.tick(now, state.timers.map((t) => t.text));
  guideBosses.tick(now, guideBossCfg(now));
  passTimers.tick(now);
  customEvents.tick(now);
  try { checkEventPredictions(now); } catch { /* no events learned yet */ }
  checkSignups(now);
  checkBreak(now);

  if (!state.game.running) return;
  if (s.position) passTimers.zone(s.position.zone, now, { outer: settings.braceletHours });
  checkZoneRisk(now);
  if (s.position) checkGearFor(s.position.zone);
  if (s.position) try { checkHandIn(s.position.zone); } catch { /* quest data not ready */ }
  for (const o of others.values()) if (o.session?.character && o.session.position) try { checkHandIn(o.session.position.zone, o.session.character); } catch { /* skipped */ }
  let nearNow = 0;
  for (const p of Object.values(s.players)) if (p.lastSeen && now - p.lastSeen < NEARBY_WINDOW_MS) { p.nearMs += 1000; nearNow++; }
  // busy hours: average players around you per zone and hour of day
  if (s.position && isRealZone(s.position.zone)) {
    const h = new Date(now).getHours();
    const b = ((busy[s.position.zone] ||= {})[h] ||= { sec: 0, near: 0 });
    b.sec++; b.near += nearNow;
    busyDirty = true;
    const a = activityHour(now);
    a.sec++; a.nsec++; a.near += nearNow;
    activityDirty = true;
  }
  // second game windows: near time and active / AFK time
  for (const { session: o } of others.values()) {
    for (const p of Object.values(o.players)) if (p.lastSeen && now - p.lastSeen < NEARBY_WINDOW_MS) p.nearMs += 1000;
    if (o.startedAt) { if (now - (o.lastActiveAt || now) >= settings.afkMinutes * 60000) o.afkMs += 1000; else o.activeMs += 1000; }
  }
  if (s.startedAt) {
    if (now - (s.lastActiveAt || now) >= settings.afkMinutes * 60000) s.afkMs += 1000;
    else s.activeMs += 1000;
  }

  // the client only logs a position when you move, so standing still keeps counting at the last spot
  const pos = s.position;
  if (pos && isRealZone(pos.zone)) {
    const cells = (heatmap[pos.zone] ||= {});
    const key = `${Math.floor(pos.x / HEAT_CELL)},${Math.floor(pos.z / HEAT_CELL)}`;
    cells[key] = (cells[key] || 0) + 1;
    heatDirty = true;
  }
}

// ---------------------------------------------------------------- views for the UI

function snapshot() {
  const now = Date.now();
  const s = state.session;

  s.moveSamples = s.moveSamples.filter((x) => now - x.at < 60000);
  const recent = s.moveSamples.filter((x) => now - x.at < 10000).reduce((a, x) => a + x.d, 0);
  const zones = s.zoneHistory.filter((z) => isRealZone(z.zone));

  const players = Object.values(s.players)
    .map((p) => ({ ...p, nearby: p.lastSeen !== null && now - p.lastSeen < NEARBY_WINDOW_MS, info: playerInfo(p.name), watched: isWatched(p.name), threat: isThreat(p.name), friendThreat: friends.threatBy(p.name), friendWatch: friends.watchedBy(p.name) }))
    .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0) || b.sightings - a.sightings);

  const zone = s.position?.zone;
  return {
    now,
    serverTz: SERVER_TZ,
    labels: { ...labels, zones: zoneLabels() },
    game: state.game,
    trackerStartedAt: state.trackerStartedAt,
    session: {
      startedAt: s.startedAt,
      clientVersion: s.clientVersion,
      account: s.account,
      character: s.character,
      weaponClass: s.weaponClass,
      serverId: s.serverId,
      channelId: s.channelId,
      position: s.position,
      distance: s.distance,
      distanceByZone: s.distanceByZone,
      speed: recent / 10, // units per second over the last 10 s
      zoneEnteredAt: zones.length ? zones[zones.length - 1].at : null,
      zoneHistory: zones,
      timeByZone: timeByZone(s, now),
      trail: zone !== undefined ? s.trails[zone] || [] : [],
      players,
      selfInfo: playerInfo(s.character),
      notices: s.notices,
      lineCount: s.lineCount,
      activeMs: s.activeMs,
      afkMs: s.afkMs,
      idleMs: s.lastActiveAt ? now - s.lastActiveAt : 0,
    },
    settings,
    today: { ms: playedToday(), goalHours: settings.goalHours, limitHours: settings.limitHours, runMs: breakWatch.view(now)?.ms ?? null, breakMinutes: settings.breakMinutes },
    maps: zoneMaps,
    waypoints: [...waypoints, ...friends.waypoints(), ...guideMarks()],
    friends: { list: friends.list(), error: friends.error, lastSync: friends.lastSync, party: friends.party(now) },
    version: VERSION,
    update: updateView(),
    bossNext: bosses.stats(now).filter((b) => b.next).slice(0, 4).map(({ boss, next, intervalMs, spawns, confidence, lastEarth }) => ({ boss, next, intervalMs, spawns, confidence, lastEarth })),
    guideBoss: guideBosses.view(now, guideBossCfg(now)),
    passes: passTimers.view(now),
    dayNext: dayNext(now), // the next few things from the 24-hour plan (overlay, phone)
    zoneRisk: s.position && isRealZone(s.position.zone) && feat('danger') ? riskFor(s.position.zone, now) : null,
    clients: clientsView(now),
    gearCompare: (() => { const g = gearGold.gearCompare(); return g && now - g.t < 3 * 60000 ? g : null; })(),
    priceNow: (() => { const p = gearGold.priceNow(); return p && now - p.t < 60000 && (p.sell || p.buy || p.npcPrice) ? p : null; })(),
    questItems: (() => { const c = state.session.character; try { return c && feat('quests') ? questProgView(c) : []; } catch { return []; } })(),
    questNext: (() => { try { return feat('quests') ? questNext(state.session.character) : null; } catch { return null; } })(),
    expPts: (() => { try { return expPtsView(state.session.character, now); } catch { return null; } })(),
    expBoost: expBoost && now - expBoost.seenAt < 3 * 3600000 ? expBoost : null,
    tryNext: (() => { try { return state.game.running && settings.screenReader ? tryNextList(now) : null; } catch { return null; } })(),
    gold: (() => { const c = state.session.character, l = c && invWatch.last(c); return l ? { gold: l.gold, t: l.t, session: state.session.startedAt ? invWatch.rate(c, state.session.startedAt, now) : null } : null; })(),
    viewCharacter: myCharacter(),
    maze: mazeRuns.cur ? { start: mazeRuns.cur.start, exp: mazeRuns.cur.exp, kills: mazeRuns.cur.kills } : null,
    enhanceAuto: enhanceSession.active ? { level: enhanceSession.level, item: enhanceSession.item } : null,
    events: news.events(),
    maintenance: news.maintenance(),
    news: { fetchedAt: news.fetchedAt, error: news.error, posts: news.posts.map(({ idx, title, date, url, maintenance }) => ({ idx, title, date, url, maintenance: !!maintenance })) },
    danger: (() => { const t = nearbyThreats(now); return { myFaction: myFaction(), enemies: t.enemies.length, unknown: t.unknown.length }; })(),
    others: [...others.values()].map((o) => otherView(o, now)),
    screen: settings.screenReader ? { ...(screen || {}), status: screenReader.status, error: screenReader.error, pace, sessionKills: screenSession.kills, sessionExp: screenSession.exp, lastDrop: lastMineDrop ? { t: lastMineDrop.t, who: lastMineDrop.who, item: lastMineDrop.item } : null } : null,
    expGoal: expGoalView(),
    countdowns: (() => { try { return countdownsView(now); } catch { return []; } })(),
    patch: (() => { const r = patches.history[0]; return r ? { id: r.id, at: r.at, versionTo: r.versionTo } : null; })(),
    buffs: Object.values(state.buffs).sort((a, b) => a.expiresAt - b.expiresAt),
    buffHistory: state.buffHistory,
    timers: state.timers.map(({ id, title, text, endsAt }) => ({ id, title, text, endsAt })).sort((a, b) => a.endsAt - b.endsAt),
    alerts: alerts.slice(-30),
    watchlist,
    logins: state.logins.slice(-40).reverse(),
    rankings: { fetchedAt: rankings.fetchedAt, error: rankings.error, players: rankings.list(), boards: Object.values(RANKING_TABS) },
    notedCount: Object.keys(playerNotes).length,
  };
}

// a second game window, for the "Other characters" panel
function otherView(o, now) {
  const s = o.session, p = s.position;
  const mine = playerInfo(s.character)?.faction || null;
  const near = Object.values(s.players).filter((x) => x.lastSeen && now - x.lastSeen < NEARBY_WINDOW_MS)
    .map((x) => ({ name: x.name, info: playerInfo(x.name), watched: isWatched(x.name), threat: isThreat(x.name) }));
  return {
    pid: o.pid, responding: o.responding, character: s.character, account: s.account, startedAt: s.startedAt,
    zone: p && isRealZone(p.zone) ? p.zone : null, x: p ? p.x : null, z: p ? p.z : null,
    afk: !!(s.lastActiveAt && now - s.lastActiveAt >= settings.afkMinutes * 60000), idleMs: s.lastActiveAt ? now - s.lastActiveAt : 0,
    activeMs: s.activeMs, afkMs: s.afkMs, seen: Object.keys(s.players).length,
    nearby: near.length, enemies: mine ? near.filter((x) => x.info?.faction && x.info.faction !== mine).length : null,
    players: near.slice(0, 8), info: playerInfo(s.character),
    screen: altReaders.get(o.pid)?.screen ? { ...altReaders.get(o.pid).screen, status: altReaders.get(o.pid).reader.status } : null,
  };
}
// ---- party finder: "LF healer 120+ SF" in the chat, matched to the characters you have in the game
let lfgPosts = store.readJson('lfg.json', []);
const lfgSeen = new Map();
let zoneListCache = { db: null, v: [] };
const zoneList = () => (zoneListCache.db === gameDb ? zoneListCache.v : (zoneListCache = { db: gameDb, v: Object.entries(gameDb.zones).map(([id, name]) => ({ id: +id, name })) }).v);
function onLfg(e, t) {
  const plain = (x) => String(x || '').toLowerCase();
  if (!e.who || inGameChars().some((c) => plain(c) === plain(e.who))) return; // not your own posts
  const p = plans.lfgParse(e.text, zoneList());
  if (!p) return;
  if (t - (lfgSeen.get(plain(e.who)) || 0) < 10 * 60000) return; // one post per player every 10 minutes
  lfgSeen.set(plain(e.who), t);
  const fits = inGameChars().filter((c) => { const i = playerInfo(c) || {}; return plans.lfgFits(p, { level: i.level, cls: i.cls }); });
  const post = { t, who: e.who, text: String(e.text).slice(0, 200), ...p, fits };
  lfgPosts.push(post); lfgPosts = lfgPosts.filter((x) => t - x.t < 2 * 86400000).slice(-200);
  store.writeJson('lfg.json', lfgPosts);
  if (settings.partyFinder && feat('party') && fits.length) addAlert('party', `Party wanted: ${e.who}`, `${post.text}${fits.length ? ` · fits ${fits.join(', ')}` : ''}`);
}

// ---- goals with pace: level / Honor / gold / your own, by a date
let myGoals = store.readJson('my-goals.json', []);
function goalValue(g) {
  const i = playerInfo(g.char) || {};
  if (g.kind === 'level') return i.level != null ? i.level + (g.char === state.session.character && screen?.exp != null ? screen.exp / 100 : 0) : null;
  if (g.kind === 'honor') return i.honor ?? rankings.list().find((p) => p.name.toLowerCase() === String(g.char).toLowerCase())?.honor ?? null;
  if (g.kind === 'gold') return ascFor(g.char).gold || null;
  return g.value ?? 0;
}
const goalsView = (now = Date.now()) => myGoals.map((g) => { const v = goalValue(g); return { ...g, value: v, ...plans.goalPace(g, v ?? g.start?.value ?? 0, now) }; });
// once a day (at the digest hour, else 20:00): goals you're behind on
let goalNudgeDay = store.readJson('goal-nudge.json', { day: null }).day;
function checkGoalNudge() {
  const now = new Date(), hour = settings.digestHour >= 0 ? settings.digestHour : 20, day = dayKey(now.getTime());
  if (now.getHours() < hour || goalNudgeDay === day) return;
  goalNudgeDay = day; store.writeJson('goal-nudge.json', { day });
  const behind = goalsView().filter((g) => !g.done && !g.onPace);
  if (behind.length) addAlert('goal', `Behind on ${behind.length} goal${behind.length === 1 ? '' : 's'}`, behind.slice(0, 3).map((g) => `${g.label}: ${g.perDayNeeded != null ? `${Math.round(g.perDayNeeded * 100) / 100}/day needed` : 'overdue'}`).join(' · '));
}

// both game windows side by side: HP, EXP, zone, AFK, enemies, and why one needs you
function clientsView(now = Date.now()) {
  if (!state.game.running || !others.size) return [];
  const recent = (kind, ms, re) => alerts.some((a) => a.kind === kind && now - a.t < ms && (!re || re.test(a.title)));
  const card = ({ main, character, zone, hp, hpMax, exp, afk, enemies, status, idleMs }) => {
    const hpPct = hp != null && hpMax ? Math.round((hp / hpMax) * 100) : null, why = [];
    if (hpPct != null && hpPct < Math.max(30, settings.lowHpAlert || 0)) why.push(hpPct === 0 ? 'dead' : 'low HP');
    if (enemies) why.push(`${enemies} enem${enemies === 1 ? 'y' : 'ies'}`);
    if (status === 'hidden' || status === 'covered') why.push(status === 'hidden' ? 'minimised' : 'covered');
    if (main && recent('disconnect', 5 * 60000)) why.push('disconnected?');
    if (main && recent('whisper', 2 * 60000)) why.push('whisper');
    if (main && recent('stuck', 10 * 60000)) why.push('EXP stopped');
    return { main, character: character || null, zone: zone ?? null, zoneName: zone != null ? zoneName(zone) : null, hpPct, exp: exp ?? null, afk, idleMs, enemies: enemies || 0, attention: why };
  };
  const s = state.session, t = nearbyThreats(now);
  return [card({ main: true, character: s.character, zone: s.position && isRealZone(s.position.zone) ? s.position.zone : null, hp: screen?.hp, hpMax: screen?.hpMax, exp: screen?.exp,
    afk: !!(s.lastActiveAt && now - s.lastActiveAt >= settings.afkMinutes * 60000), idleMs: s.lastActiveAt ? now - s.lastActiveAt : 0, enemies: t.enemies.length, status: screenReader.status }),
  ...[...others.values()].map((o) => { const v = otherView(o, now); return card({ main: false, character: v.character, zone: v.zone, hp: v.screen?.hp, hpMax: v.screen?.hpMax, exp: v.screen?.exp, afk: v.afk, idleMs: v.idleMs, enemies: v.enemies, status: v.screen?.status }); })];
}
const liveKeys = () => new Set(state.game.running ? [sessionKey(state.session), ...[...others.values()].map((o) => sessionKey(o.session))] : []);

function sessionList() {
  const live = liveKeys();
  return Object.values(sessions)
    .map(({ players, ...r }) => ({ ...r, playerCount: Object.keys(players || {}).length, live: live.has(r.key) }))
    .sort((a, b) => b.startedAt - a.startedAt);
}

// Play time per day, from the client's login log plus the tracker's own session records.
function calendar() {
  const now = Date.now();
  const spans = [];
  const accounts = new Set();
  const newestOpen = {};
  for (const l of state.logins) if (!l.logoutAt) newestOpen[l.account] = l;
  for (const l of state.logins) {
    accounts.add(l.account);
    let end = l.logoutAt;
    if (!end) {
      const tracked = Object.values(sessions).find((r) => r.account === l.account && Math.abs(r.startedAt - l.loginAt) < 5 * 60000);
      if (tracked) end = tracked.endedAt;
      if (newestOpen[l.account] === l && state.game.running && state.session.account === l.account) end = now;
    }
    if (end && end > l.loginAt && end - l.loginAt < 48 * 3600000) spans.push({ account: l.account, from: l.loginAt, to: end });
  }
  const days = {}; // account -> { 'YYYY-MM-DD': ms }
  for (const sp of spans) {
    let t = sp.from;
    while (t < sp.to) {
      const d = new Date(t);
      const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
      const until = Math.min(next, sp.to);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const acc = (days[sp.account] ||= {});
      acc[key] = (acc[key] || 0) + (until - t);
      t = until;
    }
  }
  return { accounts: [...accounts], current: state.session.account, days, spans };
}

// ---------------------------------------------------------------- house (guild) tracker

function houseNames() {
  const set = new Map();
  for (const p of rankings.players.values()) if (p.house) set.set(p.house.toLowerCase(), p.house);
  for (const n of Object.values(playerNotes)) if (n.house) set.set(n.house.toLowerCase(), n.house);
  return [...set.values()].sort((a, b) => a.localeCompare(b));
}

function houseView(name) {
  const k = String(name || '').toLowerCase();
  if (!k) return { name: '', houses: houseNames() };
  const enc = encounters();
  const members = new Map();
  for (const p of rankings.players.values()) if ((p.house || '').toLowerCase() === k) members.set(p.name.toLowerCase(), { name: p.name, level: p.level, cls: p.cls, faction: p.faction, honor: p.honor, ranks: p.ranks, source: 'rankings' });
  for (const n of Object.values(playerNotes)) if ((n.house || '').toLowerCase() === k && !members.has(n.name.toLowerCase())) members.set(n.name.toLowerCase(), { name: n.name, level: n.level, cls: n.cls, faction: n.faction, source: 'notes' });
  const list = [...members.values()].map((m) => {
    const e = enc.find((x) => x.name.toLowerCase() === m.name.toLowerCase());
    const pr = rankings.predict(m.name);
    return { ...m, met: e ? e.sessions : 0, lastMet: e?.lastSeen || null, nearMs: e?.nearMs || 0, watched: isWatched(m.name), threat: isThreat(m.name), perDay: pr ? pr.perDay : null, nextLevelAt: pr ? pr.nextLevelAt : null };
  }).sort((a, b) => (b.level || 0) - (a.level || 0));
  const hist = rankings.historyRange(Date.now() - 30 * 86400000, Date.now());
  const all = hist.houses;
  const mine = all.find((h) => h.house.toLowerCase() === k);
  const faction = mine?.faction || list[0]?.faction || null;
  // strength over time vs. the 4 strongest other houses
  const rivals = all.filter((h) => h.house.toLowerCase() !== k).slice(0, 4).map((h) => h.house);
  const tracked = [mine?.house || name, ...rivals];
  const series = rankings.snapshots.filter((s) => s.t >= Date.now() - 30 * 86400000).map((s) => {
    const c = { t: s.t };
    for (const h of tracked) c[h] = s.p.filter((r) => (r[4] || '').toLowerCase() === h.toLowerCase()).length;
    return c;
  });
  return {
    name: mine?.house || name, faction, houses: houseNames(), members: list,
    rank: mine ? all.indexOf(mine) + 1 : null, stats: mine || null, tracked, series,
    metCount: list.filter((m) => m.met).length,
  };
}

// ---------------------------------------------------------------- stats: characters, patterns, busy hours, milestones

function busyView() {
  const out = {};
  for (const [zone, hours] of Object.entries(busy)) {
    out[zone] = { name: zoneName(zone), hours: Array.from({ length: 24 }, (_, h) => (hours[h] && hours[h].sec >= 60 ? { avg: hours[h].near / hours[h].sec, minutes: Math.round(hours[h].sec / 60) } : null)) };
  }
  return out;
}

// One-off: fill the activity hours from the sessions recorded before this existed
// (play time + players met; "players around you" is only measured live).
function backfillActivity() {
  if (activity.backfilled) return;
  for (const r of Object.values(sessions)) {
    if (!r.startedAt || !r.endedAt || r.endedAt > state.trackerStartedAt - 60000) continue; // live sessions are counted live
    for (let t = r.startedAt; t < r.endedAt;) {
      const next = Math.min(r.endedAt, hourStart(t) + 3600000);
      activityHour(t).sec += Math.round((next - t) / 1000);
      t = next;
    }
    for (const p of Object.values(r.players || {})) if (p.firstSeen && p.firstSeen >= r.startedAt - 60000) activityHour(p.firstSeen).met++;
  }
  activity.backfilled = true;
  store.writeJson('activity.json', activity);
}

const WEEKDAY = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
// weekday x hour grid in your time or the server's time, over the last `days` days (0 = everything)
function activityView(tz, days, metric) {
  const from = days ? Date.now() - days * 86400000 : 0;
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz === 'server' ? SERVER_TZ : undefined, weekday: 'short', hour: 'numeric', hourCycle: 'h23' });
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ sec: 0, nsec: 0, near: 0, met: 0 })));
  let sec = 0, nsec = 0, hours = 0;
  for (const [h, a] of Object.entries(activity.hours)) {
    if (+h < from || !a.sec) continue;
    const p = Object.fromEntries(fmt.formatToParts(new Date(+h)).map((x) => [x.type, x.value]));
    const c = grid[WEEKDAY[p.weekday]][+p.hour % 24];
    c.sec += a.sec; c.nsec += a.nsec; c.near += a.near; c.met += a.met;
    sec += a.sec; nsec += a.nsec; hours++;
  }
  const cells = grid.map((row) => row.map((c) => (c.sec < 300 ? null : {
    minutes: Math.round(c.sec / 60),
    metPerHour: c.met / (c.sec / 3600),
    avgNear: c.nsec >= 300 ? c.near / c.nsec : null,
  })));
  // busiest / quietest times with at least 15 minutes of play behind them
  const list = [];
  const score = (c) => (metric === 'near' ? c.avgNear : c.metPerHour);
  cells.forEach((row, d) => row.forEach((c, h) => { if (c && c.minutes >= 15 && score(c) != null) list.push({ day: d, hour: h, ...c }); }));
  list.sort((a, b) => score(b) - score(a));
  return {
    tz: tz === 'server' ? SERVER_TZ : Intl.DateTimeFormat().resolvedOptions().timeZone, days, metric,
    cells, playedMs: sec * 1000, measuredMs: nsec * 1000, hours,
    busiest: list.slice(0, 3), quietest: list.length > 3 ? list.slice(-3).reverse() : [],
  };
}

function milestoneCtx() {
  return stats.milestoneContext({
    sessions, spans: calendar().spans, alerts, waypoints, watchlist, trades,
    // only spawns you saw yourself count (friends' shared records don't earn your milestones)
    bossSpawns: new Set(bosses.log.filter((r) => r.kind !== 'caught').map((r) => `${r.boss}|${Math.round(r.at / 1200000)}`)).size,
    knownZones: Object.keys(KNOWN_ZONES),
  });
}

function milestonesView() {
  const c = milestoneCtx();
  return stats.MILESTONES.map(({ id, group, icon, title, test }) => ({ id, group, icon, title, earned: test(c), at: milestoneState?.[id] ?? null }));
}

// evaluated every minute; the very first run records what you already had without alerting
function checkMilestones() {
  const c = milestoneCtx();
  const first = !milestoneState;
  milestoneState ||= {};
  let changed = first;
  for (const m of stats.MILESTONES) {
    if (milestoneState[m.id] !== undefined || !m.test(c)) continue;
    // 0 = reached before the tracker was watching (unless the real moment is known)
    milestoneState[m.id] = (m.at && m.at(c)) || (first ? 0 : Date.now());
    changed = true;
    if (!first) addAlert('milestone', `Milestone: ${m.title}`, `${m.icon} ${m.group}`);
  }
  if (changed) store.writeJson('milestones.json', milestoneState);
}

// ---------------------------------------------------------------- automatic daily backup to a folder you choose

let backupState = store.readJson('backup-state.json', { lastAt: 0, lastFile: null, error: null });
function checkDailyBackup() {
  if (!settings.backupDir || Date.now() - backupState.lastAt < 24 * 3600000) return;
  try {
    if (!fs.existsSync(settings.backupDir)) throw new Error('Backup folder not found');
    const { name, buf } = makeBackup();
    fs.writeFileSync(path.join(settings.backupDir, name), buf);
    const old = fs.readdirSync(settings.backupDir).filter((f) => /^sof-data-.*\.zip$/.test(f)).sort().reverse();
    for (const f of old.slice(Math.max(1, settings.backupKeep))) fs.unlinkSync(path.join(settings.backupDir, f));
    backupState = { lastAt: Date.now(), lastFile: name, error: null };
  } catch (e) {
    backupState = { ...backupState, lastAt: Date.now() - 23 * 3600000, error: e.message }; // try again in an hour
  }
  store.writeJson('backup-state.json', backupState);
}

// ---------------------------------------------------------------- friends sync

function liveStatus() {
  const s = state.session, now = Date.now(), p = s.position;
  return {
    running: state.game.running, character: s.character || null,
    zone: p ? p.zone : null, x: p ? Math.round(p.x) : null, z: p ? Math.round(p.z) : null,
    afk: !!(state.game.running && s.lastActiveAt && now - s.lastActiveAt >= settings.afkMinutes * 60000),
    nearby: Object.values(s.players).filter((x) => x.lastSeen && now - x.lastSeen < NEARBY_WINDOW_MS).length,
  };
}

function syncFriends() {
  friends.sync({ dir: settings.syncDir, name: settings.syncName }, {
    version: VERSION,
    watchlist,
    threats,
    notes: playerNotes,
    waypoints: waypoints.map(({ id, zone, x, z, label, kind, note }) => ({ id, zone, x, z, label, kind, note })),
    live: settings.shareLive ? liveStatus() : null,
    bosses: bosses.shareRows(),
    // trade offers read from the chat in the last 30 days, pooled with friends for better price data
    offers: settings.shareMarket ? offers.filter((o) => o.itemId && o.price && Date.now() - o.t < 30 * 86400000).slice(-3000).map(({ t, who, side, itemId, item, price }) => ({ t, who, side, itemId, item, price })) : [],
    // your enhance tries, pooled with friends to pin down the real odds; the bosses you're coming to
    enhance: settings.shareEnhance ? enhanceLog.slice(-3000).map(({ t, level, charm, ok, sofCharm }) => ({ t, level, charm, ok, sofCharm })) : [],
    signups: signups.filter((s) => s.t > Date.now() - 3 * 3600000),
    gear: knownChars().map((c) => ({ char: c, score: charGearScore(c).score })).filter((g) => g.score > 0),
    // your quests in progress, so friends with the same ones can party up
    quests: knownChars().map((c) => ({ char: c, ids: questWatch.active(c)?.ids || [] })).filter((q) => q.ids.length),
  });
  bosses.setExtra(friends.bossRows());
}

// ---------------------------------------------------------------- update check (through the shared folder)

// all a page gets while the tracker is blocked: the update screen's content, nothing of your data
const blockedSnapshot = () => ({ blocked: true, now: Date.now(), version: VERSION, update: updateView(), settings: { lang: settings.lang } });
// what the dashboard shows about updates: the signed update file's verdict (lib/updater.js), plus a friend who runs
// a newer version (just a hint: installers are only ever taken from the signed update file)
function updateView() {
  const u = updateStatus(), fv = friends.newestVersion();
  return { ...u, friend: fv && version.valid(fv.version) && version.lt(VERSION, fv.version) ? fv : null };
}

// ---------------------------------------------------------------- groups: players who arrive together (lib/social.js)
let arrivals = store.readJson('arrivals.json', []); // [{ t, zone, names }] recorded live, newest last
let arrivalsDirty = false, lastArrivalCheck = 0;
const arrivalSeen = new Set(); // name|nearSince already put in a cluster
const groupAlerted = {};
function checkArrivals(now) {
  if (now - lastArrivalCheck < 5000) return;
  lastArrivalCheck = now;
  const s = state.session;
  const fresh = Object.values(s.players).filter((p) => !p.own && p.nearSince && now - p.nearSince < social.WINDOW * 2 && !arrivalSeen.has(`${p.name}|${p.nearSince}`));
  if (!fresh.length) return;
  const first = Math.min(...fresh.map((p) => p.nearSince));
  if (now - first < social.WINDOW) return; // wait until everyone who came with them is in
  const batch = fresh.filter((p) => p.nearSince - first <= social.WINDOW);
  for (const p of batch) arrivalSeen.add(`${p.name}|${p.nearSince}`);
  if (batch.length < 2 || batch.length > social.MAX_CLUSTER) return;
  // right after you change maps everyone "arrives" at once: that says nothing about them
  const lastMap = s.zoneHistory[s.zoneHistory.length - 1]?.at || 0;
  if (Math.abs(first - lastMap) < 20000) return;
  const names = batch.map((p) => p.name), zone = s.position?.zone ?? null;
  arrivals.push({ t: first, zone, names });
  if (arrivals.length > 5000) arrivals = arrivals.slice(-5000);
  arrivalsDirty = true; groupCache = null;
  for (const g of groupsView()) {
    const hit = names.filter((n) => g.members.some((m) => m.name === n));
    const key = g.members.map((m) => m.name).join('|');
    if (hit.length >= 2 && now - (groupAlerted[key] || 0) > 10 * 60000) {
      groupAlerted[key] = now;
      addAlert('watch', `Group arrived: ${hit.join(', ')}`, [`seen together ${g.together}×`, zone != null && zoneName(zone)].filter(Boolean).join(' · '));
    }
  }
}
let groupCache = null;
function groupsView() {
  if (groupCache && Date.now() - groupCache.at < 60000) return groupCache.list;
  const met = {}; for (const e of encounters()) met[e.name] = e.sessions;
  const list = social.findGroups([...arrivals, ...social.clustersFromSessions(sessions)], met).map((g) => ({
    ...g, members: g.members.map((n) => ({ name: n, info: playerInfo(n), watched: isWatched(n), threat: isThreat(n) })),
    zones: Object.entries(g.zones).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([z]) => zoneName(z)),
  }));
  groupCache = { at: Date.now(), list };
  return list;
}

function encounters() {
  const agg = {};
  for (const r of Object.values(sessions)) {
    for (const [name, p] of Object.entries(r.players || {})) {
      const a = (agg[name] ||= { name, sessions: 0, sightings: 0, nearMs: 0, firstSeen: null, lastSeen: null, zones: {} });
      a.sessions++;
      a.sightings += p.sightings || 0;
      a.nearMs += p.nearMs || 0;
      const seen = p.firstSeen || r.startedAt;
      if (seen && (!a.firstSeen || seen < a.firstSeen)) a.firstSeen = seen;
      if (seen && (!a.lastSeen || seen > a.lastSeen)) a.lastSeen = seen;
      if (p.zone != null) a.zones[p.zone] = (a.zones[p.zone] || 0) + 1;
    }
  }
  return Object.values(agg)
    .map((a) => ({ ...a, info: playerInfo(a.name), watched: isWatched(a.name), threat: isThreat(a.name) }))
    .sort((a, b) => b.sessions - a.sessions || b.nearMs - a.nearMs || b.sightings - a.sightings);
}

// ---------------------------------------------------------------- export & backup

function exportWorkbook() {
  const min = (ms) => (ms ? Math.round(ms / 60000) : 0);
  const sess = Object.values(sessions).sort((a, b) => b.startedAt - a.startedAt);
  const enc = encounters();
  const cal = calendar();
  const dayRows = [];
  for (const [acc, days] of Object.entries(cal.days)) for (const [d, ms] of Object.entries(days)) dayRows.push([d, acc, min(ms)]);
  dayRows.sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : a[1].localeCompare(b[1])));
  const rankRows = [];
  for (const snap of rankings.snapshots) for (const r of snap.p) rankRows.push([{ date: snap.t }, r[0], r[1], r[2], r[3], r[4], r[5], r[6]]);

  return workbook([
    {
      name: 'Sessions',
      columns: [{ header: 'Started', width: 17 }, { header: 'Ended', width: 17 }, { header: 'Character', width: 16 }, { header: 'Account', width: 14 }, { header: 'Server' }, { header: 'Channel' },
        { header: 'Minutes' }, { header: 'Active min' }, { header: 'AFK min' }, { header: 'Distance' }, { header: 'Players met' }, { header: 'Main zone', width: 22 }, { header: 'Zones (minutes)', width: 50 }],
      rows: sess.map((r) => {
        const zones = Object.entries(r.zones || {}).sort((a, b) => b[1] - a[1]);
        return [{ date: r.startedAt }, { date: r.endedAt }, r.character, r.account, r.serverId, r.channelId, min(r.endedAt - r.startedAt), min(r.activeMs), min(r.afkMs),
          Math.round(r.distance || 0), Object.keys(r.players || {}).length, zones[0] ? zoneName(zones[0][0]) : null, zones.map(([z, ms]) => `${zoneName(z)}: ${min(ms)}`).join(', ')];
      }),
    },
    {
      name: 'Encounters',
      columns: [{ header: 'Name', width: 18 }, { header: 'Level' }, { header: 'Class' }, { header: 'Faction', width: 12 }, { header: 'House', width: 14 }, { header: 'Sessions' },
        { header: 'Minutes near' }, { header: 'Sightings' }, { header: 'First met', width: 17 }, { header: 'Last met', width: 17 }, { header: 'Usual zone', width: 22 }, { header: 'Watched' }, { header: 'Note', width: 30 }],
      rows: enc.map((e) => {
        const z = Object.entries(e.zones).sort((a, b) => b[1] - a[1])[0];
        return [e.name, e.info?.level, e.info?.cls, e.info?.faction, e.info?.house, e.sessions, min(e.nearMs), e.sightings, { date: e.firstSeen }, { date: e.lastSeen }, z ? zoneName(z[0]) : null, e.watched ? 'yes' : '', e.info?.note];
      }),
    },
    { name: 'Daily play time', columns: [{ header: 'Date', width: 12 }, { header: 'Account', width: 14 }, { header: 'Minutes' }], rows: dayRows },
    {
      name: 'Rankings history',
      columns: [{ header: 'Snapshot', width: 17 }, { header: 'Name', width: 18 }, { header: 'Class' }, { header: 'Level' }, { header: 'Honor', width: 12 }, { header: 'House', width: 14 }, { header: 'Faction', width: 12 }, { header: 'Ranks', width: 30 }],
      rows: rankRows,
    },
    {
      name: 'Player notes',
      columns: [{ header: 'Name', width: 18 }, { header: 'Level' }, { header: 'Class' }, { header: 'Faction', width: 12 }, { header: 'House', width: 14 }, { header: 'Note', width: 40 }, { header: 'Updated', width: 17 }],
      rows: Object.values(playerNotes).map((n) => [n.name, n.level, n.cls, n.faction, n.house, n.note, { date: n.updatedAt }]),
    },
    {
      name: 'Alerts',
      columns: [{ header: 'Time', width: 17 }, { header: 'Type' }, { header: 'Alert', width: 40 }, { header: 'Details', width: 60 }],
      rows: alerts.slice().reverse().map((a) => [{ date: a.t }, a.kind, a.title, a.body]),
    },
    {
      name: 'Trades & drops',
      columns: [{ header: 'Time', width: 17 }, { header: 'Type' }, { header: 'Item', width: 30 }, { header: 'Qty' }, { header: 'Price', width: 14 }, { header: 'Total', width: 14 }, { header: 'With', width: 16 }, { header: 'Character', width: 14 }, { header: 'Zone', width: 18 }, { header: 'Note', width: 40 }],
      rows: trades.slice().reverse().map((t) => [{ date: t.t }, t.type, t.item, t.qty, t.price, t.price != null ? t.price * t.qty : null, t.with, t.character, t.zone != null ? zoneName(t.zone) : null, t.note]),
    },
    {
      name: 'Boss spawns',
      columns: [{ header: 'Boss', width: 26 }, { header: 'Spawn', width: 17 }, { header: 'Earth' }, { header: 'Confirmed' }, { header: 'Caught' }],
      rows: bosses.stats().flatMap((b) => bosses.spawns(b.boss).reverse().map((s) => [b.boss, { date: s.at }, s.earth, s.confirmed ? 'yes' : '', s.caught ? 'yes' : ''])),
    },
    {
      name: 'Gold ledger',
      columns: [{ header: 'Time', width: 17 }, { header: 'Character', width: 16 }, { header: 'Change', width: 16 }, { header: 'Gold after', width: 16 }, { header: 'What (probably)', width: 18 }, { header: 'Trade', width: 26 }],
      rows: Object.keys(invWatch.data.gold || {}).flatMap((k) => {
        const name = knownChars().find((c) => c.toLowerCase() === k) || k;
        const r = ledger.goldLedger(invWatch.data.gold[k], { exchanges: exchanges.map((e) => e.t), enhance: enhanceLog.filter((e) => !e.character || e.character.toLowerCase() === k).map((e) => e.t), trades: trades.filter((x) => !x.character || x.character.toLowerCase() === k) });
        return r.rows.map((x) => [{ date: x.t }, name, x.change, x.gold, x.cat, x.trade || null]);
      }),
    },
    {
      name: 'Quest history',
      columns: [{ header: 'Handed in', width: 17 }, { header: 'Character', width: 16 }, { header: 'Quest', width: 40 }, { header: 'Level' }, { header: 'First seen', width: 17 }, { header: 'Minutes' }, { header: 'EXP', width: 14 }],
      rows: quests.questLog().slice().reverse().map((q) => [{ date: q.end }, q.char, q.name, q.level, q.start ? { date: q.start } : null, q.start ? Math.round((q.end - q.start) / 60000) : null, q.exp || null]),
    },
    {
      name: 'Gear log',
      columns: [{ header: 'Character', width: 16 }, { header: 'Slot' }, { header: 'Item', width: 36 }, { header: '+' }, { header: 'Level' }, { header: 'Attack', width: 12 }, { header: 'Defense' }, { header: 'Options', width: 50 }, { header: 'Element', width: 14 }, { header: 'Awakening' }, { header: 'Last seen', width: 17 }],
      rows: gearLog.list().map((g) => [g.char, g.slot, g.name, g.plus || 0, g.level, g.attack ? g.attack.join('–') : null, g.defense, (g.options || []).join('; '), g.element ? `${g.element.name} ${g.element.level}${g.element.bonus ? `+${g.element.bonus}` : ''}` : null, g.souled, { date: g.lastSeen }]),
    },
  ]);
}

const stamp = () => { const d = new Date(); return `${dayKey(d)}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`; };

// Zip every file in data/ (not the overlay browser profile) into backups/ and return the archive.
function makeBackup() {
  saveCurrentSession(state.game.running);
  if (heatDirty) { store.writeJson('heatmap.json', heatmap); heatDirty = false; }
  const files = fs.readdirSync(store.DIR, { withFileTypes: true })
    .filter((f) => f.isFile() && !f.name.endsWith('.tmp'))
    .map((f) => { const full = path.join(store.DIR, f.name); return { name: `data/${f.name}`, data: fs.readFileSync(full), mtime: fs.statSync(full).mtime }; });
  const buf = zip(files);
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const name = `sof-data-${stamp()}.zip`;
  fs.writeFileSync(path.join(BACKUP_DIR, name), buf);
  console.log(`[tracker] backup written: backups/${name}`);
  return { name, buf };
}

// ---------------------------------------------------------------- clean-up tools (always back up first)

const RESETS = ['heatmap', 'busy', 'activity','alerts', 'bosses', 'rankings', 'trades', 'waypoints', 'notes', 'watchlist', 'threats', 'milestones', 'encounters', 'sessions'];

function cleanup(b) {
  const backup = makeBackup().name; // safety copy first, so every clean-up can be undone
  const liveKey = state.game.running ? sessionKey(state.session) : null;
  let done = '';
  if (b.action === 'delete-sessions') {
    const keys = (Array.isArray(b.keys) ? b.keys : []).filter((k) => sessions[k] && k !== liveKey);
    for (const k of keys) { delete sessions[k]; try { fs.unlinkSync(trailFile(k)); } catch { /* no route file */ } }
    store.writeJson('sessions.json', sessions);
    done = `${keys.length} session(s) deleted`;
  } else if (b.action === 'merge-character') {
    const from = String(b.from || '').trim(), to = String(b.to || '').trim();
    if (!from || !to || from === to) throw new Error('Pick two different characters');
    let n = 0;
    for (const r of Object.values(sessions)) if (r.character === from) { r.character = to; n++; }
    store.writeJson('sessions.json', sessions);
    done = `${n} session(s) moved from ${from} to ${to}`;
  } else if (b.action === 'reset') {
    const what = b.what;
    if (!RESETS.includes(what)) throw new Error('Unknown data type');
    const clear = (o) => { for (const k of Object.keys(o)) delete o[k]; };
    switch (what) {
      case 'heatmap': clear(heatmap); store.writeJson('heatmap.json', heatmap); break;
      case 'busy': clear(busy); store.writeJson('busy.json', busy); break;
      case 'activity': clear(activity.hours); activity.cur = { h: 0, names: [] }; activityNames = new Set(); activity.backfilled = true; store.writeJson('activity.json', activity); break;
      case 'alerts': alerts.length = 0; store.writeJson('alerts.json', alerts); break;
      case 'bosses': bosses.log = []; try { fs.unlinkSync(path.join(store.DIR, 'bosses.jsonl')); } catch { /* none yet */ } break;
      case 'rankings':
        rankings.snapshots = rankings.snapshots.slice(-1); // keep the current boards
        fs.writeFileSync(path.join(store.DIR, 'rankings.jsonl'), rankings.snapshots.map((s) => JSON.stringify(s) + '\n').join(''));
        break;
      case 'trades': trades = []; store.writeJson('trades.json', trades); break;
      case 'waypoints': waypoints = []; store.writeJson('waypoints.json', waypoints); break;
      case 'notes': playerNotes = {}; store.writeJson('players.json', playerNotes); break;
      case 'watchlist': watchlist = []; store.writeJson('watchlist.json', watchlist); break;
      case 'threats': threats = {}; store.writeJson('threats.json', threats); break;
      case 'milestones': milestoneState = null; try { fs.unlinkSync(path.join(store.DIR, 'milestones.json')); } catch { /* none */ } break;
      case 'encounters': for (const r of Object.values(sessions)) r.players = {}; for (const p of Object.values(state.session.players)) p.nearMs = 0; store.writeJson('sessions.json', sessions); break;
      case 'sessions':
        for (const k of Object.keys(sessions)) if (k !== liveKey) { delete sessions[k]; try { fs.unlinkSync(trailFile(k)); } catch { /* none */ } }
        store.writeJson('sessions.json', sessions);
        break;
    }
    done = `${what} reset`;
  } else throw new Error('Unknown clean-up action');
  console.log(`[tracker] clean-up: ${done} (backup ${backup})`);
  return { done, backup };
}

// ---------------------------------------------------------------- diagnostics bundle (for reporting problems)

function diagnostics() {
  const read = (f, tail) => { try { const t = fs.readFileSync(f, 'utf8'); return tail ? t.split('\n').slice(-tail).join('\n') : t; } catch { return ''; } };
  const safeSettings = { ...settings };
  const info = {
    version: VERSION, node: process.version, os: `${os.type()} ${os.release()}`, clientDir: CLIENT_DIR, clientDirFound: fs.existsSync(CLIENT_DIR),
    game: state.game, sessions: Object.keys(sessions).length, alerts: alerts.length, rankingsSnapshots: rankings.snapshots.length,
    guide: { monsters: guide.monsters.length, quests: guide.quests.length, npcs: guide.npcs.length, items: guide.items.length },
    friends: friends.list().length, notifyEnabled: notifier.enabled(), maps: Object.keys(zoneMaps), time: new Date().toString(),
  };
  const files = [
    { name: 'info.json', data: JSON.stringify(info, null, 2) },
    { name: 'settings.json', data: JSON.stringify(safeSettings, null, 2) },
    { name: 'tracker.log', data: read(path.join(store.DIR, 'tracker.log')) },
    { name: 'tracker-errors.log', data: read(path.join(store.DIR, 'tracker-errors.log')) },
  ];
  if (state.game.logFile) files.push({ name: `game-${state.game.logFile}`, data: read(path.join(CLIENT_DIR, state.game.logFile), 400) });
  return zip(files);
}

function listBackups() {
  try {
    return fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.zip'))
      .map((f) => { const st = fs.statSync(path.join(BACKUP_DIR, f)); return { name: f, size: st.size, at: st.mtimeMs }; })
      .sort((a, b) => b.at - a.at);
  } catch { return []; }
}

// ---------------------------------------------------------------- start with Windows

function setAutostart(on, cb) {
  if (!on) { try { fs.unlinkSync(STARTUP_LNK); } catch { /* already gone */ } return cb(null); }
  const q = (s) => s.replace(/'/g, "''");
  const ps = `$s = (New-Object -ComObject WScript.Shell).CreateShortcut('${q(STARTUP_LNK)}');` +
    `$s.TargetPath = "$env:WINDIR\\System32\\wscript.exe"; $s.Arguments = '"${q(path.join(__dirname, 'tray.vbs'))}"';` +
    `$s.WorkingDirectory = '${q(__dirname)}'; $s.Description = 'Scions of Fate tracker'; $s.Save()`;
  execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true }, (err, _o, stderr) => cb(err ? String(stderr || err.message).trim() : null));
}

// ---------------------------------------------------------------- player profile

function playerProfile(name) {
  const k = name.toLowerCase();
  const meetings = [];
  for (const r of Object.values(sessions)) {
    const hit = Object.entries(r.players || {}).find(([n]) => n.toLowerCase() === k);
    if (hit) meetings.push({ name: hit[0], at: hit[1].firstSeen || r.startedAt, character: r.character, zone: hit[1].zone, nearMs: hit[1].nearMs || 0, sightings: hit[1].sightings || 0, session: r.key });
  }
  meetings.sort((a, b) => b.at - a.at);
  const zones = {};
  for (const m of meetings) if (m.zone != null) zones[m.zone] = (zones[m.zone] || 0) + 1;
  const ranked = rankings.players.get(k) || null;
  return {
    name: ranked?.name || meetings[0]?.name || playerNotes[k]?.name || name,
    info: playerInfo(name), note: playerNotes[k] || null, ranked,
    history: rankings.playerHistory(name).points,
    meetings, zones, watched: isWatched(name), threat: threats[k] || null,
    prediction: (() => { const p = rankings.predict(name); return p ? { level: p.level, perDay: p.perDay, nextLevelAt: p.nextLevelAt, basedOn: p.basedOn } : null; })(),
    friendThreat: friends.threatBy(name), friendWatch: friends.watchedBy(name),
    alerts: alerts.filter((a) => `${a.title} ${a.body}`.toLowerCase().includes(k)).slice(-20).reverse(),
    // when they're usually around: the times you met them (also in groups) and their ranking changes
    schedule: (() => {
      const seen = [...meetings.map((m) => ({ t: m.at, zone: m.zone })), ...arrivals.filter((c) => c.names.some((n) => n.toLowerCase() === k)).map((c) => ({ t: c.t, zone: c.zone }))];
      const s = social.playerSchedule({ seen, rankPoints: rankings.playerHistory(name).points });
      return { ...s, zones: s.zones.map((z) => ({ ...z, name: zoneName(z.zone) })) };
    })(),
    groups: groupsView().filter((g) => g.members.some((m) => m.name.toLowerCase() === k)),
    // your PvP record with them (from the game's "You defeated …" / "You died by …" messages)
    pvp: pvp[k] ? { kills: pvp[k].kills, deaths: pvp[k].deaths, lastAt: pvp[k].lastAt } : null,
  };
}

// ---------------------------------------------------------------- waypoints (your own map markers)

let waypoints = store.readJson('waypoints.json', []); // [{ id, zone, x, z, label, kind, at }]

// ---------------------------------------------------------------- weekly report

const weekStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.getTime(); }; // Monday 00:00

// a week (from its Monday) or any span: a month when `endAt` is given
function weeklyReport(ws, endAt = null) {
  const we = new Date(ws); we.setDate(we.getDate() + 7);
  const end = endAt || we.getTime();
  // play time per day (all accounts) from the login log
  const cal = calendar();
  const days = [];
  for (let d = new Date(ws); d.getTime() < end; d.setDate(d.getDate() + 1)) {
    const key = dayKey(d.getTime());
    const byAccount = {};
    for (const [acc, dd] of Object.entries(cal.days)) if (dd[key]) byAccount[acc] = dd[key];
    days.push({ day: key, ms: Object.values(byAccount).reduce((a, b) => a + b, 0), byAccount });
  }
  const accounts = {};
  for (const d of days) for (const [a, ms] of Object.entries(d.byAccount)) accounts[a] = (accounts[a] || 0) + ms;

  // tracked sessions that started this week
  const ss = Object.values(sessions).filter((r) => r.startedAt >= ws && r.startedAt < end);
  const zones = {}, met = {};
  let active = 0, afk = 0, distance = 0;
  const scr = { exp: 0, kills: 0, deaths: 0, drops: 0, levels: 0 };
  for (const r of ss) {
    active += r.activeMs || 0; afk += r.afkMs || 0; distance += r.distance || 0;
    if (r.screen) for (const k of Object.keys(scr)) scr[k] += r.screen[k] || 0;
    for (const [z, ms] of Object.entries(r.zones || {})) zones[z] = (zones[z] || 0) + ms;
    for (const [n, p] of Object.entries(r.players || {})) {
      if (p.own || isOwnChar(n)) continue; // your own characters are not people you met
      const m = (met[n] ||= { name: n, sessions: 0, nearMs: 0 });
      m.sessions++; m.nearMs += p.nearMs || 0;
    }
  }
  // players met this week for the very first time
  const firstSeen = {};
  for (const r of Object.values(sessions)) for (const [n, p] of Object.entries(r.players || {})) {
    const t = p.firstSeen || r.startedAt;
    if (!firstSeen[n] || t < firstSeen[n]) firstSeen[n] = t;
  }
  const metList = Object.values(met);
  const r = rankings.historyRange(ws, end);
  const fac = r.factions;
  return {
    weekStart: ws, weekEnd: end,
    playMs: days.reduce((a, d) => a + d.ms, 0), days, accounts,
    sessions: ss.length, activeMs: active, afkMs: afk, distance,
    screen: scr.exp || scr.kills || scr.deaths ? { ...scr, exp: Math.round(scr.exp * 10) / 10 } : null,
    // the usual selling prices that changed most against the week before (from the chat)
    movers: watch.marketMovers(marketOffers(), ws, end - ws),
    zones: Object.entries(zones).sort((a, b) => b[1] - a[1]).map(([zone, ms]) => ({ zone, name: zoneName(zone), ms })),
    playersMet: metList.length,
    newPlayers: metList.filter((m) => firstSeen[m.name] >= ws).length,
    topPlayers: metList.sort((a, b) => b.sessions - a.sessions || b.nearMs - a.nearMs).slice(0, 10).map((m) => ({ ...m, info: playerInfo(m.name), watched: isWatched(m.name), threat: isThreat(m.name) })),
    watchedMet: metList.filter((m) => isWatched(m.name)).map((m) => m.name),
    dangerAlerts: alerts.filter((a) => a.kind === 'danger' && a.t >= ws && a.t < end).length,
    recaps: ss.filter((x) => x.recap).sort((a, b) => a.startedAt - b.startedAt).map((x) => ({ at: x.startedAt, character: x.character, recap: x.recap })),
    rankings: { snapshots: r.snapshots, fastest: r.fastest.slice(0, 8), honor: r.honor.slice(0, 8), climbers: r.climbers.slice(0, 8),
      factionsStart: fac[0] || null, factionsEnd: fac[fac.length - 1] || null },
    // you: potions, enhancing, maze runs, Honor gained (from the rankings)
    mine: (() => {
      const me = myCharacter(), pts = me ? rankings.playerHistory(me).points.filter((p) => p.honor != null && p.t >= ws && p.t < end) : [];
      return { ...mySummary(ws, end, me), character: me, honorGained: pts.length >= 2 ? pts[pts.length - 1].honor - pts[0].honor : null };
    })(),
    // deaths: how many, who killed you, where
    deaths: (() => {
      const list = farming.data.deaths.filter((d) => d.t >= ws && d.t < end), by = (f) => { const m = {}; for (const d of list) { const k = f(d); if (k) m[k] = (m[k] || 0) + 1; } return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 5); };
      return { count: list.length, toPlayers: list.filter((d) => d.killer).length, killers: by((d) => d.killer), zones: by((d) => zoneName(d.zone)), expLost: Math.round(list.reduce((a, d) => a + (d.expLost || 0), 0) * 100) / 100 };
    })(),
    // enchanting and combining luck (the game's messages) and enhancing (the enhance log)
    craft: (() => {
      const out = { enchant: { ok: 0, n: 0 }, combine: { ok: 0, n: 0 }, enhance: { ok: 0, n: 0 } };
      for (const c of craftLog) if (c.t >= ws && c.t < end) { out[c.kind].n++; if (c.ok) out[c.kind].ok++; }
      for (const e of enhanceLog) if (e.t >= ws && e.t < end) { out.enhance.n++; if (e.ok) out.enhance.ok++; }
      return out;
    })(),
    // your best monsters (all the fighting the tracker saw, not only this span)
    mobs: (() => { const me = myCharacter(); try { return me ? mobStatsView(me).mobs.filter((m) => m.expPerHour).slice(0, 5).map(({ name, level, kills, expPerHour, expPerKill, secPerKill }) => ({ name, level, kills, expPerHour, expPerKill, secPerKill })) : []; } catch { return []; } })(),
  };
}
// months for the report: 'YYYY-MM' → [start, end)
const monthRange = (m) => { const [y, mo] = m.split('-').map(Number); return [new Date(y, mo - 1, 1).getTime(), new Date(y, mo, 1).getTime()]; };
function reportFor(params) {
  const months = [], now = new Date();
  for (let i = 0; i < 12; i++) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
  const weeks = [];
  for (let i = 0, w = weekStart(Date.now()); i < 12; i++, w = weekStart(w - 86400000)) weeks.push(dayKey(w));
  const m = params.get('month');
  if (m && /^\d{4}-\d{2}$/.test(m)) { const [a, b] = monthRange(m); return { ...weeklyReport(a, b), weeks, months, month: m, week: null }; }
  const q = params.get('week');
  const ws = q && /^\d{4}-\d{2}-\d{2}$/.test(q) ? weekStart(new Date(q + 'T12:00:00').getTime()) : weekStart(weekStart(Date.now()) - 86400000);
  return { ...weeklyReport(ws), weeks, months, week: dayKey(ws), month: null };
}

// ---- the daily EXP goal (Live card, alert once a day, streak)
let goalCache = { at: 0, v: null };
function expGoalView() {
  if (!settings.expGoal) return null;
  if (Date.now() - goalCache.at > 15000) goalCache = { at: Date.now(), v: extras.goalProgress({ sessions: Object.values(sessions), goal: settings.expGoal, dayOf: dayKey }) };
  return goalCache.v;
}
let expGoalState = store.readJson('exp-goal.json', { day: null });
function checkExpGoal() {
  const g = expGoalView();
  if (!g?.reached || expGoalState.day === dayKey(Date.now())) return;
  expGoalState = { day: dayKey(Date.now()) }; store.writeJson('exp-goal.json', expGoalState);
  addAlert('goal', `EXP goal reached: +${g.today.toFixed(1)}% today`, g.streak > 1 ? `${g.streak} days in a row` : '');
}

// ---- personal records (an alert when one is beaten); seeded from the sessions already saved
let records = store.readJson('records.json', null);
if (!records) {
  records = {};
  for (const r of Object.values(sessions)) if (r.screen) extras.beatRecords(records, { sessionExp: { v: r.screen.exp, text: r.character }, sessionKills: { v: r.screen.kills, text: r.character } }, r.startedAt);
  store.writeJson('records.json', records);
}
function checkRecords(extra = {}) {
  if (!settings.screenReader) return;
  const s = state.session, ss = screenSession, now = Date.now(), vals = { ...extra };
  if (ss.key && ss.key === (s.file && s.startedAt ? sessionKey(s) : null)) {
    vals.sessionExp = { v: Math.round(ss.exp * 100) / 100, text: s.character };
    vals.sessionKills = { v: ss.kills, text: s.character };
    // minutes played this session without a death (only when the reader saw the whole session)
    if (!ss.deaths && s.startedAt && readerStats.since && readerStats.since - s.startedAt < 5 * 60000) vals.cleanSession = { v: Math.round((now - s.startedAt) / 60000), text: s.character };
  }
  // EXP in the last full hour of reading
  if (expSamples.length && expSamples[expSamples.length - 1].t - expSamples[0].t >= 55 * 60000) { const r = screenreader.expRate(expSamples, 60 * 60000); if (r) vals.expHour = { v: Math.round(r.perHour * 100) / 100, text: s.character }; }
  const beaten = extras.beatRecords(records, vals, now);
  for (const b of beaten) {
    const fmt = (id, v) => (id === 'cleanSession' ? hm(v * 60000) : id === 'rareDrop' ? `1 in ${Math.round(1 / v)}` : id === 'sessionKills' ? String(v) : `${v.toFixed(1)}%`);
    addAlert('milestone', `New record: ${b.label}`, `${b.text ? `${b.text}: ` : ''}${fmt(b.id, b.v)} (was ${fmt(b.id, b.was)})`);
  }
  if (beaten.length || Object.keys(vals).length) store.writeJson('records.json', records);
}

// ---- what to say for the "status" hotkey (Ctrl+Shift+S, spoken by the tray)
function voiceStatus(lang = uiLang()) {
  const T = (s, p) => i18n.t(lang, s, p);
  if (!state.game.running) return T('The game is not running.');
  const parts = [], sc = screen, now = Date.now();
  const spoken = (ms) => { const m = Math.round(ms / 60000); return m >= 60 ? T('{h} hours {m} minutes', { h: Math.floor(m / 60), m: m % 60 }) : T('{m} minutes', { m }); };
  if (sc?.hp != null) parts.push(T('HP {hp} of {max}', { hp: sc.hp, max: sc.hpMax }));
  if (sc?.exp != null) parts.push(T('EXP {p} percent', { p: sc.exp.toFixed(1) }));
  if (sc?.toNextMs) parts.push(T('next level in about {d}', { d: spoken(sc.toNextMs) }));
  const tm = state.timers.filter((x) => x.endsAt > now).sort((a, b) => a.endsAt - b.endsAt)[0];
  const b = bosses.stats(now).filter((x) => x.next && x.next > now).sort((a, c) => a.next - c.next)[0];
  if (tm) parts.push(T('{what} in {d}', { what: tm.title.replace(/…/g, '').slice(0, 60), d: spoken(tm.endsAt - now) }));
  else if (b) parts.push(T('next boss {boss} in about {d}', { boss: b.boss, d: spoken(b.next - now) }));
  const en = nearbyThreats(now).enemies.length;
  if (en) parts.push(T('{n} enemies nearby', { n: en }));
  return parts.length ? `${parts.join('. ')}.` : T('No readings yet: is the screen reader on?');
}

// ---- tracker health: CPU and memory of the tracker and its screen readers, once a minute for a day
const health = { samples: [], warnedDay: null };
// the game's own CPU, memory and freezes (lib/gameperf.js), from the 5-second process check
const gamePerf = new GamePerf({ read: () => store.readJson('game-perf.json', null), save: (d) => store.writeJson('game-perf.json', d), cores: os.cpus().length });
let lastCpu = process.cpuUsage(), lastCpuAt = Date.now(), readerCpu = new Map();
function sampleHealth() {
  const now = Date.now(), cores = os.cpus().length || 1;
  const c = process.cpuUsage(), dt = Math.max(1, now - lastCpuAt);
  const trackerPct = ((c.user - lastCpu.user + c.system - lastCpu.system) / 1000 / dt / cores) * 100;
  lastCpu = c; lastCpuAt = now;
  const pids = [screenReader.proc?.pid, ...[...altReaders.values()].map((a) => a.reader.proc?.pid)].filter(Boolean);
  const done = (readerPct, readerMb) => {
    health.samples.push({ t: now, tracker: Math.round(trackerPct * 10) / 10, reader: readerPct == null ? null : Math.round(readerPct * 10) / 10, trackerMb: Math.round(process.memoryUsage().rss / 1048576), readerMb });
    if (health.samples.length > 1440) health.samples.shift();
    // using a lot for 10 minutes: say so once a day
    const last = health.samples.slice(-10), avg = last.reduce((a, s) => a + s.tracker + (s.reader || 0), 0) / last.length;
    if (last.length === 10 && avg > 25 && health.warnedDay !== dayKey(now)) {
      health.warnedDay = dayKey(now);
      addAlert('patch', `The tracker uses ${Math.round(avg)}% CPU`, 'For 10 minutes now. Reading the screen less often (Settings → Screen reader) or switching off the second window lowers it.');
    }
  };
  if (!pids.length || process.env.SOF_TEST_FRAMES) return done(null, null);
  // CPU time of the reader processes (tasklist: no extra PowerShell needed)
  execFile('tasklist', ['/V', '/FO', 'CSV', '/NH', '/FI', 'IMAGENAME eq powershell.exe'], { windowsHide: true }, (err, out) => {
    if (err) return done(null, null);
    let pct = 0, mb = 0;
    for (const m of out.matchAll(/^"[^"]*","(\d+)","[^"]*","[^"]*","([\d.,\s]+) K","[^"]*","[^"]*","(\d+):(\d+):(\d+)"/gm)) {
      const pid = +m[1];
      if (!pids.includes(pid)) continue;
      const secs = +m[3] * 3600 + +m[4] * 60 + +m[5], prev = readerCpu.get(pid);
      if (prev) pct += ((secs - prev.secs) / ((now - prev.t) / 1000) / cores) * 100;
      readerCpu.set(pid, { secs, t: now });
      mb += Math.round(+m[2].replace(/[^\d]/g, '') / 1024);
    }
    done(pct, mb);
  });
}
setInterval(sampleHealth, 60000);

// ---- updates (lib/updater.js): the signed update file from release.config.json, checked at start and every
// 6 hours (every 15 minutes while blocked). Below the minimum version, withdrawn, or unable to check for longer than
// the offline grace, the tracker is blocked: its pages show only the update screen and its data routes answer 426.
// (SOF_RELEASE_CONFIG: another config file, for the tests)
const RELEASE = (() => { try { return JSON.parse(fs.readFileSync(process.env.SOF_RELEASE_CONFIG || path.join(__dirname, 'release.config.json'), 'utf8')); } catch { return {}; } })();
const updater = new Updater({
  current: VERSION, dir: path.join(store.DIR, 'updates'),
  config: { manifestUrl: process.env.SOF_UPDATE_URL || RELEASE.manifestUrl || '', publicKeys: RELEASE.publicKeys || [], downloadHosts: RELEASE.downloadHosts,
    allowInsecureLocal: process.env.SOF_UPDATE_INSECURE_LOCAL === '1' }, // (only for the tests: http to this PC)
  read: () => store.readJson('update-state.json', null), save: (s) => store.writeJson('update-state.json', s),
  // the installer runs on its own: it stops this tracker, replaces the files in this folder and starts the new one
  // (SOF_UPDATE_SETUP_ARGS: extra setup arguments, for the tests)
  spawn: (file, args) => spawn(file, [...args, '-InstallDir', __dirname, ...(process.env.SOF_UPDATE_SETUP_ARGS || '').split(' ').filter(Boolean)], { detached: true, stdio: 'ignore' }).unref(),
  log: (m) => console.log(`[tracker] ${m}`),
});
// a development copy (the project folder with the release tool, not an installed tracker) is never blocked or
// updated in place: update it with git. SOF_TREAT_AS_INSTALLED=1 makes it act installed (the tests).
const DEV_CHECKOUT = fs.existsSync(path.join(__dirname, 'scripts', 'release.js')) && process.env.SOF_TREAT_AS_INSTALLED !== '1';
let updateCache = { at: 0, v: null };
const updateStatus = () => {
  const t = Date.now();
  if (t - updateCache.at > 1000) {
    const s = updater.status();
    updateCache = { at: t, v: DEV_CHECKOUT ? { ...s, devCheckout: true, wouldBlock: s.blocked, blocked: false } : s };
    updateBlocked = updateCache.v.blocked;
  }
  return updateCache.v;
};
const isBlocked = () => updateStatus().blocked;
let updateAlerted = store.readJson('update-alerted.json', { key: null });
function noteUpdate() {
  updateCache.at = 0;
  const u = updateStatus();
  const key = u.blocked ? `${u.state}:${u.target?.version || ''}` : u.state === 'optional' ? `optional:${u.target.version}` : null;
  if (!key || updateAlerted.key === key) return;
  updateAlerted = { key }; store.writeJson('update-alerted.json', updateAlerted);
  if (u.state === 'optional') addAlert('update', `SoF Tracker ${u.target.version} is available`, 'Install it from the banner on the dashboard.');
  else if (u.state === 'offline') addAlert('update', 'SoF Tracker could not check for updates', 'Connect to the internet and open the dashboard to continue.');
  else addAlert('update', `Update required: SoF Tracker ${u.target?.version || u.latest || ''}`.trim(), u.reason || 'Install the update to keep using the tracker.');
  if (u.blocked) { syncScreenReader(); bot.stop(); }
}
async function checkUpdates() { await updater.check(); noteUpdate(); }
{
  const r = updater.confirmInstall();
  if (r.updated) setTimeout(() => addAlert('update', `Updated to SoF Tracker ${r.updated.to}`, `from ${r.updated.from}; your data and settings were kept`), 3000);
  if (r.failed) setTimeout(() => addAlert('update', 'The update did not finish', `${r.failed.reason} Try again from the dashboard, or download the setup yourself.`), 3000);
}
if (!process.env.SOF_OFFLINE || process.env.SOF_UPDATE_URL) {
  setTimeout(checkUpdates, 3000);
  setInterval(() => { if (isBlocked() || Date.now() - (updater.s.lastAttemptAt || 0) > 6 * 3600000) checkUpdates(); }, 15 * 60000);
}

// ---- storage: how much room the screen reader's records take, and clearing them (Settings)
function dirSize(dir) {
  let bytes = 0, files = 0;
  try { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) { const s = dirSize(p); bytes += s.bytes; files += s.files; } else { bytes += fs.statSync(p).size; files++; } } } catch { /* missing */ }
  return { bytes, files };
}
const fileSize = (name) => { try { return fs.statSync(path.join(store.DIR, name)).size; } catch { return 0; } };
// the overlay window's browser keeps a cache that can grow large; these folders are safe to empty (settings stay)
const OVERLAY_CACHE = ['Cache', 'Code Cache', 'GPUCache', 'Service Worker', 'DawnCache', 'GrShaderCache', 'ShaderCache'];
// what Edge downloads into a profile by itself (shopping, wallet, language models…): the overlay needs none of it
const OVERLAY_COMPONENTS = ['component_crx_cache', 'ProvenanceData', 'Edge Entity Extraction', 'Edge Wallet', 'Edge Shopping', 'Subresource Filter', 'BrowserMetrics',
  'EdgeLanguageDetectionModel', 'Speech Recognition', 'hyphen-data', 'extensions_crx_cache', 'OnDeviceHeadSuggestModel', 'Trust Protection Lists', 'WidevineCdm', 'SmartScreen', 'Crashpad'];
const overlayCacheDirs = () => { const root = path.join(store.DIR, 'overlay-profile'); return [...OVERLAY_CACHE.map((d) => path.join(root, 'Default', d)), ...OVERLAY_CACHE.map((d) => path.join(root, d)), ...OVERLAY_COMPONENTS.map((d) => path.join(root, d))]; };
function storageView() {
  // saved pictures only: the ring folders are the reader's last few looks, overwritten all the time
  const shotsSize = { bytes: 0 };
  try { for (const e of fs.readdirSync(SHOT_DIR, { withFileTypes: true })) if (!/^ring/.test(e.name)) shotsSize.bytes += e.isDirectory() ? dirSize(path.join(SHOT_DIR, e.name)).bytes : fs.statSync(path.join(SHOT_DIR, e.name)).size; } catch { /* none yet */ }
  const tl = dirSize(TIMELINE_DIR), all = dirSize(store.DIR);
  const overlay = overlayCacheDirs().reduce((a, d) => a + dirSize(d).bytes, 0);
  const disk = (() => { try { const s = fs.statfsSync(store.DIR); return { free: s.bavail * s.bsize, size: s.blocks * s.bsize }; } catch { return null; } })();
  const tidyable = tidyItems().reduce((a, x) => a + x.bytes, 0);
  return {
    total: all.bytes, dir: store.DIR, disk, tidy: { mb: settings.tidyMB, days: settings.tidyDays, bytes: tidyable, ...tidyState },
    parts: [
      { what: 'chat', label: 'Chat log', bytes: fileSize('chat.json'), count: chatLog.entries.length },
      { what: 'offers', label: 'Trade offers', bytes: fileSize('market.json'), count: offers.length },
      { what: 'drops', label: 'Drop announcements', bytes: fileSize('drops.json'), count: drops.length },
      { what: 'pictures', label: 'Death replays & drop pictures', bytes: shotsSize.bytes, count: shots.deaths.length + shots.drops.length },
      { what: 'timelines', label: 'Session timelines', bytes: tl.bytes, count: tl.files },
      { what: 'overlay', label: 'Overlay window cache', bytes: overlay, count: null },
      // older than 90 days: one trade offer per item, side and day; one rankings snapshot per day
      { what: 'slim', label: 'Old trade offers and rankings (thinned, not deleted)', bytes: null, count: slimPlan().removable },
    ],
  };
}
// thinning: what would go (older than 90 days, more than one per item / side / day, or more than one snapshot a day)
function slimPlan(now = Date.now()) {
  const cut = now - 90 * 86400000, keepOffer = new Map(), dropOffers = new Set(), keepSnap = new Set(), dropSnaps = new Set();
  for (const o of offers) {
    if (o.t >= cut) continue;
    const k = `${o.itemId || o.item}|${o.side}|${dayKey(o.t)}`;
    if (keepOffer.has(k)) dropOffers.add(o); else keepOffer.set(k, o);
  }
  for (const s of rankings.snapshots) { if (s.t >= cut) continue; const d = dayKey(s.t); if (keepSnap.has(d)) dropSnaps.add(s); else keepSnap.add(d); }
  return { dropOffers, dropSnaps, removable: dropOffers.size + dropSnaps.size };
}
// automatic tidy-up (Settings → Storage): death replays, drop pictures, debug captures and old session timelines are
// kept within settings.tidyMB and settings.tidyDays, oldest first. Runs once a day, and from the "Tidy up now" button.
let tidyState = store.readJson('tidy.json', { lastAt: 0, removed: 0, freed: 0 });
function tidyItems() {
  const items = [], size = (p) => { try { const s = fs.statSync(p); return s.isDirectory() ? dirSize(p).bytes : s.size; } catch { return 0; } };
  for (const d of shots.deaths) items.push({ t: d.t, bytes: size(path.join(SHOT_DIR, d.id)), drop: () => { fs.rmSync(path.join(SHOT_DIR, d.id), { recursive: true, force: true }); shots.deaths = shots.deaths.filter((x) => x !== d); } });
  for (const d of shots.drops) items.push({ t: d.t, bytes: size(path.join(SHOT_DIR, `${d.id}.jpg`)), drop: () => { fs.rmSync(path.join(SHOT_DIR, `${d.id}.jpg`), { force: true }); shots.drops = shots.drops.filter((x) => x !== d); } });
  try {
    for (const f of fs.readdirSync(DEBUG_DIR)) {
      const p = path.join(DEBUG_DIR, f);
      // (the sharp Status-window pictures stay: they rebuild the digit reader)
      if (/\.(json|jpg|png)$/.test(f) && !/^status-sharp-/.test(f)) items.push({ t: fs.statSync(p).mtimeMs, bytes: size(p), drop: () => fs.rmSync(p, { force: true }) });
    }
  } catch { /* none yet */ }
  const cur = timeline?.key ? timelineFile(timeline.key) : null;
  try { for (const f of fs.readdirSync(TIMELINE_DIR)) { const p = path.join(TIMELINE_DIR, f); if (p !== cur) items.push({ t: fs.statSync(p).mtimeMs, bytes: size(p), drop: () => fs.rmSync(p, { force: true }) }); } } catch { /* none yet */ }
  return items.sort((a, b) => a.t - b.t);
}
function autoTidy(now = Date.now(), force = false) {
  if (!force && (now - tidyState.lastAt < 24 * 3600000 || (!settings.tidyMB && !settings.tidyDays))) return { removed: 0, freed: 0 };
  const items = tidyItems(), out = [];
  if (settings.tidyDays > 0) for (const x of items) if (now - x.t > settings.tidyDays * 86400000) out.push(x);
  if (settings.tidyMB > 0) {
    let total = items.reduce((a, x) => a + x.bytes, 0) - out.reduce((a, x) => a + x.bytes, 0);
    for (const x of items) { if (total <= settings.tidyMB * 1048576) break; if (!out.includes(x)) { out.push(x); total -= x.bytes; } }
  }
  let freed = 0;
  for (const x of out) try { x.drop(); freed += x.bytes; } catch { /* in use */ }
  if (out.length) store.writeJson('shots.json', shots);
  tidyState = { lastAt: now, removed: out.length, freed };
  store.writeJson('tidy.json', tidyState);
  if (out.length) console.log(`[tracker] tidy-up: ${out.length} old pictures / captures / timelines, ${Math.round(freed / 1048576)} MB`);
  return { removed: out.length, freed };
}
function clearStorage(what) {
  if (what === 'chat') { chatLog.entries.length = 0; store.writeJson('chat.json', []); chatDirty = false; }
  else if (what === 'offers') { offers = []; store.writeJson('market.json', offers); marketDirty = false; }
  else if (what === 'drops') { drops = []; store.writeJson('drops.json', drops); dropsDirty = false; }
  else if (what === 'pictures') {
    for (const x of [...shots.deaths.map((d) => d.id), ...shots.drops.map((d) => `${d.id}.jpg`)]) try { fs.rmSync(path.join(SHOT_DIR, x), { recursive: true, force: true }); } catch { /* gone */ }
    shots = { deaths: [], drops: [] }; store.writeJson('shots.json', shots);
  } else if (what === 'timelines') {
    // older than 30 days (the current session's is kept)
    for (const f of fs.readdirSync(TIMELINE_DIR)) { const p = path.join(TIMELINE_DIR, f); try { if (Date.now() - fs.statSync(p).mtimeMs > 30 * 86400000) fs.unlinkSync(p); } catch { /* gone */ } }
  } else if (what === 'overlay') {
    // only the cache folders; files the open overlay is using stay (they are cleared next time)
    for (const d of overlayCacheDirs()) try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* in use */ }
  } else if (what === 'slim') {
    makeBackup(); // a safety copy first
    const p = slimPlan();
    if (p.dropOffers.size) { offers = offers.filter((o) => !p.dropOffers.has(o)); store.writeJson('market.json', offers); marketDirty = false; }
    if (p.dropSnaps.size) {
      rankings.snapshots = rankings.snapshots.filter((s) => !p.dropSnaps.has(s));
      fs.writeFileSync(path.join(store.DIR, 'rankings.jsonl'), rankings.snapshots.map((s) => JSON.stringify(s) + '\n').join(''));
    }
  } else throw new Error('Unknown part');
  return storageView();
}

// ---- the daily digest (phone / Discord): today's play, EXP, kills, deaths, drops, whispers and the best deals
let digestState = store.readJson('digest.json', { day: null });
function dailyDigest(now = Date.now()) {
  const d0 = new Date(now); d0.setHours(0, 0, 0, 0);
  const from = d0.getTime(), today = Object.values(sessions).filter((r) => (r.endedAt || now) > from && r.startedAt < now);
  const sum = (k) => today.reduce((a, r) => a + (r.screen?.[k] || 0), 0);
  const wh = alerts.filter((a) => a.kind === 'whisper' && a.t >= from);
  const deals = offers.filter((o) => o.t >= from && o.deal).sort((a, b) => b.deal - a.deal).slice(0, 3);
  const mineDrops = drops.filter((x) => x.t >= from && [state.session.character, ...today.map((r) => r.character)].filter(Boolean).map((n) => n.toLowerCase()).includes(String(x.who).toLowerCase()));
  const my = mySummary(from, now + 1, state.session.character);
  return {
    title: `Today: ${hm(playedToday())} played`,
    body: [sum('exp') && `EXP +${sum('exp').toFixed(1)}%`, sum('kills') && `${sum('kills')} kills`, sum('deaths') && `${sum('deaths')} death${sum('deaths') === 1 ? '' : 's'}`,
      mineDrops.length && `drops: ${mineDrops.slice(0, 3).map((x) => x.item).join(', ')}`,
      wh.length && `${wh.length} whisper${wh.length === 1 ? '' : 's'} (${wh.slice(-3).map((a) => a.title.replace(/^Whisper from /, '')).join(', ')})`,
      deals.length && `best deals: ${deals.map((o) => `${o.item} ${market.gold(o.price)} (−${o.deal}%)`).join(', ')}`,
      (my.hpPots || my.mpPots) && `potions: ${my.hpPots} HP, ${my.mpPots} MP${my.potionCost ? ` (~${market.gold(my.potionCost)})` : ''}`,
      (my.enhOk || my.enhFail) && `enhancing: ${my.enhOk} worked, ${my.enhFail} failed`,
      my.mazeRuns && `maze: ${my.mazeRuns} run${my.mazeRuns === 1 ? '' : 's'}, EXP +${my.mazeExp.toFixed(1)}%`,
      my.goldChange && `gold ${my.goldChange > 0 ? '+' : '−'}${market.gold(Math.abs(my.goldChange))}`,
      my.questsDone && `${my.questsDone} quest${my.questsDone === 1 ? '' : 's'} handed in`,
      my.ki && `Ki +${market.gold(my.ki)}`, my.goldLoot && `gold picked up ${market.gold(my.goldLoot)}`,
      my.expQuest + my.expMob >= 0.5 && `EXP ${Math.round((my.expQuest / (my.expQuest + my.expMob)) * 100)}% from quests`,
      my.netWorthChange && `net worth ${my.netWorthChange > 0 ? '+' : '−'}${market.gold(Math.abs(my.netWorthChange))}`,
      my.gearScoreChange && `gear score ${my.gearScoreChange > 0 ? '+' : ''}${my.gearScoreChange}`,
      my.deathExp && `deaths cost ${my.deathExp}% EXP`].filter(Boolean).join(' · '),
  };
}
function checkDigest() {
  const now = new Date();
  if (settings.digestHour < 0 || now.getHours() < settings.digestHour) return;
  const day = dayKey(now.getTime());
  if (digestState.day === day) return;
  digestState = { day }; store.writeJson('digest.json', digestState);
  if (!playedToday()) return; // nothing played today: no digest
  const d = dailyDigest();
  addAlert('digest', d.title, d.body);
}

let reportState = store.readJson('report.json', { alertedWeek: null });
function checkWeeklyReport() {
  const lastWeek = weekStart(weekStart(Date.now()) - 86400000);
  if (reportState.alertedWeek === lastWeek) return;
  reportState.alertedWeek = lastWeek;
  store.writeJson('report.json', reportState);
  const rep = weeklyReport(lastWeek);
  if (!rep.playMs && !rep.sessions) return; // nothing played: no report alert
  addAlert('report', `Weekly report: week of ${new Date(lastWeek).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`,
    [`${hm(rep.playMs)} played`, `${rep.sessions} tracked sessions`, `met ${rep.playersMet} players (${rep.newPlayers} new)`, rep.zones[0] && `mostly ${rep.zones[0].name}`,
      rep.screen?.exp && `EXP +${rep.screen.exp}%`, rep.screen?.kills && `${rep.screen.kills} kills`, rep.screen?.deaths && `${rep.screen.deaths} death${rep.screen.deaths === 1 ? '' : 's'}`,
      ...rep.movers.slice(0, 2).map((m) => `${m.item} ${m.change > 0 ? '+' : ''}${m.change}% (${market.gold(m.now)})`)].filter(Boolean).join(' · '));
}

// ---------------------------------------------------------------- game database & 3D world

const ICON_DIR = path.join(GAME_DIR, 'datas', 'interface', 'ITEM');
const ICON_CACHE = path.join(store.DIR, 'icons');

// ---- screen reader: HP / MP / EXP from the HUD and loot announcements from the chat (lib/screenreader.js)
let screen = null;             // latest reading for the dashboard
let drops = store.readJson('drops.json', []); // [{ t, who, item, itemId, from, mobId }] announced loot, newest last
const expSamples = [];
let lowHpAt = 0, dropsDirty = false;
let lastMineDrop = null; // the last announced drop of you / your party (stream widget)
let offers = store.readJson('market.json', []);           // trade offers read from the chat, newest last
const farming = new Farming(store.readJson('farming.json', null));
let marketDirty = false, farmingDirty = false;
// the offers prices are worked out from: yours plus those your friends' trackers read (friends sync), each once
let marketCache = { key: null, list: [] };
function marketOffers() {
  const key = `${offers.length}|${offers[offers.length - 1]?.t}|${friends.lastSync}|${settings.shareMarket}`;
  if (marketCache.key !== key) marketCache = { key, list: settings.shareMarket ? mergeOffers(offers, friends.offers()) : offers };
  return marketCache.list;
}
// ---- potions, the cost of a farming spot, the shopping list, the next 24 hours
const itemByName = (name) => gameDb.items.find((i) => i.name === name) || null;
// what an item costs: the usual chat price (90 days), else what the game's shop data says
function itemPrice(it) {
  const p = it && market.priceStats(marketOffers().filter((o) => o.itemId === it.id), 90)[0];
  return p?.sell ? { price: p.sell, from: 'chat' } : it?.price ? { price: it.price, from: 'shop' } : { price: null, from: null };
}
// ---- the game's per-character files (lib/gamecfg.js): skill bars, auto-combat setups, game settings, your roster.
// Read again at most once a minute; a change in the game settings is remembered and put on the session timeline.
let gameCfg = { at: 0, chars: new Map(), options: null, roster: { accounts: {}, names: new Set() } };
let optionLog = store.readJson('game-options.json', { options: null, history: [] }); // history: [{ t, changes: [{ key, from, to }] }]
function gameFiles(now = Date.now()) {
  if (now - gameCfg.at < 60000) return gameCfg;
  const skills = new Map(gameDb.skills.map((s) => [s.id, s])), items = new Map(gameDb.items.map((s) => [s.id, s]));
  gameCfg = { at: now, chars: gamecfg.readCharacterFiles(CLIENT_DIR, (id) => skills.has(id) || items.has(id)), options: gamecfg.readOptions(CLIENT_DIR), roster: gamecfg.readRoster(CLIENT_DIR) };
  const changes = gamecfg.optionChanges(optionLog.options, gameCfg.options);
  if (gameCfg.options && (!optionLog.options || changes.length)) {
    if (optionLog.options && changes.length) {
      optionLog.history = [{ t: now, changes }, ...optionLog.history].slice(0, 50);
      if (state.session.startedAt) timelineFor(sessionKey(state.session))?.event(now, 'settings', changes.map((c) => `${c.key} ${c.from} → ${c.to}`).join(', '));
    }
    optionLog.options = gameCfg.options;
    store.writeJson('game-options.json', optionLog);
  }
  return gameCfg;
}
// a character that logged in on this PC (one of yours): not a "player met", never a danger
const isOwnChar = (name) => !!name && (gameFiles().roster.names.has(String(name).toLowerCase()) || inGameChars().some((c) => c.toLowerCase() === String(name).toLowerCase()));
// a character's skill bar and auto-combat setup, with names, cooldowns and what to improve
function skillSetup(char) {
  const c = char && gameFiles().chars.get(String(char).toLowerCase());
  const skills = new Map(gameDb.skills.map((s) => [s.id, s])), items = new Map(gameDb.items.map((s) => [s.id, s])), cds = cooldownMap();
  const named = (slots) => (slots || []).map(({ slot, id }) => {
    const s = skills.get(id), it = items.get(id);
    return s ? { slot, id, kind: 'skill', name: s.name, level: s.level, cls: s.cls, cost: s.cost || null, cooldownMs: cds.get(id) || null, desc: s.desc || '' }
      : { slot, id, kind: gamecfg.ACTION_IDS.has(id) ? 'action' : 'item', name: it?.name || `#${id}`, cooldownMs: cds.get(id) || null };
  });
  const bar = named(c?.bar?.slots), auto = named(c?.auto?.slots);
  const info = playerInfo(char), cls = gamecfg.classIdOf(info?.cls) ?? [...bar, ...auto].find((x) => x.kind === 'skill' && x.cls)?.cls ?? null;
  const used = [...auto, ...bar].filter((x) => x.kind === 'skill');
  return {
    character: char || null, found: !!c, barFile: c?.bar?.file || null, barAt: c?.bar?.t || null, autoAt: c?.auto?.t || null, level: info?.level ?? null, cls: info?.cls ?? null,
    bar, auto, potions: gamecfg.potionsOf([...auto, ...bar].filter((x) => x.kind === 'item'), guideplan.POTIONS),
    advice: gamecfg.skillAdvice({ used, skills: gameDb.skills, cls, level: info?.level, faction: info?.faction }),
  };
}
// the HP / MP potions a character uses: from its own setup in the game files, else the ones picked in Settings
function potionsFor(char) {
  const p = char ? skillSetup(char).potions : {};
  return { hp: p.hp || settings.potionHp, mp: p.mp || settings.potionMp, auto: { hp: !!p.hp, mp: !!p.mp } };
}
function potionList() {
  return Object.entries(guideplan.POTIONS).map(([name, p]) => { const it = itemByName(name); return { name, id: it?.id ?? null, hp: p.hp || 0, mp: p.mp || 0, pool: !!p.pool, ...itemPrice(it) }; });
}
// per farming spot: potions per hour, what they cost, and EXP % per million spent
// your character's gender: Settings, else from the robe you wear (robes are made for M or F)
function myGender(char = myCharacter()) {
  if (settings.myGender === 'M' || settings.myGender === 'F') return settings.myGender;
  const robe = gearLog.list(char).find((g) => g.slot === 'Robe' && g.itemId), it = robe && gameDb.items.find((x) => x.id === robe.itemId);
  return it?.gender || null;
}
// what an NPC pays for an item (the game data's sell price), for loot without a chat price yet
let npcSellCache = { db: null, map: new Map() };
function npcSell(id) { if (npcSellCache.db !== gameDb) npcSellCache = { db: gameDb, map: new Map(gameDb.items.filter((i) => i.sell > 0).map((i) => [i.id, i.sell])) }; return npcSellCache.map.get(id) || 0; }
function spotCost(s, pots = potionList(), char = myCharacter()) {
  const use = potionsFor(char); // (the character's own potions, from its setup in the game files)
  const hpP = pots.find((p) => p.name === use.hp), mpP = pots.find((p) => p.name === use.mp);
  const hp = guideplan.potionCost(s.hpPerHour, use.hp, hpP?.price), mp = guideplan.potionCost(s.mpPerHour, use.mp, mpP?.price);
  const cost = (hp.cost || 0) + (mp.cost || 0);
  // your announced drops there, at the chat's usual selling price
  let loot = 0, priced = 0;
  for (const [id, n] of Object.entries(s.loot || {})) { const p = chatPrice(+id) || npcSell(+id); if (p) { loot += p * n; priced += n; } }
  const lootPerHour = s.hours > 0 && priced ? loot / s.hours : null;
  return { hpPots: hp.perHour, mpPots: mp.perHour, costPerHour: hp.cost == null && mp.cost == null ? null : cost, expPerMillion: cost > 0 ? s.expPerHour / (cost / 1e6) : null,
    drops: Object.values(s.loot || {}).reduce((a, n) => a + n, 0), lootPerHour, profitPerHour: lootPerHour != null || cost ? (lootPerHour || 0) - cost : null };
}
// the usual chat selling price of an item (90 days), cached for a minute
let chatPriceCache = { at: 0, map: new Map() };
function chatPrice(id) {
  if (Date.now() - chatPriceCache.at > 60000) chatPriceCache = { at: Date.now(), map: new Map(market.priceStats(marketOffers(), 90).filter((p) => p.sell).map((p) => [p.itemId, p.sell])) };
  return chatPriceCache.map.get(id) || null;
}
function shoppingView() {
  const rows = shopping.map((r) => {
    const it = gameDb.items.find((i) => i.id === r.id);
    const chat = it && market.priceStats(marketOffers().filter((o) => o.itemId === it.id), 90)[0];
    const each = chat?.sell || it?.price || null;
    const pt = it ? plans.priceTimes(marketOffers().filter((o) => o.itemId === it.id)) : null;
    return { id: r.id, name: it?.name || `#${r.id}`, qty: r.qty, note: r.note, maxPrice: r.maxPrice || null, shop: it?.price || null, chat: chat?.sell || null, chatBuy: chat?.buy || null, total: each ? each * r.qty : null,
      cheapest: pt?.buyAt.day || pt?.buyAt.block ? { day: pt.buyAt.day?.day || null, block: pt.buyAt.block?.block || null } : null };
  });
  return { rows, total: rows.reduce((a, r) => a + (r.total || 0), 0) };
}
function dayPlanView(now) {
  const playHours = Array(24).fill(0);
  for (const [h, v] of Object.entries(activity.hours)) if (now - +h < 30 * 86400000) playHours[new Date(+h).getHours()] += v.sec || 0;
  const g = guideBosses.view(now, guideBossCfg(now));
  // your own events: every start in the next 24 hours
  const extra = [];
  for (const e of customEvents.list) { let t = plans.nextOccurrence(e, now - 5 * 60000, SERVER_TZ); while (t && t < now + 86400000) { extra.push({ t, kind: 'custom', title: e.name, sub: 'your own event' }); t = plans.nextOccurrence(e, t + 60000, SERVER_TZ); } }
  // events at the times they usually start (learned from the game's "…has started" messages)
  for (const p of eventPredictions(now)) extra.push({ t: p.t, kind: 'event', title: `${p.name} (usual time)`, sub: `seen ${p.seen}×, ${p.how}` });
  const plan = guideplan.dayPlan({ now, tz: SERVER_TZ, bossHours: settings.guideBossHours, guideBossNames: settings.guideBossAlert ? g.names : [],
    learnedBosses: bosses.stats(now).filter((b) => b.next && b.intervals >= 2), checklist: checklist.view(now, myCharacter()), events: news.events(), maintenance: news.maintenance(), passes: passTimers.view(now), playHours, extra });
  // bosses: who is coming (you and friends)
  const theirs = friends.signups();
  for (const x of plan.items) if (x.kind === 'boss') { x.coming = plans.coming({ t: x.t, label: x.title }, signups, theirs, 'you'); x.signedUp = x.coming.includes('you'); }
  return plan;
}
function levelForecastView() {
  const me = state.session.character, mine = (r) => !me || r.character === me;
  return { character: me || null, ...watch.levelForecast({ exp: screen?.exp ?? null, sessions: Object.values(sessions).filter(mine), levels: levelLog.filter(mine) }) };
}
let dayNextCache = { at: 0, v: [] };
const dayNext = (now) => { if (now - dayNextCache.at > 30000) dayNextCache = { at: now, v: dayPlanView(now).items.filter((x) => x.t >= now).slice(0, 5) }; return dayNextCache.v; };

// the character the dashboard shows: the one you picked in the header, else the one in the game, else the last one played
const lastCharacter = () => Object.values(sessions).filter((r) => r.character).sort((a, b) => b.startedAt - a.startedAt)[0]?.character || null;
const myCharacter = () => settings.viewCharacter || state.session.character || lastCharacter();
// everyone you played (for the picker), newest first, with level and class from the rankings
function myCharacters() {
  const seen = new Map();
  for (const r of Object.values(sessions).sort((a, b) => b.startedAt - a.startedAt)) if (r.character && !seen.has(r.character)) seen.set(r.character, { name: r.character, account: r.account, lastPlayed: r.startedAt });
  if (state.session.character && !seen.has(state.session.character)) seen.set(state.session.character, { name: state.session.character, account: state.session.account, lastPlayed: Date.now() });
  return [...seen.values()].map((c) => ({ ...c, level: playerInfo(c.name)?.level ?? null, cls: playerInfo(c.name)?.cls ?? null, inGame: c.name === state.session.character }));
}
// the characters in the game right now (both clients), and the ones played in the last two weeks
const inGameChars = () => (state.game.running ? [state.session.character, ...[...others.values()].map((o) => o.session.character)] : []).filter(Boolean);
const knownChars = () => [...new Set([...inGameChars(), ...myCharacters().filter((c) => Date.now() - c.lastPlayed < 14 * 86400000).map((c) => c.name)])].slice(0, 10);
// Ascension progress is per character
const ascFor = (name) => ({ asc: 0, gold: 0, ki: 0, stones: 0, ...(ascState.byChar?.[String(name || '').toLowerCase()] || (ascState.byChar ? {} : ascState)) });
// regions from the game's own data: monsters (spawn points with levels), NPCs and quests per zone
let regionCache = { db: null, v: null };
function regionsView() {
  if (regionCache.db === gameDb) return regionCache.v;
  const mobByName = new Map(gameDb.monsters.map((m) => [m.name.toLowerCase(), m]));
  const mobById = new Map(gameDb.monsters.map((m) => [m.id, m])), npcById = new Map(gameDb.npcs.map((n) => [n.id, n]));
  const by = {};
  const zoneOf = (z) => (by[z] ||= { zone: +z, name: gameDb.zones[z] || zoneName(z), mobs: new Map(), npcs: new Map(), quests: [] });
  for (const s of gameDb.npcSpots) {
    const mob = mobById.get(s.npc) || (s.name && mobByName.get(s.name.toLowerCase()));
    const r = zoneOf(s.zone);
    if (mob) { const m = r.mobs.get(mob.id) || { id: mob.id, name: mob.name, level: mob.level, spots: [] }; m.spots.push({ x: s.x, z: s.z }); r.mobs.set(mob.id, m); }
    else { const name = npcById.get(s.npc)?.name || s.name; if (name && name !== 'null') r.npcs.set(name, { id: s.npc, name, x: s.x, z: s.z }); }
  }
  for (const q of gameDb.quests) { const z = q.steps[0]?.zone; if (z) zoneOf(z).quests.push({ id: q.id, name: q.name, level: q.level }); }
  const kr = (KR_GUIDE.sections.find((s) => s.id === 'regions')?.table?.rows || []);
  const v = Object.values(by).filter((r) => r.mobs.size || r.npcs.size || r.quests.length).map((r) => {
    // (herbs to gather and event monsters are level 1: left out of the zone's level range)
    const mobs = [...r.mobs.values()].sort((a, b) => a.level - b.level), lv = mobs.map((m) => m.level).filter((l) => l > 1);
    const k = kr.find((row) => row[2] && String(row[2]).toLowerCase() === r.name.toLowerCase());
    return { zone: r.zone, name: r.name, levels: lv.length ? [Math.min(...lv), Math.max(...lv)] : null, kr: k ? { name: k[0], korean: k[1], levels: k[3] } : null,
      mobs: mobs.map((m) => ({ id: m.id, name: m.name, level: m.level, x: m.spots[0].x, z: m.spots[0].z, spots: m.spots.length })),
      npcs: [...r.npcs.values()].sort((a, b) => a.name.localeCompare(b.name)), quests: r.quests.sort((a, b) => a.level - b.level) };
  }).sort((a, b) => (a.levels?.[0] ?? 999) - (b.levels?.[0] ?? 999));
  regionCache = { db: gameDb, v };
  return v;
}

// the places the Korean guide sends you to, as map markers (built once per game database)
let guideMarkCache = { db: null, v: [] };
const guideMarks = () => (settings.guideMarks === false ? [] : guideMarkCache.db === gameDb ? guideMarkCache.v : (guideMarkCache = { db: gameDb, v: guideplan.guidePlaces(gameDb.npcSpots, gameDb.npcs) }).v);

// danger forecast: how often you died in a zone (30 days) and which enemy-faction players you met there around this hour
function zoneRisk(zone, now = Date.now()) {
  if (zone == null) return null;
  const since = now - 30 * 86400000, h = new Date(now).getHours(), near = (t) => { const d = Math.abs(new Date(t).getHours() - h); return Math.min(d, 24 - d) <= 1; };
  const deaths = farming.data.deaths.filter((d) => String(d.zone) === String(zone) && d.t >= since);
  const mine = myFaction(), enemies = new Map();
  for (const r of Object.values(sessions)) {
    if ((r.endedAt || r.startedAt) < since) continue;
    for (const [name, p] of Object.entries(r.players || {})) {
      if (String(p.zone) !== String(zone) || !near(p.firstSeen || r.startedAt)) continue;
      const fac = playerInfo(name)?.faction;
      if (mine && fac && fac !== mine) enemies.set(name, (enemies.get(name) || 0) + 1);
    }
  }
  const list = [...enemies.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n, threat: isThreat(name) }));
  const level = deaths.length >= 3 || list.length >= 5 ? 'high' : deaths.length >= 2 || list.length >= 2 ? 'some' : 'low';
  const cost = deathCost(deaths);
  return { zone: +zone, name: zoneName(zone), deaths: deaths.length, lastDeath: deaths[deaths.length - 1]?.t || null, deathHours: deaths.filter((d) => near(d.t)).length, enemies: list.slice(0, 8), enemyCount: list.length, level, expLost: cost.exp, earnBackMin: cost.minutes };
}
// what deaths cost: EXP lost (% of a level, read after each death) and the time to earn it back at that moment's pace
function deathCost(deaths) {
  const withExp = deaths.filter((d) => d.expLost > 0);
  return { known: withExp.length, exp: Math.round(withExp.reduce((s, d) => s + d.expLost, 0) * 100) / 100, minutes: Math.round(withExp.reduce((s, d) => s + (d.earnBackMin || 0), 0)) };
}
// a death: the EXP bar a moment before, to see how much the death took (the penalty may come on revive)
let pendingDeath = null;
function checkDeathExp(f) {
  if (!pendingDeath || !(f.exp > 0)) return;
  if (f.t - pendingDeath.t > 10 * 60000) { pendingDeath = null; return; }
  const lost = pendingDeath.exp - f.exp;
  if (lost > 0.005 && lost < 50) {
    const d = pendingDeath.d, per = pendingDeath.perHour;
    d.expLost = Math.round(lost * 1000) / 1000;
    if (per > 0) d.earnBackMin = Math.round((lost / per) * 60);
    farmingDirty = true; pendingDeath = null;
  }
}
let riskZone = null, riskCache = { zone: null, at: 0, v: null };
const riskFor = (zone, now) => { if (riskCache.zone !== zone || now - riskCache.at > 60000) riskCache = { zone, at: now, v: zoneRisk(zone, now) }; return riskCache.v; };
// walking into a risky zone: one warning per zone visit
function checkZoneRisk(now) {
  const z = state.session.position?.zone;
  if (z == null || z === riskZone) return;
  riskZone = z;
  if (!settings.dangerForecast || !feat('danger') || !isRealZone(z)) return;
  const r = riskFor(z, now);
  if (r && r.level !== 'low') addAlert('danger', `Careful in ${r.name}`, [r.deaths && `you died here ${r.deaths}× in 30 days${r.deathHours ? ` (${r.deathHours}× around this hour)` : ''}${r.expLost ? `, losing ${r.expLost}% EXP${r.earnBackMin ? ` (~${hm(r.earnBackMin * 60000)} to earn back)` : ''}` : ''}`,
    r.enemyCount && `enemies met here around this hour: ${r.enemies.slice(0, 4).map((e) => e.name).join(', ')}${r.enemyCount > 4 ? ` +${r.enemyCount - 4}` : ''}`].filter(Boolean).join(' · '));
}

// Honor: yours from the rankings, against the guide's Honor ranks
function honorView(name = myCharacter()) {
  const me = name && rankings.list().find((p) => p.name.toLowerCase() === String(name).toLowerCase());
  if (!me) return { name: name || null, found: false };
  // this week: Honor from Honor Pills and players you defeated (the game's messages)
  const wk = dailyStats.range(Date.now() - 7 * 86400000, Date.now() + 1, me.name);
  return { name: me.name, found: true, ...(plans.honorProgress(me.honor, rankings.playerHistory(me.name).points) || { honor: null }), pillWeek: wk.honorPill || 0, pvpKillsWeek: wk.pvpKills || 0 };
}
// what the next Ascension needs, against what you have
function ascView() {
  const name = myCharacter(), me = playerInfo(name), have = ascFor(name);
  const fc = (() => { try { return levelForecastView(); } catch { return null; } })();
  const p = plans.ascProgress({ level: me?.level || null, exp: name === state.session.character ? screen?.exp || 0 : 0, asc: have.asc, have, expPerHour: fc?.perHour || null });
  // Ki per hour from the chat's "Ki obtained" lines (last 2 hours of play), and when you'll have the Ki for the next Ascension
  const now = Date.now(), kiPerHour = Math.round(recapSum(name, 'ki', now - 2 * 3600000, now) / 2) || null;
  const kiLeft = p.ki ? Math.max(0, p.ki.need - p.ki.have) : null;
  return { ...p, have, character: name, kiPerHour, kiHours: kiLeft && kiPerHour ? Math.round((kiLeft / kiPerHour) * 10) / 10 : kiLeft === 0 ? 0 : null };
}
// your week (or day): potions and what they cost, enhance results, maze runs
// your characters side by side over the last `days` days: play, EXP and gold per hour, gear, deaths, quests, best monster
function compareView(days = 30, now = Date.now()) {
  const from = now - days * 86400000, H = 3600000;
  // plus your characters from the game files that the tracker never saw play, when their level is known (rankings / notes)
  const seen = new Set(myCharacters().map((c) => c.name.toLowerCase()));
  const accountOf = {}; for (const [acc, list] of Object.entries(gameFiles().roster.accounts)) for (const n of list) accountOf[n.toLowerCase()] = acc;
  const extra = [...gameFiles().roster.names].filter((n) => !seen.has(n) && playerInfo(n)?.level).slice(0, 12)
    .map((n) => { const i = playerInfo(n); return { name: i.name || n, account: accountOf[n] || null, level: i.level, cls: i.cls || null, inGame: false, lastPlayed: null, rosterOnly: true }; });
  return [...myCharacters().slice(0, 12), ...extra].map((c) => {
    const k = c.name.toLowerCase();
    const ss = Object.values(sessions).filter((r) => String(r.character).toLowerCase() === k && (r.endedAt || r.startedAt) >= from);
    const ms = ss.reduce((a, r) => a + Math.max(0, (r.endedAt || now) - Math.max(r.startedAt, from)), 0);
    const active = ss.reduce((a, r) => a + (r.activeMs || 0), 0), afk = ss.reduce((a, r) => a + (r.afkMs || 0), 0);
    const scr = { exp: 0, kills: 0, levels: 0 }; for (const r of ss) if (r.screen) for (const f of Object.keys(scr)) scr[f] += r.screen[f] || 0;
    const sum = (() => { try { return mySummary(from, now + 1, c.name); } catch { return {}; } })();
    const deaths = farming.data.deaths.filter((d) => d.t >= from && String(d.character || '').toLowerCase() === k);
    const mobs = (() => { try { return mobStatsView(c.name).mobs.filter((m) => m.expPerHour); } catch { return []; } })();
    const best = mobs.sort((a, b) => b.expPerHour - a.expPerHour)[0];
    const activeH = active / H, playH = ms / H;
    return {
      name: c.name, account: c.account, level: c.level, cls: c.cls, inGame: c.inGame, lastPlayed: c.lastPlayed,
      playMs: ms, activePct: active + afk ? Math.round((active / (active + afk)) * 100) : null, sessions: ss.length,
      exp: Math.round(scr.exp * 10) / 10, expPerHour: activeH >= 0.25 && scr.exp ? Math.round((scr.exp / activeH) * 100) / 100 : null,
      kills: scr.kills, levels: scr.levels,
      gold: sum.goldChange ?? null, goldPerHour: sum.goldChange != null && playH >= 0.25 ? Math.round(sum.goldChange / playH) : null,
      gearScore: (() => { try { return charGearScore(c.name).score || null; } catch { return null; } })(),
      deaths: deaths.length, deathExp: sum.deathExp || 0, questsDone: sum.questsDone || 0,
      bestMob: best ? { name: best.name, expPerHour: best.expPerHour } : null, rosterOnly: !!c.rosterOnly,
    };
  }).filter((c) => c.sessions || c.inGame || c.rosterOnly);
}
// countdowns to your goals for the overlay, the phone and the widget: the next level, today's EXP goal, the gold
// for your shopping list and gear goals (play time left at your own pace). Cached for 30 seconds.
let countdownCache = { at: 0, v: [] };
function countdownsView(now = Date.now()) {
  if (now - countdownCache.at < 30000) return countdownCache.v;
  const out = [], H = 3600000, me = myCharacter() || state.session.character;
  try {
    const f = levelForecastView(), lv = playerInfo(f.character || me)?.level;
    if (f.exp != null) out.push({ kind: 'level', n: lv ? lv + 1 : null, label: lv ? `Level ${lv + 1}` : 'Next level', left: `${(100 - f.exp).toFixed(1)}%`, pct: f.exp, playMs: f.perHour ? f.playHoursLeft * H : null, at: f.etaAt || null });
  } catch { /* no forecast yet */ }
  const g = expGoalView();
  if (g && !g.reached) out.push({ kind: 'expGoal', label: "Today's EXP goal", left: `${(g.goal - g.today).toFixed(1)}%`, pct: g.pct, playMs: screen?.expPerHour > 0 ? ((g.goal - g.today) / screen.expPerHour) * H : null, at: null });
  if (me) try {
    const need = shoppingView().total + gearGoalsView(me).filter((x) => !x.have && x.price).reduce((a, x) => a + x.price, 0);
    const have = invWatch.last(me)?.gold ?? null;
    if (need > 0 && have != null) {
      // gold per hour played over the last 7 days
      const since = now - 7 * 86400000, played = Object.values(sessions).filter((r) => r.character === me && (r.endedAt || now) >= since).reduce((a, r) => a + Math.max(0, (r.endedAt || now) - Math.max(r.startedAt, since)), 0);
      const made = invWatch.between(me, since, now), perHour = made > 0 && played > 30 * 60000 ? made / (played / H) : null;
      const left = Math.max(0, need - have);
      out.push({ kind: 'gold', label: 'Shopping & gear goals', left: left ? `${Math.round(left).toLocaleString('en-US')} gold` : 'enough gold', gold: left, pct: Math.min(100, Math.round((have / need) * 100)), playMs: left && perHour ? (left / perHour) * H : left ? null : 0, at: null });
    }
  } catch { /* no gold readings yet */ }
  countdownCache = { at: out.length ? now : now - 25000, v: out }; // (nothing yet, e.g. right after start-up: look again in 5 s)
  return out;
}
// "Ask the tracker" (lib/ask.js): the data it may look at, each read only when a question needs it
function askContext() {
  const overlap = (a, b, from, to) => Math.max(0, Math.min(b, to) - Math.max(a, from));
  return {
    me: myCharacter() || state.session.character || null,
    chars: myCharacters().map((c) => c.name),
    playMs: (from, to) => calendar().spans.reduce((a, s) => a + overlap(s.from, s.to, from, to), 0),
    sessions: (from, to) => Object.values(sessions).map((r) => ({ character: r.character, ms: overlap(r.startedAt, r.endedAt || Date.now(), from, to), screen: r.screen })).filter((r) => r.ms > 0),
    gold: (c, from, to) => invWatch.between(c, from, to),
    deaths: () => farming.data.deaths.map((d) => ({ ...d, zoneName: zoneName(d.zone) })),
    spots: () => { const pots = potionList(); return farming.best().map((s) => ({ ...s, zoneName: zoneName(s.zone), ...spotCost(s, pots) })); },
    mobs: (c) => mobStatsView(c).mobs,
    forecast: () => levelForecastView(),
    plan: (now) => dayPlanView(now).items,
    price: (name) => {
      const it = screenreader.bestMatch(name, gameDb.items);
      if (!it) return null;
      const list = marketOffers().filter((o) => o.itemId === it.id && Date.now() - o.t < 90 * 86400000), st = market.priceStats(list, 90)[0];
      return { item: it.name, sell: st?.sell || null, buy: st?.buy || null, offers: list.length, npc: npcSell(it.id) || null };
    },
    lastSeen: (name) => {
      const k = name.toLowerCase(); let best = null, n = 0;
      for (const r of Object.values(sessions)) for (const [pn, p] of Object.entries(r.players || {})) if (pn.toLowerCase() === k) { n++; const t = p.lastSeen || p.firstSeen || r.startedAt; if (!best || t > best.t) best = { name: pn, t, zone: p.zone }; }
      const live = Object.values(state.session.players).find((p) => p.name.toLowerCase() === k && p.lastSeen);
      if (live && (!best || live.lastSeen > best.t)) best = { name: live.name, t: live.lastSeen, zone: state.session.position?.zone ?? null };
      return best ? { ...best, zoneName: best.zone != null ? zoneName(best.zone) : null, sessions: n } : null;
    },
    craft: (c, from, to) => {
      const out = { enchant: { ok: 0, n: 0 }, combine: { ok: 0, n: 0 }, enhance: { ok: 0, n: 0 } };
      for (const x of craftLog) if (x.t >= from && x.t < to && (!c || String(x.char).toLowerCase() === c.toLowerCase())) { out[x.kind].n++; if (x.ok) out[x.kind].ok++; }
      for (const e of enhanceLog) if (e.t >= from && e.t < to && (!c || !e.character || String(e.character).toLowerCase() === c.toLowerCase())) { out.enhance.n++; if (e.ok ?? e.success) out.enhance.ok++; }
      return out;
    },
    quests: (c, from, to) => quests.questLog().filter((q) => String(q.char).toLowerCase() === c.toLowerCase() && q.end >= from && q.end < to).length,
    level: (c) => playerInfo(c) || null,
  };
}
function mySummary(from, to, char = null) {
  const d = dailyStats.range(from, to, char), pots = potionList();
  const use = potionsFor(char), hp = guideplan.POTIONS[use.hp], mp = guideplan.POTIONS[use.mp];
  const hpPots = d.potHp && hp ? d.potHp / hp.hp : 0, mpPots = d.potMp && mp ? d.potMp / mp.mp : 0;
  const price = (n) => pots.find((p) => p.name === n)?.price || 0;
  return { hpPots: Math.round(hpPots), mpPots: Math.round(mpPots), potionCost: Math.round(hpPots * price(use.hp) + mpPots * price(use.mp)), potions: use,
    goldChange: char ? invWatch.between(char, from, to) : null,
    enhOk: d.enhOk || 0, enhFail: d.enhFail || 0, mazeRuns: d.mazeRuns || 0, mazeExp: d.mazeExp || 0, mazeMin: Math.round(d.mazeMin || 0),
    // quests, EXP from monsters / quests, net worth, gear score and what deaths cost
    ...(char ? (() => {
      const k = String(char).toLowerCase(), inRange = (t) => t >= from && t < to;
      const span = (list, v) => { const a = list.filter((p) => p.t < from).pop() || list.find((p) => inRange(p.t)), b = list.filter((p) => p.t < to).pop(); return a && b && a !== b ? v(b) - v(a) : null; };
      const deaths = farming.data.deaths.filter((x) => inRange(x.t) && (!x.character || x.character.toLowerCase() === k));
      return {
        ki: d.ki || 0, goldLoot: d.goldLoot || 0,
        questsDone: quests.questLog().filter((q) => String(q.char).toLowerCase() === k && inRange(q.end)).length,
        expMob: Math.round((d.expMob || 0) * 10) / 10, expQuest: Math.round((d.expQuest || 0) * 10) / 10,
        netWorthChange: span(netWorth.history(char, 400), (p) => p.gold + (p.gear || 0)),
        gearScoreChange: span(gearScores.history(char), (p) => p.score),
        deathExp: Math.round(deaths.reduce((s, x) => s + (x.expLost || 0), 0) * 100) / 100,
      };
    })() : {}) };
}

// one search box for everything the tracker knows: game data, the Korean guide, prices, bosses, players
function searchAll(raw) {
  const q = raw.trim().toLowerCase();
  if (q.length < 2) return { q: raw, groups: [] };
  const has = (s) => String(s || '').toLowerCase().includes(q);
  const rank = (a, b) => (b.name.toLowerCase().startsWith(q) - a.name.toLowerCase().startsWith(q)) || a.name.length - b.name.length;
  const top = (list, n = 8) => list.sort(rank).slice(0, n);
  const prices = new Map(market.priceStats(marketOffers(), 90).map((p) => [p.itemId, p]));
  const ix = gameIndex();
  const groups = [
    ['monster', 'Monsters', top(gameDb.monsters.filter((m) => has(m.name))).map((m) => ({ id: m.id, name: m.name, level: m.level, zones: [...new Set((ix.spots.get(m.id) || []).map((p) => zoneName(p.zone)))].slice(0, 3) }))],
    ['item', 'Items', top(gameDb.items.filter((i) => has(i.name))).map((i) => ({ id: i.id, name: i.name, level: i.level, price: prices.get(i.id) || null }))],
    ['npc', 'NPCs', top(gameDb.npcs.filter((n) => has(n.name)), 6).map((n) => ({ id: n.id, name: n.name, zones: [...new Set(gameDb.npcSpots.filter((s) => s.npc === n.id).map((s) => zoneName(s.zone)))].slice(0, 3) }))],
    ['zone', 'Zones', top(Object.entries(gameDb.zones).filter(([, n]) => has(n)).map(([id, name]) => ({ id: +id, name })), 6)],
    ['quest', 'Quests', top(gameDb.quests.filter((x) => has(x.name)), 6).map((x) => ({ id: x.id, name: x.name, level: x.level }))],
    ['skill', 'Skills', top(gameDb.skills.filter((x) => has(x.name)), 6).map((x) => ({ id: x.id, name: x.name, level: x.level, cls: x.cls }))],
    ['boss', 'Boss spawns', bosses.stats().filter((b) => has(b.boss)).slice(0, 4).map((b) => ({ name: b.boss, next: b.next, spawns: b.spawns }))],
    ['player', 'Players', top((rankings.list() || []).filter((p) => has(p.name)).map((p) => ({ name: p.name, level: p.level, cls: p.cls, faction: p.faction })), 6)],
  ];
  // the Korean guide: every line that mentions it
  const guide = [];
  for (const sec of KR_GUIDE.sections) {
    const lines = [...(sec.intro || []), ...[sec.table, sec.table2, sec.table3].filter(Boolean).flatMap((tb) => tb.rows.map((r) => r.join(' · '))),
      ...(sec.groups || []).flatMap((g) => g.mobs.map((m) => `${g.title}: ${m[1]} (Lv ${m[0]})${m[2] ? ` — ${m[2]}` : ''}`)), ...(sec.notes || [])];
    for (const l of lines) if (has(l) && guide.length < 8) {
      const i = l.toLowerCase().indexOf(q), from = Math.max(0, i - 60);
      guide.push({ section: sec.id, title: sec.title, name: sec.title, text: `${from ? '…' : ''}${l.slice(from, i + q.length + 100)}${i + q.length + 100 < l.length ? '…' : ''}` });
    }
  }
  groups.push(['guide', 'Korean guide', guide]);
  return { q: raw, groups: groups.filter(([, , list]) => list.length).map(([type, title, list]) => ({ type, title, list })) };
}

let marketIndex = null;
const itemIndex =() => (marketIndex?.db === gameDb ? marketIndex.ix : (marketIndex = { db: gameDb, ix: market.buildIndex(gameDb.items) }).ix);
// who is the target under the minimap? players (rankings, met), monsters, NPCs
function resolveTarget(raw) {
  if (!raw || raw.replace(/\W/g, '').length < 3) return null;
  const players = new Map();
  for (const p of rankings.players.values()) players.set(p.name.toLowerCase(), { id: p.name, name: p.name });
  for (const n of Object.keys(state.session.players)) players.set(n.toLowerCase(), { id: n, name: n });
  const p = screenreader.bestMatch(raw, [...players.values()]);
  const me = String(state.session.character || '').toLowerCase();
  if (me && (p ? p.name.toLowerCase() === me : screenreader.bestMatch(raw, [{ name: state.session.character }]))) return null; // nothing selected: the box shows your own name
  if (p) { const i = playerInfo(p.name); return { raw, kind: 'player', name: p.name, level: i?.level ?? null, cls: i?.cls ?? null, faction: i?.faction ?? null, house: i?.house ?? null, threat: isThreat(p.name), watched: isWatched(p.name) }; }
  const m = screenreader.bestMatch(raw, gameDb.monsters);
  if (m) return { raw, kind: 'monster', name: m.name, level: m.level, hp: m.hp, id: m.id };
  const n = screenreader.bestMatch(raw, gameDb.npcs);
  if (n) return { raw, kind: 'npc', name: n.name, id: n.id };
  return { raw, kind: null, name: raw };
}
// ---- while you're away: chat log + whispers, disconnects, EXP stopping, party HP, price watches (lib/watch.js)
const knownPlayer = (n) => !!n && (rankings.players.has(String(n).toLowerCase()) || !!state.session.players[n]);
const chatLog = new watch.ChatLog(store.readJson('chat.json', []), { known: knownPlayer });
let chatDirty = false;
const awayWatch = new watch.AwayWatch(), partyWatch = new watch.PartyWatch();
// what the reader managed to read and when (Settings and the self-check), and the reading pace
const readerStats = { since: null, frames: 0, lastFrameAt: null, lastHpAt: null, lastExpAt: null, lastChatAt: null, ocr: null, w: null, h: null };
// reader tools (lib/features/readertools.js): reader check, debug captures and bundle, setup check
const readerTools = require('./lib/features/readertools')({
  store, VERSION, CLIENT_DIR, settings: () => settings, state: () => state, db: () => gameDb, backupState: () => backupState, readerStats: () => readerStats,
  ringFrames: (since) => ringFrames(since), stamp: () => stamp(), zip: (files) => zip(files),
  pickupCandidates: () => quests.pickupCandidates(), pickupPatterns: () => quests.pickupPatterns(),
});
const { readerOk, debugCapture, debugList, debugBundle, setupCheck, readerCheckView, DEBUG_DIR } = readerTools;
const recentKills = [];
let pace = { interval: null, why: null };
const PACE_FILE = path.join(store.DIR, 'reader-interval.txt');
function setPace(p) {
  if (p.interval === pace.interval && p.why === pace.why) return;
  pace = p;
  try { fs.writeFileSync(PACE_FILE, String(p.interval)); } catch { /* next look */ }
}
const onlineSeen = new Map(); // watched player -> last chat line time (an "is online" alert once an hour)
// buff icons: the item and skill icons a buff can show with, shrunk for the screen reader (lib/iconindex.js); built
// from the game files when missing or older than the game database, again after a game update
const ICON_INDEX = path.join(store.DIR, 'icon-index.bin');
let iconGroups = {};
function ensureIconIndex() {
  try {
    const dbAt = fs.statSync(path.join(store.DIR, 'gamedb.json')).mtimeMs;
    if (!fs.existsSync(ICON_INDEX) || fs.statSync(ICON_INDEX).mtimeMs < dbAt) {
      if (!gameDb.items.length) return;
      const r = buildIconIndex(GAME_DIR, { items: gameDb.items, out: ICON_INDEX });
      console.log(`[tracker] buff icons: ${r.icons} pictures (${r.shared} shared) in ${r.ms} ms`);
      // readers load the icons when they start
      if (screenReader.proc) { screenReader.stop(); syncScreenReader(); }
      for (const [pid, a] of altReaders) { a.reader.stop(); altReaders.delete(pid); }
      syncScreenReader();
    }
    iconGroups = JSON.parse(fs.readFileSync(ICON_INDEX.replace(/\.bin$/, '-groups.json'), 'utf8'));
  } catch (e) { if (!process.env.SOF_TEST_FRAMES) console.log(`[tracker] buff icons: ${e.message}`); }
}
setTimeout(ensureIconIndex, 6000);
const iconBuffName = (key) => iconName(key, iconGroups, { item: (id) => gameDb.items.find((i) => i.id === id)?.name, skill: (id) => gameDb.skills.find((s) => s.id === id)?.name });
// effect icons on you (stunned, poisoned, defence up…), buffs in the right-edge column, and the minimap dots
const effectWatch = new watch.EffectWatch((id) => gameDb.items.find((i) => i.id === id)?.name || null, iconBuffName), minimapWatch = new watch.MinimapWatch();
const effectAlertAt = new Map();
let priceWatches = store.readJson('price-watch.json', []); // [{ id, itemId, item, side, price }]
// party names as read from the screen, matched to players the tracker knows
function partyNames(members) {
  const list = [...new Map([...rankings.players.values(), ...Object.values(state.session.players)].map((p) => [p.name.toLowerCase(), { name: p.name }])).values()];
  return members.map((m) => ({ ...m, name: /^Party member \d/.test(m.name) ? m.name : screenreader.bestMatch(m.name, list)?.name || m.name }));
}

// ---- pictures: the last looks before each death (a replay) and the moment of announced drops
const SHOT_DIR = path.join(store.DIR, 'shots'), RING_DIR = path.join(SHOT_DIR, 'ring');
fs.mkdirSync(RING_DIR, { recursive: true });
let shots = store.readJson('shots.json', { deaths: [], drops: [] });
function ringFrames(since, dir = RING_DIR) {
  try {
    return fs.readdirSync(dir).filter((n) => /^f\d+\.jpg$/.test(n)).map((n) => ({ n, dir, t: fs.statSync(path.join(dir, n)).mtimeMs }))
      .filter((x) => x.t >= since).sort((a, b) => a.t - b.t);
  } catch { return []; }
}
function keepShots() {
  // the newest 20 replays and 200 drop pictures; older ones are deleted with their files
  const rm = (p) => { try { fs.rmSync(path.join(SHOT_DIR, p), { recursive: true, force: true }); } catch { /* gone */ } };
  while (shots.deaths.length > 20) rm(shots.deaths.shift().id);
  while (shots.drops.length > 200) rm(`${shots.drops.shift().id}.jpg`);
  store.writeJson('shots.json', shots);
}
function saveDeathReplay(t, zone, enemies, dir = RING_DIR, who = state.session.character) {
  const frames = ringFrames(t - 30000, dir);
  if (!frames.length) return;
  const id = `death-${t}`;
  fs.mkdirSync(path.join(SHOT_DIR, id), { recursive: true });
  frames.forEach((x, i) => fs.copyFileSync(path.join(dir, x.n), path.join(SHOT_DIR, id, `${String(i + 1).padStart(2, '0')}.jpg`)));
  shots.deaths.push({ id, t, who: who || null, zone, zoneName: zoneName(zone), enemies, frames: frames.length, times: frames.map((x) => Math.round(x.t)) });
  keepShots();
}

// ---- the session timeline (HP / MP / EXP every 10 s and what happened), one file per session in data/timelines
const TIMELINE_DIR = path.join(store.DIR, 'timelines');
fs.mkdirSync(TIMELINE_DIR, { recursive: true });
const timelineFile = (key) => path.join(TIMELINE_DIR, `${String(key).replace(/[^\w.@-]/g, '_')}.json`);
let timeline = null;
function timelineFor(key) {
  if (timeline?.key === key) return timeline;
  saveTimeline();
  let data = null; try { data = JSON.parse(fs.readFileSync(timelineFile(key), 'utf8')); } catch { /* new session */ }
  return (timeline = new watch.Timeline(key, data));
}
function saveTimeline() {
  if (!timeline?.dirty) return;
  try { fs.writeFileSync(timelineFile(timeline.key), JSON.stringify(timeline)); timeline.dirty = false; } catch (e) { console.log(`[tracker] timeline: ${e.message}`); }
}
// level-ups seen on the EXP bar, for the level forecast: [{ t, character }]
let levelLog = store.readJson('level-log.json', []);
function saveDropShot(rec) {
  const last = ringFrames(rec.t - 10000).pop();
  if (!last) return;
  const id = `drop-${rec.t}-${shots.drops.length}`;
  fs.copyFileSync(path.join(RING_DIR, last.n), path.join(SHOT_DIR, `${id}.jpg`));
  shots.drops.push({ id, t: rec.t, who: rec.who, item: rec.item, itemId: rec.itemId, from: rec.from });
  rec.shot = id;
  keepShots();
}

const screenReader = new screenreader.ScreenReader({
  script: screenreader.SCRIPT,
  onFrame(f) {
    const hp = screenreader.parsePair(f.hp), mp = screenreader.parsePair(f.mp);
    const sk = state.session.file && state.session.startedAt ? sessionKey(state.session) : null;
    if (screenSession.key !== sk) screenSession = new watch.ScreenSession(sk, sk ? sessions[sk]?.screen : null);
    if (f.exp > 0) { expSamples.push({ t: f.t, exp: f.exp }); while (expSamples.length > 2000 || (expSamples.length && f.t - expSamples[0].t > 3600000)) expSamples.shift(); }
    const rate = screenreader.expRate(expSamples);
    screen = { at: f.t, hp: hp?.[0] ?? null, hpMax: hp?.[1] ?? null, mp: mp?.[0] ?? null, mpMax: mp?.[1] ?? null, exp: f.exp || null,
      expPerHour: rate?.perHour ?? null, toNextMs: rate?.toNextMs ?? null, w: f.w, h: f.h,
      target: resolveTarget(f.target), kills: farming.data.kills, deaths: farming.data.deaths.length };
    // kills, deaths and farming spots
    const pos = state.session.position;
    const prevLook = farming.last;
    if (screen.target?.kind === 'monster') { quests.setMobTarget({ id: screen.target.id, t: f.t }); if (state.session.character) mobStats.target(state.session.character, screen.target.id, f.t); }
    const fe = farming.frame({ t: f.t, exp: f.exp || null, hp: hp?.[0] ?? null, hpMax: hp?.[1] ?? null, mp: mp?.[0] ?? null, mpMax: mp?.[1] ?? null, zone: pos?.zone ?? null, x: pos?.x, z: pos?.z,
      nearby: Object.values(state.session.players).filter((x) => x.lastSeen && f.t - x.lastSeen < NEARBY_WINDOW_MS).map((x) => x.name) });
    if (fe.kill || fe.died || fe.potHp || fe.potMp) farmingDirty = true;
    if (fe.potHp || fe.potMp) dailyStats.add(f.t, { potHp: fe.potHp, potMp: fe.potMp }, state.session.character);
    checkDeathExp(f);
    // "125120Exp obtained": the exact EXP of each gain (with how far the bar moved, for a level's size)
    try { const g = expChat.frame(f); if (g.length) { let bg = f.exp > 0 && prevLook?.exp != null ? f.exp - prevLook.exp : 0; if (bg < 0) bg = 0; onExpGains(g, f.t, state.session.character, bg); } onSysLines(expChat.fresh, f.t, state.session.character); } catch (e) { console.log(`[tracker] exp chat: ${e.message}`); }
    // EXP from monsters or from quests handed in (in % of a level)
    if (f.exp > 0 && prevLook?.exp != null && pos && prevLook.zone === pos.zone) {
      let gain = f.exp - prevLook.exp; if (gain < -50) gain += 100;
      const kind = expSplit.classify(gain, { nearNpc: nearNpc(pos) });
      if (kind === 'quest') dailyStats.add(f.t, { expQuest: gain, questsIn: 1 }, state.session.character);
      else if (kind === 'mob') dailyStats.add(f.t, { expMob: gain }, state.session.character);
      if (kind) recapEvent(f.t, state.session.character, kind === 'quest' ? 'expQuest' : 'expMob', gain);
    }
    // a kill counts for the quest items that come from that monster / that spot
    if (fe.kill && state.session.character && pos && feat('quests')) try {
      const mt = quests.mobTarget(), mob = mt && f.t - mt.t < 30000 ? mt.id : null;
      questProg.kill(state.session.character, { zone: pos.zone, x: pos.x, z: pos.z, mobId: mob }, activeQuestViews(state.session.character));
    } catch (e) { console.log(`[tracker] quest items: ${e.message}`); }
    // "You obtained [X]" in the chat or the middle of the screen: a quest item picked up
    // the message box in the middle: the same messages (the chat's new lines are handled with the EXP lines above)
    try { onSysLines(f.center || [], f.t, state.session.character, { fromCenter: true }); } catch { /* a line it can't read */ }
    // enhance results in the box in the middle of the screen
    for (const l of feat('enhance') ? f.center || [] : []) { const r = guideplan.enhanceResult(l); if (r) { readerOk('enhance', f.t); onEnhanceResult(r.ok, f.t, l); } }
    // an item tooltip open: the gear log; the inventory open: gold and weight
    if (f.tooltip?.lines?.length) try { onTooltip(f.tooltip, f.t); } catch (e) { console.log(`[tracker] gear log: ${e.message}`); }
    if (f.inventory) try { onInventory(f.inventory, f.t); } catch (e) { console.log(`[tracker] inventory: ${e.message}`); }
    if (f.quests) try { onQuestWindow(f.quests, f.t); } catch (e) { console.log(`[tracker] quest window: ${e.message}`); }
    if (f.status) try { onStatusWindow(f.status, f.t); } catch (e) { console.log(`[tracker] status window: ${e.message}`); }
    // what was read, for the self-check and Settings
    readerStats.since ||= f.t; readerStats.frames++; readerStats.lastFrameAt = f.t; readerStats.ocr = f.ocr || readerStats.ocr; readerStats.w = f.w; readerStats.h = f.h;
    if (hp) { readerStats.lastHpAt = f.t; readerOk('hud', f.t); }
    if (f.exp > 0) { readerStats.lastExpAt = f.t; readerOk('exp', f.t); }
    if (screen.target) readerOk('target', f.t);
    if ((f.center || []).some((l) => String(l).trim().length > 3)) readerOk('center', f.t);
    if (fe.kill) { recentKills.push(f.t); while (recentKills.length && f.t - recentKills[0] > 15 * 60000) recentKills.shift(); }
    const ss = screenSession.frame(f, { kill: fe.kill, died: fe.died, zone: pos?.zone ?? null });
    // the session timeline and level-ups
    const tl = sk ? timelineFor(sk) : null;
    tl?.frame(f, { hpPct: hp ? Math.round((hp[0] / hp[1]) * 100) : null, mpPct: mp ? Math.round((mp[0] / mp[1]) * 100) : null });
    if (fe.kill) tl?.event(f.t, 'kill');
    if (fe.died) tl?.event(f.t, 'death', zoneName(pos?.zone));
    if (ss.levelUp) {
      levelLog.push({ t: f.t, character: state.session.character || null, level: playerInfo(state.session.character)?.level ?? null });
      levelLog = levelLog.slice(-200); store.writeJson('level-log.json', levelLog);
      tl?.event(f.t, 'level');
    }
    if (fe.died) {
      const d = farming.data.deaths[farming.data.deaths.length - 1], enemies = nearbyThreats(f.t).enemies.map((x) => x.name);
      // for the death analysis: alone or in a party, and which monster you had targeted
      d.party = (screen.party || []).length; if (screen.target?.kind === 'monster') d.target = screen.target.name;
      d.character = state.session.character || undefined;
      if (lastKiller && f.t - lastKiller.t < 60000) { d.killer = lastKiller.who; lastKiller = null; } // (the game said who, a moment before)
      pendingDeath = prevLook?.exp != null ? { d, t: f.t, exp: prevLook.exp, perHour: screen.expPerHour } : null;
      addAlert('danger', `You died in ${zoneName(d.zone)}`, enemies.length ? `enemies nearby: ${enemies.slice(0, 5).join(', ')}` : '');
      if (settings.deathReplay) try { saveDeathReplay(f.t, d.zone, enemies.slice(0, 8)); } catch (e) { console.log(`[tracker] death replay: ${e.message}`); }
    }
    // logged out / disconnected / EXP stopped while farming
    const hud = !!hp || f.exp > 0;
    for (const a of awayWatch.frame(f, { hud, kill: fe.kill, cfg: { hud: settings.hudAlert, stuckMinutes: settings.stuckMinutes } })) addAlert(a.kind, a.title, a.body);
    // effects on you: on the timeline; a debuff while you're AFK means something is at you; a buff running out
    const afkNow = !!(state.session.lastActiveAt && Date.now() - state.session.lastActiveAt >= settings.afkMinutes * 60000);
    const ef = effectWatch.frame(f);
    buffDurations.look(f.t);
    for (const e of ef.ended) buffDurations.ended(e);
    screen.effects = buffDurations.active(ef.active, f.t, settings.buffEndAlert); // with "ends" for buffs whose run time it learned
    const runsBefore = mazeRuns.data.runs.length;
    if (feat('maze')) mazeRuns.frame({ t: f.t, zone: pos?.zone ?? null, exp: f.exp || null, kill: fe.kill, died: fe.died, effects: ef.active });
    if (mazeRuns.data.runs.length > runsBefore) { const r = mazeRuns.data.runs[mazeRuns.data.runs.length - 1]; r.character ||= state.session.character || undefined; dailyStats.add(r.end, { mazeRuns: 1, mazeExp: r.exp, mazeMin: (r.end - r.start) / 60000 }, r.character); }
    for (const e of ef.started) {
      tl?.event(f.t, 'effect', e.label);
      if (e.kind === 'debuff' && afkNow && settings.effectAlert && f.t - (effectAlertAt.get(e.id) || 0) > 2 * 60000) {
        effectAlertAt.set(e.id, f.t);
        addAlert('danger', `${e.label} while you're AFK`, 'Something may be attacking you.');
      }
    }
    for (const e of ef.ended) if (e.kind === 'buff' && e.ms >= 60000 && settings.buffEndAlert) addAlert('buff', `${e.label} ended`, `after ${hm(e.ms)}`);
    // players on the minimap: a crowd arriving while you're AFK
    const mm = minimapWatch.frame(f, { surge: settings.minimapSurge, watching: afkNow });
    screen.minimap = { count: mm.view.count, near: mm.view.near, mostly: mm.view.mostly, by: mm.view.by, dots: mm.view.dots.slice(0, 80), party: mm.view.party.slice(0, 12), facing: mm.view.facing };
    if (mm.alert) addAlert(mm.alert.kind, mm.alert.title, mm.alert.body);
    // party members' HP
    for (const a of partyWatch.frame(f, { below: settings.partyHpAlert })) addAlert(a.kind, a.title, a.body);
    screen.party = partyNames(partyWatch.members);
    // the chat log, and the messages you want to hear about
    if (settings.chatLog || settings.whisperAlert || settings.mentionAlert || settings.chatColors.length) {
      const fresh = chatLog.add(f);
      if (fresh.length && settings.chatLog) chatDirty = true;
      const cfg = { me: state.session.character, whispers: settings.whisperAlert, mentions: settings.mentionAlert, colors: settings.chatColors };
      for (const e of fresh) {
        const a = watch.chatAlert(e, cfg);
        if (a) { e.alert = a.kind; addAlert(a.kind, a.title, e.text.slice(0, 200)); tl?.event(f.t, 'whisper', `${e.who}: ${e.text}`); continue; }
        // words you asked to hear about ("LF party", an item…), not from yourself
        const plain = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const word = plain(e.who) !== plain(state.session.character) && watch.chatWordHit(e, settings.chatWords);
        if (word) { e.alert = 'chat'; addAlert('chat', `${e.who}: "${word}"`, e.text.slice(0, 200)); }
      }
      for (const e of fresh) {
        // parties looking for people
        try { onLfg(e, f.t); } catch (err) { console.log(`[tracker] party finder: ${err.message}`); }
        // enhance results in the chat, and the server's "… enhanced …'s grade up to N" announcements
        const er = guideplan.enhanceResult(e.text);
        if (er && (!e.who || /^(system|notice|info)/i.test(e.who))) onEnhanceResult(er.ok, f.t, e.text); // not a player typing it
        const ea = guideplan.enhanceAnnouncement(`${e.who ? `${e.who}: ` : ''}${e.text}`.replace(/^[^:]*announ\w*:\s*/i, ''));
        if (ea && ea.level >= 5) {
          enhanceAnnounced.push({ t: f.t, ...ea }); enhanceAnnounced = enhanceAnnounced.slice(-300); store.writeJson('enhance-announced.json', enhanceAnnounced);
          const me = String(state.session.character || '').toLowerCase();
          if (me && ea.who.toLowerCase() === me && enhanceSession.active && enhanceSession.level === ea.level) onEnhanceResult(true, f.t, e.text);
        }
        // a watched player writes in the chat: they're online (once an hour)
        if (settings.watchOnline && isWatched(e.who) && f.t - (onlineSeen.get(e.who.toLowerCase()) || 0) > 3600000) addAlert('watch', `${e.who} is online`, `in the chat: ${e.text.slice(0, 160)}`);
        if (isWatched(e.who)) onlineSeen.set(e.who.toLowerCase(), f.t);
        // server announcements in the chat: boss sightings the game log did not have (a boss seen spawning or caught)
        if (/^annou?n?cements?$/i.test(e.who) && !/party\s+m\S*mber/i.test(e.text)) {
          const boss = bossName(e.text);
          if (boss && !bosses.log.some((r) => r.boss === boss && Math.abs(r.t - f.t) < 3 * 60000)) bosses.onNotice(e.text, f.t, null);
        }
      }
      if (fresh.length) { readerStats.lastChatAt = f.t; readerOk('chat', f.t); }
    }
    // trade offers in the chat and the shout box
    // (from the best reading of each chat row, so garbled passes and the tab bar don't end up in offers)
    const chatLines = (f.chatY || []).length ? watch.chatMessages(f, knownPlayer).map((m) => `${m.who}: ${m.text}`) : f.chat || [];
    // gear for sale / wanted ("SELL ROBE HBK 110 DEF7+8 7,5B"): prices for gear like yours
    for (const l of [...chatLines, ...(f.shout || [])]) try { onGearOffer(l, f.t); } catch { /* a line it can't read */ }
    for (const o of market.parseTrades([...chatLines, ...(f.shout || [])], itemIndex())) {
      if (offers.some((x) => f.t - x.t < 30 * 60000 && x.who === o.who && x.raw === o.raw)) continue;
      const rec = { t: f.t, ...o };
      // well under (or for buyers: over) the usual price?
      const deal = watch.dealOf(rec, marketOffers(), 20);
      if (deal) rec.deal = deal.pct;
      offers.push(rec); marketDirty = true;
      const w = watch.priceHit(o, priceWatches);
      if (w) addAlert('price', `${o.who} ${o.side === 'sell' ? 'sells' : 'buys'} ${o.item} for ${market.gold(o.price)}`, `your price: ${o.side === 'sell' ? 'at most' : 'at least'} ${market.gold(w.price)} · ${o.raw}`);
      // an item on your shopping list, at or under the price you set
      else if (o.side === 'sell' && o.itemId && o.price && shopping.some((x) => x.id === o.itemId && x.maxPrice && o.price <= x.maxPrice)) {
        const want = shopping.find((x) => x.id === o.itemId);
        addAlert('price', `🛒 ${o.who} sells ${o.item} for ${market.gold(o.price)}`, `on your shopping list (at most ${market.gold(want.maxPrice)}, ${want.qty} wanted) · ${o.raw}`);
      }
      else if (o.side === 'sell' && o.itemId && gearGoalsView(state.session.character).some((g) => g.itemId === o.itemId && !g.have)) checkGoalOffer(o);
      else if (deal && settings.dealAlert && deal.pct >= settings.dealAlert && feat('market')) addAlert('price', `Deal: ${o.who} ${o.side === 'sell' ? 'sells' : 'buys'} ${o.item} for ${market.gold(o.price)}`, `usually ${market.gold(deal.usual)} (${o.side === 'sell' ? `${deal.pct}% cheaper` : `${deal.pct}% more`}) · ${o.raw}`);
    }
    if (offers.length > 10000) offers = offers.slice(-10000);
    if (hp && settings.lowHpAlert && hp[0] / hp[1] * 100 < settings.lowHpAlert && f.t - lowHpAt > 60000) {
      lowHpAt = f.t;
      addAlert('danger', `Low HP: ${Math.round(hp[0] / hp[1] * 100)}%`, `${hp[0]} / ${hp[1]}`);
    }
    // loot announcements stay in the chat for a while: keep each one once
    for (const d of screenreader.parseDrops(f.chat)) {
      const item = screenreader.bestMatch(d.item, gameDb.items), mob = screenreader.bestMatch(d.from, gameDb.monsters);
      const rec = { t: f.t, who: d.who, item: item?.name || d.item, itemId: item?.id || null, from: mob?.name || d.from, mobId: mob?.id || null };
      // the same announcement stays in the chat for a while and is read differently each time: keep one, and
      // take the monster from the reading that recognised it ("Leo" → "Leopard Hunter")
      const same = drops.find((x) => f.t - x.t < 15 * 60000 && x.who === rec.who && x.item === rec.item);
      if (same) { if (!same.mobId && rec.mobId) { same.from = rec.from; same.mobId = rec.mobId; dropsDirty = true; } continue; }
      drops.push(rec); dropsDirty = true;
      // yours, your party's (as read on screen) or a friend's: counted for the session, and a picture if wanted
      const mine = [state.session.character, ...(screen.party || []).map((p) => p.name), ...friends.party(f.t).flatMap((x) => [x.name, x.live?.character])].filter(Boolean).map((n) => n.toLowerCase());
      if (mine.includes(String(rec.who).toLowerCase())) {
        screenSession.drops++; tl?.event(f.t, 'drop', `${rec.who}: ${rec.item}`); lastMineDrop = rec;
        // your own drop: counted for the spot you're farming (profit per hour)
        if (String(rec.who).toLowerCase() === String(state.session.character || '').toLowerCase() && state.session.position) {
          const p = state.session.position; farming.addLoot({ zone: p.zone, x: p.x, z: p.z, itemId: rec.itemId }); farmingDirty = true;
          if (rec.itemId) dailyStats.add(f.t, { drops: 1 }, state.session.character);
        }
        // the rarest drop: the fewer times the server announced this item, the rarer
        const seen = drops.filter((x) => x.item === rec.item).length;
        checkRecords({ rareDrop: { v: 1 / seen, text: `${rec.who}: ${rec.item}` } });
      }
      if (settings.dropShots === 'all' || (settings.dropShots === 'mine' && mine.includes(String(rec.who).toLowerCase()))) try { saveDropShot(rec); } catch (e) { console.log(`[tracker] drop picture: ${e.message}`); }
    }
    if (drops.length > 5000) drops = drops.slice(-5000);
    // how soon to look again: quickly while fighting, slowly while AFK
    const afk = !!(state.session.lastActiveAt && Date.now() - state.session.lastActiveAt >= settings.afkMinutes * 60000);
    setPace(settings.adaptivePace
      ? watch.readingPace({ base: settings.screenInterval, kills: recentKills, hpPct: hp ? (hp[0] / hp[1]) * 100 : null, target: screen.target, partyLow: (screen.party || []).some((p) => p.hp < 60), afk, now: f.t })
      : { interval: settings.screenInterval, why: 'fixed' });
  },
});
// SOF_TEST_FRAMES: replay saved screen readings instead of reading the screen (tests)
if (process.env.SOF_TEST_FRAMES) setTimeout(() => { for (const f of JSON.parse(fs.readFileSync(process.env.SOF_TEST_FRAMES, 'utf8'))) screenReader.onFrame(f); }, 2500);
function syncScreenReader() {
  if (process.env.SOF_TEST_FRAMES) return;
  if (settings.screenReader && state.game.running && state.game.pid && !updateBlocked) {
    if (!screenReader.proc) {
      setPace({ interval: settings.screenInterval, why: 'start' });
      // a self-check of the reader once it had a few minutes to read (HP, EXP, chat)
      clearTimeout(syncScreenReader.check); syncScreenReader.check = setTimeout(() => doSelfCheck('screen reader started'), 5 * 60000);
    }
    screenReader.start(state.game.pid, settings.screenInterval, ['-RingDir', RING_DIR, '-IntervalFile', PACE_FILE, '-IconIndex', ICON_INDEX]);
  }
  else { screenReader.stop(); screen = null; }
  // your other game windows get a reader of their own: HP / MP / EXP, deaths, low HP, logged out, EXP stopped
  const want = settings.screenReader && settings.screenReaderAlts ? [...others.keys()] : [];
  for (const [pid, a] of altReaders) if (!want.includes(pid)) { a.reader.stop(); altReaders.delete(pid); }
  for (const pid of want) {
    if (altReaders.has(pid)) continue;
    const a = newAltReader(pid);
    altReaders.set(pid, a);
    a.reader.start(pid, Math.max(settings.screenInterval, 3), ['-RingDir', a.ring, '-IconIndex', ICON_INDEX]);
  }
}

// ---- a reader for a second game window (lighter: the chat is the same server chat the main window reads)
const altReaders = new Map(); // pid -> { pid, reader, ring, screen, away, lastHp, lowAt, exp }
function newAltReader(pid) {
  const ring = path.join(SHOT_DIR, `ring-${pid}`);
  fs.mkdirSync(ring, { recursive: true });
  const a = { pid, ring, screen: null, away: new watch.AwayWatch(), lastHp: null, lowAt: 0, exp: null };
  a.reader = new screenreader.ScreenReader({ script: screenreader.SCRIPT, onFrame: (f) => altFrame(a, f) });
  return a;
}
function altFrame(a, f) {
  const o = others.get(a.pid);
  if (!o) return;
  const s = o.session, who = s.character || 'Your other character', zone = s.position?.zone ?? null;
  readerOk('alt', f.t);
  const hp = screenreader.parsePair(f.hp), mp = screenreader.parsePair(f.mp);
  // the second window's gear tooltips and inventory, for its own character
  if (s.character && f.tooltip?.lines?.length) try { onTooltip(f.tooltip, f.t, s.character); } catch { /* skipped */ }
  if (s.character && f.inventory) try { onInventory(f.inventory, f.t, s.character); } catch { /* skipped */ }
  if (s.character && f.quests) try { onQuestWindow(f.quests, f.t, s.character); } catch { /* skipped */ }
  if (s.character && f.status) try { onStatusWindow(f.status, f.t, s.character); } catch { /* skipped */ }
  a.screen = { at: f.t, hp: hp?.[0] ?? null, hpMax: hp?.[1] ?? null, mp: mp?.[0] ?? null, mpMax: mp?.[1] ?? null, exp: f.exp || null, status: 'reading' };
  // a kill: a small EXP gain (as for the main window)
  const d = f.exp > 0 && a.exp != null ? f.exp - a.exp : 0, kill = d > 0 && d < 20;
  // this window's quests: kills where the quest items come from, pickups in the box in the middle, the kill pace
  if (s.character) try {
    const k = String(s.character).toLowerCase();
    if (kill) {
      const list = (altKills.get(k) || []).filter((x) => f.t - x < 15 * 60000); list.push(f.t); altKills.set(k, list);
      if (s.position) questProg.kill(s.character, { zone: s.position.zone, x: s.position.x, z: s.position.z, mobId: null }, activeQuestViews(s.character));
    }
    onPickupLines(f.center || [], f.t, s.character);
  } catch { /* quest data not ready */ }
  if (f.exp > 0 && (a.exp == null || d < 20)) a.exp = f.exp;
  for (const x of a.away.frame(f, { hud: !!hp || f.exp > 0, kill, cfg: { hud: settings.hudAlert, stuckMinutes: settings.stuckMinutes } })) addAlert(x.kind, x.title, [who, x.body].filter(Boolean).join(' · '));
  if (hp) {
    if (a.lastHp > 0 && hp[0] === 0) {
      addAlert('danger', `${who} died`, zone != null ? zoneName(zone) : '');
      if (settings.deathReplay) try { saveDeathReplay(f.t, zone, [], a.ring, who); } catch (e) { console.log(`[tracker] death replay: ${e.message}`); }
    }
    if (settings.lowHpAlert && hp[0] > 0 && (hp[0] / hp[1]) * 100 < settings.lowHpAlert && f.t - a.lowAt > 60000) { a.lowAt = f.t; addAlert('danger', `Low HP: ${Math.round((hp[0] / hp[1]) * 100)}%`, `${who} · ${hp[0]} / ${hp[1]}`); }
    a.lastHp = hp[0];
  }
}

// ---- Discord bot: slash commands answered from what the tracker knows (lib/discordbot.js)
const botAnswers = {
  online() {
    const s = state.session, p = s.position, now = Date.now();
    if (!state.game.running) return `🔴 The game is not running.${s.character ? ` Last character: **${s.character}**.` : ''}`;
    const near = Object.values(s.players).filter((x) => x.lastSeen && now - x.lastSeen < NEARBY_WINDOW_MS);
    const t = nearbyThreats(now);
    const afk = s.lastActiveAt && now - s.lastActiveAt >= settings.afkMinutes * 60000;
    const party = friends.party(now).filter((f) => f.online && f.live?.running).map((f) => `${f.name}${f.live.zone ? ` (${zoneName(f.live.zone)})` : ''}`);
    return [`🟢 **${s.character || '?'}**${afk ? ' (AFK)' : ''} in **${p ? zoneName(p.zone) : '?'}**${p ? ` at ${Math.round(p.x)}, ${Math.round(p.z)}` : ''}`,
      `👥 ${near.length} players nearby${t.enemies.length ? ` · ⚠ ${t.enemies.length} enemies` : ''}${near.length ? `: ${near.slice(0, 8).map((x) => x.name).join(', ')}` : ''}`,
      screen?.hp != null ? `❤ HP ${screen.hp}/${screen.hpMax}${screen.exp != null ? ` · EXP ${screen.exp}%` : ''}${screen.expPerHour != null ? ` (${screen.expPerHour.toFixed(1)}%/h)` : ''}` : null,
      party.length ? `🤝 Party online: ${party.join(', ')}` : null].filter(Boolean).join('\n');
  },
  boss() {
    const list = bosses.stats(Date.now()).filter((b) => b.next).slice(0, 6);
    return list.length ? list.map((b) => `🐉 **${b.boss}** ~ <t:${Math.round(b.next / 1000)}:R> (${b.confidence} estimate, seen ${b.spawns}×)`).join('\n') : 'No boss predictions yet: the tracker learns them from server notices.';
  },
  timers() {
    return state.timers.length ? state.timers.map((x) => `⏱ <t:${Math.round(x.endsAt / 1000)}:R> ${x.text}`).join('\n') : 'No timers running.';
  },
  today() {
    const s = state.session;
    return [`🕒 Played today: **${hm(playedToday())}**${settings.goalHours ? ` (goal ${settings.goalHours}h)` : ''}`,
      state.game.running && s.startedAt ? `This session: ${hm(Date.now() - s.startedAt)} · active ${hm(s.activeMs)} · AFK ${hm(s.afkMs)}` : null].filter(Boolean).join('\n');
  },
  whois({ name }) {
    const pr = playerProfile(String(name || '').slice(0, 40));
    const i = pr.info || {};
    if (!pr.meetings.length && !pr.ranked && !pr.note) return `I don't know **${name}** yet.`;
    const sch = pr.schedule;
    return [`**${pr.name}**${i.level ? ` · Lv ${i.level}` : ''}${i.cls ? ` · ${i.cls}` : ''}${i.faction ? ` · ${i.faction}` : ''}${i.house ? ` · ${i.house}` : ''}`,
      pr.meetings.length ? `Met ${pr.meetings.length}× · last <t:${Math.round(pr.meetings[0].at / 1000)}:R> in ${pr.meetings[0].zone != null ? zoneName(pr.meetings[0].zone) : '?'}` : null,
      sch?.hours?.length ? `Usually online ${sch.hours.map((h) => `${String(h.from).padStart(2, '0')}:00–${String(h.to).padStart(2, '0')}:00`).join(', ')} (your time)` : null,
      pr.threat ? `⚠ In ${pr.threat.count} danger alerts` : null, pr.watched ? '★ On your watchlist' : null, pr.note?.note ? `📝 ${pr.note.note}` : null].filter(Boolean).join('\n');
  },
  route({ to }) {
    const q = String(to || '').trim().toLowerCase();
    const zone = Object.entries(gameDb.zones).find(([, n]) => n.toLowerCase() === q) || Object.entries(gameDb.zones).find(([, n]) => n.toLowerCase().includes(q));
    const npc = !zone && gameDb.npcSpots.find((s) => (s.name || '').toLowerCase() === q);
    const params = new URLSearchParams(zone ? { toZone: zone[0] } : npc ? { npc: npc.npc } : {});
    const r = routeRequest(params);
    if (!r.found) return r.reason === 'no-position' ? 'I don\'t know where you are: the game has to be running.' : r.reason === 'no-target' ? `No zone or NPC called "${to}".` : 'No way there through the known exits.';
    return [`🧭 ${r.hops} zone change(s), about ${r.distance.toLocaleString('en-US')} units:`, ...r.legs.map((l, n) => `${n + 1}. ${l.zoneName}: ${l.via === 'target' ? `walk to **${l.label}**` : l.via === 'npc' ? `talk to **${l.label}**` : `exit **${l.label}**`} (${l.dist.toLocaleString('en-US')})`)].join('\n');
  },
};
// from the screen reader: a picture of the game, the chat, whispers, prices
Object.assign(botAnswers, {
  screen() {
    if (!settings.screenReader) return 'The screen reader is off (Settings → Screen reader on the PC).';
    const last = ringFrames(Date.now() - 60000).pop();
    if (!last) return state.game.running ? 'No recent look at the game: is the game window minimised?' : '🔴 The game is not running.';
    return { content: `📸 ${state.session.character || 'Game'} · ${new Date(last.t).toLocaleTimeString('en-GB')}${screen?.hp != null ? ` · HP ${screen.hp}/${screen.hpMax}` : ''}${screen?.exp != null ? ` · EXP ${screen.exp}%` : ''}`, file: { name: 'game.jpg', data: fs.readFileSync(path.join(RING_DIR, last.n)) } };
  },
  chat({ who }) {
    const list = chatLog.search({ who: who || '', limit: 15 }).reverse();
    if (!list.length) return who ? `No chat from **${who}** seen.` : 'No chat seen yet (needs the screen reader).';
    return list.map((e) => `\`${new Date(e.t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}\` **${e.who}**: ${e.text}`).join('\n');
  },
  whispers() {
    const list = alerts.filter((a) => a.kind === 'whisper' && Date.now() - a.t < 86400000).slice(-15);
    return list.length ? list.map((a) => `💬 <t:${Math.round(a.t / 1000)}:R> **${a.title}**${a.body ? `: ${a.body}` : ''}`).join('\n') : 'No whispers or chat alerts in the last day.';
  },
  price({ item }) {
    const it = gameDb.items.find((x) => x.name.toLowerCase() === String(item || '').trim().toLowerCase()) || screenreader.bestMatch(String(item || ''), gameDb.items);
    if (!it) return `No item called "${item}".`;
    const mine = marketOffers().filter((o) => o.itemId === it.id);
    if (!mine.length) return `No offers for **${it.name}** seen in the chat yet.`;
    const s = market.priceStats(mine, 30)[0];
    return [`💰 **${it.name}**: usually ${s?.sell ? `selling for **${market.gold(s.sell)}**` : 'no sellers'} · ${s?.buy ? `buying for **${market.gold(s.buy)}**` : 'no buyers'} (${mine.length} offers)`,
      ...mine.slice(-6).reverse().map((o) => `<t:${Math.round(o.t / 1000)}:R> ${o.who} ${o.side === 'sell' ? 'sells' : 'buys'}${o.price ? ` for ${market.gold(o.price)}` : ''}: ${o.raw}`)].join('\n');
  },
});
// buttons under bot answers: a short id → what to do (Discord allows 100 characters, boss names can be long)
const botButtons = new Map();
const botBtn = (label, action, style = 2) => { const id = `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`; botButtons.set(id, action); if (botButtons.size > 300) botButtons.delete(botButtons.keys().next().value); return { label, id, style }; };
// /plan: the next 24 hours, your passes and who's coming to the bosses, with ✋ buttons for the next bosses
botAnswers.plan = () => {
  const p = dayPlanView(Date.now()), icon = { boss: '🐉', checklist: '☑️', event: '🎉', maintenance: '🛠', pass: '⏱', custom: '📌' };
  const items = p.items.filter((x) => x.t >= Date.now() - 60000).slice(0, 15);
  const lines = items.map((x) => `${icon[x.kind] || '•'} <t:${Math.round(x.t / 1000)}:t> (<t:${Math.round(x.t / 1000)}:R>) **${x.title}**${x.sub ? ` · ${x.sub}` : ''}${x.coming?.length ? ` · coming: ${x.coming.join(', ')}` : ''}`);
  const passes = passTimers.view().map((x) => `⏱ ${x.label} ends <t:${Math.round(x.end / 1000)}:R>`);
  const btns = items.filter((x) => x.kind === 'boss' && x.t > Date.now()).slice(0, 5).map((x) => botBtn(`${x.signedUp ? '✋ Leave' : '✋ Join'} ${new Date(x.t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} ${x.title}`.slice(0, 80), { kind: 'signup', t: x.t, label: x.title, on: !x.signedUp }, x.signedUp ? 2 : 3));
  return { content: [...passes, ...lines].join('\n') || 'Nothing planned in the next 24 hours.', components: btns.length ? discordButtons(btns) : undefined };
};
// /checklist: open items with a ✓ button each (pet feeding, dailies…)
botAnswers.checklist = () => {
  const list = checklist.view(Date.now(), myCharacter());
  if (!list.length) return 'Your checklist is empty (Live tab → Checklist on the PC).';
  const line = (x) => `${x.done ? '✅' : '⬜'} **${x.text}**${x.every === 'hours' ? (x.nextReset && x.nextReset > Date.now() ? ` · due <t:${Math.round(x.nextReset / 1000)}:R>` : ' · due now') : x.nextReset ? ` · resets <t:${Math.round(x.nextReset / 1000)}:R>` : ''}`;
  const btns = list.filter((x) => !x.done).slice(0, 10).map((x) => botBtn(`✓ ${x.text}`.slice(0, 80), { kind: 'check', id: x.id }, 3));
  return { content: list.map(line).join('\n'), components: btns.length ? discordButtons(btns) : undefined };
};
// /enhance: the auto-log, with start / stop
botAnswers.enhance = () => {
  const s = enhanceSession, recent = enhanceLog.slice(-6).reverse();
  return { content: [s.active ? `⚒ Auto-log **on**: next try +${s.level}${s.item ? ` (${s.item})` : ''}` : '⚒ Auto-log **off**',
    ...recent.map((r) => `${r.ok ? '✅' : '❌'} +${r.level}${r.item ? ` ${r.item}` : ''} · <t:${Math.round(r.t / 1000)}:R>`)].join('\n'),
  components: discordButtons([s.active ? botBtn('⏹ Stop auto-log', { kind: 'enhance', active: false }, 4) : botBtn(`▶ Start at +${s.level}`, { kind: 'enhance', active: true }, 3)]) };
};
// a button was pressed: do it, then show the updated answer
// /quests: your quests in progress, how far the items are, and the trip's next stops
botAnswers.quests = () => {
  const who = myCharacter();
  if (!who) return 'No character yet.';
  const qv = activeQuestViews(who);
  if (!qv.length) return `No quests read for **${who}** yet: open the quest window (Ctrl+Q) in the game with the screen reader on.`;
  const prog = questProgView(who), trip = questRouteView(who);
  const lines = [`📜 **${who}** · ${qv.length} quests in progress`];
  for (const q of qv.slice(0, 12)) {
    const p = prog.find((x) => x.id === q.id);
    lines.push(`• Lv ${q.level} **${q.name}**${p ? ` — ${p.items.map((i) => `${i.name} ${i.picked}/${i.need}${i.killsLeft ? ` (~${i.killsLeft} kills${i.minutesLeft ? `, ${i.minutesLeft} min` : ''})` : ''}`).join(', ')}${p.ready ? ' ✅ hand in' : ''}` : ''}`);
  }
  if (trip.stops.length) lines.push('', `🧭 Trip (${trip.stops.length} stops):`, ...trip.stops.slice(0, 6).map((s, n) => `${n + 1}. ${s.kind === 'collect' ? 'collect' : s.kind === 'handin' ? 'hand in to' : 'talk to'} **${s.label}** · ${s.zoneName || zoneName(s.zone)}`));
  return lines.join('\n').slice(0, 1900); // Discord's limit is 2000
};
botAnswers.button = (id) => {
  const a = botButtons.get(id);
  if (!a) return 'This button is too old: ask again.';
  if (a.kind === 'signup') { signups = plans.toggleSignup(signups, { t: a.t, label: a.label }, a.on); store.writeJson('signups.json', signups); dayNextCache.at = 0; syncFriends(); return botAnswers.plan(); }
  if (a.kind === 'check') { checklist.change({ action: 'toggle', id: a.id, done: true }, myCharacter()); return botAnswers.checklist(); }
  if (a.kind === 'enhance') { enhanceSession = { ...enhanceSession, active: a.active }; store.writeJson('enhance-session.json', enhanceSession); return botAnswers.enhance(); }
  return 'Unknown button.';
};
let botCfg = store.readJson('discord-bot.json', { token: '', allowed: [] });
const bot = new DiscordBot({ handlers: botAnswers, log: (m) => console.log(m) });
function startBot() { if (botCfg.token && !process.env.SOF_OFFLINE && !updateBlocked) bot.start({ token: botCfg.token, allowed: botCfg.allowed }); else bot.stop(); }
setTimeout(startBot, 8000);
const botView = () => ({ token: botCfg.token ? '••••••••' + botCfg.token.slice(-4) : '', allowed: botCfg.allowed, status: bot.status, error: bot.error, me: bot.me, owner: bot.owner, invite: bot.inviteUrl() });

// ---- daily / weekly checklist (resets in server time) and the calendar feed (lib/planner.js)
const checklist = new Checklist({ read: () => store.readJson('checklist.json', null), save: (d) => store.writeJson('checklist.json', d), tz: SERVER_TZ, onEvent: addAlert });
function calendarFeed() {
  const now = Date.now(), ev = [];
  for (const b of bosses.stats(now)) if (b.next && b.next > now - 3600000) {
    const every = Math.round((b.intervalMs || 0) / 60000);
    ev.push({ uid: `boss-${b.boss}-${Math.round(b.next / 600000)}`, start: b.next, end: b.next + 15 * 60000, title: `${b.boss} (expected)`, alarmMin: 10,
      description: [every && `Usually every ${every >= 60 ? `${Math.floor(every / 60)}h ${every % 60}m` : `${every}m`}`, `seen ${b.spawns}×`, `${b.confidence} estimate`].filter(Boolean).join(', ') });
  }
  for (const e of news.events()) ev.push({ uid: `event-${e.name}-${e.start}`, start: e.start, end: e.end, title: e.name, url: e.url });
  for (const m of news.maintenance()) ev.push({ uid: `maint-${m.start}`, start: m.start, end: m.end || m.start + 3 * 3600000, title: 'Scions of Fate maintenance', description: m.title, url: m.url, alarmMin: 60 });
  for (const it of checklist.view(now)) if (it.nextReset) ev.push({ uid: `reset-${it.id}-${it.nextReset}`, start: it.nextReset, title: `Checklist resets: ${it.text}`, alarmMin: it.remind || undefined });
  return icsCalendar(ev, 'Scions of Fate');
}

// ---- self-check: are all the readers still working (after a game update, at start-up, daily, on demand)?
let selfCheck = store.readJson('selfcheck.json', null);
function doSelfCheck(reason) {
  const previous = selfCheck;
  try {
    selfCheck = runSelfCheck({
      clientDir: CLIENT_DIR, gameDir: GAME_DIR, gameDb, previous, templates: templates.length, zoneMaps: Object.keys(zoneMaps).length,
      worldZones: worldZoneList ? worldZoneList.length : null, guideMonsters: guide.monsters.length, logins: state.logins.length,
      parseLog: (file) => { const s = freshSession(file); for (const line of decoder.decode(fs.readFileSync(path.join(CLIENT_DIR, file))).split('\n')) parseSessionLine(s, line.replace(/\r$/, ''), false); return s; },
      readTerrain: (z) => terrain.readTerrain(GAME_DIR, z),
      iconTest: () => ddsToPng(fs.readFileSync(path.join(GAME_DIR, 'datas', 'interface', 'ITEM', '1.d2s'))).length,
      rankings: { fetchedAt: rankings.fetchedAt, error: rankings.error }, news: { fetchedAt: news.fetchedAt, error: news.error },
      screen: { on: settings.screenReader, gameRunning: state.game.running, status: screenReader.status, error: screenReader.error, ...readerStats },
    }, reason);
  } catch (e) { console.log(`[tracker] self-check failed to run: ${e.message}`); return selfCheck; }
  store.writeJson('selfcheck.json', selfCheck);
  // say so only when something broke that worked before
  const was = new Set((previous?.checks || []).filter((c) => c.level === 'fail').map((c) => c.id));
  const newly = selfCheck.checks.filter((c) => c.level === 'fail' && !was.has(c.id));
  if (newly.length) addAlert('patch', `Self-check: ${newly.length} problems found`, newly.map((c) => c.label).join(' · '));
  console.log(`[tracker] self-check (${reason}): ${selfCheck.fails} problems, ${selfCheck.warns} warnings`);
  return selfCheck;
}

let questsDone = store.readJson('quests-done.json', {}); // character -> [quest ids]

// quests, gear, routes, leveling plan and item details over the decoded database (lib/gameviews.js)
const views = createGameViews({
  db: () => gameDb, guide: () => guide, zoneMaps: () => zoneMaps, zoneName,
  trades: () => trades, questsDone: () => questsDone,
  position: () => state.session.position, character: () => state.session.character,
  levelOf: (name) => playerInfo(name)?.level ?? null, isRealZone,
});
const { itemSearch, zoneCenter, gameIndex, questSearch, gearAdvice, routeRequest, levelingPlan, itemInfo } = views;

// ---- screenshots: datas/capture/YBcaptureNNNNN.jpg, with a copy of the game log at that moment (.ybt)
const CAPTURE_DIR = path.join(GAME_DIR, 'datas', 'capture');
const shotCache = new Map(); // file -> { mtime, info }
function screenshots() {
  let files = [];
  try { files = fs.readdirSync(CAPTURE_DIR).filter((f) => /^YBcapture\d+\.jpg$/i.test(f)); } catch { return []; }
  return files.map((f) => {
    const full = path.join(CAPTURE_DIR, f), st = fs.statSync(full), hit = shotCache.get(f);
    if (hit && hit.mtime === st.mtimeMs) return hit.info;
    const s = freshSession(f);
    try {
      const log = path.join(CAPTURE_DIR, f.replace(/\.jpg$/i, '.ybt'));
      for (const line of decoder.decode(fs.readFileSync(log)).split('\n')) parseSessionLine(s, line.replace(/\r$/, ''), false);
    } catch { /* no log copy */ }
    const p = s.position && isRealZone(s.position.zone) ? s.position : null;
    const info = {
      name: f, at: s.clock || s.startedAt || st.mtimeMs, character: s.character, account: s.account,
      zone: p ? p.zone : null, zoneName: p ? zoneName(p.zone) : null, x: p ? Math.round(p.x) : null, z: p ? Math.round(p.z) : null,
      players: Object.keys(s.players).slice(-12), size: st.size,
    };
    shotCache.set(f, { mtime: st.mtimeMs, info });
    return info;
  }).sort((a, b) => b.at - a.at || b.name.localeCompare(a.name));
}

function worldView(zone) {
  const z = String(zone);
  const heat = Object.entries(heatmap[z] || {}).sort((a, b) => b[1] - a[1]).slice(0, 4000)
    .map(([k, s]) => { const [cx, cz] = k.split(',').map(Number); return [cx * HEAT_CELL + HEAT_CELL / 2, cz * HEAT_CELL + HEAT_CELL / 2, s]; });
  return {
    zone: z, name: zoneName(z), center: zoneCenter(z), cell: HEAT_CELL,
    terrain: terrain.readTerrain(GAME_DIR, z),
    image: terrain.zoneImage(GAME_DIR, z) ? `/api/world-image/${z}` : null,
    npcs: gameDb.npcSpots.filter((n) => String(n.zone) === z),
    portals: gameDb.portals.filter((p) => String(p.zone) === z).map((p) => ({ ...p, toName: zoneName(p.to) })),
    waypoints: [...waypoints, ...friends.waypoints(), ...guideMarks()].filter((w) => String(w.zone) === z),
    mobs: (() => { const ix = gameIndex(), out = []; for (const [id, list] of ix.spots) for (const p of list) if (String(p.zone) === z) out.push({ ...p, id, name: ix.who.get(id), level: ix.mob.get(id)?.level ?? null }); return out; })(),
    heat,
    // where you died here (screen reader)
    deaths: farming.data.deaths.filter((d) => String(d.zone) === z && d.x != null).map(({ t, x, z: dz, near }) => ({ t, x, z: dz, near })),
  };
}

function lanUrls() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(`http://${i.address}:${PORT}`);
  }
  return out;
}

// ---------------------------------------------------------------- http server

const clients = new Set();

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

// a binary body (an uploaded sound), at most `max` bytes
function readRaw(req, max) {
  return new Promise((resolve, reject) => {
    const parts = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > max) { reject(new Error(`The file is over ${Math.round(max / 1048576)} MB`)); req.destroy(); } else parts.push(c); });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}
// your own alert sounds: data\sounds, plain names only
const SOUND_DIR = path.join(store.DIR, 'sounds');
const SOUND_TYPES = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4' };
const SOUND_TONES = ['chime', 'alarm', 'bell', 'coin', 'pop', 'soft', 'triple', 'siren']; // public/sounds.js
function soundName(n) {
  const m = /^([\w .()-]{1,60})\.(mp3|wav|ogg|m4a)$/i.exec(path.basename(String(n)).trim());
  return m ? `${m[1].trim().replace(/\s+/g, ' ')}.${m[2].toLowerCase()}` : null;
}
function soundFiles() {
  try { return fs.readdirSync(SOUND_DIR).filter((f) => soundName(f) === f).map((f) => ({ name: f, size: fs.statSync(path.join(SOUND_DIR, f)).size })); } catch { return []; }
}
const json = (res, data) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
// every settings change (Settings page, an import) goes through here: values checked and kept in range, folders tested
function applySettings(b) {
  const num = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const next = {
    afkMinutes: num(b.afkMinutes, 1, 60, settings.afkMinutes),
    goalHours: num(b.goalHours, 0, 24, settings.goalHours),
    limitHours: num(b.limitHours, 0, 24, settings.limitHours),
    remindEveryHours: num(b.remindEveryHours, 0, 12, settings.remindEveryHours),
    breakMinutes: num(b.breakMinutes, 0, 600, settings.breakMinutes),
    breakPauseMinutes: num(b.breakPauseMinutes, 2, 60, settings.breakPauseMinutes),
    autoOverlay: b.autoOverlay === undefined ? settings.autoOverlay : !!b.autoOverlay,
    dangerCount: num(b.dangerCount, 1, 20, settings.dangerCount),
    dangerWindowSec: num(b.dangerWindowSec, 5, 300, settings.dangerWindowSec),
    dangerUnknown: b.dangerUnknown === undefined ? settings.dangerUnknown : !!b.dangerUnknown,
    myFaction: b.myFaction === undefined ? settings.myFaction : (['The Order', 'The Chaos'].includes(b.myFaction) ? b.myFaction : ''),
    myHouse: b.myHouse === undefined ? settings.myHouse : String(b.myHouse || '').trim().slice(0, 40),
    backupDir: b.backupDir === undefined ? settings.backupDir : String(b.backupDir || '').trim().slice(0, 260),
    backupKeep: num(b.backupKeep, 1, 365, settings.backupKeep),
    syncDir: b.syncDir === undefined ? settings.syncDir : String(b.syncDir || '').trim().slice(0, 260),
    syncName: b.syncName === undefined ? settings.syncName : safeName(b.syncName),
    lang: LANG_CODES.includes(b.lang) ? b.lang : settings.lang,
    voice: ['off', 'important', 'all'].includes(b.voice) ? b.voice : settings.voice,
    shareLive: b.shareLive === undefined ? settings.shareLive : !!b.shareLive,
    screenReader: b.screenReader === undefined ? settings.screenReader : !!b.screenReader,
    screenInterval: num(b.screenInterval, 1, 30, settings.screenInterval),
    lowHpAlert: num(b.lowHpAlert, 0, 90, settings.lowHpAlert),
    whisperAlert: b.whisperAlert === undefined ? settings.whisperAlert : !!b.whisperAlert,
    mentionAlert: b.mentionAlert === undefined ? settings.mentionAlert : !!b.mentionAlert,
    hudAlert: b.hudAlert === undefined ? settings.hudAlert : !!b.hudAlert,
    stuckMinutes: num(b.stuckMinutes, 0, 120, settings.stuckMinutes),
    partyHpAlert: num(b.partyHpAlert, 0, 90, settings.partyHpAlert),
    deathReplay: b.deathReplay === undefined ? settings.deathReplay : !!b.deathReplay,
    dropShots: ['off', 'mine', 'all'].includes(b.dropShots) ? b.dropShots : settings.dropShots,
    chatLog: b.chatLog === undefined ? settings.chatLog : !!b.chatLog,
    screenReaderAlts: b.screenReaderAlts === undefined ? settings.screenReaderAlts : !!b.screenReaderAlts,
    dealAlert: num(b.dealAlert, 0, 90, settings.dealAlert),
    peekLan: b.peekLan === undefined ? settings.peekLan : !!b.peekLan,
    adaptivePace: b.adaptivePace === undefined ? settings.adaptivePace : !!b.adaptivePace,
    watchOnline: b.watchOnline === undefined ? settings.watchOnline : !!b.watchOnline,
    digestHour: num(b.digestHour, -1, 23, settings.digestHour),
    chatWords: b.chatWords === undefined ? settings.chatWords : (Array.isArray(b.chatWords) ? b.chatWords : String(b.chatWords).split(/[,\n]/)).map((w) => String(w).trim().slice(0, 40)).filter((w) => w.length >= 2).slice(0, 30),
    shareMarket: b.shareMarket === undefined ? settings.shareMarket : !!b.shareMarket,
    quietFrom: num(b.quietFrom, -1, 23, settings.quietFrom),
    quietTo: num(b.quietTo, -1, 23, settings.quietTo),
    expGoal: num(b.expGoal, 0, 500, settings.expGoal),
    effectAlert: b.effectAlert === undefined ? settings.effectAlert : !!b.effectAlert,
    buffEndAlert: b.buffEndAlert === undefined ? settings.buffEndAlert : !!b.buffEndAlert,
    minimapSurge: num(b.minimapSurge, 0, 50, settings.minimapSurge),
    guideBossAlert: b.guideBossAlert === undefined ? settings.guideBossAlert : !!b.guideBossAlert,
    guideBossHours: b.guideBossHours === undefined ? settings.guideBossHours : [...new Set((Array.isArray(b.guideBossHours) ? b.guideBossHours : String(b.guideBossHours).split(/[,\s]+/)).map((h) => parseInt(h, 10)).filter((h) => h >= 0 && h <= 23))].sort((x, y) => x - y).slice(0, 12),
    braceletHours: [4, 24].includes(+b.braceletHours) ? +b.braceletHours : settings.braceletHours,
    shareEnhance: b.shareEnhance === undefined ? settings.shareEnhance : !!b.shareEnhance,
    viewCharacter: b.viewCharacter === undefined ? settings.viewCharacter : String(b.viewCharacter || '').trim().slice(0, 40),
    dangerForecast: b.dangerForecast === undefined ? settings.dangerForecast : !!b.dangerForecast,
    partyFinder: b.partyFinder === undefined ? settings.partyFinder : !!b.partyFinder,
    weightAlert: num(b.weightAlert, 0, 100, settings.weightAlert),
    gearOfferAlert: b.gearOfferAlert === undefined ? settings.gearOfferAlert : !!b.gearOfferAlert,
    debugCapture: b.debugCapture === undefined ? settings.debugCapture : !!b.debugCapture,
    myGender: b.myGender === undefined ? settings.myGender : (['M', 'F'].includes(b.myGender) ? b.myGender : ''),
    features: b.features && typeof b.features === 'object' ? Object.fromEntries(FEATURES.map((x) => [x.id, b.features[x.id] !== false])) : settings.features,
    alertMute: b.alertMute && typeof b.alertMute === 'object' ? Object.fromEntries(Object.entries(b.alertMute).filter(([k, v]) => /^[a-z]{2,20}$/.test(k) && v).map(([k]) => [k, true])) : settings.alertMute,
    alertCap: num(b.alertCap, 0, 100, settings.alertCap),
    quietFarming: b.quietFarming === undefined ? settings.quietFarming : !!b.quietFarming,
    potionHp: guideplan.POTIONS[b.potionHp]?.hp ? b.potionHp : settings.potionHp,
    potionMp: guideplan.POTIONS[b.potionMp]?.mp ? b.potionMp : settings.potionMp,
    rivals: b.rivals === undefined ? settings.rivals : (Array.isArray(b.rivals) ? b.rivals : String(b.rivals).split(',')).map((n) => String(n).trim().slice(0, 40)).filter(Boolean).slice(0, 8),
    // a sound per alert type: { kind: { s: tone | 'off' | 'default' | 'file:<name>', v: volume 0-100 } }
    sounds: b.sounds && typeof b.sounds === 'object' ? Object.fromEntries(Object.entries(b.sounds).slice(0, 40).filter(([k, v]) => /^[a-z]{2,20}$/.test(k) && v && typeof v.s === 'string'
      && (SOUND_TONES.includes(v.s) || ['off', 'default'].includes(v.s) || (v.s.startsWith('file:') && soundName(v.s.slice(5)) === v.s.slice(5))) && v.s !== 'default').map(([k, v]) => [k, { s: v.s, v: num(v.v, 0, 100, 70) }])) : settings.sounds,
    // tidy-up: pictures, debug captures and old timelines kept under a size (MB) and an age (days); 0 = no limit
    tidyMB: num(b.tidyMB, 0, 100000, settings.tidyMB),
    tidyDays: num(b.tidyDays, 0, 3650, settings.tidyDays),
    // your own dashboard layout: panel order per tab grid and the hidden panels (keys made by public/js/layout.js)
    layout: b.layout && typeof b.layout === 'object' ? (() => {
      const pk = (k) => typeof k === 'string' && /^[\w-]{1,64}$/.test(k);
      const order = {};
      for (const [g, list] of Object.entries(b.layout.order || {}).slice(0, 60)) if (/^[a-z]{2,20}#\d{1,2}$/.test(g) && Array.isArray(list)) order[g] = list.filter(pk).slice(0, 80);
      return { order, hidden: [...new Set((Array.isArray(b.layout.hidden) ? b.layout.hidden : []).filter(pk))].slice(0, 300) };
    })() : settings.layout,
    chatColors: Array.isArray(b.chatColors) ? b.chatColors.filter((c) => /^#[0-9a-f]{6}$/i.test(c?.col)).slice(0, 10).map((c) => ({ col: c.col.toLowerCase(), label: String(c.label || '').trim().slice(0, 24) || 'Chat' })) : settings.chatColors,
  };
  // a backup folder inside the shared friends folder is made when missing (the "Use the friends folder" button)
  if (next.backupDir && next.syncDir && path.resolve(next.backupDir).toLowerCase().startsWith(path.resolve(next.syncDir).toLowerCase() + path.sep) && fs.existsSync(next.syncDir)) {
    try { fs.mkdirSync(next.backupDir, { recursive: true }); } catch { /* checked below */ }
  }
  // check folders before applying anything, so a typo never half-saves
  for (const [k, label] of [['backupDir', 'Backup folder'], ['syncDir', 'Shared folder']]) {
    if (next[k] && !(fs.existsSync(next[k]) && fs.statSync(next[k]).isDirectory())) throw new Error(`${label} not found: ${next[k]}`);
  }
  if (next.syncDir && !next.syncName) throw new Error('Pick a name for friends sync');
  const backupChanged = next.backupDir !== settings.backupDir;
  settings = next;
  store.writeJson('settings.json', settings);
  if (backupChanged && settings.backupDir) { backupState.lastAt = 0; checkDailyBackup(); }
  syncScreenReader();
  syncFriends();
  // re-arm today's goal alerts against the new values
  goalState = { ...goalState, goalHit: false, limitHit: false, lastNag: 0 };
  if (settings.goalHours && playedToday() >= settings.goalHours * 3600000) goalState.goalHit = true;
  store.writeJson('goals.json', goalState);
  return settings;
}

const STATIC = { '/': 'index.html', '/index.html': 'index.html', '/overlay': 'overlay.html', '/overlay.html': 'overlay.html', '/stream': 'overlay.html', '/phone': 'phone.html', '/widget': 'widget.html' };
const STATIC_JS = { '/update-gate.js': 'update-gate.js', '/sounds.js': 'sounds.js', '/i18n.js': 'i18n.js', '/i18n-dict.js': 'i18n-dict.js', '/help.js': 'help.js', '/world.js': 'world.js', '/krguide.js': 'krguide.js' };

// phone mode (SOF_HOST=0.0.0.0): the key other devices need, made once and kept in data\lan-key.txt
const LAN_MODE = HOST !== '127.0.0.1' && HOST !== 'localhost' && HOST !== '::1';
const lanKey = (() => {
  if (!LAN_MODE) return null;
  const f = path.join(store.DIR, 'lan-key.txt');
  try { const k = fs.readFileSync(f, 'utf8').trim(); if (k.length >= 16) return k; } catch { /* first start */ }
  const k = guard.newKey(); fs.writeFileSync(f, k); return k;
})();
const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { res.writeHead(400); return res.end('Bad request'); }
  const route = url.pathname;
  // only the tracker's own pages and programs on this PC (or a phone with the key): see lib/guard.js
  const g = guard.check(req, url, { port: PORT, lanMode: LAN_MODE, lanKey, pcNames: [os.hostname()] });
  if (!g.ok) { res.writeHead(g.status, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end(g.reason); }
  if (g.setCookie) res.setHeader('Set-Cookie', g.setCookie);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  try {
    // ---- updates: always reachable (also while blocked)
    if (route === '/api/update' && req.method === 'GET') return json(res, updateView());
    if (route.startsWith('/api/update/') && req.method === 'POST' && !guard.isLoopbackAddr(req.socket.remoteAddress)) { res.writeHead(403); return res.end('Update from the PC running the tracker'); }
    if (route === '/api/update/check' && req.method === 'POST') { await checkUpdates(); return json(res, updateView()); }
    if (route === '/api/update/install' && req.method === 'POST') {
      if (DEV_CHECKOUT) { res.writeHead(409); return res.end('This is a development copy (the project folder): update it with git, not the setup'); }
      // download (verified against the signed fingerprint), then run the setup; progress is in /api/update
      updater.install().then((r) => console.log(`[tracker] update: setup ${r.started} started`))
        .catch((e) => { console.log(`[tracker] update failed: ${e.message}`); addAlert('update', 'The update could not be installed', `${e.message}. Try again, or download the setup yourself.`); })
        .finally(() => { updateCache.at = 0; });
      return json(res, { started: true });
    }
    // ---- blocked (update required, version withdrawn, or no check for too long): pages show the update screen only
    if (isBlocked()) {
      const open = ['/api/shutdown', '/api/tray-status', '/api/i18n/tray', '/api/diagnostics', '/api/alerts']; // (/api/alerts: only update alerts then, for the tray)
      if (route === '/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        const send = () => res.write(`data: ${JSON.stringify(blockedSnapshot())}\n\n`);
        send(); const iv = setInterval(send, 2000);
        req.on('close', () => clearInterval(iv));
        return;
      }
      if (route === '/api/state') return json(res, blockedSnapshot());
      if (route.startsWith('/api/') && !open.includes(route)) { res.writeHead(426, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ blocked: true, update: updateView() })); }
    }
    if (route === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      // ?delta=1: parts that rarely change are left out while they stay the same (the page keeps its copy)
      if (url.searchParams.get('delta') === '1') res.sent = new Map();
      res.write(`data: ${snapshotFor(res, snapshot())}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (route === '/api/state') return json(res, snapshot());
    if (route === '/api/rankings/history') return json(res, rankings.history(Math.min(365, Math.max(1, +url.searchParams.get('days') || 7))));
    if (route === '/api/rankings/player') return json(res, rankings.playerHistory(url.searchParams.get('name') || ''));
    if (route === '/api/sessions') return json(res, sessionList());
    if (route === '/api/session') return json(res, sessions[url.searchParams.get('key')] || null);
    if (route === '/api/calendar') return json(res, calendar());
    // (with where you died, from the screen reader)
    if (route === '/api/heatmap') return json(res, { cell: HEAT_CELL, zones: heatmap, labels: zoneLabels(), deaths: farming.data.deaths.filter((d) => d.zone != null && d.x != null).map(({ t, zone, x, z, near }) => ({ t, zone, x, z, near })) });
    // the session timeline: HP / MP / EXP every 10 s and kills, deaths, drops, whispers, level-ups
    if (route === '/api/session-timeline') {
      const key = url.searchParams.get('key') || '';
      if (timeline?.key === key) return json(res, timeline);
      try { return json(res, JSON.parse(fs.readFileSync(timelineFile(key), 'utf8'))); } catch { return json(res, null); }
    }
    if (route === '/api/level-forecast') return json(res, levelForecastView());
    // your setup in one file (Settings → Move or share your setup); PC only, tokens only when asked for
    if (route === '/api/setup-export' || route === '/api/setup-import') {
      if (!/^(::1|127\.|::ffff:127\.)/.test(req.socket.remoteAddress || '')) { res.writeHead(403); return res.end('PC only'); }
      if (route === '/api/setup-export') {
        const secrets = url.searchParams.get('secrets') === '1';
        const file = setup.exportSetup({ version: VERSION, settings, watchlist, threats, notes: playerNotes, waypoints, priceWatches, labels, checklist: checklist.data.items,
          notify: secrets ? notifier.cfg : null, discordBot: secrets && botCfg.token ? botCfg : null });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="sof-tracker-setup-${stamp()}${secrets ? '-with-tokens' : ''}.json"` });
        return res.end(JSON.stringify(file, null, 1));
      }
      if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
      const inc = JSON.parse(await readBody(req));
      const m = setup.mergeSetup({ watchlist, threats, notes: playerNotes, waypoints, priceWatches, labels, checklist: checklist.data.items }, inc);
      ({ watchlist, threats, waypoints, priceWatches, labels } = m); playerNotes = m.notes;
      for (const [f, v] of [['watchlist.json', watchlist], ['threats.json', threats], ['players.json', playerNotes], ['waypoints.json', waypoints], ['price-watch.json', priceWatches], ['labels.json', labels]]) store.writeJson(f, v);
      for (const it of m.checklist) try { checklist.change({ action: 'add', ...it }); } catch { /* a bad item is skipped */ }
      const summary = m.summary;
      const s = setup.settingsToApply(inc, (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } });
      if (Object.keys(s).length) { applySettings(s); summary.push({ what: 'Settings', added: null }); }
      if (inc.notify && typeof inc.notify === 'object') { notifier.update(inc.notify); summary.push({ what: 'Phone & Discord alerts', added: null }); }
      if (inc.discordBot?.token) { botCfg = { token: String(inc.discordBot.token), allowed: Array.isArray(inc.discordBot.allowed) ? inc.discordBot.allowed.map(String).slice(0, 20) : [] }; store.writeJson('discord-bot.json', botCfg); startBot(); summary.push({ what: 'Discord commands', added: null }); }
      syncFriends();
      return json(res, summary);
    }
    // goals, records, rivals, planning, deaths, your house, the status hotkey, tracker health
    if (route === '/api/records') return json(res, Object.entries(extras.RECORDS).map(([id, label]) => ({ id, label, ...(records[id] || {}) })));
    if (route === '/api/rivals') {
      const me = state.session.character;
      return json(res, { me: me || null, rivals: settings.rivals, list: extras.rivalView([...(me ? [me] : []), ...settings.rivals], (n) => rankings.playerHistory(n)) });
    }
    if (route === '/api/plan-session') {
      const hours = Math.min(12, Math.max(0.25, +url.searchParams.get('hours') || 2));
      const p = extras.planSession({ hours, spots: farming.best().map((s) => ({ ...s, zoneName: zoneName(s.zone) })), exp: screen?.exp ?? null });
      // the way to the best spot, and the leveling plan's ideas when you have no farming data yet
      const top = p.spots[0], route0 = top ? routeRequest(new URLSearchParams({ toZone: String(top.zone) })) : null;
      // what happens during the session (bosses, your events, resets, pet feeding, passes running out)
      const now = Date.now(), until = now + hours * 3600000;
      const during = dayPlanView(now).items.filter((x) => x.t >= now && x.t <= until);
      // spots with their potion cost / profit and how dangerous they are
      const pots = potionList();
      for (const s of p.spots) Object.assign(s, spotCost(s, pots), { risk: zoneRisk(s.zone, now) });
      // a training area or dungeon for your level the guide suggests (when you have the pass / bracelet)
      const lv = playerInfo(myCharacter())?.level;
      const guideSpot = lv ? guideplan.levelPlaces({ level: lv, guide: KR_GUIDE, zones: gameDb.zones, spots: [], now }).find((x) => x.kind !== 'Field') : null;
      return json(res, { ...p, route: route0?.found ? route0 : null, plan: p.spots.length ? null : levelingPlan(new URLSearchParams()), during, passes: passTimers.view(now), guideSpot, level: lv || null });
    }
    if (route === '/api/death-analysis') return json(res, extras.deathAnalysis(farming.data.deaths, { zoneName }));
    if (route === '/api/house-activity') {
      const h = houseView(url.searchParams.get('name') ?? settings.myHouse);
      if (!h.members) return json(res, null);
      // seen = met near you (the day of that session) or writing in the chat
      const seen = [];
      for (const r of Object.values(sessions)) for (const n of Object.keys(r.players || {})) seen.push({ name: n, t: r.startedAt });
      for (const e of chatLog.entries) seen.push({ name: e.who, t: e.t });
      const gain = (n) => { const pts = rankings.playerHistory(n).points.filter((p) => p.level && Date.now() - p.t < 7 * 86400000); return pts.length > 1 ? pts[pts.length - 1].level - pts[0].level : null; };
      return json(res, { name: h.name, ...extras.houseActivity({ members: h.members, seen, levelGain: gain, dayOf: dayKey }) });
    }
    if (route === '/api/voice-status') return json(res, { text: voiceStatus() });
    if (route === '/api/health') return json(res, { samples: health.samples, cores: os.cpus().length, game: gamePerf.view(Date.now()) });
    // an item's usual price per day (item dialog chart)
    if (route === '/api/price-history') return json(res, watch.priceHistory(marketOffers(), +url.searchParams.get('item'), { days: Math.min(365, +url.searchParams.get('days') || 90), dayOf: dayKey }));
    // what the server announced in the chat, besides drops
    if (route === '/api/announcements') return json(res, chatLog.entries.filter((e) => /^annou?n?cements?$/i.test(e.who) && !/party\s+m\S*mber/i.test(e.text)).slice(-100).reverse().map(({ t, text }) => ({ t, text })));
    // today's digest as it would be sent now (Settings → preview)
    if (route === '/api/digest') return json(res, dailyDigest());
    // what the tracker keeps, and how much room it takes
    if (route === '/api/storage' && req.method === 'GET') return json(res, storageView());
    if (route === '/api/storage' && req.method === 'POST') {
      if (!/^(::1|127\.|::ffff:127\.)/.test(req.socket.remoteAddress || '')) { res.writeHead(403); return res.end('PC only'); }
      return json(res, clearStorage(JSON.parse(await readBody(req)).what));
    }
    // CSV exports of what the screen reader collected
    const csv = /^\/api\/export\/(chat|offers|drops)\.csv$/.exec(route);
    if (csv) {
      const q = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
      const when = (t) => new Date(t).toISOString();
      const rows = csv[1] === 'chat' ? [['time', 'player', 'message', 'colour'], ...chatLog.entries.map((e) => [when(e.t), e.who, e.text, e.col])]
        : csv[1] === 'offers' ? [['time', 'player', 'side', 'item', 'item id', 'price', 'deal %', 'message'], ...offers.map((o) => [when(o.t), o.who, o.side, o.item, o.itemId, o.price, o.deal, o.raw])]
          : [['time', 'player', 'item', 'item id', 'monster', 'monster id'], ...drops.map((d) => [when(d.t), d.who, d.item, d.itemId, d.from, d.mobId])];
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="sof-${csv[1]}-${stamp()}.csv"` });
      return res.end('﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n'));
    }
    // a player as a trader: offers and messages from the chat
    if (route === '/api/trader') return json(res, watch.traderProfile(String(url.searchParams.get('name') || '').slice(0, 40), marketOffers(), chatLog.entries));
    // the latest look at a game window (?pid= for another window): on this PC, or on the phone when allowed
    if (route === '/api/peek.jpg') {
      const local = /^(::1|127\.|::ffff:127\.)/.test(req.socket.remoteAddress || '');
      if (!local && !settings.peekLan) { res.writeHead(403); return res.end('Showing the game screen on other devices is off (Settings → Screen reader)'); }
      const pid = +url.searchParams.get('pid'), dir = pid && altReaders.has(pid) ? altReaders.get(pid).ring : RING_DIR;
      const last = ringFrames(Date.now() - 60000, dir).pop();
      if (!last) { res.writeHead(404); return res.end('No recent look at the game'); }
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store', 'X-Taken-At': String(Math.round(last.t)) });
      return fs.createReadStream(path.join(dir, last.n)).pipe(res);
    }
    if (route === '/api/encounters') return json(res, encounters());
    if (route === '/api/alerts') {
      const tr = url.searchParams.get('translate') ? uiLang() : null;
      const loud = url.searchParams.get('loud') === '1'; // the tray: no pop-ups for muted / capped alerts
      if (loud) readerTools.trayPing(); // only the tray asks this way: it's running
      return json(res, alerts.slice().reverse().filter((a) => (!loud || !a.silent) && (!updateBlocked || a.kind === 'update')).map((a) => (tr ? { ...a, title: i18n.tAlert(tr, a.title), body: i18n.tAlert(tr, a.body) } : a)));
    }
    if (route === '/api/i18n/tray') {
      const L = uiLang();
      const keys = ['Open dashboard', 'Open overlay', 'Play', 'Restart tracker', 'Quit', 'Launcher started', 'Tracker restarted', 'No alerts yet',
        'Tracker is running. Double-click the icon to open the dashboard.', 'Hotkeys: Ctrl+Shift+M mark spot, Ctrl+Shift+O overlay, Ctrl+Shift+L last alert', 'Hotkeys: Ctrl+Shift+M mark spot, Ctrl+Shift+O overlay, Ctrl+Shift+L last alert, Ctrl+Shift+S status'];
      return json(res, { lang: L, speech: i18n.SPEECH[L] || 'en-US', strings: Object.fromEntries(keys.map((k) => [k, i18n.t(L, k)])) });
    }
    // phone mode: the addresses to open on a phone, with the access key (shown on this PC only)
    if (route === '/api/net') return json(res, { host: HOST, lan: LAN_MODE && guard.isLoopbackAddr(req.socket.remoteAddress) ? lanUrls().map((u) => `${u}/phone?key=${lanKey}`) : [] });
    if (route === '/api/player-notes') return json(res, playerNotes);
    if (route === '/api/profile') return json(res, playerProfile(String(url.searchParams.get('name') || '').slice(0, 40)));
    if (route === '/api/report') return json(res, reportFor(url.searchParams));
    // the report as one page to keep or share (a download, charts included, no tracker needed to open it)
    if (route === '/api/report.html') {
      const r = reportFor(url.searchParams), name = `SoF report ${r.month || r.week}.html`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"` });
      return res.end(reportPage(r, { zoneName, version: VERSION }));
    }
    if (req.method === 'POST' && route === '/api/waypoints') {
      const b = JSON.parse(await readBody(req));
      if (b.action === 'delete') waypoints = waypoints.filter((w) => w.id !== b.id);
      else if (b.action === 'add') {
        const n = (v) => (Number.isFinite(+v) ? +v : NaN);
        if (!/^\d+$/.test(String(b.zone)) || Number.isNaN(n(b.x)) || Number.isNaN(n(b.z))) throw new Error('bad waypoint');
        waypoints.push({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, zone: String(b.zone), x: n(b.x), z: n(b.z),
          label: String(b.label || '').trim().slice(0, 40) || 'Marker', kind: ['farm', 'boss', 'npc', 'danger', 'star'].includes(b.kind) ? b.kind : 'star', at: Date.now(),
          note: String(b.note || '').trim().slice(0, 300) || undefined });
      } else throw new Error('bad action');
      store.writeJson('waypoints.json', waypoints);
      return json(res, waypoints);
    }
    if (req.method === 'POST' && route === '/api/threat') {
      const { name } = JSON.parse(await readBody(req));
      delete threats[String(name || '').toLowerCase()];
      store.writeJson('threats.json', threats);
      res.writeHead(204); return res.end();
    }

    if (route === '/api/zone-names') return json(res, zoneNameList);
    if (route === '/api/gamedb') {
      return json(res, {
        counts: { items: gameDb.items.length, monsters: gameDb.monsters.length, npcs: gameDb.npcs.length, skills: gameDb.skills.length, quests: gameDb.quests.length, zones: Object.keys(gameDb.zones).length, npcSpots: gameDb.npcSpots.length, portals: gameDb.portals.length },
        classes: CLASSES, slots: SLOTS,
      });
    }
    // (with the chat's usual selling price next to the shop price and what an NPC pays)
    if (route === '/api/gamedb/items') { const r = itemSearch(url.searchParams); return json(res, { ...r, items: r.items.map((it) => ({ ...it, chat: chatPrice(it.id) || null })) }); }
    if (route === '/api/gamedb/monsters') {
      const ix = gameIndex();
      return json(res, gameDb.monsters.map((m) => ({ ...m, area: ix.guideArea.get(m.name.toLowerCase()) || null, spots: (ix.spots.get(m.id) || []).map((p) => ({ ...p, zoneName: zoneName(p.zone) })) })));
    }
    if (route === '/api/gamedb/quests') return json(res, questSearch(url.searchParams));
    if (route === '/api/gamedb/skills') {
      const cls = url.searchParams.get('cls'), text = String(url.searchParams.get('q') || '').trim().toLowerCase();
      const cd = cooldownMap();
      return json(res, gameDb.skills.filter((s) => (!cls || String(s.cls) === cls) && (!text || s.name.toLowerCase().includes(text) || s.desc.toLowerCase().includes(text))).sort((a, b) => a.level - b.level || a.id - b.id).map((s) => (cd.has(s.id) ? { ...s, cooldown: cd.get(s.id) } : s)));
    }
    if (route === '/api/gamedb/gear') {
      // your character's gender (Settings, else the robe you wear): the advisor leaves out gear made for the other one
      const q = new URLSearchParams(url.searchParams); if (!q.get('gender')) { const gd = myGender(); if (gd) q.set('gender', gd); }
      return json(res, { gender: q.get('gender') || null, rows: gearAdvice(q) });
    }
    if (route === '/api/gamedb/item') {
      const it = itemInfo(url.searchParams);
      if (!it) return json(res, null);
      // what the chat says it costs, and which monsters were announced dropping it (with where they live)
      const ix = gameIndex(), byMob = new Map();
      for (const d of drops) if (d.itemId === it.id || (!d.itemId && d.item.toLowerCase() === it.name.toLowerCase())) {
        const e = byMob.get(d.from) || { from: d.from, mobId: d.mobId, count: 0, last: 0 };
        e.count++; e.last = Math.max(e.last, d.t); byMob.set(d.from, e);
      }
      const announced = [...byMob.values()].sort((a, b) => b.count - a.count).map((e) => ({
        ...e, level: e.mobId ? ix.mob.get(e.mobId)?.level ?? null : null, area: ix.guideArea.get(String(e.from).toLowerCase()) || null,
        spots: (e.mobId ? ix.spots.get(e.mobId) || [] : []).map((p) => ({ ...p, zoneName: zoneName(p.zone) })),
      }));
      const all = marketOffers().filter((o) => o.itemId === it.id);
      const price = market.priceStats(all, 90)[0] || null;
      return json(res, { ...it, announced, price, offers: all.slice(-10).reverse() });
    }
    // market flips: chat buyers paying more than sellers ask, sellers asking less than an NPC pays (last 30 days)
    if (route === '/api/market-flips') {
      const all = marketOffers(), now = Date.now(), counts = new Map();
      for (const o of all) if (o.itemId && o.price && now - o.t < 30 * 86400000) { const c = counts.get(o.itemId) || { sell: 0, buy: 0 }; c[o.side]++; counts.set(o.itemId, c); }
      const npc = new Map(gameDb.items.map((x) => [x.id, x.sell || 0]));
      if (!feat('market')) return json(res, { flips: [] });
      return json(res, { flips: ledger.marketFlips(market.priceStats(all, 30), counts, (id) => npc.get(id) || 0).slice(0, 40).map((f) => ({ ...f, history: priceLine(f.itemId) })) });
    }
    if (route === '/api/market') {
      const days = Math.min(365, Math.max(1, +url.searchParams.get('days') || 30));
      const all = marketOffers();
      return json(res, { total: all.length, fromFriends: all.length - offers.length, stats: market.priceStats(all, days).slice(0, 200), recent: all.slice(-150).reverse() });
    }
    if (route === '/api/farming') {
      const pots = potionList();
      return json(res, { kills: farming.data.kills, best: farming.best().slice(0, 40).map((s) => ({ ...s, zoneName: zoneName(s.zone), ...spotCost(s, pots) })),
        potions: pots, ...(() => { const u = potionsFor(myCharacter()); return { potionHp: u.hp, potionMp: u.mp, potionAuto: u.auto }; })(),
        deaths: farming.data.deaths.slice(-50).reverse().map((d) => ({ ...d, zoneName: zoneName(d.zone) })),
        deathCost: deathCost(farming.data.deaths.filter((d) => d.t >= Date.now() - 30 * 86400000)) });
    }
    if (route === '/api/gamedb/leveling') return json(res, levelingPlan(url.searchParams));
    // the whole quest trip as one route on the 3D map: the legs to each stop in turn
    if (route === '/api/route' && url.searchParams.get('quests') === '1') {
      const who = myCharacter(), trip = who ? questRouteView(who) : { stops: [] }, p = who ? charPosition(who) : null;
      if (!p || p.zone == null) return json(res, { found: false, reason: 'no-position' });
      if (!trip.stops.length) return json(res, { found: false, reason: 'no-target' });
      let cur = { zone: p.zone, x: p.x, z: p.z };
      const legs = []; let hops = 0;
      for (const s of trip.stops) {
        const r = views.planRoute(cur, { zone: s.zone, x: s.x, z: s.z, label: `${s.kind === 'collect' ? '⛏' : '💬'} ${s.label}` });
        if (!r?.found) continue;
        legs.push(...r.legs); hops += r.hops; cur = { zone: s.zone, x: s.x, z: s.z };
      }
      return json(res, { found: legs.length > 0, from: { zone: p.zone, x: p.x, z: p.z }, target: trip.stops[trip.stops.length - 1], hops, distance: legs.reduce((a, l) => a + l.dist, 0), legs });
    }
    if (route === '/api/route') return json(res, routeRequest(url.searchParams));
    if (route === '/api/route-targets') {
      // everything you can plan a route to: zones and NPCs with a known spot
      const named = new Map();
      for (const s of gameDb.npcSpots) if (s.name && !named.has(s.npc)) named.set(s.npc, { npc: s.npc, name: s.name, zone: s.zone, zoneName: zoneName(s.zone) });
      const reachable = new Set(gameDb.portals.flatMap((p) => [String(p.zone), String(p.to)]));
      return json(res, { zones: [...reachable].map((z) => ({ zone: +z, name: zoneName(z) })).sort((a, b) => a.name.localeCompare(b.name)), npcs: [...named.values()].sort((a, b) => a.name.localeCompare(b.name)) });
    }
    if (route === '/api/screens') return json(res, screenshots());
    const shot = /^\/api\/screen\/(YBcapture\d+\.jpg)$/i.exec(route);
    if (shot) {
      const f = path.join(CAPTURE_DIR, shot[1]);
      if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=86400' });
      return fs.createReadStream(f).pipe(res);
    }
    if (route === '/api/gamedb/changes') return json(res, dbChanges);
    if (route === '/api/selfcheck' && req.method === 'GET') return json(res, selfCheck);
    if (route === '/api/groups') return json(res, { groups: groupsView(), arrivals: arrivals.length });
    if (route === '/api/drops') {
      const qq = String(url.searchParams.get('q') || '').toLowerCase(), item = url.searchParams.get('item');
      const list = drops.filter((d) => (!item || String(d.itemId) === item) && (!qq || `${d.item} ${d.from} ${d.who}`.toLowerCase().includes(qq)));
      const byItem = {};
      for (const d of list) { const k = d.item; const e = (byItem[k] ||= { item: d.item, itemId: d.itemId, count: 0, from: {} }); e.count++; e.from[d.from] = (e.from[d.from] || 0) + 1; }
      // the drop table as announced: per monster, what it was seen dropping (the game keeps the real one on the server)
      const byMob = {};
      for (const d of list) {
        const e = (byMob[d.from] ||= { from: d.from, mobId: d.mobId, count: 0, items: {} });
        e.count++; if (d.mobId) e.mobId = d.mobId;
        const it = (e.items[d.item] ||= { item: d.item, itemId: d.itemId, count: 0, last: 0 }); it.count++; it.last = Math.max(it.last, d.t);
      }
      const ix = gameIndex();
      const mobs = Object.values(byMob).map((e) => ({ ...e, level: e.mobId ? ix.mob.get(e.mobId)?.level ?? null : null, items: Object.values(e.items).sort((a, b) => b.count - a.count) })).sort((a, b) => b.count - a.count).slice(0, 150);
      return json(res, { total: list.length, recent: list.slice(-200).reverse(), items: Object.values(byItem).sort((a, b) => b.count - a.count).slice(0, 100), mobs });
    }
    // the chat the screen reader saw (newest first), searchable
    if (route === '/api/chat') {
      const list = chatLog.search({ q: url.searchParams.get('q') || '', who: url.searchParams.get('who') || '', before: +url.searchParams.get('before') || Infinity, limit: 300 });
      return json(res, { total: chatLog.entries.length, entries: list.map(({ id, t, last, who, text, col, alert }) => ({ id, t, last, who, text, col, alert: alert || null })), colors: settings.chatColors });
    }
    if (route === '/api/price-watch' && req.method === 'GET') return json(res, priceWatches);
    if (route === '/api/price-watch' && req.method === 'POST') {
      const b = JSON.parse(await readBody(req));
      if (b.action === 'delete') priceWatches = priceWatches.filter((w) => w.id !== b.id);
      else {
        const it = gameDb.items.find((x) => x.id === +b.itemId) || gameDb.items.find((x) => x.name.toLowerCase() === String(b.item || '').trim().toLowerCase()) || screenreader.bestMatch(String(b.item || ''), gameDb.items);
        if (!it) throw new Error('Pick an item from the list');
        const p = typeof b.price === 'number' ? b.price : market.parsePrices(String(b.price || '').replace(/\s+/g, '')).map((x) => x.value)[0] ?? Number(String(b.price || '').replace(/[ ,_]/g, ''));
        if (!(p > 0)) throw new Error('Price: a number like 150m or 3.8b');
        priceWatches.push({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, itemId: it.id, item: it.name, side: b.side === 'buy' ? 'buy' : 'sell', price: p });
        priceWatches = priceWatches.slice(-50);
      }
      store.writeJson('price-watch.json', priceWatches);
      return json(res, priceWatches);
    }
    // death replays and drop pictures (data/shots)
    if (route === '/api/shots') return json(res, { deaths: shots.deaths.slice().reverse(), drops: shots.drops.slice().reverse() });
    const sf = /^\/shots\/((?:death-\d+\/\d{2})|(?:drop-\d+-\d+))\.jpg$/.exec(route);
    if (sf) {
      const f = path.join(SHOT_DIR, `${sf[1]}.jpg`);
      if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=86400' });
      return fs.createReadStream(f).pipe(res);
    }
    // per-character items show the ticks of the character the dashboard shows, plus who else still has them to do
    if (route === '/api/checklist' && req.method === 'GET') return json(res, { items: checklist.view(Date.now(), myCharacter(), knownChars()), tz: SERVER_TZ, char: myCharacter() });
    if (route === '/api/checklist' && req.method === 'POST') { checklist.change(JSON.parse(await readBody(req)), myCharacter()); return json(res, { items: checklist.view(Date.now(), myCharacter(), knownChars()), tz: SERVER_TZ, char: myCharacter() }); }
    if (route === '/calendar.ics') {
      res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store', ...(url.searchParams.get('download') ? { 'Content-Disposition': 'attachment; filename="scions-of-fate.ics"' } : {}) });
      return res.end(calendarFeed());
    }
    if (route === '/api/selfcheck/run' && req.method === 'POST') return json(res, doSelfCheck('manual'));
    if (req.method === 'POST' && route === '/api/quests/done') {
      const b = JSON.parse(await readBody(req));
      const who = String(b.character || state.session.character || 'me').slice(0, 40), id = +b.id;
      if (!Number.isFinite(id)) throw new Error('bad quest');
      const set = new Set(questsDone[who] || []);
      if (b.done) set.add(id); else set.delete(id);
      questsDone[who] = [...set];
      store.writeJson('quests-done.json', questsDone);
      res.writeHead(204); return res.end();
    }
    if (route === '/api/gamedb/npcs') {
      const named = new Map(gameDb.npcs.map((n) => [n.id, n.name]));
      const spots = {}; for (const s of gameDb.npcSpots) (spots[s.npc] ||= []).push({ zone: s.zone, zoneName: zoneName(s.zone), x: s.x, z: s.z });
      return json(res, [...named].map(([id, name]) => ({ id, name, spots: spots[id] || [] })));
    }
    if (route === '/api/gamedb/zones') return json(res, Object.entries(gameDb.zones).map(([id, name]) => ({ id, name, npcs: gameDb.npcSpots.filter((n) => String(n.zone) === id).length, exits: gameDb.portals.filter((p) => String(p.zone) === id).map((p) => zoneName(p.to)) })));
    if (route === '/api/world-zones') return json(res, (worldZoneList || []).map((z) => ({ ...z, name: zoneName(z.zone) })));
    const wm = /^\/api\/world\/(\d{1,6})$/.exec(route);
    if (wm) return json(res, worldView(wm[1]));
    const wi = /^\/api\/world-image\/(\d{1,6})$/.exec(route);
    if (wi) {
      const f = terrain.zoneImage(GAME_DIR, wi[1]);
      if (!f) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'image/bmp', 'Cache-Control': 'max-age=86400' });
      return fs.createReadStream(f).pipe(res);
    }
    const ic = /^\/api\/icon\/(\d{1,12})\.png$/.exec(route);
    if (ic) {
      const cached = path.join(ICON_CACHE, `${ic[1]}.png`);
      if (!fs.existsSync(cached)) {
        const src = path.join(ICON_DIR, `${ic[1]}.d2s`);
        if (!fs.existsSync(src)) { res.writeHead(404); return res.end(); }
        fs.mkdirSync(ICON_CACHE, { recursive: true });
        fs.writeFileSync(cached, ddsToPng(fs.readFileSync(src)));
      }
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=86400' });
      return fs.createReadStream(cached).pipe(res);
    }
    if (route === '/api/monsters') return json(res, guide.monsters);
    if (route === '/api/guide') return json(res, guide);
    if (route === '/api/bosses') return json(res, bosses.stats());
    // ---- built on the Korean guide book
    if (route === '/api/enhance') {
      const q = url.searchParams, charm = ['best', 'high', 'mid'].includes(q.get('charm')) ? q.get('charm') : 'high';
      const tiers = guideplan.enhanceTiers(KR_GUIDE, charm), tier = tiers[Math.min(tiers.length - 1, Math.max(0, +q.get('tier') || 0))];
      // your tries, or yours and your friends' together (friends sync)
      const theirs = friends.enhanceRows(), rows = q.get('pool') === '1' ? [...enhanceLog, ...theirs] : enhanceLog;
      const own = guideplan.enhanceStats(rows)[charm] || {};
      const odds = q.get('own') === '1' ? guideplan.ownOdds(tier.odds, own) : tier.odds;
      const n = (k) => Math.max(0, Number(q.get(k)) || 0);
      const plan = guideplan.enhancePlan({ odds, from: n('from'), to: n('to') || 10, stones: n('stones') || 1, prices: { stone: n('stone'), charm: n('charmPrice'), fee: n('fee'), item: n('item') } });
      // what the chat says luck charms and enhance charms cost, to fill in the prices
      const want = (name) => /charm of luck|enhance charm/i.test(name) && !/event|no trade/i.test(name);
      const prices = market.priceStats(marketOffers().filter((o) => o.itemId && want(o.item)), 90).map(({ itemId, item, sell, buy, offers: n2 }) => ({ itemId, item, sell, buy, offers: n2 }));
      // which SoF luck charm is which Korean grade: your success rates per charm, next to the guide's for each grade
      const byCharm = guideplan.enhanceStats(rows);
      return json(res, { charm, tiers: tiers.map((x) => x.tier), tier: tier.tier, odds, guideOdds: tier.odds, own, plan, prices, logged: enhanceLog.length, recent: enhanceLog.slice(-12).reverse(),
        friendsLogged: theirs.length, friendsNames: [...new Set(theirs.map((r) => r.from))], pooled: q.get('pool') === '1',
        session: enhanceSession, announced: enhanceAnnounced.slice(-15).reverse(), sofCharms: guideplan.SOF_CHARMS, charmGrades: guideplan.charmGrades(rows, KR_GUIDE),
        grades: Object.fromEntries(['best', 'high', 'mid'].map((c) => [c, { odds: guideplan.enhanceTiers(KR_GUIDE, c)[0]?.odds || [], own: byCharm[c] || {} }])) });
    }
    if (req.method === 'POST' && route === '/api/enhance-session') {
      const b = JSON.parse(await readBody(req));
      enhanceSession = { ...enhanceSession, active: b.active === undefined ? enhanceSession.active : !!b.active, level: Math.max(1, Math.min(15, Math.round(+b.level || enhanceSession.level))),
        charm: ['best', 'high', 'mid'].includes(b.charm) ? b.charm : enhanceSession.charm, item: String(b.item ?? enhanceSession.item ?? '').slice(0, 60),
        sofCharm: b.sofCharm === undefined ? enhanceSession.sofCharm : (guideplan.SOF_CHARMS.includes(b.sofCharm) ? b.sofCharm : '') };
      store.writeJson('enhance-session.json', enhanceSession);
      return json(res, enhanceSession);
    }
    // potions: the ones the guide knows, with what they cost (chat price, else the shop price)
    if (route === '/api/potions') return json(res, potionList());
    if (route === '/api/maze') return json(res, mazeRuns.view(zoneName));
    if (route === '/api/day-plan') return json(res, dayPlanView(Date.now()));
    if (req.method === 'GET' && route === '/api/events-custom') return json(res, { list: customEvents.view(), presets: plans.EVENT_PRESETS });
    if (req.method === 'POST' && route === '/api/events-custom') { const v = customEvents.change(JSON.parse(await readBody(req))); dayNextCache.at = 0; return json(res, { list: v, presets: plans.EVENT_PRESETS }); }
    if (req.method === 'POST' && route === '/api/signup') {
      const b = JSON.parse(await readBody(req));
      if (!Number.isFinite(+b.t) || !b.label) throw new Error('bad sign-up');
      signups = plans.toggleSignup(signups, { t: +b.t, label: String(b.label) }, !!b.on);
      store.writeJson('signups.json', signups); dayNextCache.at = 0; syncFriends();
      return json(res, { ok: true, signups });
    }
    if (route === '/api/honor') return json(res, honorView(url.searchParams.get('name') || undefined));
    if (req.method === 'POST' && route === '/api/ask') { const b = JSON.parse(await readBody(req)); return json(res, ask.answer(String(b.q || '').slice(0, 200), askContext())); }
    if (route === '/api/compare') { const days = [7, 30, 90].includes(+url.searchParams.get('days')) ? +url.searchParams.get('days') : 30; return json(res, { days, chars: compareView(days) }); }
    if (route === '/api/characters') return json(res, { list: myCharacters(), view: myCharacter(), picked: settings.viewCharacter || null, inGame: state.session.character || null });
    if (route === '/api/zone-risk') return json(res, zoneRisk(url.searchParams.get('zone') ?? state.session.position?.zone));
    // danger by hour of the day in a zone: your deaths and the enemy-faction players met there (30 days)
    if (route === '/api/zone-hours') {
      const zone = String(url.searchParams.get('zone')), since = Date.now() - 30 * 86400000, deaths = Array(24).fill(0), enemies = Array(24).fill(0), mine = myFaction();
      for (const d of farming.data.deaths) if (String(d.zone) === zone && d.t >= since) deaths[new Date(d.t).getHours()]++;
      for (const r of Object.values(sessions)) if ((r.endedAt || r.startedAt) >= since) for (const [name, p] of Object.entries(r.players || {})) {
        const fac = playerInfo(name)?.faction;
        if (String(p.zone) === zone && mine && fac && fac !== mine) enemies[new Date(p.firstSeen || r.startedAt).getHours()]++;
      }
      return json(res, { zone, deaths, enemies, myFaction: mine });
    }
    // quest chains: the quests you ticked off, for the character the dashboard shows
    if (route === '/api/quests-done') { const who = myCharacter() || 'me'; return json(res, { character: who, done: questsDone[who] || [], active: questWatch.active(who)?.ids || [] }); }
    // the quests in progress (read from the quest window), with their steps: where to go, what to bring
    if (route === '/api/quests-active') {
      const who = myCharacter(), a = questWatch.active(who);
      if (!a) return json(res, { character: who, seenAt: null, quests: [] });
      const views = a.quests.map((q) => questSearch(new URLSearchParams({ q: q.name, range: '999', character: who || '' })).quests.find((x) => x.id === q.id) || { ...q, steps: [], rewards: [] });
      // your other characters and friends with the same quests
      const mates = friends.questMates(a.ids);
      for (const c of knownChars()) if (c.toLowerCase() !== String(who).toLowerCase()) for (const id of questWatch.active(c)?.ids || []) if (a.ids.includes(id)) (mates[id] ||= []).push(c);
      return json(res, { character: who, seenAt: a.t, quests: views, mates });
    }
    // quest items: how far along, set by hand (POST { quest, item, picked })
    if (req.method === 'GET' && route === '/api/quest-progress') { const who = myCharacter(); return json(res, { character: who, quests: who ? questProgView(who) : [] }); }
    if (req.method === 'POST' && route === '/api/quest-progress') {
      const b = JSON.parse(await readBody(req)), who = myCharacter();
      return json(res, { ok: !!who && questProg.set(who, String(b.quest), String(b.item), b.picked) });
    }
    if (route === '/api/quest-route') { const who = myCharacter(); return json(res, { character: who, ...(who ? questRouteView(who) : { stops: [], total: 0 }) }); }
    // the phone page's planning cards in one go: checklist, quest trip with item counts, gear goals
    if (route === '/api/phone-plan') {
      const who = myCharacter(), now = Date.now();
      let trip = { stops: [] }, prog = [];
      try { if (who && feat('quests')) { trip = questRouteView(who); prog = questProgView(who); } } catch { /* quest data not ready */ }
      return json(res, { character: who, checklist: checklist.view(now, who, knownChars()).map(({ id, text, done, nextReset, every, perChar }) => ({ id, text, done, nextReset, every, perChar })),
        trip: trip.stops.slice(0, 8).map(({ kind, label, zoneName: z, zone, questName }) => ({ kind, label, zoneName: z || zoneName(zone), questName })),
        items: prog.flatMap((q) => q.items.map((i) => ({ quest: q.id, questName: q.name, itemId: i.itemId, name: i.name, picked: i.picked, need: i.need, killsLeft: i.killsLeft }))),
        goals: who && feat('gear') ? gearGoalsView(who).map(({ kind, name, have, price }) => ({ kind, name, have, price })) : [] });
    }
    // the tray says which hotkeys it could register (other programs can hold them)
    if (route === '/api/tray-status' && req.method === 'POST') {
      if (!/^(::1|127\.|::ffff:127\.)/.test(req.socket.remoteAddress || '')) { res.writeHead(403); return res.end('PC only'); }
      const b = JSON.parse(await readBody(req));
      readerTools.setTrayStatus({ at: Date.now(), keys: Object.fromEntries(['M', 'O', 'L', 'S', 'I'].map((k) => [k, !!b[k]])) });
      return json(res, { ok: true });
    }
    if (route === '/api/setup-check') {
      // plus the game's own settings that matter for the screen reader (ybopt2.cfg)
      const r = setupCheck(), o = gameFiles().options;
      if (o) {
        const issues = gamecfg.readerIssues(o);
        const row = (id, label, ok, detail, fix) => ({ id, label, status: ok ? 'ok' : 'warn', detail, fix });
        r.rows.push(row('winmode', 'Game window mode', o.Winmode !== 0, o.Winmode === 0 ? 'full screen' : 'windowed or borderless', issues.find((i) => i.key === 'Winmode')?.text || ''));
        if (o.ChatBackgroundAlpha != null) r.rows.push(row('chatbg', 'Chat background (for reading the chat)', o.ChatBackgroundAlpha >= 60, `${o.ChatBackgroundAlpha} of 100`, issues.find((i) => i.key === 'ChatBackgroundAlpha')?.text || ''));
        r.warnings = r.rows.filter((x) => x.status === 'warn').length;
      }
      return json(res, r);
    }
    // a character's skill bar and auto-combat setup from the game files, with advice
    if (route === '/api/skill-setup') {
      const chars = [...new Set([...knownChars(), ...[...gameFiles().chars.values()].filter((c) => c.bar?.slots.length || c.auto?.slots.length).map((c) => c.name)])];
      const who = url.searchParams.get('char') || myCharacter() || chars[0] || null;
      return json(res, { ...skillSetup(who), chars });
    }
    // the game's settings: what costs the most, what was changed and when
    if (route === '/api/game-options') {
      const g = gameFiles();
      return json(res, { options: g.options, heavy: gamecfg.graphicsHeavy(g.options), reader: gamecfg.readerIssues(g.options), history: optionLog.history.slice(0, 20), freezes24h: gamePerf.view(Date.now()).today });
    }
    if (route === '/api/features') return json(res, { features: FEATURES.map((x) => ({ ...x, on: feat(x.id) })), alertMute: settings.alertMute || {}, alertCap: settings.alertCap || 0, quietFarming: !!settings.quietFarming });
    // debug captures and the debug bundle (a zip to send for tuning the readers): game pictures and logs, so this PC only
    if ((route.startsWith('/api/debug') || route === '/api/pickup-learn') && !/^(::1|127\.|::ffff:127\.)/.test(req.socket.remoteAddress || '')) { res.writeHead(403); return res.end('PC only'); }
    if (route === '/api/debug' && req.method === 'GET') return json(res, { on: !!settings.debugCapture, captures: debugList() });
    if (route === '/api/debug' && req.method === 'POST') {
      const b = JSON.parse(await readBody(req));
      if (b.action === 'clear') for (const f of fs.existsSync(DEBUG_DIR) ? fs.readdirSync(DEBUG_DIR) : []) if (/\.(json|jpg)$/.test(f)) fs.unlinkSync(path.join(DEBUG_DIR, f));
      return json(res, { ok: true, captures: debugList() });
    }
    if (route.startsWith('/api/debug-shot/')) {
      const name = path.basename(decodeURIComponent(route.slice('/api/debug-shot/'.length)));
      const file = path.join(DEBUG_DIR, name);
      if (!/^[\w.-]+\.jpg$/.test(name) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' }); return res.end(fs.readFileSync(file));
    }
    if (route === '/api/debug-bundle') {
      const data = debugBundle();
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="sof-tracker-debug-${stamp()}.zip"` });
      return res.end(data);
    }
    // the reader check, with lines that may be pickup messages and the ones you taught
    if (route === '/api/reader-check' && req.method === 'GET') return json(res, { ...readerCheckView(), candidates: quests.pickupCandidates().slice().reverse(), patterns: quests.pickupPatterns() });
    if (route === '/api/pickup-learn' && req.method === 'POST') {
      const b = JSON.parse(await readBody(req));
      if (b.action === 'dismiss') { quests.dismissCandidate(b.line); return json(res, { ok: true }); }
      if (b.action === 'forget') { quests.forgetPattern(b.re); return json(res, { ok: true }); }
      return json(res, { ok: true, re: learnPickup(b.line, b.itemText) });
    }
    // the hotkey (Ctrl+Shift+I): +1 quest item for the trip's next collect stop (or the first item still missing)
    if (route === '/api/quest-item-plus' && req.method === 'POST') {
      const who = state.session.character;
      if (!who) return json(res, { ok: false, label: 'No character in game' });
      const prog = questProgView(who), next = questRouteView(who).stops.find((s) => s.kind === 'collect');
      let pick = null;
      for (const p of prog) for (const it of p.items) if (it.picked < it.need && (!pick || (next && next.quest === p.id && next.label.startsWith(it.name)))) pick = { q: p, it };
      if (!pick) return json(res, { ok: false, label: 'No quest items to count' });
      questProg.pickup(who, { name: pick.it.name, qty: 1 }, activeQuestViews(who), (a, b) => a === b);
      recapEvent(Date.now(), who, 'pickup', 1);
      quests.resetNext();
      return json(res, { ok: true, label: `${pick.it.name} ${pick.it.picked + 1} of ${pick.it.need}` });
    }
    if (req.method === 'POST' && route === '/api/alert-undo') {
      const b = JSON.parse(await readBody(req));
      return json(res, { ok: undoAlert(alerts.find((a) => a.id === +b.id)) });
    }
    if (route === '/api/char-status') return json(res, skillsView(myCharacter()));
    if (route === '/api/mob-stats') return json(res, mobStatsView(myCharacter()));
    // the official guide's pages the game links to, named in English and grouped (links only)
    if (route === '/api/guide-links') return json(res, { groups: guideLinkGroups(gameDb.guideLinks) });
    if (route === '/api/quest-history') { const who = myCharacter(); return json(res, { character: who, ...questplan.questHistory(quests.questLog(), who) }); }
    if (route === '/api/quests-available') { const who = myCharacter(); return json(res, { character: who, ...availableView(who) }); }
    // EXP per day: monsters or quests handed in
    if (route === '/api/exp-split') {
      const who = myCharacter(), days = Math.min(60, +url.searchParams.get('days') || 14), now = Date.now(), list = [];
      for (let i = days - 1; i >= 0; i--) {
        const from = new Date(now - i * 86400000); from.setHours(0, 0, 0, 0);
        const r = dailyStats.range(+from, +from + 86400000, who);
        list.push({ day: dayKey(+from), mob: r.expMob || 0, quest: r.expQuest || 0, quests: r.questsIn || 0, pts: r.expPts || 0, ptsQuest: r.expPtsQuest || 0 });
      }
      const sum = (k) => Math.round(list.reduce((s, d) => s + d[k], 0) * 100) / 100;
      return json(res, { character: who, days: list, mob: sum('mob'), quest: sum('quest'), quests: sum('quests'), pts: sum('pts'), ptsQuest: sum('ptsQuest'), now: expPtsView(who) });
    }
    // gear score: yours with its history, your other characters, friends'
    if (route === '/api/gear-score') {
      const who = myCharacter();
      const chars = knownChars().filter((c) => gearLog.list(c).length).map((c) => ({ char: c, score: charGearScore(c).score }));
      return json(res, { ...gearScoreView(who), chars, friends: friends.gearScores() });
    }
    // the gold ledger: each change of gold sorted into what it probably was
    if (route === '/api/gold-ledger') {
      const who = myCharacter(), days = Math.min(90, +url.searchParams.get('days') || 7), now = Date.now();
      if (!who) return json(res, { character: null, rows: [], cats: {}, days: [] });
      const pts = invWatch.history(who, days + 1);
      const r = ledger.goldLedger(pts, { exchanges: exchanges.map((e) => e.t), enhance: enhanceLog.filter((e) => !e.character || String(e.character).toLowerCase() === who.toLowerCase()).map((e) => e.t), trades: trades.filter((x) => !x.character || x.character === who) }, { from: now - days * 86400000, to: now });
      // gold picked up, counted exactly from "Gold obtained" in the chat (the ledger's loot line is a difference between two looks)
      const lootChat = dailyStats.range(now - days * 86400000, now + 1, who).goldLoot || 0;
      return json(res, { character: who, ...r, rows: r.rows.slice(0, 200), lootChat });
    }
    if (route === '/api/lfg') return json(res, lfgPosts.slice().reverse());
    if (req.method === 'GET' && route === '/api/gear') {
      const char = url.searchParams.get('all') === '1' ? null : myCharacter(), now = Date.now();
      const items = gearLog.list(char).map((r) => ({ ...r, slotName: r.slot, price: gearPrice(r), priceNext: (r.plus || 0) < 10 ? gearPrice(r, (r.plus || 0) + 1) : null }));
      // which piece is cheapest to enhance next: the guide's high-grade odds (your own where you logged 5+ tries)
      const tiers = guideplan.enhanceTiers(KR_GUIDE, 'high'), own = guideplan.enhanceStats(enhanceLog).high || {};
      const upgrades = inv.upgradePlan(items, (cls) => guideplan.ownOdds(tiers[inv.tierIndex(cls, tiers.map((x) => x.tier))]?.odds || [], own),
        (g, plus) => { const p = gearPrice(g, plus); return p.sell ?? p.buy ?? null; });
      const ses = state.session.startedAt && char === state.session.character ? invWatch.rate(char, state.session.startedAt, now) : null;
      const nw = char ? { ...gearValue(char), gold: invWatch.last(char)?.gold ?? null, history: netWorth.history(char).map((p) => [p.t, p.gold + (p.gear || 0)]) } : null;
      // enchanting and combining, last 30 days (the game's "…has succeed / failed" messages)
      const craft = {}; for (const c of craftLog) if ((!char || String(c.char).toLowerCase() === char.toLowerCase()) && now - c.t < 30 * 86400000) { const k = (craft[c.kind] ||= { ok: 0, n: 0 }); k.n++; if (c.ok) k.ok++; }
      return json(res, { char, items, upgrades, craft, budget: char ? enhanceBudget(char, upgrades) : null, netWorth: nw, goals: char ? gearGoalsView(char) : [], compare: (() => { const g = gearGold.gearCompare(); return g && now - g.t < 10 * 60000 ? g : null; })(),
        gold: char ? { last: invWatch.last(char), session: ses, day: invWatch.between(char, now - 86400000, now), week: invWatch.between(char, now - 7 * 86400000, now), history: invWatch.history(char, 30).map((p) => [p.t, p.gold]) } : null,
        weight: char ? invWatch.weight.get(String(char).toLowerCase()) || null : null, gearOffers: gearGold.gearOffers().length });
    }
    // gear goals: { kind, itemId } sets one (itemId null removes it), for the character the dashboard shows
    if (req.method === 'POST' && route === '/api/gear-goals') {
      const b = JSON.parse(await readBody(req)), who = myCharacter();
      if (!who) throw new Error('no character yet');
      const kind = inv.gearKind(String(b.kind || '')), k = who.toLowerCase();
      if (!kind) throw new Error('unknown slot');
      const g = (gearGoals[k] ||= {});
      if (b.itemId && gameDb.items.some((x) => x.id === +b.itemId)) g[kind] = +b.itemId; else delete g[kind];
      store.writeJson('gear-goals.json', gearGoals);
      return json(res, { ok: true, goals: gearGoalsView(who) });
    }
    if (req.method === 'POST' && route === '/api/gear') {
      const b = JSON.parse(await readBody(req));
      if (b.action === 'delete') gearLog.remove(String(b.key));
      if (b.action === 'equip') { gearLog.equip(); gearGold.clearGearCompare(); }
      if (b.action === 'dismiss') gearGold.clearGearCompare();
      if (b.action === 'clean') return json(res, { ok: true, removed: gearLog.clean() });
      return json(res, { ok: true });
    }
    if (req.method === 'GET' && route === '/api/my-goals') return json(res, { goals: goalsView(), chars: knownChars(), char: myCharacter() });
    if (req.method === 'POST' && route === '/api/my-goals') {
      const b = JSON.parse(await readBody(req));
      if (b.action === 'delete') myGoals = myGoals.filter((g) => g.id !== b.id);
      else if (b.action === 'value') { const g = myGoals.find((x) => x.id === b.id); if (g) g.value = +b.value || 0; }
      else {
        const kind = ['level', 'honor', 'gold', 'custom'].includes(b.kind) ? b.kind : 'custom', by = Date.parse(b.by), target = +b.target;
        if (!Number.isFinite(by) || by < Date.now() || !Number.isFinite(target)) throw new Error('Give a target and a date in the future');
        const char = String(b.char || myCharacter() || '').slice(0, 40);
        const g = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, kind, target, by, char, value: kind === 'custom' ? +b.value || 0 : undefined,
          label: String(b.label || '').trim().slice(0, 60) || `${{ level: 'Level', honor: 'Honor', gold: 'Gold', custom: 'Goal' }[kind]} ${kind === 'gold' ? market.gold(target) : target}${char ? ` (${char})` : ''}` };
        g.start = { t: Date.now(), value: goalValue(g) ?? 0 };
        myGoals.push(g);
      }
      store.writeJson('my-goals.json', myGoals);
      return json(res, { goals: goalsView(), chars: knownChars(), char: myCharacter() });
    }
    // regions: per zone, what lives there (with levels), the NPCs, the quests that start there, the Korean guide's level range
    if (route === '/api/regions') return json(res, regionsView());
    if (req.method === 'GET' && route === '/api/asc') return json(res, ascView());
    if (req.method === 'POST' && route === '/api/asc') {
      const b = JSON.parse(await readBody(req)), num = (v, max) => Math.max(0, Math.min(max, Math.round(+v || 0)));
      const name = String(myCharacter() || '').toLowerCase(), cur = ascFor(name);
      if (!ascState.byChar) ascState = { byChar: {} }; // the first version kept one set for everyone
      ascState.byChar[name] = { asc: num(b.asc ?? cur.asc, 7), gold: num(b.gold ?? cur.gold, 1e12), ki: num(b.ki ?? cur.ki, 1e12), stones: num(b.stones ?? cur.stones, 1e6) };
      store.writeJson('asc.json', ascState);
      return json(res, ascView());
    }
    // when an item is cheapest to buy and pays most to sell, from the chat's offers
    if (route === '/api/price-times') {
      const id = +url.searchParams.get('item');
      return json(res, plans.priceTimes(marketOffers().filter((o) => o.itemId === id)));
    }
    if (req.method === 'GET' && route === '/api/shopping') return json(res, shoppingView());
    if (req.method === 'POST' && route === '/api/shopping') {
      const b = JSON.parse(await readBody(req));
      if (b.action === 'clear') shopping = [];
      else if (b.action === 'remove') shopping = shopping.filter((x) => x.id !== +b.id);
      else {
        const it = gameDb.items.find((i) => i.id === +b.id) || gameDb.items.find((i) => i.name.toLowerCase() === String(b.name || '').toLowerCase());
        if (!it) throw new Error('item not found');
        const row = shopping.find((x) => x.id === it.id), qty = Math.max(1, Math.min(9999, Math.round(+b.qty || 1)));
        // the highest price you'd pay: an alert when someone in the chat sells it for that or less
        const maxPrice = b.maxPrice === undefined ? undefined : Math.max(0, Math.round(+b.maxPrice || 0)) || null;
        if (b.action === 'set' && row) { if (b.qty !== undefined) row.qty = qty; if (maxPrice !== undefined) row.maxPrice = maxPrice; }
        else if (row) row.qty += qty; else shopping.push({ id: it.id, qty, note: String(b.note || '').slice(0, 60), maxPrice: maxPrice || null });
        shopping = shopping.slice(-200);
      }
      store.writeJson('shopping.json', shopping);
      return json(res, shoppingView());
    }
    if (req.method === 'POST' && route === '/api/enhance-log') {
      const b = JSON.parse(await readBody(req));
      if (b.undo) enhanceLog.pop();
      else {
        const level = Math.round(+b.level);
        if (!(level >= 1 && level <= 15) || !['best', 'high', 'mid'].includes(b.charm)) throw new Error('bad enhance result');
        enhanceLog.push({ t: Date.now(), level, charm: b.charm, ok: !!b.ok, item: String(b.item || '').slice(0, 60) || undefined,
          sofCharm: guideplan.SOF_CHARMS.includes(b.sofCharm) ? b.sofCharm : undefined });
        enhanceLog = enhanceLog.slice(-2000);
      }
      store.writeJson('enhance-log.json', enhanceLog);
      return json(res, { ok: true, logged: enhanceLog.length });
    }
    if (req.method === 'POST' && route === '/api/passes') {
      const b = JSON.parse(await readBody(req));
      passTimers.set(b.kind, Math.max(0, Math.min(48 * 60, Math.round(+b.minutes || 0))));
      return json(res, passTimers.view());
    }
    if (route === '/api/level-places') {
      const level = Math.round(+url.searchParams.get('level') || playerInfo(state.session.character)?.level || 0);
      if (!level) return json(res, { level: null, places: [] });
      const ix = gameIndex(), byZone = {};
      for (const [id, list] of ix.spots) { const lv = ix.mob.get(id)?.level; if (lv) for (const p of list) (byZone[p.zone] ||= new Set()).add(`${id}:${lv}`); }
      const mobZones = Object.entries(byZone).map(([zone, set]) => ({ zone: +zone, levels: [...set].map((x) => +x.split(':')[1]) }));
      const best = farming.best(), pots = potionList();
      const places = guideplan.levelPlaces({ level, guide: KR_GUIDE, zones: gameDb.zones, spots: best, mobZones, now: Date.now() });
      // the potion cost of the places you farmed (the best spot in that zone)
      for (const p of places) { const s = best.find((x) => String(x.zone) === String(p.zone)); if (s) Object.assign(p, spotCost(s, pots)); }
      return json(res, { level, places: places.map((p) => ({ ...p, zoneName: p.zone != null ? zoneName(p.zone) : p.name, here: state.session.position && String(state.session.position.zone) === String(p.zone) })) });
    }
    if (route === '/api/buff-durations') return json(res, buffDurations.list());
    if (route === '/api/search') return json(res, searchAll(String(url.searchParams.get('q') || '')));
    if (route === '/api/predictions') return json(res, rankings.predictions());
    if (route === '/api/house') return json(res, { ...houseView(url.searchParams.get('name') ?? settings.myHouse), log: houseLog.slice(-40).reverse() });
    if (route === '/api/stats') {
      const cal = calendar();
      return json(res, {
        characters: stats.characters(sessions, playerInfo, zoneName),
        patterns: stats.patterns(cal.spans),
        busy: busyView(),
        milestones: milestonesView(),
      });
    }
    if (route === '/api/activity') {
      const days = [0, 7, 30, 90, 365].includes(+url.searchParams.get('days')) ? +url.searchParams.get('days') : 0;
      return json(res, activityView(url.searchParams.get('tz') === 'server' ? 'server' : 'local', days, url.searchParams.get('metric') === 'near' ? 'near' : 'met'));
    }
    if (route === '/api/patches') return json(res, patches.status());
    if (route === '/api/patch') return json(res, patches.report(url.searchParams.get('id') || ''));
    if (req.method === 'POST' && route === '/api/patches/check') {
      const r = await patches.check('manual');
      return json(res, { changed: !!r, status: patches.status() });
    }
    // follow another open game window on the dashboard
    if (req.method === 'POST' && route === '/api/focus') {
      const { pid } = JSON.parse(await readBody(req));
      if (!others.has(+pid)) { res.writeHead(404); return res.end('That game window is not open'); }
      focusPid = +pid;
      checkGameProcess();
      res.writeHead(204); return res.end();
    }
    if (route === '/api/trades' && req.method === 'GET') return json(res, trades);
    if (route === '/api/friends') return json(res, { list: friends.list(), error: friends.error, lastSync: friends.lastSync, syncDir: settings.syncDir, syncName: settings.syncName });
    if (route === '/api/session-trail') {
      const key = url.searchParams.get('key') || '';
      if (!sessions[key]) return json(res, null);
      const liveS = [state.session, ...[...others.values()].map((o) => o.session)].find((s) => sessionKey(s) === key);
      if (liveS) return json(res, liveS.track);
      try { return json(res, JSON.parse(fs.readFileSync(trailFile(key), 'utf8'))); } catch { return json(res, []); }
    }
    let m;
    if ((m = /^\/api\/minimap\/(\d+)$/.exec(route)) && zoneMaps[m[1]]) {
      res.writeHead(200, { 'Content-Type': 'image/bmp', 'Cache-Control': 'max-age=86400' });
      return fs.createReadStream(path.join(MINIMAP_DIR, `${m[1]}.bmp`)).pipe(res);
    }
    if ((m = /^\/guide-img\/([\w.-]+)$/.exec(route)) && fs.existsSync(path.join(GUIDE_IMG_DIR, m[1]))) {
      const ext = path.extname(m[1]).toLowerCase();
      res.writeHead(200, { 'Content-Type': ext === '.gif' ? 'image/gif' : ext === '.png' ? 'image/png' : 'image/jpeg', 'Cache-Control': 'max-age=86400' });
      return fs.createReadStream(path.join(GUIDE_IMG_DIR, m[1])).pipe(res);
    }
    if (route === '/api/settings' && req.method === 'GET') return json(res, { ...settings, autostart: fs.existsSync(STARTUP_LNK), backups: listBackups(), backupState, houses: houseNames() });
    if (route === '/api/export.xlsx') {
      const buf = exportWorkbook();
      res.writeHead(200, {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="sof-tracker-${stamp()}.xlsx"`,
        'Content-Length': buf.length,
      });
      return res.end(buf);
    }

    // everything below changes this PC, so it is only allowed from the PC itself (not the phone view)
    const local = /^(::1|127\.|::ffff:127\.)/.test(req.socket.remoteAddress || '');
    const PC_ONLY = ['/api/launch', '/api/autostart', '/api/overlay', '/api/backup', '/api/settings', '/api/notify', '/api/notify/test',
      '/api/cleanup', '/api/update/install', '/api/update/publish', '/api/diagnostics', '/api/discord-bot', '/api/discord-bot/try', '/api/sounds', '/api/tidy'];
    if (PC_ONLY.includes(route) && (req.method === 'POST' || ['/api/backup', '/api/notify', '/api/diagnostics', '/api/discord-bot', '/api/discord-bot/try'].includes(route)) && !local) {
      res.writeHead(403); return res.end('This only works on the PC running the tracker');
    }

    if (req.method === 'POST' && route === '/api/cleanup') return json(res, cleanup(JSON.parse(await readBody(req))));
    // your own alert sounds (data\sounds): list, add (the file itself as the body, ?name=), delete
    if (route === '/api/sounds' && req.method === 'GET') return json(res, { files: soundFiles() });
    if (route === '/api/sounds' && req.method === 'POST') {
      const name = url.searchParams.get('name');
      if (name) {
        const safe = soundName(name);
        if (!safe) throw new Error('Use an .mp3, .wav, .ogg or .m4a file');
        const body = await readRaw(req, 3 * 1048576);
        if (!body.length) throw new Error('Empty file');
        fs.mkdirSync(SOUND_DIR, { recursive: true });
        fs.writeFileSync(path.join(SOUND_DIR, safe), body);
        return json(res, { ok: true, name: safe, files: soundFiles() });
      }
      const b = JSON.parse(await readBody(req)), safe = soundName(b.name || '');
      if (b.action === 'delete' && safe) {
        try { fs.unlinkSync(path.join(SOUND_DIR, safe)); } catch { /* gone */ }
        // alert types that used it go back to the usual sound
        const sounds = Object.fromEntries(Object.entries(settings.sounds || {}).filter(([, v]) => v.s !== `file:${safe}`));
        applySettings({ sounds });
      }
      return json(res, { files: soundFiles() });
    }
    // tidy-up now (Settings → Storage), with the limits saved there
    if (route === '/api/tidy' && req.method === 'POST') return json(res, { ...autoTidy(Date.now(), true), storage: storageView() });
    // used by the installer / uninstaller: save everything and stop
    if (req.method === 'POST' && route === '/api/shutdown') {
      if (!local) { res.writeHead(403); return res.end('PC only'); }
      json(res, { stopping: true });
      setTimeout(shutdown, 200);
      return;
    }
    if (route === '/api/diagnostics') {
      const buf = diagnostics();
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="sof-tracker-diagnostics-${stamp()}.zip"`, 'Content-Length': buf.length });
      return res.end(buf);
    }

    if (route === '/api/discord-bot' && req.method === 'GET') return json(res, botView());
    if (route === '/api/discord-bot' && req.method === 'POST') {
      const b = JSON.parse(await readBody(req));
      if (b.token !== undefined && !/^•+/.test(b.token)) {
        const tk = String(b.token).trim();
        if (tk && !/^[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,}$/.test(tk)) throw new Error('That does not look like a Discord bot token');
        botCfg.token = tk;
      }
      if (b.allowed !== undefined) botCfg.allowed = String(b.allowed).split(/[\s,]+/).filter((x) => /^\d{15,22}$/.test(x)).slice(0, 20);
      store.writeJson('discord-bot.json', botCfg);
      startBot();
      return json(res, botView());
    }
    // preview of what a command would answer (Settings → Discord bot)
    if (route === '/api/discord-bot/try') {
      const cmd = url.searchParams.get('cmd');
      if (!botAnswers[cmd]) { res.writeHead(404); return res.end('unknown command'); }
      const arg = url.searchParams.get('arg') || '';
      const r = await botAnswers[cmd]({ name: arg, to: arg, who: arg, item: arg });
      return json(res, { text: r && typeof r === 'object' ? `${r.content}\n[+ picture: ${r.file.name}, ${Math.round(r.file.data.length / 1024)} KB]` : r });
    }
    if (route === '/api/notify' && req.method === 'GET') return json(res, notifier.publicConfig());
    if (route === '/api/notify' && req.method === 'POST') return json(res, notifier.update(JSON.parse(await readBody(req))));
    if (route === '/api/notify/test' && req.method === 'POST') return json(res, await notifier.test());

    if (req.method === 'POST' && route === '/api/trades') {
      const b = JSON.parse(await readBody(req));
      if (b.action === 'delete') trades = trades.filter((t) => t.id !== b.id);
      else {
        const item = String(b.item || '').trim().slice(0, 80);
        if (!item) throw new Error('item is required');
        const n = (v) => { const x = Number(String(v ?? '').replace(/[ ,_]/g, '')); return Number.isFinite(x) ? x : null; };
        trades.push({
          id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, t: Date.now(),
          type: ['drop', 'buy', 'sell', 'trade'].includes(b.type) ? b.type : 'drop', item,
          qty: Math.max(1, Math.round(n(b.qty) || 1)), price: n(b.price), with: String(b.with || '').trim().slice(0, 40) || null,
          note: String(b.note || '').trim().slice(0, 200) || null,
          zone: state.session.position?.zone ?? null, character: state.session.character || null,
        });
        if (trades.length > 5000) trades = trades.slice(-5000);
      }
      store.writeJson('trades.json', trades);
      return json(res, trades);
    }
    // used by the in-game hotkey: drop a marker where you stand
    if (req.method === 'POST' && route === '/api/mark-here') {
      const p = state.session.position;
      if (!p) { res.writeHead(409); return res.end('No position known yet'); }
      const b = JSON.parse((await readBody(req)) || '{}');
      const label = String(b.label || '').trim().slice(0, 40) || `Marked ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      waypoints.push({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, zone: String(p.zone), x: p.x, z: p.z, label, kind: ['farm', 'boss', 'npc', 'danger', 'star'].includes(b.kind) ? b.kind : 'star', at: Date.now() });
      store.writeJson('waypoints.json', waypoints);
      addAlert('marker', `Marker added: ${label}`, `${zoneName(p.zone)} · x ${Math.round(p.x)}, z ${Math.round(p.z)}`);
      return json(res, { ok: true, label });
    }

    if (req.method === 'POST' && route === '/api/settings') return json(res, applySettings(JSON.parse(await readBody(req))));
    if (req.method === 'POST' && route === '/api/autostart') {
      const { on } = JSON.parse(await readBody(req));
      return setAutostart(!!on, (err) => {
        if (err) { res.writeHead(500); return res.end(err); }
        json(res, { autostart: fs.existsSync(STARTUP_LNK) });
      });
    }
    if (req.method === 'POST' && route === '/api/overlay') {
      const { open, toggle } = JSON.parse(await readBody(req));
      if (toggle) {
        // the hotkey: close the overlay if it is open, otherwise open it
        const ps = "if (Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | Where-Object { $_.CommandLine -like '*overlay-profile*' }) { 'open' } else { 'closed' }";
        execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true }, (_e, out) => (/open/.test(out) ? closeOverlay() : openOverlay()));
      } else if (open) openOverlay(); else closeOverlay();
      res.writeHead(204); return res.end();
    }
    if (route === '/api/backup') {
      const { name, buf } = makeBackup();
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${name}"`, 'Content-Length': buf.length });
      return res.end(buf);
    }

    if (req.method === 'POST' && route === '/api/launch') {
      if (!fs.existsSync(LAUNCHER)) { res.writeHead(404); return res.end(`Launcher not found: ${LAUNCHER}`); }
      // a second client: only while exactly one is running (two at most)
      if (url.searchParams.get('second') === '1' && (state.game.count || 0) >= 2) { res.writeHead(409); return res.end('Two game clients are already running.'); }
      // Start-Process goes through the Windows shell, so a launcher that needs admin rights gets its normal UAC prompt
      const ps = `Start-Process -FilePath '${LAUNCHER.replace(/'/g, "''")}' -WorkingDirectory '${GAME_DIR.replace(/'/g, "''")}'`;
      execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true }, (err, _out, stderr) => {
        if (err) { res.writeHead(500); return res.end(String(stderr || err.message).trim()); }
        console.log('[tracker] launcher started');
        res.writeHead(204); res.end();
      });
      return;
    }
    if (req.method === 'POST' && route === '/api/label') {
      const { kind, id, name } = JSON.parse(await readBody(req));
      if (!['zones', 'buffs'].includes(kind) || !/^-?\d+$/.test(String(id))) throw new Error('bad label');
      labels[kind] ||= {};
      if (name && String(name).trim()) labels[kind][id] = String(name).trim().slice(0, 60);
      else delete labels[kind][id];
      store.writeJson('labels.json', labels);
      res.writeHead(204); return res.end();
    }
    if (req.method === 'POST' && route === '/api/player') {
      const b = JSON.parse(await readBody(req));
      const name = String(b.name || '').trim();
      if (!name || name.length > 40) throw new Error('bad name');
      const clean = (x, max = 40) => (x == null || String(x).trim() === '' ? null : String(x).trim().slice(0, max));
      const level = b.level === '' || b.level == null ? null : Math.max(1, Math.min(999, parseInt(b.level, 10) || 0)) || null;
      const entry = { name, level, cls: clean(b.cls), faction: clean(b.faction), house: clean(b.house), note: clean(b.note, 200), updatedAt: Date.now() };
      const key = name.toLowerCase();
      if (!entry.level && !entry.cls && !entry.faction && !entry.house && !entry.note) delete playerNotes[key];
      else playerNotes[key] = entry;
      store.writeJson('players.json', playerNotes);
      res.writeHead(204); return res.end();
    }
    if (req.method === 'POST' && route === '/api/watch') {
      const { name, on } = JSON.parse(await readBody(req));
      const n = String(name || '').trim();
      if (!n || n.length > 40) throw new Error('bad name');
      watchlist = watchlist.filter((w) => w.toLowerCase() !== n.toLowerCase());
      if (on) watchlist.push(n);
      store.writeJson('watchlist.json', watchlist);
      res.writeHead(204); return res.end();
    }
    const snd = /^\/sounds\/([^/]+)$/.exec(route);
    if (snd) {
      const safe = soundName(decodeURIComponent(snd[1])), file = safe && path.join(SOUND_DIR, safe);
      if (!file || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': SOUND_TYPES[path.extname(safe).slice(1)], 'Cache-Control': 'max-age=3600' });
      return fs.createReadStream(file).pipe(res);
    }
    if (STATIC[route]) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return fs.createReadStream(path.join(PUBLIC_DIR, STATIC[route])).pipe(res);
    }
    // installable app: manifest, service worker, icons
    if (route === '/manifest.webmanifest') { res.writeHead(200, { 'Content-Type': 'application/manifest+json' }); return fs.createReadStream(path.join(PUBLIC_DIR, 'manifest.webmanifest')).pipe(res); }
    if (route === '/sw.js') { res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store', 'Service-Worker-Allowed': '/' }); return fs.createReadStream(path.join(PUBLIC_DIR, 'sw.js')).pipe(res); }
    const icon = /^\/icons\/(icon-\d+\.png)$/.exec(route);
    if (icon && fs.existsSync(path.join(PUBLIC_DIR, 'icons', icon[1]))) { res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=86400' }); return fs.createReadStream(path.join(PUBLIC_DIR, 'icons', icon[1])).pipe(res); }
    // dashboard scripts and styles (public/js, public/css)
    const asset = /^\/(js|css)\/([\w-]+)\.(js|css)$/.exec(route);
    if (asset && asset[1] === asset[3] && fs.existsSync(path.join(PUBLIC_DIR, asset[1], `${asset[2]}.${asset[3]}`))) {
      res.writeHead(200, { 'Content-Type': `${asset[3] === 'js' ? 'text/javascript' : 'text/css'}; charset=utf-8`, 'Cache-Control': 'no-store' });
      return fs.createReadStream(path.join(PUBLIC_DIR, asset[1], `${asset[2]}.${asset[3]}`)).pipe(res);
    }
    if (STATIC_JS[route]) {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      return fs.createReadStream(path.join(PUBLIC_DIR, STATIC_JS[route])).pipe(res);
    }
    res.writeHead(404); res.end();
  } catch (e) {
    res.writeHead(400); res.end(String(e.message || e));
  }
});

// ---------------------------------------------------------------- main loop

backfillSessions(null);
repairSessions();
checkGameProcess();
setInterval(checkGameProcess, 5000);
loginTailer.poll(true);
if (!process.env.SOF_OFFLINE) { // SOF_OFFLINE: no website calls (tests)
  rankings.refresh(isWatched);
  setInterval(() => rankings.refresh(isWatched), RANKING_REFRESH_MS);
  news.refresh();
  setInterval(() => news.refresh(), 30 * 60000);
}

setTimeout(() => patches.check('startup'), 20000);
setTimeout(() => doSelfCheck('startup'), 45000); // after the guide, the 3D zone scan and the first website calls
setInterval(() => doSelfCheck('daily'), 24 * 3600000);
setInterval(() => patches.check('scheduled'), 6 * 3600000);

setInterval(() => {
  sessionTailer?.poll(false);
  for (const o of others.values()) o.tailer.poll(false);
  statusTailer.poll(false);
  loginTailer.poll(false);
}, 500);

setInterval(() => {
  tick();
  if (!clients.size) return;
  const snap = snapshot(), full = `data: ${JSON.stringify(snap)}\n\n`;
  for (const c of clients) c.write(c.sent ? `data: ${snapshotFor(c, snap)}\n\n` : full);
}, 1000);
// the live data for one page: the slow parts only when they changed since that page last got them ("same" lists the rest)
const SLOW_PARTS = ['rankings', 'labels', 'logins', 'waypoints', 'events', 'news', 'maps'];
function snapshotFor(c, snap) {
  if (!c.sent) return JSON.stringify(snap);
  const out = { ...snap }, same = [];
  for (const k of SLOW_PARTS) {
    if (!(k in snap)) continue;
    const j = JSON.stringify(snap[k]);
    if (c.sent.get(k) === j) { delete out[k]; same.push(k); } else c.sent.set(k, j);
  }
  if (same.length) out.same = same;
  return JSON.stringify(out);
}

setInterval(() => {
  checkGoals();
  try { gameFiles(); } catch (e) { console.log(`[tracker] game files: ${e.message}`); } // (notices game-setting changes)
  checkWeeklyReport();
  checkDigest();
  checkExpGoal();
  checkRecords();
  if (state.game.running) saveCurrentSession(true);
  for (const o of others.values()) saveSession(o.session, true);
  if (heatDirty) { store.writeJson('heatmap.json', heatmap); heatDirty = false; }
  if (busyDirty) { store.writeJson('busy.json', busy); busyDirty = false; }
  if (activityDirty) { store.writeJson('activity.json', activity); activityDirty = false; }
  if (arrivalsDirty) { store.writeJson('arrivals.json', arrivals); arrivalsDirty = false; }
  if (dropsDirty) { store.writeJson('drops.json', drops); dropsDirty = false; }
  if (marketDirty) { store.writeJson('market.json', offers); marketDirty = false; }
  if (farmingDirty) { store.writeJson('farming.json', farming.data); farmingDirty = false; }
  if (chatDirty) { store.writeJson('chat.json', chatLog.entries); chatDirty = false; }
  if (mazeRuns.cur) mazeRuns.save();
  dailyStats.flush();
  saveTimeline();
  checklist.tick(Date.now(), inGameChars());
  checkGoalNudge();
  checkMilestones();
  checkDailyBackup();
  try { autoTidy(); } catch (e) { console.log(`[tracker] tidy-up: ${e.message}`); }
}, 30000);
setInterval(syncFriends, 10000); // often enough for the party view to feel live
setTimeout(() => { checkMilestones(); syncFriends(); checkDailyBackup(); backfillActivity(); }, 5000);

function shutdown() {
  saveCurrentSession(false);
  for (const o of others.values()) saveSession(o.session, false);
  if (heatDirty) store.writeJson('heatmap.json', heatmap);
  if (busyDirty) store.writeJson('busy.json', busy);
  if (activityDirty) store.writeJson('activity.json', activity);
  if (arrivalsDirty) store.writeJson('arrivals.json', arrivals);
  if (dropsDirty) store.writeJson('drops.json', drops);
  if (marketDirty) store.writeJson('market.json', offers);
  if (farmingDirty) store.writeJson('farming.json', farming.data);
  if (chatDirty) store.writeJson('chat.json', chatLog.entries);
  mazeRuns.save();
  dailyStats.flush();
  saveTimeline();
  screenReader.stop();
  for (const a of altReaders.values()) a.reader.stop();
  bot.stop();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, HOST, () => {
  console.log(`[tracker] Scions of Fate stats tracker running at http://localhost:${PORT}`);
  if (HOST === '0.0.0.0') for (const u of lanUrls()) console.log(`[tracker] phone / LAN: ${u}`);
  console.log(`[tracker] reading logs from ${CLIENT_DIR}`);
});
