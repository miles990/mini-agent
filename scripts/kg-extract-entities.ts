#!/usr/bin/env -S node --loader tsx
/**
 * KG Entity Extractor Runner (P2a)
 *
 * Pipeline: chunks.jsonl → filter → batch → Claude CLI → parse → candidates.jsonl
 *
 * Output is staging — registry (CC's kg-entity-registry.ts) consumes this file
 * and assigns entity ids, dedupes by canonical_name.
 *
 * Usage:
 *   pnpm tsx scripts/kg-extract-entities.ts [--dry] [--limit N] [--model haiku|sonnet]
 *                                           [--batch 20] [--timeout 60000] [--append]
 *
 * --dry     print the first batch prompt + exit (no LLM call)
 * --limit   only process first N batches (cost calibration)
 * --append  don't truncate candidates.jsonl — resume partial run
 */
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KG_PATHS, type ChunkRecord } from '../src/kg-types.js';
import {
  buildEntityPrompt,
  parseEntityCandidates,
  type CandidateBatch,
} from '../src/kg-entity-prompt.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface CliOpts {
  dry: boolean;
  limit: number | null;
  model: string;
  batch: number;
  timeoutMs: number;
  append: boolean;
}

function parseArgs(): CliOpts {
  const a = process.argv.slice(2);
  const get = (flag: string, fallback?: string): string | undefined => {
    const i = a.indexOf(flag);
    return i >= 0 && i + 1 < a.length ? a[i + 1] : fallback;
  };
  return {
    dry: a.includes('--dry'),
    limit: a.includes('--limit') ? Math.max(1, Number(get('--limit', '1'))) : null,
    model: get('--model', 'haiku') ?? 'haiku',
    batch: Math.max(1, Number(get('--batch', '20'))),
    timeoutMs: Math.max(5_000, Number(get('--timeout', '90000'))),
    append: a.includes('--append'),
  };
}

function loadChunks(): ChunkRecord[] {
  const p = resolve(REPO_ROOT, KG_PATHS.chunks);
  if (!existsSync(p)) {
    throw new Error(`chunks file missing: ${p} — run kg-extract-chunks.ts first`);
  }
  const raw = readFileSync(p, 'utf-8');
  const out: ChunkRecord[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    out.push(JSON.parse(line) as ChunkRecord);
  }
  return out;
}

/** Entity-bearing heuristic — cut trivial chunks before LLM spend. */
function shouldExtract(c: ChunkRecord): boolean {
  if (c.type === 'heading') return false;
  if (c.type === 'frontmatter') return false;
  const len = c.text.trim().length;
  if (c.type === 'code_block') return len >= 200;
  if (c.type === 'list_item') return len >= 25;
  return len >= 30;
}

function batchChunks(chunks: ChunkRecord[], size: number): ChunkRecord[][] {
  const out: ChunkRecord[][] = [];
  for (let i = 0; i < chunks.length; i += size) out.push(chunks.slice(i, i + size));
  return out;
}

function callClaude(prompt: string, model: string, timeoutMs: number): Promise<string | null> {
  return new Promise((resolveP) => {
    // Strip ANTHROPIC_API_KEY — CLI uses subscription auth.
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => k !== 'ANTHROPIC_API_KEY'),
    );
    const child = spawn('claude', ['-p', '--model', model, '--output-format', 'text'], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let done = false;
    const finish = (val: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolveP(val);
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      finish(null);
    }, timeoutMs);
    child.stdout?.on('data', (b: Buffer) => { stdout += b.toString(); });
    child.stderr?.on('data', (b: Buffer) => { stderr += b.toString(); });
    child.on('error', () => finish(null));
    child.on('close', (code) => {
      if (code === 0 && stdout.trim()) finish(stdout.trim());
      else {
        if (stderr) console.error(`  ! claude exit=${code} stderr=${stderr.slice(0, 200)}`);
        finish(null);
      }
    });
    child.stdin?.write(prompt);
    child.stdin?.end();
  });
}

async function main() {
  const opts = parseArgs();
  const allChunks = loadChunks();
  const eligible = allChunks.filter(shouldExtract);
  const batches = batchChunks(eligible, opts.batch);
  const planBatches = opts.limit ? batches.slice(0, opts.limit) : batches;

  console.log(`chunks: ${allChunks.length} total → ${eligible.length} eligible`);
  console.log(`batches: ${batches.length} planned, running ${planBatches.length} (size=${opts.batch}, model=${opts.model})`);

  if (opts.dry) {
    const sample = planBatches[0];
    console.log('\n--- SAMPLE PROMPT (batch 1) ---\n');
    console.log(buildEntityPrompt(sample));
    console.log(`\n--- ${sample.length} chunks, ${buildEntityPrompt(sample).length} prompt chars ---`);
    return;
  }

  const outPath = resolve(REPO_ROOT, KG_PATHS.entity_candidates);
  mkdirSync(dirname(outPath), { recursive: true });
  if (!opts.append) writeFileSync(outPath, '');

  let candidatesTotal = 0;
  let skippedTotal = 0;
  let callsOk = 0;
  let callsFail = 0;
  const t0 = Date.now();

  for (let i = 0; i < planBatches.length; i++) {
    const batch = planBatches[i];
    const prompt = buildEntityPrompt(batch);
    const raw = await callClaude(prompt, opts.model, opts.timeoutMs);
    if (raw === null) {
      callsFail++;
      console.log(`  [${i + 1}/${planBatches.length}] FAIL (null response)`);
      continue;
    }
    callsOk++;
    const parsed = parseEntityCandidates(raw, batch);
    skippedTotal += parsed.skipped.length;

    // Parser flattens candidates — re-thread to chunks by span-in-text membership.
    // Small batches (~20 chunks × ~2 cands) make O(n·m) cheap vs tracking owner through parser.
    const byChunk = new Map<string, CandidateBatch>();
    for (const chunk of batch) {
      const mine = parsed.candidates.filter((c) => chunk.text.includes(c.span));
      if (mine.length === 0) continue;
      byChunk.set(chunk.id, { chunk_id: chunk.id, candidates: mine });
    }

    const lines: string[] = [];
    for (const cb of byChunk.values()) lines.push(JSON.stringify(cb));
    if (lines.length) appendFileSync(outPath, lines.join('\n') + '\n');
    candidatesTotal += parsed.candidates.length;

    const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
    console.log(
      `  [${i + 1}/${planBatches.length}] +${parsed.candidates.length} cands` +
      ` (${parsed.skipped.length} skipped)` +
      ` elapsed=${elapsed}s`,
    );
  }

  const totalSec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('\n=== done ===');
  console.log(`  calls: ok=${callsOk} fail=${callsFail}`);
  console.log(`  candidates: ${candidatesTotal} extracted, ${skippedTotal} skipped`);
  console.log(`  elapsed: ${totalSec}s  (${(Number(totalSec) / Math.max(1, callsOk)).toFixed(1)}s/call avg)`);
  console.log(`  output: ${KG_PATHS.entity_candidates}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
