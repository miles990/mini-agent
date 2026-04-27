#!/usr/bin/env node
/**
 * hn-ai-trend-graph.mjs
 *
 * Reads all daily HN AI digest JSONs in memory/state/hn-ai-trend/,
 * tags each post by topic via keyword matching, builds a force-directed
 * graph (d3 v7), and writes a self-contained HTML page.
 *
 * Output: kuro-portfolio/hn-ai-trend/graph.html (served at kuro.page/hn-ai-trend/graph.html)
 *
 * Nodes  = posts (size = points, color = primary topic)
 * Edges  = shared topic between two posts (weight = shared count)
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'memory/state/hn-ai-trend');
const OUT = join(ROOT, 'kuro-portfolio/hn-ai-trend/graph.html');

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

async function main() {
  const files = (await readdir(DATA_DIR))
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();

  console.log(`[graph] found ${files.length} daily JSONs:`, files);

  const allPosts = [];
  for (const f of files) {
    const date = f.replace('.json', '');
    const raw = JSON.parse(await readFile(join(DATA_DIR, f), 'utf8'));
    for (const p of (raw.posts || [])) {
      const t = tagPost(p);
      allPosts.push({
        id: p.id,
        date,
        title: p.title,
        url: p.url,
        author: p.author,
        points: p.points,
        comments: p.comments,
        hn: `https://news.ycombinator.com/item?id=${p.id}`,
        claim: p.summary?.claim || '',
        novelty: p.summary?.novelty || '',
        so_what: p.summary?.so_what || '',
        tags: t.tags,
        primary: t.primary,
        color: t.color,
      });
    }
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

  // Topic legend (only topics actually used)
  const usedTopics = new Set(nodes.map(n => n.primary));
  const legend = [...TOPICS, DEFAULT_TOPIC]
    .filter(t => usedTopics.has(t.name))
    .map(t => ({ name: t.name, color: t.color, count: nodes.filter(n => n.primary === t.name).length }));

  const dateRange = `${files[0].replace('.json','')} → ${files[files.length-1].replace('.json','')}`;

  const html = renderHTML({ nodes, links, legend, dateRange, fileCount: files.length });
  await writeFile(OUT, html, 'utf8');
  console.log(`[graph] wrote ${OUT} (${html.length} bytes)`);
}

function renderHTML({ nodes, links, legend, dateRange, fileCount }) {
  const data = JSON.stringify({ nodes, links }).replace(/</g, '\\u003c');
  const legendHtml = legend.map(l =>
    `<span class="lg"><span class="dot" style="background:${l.color}"></span>${l.name} <em>${l.count}</em></span>`
  ).join('');
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
  .lg em { color: #666; font-style: normal; margin-left: 0.15rem; }

  svg { display: block; width: 100vw; height: 100vh; cursor: grab; }
  svg:active { cursor: grabbing; }

  .link { stroke: #333; stroke-opacity: 0.5; }
  .link.dim { stroke-opacity: 0.05; }
  .link.hi  { stroke: #7fd4b8; stroke-opacity: 0.85; }

  .node circle { stroke: #0b0b0c; stroke-width: 1.5; cursor: pointer; transition: stroke-width 0.15s; }
  .node circle:hover { stroke: #fff; stroke-width: 2.5; }
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
</style>
</head>
<body>

<header>
  <div class="crumb"><a href="/">&larr; kuro.page</a> &nbsp;/&nbsp; <a href="./">hn-ai-trend</a></div>
  <h1>HN AI Trend <small>／ graph (${dateRange}, ${fileCount} editions)</small></h1>
  <div class="legend">${legendHtml}</div>
</header>

<svg id="g"></svg>

<div id="panel">
  <button class="close" onclick="document.getElementById('panel').classList.remove('show')">×</button>
  <span class="ttl"><a id="p-title" href="" target="_blank"></a></span>
  <div class="meta">
    <span class="pts" id="p-pts"></span><span class="sep">·</span>
    <span id="p-author"></span><span class="sep">·</span>
    <span id="p-date"></span><span class="sep">·</span>
    <a id="p-hn" href="" target="_blank" style="color:#888;border-bottom:1px solid #333">HN thread</a>
  </div>
  <div class="row"><span class="label">claim</span><span id="p-claim"></span></div>
  <div class="row"><span class="label">novelty</span><span id="p-novelty"></span></div>
  <div class="row"><span class="label">so what</span><span id="p-so"></span></div>
  <div class="tags" id="p-tags"></div>
</div>

<footer>
  Compiled by <a href="/">Kuro</a>. Source data: <a href="https://github.com/miles990/mini-agent/blob/main/scripts/hn-ai-trend-graph.mjs">hn-ai-trend-graph.mjs</a>.
  Drag nodes · click for detail · scroll to zoom.
</footer>

<script src="https://d3js.org/d3.v7.min.js"></script>
<script>
const DATA = ${data};
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
  .data(DATA.nodes).join('g').attr('class', 'node')
  .call(d3.drag()
    .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
    .on('drag',  (e, d) => { d.fx = e.x; d.fy = e.y; })
    .on('end',   (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));

node.append('circle').attr('r', radius).attr('fill', d => d.color);
node.append('text')
  .attr('dy', d => -radius(d) - 3)
  .attr('text-anchor', 'middle')
  .text(d => d.title.length > 36 ? d.title.slice(0, 34) + '…' : d.title);

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
  document.getElementById('p-hn').href = d.hn;
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
</script>

</body>
</html>
`;
}

main().catch(e => { console.error(e); process.exit(1); });
