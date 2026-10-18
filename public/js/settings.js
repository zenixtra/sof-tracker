// SoF Tracker dashboard: settings. Loaded as a classic script; all dashboard scripts share one global scope (see index.html).

// ---------------------------------------------------------------- settings tab
const setForm = $('setForm');
const SET_FIELDS = ['goalHours', 'limitHours', 'remindEveryHours', 'breakMinutes', 'breakPauseMinutes', 'afkMinutes', 'dangerCount', 'dangerWindowSec', 'myFaction', 'dangerUnknown'];
// ---- self-check: one row per reader, grouped by area, problems highlighted
function renderSelfCheck(r) {
  if (!r) { $('scInfo').textContent = t('Not run yet.'); $('scList').innerHTML = ''; return; }
  $('scInfo').textContent = `${r.fails ? t('{n} problems', { n: r.fails }) : t('All working')}${r.warns ? ` · ${t('{n} warnings', { n: r.warns })}` : ''} · ${dateTime(r.at)}`;
  let area = '';
  $('scList').innerHTML = r.checks.map((c) => {
    const head = c.area !== area ? `<div class="sc-area">${esc(t(c.area))}</div>` : '';
    area = c.area;
    return `${head}<div class="sc-row ${c.level}"><span class="ic">${c.level === 'ok' ? '✓' : c.level === 'warn' ? '!' : '✗'}</span><span>${esc(t(c.label))}</span><span class="d muted notr" style="font-size:12px">${esc(c.detail)}</span></div>`;
  }).join('');
}
$('btnSelfCheck').onclick = async () => {
  $('btnSelfCheck').disabled = true; $('scInfo').textContent = t('Checking…');
  try { renderSelfCheck(await post('/api/selfcheck/run', {}).then((x) => x.json())); } finally { $('btnSelfCheck').disabled = false; }
};

// ---- reader check: when each part of the screen reading last worked, and teaching it the pickup message
async function loadReaderCheck() {
  const r = await getJSON('/api/reader-check').catch(() => null);
  if (!r) return;
  const ok = r.checks.filter((c) => c.status === 'ok').length;
  $('rcInfo').textContent = !r.on ? t('The screen reader is off (Screen reader above).') : t('{n} of {m} seen working in the last 3 days', { n: ok, m: r.checks.length });
  $('rcList').innerHTML = r.checks.map((c) => `<div class="sc-row ${c.status === 'ok' ? 'ok' : c.status === 'old' ? 'warn' : 'never'}"><span class="ic">${c.status === 'ok' ? '✓' : c.status === 'old' ? '!' : '○'}</span><span>${esc(t(c.label))}</span>
    <span class="d muted" style="font-size:12px">${c.at ? t('last worked {when}', { when: dateTime(c.at) }) : esc(t(c.tip))}${c.status === 'old' ? ` · ${esc(t(c.tip))}` : ''}</span></div>`).join('');
  // lines that may be what the game says when you pick something up: mark the item's part and teach it
  $('plList').innerHTML = (r.patterns.length ? `<div style="font-size:12px;margin-bottom:6px">${t('Taught')}: ${r.patterns.map((p) => `<span class="tag notr" title="${esc(p.re)}">${esc(p.example)} <button class="small" data-pl-forget="${esc(p.re)}">×</button></span>`).join(' ')}</div>` : '')
    + (r.candidates.length ? r.candidates.map((c, i) => `<div class="plrow"><span class="notr mono" style="font-size:12px">${esc(c.line)}</span>
      <label style="font-size:12px">${t('item')} <input data-pl-item="${i}" value="${esc(c.itemText || '')}" size="22" placeholder="${esc(t('copy the item name from the line'))}"></label>
      <button class="small primary" data-pl-learn="${i}">${t('This is a pickup')}</button> <button class="small" data-pl-no="${i}">${t('Not a pickup')}</button></div>`).join('')
      : `<div class="muted" style="font-size:12px">${r.patterns.length ? '' : t('Nothing to look at yet. While you farm quest items with the screen reader on, lines from the message box and the chat that mention your quest items (or words like "obtained") show up here.')}</div>`);
  $('plList').dataset.lines = JSON.stringify(r.candidates.map((c) => c.line));
  loadDebug();
}
// setup check: what works on this PC, with what to do about the rest
async function loadSetupCheck() {
  const r = await getJSON('/api/setup-check').catch(() => null);
  if (!r) return null;
  $('suInfo').textContent = r.problems ? t('{n} things to fix', { n: r.problems }) : r.warnings ? t('Working · {n} optional things', { n: r.warnings }) : t('All set up');
  $('suList').innerHTML = r.rows.map((x) => `<div class="sc-row ${x.status}"><span class="ic">${x.status === 'ok' ? '✓' : x.status === 'warn' ? '!' : '✗'}</span><span>${esc(t(x.label))}</span>
    <span class="d" style="font-size:12px"><span class="muted notr">${esc(t(x.detail))}</span>${x.status !== 'ok' && x.fix ? `<br>${esc(t(x.fix))}` : ''}</span></div>`).join('');
  return r;
}
// first run: a banner on the dashboard while something needs fixing (until dismissed)
async function setupBanner() {
  if (store.get('setupDismissed', false)) return;
  const r = await getJSON('/api/setup-check').catch(() => null);
  if (!r || !r.problems) return;
  const el = document.createElement('div');
  el.className = 'setupbanner';
  el.innerHTML = `<span>⚙ ${esc(t('Setup check: {n} things to fix on this PC', { n: r.problems }))}</span> <button class="small primary" data-setup-open>${t('Show me')}</button> <button class="small" data-setup-hide>${t('Hide')}</button>`;
  document.body.prepend(el);
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-setup-open]')) { showTab('settings'); setTimeout(() => $('setupPanel').scrollIntoView({ block: 'start' }), 100); el.remove(); }
    if (e.target.closest('[data-setup-hide]')) { store.set('setupDismissed', true); el.remove(); }
  });
}
setTimeout(setupBanner, 8000); // after the tray had time to say hello
// features you can switch off, and alert noise (muted types, a daily cap, quiet farming)
async function loadFeatures() {
  const r = await getJSON('/api/features').catch(() => null);
  if (!r) return;
  $('featList').innerHTML = r.features.map((f) => `<label class="wchk"><input type="checkbox" data-feat="${f.id}" ${f.on ? 'checked' : ''}> ${esc(t(f.label))}</label>`).join('');
  $('anQuiet').checked = r.quietFarming;
  $('anCap').value = String(r.alertCap);
  $('anMute').innerHTML = Object.entries(KIND_NAMES).map(([k, label]) => `<label class="wchk"><input type="checkbox" data-mute="${k}" ${r.alertMute[k] ? 'checked' : ''}> ${t('Mute: {x}', { x: t(label) })}</label>`).join('');
}
$('featList').addEventListener('change', () => saveSettings({ features: Object.fromEntries([...document.querySelectorAll('[data-feat]')].map((c) => [c.dataset.feat, c.checked])) }));
const saveNoise = () => saveSettings({ quietFarming: $('anQuiet').checked, alertCap: +$('anCap').value, alertMute: Object.fromEntries([...document.querySelectorAll('[data-mute]')].filter((c) => c.checked).map((c) => [c.dataset.mute, true])) });
for (const id of ['anQuiet', 'anCap', 'anMute']) $(id).addEventListener('change', saveNoise);
// debug captures: what a reader saw when it got stuck (click a picture to open it)
const DEBUG_KINDS = { quest: 'Quest window', tooltip: 'Item tooltip', inventory: 'Inventory gold', pickup: 'Pickup message', status: 'Status window' };
async function loadDebug() {
  const r = await getJSON('/api/debug').catch(() => null);
  if (!r) return;
  $('dbgOn').checked = r.on;
  $('dbgList').innerHTML = r.captures.length ? r.captures.slice(0, 24).map((c) => `<a class="dbgcap" href="/api/debug-shot/${encodeURIComponent(c.name)}.jpg" target="_blank" rel="noopener">
      ${c.shot ? `<img src="/api/debug-shot/${encodeURIComponent(c.name)}.jpg" alt="" loading="lazy">` : ''}<span>${esc(t(DEBUG_KINDS[c.kind] || c.kind))}<small class="muted">${dateTime(c.t)}</small></span></a>`).join('')
    : `<div class="muted" style="font-size:12px">${t('No captures: nothing got stuck yet.')}</div>`;
}
$('dbgOn').addEventListener('change', () => saveSettings({ debugCapture: $('dbgOn').checked }));
$('dbgClear').onclick = async () => { await post('/api/debug', { action: 'clear' }); loadDebug(); };
$('plList').addEventListener('click', async (e) => {
  const lines = JSON.parse($('plList').dataset.lines || '[]');
  const learn = e.target.closest('[data-pl-learn]'), no = e.target.closest('[data-pl-no]'), forget = e.target.closest('[data-pl-forget]');
  if (learn) {
    const i = +learn.dataset.plLearn, r = await post('/api/pickup-learn', { line: lines[i], itemText: $('plList').querySelector(`[data-pl-item="${i}"]`).value.trim() });
    toast(r.ok ? { kind: 'buff', title: t('Pickup message learned') } : { kind: 'danger', title: t('Copy the item name exactly as it is in the line') });
  } else if (no) await post('/api/pickup-learn', { action: 'dismiss', line: lines[+no.dataset.plNo] });
  else if (forget) await post('/api/pickup-learn', { action: 'forget', re: forget.dataset.plForget });
  else return;
  loadReaderCheck();
});

async function loadSettings() {
  getJSON('/api/selfcheck').then(renderSelfCheck);
  loadReaderCheck();
  loadFeatures();
  loadSetupCheck();
  loadScreenSettings();
  loadBot();
  const st = await getJSON('/api/settings');
  for (const f of SET_FIELDS) if (document.activeElement !== setForm.elements[f]) setForm.elements[f].value = String(st[f]);
  for (const el of document.querySelectorAll('[data-set]')) if (document.activeElement !== el) el.value = st[el.dataset.set] ?? '';
  const auto = S?.danger?.myFaction && !st.myFaction ? S.danger.myFaction : null;
  $('setFacHint').textContent = st.myFaction ? t('Used to tell enemies from allies.') : auto ? t('Detected from your character: {f}.', { f: auto }) : t('Not known yet: pick it here, or set it on your character (click Level / Class at the top).');
  $('setAutostart').checked = st.autostart;
  $('setAutoOverlay').checked = st.autoOverlay;
  $('setToday').textContent = S ? t('{d} played today', { d: dur(S.today.ms) }) : '';
  $('backupList').innerHTML = st.backups.length ? st.backups.map((b) => `<tr><td class="mono" style="font-size:12px">${esc(b.name)}</td><td class="num">${num(b.size / 1024)} KB</td><td class="muted">${dateTime(b.at)}</td></tr>`).join('') : `<tr><td colspan="3" class="empty">${t('No backups yet.')}</td></tr>`;
  const bs = st.backupState || {};
  $('bkState').textContent = !st.backupDir ? t('Leave empty to switch off. A backup is made once a day.') : bs.error ? t('Last attempt failed: {e}', { e: bs.error }) : bs.lastFile ? t('Last backup: {f} ({when})', { f: bs.lastFile, when: dateTime(bs.lastAt) }) : t('First backup is made within a minute.');
  // language & voice (voice is per device)
  $('setLang').innerHTML = Object.entries(LANGS).map(([k, v]) => `<option value="${k}" ${k === getLang() ? 'selected' : ''}>${esc(v.name)}</option>`).join('');
  $('setVoice').value = store.get('voice', 'off');
  loadNotify();
  loadFriends();
  loadCleanup();
}
async function saveSettings(extra = {}) {
  const body = { ...Object.fromEntries(SET_FIELDS.map((f) => [f, setForm.elements[f].value])), autoOverlay: $('setAutoOverlay').checked };
  for (const el of document.querySelectorAll('[data-set]')) body[el.dataset.set] = el.value;
  Object.assign(body, extra);
  body.dangerUnknown = body.dangerUnknown === 'true' || body.dangerUnknown === true;
  if (body.shareLive !== undefined) body.shareLive = body.shareLive === 'true' || body.shareLive === true;
  if (body.shareMarket !== undefined) body.shareMarket = body.shareMarket === 'true' || body.shareMarket === true;
  if (body.shareEnhance !== undefined) body.shareEnhance = body.shareEnhance === 'true' || body.shareEnhance === true;
  const r = await post('/api/settings', body);
  if (!r.ok) { toast({ kind: 'timer', title: t('Could not save settings'), body: await r.text() }); return false; }
  S.settings = await r.json();
  $('setSaved').textContent = t('Saved'); setTimeout(() => { $('setSaved').textContent = ''; }, 2000);
  loadSettings();
  return true;
}
// a copy in the shared friends folder: <folder>\SoF backups\<your name>, 7 days (the note says who can read it)
$('btnBackupSync').onclick = async () => {
  const st = await getJSON('/api/settings');
  if (!st.syncDir) { toast({ kind: 'timer', title: t('Set up the shared friends folder first (Friends sync).') }); return; }
  $('bkSyncNote').hidden = false;
  if (!confirm(t('Friends who share that folder can open the backup (chat log, whispers, notes). Use it anyway?'))) return;
  const sep = st.syncDir.includes('/') && !st.syncDir.includes('\\') ? '/' : '\\';
  document.querySelector('[data-set="backupDir"]').value = `${st.syncDir.replace(/[\\/]+$/, '')}${sep}SoF backups${sep}${(st.syncName || 'me').replace(/[^\w .-]/g, '')}`;
  document.querySelector('[data-set="backupKeep"]').value = '7';
  if (await saveSettings()) toast({ kind: 'buff', title: t('Backups now go to the friends folder') });
};
$('btnSaveBackup').onclick = async () => { if (await saveSettings()) toast({ kind: 'buff', title: t('Backup settings saved') }); };
$('btnSaveSync').onclick = async () => { if (await saveSettings()) toast({ kind: 'buff', title: t('Friends sync saved') }); };
$('setLang').addEventListener('change', () => setLang($('setLang').value));
$('setVoice').addEventListener('change', () => {
  store.set('voice', $('setVoice').value);
  // the overlay window keeps its own storage, so it reads the voice choice from the tracker
  fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ voice: $('setVoice').value }) }).catch(() => {});
});
$('btnVoiceTest').onclick = () => speak(t('{n} enemies just arrived', { n: 3 }));

async function loadFriends() {
  const f = await getJSON('/api/friends');
  $('frState').textContent = !f.syncDir ? t('off') : f.error ? t('error: {e}', { e: f.error }) : f.lastSync ? t('synced {when}', { when: clock(f.lastSync) }) : '';
  $('frList').innerHTML = f.list.length ? `<table><thead><tr><th>${t('Friend')}</th><th class="num">${t('Watching')}</th><th class="num">${t('Flags')}</th><th class="num">${t('Notes')}</th><th class="num">${t('Markers')}</th><th>${t('Updated')}</th></tr></thead><tbody>${f.list.map((x) => `<tr><td><b>${esc(x.name)}</b></td><td class="num">${x.watchlist}</td><td class="num">${x.threats}</td><td class="num">${x.notes}</td><td class="num">${x.waypoints}</td><td class="muted">${dateTime(x.updatedAt)}</td></tr>`).join('')}</tbody></table>`
    : f.syncDir ? `<div class="empty">${t('No friends in the shared folder yet. Their tracker needs the same folder and its own name.')}</div>` : '';
}

async function loadNotify() {
  const r = await fetch('/api/notify');
  if (!r.ok) { $('ntForm').innerHTML = `<div class="empty">${t('Only available on the PC running the tracker.')}</div>`; return; }
  const c = await r.json();
  for (const el of document.querySelectorAll('[data-nt]')) if (document.activeElement !== el) el.value = String(c[el.dataset.nt] ?? '');
  $('ntKinds').innerHTML = c.kindsAll.map((k) => `<label><input type="checkbox" value="${k}" ${c.kinds.includes(k) ? 'checked' : ''}> ${esc(t(KIND_NAMES[k] || k))}</label>`).join('');
  $('ntState').textContent = c.enabled ? (c.lastError ? t('last send failed') : t('on')) : t('off');
  $('ntMsg').textContent = c.lastError || '';
  // quiet hours (a tracker setting, saved as soon as it changes)
  const st = await getJSON('/api/settings');
  for (const id of ['qtFrom', 'qtTo']) {
    if ($(id).options.length < 2) for (let h = 0; h < 24; h++) $(id).add(new Option(`${String(h).padStart(2, '0')}:00`, String(h)));
    $(id).value = String(st[id === 'qtFrom' ? 'quietFrom' : 'quietTo'] ?? -1);
  }
}
for (const [id, key] of [['qtFrom', 'quietFrom'], ['qtTo', 'quietTo']]) $(id).addEventListener('change', () => saveSettings({ [key]: +$(id).value }));
var KIND_NAMES = { update: 'Tracker updates', danger: 'Danger', watch: 'Watched players', disconnect: 'Disconnects', maintenance: 'Maintenance', timer: 'Boss & event timers', boss: 'Boss predictions', event: 'Events', goal: 'Play-time goals', recap: 'Session recaps', report: 'Weekly reports', milestone: 'Milestones', buff: 'Buff reminders', marker: 'Markers', patch: 'Game updates', checklist: 'Checklist', whisper: 'Whispers & chat', stuck: 'EXP stopped', party: 'Party HP', price: 'Price watches', chat: 'Chat words', digest: 'Daily digest' };
// ---- sounds per alert type (public/sounds.js plays them; the choice is in the tracker's settings)
let sndFiles = [], sndCfg = null;
async function loadSounds() {
  const [f, st] = await Promise.all([getJSON('/api/sounds').catch(() => ({ files: [] })), getJSON('/api/settings').catch(() => null)]);
  sndFiles = f.files; sndCfg = st?.sounds || {};
  const opts = (cur) => [['default', t('Usual beep')], ...Object.entries(SofSounds.TONES).map(([k, v]) => [k, t(v.label)]), ...sndFiles.map((x) => [`file:${x.name}`, `♪ ${x.name}`]), ['off', t('No sound')]]
    .map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('');
  $('sndRows').innerHTML = Object.entries(KIND_NAMES).map(([k, label]) => { const c = sndCfg[k] || { s: 'default', v: 70 };
    return `<tr><td>${esc(t(label))}</td><td><select data-snd="${k}">${opts(c.s)}</select></td><td><input type="range" min="0" max="100" step="5" value="${c.v ?? 70}" data-sndv="${k}" title="${esc(t('Volume'))}" style="width:80px"></td><td><button class="small" data-sndtry="${k}" title="${esc(t('Play'))}">▶</button></td></tr>`; }).join('');
  $('sndFiles').innerHTML = sndFiles.map((x) => `<span class="tag notr">♪ ${esc(x.name)} <button class="small" data-snddel="${esc(x.name)}" title="${esc(t('Delete'))}">×</button></span>`).join(' ');
}
const saveSounds = () => {
  const sounds = {};
  for (const sel of document.querySelectorAll('[data-snd]')) if (sel.value !== 'default') sounds[sel.dataset.snd] = { s: sel.value, v: +document.querySelector(`[data-sndv="${sel.dataset.snd}"]`).value };
  sndCfg = sounds;
  return post('/api/settings', { sounds });
};
$('sndRows').addEventListener('change', saveSounds);
$('sndRows').addEventListener('click', (e) => {
  const b = e.target.closest('[data-sndtry]'); if (!b) return;
  const k = b.dataset.sndtry, s = document.querySelector(`[data-snd="${k}"]`).value, v = +document.querySelector(`[data-sndv="${k}"]`).value;
  if (s === 'default') { const keep = S?.settings?.sounds; if (S?.settings) S.settings.sounds = {}; beep(k); if (S?.settings) S.settings.sounds = keep; } else SofSounds.preview(s, v);
});
$('sndFile').addEventListener('change', async () => {
  const f = $('sndFile').files[0]; $('sndFile').value = '';
  if (!f) return;
  if (f.size > 3 * 1048576) return toast({ kind: 'timer', title: t('The file is over 3 MB') });
  const r = await fetch(`/api/sounds?name=${encodeURIComponent(f.name)}`, { method: 'POST', body: f });
  if (!r.ok) return toast({ kind: 'timer', title: await r.text() });
  toast({ kind: 'buff', title: t('Sound added: pick it for an alert type above') });
  loadSounds();
});
$('sndFiles').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-snddel]'); if (!b) return;
  await post('/api/sounds', { action: 'delete', name: b.dataset.snddel });
  loadSounds();
});
$('nav').addEventListener('click', (e) => { if (e.target.closest('[data-tab="alerts"]')) loadSounds(); });
setTimeout(() => { if (tab === 'alerts') loadSounds(); }, 1500);
$('btnNtSave').onclick = async () => {
  const body = Object.fromEntries([...document.querySelectorAll('[data-nt]')].map((el) => [el.dataset.nt, el.value]));
  body.onlyWhenAway = body.onlyWhenAway === 'true';
  body.kinds = [...$('ntKinds').querySelectorAll('input:checked')].map((i) => i.value);
  const r = await post('/api/notify', body);
  $('ntMsg').textContent = r.ok ? t('Saved') : await r.text();
  if (r.ok) loadNotify();
};
$('btnNtTest').onclick = async () => {
  $('ntMsg').textContent = t('Sending…');
  const r = await post('/api/notify/test', {});
  const res = r.ok ? await r.json() : [];
  $('ntMsg').textContent = res.map((x) => `${x.channel}: ${x.ok ? '✓' : x.error}`).join(' · ') || (await r.text());
};
setForm.addEventListener('submit', (e) => { e.preventDefault(); saveSettings(); });
$('setAutoOverlay').addEventListener('change', () => saveSettings());
$('setAutostart').addEventListener('change', async (e) => {
  const r = await post('/api/autostart', { on: e.target.checked });
  if (!r.ok) toast({ kind: 'timer', title: 'Could not change startup setting', body: await r.text() });
  else toast({ kind: 'buff', title: e.target.checked ? 'Will start with Windows' : 'Removed from Windows startup', body: e.target.checked ? 'From your next login the tracker runs in the system tray.' : '' });
  loadSettings();
});
$('btnOverlayOpen').onclick = () => post('/api/overlay', { open: true });
$('btnOverlayClose').onclick = () => post('/api/overlay', { open: false });
$('btnBackup').addEventListener('click', () => setTimeout(loadSettings, 1500));

// ---------------------------------------------------------------- play button
let launching = 0;
$('btnPlay').addEventListener('click', async () => {
  launching = Date.now();
  $('btnPlay').disabled = true; $('btnPlay').textContent = 'Starting…';
  const r = await fetch('/api/launch', { method: 'POST' }).catch((e) => ({ ok: false, text: async () => e.message }));
  if (!r.ok) {
    launching = 0;
    toast({ kind: 'timer', title: 'Could not start the launcher', body: await r.text() });
    renderHeader();
  } else toast({ kind: 'buff', title: 'Launcher started', body: 'Log in there; the tracker picks the game up automatically.' });
});
// whose Honor, Ascension and week the dashboard shows (header): follow the game, or a character you pick
async function loadCharacters() {
  let r; try { r = await getJSON('/api/characters'); } catch { return; }
  if (document.activeElement === $('charView')) return;
  $('charView').innerHTML = `<option value="">${esc(t('follow the game'))}</option>` + r.list.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}${c.level ? ` · ${c.level}` : ''}${c.inGame ? ' ●' : ''}</option>`).join('');
  $('charView').value = r.picked || '';
  $('charView').hidden = r.list.length < 2;
}
$('charView').addEventListener('change', async () => {
  await saveSettings({ viewCharacter: $('charView').value });
  if (tab === 'stats') loadFarming();
  if (tab === 'report') loadReport();
});
loadCharacters();
setInterval(loadCharacters, 60000);

// a second game client (shown while one is running; two at most; launching2 lives in live.js)
$('btnPlay2').addEventListener('click', async () => {
  launching2 = Date.now();
  $('btnPlay2').disabled = true; $('btnPlay2').textContent = t('Starting…');
  const r = await fetch('/api/launch?second=1', { method: 'POST' }).catch((e) => ({ ok: false, text: async () => e.message }));
  if (!r.ok) {
    launching2 = 0;
    toast({ kind: 'timer', title: t('Could not start the second client'), body: await r.text() });
  } else toast({ kind: 'buff', title: t('Launcher started for a second client'), body: t('Log in there with your other account; the tracker reads both windows.') });
  renderHeader();
});

// ---------------------------------------------------------------- clocks
let tzFmt = null;
function renderClocks() {
  const d = new Date(now());
  const tz = S?.serverTz || 'America/Los_Angeles';
  if (!tzFmt || tzFmt.tz !== tz) {
    tzFmt = {
      tz,
      time: new Intl.DateTimeFormat([], { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }),
      date: new Intl.DateTimeFormat([], { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }),
      zone: new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }),
    };
  }
  const abbr = tzFmt.zone.formatToParts(d).find((p) => p.type === 'timeZoneName')?.value || tz;
  $('srvClockLbl').textContent = `${t('Server time')} · ${abbr}`;
  $('srvClock').textContent = tzFmt.time.format(d);
  $('srvDate').textContent = tzFmt.date.format(d);
  $('myClock').textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  $('myDate').textContent = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}
renderClocks();
setInterval(renderClocks, 500);

// ---------------------------------------------------------------- screen reader (Live cards + Settings)
function renderScreen() {
  const s = S?.screen;
  const on = !!s && S.game.running;
  $('kHpCard').hidden = !on; $('kExpCard').hidden = !on;
  // the selected target, recognised from the name under the minimap
  const tg = on ? s.target : null;
  $('kTargetCard').hidden = !tg;
  if (tg) {
    $('kTarget').textContent = tg.name;
    if (tg.kind === 'player') $('kTarget').dataset.player = tg.name; else delete $('kTarget').dataset.player;
    $('kTarget').classList.toggle('click', tg.kind === 'player');
    $('kTargetSub').textContent = tg.kind === 'player' ? [tg.level && `Lv ${tg.level}`, tg.cls, tg.faction, tg.house, tg.threat && '⚠', tg.watched && '★'].filter(Boolean).join(' · ') || t('player')
      : tg.kind === 'monster' ? `${t('Monster')} · Lv ${tg.level} · HP ${num(tg.hp)}` : tg.kind === 'npc' ? 'NPC' : t('not recognised');
  }
  // effects on you, read from their icons on screen (next to the ones from the game log)
  const fx = on ? s.effects || [] : [];
  const tn = Date.now() + (S.now ? S.now - Date.now() : 0);
  $('effOnScreen').innerHTML = fx.length ? `<div class="muted" style="font-size:11px;margin-top:6px">${t('On you now (screen)')}</div>` + fx.map((e) => `<div class="row fx ${e.kind}"><span>${e.kind === 'debuff' ? '⚠' : '✦'} ${esc(t(e.label))}</span><span class="muted mono">${dur(Math.max(0, tn - e.since))}</span></div>`).join('') : '';
  // players on the minimap: a tiny radar (you in the middle, north up) and where most of them are
  const mm = on ? s.minimap : null;
  $('kMiniCard').hidden = !mm;
  if (mm) {
    $('kMini').textContent = mm.count;
    const mates = mm.party || [];
    $('kMiniSub').textContent = [mm.count ? t('{n} close', { n: mm.near }) : t('nobody around'), mm.count && mm.mostly && t('mostly {dir}', { dir: t(mm.mostly) }), mates.length && t('{n} of your party apart from you', { n: mates.length })].filter(Boolean).join(' · ');
    // other players red, party members gold (a ring, so they stand out from the red dots), you in the middle
    $('kMiniSvg').innerHTML = '<circle r="80" fill="none" stroke="var(--line)"/><circle r="25" fill="none" stroke="var(--line)" stroke-dasharray="3 3"/>'
      + mm.dots.map(([dx, dy]) => `<circle cx="${dx}" cy="${dy}" r="5" fill="var(--crimson)" stroke="var(--panel)" stroke-width="2"/>`).join('')
      + mates.map(([dx, dy]) => `<circle cx="${dx}" cy="${dy}" r="5" fill="var(--panel)" stroke="var(--gold)" stroke-width="3"/>`).join('')
      + '<path d="M0,-8 L6,6 L0,3 L-6,6 Z" fill="var(--gold)"/>';
  }
  // the daily EXP goal
  const g = S?.expGoal;
  $('kGoalCard').hidden = !g;
  if (g) {
    $('kGoal').textContent = `+${num(g.today, 1)}% / ${g.goal}%`;
    $('kGoalBar').firstElementChild.style.width = `${g.pct}%`;
    $('kGoalSub').textContent = [g.reached ? t('reached ✓') : t('{p}% to go', { p: num(g.goal - g.today, 1) }), g.streak > 1 && t('{n} days in a row', { n: g.streak })].filter(Boolean).join(' · ');
  }
  // the latest look at the game (refreshed every few seconds below)
  const wasHidden = $('peekPanel').hidden;
  $('peekPanel').hidden = !on;
  if (on && wasHidden) refreshPeek();
  // party members' HP gauges as read from the screen
  const party = on ? s.party || [] : [];
  $('kPartyCard').hidden = !party.length;
  if (party.length) $('kParty').innerHTML = party.map((p) => `<div class="row"><span class="notr">${esc(p.name)}</span><span class="${p.hp < 30 ? 'bad' : 'muted'}">${p.hp ? `${p.hp}%` : '✝'}</span></div><div class="bar hp"><i style="width:${p.hp}%"></i></div>`).join('');
  if (!on) return;
  const pct = (a, b) => (a != null && b ? Math.round((a / b) * 100) : null);
  const hp = pct(s.hp, s.hpMax), mp = pct(s.mp, s.mpMax);
  $('kHp').textContent = s.hp != null ? `${num(s.hp)}` : '—';
  $('kHpBar').firstElementChild.style.width = `${hp ?? 0}%`;
  $('kMpBar').firstElementChild.style.width = `${mp ?? 0}%`;
  const state = { reading: '', starting: t('starting…'), hidden: t('game window minimised'), covered: t('game window covered: bring it to the front once'), error: s.error || t('error'), stopped: t('stopped'), off: '' }[s.status] ?? '';
  $('kHpSub').textContent = state || [hp != null && `HP ${hp}%`, s.mp != null && `MP ${num(s.mp)} (${mp}%)`].filter(Boolean).join(' · ');
  $('kExp').textContent = s.exp != null ? `${num(s.exp, 1)}%` : '—';
  $('kExpBar').firstElementChild.style.width = `${s.exp ?? 0}%`;
  $('kExpSub').textContent = s.expPerHour != null ? t('{p}%/h · next level in {d}', { p: num(s.expPerHour, 1), d: s.toNextMs ? dur(s.toNextMs) : '—' }) : t('EXP per hour after a few minutes');
  // the exact EXP from the chat's "Exp obtained" lines: points per hour, and what the level still needs
  const xp = S.expPts;
  if (xp?.perHour) $('kExpSub').textContent += ` · ${t('{n} EXP/h', { n: gold(xp.perHour) })}${xp.toGo ? ` · ${t('{n} to go', { n: gold(xp.toGo) })}` : ''}`;
  // a double / bonus EXP event the game announced: today's pace is boosted
  if (S.expBoost) $('kExpSub').textContent += ` · ⚡ ${t('{what} event', { what: t(S.expBoost.what) })}`;
}
// server announcements in the chat (Live tab, under the server notices)
async function loadAnnouncements() {
  if (tab !== 'live' || !S?.screen) { $('annList').innerHTML = `<div class="muted" style="font-size:12px">${t('With the screen reader on, the server\'s announcements in the chat show up here.')}</div>`; return; }
  const list = await getJSON('/api/announcements');
  $('annList').innerHTML = list.slice(0, 20).map((a) => `<div class="recap notr"><span class="muted">${clock(a.t)}</span> ${esc(a.text)}</div>`).join('') || `<div class="muted" style="font-size:12px">${t('Nothing announced yet.')}</div>`;
}
setInterval(loadAnnouncements, 30000);
setTimeout(loadAnnouncements, 2000);

// move / share your setup: one file out, one file in (added to what is here)
$('suSecrets').addEventListener('change', () => { $('suExport').href = `/api/setup-export${$('suSecrets').checked ? '?secrets=1' : ''}`; });
$('suImport').addEventListener('change', async () => {
  const file = $('suImport').files[0];
  $('suImport').value = '';
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch { $('suMsg').textContent = t('That is not a setup file.'); return; }
  if (!confirm(t('Import the setup from {name}? It is added to what you have now.', { name: file.name }))) return;
  const r = await post('/api/setup-import', data);
  if (!r.ok) { $('suMsg').textContent = await r.text(); return; }
  const s = await r.json();
  $('suMsg').textContent = t('Imported: {list}', { list: s.map((x) => `${t(x.what)} ${x.added != null ? `+${x.added}` : ''}`.trim()).join(', ') || t('nothing new') });
  loadScreenSettings(); loadNotify();
});

// tracker health: CPU and memory (two charts, one unit each)
async function loadHealth() {
  const h = await getJSON('/api/health');
  const s = h.samples;
  const avg = (k) => { const v = s.slice(-30).map((x) => x[k]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  $('hlInfo').textContent = s.length ? t('last 30 minutes: tracker {a}% CPU, screen readers {b}% CPU ({n} cores)', { a: num(avg('tracker') ?? 0, 1), b: avg('reader') == null ? '—' : num(avg('reader'), 1), n: h.cores }) : t('Measured once a minute; the first numbers show up after a minute or two.');
  const pts = (k) => s.filter((x) => x[k] != null).map((x) => [x.t, x[k]]);
  lineChart($('hlCpu'), { series: [{ name: t('Tracker'), color: 'var(--s1)', points: pts('tracker') }, { name: t('Screen readers'), color: 'var(--s2)', points: pts('reader') }].filter((x) => x.points.length), yFmt: (v) => `${num(v, 1)}%`, height: 160, empty: t('Measured once a minute; the first numbers show up after a minute or two.') });
  lineChart($('hlMem'), { series: [{ name: t('Tracker'), color: 'var(--s1)', points: pts('trackerMb') }, { name: t('Screen readers'), color: 'var(--s2)', points: pts('readerMb') }].filter((x) => x.points.length), yFmt: (v) => `${num(v)} MB`, height: 160, empty: t('Measured once a minute; the first numbers show up after a minute or two.') });
  // the game itself: CPU, memory and freezes
  const g = h.game || { samples: [], freezes: [], frozenNow: [] };
  const last = g.samples[g.samples.length - 1];
  $('gpInfo').textContent = last ? [t('now {c}% CPU, {m} MB', { c: num(last[1], 1), m: num(last[2]) }), g.today ? t('{n} freezes in 24 hours', { n: g.today }) : t('no freezes in 24 hours'), g.longest ? t('longest {d}', { d: dur(g.longest) }) : ''].filter(Boolean).join(' · ') : t('Measured while the game runs, once a minute.');
  const empty = t('Measured while the game runs, once a minute.');
  lineChart($('gpCpu'), { series: [{ name: t('Game'), color: 'var(--s3)', points: g.samples.map((x) => [x[0], x[1]]) }], yFmt: (v) => `${num(v, 1)}%`, height: 160, empty });
  lineChart($('gpMem'), { series: [{ name: t('Game'), color: 'var(--s3)', points: g.samples.map((x) => [x[0], x[2]]) }], yFmt: (v) => `${num(v)} MB`, height: 160, empty });
  $('gpFreezes').innerHTML = (g.frozenNow.length ? `<tr><td colspan="4"><b style="color:var(--crimson)">❄ ${t('Not responding right now')} (${dur(g.frozenNow[0].ms)})</b></td></tr>` : '')
    + (g.freezes.map((f) => `<tr><td class="muted">${dateTime(f.t)}</td><td class="num">${dur(f.ms)}</td><td class="notr">${esc(f.char || '')}</td><td>${f.zone != null ? esc(zoneName(f.zone)) : ''}</td></tr>`).join('')
    || `<tr><td colspan="4" class="empty">${t('No freezes in the last 7 days.')}</td></tr>`);
  // the game's graphics settings: what costs the most (advice when it freezes), and what you changed lately
  const o = await getJSON('/api/game-options').catch(() => null);
  if (!o?.options) { $('gpGfx').innerHTML = `<span class="muted">${t('The game settings file (ybopt2.cfg) was not found.')}</span>`; return; }
  const heavy = o.heavy.map((h) => t(h.label)).join(', ');
  const advice = o.freezes24h >= 3 && o.heavy.length
    ? `<div class="note-box" style="margin:4px 0">${esc(t('The game froze {n} times in 24 hours. Lower these first, in this order (game options → graphics): {list}.', { n: o.freezes24h, list: o.heavy.slice(0, 3).map((h) => t(h.label)).join(', ') }))}</div>` : '';
  const hist = o.history.slice(0, 6).map((h) => `<div class="muted" style="font-size:12px">${dateTime(h.t)}: <span class="mono">${esc(h.changes.map((c) => `${c.key} ${c.from} → ${c.to}`).join(', '))}</span></div>`).join('');
  $('gpGfx').innerHTML = `${advice}<div>${o.heavy.length ? esc(t('On now (the heaviest first): {list}', { list: heavy })) : esc(t('Your graphics settings are already light.'))}</div>${hist ? `<div style="margin-top:6px"><b style="font-size:12px">${t('Changed lately')}</b>${hist}</div>` : ''}`;
}

// today's digest as it would be sent now
$('srDigestTry').onclick = async () => {
  const d = await getJSON('/api/digest');
  $('srDigestOut').hidden = false;
  $('srDigestOut').textContent = `${tAlert(d.title)}\n${tAlert(d.body) || t('Nothing to report yet today.')}`;
};
// storage: what the screen reader keeps, with a clear button per part
const bytes = (n) => (n >= 1048576 ? `${num(n / 1048576, 1)} MB` : `${num(n / 1024)} KB`);
function renderStorage(s) {
  $('stoInfo').textContent = t('{size} in total in {dir}', { size: bytes(s.total), dir: s.dir });
  // the drive it's on, and the automatic tidy-up
  const gb = (n) => `${num(n / 1073741824, 1)} GB`;
  $('stoDisk').innerHTML = s.disk ? `${esc(t('Drive: {free} free of {size}', { free: gb(s.disk.free), size: gb(s.disk.size) }))}<div class="bar ${s.disk.free / s.disk.size < 0.1 ? 'low' : ''}" style="margin-top:4px"><i style="width:${Math.round((1 - s.disk.free / s.disk.size) * 100)}%"></i></div>` : '';
  if (document.activeElement !== $('tdMB')) $('tdMB').value = String(s.tidy.mb || 0);
  if (document.activeElement !== $('tdDays')) $('tdDays').value = String(s.tidy.days || 0);
  $('tdInfo').textContent = [t('pictures, captures and timelines: {size}', { size: bytes(s.tidy.bytes) }), s.tidy.lastAt ? t('last tidy-up {when}: {n} removed, {size} freed', { when: dateTime(s.tidy.lastAt), n: s.tidy.removed, size: bytes(s.tidy.freed) }) : ''].filter(Boolean).join(' · ');
  $('stoList').innerHTML = s.parts.map((p) => `<tr><td>${esc(t(p.label))}</td><td class="num">${p.count == null ? '' : num(p.count)}</td><td class="num">${p.bytes == null ? '' : bytes(p.bytes)}</td>
    <td>${p.what === 'slim' ? (p.count ? `<button class="small" data-slim="1">${t('Thin out ({n} records)', { n: num(p.count) })}</button>` : `<span class="muted" style="font-size:12px">${t('nothing to thin yet')}</span>`)
      : `<button class="small danger" data-clear="${p.what}">${p.what === 'timelines' ? t('Clear older than 30 days') : p.what === 'overlay' ? t('Empty the cache') : t('Clear')}</button>`}</td></tr>`).join('');
}
const saveTidy = () => saveSettings({ tidyMB: +$('tdMB').value, tidyDays: +$('tdDays').value });
for (const id of ['tdMB', 'tdDays']) $(id).addEventListener('change', saveTidy);
$('tdNow').onclick = async () => {
  await saveTidy();
  const r = await post('/api/tidy', {});
  if (!r.ok) { toast({ kind: 'timer', title: await r.text() }); return; }
  const x = await r.json();
  toast({ kind: 'buff', title: x.removed ? t('Tidied up: {n} removed, {size} freed', { n: x.removed, size: bytes(x.freed) }) : t('Nothing to tidy up within these limits') });
  renderStorage(x.storage);
};
// thinning keeps one record per day (a backup is made first), so it doesn't need the "for good" warning
document.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-slim]')) return;
  const r = await post('/api/storage', { what: 'slim' });
  if (!r.ok) { toast({ kind: 'timer', title: await r.text() }); return; }
  toast({ kind: 'buff', title: t('Old records thinned (a backup was made first)') });
  renderStorage(await r.json());
});
async function loadStorage() { renderStorage(await getJSON('/api/storage')); }
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-clear]');
  if (!b || !confirm(t('Delete this for good? It cannot be undone.'))) return;
  const r = await post('/api/storage', { what: b.dataset.clear });
  if (!r.ok) { toast({ kind: 'timer', title: await r.text() }); return; }
  renderStorage(await r.json());
});

// the game screen card (Live tab): also on the phone, when that is allowed in the settings
let peekUrl = null, peekBusy = false;
async function refreshPeek() {
  if (peekBusy || tab !== 'live' || $('peekPanel').hidden || document.hidden) return;
  peekBusy = true;
  try {
    const r = await fetch(`/api/peek.jpg?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) { $('peekInfo').textContent = r.status === 403 ? t('switch on "Show the game screen on my phone too" on the PC') : t('no recent look: is the game minimised?'); $('peekImg').hidden = true; return; }
    const at = +r.headers.get('X-Taken-At');
    if (peekUrl) URL.revokeObjectURL(peekUrl);
    peekUrl = URL.createObjectURL(await r.blob());
    $('peekImg').src = peekUrl; $('peekImg').hidden = false;
    $('peekInfo').textContent = at ? t('seen at {time}', { time: clock(at) }) : '';
  } catch { /* tracker restarting */ } finally { peekBusy = false; }
}
setInterval(refreshPeek, 3000);
async function loadScreenSettings() {
  const st = await getJSON('/api/settings');
  $('srOn').checked = !!st.screenReader; $('srEvery').value = String(st.screenInterval || 3); $('srLowHp').value = String(st.lowHpAlert || 0);
  $('srWhisper').checked = st.whisperAlert !== false; $('srMention').checked = st.mentionAlert !== false; $('srHud').checked = st.hudAlert !== false;
  $('srStuck').value = String(st.stuckMinutes ?? 10); $('srParty').value = String(st.partyHpAlert || 0);
  $('srReplay').checked = st.deathReplay !== false; $('srShots').value = st.dropShots || 'mine'; $('srChat').checked = st.chatLog !== false;
  $('srDeal').value = String(st.dealAlert ?? 30); $('srAlts').checked = st.screenReaderAlts !== false; $('srPeekLan').checked = !!st.peekLan;
  $('srWatchOnline').checked = st.watchOnline !== false; $('srPace').checked = st.adaptivePace !== false;
  if (document.activeElement !== $('srWords')) $('srWords').value = (st.chatWords || []).join(', ');
  if ($('srDigest').options.length < 2) for (let h = 0; h < 24; h++) $('srDigest').add(new Option(`${String(h).padStart(2, '0')}:00`, String(h)));
  $('srDigest').value = String(st.digestHour ?? 22);
  $('srGoal').value = String(st.expGoal || 0);
  $('srEffect').checked = st.effectAlert !== false; $('srBuffEnd').checked = st.buffEndAlert !== false; $('srMini').value = String(st.minimapSurge ?? 5);
  loadHealth();
  const pc = S?.screen?.pace;
  $('srPaceNow').textContent = pc?.interval ? t('now every {n} s ({why})', { n: pc.interval, why: t({ busy: 'fighting', quiet: 'AFK', normal: 'normal', fixed: 'fixed', start: 'starting' }[pc.why] || pc.why) }) : '';
  loadStorage();
  const s = S?.screen;
  $('srStatus').textContent = !st.screenReader ? t('off') : !S?.game?.running ? t('waits for the game') : s?.status === 'reading' ? t('reading the game window') : s?.status === 'hidden' ? t('game window minimised') : s?.status === 'covered' ? t('game window covered: bring it to the front once') : s?.error ? s.error : t('starting…');
}
const chk = (el) => el.checked, val = (el) => +el.value;
for (const [id, key, conv] of [['srOn', 'screenReader', chk], ['srEvery', 'screenInterval', val], ['srLowHp', 'lowHpAlert', val],
  ['srWhisper', 'whisperAlert', chk], ['srMention', 'mentionAlert', chk], ['srHud', 'hudAlert', chk], ['srStuck', 'stuckMinutes', val], ['srParty', 'partyHpAlert', val],
  ['srReplay', 'deathReplay', chk], ['srShots', 'dropShots', (el) => el.value], ['srChat', 'chatLog', chk],
  ['srDeal', 'dealAlert', val], ['srAlts', 'screenReaderAlts', chk], ['srPeekLan', 'peekLan', chk],
  ['srWatchOnline', 'watchOnline', chk], ['srPace', 'adaptivePace', chk], ['srDigest', 'digestHour', val], ['srGoal', 'expGoal', val], ['srEffect', 'effectAlert', chk], ['srBuffEnd', 'buffEndAlert', chk], ['srMini', 'minimapSurge', val], ['srWords', 'chatWords', (el) => el.value.split(',').map((w) => w.trim()).filter(Boolean)]]) {
  $(id).addEventListener('change', async () => { await saveSettings({ [key]: conv($(id)) }); setTimeout(loadScreenSettings, 1500); });
}

// ---------------------------------------------------------------- Discord bot (Settings)
function renderBot(b) {
  $('dbState').textContent = { off: b.token ? t('off') : t('not set up'), connecting: t('connecting…'), reconnecting: t('reconnecting…'), connected: t('connected as {name}', { name: b.me || '?' }), error: b.error || t('error') }[b.status] || b.status;
  if (document.activeElement !== $('dbToken')) $('dbToken').value = b.token || '';
  if (document.activeElement !== $('dbAllowed')) $('dbAllowed').value = (b.allowed || []).join(', ');
  $('dbInvite').hidden = !b.invite; if (b.invite) $('dbInvite').href = b.invite;
}
async function loadBot() { try { renderBot(await getJSON('/api/discord-bot')); } catch { /* phone view */ } }
$('btnDbSave').onclick = async () => {
  const r = await post('/api/discord-bot', { token: $('dbToken').value, allowed: $('dbAllowed').value });
  if (!r.ok) { $('dbState').textContent = await r.text(); return; }
  renderBot(await r.json()); setTimeout(loadBot, 4000);
};
$('btnDbTry').onclick = async () => {
  const r = await getJSON(`/api/discord-bot/try?cmd=${$('dbTryCmd').value}&arg=${encodeURIComponent($('dbTryArg').value)}`);
  $('dbTryOut').hidden = false;
  $('dbTryOut').textContent = r.text.replace(/<t:(\d+):R>/g, (m, s) => clock(+s * 1000)).replace(/\*\*/g, '');
};

// ---------------------------------------------------------------- calendar feed address (Settings)
getJSON('/api/net').then((n) => { if (n.lan?.length) $('calUrl').value = `${n.lan[0]}/calendar.ics`; });
$('calCopy').onclick = async () => {
  try { await navigator.clipboard.writeText($('calUrl').value); toast({ kind: 'buff', title: t('Address copied') }); }
  catch { $('calUrl').select(); }
};

// ---------------------------------------------------------------- daily / weekly checklist (Live tab)
let checkItems = [];
const CK_DAYS = () => [t('Mon'), t('Tue'), t('Wed'), t('Thu'), t('Fri'), t('Sat'), t('Sun')];
function fillCheckForm() {
  $('ckHour').innerHTML = Array.from({ length: 24 }, (_, h) => `<option value="${h}">${String(h).padStart(2, '0')}:00</option>`).join('');
  $('ckDay').innerHTML = CK_DAYS().map((d, i) => `<option value="${i}">${esc(d)}</option>`).join('');
}
async function loadChecklist() { checkItems = (await getJSON('/api/checklist')).items; renderChecklist(); }
function renderChecklist() {
  const now = Date.now() + (clockOffset || 0);
  const open = checkItems.filter((x) => !x.done).length;
  $('ckInfo').textContent = checkItems.length ? t('{n} of {total} left · server time', { n: open, total: checkItems.length }) : t('resets in server time');
  const when = (x) => (x.every === 'hours'
    ? `${t('every {n} h', { n: x.hours })} · ${x.nextReset && x.nextReset > now ? t('due in {d}', { d: dur(x.nextReset - now) }) : t('due now')}`
    : `${x.every === 'weekly' ? t('weekly, {day} {h}', { day: CK_DAYS()[x.resetDay], h: `${String(x.resetHour).padStart(2, '0')}:00` }) : t('daily, {h}', { h: `${String(x.resetHour).padStart(2, '0')}:00` })} · ${x.nextReset ? t('resets in {d}', { d: dur(x.nextReset - now) }) : ''}`);
  // per-character items: ticked for the character the dashboard shows; a row of everyone with ✓ / ○ (click to tick)
  const who = (x) => (x.perChar ? `<div class="ckchars">${(x.byChar || []).map((c) => `<button class="chip ${c.done ? 'on' : ''}" data-ck-char="${esc(c.name)}" data-ck-id="${esc(x.id)}" data-ck-done="${c.done ? '0' : '1'}" title="${esc(c.done ? t('done') : t('not done yet'))}">${c.done ? '✓' : '○'} ${esc(c.name)}</button>`).join('')}</div>` : '');
  $('checks').innerHTML = checkItems.map((x) => `<div class="ck ${x.done ? 'done' : ''}"><input type="checkbox" data-ck="${esc(x.id)}" ${x.done ? 'checked' : ''}>
    <span class="ckt"><span class="notr">${esc(x.text)}</span><small>${when(x)}${x.perChar ? ` · ${esc(t('per character'))}${x.char ? `: <span class="notr">${esc(x.char)}</span>` : ''}` : ''}</small>${who(x)}</span>
    <button class="small" data-ck-del="${esc(x.id)}" title="${esc(t('Delete'))}">×</button></div>`).join('')
    || `<div class="empty" style="font-size:12px">${t('Add the things you do every day or week (dailies, arena, guild quests…). They untick themselves at the reset, and you get a reminder before it if something is left.')}</div>`;
}
const checkPost = async (b) => { const r = await post('/api/checklist', b); if (!r.ok) { toast({ kind: 'timer', title: await r.text() }); return; } checkItems = (await r.json()).items; renderChecklist(); };
$('checks').addEventListener('change', (e) => { const c = e.target.closest('[data-ck]'); if (c) checkPost({ action: 'toggle', id: c.dataset.ck, done: c.checked }); });
$('checks').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ck-del]'); if (b) checkPost({ action: 'delete', id: b.dataset.ckDel });
  const c = e.target.closest('[data-ck-char]'); if (c) checkPost({ action: 'toggle', id: c.dataset.ckId, char: c.dataset.ckChar, done: c.dataset.ckDone === '1' });
});
$('ckEvery').onchange = () => {
  $('ckDay').hidden = $('ckEvery').value !== 'weekly';
  $('ckHours').hidden = $('ckEvery').value !== 'hours'; $('ckHourLbl').hidden = $('ckEvery').value === 'hours';
};
$('ckAdd').onclick = async () => {
  await checkPost({ action: 'add', text: $('ckText').value, every: $('ckEvery').value, resetDay: +$('ckDay').value, resetHour: +$('ckHour').value, hours: +$('ckHours').value,
    remind: $('ckEvery').value === 'hours' ? 0 : +$('ckRemind').value, perChar: $('ckPerChar').checked });
  $('ckText').value = '';
};
// a pet's loyalty drops over time: a reminder to feed it, due 3 hours after you tick it
$('ckPet').onclick = () => checkPost({ action: 'add', text: t('Feed my pet'), every: 'hours', hours: 3, remind: 0 });
$('ckText').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('ckAdd').click(); });
fillCheckForm();
window.addEventListener('langchange', () => { fillCheckForm(); renderChecklist(); });
loadChecklist();
setInterval(() => { if (tab === 'live') loadChecklist(); }, 60000);
