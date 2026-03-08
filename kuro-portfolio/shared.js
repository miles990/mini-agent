/* ═══════════════════════════════════════
   Kuro Portfolio — Shared JS
   i18n + mobile menu — loaded by all pages
   ═══════════════════════════════════════ */

// ═══ i18n ═══
const I18N = (() => {
  const cache = {};
  let currentLang = localStorage.getItem('kuro-lang') || 'en';

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

  async function apply(lang) {
    const data = await loadLang(lang);
    if (!data) return;
    currentLang = lang;
    localStorage.setItem('kuro-lang', lang);
    document.documentElement.lang = lang === 'zh' ? 'zh-Hant' : lang;

    document.querySelectorAll('[data-i18n]').forEach(el => {
      const val = resolve(data, el.dataset.i18n);
      if (val) el.textContent = val;
    });
    document.querySelectorAll('[data-i18n-html]').forEach(el => {
      const val = resolve(data, el.dataset.i18nHtml);
      if (val) el.innerHTML = val;
    });

    document.querySelectorAll('.lang-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.lang === lang);
    });
  }

  function getLang() { return currentLang; }
  return { apply, getLang };
})();

document.querySelectorAll('.lang-btn').forEach(btn => {
  btn.addEventListener('click', () => I18N.apply(btn.dataset.lang));
});
I18N.apply(I18N.getLang());

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
