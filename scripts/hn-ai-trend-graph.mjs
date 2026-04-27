#!/usr/bin/env node
/**
 * hn-ai-trend-graph.mjs
 *
 * Reads daily AI digest JSONs from multiple sources:
 *   - memory/state/hn-ai-trend/   (Hacker News)
 *   - memory/state/reddit-trend/  (r/MachineLearning, r/LocalLLaMA, r/singularity)
 *   - memory/state/x-trend/       (X/Twitter — optional, future)
 *
 * Tags each post by topic via keyword matching, builds a force-directed
 * graph (d3 v7), and writes a self-contained HTML page.
 *
 * Output: kuro-portfolio/hn-ai-trend/graph.html (served at kuro.page/hn-ai-trend/graph.html)
 *
 * Nodes  = posts (size = points, FILL = source, STROKE = primary topic)
 * Edges  = shared topic between two posts (weight = shared count)
 */
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const STATE_DIR = join(ROOT, 'memory/state');
const OUT = join(ROOT, 'kuro-portfolio/hn-ai-trend/graph.html');

// Multi-source registry. Each source maps a state subdir to a default `source` tag
// and a fill color. Order matters for stable legend ordering.
const SOURCES = [
  { key: 'hn',     dir: 'hn-ai-trend',  color: '#ff8800', label: 'HN',     hubUrl: id => `https://news.ycombinator.com/item?id=${id}` },
  { key: 'reddit', dir: 'reddit-trend', color: '#ff4500', label: 'Reddit', hubUrl: (_id, p) => p.url },
  { key: 'x',      dir: 'x-trend',      color: '#1da1f2', label: 'X',      hubUrl: (_id, p) => p.url },
];
const DEFAULT_SOURCE = { key: 'unknown', color: '#888', label: 'unknown' };

// Topic taxonomy — keyword → canonical topic. First match wins for primary color.
// Order matters: more specific first.
const TOPICS = [
  { name: 'memory',    color: '#7fd4b8', kw: /\b(memory|context window|persistent|retrieval|rag\b|wiki|notebook)\b/i },
  { name: 'agent',     color: '#9ab8ff', kw: /\b(agent|autonomous|tool[- ]use|copilot|claude code|cursor|swarm|orchestrat|mcp)\b/i },
  { name: 'model',     color: '#ffb86b', kw: /\b(gpt[- ]?\d|claude|gemini|llama|mistral|anthropic|openai|deepseek|qwen|grok|sonnet|haiku|opus)\b/i },
  { name: 'training',  color: '#ff79c6', kw: /\b(train(ing)?|fine[- ]?tun|rlhf|distill|pretrain|sft|dpo|grpo|reward model)\b/i },
  { name: 'eval',      color: '#bd93f9', kw: /\b(benchmark|eval(uation)?|leaderboard|swe[- ]bench|mmlu|humaneval|arena)\b/i },
  { name: 'security',  color: '#ff5555', kw: /\b(security|prompt injection|jailbreak|exploit|cve|vuln|attack|sandbox)\b/i },
  { name: 'infra',     color: '#8be9fd', kw: /\b(infra|kubernetes|k8s|docker|deploy|gpu|cuda|inference|vllm|serving|triton)\b/i },
  { name: 'reasoning', color: '#f1fa8c', kw: /\b(reason(ing)?|chain[- ]of[- ]thought|cot\b|o1\b|o3\b|thinking|planning|search)\b/i },
  { name: 'opinion',   color: '#aaaaaa', kw: /\b(ask hn|show hn|opinion|rant|essay|why|how i)\b/i },
];
const DEFAULT_TOPIC = { name: 'other', color: '#666666' };

function tagPost(post) {
  const text = [
    post.title || '',
    post.summary?.claim || '',
    post.summary?.novelty || '',
    post.summary?.so_what || '',
  ].join(' ');
  const tags = TOPICS.filter(t => t.kw.test(text)).map(t => t.name);
  const primary = tags[0] || DEFAULT_TOPIC.name;
  const color = TOPICS.find(t => t.name === primary)?.color || DEFAULT_TOPIC.color;
  return { tags, primary, color };
}

async function dirExists(p) {
  try { const s = await stat(p); return s.isDirectory(); } catch { return false; }
}

async function loadSource(srcDef) {
  const dir = join(STATE_DIR, srcDef.dir);
  if (!await dirExists(dir)) {
    console.log(`[graph] source ${srcDef.key}: dir not found, skipping`);
    return { srcDef, files: [], posts: [] };
  }
  const files = (await readdir(dir))
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  const posts = [];
  for (const f of files) {
    const date = f.replace('.json', '');
    let raw;
    try { raw = JSON.parse(await readFile(join(dir, f), 'utf8')); }
    catch (e) { console.warn(`[graph] skip malformed ${srcDef.key}/${f}: ${e.message}`); continue; }
    for (const p of (raw.posts || [])) {
      const t = tagPost(p);
      // Honor post-level source if present, else fall back to dir-level default.
      const srcKey = p.source || srcDef.key;
      const matchedSrc = SOURCES.find(s => s.key === srcKey) || srcDef;
      posts.push({
        id: p.id,
        date,
        source: matchedSrc.key,
        sourceColor: matchedSrc.color,
        sourceLabel: matchedSrc.label,
        subreddit: p.subreddit || null,
        title: p.title,
        url: p.url,
        author: p.author,
        points: p.points,
        comments: p.comments,
        hub: matchedSrc.hubUrl(p.id, p),
        claim: p.summary?.claim || '',
        novelty: p.summary?.novelty || '',
        so_what: p.summary?.so_what || '',
        tags: t.tags,
        primary: t.primary,
        color: t.color,           // topic color (stroke ring)
      });
    }
  }
  console.log(`[graph] source ${srcDef.key}: ${files.length} files, ${posts.length} posts`);
  return { srcDef, files, posts };
}

async function main() {
  const loaded = [];
  for (const s of SOURCES) loaded.push(await loadSource(s));

  const allPosts = loaded.flatMap(l => l.posts);
  const allFiles = loaded.flatMap(l => l.files);
  if (allFiles.length === 0) {
    console.error('[graph] no source data found in any registered dir');
    process.exit(1);
  }

  // Dedup by id (same post may appear across consecutive days)
  const seen = new Map();
  for (const p of allPosts) {
    const prev = seen.get(p.id);
    if (!prev || p.points > prev.points) seen.set(p.id, p);
  }
  const nodes = [...seen.values()];

  // Build edges: any pair of posts sharing >=1 tag
  const links = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const shared = a.tags.filter(t => b.tags.includes(t));
      if (shared.length > 0) {
        links.push({ source: a.id, target: b.id, weight: shared.length, shared });
      }
    }
  }

  console.log(`[graph] ${nodes.length} unique posts, ${links.length} edges`);

  // Topic legend (only topics actually used) — used for stroke ring color.
  const usedTopics = new Set(nodes.map(n => n.primary));
  const topicLegend = [...TOPICS, DEFAULT_TOPIC]
    .filter(t => usedTopics.has(t.name))
    .map(t => ({ name: t.name, color: t.color, count: nodes.filter(n => n.primary === t.name).length }));

  // Source legend — used for fill color, primary visual cluster.
  const usedSources = new Set(nodes.map(n => n.source));
  const sourceLegend = SOURCES
    .filter(s => usedSources.has(s.key))
    .map(s => ({ name: s.label, color: s.color, count: nodes.filter(n => n.source === s.key).length }));

  const sortedDates = [...new Set(allFiles.map(f => f.replace('.json','')))].sort();
  const dateRange = `${sortedDates[0]} → ${sortedDates[sortedDates.length-1]}`;

  // Calendar coverage: show real sample density vs span. Renderer-side fix
  // because backfill is structurally impossible (HN Firebase has no historical
  // top-stories endpoint). See docs/plans/2026-04-27-hn-trend-gap-day-render.md.
  const first = new Date(sortedDates[0] + 'T00:00:00Z');
  const last  = new Date(sortedDates[sortedDates.length - 1] + 'T00:00:00Z');
  const calendarDays = Math.round((last - first) / 86400000) + 1;
  const have = new Set(sortedDates);
  const missingDates = [];
  for (let d = new Date(first); d <= last; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    if (!have.has(iso)) missingDates.push(iso);
  }
  const sampledDays = sortedDates.length;
  console.log(`[graph] coverage: ${sampledDays}/${calendarDays} days, gaps: ${missingDates.join(', ') || 'none'}`);

  // Top signals: top-5 by points. Tag each top node with topRank for halo CSS.
  const topSignals = [...nodes].sort((a, b) => (b.points || 0) - (a.points || 0)).slice(0, 5);
  topSignals.forEach((n, i) => { n.topRank = i + 1; });
  console.log(`[graph] top signals: ${topSignals.map(s => `#${s.topRank} ${s.points}pts`).join(', ')}`);

  const html = renderHTML({ nodes, links, sourceLegend, topicLegend, dateRange, fileCount: allFiles.length, sampledDays, calendarDays, missingDates, topSignals });
  await writeFile(OUT, html, 'utf8');
  console.log(`[graph] wrote ${OUT} (${html.length} bytes)`);
}

function renderHTML({ nodes, links, sourceLegend, topicLegend, dateRange, fileCount, sampledDays, calendarDays, missingDates, topSignals }) {
  const data = JSON.stringify({ nodes, links, topSignals: topSignals.map(s => ({ id: s.id, title: s.title, points: s.points, topRank: s.topRank })) }).replace(/</g, '\\u003c');
  const sourceLegendHtml = sourceLegend.map(l =>
    `<span class="lg"><span class="dot" style="background:${l.color}"></span>${l.name} <em>${l.count}</em></span>`
  ).join('');
  const topicLegendHtml = topicLegend.map(l =>
    `<span class="lg"><span class="ring" style="border-color:${l.color}"></span>${l.name} <em>${l.count}</em></span>`
  ).join('');
  // Coverage row: distinguish "nothing happened" from "didn't sample". Color
  // matches HN source dot (#ff8800) — this is a known absence, not an error.
  const MAX_GAPS_INLINE = 8;
  const gapsTrunc = missingDates.length > MAX_GAPS_INLINE
    ? missingDates.slice(0, MAX_GAPS_INLINE).map(d => d.slice(5))
    : missingDates.map(d => d.slice(5));
  const gapsExtra = missingDates.length > MAX_GAPS_INLINE
    ? ` <span style="color:#666">… (+${missingDates.length - MAX_GAPS_INLINE} more)</span>`
    : '';
  // Coverage strings exposed to client so language toggle can re-render them.
  const coverageData = JSON.stringify({ sampledDays, calendarDays, missingDates, gapsTrunc, hasMore: missingDates.length > MAX_GAPS_INLINE, extraCount: Math.max(0, missingDates.length - MAX_GAPS_INLINE) });
  const coverageHtml = missingDates.length === 0
    ? `<span style="color:#7fd4b8">${sampledDays}/${calendarDays} days · complete coverage</span>`
    : `<strong style="color:#e6e6e6">${sampledDays}/${calendarDays}</strong> <span style="color:#888">days · gaps:</span> ${gapsTrunc.map(d => `<code style="color:#ff8800">${d}</code>`).join(' ')}${gapsExtra}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>HN AI Trend — Graph — Kuro</title>
<meta name="description" content="Force-directed graph of AI-related Hacker News posts, clustered by topic. Compiled by Kuro.">
<link rel="canonical" href="https://kuro.page/hn-ai-trend/graph.html">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; height: 100%; }
  body {
    font: 14px/1.5 ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    background: #0b0b0c;
    color: #e6e6e6;
    overflow: hidden;
  }
  header {
    position: fixed; top: 0; left: 0; right: 0;
    padding: 0.9rem 1.2rem;
    background: linear-gradient(180deg, rgba(11,11,12,0.95), rgba(11,11,12,0.7) 70%, transparent);
    z-index: 10;
  }
  header h1 { font-size: 1.05rem; margin: 0; letter-spacing: -0.01em; }
  header h1 small { color: #888; font-weight: 400; }
  header .crumb { font-size: 0.8rem; color: #888; margin-bottom: 0.3rem; }
  header .crumb a { color: #888; text-decoration: none; border-bottom: 1px solid #333; }
  header .crumb a:hover { color: #cfe; }
  header .legend { font-size: 0.75rem; color: #aaa; margin-top: 0.4rem; }
  .lg { display: inline-block; margin-right: 0.9rem; }
  .lg .dot { display: inline-block; width: 0.55rem; height: 0.55rem; border-radius: 50%; margin-right: 0.3rem; vertical-align: middle; }
  .lg .ring { display: inline-block; width: 0.55rem; height: 0.55rem; border-radius: 50%; border: 2px solid #888; background: transparent; margin-right: 0.3rem; vertical-align: middle; box-sizing: border-box; }
  .lg em { color: #666; font-style: normal; margin-left: 0.15rem; }
  header .legend-row { margin-top: 0.3rem; }
  header .legend-row .label { color: #666; margin-right: 0.5rem; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; }

  svg { display: block; width: 100vw; height: 100vh; cursor: grab; }
  svg:active { cursor: grabbing; }

  .link { stroke: #333; stroke-opacity: 0.5; }
  .link.dim { stroke-opacity: 0.05; }
  .link.hi  { stroke: #7fd4b8; stroke-opacity: 0.85; }

  .node circle { stroke-width: 2.5; cursor: pointer; transition: stroke-width 0.15s, filter 0.15s; }
  .node circle:hover { stroke-width: 4; filter: brightness(1.2); }
  .node.dim circle { opacity: 0.18; }
  .node text {
    font: 10px ui-monospace, "SF Mono", Menlo, monospace;
    fill: #d8d8d8;
    pointer-events: none;
    text-shadow: 0 0 3px #0b0b0c, 0 0 3px #0b0b0c, 0 0 6px #0b0b0c;
  }
  .node.dim text { opacity: 0.2; }

  #panel {
    position: fixed; right: 1rem; bottom: 1rem;
    width: 360px; max-height: 50vh; overflow: auto;
    background: #121215; border: 1px solid #2a2a2d;
    padding: 0.9rem 1rem; border-radius: 6px;
    font-size: 0.82rem; line-height: 1.55;
    z-index: 5; display: none;
    box-shadow: 0 4px 24px rgba(0,0,0,0.4);
  }
  #panel.show { display: block; }
  #panel .ttl { font-weight: 600; font-size: 0.95rem; color: #e6e6e6; display: block; margin-bottom: 0.3rem; }
  #panel .ttl a { color: #9ab8ff; text-decoration: none; border-bottom: 1px solid #334; }
  #panel .meta { color: #888; font-size: 0.75rem; margin-bottom: 0.6rem; }
  #panel .meta .pts { color: #7fd4b8; }
  #panel .meta .sep { color: #444; margin: 0 0.3rem; }
  #panel .label { color: #7fd4b8; font-weight: 600; margin-right: 0.3rem; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.08em; }
  #panel .row { margin: 0.4rem 0; color: #c8c8c8; }
  #panel .tags { margin-top: 0.6rem; }
  #panel .tag {
    display: inline-block;
    padding: 0.05rem 0.45rem;
    border: 1px solid #333;
    border-radius: 10px;
    color: #aaa;
    font-size: 0.7rem;
    margin-right: 0.3rem;
  }
  #panel .close {
    position: absolute; top: 0.4rem; right: 0.6rem;
    color: #555; cursor: pointer; font-size: 1.2rem;
    background: none; border: none; padding: 0;
  }
  #panel .close:hover { color: #fff; }

  footer {
    position: fixed; left: 1rem; bottom: 0.7rem;
    font-size: 0.7rem; color: #555; z-index: 5;
  }
  footer a { color: #777; text-decoration: none; border-bottom: 1px solid #333; }

  /* Top-signal halo: top 1-3 get a glowing pulse so the eye locks on instantly. */
  @keyframes haloPulse {
    0%, 100% { filter: drop-shadow(0 0 4px currentColor); }
    50%      { filter: drop-shadow(0 0 12px currentColor) drop-shadow(0 0 4px currentColor); }
  }
  .node.top circle { stroke-width: 3.5; }
  .node.top-1 circle { animation: haloPulse 2.4s ease-in-out infinite; stroke-width: 4; }
  .node.top-2 circle, .node.top-3 circle { animation: haloPulse 3s ease-in-out infinite; }
  .node.top text { font-weight: 600; fill: #fff; font-size: 11px; }
  .node.top text.rank {
    font-size: 11px; fill: #ffd866; font-weight: 700;
  }

  /* Lang toggle button — top-right corner. */
  #lang-btn {
    position: fixed; top: 0.9rem; right: 1rem;
    background: #1a1a1d; color: #cfe; border: 1px solid #2a2a2d;
    padding: 0.3rem 0.7rem; border-radius: 4px;
    font: 0.75rem ui-monospace, "SF Mono", Menlo, monospace;
    cursor: pointer; z-index: 20;
    transition: background 0.15s, border-color 0.15s;
  }
  #lang-btn:hover { background: #22222a; border-color: #7fd4b8; }

  /* Top-signals panel — top-right under header, ranked list. */
  #top-signals {
    position: fixed; top: 7.6rem; right: 1rem;
    width: 280px; max-height: 40vh; overflow: auto;
    background: rgba(18, 18, 21, 0.92); border: 1px solid #2a2a2d;
    padding: 0.7rem 0.85rem; border-radius: 6px;
    font-size: 0.75rem; z-index: 8;
    box-shadow: 0 4px 16px rgba(0,0,0,0.35);
    backdrop-filter: blur(4px);
  }
  #top-signals h2 {
    margin: 0 0 0.5rem 0; font-size: 0.7rem; font-weight: 600;
    color: #ffd866; text-transform: uppercase; letter-spacing: 0.1em;
  }
  #top-signals ol { margin: 0; padding: 0; list-style: none; }
  #top-signals li {
    padding: 0.35rem 0; border-bottom: 1px solid #1f1f23;
    cursor: pointer; transition: background 0.12s;
    display: flex; gap: 0.4rem; align-items: baseline;
  }
  #top-signals li:hover { background: #1a1a1d; }
  #top-signals li:last-child { border-bottom: none; }
  #top-signals .rank {
    color: #ffd866; font-weight: 700; min-width: 1.4rem; text-align: center;
  }
  #top-signals .pts {
    color: #7fd4b8; font-weight: 600; font-size: 0.7rem;
    min-width: 2.8rem; text-align: right;
  }
  #top-signals .ttl { color: #d8d8d8; flex: 1; line-height: 1.35; }
  #top-signals li:hover .ttl { color: #fff; }
  @media (max-width: 720px) {
    #top-signals { width: calc(100vw - 2rem); top: auto; bottom: 4.5rem; max-height: 30vh; }
    #panel { width: calc(100vw - 2rem); right: 1rem; left: 1rem; max-height: 35vh; }
  }
</style>
</head>
<body>

<button id="lang-btn" type="button" title="Toggle language">中文</button>

<header>
  <div class="crumb"><a href="/">&larr; kuro.page</a> &nbsp;/&nbsp; <a href="./">hn-ai-trend</a></div>
  <h1><span data-i18n="title">AI Trend</span> <small>／ <span data-i18n="subtitle">multi-source graph</span> (${dateRange}, ${fileCount} <span data-i18n="editions">editions</span>)</small></h1>
  <div class="legend legend-row"><span class="label" data-i18n="source">source</span>${sourceLegendHtml}</div>
  <div class="legend legend-row"><span class="label" data-i18n="topic">topic</span>${topicLegendHtml}</div>
  <div class="legend legend-row"><span class="label" data-i18n="coverage">coverage</span><span id="coverage-body">${coverageHtml}</span></div>
</header>

<aside id="top-signals">
  <h2 data-i18n="topSignal">Top Signals</h2>
  <ol id="top-list"></ol>
</aside>

<svg id="g"></svg>

<div id="panel">
  <button class="close" onclick="document.getElementById('panel').classList.remove('show')">×</button>
  <span class="ttl"><a id="p-title" href="" target="_blank"></a></span>
  <div class="meta">
    <span class="pts" id="p-pts"></span><span class="sep">·</span>
    <span id="p-author"></span><span class="sep">·</span>
    <span id="p-date"></span><span class="sep">·</span>
    <a id="p-hub" href="" target="_blank" style="color:#888;border-bottom:1px solid #333">thread</a>
    <span class="sep">·</span>
    <span id="p-source" style="color:#7fd4b8"></span>
  </div>
  <div class="row"><span class="label" data-i18n="claim">claim</span><span id="p-claim"></span></div>
  <div class="row"><span class="label" data-i18n="novelty">novelty</span><span id="p-novelty"></span></div>
  <div class="row"><span class="label" data-i18n="soWhat">so what</span><span id="p-so"></span></div>
  <div class="tags" id="p-tags"></div>
</div>

<footer>
  <span data-i18n="compiledBy">Compiled by</span> <a href="/">Kuro</a>. <span data-i18n="sourceData">Source data:</span> <a href="https://github.com/miles990/mini-agent/blob/main/scripts/hn-ai-trend-graph.mjs">hn-ai-trend-graph.mjs</a>.
  <span data-i18n="instructions">Drag nodes · click for detail · scroll to zoom.</span>
</footer>

<script src="https://d3js.org/d3.v7.min.js"></script>
<script>
const DATA = ${data};
const COVERAGE = ${coverageData};

// ─── i18n ────────────────────────────────────────────────────────────────
const I18N = {
  en: {
    title: 'AI Trend', subtitle: 'multi-source graph', editions: 'editions',
    source: 'source', topic: 'topic', coverage: 'coverage',
    days: 'days', gaps: 'gaps:', complete: 'complete coverage',
    topSignal: 'Top Signals', pts: 'pts', by: 'by', thread: 'thread',
    claim: 'claim', novelty: 'novelty', soWhat: 'so what',
    instructions: 'Drag nodes · click for detail · scroll to zoom.',
    compiledBy: 'Compiled by', sourceData: 'Source data:',
    moreGaps: n => '… (+' + n + ' more)', toggleLabel: '中文',
  },
  zh: {
    title: 'AI 趨勢', subtitle: '多源圖譜', editions: '次發佈',
    source: '來源', topic: '主題', coverage: '覆蓋',
    days: '天', gaps: '空缺：', complete: '完整覆蓋',
    topSignal: '最強信號', pts: '分', by: '作者', thread: '討論串',
    claim: '主張', novelty: '新意', soWhat: '影響',
    instructions: '拖曳節點 · 點擊看詳情 · 滾動縮放。',
    compiledBy: '編製：', sourceData: '原始資料：',
    moreGaps: n => '… （另 ' + n + ' 天）', toggleLabel: 'EN',
  }
};
let LANG = (localStorage.getItem('ai-trend-lang') === 'zh') ? 'zh' : 'en';

function renderCoverage() {
  const t = I18N[LANG];
  const el = document.getElementById('coverage-body');
  if (!el) return;
  if (COVERAGE.missingDates.length === 0) {
    el.innerHTML = '<span style="color:#7fd4b8">' + COVERAGE.sampledDays + '/' + COVERAGE.calendarDays + ' ' + t.days + ' · ' + t.complete + '</span>';
  } else {
    const gaps = COVERAGE.gapsTrunc.map(d => '<code style="color:#ff8800">' + d + '</code>').join(' ');
    const extra = COVERAGE.hasMore ? ' <span style="color:#666">' + t.moreGaps(COVERAGE.extraCount) + '</span>' : '';
    el.innerHTML = '<strong style="color:#e6e6e6">' + COVERAGE.sampledDays + '/' + COVERAGE.calendarDays + '</strong> <span style="color:#888">' + t.days + ' · ' + t.gaps + '</span> ' + gaps + extra;
  }
}

function renderTopSignals() {
  const t = I18N[LANG];
  const ol = document.getElementById('top-list');
  if (!ol) return;
  ol.innerHTML = DATA.topSignals.map(s =>
    '<li data-id="' + s.id + '">' +
      '<span class="rank">#' + s.topRank + '</span>' +
      '<span class="ttl">' + (s.title.length > 60 ? s.title.slice(0, 58) + '…' : s.title) + '</span>' +
      '<span class="pts">' + s.points + ' ' + t.pts + '</span>' +
    '</li>'
  ).join('');
  ol.querySelectorAll('li').forEach(li => {
    li.addEventListener('click', () => focusNode(li.dataset.id));
  });
}

function applyLang(lang) {
  LANG = lang;
  document.documentElement.lang = (lang === 'zh') ? 'zh-Hant' : 'en';
  const t = I18N[lang];
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (t[key]) el.textContent = t[key];
  });
  document.getElementById('lang-btn').textContent = t.toggleLabel;
  renderCoverage();
  renderTopSignals();
  localStorage.setItem('ai-trend-lang', lang);
}

document.getElementById('lang-btn').addEventListener('click', () => {
  applyLang(LANG === 'zh' ? 'en' : 'zh');
});

// ─── Graph ───────────────────────────────────────────────────────────────
const W = window.innerWidth, H = window.innerHeight;
const svg = d3.select('#g').attr('viewBox', [0, 0, W, H]);
const root = svg.append('g');

svg.call(d3.zoom().scaleExtent([0.3, 4]).on('zoom', e => root.attr('transform', e.transform)));

const radius = d => 4 + Math.sqrt(d.points || 1) * 1.2;

const sim = d3.forceSimulation(DATA.nodes)
  .force('link', d3.forceLink(DATA.links).id(d => d.id).distance(d => 80 / (d.weight || 1)).strength(0.3))
  .force('charge', d3.forceManyBody().strength(-180))
  .force('center', d3.forceCenter(W/2, H/2))
  .force('collide', d3.forceCollide().radius(d => radius(d) + 4));

const link = root.append('g').attr('class', 'links').selectAll('line')
  .data(DATA.links).join('line')
  .attr('class', 'link')
  .attr('stroke-width', d => Math.min(d.weight, 4));

const node = root.append('g').attr('class', 'nodes').selectAll('g')
  .data(DATA.nodes).join('g')
  .attr('class', d => d.topRank ? ('node top top-' + d.topRank) : 'node')
  .attr('data-id', d => d.id)
  .call(d3.drag()
    .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
    .on('drag',  (e, d) => { d.fx = e.x; d.fy = e.y; })
    .on('end',   (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));

node.append('circle')
  .attr('r', d => d.topRank ? radius(d) + 2 : radius(d))
  .attr('fill', d => d.sourceColor)   // source = primary visual identity
  .attr('stroke', d => d.color);      // topic = ring color
node.append('text')
  .attr('dy', d => -radius(d) - 3)
  .attr('text-anchor', 'middle')
  .text(d => {
    const max = d.topRank ? 44 : 36;
    const prefix = d.topRank ? ('#' + d.topRank + ' ') : '';
    const t = d.title.length > max ? d.title.slice(0, max - 2) + '…' : d.title;
    return prefix + t;
  });

// Focus a node by id (called from top-signals panel click).
function focusNode(id) {
  const target = DATA.nodes.find(n => n.id === id || n.id === Number(id));
  if (!target) return;
  // Trigger same selection behavior as click on the node.
  const evt = new Event('click', { bubbles: true });
  const el = document.querySelector('g.node[data-id="' + id + '"] circle');
  if (el) el.dispatchEvent(evt);
  // Pan to node by adjusting zoom transform.
  if (target.x != null && target.y != null) {
    const k = 1.5;
    const tx = W / 2 - target.x * k;
    const ty = H / 2 - target.y * k;
    svg.transition().duration(600).call(
      d3.zoom().on('zoom', e => root.attr('transform', e.transform)).transform,
      d3.zoomIdentity.translate(tx, ty).scale(k)
    );
  }
}

node.on('click', (e, d) => {
  e.stopPropagation();
  const adj = new Set([d.id]);
  DATA.links.forEach(l => {
    const s = l.source.id || l.source, t = l.target.id || l.target;
    if (s === d.id) adj.add(t);
    if (t === d.id) adj.add(s);
  });
  node.classed('dim', n => !adj.has(n.id));
  link.classed('dim', l => {
    const s = l.source.id || l.source, t = l.target.id || l.target;
    return !(s === d.id || t === d.id);
  });
  link.classed('hi', l => {
    const s = l.source.id || l.source, t = l.target.id || l.target;
    return s === d.id || t === d.id;
  });

  document.getElementById('p-title').textContent = d.title;
  document.getElementById('p-title').href = d.url;
  document.getElementById('p-pts').textContent = d.points + ' pts';
  document.getElementById('p-author').textContent = 'by ' + d.author;
  document.getElementById('p-date').textContent = d.date;
  document.getElementById('p-hub').href = d.hub;
  document.getElementById('p-source').textContent = d.subreddit ? (d.sourceLabel + ' · r/' + d.subreddit) : d.sourceLabel;
  document.getElementById('p-claim').textContent = d.claim || '—';
  document.getElementById('p-novelty').textContent = d.novelty || '—';
  document.getElementById('p-so').textContent = d.so_what || '—';
  document.getElementById('p-tags').innerHTML = d.tags.map(t => '<span class="tag">' + t + '</span>').join('');
  document.getElementById('panel').classList.add('show');
});

svg.on('click', () => {
  node.classed('dim', false);
  link.classed('dim', false).classed('hi', false);
});

sim.on('tick', () => {
  link
    .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
    .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
  node.attr('transform', d => 'translate(' + d.x + ',' + d.y + ')');
});

window.addEventListener('resize', () => {
  const w = window.innerWidth, h = window.innerHeight;
  svg.attr('viewBox', [0, 0, w, h]);
  sim.force('center', d3.forceCenter(w/2, h/2)).alpha(0.3).restart();
});

// Initialize language on load (applies translations + renders top-signals panel).
applyLang(LANG);
</script>

</body>
</html>
`;
}

main().catch(e => { console.error(e); process.exit(1); });
