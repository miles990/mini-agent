#!/usr/bin/env node
/**
 * HN AI Trend — Claude CLI enrichment pass
 *
 * Reads today's baseline JSON from memory/state/hn-ai-trend/YYYY-MM-DD.json,
 * fills in claim/evidence/novelty/so_what via Claude CLI (subscription-based),
 * writes back in place.
 *
 * Usage:
 *   node scripts/hn-ai-trend-enrich-remote.mjs
 *   node scripts/hn-ai-trend-enrich-remote.mjs --date=2026-04-23
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
const flagDate = (args.find(a => a.startsWith('--date=')) || '').split('=')[1];
const date = flagDate || new Date().toISOString().slice(0, 10);
const force = args.includes('--force');

const inFile = join(REPO_ROOT, 'memory', 'state', 'hn-ai-trend', `${date}.json`);
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
console.error(`[enrich] ${toEnrich.length}/${doc.posts.length} posts need enrichment (date=${date}, force=${force})`);

if (toEnrich.length === 0) {
  console.error('[enrich] nothing to enrich; exiting');
  process.exit(0);
}

const SYSTEM = `You classify HN posts for an AI-trend knowledge graph. Output STRICT JSON only — no prose, no code fences. Keys: claim, evidence, novelty, so_what.

IMPORTANT: Write all values in 繁體中文 (Traditional Chinese). Keep technical terms (model names, APIs, framework names, benchmarks) in original English. Do NOT translate the post title — that stays in original language in the surrounding JSON.

- claim: 1 sentence stating the core assertion in 繁中 (≤80 chars)
- evidence: what backs it in 繁中 — paper link, benchmark, repo, demo, author authority (≤120 chars)
- novelty: what's actually new vs prior art in 繁中. If incremental, say so (≤80 chars)
- so_what: concrete implication for agent builders in 繁中. No platitudes (≤100 chars)`;

const JSON_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    claim: { type: 'string' },
    evidence: { type: 'string' },
    novelty: { type: 'string' },
    so_what: { type: 'string' },
  },
  required: ['claim', 'evidence', 'novelty', 'so_what'],
});

async function enrich(post) {
  const prompt = `${SYSTEM}\n\ntitle: ${post.title}\nurl: ${post.url}\npoints: ${post.points}, comments: ${post.comments}\nstory_text: ${(post.story_text || '').slice(0, 1200)}`;

  try {
    const raw = execSync(
      `echo ${JSON.stringify(prompt)} | claude -p --model haiku --output-format json --json-schema ${JSON.stringify(JSON_SCHEMA)}`,
      { timeout: 60000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const envelope = JSON.parse(raw);
    const text = envelope?.result ?? raw;
    const match = String(text).match(/\{[\s\S]*\}/);
    if (!match) {
      console.error(`[enrich] ${post.id} no-json: ${String(text).slice(0, 80)}`);
      return null;
    }
    const parsed = JSON.parse(match[0]);
    return {
      claim: parsed.claim || post.title,
      evidence: parsed.evidence || `HN ${post.points}pts/${post.comments}c`,
      novelty: parsed.novelty || 'unspecified',
      so_what: parsed.so_what || 'unspecified',
    };
  } catch (e) {
    console.error(`[enrich] ${post.id} fail: ${e.message?.slice(0, 200)}`);
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
doc.enrichment = { ok, fail, model: 'haiku', via: 'claude-cli' };
writeFileSync(inFile, JSON.stringify(doc, null, 2));
console.error(`[enrich] done: ok=${ok} fail=${fail} → ${inFile}`);
