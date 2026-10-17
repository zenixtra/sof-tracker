// Server-side use of the same translation tables as the dashboard (public/i18n-dict.js):
// translated tray texts and translated alerts for the tray and phone notifications.
'use strict';

let DICT = {}, PATTERNS = {};
try { ({ DICT, PATTERNS } = require('../public/i18n-dict.js')); } catch (e) { console.log(`[tracker] translations unavailable: ${e.message}`); }

const SPEECH = { en: 'en-US', tr: 'tr-TR', vi: 'vi-VN', id: 'id-ID', zh: 'zh-CN', th: 'th-TH', es: 'es-ES' };
const fill = (s, p) => (p ? s.replace(/\{(\w+)\}/g, (m, k) => (p[k] !== undefined ? p[k] : m)) : s);

function t(lang, text, params) {
  return fill((DICT[lang] && DICT[lang][text]) || text, params);
}

function one(lang, text) {
  for (const [re, out] of PATTERNS[lang] || []) {
    const m = re.exec(text);
    // $1 = matched text as is; $t1 = matched text translated too (e.g. a milestone name)
    if (m) return out.replace(/\$t(\d)/g, (_, i) => t(lang, m[+i] ?? '')).replace(/\$(\d)/g, (_, i) => m[+i] ?? '');
  }
  return (DICT[lang] && DICT[lang][text]) || null;
}

// whole text first, then each " · " separated part; unknown parts (game text) stay as they are
function tAlert(lang, text) {
  if (!text || !lang || lang === 'en') return text;
  const whole = one(lang, text);
  if (whole) return whole;
  return text.split(' · ').map((part) => one(lang, part) || part).join(' · ');
}

module.exports = { t, tAlert, SPEECH };
