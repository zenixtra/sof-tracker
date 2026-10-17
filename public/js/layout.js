// SoF Tracker dashboard: your own layout. Loaded as a classic script; all dashboard scripts share one global scope (see index.html).
// Every panel of a tab gets a stable key (its id, or the tab + its English heading). The order per grid and the hidden
// panels are kept in the tracker's settings (layout), so every browser on this PC shows the same dashboard.

const layoutGrids = []; // [{ key, el, panels: [el] }] in page order
(function keyPanels() {
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'panel';
  const used = new Set();
  for (const tabEl of document.querySelectorAll('section.tab')) {
    const tabId = tabEl.id.replace(/^tab-/, '');
    tabEl.querySelectorAll(':scope > .grid').forEach((grid, gi) => {
      const panels = [...grid.children].filter((p) => p.classList.contains('panel'));
      if (panels.length < 2) return;
      for (const p of panels) {
        const head = p.querySelector('h2, h3');
        const text = head ? [...head.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join(' ').trim() : '';
        let k = p.id || `${tabId}-${slug(text)}`;
        for (let i = 2; used.has(k); i++) k = `${p.id || `${tabId}-${slug(text)}`}-${i}`;
        used.add(k); p.dataset.pk = k;
      }
      layoutGrids.push({ key: `${tabId}#${gi}`, el: grid, panels });
    });
  }
})();

let layout = { order: {}, hidden: [] }, layoutLoaded = false;
function applyLayout(l) {
  layout = { order: l?.order || {}, hidden: l?.hidden || [] };
  const hidden = new Set(layout.hidden);
  for (const g of layoutGrids) {
    const want = layout.order[g.key] || [];
    // the saved order first; panels that are new since then keep their place after the ones before them
    const rank = new Map(want.map((k, i) => [k, i]));
    const sorted = g.panels.slice().sort((a, b) => (rank.get(a.dataset.pk) ?? 1e3 + g.panels.indexOf(a)) - (rank.get(b.dataset.pk) ?? 1e3 + g.panels.indexOf(b)));
    for (const p of sorted) g.el.appendChild(p);
    for (const p of g.panels) p.classList.toggle('lay-hidden', hidden.has(p.dataset.pk));
  }
  layoutLoaded = true;
}
const saveLayout = () => post('/api/settings', { layout }).catch(() => {});

// ---- editing: drag by the handle, hide / show, reset the tab
function layoutBars(on) {
  document.documentElement.classList.toggle('lay-edit', on);
  for (const g of layoutGrids) for (const p of g.panels) {
    p.draggable = on;
    let bar = p.querySelector(':scope > .laybar');
    if (!on) { bar?.remove(); continue; }
    if (!bar) {
      bar = document.createElement('div'); bar.className = 'laybar';
      bar.innerHTML = `<span class="layhandle" title="${esc(t('Drag to move'))}">⠿</span><button class="small" data-lay-move="-1" title="${esc(t('Move earlier'))}">◀</button><button class="small" data-lay-move="1" title="${esc(t('Move later'))}">▶</button><button class="small" data-lay-hide>${esc(t(p.classList.contains('lay-hidden') ? 'Show' : 'Hide'))}</button>`;
      p.prepend(bar);
    }
  }
  $('layDone').hidden = !on;
}
function gridOf(p) { return layoutGrids.find((g) => g.panels.includes(p)); }
function rememberOrder(g) { layout.order[g.key] = [...g.el.children].filter((x) => x.dataset.pk).map((x) => x.dataset.pk); }
$('btnLayout').onclick = () => layoutBars(!document.documentElement.classList.contains('lay-edit'));
$('layFinish').onclick = () => layoutBars(false);
$('layReset').onclick = () => {
  for (const g of layoutGrids.filter((x) => x.key.startsWith(`${tab}#`))) { delete layout.order[g.key]; layout.hidden = layout.hidden.filter((k) => !g.panels.some((p) => p.dataset.pk === k)); }
  applyLayout(layout); saveLayout(); layoutBars(true);
};
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-lay-move], [data-lay-hide]');
  if (!b) return;
  const p = b.closest('.panel'), g = gridOf(p);
  if (!g) return;
  if (b.dataset.layMove) {
    const sib = +b.dataset.layMove < 0 ? p.previousElementSibling : p.nextElementSibling;
    if (sib?.dataset.pk) (+b.dataset.layMove < 0 ? sib.before(p) : sib.after(p));
    rememberOrder(g);
  } else {
    const k = p.dataset.pk, off = !layout.hidden.includes(k);
    layout.hidden = off ? [...layout.hidden, k] : layout.hidden.filter((x) => x !== k);
    p.classList.toggle('lay-hidden', off);
    b.textContent = t(off ? 'Show' : 'Hide');
  }
  saveLayout();
});
let layDrag = null;
document.addEventListener('dragstart', (e) => { const p = e.target.closest?.('.panel[data-pk]'); if (!p || !document.documentElement.classList.contains('lay-edit')) return; layDrag = p; p.classList.add('lay-drag'); e.dataTransfer.effectAllowed = 'move'; });
document.addEventListener('dragover', (e) => {
  const over = e.target.closest?.('.panel[data-pk]');
  if (!layDrag || !over || over === layDrag || gridOf(over) !== gridOf(layDrag)) return;
  e.preventDefault();
  const r = over.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2 || (e.clientX > r.left + r.width / 2 && e.clientY > r.top);
  (after ? over.after(layDrag) : over.before(layDrag));
});
document.addEventListener('dragend', () => { if (!layDrag) return; layDrag.classList.remove('lay-drag'); rememberOrder(gridOf(layDrag)); layDrag = null; saveLayout(); });
getJSON('/api/settings').then((st) => applyLayout(st.layout)).catch(() => {});
