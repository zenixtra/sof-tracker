// Discord bot with slash commands (/online, /boss, /whois, /today, /timers, /route, /screen, /chat, /whispers,
// /price, /plan): ask the tracker things from
// Discord, e.g. on your phone. Uses Discord's gateway (WebSocket) and REST API directly, no libraries.
// Only the people on the allow-list (by default: the bot's owner) get answers, and answers are private (ephemeral).
'use strict';

const API = 'https://discord.com/api/v10';
const COMMANDS = [
  { name: 'online', description: 'Is the game running, where am I, who is around' },
  { name: 'boss', description: 'Expected boss spawns' },
  { name: 'timers', description: 'Boss and event timers running now' },
  { name: 'today', description: 'Play time today and this session' },
  { name: 'whois', description: 'What the tracker knows about a player', options: [{ type: 3, name: 'name', description: 'Player name', required: true }] },
  { name: 'route', description: 'Route from where I am to a zone or NPC', options: [{ type: 3, name: 'to', description: 'Zone or NPC name', required: true }] },
  { name: 'screen', description: 'A picture of the game screen right now (needs the screen reader)' },
  { name: 'chat', description: 'The latest chat messages the screen reader saw', options: [{ type: 3, name: 'who', description: 'Only this player', required: false }] },
  { name: 'whispers', description: 'Whispers and chat alerts of the last day' },
  { name: 'price', description: 'Usual price and latest offers of an item, from the chat', options: [{ type: 3, name: 'item', description: 'Item name', required: true }] },
  { name: 'plan', description: 'The next 24 hours: bosses, events, resets, your passes and who is coming' },
  { name: 'checklist', description: 'Your checklist (pet feeding, dailies…) with buttons to tick things off' },
  { name: 'enhance', description: 'The enhance auto-log: what it logged, with a button to start or stop it' },
  { name: 'quests', description: 'Your quests in progress, how far the quest items are, and the next stops' },
];
// a row of buttons for an answer: [{ label, id, style: 1 blue | 2 grey | 3 green | 4 red }] (5 per row, 5 rows)
function buttons(list) {
  const rows = [];
  for (let k = 0; k < Math.min(list.length, 25); k += 5) rows.push({ type: 1, components: list.slice(k, k + 5).map((b) => ({ type: 2, style: b.style || 2, label: String(b.label).slice(0, 80), custom_id: String(b.id).slice(0, 100) })) });
  return rows;
}

class DiscordBot {
  /** handlers: { [command]: async (options) => string }; log(msg) */
  constructor({ handlers, log = () => {} }) {
    this.handlers = handlers; this.log = log;
    this.ws = null; this.token = null; this.allowed = []; this.status = 'off'; this.error = null; this.me = null; this.appId = null; this.owner = null;
    this.seq = null; this.hb = null; this.retry = null; this.stopped = true;
  }

  async rest(method, path, body) {
    const r = await fetch(`${API}${path}`, { method, headers: { Authorization: `Bot ${this.token}`, 'Content-Type': 'application/json', 'User-Agent': 'DiscordBot (sof-tracker, 1.0)' }, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) throw new Error(`Discord ${method} ${path.split('?')[0]}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    return r.status === 204 ? null : r.json();
  }

  async start({ token, allowed = [] }) {
    this.stop();
    if (!token) return;
    this.token = token; this.allowed = allowed.map(String); this.stopped = false; this.status = 'connecting'; this.error = null;
    try {
      const app = await this.rest('GET', '/oauth2/applications/@me');
      this.appId = app.id; this.owner = app.owner?.id || null;
      await this.rest('PUT', `/applications/${this.appId}/commands`, COMMANDS); // register / update the slash commands
      const gw = await this.rest('GET', '/gateway/bot');
      this.connect(`${gw.url}?v=10&encoding=json`);
    } catch (e) { this.fail(e); }
  }

  connect(url) {
    if (this.stopped) return;
    const ws = (this.ws = new WebSocket(url));
    ws.onmessage = (ev) => this.onMessage(JSON.parse(ev.data));
    ws.onclose = (ev) => {
      clearInterval(this.hb);
      if (this.stopped || ws !== this.ws) return;
      if ([4004, 4010, 4011, 4012, 4013, 4014].includes(ev.code)) return this.fail(new Error(`Discord closed the connection (${ev.code}${ev.code === 4004 ? ': wrong token' : ''})`));
      this.status = 'reconnecting';
      this.retry = setTimeout(() => this.connect(url), 5000);
    };
    ws.onerror = () => {};
  }

  onMessage(p) {
    if (p.s != null) this.seq = p.s;
    if (p.op === 10) { // hello: start the heartbeat, then identify (no intents: slash commands arrive anyway)
      clearInterval(this.hb);
      this.hb = setInterval(() => this.send({ op: 1, d: this.seq }), p.d.heartbeat_interval);
      this.send({ op: 2, d: { token: this.token, intents: 0, properties: { os: 'windows', browser: 'sof-tracker', device: 'sof-tracker' } } });
    } else if (p.op === 7 || p.op === 9) { try { this.ws.close(4000); } catch { /* closed */ } } // asked to reconnect
    else if (p.op === 0 && p.t === 'READY') { this.me = p.d.user?.username; this.status = 'connected'; this.log(`[discord] connected as ${this.me}`); }
    else if (p.op === 0 && p.t === 'INTERACTION_CREATE') this.onInteraction(p.d).catch((e) => this.log(`[discord] ${e.message}`));
  }

  send(o) { try { this.ws?.readyState === 1 && this.ws.send(JSON.stringify(o)); } catch { /* reconnects */ } }

  async onInteraction(i) {
    if (i.type !== 2 && i.type !== 3) return; // slash commands, and presses on the buttons under an answer
    const user = i.member?.user?.id || i.user?.id;
    const allowed = this.allowed.length ? this.allowed : [this.owner].filter(Boolean);
    let content, file = null, components;
    if (!allowed.includes(String(user))) content = 'Sorry, this tracker only answers its owner.';
    else {
      // a button: handlers.button(customId) answers like a command and replaces the message it was pressed on
      const h = i.type === 3 ? this.handlers.button && (() => this.handlers.button(i.data.custom_id)) : this.handlers[i.data.name];
      const opts = Object.fromEntries((i.data.options || []).map((o) => [o.name, o.value]));
      // a handler answers with text, or with { content, file: { name, data }, components: [rows of buttons] }
      try { const r = h ? await h(opts) : 'Unknown command.'; if (r && typeof r === 'object') ({ content, file, components } = r); else content = r; } catch (e) { content = `Something went wrong: ${e.message}`; }
    }
    const data = { content: String(content || '').slice(0, 1990), flags: 64, ...(components ? { components } : {}) };
    if (i.type === 3) return this.rest('POST', `/interactions/${i.id}/${i.token}/callback`, { type: 7, data: { content: data.content, components: components || [] } });
    if (!file) return this.rest('POST', `/interactions/${i.id}/${i.token}/callback`, { type: 4, data });
    // with a file: multipart, the JSON part names the attachment
    const form = new FormData();
    form.append('payload_json', JSON.stringify({ type: 4, data: { ...data, attachments: [{ id: 0, filename: file.name }] } }));
    form.append('files[0]', new Blob([file.data], { type: file.type || 'image/jpeg' }), file.name);
    const r = await fetch(`${API}/interactions/${i.id}/${i.token}/callback`, { method: 'POST', headers: { Authorization: `Bot ${this.token}`, 'User-Agent': 'DiscordBot (sof-tracker, 1.0)' }, body: form });
    if (!r.ok) throw new Error(`Discord callback with a file: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  }

  fail(e) { this.status = 'error'; this.error = e.message; this.log(`[discord] ${e.message}`); }

  stop() {
    this.stopped = true; clearInterval(this.hb); clearTimeout(this.retry);
    if (this.ws) { const w = this.ws; this.ws = null; try { w.close(1000); } catch { /* closed */ } }
    this.status = 'off';
  }

  inviteUrl() { return this.appId ? `https://discord.com/oauth2/authorize?client_id=${this.appId}&scope=bot%20applications.commands&permissions=0` : null; }
}

module.exports = { DiscordBot, COMMANDS, buttons };
