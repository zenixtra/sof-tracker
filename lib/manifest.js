// The update file (updates/update.json): which versions may be used, signed with the publisher's Ed25519 key.
//
//   { "schema": 1, "keyId": "…", "payload": "<base64 of the JSON below>", "signature": "<base64 Ed25519 signature of payload's bytes>" }
//
// payload:
//   { "product": "sof-tracker", "sequence": 7, "issuedAt": "2026-10-17T09:00:00.000Z",
//     "latest": "1.45.0", "minimum": "1.44.0", "offlineGraceHours": 168, "message": "",
//     "releases": [{ "version": "1.45.0", "url": "https://github.com/…/SoF-Tracker-Setup-1.45.0.exe",
//                    "sha256": "<64 hex>", "size": 712345, "mandatory": false, "date": "2026-10-17",
//                    "notes": "What changed", "instructions": "" }],
//     "revoked": [{ "version": "1.44.1", "reason": "Crashes at start", "replacement": "1.45.0" }] }
//
// The signature covers the exact payload bytes, so nothing has to be re-serialised to check it. `sequence` goes up with
// every publish: a tracker never accepts an older update file than the one it already has (no replaying an old,
// more permissive file).
'use strict';

const crypto = require('crypto');
const version = require('./version');

const PRODUCT = 'sof-tracker';
const MAX_BYTES = 512 * 1024;
const MAX_INSTALLER = 300 * 1024 * 1024;

// throws with a plain explanation when something is off; returns the cleaned payload
function validate(p) {
  const bad = (m) => { throw new Error(`Update file: ${m}`); };
  if (!p || typeof p !== 'object' || Array.isArray(p)) bad('not an object');
  if (p.product !== PRODUCT) bad(`made for "${p.product}", not ${PRODUCT}`);
  if (!Number.isSafeInteger(p.sequence) || p.sequence < 1) bad('sequence must be a whole number from 1');
  if (typeof p.issuedAt !== 'string' || !Number.isFinite(Date.parse(p.issuedAt))) bad('issuedAt is not a date');
  for (const k of ['latest', 'minimum']) if (!version.valid(p[k])) bad(`${k} "${p[k]}" is not a version like 1.2.3`);
  if (version.compare(p.minimum, p.latest) > 0) bad('minimum is newer than latest');
  const grace = p.offlineGraceHours ?? 168;
  if (!Number.isFinite(grace) || grace < 0 || grace > 24 * 365) bad('offlineGraceHours must be 0 to 8760');
  if (!Array.isArray(p.releases) || !p.releases.length) bad('no releases');
  const releases = p.releases.map((r, i) => {
    if (!r || !version.valid(r.version)) bad(`release ${i + 1}: bad version`);
    let u; try { u = new URL(r.url); } catch { bad(`release ${r.version}: bad url`); }
    if (u.protocol !== 'https:') bad(`release ${r.version}: the download must use https`);
    if (!/^[0-9a-f]{64}$/.test(String(r.sha256 || ''))) bad(`release ${r.version}: sha256 must be 64 hex characters`);
    if (!Number.isSafeInteger(r.size) || r.size <= 0 || r.size > MAX_INSTALLER) bad(`release ${r.version}: bad size`);
    return { version: r.version, url: u.href, sha256: r.sha256, size: r.size, mandatory: !!r.mandatory, date: String(r.date || '').slice(0, 40),
      notes: String(r.notes || '').slice(0, 4000), instructions: String(r.instructions || '').slice(0, 2000) };
  });
  if (new Set(releases.map((r) => r.version)).size !== releases.length) bad('a version is listed twice');
  if (!releases.some((r) => r.version === p.latest)) bad(`no download for latest ${p.latest}`);
  const revoked = (Array.isArray(p.revoked) ? p.revoked : []).map((r) => {
    if (!r || !version.valid(r.version)) bad('revoked: bad version');
    if (r.replacement != null && !version.valid(r.replacement)) bad(`revoked ${r.version}: bad replacement`);
    return { version: r.version, reason: String(r.reason || '').slice(0, 500), replacement: r.replacement || null };
  });
  if (revoked.some((r) => r.version === p.latest)) bad('latest is revoked');
  return { product: PRODUCT, sequence: p.sequence, issuedAt: p.issuedAt, latest: p.latest, minimum: p.minimum, offlineGraceHours: grace,
    message: String(p.message || '').slice(0, 2000), releases, revoked };
}

// keys: [{ id, pem }] (public keys); returns the validated payload or throws
function verify(text, keys) {
  if (typeof text !== 'string' || text.length > MAX_BYTES) throw new Error('Update file: too large or empty');
  let env; try { env = JSON.parse(text); } catch { throw new Error('Update file: not valid JSON'); }
  if (!env || env.schema !== 1 || typeof env.payload !== 'string' || typeof env.signature !== 'string') throw new Error('Update file: not a signed update file');
  const key = keys.find((k) => k.id === env.keyId);
  if (!key) throw new Error(`Update file: signed with an unknown key (${String(env.keyId).slice(0, 20)})`);
  const bytes = Buffer.from(env.payload, 'base64');
  let ok = false;
  try { ok = crypto.verify(null, bytes, crypto.createPublicKey(key.pem), Buffer.from(env.signature, 'base64')); } catch { ok = false; }
  if (!ok) throw new Error('Update file: the signature does not match (changed or forged)');
  let payload; try { payload = JSON.parse(bytes.toString('utf8')); } catch { throw new Error('Update file: signed content is not JSON'); }
  return validate(payload);
}

// for the release tool: sign a payload object with a private key (PEM)
function sign(payload, privatePem, keyId) {
  const clean = validate(payload);
  const bytes = Buffer.from(JSON.stringify(clean, null, 1), 'utf8');
  const signature = crypto.sign(null, bytes, crypto.createPrivateKey(privatePem)).toString('base64');
  return `${JSON.stringify({ schema: 1, keyId, payload: bytes.toString('base64'), signature }, null, 1)}\n`;
}

// a short, stable name for a public key (in the update file, so keys can be rotated)
const keyIdOf = (publicPem) => crypto.createHash('sha256').update(crypto.createPublicKey(publicPem).export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);

module.exports = { validate, verify, sign, keyIdOf, PRODUCT, MAX_BYTES };
