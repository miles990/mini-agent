#!/usr/bin/env node
/**
 * build-landing.mjs
 *
 * Reads daily AI digest JSONs from 5 sources under memory/state/{source}-trend/
 * and produces three period aggregates for the landing page:
 *   data/landing-1d.json   (today only)
 *   data/landing-7d.json   (last 7 days)
 *   data/landing-30d.json  (last 30 days)
 *
 * Each aggregate contains:
 *   - top_topics[]   : chip grid (topic, post_count, sources, sample_titles)
 *   - trend_lines[]  : time series per topic (date, count) using first_seen dedup
 *   - cross_source[] : topic × source matrix (filter source_count >= 2)
 *   - meta           : period metadata
 *
 * Output: kuro-portfolio/ai-trend/data/landing-{1,7,30}d.json
 *
 * Cycle 28 finding internalized: artifacts/ subdir does NOT exist; data lives
 * in memory/state/{source}-trend/YYYY-MM-DD.json. Five sources confirmed for
 * 04-27/28; HN extends back to 04-21.
 */
import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');
const STATE_DIR = join(ROOT, 'memory/state');
const OUT_DIR   = join(ROOT, 'kuro-portfolio/ai-trend/data');

// 5-source registry — same order as graph.mjs SOURCES for legend stability.
const SOURCES = [
  { key: 'hn',     dir: 'hn-ai-trend',        color: '#ff8800', label: 'HN' },
  { key: 'reddit', dir: 'reddit-trend',       color: '#ff4500', label: 'Reddit' },
  { key: 'x',      dir: 'x-trend',            color: '#1da1f2', label: 'X' },
  { key: 'arxiv',  dir: 'arxiv-trend',        color: '#b31b1b', label: 'arXiv' },
  { key: 'latent', dir: 'latent-space-trend', color: '#7c3aed', label: 'Latent Space' },
];

// Topic taxonomy — keyword → canonical topic. Order matters: more specific first.
// Matches graph.mjs taxonomy so chip colors and graph node strokes agree.
const TOPICS = [
  { name: 'memory',    color: '#7fd4b8', kw: /\b(memory|context window|persistent|retrieval|rag|wiki|notebook)\b/i },
  { name: 'agent',     color: '#9ab8ff', kw: /\b(agent|autonomous|tool[- ]use|copilot|claude code|cursor|swarm|orchestrat|mcp)\b/i },
  { name: 'model',     color: '#ffb86b', kw: /\b(gpt[- ]?\d|claude|gemini|llama|mistral|anthropic|openai|deepseek|qwen|grok|sonnet|haiku|opus)\b/i },
  { name: 'training',  color: '#ff79c6', kw: /\b(train(ing)?|fine[- ]?tun|rlhf|distill|pretrain|sft|dpo|grpo|reward model)\b/i },
  { name: 'eval',      color: '#bd93f9', kw: /\b(benchmark|eval(uation)?|leaderboard|swe[- ]bench|mmlu|humaneval|arena)\b/i },
  { name: 'security',  color: '#ff5555', kw: /\b(security|prompt injection|jailbreak|exploit|cve|vuln|attack|sandbox)\b/i },
  { name: 'infra',     color: '#8be9fd', kw: /\b(infra|kubernetes|k8s|docker|deploy|gpu|cuda|inference|vllm|serving|triton)\b/i },
  { name: 'reasoning', color: '#f1fa8c', kw: /\b(reason(ing)?|chain[- ]of[- ]thought|cot|o1|o3|thinking|planning|search)\b/i },
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

function isoDate(d) { return d.toISOString().slice(0, 10); }

function dateNDaysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return isoDate(d);
}

async function loadPeriod(days) {
  const today  = isoDate(new Date());
  const cutoff = dateNDaysAgo(days - 1); // inclusive of `days` days

  const all = [];
  const sourcesActive = new Set();

  for (const src of SOURCES) {
    const dir = join(STATE_DIR, src.dir);
    if (!await dirExists(dir)) continue;
    const files = (await readdir(dir)).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    for (const f of files) {
      const date = f.slice(0, 10);
      if (date < cutoff || date > today) continue;
      let raw;
      try { raw = JSON.parse(await readFile(join(dir, f), 'utf8')); }
      catch (e) { console.warn(`[landing] skip ${src.key}/${f}: ${e.message}`); continue; }
      for (const p of (raw.posts || [])) {
        const t = tagPost(p);
        all.push({
          id: p.id, date, source: src.key,
          title: p.title || '(untitled)',
          url: p.url || '#',
          points: Number(p.points) || 0,
          comments: Number(p.comments) || 0,
          tags: t.tags, primary: t.primary, color: t.color,
        });
        sourcesActive.add(src.key);
      }
    }
  }

  // Dedup by id: keep first_seen date (for trend), max points (for ranking).
  // Track all sources a post appeared in (cross-source signal).
  const byId = new Map();
  for (const p of all) {
    const prev = byId.get(p.id);
    if (!prev) {
      byId.set(p.id, { ...p, first_seen: p.date, sources_seen: new Set([p.source]) });
      continue;
    }
    if (p.date < prev.first_seen) prev.first_seen = p.date;
    if (p.points > prev.points)   prev.points    = p.points;
    prev.sources_seen.add(p.source);
  }
  return { posts: [...byId.values()], sourcesActive: [...sourcesActive] };
}

function buildTopTopics(posts) {
  const byTopic = new Map();
  for (const p of posts) {
    if (!byTopic.has(p.primary)) byTopic.set(p.primary, { topic: p.primary, color: p.color, posts: [], sources: new Set() });
    const e = byTopic.get(p.primary);
    e.posts.push(p);
    for (const s of p.sources_seen) e.sources.add(s);
  }
  return [...byTopic.values()]
    .map(e => {
      const sorted = e.posts.sort((a, b) => b.points - a.points);
      return {
        topic: e.topic,
        color: e.color,
        post_count: e.posts.length,
        sources: [...e.sources],
        sample_titles: sorted.slice(0, 3).map(p => ({
          title: p.title, url: p.url, source: p.source, points: p.points,
        })),
      };
    })
    .filter(e => e.topic !== DEFAULT_TOPIC.name)  // hide "other" chip
    .sort((a, b) => b.post_count - a.post_count);
}

function buildTrendLines(posts, days) {
  // Build date axis (days entries, oldest → newest)
  const today = new Date();
  const dates = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today); d.setUTCDate(d.getUTCDate() - i);
    dates.push(isoDate(d));
  }

  // Per topic per first_seen date count
  const byTopic = new Map();
  for (const p of posts) {
    if (p.primary === DEFAULT_TOPIC.name) continue;
    if (!byTopic.has(p.primary)) byTopic.set(p.primary, { topic: p.primary, color: p.color, byDate: new Map() });
    const e = byTopic.get(p.primary);
    e.byDate.set(p.first_seen, (e.byDate.get(p.first_seen) || 0) + 1);
  }

  return [...byTopic.values()]
    .map(e => {
      const points = dates.map(d => ({ date: d, count: e.byDate.get(d) || 0 }));
      const total = points.reduce((s, p) => s + p.count, 0);
      const todayCount = points[points.length - 1].count;
      const prevAvg    = days > 1 ? (total - todayCount) / (days - 1) : 0;
      const delta      = prevAvg > 0 ? Math.round(((todayCount - prevAvg) / prevAvg) * 100) : null;
      return { topic: e.topic, color: e.color, points, total, delta_pct: delta };
    })
    .sort((a, b) => b.total - a.total);
}

function buildCrossSource(posts) {
  const byTopic = new Map();
  for (const p of posts) {
    if (p.primary === DEFAULT_TOPIC.name) continue;
    if (!byTopic.has(p.primary)) byTopic.set(p.primary, { topic: p.primary, color: p.color, sources: new Map(), samples: new Map() });
    const e = byTopic.get(p.primary);
    for (const s of p.sources_seen) {
      e.sources.set(s, (e.sources.get(s) || 0) + 1);
      if (!e.samples.has(s)) e.samples.set(s, { title: p.title, url: p.url, points: p.points });
    }
  }
  return [...byTopic.values()]
    .filter(e => e.sources.size >= 2)
    .map(e => ({
      topic: e.topic, color: e.color,
      sources: [...e.sources.entries()].map(([source, post_count]) => ({ source, post_count })),
      source_count: e.sources.size,
      post_count:  [...e.sources.values()].reduce((s, n) => s + n, 0),
      sample_per_source: [...e.samples.entries()].map(([source, sample]) => ({ source, ...sample })),
    }))
    .sort((a, b) => b.source_count - a.source_count || b.post_count - a.post_count);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const summary = [];
  for (const days of [1, 7, 30]) {
    const { posts, sourcesActive } = await loadPeriod(days);
    const out = {
      meta: {
        period_days: days,
        end_date:    isoDate(new Date()),
        start_date:  dateNDaysAgo(days - 1),
        sources_active: sourcesActive,
        sources_registry: SOURCES.map(s => ({ key: s.key, label: s.label, color: s.color })),
        total_posts: posts.length,
        generated_at: new Date().toISOString(),
      },
      top_topics:   buildTopTopics(posts),
      trend_lines:  buildTrendLines(posts, days),
      cross_source: buildCrossSource(posts),
    };
    const fp = join(OUT_DIR, `landing-${days}d.json`);
    await writeFile(fp, JSON.stringify(out, null, 2));
    summary.push({ period: `${days}d`, posts: posts.length, topics: out.top_topics.length, cross: out.cross_source.length });
  }
  console.log('[landing] built:', JSON.stringify(summary));
}

main().catch(e => { console.error('[landing] FATAL', e); process.exit(1); });
