#!/usr/bin/env node
/**
 * HN AI Trend — local Qwen enrichment pass
 *
 * Reads today's baseline JSON from memory/state/hn-ai-trend/YYYY-MM-DD.json
 * (produced by hn-ai-trend.mjs), fills in novelty/so_what via local MLX Qwen
 * (OpenAI-compatible endpoint), writes back in place.
 *
 * Why separate: the original script uses Anthropic schema; this keeps it
 * usable with local inference without modifying the pipeline script.
 *
 * Usage:
 *   node scripts/hn-ai-trend-enrich.mjs                # enrich today's file
 *   node scripts/hn-ai-trend-enrich.mjs --date=2026-04-22
 *
 * Env:
 *   LOCAL_LLM_URL (required, e.g. http://localhost:8000)
 *   LOCAL_LLM_KEY (optional, sent as Bearer)
 *   HN_LOCAL_MODEL (default: Qwen3.5-4B-MLX-4bit)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const args = process.argv.slice(2);
const flagDate = (args.find(a => a.startsWith('--date=')) || '').split('=')[1];
const date = flagDate || new Date().toISOString().slice(0, 10);
const force = args.includes('--force');

const LLM_URL = process.env.LOCAL_LLM_URL;
const LLM_KEY = process.env.LOCAL_LLM_KEY || '';
const MODEL = process.env.HN_LOCAL_MODEL || 'Qwen3.5-4B-MLX-4bit';

if (!LLM_URL) {
  console.error('[enrich] LOCAL_LLM_URL not set — aborting by design.');
  console.error('[enrich] This script is local-MLX-only (see header comment line 8-10).');
  console.error('[enrich] To enrich: start MLX endpoint and `export LOCAL_LLM_URL=http://localhost:PORT`.');
  console.error('[enrich] For remote (Anthropic) inference, write a sibling script — do not augment this one.');
  console.error(`[enrich] Baseline file left unenriched: memory/state/hn-ai-trend/${date}.json (novelty="pending-llm-pass" preserved).`);
  process.exit(2);
}

const inFile = join(REPO_ROOT, 'memory', 'state', 'hn-ai-trend', `${date}.json`);
let doc;
try {
  doc = JSON.parse(readFileSync(inFile, 'utf8'));
} catch (e) {
  console.error(`[enrich] cannot read ${inFile}: ${e.message}`);
  process.exit(3);
}

const toEnrich = force ? doc.posts : doc.posts.filter(p => p.summary?.novelty === 'pending-llm-pass');
console.error(`[enrich] ${toEnrich.length}/${doc.posts.length} posts need enrichment (date=${date}, model=${MODEL}, force=${force})`);

const SYSTEM = `你為 AI 趨勢知識圖譜分類 HN 文章。只輸出嚴格 JSON — 不要 prose、不要 code fence。欄位：claim, evidence, novelty, so_what。

重要：所有欄位值用繁體中文撰寫。技術術語（模型名、API、框架名、benchmark）保留原文。不要翻譯 JSON 外的 post title。

- claim: 一句話講核心主張（≤80 字）
- evidence: 什麼在支撐它 — paper 連結、benchmark、repo、demo、作者權威（≤120 字）
- novelty: 相較前作真的有什麼新東西。如果只是漸進式升級，直說（≤80 字）
- so_what: 對 agent 開發者的具體意義。不要空話（≤100 字）`;

async function enrich(post) {
  const userMsg = `title: ${post.title}
url: ${post.url}
points: ${post.points}, comments: ${post.comments}
story_text: ${(post.story_text || '').slice(0, 1200)}`;

  const body = {
    model: MODEL,
    max_tokens: 400,
    temperature: 0.3,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: userMsg },
    ],
  };

  try {
    const resp = await fetch(`${LLM_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(LLM_KEY ? { authorization: `Bearer ${LLM_KEY}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      console.error(`[enrich] ${post.id} http ${resp.status}`);
      return null;
    }
    const data = await resp.json();
    const raw = data?.choices?.[0]?.message?.content || '';
    const cleaned = raw.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
    // Qwen sometimes emits extra text; extract first {...} block
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) {
      console.error(`[enrich] ${post.id} no-json: ${cleaned.slice(0, 80)}`);
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
    console.error(`[enrich] ${post.id} fail: ${e.message}`);
    return null;
  }
}

let ok = 0, fail = 0;
for (const post of toEnrich) {
  const enriched = await enrich(post);
  if (enriched) {
    post.summary = enriched;
    post.status = post.status === 'dry-run' ? 'enriched' : post.status;
    ok++;
  } else {
    fail++;
  }
}

doc.enriched_at = new Date().toISOString();
doc.enrichment = { ok, fail, model: MODEL };
writeFileSync(inFile, JSON.stringify(doc, null, 2));
console.error(`[enrich] done: ok=${ok} fail=${fail} → ${inFile}`);
