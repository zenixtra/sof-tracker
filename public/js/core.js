// SoF Tracker dashboard: core. Loaded as a classic script; all dashboard scripts share one global scope (see index.html).

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)'];
const CLASSES = ['Blade', 'Sword', 'Spear', 'Bow', 'Healer', 'Ninja', 'Busker', 'Hanbia', 'DamHwalyn', 'Fighter', 'Maeyujin', 'Noho', 'Migo'];
const store = {
  get(k, d) { try { const v = localStorage.getItem('sof.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('sof.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

let S = null, clockOffset = 0, tab = 'live';

// ---------------------------------------------------------------- formatting helpers
function dur(ms) {
  if (ms == null || ms < 0) return '—';
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h >= 48) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : m ? `${m}m ${String(sec).padStart(2, '0')}s` : `${sec}s`;
}
const countdown = (ms) => { if (ms <= 0) return 'now'; const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const clock = (t) => t ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
const dateTime = (t) => t ? new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const dateOnly = (t) => t ? new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
// in-game money the way players write it: 750k, 20m, 1.5b
const gold = (v) => (v == null ? '—' : v >= 1e9 ? `${num(v / 1e9, v % 1e9 ? 1 : 0)}b` : v >= 1e6 ? `${num(v / 1e6, v % 1e6 ? 1 : 0)}m` : v >= 1e3 ? `${num(v / 1e3)}k` : num(v));
const num = (n, d = 0) => (n ?? 0).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d });
const zoneName = (z) => S?.labels?.zones?.[z] || t('Zone {id}', { id: z });
const buffName = (id) => S?.labels?.buffs?.[id] || t('Effect #{id}', { id });
const now = () => Date.now() + clockOffset;
const facKey = (f) => (/order/i.test(f || '') ? 'order' : /chaos/i.test(f || '') ? 'chaos' : 'unknown');
const facBadge = (f) => (f ? `<span class="fac ${facKey(f)}">${esc(f.replace(/^The /, ''))}</span>` : '<span class="fac unknown">?</span>');
const q = (s) => s ?? '<span class="muted">?</span>';
const flag = '<span class="flag" title="Was part of a danger alert">⚠</span>';
const friendFlags = (x) => (x.friendThreat?.length ? `<span class="flag" title="${esc(t('Flagged by {names}', { names: x.friendThreat.join(', ') }))}">⚠ᶠ</span>` : '')
  + (x.friendWatch?.length ? `<span class="fflag" title="${esc(t('Watched by {names}', { names: x.friendWatch.join(', ') }))}">★ᶠ</span>` : '')
  + (x.info?.friendNote ? `<span class="fflag" title="${esc(t('Notes from {name}', { name: x.info.friendNote }))}">✎ᶠ</span>` : '');
const star = (name, on) => `<button class="star ${on ? 'on' : ''}" data-watch="${esc(name)}" title="${on ? 'Stop watching' : 'Watch this player'}">${on ? '★' : '☆'}</button>`;
const getJSON = (u) => fetch(u).then((r) => r.json());
const post = (u, body) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const isWatched = (name) => (S?.watchlist || []).some((w) => w.toLowerCase() === String(name).toLowerCase());

// ---------------------------------------------------------------- tabs
function showTab(name) {
  tab = name;
  for (const b of $('nav').children) b.classList.toggle('active', b.dataset.tab === name);
  for (const el of document.querySelectorAll('.tab')) el.classList.toggle('active', el.id === 'tab-' + name);
  if (name !== 'sessions') stopReplay();
  store.set('tab', name);
  if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
  loaders[name]?.();
  if (name === 'alerts') markAlertsRead();
}
$('nav').addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); });

// ---------------------------------------------------------------- line chart (SVG, hover crosshair, direct labels)
function lineChart(el, { series, height = 220, yFmt = (v) => num(v), step = false, empty = 'Not enough history yet.' }) {
  const pts = series.flatMap((s) => s.points);
  if (new Set(pts.map((p) => p[0])).size < 2) { el.innerHTML = `<div class="empty">${empty}</div>`; return; }
  const W = Math.max(320, el.clientWidth || 600), H = height, m = { l: 48, r: 92, t: 10, b: 24 };
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]).filter((v) => v != null);
  let x0 = Math.min(...xs), x1 = Math.max(...xs); if (x0 === x1) { x0 -= 3600000; x1 += 3600000; }
  let y0 = Math.min(...ys), y1 = Math.max(...ys); if (y0 === y1) { y0 -= 1; y1 += 1; }
  const pad = (y1 - y0) * 0.08; y0 = Math.max(0, y0 - pad); y1 += pad;
  const X = (x) => m.l + ((x - x0) / (x1 - x0)) * (W - m.l - m.r);
  const Y = (y) => m.t + (1 - (y - y0) / (y1 - y0)) * (H - m.t - m.b);
  const ticks = 4, grid = [];
  for (let i = 0; i <= ticks; i++) { const v = y0 + ((y1 - y0) * i) / ticks; grid.push(`<line x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${m.l - 8}" y="${Y(v) + 4}" text-anchor="end" fill="var(--muted)" font-size="11">${yFmt(v)}</text>`); }
  const span = x1 - x0, xt = [];
  for (let i = 0; i <= 3; i++) { const t = x0 + (span * i) / 3; xt.push(`<text x="${X(t)}" y="${H - 6}" text-anchor="middle" fill="var(--muted)" font-size="11">${span > 2 * 86400000 ? new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' }) : new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</text>`); }
  // end-of-line direct labels, nudged apart so they never overlap
  const ends = series.map((s, i) => {
    const p = s.points.filter((x) => x[1] != null);
    return p.length ? { i, x: X(p[p.length - 1][0]), y: Y(p[p.length - 1][1]) } : null;
  }).filter(Boolean).sort((a, b) => a.y - b.y);
  ends.forEach((e, k) => { e.ly = k ? Math.max(e.y, ends[k - 1].ly + 13) : e.y; });
  const labelY = Object.fromEntries(ends.map((e) => [e.i, e.ly]));
  const paths = series.map((s, si) => {
    const p = s.points.filter((x) => x[1] != null);
    if (!p.length) return '';
    let d = `M${X(p[0][0])},${Y(p[0][1])}`;
    for (let i = 1; i < p.length; i++) d += step ? `H${X(p[i][0])}V${Y(p[i][1])}` : `L${X(p[i][0])},${Y(p[i][1])}`;
    const lx = X(p[p.length - 1][0]), ly = Y(p[p.length - 1][1]);
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>
      <circle cx="${lx}" cy="${ly}" r="4" fill="${s.color}" stroke="var(--panel)" stroke-width="2"/>
      <text x="${lx + 8}" y="${labelY[si] + 4}" fill="var(--text)" font-size="11">${esc(s.name)}</text>`;
  });
  el.innerHTML = `<div class="legend">${series.length > 1 ? series.map((s) => `<span><span class="swatch" style="background:${s.color}"></span>${esc(s.name)}</span>`).join('') : ''}</div>
    <svg viewBox="0 0 ${W} ${H}" role="img">${grid.join('')}${xt.join('')}${paths.join('')}
    <line class="xh" y1="${m.t}" y2="${H - m.b}" stroke="var(--muted)" stroke-dasharray="3 3" visibility="hidden"/>
    <rect x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" fill="transparent"/></svg><div class="tip"></div>`;
  const svg = el.querySelector('svg'), tip = el.querySelector('.tip'), xh = el.querySelector('.xh');
  const allT = [...new Set(xs)].sort((a, b) => a - b);
  svg.addEventListener('mousemove', (e) => {
    const r = svg.getBoundingClientRect(), mx = ((e.clientX - r.left) / r.width) * W;
    const t = allT.reduce((best, x) => (Math.abs(X(x) - mx) < Math.abs(X(best) - mx) ? x : best), allT[0]);
    xh.setAttribute('x1', X(t)); xh.setAttribute('x2', X(t)); xh.setAttribute('visibility', 'visible');
    const rows = series.map((s) => { const p = [...s.points].reverse().find((x) => x[0] <= t && x[1] != null); return p ? `<div><span class="swatch" style="background:${s.color}"></span>${esc(s.name)}: <b>${yFmt(p[1])}</b></div>` : ''; }).join('');
    tip.innerHTML = `<div class="muted">${dateTime(t)}</div>${rows}`;
    tip.style.display = 'block';
    const left = (X(t) / W) * r.width;
    tip.style.left = Math.min(left + 12, r.width - tip.offsetWidth) + 'px';
    tip.style.top = '20px';
  });
  svg.addEventListener('mouseleave', () => { tip.style.display = 'none'; xh.setAttribute('visibility', 'hidden'); });
}

function barChart(el, { bars, height = 200, yFmt = (v) => v }) {
  if (!bars.length) { el.innerHTML = '<div class="empty">No data yet.</div>'; return; }
  const W = Math.max(280, el.clientWidth || 400), H = height, m = { l: 40, r: 8, t: 10, b: 24 };
  const max = Math.max(...bars.map((b) => b.v), 1);
  const bw = (W - m.l - m.r) / bars.length;
  const Y = (v) => m.t + (1 - v / max) * (H - m.t - m.b);
  const grid = [0, 0.5, 1].map((f) => `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(max * f)}" y2="${Y(max * f)}" stroke="var(--line)"/><text x="${m.l - 6}" y="${Y(max * f) + 4}" text-anchor="end" fill="var(--muted)" font-size="11">${yFmt(max * f)}</text>`).join('');
  const rects = bars.map((b, i) => {
    const x = m.l + i * bw + 1, w = Math.max(2, bw - 2), y = Y(b.v), h = H - m.b - y, r = Math.min(4, h, w / 2);
    return `<g><title>${esc(b.label)}: ${yFmt(b.v)}</title>${h > 0.5 ? `<path d="M${x},${H - m.b}V${y + r}q0,-${r} ${r},-${r}H${x + w - r}q${r},0 ${r},${r}V${H - m.b}Z" fill="var(--s4)"/>` : ''}
      ${i % Math.ceil(bars.length / 6) === 0 ? `<text x="${x + w / 2}" y="${H - 6}" text-anchor="middle" fill="var(--muted)" font-size="11">${esc(b.short)}</text>` : ''}</g>`;
  }).join('');
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}">${grid}${rects}</svg>`;
}
