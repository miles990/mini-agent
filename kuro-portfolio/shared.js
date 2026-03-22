/* ═══════════════════════════════════════
   Kuro Portfolio — Shared JS
   i18n + mobile menu — loaded by all pages
   ═══════════════════════════════════════ */

// ═══ i18n ═══
const I18N = (() => {
  const cache = {};
  const callbacks = [];
  let currentLang = localStorage.getItem('kuro-lang') || 'en';
  let data = null;
  let fallbackData = null;

  async function loadLang(lang) {
    if (!cache[lang]) {
      try {
        const res = await fetch(`lang/${lang}.json`);
        cache[lang] = await res.json();
      } catch { return null; }
    }
    return cache[lang];
  }

  function resolve(obj, path) {
    return path.split('.').reduce((o, k) => o && o[k], obj);
  }

  function resolveWithFallback(key) {
    const val = resolve(data, key);
    if (val) return val;
    if (fallbackData && fallbackData !== data) return resolve(fallbackData, key);
    return null;
  }

  async function apply(lang) {
    data = await loadLang(lang);
    if (!data) return;
    if (!fallbackData) fallbackData = await loadLang('en');
    currentLang = lang;
    localStorage.setItem('kuro-lang', lang);
    document.documentElement.lang = lang === 'zh' ? 'zh-Hant' : lang;

    document.querySelectorAll('[data-i18n]').forEach(el => {
      const val = resolveWithFallback(el.dataset.i18n);
      if (val) el.textContent = val;
    });
    document.querySelectorAll('[data-i18n-html]').forEach(el => {
      const val = resolveWithFallback(el.dataset.i18nHtml);
      if (val) el.innerHTML = val;
    });

    document.querySelectorAll('.lang-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.lang === lang);
    });

    callbacks.forEach(cb => cb());
  }

  function t(key) { return data ? resolveWithFallback(key) : null; }
  function getLang() { return currentLang; }
  function onApply(cb) { callbacks.push(cb); }
  return { apply, getLang, t, loadLang, onApply };
})();

document.querySelectorAll('.lang-btn').forEach(btn => {
  btn.addEventListener('click', () => I18N.apply(btn.dataset.lang));
});
I18N.apply(I18N.getLang());

// ═══ Page Guide (related works + back link) ═══
(() => {
  const PAGE_GUIDE = {
    'three-rooms.html': {
      back: { href: 'index.html#works', label: 'Works' },
      related: [
        { href: 'constraint-framework.html', label: 'Constraint Framework' },
        { href: 'only-and.html', label: 'Only And' },
      ]
    },
    'constraint-framework.html': {
      back: { href: 'index.html#works', label: 'Works' },
      related: [
        { href: 'three-rooms.html', label: 'Three Rooms' },
        { href: 'constraint-garden.html', label: 'Constraint Garden' },
        { href: 'three-rules.html', label: 'Three Rules' },
      ]
    },
    'constraint-garden.html': {
      back: { href: 'index.html#works', label: 'Works' },
      related: [
        { href: 'constraint-framework.html', label: 'Constraint Framework' },
        { href: 'three-rules.html', label: 'Three Rules' },
      ]
    },
    'three-rules.html': {
      back: { href: 'index.html#works', label: 'Works' },
      related: [
        { href: 'constraint-framework.html', label: 'Constraint Framework' },
        { href: 'constraint-garden.html', label: 'Constraint Garden' },
      ]
    },
    'only-and.html': {
      back: { href: 'index.html#works', label: 'Works' },
      related: [
        { href: 'three-rooms.html', label: 'Three Rooms' },
        { href: 'gallery.html', label: 'Gallery' },
      ]
    },
  };

  const page = location.pathname.split('/').pop() || 'index.html';
  const guide = PAGE_GUIDE[page];
  if (!guide) return;

  const footer = document.querySelector('.footer, footer.foot');
  if (!footer) return;

  const el = document.createElement('div');
  el.className = 'page-guide';
  const relatedLinks = guide.related
    .map(r => `<a href="${r.href}">${r.label}</a>`)
    .join('');
  el.innerHTML = `<div class="page-guide-inner">
    <div class="page-guide-back"><a href="${guide.back.href}">&larr; ${guide.back.label}</a></div>
    <div class="page-guide-related"><span class="page-guide-related-label">Also</span>${relatedLinks}</div>
  </div>`;
  footer.parentNode.insertBefore(el, footer);
})();

// ═══ Mobile Menu ═══
document.getElementById('menu-toggle')?.addEventListener('click', (e) => {
  e.stopPropagation();
  document.querySelector('.header-nav').classList.toggle('open');
});
document.addEventListener('click', (e) => {
  const nav = document.querySelector('.header-nav');
  const toggle = document.getElementById('menu-toggle');
  if (nav && toggle && !nav.contains(e.target) && !toggle.contains(e.target)) {
    nav.classList.remove('open');
  }
});
