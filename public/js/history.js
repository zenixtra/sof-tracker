// SoF Tracker dashboard: history. Loaded as a classic script; all dashboard scripts share one global scope (see index.html).

// ---------------------------------------------------------------- rankings tab
let rDays = store.get('rDays', 7), rHist = null, rSelected = null;

function renderBoards() {
  const R = S.rankings;
  $('rankInfo').textContent = R.error ? t('refresh failed: {e}', { e: R.error }) : R.fetchedAt ? t('{n} characters · updated {time}', { n: R.players.length, time: clock(R.fetchedAt) }) : t('loading…');
  if (!$('rBoard').options.length) $('rBoard').innerHTML = ['All', 'Honor', ...CLASSES].map((b) => `<option>${b}</option>`).join('');
  const board = $('rBoard').value, facF = $('rFaction').value;
  const seen = new Set(S.session.players.map((p) => p.name.toLowerCase()));
  const rows = R.players.map((p) => ({ p, r: p.ranks.find((x) => x.board === board) }))
    .filter(({ p, r }) => r && (!facF || p.faction === facF)).sort((a, b) => a.r.rank - b.r.rank);
  $('rankings').innerHTML = rows.length ? rows.map(({ p, r }) => `<tr class="click ${seen.has(p.name.toLowerCase()) ? 'seen' : ''} ${rSelected === p.name ? 'sel' : ''}" data-rank-player="${esc(p.name)}" title="${seen.has(p.name.toLowerCase()) ? 'Seen this session' : ''}">
    <td>${star(p.name, isWatched(p.name))}</td><td class="num">${r.rank}</td><td>${esc(p.name)}</td><td class="num">${p.level ?? '?'}</td><td>${esc(p.cls)}</td><td>${facBadge(p.faction)}</td><td>${esc(p.house) || '—'}</td><td class="num">${p.honor ? num(p.honor) : '<span class="muted">—</span>'}</td></tr>`).join('')
    : `<tr><td colspan="8" class="empty">${R.fetchedAt ? 'No characters on this board.' : 'Fetching rankings from fate.netgame.com…'}</td></tr>`;
}

async function loadRankings() {
  for (const b of $('rRange').children) b.classList.toggle('on', +b.dataset.days === rDays);
  rHist = await getJSON(`/api/rankings/history?days=${rDays}`);
  const H = rHist;
  $('rHistInfo').textContent = H.snapshots > 1
    ? t('{n} snapshots from {from} to {to}', { n: H.snapshots, from: dateTime(H.from), to: dateTime(H.to) })
    : 'History builds up as the tracker saves the rankings every 30 minutes. Changes show here once there are two snapshots.';
  lineChart($('facChart'), {
    series: [
      { name: 'Order', color: 'var(--s1)', points: H.factions.map((f) => [f.t, f.order]) },
      { name: 'Chaos', color: 'var(--s2)', points: H.factions.map((f) => [f.t, f.chaos]) },
    ], step: true,
  });
  lineChart($('houseChart'), {
    series: H.topHouses.map((h, i) => ({ name: h, color: SERIES[i], points: H.houseSeries.map((x) => [x.t, x[h]]) })), step: true,
  });
  const nameCell = (m) => `<td><span class="click" data-rank-player="${esc(m.name)}">${esc(m.name)}</span> <span class="muted" style="font-size:11px">${esc(m.cls || '')}</span></td>`;
  $('rFastest').innerHTML = H.fastest.map((m) => `<tr>${nameCell(m)}<td class="num">${m.level}</td><td class="num"><span class="tag up">+${m.levelGain}</span></td></tr>`).join('') || '<tr><td colspan="3" class="empty">No level changes in this period yet.</td></tr>';
  $('rHonor').innerHTML = H.honor.map((m) => `<tr>${nameCell(m)}<td class="num">${num(m.honor)}</td><td class="num"><span class="tag up">+${num(m.honorGain)}</span></td></tr>`).join('') || '<tr><td colspan="3" class="empty">No honor changes in this period yet.</td></tr>';
  $('rClimb').innerHTML = H.climbers.map((m) => `<tr>${nameCell(m)}<td class="num">#${m.rankNow}</td><td class="num">${m.rankDelta == null ? '<span class="tag up">new</span>' : m.rankDelta > 0 ? `<span class="tag up">▲ ${m.rankDelta}</span>` : `<span class="tag down">▼ ${-m.rankDelta}</span>`}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">No rank changes in this period yet.</td></tr>';
  getJSON('/api/predictions').then((pr) => {
    $('rPred').innerHTML = pr.length ? pr.slice(0, 40).map((p) => `<tr class="click" data-player="${esc(p.name)}"><td>${esc(p.name)}</td><td>${esc(p.cls)}</td><td>${facBadge(p.faction)}</td><td class="num">${p.level}</td><td class="num">${num(p.perDay, 2)}</td>
      <td class="num">${p.nextLevelAt > Date.now() ? t('in {d}', { d: dur(p.nextLevelAt - Date.now()) }) : t('any time now')}</td><td class="num">${p.nextTen ? `Lv ${Math.ceil((p.level + 1) / 10) * 10}: ${dateOnly(p.nextTen)}` : '—'}</td><td class="num">${t('{n} level-ups', { n: p.basedOn })}</td></tr>`).join('')
      : `<tr><td colspan="8" class="empty">${t('Predictions appear once a player has levelled up at least twice while the tracker was saving the rankings.')}</td></tr>`;
  });
  $('rHouses').innerHTML = H.houses.map((h) => `<tr><td>${esc(h.house)}</td><td>${facBadge(h.faction)}</td><td class="num">${h.members}${h.memberChange ? ` <span class="tag ${h.memberChange > 0 ? 'up' : 'down'}">${h.memberChange > 0 ? '+' : ''}${h.memberChange}</span>` : ''}</td><td class="num">${h.avgLevel ? num(h.avgLevel, 1) : '—'}</td><td class="num">${h.honor ? num(h.honor) : '—'}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No data yet.</td></tr>';
  if (rSelected) openRankPlayer(rSelected);
}
$('rRange').addEventListener('click', (e) => { const b = e.target.closest('[data-days]'); if (!b) return; rDays = +b.dataset.days; store.set('rDays', rDays); loadRankings(); });

async function openRankPlayer(name) {
  rSelected = name;
  const p = S.rankings.players.find((x) => x.name === name);
  const h = await getJSON(`/api/rankings/player?name=${encodeURIComponent(name)}`);
  $('playerPanel').hidden = false;
  $('ppName').innerHTML = `${esc(name)} ${star(name, isWatched(name))}`;
  $('ppInfo').innerHTML = p ? `Lv ${p.level ?? '?'} ${esc(p.cls)} · ${esc(t(p.faction))} · ${esc(p.house || t('no house'))} · ${p.ranks.map((r) => `#${r.rank} ${t(r.board)}`).join(', ')}` : t('No longer in the rankings');
  lineChart($('ppLevel'), { series: [{ name: 'Level', color: 'var(--s4)', points: h.points.filter((x) => x.level).map((x) => [x.t, x.level]) }], height: 180, step: true });
  lineChart($('ppHonor'), { series: [{ name: 'Honor', color: 'var(--s5)', points: h.points.filter((x) => x.honor).map((x) => [x.t, x.honor]) }], height: 180, step: true, empty: 'Not on the honor board.' });
  renderBoards();
  if (tab === 'rankings') $('playerPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ---------------------------------------------------------------- sessions tab
let calData = null, sessionsData = [], sdKey = null;

async function loadSessions() {
  [calData, sessionsData] = await Promise.all([getJSON('/api/calendar'), getJSON('/api/sessions')]);
  const sel = $('calAccount');
  const want = sel.value || store.get('calAccount', calData.current || '');
  sel.innerHTML = `<option value="">All accounts</option>` + calData.accounts.map((a) => `<option ${a === want ? 'selected' : ''}>${esc(a)}</option>`).join('');
  renderCalendar();
  $('sessionList').innerHTML = sessionsData.length ? sessionsData.map((r) => {
    const main = Object.entries(r.zones || {}).sort((a, b) => b[1] - a[1])[0];
    return `<tr class="click ${sdKey === r.key ? 'sel' : ''}" data-session="${esc(r.key)}"><td>${dateTime(r.startedAt)} ${r.live ? '<span class="tag live">live</span>' : ''}</td><td>${esc(r.character || '?')}</td>
      <td class="num">${dur(r.endedAt - r.startedAt)}</td><td class="num">${activePct(r)}</td><td class="num">${num(r.distance)}</td><td class="num">${r.playerCount}</td><td>${main ? esc(zoneName(main[0])) : '—'}</td></tr>`;
  }).join('') : '<tr><td colspan="7" class="empty">No sessions recorded yet.</td></tr>';
  if (sdKey) openSession(sdKey);
}

// active share of a session; sessions from before AFK tracking (or imported from old logs) have no data
const activePct = (r) => (r.activeMs || r.afkMs ? `${Math.round((r.activeMs / (r.activeMs + r.afkMs)) * 100)}%` : '<span class="muted" title="Not measured">—</span>');

function renderCalendar() {
  const acc = $('calAccount').value;
  store.set('calAccount', acc);
  const days = {};
  for (const [a, d] of Object.entries(calData.days)) if (!acc || a === acc) for (const [k, ms] of Object.entries(d)) days[k] = (days[k] || 0) + ms;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const weeks = 26, start = new Date(today); start.setDate(start.getDate() - start.getDay() - (weeks - 1) * 7);
  const max = Math.max(...Object.values(days), 1);
  const ramp = ['var(--panel-2)', '#4a3a1c', '#7a5f28', '#b08530', '#e6bd62'];
  const cells = [], weekTotals = [];
  let total = 0, active = 0;
  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const ms = days[key] || 0;
    total += ms; if (ms) active++;
    const lvl = ms ? Math.min(4, 1 + Math.floor((ms / max) * 3.999)) : 0;
    cells.push(`<span style="background:${ramp[lvl]}" title="${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}: ${ms ? dur(ms) : 'no play'}"></span>`);
    const wk = Math.floor((d - start) / (7 * 86400000));
    weekTotals[wk] = (weekTotals[wk] || 0) + ms;
  }
  $('cal').innerHTML = cells.join('');
  $('calTotals').textContent = t('{d} over {n} days in the last {w} weeks', { d: dur(total), n: active, w: weeks });
  const last = weekTotals.slice(-12);
  barChart($('weekChart'), {
    bars: last.map((ms, i) => {
      const ws = new Date(start); ws.setDate(ws.getDate() + (weekTotals.length - last.length + i) * 7);
      return { v: (ms || 0) / 3600000, label: t('Week of {date}', { date: ws.toLocaleDateString([], { month: 'short', day: 'numeric' }) }), short: ws.toLocaleDateString([], { month: 'numeric', day: 'numeric' }) };
    }),
    yFmt: (v) => `${num(v, v < 10 ? 1 : 0)}h`,
  });
}
$('calAccount').addEventListener('change', renderCalendar);

async function openSession(key) {
  sdKey = key;
  const r = await getJSON(`/api/session?key=${encodeURIComponent(key)}`);
  for (const tr of $('sessionList').children) tr.classList.toggle('sel', tr.dataset.session === key);
  if (!r) { $('sessionDetail').innerHTML = '<div class="empty">Session not found.</div>'; return; }
  $('sdInfo').textContent = `${esc(r.character || '?')} · ${dateTime(r.startedAt)} – ${clock(r.endedAt)}`;
  const zones = Object.entries(r.zones || {}).sort((a, b) => b[1] - a[1]);
  const players = Object.entries(r.players || {}).sort((a, b) => (b[1].nearMs || 0) - (a[1].nearMs || 0) || b[1].sightings - a[1].sightings);
  $('sessionDetail').innerHTML = `${r.recap ? `<div class="note-box" style="color:var(--text)">${esc(tAlert(r.recap))}</div>` : ''}
    <h2>${t('Replay')}</h2>
    <div id="sdReplayBox"><canvas class="map" id="rpCanvas" style="height:300px"></canvas>
      <div class="replay"><button id="rpPlay" class="small primary">▶</button><input type="range" id="rpPos" min="0" max="1" value="0">
        <select id="rpSpeed"><option value="10">10×</option><option value="60" selected>60×</option><option value="300">300×</option><option value="1200">1200×</option></select>
        <span class="muted mono" id="rpTime" style="font-size:12px"></span><button id="rp3d" class="small" title="${esc(t('Replay this session on the 3D map'))}">${t('Replay in 3D')}</button></div></div>
    <h2 style="margin-top:16px">${t('Buff timeline')}</h2>
    ${buffTimeline(r)}
    <h2 style="margin-top:16px">${t('Screen timeline')} <small>${t('HP, MP and EXP as the screen reader saw them')}</small></h2>
    <div id="sdTimeline"></div>
    <div style="height:12px"></div>
    <div class="kpis" style="grid-template-columns:repeat(2,1fr)">
      <div class="kpi"><label>Length</label><div class="v">${dur(r.endedAt - r.startedAt)}</div></div>
      <div class="kpi"><label>Active / AFK</label><div class="v">${r.activeMs || r.afkMs ? `${dur(r.activeMs)} / ${dur(r.afkMs)}` : '—'}</div></div>
      <div class="kpi"><label>Distance</label><div class="v">${num(r.distance)}</div></div>
      <div class="kpi"><label>Players met</label><div class="v">${players.length}</div></div>
    </div>
    <table><thead><tr><th>Zone</th><th class="num">Time</th><th class="num">Distance</th></tr></thead><tbody>
      ${zones.map(([z, ms]) => `<tr><td>${esc(zoneName(z))}</td><td class="num">${dur(ms)}</td><td class="num">${num(r.distanceByZone?.[z])}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">No zone data.</td></tr>'}
    </tbody></table>
    <h2 style="margin-top:16px">Players met</h2>
    <div class="scroll"><table><thead><tr><th>Name</th><th>Faction</th><th class="num">Time near</th><th>Zone</th></tr></thead><tbody>
      ${players.map(([n, p]) => `<tr class="click" data-player="${esc(n)}"><td>${esc(n)}</td><td>${facBadge(infoFor(n)?.faction)}</td><td class="num">${p.nearMs ? dur(p.nearMs) : '<span class="muted">—</span>'}</td><td>${p.zone != null ? esc(zoneName(p.zone)) : '—'}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nobody.</td></tr>'}
    </tbody></table></div>`;
  setupReplay(r);
  loadTimeline(r);
}

// HP / MP / EXP over the session (one axis: all in %), and below it when kills, deaths, drops, whispers and level-ups happened
const TL_EVENTS = { kill: ['·', 'Kills'], death: ['✝', 'Deaths'], drop: ['◆', 'Drops'], whisper: ['💬', 'Whispers'], level: ['▲', 'Level-ups'], effect: ['✦', 'Effects'], party: ['👥', 'Party'], freeze: ['❄', 'Game froze'], settings: ['⚙', 'Game settings changed'] };
async function loadTimeline(r) {
  const tl = await getJSON(`/api/session-timeline?key=${encodeURIComponent(r.key)}`);
  const box = $('sdTimeline');
  if (!box || sdKey !== r.key) return;
  if (!tl?.samples?.length) { box.innerHTML = `<div class="empty">${t('Sessions played with the screen reader on get a timeline here.')}</div>`; return; }
  box.innerHTML = '<div class="chart" id="sdTlChart"></div><div class="evstrip" id="sdTlEv"></div><div class="evlegend" id="sdTlLeg"></div>';
  const col = (i) => tl.samples.map((s) => [s[0], s[i]]);
  lineChart($('sdTlChart'), { series: [{ name: 'HP', color: 'var(--crimson)', points: col(1) }, { name: 'MP', color: 'var(--sky)', points: col(2) }, { name: 'EXP', color: 'var(--gold)', points: col(3) }], yFmt: (v) => `${num(v)}%`, height: 200 });
  const t0 = tl.samples[0][0], t1 = Math.max(tl.samples[tl.samples.length - 1][0], ...tl.events.map((e) => e[0])), span = Math.max(1, t1 - t0);
  $('sdTlEv').innerHTML = tl.events.filter((e) => e[0] >= t0).map(([at, kind, text]) => `<span class="ev ${kind}" style="left:${(((at - t0) / span) * 100).toFixed(2)}%" title="${esc(`${clock(at)} · ${t(TL_EVENTS[kind]?.[1] || kind)}${text ? ` · ${text}` : ''}`)}">${TL_EVENTS[kind]?.[0] || '•'}</span>`).join('');
  const count = (k) => tl.events.filter((e) => e[1] === k).length;
  $('sdTlLeg').innerHTML = Object.entries(TL_EVENTS).filter(([k]) => count(k)).map(([k, [icon, label]]) => `<span><span class="ev ${k}" style="position:static">${icon}</span> ${t(label)} ${count(k)}</span>`).join('');
}

const infoFor = (name) => {
  const k = name.toLowerCase();
  const live = S.session.players.find((p) => p.name.toLowerCase() === k);
  if (live?.info) return live.info;
  const r = S.rankings.players.find((p) => p.name.toLowerCase() === k);
  return encCache.find((e) => e.name.toLowerCase() === k)?.info || r || null;
};

// ---------------------------------------------------------------- encounters tab
let encCache = [];
async function loadEncounters() {
  encCache = await getJSON('/api/encounters');
  renderEncounters();
}
function renderEncounters() {
  const qq = $('encSearch').value.trim().toLowerCase(), facF = $('encFaction').value, sort = $('encSort').value;
  let list = encCache.filter((e) => (!qq || e.name.toLowerCase().includes(qq)) && (!facF || (facF === '?' ? !e.info?.faction : e.info?.faction === facF)));
  if (sort === 'near') list.sort((a, b) => b.nearMs - a.nearMs);
  if (sort === 'recent') list.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  $('encInfo').textContent = t('{n} players across all tracked sessions', { n: encCache.length });
  $('encounters').innerHTML = list.slice(0, 500).map((e) => {
    const i = e.info || {};
    const zone = Object.entries(e.zones).sort((a, b) => b[1] - a[1])[0];
    return `<tr class="click" data-player="${esc(e.name)}"><td>${star(e.name, isWatched(e.name))}</td><td>${esc(e.name)}${e.threat ? flag : ''}</td><td class="num">${q(i.level)}</td><td>${esc(i.cls) || q()}</td><td>${facBadge(i.faction)}</td>
      <td class="num">${e.sessions}</td><td class="num">${e.nearMs ? dur(e.nearMs) : '<span class="muted">—</span>'}</td><td class="muted">${dateOnly(e.firstSeen)}</td><td class="muted">${dateOnly(e.lastSeen)}</td><td>${zone ? esc(zoneName(zone[0])) : '—'}</td></tr>`;
  }).join('') || '<tr><td colspan="10" class="empty">No encounters recorded yet.</td></tr>';
}
for (const id of ['encSearch', 'encFaction', 'encSort']) $(id).addEventListener('input', renderEncounters);

// ---------------------------------------------------------------- heatmap tab
let heatData = null, heatView = null;
async function loadHeatmap() {
  heatData = await getJSON('/api/heatmap');
  const zones = Object.keys(heatData.zones).sort((a, b) => sumCells(heatData.zones[b]) - sumCells(heatData.zones[a]));
  const want = $('heatZone').value || String(S?.session.position?.zone ?? zones[0] ?? '');
  $('heatZone').innerHTML = zones.length ? zones.map((z) => `<option value="${z}" ${z === want ? 'selected' : ''}>${esc(zoneName(z))} · ${dur(sumCells(heatData.zones[z]) * 1000)}</option>`).join('') : '<option value="">No data yet</option>';
  drawHeatmap();
}
const sumCells = (c) => Object.values(c || {}).reduce((a, b) => a + b, 0);

function drawHeatmap() {
  const { ctx, w, h } = prepCanvas($('heat'));
  const zone = $('heatZone').value, cells = heatData?.zones[zone];
  if (!cells || !Object.keys(cells).length) {
    heatView = null;
    ctx.fillStyle = '#8d8a80'; ctx.font = '13px Inter'; ctx.textAlign = 'center';
    ctx.fillText('No heatmap data yet. It fills in every second you play while the tracker runs.', w / 2, h / 2); return;
  }
  const C = heatData.cell;
  const tile = S?.maps?.[zone], img = tile && mapImage(zone);
  const pts = Object.keys(cells).map((k) => k.split(',').map((n) => (+n + 0.5) * C));
  const v = tile ? fitView(tileCorners(tile), w, h, 0, 1) : fitView(pts, w, h, C * 10);
  heatView = { v, C, cells, zone };
  if (img) drawTile(ctx, v, tile, img, w, h, 0.55);
  const max = Math.max(...Object.values(cells));
  // sequential warm ramp (light -> dark on the map, dark -> light on the empty grid)
  const ramp = img ? [[246, 214, 120], [236, 160, 60], [214, 100, 40], [168, 40, 30]] : [[74, 58, 28], [122, 95, 40], [176, 133, 48], [230, 189, 98]];
  $('heatLegend').innerHTML = ramp.map((c) => `<span class="swatch" style="background:rgb(${c.join(',')});margin:0 2px"></span>`).join('');
  const size = Math.max(img ? 3 : 2, C * v.scale);
  for (const [k, sec] of Object.entries(cells)) {
    const [cx, cz] = k.split(',').map(Number);
    const f = Math.log(1 + sec) / Math.log(1 + max);
    const c = ramp[Math.min(3, Math.floor(f * 3.999))];
    const [x, y] = v.P(cx * C, (cz + 1) * C);
    ctx.fillStyle = `rgba(${c.join(',')},${img ? 0.85 : 1})`;
    ctx.fillRect(x, y, size, size);
  }
  const p = S?.session.position;
  if (p && String(p.zone) === zone) {
    const [px, py] = v.P(p.x, p.z);
    ctx.strokeStyle = img ? '#1a1408' : '#e6e3da'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.stroke();
  }
  drawDeaths(ctx, v, zone);
  drawMarkers(ctx, v, zone);
  $('heatInfo').textContent = t('{n} cells of {c}×{c} units · {d} recorded', { n: Object.keys(cells).length, c: C, d: dur(sumCells(cells) * 1000) });
}
// where you died (screen reader): a crimson cross per death, with a dark ring so it shows on any map colour
function drawDeaths(ctx, v, zone) {
  const list = (heatData?.deaths || []).filter((d) => String(d.zone) === String(zone));
  $('heatDeathInfo').textContent = list.length ? t('{n} deaths in this zone', { n: list.length }) : '';
  heatView.deaths = list;
  if (!$('heatDeaths').checked) return;
  for (const d of list) {
    const [x, y] = v.P(d.x, d.z);
    ctx.lineCap = 'round';
    for (const [w, c] of [[6, 'rgba(14,15,19,.85)'], [3, '#d4574b']]) {
      ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath();
      ctx.moveTo(x - 6, y - 6); ctx.lineTo(x + 6, y + 6); ctx.moveTo(x + 6, y - 6); ctx.lineTo(x - 6, y + 6); ctx.stroke();
    }
  }
}
$('heatDeaths').addEventListener('change', drawHeatmap);
$('heatZone').addEventListener('change', drawHeatmap);
$('mapMode').value = store.get('mapMode', 'follow');
$('mapMode').addEventListener('change', () => { store.set('mapMode', $('mapMode').value); if (S) drawTrail(); });
$('heat').addEventListener('mousemove', (e) => {
  if (!heatView) return;
  const r = e.target.getBoundingClientRect(), { v, C, cells } = heatView;
  // invert the view transform to world coordinates
  const sx = e.clientX - r.left, sy = e.clientY - r.top, w = r.width, h = r.height;
  const wx = (sx - w / 2) / v.scale + v.cx, wz = -(sy - h / 2) / v.scale + v.cz;
  const sec = cells[`${Math.floor(wx / C)},${Math.floor(wz / C)}`];
  // a death under the pointer: when and who was around
  const dd = $('heatDeaths').checked && (heatView.deaths || []).find((d) => Math.hypot(d.x - wx, d.z - wz) * v.scale < 9);
  $('heatHover').textContent = `x ${num(wx)}, z ${num(wz)}${sec ? ` · ${dur(sec * 1000)}` : ''}${dd ? ` · ✝ ${dateTime(dd.t)}${dd.near?.length ? ` (${dd.near.slice(0, 4).join(', ')})` : ''}` : ''}`;
});
