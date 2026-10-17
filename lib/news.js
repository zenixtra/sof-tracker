// Official news from fate.netgame.com: latest posts plus scheduled maintenance windows.
// Maintenance posts give times in US Pacific time, e.g.
//   "scheduled maintenance on October 13, 2026 at 12:30 PM (PDT)"
//   "Downtime: October 13 12:30 PM → 20:00 PM (PDT)"
//   "expected to last approximately 8 to 9 hours"
'use strict';

const SITE = 'https://fate.netgame.com';
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const OFFSET = { PDT: 7, PST: 8, PT: 7 }; // hours behind UTC

const text = (html) => html
  .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();

function to24(h, m, ampm) {
  h = +h; m = +(m || 0);
  if (ampm && /pm/i.test(ampm) && h < 12) h += 12; // the site writes both "12:30 PM" and "20:00 PM"
  if (ampm && /am/i.test(ampm) && h === 12) h = 0;
  return [h, m];
}

// wall-clock time in the given US zone -> epoch ms
function pacific(year, month, day, h, m, tz) {
  return Date.UTC(year, month, day, h + (OFFSET[tz] ?? 7), m);
}

function parseMaintenance(body, postedAt) {
  const year0 = new Date(postedAt || Date.now()).getFullYear();
  const monthIdx = (s) => MONTHS.findIndex((x) => x.startsWith(s.toLowerCase().slice(0, 3)));
  let start = null, end = null, tz = 'PDT';

  let m = /maintenance[^.\n]*? on (\w+) (\d{1,2}),? (\d{4})? ?at (\d{1,2})(?::(\d{2}))? ?(AM|PM)? ?\((P[DS]?T)\)/i.exec(body);
  if (m && monthIdx(m[1]) >= 0) {
    tz = m[7].toUpperCase();
    const [h, mi] = to24(m[4], m[5], m[6]);
    start = pacific(+(m[3] || year0), monthIdx(m[1]), +m[2], h, mi, tz);
  }
  m = /Downtime:?\s*(\w+) (\d{1,2}),? (\d{1,2})(?::(\d{2}))? ?(AM|PM)?\s*(?:→|->|–|-|~|to)\s*(?:(\w+) (\d{1,2}),? )?(\d{1,2})(?::(\d{2}))? ?(AM|PM)?\s*\((P[DS]?T)\)/i.exec(body);
  if (m && monthIdx(m[1]) >= 0) {
    tz = m[11].toUpperCase();
    const mon = monthIdx(m[1]);
    const [h1, m1] = to24(m[3], m[4], m[5]);
    const s = pacific(year0, mon, +m[2], h1, m1, tz);
    if (!start || Math.abs(s - start) < 86400000) start = start || s;
    const mon2 = m[6] && monthIdx(m[6]) >= 0 ? monthIdx(m[6]) : mon;
    const [h2, m2] = to24(m[8], m[9], m[10]);
    let e = pacific(year0, mon2, +(m[7] || m[2]), h2, m2, tz);
    if (e <= start) e += 86400000; // runs past midnight
    if (e - start < 48 * 3600000) end = e;
  }
  if (start && !end) {
    m = /last approximately (\d+(?:\.\d+)?)(?:\s*(?:to|-|~)\s*(\d+(?:\.\d+)?))? hours?/i.exec(body);
    if (m) end = start + (+(m[2] || m[1])) * 3600000;
  }
  return start ? { start, end, tz } : null;
}

// Event periods inside a post, e.g.
//   "3️⃣ SOF 11th Anniversary Event"            <- name: the line before the period
//   "📅 Event Period : 10/13/2026 ~ 10/28/2026"
//   "🎉 Period : 10/13/2026 - 10/28/2026 (2 weeks)"
const PERIOD = /Period\s*:?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(?:~|-|–|to)\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i;

function cleanName(line) {
  return line
    .replace(/^\s*\d️?⃣/u, '')       // keycap numbers like 3️⃣
    .replace(/^[^A-Za-z0-9[]+/u, '')          // leading emoji / bullets
    .replace(/^(?:\d+[.)]|[a-z][.)])\s*/i, '') // "3." / "a)"
    .replace(/\[(?:new|hot|end)\]/gi, '')
    .replace(/[^\w\s'’:&()[\]!,.-]+/gu, '')    // trailing emoji
    .replace(/\s+/g, ' ').trim()
    .replace(/[.,:]$/, '');
}

function parseEvents(body, url, postedAt) {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  const out = [];
  lines.forEach((line, i) => {
    const m = PERIOD.exec(line);
    if (!m) return;
    let name = null;
    for (let j = i - 1; j >= Math.max(0, i - 3) && !name; j--) {
      const c = cleanName(lines[j]);
      if (c.length >= 4 && !PERIOD.test(lines[j])) name = c;
    }
    // the site's dates are Pacific; events run from the start of the first day to the end of the last
    const start = Date.UTC(+m[3], +m[1] - 1, +m[2], 7, 0);
    const end = Date.UTC(+m[6], +m[4] - 1, +m[5], 7, 0) + 86400000 - 60000;
    if (end > start) out.push({ name: name || 'Event', start, end, url, postedAt });
  });
  return out;
}

class News {
  constructor({ onEvent, readAlerted, saveAlerted }) {
    this.onEvent = onEvent;
    this.posts = [];        // [{ idx, ccode, title, date, url, maintenance, events }]
    this.fetchedAt = null;
    this.error = null;
    this.saveAlerted = saveAlerted || (() => {});
    this.alerted = new Set(readAlerted ? readAlerted() : []);
  }

  // events from all loaded posts that have not ended, de-duplicated, soonest end first
  events() {
    const now = Date.now(), seen = new Map();
    for (const p of this.posts) for (const e of p.events || []) {
      if (e.end < now) continue;
      const key = `${e.name.toLowerCase()}|${e.start}|${e.end}`;
      if (!seen.has(key)) seen.set(key, { ...e, postTitle: p.title });
    }
    return [...seen.values()].sort((a, b) => a.end - b.end);
  }

  async refresh() {
    try {
      // the homepage's own news box: latest notices with their full HTML content
      const res = await fetch(`${SITE}/component/main_news_display.mgame`, { headers: { 'User-Agent': 'SOF-Tracker/1.0' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const v = (x) => (x && typeof x === 'object' ? x['0'] : x);
      const items = [];
      for (const [section, group] of Object.entries(j)) {
        if (!group) continue;
        for (const list of Object.values(group)) for (const it of Object.values(list || {})) items.push({ section, it });
      }
      const posts = items.map(({ section, it }) => {
        const idx = String(v(it.idx));
        const title = String(v(it.subject) || `News #${idx}`).trim();
        const regdate = v(it.regdate); // site time (Pacific)
        const date = regdate ? Date.parse(regdate.replace(' ', 'T') + '-07:00') : null;
        const body = text(String(v(it.content) || ''));
        const maintenance = /maintenance/i.test(title) ? parseMaintenance(body, date) : null;
        const ccode = section === 'event' ? 2 : 1;
        const url = `${SITE}/news/view.mgame?ccode=${ccode}&idx=${idx}`;
        return { idx, title, date, section, url, maintenance, events: parseEvents(body, url, date) };
      }).sort((a, b) => (b.date || 0) - (a.date || 0));
      this.posts = posts;
      this.fetchedAt = Date.now();
      this.error = null;
    } catch (e) {
      this.error = String(e.message || e);
      console.log(`[tracker] news refresh failed: ${this.error}`);
    }
  }

  // the maintenance windows that have not finished yet, soonest first
  maintenance() {
    const now = Date.now();
    const seen = new Set();
    return this.posts.filter((p) => p.maintenance && (p.maintenance.end || p.maintenance.start + 3 * 3600000) > now)
      .map((p) => ({ ...p.maintenance, title: p.title, url: p.url }))
      .filter((m) => (seen.has(m.start) ? false : seen.add(m.start)))
      .sort((a, b) => a.start - b.start);
  }

  // called every second: alerts 60 and 15 minutes before, at start and when it should be over
  tick() {
    const now = Date.now();
    const fire = (key, title, body, kind = 'maintenance') => {
      if (this.alerted.has(key)) return;
      this.alerted.add(key);
      this.saveAlerted([...this.alerted].slice(-300));
      this.onEvent(kind, title, body);
    };
    // events: one grouped alert for everything that started, and one for everything ending soon
    const started = [], ending = [];
    for (const e of this.events()) {
      const key = `${e.name}|${e.start}`;
      if (e.start <= now && now - e.start < 86400000 && !this.alerted.has(`${key}:start`)) { this.alerted.add(`${key}:start`); started.push(e); }
      if (e.end - now < 86400000 && e.end > now && e.end - e.start > 86400000 && !this.alerted.has(`${key}:end`)) { this.alerted.add(`${key}:end`); ending.push(e); }
    }
    const day = (t) => new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    const names = (list) => list.slice(0, 4).map((e) => e.name).join(', ') + (list.length > 4 ? ` +${list.length - 4} more` : '');
    if (started.length) this.onEvent('event', started.length === 1 ? `Event started: ${started[0].name}` : `${started.length} events started`, `${names(started)} · until ${day(started[0].end)}`);
    if (ending.length) this.onEvent('event', ending.length === 1 ? `Event ends within 24 hours: ${ending[0].name}` : `${ending.length} events end within 24 hours`, names(ending));
    if (started.length || ending.length) this.saveAlerted([...this.alerted].slice(-300));
    for (const m of this.maintenance()) {
      const left = m.start - now;
      if (left <= 60 * 60000 && left > 15 * 60000) fire(`${m.start}:60`, 'Maintenance in 1 hour', m.title);
      if (left <= 15 * 60000 && left > 0) fire(`${m.start}:15`, 'Maintenance in 15 minutes', 'Find a safe spot and log out.');
      if (left <= 0 && left > -60000) fire(`${m.start}:0`, 'Maintenance has started', m.end ? `Expected back around ${new Date(m.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : m.title);
    }
  }
}

module.exports = { News, parseMaintenance, parseEvents };
