// Which HTTP requests the tracker accepts. The tracker listens on this PC (and, in phone mode, on your home network),
// and a web page you visit in your browser could otherwise talk to it too:
//  - DNS rebinding: a site whose name points at 127.0.0.1 could read your data. The Host header must therefore be
//    localhost, a loopback address, or (phone mode) a private-network IP address or this PC's own name.
//  - Cross-site requests: a site could make your browser send commands (change settings, start programs).
//    A request another site started (Origin from elsewhere, Sec-Fetch-Site: cross-site) is refused.
//  - Phone mode: other devices on the network need the access key (?key=… once, then a cookie).
// Programs on this PC (the tray, the installer) send no Origin and are allowed.
'use strict';

const crypto = require('crypto');

const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const isLoopbackAddr = (a) => /^(::1|127\.|::ffff:127\.)/.test(a || '');
// private IPv4 ranges (10/8, 172.16/12, 192.168/16), link-local, and 100.64/10 (Tailscale and other private VPNs),
// as typed in a phone's address bar
const isPrivateIp = (h) => /^(10\.\d{1,3}|192\.168|172\.(1[6-9]|2\d|3[01])|169\.254|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7]))\.\d{1,3}\.\d{1,3}$/.test(h);

// "host:port" → { name, port }
function splitHost(h) {
  const m = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(String(h || '').trim().toLowerCase());
  return m ? { name: m[1], port: m[2] ? +m[2] : null } : null;
}

function hostAllowed(host, { port, lanMode, pcNames = [] }) {
  const h = splitHost(host);
  if (!h || (h.port != null && h.port !== port)) return false;
  if (LOOPBACK_NAMES.has(h.name)) return true;
  if (!lanMode) return false;
  return isPrivateIp(h.name) || pcNames.map((n) => String(n).toLowerCase()).some((n) => h.name === n || h.name === `${n}.local`);
}

const safeEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
function cookieValue(header, name) {
  for (const part of String(header || '').split(';')) { const [k, ...v] = part.trim().split('='); if (k === name) return decodeURIComponent(v.join('=')); }
  return null;
}

// returns { ok: true, setCookie? } or { ok: false, status, reason }
function check(req, url, { port, lanMode, lanKey, pcNames }) {
  const remote = req.socket?.remoteAddress || '';
  const host = req.headers.host;
  if (!hostAllowed(host, { port, lanMode, pcNames })) return { ok: false, status: 403, reason: 'Unknown host name: open the tracker at http://localhost:' + port };
  const site = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (site === 'cross-site') return { ok: false, status: 403, reason: 'Requests from other websites are not allowed' };
  const origin = req.headers.origin;
  if (origin !== undefined) {
    let o = null; try { o = origin === 'null' ? null : new URL(origin); } catch { o = null; }
    // the page must come from the tracker itself (same host name it was opened at)
    if (!o || o.protocol !== 'http:' || !hostAllowed(o.host, { port, lanMode, pcNames }) || (splitHost(o.host)?.name !== splitHost(host)?.name)) {
      return { ok: false, status: 403, reason: 'Requests from other websites are not allowed' };
    }
  }
  if (isLoopbackAddr(remote)) return { ok: true };
  // another device (phone mode): the access key
  if (!lanMode || !lanKey) return { ok: false, status: 403, reason: 'This PC only' };
  const q = url.searchParams.get('key');
  if (q && safeEqual(q, lanKey)) return { ok: true, setCookie: `sof_key=${encodeURIComponent(lanKey)}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict` };
  if (safeEqual(cookieValue(req.headers.cookie, 'sof_key'), lanKey)) return { ok: true };
  return { ok: false, status: 401, reason: 'Open the address with the access key shown on the PC (Settings → phone view)' };
}

const newKey = () => crypto.randomBytes(18).toString('base64url');

module.exports = { check, hostAllowed, isLoopbackAddr, isPrivateIp, newKey, cookieValue };
