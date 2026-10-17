// The weekly / monthly report as one self-contained HTML page (Reports → "Save as a page"): opens in any browser
// without the tracker, so it can be kept or sent to someone. Charts are inline SVG; no scripts, no outside files.
'use strict';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hm = (ms) => { const m = Math.round((ms || 0) / 60000); return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`; };
const n0 = (v, d = 0) => (v ?? 0).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
const gold = (v) => { if (v == null) return '—'; const a = Math.abs(v), s = v < 0 ? '−' : ''; return a >= 1e9 ? `${s}${(a / 1e9).toFixed(1)}b` : a >= 1e6 ? `${s}${(a / 1e6).toFixed(1)}m` : a >= 1e3 ? `${s}${Math.round(a / 1e3)}k` : `${s}${Math.round(a)}`; };
const signed = (v, f = gold) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${f(v)}`);
const day = (t, o) => new Date(t).toLocaleDateString('en-GB', o || { day: 'numeric', month: 'short', year: 'numeric' });

// play time per day: rounded-top bars on a baseline, every bar labelled on hover (title) and the busiest one in text
function dayBars(days) {
  const W = 640, Hh = 170, m = { l: 34, r: 6, t: 10, b: 22 }, max = Math.max(1, ...days.map((d) => d.ms / 3600000));
  const bw = (W - m.l - m.r) / Math.max(1, days.length), Y = (v) => m.t + (1 - v / max) * (Hh - m.t - m.b);
  const grid = [0, 0.5, 1].map((f) => `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(max * f)}" y2="${Y(max * f)}" class="g"/><text x="${m.l - 5}" y="${Y(max * f) + 4}" text-anchor="end" class="ax">${n0(max * f, max < 5 ? 1 : 0)}h</text>`).join('');
  const step = Math.ceil(days.length / 10);
  const bars = days.map((d, i) => {
    const v = d.ms / 3600000, x = m.l + i * bw + 1, w = Math.max(2, bw - 2), y = Y(v), h = Hh - m.b - y, r = Math.min(4, h, w / 2);
    const lbl = days.length > 8 ? day(new Date(d.day + 'T12:00:00'), { day: 'numeric' }) : day(new Date(d.day + 'T12:00:00'), { weekday: 'short' });
    return `<g><title>${esc(day(new Date(d.day + 'T12:00:00'), { weekday: 'long', day: 'numeric', month: 'short' }))}: ${hm(d.ms)}</title>${h > 0.5 ? `<path d="M${x},${Hh - m.b}V${y + r}q0,-${r} ${r},-${r}H${x + w - r}q${r},0 ${r},${r}V${Hh - m.b}Z" class="bar"/>` : ''}${i % step === 0 ? `<text x="${x + w / 2}" y="${Hh - 6}" text-anchor="middle" class="ax">${esc(lbl)}</text>` : ''}</g>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Play time per day">${grid}${bars}</svg>`;
}

function reportPage(r, { zoneName = (z) => `Zone ${z}`, version = '' } = {}) {
  const title = r.month ? `Month of ${day(r.weekStart, { month: 'long', year: 'numeric' })}` : `Week of ${day(r.weekStart)}`;
  const my = r.mine || {}, sc = r.screen || {}, tracked = (r.activeMs || 0) + (r.afkMs || 0);
  const kpi = (label, v, sub = '') => `<div class="kpi"><div class="l">${esc(label)}</div><div class="v">${v}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
  const pct = (ok, n) => (n ? `${ok} of ${n} (${Math.round((ok / n) * 100)}%)` : '—');
  const table = (head, rows, empty) => (rows.length ? `<table><thead><tr>${head.map((h, i) => `<th${i ? ' class="num"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((c, i) => `<td${i ? ' class="num"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>` : `<p class="empty">${esc(empty)}</p>`);
  const best = r.days.reduce((a, d) => (d.ms > (a?.ms || 0) ? d : a), null);
  const z = r.zones.slice(0, 8), zt = r.zones.reduce((a, x) => a + x.ms, 0) || 1;
  const dz = r.deaths || { count: 0, killers: [], zones: [] }, cr = r.craft || {};
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>SoF Report</title>
<style>
:root { --bg: #f6f3ec; --panel: #fffdf8; --line: #e2dccd; --text: #2b2418; --muted: #776d5c; --accent: #9a6a12; --bar: #2f6fae; color-scheme: light dark; }
@media (prefers-color-scheme: dark) { :root { --bg: #0e0f13; --panel: #16181f; --line: #2a2e3a; --text: #e6e3da; --muted: #8d8a80; --accent: #d6a84a; --bar: #6aa7e0; } }
* { box-sizing: border-box; } body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 980px; margin: 0 auto; padding: 24px 16px 40px; }
h1 { font-size: 26px; margin: 0; } h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin: 0 0 10px; }
.sub { color: var(--muted); margin: 4px 0 18px; }
.kpis { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; margin-bottom: 14px; }
.kpi, section { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px 14px; }
.kpi .l { font-size: 12px; color: var(--muted); } .kpi .v { font-size: 22px; font-weight: 650; font-variant-numeric: tabular-nums; } .kpi .s { font-size: 12px; color: var(--muted); }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px; } section { margin-bottom: 0; } section.wide { grid-column: 1 / -1; }
table { width: 100%; border-collapse: collapse; font-size: 14px; } th, td { text-align: left; padding: 5px 6px; border-bottom: 1px solid var(--line); } th { font-size: 12px; color: var(--muted); font-weight: 600; }
.num { text-align: right; font-variant-numeric: tabular-nums; } .empty { color: var(--muted); font-size: 13px; margin: 0; }
svg { width: 100%; height: auto; display: block; } svg .g { stroke: var(--line); } svg .ax { fill: var(--muted); font-size: 11px; } svg .bar { fill: var(--bar); }
.recap { font-size: 13px; padding: 6px 0; border-bottom: 1px solid var(--line); } .recap:last-child { border: 0; } .muted { color: var(--muted); }
footer { color: var(--muted); font-size: 12px; margin-top: 18px; }
</style></head><body><main>
<h1>${esc(title)}${my.character ? ` · ${esc(my.character)}` : ''}</h1>
<p class="sub">${esc(day(r.weekStart))} – ${esc(day(r.weekEnd - 1))} · Scions of Fate, from SoF Tracker</p>
<div class="kpis">
${kpi('Played', hm(r.playMs), best && best.ms ? `most on ${esc(day(new Date(best.day + 'T12:00:00'), { weekday: 'short', day: 'numeric', month: 'short' }))}` : '')}
${kpi('Sessions', n0(r.sessions), tracked ? `${Math.round((r.activeMs / tracked) * 100)}% active` : '')}
${kpi('EXP gained', r.screen ? `+${n0(sc.exp, 1)}%` : '—', r.screen ? `${n0(sc.kills)} kills${sc.levels ? ` · ${sc.levels} level-ups` : ''}` : '')}
${kpi('Deaths', n0(dz.count), dz.toPlayers ? `${dz.toPlayers} to players` : '')}
${kpi('Gold', signed(my.goldChange), 'from the inventory')}
${kpi('Net worth', signed(my.netWorthChange), 'gold + gear at chat prices')}
${kpi('Quests', n0(my.questsDone || 0), 'handed in')}
${kpi('Players met', n0(r.playersMet), `${n0(r.newPlayers)} new`)}
</div>
<div class="grid">
<section class="wide"><h2>Play time per day</h2>${dayBars(r.days)}</section>
<section><h2>Where you played</h2>${table(['Zone', 'Time', 'Share'], z.map((x) => [esc(x.name || zoneName(x.zone)), hm(x.ms), `${Math.round((x.ms / zt) * 100)}%`]), 'No tracked sessions.')}</section>
<section><h2>Best monsters <span class="muted" style="text-transform:none;letter-spacing:0">(all you fought)</span></h2>${table(['Monster', 'EXP / hour', 'Per kill', 's / kill'], (r.mobs || []).map((m) => [esc(m.name), n0(m.expPerHour), n0(m.expPerKill), m.secPerKill ?? '—']), 'No monster stats yet.')}</section>
<section><h2>Deaths</h2>${dz.count ? `<p style="margin:0 0 8px">${n0(dz.count)} deaths${dz.expLost ? `, ${n0(dz.expLost, 2)}% of a level in EXP lost` : ''}.</p>` : ''}${table(['Killed by', 'Times'], dz.killers.map(([k, n]) => [esc(k), n]), dz.count ? 'The game did not name the killers.' : 'No deaths. Nice.')}${dz.zones.length ? table(['Where', 'Deaths'], dz.zones.map(([k, n]) => [esc(k), n]), '') : ''}</section>
<section><h2>Luck</h2>${table(['What', 'Worked'], [['Enchanting', pct(cr.enchant?.ok, cr.enchant?.n)], ['Combining', pct(cr.combine?.ok, cr.combine?.n)], ['Enhancing', pct(cr.enhance?.ok, cr.enhance?.n)]], '')}
<p class="empty" style="margin-top:8px">Potions: ${n0((my.hpPots || 0) + (my.mpPots || 0))}${my.potionCost ? ` (~${gold(my.potionCost)} gold)` : ''} · Maze runs: ${n0(my.mazeRuns || 0)}${my.honorGained != null ? ` · Honor ${signed(my.honorGained, n0)}` : ''}</p></section>
<section><h2>Who you met most</h2>${table(['Name', 'Sessions', 'Near you'], r.topPlayers.slice(0, 8).map((m) => [esc(m.name), m.sessions, m.nearMs ? hm(m.nearMs) : '—']), 'Nobody.')}</section>
<section><h2>Price changes</h2>${table(['Item', 'Before', 'Now', 'Change'], (r.movers || []).slice(0, 10).map((m) => [esc(m.item), gold(m.before), gold(m.now), `${m.change > 0 ? '▲' : '▼'} ${Math.abs(m.change)}%`]), 'Not enough chat offers to compare.')}</section>
${r.recaps.length ? `<section class="wide"><h2>Session recaps</h2>${r.recaps.slice(-20).map((x) => `<div class="recap"><span class="muted">${esc(day(x.at, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))} · ${esc(x.character || '?')}</span><br>${esc(x.recap)}</div>`).join('')}</section>` : ''}
</div>
<footer>Made by SoF Tracker ${esc(version)} on ${esc(day(Date.now(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }))}. Everything here comes from your own PC: the game's log files, the screen reader and the public rankings.</footer>
</main></body></html>`;
}

module.exports = { reportPage };
