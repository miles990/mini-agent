#!/usr/bin/env -S node --loader tsx
/**
 * KG Edge Extractor Runner (P2b / Lane 3 — semantic edges)
 *
 * Pipeline: chunks + entities + chunk-entity-index → per-chunk LLM call
 *           → parse → edges.candidates.jsonl
 *
 * Output is staging — kg-edge-builder (CC side) resolves endpoint probes to
 * entity ids, dedupes, floors confidence, writes edges.jsonl.
 *
 * Each chunk with ≥2 entities = 1 LLM call (entity list varies per chunk,
 * so no batching like the entity extractor).
 *
 * Usage:
 *   pnpm tsx scripts/kg-extract-edges.ts [--dry] [--limit N] [--model haiku|sonnet]
 *                                        [--timeout 120000] [--append] [--concurrency 5]
 *
 * --dry          print first chunk prompt + exit (no LLM call)
 * --limit        only process first N chunks (cost calibration)
 * --append       don't truncate edges.candidates.jsonl — resume partial run
 * --concurrency  parallel claude CLI workers (default 5)
 */
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KG_PATHS, type ChunkRecord, type EntityRecord } from '../src/kg-types.js';
import {
  buildEdgePrompt,
  parseEdgeResponse,
  type EdgeCandidateBatch,
} from '../src/kg-edge-prompt.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface CliOpts {
  dry: boolean;
  limit: number | null;
  model: string;
  timeoutMs: number;
  append: boolean;
  concurrency: number;
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
    timeoutMs: Math.max(5_000, Number(get('--timeout', '120000'))),
    append: a.includes('--append'),
    concurrency: Math.max(1, Number(get('--concurrency', '5'))),
  };
}

function readJsonl<T>(path: string): T[] {
  const raw = readFileSync(path, 'utf-8');
  const out: T[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    out.push(JSON.parse(line) as T);
  }
  return out;
}

interface ChunkEntityIndexRow {
  chunk_id: string;
  entity_ids: string[];
}

function callClaude(prompt: string, model: string, timeoutMs: number): Promise<string | null> {
  return new Promise((resolveP) => {
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

  const chunksPath = resolve(REPO_ROOT, KG_PATHS.chunks);
  const entitiesPath = resolve(REPO_ROOT, KG_PATHS.entities);
  const indexPath = resolve(REPO_ROOT, KG_PATHS.chunk_entity_index);
  for (const [label, p] of [
    ['chunks', chunksPath],
    ['entities', entitiesPath],
    ['chunk_entity_index', indexPath],
  ] as const) {
    if (!existsSync(p)) throw new Error(`${label} missing: ${p}`);
  }

  const chunks = readJsonl<ChunkRecord>(chunksPath);
  const entities = readJsonl<EntityRecord>(entitiesPath);
  const index = readJsonl<ChunkEntityIndexRow>(indexPath);

  const chunkById = new Map(chunks.map((c) => [c.id, c]));
  const entityById = new Map(entities.map((e) => [e.id, e]));

  // A chunk is eligible when ≥2 distinct entities co-occur there.
  const eligible: Array<{ chunk: ChunkRecord; ents: EntityRecord[] }> = [];
  for (const row of index) {
    const chunk = chunkById.get(row.chunk_id);
    if (!chunk) continue;
    const ents: EntityRecord[] = [];
    const seen = new Set<string>();
    for (const eid of row.entity_ids) {
      if (seen.has(eid)) continue;
      const e = entityById.get(eid);
      if (!e) continue;
      seen.add(eid);
      ents.push(e);
    }
    if (ents.length < 2) continue;
    eligible.push({ chunk, ents });
  }

  const planned = opts.limit ? eligible.slice(0, opts.limit) : eligible;

  console.log(`chunks: ${chunks.length}, entities: ${entities.length}, indexed: ${index.length}`);
  console.log(`eligible (2+ entities): ${eligible.length}, running: ${planned.length} (model=${opts.model}, concurrency=${opts.concurrency})`);

  if (opts.dry) {
    const sample = planned[0];
    if (!sample) {
      console.log('\n(no eligible chunks — nothing to extract)');
      return;
    }
    const entList = sample.ents.map((e) => ({ canonical_name: e.canonical_name, aliases: e.aliases }));
    const prompt = buildEdgePrompt({ chunk: sample.chunk, entities: entList });
    console.log('\n--- SAMPLE PROMPT ---\n');
    console.log(prompt);
    console.log(`\n--- chunk ${sample.chunk.id}, ${sample.ents.length} entities, ${prompt.length} chars ---`);
    return;
  }

  const outPath = resolve(REPO_ROOT, KG_PATHS.edge_candidates);
  mkdirSync(dirname(outPath), { recursive: true });
  if (!opts.append) writeFileSync(outPath, '');

  let edgesTotal = 0;
  let parseErrorsTotal = 0;
  let callsOk = 0;
  let callsFail = 0;
  let completed = 0;
  const t0 = Date.now();

  const total = planned.length;
  let nextIdx = 0;

  const processOne = async (task: { chunk: ChunkRecord; ents: EntityRecord[] }, n: number): Promise<void> => {
    const entList = task.ents.map((e) => ({ canonical_name: e.canonical_name, aliases: e.aliases }));
    const prompt = buildEdgePrompt({ chunk: task.chunk, entities: entList });
    const raw = await callClaude(prompt, opts.model, opts.timeoutMs);
    completed++;
    if (raw === null) {
      callsFail++;
      console.log(`  [${n}/${total}] FAIL done=${completed}/${total}`);
      return;
    }
    callsOk++;
    const { candidates, errors } = parseEdgeResponse(raw, task.chunk.id);
    parseErrorsTotal += errors.length;

    if (candidates.length > 0) {
      const batch: EdgeCandidateBatch = { chunk_id: task.chunk.id, candidates };
      appendFileSync(outPath, JSON.stringify(batch) + '\n');
      edgesTotal += candidates.length;
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
    console.log(
      `  [${n}/${total}] +${candidates.length} edges` +
      (errors.length ? ` (${errors.length} parse errs)` : '') +
      ` done=${completed}/${total} elapsed=${elapsed}s`,
    );
  };

  const worker = async (): Promise<void> => {
    while (true) {
      const i = nextIdx++;
      if (i >= total) return;
      await processOne(planned[i], i + 1);
    }
  };

  const workerCount = Math.min(opts.concurrency, total);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const totalSec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('\n=== done ===');
  console.log(`  calls: ok=${callsOk} fail=${callsFail}`);
  console.log(`  edges: ${edgesTotal} extracted, ${parseErrorsTotal} parse errors`);
  console.log(`  elapsed: ${totalSec}s  (${(Number(totalSec) / Math.max(1, callsOk)).toFixed(1)}s/call avg)`);
  console.log(`  output: ${KG_PATHS.edge_candidates}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
