#!/usr/bin/env -S node --loader tsx
/**
 * Ingest pre-extracted entity candidates from candidates.jsonl into the registry.
 *
 * Bridges Kuro's runner output (LLM call) and CC's registry (deterministic resolution).
 * No LLM calls here — just file → file transformation.
 *
 * Usage:
 *   pnpm tsx scripts/kg-ingest-candidates.ts                # dry-run, stats only
 *   pnpm tsx scripts/kg-ingest-candidates.ts --write        # persist entities.jsonl
 *   pnpm tsx scripts/kg-ingest-candidates.ts --candidates path/to.jsonl
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KG_PATHS, type ChunkRecord, type IndexManifest } from '../src/kg-types.js';
import {
  loadRegistry,
  persistRegistry,
  resolveOrCreate,
  summarize,
  type EntityCandidate,
} from '../src/kg-entity-registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const args = process.argv.slice(2);
const write = args.includes('--write');
const candIdx = args.indexOf('--candidates');
const candidatesPath = candIdx >= 0
  ? resolve(args[candIdx + 1])
  : resolve(REPO_ROOT, KG_PATHS.entity_candidates);

const chunksPath = resolve(REPO_ROOT, KG_PATHS.chunks);
const entitiesPath = resolve(REPO_ROOT, KG_PATHS.entities);
const manifestPath = resolve(REPO_ROOT, KG_PATHS.manifest);

if (!existsSync(candidatesPath)) {
  console.error(`No candidates file at ${candidatesPath}`);
  process.exit(1);
}
if (!existsSync(chunksPath)) {
  console.error(`No chunks file at ${chunksPath} — run scripts/kg-extract-chunks.ts first.`);
  process.exit(1);
}

// Load chunks for last_referenced timestamp lookup (chunk.created).
const chunkCreated = new Map<string, string>();
for (const line of readFileSync(chunksPath, 'utf-8').split('\n')) {
  const t = line.trim();
  if (!t) continue;
  try {
    const c = JSON.parse(t) as ChunkRecord;
    if (c.id && c.created) chunkCreated.set(c.id, c.created);
  } catch { /* skip */ }
}

interface CandidateLine {
  chunk_id: string;
  candidates: EntityCandidate[];
}

const lines: CandidateLine[] = [];
for (const line of readFileSync(candidatesPath, 'utf-8').split('\n')) {
  const t = line.trim();
  if (!t) continue;
  try {
    lines.push(JSON.parse(t));
  } catch { /* skip malformed */ }
}

console.log(`Loaded ${lines.length} candidate batches from ${candidatesPath}`);
console.log(`Mode: ${write ? 'WRITE' : 'DRY-RUN'}`);

const baseRegistry = loadRegistry(entitiesPath);
console.log(`Base registry: ${baseRegistry.byId.size} entities`);

const fallbackNow = new Date().toISOString();
let candidatesTotal = 0;
let candidatesAccepted = 0;
let candidatesRejected = 0;
let created = 0;
let enriched = 0;
const rejectReasons = new Map<string, number>();

for (const { chunk_id, candidates } of lines) {
  const now = chunkCreated.get(chunk_id) ?? fallbackNow;
  for (const cand of candidates) {
    candidatesTotal++;
    try {
      const r = resolveOrCreate(baseRegistry, cand, chunk_id, now);
      candidatesAccepted++;
      if (r.created) created++;
      else if (r.enriched) enriched++;
    } catch (e) {
      candidatesRejected++;
      const reason = (e as Error).message.slice(0, 80);
      rejectReasons.set(reason, (rejectReasons.get(reason) ?? 0) + 1);
    }
  }
}

const summary = summarize(baseRegistry);
console.log('---');
console.log(`Candidates: total=${candidatesTotal} accepted=${candidatesAccepted} rejected=${candidatesRejected}`);
if (rejectReasons.size > 0) {
  console.log('Reject reasons:');
  for (const [reason, count] of rejectReasons) console.log(`  ${count}× ${reason}`);
}
console.log(`Entities: created=${created} enriched=${enriched} total=${summary.total} disputed=${summary.withDisputedTypes}`);
console.log(`  byType: ${JSON.stringify(summary.byType)}`);

if (!write) {
  console.log('(dry-run — pass --write to persist)');
  process.exit(0);
}

persistRegistry(baseRegistry, entitiesPath);

let manifest: IndexManifest;
if (existsSync(manifestPath)) {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
} else {
  manifest = {
    version: 1,
    built_at: new Date().toISOString(),
    raw_files_count: 0,
    raw_bytes_total: 0,
    entities_count: 0,
    edges_count: 0,
    chunks_count: chunkCreated.size,
    conflicts_pending: 0,
    last_full_rebuild: 'never',
    last_incremental: 'never',
  };
}
manifest.entities_count = baseRegistry.byId.size;
manifest.last_incremental = new Date().toISOString();
manifest.built_at = manifest.last_incremental;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

console.log(`Persisted: ${entitiesPath}, ${manifestPath}`);
