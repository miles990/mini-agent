#!/usr/bin/env node
/**
 * HN AI Trend — Anthropic remote enrichment pass (sibling of hn-ai-trend-enrich.mjs)
 *
 * Reads today's baseline JSON from memory/state/hn-ai-trend/YYYY-MM-DD.json,
 * fills in claim/evidence/novelty/so_what via Anthropic Messages API,
 * writes back in place.
 *
 * Why separate from hn-ai-trend-enrich.mjs: that one is pinned to local MLX
 * (OpenAI-compatible /v1/chat/completions schema). This one uses Anthropic
 * schema. Either can run; they produce identical output shape.
 *
 * Usage:
 *   node scripts/hn-ai-trend-enrich-remote.mjs
 *   node scripts/hn-ai-trend-enrich-remote.mjs --date=2026-04-23
 *
 * Env:
 *   ANTHROPIC_API_KEY (required)
 *   HN_REMOTE_MODEL   (default: claude-haiku-4-5-20251001)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

// Load .env if present (standalone script — main loop may not have exported vars)
try {
  const envText = readFileSync(join(REPO_ROOT, '.env'), 'utf8');
  for (const line of envText.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
} catch {}

const args = process.argv.slice(2);
const flagDate = (args.find(a => a.startsWith('--date=')) || '').split('=')[1];
const date = flagDate || new Date().toISOString().slice(0, 10);
const force = args.includes('--force');

const API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.HN_REMOTE_MODEL || 'claude-haiku-4-5-20251001';

if (!API_KEY) {
  console.error('[enrich-remote] ANTHROPIC_API_KEY not set; aborting');
  process.exit(2);
}

const inFile = join(REPO_ROOT, 'memory', 'state', 'hn-ai-trend', `${date}.json`);
let doc;
try {
  doc = JSON.parse(readFileSync(inFile, 'utf8'));
} catch (e) {
  console.error(`[enrich-remote] cannot read ${inFile}: ${e.message}`);
  process.exit(3);
}

const toEnrich = force
  ? doc.posts
  : doc.posts.filter(p => p.summary?.novelty === 'pending-llm-pass');
console.error(`[enrich-remote] ${toEnrich.length}/${doc.posts.length} posts need enrichment (date=${date}, model=${MODEL}, force=${force})`);

const SYSTEM = `You classify HN posts for an AI-trend knowledge graph. Output STRICT JSON only — no prose, no code fences. Keys: claim, evidence, novelty, so_what.

IMPORTANT: Write all values in 繁體中文 (Traditional Chinese). Keep technical terms (model names, APIs, framework names, benchmarks) in original English. Do NOT translate the post title — that stays in original language in the surrounding JSON.

- claim: 1 sentence stating the core assertion in 繁中 (≤80 chars)
- evidence: what backs it in 繁中 — paper link, benchmark, repo, demo, author authority (≤120 chars)
- novelty: what's actually new vs prior art in 繁中. If incremental, say so (≤80 chars)
- so_what: concrete implication for agent builders in 繁中. No platitudes (≤100 chars)`;

async function enrich(post) {
  const userMsg = `title: ${post.title}
url: ${post.url}
points: ${post.points}, comments: ${post.comments}
story_text: ${(post.story_text || '').slice(0, 1200)}`;

  const body = {
    model: MODEL,
    max_tokens: 400,
    temperature: 0.3,
    system: SYSTEM,
    messages: [{ role: 'user', content: userMsg }],
  };

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      console.error(`[enrich-remote] ${post.id} http ${resp.status}: ${errText.slice(0, 200)}`);
      return null;
    }
    const data = await resp.json();
    const raw = data?.content?.[0]?.text || '';
    const cleaned = raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) {
      console.error(`[enrich-remote] ${post.id} no-json: ${cleaned.slice(0, 80)}`);
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
    console.error(`[enrich-remote] ${post.id} fail: ${e.message}`);
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
doc.enrichment = { ok, fail, model: MODEL, via: 'anthropic-remote' };
writeFileSync(inFile, JSON.stringify(doc, null, 2));
console.error(`[enrich-remote] done: ok=${ok} fail=${fail} → ${inFile}`);
