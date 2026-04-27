#!/usr/bin/env node
/**
 * Reddit AI Trend — baseline fetcher
 *
 * Pulls top posts from AI-relevant subreddits via Reddit public JSON API,
 * filters by score, writes baseline JSON to memory/state/reddit-trend/YYYY-MM-DD.json
 * with summary.novelty="pending-llm-pass" so a future enricher can fill in.
 *
 * Cron: TBD — register after first manual verification
 *
 * Usage:
 *   node scripts/reddit-ai-trend.mjs                      # default (top/day, score>=50)
 *   node scripts/reddit-ai-trend.mjs --subs=MachineLearning,LocalLLaMA
 *   node scripts/reddit-ai-trend.mjs --window=day --minScore=100 --max=30
 *   node scripts/reddit-ai-trend.mjs --out=/tmp/test.json --dry-run
 *
 * Schema mirrors hn-ai-trend.mjs (verified 2026-04-25):
 *   { run_at, config, count, posts:[{
 *       id, title, url, author, points, comments, created_at,
 *       story_text, summary:{claim,evidence,novelty,so_what},
 *       status, source, subreddit
 *   }] }
 *
 * Why custom UA: Reddit returns 429/403 on the default Node fetch UA.
 * A descriptive UA per Reddit API etiquette gets ~all requests through.
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

const subsArg = getArg('subs', 'MachineLearning,LocalLLaMA,singularity');
const subs = subsArg.split(',').map(s => s.trim()).filter(Boolean);
const window_ = getArg('window', 'day'); // hour|day|week|month|year|all
const minScore = parseInt(getArg('minScore', '50'), 10);
const maxPerSub = parseInt(getArg('maxPerSub', '25'), 10);
const max = parseInt(getArg('max', '60'), 10);
const outFlag = getArg('out', null);
const dryRun = args.includes('--dry-run');

// Reddit etiquette: identify yourself. This is a personal agent's reader,
// not impersonating a real app. Linked to its repo for accountability.
const USER_AGENT = 'mini-agent-trend-reader/0.1 (+https://github.com/kuro-agent/mini-agent)';

async function fetchJSON(url, attempt = 1) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    if (attempt < 3) {
      await new Promise(res => setTimeout(res, 800 * attempt));
      return fetchJSON(url, attempt + 1);
    }
    throw new Error(`${e.message} (${url})`);
  }
}

async function fetchSub(sub) {
  const url = `https://www.reddit.com/r/${sub}/top.json?t=${encodeURIComponent(window_)}&limit=${maxPerSub}`;
  console.error(`[reddit-ai-trend] fetch r/${sub} (top/${window_} limit=${maxPerSub})`);
  const j = await fetchJSON(url);
  const children = (j && j.data && Array.isArray(j.data.children)) ? j.data.children : [];
  const posts = [];
  for (const c of children) {
    const d = c && c.data;
    if (!d) continue;
    if (d.stickied) continue;
    if ((d.score || 0) < minScore) continue;
    const createdMs = (d.created_utc || 0) * 1000;
    const isSelf = !!d.is_self;
    const permalink = d.permalink ? `https://www.reddit.com${d.permalink}` : '';
    posts.push({
      id: d.id ? `reddit_${d.id}` : `reddit_${Math.random().toString(36).slice(2, 10)}`,
      title: d.title || '',
      url: isSelf ? permalink : (d.url_overridden_by_dest || d.url || permalink),
      author: d.author || '',
      points: d.score || 0,
      comments: d.num_comments || 0,
      created_at: new Date(createdMs).toISOString(),
      story_text: isSelf ? (d.selftext || null) : null,
      summary: {
        claim: 'pending-llm-pass',
        evidence: 'pending-llm-pass',
        novelty: 'pending-llm-pass',
        so_what: 'pending-llm-pass',
      },
      status: 'baseline',
      source: 'reddit',
      subreddit: sub,
    });
  }
  return posts;
}

async function main() {
  console.error(`[reddit-ai-trend] subs=[${subs.join(',')}] window=${window_} minScore=${minScore} maxPerSub=${maxPerSub} max=${max}`);
  const all = [];
  for (const sub of subs) {
    try {
      const posts = await fetchSub(sub);
      console.error(`[reddit-ai-trend] r/${sub}: ${posts.length} posts after filter`);
      all.push(...posts);
    } catch (e) {
      console.error(`[reddit-ai-trend] r/${sub} failed: ${e.message}`);
    }
    // gentle pacing between subs
    await new Promise(res => setTimeout(res, 500));
  }

  // Dedup by id (cross-sub crossposts), then sort by points desc, then cap to max.
  const seen = new Set();
  const dedup = [];
  for (const p of all) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    dedup.push(p);
  }
  dedup.sort((a, b) => b.points - a.points);
  const final = dedup.slice(0, max);

  const date = new Date().toISOString().slice(0, 10);
  const outDir = join(REPO_ROOT, 'memory', 'state', 'reddit-trend');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outFile = outFlag || join(outDir, `${date}.json`);

  const doc = {
    run_at: new Date().toISOString(),
    config: { subs, window: window_, minScore, maxPerSub, max, outFile: outFlag },
    count: final.length,
    posts: final,
  };

  if (dryRun) {
    console.error(`[reddit-ai-trend] DRY RUN — would write ${final.length} posts (raw=${all.length} dedup=${dedup.length}) → ${outFile}`);
    console.log(JSON.stringify(doc, null, 2));
    return;
  }

  writeFileSync(outFile, JSON.stringify(doc, null, 2));
  console.error(`[reddit-ai-trend] wrote ${final.length} posts (raw=${all.length} dedup=${dedup.length}) → ${outFile}`);
}

main().catch(e => {
  console.error(`[reddit-ai-trend] FATAL: ${e.message}`);
  process.exit(1);
});
