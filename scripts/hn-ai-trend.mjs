#!/usr/bin/env node
/**
 * HN AI Trend — baseline fetcher
 *
 * Pulls HN top stories via Firebase API, filters for AI/LLM/agent topics,
 * writes baseline JSON to memory/state/hn-ai-trend/YYYY-MM-DD.json with
 * summary.novelty="pending-llm-pass" so enrichers
 * (hn-ai-trend-enrich.mjs / -enrich-remote.mjs) can fill in via LLM.
 *
 * Cron: 30 1 * * *
 *
 * Usage:
 *   node scripts/hn-ai-trend.mjs                       # fetch today (defaults)
 *   node scripts/hn-ai-trend.mjs --since=24h --minScore=15 --max=30
 *   node scripts/hn-ai-trend.mjs --out=/tmp/test.json  # custom output path
 *
 * Schema mirrors prior pipeline output (verified against 2026-04-25.json):
 *   { run_at, config:{kg,since,minScore,outFile}, count, posts:[{
 *       id, title, url, author, points, comments, created_at,
 *       story_text, summary:{claim,evidence,novelty,so_what}, status
 *   }] }
 *
 * Why no Anthropic key required: this script is baseline-only. The original
 * (deleted) version did inline enrichment; we now defer enrichment to the
 * sibling enrich scripts so cron can run without ANTHROPIC_API_KEY in env.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const a = args.find(x => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : def;
};

const since = getArg('since', '24h');
const minScore = parseInt(getArg('minScore', '15'), 10);
const max = parseInt(getArg('max', '30'), 10);
const outFlag = getArg('out', null);
const dryRun = args.includes('--dry-run');

const sinceHours = parseInt(since, 10) || 24;
const now = Date.now();
const sinceMs = now - sinceHours * 3600 * 1000;

// AI/LLM/agent keyword filter. Case-insensitive, mostly word-bounded.
// Tuned against 2026-04-21..25 retained posts (DeepSeek / GPT-5.5 / Claude /
// Karpathy LLM wiki / open-source memory layer / etc.).
const AI_PATTERNS = [
  /\bAI\b/i, /\bA\.I\.\b/i,
  /\bLLM(s)?\b/i, /\bGPT(-?\d+(\.\d+)?)?\b/i, /\bChatGPT\b/i,
  /\bClaude\b/i, /\bAnthropic\b/i, /\bOpenAI\b/i, /\bGemini\b/i,
  /\bDeepSeek\b/i, /\bQwen\b/i, /\bLlama\b/i, /\bMistral\b/i, /\bGrok\b/i,
  /\bagent(s|ic)?\b/i, /\bRAG\b/i, /\bMCP\b/i,
  /\b(transformer|diffusion|inference|fine[- ]?tun(e|ing)|prompt|embedding)\b/i,
  /\bneural\b/i, /\bgenerative AI\b/i, /\bGenAI\b/i,
  /\b(machine learning|deep learning)\b/i,
  /\bcopilot\b/i, /\bcursor\b/i, /\bperplexity\b/i, /\bkarpathy\b/i,
  /\bopen[- ]?source.{0,30}(model|memory|agent)\b/i,
];

function isAITopic(item) {
  const text = `${item.title || ''} ${item.url || ''}`;
  return AI_PATTERNS.some(p => p.test(text));
}

async function fetchJSON(url, attempt = 1) {
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    if (attempt < 3) {
      await new Promise(res => setTimeout(res, 500 * attempt));
      return fetchJSON(url, attempt + 1);
    }
    throw new Error(`${e.message} (${url})`);
  }
}

const HN_BASE = 'https://hacker-news.firebaseio.com/v0';

async function main() {
  console.error(`[hn-ai-trend] fetch topstories (since=${sinceHours}h minScore=${minScore} max=${max})`);
  const ids = await fetchJSON(`${HN_BASE}/topstories.json`);
  console.error(`[hn-ai-trend] got ${ids.length} top story ids`);

  const posts = [];
  const SCAN_LIMIT = 200; // top ~200 covers most >15-pt stories
  let scanned = 0;
  let aiHits = 0;

  for (let i = 0; i < Math.min(ids.length, SCAN_LIMIT); i++) {
    const id = ids[i];
    let item;
    try {
      item = await fetchJSON(`${HN_BASE}/item/${id}.json`);
    } catch (e) {
      console.error(`[hn-ai-trend] skip ${id}: ${e.message}`);
      continue;
    }
    scanned++;
    if (!item || item.deleted || item.dead) continue;
    if (item.type !== 'story') continue;
    if ((item.score || 0) < minScore) continue;
    const itemTimeMs = (item.time || 0) * 1000;
    if (itemTimeMs < sinceMs) continue;
    if (!isAITopic(item)) continue;
    aiHits++;

    posts.push({
      id: String(item.id),
      title: item.title || '',
      url: item.url || `https://news.ycombinator.com/item?id=${item.id}`,
      author: item.by || '',
      points: item.score || 0,
      comments: item.descendants || 0,
      created_at: new Date(itemTimeMs).toISOString(),
      story_text: item.text || null,
      summary: {
        claim: 'pending-llm-pass',
        evidence: 'pending-llm-pass',
        novelty: 'pending-llm-pass',
        so_what: 'pending-llm-pass',
      },
      status: 'baseline',
    });

    if (posts.length >= max) break;
  }

  posts.sort((a, b) => b.points - a.points);

  const date = new Date().toISOString().slice(0, 10);
  const outDir = join(REPO_ROOT, 'memory', 'state', 'hn-ai-trend');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outFile = outFlag || join(outDir, `${date}.json`);

  const doc = {
    run_at: new Date().toISOString(),
    config: { kg: false, since, minScore, outFile: outFlag },
    count: posts.length,
    posts,
  };

  if (dryRun) {
    console.error(`[hn-ai-trend] DRY RUN — would write ${posts.length} posts (scanned=${scanned} aiHits=${aiHits}) → ${outFile}`);
    console.log(JSON.stringify(doc, null, 2));
    return;
  }

  writeFileSync(outFile, JSON.stringify(doc, null, 2));
  console.error(`[hn-ai-trend] wrote ${posts.length} posts (scanned=${scanned} aiHits=${aiHits}) → ${outFile}`);
}

main().catch(e => {
  console.error(`[hn-ai-trend] FATAL: ${e.message}`);
  process.exit(1);
});
