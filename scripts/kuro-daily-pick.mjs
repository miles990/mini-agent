#!/usr/bin/env node
/**
 * Kuro Daily Pick — non-AI-filtered top picks
 *
 * Aggregates HN top stories + lobste.rs front page, scores by combined
 * signal (points/comment ratio + recency), picks top N regardless of topic.
 * Writes markdown to memory/state/kuro-daily-pick/YYYY-MM-DD.md.
 *
 * Distinct from hn-ai-trend pipeline: that one is AI-only and fed to LLM
 * enrichment. This one is breadth-first across all topics — what an
 * informed reader should know about today, AI or not.
 *
 * Cron: 30 1 * * *  (09:30 Taipei, 30min after hn-ai-trend cron)
 *
 * Usage:
 *   node scripts/kuro-daily-pick.mjs              # today, default 8 picks
 *   node scripts/kuro-daily-pick.mjs --max=10
 *   node scripts/kuro-daily-pick.mjs --dry-run    # log to stdout, don't write
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

const max = parseInt(getArg('max', '8'), 10);
const dryRun = args.includes('--dry-run');

const today = new Date();
const yyyy = today.getFullYear();
const mm = String(today.getMonth() + 1).padStart(2, '0');
const dd = String(today.getDate()).padStart(2, '0');
const dateStr = `${yyyy}-${mm}-${dd}`;

const outDir = join(REPO_ROOT, 'memory/state/kuro-daily-pick');
const outFile = join(outDir, `${dateStr}.md`);

// ---------------------------------------------------------------- fetch utils

async function fetchJSON(url, attempt = 1) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    if (attempt < 3) {
      await new Promise(res => setTimeout(res, 500 * attempt));
      return fetchJSON(url, attempt + 1);
    }
    throw e;
  }
}

async function fetchText(url, attempt = 1) {
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { 'user-agent': 'kuro-daily-pick/1.0 (+https://kuro.page)' },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } catch (e) {
    if (attempt < 3) {
      await new Promise(res => setTimeout(res, 500 * attempt));
      return fetchText(url, attempt + 1);
    }
    throw e;
  }
}

// -------------------------------------------------------------------- sources

async function fetchHN() {
  const ids = await fetchJSON('https://hacker-news.firebaseio.com/v0/topstories.json');
  const top = ids.slice(0, 30);
  const items = await Promise.all(top.map(id =>
    fetchJSON(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)
      .catch(() => null)
  ));
  return items
    .filter(i => i && i.title && !i.deleted && !i.dead)
    .map(i => ({
      source: 'hn',
      id: `hn-${i.id}`,
      title: i.title,
      url: i.url || `https://news.ycombinator.com/item?id=${i.id}`,
      hn_url: `https://news.ycombinator.com/item?id=${i.id}`,
      points: i.score || 0,
      comments: i.descendants || 0,
      author: i.by,
      created_at: new Date((i.time || 0) * 1000).toISOString(),
    }));
}

async function fetchLobsters() {
  // hottest.json is the public API — same shape as the front page
  const items = await fetchJSON('https://lobste.rs/hottest.json').catch(() => []);
  return items.slice(0, 25).map(i => ({
    source: 'lobsters',
    id: `lob-${i.short_id}`,
    title: i.title,
    url: i.url || `https://lobste.rs/s/${i.short_id}`,
    hn_url: `https://lobste.rs/s/${i.short_id}`,
    points: i.score || 0,
    comments: i.comment_count || 0,
    author: i.submitter_user?.username || 'unknown',
    created_at: i.created_at,
    tags: i.tags || [],
  }));
}

// --------------------------------------------------------------------- score

// Score blends points, comment intensity (signal of discussion), and source.
// HN front page baseline ~150-300 points, lobste.rs ~30-80, so we normalize
// per-source before merging — otherwise lobsters never wins.
function scorePost(p, sourceMax) {
  const max = sourceMax[p.source] || 1;
  const pointsNorm = p.points / max;
  // Comment ratio = engagement intensity. Cap at 1.0 (3 comments per point
  // is already very discussion-heavy)
  const commentRatio = p.points > 0
    ? Math.min(1, (p.comments / p.points) / 3)
    : 0;
  return Math.round(100 * (pointsNorm * 0.7 + commentRatio * 0.3));
}

function dedupe(posts) {
  // Two layers: exact URL match, and fuzzy title overlap (>= 5 word tokens
  // shared). Keeps highest-points version.
  const byUrl = new Map();
  for (const p of posts) {
    const key = (p.url || '').replace(/[?#].*$/, '').toLowerCase();
    if (!key) continue;
    const prev = byUrl.get(key);
    if (!prev || p.points > prev.points) byUrl.set(key, p);
  }
  const unique = [...byUrl.values()];

  // Fuzzy pass on remaining titles
  const out = [];
  for (const p of unique) {
    const tokens = new Set(
      p.title.toLowerCase().split(/\W+/).filter(t => t.length >= 4)
    );
    const dup = out.find(o => {
      const ot = new Set(
        o.title.toLowerCase().split(/\W+/).filter(t => t.length >= 4)
      );
      const overlap = [...tokens].filter(t => ot.has(t)).length;
      return overlap >= 5;
    });
    if (dup) {
      if (p.points > dup.points) {
        out.splice(out.indexOf(dup), 1, p);
      }
    } else {
      out.push(p);
    }
  }
  return out;
}

// ---------------------------------------------------------------- markdown

function renderMD(picks, totals) {
  const lines = [];
  lines.push(`# Kuro 每日精選 · ${dateStr}`);
  lines.push('');
  lines.push(`從 HN top 30 + lobste.rs front page 共 ${totals.fetched} 則挑出 **${picks.length}** 則 — 不限主題，看當下值得知道什麼。`);
  lines.push('');
  lines.push('---');
  lines.push('');

  picks.forEach((p, i) => {
    const tagStr = p.tags?.length ? ` · ${p.tags.join(',')}` : '';
    lines.push(`## ${i + 1}. ${p.title}`);
    lines.push('');
    lines.push(`🔗 ${p.url}`);
    lines.push('');
    lines.push(`📊 **${p.source}**: ${p.points}pts / ${p.comments}c · score=${p.score}/100${tagStr}`);
    lines.push('');
    lines.push(`💬 [討論](${p.hn_url})`);
    lines.push('');
    lines.push('---');
    lines.push('');
  });

  lines.push(`_生成於 ${new Date().toISOString()}_`);
  lines.push('');
  return lines.join('\n');
}

// ------------------------------------------------------------------- main

async function main() {
  console.log(`[kuro-daily-pick] start ${dateStr} max=${max} dryRun=${dryRun}`);

  const [hn, lob] = await Promise.all([
    fetchHN().catch(e => {
      console.error('[hn] fetch failed:', e.message);
      return [];
    }),
    fetchLobsters().catch(e => {
      console.error('[lobsters] fetch failed:', e.message);
      return [];
    }),
  ]);

  console.log(`[fetch] hn=${hn.length} lobsters=${lob.length}`);

  if (hn.length === 0 && lob.length === 0) {
    console.error('[fatal] no posts fetched from any source');
    process.exit(1);
  }

  const all = [...hn, ...lob];
  const sourceMax = {
    hn: Math.max(1, ...hn.map(p => p.points)),
    lobsters: Math.max(1, ...lob.map(p => p.points)),
  };

  const scored = all.map(p => ({ ...p, score: scorePost(p, sourceMax) }));
  const unique = dedupe(scored);
  const picks = unique.sort((a, b) => b.score - a.score).slice(0, max);

  const md = renderMD(picks, { fetched: all.length });

  if (dryRun) {
    console.log('--- MARKDOWN OUTPUT ---');
    console.log(md);
    return;
  }

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(outFile, md);
  console.log(`[ok] wrote ${outFile} (${md.length} bytes, ${picks.length} picks)`);
}

main().catch(e => {
  console.error('[fatal]', e);
  process.exit(1);
});
