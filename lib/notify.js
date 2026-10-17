// Sends tracker alerts to your phone or group: ntfy (free push app), Telegram bot, Discord webhook.
// Settings live in data/notify.json and are only readable from this PC.
'use strict';

const store = require('./store');

const DEFAULTS = {
  ntfyServer: 'https://ntfy.sh',
  ntfyTopic: '',
  telegramToken: '',
  telegramChat: '',
  discordWebhook: '',
  kinds: ['danger', 'watch', 'disconnect', 'maintenance', 'boss', 'whisper', 'stuck', 'party', 'price', 'chat', 'digest'],
  kindsV: 3,
  onlyWhenAway: false, // only send while the game is closed or you are AFK
};
const KINDS = ['danger', 'watch', 'disconnect', 'maintenance', 'timer', 'boss', 'event', 'goal', 'recap', 'report', 'milestone', 'buff', 'patch', 'checklist', 'whisper', 'stuck', 'party', 'price', 'chat', 'digest'];
const ICON = { patch: '🧩', checklist: '☑️', danger: '⚠️', watch: '👁', disconnect: '🔌', maintenance: '🛠', timer: '⏱', boss: '🐉', event: '🎉', goal: '🎯', recap: '📋', report: '📊', milestone: '🏆', buff: '✨', whisper: '💬', stuck: '⏸', party: '🤝', price: '💰', chat: '🗨', digest: '🗓' };
// kinds added later are switched on once for settings saved before they existed
const ADDED = { 2: ['whisper', 'stuck', 'party', 'price'], 3: ['chat', 'digest'] };

class Notifier {
  constructor({ isAway }) {
    this.isAway = isAway;
    const saved = store.readJson('notify.json', {});
    this.cfg = { ...DEFAULTS, ...saved };
    if (saved.kinds && (saved.kindsV || 1) < DEFAULTS.kindsV) {
      for (const [v, ks] of Object.entries(ADDED)) if (+v > (saved.kindsV || 1)) for (const k of ks) if (!this.cfg.kinds.includes(k)) this.cfg.kinds.push(k);
      this.cfg.kindsV = DEFAULTS.kindsV;
      store.writeJson('notify.json', this.cfg);
    }
    this.queue = [];
    this.busy = false;
    this.lastError = null;
  }

  enabled() {
    const c = this.cfg;
    return !!(c.ntfyTopic || (c.telegramToken && c.telegramChat) || c.discordWebhook);
  }

  update(b) {
    const s = (v, max = 300) => String(v ?? '').trim().slice(0, max);
    const next = { ...this.cfg };
    if (b.ntfyServer !== undefined) { const v = s(b.ntfyServer); if (v && !/^https:\/\/[\w.-]+(:\d+)?\/?$/.test(v)) throw new Error('ntfy server must be an https:// address'); next.ntfyServer = (v || DEFAULTS.ntfyServer).replace(/\/$/, ''); }
    if (b.ntfyTopic !== undefined) { const v = s(b.ntfyTopic, 64); if (v && !/^[\w-]{3,64}$/.test(v)) throw new Error('ntfy topic: letters, numbers, - and _ only'); next.ntfyTopic = v; }
    if (b.telegramToken !== undefined && !/^\*+$/.test(b.telegramToken)) { const v = s(b.telegramToken, 100); if (v && !/^\d+:[\w-]{20,}$/.test(v)) throw new Error('That does not look like a Telegram bot token'); next.telegramToken = v; }
    if (b.telegramChat !== undefined) { const v = s(b.telegramChat, 64); if (v && !/^(-?\d+|@\w{4,})$/.test(v)) throw new Error('Telegram chat id must be a number or @channel'); next.telegramChat = v; }
    if (b.discordWebhook !== undefined && !/^\*+$/.test(b.discordWebhook)) { const v = s(b.discordWebhook); if (v && !/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(v)) throw new Error('That does not look like a Discord webhook URL'); next.discordWebhook = v; }
    if (Array.isArray(b.kinds)) next.kinds = b.kinds.filter((k) => KINDS.includes(k));
    if (b.onlyWhenAway !== undefined) next.onlyWhenAway = !!b.onlyWhenAway;
    this.cfg = next;
    store.writeJson('notify.json', next);
    return this.publicConfig();
  }

  // secrets are masked so they never leave this PC in full
  publicConfig() {
    const c = this.cfg, mask = (v) => (v ? '*'.repeat(8) : '');
    return { ...c, telegramToken: mask(c.telegramToken), discordWebhook: mask(c.discordWebhook), kindsAll: KINDS, enabled: this.enabled(), lastError: this.lastError };
  }

  send(alert) {
    if (!this.enabled() || !this.cfg.kinds.includes(alert.kind)) return;
    if (this.cfg.onlyWhenAway && !this.isAway()) return;
    this.queue.push(alert);
    if (this.queue.length > 30) this.queue.splice(0, this.queue.length - 30);
    this.drain();
  }

  async drain() {
    if (this.busy) return;
    this.busy = true;
    while (this.queue.length) {
      const a = this.queue.shift();
      const results = await this.deliver(a);
      const failed = results.filter((r) => !r.ok);
      this.lastError = failed.length ? `${failed.map((f) => `${f.channel}: ${f.error}`).join('; ')} (${new Date().toLocaleTimeString()})` : null;
      await new Promise((r) => setTimeout(r, 1500)); // stay well under every service's rate limit
    }
    this.busy = false;
  }

  async deliver(a, cfg = this.cfg) {
    const icon = ICON[a.kind] || '🔔';
    const title = `${icon} ${a.title}`;
    const text = a.body ? `${title}\n${a.body}` : title;
    const jobs = [];
    const run = (channel, fn) => jobs.push(fn().then(async (r) => (r.ok ? { channel, ok: true } : { channel, ok: false, error: `HTTP ${r.status} ${(await r.text()).slice(0, 80)}` }))
      .catch((e) => ({ channel, ok: false, error: e.message })));
    if (cfg.ntfyTopic) {
      run('ntfy', () => fetch(`${cfg.ntfyServer}/${cfg.ntfyTopic}`, {
        method: 'POST', body: a.body || a.title,
        headers: { Title: encodeURIComponent(title).length === title.length ? title : a.title.replace(/[^\x20-\x7e]/g, ''), Priority: ['danger', 'disconnect', 'whisper', 'party'].includes(a.kind) ? 'high' : 'default', Tags: a.kind },
      }));
    }
    if (cfg.telegramToken && cfg.telegramChat) {
      run('telegram', () => fetch(`https://api.telegram.org/bot${cfg.telegramToken}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: cfg.telegramChat, text, disable_web_page_preview: true }),
      }));
    }
    if (cfg.discordWebhook) {
      run('discord', () => fetch(cfg.discordWebhook, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'SoF Tracker', content: text.slice(0, 1900), allowed_mentions: { parse: [] } }),
      }));
    }
    return Promise.all(jobs);
  }

  async test() {
    if (!this.enabled()) return [{ channel: 'none', ok: false, error: 'No channel set up yet' }];
    return this.deliver({ kind: 'watch', title: 'Test from your SoF Tracker', body: 'If you can read this, alerts will reach you here.' });
  }
}

module.exports = { Notifier, NOTIFY_KINDS: KINDS };
