#!/usr/bin/env node
/**
 * Unified AI Trend — Claude CLI enrichment pass
 *
 * Reads today's baseline JSON from memory/state/<dir>/YYYY-MM-DD.json,
 * fills in claim/evidence/novelty/so_what via Claude CLI (subscription-based),
 * writes back in place.
 *
 * Usage:
 *   node scripts/ai-trend-enrich-remote.mjs --source=hn|github|arxiv|latent
 *   node scripts/ai-trend-enrich-remote.mjs --source=github --date=2026-05-05
 *   node scripts/ai-trend-enrich-remote.mjs --source=github --force
 *
 * Source → state dir map:
 *   hn      → memory/state/hn-ai-trend
 *   github  → memory/state/github-trend
 *   arxiv   → memory/state/arxiv-trend
 *   latent  → memory/state/latent-space-trend
 *
 * Requires `claude` CLI in PATH (uses subscription, no API key needed).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const args = process.argv.slice(2);
const flag = (name) => (args.find(a => a.startsWith(`--${name}=`)) || '').split('=')[1];
const source = flag('source') || 'hn';
const flagDate = flag('date');
const date = flagDate || new Date().toISOString().slice(0, 10);
const force = args.includes('--force');

const SOURCE_MAP = {
  hn:     { dir: 'hn-ai-trend',         kind: 'HN post',                    label: 'Hacker News post' },
  github: { dir: 'github-trend',        kind: 'GitHub repo',                label: 'GitHub repository (title is "owner/repo: description")' },
  arxiv:  { dir: 'arxiv-trend',         kind: 'arxiv paper',                label: 'arxiv research paper' },
  latent: { dir: 'latent-space-trend',  kind: 'latent.space blog post',     label: 'latent.space blog/podcast post' },
};

const cfg = SOURCE_MAP[source];
if (!cfg) {
  console.error(`[enrich] unknown source=${source}; valid: ${Object.keys(SOURCE_MAP).join('|')}`);
  process.exit(2);
}

const inFile = join(REPO_ROOT, 'memory', 'state', cfg.dir, `${date}.json`);
let doc;
try {
  doc = JSON.parse(readFileSync(inFile, 'utf8'));
} catch (e) {
  console.error(`[enrich] cannot read ${inFile}: ${e.message}`);
  process.exit(3);
}

const toEnrich = force
  ? doc.posts
  : doc.posts.filter(p => p.summary?.novelty === 'pending-llm-pass');
console.error(`[enrich] source=${source} ${toEnrich.length}/${doc.posts.length} posts need enrichment (date=${date}, force=${force})`);

if (toEnrich.length === 0) {
  console.error('[enrich] nothing to enrich; exiting');
  process.exit(0);
}

const SYSTEM = `You classify ${cfg.label}s for an AI-trend knowledge graph. Output STRICT JSON only — no prose, no code fences. Keys: claim, evidence, novelty, so_what.

IMPORTANT: Write all values in 繁體中文 (Traditional Chinese). Keep technical terms (model names, APIs, framework names, benchmarks, repo names) in original English. Do NOT translate the post title — that stays in original language in the surrounding JSON.

- claim: 1 sentence stating the core assertion of this ${cfg.kind} in 繁中 (≤80 chars)
- evidence: what backs it in 繁中 — paper link, benchmark, repo stars, demo, author authority (≤120 chars)
- novelty: what's actually new vs prior art in 繁中. If incremental, say so (≤80 chars)
- so_what: concrete implication for agent builders in 繁中. No platitudes (≤100 chars)`;

const JSON_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    claim:    { type: 'string' },
    evidence: { type: 'string' },
    novelty:  { type: 'string' },
    so_what:  { type: 'string' },
  },
  required: ['claim', 'evidence', 'novelty', 'so_what'],
});

async function enrich(post) {
  const extra = post.arxiv_primary_category ? `\narxiv_category: ${post.arxiv_primary_category}` : '';
  const prompt = `${SYSTEM}\n\ntitle: ${post.title}\nurl: ${post.url}\npoints: ${post.points}, comments: ${post.comments}${extra}\nstory_text: ${(post.story_text || '').slice(0, 1200)}`;

  try {
    const raw = execSync(
      `echo ${JSON.stringify(prompt)} | claude -p --model haiku --output-format json --json-schema ${JSON.stringify(JSON_SCHEMA)}`,
      { timeout: 60000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const envelope = JSON.parse(raw);
    const parsed = envelope?.structured_output;
    if (!parsed || !parsed.claim) {
      console.error(`[enrich] ${post.id} no-structured-output: ${raw.slice(0, 100)}`);
      return null;
    }
    return {
      claim:    parsed.claim    || post.title,
      evidence: parsed.evidence || `${cfg.kind} ${post.points}pts/${post.comments}c`,
      novelty:  parsed.novelty  || 'unspecified',
      so_what:  parsed.so_what  || 'unspecified',
    };
  } catch (e) {
    const stderr = (e.stderr?.toString?.() || '').trim();
    const stdout = (e.stdout?.toString?.() || '').trim();
    const detail = stderr || stdout || e.message || String(e);
    console.error(`[enrich] ${post.id} fail status=${e.status ?? '?'} signal=${e.signal ?? '-'}: ${detail.slice(0, 600)}`);
    return null;
  }
}

let ok = 0, fail = 0;
for (const post of toEnrich) {
  const enriched = await enrich(post);
  if (enriched) {
    post.summary = enriched;
    post.status = post.status === 'dry-run' ? 'enriched' : (post.status || 'enriched');
    ok++;
  } else {
    fail++;
  }
}

doc.enriched_at = new Date().toISOString();
doc.enrichment = { ok, fail, model: 'haiku', via: 'claude-cli', source };
writeFileSync(inFile, JSON.stringify(doc, null, 2));
console.error(`[enrich] done: source=${source} ok=${ok} fail=${fail} → ${inFile}`);
