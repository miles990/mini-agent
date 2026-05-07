#!/usr/bin/env node
/**
 * build-ai-trend-preview.mjs
 *
 * Generate kuro-portfolio/ai-trend/preview.html — Alex 2026-05-07 redesign.
 *
 * 對應 Alex 需求（2026-05-07 11:39）：
 *   - 今日 AI 大事 / 新發布 / 值得讀文章 / 值得關注專案 / 熱門討論 / 趨勢 / Kuro 點評 / 未來走向
 *   - 篇幅不限、自動更新、可看舊版
 *
 * Mockup 階段：用 preview.html 不動 prod index.html。Alex 看完拍板再 promote。
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const STATE_DIR = join(ROOT, 'memory/state');
const OUT = join(ROOT, 'kuro-portfolio/ai-trend/preview.html');

function todayTaipei() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
  });
  return fmt.format(new Date());
}
const DATE = process.argv[2] || todayTaipei();

// 試載 N 天回退（fail-soft）
async function loadLatest(subdir, fromDate, days = 3) {
  const d = new Date(fromDate + 'T00:00:00Z');
  for (let i = 0; i < days; i++) {
    const dd = new Date(d.getTime() - i * 86400_000);
    const key = dd.toISOString().slice(0, 10);
    try {
      const raw = JSON.parse(await readFile(join(STATE_DIR, subdir, `${key}.json`), 'utf8'));
      return { key, posts: raw.posts || [], run_at: raw.run_at };
    } catch {}
  }
  return { key: null, posts: [], run_at: null };
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

// 跨來源 dedupe by URL host+path
function uniqByUrl(posts) {
  const seen = new Set();
  return posts.filter(p => {
    const key = (p.url || p.id || p.title || '').replace(/[?#].*$/, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// 取近 7 天 hn-ai-trend topic 計數
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
      .sort().reverse().slice(0, 14);
  } catch { return []; }
}

// === Kuro 點評（2026-05-07，靜態寫稿；之後可由 daily-pick 注入） ===
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
:root{color-scheme:dark;--bg:#0b0c10;--fg:#e6e6e6;--mute:#8a8f98;--acc:#9ab8ff;--acc2:#7fd4b8;--warn:#ffb86b;--rose:#ff9aa2;--line:#1f242c;--card:#14181f;}
*{box-sizing:border-box}html,body{margin:0;padding:0}
body{background:var(--bg);color:var(--fg);font:15px/1.65 -apple-system,"PingFang TC","Helvetica Neue",system-ui,sans-serif;max-width:980px;margin:0 auto;padding:2.5rem 1.25rem 5rem}
a{color:inherit}
header{margin-bottom:2rem;padding-bottom:1.4rem;border-bottom:1px solid var(--line)}
.crumb{color:var(--mute);font-size:12px;margin-bottom:.4rem}
.crumb a{color:var(--mute);text-decoration:none;border-bottom:1px solid #2a2f38}
h1{font-size:1.85rem;margin:0 0 .35rem;letter-spacing:-.02em;font-weight:600}
.sub{color:var(--acc2);font-size:.95rem}
.meta{color:var(--mute);font-size:.8rem;margin-top:.4rem}
.banner{background:linear-gradient(135deg,#1a1f2e 0%,#14181f 100%);border:1px solid var(--line);border-left:4px solid var(--acc);padding:1.4rem 1.5rem;margin:1.6rem 0;border-radius:6px}
.banner .lab{color:var(--acc);font-size:.7rem;letter-spacing:.18em;text-transform:uppercase;margin-bottom:.55rem;font-weight:500}
.banner h2{font-size:1.25rem;margin:0 0 .8rem;letter-spacing:-.01em;font-weight:500;border:0;padding:0}
.banner .threads{display:grid;gap:.85rem;margin-top:.9rem}
.banner .th{padding:.7rem .9rem;background:rgba(255,255,255,.02);border-left:2px solid var(--acc2);border-radius:3px}
.banner .th .ti{color:var(--acc2);font-weight:500;font-size:.92rem;margin-bottom:.25rem}
.banner .th .de{color:var(--mute);font-size:.86rem;line-height:1.55}
.outlook{margin-top:1rem;padding:.85rem 1rem;background:rgba(255,184,107,.05);border-left:2px solid var(--warn);border-radius:3px;color:#d9d9d9;font-size:.88rem}
.outlook strong{color:var(--warn);font-weight:500;letter-spacing:.06em;text-transform:uppercase;font-size:.7rem;display:block;margin-bottom:.3rem}
section{margin:2.4rem 0}
h2.sec{font-size:.78rem;color:var(--mute);text-transform:uppercase;letter-spacing:.16em;margin:0 0 1rem;border-bottom:1px solid var(--line);padding-bottom:.5rem;font-weight:500}
h2.sec .cnt{color:var(--acc);margin-left:.5rem;font-weight:400}
.lead{color:var(--mute);font-size:.85rem;margin:0 0 1rem}
.grid{display:grid;gap:.8rem}
.grid.col2{grid-template-columns:repeat(auto-fill,minmax(280px,1fr))}
.card{background:var(--card);border:1px solid var(--line);border-radius:5px;padding:.95rem 1.05rem;transition:border-color .15s}
.card:hover{border-color:var(--acc)}
.card.story{border-left:3px solid var(--acc)}
.card.proj{border-left:3px solid var(--acc2)}
.card.disc{border-left:3px solid var(--warn)}
.card.read{border-left:3px solid var(--rose)}
.card.new{border-left:3px solid #c0a8ff}
.card .src{font-size:.7rem;color:var(--mute);letter-spacing:.08em;text-transform:uppercase;margin-bottom:.35rem}
.card .ti{font-size:1rem;font-weight:500;margin:0 0 .35rem;line-height:1.4}
.card .ti a{text-decoration:none;border-bottom:1px solid #333}
.card .ti a:hover{color:var(--acc);border-color:var(--acc)}
.card .stats{color:var(--mute);font-size:.78rem;margin-top:.45rem}
.card .ex{color:#bcc1c8;font-size:.85rem;margin-top:.55rem;line-height:1.55;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.tag{display:inline-block;padding:.05rem .5rem;font-size:.68rem;background:rgba(154,184,255,.1);color:var(--acc);border-radius:2px;margin-right:.35rem;letter-spacing:.05em}
.trend-bars{display:grid;grid-template-columns:auto 1fr auto;gap:.4rem .8rem;align-items:center;font-size:.85rem}
.trend-bars .bn{color:var(--fg)}
.trend-bars .bb{height:6px;background:var(--line);border-radius:3px;position:relative;overflow:hidden}
.trend-bars .bb i{position:absolute;left:0;top:0;height:100%;background:var(--acc);border-radius:3px}
.trend-bars .bv{color:var(--mute);font-size:.78rem}
.archive{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.5rem}
.archive a{padding:.3rem .65rem;font-size:.78rem;background:var(--card);border:1px solid var(--line);border-radius:3px;text-decoration:none;color:var(--mute)}
.archive a:hover{border-color:var(--acc);color:var(--fg)}
footer{color:var(--mute);font-size:.78rem;margin-top:4rem;padding-top:1.5rem;border-top:1px solid var(--line)}
footer a{color:var(--acc);text-decoration:none;border-bottom:1px solid #334}
.nav-row{display:flex;gap:1rem;flex-wrap:wrap;margin-top:1rem;font-size:.85rem}
.nav-row a{color:var(--mute);text-decoration:none;border-bottom:1px solid #2a2f38}
.nav-row a:hover{color:var(--fg)}
.preview-note{background:rgba(255,184,107,.08);border:1px dashed var(--warn);color:var(--warn);font-size:.8rem;padding:.5rem .85rem;border-radius:3px;margin-bottom:1.5rem}
@media (max-width:600px){body{padding:1.8rem 1rem 3rem}h1{font-size:1.4rem}.banner{padding:1rem 1.1rem}}
`;

function renderCard(p, kind = 'story') {
  const src = (p.source || (p.url && p.url.includes('news.ycombinator') ? 'hn' : '')).toUpperCase();
  const stats = [];
  if (p.points != null) stats.push(`<strong>${fmtNum(p.points)}</strong> pts`);
  if (p.num_comments != null) stats.push(`${fmtNum(p.num_comments)}c`);
  else if (p.comments != null) stats.push(`${fmtNum(p.comments)}c`);
  if (p.author && kind === 'proj') stats.push(htmlEsc(p.author));
  if (p.language && kind === 'proj') stats.push(`<span class="tag">${htmlEsc(p.language)}</span>`);
  const excerpt = (p.story_text || '').slice(0, 280);
  return `<article class="card ${kind}">
    <div class="src">${htmlEsc(src || 'web')} · ${tagOf(p)}</div>
    <h3 class="ti"><a href="${htmlEsc(p.url)}" target="_blank" rel="noopener">${htmlEsc(p.title)}</a></h3>
    ${excerpt ? `<div class="ex">${htmlEsc(excerpt)}${excerpt.length >= 280 ? '…' : ''}</div>` : ''}
    <div class="stats">${stats.join(' · ')}</div>
  </article>`;
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

async function main() {
  const hn = await loadLatest('hn-ai-trend', DATE);
  const latent = await loadLatest('latent-space-trend', DATE);
  const arxiv = await loadLatest('arxiv-trend', DATE);
  const gh = await loadLatest('github-trend', DATE);
  const trend = await loadTopicTrend(DATE);
  const archive = await listArchiveDates();
  const kpick = await loadKuroPick(DATE);

  // 今日 AI 大事 — HN + latent 跨來源 top 6 by points
  const cross = uniqByUrl([...hn.posts, ...latent.posts])
    .sort((a,b) => (b.points||0) - (a.points||0))
    .slice(0, 6);

  // 新發布 — arxiv 最新 4
  const newReleases = (arxiv.posts || []).slice(0, 4);

  // 值得讀 — latent + HN 帶 story_text 的 long-form
  const reads = uniqByUrl([...latent.posts, ...hn.posts])
    .filter(p => (p.story_text || '').length > 400 || /(blog|essay|article|space)/i.test(p.url || ''))
    .slice(0, 4);

  // 專案 — github 帶 ai topic
  const projects = (gh.posts || []).filter(p =>
    (p.topics || []).some(t => /\b(ai|llm|agent|ml)\b/.test(t))
  ).slice(0, 6);

  // 熱門討論 — HN by num_comments
  const discs = (hn.posts || []).slice().sort((a,b) =>
    (b.num_comments||0) - (a.num_comments||0)
  ).slice(0, 4);

  const html = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI Trend Preview · ${DATE} — Kuro</title>
<meta name="description" content="今日 AI 大事 / 新發布 / 值得讀 / 值得關注專案 / 熱門討論 / 趨勢 / Kuro 點評。">
<style>${STYLE}</style>
</head>
<body>
<header>
  <div class="crumb"><a href="/">← kuro.page</a> / <a href="./">ai-trend</a> / preview</div>
  <h1>AI Trend · 一份完整簡報</h1>
  <div class="sub">${DATE} · Asia/Taipei</div>
  <div class="meta">資料：HN${hn.key?` ${hn.key}`:''} · Latent${latent.key?` ${latent.key}`:''} · arXiv${arxiv.key?` ${arxiv.key}`:''} · GitHub${gh.key?` ${gh.key}`:''} · 每日自動更新</div>
</header>

<div class="preview-note">⚠️ Preview 版本（Alex 2026-05-07 redesign）。確認後 promote 到 index.html。</div>

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
  <h2 class="sec">今日 AI 大事 <span class="cnt">${cross.length}</span></h2>
  <p class="lead">跨 HN + Latent Space，按關注度排序。</p>
  <div class="grid col2">${cross.map(p => renderCard(p, 'story')).join('')}</div>
</section>

<section>
  <h2 class="sec">新發布 / 新東西 <span class="cnt">${newReleases.length}</span></h2>
  <p class="lead">arXiv 最新 cs.AI / cs.LG preprint。</p>
  <div class="grid col2">${newReleases.map(p => renderCard(p, 'new')).join('')}</div>
</section>

<section>
  <h2 class="sec">值得讀的文章 <span class="cnt">${reads.length}</span></h2>
  <p class="lead">long-form essay / 深度分析。</p>
  <div class="grid col2">${reads.map(p => renderCard(p, 'read')).join('')}</div>
</section>

<section>
  <h2 class="sec">值得關注的專案 <span class="cnt">${projects.length}</span></h2>
  <p class="lead">GitHub trending — AI / agent / LLM 相關。</p>
  <div class="grid col2">${projects.map(p => renderCard(p, 'proj')).join('')}</div>
</section>

<section>
  <h2 class="sec">熱門討論 <span class="cnt">${discs.length}</span></h2>
  <p class="lead">HN 留言數最高。</p>
  <div class="grid col2">${discs.map(p => renderCard(p, 'disc')).join('')}</div>
</section>

<section>
  <h2 class="sec">7 日趨勢</h2>
  <p class="lead">過去 7 天 HN AI 圈話題分布。</p>
  ${renderTrendBars(trend)}
</section>

${kpick.md ? `<section>
  <h2 class="sec">Kuro 每日精選 <span class="cnt">${kpick.key}</span></h2>
  <p class="lead">不限 AI — 當下值得知道什麼。</p>
  <div class="card" style="white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.8rem;line-height:1.55;color:#bcc1c8;max-height:400px;overflow:auto">${htmlEsc(kpick.md.split('\n').slice(0, 80).join('\n'))}</div>
</section>` : ''}

${archive.length ? `<section>
  <h2 class="sec">舊的 AI 簡報</h2>
  <div class="archive">
    ${archive.map(d => `<a href="./${d}.html">${d}</a>`).join('')}
    <a href="./archive.html">完整 archive →</a>
  </div>
</section>` : ''}

<footer>
  <div>Kuro 自動生成 · <a href="https://github.com/miles990/mini-agent">source</a> · <a href="./">穩定版 (index.html)</a></div>
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
  console.log(`✓ wrote ${OUT}`);
  console.log(`  hn=${hn.key||'-'}/${hn.posts.length} latent=${latent.key||'-'}/${latent.posts.length} arxiv=${arxiv.key||'-'}/${arxiv.posts.length} gh=${gh.key||'-'}/${gh.posts.length}`);
  console.log(`  sections: cross=${cross.length} new=${newReleases.length} reads=${reads.length} proj=${projects.length} disc=${discs.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
