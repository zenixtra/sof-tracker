// SoF Tracker dashboard: guide. Loaded as a classic script; all dashboard scripts share one global scope (see index.html).

// ---------------------------------------------------------------- hunting tab (monster guide)
let monsterList = null;
const normArea = (s) => String(s || '').toLowerCase().replace(/s$/, '').trim();

async function loadHunting() {
  if (!guideData) guideData = await getJSON('/api/guide');
  monsterList = guideData.monsters;
  renderGuidePane();
  if (!$('hLevel').value) {
    const lv = S?.session.selfInfo?.level || store.get('huntLevel', '');
    $('hLevel').value = lv;
  }
  if ($('hArea').options.length <= 1) {
    const areas = [...new Set(monsterList.map((m) => m.area))].sort();
    $('hArea').innerHTML = '<option value="">All areas</option>' + areas.map((a) => `<option>${esc(a)}</option>`).join('');
  }
  renderHunting();
}

function renderHunting() {
  if (!monsterList) return;
  const lv = +$('hLevel').value || 0, range = +$('hRange').value, type = $('hType').value, area = $('hArea').value, qq = $('hSearch').value.trim().toLowerCase();
  store.set('huntLevel', $('hLevel').value);
  const here = S?.session.position ? normArea(zoneName(S.session.position.zone)) : null;
  const inRange = (m) => !lv || range >= 999 || Math.abs(m.level - lv) <= range;
  const list = monsterList.filter((m) => inRange(m) && (!type || m.type === type) && (!area || m.area === area)
    && (!qq || m.name.toLowerCase().includes(qq) || m.desc.toLowerCase().includes(qq)));
  $('monInfo').textContent = lv ? t('{n} of {total} monsters for level {lv}', { n: list.length, total: monsterList.length, lv }) : t('{n} of {total} monsters', { n: list.length, total: monsterList.length });
  $('monsters').innerHTML = list.map((m) => {
    const isHere = here && normArea(m.area) === here;
    return `<tr class="${isHere ? 'here-row' : ''}"><td>${m.img ? `<img class="mon-img" loading="lazy" src="/guide-img/${encodeURIComponent(m.img)}" alt="">` : ''}</td>
      <td><b>${esc(m.name)}</b><div class="mon-desc" title="${esc(m.desc)}">${esc(m.desc)}</div></td>
      <td class="num">${m.level}</td><td>${esc(m.area)}${isHere ? '<span class="here">● you are here</span>' : ''}</td>
      <td><span class="tag ${m.type === 'Aggressive' ? 'aggr' : ''}">${esc(m.type)}</span></td></tr>`;
  }).join('') || `<tr><td colspan="5" class="empty">${monsterList.length ? 'No monsters match. Try a wider level range.' : 'The monster guide could not be loaded from the game folder.'}</td></tr>`;

  // best areas: how many monsters in your range each area has
  const by = {};
  for (const m of monsterList.filter((x) => inRange(x) && (!type || x.type === type))) {
    const a = (by[m.area] ||= { area: m.area, n: 0, min: 999, max: 0, aggr: 0 });
    a.n++; a.min = Math.min(a.min, m.level); a.max = Math.max(a.max, m.level); if (m.type === 'Aggressive') a.aggr++;
  }
  const best = Object.values(by).sort((a, b) => b.n - a.n || a.min - b.min);
  $('bestInfo').textContent = lv ? t('level {lv} ±{r}', { lv, r: range >= 999 ? '∞' : range }) : t('enter your level');
  $('bestAreas').innerHTML = best.length ? `<table><thead><tr><th>Area</th><th class="num">Monsters</th><th class="num">Levels</th></tr></thead><tbody>${best.map((a) => {
    const isHere = here && normArea(a.area) === here;
    return `<tr class="click ${isHere ? 'here-row' : ''} ${area === a.area ? 'sel' : ''}" data-hunt-area="${esc(a.area)}"><td>${esc(a.area)}${isHere ? '<span class="here">● here</span>' : ''}${a.aggr ? `<div class="muted" style="font-size:11px">${a.aggr} aggressive</div>` : ''}</td><td class="num">${a.n}</td><td class="num">${a.min}–${a.max}</td></tr>`;
  }).join('')}</tbody></table>` : '<div class="empty">Nothing in this level range.</div>';
}
for (const id of ['hLevel', 'hRange', 'hType', 'hArea', 'hSearch']) $(id).addEventListener('input', renderHunting);
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-hunt-area]');
  if (!a) return;
  $('hArea').value = $('hArea').value === a.dataset.huntArea ? '' : a.dataset.huntArea;
  renderHunting();
});

// ---------------------------------------------------------------- guide: quests, NPCs, items
let guideData = null, guidePane = store.get('guidePane', 'monsters');
for (const seg of ['gSeg', 'gSeg2', 'gSeg3']) $(seg).addEventListener('click', (e) => {
  const b = e.target.closest('[data-g]');
  if (!b) return;
  guidePane = b.dataset.g; store.set('guidePane', guidePane);
  renderGuidePane();
});
function renderGuidePane() {
  for (const b of [...$('gSeg').children, ...$('gSeg2').children, ...$('gSeg3').children]) b.classList.toggle('on', b.dataset.g === guidePane);
  for (const p of document.querySelectorAll('.gpane')) p.hidden = p.id !== `g-${guidePane}`;
  if (guidePane === 'kr') { $('gSrc').textContent = t('From the official Korean Yulgang guide, in English'); return renderKrGuide(); }
  if (guidePane === 'level') { $('gSrc').textContent = t('Your own EXP per hour, the Korean guide and the game data'); return renderLevelPlaces(); }
  if (guidePane === 'enhance') { $('gSrc').textContent = t('Odds from the official Korean Yulgang guide'); return renderEnhance(); }
  if (guidePane === 'shop') { $('gSrc').textContent = t('Prices from the chat and the game\'s shop data'); return renderShop(); }
  if (guidePane === 'regions') { $('gSrc').textContent = t('Decoded from the game\'s own data files, with the Korean guide\'s level ranges'); return renderRegions(); }
  const fromDb = guidePane.startsWith('db');
  $('gSrc').textContent = t(fromDb ? "Decoded from the game's own data files" : "From the game's own guide (Scions_of_Fate_guide.chm)");
  if (fromDb) return loadGameDbPane(guidePane);
  if (!guideData) return;
  if (guidePane === 'quests') renderQuests();
  if (guidePane === 'npcs') renderNpcs();
  if (guidePane === 'items') renderItems();
}
// ---- the Korean guide book in English (public/krguide.js): one section at a time; monsters open in "All monsters"
let krSection = store.get('krSection', 'bosses');
// the official guide's pages the game links to (GuideLinkList.cfg), by topic; your class's skill pages first
let krLinksDone = false;
async function renderKrLinks() {
  if (krLinksDone) return;
  const r = await getJSON('/api/guide-links').catch(() => null);
  if (!r?.groups?.length) { $('krLinks').innerHTML = `<div class="muted" style="font-size:12px">${t('The game data has no guide links (yet).')}</div>`; return; }
  krLinksDone = true;
  const mine = String(S?.session?.selfInfo?.cls || '').split(/\s/)[0];
  $('krLinks').innerHTML = r.groups.map((g) => `<div class="krlinkgroup"><h3>${esc(t(g.group))}</h3>
    ${g.pages.map((p) => `<a href="${esc(p.link)}" target="_blank" rel="noopener" class="${p.cls && p.cls === mine ? 'mine' : ''}" title="${esc(p.korean)}">${esc(t(p.name))}</a>`).join('')}</div>`).join('');
}
function renderKrGuide() {
  renderKrLinks();
  const g = window.KR_GUIDE;
  if (!g) { $('krBody').innerHTML = `<div class="empty">${t('The Korean guide could not be loaded.')}</div>`; return; }
  if (!g.sections.some((s) => s.id === krSection)) krSection = g.sections[0].id;
  $('krSrc').href = g.source;
  $('krNav').innerHTML = g.sections.map((s) => `<button class="${s.id === krSection ? 'on' : ''}" data-kr="${s.id}">${esc(s.title)}</button>`).join('');
  const s = g.sections.find((x) => x.id === krSection);
  const table = (tb) => (tb ? `${tb.caption ? `<h3>${esc(tb.caption)}</h3>` : ''}<div class="scroll"><table class="notr"><thead><tr>${tb.cols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${tb.rows.map((r) => `<tr>${r.map((c, i) => `<td class="${typeof c === 'number' ? `num${tb.plain ? '' : c >= 100 ? ' sure' : c < 40 ? ' risky' : ''}` : ''}">${i === 0 ? `<b>${esc(c)}</b>` : esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '');
  const mobs = (gr) => `<h3>${esc(gr.title)}</h3><table class="notr"><tbody>${gr.mobs.map(([lv, name, desc]) => `<tr><td class="num" style="width:44px">${lv}</td><td><b class="click" data-kr-mob="${esc(name.replace(/ \(probably\)$/, ''))}">${esc(name)}</b>${desc ? `<div class="muted" style="font-size:12px">${esc(desc)}</div>` : ''}</td></tr>`).join('')}</tbody></table>`;
  $('krBody').innerHTML = `<h2>${esc(s.title)}</h2>${(s.intro || []).map((p) => `<p class="notr">${esc(p)}</p>`).join('')}${table(s.table)}${table(s.table2)}${table(s.table3)}${(s.groups || []).map(mobs).join('')}${(s.notes || []).map((n) => `<p class="muted notr" style="font-size:12px">${esc(n)}</p>`).join('')}`;
}
$('krNav').addEventListener('click', (e) => { const b = e.target.closest('[data-kr]'); if (!b) return; krSection = b.dataset.kr; store.set('krSection', krSection); renderKrGuide(); });
$('krBody').addEventListener('click', (e) => {
  const m = e.target.closest('[data-kr-mob]');
  if (!m) return;
  guidePane = 'dbmobs'; store.set('guidePane', guidePane); renderGuidePane();
  setTimeout(() => { $('dbmSearch').value = m.dataset.krMob; $('dbmMin').value = ''; $('dbmMax').value = ''; $('dbmSearch').dispatchEvent(new Event('input')); }, 300);
});
function renderQuests() {
  if (!$('qLevel').value) $('qLevel').value = S?.session.selfInfo?.level || store.get('huntLevel', '');
  const lv = +$('qLevel').value || 0, range = +$('qRange').value, fac = $('qFaction').value, qq = $('qSearch').value.trim().toLowerCase();
  const list = guideData.quests.filter((x) => (!lv || range >= 999 || !x.level || Math.abs(x.level - lv) <= range) && (!fac || x.faction === fac)
    && (!qq || `${x.name} ${x.npc} ${x.items}`.toLowerCase().includes(qq)));
  $('qInfo').textContent = t('{n} of {total} quests', { n: list.length, total: guideData.quests.length });
  $('quests').innerHTML = list.map((x) => `<tr><td><b>${esc(x.name)}</b></td><td class="num">${x.level ?? '—'}</td><td>${x.faction && x.faction !== 'Common' ? facBadge(x.faction) : `<span class="tag">${esc(t('Common'))}</span>`}</td><td>${esc(x.npc || '—')}</td><td class="muted" style="font-size:12px">${esc(x.items || '')}</td></tr>`).join('')
    || `<tr><td colspan="5" class="empty">${t('No quests match.')}</td></tr>`;
}
function renderNpcs() {
  const qq = $('nSearch').value.trim().toLowerCase();
  const list = guideData.npcs.filter((n) => !qq || `${n.name} ${n.desc} ${n.area || ''}`.toLowerCase().includes(qq));
  $('nInfo').textContent = t('{n} of {total} NPCs', { n: list.length, total: guideData.npcs.length });
  $('npcs').innerHTML = list.map((n) => `<tr><td>${n.img ? `<img class="mon-img" loading="lazy" src="/guide-img/${encodeURIComponent(n.img)}" alt="">` : ''}</td><td><b>${esc(n.name)}</b></td><td>${esc(n.area || '—')}</td>
    <td><div class="mon-desc" title="${esc(n.desc)}">${esc(n.desc)}</div></td><td><button class="small" data-mark-npc="${esc(n.name)}" title="${esc(t('Stand next to this NPC in-game, then click'))}">📍 ${t('Mark here')}</button></td></tr>`).join('')
    || `<tr><td colspan="5" class="empty">${t('No NPCs match.')}</td></tr>`;
}
function itemLevel(it) { const v = Object.entries(it.fields).find(([k]) => /level/i.test(k)); return v ? parseInt(v[1], 10) || null : null; }
function itemClass(it) { const v = Object.entries(it.fields).find(([k]) => /class/i.test(k)); return v ? v[1] : null; }
function renderItems() {
  if ($('iClass').options.length <= 1) {
    const classes = [...new Set(guideData.items.map(itemClass).filter(Boolean))].sort();
    $('iClass').innerHTML = `<option value="">${esc(t('Any class'))}</option>` + classes.map((c) => `<option>${esc(c)}</option>`).join('');
  }
  const grp = $('iGroup').value, cls = $('iClass').value, maxLv = +$('iLevel').value || 0, qq = $('iSearch').value.trim().toLowerCase();
  const list = guideData.items.filter((it) => (!grp || it.group === grp) && (!cls || itemClass(it) === cls)
    && (!maxLv || !itemLevel(it) || itemLevel(it) <= maxLv) && (!qq || `${it.name} ${Object.values(it.fields).join(' ')}`.toLowerCase().includes(qq)));
  $('iInfo').textContent = t('{n} of {total} items', { n: list.length, total: guideData.items.length });
  $('items').innerHTML = list.slice(0, 400).map((it) => `<tr><td>${it.img ? `<img class="mon-img" style="width:32px;height:32px" loading="lazy" src="/guide-img/${encodeURIComponent(it.img)}" alt="">` : ''}</td>
    <td><b>${esc(it.name)}</b>${it.gender ? ` <span class="tag">${esc(t(it.gender))}</span>` : ''}</td><td>${esc(t(it.group))}</td>
    <td class="muted" style="font-size:12px">${Object.entries(it.fields).filter(([k]) => !/^(name|names|items?)$/i.test(k)).map(([k, v]) => `<b style="color:var(--text);font-weight:500">${esc(k)}:</b> ${esc(v)}`).join(' · ')}</td></tr>`).join('')
    || `<tr><td colspan="4" class="empty">${t('No items match.')}</td></tr>`;
}
for (const id of ['qLevel', 'qRange', 'qFaction', 'qSearch']) $(id).addEventListener('input', renderQuests);
$('nSearch').addEventListener('input', renderNpcs);
for (const id of ['iGroup', 'iClass', 'iLevel', 'iSearch']) $(id).addEventListener('input', renderItems);
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-mark-npc]');
  if (!b) return;
  const r = await post('/api/mark-here', { label: b.dataset.markNpc, kind: 'npc' });
  toast(r.ok ? { kind: 'buff', title: t('Marker added: {label}', { label: b.dataset.markNpc }) } : { kind: 'timer', title: t('No position yet'), body: t('Move in-game once so the tracker knows where you are.') });
});

// ---------------------------------------------------------------- game database (decoded client files)
let gdbMeta = null, gdbMobs = null, gdbNpcs = null, gdbZones = null;
const debounce = (fn, ms = 250) => { let h; return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); }; };
async function loadGameDbPane(pane) {
  if (!gdbMeta) {
    gdbMeta = await getJSON('/api/gamedb');
    $('dbiClass').innerHTML = `<option value="">${esc(t('All classes'))}</option>` + Object.entries(gdbMeta.classes).filter(([k]) => k !== '0').map(([k, v]) => `<option value="${k}">${esc(t(v))}</option>`).join('');
    $('dbiSlot').innerHTML = `<option value="">${esc(t('All types'))}</option>` + Object.entries(gdbMeta.slots).map(([k, v]) => `<option value="${k}">${esc(t(v))}</option>`).join('');
    // class and level default to your character's
    const classOpts = Object.entries(gdbMeta.classes).filter(([k]) => k !== '0').map(([k, v]) => `<option value="${k}">${esc(t(v))}</option>`).join('');
    const mine = myClassId();
    $('dbqClass').innerHTML = `<option value="">${esc(t('All classes'))}</option>` + classOpts;
    $('dbgClass').innerHTML = classOpts; $('dbsClass').innerHTML = classOpts;
    // your character's class and level; with the game closed, the last ones you used here
    const cls = mine || store.get('dbClass', ''), lv = S?.session?.selfInfo?.level || store.get('dbLevel', '');
    for (const id of ['dbqClass', 'dbgClass', 'dbsClass']) if (cls) $(id).value = cls;
    if (lv) { $('dbqLevel').value = lv; $('dbgLevel').value = lv; }
    for (const id of ['dbqClass', 'dbgClass', 'dbsClass']) $(id).addEventListener('change', () => $(id).value && store.set('dbClass', $(id).value));
    for (const id of ['dbqLevel', 'dbgLevel']) $(id).addEventListener('change', () => $(id).value && store.set('dbLevel', $(id).value));
  }
  if (pane === 'dbitems') renderDbItems();
  if (pane === 'dbquests') renderDbQuests();
  if (pane === 'dbgear') renderDbGear();
  if (pane === 'dbskills') renderDbSkills();
  if (pane === 'dbmobs') { gdbMobs ||= await getJSON('/api/gamedb/monsters'); renderDbMobs(); }
  if (pane === 'dbnpcs') { gdbNpcs ||= await getJSON('/api/gamedb/npcs'); renderDbNpcs(); }
  if (pane === 'dbzones') { gdbZones ||= await getJSON('/api/gamedb/zones'); renderDbZones(); }
}
async function renderDbItems() {
  const q = new URLSearchParams({ q: $('dbiSearch').value.trim(), cls: $('dbiClass').value, slot: $('dbiSlot').value, min: $('dbiMin').value, max: $('dbiMax').value, sort: $('dbiSort').value });
  const r = await getJSON(`/api/gamedb/items?${q}`);
  $('dbiInfo').textContent = t('{n} of {total} items', { n: r.total, total: gdbMeta.counts.items }) + (r.total > r.items.length ? ` · ${t('showing the first {n}', { n: r.items.length })}` : '');
  const cls = (c) => (c ? t(gdbMeta.classes[c] || `#${c}`) : t('All'));
  $('dbItems').innerHTML = r.items.map((it) => `<tr class="click" data-dbitem="${it.id}"><td><img class="mon-img" style="width:32px;height:32px" loading="lazy" src="/api/icon/${it.id}.png" alt="" onerror="this.style.visibility='hidden'"></td>
    <td><b class="notr click" data-item="${it.id}" title="${esc(t('Details'))}">${esc(it.name)}</b>${it.gender ? ` <span class="tag">${it.gender === 'M' ? t('Male') : t('Female')}</span>` : ''}<div class="muted notr dbdesc" style="font-size:12px;white-space:pre-line" hidden>${esc(it.desc || '')}${it.sell ? `\n${esc(t('Sells for {n}', { n: num(it.sell) }))}` : ''}\nID ${it.id}</div></td>
    <td class="num">${it.level || '—'}</td><td>${esc(cls(it.cls))}</td><td>${esc(t(gdbMeta.slots[it.slot] || 'Other'))}</td>
    <td class="num">${it.atkMax ? `${num(it.atkMin)}–${num(it.atkMax)}` : '—'}</td><td class="num">${it.def ? num(it.def) : '—'}</td><td class="num">${it.price ? num(it.price) : '—'}</td>
    <td class="num">${it.sell ? num(it.sell) : '—'}</td><td class="num">${it.chat ? gold(it.chat) : '<span class="muted">—</span>'}</td></tr>`).join('')
    || `<tr><td colspan="10" class="empty">${t('No items match.')}</td></tr>`;
  for (const b of $('dbiQuick').children) b.classList.toggle('on', b.dataset.dbiSlot === $('dbiSlot').value);
}
// charms / gems / soul pets / outfits in one click (the type filter)
$('dbiQuick').addEventListener('click', (e) => {
  const b = e.target.closest('[data-dbi-slot]'); if (!b) return;
  $('dbiSlot').value = $('dbiSlot').value === b.dataset.dbiSlot ? '' : b.dataset.dbiSlot;
  renderDbItems();
});
const renderDbItemsSoon = debounce(renderDbItems);
for (const id of ['dbiSearch', 'dbiMin', 'dbiMax']) $(id).addEventListener('input', renderDbItemsSoon);
for (const id of ['dbiClass', 'dbiSlot', 'dbiSort']) $(id).addEventListener('change', renderDbItems);
$('dbItems').addEventListener('click', (e) => { const r = e.target.closest('[data-dbitem]'); if (r) { const d = r.querySelector('.dbdesc'); d.hidden = !d.hidden; } });

function renderDbMobs() {
  const qq = $('dbmSearch').value.trim().toLowerCase(), min = +$('dbmMin').value || 0, max = +$('dbmMax').value || 0;
  const list = gdbMobs.filter((m) => (!qq || m.name.toLowerCase().includes(qq)) && (!min || m.level >= min) && (!max || m.level <= max)).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  $('dbmInfo').textContent = t('{n} of {total} monsters', { n: list.length, total: gdbMobs.length });
  $('dbMobs').innerHTML = list.slice(0, 600).map((m) => {
    const where = [...new Set(m.spots.map((s) => s.zoneName))].map((zn) => { const s = m.spots.find((x) => x.zoneName === zn); return `<button class="small" data-world="${s.zone}" data-wx="${s.x}" data-wz="${s.z}" title="${esc(s.drop ? t('drops {item}', { item: s.drop }) : '')}">${esc(zn)} ↗</button>`; }).join(' ');
    return `<tr><td class="notr"><b>${esc(m.name)}</b></td><td class="num">${m.level}</td><td class="num">${num(m.hp)}</td><td class="notr" style="font-size:12px">${where}${m.area && !m.spots.some((s) => s.zoneName === m.area) ? ` <span class="muted">${esc(m.area)}</span>` : ''}${!where && !m.area ? '<span class="muted">—</span>' : ''}</td></tr>`;
  }).join('') || `<tr><td colspan="4" class="empty">${t('Nothing found.')}</td></tr>`;
}

// your class id from the character's class name (rankings / your notes)
function myClassId() {
  const c = String(S?.session?.selfInfo?.cls || '').toLowerCase();
  if (!c || !gdbMeta) return '';
  const hit = Object.entries(gdbMeta.classes).find(([k, v]) => k !== '0' && (c === v.toLowerCase() || c.startsWith(v.toLowerCase())));
  return hit ? hit[0] : '';
}

// ---- quest planner (all quests, or a leveling plan: EXP quests around your level, nearby zones first)
let questMode = 'list';
$('dbqMode').addEventListener('click', (e) => {
  const b = e.target.closest('[data-qm]'); if (!b) return;
  questMode = b.dataset.qm; renderDbQuests();
});
// what a quest asks you to bring, added up over its steps
const questItems = (x) => Object.values(x.steps.flatMap((s) => s.items).reduce((a, it) => { if (it.id) (a[it.id] ||= { id: it.id, qty: 0 }).qty += it.qty || 1; return a; }, {}));
// the quests in progress, read from the quest window (Ctrl+Q): what to do next for each
async function renderActiveQuests() {
  const [a, prog, trip, avail, xs, hist] = await Promise.all(['/api/quests-active', '/api/quest-progress', '/api/quest-route', '/api/quests-available', '/api/exp-split?days=7', '/api/quest-history'].map((u) => getJSON(u).catch(() => null)));
  const availHtml = renderAvailable(avail), splitHtml = renderExpSplit(xs) + renderQuestHistory(hist);
  if (!a || !a.quests.length) { $('dbqActive').innerHTML = `<div class="muted" style="font-size:12px;margin-bottom:8px">${t('Open the quest window in the game (Ctrl+Q, "Quest in progress") with the screen reader on: your quests in progress show here, and the ones you finish are ticked off.')}</div>${availHtml}${splitHtml}`; return; }
  const go = (zone, x, z, label) => (zone && x != null ? `<button class="small" data-world="${zone}" data-wx="${x}" data-wz="${z}">${esc(label)} ↗</button> <button class="small" data-route-zone="${zone}" data-route-x="${x}" data-route-z="${z}" data-route-label="${esc(label)}">🧭</button>` : '');
  const progOf = (id) => (prog?.quests || []).find((q) => q.id === id);
  // the items a quest asks for: how many you have (picked up / set by hand) and the kills where they come from
  const itemsHtml = (p) => (p ? `<div class="qprog">${p.items.map((it) => `<div class="qprog-row ${it.picked >= it.need ? 'done' : ''}"><b class="notr">${esc(it.name)}</b>
      <span class="qcount"><button class="small" data-qp="${p.id}" data-qp-item="${it.itemId}" data-qp-v="${it.picked - 1}">−</button> ${it.picked} / ${it.need} <button class="small" data-qp="${p.id}" data-qp-item="${it.itemId}" data-qp-v="${it.picked + 1}">+</button></span>
      <span class="muted" style="font-size:12px">${t('{n} kills there', { n: it.kills })}${it.mobName ? ` · <span class="notr">${esc(it.mobName)}</span>` : ''}</span>
      ${it.est != null && it.est > it.picked ? `<span class="qeta" title="${esc(t('The game shows no pickup message: this is from your kills there and how many kills an item took before. Press Ctrl+Shift+I in the game for each item to keep it exact.'))}">${t('≈ {n} by your kills', { n: it.est })}</span>` : ''}
      ${it.killsLeft ? `<span class="qeta" title="${esc(t('about {k} kills per item, learned from your own pickups', { k: num(it.killsPerItem, 1) }))}">${t('~{n} more kills', { n: it.killsLeft })}${it.minutesLeft ? ` · ${t('~{m} min at your pace', { m: it.minutesLeft })}` : ''}</span>` : ''}</div>`).join('')}
      ${p.ready ? `<div class="good" style="font-size:12px">✓ ${t('All items: hand it in to {npc}', { npc: `<b class="notr">${esc(p.items[0]?.npc || '?')}</b>` })}</div>` : ''}</div>` : '');
  const tripHtml = trip?.stops?.length ? `<details class="qtrip" open><summary><b>${t('Trip')}</b> <small class="muted">${t('{n} stops · about {d} units', { n: trip.stops.length, d: num(trip.total) })}${trip.from ? ` · ${t('from {zone}', { zone: esc(trip.from.zoneName) })}` : ''}</small>
      <button class="small primary" data-route-quests="1" data-route-label="${esc(t('Quest trip'))}">🧭 ${t('Show on the map')}</button></summary>
      <ol class="qtrip-list">${trip.stops.map((s) => `<li><span class="tag">${s.kind === 'collect' ? t('collect') : s.kind === 'handin' ? t('hand in') : t('talk')}</span> <b class="notr">${esc(s.label)}</b> <span class="muted notr" style="font-size:12px">${esc(s.zoneName || '')} · ${esc(s.questName)}</span> ${go(s.zone, s.x, s.z, '')}</li>`).join('')}</ol></details>` : '';
  $('dbqActive').innerHTML = `<h3 style="margin:0 0 6px">${t('In progress')} <small class="muted">${t('{n} quests · {char} · read {time}', { n: a.quests.length, char: esc(a.character || '?'), time: dateTime(a.seenAt) })}</small></h3>
    ${tripHtml}
    ${a.quests.map((x) => { const s = x.steps?.[0], p = progOf(x.id);
      return `<details class="quest"><summary><span class="qlv">Lv ${x.level}</span> <b class="notr">${esc(x.name)}</b> <span class="muted notr" style="font-size:12px">${esc(s?.npcName || '')}${s?.zoneName ? ` · ${esc(s.zoneName)}` : ''}</span>
        ${p ? `<span class="tag ${p.ready ? 'good' : ''}">${p.items.reduce((n, i) => n + i.picked, 0)} / ${p.items.reduce((n, i) => n + i.need, 0)}</span>` : ''}
        ${a.mates?.[x.id]?.length ? `<span class="tag mate" title="${esc(t('Friends and your other characters with this quest in progress'))}">👥 ${esc(a.mates[x.id].join(', '))}</span>` : ''}</summary>
        ${itemsHtml(p)}
        <ol class="qsteps">${(x.steps || []).map((st) => `<li><div>${t('Talk to {npc}', { npc: `<b class="notr">${esc(st.npcName)}</b>` })} ${go(st.zone, st.x, st.z, st.zoneName || '')}</div>
          ${st.items.map((it) => `<div class="qitem">${t('Bring {item}', { item: `<b class="notr click" data-item="${it.id}">${esc(it.name)}</b>${it.qty > 1 ? ` ×${it.qty}` : ''}` })}${it.mobName ? ` — ${t('from {mob}', { mob: `<span class="notr">${esc(it.mobName)}</span>` })}` : ''} ${go(it.zone, it.x, it.z, it.zoneName || '')}</div>`).join('')}
          ${st.goal ? `<div class="muted notr" style="font-size:12px;white-space:pre-line">${esc(st.goal)}</div>` : ''}</li>`).join('')}</ol></details>`; }).join('')}
    ${availHtml}${splitHtml}`;
}
// the "Available Quest" tab of the quest window, ranked: EXP for your level, rewards worth something, a chain after it
function renderAvailable(av) {
  if (!av?.quests?.length) return '';
  const why = { exp: t('EXP'), items: t('rewards worth gold'), chain: t('starts a chain'), low: t('far under your level') };
  return `<details class="qavail"><summary><b>${t('You could pick up')}</b> <small class="muted">${t('{n} quests on the "Available Quest" tab · read {time}', { n: av.quests.length, time: dateTime(av.seenAt) })}</small></summary>
    <table><thead><tr><th>${t('Quest')}</th><th class="num">${t('EXP')}</th><th class="num">${t('Rewards')}</th><th>${t('Why')}</th></tr></thead><tbody>
    ${av.quests.map((q, i) => `<tr class="${i === 0 ? 'best' : ''}"><td><span class="qlv">Lv ${q.level}</span> <b class="notr">${esc(q.name)}</b> <span class="muted notr" style="font-size:12px">${esc(q.steps?.[0]?.npcName || '')}</span></td>
      <td class="num">${q.exp ? num(q.exp) : '—'}</td><td class="num">${q.itemValue ? gold(q.itemValue) : '—'}</td>
      <td>${q.why.map((w) => `<span class="tag ${w === 'low' ? 'warn' : ''}">${esc(why[w] || w)}${w === 'chain' ? ` (${q.followUps})` : ''}</span>`).join(' ')}</td></tr>`).join('')}</tbody></table></details>`;
}
// quests handed in: how long they took (first seen in the quest window → handed in), per level range, the slow ones
function renderQuestHistory(h) {
  if (!h?.rows?.length) return '';
  const mins = (m) => (m == null ? '—' : dur(m * 60000));
  return `<details class="qavail"><summary><b>${t('Quest history')}</b> <small class="muted">${t('{n} handed in · from first seen in the quest window to handed in', { n: h.done })}</small></summary>
    ${h.bands.length ? `<div class="qhist-bands">${h.bands.map((b) => `<span class="tag">Lv ${b.from}–${b.to}: ${t('{n} quests, ~{m} each', { n: b.n, m: mins(b.avgMinutes) })}</span>`).join(' ')}</div>` : ''}
    ${h.slow.length ? `<div style="font-size:12px;margin:6px 0"><b>${t('Slow for what they give')}:</b> ${h.slow.map((s) => `<span class="notr">${esc(s.name)}</span> <span class="muted">(${mins(s.minutes)}, ${num(s.expPerMin)} ${t('EXP/min')})</span>`).join(' · ')}</div>` : ''}
    <div class="scroll" style="max-height:240px"><table><thead><tr><th>${t('Quest')}</th><th class="num">${t('Took')}</th><th class="num">${t('EXP')}</th><th>${t('Handed in')}</th></tr></thead><tbody>
    ${h.rows.slice(0, 100).map((r) => `<tr><td><span class="qlv">Lv ${r.level}</span> <span class="notr">${esc(r.name)}</span></td><td class="num">${mins(r.minutes)}</td><td class="num">${r.exp ? num(r.exp) : '—'}</td><td class="muted">${dateTime(r.end)}</td></tr>`).join('')}</tbody></table></div></details>`;
}
// EXP from monsters vs quests handed in, last 7 days
function renderExpSplit(xs) {
  if (!xs || !(xs.mob + xs.quest)) return '';
  const tot = xs.mob + xs.quest, qp = Math.round((xs.quest / tot) * 100);
  return `<div class="qsplit"><b>${t('Where your EXP came from')}</b> <small class="muted">${t('last 7 days · {char}', { char: esc(xs.character || '?') })}</small>
    <div class="splitbar"><span class="mob" style="width:${100 - qp}%"></span><span class="quest" style="width:${qp}%"></span></div>
    <div style="font-size:12px">${t('Monsters {a}% of a level ({p}%)', { a: num(xs.mob, 1), p: 100 - qp })} · ${t('Quests {a}% of a level ({p}%, {n} handed in)', { a: num(xs.quest, 1), p: qp, n: xs.quests })}</div>
    ${xs.pts ? `<div style="font-size:12px">${t('Exact, from "Exp obtained" in the chat: {n} EXP, {q} of it from quest rewards', { n: num(xs.pts), q: num(xs.ptsQuest) })}${xs.now?.levelSize ? ` · ${t('a level takes about {n} EXP', { n: num(xs.now.levelSize) })}` : ''}${xs.now?.etaMs ? ` · ${t('next level in {d} at this pace', { d: dur(xs.now.etaMs) })}` : ''}</div>` : ''}</div>`;
}
$('dbqActive').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-qp]'); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  await post('/api/quest-progress', { quest: b.dataset.qp, item: b.dataset.qpItem, picked: Math.max(0, +b.dataset.qpV) });
  renderActiveQuests();
});
async function renderDbQuests() {
  renderActiveQuests();
  for (const b of $('dbqMode').children) b.classList.toggle('on', b.dataset.qm === questMode);
  const plan = questMode === 'plan';
  const q = new URLSearchParams({ level: $('dbqLevel').value, range: $('dbqRange').value, cls: $('dbqClass').value, q: $('dbqSearch').value.trim(), hideDone: $('dbqHide').checked ? '1' : '0', character: S?.session?.character || '' });
  const r = plan ? await getJSON(`/api/gamedb/leveling?${q}`) : await getJSON(`/api/gamedb/quests?${q}`);
  $('dbqInfo').textContent = plan ? t('{n} EXP quests around level {lv}, nearest zones first', { n: r.quests.length, lv: r.level }) : t('{n} quests', { n: r.total });
  const go = (zone, x, z, label) => (zone && x != null ? `<button class="small" data-world="${zone}" data-wx="${x}" data-wz="${z}">${esc(label)} ↗</button>
    <button class="small" data-route-zone="${zone}" data-route-x="${x}" data-route-z="${z}" data-route-label="${esc(label)}" title="${esc(t('Plan a route there'))}">🧭</button>` : '');
  const reward = (rw) => rw.map((x) => `<span class="tag notr click" data-item="${x.id}">${esc(x.name)}${x.qty > 1 ? ` ×${num(x.qty)}` : ''}</span>`).join(' ');
  $('dbQuests').innerHTML = r.quests.map((x) => `<details class="quest ${x.done ? 'done' : ''}"><summary><label class="qdone" title="${esc(t('Mark as done'))}"><input type="checkbox" data-qdone="${x.id}" ${x.done ? 'checked' : ''}></label>
      <span class="qlv">Lv ${x.level}</span> <b class="notr">${esc(x.name)}</b> <span class="muted notr" style="font-size:12px">${esc(x.steps[0]?.npcName || '')}${x.steps[0]?.zoneName ? ` · ${esc(x.steps[0].zoneName)}` : ''}</span>
      ${plan ? `<span class="plan-exp">+${num(x.exp)} EXP · ${t('total {n}', { n: num(x.total) })}${x.hops != null ? ` · ${x.hops ? t('{n} zones away', { n: x.hops }) : t('this zone')}` : ''}</span>` : ''}
      <span class="qrew">${reward(x.rewards.slice(0, 3))}</span>${questItems(x).length ? ` <button class="small" data-quest-shop="${esc(JSON.stringify(questItems(x)))}" data-quest-name="${esc(x.name)}" title="${esc(t('Add the items this quest asks for to the shopping list'))}">🛒</button>` : ''}</summary>
      ${x.intro ? `<p class="muted notr qintro">${esc(x.intro)}</p>` : ''}
      <ol class="qsteps">${x.steps.map((s) => `<li><div>${t('Talk to {npc}', { npc: `<b class="notr">${esc(s.npcName)}</b>` })} ${go(s.zone, s.x, s.z, s.zoneName || '')}</div>
        ${s.items.map((it) => `<div class="qitem">${t('Bring {item}', { item: `<b class="notr click" data-item="${it.id}">${esc(it.name)}</b>${it.qty > 1 ? ` ×${it.qty}` : ''}` })}${it.mobName ? ` — ${t('from {mob}', { mob: `<span class="notr">${esc(it.mobName)}</span>` })}` : ''} ${go(it.zone, it.x, it.z, it.zoneName || '')}</div>`).join('')}
        ${s.goal ? `<div class="muted notr" style="font-size:12px;white-space:pre-line">${esc(s.goal)}</div>` : ''}</li>`).join('')}</ol>
      <div>${t('Rewards')}: ${reward(x.rewards) || '—'}</div></details>`).join('') || `<div class="empty">${t('No quests match.')}</div>`;
}
const renderDbQuestsSoon = debounce(renderDbQuests);
for (const id of ['dbqLevel', 'dbqSearch']) $(id).addEventListener('input', renderDbQuestsSoon);
for (const id of ['dbqRange', 'dbqClass', 'dbqHide']) $(id).addEventListener('change', renderDbQuests);
$('dbQuests').addEventListener('click', (e) => { if (e.target.closest('.qdone')) e.stopPropagation(); });
$('dbQuests').addEventListener('change', async (e) => {
  const c = e.target.closest('[data-qdone]'); if (!c) return;
  await post('/api/quests/done', { id: +c.dataset.qdone, done: c.checked, character: S?.session?.character || '' });
  c.closest('details').classList.toggle('done', c.checked);
});

// ---- gear advisor
async function renderDbGear() {
  const q = new URLSearchParams({ cls: $('dbgClass').value, level: $('dbgLevel').value || 1, events: $('dbgEvents').checked ? '1' : '0', gender: $('dbgGender').value });
  const res = await getJSON(`/api/gamedb/gear?${q}`), rows = res.rows || res;
  // (no gender picked: the server takes yours from Settings or the robe you wear)
  $('dbgInfo').textContent = t('{cls}, level {lv}', { cls: t(gdbMeta.classes[$('dbgClass').value] || ''), lv: $('dbgLevel').value || 1 }) + (res.gender ? ` · ${res.gender === 'M' ? t('male') : t('female')}` : '');
  const stat = (it) => (it.atkMax ? `${t('Attack')} ${num(it.atkMin)}–${num(it.atkMax)}` : it.def ? `${t('Defense')} ${num(it.def)}` : '');
  const cell = (it, big) => (it ? `<div class="gear click" data-item="${it.id}"><img src="/api/icon/${it.id}.png" alt="" onerror="this.style.visibility='hidden'"><span><b class="notr" style="${big ? '' : 'font-weight:500'}">${esc(it.name)}</b><small>Lv ${it.level}${stat(it) ? ` · ${stat(it)}` : ''}${it.price ? ` · ${num(it.price)}` : ''}</small></span>
    <button class="small goalbtn" data-goal-kind="${esc(gdbMeta.slots[it.slot] || '')}" data-goal-id="${it.id}" data-goal-name="${esc(it.name)}" title="${esc(t('Make this my goal for this slot'))}">🎯</button></div>` : '<span class="muted">—</span>');
  $('dbGear').innerHTML = rows.map((r) => `<tr><td><b>${esc(t(gdbMeta.slots[r.slot] || ''))}</b></td><td>${cell(r.best[0], true)}</td><td>${r.best.slice(1).map((x) => cell(x)).join('') || '<span class="muted">—</span>'}</td><td>${cell(r.next)}</td></tr>`).join('');
}
const renderDbGearSoon = debounce(renderDbGear);
$('dbgLevel').addEventListener('input', renderDbGearSoon);
for (const id of ['dbgClass', 'dbgEvents', 'dbgGender']) $(id).addEventListener('change', renderDbGear);

// ---- skills
// the promotions skills unlock at (Korean guide: 10 / 35 / 60 / 80 / 100, then ASC 1–7 every 10 levels from 110)
const SKILL_TIERS = [[1, 'Before the 1st promotion'], [10, '1st promotion'], [35, '2nd promotion'], [60, '3rd promotion'], [80, '4th promotion'], [100, '5th promotion'],
  ...[1, 2, 3, 4, 5, 6, 7].map((n) => [100 + n * 10, `ASC ${n}`])];
const tierOf = (lv) => SKILL_TIERS.filter(([from]) => lv >= from).pop() || SKILL_TIERS[0];
async function renderDbSkills() {
  const list = await getJSON(`/api/gamedb/skills?cls=${$('dbsClass').value}&q=${encodeURIComponent($('dbsSearch').value.trim())}`);
  $('dbsInfo').textContent = t('{n} skills', { n: list.length });
  const plv = +$('dbsLevel').value || 0;
  store.set('dbsLevel', $('dbsLevel').value);
  if (plv) {
    // the build plan: what you can learn by now, what it costs, what's next, per promotion
    const all = $('dbsSearch').value.trim() ? await getJSON(`/api/gamedb/skills?cls=${$('dbsClass').value}&q=`) : list;
    const have = all.filter((s) => s.level <= plv), next = all.filter((s) => s.level > plv && s.level <= plv + 10).sort((a, b) => a.level - b.level);
    const cost = (l) => l.reduce((a, s) => a + (s.cost || 0), 0);
    const tiers = SKILL_TIERS.map(([from, name], i) => { const to = SKILL_TIERS[i + 1]?.[0] ?? 999, l = all.filter((s) => s.level >= from && s.level < to); return { from, name, n: l.length, cost: cost(l) }; }).filter((x) => x.n);
    $('dbsPlan').innerHTML = `<div><b>${t('By level {lv}: {n} skills, {cost} to learn them all', { lv: plv, n: have.length, cost: gold(cost(have)) })}</b>
      <span class="muted"> · ${t('your tier: {tier}', { tier: t(tierOf(plv)[1]) })}</span></div>
      ${next.length ? `<div style="margin-top:4px">${t('Next 10 levels')}: ${next.map((s) => `<span class="tag notr">${esc(s.name)} · Lv ${s.level}${s.cost ? ` · ${gold(s.cost)}` : ''}</span>`).join(' ')}</div>` : ''}
      <table style="margin-top:8px"><thead><tr><th>${t('Promotion')}</th><th class="num">${t('From level')}</th><th class="num">${t('Skills')}</th><th class="num">${t('Cost')}</th><th></th></tr></thead><tbody>${tiers.map((x) => `<tr class="${plv >= x.from ? '' : 'muted'}"><td>${esc(t(x.name))}</td><td class="num">${x.from}</td><td class="num">${x.n}</td><td class="num">${x.cost ? gold(x.cost) : '—'}</td><td>${plv >= x.from ? '✓' : ''}</td></tr>`).join('')}</tbody></table>`;
  } else $('dbsPlan').innerHTML = '';
  $('dbSkills').innerHTML = list.map((s) => `<tr class="${plv && s.level > plv ? 'muted' : ''}"><td class="notr"><b>${esc(s.name)}</b>${plv && s.level <= plv ? ' ✓' : ''}${s.cooldown ? ` <span class="tag" title="${esc(t('cooldown, from the game data'))}">⏱ ${cdText(s.cooldown)}</span>` : ''}</td><td class="num">${s.level}</td><td class="num">${s.cost ? num(s.cost) : '—'}</td><td class="muted notr" style="font-size:12px;white-space:pre-line">${esc(s.desc || '')}</td></tr>`).join('') || `<tr><td colspan="4" class="empty">${t('Nothing found.')}</td></tr>`;
}
// a cooldown: "3 min", "16 s", "1.5 s"
const cdText = (ms) => (ms >= 60000 ? `${num(ms / 60000, ms % 60000 ? 1 : 0)} min` : `${num(ms / 1000, ms % 1000 ? 1 : 0)} s`);
$('dbsSearch').addEventListener('input', debounce(renderDbSkills));
$('dbsLevel').addEventListener('input', debounce(renderDbSkills));
if (!$('dbsLevel').value) $('dbsLevel').value = store.get('dbsLevel', '');
$('dbsClass').addEventListener('change', renderDbSkills);
for (const id of ['dbmSearch', 'dbmMin', 'dbmMax']) $(id).addEventListener('input', () => gdbMobs && renderDbMobs());

function renderDbNpcs() {
  const qq = $('dbnSearch').value.trim().toLowerCase();
  const rows = gdbNpcs.flatMap((n) => (n.spots.length ? n.spots : [null]).map((s) => ({ n, s })))
    .filter(({ n, s }) => !qq || n.name.toLowerCase().includes(qq) || (s && s.zoneName.toLowerCase().includes(qq)));
  $('dbnInfo').textContent = t('{n} NPCs, {m} with a known position', { n: gdbNpcs.length, m: gdbNpcs.filter((n) => n.spots.length).length });
  $('dbNpcs').innerHTML = rows.slice(0, 800).map(({ n, s }) => `<tr><td class="notr"><b>${esc(n.name)}</b></td><td>${s ? esc(s.zoneName) : '<span class="muted">—</span>'}</td><td class="num mono">${s ? `${s.x}, ${s.z}` : ''}</td>
    <td>${s ? `<button class="small" data-world="${s.zone}" data-wx="${s.x}" data-wz="${s.z}">${t('Show in 3D')}</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="4" class="empty">${t('Nothing found.')}</td></tr>`;
}
$('dbnSearch').addEventListener('input', () => gdbNpcs && renderDbNpcs());

function renderDbZones() {
  const qq = $('dbzSearch').value.trim().toLowerCase();
  const list = gdbZones.filter((z) => !qq || z.name.toLowerCase().includes(qq) || z.id === qq);
  $('dbzInfo').textContent = t('{n} zones', { n: gdbZones.length });
  $('dbZones').innerHTML = list.map((z) => `<tr><td class="num muted">${z.id}</td><td class="notr"><b>${esc(z.name)}</b></td><td class="num">${z.npcs || '—'}</td><td class="notr" style="font-size:12px">${esc([...new Set(z.exits)].join(', ')) || '<span class="muted">—</span>'}</td>
    <td><button class="small" data-world="${z.id}">${t('3D')}</button></td></tr>`).join('');
}
$('dbzSearch').addEventListener('input', () => gdbZones && renderDbZones());

// ---------------------------------------------------------------- item lookup (any element with data-item="<id>" or data-item-name="<name>")
async function openItem(query) {
  const it = await getJSON(`/api/gamedb/item?${query}`);
  if (!it) { toast({ kind: 'timer', title: t('Item not found in the game data') }); return; }
  $('idIcon').src = `/api/icon/${it.id}.png`; $('idIcon').onerror = function () { this.style.visibility = 'hidden'; }; $('idIcon').style.visibility = '';
  $('idName').textContent = it.name;
  $('idShop').dataset.id = it.id;
  // when it's cheapest to buy / pays most to sell, from the chat's offers (your time)
  $('idTimes').hidden = true;
  getJSON(`/api/price-times?item=${it.id}`).then((pt) => {
    if (+$('idShop').dataset.id !== it.id || pt.offers < 6) return;
    const at = (x) => [x.day && `${t(x.day.day)} (${gold(x.day.price)})`, x.block && `${x.block.block} (${gold(x.block.price)})`].filter(Boolean).join(' · ');
    const buy = at(pt.buyAt), sell = at(pt.sellAt);
    if (!buy && !sell) return;
    $('idTimes').innerHTML = `${buy ? `<div>🛒 ${t('Cheapest to buy')}: <b>${buy}</b></div>` : ''}${sell ? `<div>💰 ${t('Best to sell')}: <b>${sell}</b></div>` : ''}<small class="muted">${t('from {n} chat offers, last 90 days, your time', { n: pt.offers })}</small>`;
    $('idTimes').hidden = false;
  });
  const facts =[[t('Level'), it.level || '—'], [t('Class'), t(it.clsName || 'All')], [t('Type'), t(it.slotName || 'Other')],
    it.atkMax ? [t('Attack'), `${num(it.atkMin)}–${num(it.atkMax)}`] : null, it.def ? [t('Defense'), num(it.def)] : null,
    it.price ? [t('Shop price'), num(it.price)] : null, it.sell ? [t('Sell price'), num(it.sell)] : null, it.traded ? [t('In your trades log'), `${it.traded}×`] : null, ['ID', it.id]].filter(Boolean);
  $('idFacts').innerHTML = facts.map(([k, v]) => `<span><b>${esc(k)}</b>${esc(String(v))}</span>`).join('');
  $('idDesc').textContent = it.desc || '';
  const qlink = (q) => `<div class="notr" style="font-size:13px;margin:3px 0">Lv ${q.level} · <a href="#" data-quest-find="${esc(q.name)}">${esc(q.name)}</a>${q.qty > 1 ? ` (×${q.qty})` : ''}</div>`;
  $('idDrops').innerHTML = it.dropsFrom.map((d) => `<div class="notr" style="font-size:13px;margin:3px 0"><b>${esc(d.name)}</b> Lv ${d.level}${d.zoneName ? ` · ${esc(d.zoneName)} ${d.x != null ? `<button class="small" data-world="${d.zone}" data-wx="${d.x}" data-wz="${d.z}">3D</button>` : ''}` : ''}</div>`).join('') || `<div class="muted" style="font-size:12px">${t('Not known from the game files.')}</div>`;
  // what it goes for in the chat, and where the monsters that drop it live
  $('idMarket').hidden = !it.price;
  if (it.price) {
    $('idMarket').innerHTML = `💰 ${[it.price.sell && t('usually sold for {p}', { p: `<b>${gold(it.price.sell)}</b>` }), it.price.buy && t('people pay {p}', { p: `<b>${gold(it.price.buy)}</b>` })].filter(Boolean).join(' · ')} <span class="muted">(${t('{n} offers in the chat', { n: it.price.offers })})</span><div class="chart" id="idPriceChart"></div>`;
    // the price over the last 90 days: one line for selling, one for buying (same unit, one axis)
    getJSON(`/api/price-history?item=${it.id}`).then((h) => {
      if (!$('idPriceChart')) return;
      const series = [['sell', 'Selling for', 'var(--s1)'], ['buy', 'Buying for', 'var(--s2)']].map(([k, name, color]) => ({ name: t(name), color, points: h.filter((d) => d[k]).map((d) => [d.t, d[k]]) })).filter((s) => s.points.length);
      lineChart($('idPriceChart'), { series, height: 160, yFmt: (v) => gold(v), empty: t('A price chart appears once the item was offered on two different days.') });
    });
  }
  $('idFarm').hidden = !it.announced?.length;
  $('idFarmList').innerHTML = (it.announced || []).map((a) => `<div class="notr" style="font-size:13px;margin:4px 0"><b>${esc(a.from)}</b>${a.level ? ` Lv ${a.level}` : ''} · ${t('{n}× announced', { n: a.count })}
    ${a.spots.map((p) => `<button class="small" data-world="${p.zone}" data-wx="${p.x}" data-wz="${p.z}">${esc(p.zoneName)} ↗</button>`).join(' ')}${!a.spots.length && a.area ? ` <span class="muted">${esc(a.area)}</span>` : ''}</div>`).join('');
  $('idRewardOf').innerHTML = it.rewardOf.map(qlink).join('') || '<div class="muted">—</div>';
  $('idNeeded').innerHTML = it.neededBy.map(qlink).join('') || '<div class="muted">—</div>';
  if (!$('itemDialog').open) $('itemDialog').showModal();
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-item], [data-item-name]');
  if (b) { e.preventDefault(); e.stopPropagation(); openItem(b.dataset.item ? `id=${b.dataset.item}` : `name=${encodeURIComponent(b.dataset.itemName)}`); return; }
  const q = e.target.closest('[data-quest-find]');
  if (q) { e.preventDefault(); document.querySelectorAll('dialog[open]').forEach((d) => d.close()); showTab('hunting'); guidePane = 'dbquests'; renderGuidePane(); setTimeout(() => { $('dbqLevel').value = ''; $('dbqRange').value = '999'; $('dbqSearch').value = q.dataset.questFind; questMode = 'list'; renderDbQuests(); }, 300); }
  if (e.target.closest('[data-world]')) document.querySelectorAll('dialog[open]').forEach((d) => d.close());
}, true);

// ---------------------------------------------------------------- screenshots (Sessions tab)
async function loadShots() {
  const list = await getJSON('/api/screens');
  $('shotInfo').textContent = list.length ? t('{n} screenshots from the game\'s capture folder', { n: list.length }) : t('No screenshots yet. Take one in-game and it shows up here with where and when you took it.');
  $('shots').innerHTML = list.slice(0, 120).map((s) => `<div class="shot"><img loading="lazy" src="/api/screen/${encodeURIComponent(s.name)}" alt="" data-shot="${esc(s.name)}">
    <div><b class="notr">${esc(s.character || '?')}</b> · ${dateTime(s.at)}<small class="notr">${esc(s.zoneName || '')}${s.x != null ? ` · ${s.x}, ${s.z}` : ''}${s.players.length ? ` · ${t('{n} players around', { n: s.players.length })}` : ''}</small>
    ${s.zone != null ? `<button class="small" data-world="${s.zone}" data-wx="${s.x}" data-wz="${s.z}" style="margin-top:4px">${t('Show in 3D')}</button>` : ''}</div></div>`).join('');
}
$('shots').addEventListener('click', (e) => { const i = e.target.closest('[data-shot]'); if (i) window.open(`/api/screen/${encodeURIComponent(i.dataset.shot)}`, '_blank'); });

// ---------------------------------------------------------------- boss predictions (Live tab)
function renderBossNext(tnow) {
  const list = S.bossNext || [];
  $('bossNext').innerHTML = list.length ? `<h2 style="margin-top:16px">${t('Predicted boss spawns')}</h2>` + list.map((b) => {
    const left = b.next - tnow, every = Math.round((b.intervalMs || 0) / 60000);
    return `<div class="timer"><div class="row"><span><b>${esc(b.boss)}</b>${b.lastEarth ? ` <span class="muted">· ${t('Earth {n}', { n: b.lastEarth })}</span>` : ''}</span><span class="mono">${left > 0 ? `~${dur(left)}` : t('due now')}</span></div>
      <p>${t('usually every {d}', { d: every >= 60 ? `${Math.floor(every / 60)}h ${every % 60}m` : `${every}m` })} · ${t('seen {n}×', { n: b.spawns })} · ${t(b.confidence === 'good' ? 'good estimate' : b.confidence === 'rough' ? 'rough estimate' : 'first guess')}</p></div>`;
  }).join('') : '';
  renderPasses(tnow);
  renderGuideBoss(tnow);
  renderGuideTimerSettings();
}

// ---- Training Pass / Entry Bracelet countdowns, and the guide's field-boss times (Live tab)
const hhmm = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
function renderPasses(tnow) {
  const list = S.passes || [];
  $('passTimers').innerHTML = list.map((p) => {
    const left = p.end - tnow, pct = Math.max(0, Math.min(100, (left / (p.end - p.start)) * 100));
    return `<div class="timer"><div class="row"><span><b>${esc(t(p.label))}</b>${p.zone ? ` <span class="muted notr">· ${esc(zoneName(p.zone))}</span>` : ''}</span>
      <span class="mono">${left > 0 ? (left >= 3600000 ? dur(left) : countdown(left)) : t('ran out')}</span></div>
      <div class="passbar"><i style="width:${pct}%"></i></div>
      <p>${t('ends {time}', { time: hhmm(p.end) })} · <button class="small" data-pass-set="${p.kind}">${t('Correct')}</button> <button class="small" data-pass-clear="${p.kind}">✕</button></p></div>`;
  }).join('');
}
function renderGuideBoss(tnow) {
  const g = S.guideBoss;
  if (!g || !g.names.length || (!g.next && !g.current)) { $('guideBoss').innerHTML = ''; return; }
  const on = g.current && g.currentEnds > tnow;
  $('guideBoss').innerHTML = `<h2 style="margin-top:16px">${t('Field bosses')} <small>${t('Korean guide times, not confirmed for SoF')}</small></h2>
    <div class="timer"><div class="row"><span><b>${on ? t('Out now (until {time})', { time: hhmm(g.currentEnds) }) : t('Next at {time}', { time: hhmm(g.next) })}</b></span>
    <span class="mono">${on ? '' : `~${dur(g.next - tnow)}`}</span></div>
    <p class="notr">${esc(g.names.join(', '))}</p>${g.learned.length ? `<p class="muted">${t('Learned from the server notices instead: {names}', { names: esc(g.learned.join(', ')) })}</p>` : ''}</div>`;
}
$('passTimers').addEventListener('click', async (e) => {
  const set = e.target.closest('[data-pass-set]'), clear = e.target.closest('[data-pass-clear]');
  if (!set && !clear) return;
  let minutes = 0;
  if (set) {
    const v = prompt(t('Minutes left on it (look at its icon in-game):'), '');
    if (v === null) return;
    minutes = Math.max(0, Math.round(+v || 0));
    if (!minutes) return;
  }
  await post('/api/passes', { kind: (set || clear).dataset[set ? 'passSet' : 'passClear'], minutes });
});
// Alerts tab: guide timer settings
function renderGuideTimerSettings() {
  const st = S?.settings; if (!st) return;
  $('gtBoss').checked = st.guideBossAlert !== false;
  if (document.activeElement !== $('gtHours')) $('gtHours').value = (st.guideBossHours || []).join(', ');
  $('gtBracelet').value = String(st.braceletHours || 24);
  $('gtRisk').checked = st.dangerForecast !== false;
  $('gtLfg').checked = st.partyFinder !== false;
  if (document.activeElement !== $('gtWeight')) $('gtWeight').value = String(st.weightAlert ?? 90);
  $('gtGearOffer').checked = st.gearOfferAlert !== false;
}
$('gtGearOffer').addEventListener('change', () => saveSettings({ gearOfferAlert: $('gtGearOffer').checked }));
$('gtWeight').addEventListener('change', () => saveSettings({ weightAlert: +$('gtWeight').value }));
$('gtRisk').addEventListener('change', () => saveSettings({ dangerForecast: $('gtRisk').checked }));
$('gtLfg').addEventListener('change', () => saveSettings({ partyFinder: $('gtLfg').checked }));
$('gtBoss').addEventListener('change', () => saveSettings({ guideBossAlert: $('gtBoss').checked }));
$('gtHours').addEventListener('change', () => saveSettings({ guideBossHours: $('gtHours').value }));
$('gtBracelet').addEventListener('change', () => saveSettings({ braceletHours: +$('gtBracelet').value }));

// ---- where to level (Guide tab)
async function renderLevelPlaces() {
  if (!$('lvLevel').value) $('lvLevel').value = S?.session?.selfInfo?.level || store.get('huntLevel', '');
  const lv = +$('lvLevel').value || 0;
  if (!lv) { $('lvInfo').textContent = t('enter your level'); $('lvPlaces').innerHTML = ''; return; }
  const r = await getJSON(`/api/level-places?level=${lv}`);
  $('lvInfo').textContent = t('for level {lv}', { lv });
  $('lvPlaces').innerHTML = r.places.map((p) => `<tr class="${p.here ? 'here-row' : ''}"><td><b class="notr">${esc(p.zoneName)}</b>${p.here ? '<span class="here">● here</span>' : ''}</td>
    <td>${esc(t(p.kind))}</td><td class="num">${p.levels ? `${p.levels[0]}–${p.levels[1]}` : '—'}</td>
    <td class="num">${p.expPerHour ? `${num(p.expPerHour, 1)}%` : '<span class="muted">—</span>'}${p.minutes ? `<div class="muted" style="font-size:11px">${t('{n} min measured', { n: p.minutes })}</div>` : ''}</td>
    <td class="muted" style="font-size:12px">${esc(t(p.note))}</td></tr>`).join('') || `<tr><td colspan="5" class="empty">${t('Nothing found for this level yet.')}</td></tr>`;
}
$('lvLevel').addEventListener('input', debounce(renderLevelPlaces));

// ---- enhance calculator (Guide tab)
const enField = { charm: 'enCharm', tier: 'enTier', from: 'enFrom', to: 'enTo', stones: 'enStones', stone: 'enStone', charmPrice: 'enCharmPrice', fee: 'enFee', item: 'enItem' };
function enhanceLevels() {
  if ($('enFrom').options.length) return;
  for (let i = 0; i <= 9; i++) $('enFrom').add(new Option(`+${i}`, String(i)));
  for (let i = 1; i <= 10; i++) { $('enTo').add(new Option(`+${i}`, String(i))); $('enLogLevel').add(new Option(`+${i}`, String(i))); }
  const saved = store.get('enhance', {});
  for (const [k, id] of Object.entries(enField)) if (saved[k] != null && k !== 'tier') $(id).value = saved[k];
  if (!saved.to) $('enTo').value = '7';
  $('enOwn').checked = !!saved.own;
}
async function renderEnhance() {
  enhanceLevels();
  if (+$('enTo').value <= +$('enFrom').value) $('enTo').value = String(Math.min(10, +$('enFrom').value + 1));
  const p = Object.fromEntries(Object.entries(enField).map(([k, id]) => [k, $(id).value]));
  p.tier = p.tier || store.get('enhance', {}).tier || '0';
  store.set('enhance', { ...p, own: $('enOwn').checked });
  const r = await getJSON(`/api/enhance?${new URLSearchParams({ ...p, own: $('enOwn').checked ? '1' : '0', pool: $('enPool').checked ? '1' : '0' })}`);
  $('enPoolLbl').hidden = !r.friendsLogged;
  $('enPoolInfo').textContent = r.friendsLogged ? t('{n} tries from {names}', { n: r.friendsLogged, names: r.friendsNames.join(', ') }) : '';
  $('enTier').innerHTML = r.tiers.map((x, i) => `<option value="${i}">${esc(x)}</option>`).join(''); $('enTier').value = p.tier;
  const pl = r.plan, pct = (x) => `${num(x * 100, x < 0.1 ? 1 : 0)}%`;
  $('enInfo').textContent = t('+{a} to +{b}, {tier}', { a: pl.from, b: pl.to, tier: r.tier });
  const kpi = (label, v, sub = '') => `<div class="kpi"><label>${esc(label)}</label><div class="v">${v}</div><div class="sub">${sub || '&nbsp;'}</div></div>`;
  $('enKpis').innerHTML = pl.chance ? [
    kpi(t('Chance in one go'), pct(pl.chance), t('without losing the item')),
    kpi(t('Items you may need'), num(pl.items, 1), t('on average')),
    kpi(t('Tries'), num(pl.tries, 0), t('{n} stones · {c} charms', { n: num(pl.stones, 0), c: num(pl.charms, 0) })),
    kpi(t('Expected cost'), pl.cost != null ? gold(Math.round(pl.cost)) : '—', pl.cost != null ? t('with the prices you entered') : t('enter prices on the left')),
  ].join('') : kpi(t('Chance in one go'), '0%');
  $('enSteps').innerHTML = pl.steps.map((s) => `<tr><td>+${s.level}</td><td class="num ${s.p >= 1 ? 'sure' : s.p < 0.4 ? 'risky' : ''}">${pct(s.p)}${r.odds[s.level - 1] !== r.guideOdds[s.level - 1] ? ` <span class="muted" title="${esc(t('your own rate'))}">●</span>` : ''}</td>
    <td class="num">${pct(s.reach)}</td><td class="muted" style="font-size:12px">${s.risky ? t('can break the item') : t('safe')}</td></tr>`).join('');
  $('enPrices').innerHTML = r.prices.length ? r.prices.map((x) => `<div class="notr"><span class="click" data-item="${x.itemId}">${esc(x.item)}</span>: ${x.sell ? gold(x.sell) : '—'}${x.buy ? ` · ${t('buying')} ${gold(x.buy)}` : ''} <span class="muted">(${x.offers})</span></div>`).join('') : t('No luck or enhance charm offers read from the chat yet.');
  $('enLogInfo').textContent = t('{n} logged', { n: r.logged });
  const own = r.own || {};
  $('enOwnRows').innerHTML = Object.keys(own).sort((a, b) => a - b).map((lv) => `<tr><td>+${lv}</td><td class="num">${own[lv].tries}</td><td class="num">${pct(own[lv].rate)}</td><td class="num">${r.guideOdds[lv - 1] != null ? `${r.guideOdds[lv - 1]}%` : '—'}</td></tr>`).join('')
    || `<tr><td colspan="4" class="empty">${t('Nothing logged with this charm yet.')}</td></tr>`;
  if (!$('enLogLevel').dataset.touched) $('enLogLevel').value = String(Math.min(10, pl.from + 1));
  // auto-logging from the screen reader
  if (!$('enAutoLevel').options.length) for (let i = 1; i <= 15; i++) $('enAutoLevel').add(new Option(`+${i}`, String(i)));
  if (!$('enSofCharm').options.length) $('enSofCharm').innerHTML = `<option value="">${esc(t('which SoF charm?'))}</option>` + r.sofCharms.map((c) => `<option>${esc(c)}</option>`).join('');
  const ses = r.session || {};
  if (document.activeElement !== $('enAutoLevel')) $('enAutoLevel').value = String(ses.level || 1);
  if (document.activeElement !== $('enSofCharm')) $('enSofCharm').value = ses.sofCharm || '';
  if (document.activeElement !== $('enAutoItem')) $('enAutoItem').value = ses.item || '';
  $('enAutoInfo').textContent = ses.active ? t('on: next try +{n}', { n: ses.level }) : ses.seen ? t('off · {n} results seen while off', { n: ses.seen }) : t('off');
  $('enAutoGo').hidden = !!ses.active; $('enAutoStop').hidden = !ses.active;
  // which grade each SoF charm behaves like
  const gname = { best: t('Best grade (최상급)'), high: t('High grade (상급)'), mid: t('Mid grade (중급)') };
  $('enGrades').innerHTML = r.charmGrades.length ? `<table><thead><tr><th>${t('Your charm')}</th><th class="num">${t('Tries')}</th><th class="num">${t('Your rate')}</th><th>${t('Looks like')}</th></tr></thead><tbody>${r.charmGrades.map((g) => `<tr><td class="notr">${esc(g.charm)}</td><td class="num">${g.tries}</td><td class="num">${pct(g.rate)}</td>
    <td>${g.grade ? `${esc(gname[g.grade])} <span class="muted">(±${g.off} ${t('points')})</span>` : `<span class="muted">${t('needs 5 tries at +4 or higher')}</span>`}</td></tr>`).join('')}</tbody></table>` : '';
  $('enAnnounced').innerHTML = r.announced.length ? r.announced.map((a) => `<div class="notr">${dateTime(a.t)} · <b>${esc(a.who)}</b> ${esc(a.item)} <b>+${a.level}</b></div>`).join('') : t('Nothing yet.');
}
async function enhanceSession(active) {
  await post('/api/enhance-session', { active, level: +$('enAutoLevel').value, charm: $('enCharm').value, sofCharm: $('enSofCharm').value, item: $('enAutoItem').value.trim() });
  renderEnhance();
}
$('enAutoGo').addEventListener('click', () => enhanceSession(true));
$('enAutoStop').addEventListener('click', () => enhanceSession(false));
$('enSofCharm').addEventListener('change', () => post('/api/enhance-session', { sofCharm: $('enSofCharm').value }));
// the calculator follows the auto-log (a new result shows up within a few seconds)
setInterval(() => { if (tab === 'hunting' && guidePane === 'enhance' && !document.activeElement?.closest?.('#g-enhance input, #g-enhance select')) renderEnhance(); }, 8000);

// ---- shopping list (Guide tab)
async function renderShop(data) {
  const r = data || await getJSON('/api/shopping');
  $('shInfo').textContent = r.rows.length ? t('{n} items · about {total}', { n: r.rows.length, total: gold(Math.round(r.total)) }) : '';
  $('shRows').innerHTML = r.rows.map((x) => `<tr><td><b class="notr click" data-item="${x.id}">${esc(x.name)}</b>${x.note ? `<div class="muted notr" style="font-size:11px">${esc(x.note)}</div>` : ''}</td>
    <td class="num"><input type="number" min="1" value="${x.qty}" data-sh-qty="${x.id}" style="width:70px"></td><td class="num">${x.shop ? gold(x.shop) : '—'}</td>
    <td class="num">${x.chat ? gold(x.chat) : '—'}${x.chatBuy ? `<div class="muted" style="font-size:11px">${t('buying')} ${gold(x.chatBuy)}</div>` : ''}${x.cheapest ? `<div class="muted" style="font-size:11px">${t('cheapest: {when}', { when: [x.cheapest.day && t(x.cheapest.day), x.cheapest.block].filter(Boolean).join(' · ') })}</div>` : ''}</td><td class="num">${x.total ? gold(Math.round(x.total)) : '—'}</td>
    <td class="num"><input type="number" min="0" value="${x.maxPrice || ''}" placeholder="—" data-sh-max="${x.id}" style="width:110px" title="${esc(t('An alert when someone in the chat sells it for this or less'))}"></td>
    <td><button class="small" data-sh-del="${x.id}">×</button></td></tr>`).join('') || `<tr><td colspan="7" class="empty">${t('The list is empty.')}</td></tr>`;
}
const shopPost = async (b) => { const res = await post('/api/shopping', b); if (!res.ok) { toast({ kind: 'timer', title: await res.text() }); return null; } const d = await res.json(); if (guidePane === 'shop') renderShop(d); return d; };
$('shAdd').addEventListener('click', async () => { if (!$('shName').value.trim()) return; if (await shopPost({ name: $('shName').value.trim(), qty: +$('shQty').value || 1 })) { $('shName').value = ''; $('shQty').value = '1'; } });
$('shName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('shAdd').click(); });
$('shName').addEventListener('input', debounce(async () => {
  const q = $('shName').value.trim(); if (q.length < 2) return;
  const r = await getJSON(`/api/search?q=${encodeURIComponent(q)}`);
  $('shNames').innerHTML = (r.groups.find((g) => g.type === 'item')?.list || []).map((i) => `<option value="${esc(i.name)}">`).join('');
}, 250));
$('shClear').addEventListener('click', () => { if (confirm(t('Empty the whole shopping list?'))) shopPost({ action: 'clear' }); });
$('shRows').addEventListener('change', (e) => {
  const q = e.target.closest('[data-sh-qty]'); if (q) shopPost({ action: 'set', id: +q.dataset.shQty, qty: +q.value || 1 });
  const m = e.target.closest('[data-sh-max]'); if (m) shopPost({ action: 'set', id: +m.dataset.shMax, maxPrice: +m.value || 0 });
});
$('shRows').addEventListener('click', (e) => { const d = e.target.closest('[data-sh-del]'); if (d) shopPost({ action: 'remove', id: +d.dataset.shDel }); });
$('idShop').addEventListener('click', async () => { if (await shopPost({ id: +$('idShop').dataset.id, qty: 1 })) toast({ kind: 'buff', title: t('Added to the shopping list') }); });
// a quest's items: everything its steps ask you to bring
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-quest-shop]'); if (!b) return;
  e.preventDefault(); e.stopPropagation();
  const items = JSON.parse(b.dataset.questShop);
  for (const it of items) await shopPost({ id: it.id, qty: it.qty, note: b.dataset.questName });
  toast({ kind: 'buff', title: t('{n} items added to the shopping list', { n: items.length }) });
});

// ---- regions (Guide tab): per zone the monsters with levels, the NPCs, the quests that start there, the danger forecast
let regionsData = null, regionSel = store.get('region', null);
async function renderRegions() {
  if (!regionsData) regionsData = await getJSON('/api/regions');
  if (!$('rgLevel').value) $('rgLevel').value = S?.session?.selfInfo?.level || store.get('huntLevel', '');
  const qq = $('rgSearch').value.trim().toLowerCase(), lv = +$('rgLevel').value || 0;
  const hit = (r) => !qq || r.name.toLowerCase().includes(qq) || r.mobs.some((m) => m.name.toLowerCase().includes(qq)) || r.npcs.some((n) => n.name.toLowerCase().includes(qq));
  const fits = (r) => !lv || r.mobs.some((m) => m.level >= lv - 5 && m.level <= lv + 5);
  const list = regionsData.filter((r) => hit(r) && fits(r));
  $('rgInfo').textContent = t('{n} of {total}', { n: list.length, total: regionsData.length });
  const here = S?.session?.position ? String(S.session.position.zone) : null;
  $('rgList').innerHTML = list.map((r) => `<div class="rg click ${String(r.zone) === String(regionSel) ? 'sel' : ''} ${String(r.zone) === here ? 'here-row' : ''}" data-region="${r.zone}"><b class="notr">${esc(r.name)}</b>${String(r.zone) === here ? ' <span class="here">●</span>' : ''}
    <small class="muted">${r.levels ? `Lv ${r.levels[0]}–${r.levels[1]} · ` : ''}${t('{m} monsters · {n} NPCs · {q} quests', { m: r.mobs.length, n: r.npcs.length, q: r.quests.length })}</small></div>`).join('') || `<div class="empty">${t('Nothing found.')}</div>`;
  const r = regionsData.find((x) => String(x.zone) === String(regionSel));
  if (!r) return;
  const [risk, hrs, qd] = await Promise.all([getJSON(`/api/zone-risk?zone=${r.zone}`).catch(() => null), getJSON(`/api/zone-hours?zone=${r.zone}`).catch(() => null), getJSON('/api/quests-done').catch(() => ({ done: [] }))]);
  // danger by hour of the day: your deaths and enemies met here (30 days); the hour now is marked
  const h0 = new Date().getHours(), mx = hrs ? Math.max(1, ...hrs.deaths, ...hrs.enemies) : 1;
  const hourBars = hrs && (hrs.deaths.some(Boolean) || hrs.enemies.some(Boolean)) ? `<h3>${t('Danger by hour')} <small class="muted">${t('your deaths and enemies met here, last 30 days')}</small></h3>
    <div class="hours24">${hrs.deaths.map((d, h) => `<div class="${h === h0 ? 'now' : ''}" title="${String(h).padStart(2, '0')}:00 · ${t('{d} deaths · {e} enemies', { d, e: hrs.enemies[h] })}"><i class="e" style="height:${(hrs.enemies[h] / mx) * 100}%"></i><i class="d" style="height:${(d / mx) * 100}%"></i></div>`).join('')}</div>
    <div class="muted" style="font-size:11px"><span class="swatch" style="background:var(--crimson)"></span>${t('deaths')} <span class="swatch" style="background:var(--gold)"></span>${t('enemies')} · 00 – 23 h</div>` : '';
  // the quest chain: quests starting here in level order, ticked off for your character, the next one marked
  const done = new Set(qd.done || []), active = new Set(qd.active || []), myLv = +$('rgLevel').value || S?.session?.selfInfo?.level || 0;
  const next = r.quests.find((q) => !done.has(q.id) && (!myLv || q.level <= myLv));
  const chain = `<h3 style="margin-top:12px">${t('Quest chain')} <small class="muted">${t('{d} of {n} done', { d: r.quests.filter((q) => done.has(q.id)).length, n: r.quests.length })}${qd.character ? ` · ${esc(qd.character)}` : ''}</small></h3>
    ${r.quests.slice(0, 120).map((q) => `<div class="qchain ${done.has(q.id) ? 'done' : ''} ${next && q.id === next.id ? 'next' : ''}"><input type="checkbox" data-rg-qdone="${q.id}" ${done.has(q.id) ? 'checked' : ''}>
      <span class="qlv">Lv ${q.level}</span> <span class="click notr" data-quest-find="${esc(q.name)}">${esc(q.name)}</span>${active.has(q.id) ? ` <span class="tag up">${t('in progress')}</span>` : next && q.id === next.id ? ` <span class="tag">${t('next')}</span>` : ''}</div>`).join('') || '<div class="muted">—</div>'}`;
  const marks = (S?.waypoints || []).filter((w) => w.zone === String(r.zone) && w.owner === 'Korean guide');
  const route = (x, z, label) => `<button class="small" data-world="${r.zone}" data-wx="${x}" data-wz="${z}">3D</button> <button class="small" data-route-zone="${r.zone}" data-route-x="${x}" data-route-z="${z}" data-route-label="${esc(label)}" title="${esc(t('Plan a route there'))}">🧭</button>`;
  $('rgBody').innerHTML = `<h2 class="notr">${esc(r.name)} <small>${r.levels ? `Lv ${r.levels[0]}–${r.levels[1]}` : ''}${r.kr ? ` · ${esc(r.kr.korean)}` : ''}</small></h2>
    ${risk && risk.level !== 'low' ? `<div class="note-box">⚠ ${[risk.deaths && t('you died here {n}× in 30 days', { n: risk.deaths }), risk.enemyCount && t('enemies met here around this hour: {names}', { names: esc(risk.enemies.map((e) => e.name).join(', ')) })].filter(Boolean).join(' · ')}</div>` : ''}
    ${marks.length ? `<div style="margin:6px 0">${marks.map((m) => `<div>❗ <b class="notr">${esc(m.label)}</b> <span class="muted" style="font-size:12px">${esc(t(m.note || ''))}</span> ${route(m.x, m.z, m.label)}</div>`).join('')}</div>` : ''}
    <div class="grid"><div class="c6"><h3>${t('Monsters')}</h3><table><tbody>${r.mobs.map((m) => `<tr class="${lv && Math.abs(m.level - lv) <= 5 ? 'here-row' : ''}"><td class="num" style="width:40px">${m.level}</td><td class="notr"><b>${esc(m.name)}</b>${m.spots > 1 ? ` <span class="muted">×${m.spots}</span>` : ''}</td><td>${route(m.x, m.z, m.name)}</td></tr>`).join('') || `<tr><td class="empty">—</td></tr>`}</tbody></table></div>
    <div class="c6">${hourBars}<h3>${t('NPCs')}</h3><table><tbody>${r.npcs.map((n) => `<tr><td class="notr"><b>${esc(n.name)}</b></td><td>${route(n.x, n.z, n.name)}</td></tr>`).join('') || `<tr><td class="empty">—</td></tr>`}</tbody></table>
    ${chain}</div></div>`;
}
$('rgBody').addEventListener('change', async (e) => {
  const c = e.target.closest('[data-rg-qdone]'); if (!c) return;
  await post('/api/quests/done', { id: +c.dataset.rgQdone, done: c.checked, character: S?.viewCharacter || S?.session?.character || '' });
  renderRegions();
});
$('rgList').addEventListener('click', (e) => { const r = e.target.closest('[data-region]'); if (!r) return; regionSel = r.dataset.region; store.set('region', regionSel); renderRegions(); });
for (const id of ['rgSearch', 'rgLevel']) $(id).addEventListener('input', debounce(renderRegions));

// ---- the next 24 hours (Live tab)
const DP_ICON = { boss: '🐉', checklist: '☑️', event: '🎉', maintenance: '🛠', pass: '⏱', custom: '📌' };
async function loadDayPlan() {
  let r; try { r = await getJSON('/api/day-plan'); } catch { return; }
  const tn = now();
  // when you usually play: one bar per hour from now on
  if (r.playHours) {
    const max = Math.max(...r.playHours), h0 = new Date(tn).getHours();
    $('dpPlay').innerHTML = Array.from({ length: 24 }, (_, k) => { const h = (h0 + k) % 24, v = r.playHours[h] / max; return `<i style="opacity:${0.12 + v * 0.88}" title="${String(h).padStart(2, '0')}:00"></i>`; }).join('')
      + `<small>${t('now')}</small><small>${t('+24 h')}</small>`;
  } else $('dpPlay').innerHTML = '';
  // bosses: who is coming (you and friends through friends sync) and a button to sign up
  const who = (x) => (x.coming?.length ? `<small>${t('coming: {names}', { names: esc(x.coming.map((n) => (n === 'you' ? t('you') : n)).join(', ')) })}</small>` : '');
  const sign = (x) => (x.kind === 'boss' && x.t > tn ? `<button class="small ${x.signedUp ? 'primary' : ''}" data-signup="${x.t}" data-signup-label="${esc(x.title)}" data-on="${x.signedUp ? '0' : '1'}" title="${esc(t('Tell your friends you\'re coming'))}">${x.signedUp ? t('✋ I\'m in') : t('✋ Join')}</button>` : '');
  $('dpList').innerHTML = r.items.length ? r.items.map((x) => `<div class="dp ${x.t < tn ? 'past' : ''}"><span class="mono">${hhmm(x.t)}</span><span>${DP_ICON[x.kind] || '•'}</span>
    <span><b class="notr">${esc(t(x.title))}</b>${x.sub ? `<small class="notr">${esc(t(x.sub))}</small>` : ''}${who(x)}</span><span class="muted mono">${x.t > tn ? `+${dur(x.t - tn)}` : ''}${sign(x)}</span></div>`).join('')
    : `<div class="empty" style="font-size:12px">${t('Nothing planned in the next 24 hours yet.')}</div>`;
}
$('dpList').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-signup]'); if (!b) return;
  await post('/api/signup', { t: +b.dataset.signup, label: b.dataset.signupLabel, on: b.dataset.on === '1' });
  loadDayPlan();
});
// your own recurring events (server time)
const EV_DAYS = () => [t('Mon'), t('Tue'), t('Wed'), t('Thu'), t('Fri'), t('Sat'), t('Sun')];
async function loadEvents(data) {
  const r = data || await getJSON('/api/events-custom');
  if (!$('evDays').children.length) $('evDays').innerHTML = EV_DAYS().map((d, i) => `<label class="wchk"><input type="checkbox" value="${i}">${esc(d)}</label>`).join('');
  const hm2 = (s) => `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`;
  $('evPresets').innerHTML = r.presets.map((p, i) => `<button class="small" data-ev-preset="${i}" title="${esc(`${t(p.note || '')} · ${p.slots.map((s) => `${s.days.length ? s.days.map((d) => EV_DAYS()[d]).join('/') : t('every day')} ${hm2(s)}`).join(', ')}`)}">${esc(p.name)} <span class="muted">(${p.slots.length})</span></button>`).join(' ');
  const days = (e) => (e.days.length && e.days.length < 7 ? e.days.map((d) => EV_DAYS()[d]).join(', ') : t('every day'));
  $('evList').innerHTML = r.list.map((e) => `<div class="ck"><span class="ckt"><span class="notr">${esc(e.name)}</span><small>${days(e)} · ${String(e.hour).padStart(2, '0')}:${String(e.minute).padStart(2, '0')}${e.next ? ` · ${t('next {time}', { time: dateTime(e.next) })}` : ''}</small></span>
    <button class="small" data-ev-del="${esc(e.id)}">×</button></div>`).join('');
}
const evPost = async (b) => { const res = await post('/api/events-custom', b); if (!res.ok) { toast({ kind: 'timer', title: await res.text() }); return; } loadEvents(await res.json()); loadDayPlan(); };
$('evAdd').addEventListener('click', () => {
  const [h, m] = ($('evTime').value || '20:00').split(':').map(Number);
  evPost({ action: 'add', name: $('evName').value, days: [...$('evDays').querySelectorAll('input:checked')].map((c) => +c.value), hour: h, minute: m, remind: +$('evRemind').value });
  $('evName').value = '';
});
$('evPresets').addEventListener('click', (e) => { const b = e.target.closest('[data-ev-preset]'); if (b) evPost({ action: 'preset', index: +b.dataset.evPreset }); });
$('evList').addEventListener('click', (e) => { const b = e.target.closest('[data-ev-del]'); if (b) evPost({ action: 'delete', id: b.dataset.evDel }); });
loadEvents();
loadDayPlan();
setInterval(() => { if (tab === 'live') loadDayPlan(); }, 60000);
for (const id of [...Object.values(enField), 'enOwn', 'enPool']) $(id).addEventListener('change', renderEnhance);
for (const id of ['enStone', 'enCharmPrice', 'enFee', 'enItem']) $(id).addEventListener('input', debounce(renderEnhance, 400));
$('enLogLevel').addEventListener('change', () => { $('enLogLevel').dataset.touched = '1'; });
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-enlog]');
  if (b) { await post('/api/enhance-log', { level: +$('enLogLevel').value, charm: $('enCharm').value, sofCharm: $('enSofCharm').value || undefined, ok: b.dataset.enlog === '1' }); renderEnhance(); }
  if (e.target.closest('#enUndo')) { await post('/api/enhance-log', { undo: true }); renderEnhance(); }
});

// ---- search everything (header)
function openGuidePane(pane, field, value, before) {
  document.querySelectorAll('dialog[open]').forEach((d) => d.close());
  showTab('hunting'); guidePane = pane; store.set('guidePane', pane); renderGuidePane();
  setTimeout(() => { before?.(); if (field) { $(field).value = value; $(field).dispatchEvent(new Event('input')); } }, 400);
}
const searchHits = new Map();
async function runSearch() {
  const q = $('gSearch').value.trim();
  if (q.length < 2) { $('gSearchPop').hidden = true; return; }
  const r = await getJSON(`/api/search?q=${encodeURIComponent(q)}`);
  if ($('gSearch').value.trim() !== q) return;
  searchHits.clear();
  let n = 0;
  const sub = (h, type) => {
    if (type === 'monster') return [`Lv ${h.level}`, ...(h.zones || [])].join(' · ');
    if (type === 'item') return [h.level > 1 ? `Lv ${h.level}` : '', h.price?.sell ? t('sells for {p} in the chat', { p: gold(h.price.sell) }) : ''].filter(Boolean).join(' · ');
    if (type === 'npc') return (h.zones || []).join(' · ');
    if (type === 'quest' || type === 'skill') return h.level ? `Lv ${h.level}` : '';
    if (type === 'boss') return h.next ? t('next ~{d}', { d: dur(Math.max(0, h.next - now())) }) : t('seen {n}×', { n: h.spawns });
    if (type === 'player') return [h.level && `Lv ${h.level}`, h.cls, h.faction].filter(Boolean).join(' · ');
    if (type === 'guide') return h.text;
    return '';
  };
  $('gSearchPop').innerHTML = r.groups.length ? r.groups.map((g) => `<h4>${esc(t(g.title))}</h4>${g.list.map((h) => { const k = String(n++); searchHits.set(k, { type: g.type, h });
    return `<button class="hit" data-hit="${k}"><span class="notr">${esc(h.name)}</span>${sub(h, g.type) ? `<small class="notr">${esc(sub(h, g.type))}</small>` : ''}</button>`; }).join('')}`).join('')
    : `<div class="muted" style="padding:8px">${t('Nothing found.')}</div>`;
  $('gSearchPop').hidden = false;
}
$('gSearch').addEventListener('input', debounce(runSearch, 200));
$('gSearch').addEventListener('focus', () => { if ($('gSearch').value.trim().length >= 2) runSearch(); });
$('gSearch').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { $('gSearchPop').hidden = true; $('gSearch').blur(); }
  if (e.key === 'Enter') $('gSearchPop').querySelector('.hit')?.click();
  if (e.key === 'ArrowDown') { e.preventDefault(); $('gSearchPop').querySelector('.hit')?.focus(); }
});
$('gSearchPop').addEventListener('keydown', (e) => {
  const hits = [...$('gSearchPop').querySelectorAll('.hit')], i = hits.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); hits[Math.min(hits.length - 1, i + 1)]?.focus(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); (i <= 0 ? $('gSearch') : hits[i - 1]).focus(); }
  if (e.key === 'Escape') { $('gSearchPop').hidden = true; $('gSearch').focus(); }
});
document.addEventListener('click', (e) => { if (!e.target.closest('.gsearch')) $('gSearchPop').hidden = true; });
$('gSearchPop').addEventListener('click', (e) => {
  const b = e.target.closest('[data-hit]'); if (!b) return;
  const { type, h } = searchHits.get(b.dataset.hit);
  $('gSearchPop').hidden = true;
  if (type === 'item') return openItem(`id=${h.id}`);
  if (type === 'monster') return openGuidePane('dbmobs', 'dbmSearch', h.name, () => { $('dbmMin').value = ''; $('dbmMax').value = ''; });
  if (type === 'npc') return openGuidePane('dbnpcs', 'dbnSearch', h.name);
  if (type === 'zone') return openGuidePane('dbzones', 'dbzSearch', h.name);
  if (type === 'skill') return openGuidePane('dbskills', 'dbsSearch', h.name, () => { if (h.cls) { $('dbsClass').value = String(h.cls); } });
  if (type === 'quest') return openGuidePane('dbquests', 'dbqSearch', h.name, () => { $('dbqLevel').value = ''; $('dbqRange').value = '999'; questMode = 'list'; });
  if (type === 'guide') { krSection = h.section; store.set('krSection', krSection); return openGuidePane('kr'); }
  if (type === 'boss') return showTab('stats');
  if (type === 'player') return openPlayer(h.name);
});
