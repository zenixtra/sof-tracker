// SoF Tracker dashboard: live. Loaded as a classic script; all dashboard scripts share one global scope (see index.html).

// ---------------------------------------------------------------- live tab
let launching2 = 0; // when the second-client button was pressed (settings.js)
document.addEventListener('click', (e) => { if (e.target.closest('[data-try-hide]')) { store.set('tryNextHidden', Date.now()); $('tryNext').hidden = true; } });
document.addEventListener('click', async (e) => { const b = e.target.closest('[data-gear]'); if (!b) return; await post('/api/gear', { action: b.dataset.gear }); S.gearCompare = null; $('gearCmp').hidden = true; });
function renderHeader() {
  const s = S.session, g = S.game, me = s.selfInfo;
  $('gameDot').classList.toggle('on', g.running);
  $('gameStatus').textContent = !g.running ? t('Game not running') : g.responding === false ? t('Game not responding!') : t('Game running · PID {pid}', { pid: g.pid }) + (g.count > 1 ? ` · ${t('{n} windows', { n: g.count })}` : '');
  $('gameDot').style.background = g.running && g.responding === false ? 'var(--crimson)' : '';
  if (g.running) launching = 0;
  const btn = $('btnPlay');
  btn.disabled = g.running || Date.now() - launching < 60000;
  btn.textContent = g.running ? 'In game' : btn.disabled ? 'Starting…' : '▶ Play';
  // the second client: only while exactly one is running
  const b2 = $('btnPlay2'), one = g.running && (g.count || 1) < 2;
  if ((g.count || 0) >= 2) launching2 = 0;
  b2.hidden = !one && !launching2;
  b2.disabled = Date.now() - launching2 < 60000;
  b2.textContent = b2.disabled ? t('Starting…') : t('▶ 2nd client');
  $('char').textContent = s.character || '—';
  $('acct').textContent = s.account || '—';
  $('srv').textContent = s.serverId != null ? `${s.serverId} / ${s.channelId ?? '?'}` : '—';
  $('selfLvl').textContent = me && (me.level || me.cls) ? `${me.level ? 'Lv ' + me.level : 'Lv ?'} · ${me.cls || '?'}` : 'set…';
  $('selfFac').innerHTML = facBadge(me?.faction);
  $('selfHouse').textContent = me?.house || '—';
  renderMaintenance();
  renderUpdate();
}

// banner shown on every tab when maintenance is less than 2 days away or running now
function renderMaintenance() {
  const tn = now(), m = (S.maintenance || []).find((x) => x.start - tn < 48 * 3600000);
  const bar = $('maintBar');
  if (!m) { bar.className = ''; return; }
  const live = tn >= m.start;
  const fmtMine = (ms) => new Date(ms).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const fmtSrv = (ms) => new Date(ms).toLocaleTimeString([], { timeZone: S.serverTz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  bar.className = live ? 'on live' : 'on';
  const big = (d) => `<span class="big">${d}</span>`;
  bar.innerHTML = live
    ? `<b>🛠 ${t('Maintenance in progress')}</b>${m.end ? `<span>${t('servers expected back in {d} ({time} your time)', { d: big(dur(m.end - tn)), time: fmtMine(m.end) })}</span>` : ''}<a href="${esc(m.url)}" target="_blank" rel="noopener">${t('Read the post')} ↗</a>`
    : `<b>🛠 ${t('Scheduled maintenance')}</b><span>${t('starts in {d}', { d: big(dur(m.start - tn)) })}</span><span>${t('{time} your time', { time: `${fmtMine(m.start)}${m.end ? ` → ${fmtMine(m.end)}` : ''}` })}</span><span class="muted">${t('server {time}', { time: `${fmtSrv(m.start)}${m.end ? `–${fmtSrv(m.end)}` : ''} ${esc(m.tz)}` })}</span><a href="${esc(m.url)}" target="_blank" rel="noopener">${t('Read the post')} ↗</a>`;
}

function renderLive() {
  const s = S.session, g = S.game, tn = now();
  $('kSession').textContent = s.startedAt ? dur((g.running ? tn : S.now) - s.startedAt) : '—';
  $('kSessionSub').textContent = s.startedAt ? t('started {time}', { time: clock(s.startedAt) }) : '';
  const p = s.position;
  $('kZone').innerHTML = p ? `<span class="editable" data-label-kind="zones" data-label-id="${p.zone}">${esc(zoneName(p.zone))}</span>` : '—';
  // gold (from the open inventory) and what you made this session
  const gd = S.gold;
  $('kGoldCard').hidden = !gd;
  if (gd) {
    $('kGold').textContent = gold(gd.gold);
    $('kGoldSub').textContent = gd.session ? t('{c} this session · {h}/h', { c: `${gd.session.change >= 0 ? '+' : '−'}${gold(Math.abs(gd.session.change))}`, h: `${gd.session.perHour >= 0 ? '+' : '−'}${gold(Math.abs(Math.round(gd.session.perHour)))}` }) : t('read {time}', { time: clock(gd.t) });
  }
  // "try these": readers that haven't worked yet this time, with what to do in the game (gone when all have)
  const tryList = S.tryNext || [], tryHidden = store.get('tryNextHidden', 0) > Date.now() - 6 * 3600000;
  $('tryNext').hidden = !tryList.length || tryHidden;
  if (tryList.length && !tryHidden) $('tryNext').innerHTML = `<div class="row"><b>🧪 ${esc(t('Try these in the game'))}</b> <small class="muted">${esc(t('{n} things the tracker hasn\'t seen work yet; each ticks off by itself', { n: tryList.length }))}</small>
    <span style="margin-left:auto"><button class="small" data-try-hide>×</button></span></div>
    <ul class="trylist">${tryList.map((x) => `<li><b>${esc(t(x.label))}</b> <span class="muted">${esc(t(x.tip))}</span></li>`).join('')}</ul>`;
  // a hovered item compared with what you wear in that slot
  const gc = S.gearCompare;
  $('gearCmp').hidden = !gc;
  if (gc) $('gearCmp').innerHTML = `<div class="row"><b>${esc(t('Compare'))}:</b> <span class="notr">${esc(gc.other.name)} +${gc.other.plus || 0}</span> <span class="muted">${esc(t('vs yours'))}</span> <span class="notr">${esc(gc.mine.name)} +${gc.mine.plus || 0}</span>
    <span class="tag ${gc.verdict === 'better' ? 'up' : gc.verdict === 'worse' ? 'down' : ''}">${esc(t(gc.verdict))}</span>
    <span style="margin-left:auto"><button class="small" data-gear="equip">${t('I wear it now')}</button> <button class="small" data-gear="dismiss">×</button></span></div>
    <div class="cmplines">${gc.lines.map((l) => `<span class="${l.better === true ? 'up' : l.better === false ? 'down' : ''}">${esc(t(l.what))}: ${esc(String(l.other))} <small class="muted">(${esc(String(l.mine))})</small>${l.pct != null ? ` ${l.pct > 0 ? '+' : ''}${l.pct}%` : ''}</span>`).join('')}
    ${gc.price?.sell ? `<span class="muted">${t('chat price for gear like it: ~{p}', { p: gold(gc.price.sell) })}</span>` : ''}</div>`;
  // the item under the mouse: what the chat asks for it, the NPC price, and whether the price on it is a deal
  const pn = S.priceNow;
  $('priceNow').hidden = !pn;
  if (pn) $('priceNow').innerHTML = `<b>💰 ${esc(t('Price check'))}:</b> <span class="notr">${esc(pn.name)}${pn.plus ? ` +${pn.plus}` : ''}</span>
    ${pn.sell ? `<span>${t('chat asks ~{p}', { p: gold(pn.sell) })}</span>` : ''}${pn.buy ? `<span class="muted">${t('wanted for ~{p}', { p: gold(pn.buy) })}</span>` : ''}
    ${pn.offers ? `<small class="muted">(${t('{n} offers', { n: pn.offers })})</small>` : ''}${pn.npcPrice ? `<span class="muted">${t('NPC {p}', { p: gold(pn.npcPrice) })}</span>` : ''}
    ${pn.verdict ? `<span class="tag ${pn.verdict.word === 'cheaper' ? 'up' : pn.verdict.word === 'dearer' ? 'down' : ''}">${t('this one {p}: {w}', { p: gold(pn.shown), w: t(pn.verdict.word) })} ${pn.verdict.pct > 0 ? '+' : ''}${pn.verdict.pct}%</span>` : ''}`;
  // both game windows side by side; the one that needs you is highlighted
  const cl = S.clients || [];
  $('clients').hidden = cl.length < 2;
  if (cl.length >= 2) $('clients').innerHTML = cl.map((c) => `<div class="client ${c.attention.length ? 'attn' : ''}">
    <div class="row"><b class="notr">${esc(c.character || '?')}</b><small class="muted">${c.main ? t('window 1') : t('window 2')}${c.afk ? ` · ${t('AFK')}` : ''}</small></div>
    <div class="muted notr" style="font-size:12px">${esc(c.zoneName || '—')}</div>
    ${c.hpPct != null ? `<div class="bar ${c.hpPct < 30 ? 'low' : ''}"><i style="width:${c.hpPct}%"></i></div>` : ''}
    <div style="font-size:12px">${c.hpPct != null ? `HP ${c.hpPct}%` : ''}${c.exp != null ? ` · EXP ${num(c.exp, 2)}%` : ''}</div>
    ${c.attention.length ? `<div class="attnwhy">⚠ ${c.attention.map((w) => esc(t(w))).join(' · ')}</div>` : ''}</div>`).join('');
  const zr = S.zoneRisk;
  $('kZoneSub').innerHTML = esc(s.zoneEnteredAt ? t('here for {d}', { d: dur(tn - s.zoneEnteredAt) }) : '')
    + (zr && zr.level !== 'low' ? ` <span style="color:${zr.level === 'high' ? 'var(--crimson)' : 'var(--gold)'}" title="${esc([zr.deaths && t('you died here {n}× in 30 days', { n: zr.deaths }), zr.expLost && t('deaths here cost you {e}% EXP', { e: num(zr.expLost, 2) }), zr.enemyCount && t('enemies met here around this hour: {names}', { names: zr.enemies.map((e) => e.name).join(', ') })].filter(Boolean).join(' · '))}">⚠ ${esc(t(zr.level === 'high' ? 'risky' : 'some risk'))}</span>` : '');
  $('kPos').textContent = p ? `${num(p.x)}, ${num(p.z)}` : '—';
  $('kPosSub').textContent = p?.at ? t('updated {d} ago', { d: dur(tn - p.at) }) : p ? t('from earlier in session') : '';
  $('kDist').textContent = num(s.distance);
  $('kSpeed').textContent = s.speed > 0.05 ? t('moving · {v} u/s', { v: num(s.speed, 1) }) : t('standing still');
  const nearby = s.players.filter((x) => x.nearby);
  $('kNearby').textContent = nearby.length;
  $('kSeen').textContent = t('{n} seen this session', { n: s.players.length });
  const fc = { order: 0, chaos: 0, unknown: 0 };
  nearby.forEach((x) => fc[facKey(x.info?.faction)]++);
  $('kFac').innerHTML = nearby.length ? `<span style="color:var(--sky)">${fc.order}</span> <span class="muted">vs</span> <span style="color:var(--crimson)">${fc.chaos}</span>${fc.unknown ? ` <span class="muted" style="font-size:13px">+${fc.unknown}?</span>` : ''}` : '—';
  $('kFacBar').innerHTML = nearby.length ? [['order', 'var(--sky)'], ['chaos', 'var(--crimson)'], ['unknown', 'var(--line)']]
    .filter(([k]) => fc[k]).map(([k, c]) => `<span style="flex:${fc[k]};background:${c}" title="${k}: ${fc[k]}"></span>`).join('') : '';
  // enemies nearby (by faction)
  const dg = S.danger;
  $('kDanger').textContent = dg.myFaction ? dg.enemies : '?';
  $('kDangerCard').classList.toggle('alarm', dg.enemies >= S.settings.dangerCount);
  const myFac = dg.myFaction ? t(dg.myFaction.replace(/^The /, '')) : '';
  $('kDangerSub').textContent = !dg.myFaction ? t('set your faction in Settings') : dg.unknown ? t('+{n} unknown · you: {f}', { n: dg.unknown, f: myFac }) : t('you: {f}', { f: myFac });

  // official news
  $('newsInfo').textContent = S.news.error ? t('could not load') : S.news.fetchedAt ? t('updated {time}', { time: clock(S.news.fetchedAt) }) : t('loading…');
  $('newsList').innerHTML = S.news.posts.length ? S.news.posts.map((n) => `<div class="notice"><time>${n.date ? dateOnly(n.date) : ''}${n.maintenance ? ` · <span style="color:var(--sky)">${t('maintenance')}</span>` : ''}</time><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a></div>`).join('') : '<div class="empty">No news loaded yet.</div>';

  // events from the news, with countdowns
  const evs = S.events || [];
  $('events').innerHTML = evs.length ? evs.map((e) => {
    const running = tn >= e.start, total = e.end - e.start;
    const pct = running ? Math.min(100, ((tn - e.start) / total) * 100) : 0;
    return `<div class="ev"><div class="row"><b>${esc(e.name)}</b><span class="mono" style="font-size:12px;white-space:nowrap">${running ? t('ends in {d}', { d: dur(e.end - tn) }) : t('starts in {d}', { d: dur(e.start - tn) })}</span></div>
      <div class="muted" style="font-size:11px">${dateOnly(e.start)} – ${dateOnly(e.end)} · <a href="${esc(e.url)}" target="_blank" rel="noopener" style="color:var(--muted)">${t('post')} ↗</a></div>
      ${running ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}</div>`;
  }).join('') : '<div class="empty">No running or upcoming events found in the latest news.</div>';
  renderMarkerChips();

  // played today vs goal / limit
  const td = S.today, target = td.limitHours || td.goalHours;
  $('kToday').textContent = dur(td.ms);
  const pct = target ? Math.min(100, (td.ms / (target * 3600000)) * 100) : 0;
  $('kTodayBar').style.display = target ? '' : 'none';
  $('kTodayBar').className = `bar ${td.limitHours && td.ms >= td.limitHours * 3600000 ? 'low' : ''}`;
  $('kTodayBar').firstElementChild.style.width = pct + '%';
  $('kTodaySub').textContent = td.limitHours ? t('limit {h}h', { h: td.limitHours }) + (td.goalHours ? ` · ${t('goal {h}h', { h: td.goalHours })}` : '') : td.goalHours ? t('goal {h}h', { h: td.goalHours }) : t('no goal set');
  // play in a row since the last break (amber once the break reminder is due)
  if (td.runMs >= 10 * 60000) $('kTodaySub').innerHTML = `${esc($('kTodaySub').textContent)} · <span style="${td.breakMinutes && td.runMs >= td.breakMinutes * 60000 ? 'color:var(--gold)' : ''}">${esc(t('{d} in a row', { d: dur(td.runMs) }))}</span>`;
  // active vs AFK this session
  const tot = s.activeMs + s.afkMs;
  $('kActive').textContent = tot ? `${Math.round((s.activeMs / tot) * 100)}%` : '—';
  const afkNow = g.running && s.idleMs >= S.settings.afkMinutes * 60000;
  $('kActiveSub').textContent = afkNow ? t('AFK for {d}', { d: dur(s.idleMs) }) : tot ? t('{a} active · {b} AFK', { a: dur(s.activeMs), b: dur(s.afkMs) }) : t('measured while you play');

  const nt = S.timers[0];
  $('kTimer').textContent = nt ? countdown(nt.endsAt - tn) : '—';
  $('kTimerSub').textContent = nt ? nt.title : t('no timers running');

  // timers
  $('timers').innerHTML = S.timers.length ? S.timers.map((x) => {
    const left = x.endsAt - tn;
    return `<div class="timer ${left < 60000 ? 'soon' : ''}"><div class="row"><span class="big">${countdown(left)}</span><span class="muted" style="font-size:12px">${clock(x.endsAt)}</span></div><p>${esc(x.text)}</p></div>`;
  }).join('') : '<div class="empty">No timers running. When the server announces a boss or event "in N min", a countdown appears here.</div>';
  renderBossNext(tn);
  renderParty(tn);

  // buffs
  $('buffs').innerHTML = S.buffs.length ? S.buffs.map((b) => {
    const left = Math.max(0, b.expiresAt - tn), pct = Math.max(0, Math.min(100, (left / b.durationMs) * 100));
    return `<div class="buff"><div class="row"><span class="editable" data-label-kind="buffs" data-label-id="${esc(b.id)}">${esc(buffName(b.id))}</span><span class="mono">${dur(left)}</span></div>
      <div class="bar ${pct < 15 ? 'low' : ''}"><i style="width:${pct}%"></i></div></div>`;
  }).join('') : '<div class="empty">No timed effects active.</div>';

  // players
  const mode = $('pFilter').value, facF = $('pFaction').value, qq = $('pSearch').value.trim().toLowerCase();
  const list = s.players.filter((x) => (mode === 'all' || (mode === 'watched' ? x.watched : x.nearby))
    && (!facF || (facF === '?' ? !x.info?.faction : x.info?.faction === facF))
    && (!qq || x.name.toLowerCase().includes(qq))).slice(0, 200);
  $('players').innerHTML = list.length ? list.map((x) => {
    const i = x.info || {};
    const src = i.noted ? `<span class="src">${t('note')}</span>` : i.ranked ? `<span class="src rank" title="${esc(i.ranks.map((r) => `#${r.rank} ${r.board}`).join(', '))}">${t('ranked')}</span>` : '';
    return `<tr class="click ${x.nearby ? '' : 'away'}" data-player="${esc(x.name)}"><td>${star(x.name, x.watched)}</td><td>${esc(x.name)}${x.threat ? flag : ''}${friendFlags(x)}${src}${i.note ? `<div class="muted" style="font-size:11px">${esc(i.note)}</div>` : ''}</td>
      <td class="num">${q(i.level)}</td><td>${esc(i.cls) || q()}</td><td>${facBadge(i.faction)}</td><td>${esc(i.house) || '<span class="muted">—</span>'}</td>
      <td>${x.nearby ? `<span class="tag live">${t('nearby')}${x.firstSeen ? ' · ' + dur(tn - x.firstSeen) : ''}</span>` : `<span class="tag">${x.lastSeen ? t('{d} ago', { d: dur(tn - x.lastSeen) }) : t('earlier')}</span>`}</td></tr>`;
  }).join('') : `<tr><td colspan="7" class="empty">${mode === 'nearby' ? 'Nobody nearby right now.' : 'Nobody matches.'}</td></tr>`;

  // zones
  const zoneIds = Object.keys(s.timeByZone).sort((a, b) => s.timeByZone[b] - s.timeByZone[a]);
  const totalZ = zoneIds.reduce((a, z) => a + s.timeByZone[z], 0) || 1;
  const zc = (i) => (i < 4 ? SERIES[i] : 'var(--muted)');
  $('zoneBar').innerHTML = zoneIds.map((z, i) => `<span title="${esc(zoneName(z))}" style="flex:${s.timeByZone[z] / totalZ};background:${zc(i)}"></span>`).join('');
  $('zones').innerHTML = zoneIds.map((z, i) => `<tr><td><span class="swatch" style="background:${zc(i)}"></span><span class="editable" data-label-kind="zones" data-label-id="${z}">${esc(zoneName(z))}</span></td>
    <td class="num">${dur(s.timeByZone[z])}</td><td class="num">${num(s.distanceByZone[z])}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">No zones loaded yet.</td></tr>';

  $('notices').innerHTML = s.notices.length ? s.notices.map((n) => `<div class="notice"><time>${n.at ? clock(n.at) : 'earlier this session'}</time>${esc(n.text)}</div>`).join('') : '<div class="empty">No server notices yet.</div>';

  const hist = Object.entries(S.buffHistory).sort((a, b) => b[1].lastAt - a[1].lastAt);
  $('buffHist').innerHTML = hist.length ? hist.map(([id, h]) => `<tr><td><span class="editable" data-label-kind="buffs" data-label-id="${esc(id)}">${esc(buffName(id))}</span></td>
    <td class="num">${h.count}</td><td class="num">${dur(h.lastDurationMs)}</td><td class="muted">${clock(h.lastAt)}</td></tr>`).join('')
    : '<tr><td colspan="4" class="empty">Nothing yet. Effects are recorded as they happen.</td></tr>';

  drawTrail();
}

// ---- theme & compact mode
const THEMES = ['dark', 'light', 'auto'];
function applyView() {
  const th = store.get('theme', 'dark'), cp = store.get('compact', false);
  document.documentElement.dataset.theme = th;
  document.documentElement.dataset.compact = cp ? '1' : '0';
  $('btnTheme').textContent = th === 'dark' ? '☾' : th === 'light' ? '☀' : '◐';
  $('btnTheme').title = t('Theme: {th} (click to change)', { th: t(th) });
  $('btnCompact').className = cp ? 'primary' : '';
  $('btnCompact').title = cp ? 'Compact mode on' : 'Compact mode off';
  if (S) { render(); if (tab === 'rankings') loadRankings(); if (tab === 'report') loadReport(); if (tab === 'heatmap') drawHeatmap(); }
}
$('btnTheme').onclick = () => { store.set('theme', THEMES[(THEMES.indexOf(store.get('theme', 'dark')) + 1) % 3]); applyView(); };
$('btnCompact').onclick = () => { store.set('compact', !store.get('compact', false)); applyView(); };

// ---- your own map markers
const MARK = { farm: '⚔', boss: '💀', npc: '❗', danger: '⚠', star: '★' };
let trailView = null, placing = false, pendingMark = null;
function drawMarkers(ctx, v, zone) {
  for (const w of (S.waypoints || []).filter((m) => m.zone === String(zone))) {
    const [x, y] = v.P(w.x, w.z);
    ctx.save();
    ctx.fillStyle = w.kind === 'danger' || w.kind === 'boss' ? 'rgba(192,57,43,.92)' : 'rgba(26,20,8,.85)';
    ctx.strokeStyle = '#f0d58a'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.font = '12px "Segoe UI Emoji", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
    ctx.fillText(MARK[w.kind] || '★', x, y + 1);
    ctx.font = '600 11px Inter, sans-serif'; ctx.textAlign = 'left';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(14,15,19,.85)'; ctx.strokeText(w.label, x + 13, y);
    ctx.fillStyle = '#f6e7c1'; ctx.fillText(w.label, x + 13, y);
    ctx.restore();
  }
}
function renderMarkerChips() {
  const zone = S.session.position?.zone;
  const list = (S.waypoints || []).filter((m) => zone != null && m.zone === String(zone));
  // (a friend's marker shows who placed it and can't be removed here; a note shows on hover)
  $('markerChips').innerHTML = list.map((m) => `<span class="chip" title="${esc([m.note, m.owner && t('from {name}', { name: m.owner })].filter(Boolean).join(' · '))}">${MARK[m.kind] || '★'} ${esc(m.label)}${m.note ? ' 📝' : ''}${m.owner ? ` <small class="muted">${esc(m.owner)}</small>` : `<button data-del-mark="${esc(m.id)}" title="Remove marker">×</button>`}</span>`).join('')
    || (zone != null ? '<span class="muted" style="font-size:12px">No markers in this zone yet. Use “Mark my spot”, or “Place on map” and click the map.</span>' : '');
}
function askMarker(zone, x, z) {
  pendingMark = { zone, x, z };
  $('mdWhere').textContent = `${zoneName(zone)} · x ${num(x)}, z ${num(z)}`;
  $('mForm').reset();
  $('mDialog').showModal();
}
$('mDialog').addEventListener('close', async () => {
  if ($('mDialog').returnValue !== 'save' || !pendingMark) return;
  const f = $('mForm').elements;
  const r = await post('/api/waypoints', { action: 'add', ...pendingMark, label: f.label.value, kind: f.kind.value, note: f.note.value });
  if (r.ok) { S.waypoints = await r.json(); renderMarkerChips(); drawTrail(); }
  pendingMark = null;
});
$('btnMarkHere').onclick = () => { const p = S?.session.position; if (p) askMarker(p.zone, p.x, p.z); else toast({ kind: 'timer', title: 'No position yet', body: 'Move in-game once so the tracker knows where you are.' }); };
$('btnMarkClick').onclick = () => { placing = !placing; $('btnMarkClick').className = placing ? 'small primary' : 'small'; $('btnMarkClick').textContent = placing ? 'Click the map…' : '＋ Place on map'; $('map').style.cursor = placing ? 'crosshair' : ''; };
$('map').addEventListener('click', (e) => {
  if (!placing || !trailView) return;
  const r = e.target.getBoundingClientRect(), { v, zone } = trailView;
  const wx = (e.clientX - r.left - r.width / 2) / v.scale + v.cx, wz = -(e.clientY - r.top - r.height / 2) / v.scale + v.cz;
  $('btnMarkClick').click(); // leave placing mode
  askMarker(zone, Math.round(wx), Math.round(wz));
});
document.addEventListener('click', async (e) => {
  const d = e.target.closest('[data-del-mark]');
  if (!d) return;
  const r = await post('/api/waypoints', { action: 'delete', id: d.dataset.delMark });
  if (r.ok) { S.waypoints = await r.json(); renderMarkerChips(); drawTrail(); }
});

// ---- real zone maps: the client's 512 px minimap covers a 5120-unit tile centred on (cx, cz)
const mapImgs = {};
function mapImage(zone) {
  if (!mapImgs[zone]) {
    const im = new Image();
    im.onload = () => { if (tab === 'live') drawTrail(); if (tab === 'heatmap') drawHeatmap(); };
    im.src = `/api/minimap/${zone}`;
    mapImgs[zone] = im;
  }
  const im = mapImgs[zone];
  return im.complete && im.naturalWidth ? im : null;
}
const tileCorners = (t) => [[t.cx - t.size / 2, t.cz - t.size / 2], [t.cx + t.size / 2, t.cz + t.size / 2]];
function drawTile(ctx, v, t, img, w, h, alpha) {
  const [x0, y0] = v.P(t.cx - t.size / 2, t.cz + t.size / 2);
  const s = t.size * v.scale;
  ctx.save();
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--panel-2').trim() || '#121319';
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = alpha; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, x0, y0, s, s);
  ctx.restore();
}

function fitView(points, w, h, minSpan = 40, pad = 1.15) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of points) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
  const span = Math.max(maxX - minX, maxZ - minZ, minSpan) * pad, cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const scale = Math.min(w, h) / span;
  // world z grows "north" in-game, so flip it for screen space
  return { P: (x, z) => [w / 2 + (x - cx) * scale, h / 2 - (z - cz) * scale], scale, span, cx, cz, minX, maxX, minZ, maxZ };
}

function prepCanvas(cv) {
  const dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function drawTrail() {
  const { ctx, w, h } = prepCanvas($('map'));
  const tr = S.session.trail, p = S.session.position;
  if (!p || !tr.length) {
    ctx.fillStyle = '#8d8a80'; ctx.font = '13px Inter'; ctx.textAlign = 'center';
    ctx.fillText('Waiting for position data…', w / 2, h / 2); return;
  }
  const tile = S.maps?.[p.zone], img = tile && mapImage(p.zone);
  // frame the map on the stretch walked since the last teleport, not the whole zone history
  let from = 0;
  for (let i = tr.length - 1; i > 0; i--) if (Math.hypot(tr[i][0] - tr[i - 1][0], tr[i][1] - tr[i - 1][1]) > 150) { from = i; break; }
  const whole = tile && $('mapMode').value === 'whole';
  const v = whole ? fitView(tileCorners(tile), w, h, 0, 1) : fitView(tr.slice(from), w, h, tile ? 1200 : 40);
  if (img) drawTile(ctx, v, tile, img, w, h, 0.9);
  else {
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1;
    const step = Math.pow(10, Math.floor(Math.log10(v.span / 4)));
    for (let gx = Math.ceil((v.cx - v.span) / step) * step; gx < v.cx + v.span; gx += step) { const [sx] = v.P(gx, 0); ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); ctx.stroke(); }
    for (let gz = Math.ceil((v.cz - v.span) / step) * step; gz < v.cz + v.span; gz += step) { const [, sy] = v.P(0, gz); ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(w, sy); ctx.stroke(); }
  }
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (let pass = 0; pass < (img ? 2 : 1); pass++) { // on a map, draw a dark casing under the gold line so it stays visible
    for (let i = 1; i < tr.length; i++) {
      if (Math.hypot(tr[i][0] - tr[i - 1][0], tr[i][1] - tr[i - 1][1]) > 150) continue; // teleport
      const a = 0.25 + 0.75 * (i / tr.length);
      ctx.strokeStyle = img && pass === 0 ? `rgba(20,14,4,${a * 0.8})` : `rgba(214,168,74,${img ? a : 0.15 + 0.6 * (i / tr.length)})`;
      ctx.lineWidth = img && pass === 0 ? 5 : img ? 2.5 : 2;
      ctx.beginPath(); ctx.moveTo(...v.P(...tr[i - 1])); ctx.lineTo(...v.P(...tr[i])); ctx.stroke();
    }
  }
  if (img) { ctx.strokeStyle = '#1a1408'; ctx.lineWidth = 3; const [qx, qy] = v.P(p.x, p.z); ctx.beginPath(); ctx.arc(qx, qy, 7, 0, Math.PI * 2); ctx.stroke(); }
  drawMarkers(ctx, v, p.zone);
  drawFriends(ctx, v, p.zone);
  trailView = { v, zone: p.zone };
  const [px, py] = v.P(p.x, p.z);
  const pulse = 6 + 3 * Math.sin(Date.now() / 300);
  ctx.fillStyle = 'rgba(214,168,74,0.25)'; ctx.beginPath(); ctx.arc(px, py, pulse + 4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#d6a84a'; ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill();
  $('mapInfo').textContent = `${zoneName(p.zone)} · ${t('{n} points', { n: tr.length })}`;
  $('mapBounds').textContent = `x ${num(v.minX)}–${num(v.maxX)} · z ${num(v.minZ)}–${num(v.maxZ)}`;
}
