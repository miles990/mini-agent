#!/usr/bin/env node
/**
 * build-ai-trend-index.mjs
 *
 * 生成 kuro-portfolio/ai-trend/index.html — Alex 要的「一頁展示引導頁面」。
 *
 * 三欄：
 *   1. 今日最重要話題  — 從 today's hn-ai-trend posts 跨來源 topic 聚合
 *   2. 最熱討論       — 取 today 最高 points + comments 的 post
 *   3. Kuro 每日精選   — parse YYYY-MM-DD-kuro-pick.md
 *
 * 舊 index.html (archive listing) 移到 archive.html。
 *
 * 用法：node scripts/build-ai-trend-index.mjs [YYYY-MM-DD]
 *   無參數 = 今天 (Asia/Taipei)
 */
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const STATE_DIR = join(ROOT, 'memory/state');
const OUT = join(ROOT, 'kuro-portfolio/ai-trend/index.html');

// 取 Asia/Taipei 今日日期
function todayTaipei() {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
  });
  return fmt.format(new Date()); // YYYY-MM-DD
}

const DATE = process.argv[2] || todayTaipei();

// Topic taxonomy — 同 build-landing.mjs 但只列 8 個常用
const TOPICS = [
  { name: 'Agent / 自主系統',  kw: /\b(agent|autonomous|tool[- ]use|copilot|claude code|cursor|swarm|orchestrat|mcp)\b/i },
  { name: 'Model / LLM',       kw: /\b(gpt[- ]?\d|claude|gemini|llama|mistral|anthropic|openai|deepseek|qwen|grok|sonnet|haiku|opus)\b/i },
  { name: 'Training / 微調',   kw: /\b(train(ing)?|fine[- ]?tun|rlhf|distill|pretrain|sft|dpo|grpo|reward model|alignment)\b/i },
  { name: 'Memory / 記憶',     kw: /\b(memory|context window|persistent|retrieval|rag|wiki|notebook)\b/i },
  { name: 'Eval / 評測',       kw: /\b(benchmark|eval(uation)?|leaderboard|swe[- ]bench|mmlu|humaneval|arena)\b/i },
  { name: 'Security / 安全',   kw: /\b(security|prompt injection|jailbreak|exploit|cve|vuln|attack|sandbox|malware|supply chain)\b/i },
  { name: 'Infra / 基礎設施',  kw: /\b(infra|kubernetes|k8s|docker|deploy|gpu|cuda|inference|vllm|serving|triton)\b/i },
  { name: 'Policy / 政策',     kw: /\b(policy|standard|regulat|opposition|firefox|mozilla|chrome|browser|w3c|copyright|license)\b/i },
];

function tagPost(post) {
  const text = [post.title || '', post.summary?.claim || '', post.summary?.so_what || ''].join(' ');
  const hits = TOPICS.filter(t => t.kw.test(text)).map(t => t.name);
  return hits[0] || 'Other / 其他';
}

async function loadTodayPosts(date) {
  const file = join(STATE_DIR, 'hn-ai-trend', `${date}.json`);
  try {
    const raw = JSON.parse(await readFile(file, 'utf8'));
    return { posts: raw.posts || [], generated: raw.run_at };
  } catch (e) {
    return { posts: [], generated: null, error: e.message };
  }
}

async function loadKuroPicks(date) {
  const file = join(STATE_DIR, 'hn-ai-trend', `${date}-kuro-pick.md`);
  try {
    const md = await readFile(file, 'utf8');
    const sections = md.split(/^## (\d+)\. /m).slice(1);
    const picks = [];
    for (let i = 0; i < sections.length; i += 2) {
      const num = sections[i];
      const body = sections[i + 1];
      const titleLine = body.split('\n')[0].trim();
      const urlMatch = body.match(/🔗 (\S+)\s+·\s+HN:\s+(\d+)pts\s+\/\s+(\d+)c/);
      const why = (body.match(/\*\*為什麼值得看\*\*：(.+?)(?:\n|$)/) || [])[1] || '';
      const judge = (body.match(/\*\*Kuro 判斷\*\*：(.+?)(?:\n|$)/) || [])[1] || '';
      picks.push({
        num, title: titleLine,
        url: urlMatch?.[1] || '#',
        pts: urlMatch?.[2] || '?',
        comments: urlMatch?.[3] || '?',
        why, judge
      });
    }
    return picks;
  } catch (e) {
    return [];
  }
}

function aggregateTopics(posts) {
  const buckets = new Map();
  for (const p of posts) {
    const t = tagPost(p);
    if (!buckets.has(t)) buckets.set(t, { name: t, count: 0, samples: [] });
    const b = buckets.get(t);
    b.count++;
    b.samples.push({ title: p.title, url: p.url, pts: p.points || 0, comments: p.descendants || 0 });
  }
  return [...buckets.values()]
    .sort((a, b) => b.count - a.count)
    .map(b => ({ ...b, samples: b.samples.sort((a, c) => (c.pts + c.comments * 2) - (a.pts + a.comments * 2)).slice(0, 3) }));
}

function topDiscussion(posts) {
  // 「最熱討論」= 評論數 × 2 + 分數 最高的 post (留言多 = 真討論)
  return [...posts].sort((a, b) =>
    ((b.descendants || 0) * 2 + (b.points || 0)) - ((a.descendants || 0) * 2 + (a.points || 0))
  )[0];
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function renderHtml({ date, posts, picks, topics, topDisc, generated }) {
  const dateZh = date.replace(/-/g, '/');
  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI Trend · ${dateZh} — Kuro</title>
<meta name="description" content="今天 AI 圈最重要話題、最熱討論、Kuro 每日精選。每天早上 9 點更新。">
<link rel="canonical" href="https://kuro.page/ai-trend/">
<style>
:root {
  color-scheme: dark;
  --bg: #0b0c10;
  --fg: #e6e6e6;
  --muted: #8a8f98;
  --accent: #9ab8ff;
  --accent2: #7fd4b8;
  --warn: #ffb86b;
  --line: #1f242c;
  --card: #14181f;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--bg); color: var(--fg);
  font: 15px/1.6 -apple-system, "PingFang TC", "Helvetica Neue", system-ui, sans-serif;
  max-width: 920px; margin: 0 auto; padding: 3rem 1.25rem 5rem;
}
header { margin-bottom: 2rem; }
header .breadcrumb { color: var(--muted); font-size: 12px; margin-bottom: 0.4rem; }
header .breadcrumb a { color: var(--muted); text-decoration: none; border-bottom: 1px solid #2a2f38; }
header .breadcrumb a:hover { color: var(--fg); }
header h1 { font-size: 1.75rem; margin: 0 0 0.3rem; letter-spacing: -0.02em; font-weight: 600; }
header .date { color: var(--accent2); font-size: 0.95rem; }
header .meta { color: var(--muted); font-size: 0.85rem; margin-top: 0.4rem; }

section { margin: 2.5rem 0; }
section h2 {
  font-size: 0.85rem; color: var(--muted); text-transform: uppercase;
  letter-spacing: 0.14em; margin: 0 0 0.9rem;
  border-bottom: 1px solid var(--line); padding-bottom: 0.5rem;
}
.lead { font-size: 0.9rem; color: var(--muted); margin: 0 0 1rem; }

.topic-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 0.75rem; }
.topic {
  background: var(--card); border: 1px solid var(--line);
  border-left: 3px solid var(--accent); border-radius: 4px; padding: 0.85rem 1rem;
}
.topic .name { font-size: 0.95rem; font-weight: 500; }
.topic .count { font-size: 1.6rem; font-weight: 300; color: var(--accent); margin: 0.3rem 0; }
.topic .smp { font-size: 0.8rem; color: var(--muted); margin-top: 0.4rem; }
.topic .smp a { color: var(--fg); text-decoration: none; border-bottom: 1px dotted #444; }
.topic .smp a:hover { color: var(--accent); border-bottom-color: var(--accent); }
.topic .smp .meta { color: var(--muted); font-size: 0.75rem; }

.disc {
  background: var(--card); border: 1px solid var(--line);
  border-left: 3px solid var(--warn); border-radius: 4px; padding: 1.25rem;
}
.disc .title { font-size: 1.1rem; font-weight: 500; margin: 0 0 0.5rem; line-height: 1.4; }
.disc .title a { color: var(--fg); text-decoration: none; border-bottom: 1px solid #444; }
.disc .title a:hover { color: var(--warn); border-bottom-color: var(--warn); }
.disc .stats { color: var(--muted); font-size: 0.85rem; margin-bottom: 0.6rem; }
.disc .stats strong { color: var(--warn); font-weight: 500; }
.disc .url { color: var(--muted); font-size: 0.75rem; word-break: break-all; }

.pick {
  background: var(--card); border: 1px solid var(--line);
  border-left: 3px solid var(--accent2); border-radius: 4px;
  padding: 1rem 1.2rem; margin-bottom: 0.75rem;
}
.pick .head { display: flex; align-items: baseline; gap: 0.6rem; margin-bottom: 0.4rem; flex-wrap: wrap; }
.pick .num { color: var(--accent2); font-weight: 500; font-size: 0.9rem; }
.pick .title { font-size: 1rem; font-weight: 500; }
.pick .title a { color: var(--fg); text-decoration: none; border-bottom: 1px solid #444; }
.pick .title a:hover { color: var(--accent2); border-bottom-color: var(--accent2); }
.pick .stats { color: var(--muted); font-size: 0.78rem; margin-left: auto; }
.pick .why { color: var(--muted); font-size: 0.85rem; margin: 0.4rem 0 0.3rem; }
.pick .judge { font-size: 0.85rem; color: var(--fg); border-left: 2px solid var(--line); padding-left: 0.7rem; margin-top: 0.5rem; font-style: italic; }

footer { color: var(--muted); font-size: 0.78rem; margin-top: 4rem; padding-top: 1.5rem; border-top: 1px solid var(--line); }
footer a { color: var(--accent); border-bottom: 1px solid #334; text-decoration: none; }
.nav-row { display: flex; gap: 1rem; flex-wrap: wrap; margin-top: 1rem; font-size: 0.85rem; }
.nav-row a { color: var(--muted); border-bottom: 1px solid #2a2f38; text-decoration: none; }
.nav-row a:hover { color: var(--fg); }

@media (max-width: 600px) {
  body { padding: 2rem 1rem 3rem; }
  header h1 { font-size: 1.4rem; }
  .topic-grid { grid-template-columns: 1fr; }
  .pick .stats { margin-left: 0; width: 100%; }
}
</style>
</head>
<body>

<header>
  <div class="breadcrumb"><a href="/">← kuro.page</a></div>
  <h1>AI Trend · 一眼看懂</h1>
  <div class="date">${dateZh}</div>
  <div class="meta">今天 AI 圈最重要的話題、最熱討論、和我自己挑的東西。資料來自 HN top + 我每天 09:00 跑 enrichment。</div>
</header>

<section>
  <h2>① 今日最重要話題</h2>
  <p class="lead">把 ${posts.length} 篇貼文按主題分類，看哪個分類今天聲量最大。</p>
  <div class="topic-grid">
${topics.slice(0, 6).map(t => `    <div class="topic">
      <div class="name">${escapeHtml(t.name)}</div>
      <div class="count">${t.count}</div>
      <div class="smp">
${t.samples.map(s => `        <div><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener">${escapeHtml(s.title.slice(0, 70))}${s.title.length > 70 ? '…' : ''}</a> <span class="meta">· ${s.pts}pts ${s.comments}c</span></div>`).join('\n')}
      </div>
    </div>`).join('\n')}
  </div>
</section>

<section>
  <h2>② 最熱討論</h2>
  <p class="lead">評論數 × 2 + 分數最高 — 真正在被吵的那篇。</p>
${topDisc ? `  <div class="disc">
    <div class="title"><a href="${escapeHtml(topDisc.url)}" target="_blank" rel="noopener">${escapeHtml(topDisc.title)}</a></div>
    <div class="stats"><strong>${topDisc.points || 0}</strong> 分 · <strong>${topDisc.descendants || 0}</strong> 則留言</div>
    <div class="url">${escapeHtml(topDisc.url || '')}</div>
${topDisc.summary?.claim ? `    <div class="why" style="margin-top:0.7rem">${escapeHtml(topDisc.summary.claim)}</div>` : ''}
  </div>` : '  <p class="lead">今天沒有資料。</p>'}
</section>

<section>
  <h2>③ Kuro 每日精選</h2>
  <p class="lead">${picks.length > 0 ? `從今天 ${posts.length} 篇裡挑 ${picks.length} 篇 — 公共信號優先。每篇我都寫了為什麼值得看 + 我的判斷。目前還是 AI 主題為主，明天起接非 AI 來源。` : '今天還沒生成。'}</p>
${picks.map(p => `  <div class="pick">
    <div class="head">
      <span class="num">#${p.num}</span>
      <span class="title"><a href="${escapeHtml(p.url)}" target="_blank" rel="noopener">${escapeHtml(p.title)}</a></span>
      <span class="stats">${p.pts}pts · ${p.comments}c</span>
    </div>
    <div class="why">${escapeHtml(p.why)}</div>
    <div class="judge">${escapeHtml(p.judge)}</div>
  </div>`).join('\n')}
</section>

<footer>
  <div>由 <a href="/">Kuro</a> 自動生成 · 資料時間 ${generated || dateZh + ' 09:00 Taipei'}</div>
  <div class="nav-row">
    <a href="./archive.html">過往編輯</a>
    <a href="./graph.html">主題圖譜</a>
    <a href="./swimlane.html">時間 × 來源</a>
    <a href="./trends.html">趨勢線</a>
    <a href="./resonance.html">跨來源共振</a>
  </div>
</footer>

</body>
</html>
`;
}

async function main() {
  const { posts, generated, error } = await loadTodayPosts(DATE);
  if (error) console.warn(`[warn] ${DATE}.json: ${error}`);
  const picks = await loadKuroPicks(DATE);
  const topics = aggregateTopics(posts);
  const topDisc = topDiscussion(posts);

  const html = renderHtml({ date: DATE, posts, picks, topics, topDisc, generated });
  await writeFile(OUT, html, 'utf8');
  console.log(`[ok] wrote ${OUT}`);
  console.log(`     posts=${posts.length} topics=${topics.length} picks=${picks.length} top_disc="${topDisc?.title?.slice(0, 50) || 'none'}"`);
}

main().catch(e => { console.error(e); process.exit(1); });
