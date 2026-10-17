// Service worker: makes the dashboard installable as an app (on this PC; phones need HTTPS for that) and shows the
// last loaded dashboard when the tracker can't be reached. Live data always comes from the network.
const CACHE = 'sof-shell-v1';
const SHELL = ['/', '/css/app.css', '/i18n-dict.js', '/i18n.js', '/help.js', '/js/core.js', '/js/live.js', '/js/history.js', '/js/guide.js', '/js/stats.js', '/js/social.js', '/js/settings.js', '/js/main.js', '/icons/icon-192.png'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname === '/events') return;
  // network first, the cached copy when the tracker is off
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok && SHELL.includes(url.pathname)) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
