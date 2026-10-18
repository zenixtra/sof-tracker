// Fast bars: the screen reader's quick looks between full ones read the HP / MP bars by colour only (a few ms each,
// several times a second). The visible bar isn't always exactly proportional to the numbers, so every full look
// (which reads the numbers too) teaches the scale: the median of text % / bar % over the last looks.
'use strict';

const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };

class FastBars {
  constructor() { this.ratio = { hp: [], mp: [] }; this.last = null; }
  // a full look: the numbers read ([cur, max] pairs, or null) and the bars measured then (0-1)
  full({ hp, mp, bars }) {
    for (const [k, pair] of [['hp', hp], ['mp', mp]]) {
      const px = bars?.[k];
      if (!pair || !(px > 0.05) || !(pair[1] > 0)) continue;
      const pct = pair[0] / pair[1];
      if (pct < 0.05) continue;
      const r = pct / px;
      if (r < 0.5 || r > 2) continue; // a misread: ignore
      this.ratio[k].push(r); if (this.ratio[k].length > 20) this.ratio[k].shift();
    }
  }
  scale(k) { return median(this.ratio[k]) ?? 1; }
  // a quick look → { t, hpPct, mpPct, exp } with the learned scale (null where the bar wasn't seen)
  quick(q) {
    const pct = (k) => (q[k] == null || q[k] < 0 ? null : Math.round(Math.min(1, q[k] * this.scale(k)) * 1000) / 10);
    this.last = { t: q.t, hpPct: pct('hp'), mpPct: pct('mp'), exp: q.exp ?? null };
    return this.last;
  }
}

module.exports = { FastBars };
