// Alert sounds, shared by the dashboard and the overlay: built-in tones made in the browser, or your own sound files
// (kept by the tracker in data\sounds). The choice per alert type is in the tracker's settings: sounds = { kind: { s, v } },
// s = a tone name below, 'off', 'file:<name>' or 'default' (the page's usual beep); v = volume 0-100.
(function () {
  const TONES = {
    chime: { label: 'Chime', notes: [784, 988, 1175], type: 'triangle', step: 0.16, len: 0.15 },
    alarm: { label: 'Alarm', notes: [988, 740, 988, 740], type: 'square', step: 0.16, len: 0.14, gain: 0.12 },
    bell: { label: 'Bell', notes: [1046], type: 'sine', step: 0, len: 1.3, gain: 0.35, overtone: 2.76 },
    coin: { label: 'Coin', notes: [988, 1319], type: 'square', step: 0.08, len: 0.2, gain: 0.1 },
    pop: { label: 'Pop', notes: [620], type: 'sine', step: 0, len: 0.09, gain: 0.35 },
    soft: { label: 'Soft', notes: [523, 659], type: 'sine', step: 0.2, len: 0.3, gain: 0.18 },
    triple: { label: 'Triple beep', notes: [880, 880, 880], type: 'triangle', step: 0.13, len: 0.08 },
    siren: { label: 'Siren', sweep: [600, 1200, 600], type: 'sawtooth', len: 0.9, gain: 0.08 },
  };
  let ctx = null;
  function tone(name, vol) {
    const d = TONES[name];
    if (!d) return false;
    ctx ||= new AudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    const peak = (d.gain ?? 0.25) * vol, t0 = ctx.currentTime;
    const note = (f, at, len, g = peak) => {
      const o = ctx.createOscillator(), gn = ctx.createGain();
      o.type = d.type; o.frequency.value = f;
      gn.gain.setValueAtTime(0.0001, at); gn.gain.exponentialRampToValueAtTime(Math.max(0.0002, g), at + 0.015); gn.gain.exponentialRampToValueAtTime(0.0001, at + len);
      o.connect(gn).connect(ctx.destination); o.start(at); o.stop(at + len + 0.02);
      return o;
    };
    if (d.sweep) {
      const o = note(d.sweep[0], t0, d.len);
      d.sweep.forEach((f, i) => o.frequency.linearRampToValueAtTime(f, t0 + (d.len * i) / (d.sweep.length - 1)));
    } else d.notes.forEach((f, i) => { note(f, t0 + i * d.step, d.len); if (d.overtone) note(f * d.overtone, t0 + i * d.step, d.len * 0.6, peak * 0.25); });
    return true;
  }
  const cache = new Map();
  function file(name, vol) {
    let a = cache.get(name);
    if (!a) { a = new Audio(`/sounds/${encodeURIComponent(name)}`); cache.set(name, a); }
    a.volume = Math.max(0, Math.min(1, vol));
    a.currentTime = 0;
    a.play().catch(() => {});
    return true;
  }
  // true when the setting handled it (played something, or 'off'); false: use the page's usual beep
  function play(kind, sounds) {
    const c = sounds?.[kind];
    if (!c || !c.s || c.s === 'default') return false;
    if (c.s === 'off') return true;
    const vol = (c.v ?? 70) / 100;
    try { return c.s.startsWith('file:') ? file(c.s.slice(5), vol) : tone(c.s, vol); } catch { return false; }
  }
  window.SofSounds = { TONES, play, preview: (s, v = 70) => play('x', { x: { s, v } }) };
})();
