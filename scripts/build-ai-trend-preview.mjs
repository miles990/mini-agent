#!/usr/bin/env node
/**
 * build-ai-trend-preview.mjs (v2 — Alex 2026-05-07 12:04 feedback)
 *
 * 變動：
 *   - 卡片式 → 密集列表（更高資訊密度）
 *   - 每來源 updated_at 精準到分（Asia/Taipei）
 *   - 用 summary.claim / summary.so_what 當中文摘要（fallback story_text 截斷）
 *   - 每項保留「閱讀原文 →」明確 outbound 連結
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const STATE_DIR = join(ROOT, 'memory/state');
const OUT = join(ROOT, 'kuro-portfolio/ai-trend/preview.html');

function todayTaipei() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}
const DATE = process.argv[2] || todayTaipei();

function fmtTaipeiMinute(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Taipei',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    }).formatToParts(d);
    const m = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return `${m.year}-${m.month}-${m.day} ${m.hour}:${m.minute}`;
  } catch { return '—'; }
}

function ageHours(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return (Date.now() - d.getTime()) / 3600_000;
}

async function loadLatest(subdir, fromDate, days = 14) {
  const d = new Date(fromDate + 'T00:00:00Z');
  for (let i = 0; i < days; i++) {
    const dd = new Date(d.getTime() - i * 86400_000);
    const key = dd.toISOString().slice(0, 10);
    try {
      const raw = JSON.parse(await readFile(join(STATE_DIR, subdir, `${key}.json`), 'utf8'));
      return { key, posts: raw.posts || [], run_at: raw.run_at, daysOld: i };
    } catch {}
  }
  return { key: null, posts: [], run_at: null, daysOld: null };
}

async function loadKuroPick(date) {
  const d = new Date(date + 'T00:00:00Z');
  for (let i = 0; i < 3; i++) {
    const dd = new Date(d.getTime() - i * 86400_000);
    const key = dd.toISOString().slice(0, 10);
    try {
      const md = await readFile(join(STATE_DIR, 'kuro-daily-pick', `${key}.md`), 'utf8');
      return { key, md };
    } catch {}
  }
  return { key: null, md: '' };
}

function htmlEsc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
function fmtNum(n) {
  if (n == null) return '—';
  if (n >= 10000) return (n/1000).toFixed(1) + 'k';
  return String(n);
}
function tagOf(post) {
  const t = (post.title + ' ' + (post.story_text || '')).toLowerCase();
  if (/\b(agent|mcp|tool[- ]use|orchestrat)\b/.test(t)) return 'agent';
  if (/\b(gpt[- ]?\d|claude|gemini|llama|mistral|sonnet|opus)\b/.test(t)) return 'model';
  if (/\b(rag|retriev|embed|vector|memory)\b/.test(t)) return 'memory';
  if (/\b(eval|benchmark|leaderboard|swe[- ]bench)\b/.test(t)) return 'eval';
  if (/\b(security|injection|jailbreak|exploit|cve)\b/.test(t)) return 'security';
  if (/\b(train|fine[- ]?tun|rlhf|distill|sft|dpo)\b/.test(t)) return 'training';
  if (/\b(infra|gpu|cuda|inference|vllm|kubernetes)\b/.test(t)) return 'infra';
  return 'other';
}
function uniqByUrl(posts) {
  const seen = new Set();
  return posts.filter(p => {
    const key = (p.url || p.id || p.title || '').replace(/[?#].*$/, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function loadTopicTrend(fromDate) {
  const d = new Date(fromDate + 'T00:00:00Z');
  const counts = {};
  for (let i = 0; i < 7; i++) {
    const dd = new Date(d.getTime() - i * 86400_000);
    const key = dd.toISOString().slice(0, 10);
    try {
      const raw = JSON.parse(await readFile(join(STATE_DIR, 'hn-ai-trend', `${key}.json`), 'utf8'));
      for (const p of (raw.posts || [])) {
        const t = tagOf(p);
        counts[t] = (counts[t] || 0) + 1;
      }
    } catch {}
  }
  return counts;
}

async function listArchiveDates() {
  try {
    const files = await readdir(join(ROOT, 'kuro-portfolio/ai-trend'));
    return files.filter(f => /^\d{4}-\d{2}-\d{2}\.html$/.test(f))
      .map(f => f.replace('.html',''))
      .sort().reverse().slice(0, 60);
  } catch { return []; }
}

const KURO_TAKE = {
  headline: 'Agent 經濟正式進場 — 從寫程式到「賣 services」',
  threads: [
    {
      title: 'Anthropic / OpenAI 都在組 services JV',
      detail: 'Latent Space 這週兩篇：Anthropic 跟 Blackstone+Goldman 合資 1.5B、OpenAI 啟動 The Deployment Company 募 4B。模型公司同時做應用層 → labs 不再只賣 token，要直接吃 enterprise services 的錢。'
    },
    {
      title: 'Vibe coding 撞牆',
      detail: 'Simon Willison 文章衝上 444 點：agentic engineering 變得「比預期更接近 vibe coding」。意思是邊界正在模糊 — 寫程式不再有清楚的「我在 review」vs「我讓 agent 跑」。這對 dev workflow 是壓力測試。'
    },
    {
      title: 'Chrome 偷裝 4GB Gemini Nano 引爆隱私戰',
      detail: '昨天 1327pt 那篇還在發酵（今日仍在 trending）。瀏覽器內建 LLM 的 silent install 模式踩到使用者紅線，Mozilla / 反 ad-tech 陣營會把這當成下一輪火藥。'
    },
  ],
  outlook: '下半年看：(1) services lab 模式會不會擠壓 SI 廠商；(2) coding agent 的「責任歸屬」框架（誰按下 deploy？）；(3) on-device LLM 的 consent UX 標準會被立法層接管。'
};

const STYLE = `
:root{color-scheme:dark;--bg:#0b0c10;--fg:#e6e6e6;--mute:#8a8f98;--dim:#5c626c;--acc:#9ab8ff;--acc2:#7fd4b8;--warn:#ffb86b;--rose:#ff9aa2;--line:#1f242c;--row:#10141a;}
*{box-sizing:border-box}html,body{margin:0;padding:0}
body{background:var(--bg);color:var(--fg);font:14.5px/1.6 -apple-system,"PingFang TC","Helvetica Neue",system-ui,sans-serif;max-width:1100px;margin:0 auto;padding:2.2rem 1.25rem 5rem}
a{color:inherit}
header{margin-bottom:1.6rem;padding-bottom:1.1rem;border-bottom:1px solid var(--line)}
.crumb{color:var(--mute);font-size:12px;margin-bottom:.4rem}
.crumb a{color:var(--mute);text-decoration:none;border-bottom:1px solid #2a2f38}
h1{font-size:1.7rem;margin:0 0 .35rem;letter-spacing:-.02em;font-weight:600}
.sub{color:var(--acc2);font-size:.92rem}
.meta{color:var(--mute);font-size:.78rem;margin-top:.5rem;display:flex;flex-wrap:wrap;gap:.55rem 1rem}
.meta span.src-stamp{display:inline-flex;align-items:center;gap:.35rem}
.meta b{color:var(--fg);font-weight:500}
.meta .stale{color:var(--warn)}
.banner{background:linear-gradient(135deg,#1a1f2e 0%,#14181f 100%);border:1px solid var(--line);border-left:4px solid var(--acc);padding:1.2rem 1.4rem;margin:1.4rem 0;border-radius:6px}
.banner .lab{color:var(--acc);font-size:.7rem;letter-spacing:.18em;text-transform:uppercase;margin-bottom:.55rem;font-weight:500}
.banner h2{font-size:1.2rem;margin:0 0 .8rem;letter-spacing:-.01em;font-weight:500;border:0;padding:0}
.banner .threads{display:grid;gap:.7rem;margin-top:.75rem}
.banner .th{padding:.6rem .85rem;background:rgba(255,255,255,.02);border-left:2px solid var(--acc2);border-radius:3px}
.banner .th .ti{color:var(--acc2);font-weight:500;font-size:.9rem;margin-bottom:.22rem}
.banner .th .de{color:var(--mute);font-size:.84rem;line-height:1.55}
.outlook{margin-top:.85rem;padding:.7rem .9rem;background:rgba(255,184,107,.05);border-left:2px solid var(--warn);border-radius:3px;color:#d9d9d9;font-size:.85rem}
.outlook strong{color:var(--warn);font-weight:500;letter-spacing:.06em;text-transform:uppercase;font-size:.7rem;display:block;margin-bottom:.3rem}
section{margin:2rem 0}
h2.sec{font-size:.78rem;color:var(--mute);text-transform:uppercase;letter-spacing:.16em;margin:0 0 .35rem;border-bottom:1px solid var(--line);padding-bottom:.45rem;font-weight:500;display:flex;align-items:baseline;gap:.6rem}
h2.sec .cnt{color:var(--acc);font-weight:400}
h2.sec .upd{color:var(--dim);font-size:.7rem;letter-spacing:.05em;text-transform:none;margin-left:auto;font-weight:400}
h2.sec .upd.stale{color:var(--warn)}
.lead{color:var(--mute);font-size:.82rem;margin:.2rem 0 .9rem}

/* dense list */
ul.feed{list-style:none;margin:0;padding:0;border-top:1px solid var(--line)}
ul.feed li{padding:.65rem .25rem;border-bottom:1px solid var(--line);display:grid;grid-template-columns:auto 1fr auto;gap:.4rem 1rem;align-items:baseline}
ul.feed li:hover{background:var(--row)}
ul.feed li .meta-row{grid-column:1 / -1;display:flex;flex-wrap:wrap;gap:.4rem 1rem;color:var(--dim);font-size:.74rem;letter-spacing:.04em;margin-top:.05rem}
ul.feed li .meta-row .pts{color:var(--mute)}
ul.feed li .meta-row .pts b{color:var(--fg);font-weight:500}
ul.feed li .meta-row .src{color:var(--acc);text-transform:uppercase;letter-spacing:.08em}
ul.feed li .meta-row .tag{color:var(--acc2)}
ul.feed li .rk{color:var(--dim);font-variant-numeric:tabular-nums;font-size:.78rem;min-width:2.2em;text-align:right;padding-top:.05rem}
ul.feed li .body{min-width:0}
ul.feed li .ti{font-size:.96rem;font-weight:500;line-height:1.4;margin:0}
ul.feed li .ti a{text-decoration:none;border-bottom:1px solid #2a2f38}
ul.feed li .ti a:hover{color:var(--acc);border-color:var(--acc)}
ul.feed li .zh{color:#cfd3da;font-size:.85rem;line-height:1.55;margin-top:.25rem}
ul.feed li .zh.todo{color:var(--dim);font-style:italic}
ul.feed li .ext{color:var(--dim);font-size:.74rem;white-space:nowrap;padding-top:.15rem}
ul.feed li .ext a{color:var(--acc);text-decoration:none;border-bottom:1px solid #2a4373}
ul.feed li .ext a:hover{color:var(--fg);border-color:var(--fg)}

.trend-bars{display:grid;grid-template-columns:auto 1fr auto;gap:.4rem .8rem;align-items:center;font-size:.85rem}
.trend-bars .bn{color:var(--fg)}
.trend-bars .bb{height:5px;background:var(--line);border-radius:3px;position:relative;overflow:hidden}
.trend-bars .bb i{position:absolute;left:0;top:0;height:100%;background:var(--acc);border-radius:3px}
.trend-bars .bv{color:var(--mute);font-size:.78rem;font-variant-numeric:tabular-nums}
.archive{display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.5rem}
.archive a{padding:.25rem .6rem;font-size:.75rem;background:var(--row);border:1px solid var(--line);border-radius:3px;text-decoration:none;color:var(--mute);font-variant-numeric:tabular-nums}
.archive a:hover{border-color:var(--acc);color:var(--fg)}
footer{color:var(--mute);font-size:.78rem;margin-top:3.5rem;padding-top:1.3rem;border-top:1px solid var(--line)}
footer a{color:var(--acc);text-decoration:none;border-bottom:1px solid #334}
.nav-row{display:flex;gap:1rem;flex-wrap:wrap;margin-top:.8rem;font-size:.82rem}
.nav-row a{color:var(--mute);text-decoration:none;border-bottom:1px solid #2a2f38}
.nav-row a:hover{color:var(--fg)}
.preview-note{background:rgba(154,184,255,.06);border:1px dashed #3a4a6e;color:var(--acc);font-size:.78rem;padding:.45rem .8rem;border-radius:3px;margin-bottom:1.3rem}
@media (max-width:640px){
  body{padding:1.5rem 1rem 3rem}h1{font-size:1.35rem}.banner{padding:.95rem 1.05rem}
  ul.feed li{grid-template-columns:auto 1fr;gap:.3rem .6rem}
  ul.feed li .ext{grid-column:2;justify-self:start;padding-top:.1rem}
}
`;

// 中文摘要：summary.claim 優先，再 so_what，最後 story_text 截斷
function zhSummary(p) {
  const s = p.summary || {};
  const claim = (s.claim && s.claim !== 'pending-llm-pass') ? s.claim : '';
  const so = (s.so_what && s.so_what !== 'pending-llm-pass') ? s.so_what : '';
  if (claim || so) return [claim, so].filter(Boolean).join(' / ');
  // GitHub repos: description is good signal
  if (p.description) return String(p.description).slice(0, 180);
  // arXiv abstracts often have first sentence
  const txt = (p.story_text || '').replace(/\s+/g, ' ').trim();
  if (txt.length > 30) return txt.slice(0, 180) + (txt.length > 180 ? '…' : '');
  return ''; // pending
}

function renderItem(p, rank) {
  const src = (p.source || (p.url && p.url.includes('news.ycombinator') ? 'hn' : 'web')).toUpperCase();
  const tag = tagOf(p);
  const stats = [];
  if (p.points != null) stats.push(`<b>${fmtNum(p.points)}</b> pts`);
  const cm = p.num_comments ?? p.comments;
  if (cm != null) stats.push(`${fmtNum(cm)} c`);
  if (p.author && /github/i.test(src)) stats.push(htmlEsc(p.author));
  if (p.language) stats.push(htmlEsc(p.language));
  const zh = zhSummary(p);
  const u = htmlEsc(p.url || '#');
  const host = (() => { try { return new URL(p.url).hostname.replace(/^www\./,''); } catch { return ''; } })();
  return `<li>
    <span class="rk">${rank}</span>
    <div class="body">
      <h3 class="ti"><a href="${u}" target="_blank" rel="noopener">${htmlEsc(p.title || '(無標題)')}</a></h3>
      ${zh
        ? `<div class="zh">${htmlEsc(zh)}</div>`
        : `<div class="zh todo">中文摘要待 LLM enrich pass — 先點右側「閱讀原文 →」</div>`}
      <div class="meta-row">
        <span class="src">${htmlEsc(src)}</span>
        <span class="tag">#${htmlEsc(tag)}</span>
        ${stats.length ? `<span class="pts">${stats.join(' · ')}</span>` : ''}
        ${host ? `<span>${htmlEsc(host)}</span>` : ''}
      </div>
    </div>
    <div class="ext"><a href="${u}" target="_blank" rel="noopener">閱讀原文 →</a></div>
  </li>`;
}

function renderTrendBars(counts) {
  const max = Math.max(1, ...Object.values(counts));
  const sorted = Object.entries(counts).sort((a,b) => b[1]-a[1]);
  return `<div class="trend-bars">
    ${sorted.map(([n,v]) =>
      `<span class="bn">${htmlEsc(n)}</span>
       <span class="bb"><i style="width:${(v/max*100).toFixed(0)}%"></i></span>
       <span class="bv">${v}</span>`
    ).join('')}
  </div>`;
}

function srcStamp(name, info) {
  const t = fmtTaipeiMinute(info.run_at);
  const stale = info.daysOld != null && info.daysOld >= 1;
  const cls = stale ? ' stale' : '';
  const note = stale ? ` (${info.daysOld}d 前)` : '';
  return `<span class="src-stamp"><b>${name}</b><span class="${cls}">${t}${note}</span></span>`;
}

function srcUpd(info, label = '更新') {
  const t = fmtTaipeiMinute(info.run_at);
  const stale = info.daysOld != null && info.daysOld >= 1;
  return `<span class="upd${stale ? ' stale' : ''}">${label} ${t}${stale ? ` · ${info.daysOld}d 前` : ''}</span>`;
}

async function main() {
  const buildAt = new Date().toISOString();
  const hn = await loadLatest('hn-ai-trend', DATE);
  const latent = await loadLatest('latent-space-trend', DATE);
  const arxiv = await loadLatest('arxiv-trend', DATE);
  const gh = await loadLatest('github-trend', DATE);
  const trend = await loadTopicTrend(DATE);
  const archive = await listArchiveDates();
  const kpick = await loadKuroPick(DATE);

  const cross = uniqByUrl([...hn.posts, ...latent.posts])
    .sort((a,b) => (b.points||0) - (a.points||0))
    .slice(0, 20);

  const newReleases = (arxiv.posts || []).slice(0, 15);

  const reads = uniqByUrl([...latent.posts, ...hn.posts])
    .filter(p => (p.story_text || '').length > 400 || /(blog|essay|article|space)/i.test(p.url || ''))
    .slice(0, 15);

  const projects = (gh.posts || []).filter(p =>
    (p.topics || []).some(t => /\b(ai|llm|agent|ml)\b/.test(t))
  ).slice(0, 20);

  const discs = (hn.posts || []).slice().sort((a,b) =>
    (b.num_comments||0) - (a.num_comments||0)
  ).slice(0, 12);


  const html = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI Trend · ${DATE} — Kuro</title>
<meta name="description" content="今日 AI 大事 / 新發布 / 值得讀 / 值得關注專案 / 熱門討論 / 趨勢 / Kuro 點評。">
<style>${STYLE}</style>
</head>
<body>
<header>
  <div class="crumb"><a href="/">← kuro.page</a> / <a href="./">ai-trend</a> / <span>${DATE}</span></div>
  <h1>AI Trend · 一份完整簡報</h1>
  <div class="sub">${DATE} · Asia/Taipei · Kuro 自動生成</div>
  <div class="meta">
    ${srcStamp('HN', hn)}
    ${srcStamp('Latent', latent)}
    ${srcStamp('arXiv', arxiv)}
    ${srcStamp('GitHub', gh)}
    <span class="src-stamp"><b>頁面 build</b><span>${fmtTaipeiMinute(buildAt)}</span></span>
  </div>
</header>

<div class="preview-note">資料每日自動拉新（cron 觸發）。stale 標 (Nd 前) 表示來源該日尚未刷新 — 多半是該來源沒有當日資料而非簡報沒更新。</div>

<div class="banner">
  <div class="lab">▎ KURO 今日點評</div>
  <h2>${htmlEsc(KURO_TAKE.headline)}</h2>
  <div class="threads">
    ${KURO_TAKE.threads.map(t => `
      <div class="th">
        <div class="ti">${htmlEsc(t.title)}</div>
        <div class="de">${htmlEsc(t.detail)}</div>
      </div>`).join('')}
  </div>
  <div class="outlook">
    <strong>未來走向 / 注意點</strong>
    ${htmlEsc(KURO_TAKE.outlook)}
  </div>
</div>

<section>
  <h2 class="sec">今日 AI 大事 <span class="cnt">${cross.length}</span> ${srcUpd(hn, 'HN')}</h2>
  <p class="lead">跨 HN + Latent Space，按關注度排序。中文摘要為 LLM enrich-pass 結果，未 enrich 的條目顯示原文鏈接。</p>
  <ul class="feed">${cross.map((p,i) => renderItem(p, i+1)).join('')}</ul>
</section>

<section>
  <h2 class="sec">新發布 / 新東西 <span class="cnt">${newReleases.length}</span> ${srcUpd(arxiv, 'arXiv')}</h2>
  <p class="lead">arXiv 最新 cs.AI / cs.LG preprint。</p>
  <ul class="feed">${newReleases.map((p,i) => renderItem(p, i+1)).join('')}</ul>
</section>

<section>
  <h2 class="sec">值得讀的文章 <span class="cnt">${reads.length}</span> ${srcUpd(latent, 'Latent')}</h2>
  <p class="lead">long-form essay / 深度分析。</p>
  <ul class="feed">${reads.map((p,i) => renderItem(p, i+1)).join('')}</ul>
</section>

<section>
  <h2 class="sec">值得關注的專案 <span class="cnt">${projects.length}</span> ${srcUpd(gh, 'GitHub')}</h2>
  <p class="lead">GitHub trending — AI / agent / LLM 相關。</p>
  <ul class="feed">${projects.map((p,i) => renderItem(p, i+1)).join('')}</ul>
</section>

<section>
  <h2 class="sec">熱門討論 <span class="cnt">${discs.length}</span> ${srcUpd(hn, 'HN')}</h2>
  <p class="lead">HN 留言數最高。</p>
  <ul class="feed">${discs.map((p,i) => renderItem(p, i+1)).join('')}</ul>
</section>

<section>
  <h2 class="sec">7 日趨勢</h2>
  <p class="lead">過去 7 天 HN AI 圈話題分布。</p>
  ${renderTrendBars(trend)}
</section>

${kpick.md ? `<section>
  <h2 class="sec">Kuro 每日精選 <span class="cnt">${kpick.key}</span></h2>
  <p class="lead">不限 AI — 當下值得知道什麼。</p>
  <pre style="white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.8rem;line-height:1.55;color:#bcc1c8;background:var(--row);border:1px solid var(--line);padding:.9rem 1rem;border-radius:4px;max-height:500px;overflow:auto">${htmlEsc(kpick.md.split('\n').slice(0, 100).join('\n'))}</pre>
</section>` : ''}

${archive.length ? `<section>
  <h2 class="sec">舊的 AI 簡報 <span class="cnt">${archive.length}</span></h2>
  <div class="archive">
    ${archive.map(d => `<a href="./${d}.html">${d}</a>`).join('')}
    <a href="./archive.html">完整 archive →</a>
  </div>
</section>` : ''}

<footer>
  <div>Kuro 自動生成 · <a href="https://github.com/miles990/mini-agent">source</a> · build ${fmtTaipeiMinute(buildAt)} (Asia/Taipei)</div>
  <div class="nav-row">
    <a href="./graph.html">Topic Graph</a>
    <a href="./swimlane.html">Swimlane</a>
    <a href="./trends.html">Trends</a>
    <a href="./archive.html">Archive</a>
  </div>
</footer>
</body>
</html>`;

  await writeFile(OUT, html, 'utf8');
  const SNAP = join(ROOT, 'kuro-portfolio/ai-trend', `${DATE}.html`);
  await writeFile(SNAP, html, 'utf8');
  const INDEX = join(ROOT, 'kuro-portfolio/ai-trend/index.html');
  await writeFile(INDEX, html, 'utf8');
  console.log(`✓ wrote ${OUT}`);
  console.log(`✓ snapshot ${SNAP}`);
  console.log(`✓ promoted ${INDEX}`);
  console.log(`  hn=${hn.key||'-'}/${hn.posts.length}@${hn.run_at?fmtTaipeiMinute(hn.run_at):'-'}`);
  console.log(`  latent=${latent.key||'-'}/${latent.posts.length}@${latent.run_at?fmtTaipeiMinute(latent.run_at):'-'}`);
  console.log(`  arxiv=${arxiv.key||'-'}/${arxiv.posts.length}@${arxiv.run_at?fmtTaipeiMinute(arxiv.run_at):'-'}`);
  console.log(`  gh=${gh.key||'-'}/${gh.posts.length}@${gh.run_at?fmtTaipeiMinute(gh.run_at):'-'}`);
  console.log(`  sections: cross=${cross.length} new=${newReleases.length} reads=${reads.length} proj=${projects.length} disc=${discs.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
