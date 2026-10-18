// SoF Tracker dashboard: stats. Loaded as a classic script; all dashboard scripts share one global scope (see index.html).

// ---------------------------------------------------------------- stats tab
// ---- your characters side by side: the best value of each column is marked ★
async function loadCompare() {
  const r = await getJSON(`/api/compare?days=${$('cmpDays').value}`).catch(() => null);
  if (!r) return;
  const rows = r.chars, best = {};
  for (const k of ['level', 'playMs', 'activePct', 'exp', 'expPerHour', 'gold', 'goldPerHour', 'gearScore', 'questsDone']) {
    const vals = rows.map((c) => c[k]).filter((v) => v != null && v > 0);
    if (rows.length > 1 && vals.length) best[k] = Math.max(...vals);
  }
  const lowDeaths = rows.length > 1 ? Math.min(...rows.filter((c) => c.playMs > 3600000).map((c) => c.deaths)) : null;
  const cell = (c, k, text) => `<td class="num">${c[k] != null && best[k] === c[k] ? `<b title="${esc(t('best of your characters'))}">★ ${text}</b>` : text}</td>`;
  const signed = (v) => (v == null ? '—' : `${v >= 0 ? '+' : '−'}${gold(Math.abs(v))}`);
  $('cmpInfo').textContent = rows.length ? t('{n} characters · the best of each column is marked ★', { n: rows.length }) : t('side by side, from what the tracker saw');
  $('cmpRows').innerHTML = rows.map((c) => `<tr class="click" data-player="${esc(c.name)}"><td><b class="notr">${esc(c.name)}</b>${c.inGame ? ' <span class="tag up">' + t('in game') + '</span>' : ''}${c.rosterOnly ? ` <span class="tag" title="${esc(t('Found in the game folder; not played since the tracker was installed'))}">${t('not tracked')}</span>` : ''}<div class="muted" style="font-size:11px">${esc(c.cls || '')}${c.account ? ` · ${esc(c.account)}` : ''}</div></td>
    ${cell(c, 'level', c.level ?? '—')}${cell(c, 'playMs', dur(c.playMs))}${cell(c, 'activePct', c.activePct != null ? c.activePct + '%' : '—')}
    ${cell(c, 'exp', c.exp ? `+${num(c.exp, 1)}%` : '—')}${cell(c, 'expPerHour', c.expPerHour != null ? `${num(c.expPerHour, 2)}%` : '—')}
    ${cell(c, 'gold', signed(c.gold))}${cell(c, 'goldPerHour', c.goldPerHour != null ? signed(c.goldPerHour) : '—')}${cell(c, 'gearScore', c.gearScore != null ? num(c.gearScore) : '—')}
    <td class="num">${lowDeaths != null && c.playMs > 3600000 && c.deaths === lowDeaths ? `<b title="${esc(t('fewest deaths'))}">★ ${c.deaths}</b>` : c.deaths}${c.deathExp ? `<div class="muted" style="font-size:11px">−${num(c.deathExp, 2)}% EXP</div>` : ''}</td>
    ${cell(c, 'questsDone', c.rosterOnly ? '—' : c.questsDone)}<td>${c.bestMob ? `<span class="notr">${esc(c.bestMob.name)}</span> <span class="muted">${num(c.bestMob.expPerHour)}/h</span>` : '<span class="muted">—</span>'}</td></tr>`).join('')
    || `<tr><td colspan="12" class="empty">${t('No sessions recorded yet.')}</td></tr>`;
}
$('cmpDays').addEventListener('change', loadCompare);

// ---- ask the tracker: a question in plain words, answered from your own data (lib/ask.js)
const ASK_EXAMPLES = ['How long did I play this week?', 'Which spot gave the most EXP?', 'When did I last die?', 'Who killed me most?', 'How much gold did I make today?', 'When is the next boss?', 'What is my best monster?', 'When will I level up?', 'Price of Special Sky Crystal', 'When did I last see Zekez?', 'What is my enchant success rate?'];
$('askEx').innerHTML = ASK_EXAMPLES.map((q) => `<button class="small" type="button" data-ask="${esc(q)}">${esc(t(q))}</button>`).join('');
async function ask(q) {
  if (!q.trim()) return;
  $('askOut').hidden = false; $('askOut').textContent = t('Looking…');
  const r = await post('/api/ask', { q }).then((x) => x.json()).catch(() => null);
  if (!r) { $('askOut').textContent = t('The tracker did not answer. Is it running?'); return; }
  $('askOut').innerHTML = `<div class="ans">${esc(r.answer)}</div>${r.lines?.length ? `<ul>${r.lines.map((l) => `<li class="notr">${esc(l)}</li>`).join('')}</ul>` : ''}${r.understood ? `<div class="muted" style="font-size:11px">${esc(t('Understood as: {x}', { x: r.understood }))}</div>` : ''}`;
}
$('askForm').addEventListener('submit', (e) => { e.preventDefault(); ask($('askQ').value); });
$('askEx').addEventListener('click', (e) => { const b = e.target.closest('[data-ask]'); if (!b) return; $('askQ').value = b.dataset.ask; ask(b.dataset.ask); });

// ---- potions and ginseng counted on the hotbar: left, per hour, how long it lasts, how long earlier batches lasted
let potChar = null;
async function loadPotions() {
  const r = await getJSON(`/api/potion-stock${potChar ? `?char=${encodeURIComponent(potChar)}` : ''}`).catch(() => null);
  if (!r) return;
  potChar = r.character;
  $('potChar').innerHTML = (r.chars.length ? r.chars : [r.character].filter(Boolean)).map((c) => `<option ${c === r.character ? 'selected' : ''}>${esc(c)}</option>`).join('');
  if (document.activeElement !== $('potLow')) $('potLow').value = String(r.limit ?? 0);
  $('potRows').innerHTML = r.items.map((p) => `<tr class="${r.limit && p.count < r.limit ? 'hl' : ''}"><td class="notr">${esc(p.name)}</td><td class="mono">${esc(p.slot || '')}</td>
    <td class="num"><b>${num(p.count)}</b>${p.stale ? `<div class="muted" style="font-size:11px">${esc(t('seen {when}', { when: dateTime(p.seenAt) }))}</div>` : ''}</td>
    <td class="num">${p.perHour != null ? num(p.perHour) : '—'}</td><td class="num">${p.leftMs ? dur(p.leftMs) : '—'}</td>
    <td class="num">${p.batch ? `${t('{n} used', { n: num(p.batch.used) })}<div class="muted" style="font-size:11px">${esc(t('of {n}, in {d} of play', { n: num(p.batch.from), d: dur(p.batch.playMs) }))}</div>` : '—'}</td>
    <td style="font-size:12px">${p.last.length ? p.last.map((b) => `${esc(t('{n} in {d}', { n: num(b.used), d: dur(b.playMs) }))}${b.perHour ? ` <span class="muted">(${num(b.perHour)}/h)</span>` : ''}`).join('<br>') : `<span class="muted">${esc(t('none finished yet'))}</span>`}</td></tr>`).join('')
    || `<tr><td colspan="7" class="empty">${esc(t('Nothing counted yet: put potions or ginseng on your hotbar and play with the screen reader on.'))}</td></tr>`;
}
$('potChar').addEventListener('change', () => { potChar = $('potChar').value; loadPotions(); });
$('potLow').addEventListener('change', async () => { await post('/api/settings', { potionLow: +$('potLow').value }); loadPotions(); });

// ---- skill setup: the character's skill bar and auto-combat setup from the game files, with what to improve
let skChar = null;
async function loadSkillSetup() {
  const r = await getJSON(`/api/skill-setup${skChar ? `?char=${encodeURIComponent(skChar)}` : ''}`).catch(() => null);
  if (!r) return;
  skChar = r.character;
  $('skChar').innerHTML = r.chars.map((c) => `<option ${c === r.character ? 'selected' : ''}>${esc(c)}</option>`).join('');
  $('skInfo').textContent = !r.found ? t('no saved setup found for this character in the game folder') : [r.cls && r.level ? `${r.cls} · Lv ${r.level}` : t('class / level unknown: set them on the character (click its name)'), r.barAt ? t('saved by the game {when}', { when: dateTime(r.barAt) }) : ''].filter(Boolean).join(' · ');
  const cd = (ms) => (ms ? (ms >= 60000 ? `${num(ms / 60000, 1)} min` : `${num(ms / 1000, 1)} s`) : '');
  const row = (x) => `<tr title="${esc(x.desc || '')}"><td class="muted mono" style="width:28px">${x.slot + 1}</td><td class="notr">${x.kind === 'skill' ? '✦' : x.kind === 'action' ? '•' : '◆'} ${esc(x.name)}${x.level ? ` <span class="muted">Lv ${x.level}</span>` : ''}</td><td class="num muted">${cd(x.cooldownMs)}</td></tr>`;
  $('skBar').innerHTML = r.bar.map(row).join('') || `<tr><td class="empty">${t('Nothing saved')}</td></tr>`;
  $('skAuto').innerHTML = r.auto.map(row).join('') || `<tr><td class="empty">${t('Nothing saved')}</td></tr>`;
  $('skPots').textContent = r.potions.hp || r.potions.mp ? t('Potions used for costs: {list}', { list: [r.potions.hp, r.potions.mp].filter(Boolean).join(' · ') }) : '';
  const a = r.advice || { upgrades: [], strongest: [] };
  $('skUp').innerHTML = a.upgrades.length ? a.upgrades.map((u) => `<div class="note-box" style="margin:4px 0"><span class="notr">${esc(u.from.name)}</span> → <b class="notr">${esc(u.to.name)}</b> <span class="muted">Lv ${u.to.level}</span></div>`).join('')
    : `<div class="muted" style="font-size:12px">${r.level ? t('No stronger versions of your saved skills at your level.') : t('Needs the character’s class and level.')}</div>`;
  $('skBest').innerHTML = (a.strongest || []).map((s) => `<tr><td class="notr">${s.onBar ? '✓ ' : ''}${esc(s.name)}</td><td class="num muted">Lv ${s.level}</td></tr>`).join('');
}
$('skChar').addEventListener('change', () => { skChar = $('skChar').value; loadSkillSetup(); });

async function loadStats() {
  loadCompare();
  loadSkillSetup();
  loadPotions();
  const [st, bs] = await Promise.all([getJSON('/api/stats'), getJSON('/api/bosses')]);
  const p = st.patterns;
  const DAYS = [t('Mon'), t('Tue'), t('Wed'), t('Thu'), t('Fri'), t('Sat'), t('Sun')];
  $('stTotal').textContent = dur(p.total);
  $('stDays').textContent = t('{n} days played', { n: p.daysPlayed });
  $('stStreak').textContent = p.currentStreak === 1 ? t('1 day') : t('{n} days', { n: p.currentStreak });
  $('stLongest').textContent = t('longest {n} days', { n: p.longestStreak });
  $('stAvg').textContent = dur(p.avgSession);
  $('stLongestSess').textContent = t('longest {d}', { d: dur(p.longestSession) });
  $('stFav').textContent = p.total ? `${String(p.favouriteHour).padStart(2, '0')}:00` : '—';
  $('stFavDay').textContent = p.total ? t('most on {day}', { day: DAYS[p.favouriteDay] }) : '';
  const earned = st.milestones.filter((m) => m.earned);
  $('stMs').textContent = `${earned.length} / ${st.milestones.length}`;
  const next = st.milestones.find((m) => !m.earned);
  $('stMsNext').textContent = next ? t('next: {m}', { m: t(next.title) }) : t('all earned!');

  // weekday x hour heat grid (sequential, one hue)
  const max = Math.max(1, ...p.grid.flat());
  let html = `<div class="hgrid"><b></b>${Array.from({ length: 24 }, (_, h) => `<i>${h % 3 === 0 ? h : ''}</i>`).join('')}`;
  p.grid.forEach((row, d) => {
    html += `<b>${DAYS[d]}</b>` + row.map((ms, h) => `<span title="${DAYS[d]} ${String(h).padStart(2, '0')}:00 · ${dur(ms)}" style="${ms ? `background:var(--s4);opacity:${(0.18 + 0.82 * (ms / max)).toFixed(2)}` : ''}"></span>`).join('');
  });
  $('stGrid').innerHTML = html + '</div>';

  $('stChars').innerHTML = st.characters.map((c) => {
    const tr = c.activeMs + c.afkMs;
    return `<tr class="click" data-player="${esc(c.name)}"><td><b>${esc(c.name)}</b><div class="muted" style="font-size:11px">${esc(c.account || '')}${c.info?.level ? ` · Lv ${c.info.level}` : ''}${c.info?.cls ? ` ${esc(c.info.cls)}` : ''}</div></td>
      <td class="num">${dur(c.ms)}</td><td class="num">${tr ? Math.round((c.activeMs / tr) * 100) + '%' : '—'}</td><td class="num">${c.players}</td><td>${esc(c.topZone || '—')}</td><td class="muted">${dateOnly(c.last)}</td></tr>`;
  }).join('') || `<tr><td colspan="6" class="empty">${t('No sessions recorded yet.')}</td></tr>`;

  // busy hours: zone rows x 24 hours, colour = average players around you
  const zones = Object.entries(st.busy).filter(([, z]) => z.hours.some(Boolean));
  const bmax = Math.max(1, ...zones.flatMap(([, z]) => z.hours.filter(Boolean).map((h) => h.avg)));
  $('stBusy').innerHTML = zones.length ? `<div class="hgrid" style="grid-template-columns:120px repeat(24,1fr)"><b></b>${Array.from({ length: 24 }, (_, h) => `<i>${h % 3 === 0 ? h : ''}</i>`).join('')}`
    + zones.map(([zone, z]) => `<b title="${esc(z.name)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(z.name)}</b>` + z.hours.map((h, i) => `<span title="${esc(z.name)} ${String(i).padStart(2, '0')}:00 · ${h ? t('{n} players around you on average ({m} min measured)', { n: num(h.avg, 1), m: h.minutes }) : t('not measured')}" style="${h ? `background:var(--s2);opacity:${(0.15 + 0.85 * (h.avg / bmax)).toFixed(2)}` : ''}"></span>`).join('')).join('') + '</div>'
    : `<div class="empty">${t('Busy hours fill in while you play: every second the tracker counts the players around you.')}</div>`;

  $('stBosses').innerHTML = bs.length ? `<table><thead><tr><th>${t('Boss')}</th><th class="num">${t('Seen')}</th><th class="num">${t('Every')}</th><th>${t('Next (estimate)')}</th></tr></thead><tbody>${bs.map((b) => {
    const every = b.intervalMs ? Math.round(b.intervalMs / 60000) : null;
    return `<tr><td><b>${esc(b.boss)}</b><div class="muted" style="font-size:11px">${t('last {d}', { d: dateTime(b.lastAt) })}${b.shared ? ` · ${t('incl. friends')}` : ''}</div></td><td class="num">${b.spawns}</td><td class="num">${every ? (every >= 60 ? `${Math.floor(every / 60)}h ${every % 60}m` : `${every}m`) : '—'}</td><td>${b.next ? `${clock(b.next)} <span class="muted">(${t(b.confidence === 'good' ? 'good estimate' : b.confidence === 'rough' ? 'rough estimate' : 'first guess')})</span>` : `<span class="muted">${t('needs more spawns')}</span>`}</td></tr>`;
  }).join('')}</tbody></table>` : `<div class="empty">${t('No boss notices seen yet. Every boss countdown the server announces is recorded from now on.')}</div>`;

  loadActivity();
  loadPatches();
  loadDbChanges();
  loadFarming();
  loadShots();
  loadRecords();
  loadRivals();
  $('stMilestones').innerHTML = st.milestones.map((m) => `<div class="ms ${m.earned ? '' : 'off'}"><span class="i">${m.icon}</span><span><b>${esc(t(m.title))}</b><small>${esc(t(m.group))}${m.earned ? ` · ${m.at ? dateOnly(m.at) : t('earlier')}` : ''}</small></span></div>`).join('');
}

// ---- server activity: weekday x hour grid, one hue (darker = busier)
async function loadActivity() {
  const metric = $('acMetric').value;
  const a = await getJSON(`/api/activity?metric=${metric}&tz=${$('acTz').value}&days=${$('acDays').value}`);
  const DAYS = [t('Mon'), t('Tue'), t('Wed'), t('Thu'), t('Fri'), t('Sat'), t('Sun')];
  const val = (c) => (c ? (metric === 'near' ? c.avgNear : c.metPerHour) : null);
  const max = Math.max(0.0001, ...a.cells.flat().map(val).filter((v) => v != null));
  const hh = (h) => `${String(h).padStart(2, '0')}:00`;
  const label = (v) => (metric === 'near' ? t('{n} players around you on average', { n: num(v, 1) }) : t('{n} players met per hour', { n: num(v, 1) }));
  $('acInfo').textContent = a.hours ? `${t('{d} played', { d: dur(a.playedMs) })} · ${t('times in {tz}', { tz: a.tz })}` : '';
  if (!a.hours || !a.cells.flat().some((c) => val(c) != null)) {
    $('acGrid').innerHTML = `<div class="empty">${metric === 'near' ? t('Players around you are counted every second while you play. Play a while and this fills in.') : t('Nothing recorded for this period yet.')}</div>`;
    $('acLegend').innerHTML = ''; $('acBusy').innerHTML = $('acQuiet').innerHTML = '';
    return;
  }
  let html = `<div class="hgrid"><b></b>${Array.from({ length: 24 }, (_, h) => `<i>${h % 3 === 0 ? h : ''}</i>`).join('')}`;
  a.cells.forEach((row, d) => {
    html += `<b>${DAYS[d]}</b>` + row.map((c, h) => {
      const v = val(c);
      const tip = `${DAYS[d]} ${hh(h)}–${hh((h + 1) % 24)} · ${v != null ? `${label(v)} · ${t('{m} min played', { m: c.minutes })}` : c ? t('not measured') : t('not played')}`;
      return `<span class="hit" title="${esc(tip)}" style="${v != null ? `background:var(--s1);opacity:${(0.15 + 0.85 * (v / max)).toFixed(2)}` : ''}"></span>`;
    }).join('');
  });
  $('acGrid').innerHTML = html + '</div>';
  $('acLegend').innerHTML = `<span>${t('quiet')}</span><span class="ramp" style="background:linear-gradient(90deg, color-mix(in srgb, var(--s1) 15%, transparent), var(--s1))"></span><span>${t('busy')} (${label(max)})</span><span style="margin-left:auto">${t('Empty cells: you did not play then.')}</span>`;
  const row = (c) => `<div class="row"><span>${DAYS[c.day]} ${hh(c.hour)}</span><span class="muted">${label(val(c))}</span></div>`;
  $('acBusy').innerHTML = a.busiest.map(row).join('') || `<div class="muted">${t('Needs at least 15 minutes of play in a time slot.')}</div>`;
  $('acQuiet').innerHTML = a.quietest.map(row).join('') || `<div class="muted">${t('Needs at least 15 minutes of play in a time slot.')}</div>`;
}
for (const id of ['acMetric', 'acTz', 'acDays']) $(id).addEventListener('change', loadActivity);

// ---- game updates found by the patch watcher
async function loadPatches() {
  const p = await getJSON('/api/patches');
  $('ptInfo').textContent = p.version ? t('game version {v}', { v: p.version }) : '';
  $('ptStatus').textContent = p.checking ? t('Checking…') : p.error ? p.error : p.lastCheckAt ? t('last checked {d}', { d: dateTime(p.lastCheckAt) }) + (p.files ? ` · ${t('{n} game files watched', { n: num(p.files) })}` : '') : t('First check runs shortly after the tracker starts.');
  $('ptList').innerHTML = p.history.length ? p.history.map((r) => {
    const n = r.counts.added + r.counts.changed + r.counts.removed;
    const chips = [
      n && `<span class="tag">${t('{n} files changed', { n: num(n) })}</span>`,
      ...r.newZones.map((z) => `<span class="tag" style="border-color:var(--jade);color:var(--jade)">${t('New zone: {z}', { z: esc(zoneName(z)) })}</span>`),
      r.changedMaps.length && `<span class="tag">${t('{n} maps changed', { n: r.changedMaps.length })}: ${r.changedMaps.slice(0, 6).map((z) => esc(zoneName(z))).join(', ')}${r.changedMaps.length > 6 ? '…' : ''}</span>`,
      ...r.tables.map((x) => `<span class="tag">${esc(t(x.label))}: ${t(x.change)}</span>`),
      r.messages?.addedCount && `<span class="tag">${t('{n} new messages', { n: r.messages.addedCount })}</span>`,
      r.messages?.changedCount && `<span class="tag">${t('{n} messages reworded', { n: r.messages.changedCount })}</span>`,
      r.itemIcons && `<span class="tag">${t('{n} new item icons', { n: r.itemIcons })}</span>`,
    ].filter(Boolean).join('');
    return `<div class="patch"><h3>${r.versionTo && r.versionFrom !== r.versionTo ? t('Version {a} → {b}', { a: esc(r.versionFrom || '?'), b: esc(r.versionTo) }) : t('Game files changed')}<small class="muted">${t('found {d}', { d: dateTime(r.at) })} · ${t('since {d}', { d: dateTime(r.since) })}</small></h3>
      <div class="chips">${chips}</div>
      <div class="muted" style="font-size:12px">${r.areas.map((x) => `${esc(t(x.area))}: ${[x.added && `+${x.added}`, x.changed && `~${x.changed}`, x.removed && `−${x.removed}`].filter(Boolean).join(' ')}`).join(' · ')}</div>
      <details data-patch="${esc(r.id)}"><summary>${t('Details')}</summary><div class="pdet">${t('Loading…')}</div></details></div>`;
  }).join('') : `<div class="empty">${t('No game updates seen yet. The tracker remembers every game file and shows here what the next patch changes.')}</div>`;
}
// the game database compared before and after each update: new / removed / changed items, monsters, skills, quests, zones
const DB_KINDS = [['items', 'Items'], ['monsters', 'Monsters'], ['skills', 'Skills'], ['quests', 'Quests'], ['zones', 'Zones']];
const DB_FIELDS = { name: 'Name', level: 'Level', cls: 'Class', slot: 'Type', atkMin: 'Min. attack', atkMax: 'Max. attack', def: 'Defense', price: 'Shop price', sell: 'Sell price', hp: 'HP', cost: 'Cost to learn' };
async function loadDbChanges() {
  const list = await getJSON('/api/gamedb/changes');
  $('dbChangeList').innerHTML = list.length ? list.map((c) => {
    const parts = DB_KINDS.map(([k, label]) => {
      const d = c.diff[k], n = d.counts;
      if (!n.added && !n.removed && !n.changed) return '';
      const names = (arr) => arr.map((x) => esc(x.name)).join(', ');
      const ch = d.changed.slice(0, 60).map((x) => `${esc(x.name)} (${x.diffs.map((f) => `${esc(t(DB_FIELDS[f.field] || f.field))} ${esc(String(f.from))} → ${esc(String(f.to))}`).join(', ')})`).join('<br>');
      return `<details><summary><b>${esc(t(label))}</b>: ${[n.added && t('{n} new', { n: n.added }), n.changed && t('{n} changed', { n: n.changed }), n.removed && t('{n} removed', { n: n.removed })].filter(Boolean).join(' · ')}</summary>
        <div class="notr" style="font-size:12px;margin:4px 0 8px">${n.added ? `<div><b>${t('New')}:</b> ${names(d.added)}${n.added > d.added.length ? '…' : ''}</div>` : ''}${n.changed ? `<div style="margin-top:4px"><b>${t('Changed')}:</b><br>${ch}</div>` : ''}${n.removed ? `<div style="margin-top:4px"><b>${t('Removed')}:</b> ${names(d.removed)}</div>` : ''}</div></details>`;
    }).join('');
    return `<div class="patch"><h3>${c.version ? t('Game version {v}', { v: esc(c.version) }) : t('Game update')}<small class="muted">${dateTime(c.at)}</small></h3>${parts}</div>`;
  }).join('') : `<div class="muted" style="font-size:12px">${t('After the next game update you will see here which items, monsters, skills, quests and zones were added or changed, even when the patch notes don\'t say.')}</div>`;
}

document.addEventListener('toggle', async (e) => {
  const d = e.target;
  if (!(d instanceof HTMLDetailsElement) || !d.dataset.patch || !d.open || d.dataset.loaded) return;
  d.dataset.loaded = '1';
  const r = await getJSON(`/api/patch?id=${encodeURIComponent(d.dataset.patch)}`);
  if (!r) return;
  const m = r.messages;
  const files = (label, list, total) => (list.length ? `<h4>${label} (${num(total)})</h4><div class="files notr">${esc(list.join('\n'))}${total > list.length ? '\n…' : ''}</div>` : '');
  d.querySelector('.pdet').innerHTML = (m ? `<h4>${t('New messages')} (${m.addedCount})</h4>${m.added.map((x) => `<div class="msg notr">${esc(x.text)}</div>`).join('') || '—'}
      ${m.changed.length ? `<h4>${t('Reworded messages')} (${m.changedCount})</h4>${m.changed.map((x) => `<div class="msg notr"><s>${esc(x.from)}</s><br>${esc(x.to)}</div>`).join('')}` : ''}` : '')
    + files(t('Added files'), r.files.added, r.counts.added) + files(t('Changed files'), r.files.changed, r.counts.changed) + files(t('Removed files'), r.files.removed, r.counts.removed);
}, true);
$('ptCheck').onclick = async () => {
  $('ptCheck').disabled = true; $('ptStatus').textContent = t('Checking…');
  try {
    const r = await post('/api/patches/check', {}).then((x) => x.json());
    toast({ kind: 'buff', title: r.changed ? t('Game files changed') : t('No changes since the last check') });
  } finally { $('ptCheck').disabled = false; loadPatches(); }
};

// ---------------------------------------------------------------- house tab
let houseName = null;
async function loadHouse() {
  const h = await getJSON(`/api/house?name=${encodeURIComponent(houseName ?? S?.settings?.myHouse ?? '')}`);
  houseName = h.name;
  loadHouseActivity(h.name);
  // members joining and leaving, as your game showed it
  $('hsLog').innerHTML = (h.log || []).length ? h.log.map((x) => `<div class="recap"><span class="muted">${dateTime(x.t)}</span> <b class="notr click" data-player="${esc(x.who)}">${esc(x.who)}</b> ${x.kind === 'joined' ? `<span class="good">${t('joined')}</span>` : `<span class="bad">${t('left')}</span>`} <span class="muted">${esc(x.char || '')}</span></div>`).join('')
    : `<div class="muted" style="font-size:12px">${t('Nothing yet: when the game says someone joined or left your house, it shows here.')}</div>`;
  $('hsPick').innerHTML = `<option value="">${esc(t('Pick a house…'))}</option>` + h.houses.map((x) => `<option ${x === h.name ? 'selected' : ''}>${esc(x)}</option>`).join('');
  $('hsMine').hidden = !h.name || h.name === S?.settings?.myHouse;
  $('hsInfo').textContent = h.name && h.name === S?.settings?.myHouse ? t('your house') : '';
  if (!h.name) { for (const id of ['hsMembers', 'hsAvg', 'hsHonor', 'hsMet']) $(id).textContent = '—'; $('hsList').innerHTML = `<tr><td colspan="6" class="empty">${t('Pick a house above. Houses come from the public rankings and your player notes.')}</td></tr>`; $('hsChart').innerHTML = ''; return; }
  $('hsMembers').textContent = h.members.length;
  $('hsRank').textContent = h.rank ? t('#{n} by members in the top lists', { n: h.rank }) : '';
  $('hsAvg').textContent = h.stats?.avgLevel ? num(h.stats.avgLevel, 1) : '—';
  $('hsFaction').innerHTML = facBadge(h.faction);
  $('hsHonor').textContent = h.stats?.honor ? num(h.stats.honor) : '—';
  $('hsMet').textContent = h.metCount;
  $('hsList').innerHTML = h.members.map((m) => `<tr class="click" data-player="${esc(m.name)}"><td>${esc(m.name)}${m.threat ? flag : ''}${m.watched ? ' <span style="color:var(--gold)">★</span>' : ''}${m.source === 'notes' ? ' <span class="src">note</span>' : ''}</td><td class="num">${m.level ?? '?'}</td><td>${esc(m.cls || '?')}</td>
    <td class="num">${m.honor ? num(m.honor) : '—'}</td><td class="num">${m.perDay ? num(m.perDay, 2) : '—'}</td><td class="num">${m.met ? `${m.met}×` : '—'}</td></tr>`).join('') || `<tr><td colspan="6" class="empty">${t('No known members.')}</td></tr>`;
  lineChart($('hsChart'), { series: h.tracked.map((n, i) => ({ name: n, color: SERIES[i], points: h.series.map((x) => [x.t, x[n]]) })), step: true, empty: t('Not enough ranking history yet.') });
}
$('hsPick').addEventListener('change', () => { houseName = $('hsPick').value; loadHouse(); });
$('hsMine').onclick = async () => { await saveSettings({ myHouse: houseName }); loadHouse(); };

// ---------------------------------------------------------------- trades tab
let tradeList = [];
async function loadTrades() { tradeList = await getJSON('/api/trades'); renderTrades(); loadDrops(); loadMarket(); loadPriceWatches(); loadChat(); loadLfg(); }
// party finder (Trades tab): "LF party / need healer" posts, and which of your characters they fit
async function loadLfg() {
  const list = await getJSON('/api/lfg');
  $('lfInfo').textContent = list.length ? t('{n} posts, last 2 days', { n: list.length }) : t('"LF party / need healer" posts in the chat, last 2 days');
  $('lfRows').innerHTML = list.map((p) => `<tr class="${p.fits?.length ? 'here-row' : ''}"><td class="muted">${dateTime(p.t)}</td><td class="notr"><b class="click" data-player="${esc(p.who)}">${esc(p.who)}</b><div class="muted" style="font-size:11px">${esc(p.text)}</div></td>
    <td>${p.classes.length ? p.classes.map((c) => esc(t(c))).join(', ') : '<span class="muted">—</span>'}</td><td class="num">${p.levels ? `${p.levels[0]}–${p.levels[1] >= 200 ? '' : p.levels[1]}` : '—'}</td>
    <td class="notr">${p.zone ? esc(p.zone.name) : '—'}</td><td class="notr">${p.fits?.length ? `✓ ${esc(p.fits.join(', '))}` : ''}</td></tr>`).join('')
    || `<tr><td colspan="6" class="empty">${t('No party posts read from the chat yet (needs the screen reader).')}</td></tr>`;
}

// goals with a date (Stats tab): progress and whether you're on pace
async function loadGoals(data) {
  const r = data || await getJSON('/api/my-goals');
  if (document.activeElement !== $('glChar')) $('glChar').innerHTML = r.chars.map((c) => `<option ${c === r.char ? 'selected' : ''}>${esc(c)}</option>`).join('') || `<option value="">${t('your character')}</option>`;
  if (!$('glBy').value) { const d = new Date(Date.now() + 7 * 86400000); $('glBy').value = d.toISOString().slice(0, 10); }
  const fmt = (g, v) => (v == null ? '?' : g.kind === 'gold' ? gold(v) : g.kind === 'level' ? num(v, 2) : num(v));
  $('glList').innerHTML = r.goals.map((g) => `<div class="goal ${g.done ? 'done' : g.onPace ? '' : 'behind'}">
    <div class="row"><b class="notr">${esc(g.label)}</b><span class="muted" style="font-size:12px">${g.done ? t('done ✓') : g.overdue ? t('overdue') : t('{d} days left', { d: num(g.daysLeft, 1) })} · ${dateOnly(g.by)}</span></div>
    <div class="bar ${g.done || g.onPace ? '' : 'low'}"><i style="width:${g.pct}%"></i></div>
    <div class="muted" style="font-size:12px">${t('now {v} of {t}', { v: fmt(g, g.value), t: fmt(g, g.target) })} · ${g.done ? '' : g.onPace ? t('on pace') : t('behind: should be at {e}', { e: fmt(g, g.expected) })}${g.perDayNeeded != null ? ` · ${t('{n} per day needed', { n: fmt(g, g.perDayNeeded) })}` : ''}
      ${g.kind === 'custom' ? ` · <label>${t('now at')} <input type="number" value="${g.value ?? 0}" data-gl-val="${esc(g.id)}" style="width:90px"></label>` : ''}
      <button class="small" data-gl-del="${esc(g.id)}">×</button></div></div>`).join('') || `<div class="empty">${t('Add a goal with a date, e.g. level 140 by Sunday. A daily alert tells you when you fall behind.')}</div>`;
}
const glPost = async (b) => { const res = await post('/api/my-goals', b); if (!res.ok) { toast({ kind: 'timer', title: await res.text() }); return; } loadGoals(await res.json()); };
$('glAdd').addEventListener('click', () => glPost({ kind: $('glKind').value, target: +$('glTarget').value, by: `${$('glBy').value}T23:59:00`, char: $('glChar').value, label: $('glLabel').value }));
$('glList').addEventListener('click', (e) => { const d = e.target.closest('[data-gl-del]'); if (d) glPost({ action: 'delete', id: d.dataset.glDel }); });
$('glList').addEventListener('change', (e) => { const v = e.target.closest('[data-gl-val]'); if (v) glPost({ action: 'value', id: v.dataset.glVal, value: +v.value }); });

// ---- price watches: an alert when a chat offer meets your price
function renderPriceWatches(list) {
  $('pwList').innerHTML = list.map((w) => `<span class="tag pw"><b class="notr">${esc(w.item)}</b> ${w.side === 'sell' ? t('sold for at most {p}', { p: gold(w.price) }) : t('bought for at least {p}', { p: gold(w.price) })} <button class="small danger" data-del-pw="${esc(w.id)}" title="${esc(t('Delete'))}">×</button></span>`).join(' ')
    || `<div class="muted" style="font-size:12px">${t('No price watches yet.')}</div>`;
}
async function loadPriceWatches() { renderPriceWatches(await getJSON('/api/price-watch')); }
$('pwForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const r = await post('/api/price-watch', Object.fromEntries(new FormData($('pwForm'))));
  if (!r.ok) { toast({ kind: 'timer', title: t('Could not save'), body: await r.text() }); return; }
  renderPriceWatches(await r.json());
  $('pwForm').elements.item.value = ''; $('pwForm').elements.price.value = '';
});
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-del-pw]');
  if (!b) return;
  const r = await post('/api/price-watch', { action: 'delete', id: b.dataset.delPw });
  if (r.ok) renderPriceWatches(await r.json());
});

// ---- chat log: what the screen reader saw, with the colour of each line (click one to be alerted about it)
let chatColors = [];
async function loadChat() {
  const r = await getJSON(`/api/chat?q=${encodeURIComponent($('chSearch').value.trim())}&who=${encodeURIComponent($('chWho').value.trim())}`);
  chatColors = r.colors || [];
  $('chInfo').textContent = r.total ? t('{n} messages read from the chat', { n: num(r.total) }) : t('what the screen reader saw in the chat');
  $('chColors').innerHTML = chatColors.map((c, i) => `<span class="tag"><i class="swatch" style="background:${c.col}"></i>${esc(c.label)} <button class="small danger" data-del-col="${i}" title="${esc(t('Delete'))}">×</button></span>`).join(' ');
  $('chList').innerHTML = r.entries.map((e) => `<tr${e.alert ? ' class="hl"' : ''}><td class="muted" style="white-space:nowrap">${dateTime(e.t)}</td>
    <td>${e.col ? `<button class="chcol" data-col="${esc(e.col)}" title="${esc(t('Alert me for messages in this colour'))}" style="background:${esc(e.col)}"></button>` : ''}</td>
    <td class="notr click" data-chat-who="${esc(e.who)}">${esc(e.who)}</td><td class="notr" style="font-size:12px">${esc(e.text)}</td></tr>`).join('')
    || `<tr><td colspan="4" class="empty">${t('With the screen reader on, the chat it sees is kept here, each message once.')}</td></tr>`;
}
let chatTimer = 0;
for (const id of ['chSearch', 'chWho']) $(id).addEventListener('input', () => { clearTimeout(chatTimer); chatTimer = setTimeout(loadChat, 250); });
const saveChatColors = async (list) => { await saveSettings({ chatColors: list }); loadChat(); };
document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-col]');
  if (c) {
    const label = prompt(t('A name for messages in this colour (Whisper, House, Party…):'), t('Whisper'));
    if (label !== null) saveChatColors([...chatColors, { col: c.dataset.col, label: label.trim() || t('Chat') }]);
    return;
  }
  const d = e.target.closest('[data-del-col]');
  if (d) { saveChatColors(chatColors.filter((_, i) => i !== +d.dataset.delCol)); return; }
  const w = e.target.closest('[data-chat-who]');
  if (w) { $('chWho').value = w.dataset.chatWho; loadChat(); }
});

// ---- personal records (Stats tab)
const REC_FMT = { expHour: (v) => `${num(v, 1)}%`, sessionExp: (v) => `${num(v, 1)}%`, sessionKills: (v) => num(v), cleanSession: (v) => dur(v * 60000), rareDrop: (v) => t('1 in {n}', { n: Math.round(1 / v) }) };
async function loadRecords() {
  const list = await getJSON('/api/records');
  $('recList').innerHTML = list.map((r) => `<div class="row recrow"><span>${esc(t(r.label))}${r.text ? `<small class="muted notr">${esc(r.text)}</small>` : ''}</span><span class="num">${r.v != null ? `<b>${REC_FMT[r.id](r.v)}</b><small class="muted">${dateOnly(r.t)}</small>` : '<span class="muted">—</span>'}</span></div>`).join('');
}

// ---- rivals: levels over time from the ranking snapshots (one axis: levels)
async function loadRivals() {
  const r = await getJSON('/api/rivals');
  if (document.activeElement !== $('rvNames')) $('rvNames').value = r.rivals.join(', ');
  $('rvList').innerHTML = (S?.rankings?.players || []).slice(0, 600).map((p) => `<option value="${esc(p.name)}">`).join('');
  const series = r.list.filter((x) => x.points.length).map((x, i) => ({ name: x.name, color: SERIES[i % SERIES.length], points: x.points }));
  lineChart($('rvChart'), { series, step: true, height: 200, yFmt: (v) => `Lv ${num(v)}`, empty: r.rivals.length ? t('Not enough ranking history for these players yet (only ranked players have levels).') : t('Add players above to follow their levels next to yours.') });
  $('rvTable').innerHTML = r.list.map((x) => `<tr class="click" data-player="${esc(x.name)}"><td><b>${esc(x.name)}</b>${x.name === r.me ? ` <span class="muted">(${t('you')})</span>` : ''}</td><td class="num">${x.level ?? '—'}</td><td class="num">${x.week ? `+${x.week}` : '0'}</td><td class="num">${x.gained ? `+${x.gained}` : '0'}</td></tr>`).join('');
}
$('rvSave').onclick = async () => { await saveSettings({ rivals: $('rvNames').value.split(',').map((n) => n.trim()).filter(Boolean) }); loadRivals(); };

// ---- "I have N hours": where to farm, from your own EXP per hour
$('plGo').onclick = async () => {
  const p = await getJSON(`/api/plan-session?hours=${$('plHours').value}`);
  const risk = (r) => (r && r.level !== 'low' ? ` <span class="tag ${r.level === 'high' ? 'aggr' : ''}" title="${esc(t('you died here {d}× in 30 days · {e} enemies met here around this hour', { d: r.deaths, e: r.enemyCount }))}">⚠ ${t(r.level === 'high' ? 'risky' : 'some risk')}</span>` : '');
  const money = (s) => [s.costPerHour ? t('potions ~{c}/h', { c: gold(Math.round(s.costPerHour)) }) : '', s.profitPerHour != null ? t('profit {p}/h', { p: `${s.profitPerHour < 0 ? '−' : ''}${gold(Math.abs(Math.round(s.profitPerHour)))}` }) : ''].filter(Boolean).join(' · ');
  const icon = { boss: '🐉', checklist: '☑️', event: '🎉', maintenance: '🛠', pass: '⏱', custom: '📌' };
  // what happens during the session, in order
  const during = (p.during || []).map((x) => `<div class="dp"><span class="mono">${hhmm(x.t)}</span><span>${icon[x.kind] || '•'}</span><span><b class="notr">${esc(t(x.title))}</b>${x.sub ? `<small class="notr">${esc(t(x.sub))}</small>` : ''}${x.coming?.length ? `<small>${t('coming: {names}', { names: esc(x.coming.join(', ')) })}</small>` : ''}</span><span></span></div>`).join('');
  $('plOut').innerHTML = (p.spots.length
    ? `${p.spots.map((s, i) => `<div class="recap"><b>${i + 1}. ${esc(s.zoneName)}</b>${risk(s.risk)} <span class="mono muted">${Math.round(s.x)}, ${Math.round(s.z)}</span> · ${t('about +{p}% EXP', { p: num(s.expected, 1) })} <span class="muted">(${t('{p}%/h measured over {d}', { p: num(s.expPerHour, 1), d: dur(s.minutes * 60000) })})</span>${money(s) ? `<div class="muted" style="font-size:12px">${money(s)}</div>` : ''} <button class="small" data-world="${s.zone}" data-wx="${s.x}" data-wz="${s.z}">3D</button></div>`).join('')}
      ${p.levelUp ? `<div class="muted" style="font-size:12px">${t('Enough for your next level at the best spot.')}</div>` : ''}
      ${p.route ? `<div class="muted" style="font-size:12px">${t('Way there')}: ${p.route.legs.map((l) => esc(l.label)).join(' → ')}</div>` : ''}`
    : `<div class="muted" style="font-size:12px">${t('No farming spots measured yet: farm 5 minutes or more somewhere with the screen reader on. Until then, see Guide → Leveling plan.')}</div>`)
    + (p.guideSpot ? `<div class="muted" style="font-size:12px;margin-top:6px">💡 ${t('With a pass: {name} (levels {a}–{b}, {note})', { name: `<b class="notr">${esc(p.guideSpot.name)}</b>`, a: p.guideSpot.levels[0], b: p.guideSpot.levels[1], note: esc(t(p.guideSpot.note)) })}</div>` : '')
    + (during ? `<h3 style="margin:10px 0 4px;font-size:12px">${t('During your session')}</h3>${during}` : '');
};

// ---- what kills you (Stats → Farming)
async function loadDeathWhy() {
  const a = await getJSON('/api/death-analysis');
  if (!a.total) { $('fmDeathWhy').innerHTML = ''; return; }
  const hh = (h) => `${String(h).padStart(2, '0')}:00`;
  $('fmDeathWhy').innerHTML = [
    a.zones[0] && `${t('Most in {zone}', { zone: `<b class="notr">${esc(a.zones[0].name)}</b>` })} (${a.zones[0].n}×)`,
    a.worstHour != null && t('mostly around {h}', { h: hh(a.worstHour) }),
    a.alone != null && t('{a} alone, {p} in a party', { a: a.alone, p: a.inParty }),
    a.players[0] && `${t('often near')}: <span class="notr">${a.players.slice(0, 3).map((p) => `${esc(p.name)} (${p.n}×)`).join(', ')}</span>`,
    a.monsters[0] && `${t('targeting')}: <span class="notr">${a.monsters.slice(0, 3).map((m) => `${esc(m.name)} (${m.n}×)`).join(', ')}</span>`,
  ].filter(Boolean).map((x) => `<div>${x}</div>`).join('');
}

// ---- your house: who was seen on which of the last 14 days
async function loadHouseActivity(name) {
  const h = await getJSON(`/api/house-activity?name=${encodeURIComponent(name || '')}`);
  if (!h?.members?.length) { $('hsActivity').innerHTML = `<div class="empty">${t('Pick a house above.')}</div>`; return; }
  const day = (d) => new Date(`${d}T12:00:00`).toLocaleDateString([], { weekday: 'narrow' });
  $('hsActivity').innerHTML = `<div class="scroll" style="max-height:420px"><table class="actgrid"><thead><tr><th>${t('Member')}</th>${h.days.map((d) => `<th title="${d}">${day(d)}</th>`).join('')}<th class="num">${t('Days')}</th><th class="num">${t('Levels (7 days)')}</th><th>${t('Last seen')}</th></tr></thead><tbody>
    ${h.members.map((m) => `<tr class="click" data-player="${esc(m.name)}"><td class="notr">${esc(m.name)}${m.level ? ` <span class="muted">${m.level}</span>` : ''}</td>${m.seenDays.map((s, i) => `<td><i class="act ${s ? 'on' : ''}" title="${h.days[i]}"></i></td>`).join('')}<td class="num">${m.daysSeen}</td><td class="num">${m.gain ? `+${m.gain}` : m.gain === 0 ? '0' : '—'}</td><td class="muted">${m.lastSeen ? dateTime(m.lastSeen) : t('not seen')}</td></tr>`).join('')}</tbody></table></div>`;
}

// ---- death replays and drop pictures (Stats tab)
let shotView = null;
async function loadShots() {
  const r = await getJSON('/api/shots');
  $('shDeaths').innerHTML = r.deaths.map((d) => `<div class="recap click" data-replay="${esc(d.id)}" data-frames="${d.frames}" data-times="${esc((d.times || []).join(','))}"><span class="muted">${dateTime(d.t)}</span> ${esc(d.zoneName || '')} · ${t('{n} pictures', { n: d.frames })}${d.enemies?.length ? `<div class="muted notr" style="font-size:11px">${esc(d.enemies.join(', '))}</div>` : ''}</div>`).join('')
    || `<div class="empty">${t('When you die, the last 30 seconds the screen reader saw are kept here.')}</div>`;
  $('shDrops').innerHTML = r.drops.map((d) => `<figure class="click" data-shot="${esc(d.id)}"><img loading="lazy" src="/shots/${esc(d.id)}.jpg" alt=""><figcaption><b class="notr">${esc(d.item)}</b><small class="notr">${esc(d.who)} · ${esc(d.from)}</small><small>${dateTime(d.t)}</small></figcaption></figure>`).join('')
    || `<div class="empty">${t('Announced drops of you, your party and friends get a picture here.')}</div>`;
}
function showShot(i) {
  const v = shotView;
  v.i = Math.max(0, Math.min(v.frames.length - 1, i));
  $('shImg').src = v.frames[v.i];
  $('shPos').max = v.frames.length - 1; $('shPos').value = v.i;
  $('shTime').textContent = v.times[v.i] ? clock(v.times[v.i]) : `${v.i + 1} / ${v.frames.length}`;
}
function openShots(frames, times) {
  clearInterval(shotView?.timer);
  shotView = { frames, times, i: 0, timer: 0 };
  $('shViewer').hidden = false; $('shPlay').hidden = $('shPos').hidden = frames.length < 2;
  showShot(0);
  $('shViewer').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
document.addEventListener('click', (e) => {
  const rp = e.target.closest('[data-replay]');
  if (rp) { const n = +rp.dataset.frames; openShots(Array.from({ length: n }, (_, i) => `/shots/${rp.dataset.replay}/${String(i + 1).padStart(2, '0')}.jpg`), rp.dataset.times.split(',').map(Number)); return; }
  const sh = e.target.closest('[data-shot]');
  if (sh) openShots([`/shots/${sh.dataset.shot}.jpg`], []);
});
$('shPos').addEventListener('input', () => showShot(+$('shPos').value));
$('shPlay').onclick = () => {
  const v = shotView; if (!v) return;
  if (v.timer) { clearInterval(v.timer); v.timer = 0; $('shPlay').textContent = '▶'; return; }
  if (v.i >= v.frames.length - 1) showShot(0);
  $('shPlay').textContent = '❚❚';
  v.timer = setInterval(() => { if (v.i >= v.frames.length - 1) { clearInterval(v.timer); v.timer = 0; $('shPlay').textContent = '▶'; return; } showShot(v.i + 1); }, 700);
};
$('shClose').onclick = () => { clearInterval(shotView?.timer); shotView = null; $('shViewer').hidden = true; };
// usual prices from trade messages in the chat
async function loadMarket() {
  const r = await getJSON('/api/market');
  $('mkInfo').textContent = r.total ? t('{n} trade offers read from the chat', { n: r.total }) + (r.fromFriends ? ` · ${t('{n} from friends', { n: r.fromFriends })}` : '') : t('from trade messages in the chat, read by the screen reader');
  $('mkStats').innerHTML = r.stats.map((s) => `<tr><td><b class="click notr" data-item="${s.itemId}">${esc(s.item)}</b></td><td class="num">${gold(s.sell)}</td><td class="num">${gold(s.buy)}</td><td class="num">${s.offers}</td></tr>`).join('')
    || `<tr><td colspan="4" class="empty">${t('With the screen reader on, prices from WTS / WTB messages in the chat collect here.')}</td></tr>`;
  $('mkRecent').innerHTML = r.recent.slice(0, 80).map((o) => `<tr><td class="muted" style="white-space:nowrap">${dateTime(o.t)}</td><td class="notr">${esc(o.who)}${o.from ? ` <span class="tag" title="${esc(t('read by {name}\'s tracker', { name: o.from }))}">${esc(o.from)}</span>` : ''}</td>
    <td class="notr" style="font-size:12px"><span class="tag">${o.side === 'sell' ? t('selling') : t('buying')}</span> ${o.deal ? `<span class="tag deal" title="${esc(t('compared with the usual price of the last 30 days'))}">${o.side === 'sell' ? t('{p}% cheaper', { p: o.deal }) : t('{p}% more', { p: o.deal })}</span> ` : ''}${o.itemId ? `<b class="click" data-item="${o.itemId}">${esc(o.item)}</b> ` : ''}${o.price ? `<b>${gold(o.price)}</b> ` : ''}<span class="muted">${esc(o.raw)}</span></td></tr>`).join('');
  loadFlips();
}
// market flips: buyers in the chat paying more than sellers ask, or sellers asking less than an NPC pays
async function loadFlips() {
  const r = await getJSON('/api/market-flips').catch(() => null);
  $('mfRows').innerHTML = (r?.flips || []).map((f) => `<tr><td><b class="click notr" data-item="${f.itemId}">${esc(f.item)}</b></td>
    <td style="font-size:12px">${f.kind === 'chat' ? t('buy from a seller, sell to a buyer') : t('buy from a seller, sell to an NPC')}</td>
    <td class="num">${gold(f.buyAt)}</td><td class="num">${gold(f.sellAt)}</td><td class="num good">+${gold(f.margin)} <small class="muted">(${f.pct}%)</small></td><td class="num">${f.offers}</td><td>${sparkLine(f.history)}</td></tr>`).join('')
    || `<tr><td colspan="7" class="empty">${t('No flips yet: they show up once the chat has offers from both sides (2+ each) for an item, or sellers below the NPC price.')}</td></tr>`;
}
// kills, deaths and best farming spots (Stats tab)
async function loadFarming() {
  const [r, fc] = await Promise.all([getJSON('/api/farming'), getJSON('/api/level-forecast')]);
  loadDeathWhy();
  // when the next level comes, at the pace of the last 7 days
  $('fmForecast').innerHTML = fc.perHour ? `<div><label>${t('Next level')}</label><b>${fc.etaAt ? dateTime(fc.etaAt) : '—'}</b><small>${fc.etaMs != null ? t('in about {d}', { d: dur(fc.etaMs) }) : ''}</small></div>
    <div><label>${t('EXP per hour played')}</label><b>${num(fc.perHour, 1)}%</b><small>${t('{n} sessions, last 7 days', { n: fc.sessions })}</small></div>
    <div><label>${t('Played per day')}</label><b>${dur(fc.hoursPerDay * 3600000)}</b><small>${fc.playHoursLeft != null ? t('{d} of play to go', { d: dur(fc.playHoursLeft * 3600000) }) : ''}</small></div>
    ${fc.levels.length ? `<div><label>${t('Recent levels took')}</label><b>${fc.levels.slice(0, 4).map((l) => dur(l.ms)).join(' · ')}</b><small>${t('time between level-ups')}</small></div>` : ''}`
    : `<div class="muted" style="font-size:12px">${t('The level forecast starts after some play with the screen reader on: it needs your EXP per hour.')}</div>`;
  $('fmInfo').textContent = r.kills ? t('{n} kills counted · {d} deaths', { n: num(r.kills), d: r.deaths.length }) : t('kills, deaths and your best spots, from the screen reader');
  // the potions you drink, for what a spot costs per hour
  const potOpts = (kind, cur) => r.potions.filter((p) => p[kind]).map((p) => `<option ${p.name === cur ? 'selected' : ''} value="${esc(p.name)}">${esc(p.name)}${p.price ? ` · ${gold(p.price)}${p.from === 'chat' ? ' (chat)' : ''}` : ''}</option>`).join('');
  if (document.activeElement !== $('fmPotHp')) $('fmPotHp').innerHTML = potOpts('hp', r.potionHp);
  if (document.activeElement !== $('fmPotMp')) $('fmPotMp').innerHTML = potOpts('mp', r.potionMp);
  // found in the character's own setup in the game files (auto-combat / skill bar): that one is used, not the picker
  $('fmPotAuto').textContent = r.potionAuto?.hp || r.potionAuto?.mp ? t('Read from this character’s own setup in the game: {what}', { what: [r.potionAuto.hp && t('HP potion'), r.potionAuto.mp && t('MP potion')].filter(Boolean).join(', ') }) : '';
  const pots = (s) => [s.hpPots >= 0.5 && `${num(s.hpPots)} HP`, s.mpPots >= 0.5 && `${num(s.mpPots)} MP`].filter(Boolean).join(' · ') || '—';
  $('fmSpots').innerHTML = r.best.map((s) => `<tr><td class="notr">${esc(s.zoneName)}</td><td class="num mono">${Math.round(s.x)}, ${Math.round(s.z)}</td><td class="num">${num(s.expPerHour, 1)}%</td><td class="num">${num(s.killsPerHour)}</td>
    <td class="num">${pots(s)}</td><td class="num">${s.costPerHour ? gold(Math.round(s.costPerHour)) : '—'}</td>
    <td class="num">${s.lootPerHour ? gold(Math.round(s.lootPerHour)) : s.drops ? `<span class="muted" title="${esc(t('no chat price yet'))}">${s.drops}×</span>` : '—'}</td>
    <td class="num ${s.profitPerHour > 0 ? 'sure' : s.profitPerHour < 0 ? 'risky' : ''}">${s.profitPerHour != null ? `${s.profitPerHour < 0 ? '−' : ''}${gold(Math.abs(Math.round(s.profitPerHour)))}` : '—'}</td>
    <td class="num">${s.expPerMillion ? `${num(s.expPerMillion, 1)}%` : '—'}</td><td class="num">${dur(s.minutes * 60000)}</td>
    <td><button class="small" data-world="${s.zone}" data-wx="${s.x}" data-wz="${s.z}">3D</button></td></tr>`).join('')
    || `<tr><td colspan="11" class="empty">${t('With the screen reader on, every kill is counted where you are. After 5 minutes of farming in a spot it shows up here, ranked by EXP per hour.')}</td></tr>`;
  const dc = r.deathCost;
  $('fmDeaths').innerHTML = (dc?.known ? `<div class="recap"><b>${t('Deaths in 30 days cost you {e}% of a level', { e: num(dc.exp, 2) })}</b>${dc.minutes ? ` <span class="muted">${t('about {t} of farming to earn back', { t: dur(dc.minutes * 60000) })}</span>` : ''}</div>` : '')
    + r.deaths.map((d) => `<div class="recap"><span class="muted">${dateTime(d.t)}</span> ${esc(d.zoneName)}${d.killer ? ` · <b class="bad notr click" data-player="${esc(d.killer)}">${t('killed by {who}', { who: esc(d.killer) })}</b>` : ''}${d.expLostPts ? ` <span class="bad">−${num(d.expLostPts)} EXP</span>` : ''}${d.expLost ? ` <span class="bad">−${num(d.expLost, 2)}% EXP</span>${d.earnBackMin ? ` <span class="muted">(${t('~{t} to earn back', { t: dur(d.earnBackMin * 60000) })})</span>` : ''}` : ''}${d.near.length ? `<div class="muted notr" style="font-size:11px">${esc(d.near.join(', '))}</div>` : ''}</div>`).join('') || `<div class="empty">${t('No deaths recorded.')}</div>`;
  loadMaze(); loadHonor(); loadAsc(); loadGoals(); loadGear(); loadCharStatus(); loadMobStats();
}

// your monsters: per type you fight, EXP per kill (exact, from the chat) and per hour, time per kill and damage per second
async function loadMobStats() {
  const r = await getJSON('/api/mob-stats').catch(() => null);
  const list = r?.mobs || [];
  $('mbInfo').textContent = list.length ? `${r.character} · ${t('{n} monster types', { n: list.length })}${r.gearAt ? ` · ${t('gear last changed {d}', { d: dateTime(r.gearAt) })}` : ''}` : t('EXP per kill and per hour, time per kill and your damage, per monster type you fight');
  $('mbRows').innerHTML = list.map((m) => `<tr><td class="notr"><b>${esc(m.name)}</b></td><td class="num">${m.level ?? '—'}</td><td class="num">${num(m.kills)}</td>
    <td class="num">${m.expPerKill ? num(m.expPerKill) : '—'}</td><td class="num">${m.expPerHour ? gold(m.expPerHour) : '<span class="muted">—</span>'}</td>
    <td class="num">${m.secPerKill != null ? `${num(m.secPerKill, 1)} s` : '—'}</td><td class="num">${m.dps ? num(m.dps) : '—'}</td>
    <td>${m.gear ? `<span class="${m.gear.after < m.gear.before ? 'good' : m.gear.after > m.gear.before ? 'bad' : ''}">${num(m.gear.before, 1)} s → ${num(m.gear.after, 1)} s</span>` : '<span class="muted">—</span>'}</td></tr>`).join('')
    || `<tr><td colspan="8" class="empty">${t('Fight with a monster targeted and the chat box open: each kill counts for its type, with the EXP the chat shows.')}</td></tr>`;
}
// your character from the Status window (C): stats with their change, skills per tab, what you can still learn
const STAT_LABELS = [['level', 'Level'], ['attack', 'Attack'], ['defense', 'Defense'], ['accuracy', 'Accuracy'], ['evasion', 'Evasion'], ['skillEvasion', 'Skill Evasion'],
  ['monAtk', 'Mon.Atk'], ['monDef', 'Mon.Def'], ['int', 'Int'], ['str', 'Str'], ['vit', 'Vit'], ['dex', 'Dex']];
async function loadCharStatus() {
  const r = await getJSON('/api/char-status').catch(() => null);
  if (!r || !r.seen) {
    $('chStats').innerHTML = `<div class="muted" style="font-size:12px">${t('Open the Status window (C) in the game with the screen reader on: Basic for your stats, then Skill and each of its tabs for your skills.')}</div>`;
    $('chSkills').innerHTML = ''; return;
  }
  $('chInfo2').textContent = [r.character, r.stats ? t('stats read {time}', { time: dateTime(r.stats.t) }) : null].filter(Boolean).join(' · ');
  const v = r.stats?.v || {}, first = r.history[0]?.v || {};
  const kpi = (label, val, sub = '') => `<div class="kpi"><label>${esc(t(label))}</label><div class="v">${val}</div><div class="sub">${sub || '&nbsp;'}</div></div>`;
  const delta = (k) => (v[k] != null && first[k] != null && v[k] !== first[k] ? `${v[k] > first[k] ? '▲' : '▼'} ${num(Math.abs(v[k] - first[k]))} ${t('since {d}', { d: dateOnly(r.history[0].t) })}` : '');
  const line = (k) => sparkLine(r.history.filter((p) => p.v[k] != null).map((p) => [p.t, p.v[k]]));
  $('chStats').innerHTML = r.stats ? `<div class="kpis">${STAT_LABELS.filter(([k]) => v[k] != null).map(([k, l]) => kpi(l, num(v[k]), delta(k))).join('')}</div>
    ${r.history.length > 1 ? `<div class="chlines">${['attack', 'defense', 'accuracy'].map((k) => `<span>${esc(t(STAT_LABELS.find((x) => x[0] === k)[1]))} ${line(k)}</span>`).join('')}</div>` : ''}`
    : `<div class="muted" style="font-size:12px">${t('Open the Basic page of the Status window once for your stats.')}</div>`;
  // the skills, per tab
  const h = r.header || {};
  const tabName = { ascension: 'Ascension', combat: 'Combat', support: 'Support' };
  const col = (name) => {
    const tb = r.tabs[name];
    if (!tb) return `<div class="chtab"><h3>${esc(t(tabName[name]))}</h3><div class="muted" style="font-size:12px">${t('not read yet: click this tab in the game')}</div></div>`;
    return `<div class="chtab"><h3>${esc(t(tabName[name]))} <small class="muted">${t('{n} skills', { n: tb.skills.length })}</small></h3>
      ${tb.skills.map((s) => `<div class="chskill"><span class="notr">${esc(s.name)}</span>${s.level != null ? ` <span class="tag ${s.level >= 10 ? 'good' : ''}">Lv ${s.level}</span>` : ''}${s.req ? ` <small class="muted">${t('from Lv {n}', { n: s.req })}</small>` : ''}${s.cooldown ? ` <small class="muted" title="${esc(t('cooldown, from the game data'))}">⏱ ${cdText(s.cooldown)}</small>` : ''}</div>`).join('')}</div>`;
  };
  $('chSkills').innerHTML = `<h3 style="margin:12px 0 4px">${t('Skills')} <small class="muted">${[h.asc != null && `ASC ${h.asc}`, h.ki != null && `Ki ${num(h.ki)}`, h.ap != null && `A.P ${num(h.ap)}`, r.ascCount ? t('{m} of {n} Ascension skills at level 10', { m: r.ascMaxed, n: r.ascCount }) : null].filter(Boolean).join(' · ')}</small></h3>
    <div class="chtabs">${['ascension', 'combat', 'support'].map(col).join('')}</div>
    ${r.missing == null ? `<div class="muted" style="font-size:12px">${t('Click all three skill tabs once in the game to see which skills you are missing.')}</div>`
      : r.missing.length ? `<details><summary><b>${t('Skills you could learn ({n})', { n: r.missing.length })}</b> <small class="muted">${t('your class, up to level {lv}, not in your skill window', { lv: r.level || '?' })}</small></summary>
        <table class="chmiss"><tbody>${r.missing.map((s) => `<tr><td class="num">Lv ${s.level}</td><td class="notr">${esc(s.name)}</td><td class="num muted">${s.cost ? gold(s.cost) : ''}</td></tr>`).join('')}</tbody></table></details>`
      : `<div class="good" style="font-size:13px">✓ ${t('You have every skill of your class up to your level.')}</div>`}`;
}
// the gear log (Stats tab): one row per slot of the character the dashboard shows
async function loadGear() {
  const r = await getJSON('/api/gear');
  $('geInfo').textContent = r.items.length ? t('{n} pieces of gear · {char}', { n: r.items.length, char: r.char || '?' }) : t('from the item tooltips the screen reader sees while you hover over your gear');
  // gold (read from the open inventory) and the bag's weight
  const kpi = (label, v, sub = '') => `<div class="kpi"><label>${esc(label)}</label><div class="v">${v}</div><div class="sub">${sub || '&nbsp;'}</div></div>`;
  const signed = (v) => (v == null ? '—' : `${v >= 0 ? '+' : '−'}${gold(Math.abs(Math.round(v)))}`);
  const gd = r.gold;
  $('geGold').innerHTML = gd?.last ? [kpi(t('Gold'), gold(gd.last.gold), t('read {time}', { time: dateTime(gd.last.t) })),
    kpi(t('This session'), signed(gd.session?.change), gd.session ? t('{h} per hour', { h: signed(gd.session.perHour) }) : ''),
    kpi(t('Last 24 hours'), signed(gd.day)), kpi(t('Last 7 days'), signed(gd.week)),
    r.weight ? kpi(t('Bag weight'), `${num(r.weight.pct, 1)}%`, `${num(r.weight.cur)} / ${num(r.weight.max)}`) : '',
    // net worth: gold plus gear at chat prices, with its change since the first point
    r.netWorth?.gold != null ? kpi(t('Net worth'), gold(r.netWorth.gold + r.netWorth.gear), [t('gear {g} ({p} of {n} pieces priced)', { g: gold(r.netWorth.gear), p: r.netWorth.priced, n: r.netWorth.pieces }),
      r.netWorth.history.length > 1 ? signed(r.netWorth.history[r.netWorth.history.length - 1][1] - r.netWorth.history[0][1]) + ` ${t('since {d}', { d: dateOnly(r.netWorth.history[0][0]) })}` : ''].filter(Boolean).join(' · ')) : ''].join('')
    : `<div class="muted" style="font-size:12px">${t('Gold shows here once the screen reader has seen your inventory open.')}</div>`;
  // the cheapest upgrade: +1 for each piece, by chance × what it's worth in the chat
  const up = r.upgrades.slice(0, 5);
  $('geUpg').innerHTML = up.length ? `<h3 style="margin:8px 0 4px">${t('Next +1, best first')} <small class="muted">${t('high-grade charm odds (yours where you logged 5+ tries); worth = chat price difference')}</small></h3>
    ${up.map((u) => `<div style="font-size:13px"><b class="notr">${esc(u.name)}</b> +${u.plus} → +${u.to}: <b>${num(u.chance * 100)}%</b>${u.tries ? ` · ~${num(u.tries, 1)} ${t('tries')}` : ''}${u.risky ? ` · <span style="color:var(--crimson)">${t('can break')}</span>` : ''}${u.gain != null ? ` · ${t('worth {g}', { g: signed(u.gain) })}` : ''}</div>`).join('')}` : '';
  // enchanting and combining: your own success rates (last 30 days, from the game's messages)
  const cr = r.craft || {}, crLine = [['enchant', 'Enchanting'], ['combine', 'Combining']].filter(([k]) => cr[k]?.n).map(([k, l]) => t('{what}: {ok} of {n} worked ({p}%)', { what: t(l), ok: cr[k].ok, n: cr[k].n, p: Math.round((cr[k].ok / cr[k].n) * 100) }));
  if (crLine.length) $('geUpg').innerHTML += `<div style="font-size:13px;margin-top:6px">${crLine.join(' · ')} <small class="muted">${t('last 30 days')}</small></div>`;
  // the enhance budget: how many tries your gold covers with your charm, and the chance for each +1
  const bd = r.budget;
  if (bd?.tries != null) $('geUpg').innerHTML += `<div class="budget"><b>${t('Enhance budget')}</b> <small class="muted">${t('{gold} covers {n} tries with {charm} ({p} each, {from})', { gold: gold(bd.gold), n: num(bd.tries), charm: `<span class="notr">${esc(bd.charm)}</span>`, p: gold(bd.price), from: t(bd.priceFrom === 'chat' ? 'chat price' : 'NPC price') })}</small>
    ${bd.plan.map((p) => `<div style="font-size:13px"><b class="notr">${esc(p.name)}</b> +${p.plus} → +${p.to}: ${p.risky ? `<span style="color:var(--crimson)">${t('one try, {c}% (a fail breaks it)', { c: num(p.chance * 100) })}</span>` : bd.tries >= 1 ? t('{c}% to get it within your budget', { c: num(p.reach * 100) }) : t('not enough gold for one try')}${p.triesNeeded ? ` <span class="muted">· ${t('~{n} tries on average', { n: p.triesNeeded })}</span>` : ''}</div>`).join('')}</div>`;
  else if (bd && !bd.gold) $('geUpg').innerHTML += `<div class="muted" style="font-size:12px">${t('Enhance budget: open your inventory in the game so the tracker can read your gold.')}</div>`;
  // "All abilities +2" four times → "All abilities +2 ×4"
  const group = (list) => Object.entries(list.reduce((a, o) => { a[o] = (a[o] || 0) + 1; return a; }, {})).map(([o, n]) => `${esc(o)}${n > 1 ? ` ×${n}` : ''}`).join('<br>');
  $('geRows').innerHTML = r.items.map((g) => `<tr><td>${esc(t(g.slotName || '—'))}</td>
    <td>${g.itemId ? `<b class="click notr" data-item="${g.itemId}">${esc(g.name)}</b>` : `<b class="notr">${esc(g.name)}</b>`}<div class="muted" style="font-size:11px">${[g.level && `Lv ${g.level}`, g.cls, g.faction && t(g.faction), g.attack && `${t('Attack')} ${g.attack[0]}–${g.attack[1]}`, g.defense && `${t('Defense')} ${g.defense}`].filter(Boolean).map(esc).join(' · ')}</div></td>
    <td class="num"><b>${g.plus ? `+${g.plus}` : '—'}</b></td><td style="font-size:12px">${group(g.options) || '<span class="muted">—</span>'}</td>
    <td style="font-size:12px">${[g.element && `${esc(t(g.element.name))} ${g.element.level}${g.element.bonus ? `+${g.element.bonus}` : ''}`, g.souled != null && t('awakened +{n}', { n: g.souled })].filter(Boolean).join('<br>') || '<span class="muted">—</span>'}</td>
    <td class="notr" style="font-size:12px">${g.extras.map(esc).join('<br>') || '<span class="muted">—</span>'}</td>
    <td class="num" style="font-size:12px">${g.price?.sell ? `~${gold(g.price.sell)}` : g.price?.buy ? `<span class="muted">${t('wanted')} ${gold(g.price.buy)}</span>` : '<span class="muted">—</span>'}${g.priceNext?.sell ? `<div class="muted">+${g.plus + 1}: ~${gold(g.priceNext.sell)}</div>` : ''}</td>
    <td style="font-size:12px">${g.history.length > 1 ? g.history.map((h) => `+${h.plus} <span class="muted">${dateOnly(h.t)}</span>`).join(' → ') : '<span class="muted">—</span>'}</td>
    <td class="muted" style="font-size:12px">${dateTime(g.lastSeen)}</td><td><button class="small" data-ge-del="${esc(g.key)}">×</button></td></tr>`).join('')
    || `<tr><td colspan="10" class="empty">${t('Nothing read yet. Open your inventory and rest the mouse on each piece of gear for 2–3 seconds with the screen reader on.')}</td></tr>`;
  // gear goals: the item you want per slot (set with 🎯 in Guide → Gear advisor)
  const goals = r.goals || [];
  const missing = goals.filter((g) => !g.have), cost = missing.reduce((s, g) => s + (g.price || 0), 0);
  $('geGoals').innerHTML = goals.length ? `<h3 style="margin:12px 0 4px">${t('Gear goals')} <small class="muted">${t('{n} still to get', { n: missing.length })}${cost ? ` · ${t('about {g} at chat prices', { g: gold(cost) })}` : ''}</small></h3>
    ${goals.map((g) => `<div class="goalrow ${g.have ? 'done' : ''}"><span class="tag">${esc(t(g.kind))}</span> <b class="click notr" data-item="${g.itemId}">${esc(g.name)}</b> <span class="muted">Lv ${g.level}</span>
      ${g.have ? `<span class="good">✓ ${t('you have it')}</span>` : `<span class="muted">${g.current ? t('now: {x}', { x: esc(g.current) }) : t('nothing read for this slot')}</span> ${g.price ? `<b>~${gold(g.price)}</b>` : `<span class="muted">${t('no chat price yet')}</span>`} ${sparkLine(g.history)}`}
      <button class="small" data-goal-kind="${esc(g.kind)}" data-goal-id="" title="${esc(t('Remove this goal'))}">×</button></div>`).join('')}`
    : `<div class="muted" style="font-size:12px;margin-top:8px">${t('Gear goals: pick the item you want for a slot with 🎯 in Guide → Gear advisor; the tracker shows what it costs and alerts you when it is offered.')}</div>`;
  loadGearScore(); loadGoldLedger();
}
// 🎯 in the gear advisor (set) and × in the goals list (remove)
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-goal-kind]'); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  const r = await post('/api/gear-goals', { kind: b.dataset.goalKind, itemId: b.dataset.goalId ? +b.dataset.goalId : null });
  if (!r.ok) { toast({ kind: 'danger', title: t('Could not set the goal') }); return; }
  toast({ kind: 'buff', title: b.dataset.goalId ? t('Gear goal set: {x}', { x: b.dataset.goalName || '' }) : t('Gear goal removed') });
  loadGear();
}, true); // capture: before the item card's own click opens the item
// a small price line ([[t, v]]), lowest point marked; the title says first → last
function sparkLine(h, W = 110, H = 24) {
  if (!h || h.length < 2) return '';
  const t0 = h[0][0], t1 = h[h.length - 1][0], lo = Math.min(...h.map((p) => p[1])), hi = Math.max(...h.map((p) => p[1]));
  const x = (t) => ((t - t0) / Math.max(1, t1 - t0)) * (W - 4) + 2, y = (v) => H - 3 - ((v - lo) / Math.max(1, hi - lo)) * (H - 6);
  const low = h.find((p) => p[1] === lo);
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><title>${esc(`${gold(h[0][1])} → ${gold(h[h.length - 1][1])} · ${t('lowest {p}', { p: gold(lo) })}`)}</title>
    <polyline points="${h.map((p) => `${x(p[0])},${y(p[1])}`).join(' ')}" fill="none" stroke="var(--gold)" stroke-width="2" stroke-linejoin="round"/><circle cx="${x(low[0])}" cy="${y(lo)}" r="2.5" fill="var(--jade)"/></svg>`;
}
// gear score: one rough number for what you wear (attack / defense raised by + level, options, element, awakening)
async function loadGearScore() {
  const r = await getJSON('/api/gear-score').catch(() => null);
  if (!r || !r.score) { $('geScore').innerHTML = ''; return; }
  const h = r.history || [];
  const prev = h.length > 1 ? h[h.length - 2][1] : null;
  // the score over time: a small line
  let spark = '';
  if (h.length > 1) {
    const W = 220, H = 36, t0 = h[0][0], t1 = h[h.length - 1][0] || t0 + 1, lo = Math.min(...h.map((p) => p[1])), hi = Math.max(...h.map((p) => p[1]));
    const pts = h.map((p) => `${((p[0] - t0) / Math.max(1, t1 - t0)) * W},${H - 3 - ((p[1] - lo) / Math.max(1, hi - lo)) * (H - 6)}`).join(' ');
    spark = `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><polyline points="${pts}" fill="none" stroke="var(--gold)" stroke-width="2" stroke-linejoin="round"/></svg>`;
  }
  const others = [...(r.chars || []).filter((c) => c.char.toLowerCase() !== String(r.char || '').toLowerCase()).map((c) => ({ ...c, from: null })), ...(r.friends || [])].sort((a, b) => b.score - a.score);
  $('geScore').innerHTML = `<h3 style="margin:12px 0 4px">${t('Gear score')} <small class="muted">${t('a rough sum: attack / defense raised by the + level, options, element and awakening')}</small></h3>
    <div class="gscore"><div class="kpi"><label>${esc(r.char || '?')}</label><div class="v">${num(r.score)}</div><div class="sub">${prev != null ? `${r.score >= prev ? '▲' : '▼'} ${num(Math.abs(r.score - prev))} ${t('since the last change')}` : '&nbsp;'}</div></div>${spark}
    <div class="gscore-pieces">${r.pieces.map((p) => `<span class="tag" title="${esc(p.name)}">${esc(t(p.slot))} ${p.plus ? `+${p.plus}` : ''} · ${num(p.score)}</span>`).join(' ')}</div></div>
    ${others.length ? `<div class="gscore-others">${others.map((o) => `<div><b class="notr">${esc(o.char)}</b>${o.from ? ` <span class="muted">(${esc(o.from)})</span>` : ''} <span class="num">${num(o.score)}</span> <span class="${o.score > r.score ? 'bad' : 'good'}" style="font-size:12px">${o.score > r.score ? '+' : '−'}${num(Math.abs(o.score - r.score))}</span></div>`).join('')}</div>` : ''}`;
}
// the gold ledger: each change of gold between two looks at the inventory, sorted into what it probably was
let ledgerDays = 7;
async function loadGoldLedger() {
  const r = await getJSON(`/api/gold-ledger?days=${ledgerDays}`).catch(() => null);
  if (!r || !r.rows?.length) { $('geLedger').innerHTML = ''; return; }
  const signed = (v) => `${v >= 0 ? '+' : '−'}${gold(Math.abs(Math.round(v)))}`;
  const cats = Object.entries(r.cats).sort((a, b) => (b[1].in + b[1].out) - (a[1].in + a[1].out));
  $('geLedger').innerHTML = `<h3 style="margin:12px 0 4px">${t('Gold ledger')} <small class="muted">${t('gold changes between two looks at your inventory, sorted into what they probably were')}</small>
      <span class="seg small" id="glDays">${[1, 7, 30].map((d) => `<button class="small ${d === ledgerDays ? 'on' : ''}" data-gl-days="${d}">${d === 1 ? t('Today') : t('{n} days', { n: d })}</button>`).join('')}</span></h3>
    <div class="kpis"><div class="kpi"><label>${t('Earned')}</label><div class="v good">${signed(r.income)}</div></div><div class="kpi"><label>${t('Spent')}</label><div class="v bad">${signed(-r.spent)}</div></div><div class="kpi"><label>${t('Net')}</label><div class="v">${signed(r.net)}</div></div>${r.lootChat ? `<div class="kpi"><label>${t('Picked up')}</label><div class="v good">+${gold(r.lootChat)}</div><div class="sub">${t('exact, from "Gold obtained" in the chat')}</div></div>` : ''}</div>
    <table class="ledger"><thead><tr><th>${t('What')}</th><th class="num">${t('In')}</th><th class="num">${t('Out')}</th></tr></thead><tbody>
      ${cats.map(([c, v]) => `<tr><td>${esc(t(c))}</td><td class="num good">${v.in ? signed(v.in) : '—'}</td><td class="num bad">${v.out ? signed(-v.out) : '—'}</td></tr>`).join('')}</tbody></table>
    <details><summary class="muted" style="font-size:12px">${t('Per day and every change')}</summary>
      <table class="ledger"><tbody>${r.days.map((d) => `<tr><td>${esc(d.day)}</td><td class="num good">${signed(d.in)}</td><td class="num bad">${signed(-d.out)}</td><td class="num"><b>${signed(d.in - d.out)}</b></td></tr>`).join('')}</tbody></table>
      <div class="scroll" style="max-height:220px"><table class="ledger"><tbody>${r.rows.map((x) => `<tr><td class="muted">${dateTime(x.t)}</td><td class="num ${x.change > 0 ? 'good' : 'bad'}">${signed(x.change)}</td><td>${esc(t(x.cat))}${x.trade ? ` <span class="muted notr">${esc(x.trade)}</span>` : ''}</td><td class="num muted">${gold(x.gold)}</td></tr>`).join('')}</tbody></table></div></details>`;
}
$('geLedger').addEventListener('click', (e) => { const b = e.target.closest('[data-gl-days]'); if (!b) return; ledgerDays = +b.dataset.glDays; loadGoldLedger(); });
$('geClean').onclick = async () => {
  const r = await (await post('/api/gear', { action: 'clean' })).json();
  toast({ kind: 'buff', title: t('{n} rows removed', { n: r.removed || 0 }) });
  loadGear();
};
$('geRows').addEventListener('click', async (e) => { const d = e.target.closest('[data-ge-del]'); if (!d) return; await post('/api/gear', { action: 'delete', key: d.dataset.geDel }); loadGear(); });

// Honor (Stats tab): your Honor from the rankings against the Korean guide's Honor ranks
async function loadHonor() {
  const h = await getJSON('/api/honor');
  if (!h.found || h.honor == null) { $('hoBody').innerHTML = `<div class="empty">${h.name ? t('{name} has no Honor in the rankings yet.', { name: esc(h.name) }) : t('Your Honor shows here once your character is in the rankings.')}</div>`; return; }
  $('hoInfo').textContent = h.name;
  const n = h.next;
  $('hoBody').innerHTML = `<div class="kpis" style="margin-bottom:10px"><div class="kpi"><label>${t('Honor')}</label><div class="v">${num(h.honor)}</div><div class="sub">${t('rank {n}', { n: h.rank })}</div></div>
    <div class="kpi"><label>${t('Per day')}</label><div class="v">${h.perDay != null ? num(h.perDay) : '—'}</div><div class="sub">${t('last 7 days')}</div></div>
    <div class="kpi"><label>${t('Next rank')}</label><div class="v">${n ? t('rank {n}', { n: n.rank }) : '—'}</div><div class="sub">${n ? (h.etaDays ? t('in about {n} days', { n: h.etaDays }) : t('{n} to go', { n: num(n.toGo) })) : t('highest rank')}</div></div></div>
    ${n ? `<div class="bar"><i style="width:${n.pct}%"></i></div><p class="muted" style="font-size:12px">${t('{n} more Honor for rank {r}: {bonus}', { n: num(n.toGo), r: n.rank, bonus: esc(t(n.bonus)) })}</p>` : ''}
    <p class="muted" style="font-size:12px">${t('Now: {bonus}. The bonuses only count while the Honor title is on (status window, Ctrl+S). At most 1,000 Honor a day.', { bonus: esc(t(h.bonus)) })}</p>
    ${h.pillWeek || h.pvpKillsWeek ? `<p style="font-size:12px">${[h.pvpKillsWeek && t('{n} players defeated this week', { n: h.pvpKillsWeek }), h.pillWeek && t('{n} Honor from Honor Pills this week', { n: num(h.pillWeek) })].filter(Boolean).join(' · ')}</p>` : ''}`;
}
// next Ascension (Stats tab): what it needs and what you have
async function loadAsc(data) {
  const a = data || await getJSON('/api/asc');
  for (const [id, k] of [['asAsc', 'asc'], ['asGold', 'gold'], ['asKi', 'ki'], ['asStones', 'stones']]) if (document.activeElement !== $(id)) $(id).value = String(a.have?.[k] ?? '');
  if (a.done) { $('asBody').innerHTML = `<div class="empty">${t('ASC 7 is the last Ascension.')}</div>`; return; }
  const nx = a.next, row = (label, p, fmt = num) => (p ? `<div class="row"><span>${label}</span><span class="mono">${fmt(p.have)} / ${fmt(p.need)}</span></div><div class="bar ${p.pct >= 100 ? '' : 'low'}"><i style="width:${p.pct}%"></i></div>` : '');
  const lv = a.level;
  $('asBody').innerHTML = `<h3 style="margin:8px 0 4px">ASC ${nx.asc} ${a.ready ? '· ✓ ' + t('ready') : ''}</h3>
    <div class="row"><span>${t('Level')}</span><span class="mono">${lv.have ?? '?'} / ${lv.need}</span></div>
    <p class="muted" style="font-size:12px;margin:2px 0 8px">${lv.toGo === 0 ? t('Level reached.') : lv.hours != null ? t('{n} levels to go: about {h} hours of play at your recent pace', { n: lv.toGo, h: num(lv.hours) }) : lv.toGo != null ? t('{n} levels to go', { n: lv.toGo }) : t('Your level shows once your character is in the rankings.')}</p>
    ${row(t('Gold'), a.gold, gold)}${row('Ki', a.ki, gold)}
    ${a.kiPerHour ? `<p class="muted" style="font-size:12px;margin:2px 0 8px">${t('{k} Ki per hour from "Ki obtained" in the chat', { k: gold(a.kiPerHour) })}${a.kiHours ? ` · ${t('enough Ki in about {h} hours of play', { h: num(a.kiHours, 1) })}` : a.kiHours === 0 ? ` · ${t('Ki: done')}` : ''}</p>` : ''}
    ${row(t('Sky Stones'), a.stones)}
    <p class="muted" style="font-size:12px">${t('Needs {x}.', { x: esc(t(nx.needs)) })} ${esc(nx.quest)}</p>
    <p class="muted" style="font-size:11px">${t('Costs from the Korean guide book; Scions of Fate can differ.')}</p>`;
}
for (const id of ['asAsc', 'asGold', 'asKi', 'asStones']) $(id).addEventListener('change', async () => {
  const r = await post('/api/asc', { asc: +$('asAsc').value, gold: +$('asGold').value || 0, ki: +$('asKi').value || 0, stones: +$('asStones').value || 0 });
  loadAsc(await r.json());
});
for (const [id, key] of [['fmPotHp', 'potionHp'], ['fmPotMp', 'potionMp']]) $(id).addEventListener('change', async () => { await saveSettings({ [key]: $(id).value }); loadFarming(); });

// Tiger Valley maze runs (Stats tab): shown once you've been in the maze
async function loadMaze() {
  const m = await getJSON('/api/maze');
  $('mazePanel').hidden = !m.runs.length && !m.current && !m.parts.length;
  const deep = (r) => [t('formation'), t('inner barrier 1–4'), t('inner barrier 5–6'), t('hidden zone 7')][r.deepest] || '';
  const row = (r, now) => `<tr${now ? ' class="here-row"' : ''}><td>${now ? `<b>${t('now')}</b>` : dateTime(r.start)}</td><td class="num">${dur(r.minutes * 60000)}</td><td class="num">${num(r.exp, 1)}%</td><td class="num">${num(r.expPerHour, 1)}%</td>
    <td class="num">${r.kills}</td><td class="num">${r.deaths}</td><td>${esc(deep(r))}</td></tr>`;
  $('mzRuns').innerHTML = [m.current && row(m.current, true), ...m.runs.map((r) => row(r))].filter(Boolean).join('') || `<tr><td colspan="7" class="empty">${t('No runs yet.')}</td></tr>`;
  $('mzParts').innerHTML = m.parts.length ? `<table><tbody>${m.parts.map((p) => `<tr><td class="notr">${esc(p.name)}</td><td>${p.effects.map((e) => esc(t(e.label))).join(', ') || '<span class="muted">—</span>'}</td></tr>`).join('')}</tbody></table>`
    : `<div class="empty">${t('The debuffs the screen reader sees in each part show up here.')}</div>`;
}
// loot announcements read from the chat by the screen reader
async function loadDrops() {
  const r = await getJSON('/api/drops');
  $('drInfo').textContent = r.total ? t('{n} announcements read from the chat', { n: r.total }) : t('read from the chat by the screen reader');
  const item = (name, id) => (id ? `<b class="click notr" data-item="${id}">${esc(name)}</b>` : `<b class="notr">${esc(name)}</b>`);
  $('drItems').innerHTML = r.items.map((x) => `<tr><td>${item(x.item, x.itemId)}</td><td class="num">${x.count}</td><td class="notr muted" style="font-size:12px">${esc(Object.entries(x.from).sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f}${n > 1 ? ` ×${n}` : ''}`).join(', '))}</td></tr>`).join('')
    || `<tr><td colspan="3" class="empty">${t('Switch on the screen reader (Settings) and the drops the server announces in the chat are collected here.')}</td></tr>`;
  $('drRecent').innerHTML = r.recent.map((d) => `<tr><td class="muted" style="white-space:nowrap">${dateTime(d.t)}</td><td class="notr">${esc(d.who)}</td><td>${item(d.item, d.itemId)}</td><td class="notr">${esc(d.from)}</td></tr>`).join('') || '';
  dropMobs = r.mobs || [];
  renderDropMobs();
}
// the announced drop table: per monster, the items it was seen dropping and how often
let dropMobs = [];
function renderDropMobs() {
  const qq = $('drMob').value.trim().toLowerCase();
  const list = dropMobs.filter((m) => !qq || m.from.toLowerCase().includes(qq) || m.items.some((x) => x.item.toLowerCase().includes(qq)));
  const item = (x) => (x.itemId ? `<b class="click notr" data-item="${x.itemId}">${esc(x.item)}</b>` : `<b class="notr">${esc(x.item)}</b>`);
  $('drMobs').innerHTML = list.map((m) => `<details class="dropmob"><summary><b class="notr">${esc(m.from)}</b>${m.level ? ` <span class="muted">Lv ${m.level}</span>` : ''} <span class="muted">· ${t('{n} drops announced', { n: m.count })} · ${t('{n} different items', { n: m.items.length })}</span></summary>
    <table><tbody>${m.items.map((x) => `<tr><td>${item(x)}</td><td class="num">${x.count}×</td><td class="num muted">${Math.round((x.count / m.count) * 100)}%</td><td class="muted" style="white-space:nowrap">${dateTime(x.last)}</td></tr>`).join('')}</tbody></table></details>`).join('')
    || `<div class="empty">${dropMobs.length ? t('No monster or item matches.') : t('Switch on the screen reader (Settings) and the drops the server announces in the chat are collected here.')}</div>`;
}
$('drMob').addEventListener('input', renderDropMobs);
function renderTrades() {
  const qq = $('trSearch').value.trim().toLowerCase(), ty = $('trType').value;
  const TYPE = { drop: t('Drop'), buy: t('Bought'), sell: t('Sold'), trade: t('Traded') };
  const list = tradeList.slice().reverse().filter((x) => (!ty || x.type === ty) && (!qq || `${x.item} ${x.with || ''} ${x.note || ''}`.toLowerCase().includes(qq)));
  $('trInfo').textContent = t('{n} entries', { n: tradeList.length });
  $('trList').innerHTML = list.map((x) => `<tr><td class="muted" style="white-space:nowrap">${dateTime(x.t)}</td><td><span class="tag">${TYPE[x.type]}</span></td><td><b class="click" data-item-name="${esc(x.item)}">${esc(x.item)}</b>${x.note ? `<div class="muted" style="font-size:11px">${esc(x.note)}</div>` : ''}</td>
    <td class="num">${x.qty}</td><td class="num">${x.price != null ? num(x.price) : '—'}</td><td>${esc(x.with || '—')}</td><td class="muted" style="font-size:12px">${x.zone != null ? esc(zoneName(x.zone)) : ''}${x.character ? ` · ${esc(x.character)}` : ''}</td>
    <td><button class="small danger" data-del-trade="${esc(x.id)}" title="${esc(t('Delete'))}">×</button></td></tr>`).join('') || `<tr><td colspan="8" class="empty">${t('Nothing logged yet.')}</td></tr>`;
  const sum = (type) => tradeList.filter((x) => x.type === type && x.price != null).reduce((a, x) => a + x.price * x.qty, 0);
  $('trTotals').innerHTML = `<table><tbody><tr><td>${t('Spent (bought)')}</td><td class="num">${num(sum('buy'))}</td></tr><tr><td>${t('Earned (sold)')}</td><td class="num">${num(sum('sell'))}</td></tr>
    <tr><td><b>${t('Balance')}</b></td><td class="num"><b>${num(sum('sell') - sum('buy'))}</b></td></tr><tr><td>${t('Drops logged')}</td><td class="num">${tradeList.filter((x) => x.type === 'drop').reduce((a, x) => a + x.qty, 0)}</td></tr></tbody></table>`;
  $('trItems').innerHTML = [...new Set([...tradeList.map((x) => x.item), ...(guideData?.items || []).map((i) => i.name)])].slice(0, 800).map((n) => `<option value="${esc(n)}">`).join('');
}
$('trForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData($('trForm')));
  const r = await post('/api/trades', f);
  if (!r.ok) { toast({ kind: 'timer', title: t('Could not save'), body: await r.text() }); return; }
  tradeList = await r.json();
  $('trForm').elements.item.value = ''; $('trForm').elements.price.value = ''; $('trForm').elements.qty.value = 1; $('trForm').elements.note.value = '';
  renderTrades();
});
for (const id of ['trSearch', 'trType']) $(id).addEventListener('input', renderTrades);
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-del-trade]');
  if (!b) return;
  const r = await post('/api/trades', { action: 'delete', id: b.dataset.delTrade });
  if (r.ok) { tradeList = await r.json(); renderTrades(); }
});

// ---------------------------------------------------------------- session replay & buff timeline
let replay = null;
function stopReplay() { if (replay) { cancelAnimationFrame(replay.raf); replay = null; } }
async function setupReplay(r) {
  stopReplay();
  const track = (await getJSON(`/api/session-trail?key=${encodeURIComponent(r.key)}`)) || [];
  const box = $('sdReplayBox');
  if (!box) return;
  if (track.length < 2) { box.innerHTML = `<div class="empty">${t('No route recorded for this session.')}</div>`; return; }
  // times: recorded live where possible, otherwise spread evenly over the session
  const known = track.filter((p) => p[0]).length;
  const span = Math.max(60000, r.endedAt - r.startedAt);
  const times = known > track.length / 2
    ? (() => { let last = r.startedAt; return track.map((p) => (p[0] ? (last = p[0]) : (last += 2000))); })()
    : track.map((_, i) => r.startedAt + (span * i) / (track.length - 1));
  replay = { track, times, r, i: 0, vt: times[0], playing: false, speed: 60, raf: 0, last: 0 };
  $('rpPos').max = track.length - 1; $('rpPos').value = 0;
  drawReplay();
}
function drawReplay() {
  if (!replay || !$('rpCanvas')) return;
  const { ctx, w, h } = prepCanvas($('rpCanvas'));
  const { track, i } = replay;
  const zone = track[i][1];
  const pts = [];
  for (let k = 0; k <= i; k++) if (track[k][1] === zone) pts.push([track[k][2], track[k][3]]);
  const tile = S?.maps?.[zone], img = tile && mapImage(zone);
  const v = tile ? fitView(tileCorners(tile), w, h, 0, 1) : fitView(pts.length ? pts : [[track[i][2], track[i][3]]], w, h, 200);
  if (img) drawTile(ctx, v, tile, img, w, h, 0.85);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (let k = 1; k < pts.length; k++) {
    if (Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]) > 150) continue;
    ctx.strokeStyle = `rgba(214,168,74,${0.3 + 0.7 * (k / pts.length)})`; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(...v.P(...pts[k - 1])); ctx.lineTo(...v.P(...pts[k])); ctx.stroke();
  }
  const [px, py] = v.P(track[i][2], track[i][3]);
  ctx.fillStyle = '#d6a84a'; ctx.strokeStyle = '#1a1408'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  drawMarkers(ctx, v, zone);
  $('rpTime').textContent = `${clock(replay.times[i])} · ${zoneName(zone)}`;
  $('rpPos').value = i;
}
function replayFrame(ts) {
  if (!replay?.playing) return;
  const dt = replay.last ? ts - replay.last : 0;
  replay.last = ts;
  replay.vt += dt * replay.speed;
  while (replay.i < replay.track.length - 1 && replay.times[replay.i + 1] <= replay.vt) replay.i++;
  drawReplay();
  if (replay.i >= replay.track.length - 1) { replay.playing = false; $('rpPlay').textContent = '▶'; return; }
  replay.raf = requestAnimationFrame(replayFrame);
}
document.addEventListener('click', (e) => {
  if (e.target.id === 'rp3d') { const keep = replay; startReplay3d().then(() => { replay ||= keep; }); return; }
  if (e.target.id !== 'rpPlay' || !replay) return;
  replay.playing = !replay.playing;
  e.target.textContent = replay.playing ? '❚❚' : '▶';
  if (replay.playing) {
    if (replay.i >= replay.track.length - 1) { replay.i = 0; replay.vt = replay.times[0]; }
    replay.last = 0; replay.raf = requestAnimationFrame(replayFrame);
  }
});
document.addEventListener('input', (e) => {
  if (!replay) return;
  if (e.target.id === 'rpPos') { replay.i = +e.target.value; replay.vt = replay.times[replay.i]; drawReplay(); }
  if (e.target.id === 'rpSpeed') replay.speed = +e.target.value;
});
function buffTimeline(r) {
  const log = (r.buffLog || []).filter((b) => b.end > r.startedAt && b.start < r.endedAt);
  if (!log.length) return `<div class="empty">${t('No buffs recorded for this session (buffs are recorded live).')}</div>`;
  const s0 = r.startedAt, span = Math.max(1, r.endedAt - s0);
  const ids = [...new Set(log.map((b) => b.id))];
  return ids.map((id) => {
    const segs = log.filter((b) => b.id === id);
    const covered = segs.reduce((a, b) => a + Math.min(b.end, r.endedAt) - Math.max(b.start, s0), 0);
    return `<div class="row" style="font-size:12px"><span>${esc(buffName(id))}</span><span class="muted">${t('{p}% of the session', { p: Math.round((covered / span) * 100) })}</span></div><div class="tl">${segs.map((b) => {
      const l = ((Math.max(b.start, s0) - s0) / span) * 100, wdt = ((Math.min(b.end, r.endedAt) - Math.max(b.start, s0)) / span) * 100;
      return `<span style="left:${l}%;width:${Math.max(0.4, wdt)}%" title="${clock(b.start)} – ${clock(b.end)}"></span>`;
    }).join('')}</div>`;
  }).join('');
}

// ---------------------------------------------------------------- help tab
// what's new (1.20 – 1.33): each with a button to the screen it is on
const WHATS_NEW = [
  ['Quest window reading: your quests in progress, a quest item counter with kills left, one trip for all quests, the "Available Quest" tab ranked, and a quest history', 'guide', 'dbquests'],
  ['Korean guide, enhance calculator, where to level, shopping list and regions', 'guide', 'kr'],
  ['Gear log from item tooltips, gear score, gear goals, net worth, the gold ledger and the enhance budget', 'stats', null],
  ['Price check when you hover an item, and gear compared with what you wear', 'live', null],
  ['Market flips and the party finder', 'trades', null],
  ['Honor, Ascension, Tiger Valley maze runs and goals with pace', 'stats', null],
  ['Your week: potions, enhancing, quests, net worth, gear score and what deaths cost', 'report', null],
  ['Field-boss and pass timers from the Korean guide, danger forecast, bag-full and gear alerts', 'alerts', null],
  ['A second game window: start it from the header, both clients side by side on Live and the overlay', 'live', null],
  ['Discord: /plan, /checklist, /enhance and /quests, with buttons', 'settings', null],
  ['Reader check, teaching the pickup message, debug captures, switching features off and alert noise control', 'settings', null],
  ['Hotkey Ctrl+Shift+I: +1 quest item while you farm', 'settings', null],
];
function whatsNewHtml() {
  return `<h3 id="help-new">${esc(t('What\'s new'))}</h3><ul class="whatsnew">${WHATS_NEW.map(([text, tab, pane]) => `<li>${esc(t(text))} <button class="small" data-goto="${tab}"${pane ? ` data-goto-pane="${pane}"` : ''}>${t('Show me')}</button></li>`).join('')}</ul>`;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-goto]'); if (!b) return;
  e.preventDefault();
  showTab(b.dataset.goto);
  if (b.dataset.gotoPane) setTimeout(() => document.querySelector(`[data-g="${b.dataset.gotoPane}"]`)?.click(), 50);
});
function loadHelp() {
  const list = (window.HELP && (HELP[getLang()] || HELP.en)) || [];
  $('helpNav').innerHTML = `<a href="#help" data-help="new">${esc(t('What\'s new'))}</a>`;
  $('helpBody').innerHTML = whatsNewHtml();
  $('helpNav').innerHTML += list.map(([id, title]) => `<a href="#help" data-help="${id}">${esc(title)}</a>`).join('');
  $('helpBody').innerHTML += list.map(([id, title, html]) => `<h3 id="help-${id}">${esc(title)}</h3>${html}`).join('');
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-help]');
  if (!a) return;
  e.preventDefault();
  for (const x of $('helpNav').children) x.classList.toggle('on', x === a);
  document.getElementById(`help-${a.dataset.help}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
