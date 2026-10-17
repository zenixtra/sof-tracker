// SoF Tracker dashboard: social. Loaded as a classic script; all dashboard scripts share one global scope (see index.html).

// ---------------------------------------------------------------- party view & update banner
function renderParty(tnow) {
  const party = S.friends?.party || [];
  renderOthers(tnow);
  $('partyPanel').hidden = !party.length;
  const side = (party.length ? 1 : 0) + ((S.others || []).length ? 1 : 0);
  $('effectPanel').className = `panel ${['c8', 'c4', 'c12'][side]}`; // next to the checklist and the party / window panels
  if (!party.length) return;
  $('party').innerHTML = party.map((f) => {
    const l = f.live;
    const status = !f.online ? t('offline') : !l?.running ? t('not playing') : l.afk ? 'AFK' : t('in game');
    const where = l?.running && l.zone ? zoneName(l.zone) : '';
    const same = l?.running && S.session.position && String(S.session.position.zone) === String(l.zone);
    return `<div class="pm"><span class="dot ${f.online && l?.running && !l.afk ? 'on' : ''}" style="${f.online && l?.afk ? 'background:var(--gold)' : ''}"></span>
      <span class="who"><b>${esc(f.name)}</b>${l?.character ? ` · ${esc(l.character)}` : ''}<small>${esc(status)}${where ? ` · ${esc(where)}` : ''}${same ? ` · ${t('same zone as you')}` : ''}${l?.running && l.nearby != null ? ` · ${t('{n} nearby', { n: l.nearby })}` : ''}</small></span>
      <span class="muted" style="font-size:11px;white-space:nowrap">${f.updatedAt ? t('{d} ago', { d: dur(tnow - f.updatedAt) }) : ''}</span></div>`;
  }).join('');
}

// second (third…) game windows: one card per character, with a button to follow it instead
function renderOthers(tnow) {
  const list = S.others || [];
  $('altsPanel').hidden = !list.length;
  if (!list.length) return;
  $('alts').innerHTML = list.map((o) => {
    const status = o.responding === false ? t('not responding') : o.afk ? `AFK ${dur(o.idleMs)}` : t('in game');
    const lv = o.info?.level ? `Lv ${o.info.level}${o.info.cls ? ` ${esc(o.info.cls)}` : ''}` : '';
    const tr = (o.activeMs || 0) + (o.afkMs || 0);
    return `<div class="pm" style="align-items:flex-start"><span class="dot ${o.afk || o.responding === false ? '' : 'on'}" style="margin-top:5px;${o.afk ? 'background:var(--gold)' : ''}"></span>
      <span class="who"><b class="click" data-player="${esc(o.character || '')}">${esc(o.character || t('Character'))}</b>${lv ? ` <span class="muted">· ${lv}</span>` : ''}
        <small>${esc(status)}${o.zone != null ? ` · ${esc(zoneName(o.zone))}` : ''}${o.x != null ? ` · ${Math.round(o.x)}, ${Math.round(o.z)}` : ''}</small>
        <small>${t('{n} nearby', { n: o.nearby })}${o.enemies ? ` · <b style="color:var(--crimson)">${t('{n} enemies', { n: o.enemies })}</b>` : ''} · ${t('{n} seen', { n: o.seen })}${o.startedAt ? ` · ${dur(tnow - o.startedAt)}` : ''}${tr ? ` · ${t('{p}% active', { p: Math.round((o.activeMs / tr) * 100) })}` : ''}</small>
        ${o.players.length ? `<small>${o.players.map((p) => `<span class="click" data-player="${esc(p.name)}">${esc(p.name)}${p.threat ? '⚠' : ''}${p.watched ? '★' : ''}</span>`).join(', ')}</small>` : ''}
        ${o.screen?.hp != null || o.screen?.exp != null ? `<small>${o.screen.hp != null ? `HP ${num(o.screen.hp)} / ${num(o.screen.hpMax)}` : ''}${o.screen.mp != null ? ` · MP ${num(o.screen.mp)}` : ''}${o.screen.exp != null ? ` · EXP ${num(o.screen.exp, 1)}%` : ''} · <a href="/api/peek.jpg?pid=${o.pid}" target="_blank" rel="noopener">${t('screen')}</a></small>
          <div class="bar hp"><i style="width:${o.screen.hpMax ? Math.round((o.screen.hp / o.screen.hpMax) * 100) : 0}%"></i></div>` : ''}</span>
      <button class="small" data-focus="${o.pid}" title="${esc(t('Show this window on the dashboard'))}">${t('Follow')}</button></div>`;
  }).join('');
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-focus]');
  if (!b) return;
  b.disabled = true;
  await post('/api/focus', { pid: +b.dataset.focus });
});

// an optional update: a banner you can put off until the next version (a required one is the full-screen update-gate.js)
function renderUpdate() {
  const u = S.update, bar = $('updBar'), d = u?.download || {};
  const show = u && u.state === 'optional' && u.target && store.get('updLater', null) !== u.target.version;
  if (!show) { bar.className = ''; bar.innerHTML = ''; return; }
  bar.className = 'on';
  const html = `<b>⬆ ${t('SoF Tracker {v} is available', { v: esc(u.target.version) })}</b><span>${t('You have {v}.', { v: esc(u.current) })}${u.target.notes ? ` <span class="muted" title="${esc(u.target.notes)}">${esc(u.target.notes.split('\n')[0].slice(0, 90))}</span>` : ''}</span>`
    + (d.phase === 'downloading' ? `<span class="mono">${t('Downloading… {p}%', { p: d.total ? Math.round((d.bytes / d.total) * 100) : 0 })}</span>`
      : d.phase === 'installing' ? `<span>${t('Setup is running: the tracker restarts by itself.')}</span>`
        : `${d.phase === 'failed' ? `<span style="color:var(--crimson)">${esc(d.error)}</span>` : ''}<button class="small primary" id="btnUpdate">${t(d.phase === 'failed' ? 'Try again' : 'Install update')}</button><button class="small" id="btnUpdLater">${t('Later')}</button>`);
  if (bar.dataset.html !== html) { bar.innerHTML = html; bar.dataset.html = html; }
}
document.addEventListener('click', async (e) => {
  if (e.target.id === 'btnUpdLater') { store.set('updLater', S.update?.target?.version || null); renderUpdate(); return; }
  if (e.target.id !== 'btnUpdate') return;
  if (!confirm(t('Install the update now? The tracker closes and restarts after setup.'))) return;
  const r = await post('/api/update/install', {});
  if (!r.ok) toast({ kind: 'timer', title: t('Could not start the update'), body: await r.text() });
});

// friends on your map: same zone, live position shared
function drawFriends(ctx, v, zone) {
  for (const f of S.friends?.party || []) {
    const l = f.live;
    if (!f.online || !l?.running || String(l.zone) !== String(zone) || l.x == null) continue;
    const [x, y] = v.P(l.x, l.z);
    ctx.save();
    ctx.fillStyle = '#6aa7e0'; ctx.strokeStyle = '#0e1a2a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.font = '600 11px Inter, sans-serif'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(14,15,19,.85)';
    ctx.strokeText(f.name, x + 9, y + 4); ctx.fillStyle = '#cfe3f7'; ctx.fillText(f.name, x + 9, y + 4);
    ctx.restore();
  }
}

// ---------------------------------------------------------------- clean-up tools
async function loadCleanup() {
  const list = await getJSON('/api/sessions');
  $('cuSessions').innerHTML = list.map((r) => `<tr><td><input type="checkbox" value="${esc(r.key)}" ${r.live ? 'disabled title="live"' : ''}></td><td class="muted" style="white-space:nowrap">${dateTime(r.startedAt)}</td><td>${esc(r.character || '?')}</td><td class="num">${dur(r.endedAt - r.startedAt)}</td></tr>`).join('')
    || `<tr><td class="empty">${t('No sessions recorded yet.')}</td></tr>`;
  const chars = [...new Set(list.map((r) => r.character).filter(Boolean))].sort();
  const opts = chars.map((c) => `<option>${esc(c)}</option>`).join('');
  $('cuFrom').innerHTML = opts; $('cuTo').innerHTML = opts;
  if (chars.length > 1) $('cuTo').selectedIndex = 1;
  renderUpdateInfo(await getJSON('/api/update'));
}
function renderUpdateInfo(u) {
  $('upVersion').textContent = t('this PC: {v}', { v: u.current });
  const state = { dev: t('update checks are off in this copy (no update key: a development build)'), current: t('up to date'), optional: t('{v} is available', { v: u.target?.version }),
    unknown: t('not checked yet'), required: t('update required'), revoked: t('this version was withdrawn'), offline: t('could not check for too long') }[u.state] || u.state;
  $('upMsg').textContent = [state, u.devCheckout ? t('development copy (the project folder): never blocked, update it with git') : '', u.verifiedAt ? t('last checked {when}', { when: dateTime(u.verifiedAt) }) : '', u.lastError ? t('last try failed: {e}', { e: u.lastError }) : '',
    u.friend ? t('{name} runs {v}', { name: u.friend.from, v: u.friend.version }) : ''].filter(Boolean).join(' · ');
}
$('btnUpCheck').onclick = async () => {
  $('btnUpCheck').disabled = true; $('upMsg').textContent = t('Checking…');
  try { const r = await post('/api/update/check', {}); if (r.ok) renderUpdateInfo(await r.json()); } finally { $('btnUpCheck').disabled = false; }
};
async function runCleanup(body, question) {
  if (!confirm(`${question}\n\n${t('A backup is made first, so this can be undone.')}`)) return;
  const r = await post('/api/cleanup', body);
  if (!r.ok) { toast({ kind: 'timer', title: t('Clean-up failed'), body: await r.text() }); return; }
  const res = await r.json();
  toast({ kind: 'buff', title: t('Done: {what}', { what: res.done }), body: t('Backup: {f}', { f: res.backup }) });
  loadSettings();
}
$('btnCuDelete').onclick = () => {
  const keys = [...$('cuSessions').querySelectorAll('input:checked')].map((i) => i.value);
  if (!keys.length) return toast({ kind: 'timer', title: t('Select sessions first') });
  runCleanup({ action: 'delete-sessions', keys }, t('Delete {n} session(s)?', { n: keys.length }));
};
$('btnCuMerge').onclick = () => runCleanup({ action: 'merge-character', from: $('cuFrom').value, to: $('cuTo').value }, t('Move all sessions of {from} to {to}?', { from: $('cuFrom').value, to: $('cuTo').value }));
$('btnCuReset').onclick = () => runCleanup({ action: 'reset', what: $('cuWhat').value }, t('Reset: {what}?', { what: $('cuWhat').selectedOptions[0].textContent }));

// ---------------------------------------------------------------- voice alerts
const IMPORTANT = ['danger', 'watch', 'boss', 'maintenance', 'disconnect', 'whisper', 'party', 'stuck'];
function speak(text) {
  if (!('speechSynthesis' in window) || !text) return;
  const u = new SpeechSynthesisUtterance(text.replace(/[⚠★✎🛠]/g, ''));
  const want = LANGS[getLang()]?.speech || 'en-US';
  const v = speechSynthesis.getVoices().find((x) => x.lang === want) || speechSynthesis.getVoices().find((x) => x.lang.startsWith(want.slice(0, 2)));
  if (v) u.voice = v;
  u.lang = want; u.rate = 1.05;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}
function maybeSpeak(a) {
  const mode = store.get('voice', 'off');
  if (mode === 'all' || (mode === 'important' && IMPORTANT.includes(a.kind))) speak(tAlert(a.title));
}

// ---------------------------------------------------------------- alerts: toasts, sound, notifications
let lastAlertId = store.get('lastAlertId', null), readAlertId = store.get('readAlertId', 0), audio = null;
const soundOn = () => store.get('sound', true), notifyOn = () => store.get('notify', false);

function beep(kind) {
  if (!soundOn()) return;
  if (window.SofSounds?.play(kind, S?.settings?.sounds)) return; // your sound for this alert type (Alerts → Sounds)
  try {
    audio ||= new AudioContext();
    if (audio.state === 'suspended') audio.resume();
    const notes = kind === 'danger' ? [988, 740, 988, 740] : kind === 'watch' ? [660, 880] : kind === 'buff' ? [523, 523] : kind === 'maintenance' ? [440, 554, 659] : kind === 'whisper' ? [880, 1175, 880] : kind === 'party' ? [988, 740, 988] : [784, 988, 1175];
    notes.forEach((f, i) => {
      const o = audio.createOscillator(), g = audio.createGain(), t0 = audio.currentTime + i * 0.16;
      o.type = 'triangle'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.15);
      o.connect(g).connect(audio.destination); o.start(t0); o.stop(t0 + 0.16);
    });
  } catch { /* audio blocked until the page gets a click */ }
}

function toast(a) {
  const el = document.createElement('div');
  el.className = `toast ${a.kind}`;
  el.innerHTML = `<b>${esc(tAlert(a.title))}</b>${a.body ? `<span>${esc(tAlert(a.body))}</span>` : ''}${a.undo && !a.undone ? `<button class="small" data-undo="${a.id}">${t('Undo')}</button>` : ''}`;
  el.onclick = (e) => { if (!e.target.closest('[data-undo]')) el.remove(); };
  $('toasts').prepend(el);
  setTimeout(() => el.remove(), 9000);
}

function handleAlerts() {
  const list = S.alerts;
  const maxId = list.length ? list[list.length - 1].id : 0;
  if (lastAlertId === null) { lastAlertId = maxId; store.set('lastAlertId', maxId); } // don't replay old alerts on first visit
  const fresh = list.filter((a) => a.id > lastAlertId);
  // muted / capped / quiet farming: only in the alert log, no pop-up or sound
  for (const a of fresh.filter((x) => !x.silent)) {
    toast(a);
    maybeSpeak(a);
    if (notifyOn() && 'Notification' in window && Notification.permission === 'granted' && document.hidden !== false) {
      try { new Notification(tAlert(a.title), { body: tAlert(a.body), tag: 'sof-' + a.id }); } catch { /* ignore */ }
    }
  }
  const loud = fresh.filter((x) => !x.silent);
  if (loud.length) beep(loud[loud.length - 1].kind);
  if (fresh.length) { lastAlertId = maxId; store.set('lastAlertId', maxId); }
  if (tab === 'alerts') markAlertsRead();
  const unread = list.filter((a) => a.id > readAlertId).length;
  $('alertBadge').hidden = !unread;
  $('alertBadge').textContent = unread > 9 ? '9+' : unread;
}
function markAlertsRead() {
  const maxId = S?.alerts.length ? S.alerts[S.alerts.length - 1].id : 0;
  if (maxId > readAlertId) { readAlertId = maxId; store.set('readAlertId', maxId); }
}

function renderAlertSettings() {
  $('btnSound').textContent = soundOn() ? '🔊 Sound on' : '🔇 Sound off';
  $('btnSound').className = soundOn() ? 'primary' : '';
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  $('btnNotify').textContent = perm === 'unsupported' ? 'Desktop notifications not supported here' : notifyOn() && perm === 'granted' ? '🔔 Desktop notifications on' : '🔕 Desktop notifications off';
  $('btnNotify').className = notifyOn() && perm === 'granted' ? 'primary' : '';
}
$('btnSound').onclick = () => { store.set('sound', !soundOn()); renderAlertSettings(); beep('timer'); };
$('btnNotify').onclick = async () => {
  if (!('Notification' in window)) return;
  if (!notifyOn()) { const p = await Notification.requestPermission(); store.set('notify', p === 'granted'); }
  else store.set('notify', false);
  renderAlertSettings();
};
$('btnTest').onclick = () => { const a = { id: 0, kind: 'timer', title: 'Test alert', body: 'This is what alerts look like.' }; toast(a); beep('timer'); if (notifyOn() && Notification.permission === 'granted') new Notification(a.title, { body: a.body }); };
document.addEventListener('click', () => { if (audio?.state === 'suspended') audio.resume(); }, { capture: true });

function renderAlertsTab() {
  $('watchlist').innerHTML = S.watchlist.length ? `<table><tbody>${S.watchlist.map((n) => {
    const i = infoFor(n) || {};
    const near = S.session.players.find((p) => p.name.toLowerCase() === n.toLowerCase() && p.nearby);
    return `<tr><td>${esc(n)} ${near ? `<span class="tag live">${t('nearby')}</span>` : ''}</td><td class="num">${i.level ? 'Lv ' + i.level : ''}</td><td>${facBadge(i.faction)}</td><td class="num"><button class="small danger" data-unwatch="${esc(n)}">Remove</button></td></tr>`;
  }).join('')}</tbody></table>` : '<div class="empty">Nobody yet. Add a name above or click ☆ next to any player.</div>';
  $('alertLog').innerHTML = S.alerts.slice().reverse().map((a) => `<tr><td class="muted" style="white-space:nowrap">${dateTime(a.t)}</td><td><span class="tag">${esc(t(KIND_NAMES[a.kind] || a.kind))}</span></td><td><b>${esc(tAlert(a.title))}</b>${a.body ? `<div class="muted" style="font-size:12px">${esc(tAlert(a.body))}</div>` : ''}${a.undo ? (a.undone ? ` <span class="tag">${t('undone')}</span>` : ` <button class="small" data-undo="${a.id}">${t('Undo')}</button>`) : ''}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">No alerts yet.</td></tr>';
}
// Undo: a tick the tracker made by itself (a quest you only dropped)
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-undo]'); if (!b) return;
  e.stopPropagation();
  const r = await (await post('/api/alert-undo', { id: +b.dataset.undo })).json();
  const a = S.alerts.find((x) => x.id === +b.dataset.undo); if (a && r.ok) a.undone = true;
  b.replaceWith(Object.assign(document.createElement('span'), { className: 'tag', textContent: r.ok ? t('undone') : t('already undone') }));
  if (typeof renderActiveQuests === 'function') renderActiveQuests();
});
$('watchForm').addEventListener('submit', async (e) => { e.preventDefault(); const n = $('watchName').value.trim(); if (!n) return; await post('/api/watch', { name: n, on: true }); $('watchName').value = ''; S.watchlist.push(n); render(); });

async function toggleWatch(name) {
  const on = !isWatched(name);
  await post('/api/watch', { name, on });
  S.watchlist = on ? [...S.watchlist, name] : S.watchlist.filter((w) => w.toLowerCase() !== name.toLowerCase());
  render();
  if (tab === 'encounters') renderEncounters();
  if (rSelected === name) $('ppName').innerHTML = `${esc(name)} ${star(name, on)}`;
}

// ---------------------------------------------------------------- player profile
let profName = null;
async function openProfile(name) {
  profName = name;
  const p = await getJSON(`/api/profile?name=${encodeURIComponent(name)}`);
  profName = p.name;
  const i = p.info || {};
  $('pfName').textContent = p.name;
  $('pfBadges').innerHTML = `${facBadge(i.faction)} ${i.ranked ? '<span class="tag" style="color:var(--gold)">ranked</span>' : ''} ${i.noted ? '<span class="tag">your notes</span>' : ''}`;
  $('pfWatch').textContent = p.watched ? '★ Watching' : '☆ Watch';
  $('pfThreat').innerHTML = p.threat ? `<div class="threatbox">⚠ <span>${t('Part of {n} danger alert(s), last {when}{where}. You get a warning when they show up again.', { n: `<b>${p.threat.count}</b>`, when: dateTime(p.threat.lastAt), where: Object.keys(p.threat.zones).length ? ` (${Object.keys(p.threat.zones).map((z) => esc(zoneName(z))).join(', ')})` : '' })}</span><button class="small" id="pfClearThreat">${t('Clear flag')}</button></div>` : '';
  const facts = [
    ['Level', i.level], ['Class', i.cls], ['House', i.house], ['Honor', i.honor ? num(i.honor) : null],
    ['Ranks', i.ranks?.length ? i.ranks.map((r) => `#${r.rank} ${r.board}`).join(', ') : null],
    ['Met', p.meetings.length ? t('{n} session(s)', { n: p.meetings.length }) : t('never')],
    ['Time near you', p.meetings.reduce((a, m) => a + m.nearMs, 0) ? dur(p.meetings.reduce((a, m) => a + m.nearMs, 0)) : null],
    ['Levels/day', p.prediction ? `${num(p.prediction.perDay, 2)} · ${t('next level {when}', { when: p.prediction.nextLevelAt > Date.now() ? t('in {d}', { d: dur(p.prediction.nextLevelAt - Date.now()) }) : t('any time now') })}` : null],
    // you killed them / they killed you (the game's own messages)
    ['PvP', p.pvp ? t('you {k} – {d} them · last {when}', { k: p.pvp.kills, d: p.pvp.deaths, when: dateTime(p.pvp.lastAt) }) : null],
    ['Flagged by friends', p.friendThreat?.length ? p.friendThreat.join(', ') : null],
    ['Watched by friends', p.friendWatch?.length ? p.friendWatch.join(', ') : null],
    ['Note', i.note],
  ].filter(([, v]) => v != null && v !== '');
  $('pfFacts').innerHTML = facts.map(([k, v]) => `<span><b>${esc(t(k))}</b>${esc(v)}</span>`).join('');
  $('pfMeetInfo').textContent = p.meetings.length ? t('first {date}', { date: dateOnly(p.meetings[p.meetings.length - 1].at) }) : '';
  $('pfMeetings').innerHTML = p.meetings.map((m) => `<tr><td>${dateTime(m.at)}</td><td>${esc(m.character || '?')}</td><td>${m.zone != null ? esc(zoneName(m.zone)) : '—'}</td><td class="num">${m.nearMs ? dur(m.nearMs) : '<span class="muted">—</span>'}</td></tr>`).join('')
    || '<tr><td colspan="4" class="empty">You have not met this player in a tracked session.</td></tr>';
  const zs = Object.entries(p.zones).sort((a, b) => b[1] - a[1]);
  $('pfZones').innerHTML = zs.length ? zs.map(([z, n]) => `<div class="row" style="padding:3px 0"><span>${esc(zoneName(z))}</span><span class="mono">${n}×</span></div>`).join('') : '<div class="empty">No zone data.</div>';
  renderSchedule(p);
  $('pfAlerts').innerHTML = p.alerts.length ? p.alerts.map((a) => `<div class="recap"><span class="muted">${dateTime(a.t)}</span> ${esc(tAlert(a.title))}</div>`).join('') : '<div class="empty">None.</div>';
  if (!$('profDialog').open) $('profDialog').showModal();
  lineChart($('pfLevel'), { series: [{ name: 'Level', color: 'var(--s4)', points: p.history.filter((x) => x.level).map((x) => [x.t, x.level]) }], height: 160, step: true, empty: p.ranked ? 'Not enough ranking history yet.' : 'Not in the public rankings.' });
  lineChart($('pfHonor'), { series: [{ name: 'Honor', color: 'var(--s5)', points: p.history.filter((x) => x.honor).map((x) => [x.t, x.honor]) }], height: 160, step: true, empty: !p.ranked ? 'Not in the public rankings.' : i.honor ? 'Not enough ranking history yet.' : 'Not on the honor board.' });
}
$('pfWatch').onclick = async () => { await toggleWatch(profName); openProfile(profName); };
$('pfEdit').onclick = () => { $('profDialog').close(); openPlayer(profName); };
document.addEventListener('click', async (e) => {
  if (e.target.id !== 'pfClearThreat') return;
  await post('/api/threat', { name: profName });
  openProfile(profName);
});

// when a player is usually online: weekday x hour grid (one hue), busiest hours, usual zones, groups
function renderSchedule(p) {
  const s = p.schedule;
  const DAYS = [t('Mon'), t('Tue'), t('Wed'), t('Thu'), t('Fri'), t('Sat'), t('Sun')];
  const hh = (h) => `${String(h).padStart(2, '0')}:00`;
  if (!s || !s.total) { $('pfSchedInfo').textContent = ''; $('pfSched').innerHTML = `<div class="empty">${t('Not enough sightings or ranking changes yet.')}</div>`; return; }
  $('pfSchedInfo').textContent = t('from {m} meetings and {r} ranking changes · your time', { m: s.observations.met, r: s.observations.rankChanges });
  const max = Math.max(...s.grid.flat());
  let html = `<div class="hgrid"><b></b>${Array.from({ length: 24 }, (_, h) => `<i>${h % 3 === 0 ? h : ''}</i>`).join('')}`;
  s.grid.forEach((row, d) => { html += `<b>${DAYS[d]}</b>` + row.map((v, h) => `<span class="hit" title="${esc(`${DAYS[d]} ${hh(h)} · ${v}`)}" style="${v ? `background:var(--s1);opacity:${(0.2 + 0.8 * (v / max)).toFixed(2)}` : ''}"></span>`).join(''); });
  const summary = [
    s.hours.length && t('usually {h}', { h: s.hours.map((r) => `${hh(r.from)}–${hh(r.to)}`).join(', ') }),
    s.days.length && t('mostly on {d}', { d: s.days.map((d) => DAYS[d]).join(', ') }),
    s.zones.length && t('mostly in {z}', { z: s.zones.map((z) => z.name).join(', ') }),
  ].filter(Boolean).join(' · ');
  const groups = (p.groups || []).map((g) => `<div style="font-size:13px;margin-top:6px">👥 ${t('Travels with {names}', { names: g.members.filter((m) => m.name.toLowerCase() !== p.name.toLowerCase()).map((m) => `<b class="click notr" data-player="${esc(m.name)}">${esc(m.name)}</b>`).join(', ') })} <span class="muted">(${t('seen together {n}×', { n: g.together })})</span></div>`).join('');
  $('pfSched').innerHTML = `<p style="margin:0 0 8px;font-size:13px">${esc(summary)}</p>${html}</div>${groups}`;
}

// groups that travel together (Encounters tab)
async function loadGroups() {
  const r = await getJSON('/api/groups');
  $('grpInfo').textContent = t('from {n} recorded arrivals', { n: r.arrivals });
  $('groups').innerHTML = r.groups.length ? r.groups.map((g) => `<div class="pm"><span style="font-size:18px">👥</span><span class="who">${g.members.map((m) => `<b class="click notr" data-player="${esc(m.name)}">${esc(m.name)}</b>${m.info?.level ? ` <span class="muted">${m.info.level}</span>` : ''}${m.threat ? ' ⚠' : ''}${m.watched ? ' ★' : ''}`).join(', ')}
      <small>${t('seen together {n}×', { n: g.together })} · ${t('last {d}', { d: dateTime(g.last) })}${g.zones.length ? ` · ${esc(g.zones.join(', '))}` : ''}</small></span></div>`).join('')
    : `<div class="empty">${t('No groups yet. While you play, the tracker notes who arrives near you together; players who keep showing up together appear here, and you get an alert when such a group arrives.')}</div>`;
}

// ---------------------------------------------------------------- weekly report
let repWeek = null; // 'YYYY-MM-DD' (a week's Monday) or 'm:YYYY-MM' (a month)
async function loadReport() {
  const qs = repWeek?.startsWith('m:') ? `?month=${repWeek.slice(2)}` : repWeek ? `?week=${repWeek}` : '';
  const r = await getJSON(`/api/report${qs}`);
  repWeek = r.month ? `m:${r.month}` : r.week;
  $('repSave').href = `/api/report.html${r.month ? `?month=${r.month}` : `?week=${r.week}`}`;
  $('repWeek').innerHTML = `<optgroup label="${esc(t('Weeks'))}">${r.weeks.map((w, i) => `<option value="${w}" ${w === r.week ? 'selected' : ''}>${i === 0 ? t('This week') : i === 1 ? t('Last week') : t('Week of {date}', { date: '' }).trim()} · ${new Date(w + 'T12:00:00').toLocaleDateString([], { day: 'numeric', month: 'short' })}</option>`).join('')}</optgroup>`
    + `<optgroup label="${esc(t('Months'))}">${(r.months || []).map((m, i) => `<option value="m:${m}" ${m === r.month ? 'selected' : ''}>${i === 0 ? `${t('This month')} · ` : ''}${new Date(m + '-15T12:00:00').toLocaleDateString([], { month: 'long', year: 'numeric' })}</option>`).join('')}</optgroup>`;
  // deaths, luck and your best monsters
  const dz = r.deaths || { count: 0, killers: [], zones: [] };
  $('rpDeathInfo').textContent = dz.count ? t('{n} deaths', { n: dz.count }) + (dz.toPlayers ? ` · ${t('{n} to players', { n: dz.toPlayers })}` : '') : '';
  $('rpDeaths').innerHTML = [...dz.killers.map(([k, n]) => `<tr><td class="notr">${esc(k)}</td><td class="num">${n}×</td></tr>`), ...dz.zones.slice(0, 3).map(([k, n]) => `<tr><td class="muted">${esc(k)}</td><td class="num muted">${n}×</td></tr>`)].join('')
    || `<tr><td class="empty">${dz.count ? t('The game did not name the killers.') : t('No deaths.')}</td></tr>`;
  const luck = (label, x) => (x?.n ? `<tr><td>${esc(t(label))}</td><td class="num">${x.ok} / ${x.n}</td><td class="num"><b>${Math.round((x.ok / x.n) * 100)}%</b></td></tr>` : '');
  $('rpLuck').innerHTML = (luck('Enchanting', r.craft?.enchant) + luck('Combining', r.craft?.combine) + luck('Enhancing', r.craft?.enhance)) || `<tr><td class="empty">${t('Nothing tried.')}</td></tr>`;
  $('rpMobs').innerHTML = (r.mobs || []).map((m) => `<tr><td class="notr">${esc(m.name)}</td><td class="num">${num(m.expPerHour)}<span class="muted"> /h</span></td><td class="num muted">${m.secPerKill != null ? `${m.secPerKill} s` : ''}</td></tr>`).join('') || `<tr><td class="empty">${t('No monster stats yet.')}</td></tr>`;
  $('repRange').textContent = `${dateOnly(r.weekStart)} – ${dateOnly(r.weekEnd - 1)}`;
  const tracked = r.activeMs + r.afkMs;
  $('rpPlay').textContent = dur(r.playMs);
  $('rpPlaySub').textContent = Object.keys(r.accounts).length ? Object.entries(r.accounts).sort((a, b) => b[1] - a[1]).map(([a, ms]) => `${a} ${dur(ms)}`).join(' · ') : 'no play';
  $('rpSess').textContent = r.sessions;
  $('rpActive').textContent = tracked ? t('{p}% active', { p: Math.round((r.activeMs / tracked) * 100) }) : t('active time not measured');
  $('rpMet').textContent = r.playersMet;
  $('rpNew').textContent = r.month ? t('{n} new this month', { n: r.newPlayers }) : t('{n} new this week', { n: r.newPlayers });
  $('rpDanger').textContent = r.dangerAlerts;
  $('rpWatched').textContent = r.watchedMet.length ? t('watched met: {names}', { names: r.watchedMet.slice(0, 3).join(', ') }) : t('no watched players met');
  $('rpDist').textContent = num(r.distance);
  $('rpExp').textContent = r.screen ? `+${num(r.screen.exp, 1)}%` : '—';
  $('rpKills').textContent = r.screen ? [t('{n} kills', { n: num(r.screen.kills) }), t('{n} deaths', { n: r.screen.deaths }), r.screen.levels && t('{n} level-ups', { n: r.screen.levels })].filter(Boolean).join(' · ') : t('needs the screen reader');
  // you this week: potions, enhancing, maze runs, Honor
  const my = r.mine || {}, kpi = (label, v, sub = '') => `<div class="kpi"><label>${esc(label)}</label><div class="v">${v}</div><div class="sub">${sub || '&nbsp;'}</div></div>`;
  const any = my.hpPots || my.mpPots || my.enhOk || my.enhFail || my.mazeRuns || my.honorGained || my.goldChange || my.questsDone || my.netWorthChange || my.gearScoreChange || my.deathExp || my.expMob || my.expQuest;
  const signedGold = (v) => (v != null ? `${v >= 0 ? '+' : '−'}${gold(Math.abs(v))}` : '—');
  $('rpMinePanel').hidden = !any;
  if (any) $('rpMine').innerHTML = [
    kpi(t('Potions'), num((my.hpPots || 0) + (my.mpPots || 0)), [`${num(my.hpPots || 0)} HP · ${num(my.mpPots || 0)} MP`, my.potionCost ? `~${gold(my.potionCost)}` : ''].filter(Boolean).join(' · ')),
    kpi(t('Enhancing'), `${my.enhOk || 0} / ${(my.enhOk || 0) + (my.enhFail || 0)}`, t('worked / tries')),
    kpi(t('Maze runs'), my.mazeRuns || 0, my.mazeRuns ? t('EXP +{e}% in {d}', { e: num(my.mazeExp, 1), d: dur(my.mazeMin * 60000) }) : ''),
    kpi(t('Honor'), my.honorGained != null ? `${my.honorGained >= 0 ? '+' : ''}${num(my.honorGained)}` : '—', t('from the rankings')),
    kpi(t('Gold'), my.goldChange != null ? `${my.goldChange >= 0 ? '+' : '−'}${gold(Math.abs(my.goldChange))}` : '—', t('from the inventory')),
    kpi(t('Net worth'), signedGold(my.netWorthChange), t('gold + gear at chat prices')),
    kpi(t('Gear score'), my.gearScoreChange != null ? `${my.gearScoreChange >= 0 ? '+' : ''}${num(my.gearScoreChange)}` : '—'),
    kpi(t('Quests'), num(my.questsDone || 0), my.expMob + my.expQuest > 0 ? t('{p}% of EXP from quests', { p: Math.round((my.expQuest / (my.expMob + my.expQuest)) * 100) }) : t('handed in')),
    kpi(t('Deaths cost'), my.deathExp ? `${num(my.deathExp, 2)}%` : '—', t('of a level in EXP')),
  ].join('');
  barChart($('rpDays'), { bars: r.days.map((d) => ({ v: d.ms / 3600000, label: new Date(d.day + 'T12:00:00').toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' }), short: new Date(d.day + 'T12:00:00').toLocaleDateString([], r.month ? { day: 'numeric' } : { weekday: 'short' }) })), yFmt: (v) => `${num(v, v < 10 ? 1 : 0)}h` });
  const zt = r.zones.reduce((a, z) => a + z.ms, 0) || 1;
  const zc = (i) => (i < 4 ? SERIES[i] : 'var(--muted)');
  $('rpZoneBar').innerHTML = r.zones.map((z, i) => `<span title="${esc(z.name)}" style="flex:${z.ms / zt};background:${zc(i)}"></span>`).join('');
  $('rpZones').innerHTML = r.zones.map((z, i) => `<tr><td><span class="swatch" style="background:${zc(i)}"></span>${esc(z.name)}</td><td class="num">${dur(z.ms)}</td><td class="num muted">${Math.round((z.ms / zt) * 100)}%</td></tr>`).join('') || '<tr><td class="empty">No tracked sessions this week.</td></tr>';
  $('rpPlayers').innerHTML = r.topPlayers.map((m) => `<tr class="click" data-player="${esc(m.name)}"><td>${esc(m.name)}${m.threat ? flag : ''}${m.watched ? ' <span style="color:var(--gold)">★</span>' : ''}</td><td>${facBadge(m.info?.faction)}</td><td class="num">${m.sessions}</td><td class="num">${m.nearMs ? dur(m.nearMs) : '—'}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nobody.</td></tr>';
  $('rpRecaps').innerHTML = r.recaps.length ? r.recaps.map((x) => `<div class="recap"><span class="muted">${dateTime(x.at)} · ${esc(x.character || '?')}</span><br>${esc(x.recap)}</div>`).join('') : '<div class="empty">No session recaps this week (they start from today).</div>';
  const rk = r.rankings, none = (s) => `<tr><td class="empty">${rk.snapshots > 1 ? s : 'Not enough ranking history for this week.'}</td></tr>`;
  $('rpFast').innerHTML = rk.fastest.map((m) => `<tr><td>${esc(m.name)}</td><td class="num">${m.level}</td><td class="num"><span class="tag up">+${m.levelGain}</span></td></tr>`).join('') || none('No level changes.');
  $('rpHonor').innerHTML = rk.honor.map((m) => `<tr><td>${esc(m.name)}</td><td class="num"><span class="tag up">+${num(m.honorGain)}</span></td></tr>`).join('') || none('No honor changes.');
  $('rpClimb').innerHTML = rk.climbers.map((m) => `<tr><td>${esc(m.name)}</td><td class="num">#${m.rankNow}</td><td class="num">${m.rankDelta == null ? '<span class="tag up">new</span>' : m.rankDelta > 0 ? `<span class="tag up">▲ ${m.rankDelta}</span>` : `<span class="tag down">▼ ${-m.rankDelta}</span>`}</td></tr>`).join('') || none('No rank changes.');
  $('rpMovers').innerHTML = (r.movers || []).map((m) => `<tr><td><b class="click notr" data-item="${m.itemId}">${esc(m.item)}</b></td><td class="num">${gold(m.before)}</td><td class="num">${gold(m.now)}</td>
    <td class="num"><span class="tag ${m.change > 0 ? 'up' : 'down'}">${m.change > 0 ? '▲' : '▼'} ${Math.abs(m.change)}%</span></td><td class="num muted">${m.offers}</td></tr>`).join('')
    || `<tr><td colspan="5" class="empty">${t('Needs at least 3 offers for an item in both weeks (screen reader, chat).')}</td></tr>`;
  const fs0 = rk.factionsStart, fs1 = rk.factionsEnd;
  $('rpFac').textContent = fs1 ? t('top lists: Order {o}, Chaos {c}', { o: fs1.order, c: fs1.chaos }) + (fs0 && fs0 !== fs1 ? ` (${t('was {o} / {c}', { o: fs0.order, c: fs0.chaos })})` : '') : '';
}
$('repWeek').addEventListener('change', () => { repWeek = $('repWeek').value; loadReport(); });

// ---------------------------------------------------------------- labels & player dialog
let zoneNamesLoaded = false, renamingZone = null;
async function renameZone(id, current) {
  if (!zoneNamesLoaded) {
    const names = await getJSON('/api/zone-names');
    $('zoneNameList').innerHTML = names.map((n) => `<option value="${esc(n)}">`).join('');
    zoneNamesLoaded = true;
  }
  renamingZone = id;
  $('zdTitle').textContent = t('Name zone {id}', { id });
  $('zForm').elements.name.value = current.startsWith('Zone ') ? '' : current;
  $('zDialog').showModal();
}
$('zDialog').addEventListener('close', async () => {
  if ($('zDialog').returnValue !== 'save' || renamingZone == null) return;
  const name = $('zForm').elements.name.value.trim();
  await post('/api/label', { kind: 'zones', id: renamingZone, name });
  S.labels.zones ||= {};
  if (name) S.labels.zones[renamingZone] = name; else delete S.labels.zones[renamingZone];
  render();
  if (tab === 'sessions') loadSessions();
  if (tab === 'heatmap') loadHeatmap();
});

async function rename(kind, id, current) {
  if (kind === 'zones') return renameZone(id, current);
  const name = prompt(t('Name for effect {id} (leave empty to clear):', { id }), current.startsWith('Zone ') || current.startsWith('Effect #') ? '' : current);
  if (name === null) return;
  await post('/api/label', { kind, id, name });
  S.labels[kind] ||= {};
  if (name.trim()) S.labels[kind][id] = name.trim(); else delete S.labels[kind][id];
  render();
}

const pForm = $('pForm');
pForm.elements.cls.innerHTML += CLASSES.map((c) => `<option>${c}</option>`).join('');
let editing = null;

async function openPlayer(name) {
  editing = name;
  const notes = await getJSON('/api/player-notes');
  const n = notes[name.toLowerCase()] || {};
  const ranked = S.rankings.players.find((p) => p.name.toLowerCase() === name.toLowerCase());
  const enc = encCache.find((e) => e.name.toLowerCase() === name.toLowerCase());
  $('pdName').textContent = name;
  $('pdSrc').innerHTML = (ranked
    ? t('Ranked: {info}. Your notes override these fields.', { info: `Lv ${ranked.level ?? '?'} ${esc(ranked.cls)}, ${esc(t(ranked.faction))}, ${esc(ranked.house || t('no house'))} (${ranked.ranks.map((r) => `#${r.rank} ${t(r.board)}`).join(', ')})` })
    : t('Not in the public rankings. Fill in what you see in-game.'))
    + (enc ? `<br>${t('Met in {n} session(s)', { n: enc.sessions })}${enc.nearMs ? `, ${t('{d} near you', { d: dur(enc.nearMs) })}` : ''}.` : '');
  for (const f of ['level', 'cls', 'faction', 'house', 'note']) pForm.elements[f].value = n[f] ?? '';
  pForm.elements.level.placeholder = ranked?.level ?? '';
  pForm.elements.house.placeholder = ranked?.house ?? '';
  $('pdWatch').textContent = isWatched(name) ? '★ Watching' : '☆ Watch';
  $('pdTrader').innerHTML = '';
  $('pDialog').showModal();
  loadTrader(name);
}
// what this player buys and sells in the chat (from the screen reader's chat log)
async function loadTrader(name) {
  const p = await getJSON(`/api/trader?name=${encodeURIComponent(name)}`);
  if (editing !== name || (!p.offers && !p.messages)) return;
  $('pdTrader').innerHTML = `<h4>${t('In the chat')} <small class="muted">${t('{o} trade offers · {m} messages · last {d}', { o: p.offers, m: p.messages, d: dateTime(p.last) })}</small></h4>
    ${p.items.length ? `<table><tbody>${p.items.slice(0, 10).map((x) => `<tr><td><span class="tag">${x.side === 'sell' ? t('selling') : t('buying')}</span></td><td class="notr">${x.itemId ? `<b>${esc(x.item)}</b>` : `<span class="muted">${esc(x.raw)}</span>`}</td><td class="num">${x.price ? gold(x.price) : '—'}</td><td class="num muted">${x.count}×</td></tr>`).join('')}</tbody></table>` : ''}
    ${p.recent.length ? `<div class="muted notr" style="font-size:12px;margin-top:6px">${p.recent.slice(0, 4).map((e) => `${clock(e.t)} ${esc(e.text)}`).join('<br>')}</div>` : ''}`;
}
async function savePlayer(data) {
  await post('/api/player', { name: editing, ...data });
}
$('pDialog').addEventListener('close', async () => {
  if ($('pDialog').returnValue !== 'save' || !editing) return;
  await savePlayer(Object.fromEntries(['level', 'cls', 'faction', 'house', 'note'].map((f) => [f, pForm.elements[f].value])));
  if (tab === 'encounters') loadEncounters();
});
$('pdClear').addEventListener('click', async () => { await savePlayer({}); $('pDialog').close('cleared'); });
$('pdWatch').addEventListener('click', async () => { await toggleWatch(editing); $('pdWatch').textContent = isWatched(editing) ? '★ Watching' : '☆ Watch'; });

document.addEventListener('click', (e) => {
  const w = e.target.closest('[data-watch]');
  if (w) { e.stopPropagation(); toggleWatch(w.dataset.watch); return; }
  const u = e.target.closest('[data-unwatch]');
  if (u) { toggleWatch(u.dataset.unwatch); return; }
  const lbl = e.target.closest('[data-label-kind]');
  if (lbl) { rename(lbl.dataset.labelKind, lbl.dataset.labelId, lbl.textContent); return; }
  const rp = e.target.closest('[data-rank-player]');
  if (rp) { openRankPlayer(rp.dataset.rankPlayer); return; }
  const pl = e.target.closest('[data-player]');
  if (pl) { openProfile(pl.dataset.player); return; }
  const se = e.target.closest('[data-session]');
  if (se) { openSession(se.dataset.session); return; }
  if (e.target.id === 'selfLvl' && S?.session.character) openPlayer(S.session.character);
});
for (const id of ['pFilter', 'pFaction', 'pSearch']) $(id).addEventListener('input', () => S && renderLive());
for (const id of ['rBoard', 'rFaction']) $(id).addEventListener('input', () => S && renderBoards());
