// SoF Tracker dashboard: main. Loaded as a classic script; all dashboard scripts share one global scope (see index.html).

// ---------------------------------------------------------------- main loop
// ---------------------------------------------------------------- 3D world (three.js, loaded when the tab is first opened)
let world = null, worldZones = null;
async function openWorld(zone, focus) {
  if (!world) {
    try {
      const mod = await import('/world.js');
      world = mod.createWorld({ canvas: $('worldCv'), labels: $('worldLabels'), tip: $('worldTip'), t, onInfo: (s) => { $('wInfo').textContent = s; } });
    } catch (e) {
      $('wInfo').textContent = t('The 3D view could not start: {e}', { e: e.message }) + ' ' + t('It needs an internet connection the first time (three.js) and a browser with WebGL.');
      return;
    }
    world.setBackground(getComputedStyle(document.documentElement).getPropertyValue('--panel-2').trim() || '#1c1f28');
    for (const [id, layer] of [['wMe', 'me'], ['wNpc', 'npcs'], ['wMobs', 'mobs'], ['wPortal', 'portals'], ['wMarks', 'marks'], ['wHeat', 'heat']]) {
      $(id).checked = store.get(`world.${layer}`, layer !== 'heat');
      world.setLayer(layer, $(id).checked);
      $(id).onchange = () => { world.setLayer(layer, $(id).checked); store.set(`world.${layer}`, $(id).checked); };
    }
    $('wFollow').onchange = () => world.setFollow($('wFollow').checked);
    $('wZone').onchange = () => worldLoad($('wZone').value);
    loadRouteTargets();
    $('wMeBtn').onclick = () => { const p = S?.session?.position; if (p) openWorld(String(p.zone), { x: p.x, z: p.z }); };
  }
  if (!worldZones?.length) worldZones = await getJSON('/api/world-zones');
  if (!worldZones.length) { $('wInfo').textContent = t('Reading the map files… try again in a few seconds.'); return; }
  $('wZone').innerHTML = worldZones.map((z) => `<option value="${z.zone}">${esc(z.name)}${z.terrain ? '' : ` (${t('flat')})`}</option>`).join('');
  const cur = S?.session?.position?.zone;
  const known = (z) => z != null && worldZones.some((w) => w.zone === String(z));
  const z = known(zone) ? String(zone) : world.zone || (known(cur) ? String(cur) : worldZones[0].zone);
  $('wZone').value = z;
  if (z !== world.zone || focus) await worldLoad(z, focus || (known(cur) && String(cur) === z && S.session.position ? { x: S.session.position.x, z: S.session.position.z } : null));
  world.updateMe(S);
}
// load a zone in 3D and put the planned route back on it
async function worldLoad(z, focus) {
  $('wZone').value = String(z);
  await world.load(z, focus);
  if (route3d) world.showRoute(route3d.legs.filter((l) => String(l.zone) === String(z)));
  renderRouteLegs();
}

// ---- route planner (3D tab)
let route3d = null, routeTargets = null;
async function loadRouteTargets() {
  routeTargets = await getJSON('/api/route-targets');
  $('rtTargets').innerHTML = routeTargets.zones.map((z) => `<option value="${esc(z.name)}">`).join('') + routeTargets.npcs.map((n) => `<option value="${esc(`${n.name} (${n.zoneName})`)}">`).join('');
}
async function planRoute3d(params) {
  $('rtInfo').textContent = t('Planning…');
  const r = await getJSON(`/api/route?${new URLSearchParams(params)}`);
  if (!r.found) {
    route3d = null; world?.showRoute([]); renderRouteLegs();
    $('rtInfo').textContent = r.reason === 'no-position' ? t('Your position is not known yet: start the game and move once.') : r.reason === 'no-target' ? t('Pick a zone or NPC from the list.') : t('No way there through the known exits.');
    return;
  }
  route3d = r;
  $('rtInfo').textContent = t('{n} zone changes · about {d} units to walk', { n: r.hops, d: num(r.distance) });
  $('rtClear').hidden = false;
  const first = r.legs[0];
  if (world && first) await worldLoad(first.zone, first.from); else renderRouteLegs();
}
function renderRouteLegs() {
  const el = $('rtLegs');
  if (!route3d) { el.hidden = true; el.innerHTML = ''; $('rtClear').hidden = true; return; }
  el.hidden = false;
  el.innerHTML = route3d.legs.map((l) => `<li class="${world && String(l.zone) === String(world.zone) ? 'here' : ''}"><a href="#" data-route-leg="${l.zone}" class="notr">${esc(l.zoneName)}</a>: ${l.via === 'target' ? t('walk {d} to {label}', { d: num(l.dist), label: `<b class="notr">${esc(l.label)}</b>` }) : l.via === 'npc' ? t('walk {d}, then talk to {label}', { d: num(l.dist), label: `<b class="notr">${esc(l.label)}</b>` }) : t('walk {d} to the exit {label}', { d: num(l.dist), label: `<b class="notr">${esc(l.label)}</b>` })}</li>`).join('');
}
$('rtLegs').addEventListener('click', (e) => { const a = e.target.closest('[data-route-leg]'); if (!a) return; e.preventDefault(); const l = route3d.legs.find((x) => String(x.zone) === a.dataset.routeLeg); worldLoad(a.dataset.routeLeg, l?.from); });
$('rtClear').onclick = () => { route3d = null; world?.showRoute([]); renderRouteLegs(); $('rtInfo').textContent = ''; $('rtTarget').value = ''; };
$('rtGo').onclick = () => {
  const v = $('rtTarget').value.trim().toLowerCase();
  if (!routeTargets || !v) return;
  const z = routeTargets.zones.find((x) => x.name.toLowerCase() === v);
  if (z) return planRoute3d({ toZone: z.zone });
  const n = routeTargets.npcs.find((x) => `${x.name} (${x.zoneName})`.toLowerCase() === v) || routeTargets.npcs.find((x) => x.name.toLowerCase() === v);
  if (n) return planRoute3d({ npc: n.npc });
  $('rtInfo').textContent = t('Pick a zone or NPC from the list.');
};
$('rtTarget').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('rtGo').click(); });
// "route there" buttons anywhere in the dashboard
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-route-zone], [data-route-npc], [data-route-quests]');
  if (!b) return;
  e.preventDefault();
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  showTab('world');
  await openWorld();
  $('rtTarget').value = b.dataset.routeLabel || '';
  // the trip past all your quests in progress
  if (b.dataset.routeQuests) return planRoute3d({ quests: '1' });
  planRoute3d(b.dataset.routeNpc ? { npc: b.dataset.routeNpc } : { toZone: b.dataset.routeZone, x: b.dataset.routeX || '', z: b.dataset.routeZ || '', label: b.dataset.routeLabel || '' });
});

// ---- session replay in 3D (started from a session's details)
let replay3d = null;
async function startReplay3d() {
  if (!replay?.track?.length || !replay.r) return;
  const r = replay.r, counts = {};
  for (const p of replay.track) counts[p[1]] = (counts[p[1]] || 0) + 1;
  const zone = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  const points = replay.track.map((p, i) => [replay.times[i], p[1], p[2], p[3]]).filter((p) => String(p[1]) === zone).map(([tm, , x, z]) => [tm, x, z]);
  // the players you met, placed where you were when you first saw them
  const at = (tm) => { let best = points[0]; for (const p of points) { if (p[0] > tm) break; best = p; } return best; };
  const players = Object.entries(r.players || {}).filter(([, p]) => p.firstSeen && String(p.zone) === zone).map(([name, p]) => { const q = at(p.firstSeen); return { name, t: p.firstSeen, x: q[1], z: q[2] }; });
  showTab('world');
  await openWorld(zone);
  if (String(world.zone) !== String(zone)) await worldLoad(zone);
  if (!world.startReplay({ points, players })) return;
  replay3d = { points, t0: points[0][0], t1: points[points.length - 1][0], vt: points[0][0], playing: false, speed: 60, raf: 0, last: 0 };
  $('w3dReplay').hidden = false; $('w3Pos').max = points.length - 1; $('w3Pos').value = 0; $('w3Play').textContent = '▶';
  replay3dShow();
}
function replay3dShow() { if (!replay3d) return; world.replayAt(replay3d.vt); $('w3Time').textContent = `${clock(replay3d.vt)} · ${zoneName(world.zone)}`; }
function replay3dFrame(ts) {
  if (!replay3d?.playing) return;
  const dt = replay3d.last ? ts - replay3d.last : 0; replay3d.last = ts;
  replay3d.vt = Math.min(replay3d.t1, replay3d.vt + dt * replay3d.speed);
  const i = replay3d.points.findIndex((p) => p[0] > replay3d.vt);
  $('w3Pos').value = i < 0 ? replay3d.points.length - 1 : Math.max(0, i - 1);
  replay3dShow();
  if (replay3d.vt >= replay3d.t1) { replay3d.playing = false; $('w3Play').textContent = '▶'; return; }
  replay3d.raf = requestAnimationFrame(replay3dFrame);
}
$('w3Play').onclick = () => {
  if (!replay3d) return;
  replay3d.playing = !replay3d.playing; $('w3Play').textContent = replay3d.playing ? '❚❚' : '▶';
  if (replay3d.playing) { if (replay3d.vt >= replay3d.t1) replay3d.vt = replay3d.t0; replay3d.last = 0; replay3d.raf = requestAnimationFrame(replay3dFrame); }
};
$('w3Pos').oninput = () => { if (!replay3d) return; replay3d.vt = replay3d.points[+$('w3Pos').value][0]; replay3dShow(); };
$('w3Speed').onchange = () => { if (replay3d) replay3d.speed = +$('w3Speed').value; };
$('w3Close').onclick = () => { if (replay3d) cancelAnimationFrame(replay3d.raf); replay3d = null; world?.stopReplay(); $('w3dReplay').hidden = true; };
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-world]');
  if (!b) return;
  showTab('world');
  openWorld(b.dataset.world, b.dataset.wx ? { x: +b.dataset.wx, z: +b.dataset.wz } : null);
});

const loaders = { rankings: loadRankings, sessions: () => { loadSessions(); loadShots(); }, encounters: () => { loadEncounters(); loadGroups(); }, heatmap: loadHeatmap, alerts: renderAlertsTab, settings: loadSettings, hunting: loadHunting, report: loadReport, stats: loadStats, house: loadHouse, trades: loadTrades, help: loadHelp, world: () => openWorld() };

// switched-off features: their panels hide (Settings → Features)
function applyFeatures() {
  const f = S?.settings?.features || {};
  for (const id of ['quests', 'gear', 'gold', 'enhance', 'maze', 'market', 'party', 'danger']) document.body.classList.toggle(`nofeat-${id}`, f[id] === false);
}
function render() {
  if (!S) return;
  applyFeatures();
  renderHeader();
  if (tab === 'live') { renderLive(); renderScreen(); }
  if (tab === 'rankings') renderBoards();
  if (tab === 'alerts') renderAlertsTab();
  if (tab === 'world' && world) world.updateMe(S);
}

// installable as an app (browsers allow the service worker only on this PC or over HTTPS)
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => {});

function connect() {
  const es = new EventSource('/events?delta=1');
  es.onmessage = (e) => {
    const first = !S, prev = S;
    S = JSON.parse(e.data); clockOffset = S.now - Date.now();
    if (SofGate.onState(S)) { S = prev; return; } // an update is required: only the update screen
    for (const k of S.same || []) S[k] = prev?.[k]; // unchanged slow parts: keep the last copy
    handleAlerts();
    render();
    if (first) showTab((location.hash || '').slice(1) || store.get('tab', 'live'));
  };
  // fast bars: HP / MP / EXP several times a second between the full updates (redrawn once per screen frame)
  let barsQueued = false;
  es.addEventListener('bars', (e) => {
    if (!S?.screen || S.blocked) return;
    const b = JSON.parse(e.data); Object.assign(S.screen, { hp: b.hp ?? S.screen.hp, mp: b.mp ?? S.screen.mp, exp: b.exp ?? S.screen.exp, fast: b });
    if (!barsQueued) { barsQueued = true; requestAnimationFrame(() => { barsQueued = false; if (tab === 'live') renderScreen(); }); }
  });
  es.onerror = () => { $('gameStatus').textContent = 'Tracker offline. Reconnecting…'; $('gameDot').classList.remove('on'); };
}

getJSON('/api/net').then((n) => {
  if (!n.lan.length) return;
  $('lanBox').hidden = false;
  $('lanBox').innerHTML = `<b>${t('Phone view is on.')}</b> ${t('On a phone connected to the same Wi-Fi, open:')} ${n.lan.map((u) => `<span class="mono" style="color:var(--text)">${esc(u)}</span>`).join(' or ')}<br><span class="muted" style="font-size:12px">${t('The address holds a private access key: only give it to your own devices. Delete data\\lan-key.txt and restart to change it.')}</span>`;
});
// opened on another device: the paired Android app may change everything, the plain phone view only watches
getJSON('/api/client').then((c) => {
  document.body.classList.toggle('remote', !c.local);
  document.body.classList.toggle('viewonly', !c.manage);
}).catch(() => {});
renderAlertSettings();
applyView();
startI18n();
window.addEventListener('langchange', () => {
  renderAlertSettings();
  if (S) { render(); loaders[tab]?.(); }
  // share the choice with the overlay and tray (they read it from the tracker)
  fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lang: getLang() }) }).catch(() => {});
});
connect();
setInterval(() => { if (S && tab === 'live') renderLive(); }, 250); // smooth countdowns between pushes
setInterval(() => { if (S && tab === 'heatmap') loadHeatmap(); }, 30000);
window.addEventListener('resize', () => { if (!S) return; if (tab === 'live') drawTrail(); if (tab === 'heatmap') drawHeatmap(); if (tab === 'rankings') loadRankings(); });
