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

    // Dynamic page title based on language
    const pageFile = (location.pathname.split('/').pop() || 'index.html').replace('.html', '');
    const pageKey = pageFile.replace(/-/g, '_');
    // For tsubuyaki individual pages, use the tsubuyaki entry's title
    const tsubuyakiMatch = pageKey.match(/^tsubuyaki_(\d+)$/);
    let newTitle;
    if (tsubuyakiMatch) {
      newTitle = resolveWithFallback(`tsubuyaki_${tsubuyakiMatch[1]}.title`);
      if (newTitle) newTitle += ' — Kuro';
    } else {
      newTitle = resolveWithFallback(`page_meta.${pageKey}.title`);
    }
    if (newTitle) document.title = newTitle;

    // Dynamic meta description
    const metaDesc = resolveWithFallback(`page_meta.${pageKey}.description`);
    if (metaDesc) {
      const descEl = document.querySelector('meta[name="description"]');
      if (descEl) descEl.setAttribute('content', metaDesc);
      const ogDescEl = document.querySelector('meta[property="og:description"]');
      if (ogDescEl) ogDescEl.setAttribute('content', metaDesc);
    }
    const ogTitle = newTitle || document.title;
    const ogTitleEl = document.querySelector('meta[property="og:title"]');
    if (ogTitleEl) ogTitleEl.setAttribute('content', ogTitle);

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
      back: 'index.html#works',
      related: [
        { href: 'constraint-framework.html', i18n: 'page_guide.constraint_framework' },
        { href: 'only-and.html', i18n: 'page_guide.only_and' },
      ]
    },
    'constraint-framework.html': {
      back: 'index.html#works',
      related: [
        { href: 'three-rooms.html', i18n: 'page_guide.three_rooms' },
        { href: 'constraint-garden.html', i18n: 'page_guide.constraint_garden' },
        { href: 'three-rules.html', i18n: 'page_guide.three_rules' },
      ]
    },
    'constraint-garden.html': {
      back: 'index.html#works',
      related: [
        { href: 'constraint-framework.html', i18n: 'page_guide.constraint_framework' },
        { href: 'three-rules.html', i18n: 'page_guide.three_rules' },
      ]
    },
    'three-rules.html': {
      back: 'index.html#works',
      related: [
        { href: 'constraint-framework.html', i18n: 'page_guide.constraint_framework' },
        { href: 'constraint-garden.html', i18n: 'page_guide.constraint_garden' },
      ]
    },
    'only-and.html': {
      back: 'index.html#works',
      related: [
        { href: 'three-rooms.html', i18n: 'page_guide.three_rooms' },
        { href: 'gallery.html', i18n: 'page_guide.gallery' },
      ]
    },
    'gallery.html': {
      back: 'index.html#works',
      related: [
        { href: 'only-and.html', i18n: 'page_guide.only_and' },
        { href: 'constraint-framework.html', i18n: 'page_guide.constraint_framework' },
      ]
    },
    'inner.html': {
      back: 'index.html#works',
      related: [
        { href: 'journal.html', i18n: 'page_guide.journal' },
        { href: 'three-rooms.html', i18n: 'page_guide.three_rooms' },
      ]
    },
    'journal.html': {
      back: 'index.html#works',
      related: [
        { href: 'inner.html', i18n: 'page_guide.inner' },
        { href: 'constraint-framework.html', i18n: 'page_guide.constraint_framework' },
      ]
    },
    'tsubuyaki.html': {
      back: 'index.html#works',
      related: [
        { href: 'tsubuyaki-list.html', i18n: 'page_guide.tsubuyaki' },
        { href: 'gallery.html', i18n: 'page_guide.gallery' },
      ]
    },
    'tsubuyaki-list.html': {
      back: 'index.html#works',
      related: [
        { href: 'gallery.html', i18n: 'page_guide.gallery' },
        { href: 'inner.html', i18n: 'page_guide.inner' },
      ]
    },
    'thread.html': {
      back: 'index.html#works',
      related: [
        { href: 'constraint-framework.html', i18n: 'page_guide.constraint_framework' },
        { href: 'three-rooms.html', i18n: 'page_guide.three_rooms' },
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
  footer.parentNode.insertBefore(el, footer);

  function render() {
    const backLabel = I18N.t('page_guide.back') || 'Works';
    const alsoLabel = I18N.t('page_guide.also') || 'Also';
    const relatedLinks = guide.related
      .map(r => `<a href="${r.href}">${I18N.t(r.i18n) || r.i18n.split('.').pop()}</a>`)
      .join('');
    el.innerHTML = `<div class="page-guide-inner">
      <div class="page-guide-back"><a href="${guide.back}">&larr; ${backLabel}</a></div>
      <div class="page-guide-related"><span class="page-guide-related-label">${alsoLabel}</span>${relatedLinks}</div>
    </div>`;
  }

  render();
  I18N.onApply(render);
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
