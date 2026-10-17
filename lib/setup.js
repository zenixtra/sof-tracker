// Your setup in one file: settings, watchlist, danger flags, player notes, map markers, price watches, labels and
// checklist, to move to another PC or share with a friend. Importing adds to what is there and never removes.
'use strict';

const FORMAT = 'sof-tracker-setup';

// paths and names that belong to one PC (taken over only when they work there)
const MACHINE = ['backupDir', 'syncDir', 'syncName'];

function exportSetup({ version, settings, watchlist, threats, notes, waypoints, priceWatches, labels, checklist, notify = null, discordBot = null }) {
  return {
    format: FORMAT, version, exportedAt: Date.now(),
    settings, watchlist, threats, notes, waypoints, priceWatches, labels,
    checklist: (checklist || []).map(({ text, every, day, hour, remind }) => ({ text, every, day, hour, remind })),
    ...(notify ? { notify } : {}), ...(discordBot ? { discordBot } : {}),
  };
}

const lower = (s) => String(s || '').toLowerCase();

// current: { watchlist, threats, notes, waypoints, priceWatches, labels, checklist } → what to keep, and a summary
function mergeSetup(cur, inc) {
  if (!inc || inc.format !== FORMAT) throw new Error('That is not a SoF Tracker setup file');
  const summary = [];
  const count = (what, added) => { if (added) summary.push({ what, added }); };

  const watchlist = [...cur.watchlist];
  for (const n of Array.isArray(inc.watchlist) ? inc.watchlist : []) if (typeof n === 'string' && n.trim() && !watchlist.some((w) => lower(w) === lower(n))) watchlist.push(n.trim().slice(0, 40));
  count('Watchlist', watchlist.length - cur.watchlist.length);

  // danger flags: the higher count wins
  const threats = { ...cur.threats }; let nt = 0;
  for (const [k, v] of Object.entries(inc.threats && typeof inc.threats === 'object' ? inc.threats : {})) {
    if (!v || typeof v !== 'object') continue;
    if (!threats[k]) { threats[k] = v; nt++; } else if ((v.count || 0) > (threats[k].count || 0)) threats[k] = { ...threats[k], ...v };
  }
  count('Danger flags', nt);

  // player notes: the newer note wins
  const notes = { ...cur.notes }; let nn = 0;
  for (const [k, v] of Object.entries(inc.notes && typeof inc.notes === 'object' ? inc.notes : {})) {
    if (!v || typeof v !== 'object') continue;
    if (!notes[k]) nn++;
    if (!notes[k] || (v.updatedAt || 0) > (notes[k].updatedAt || 0)) notes[k] = v;
  }
  count('Player notes', nn);

  // markers: the same spot (zone, about the same place, same label) only once
  const waypoints = [...cur.waypoints];
  for (const w of Array.isArray(inc.waypoints) ? inc.waypoints : []) {
    if (!w || !/^\d+$/.test(String(w.zone)) || !Number.isFinite(+w.x) || !Number.isFinite(+w.z)) continue;
    if (waypoints.some((x) => x.id === w.id || (x.zone === String(w.zone) && Math.hypot(x.x - w.x, x.z - w.z) < 30 && lower(x.label) === lower(w.label)))) continue;
    waypoints.push({ id: String(w.id || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`), zone: String(w.zone), x: +w.x, z: +w.z,
      label: String(w.label || 'Marker').slice(0, 40), kind: ['farm', 'boss', 'npc', 'danger', 'star'].includes(w.kind) ? w.kind : 'star', at: +w.at || Date.now(), note: w.note ? String(w.note).slice(0, 300) : undefined });
  }
  count('Map markers', waypoints.length - cur.waypoints.length);

  const priceWatches = [...cur.priceWatches];
  for (const w of Array.isArray(inc.priceWatches) ? inc.priceWatches : []) {
    if (!w || !Number.isFinite(+w.itemId) || !(+w.price > 0) || priceWatches.some((x) => x.itemId === +w.itemId && x.side === w.side)) continue;
    priceWatches.push({ id: String(w.id || Date.now().toString(36)), itemId: +w.itemId, item: String(w.item || '').slice(0, 80), side: w.side === 'buy' ? 'buy' : 'sell', price: +w.price });
  }
  count('Price watches', priceWatches.length - cur.priceWatches.length);

  // labels for zones and effects: only the ones you haven't named yourself
  const labels = { zones: { ...(cur.labels.zones || {}) }, buffs: { ...(cur.labels.buffs || {}) } }; let nl = 0;
  for (const kind of ['zones', 'buffs']) for (const [k, v] of Object.entries(inc.labels?.[kind] || {})) if (!labels[kind][k] && typeof v === 'string') { labels[kind][k] = v.slice(0, 60); nl++; }
  count('Labels', nl);

  // checklist items whose text is new here
  const checklist = (Array.isArray(inc.checklist) ? inc.checklist : []).filter((it) => it && it.text && !cur.checklist.some((x) => lower(x.text) === lower(it.text)));
  count('Checklist', checklist.length);

  return { watchlist, threats, notes, waypoints, priceWatches, labels, checklist, summary };
}

// incoming settings without this PC's paths (unless that folder exists here)
function settingsToApply(inc, exists) {
  const s = { ...(inc && typeof inc.settings === 'object' ? inc.settings : {}) };
  for (const k of MACHINE) if (k !== 'syncName' && s[k] && !exists(s[k])) { delete s[k]; if (k === 'syncDir') delete s.syncName; }
  return s;
}

module.exports = { exportSetup, mergeSetup, settingsToApply, FORMAT };
