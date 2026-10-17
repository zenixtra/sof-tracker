// Kills, deaths and the best farming spots, from what the screen reader sees while you play:
//  - a kill shows as a small EXP gain between two looks (several kills between looks count as one, so it's a minimum)
//  - a death is HP dropping to 0
//  - EXP gained and time spent are added up per spot (zone + 400-unit square) to rank spots by EXP per hour
//  - potions: HP / MP jumping up by 8 % of the bar or more between two close looks (regeneration is slower than
//    that); a healer's heal looks the same, so in a party it's an estimate
'use strict';

const SPOT = 400;
const ACTIVE_GAP = 120000; // time between two EXP gains longer than this doesn't count as farming time
const POT_JUMP = 0.08, POT_GAP = 10000;

class Farming {
  constructor(data) {
    this.data = data || { spots: {}, deaths: [], kills: 0 };
    this.last = null; // previous look: { t, exp, hp, zone, x, z }
    this.lastGainAt = 0;
  }

  // one screen reading plus where you are; returns { kill, died } for alerts
  frame({ t, exp, hp, hpMax, mp = null, mpMax = null, zone, x, z, nearby = [] }) {
    const ev = { kill: false, died: false, potHp: 0, potMp: 0 };
    const prev = this.last;
    this.last = { t, exp, hp, hpMax, mp, mpMax, zone, x, z };
    if (!prev || zone == null || x == null) return ev;
    // death: HP read as 0 after being above 0
    if (hp === 0 && hpMax > 0 && prev.hp > 0) {
      ev.died = true;
      this.data.deaths.push({ t, zone, x: Math.round(x), z: Math.round(z), near: nearby.slice(0, 8) });
      if (this.data.deaths.length > 500) this.data.deaths.shift();
    }
    const key = `${zone}|${Math.floor(x / SPOT)}|${Math.floor(z / SPOT)}`;
    const spot = () => (this.data.spots[key] ||= { zone, cx: Math.floor(x / SPOT), cz: Math.floor(z / SPOT), exp: 0, kills: 0, ms: 0, last: 0 });
    // potions: a big jump between two close looks, not coming back from 0 (revive) and with the same max (no level-up)
    const jump = (v, pv, max, pmax) => (v != null && pv > 0 && max > 0 && max === pmax && t - prev.t <= POT_GAP && v - pv >= max * POT_JUMP ? v - pv : 0);
    ev.potHp = jump(hp, prev.hp, hpMax, prev.hpMax); ev.potMp = jump(mp, prev.mp, mpMax, prev.mpMax);
    if (ev.potHp || ev.potMp) {
      const s = spot();
      s.potHp = (s.potHp || 0) + ev.potHp; s.potMp = (s.potMp || 0) + ev.potMp;
      this.data.potHp = (this.data.potHp || 0) + ev.potHp; this.data.potMp = (this.data.potMp || 0) + ev.potMp;
    }
    if (exp == null || prev.exp == null || prev.zone !== zone) return ev;
    let gain = exp - prev.exp;
    if (gain < -50) gain += 100;           // levelled up
    if (gain <= 0 || gain > 20) return ev; // nothing, a death penalty, or a misread
    ev.kill = true;
    this.data.kills++;
    const s = spot();
    s.exp += gain; s.kills++; s.last = t;
    if (this.lastGainAt && t - this.lastGainAt < ACTIVE_GAP) s.ms += t - this.lastGainAt;
    this.lastGainAt = t;
    return ev;
  }

  // one of your own drops (announced in the chat) where you stand now: valued later at chat prices
  addLoot({ zone, x, z, itemId }) {
    if (zone == null || x == null || !itemId) return;
    const key = `${zone}|${Math.floor(x / SPOT)}|${Math.floor(z / SPOT)}`;
    const s = (this.data.spots[key] ||= { zone, cx: Math.floor(x / SPOT), cz: Math.floor(z / SPOT), exp: 0, kills: 0, ms: 0, last: 0 });
    (s.loot ||= {})[itemId] = (s.loot[itemId] || 0) + 1;
  }

  // spots with at least `minMinutes` of farming, best EXP per hour first
  best(minMinutes = 5) {
    return Object.values(this.data.spots).filter((s) => s.ms >= minMinutes * 60000)
      .map((s) => ({ zone: s.zone, x: (s.cx + 0.5) * SPOT, z: (s.cz + 0.5) * SPOT, expPerHour: s.exp / (s.ms / 3600000), killsPerHour: s.kills / (s.ms / 3600000), minutes: Math.round(s.ms / 60000), kills: s.kills, last: s.last,
        hpPerHour: (s.potHp || 0) / (s.ms / 3600000), mpPerHour: (s.potMp || 0) / (s.ms / 3600000), loot: s.loot || {}, hours: s.ms / 3600000 }))
      .sort((a, b) => b.expPerHour - a.expPerHour);
  }
}

module.exports = { Farming, SPOT };
