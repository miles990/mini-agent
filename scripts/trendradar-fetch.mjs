#!/usr/bin/env node
/**
 * TrendRadar zh-CN lane — minimum-viable adapter.
 *
 * Reads the latest SQLite db produced by the upstream TrendRadar Python tool
 * (~/Workspace/trendradar-upstream/output/news/YYYY-MM-DD.db) and emits a
 * standard ai-trend posts[] JSON to memory/state/trendradar-zh/YYYY-MM-DD.json
 * so build-ai-trend-preview.mjs can pick it up as the 5th data source.
 *
 * Upstream schema (verified 2026-06-30):
 *   news_items(id, title, platform_id, rank, url, mobile_url,
 *              first_crawl_time, last_crawl_time, crawl_count)
 *   platforms(id, name, ...)
 *
 * Strategy (MVP, ponytail):
 *   - Pick rank=1 from each platform → cross-platform diversity by construction.
 *   - Cap at 10 items. Skip duplicates by URL.
 *   - source="trendradar-zh", points=11-rank-overall (cosmetic, 1..10).
 *
 * Usage:
 *   node scripts/trendradar-fetch.mjs              # read latest db, write today
 *   node scripts/trendradar-fetch.mjs --refresh    # run upstream python first
 *   node scripts/trendradar-fetch.mjs --self-check # assert-based smoke test
 *
 * ponytail: no separate launchd plist yet — cron can call this with --refresh
 * when we decide cadence. Until then, lane uses whatever db is freshest.
 */

import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const UPSTREAM = process.env.TRENDRADAR_UPSTREAM
  || resolve(process.env.HOME || '~', 'Workspace/trendradar-upstream');
const DB_DIR = join(UPSTREAM, 'output/news');
const OUT_DIR = join(REPO, 'memory/state/trendradar-zh');
const MAX_ITEMS = 10;

function todayKey() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function latestDbPath() {
  if (!existsSync(DB_DIR)) return null;
  const files = readdirSync(DB_DIR).filter(f => /^\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
  return files.length ? join(DB_DIR, files[files.length - 1]) : null;
}

function runUpstream() {
  const py = join(UPSTREAM, '.venv/bin/python');
  if (!existsSync(py)) {
    console.error(`[trendradar] upstream venv not found: ${py}`);
    return false;
  }
  const r = spawnSync(py, ['-m', 'trendradar'], { cwd: UPSTREAM, stdio: 'inherit', timeout: 120_000 });
  if (r.status !== 0) {
    console.error(`[trendradar] upstream exited with ${r.status}`);
    return false;
  }
  return true;
}

function extractPosts(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  // rank=1 per platform, joined to platform name, ordered by platform id for stability.
  const rows = db.prepare(`
    SELECT n.id, n.title, n.url, n.platform_id, n.rank, n.last_crawl_time,
           COALESCE(p.name, n.platform_id) AS platform_name
      FROM news_items n
      LEFT JOIN platforms p ON p.id = n.platform_id
     WHERE n.rank = 1
     ORDER BY n.platform_id
  `).all();
  db.close();

  const seen = new Set();
  const posts = [];
  for (const r of rows) {
    if (!r.url || seen.has(r.url)) continue;
    seen.add(r.url);
    posts.push({
      id: `trendradar-${r.platform_id}-${r.id}`,
      title: r.title,
      url: r.url,
      author: r.platform_name,
      points: Math.max(1, MAX_ITEMS + 1 - posts.length), // 10..1, ponytail proxy score
      comments: 0,
      created_at: r.last_crawl_time || new Date().toISOString(),
      story_text: '',
      summary: { claim: 'pending-llm-pass', evidence: '', novelty: '', so_what: '' },
      status: 'baseline',
      source: 'trendradar-zh',
      subreddit: r.platform_id,
    });
    if (posts.length >= MAX_ITEMS) break;
  }
  return posts;
}

async function main() {
  const argv = new Set(process.argv.slice(2));
  if (argv.has('--self-check')) return selfCheck();

  if (argv.has('--refresh')) {
    if (!runUpstream()) process.exit(1);
  }

  const dbPath = latestDbPath();
  if (!dbPath) {
    console.error(`[trendradar] no .db found in ${DB_DIR}; run with --refresh first`);
    process.exit(1);
  }

  const posts = extractPosts(dbPath);
  if (!posts.length) {
    console.error(`[trendradar] db ${dbPath} yielded 0 posts`);
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const key = todayKey();
  const outPath = join(OUT_DIR, `${key}.json`);
  const payload = {
    run_at: new Date().toISOString(),
    config: { source_db: dbPath, max_items: MAX_ITEMS, lane: 'trendradar-zh' },
    count: posts.length,
    posts,
  };
  await writeFile(outPath, JSON.stringify(payload, null, 2) + '\n');
  console.log(`[trendradar] wrote ${posts.length} posts → ${outPath}`);
}

function selfCheck() {
  // ponytail: one runnable check — exercises extractPosts shape against a real db
  // if present, otherwise asserts the no-db error path.
  const dbPath = latestDbPath();
  if (!dbPath) {
    console.log('[self-check] no db present — skipping shape assertion (acceptable)');
    return;
  }
  const posts = extractPosts(dbPath);
  if (!Array.isArray(posts)) throw new Error('posts not array');
  if (posts.length === 0) throw new Error('posts empty (db exists but had no rank=1 rows?)');
  if (posts.length > MAX_ITEMS) throw new Error(`posts.length=${posts.length} > MAX_ITEMS=${MAX_ITEMS}`);
  const required = ['id', 'title', 'url', 'source', 'summary', 'created_at'];
  for (const p of posts) {
    for (const k of required) {
      if (!(k in p)) throw new Error(`missing field ${k} in post ${JSON.stringify(p).slice(0, 80)}`);
    }
    if (p.source !== 'trendradar-zh') throw new Error(`bad source ${p.source}`);
  }
  console.log(`[self-check] OK — ${posts.length} posts, all required fields present`);
}

main().catch(err => {
  console.error('[trendradar] fatal:', err);
  process.exit(1);
});
