#!/usr/bin/env node
/**
 * GitHub AI Trend — baseline fetcher (6th source)
 *
 * Pulls AI-relevant trending repos via GitHub Search API, filters by topic /
 * description regex, writes baseline JSON to memory/state/github-trend/YYYY-MM-DD.json
 * with summary.novelty="pending-llm-pass" so the shared enricher can fill in.
 *
 * Cron: TBD — register after first manual smoke test
 *
 * Usage:
 *   node scripts/github-ai-trend.mjs                                  # default (7 topics, since=7d, minStars=10)
 *   node scripts/github-ai-trend.mjs --topics=llm,agent --since=14d
 *   node scripts/github-ai-trend.mjs --minStars=50 --max=40
 *   node scripts/github-ai-trend.mjs --out=/tmp/test.json --dry-run
 *
 * Schema mirrors reddit-ai-trend.mjs (see memory/topics/2026-04-28-github-6th-source-feasibility.md §4):
 *   { run_at, config, count, posts:[{
 *       id, title, url, author, points, comments, created_at,
 *       story_text, summary:{claim,evidence,novelty,so_what},
 *       status, source:"github",
 *       language, topics, pushed_at
 *   }] }
 *
 * Auth: optional GITHUB_TOKEN env (raises 60/hr → 5000/hr). Without token we use
 * unauth (10 req/min, 60/hr) — enough for daily cron with 7 topic queries.
 *
 * Why per-topic queries instead of one big OR: GitHub Search API caps results at
 * 1000 per query; per-topic gives better coverage and natural per-topic ranking.
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

// AI topic whitelist — repos with any of these GitHub topics qualify.
const DEFAULT_TOPICS = 'llm,agent,rag,transformer,diffusion,mcp,fine-tuning';
const topicsArg = getArg('topics', DEFAULT_TOPICS);
const topics = topicsArg.split(',').map(s => s.trim()).filter(Boolean);

// Time window for "pushed since" — repos with recent activity.
const sinceArg = getArg('since', '7d'); // Nd|Nh format, or YYYY-MM-DD
const minStars = parseInt(getArg('minStars', '10'), 10);
const perTopic = parseInt(getArg('perTopic', '20'), 10);
const max = parseInt(getArg('max', '60'), 10);
const outFlag = getArg('out', null);
const dryRun = args.includes('--dry-run');

const TOKEN = process.env.GITHUB_TOKEN || '';
const USER_AGENT = 'mini-agent-trend-reader/0.1 (+https://github.com/kuro-agent/mini-agent)';

// --- helpers ----------------------------------------------------------------

function parseSince(s) {
  // accepts: "7d", "24h", "2026-04-21"
  const m = /^(\d+)([dh])$/.exec(s);
  if (m) {
    const n = parseInt(m[1], 10);
    const ms = n * (m[2] === 'd' ? 86400_000 : 3_600_000);
    const d = new Date(Date.now() - ms);
    return d.toISOString().slice(0, 10);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  throw new Error(`bad --since=${s} (expected Nd | Nh | YYYY-MM-DD)`);
}

async function fetchJSON(url, attempt = 1) {
  const headers = {
    'User-Agent': USER_AGENT,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;
  try {
    const r = await fetch(url, { headers });
    if (r.status === 403 || r.status === 429) {
      // rate limited; honor Retry-After if present
      const retry = parseInt(r.headers.get('retry-after') || '0', 10) * 1000;
      const wait = retry || (1500 * attempt);
      if (attempt < 3) {
        console.error(`[github-ai-trend] ${r.status} rate-limited, sleep ${wait}ms`);
        await new Promise(res => setTimeout(res, wait));
        return fetchJSON(url, attempt + 1);
      }
    }
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

async function fetchTopic(topic, sinceDate) {
  const q = `topic:${topic} pushed:>=${sinceDate} stars:>=${minStars}`;
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=${perTopic}`;
  console.error(`[github-ai-trend] fetch topic:${topic} (since=${sinceDate} minStars=${minStars} per=${perTopic})`);
  const j = await fetchJSON(url);
  const items = Array.isArray(j && j.items) ? j.items : [];
  const posts = [];
  for (const repo of items) {
    if (!repo || !repo.id) continue;
    if ((repo.stargazers_count || 0) < minStars) continue;
    if (repo.archived) continue;
    if (repo.fork) continue;
    posts.push({
      id: `github_${repo.id}`,
      title: `${repo.full_name}: ${(repo.description || '').trim()}`.slice(0, 280),
      url: repo.html_url,
      author: repo.owner ? repo.owner.login : '',
      points: repo.stargazers_count || 0,
      comments: repo.open_issues_count || 0,
      created_at: repo.created_at || null,
      story_text: repo.description || null,
      summary: {
        claim: 'pending-llm-pass',
        evidence: 'pending-llm-pass',
        novelty: 'pending-llm-pass',
        so_what: 'pending-llm-pass',
      },
      status: 'baseline',
      source: 'github',
      language: repo.language || null,
      topics: Array.isArray(repo.topics) ? repo.topics : [],
      pushed_at: repo.pushed_at || null,
      matched_topic: topic,
    });
  }
  return posts;
}

async function main() {
  const sinceDate = parseSince(sinceArg);
  console.error(`[github-ai-trend] topics=[${topics.join(',')}] since=${sinceDate} minStars=${minStars} perTopic=${perTopic} max=${max} auth=${TOKEN ? 'token' : 'unauth'}`);

  const all = [];
  for (const topic of topics) {
    try {
      const posts = await fetchTopic(topic, sinceDate);
      console.error(`[github-ai-trend] topic:${topic}: ${posts.length} repos after filter`);
      all.push(...posts);
    } catch (e) {
      console.error(`[github-ai-trend] topic:${topic} failed: ${e.message}`);
    }
    // gentle pacing — unauth Search API = 10 req/min
    await new Promise(res => setTimeout(res, TOKEN ? 250 : 1500));
  }

  // Dedup by repo id (same repo may match multiple topics); keep highest-star match.
  const byId = new Map();
  for (const p of all) {
    const prev = byId.get(p.id);
    if (!prev || (p.points > prev.points)) byId.set(p.id, p);
  }
  const dedup = [...byId.values()];
  dedup.sort((a, b) => b.points - a.points);
  const final = dedup.slice(0, max);

  const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
  const outDir = join(REPO_ROOT, 'memory', 'state', 'github-trend');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outFile = outFlag || join(outDir, `${date}.json`);

  const doc = {
    run_at: new Date().toISOString(),
    config: { topics, since: sinceDate, minStars, perTopic, max, outFile: outFlag, auth: !!TOKEN },
    count: final.length,
    posts: final,
  };

  if (dryRun) {
    console.error(`[github-ai-trend] DRY RUN — would write ${final.length} repos (raw=${all.length} dedup=${dedup.length}) → ${outFile}`);
    console.log(JSON.stringify(doc, null, 2));
    return;
  }

  writeFileSync(outFile, JSON.stringify(doc, null, 2));
  console.error(`[github-ai-trend] wrote ${final.length} repos (raw=${all.length} dedup=${dedup.length}) → ${outFile}`);
}

main().catch(e => {
  console.error(`[github-ai-trend] FATAL: ${e.message}`);
  process.exit(1);
});
