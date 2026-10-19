// The Android app (android/): pairing and alerts.
//  - pairing: a QR code on the PC (Settings → Phone app) with a sofapp://pair?d=… link holding the PC's home-network
//    addresses and phone-view key (live view on your Wi-Fi) and a private ntfy topic (alerts anywhere)
//  - alerts: every alert the tracker shows also goes to that topic (data/phone-app.json: { topic, server, sendWhen })
// The topic is 24 random characters: whoever knows it can read the alerts, so it is only shown on this PC and can be
// replaced (Unpair phones), after which old phones get nothing more.
'use strict';

const crypto = require('crypto');

const URGENT = new Set(['danger', 'disconnect', 'whisper', 'party', 'update']);
const ICON = { danger: '⚠️', watch: '👁', disconnect: '🔌', maintenance: '🛠', timer: '⏱', boss: '🐉', event: '🎉', goal: '🎯', recap: '📋', report: '📊', milestone: '🏆', buff: '✨', whisper: '💬', stuck: '⏸', party: '🤝', price: '💰', chat: '🗨', digest: '🗓', patch: '🧩', checklist: '☑️', update: '⬆️', potion: '🧪' };
const newTopic = () => `sof-${crypto.randomBytes(18).toString('base64url')}`;

class PhoneApp {
  constructor({ read, save, isAway = () => false, fetchImpl = globalThis.fetch }) {
    this.d = { topic: null, server: 'https://ntfy.sh', sendWhen: 'always', pairedAt: null, sent: 0, lastError: null, ...(read() || {}) };
    this.saveFn = save; this.isAway = isAway; this.fetch = fetchImpl;
    this.queue = []; this.busy = false;
  }
  save() { this.saveFn(this.d); }
  // a topic for a new pairing (kept until "Unpair phones" makes a new one)
  ensureTopic() { if (!this.d.topic) { this.d.topic = newTopic(); this.d.pairedAt = Date.now(); this.save(); } return this.d.topic; }
  reset() { this.d.topic = newTopic(); this.d.pairedAt = Date.now(); this.d.sent = 0; this.save(); return this.d.topic; }
  setSendWhen(v) { if (['always', 'away'].includes(v)) { this.d.sendWhen = v; this.save(); } }

  // the QR code's link: { v, name, lan, key, ntfy, repo }
  pairing({ name, lan, key, repo }) {
    const payload = { v: 1, name, lan: key ? lan : [], key: key || '', ntfy: { server: this.d.server, topic: this.ensureTopic() }, repo: repo || '' };
    const d = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return { link: `sofapp://pair?d=${d}`, code: d, payload };
  }

  // an alert the tracker shows: to the phone too (after quiet hours / mutes were applied by the tracker)
  send(a) {
    if (!this.d.topic) return;
    if (this.d.sendWhen === 'away' && !this.isAway() && !URGENT.has(a.kind)) return;
    this.queue.push(a);
    if (this.queue.length > 30) this.queue.splice(0, this.queue.length - 30);
    this.drain();
  }
  async drain() {
    if (this.busy) return;
    this.busy = true;
    while (this.queue.length) {
      const a = this.queue.shift();
      try {
        // JSON publishing: titles and texts in any language and with emoji arrive as they are
        const r = await this.fetch(this.d.server, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ topic: this.d.topic, title: `${ICON[a.kind] || '🔔'} ${a.title}`, message: a.body || a.title, priority: URGENT.has(a.kind) ? 4 : 3, tags: [a.kind] }) });
        this.d.lastError = r.ok ? null : `relay answered ${r.status}`;
        if (r.ok) this.d.sent++;
      } catch (e) { this.d.lastError = e.message; }
      await new Promise((res) => setTimeout(res, 1000)); // well under the relay's limits
    }
    this.save();
    this.busy = false;
  }
  test() { this.send({ kind: 'update', title: 'Test from your SoF Tracker', body: 'If you can read this on your phone, alerts arrive there.' }); }
  view() { return { paired: !!this.d.topic, pairedAt: this.d.pairedAt, sendWhen: this.d.sendWhen, sent: this.d.sent, lastError: this.d.lastError, server: this.d.server }; }
}

module.exports = { PhoneApp, newTopic, URGENT };
