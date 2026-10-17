// Interface translations. English text is the key; each language maps it to its own text.
// {name} placeholders are filled in by t(text, { name: value }).
// Game names (zones, monsters, items, classes, NPCs) are not translated: the game itself is in English.
(function () {
  const LANGS = {
    en: { name: 'English', speech: 'en-US' },
    tr: { name: 'Türkçe', speech: 'tr-TR' },
    vi: { name: 'Tiếng Việt', speech: 'vi-VN' },
    id: { name: 'Bahasa Indonesia', speech: 'id-ID' },
    zh: { name: '中文', speech: 'zh-CN' },
    th: { name: 'ไทย', speech: 'th-TH' },
    es: { name: 'Español', speech: 'es-ES' },
  };
  const DICT = window.I18N_DICT || {};   // filled in by i18n-<lang> tables below
  const PATTERNS = window.I18N_PATTERNS || {};

  let lang = 'en';
  try { lang = JSON.parse(localStorage.getItem('sof.lang')) || ''; } catch { lang = ''; }
  if (!LANGS[lang]) {
    const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
    lang = LANGS[nav] ? nav : 'en';
  }

  const fill = (s, p) => (p ? s.replace(/\{(\w+)\}/g, (m, k) => (p[k] !== undefined ? p[k] : m)) : s);

  function t(text, params) {
    const d = DICT[lang];
    return fill((d && d[text]) || text, params);
  }

  // server-made alert texts: translate known shapes, leave game text (boss notices etc.) as it is
  function one(text) {
    for (const [re, out] of PATTERNS[lang] || []) {
      const m = re.exec(text);
      // $1 = matched text as is; $t1 = matched text translated too (e.g. a milestone name)
      if (m) return out.replace(/\$t(\d)/g, (_, i) => t(m[+i] ?? '')).replace(/\$(\d)/g, (_, i) => m[+i] ?? '');
    }
    return (DICT[lang] && DICT[lang][text]) || null;
  }
  // whole text first, then each " · " separated part; unknown parts (game text) stay as they are
  function tAlert(text) {
    if (!text || lang === 'en') return text;
    return one(text) || text.split(' · ').map((part) => one(part) || part).join(' · ');
  }

  // translate static text: any text node / placeholder / title that exactly matches a key
  const ORIG = new WeakMap();
  function translateNode(n) {
    if (n.nodeType === 3) {
      const raw = ORIG.has(n) ? ORIG.get(n) : n.nodeValue;
      const key = raw.trim();
      if (!key || key.length > 300) return;
      if (!ORIG.has(n)) { if (!(lang !== 'en' && DICT[lang] && DICT[lang][key])) return; ORIG.set(n, raw); }
      const tr = lang === 'en' ? key : (DICT[lang] && DICT[lang][key]) || key;
      const out = raw.replace(key, tr);
      if (n.nodeValue !== out) n.nodeValue = out;
      return;
    }
    if (n.nodeType !== 1 || n.tagName === 'SCRIPT' || n.tagName === 'STYLE' || n.classList?.contains('notr')) return;
    for (const attr of ['placeholder', 'title', 'aria-label']) {
      if (!n.hasAttribute(attr)) continue;
      const k = `data-i18n-${attr}`;
      const orig = n.getAttribute(k) ?? n.getAttribute(attr);
      if (!n.hasAttribute(k)) n.setAttribute(k, orig);
      const tr = lang === 'en' ? orig : (DICT[lang] && DICT[lang][orig]) || orig;
      if (n.getAttribute(attr) !== tr) n.setAttribute(attr, tr);
    }
    for (const c of n.childNodes) translateNode(c);
  }

  function translateTree(root) { translateNode(root || document.body); }

  // keep newly rendered content translated too
  let obs = null;
  function watch() {
    if (obs) return;
    obs = new MutationObserver((muts) => {
      if (lang === 'en' && !obs.restore) return;
      for (const m of muts) for (const n of m.addedNodes) translateNode(n);
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  function setLang(l) {
    if (!LANGS[l]) return;
    lang = l;
    try { localStorage.setItem('sof.lang', JSON.stringify(l)); } catch { /* private mode */ }
    document.documentElement.lang = l;
    if (obs) obs.restore = true;
    translateTree(document.body);
    window.dispatchEvent(new Event('langchange'));
  }

  window.LANGS = LANGS;
  window.t = t;
  window.tAlert = tAlert;
  window.getLang = () => lang;
  window.setLang = setLang;
  window.translateTree = translateTree;
  window.startI18n = () => { document.documentElement.lang = lang; translateTree(document.body); watch(); };
})();
