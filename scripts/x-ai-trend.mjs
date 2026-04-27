#!/usr/bin/env node
/**
 * X AI Trend — corpus fetcher
 *
 * Pulls trending X (Twitter) AI posts via Grok API's /v1/responses + x_search tool,
 * parses the structured JSON output, writes corpus to
 * memory/state/x-trend/YYYY-MM-DD.json.
 *
 * Schema mirrors hn-ai-trend / reddit-ai-trend (see hn-ai-trend-graph.mjs loader):
 *   { run_at, config, count, posts:[{
 *       id, title, url, author, points, comments, created_at,
 *       story_text, summary:{claim,evidence,novelty,so_what},
 *       status, source:'x', handle
 *   }] }
 *
 * Why parallel to plugins/x-perception.sh: that script outputs free-form text for
 * heartbeat injection (perception). This script outputs structured JSON for the
 * trend graph (corpus). Different consumer, different shape.
 *
 * Usage:
 *   node scripts/x-ai-trend.mjs                     # default
 *   node scripts/x-ai-trend.mjs --max=10 --query="..."
 *   node scripts/x-ai-trend.mjs --out=/tmp/test.json --dry-run
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

// --- minimal .env loader (no dep) ---
function loadEnvFile() {
  const envPath = join(REPO_ROOT, '.env');
  if (!existsSync(envPath)) return;
  const txt = readFileSync(envPath, 'utf8');
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    if (process.env[m[1]] === undefined) {
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      process.env[m[1]] = v;
    }
  }
}
loadEnvFile();

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const a = args.find(x => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : def;
};

const max = parseInt(getArg('max', '15'), 10);
const query = getArg('query', 'trending AI agent posts in the last 24h: autonomous agents, claude code, coding agents, model releases, evals');
const outFlag = getArg('out', null);
const dryRun = args.includes('--dry-run');
const model = getArg('model', 'grok-4-1-fast');

const XAI_API_KEY = process.env.XAI_API_KEY;
if (!XAI_API_KEY) {
  console.error('[x-ai-trend] XAI_API_KEY not set — exiting non-fatally (renderer will skip x-trend dir)');
  process.exit(0);
}

// Instruction asks for strict JSON. Grok-4 reliably emits a fenced or inline
// JSON block when told to. We strip fences/prose before parsing.
const instructions = `You are a corpus extractor for an AI trend tracker.
Use the x_search tool to find the top ${max} most engaging X posts matching the query.
Return ONLY a JSON array (no markdown fences, no commentary). Each item:
{
  "id":         "string — X post id (digits only) extracted from the post URL",
  "url":        "string — canonical https://x.com/<handle>/status/<id> URL",
  "handle":     "string — author handle WITHOUT leading @",
  "title":      "string — the post text (first 280 chars, single line)",
  "points":     number    — like count if known, else 0,
  "comments":   number    — reply count if known, else 0,
  "created_at": "ISO8601 if known, else empty string",
  "claim":      "string — one-sentence factual claim of the post",
  "novelty":    "string — what's new vs prior knowledge, one sentence",
  "so_what":    "string — why this matters for AI builders, one sentence"
}
Skip non-AI posts. Prefer posts with substantive content (not pure ads).`;

async function callGrok() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90000);
  try {
    const r = await fetch('https://api.x.ai/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${XAI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        tools: [{ type: 'x_search' }],
        instructions,
        input: query,
      }),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`HTTP ${r.status}: ${body.slice(0, 300)}`);
    }
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

function extractText(resp) {
  // Same shape as plugins/x-perception.sh extraction
  const out = resp?.output;
  if (!Array.isArray(out)) return '';
  for (const item of out) {
    if (item?.type !== 'message') continue;
    const content = item.content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      if (c?.type === 'output_text' && typeof c.text === 'string') return c.text;
    }
  }
  return '';
}

function parseJsonArray(text) {
  if (!text) return [];
  let t = text.trim();
  // Strip ```json ... ``` fences
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) t = fence[1].trim();
  // Find first '[' .. matching ']'
  const start = t.indexOf('[');
  const end = t.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return [];
  const slice = t.slice(start, end + 1);
  try {
    const arr = JSON.parse(slice);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    console.error(`[x-ai-trend] JSON parse failed: ${e.message}`);
    return [];
  }
}

function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const handle = String(raw.handle || '').replace(/^@/, '').trim();
  let id = String(raw.id || '').trim();
  let url = String(raw.url || '').trim();
  // If id missing, try parse from url
  if (!id && url) {
    const m = url.match(/status\/(\d+)/);
    if (m) id = m[1];
  }
  if (!id) return null;
  if (!url && handle) url = `https://x.com/${handle}/status/${id}`;
  const title = String(raw.title || '').replace(/\s+/g, ' ').trim().slice(0, 280);
  if (!title) return null;
  return {
    id: `x_${id}`,
    title,
    url,
    author: handle,
    handle,
    points: Number.isFinite(raw.points) ? raw.points : 0,
    comments: Number.isFinite(raw.comments) ? raw.comments : 0,
    created_at: typeof raw.created_at === 'string' ? raw.created_at : '',
    story_text: null,
    summary: {
      claim: String(raw.claim || 'pending-llm-pass'),
      evidence: 'pending-llm-pass',
      novelty: String(raw.novelty || 'pending-llm-pass'),
      so_what: String(raw.so_what || 'pending-llm-pass'),
    },
    status: 'baseline',
    source: 'x',
  };
}

async function main() {
  console.error(`[x-ai-trend] model=${model} max=${max} query="${query.slice(0, 60)}..."`);
  let resp;
  try {
    resp = await callGrok();
  } catch (e) {
    console.error(`[x-ai-trend] Grok call failed: ${e.message}`);
    process.exit(2);
  }
  const text = extractText(resp);
  if (!text) {
    console.error('[x-ai-trend] no output_text in Grok response');
    process.exit(3);
  }
  const rawItems = parseJsonArray(text);
  console.error(`[x-ai-trend] parsed ${rawItems.length} raw items from JSON`);

  const seen = new Set();
  const posts = [];
  for (const r of rawItems) {
    const n = normalizeItem(r);
    if (!n) continue;
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    posts.push(n);
    if (posts.length >= max) break;
  }
  console.error(`[x-ai-trend] kept ${posts.length} posts after normalize+dedup`);

  const date = new Date().toISOString().slice(0, 10);
  const outDir = join(REPO_ROOT, 'memory', 'state', 'x-trend');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outFile = outFlag || join(outDir, `${date}.json`);

  const doc = {
    run_at: new Date().toISOString(),
    config: { model, max, query, outFile: outFlag },
    count: posts.length,
    posts,
  };

  if (dryRun) {
    console.error(`[x-ai-trend] DRY RUN — would write ${posts.length} posts → ${outFile}`);
    console.log(JSON.stringify(doc, null, 2));
    return;
  }

  writeFileSync(outFile, JSON.stringify(doc, null, 2));
  console.error(`[x-ai-trend] wrote ${posts.length} posts → ${outFile}`);

  // Hard fail if zero posts — silent empty corpus is worse than visible failure
  if (posts.length === 0) process.exit(4);
}

main().catch(e => {
  console.error(`[x-ai-trend] FATAL: ${e.message}`);
  process.exit(1);
});
