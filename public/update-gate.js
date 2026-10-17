// The update screen, shared by the dashboard, the overlay, the phone page and the widgets. While the tracker says an
// update is required (S.blocked from /events, or a 426 answer), it covers the whole page: no close button, and it puts
// itself back if it is removed. The tracker itself enforces the block too (its data routes answer 426 and send nothing),
// so this screen is what the user sees, not what keeps them out.
(function () {
  const T = (s, p) => (window.t ? window.t(s, p) : String(s).replace(/\{(\w+)\}/g, (m, k) => (p && p[k] !== undefined ? p[k] : m)));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  // (the overlay, OBS pages and widgets are small windows: the short version there)
  const isSmall = () => /overlay|stream|widget/.test(location.pathname) || (window.innerWidth > 0 && window.innerWidth < 360);
  let el = null, u = null, wasBlocked = false, poll = 0, busy = false, keep = null;

  const css = `#sofGate{position:fixed;inset:0;z-index:2147483647;background:rgba(10,11,14,.97);color:#e6e3da;font:14px/1.45 Inter,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto}
#sofGate .box{max-width:560px;width:100%;background:#16181f;border:1px solid #d6a84a;border-radius:12px;padding:20px 22px;box-shadow:0 10px 40px rgba(0,0,0,.5)}
#sofGate h1{margin:0 0 6px;font-size:20px;color:#d6a84a}#sofGate p{margin:6px 0}#sofGate .m{color:#8d8a80;font-size:12px}
#sofGate .notes{white-space:pre-line;background:#0e0f13;border:1px solid #2a2e3a;border-radius:8px;padding:8px 10px;margin:10px 0;max-height:180px;overflow:auto;font-size:13px}
#sofGate .err{color:#ffb4aa;background:#3a1512;border-radius:6px;padding:6px 9px;margin:8px 0}
#sofGate .row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}#sofGate button,#sofGate a.b{font:600 14px Inter,system-ui,sans-serif;border-radius:8px;padding:9px 14px;border:1px solid #2a2e3a;background:#1c1f28;color:#e6e3da;cursor:pointer;text-decoration:none}
#sofGate button.p{background:#d6a84a;color:#1a1408;border-color:#d6a84a}#sofGate button:disabled{opacity:.6;cursor:default}
#sofGate .bar{height:8px;border-radius:4px;background:#2a2e3a;overflow:hidden;margin:10px 0 4px}#sofGate .bar i{display:block;height:100%;background:#d6a84a}
#sofGate.small .box{padding:12px}#sofGate.small h1{font-size:15px}`;

  function render() {
    if (!u) return;
    const tgt = u.target, d = u.download || {}, st = u.state, small = isSmall();
    const title = st === 'offline' ? T('SoF Tracker needs to check for updates') : st === 'revoked' ? T('This version of SoF Tracker was withdrawn') : T('Update required');
    const why = st === 'offline'
      ? T('It could not reach the update server for more than {h} hours. Connect to the internet and check again; nothing is lost.', { h: u.offlineGraceHours })
      : T('Version {cur} can no longer be used. Install version {v} to continue: your data and settings are kept.', { cur: u.current, v: tgt?.version || u.latest || '?' });
    const err = d.phase === 'failed' ? d.error : u.failed ? u.failed.reason : st === 'offline' && u.lastError ? u.lastError : null;
    const prog = d.phase === 'downloading' ? `<div class="bar"><i style="width:${d.total ? Math.round((d.bytes / d.total) * 100) : 0}%"></i></div><div class="m">${T('Downloading… {a} of {b}', { a: mb(d.bytes), b: mb(d.total) })}</div>`
      : d.phase === 'installing' ? `<p><b>${T('Setup is running.')}</b> ${T('The tracker closes and starts again by itself; this page reloads when it is back.')}</p>` : '';
    const canInstall = local && tgt && st !== 'offline' && d.phase !== 'downloading' && d.phase !== 'installing';
    el.className = small ? 'small' : '';
    el.innerHTML = `<div class="box" role="alertdialog" aria-modal="true" aria-labelledby="sofGateT">
      <h1 id="sofGateT">⬆ ${esc(title)}</h1><p>${st === 'revoked' && u.reason ? `<b>${esc(u.reason)}</b> ` : ''}${esc(why)}</p>
      ${u.message && !small ? `<p>${esc(u.message)}</p>` : ''}
      ${tgt?.notes && !small ? `<div class="notes"><b>${esc(T('What is new in {v}', { v: tgt.version }))}</b>\n${esc(tgt.notes)}</div>` : ''}
      ${tgt?.instructions && !small ? `<p class="m">${esc(tgt.instructions)}</p>` : ''}
      ${err ? `<div class="err">${esc(T('The last attempt did not work: {e}', { e: err }))}</div>` : ''}
      ${prog}
      <div class="row">
        ${canInstall ? `<button class="p" data-g="install" ${busy ? 'disabled' : ''}>${esc(err ? T('Try again') : T('Install the update'))}</button>` : ''}
        <button data-g="check" ${busy ? 'disabled' : ''}>${esc(T('Check again'))}</button>
        ${tgt?.url && !small ? `<a class="b" href="${esc(tgt.url)}" target="_blank" rel="noopener">${esc(T('Download the setup yourself'))}</a>` : ''}
      </div>
      ${!local && tgt ? `<p class="m">${esc(T('Install it on the PC that runs the tracker.'))}</p>` : ''}
      <p class="m">${esc(T('Installed: {cur}', { cur: u.current }))}${u.latest ? ` · ${esc(T('newest: {v}', { v: u.latest }))}` : ''}${u.minimum ? ` · ${esc(T('required: {v} or newer', { v: u.minimum }))}` : ''}${u.verifiedAt ? ` · ${esc(T('checked {when}', { when: new Date(u.verifiedAt).toLocaleString() }))}` : ''}</p>
    </div>`;
  }
  function mount() {
    if (!el) {
      el = document.createElement('div'); el.id = 'sofGate';
      el.addEventListener('click', onClick);
      const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s);
      // removed by hand (developer tools): put back
      keep = new MutationObserver(() => { if (u?.blocked && !document.body.contains(el)) document.body.appendChild(el); });
      keep.observe(document.body, { childList: true });
    }
    if (!document.body.contains(el)) document.body.appendChild(el);
    document.documentElement.style.overflow = 'hidden';
  }
  async function refresh() {
    try { const r = await fetch('/api/update', { cache: 'no-store' }); if (r.ok) show(await r.json()); } catch { /* tracker restarting (an update installing) */ }
  }
  async function onClick(e) {
    const b = e.target.closest('[data-g]'); if (!b) return;
    busy = true; render();
    try {
      if (b.dataset.g === 'install') await fetch('/api/update/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      else { const r = await fetch('/api/update/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); if (r.ok) { busy = false; return show(await r.json()); } }
    } catch { /* shown on the next poll */ }
    busy = false; refresh();
  }
  // called with the tracker's update status (S.update, or /api/update)
  function show(status) {
    if (!status) return;
    u = status;
    if (u.blocked) {
      wasBlocked = true; mount(); render();
      clearInterval(poll); poll = setInterval(refresh, (u.download?.phase === 'downloading' || u.download?.phase === 'installing') ? 1000 : 5000);
    } else if (wasBlocked) location.reload(); // updated (or checked again successfully): start the page fresh
  }
  // pages call this with each live message; true = blocked (the page skips its own rendering)
  function onState(S) { if (S?.blocked) { show(S.update); return true; } if (wasBlocked) location.reload(); return false; }
  window.SofGate = { show, onState, refresh };
  // any data request answered 426 means blocked
  const f0 = window.fetch;
  window.fetch = async (...a) => { const r = await f0(...a); if (r.status === 426) r.clone().json().then((j) => show(j.update)).catch(() => {}); return r; };
  // the tracker may have gone away mid-install: keep asking
  window.addEventListener('load', refresh);
})();
