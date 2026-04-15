#!/usr/bin/env -S node --loader tsx
/**
 * Ingest pre-extracted edge candidates from edges.candidates.jsonl into edges.jsonl.
 *
 * Mirrors scripts/kg-ingest-candidates.ts. No LLM calls — pure file-to-file
 * via buildEdges (floor enforce, dedup, id resolution against registry).
 *
 * Expected input schema (speculative — to be confirmed with Kuro):
 *   {"chunk_id":"chk-xxx","candidates":[
 *     {"from":"canonical or alias","to":"canonical or alias","type":"supports",
 *      "confidence":0.85,"evidence_quote":"..."}
 *   ]}
 *
 * The chunk_id from the wrapper fills EdgeCandidate.evidence_chunk_id so the
 * LLM side doesn't need to repeat it per candidate.
 *
 * Usage:
 *   pnpm tsx scripts/kg-ingest-edge-candidates.ts                # dry-run
 *   pnpm tsx scripts/kg-ingest-edge-candidates.ts --write        # persist edges.jsonl
 *   pnpm tsx scripts/kg-ingest-edge-candidates.ts --candidates path/to.jsonl
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KG_PATHS, type IndexManifest } from '../src/kg-types.js';
import { loadRegistry } from '../src/kg-entity-registry.js';
import {
  buildEdges,
  persistEdges,
  type EdgeCandidate,
} from '../src/kg-edge-builder.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const args = process.argv.slice(2);
const write = args.includes('--write');
const candIdx = args.indexOf('--candidates');
const candidatesPath = candIdx >= 0
  ? resolve(args[candIdx + 1])
  : resolve(REPO_ROOT, 'memory/index/edges.candidates.jsonl');

const entitiesPath = resolve(REPO_ROOT, KG_PATHS.entities);
const edgesPath = resolve(REPO_ROOT, KG_PATHS.edges);
const manifestPath = resolve(REPO_ROOT, KG_PATHS.manifest);

if (!existsSync(candidatesPath)) {
  console.error(`No edge candidates file at ${candidatesPath}`);
  process.exit(1);
}
if (!existsSync(entitiesPath)) {
  console.error(`No entities file at ${entitiesPath} — run kg-ingest-candidates.ts first.`);
  process.exit(1);
}

interface CandidateLine {
  chunk_id: string;
  candidates: Array<Omit<EdgeCandidate, 'evidence_chunk_id'> & { evidence_chunk_id?: string }>;
}

const lines: CandidateLine[] = [];
let malformedLines = 0;
for (const line of readFileSync(candidatesPath, 'utf-8').split('\n')) {
  const t = line.trim();
  if (!t) continue;
  try {
    lines.push(JSON.parse(t));
  } catch {
    malformedLines++;
  }
}

console.log(`Loaded ${lines.length} edge candidate batches from ${candidatesPath}`);
if (malformedLines > 0) console.log(`Skipped ${malformedLines} malformed lines`);
console.log(`Mode: ${write ? 'WRITE' : 'DRY-RUN'}`);

const registry = loadRegistry(entitiesPath);
console.log(`Registry: ${registry.byId.size} entities`);

// Flatten candidates and fill evidence_chunk_id from wrapper.
const allCandidates: EdgeCandidate[] = [];
for (const { chunk_id, candidates } of lines) {
  for (const c of candidates) {
    allCandidates.push({
      ...c,
      evidence_chunk_id: c.evidence_chunk_id ?? chunk_id,
    } as EdgeCandidate);
  }
}

console.log(`Total edge candidates: ${allCandidates.length}`);

const result = buildEdges(allCandidates, registry, new Date().toISOString());

console.log('---');
console.log(
  `Edges: kept=${result.stats.kept} below_floor=${result.stats.droppedBelowFloor} ` +
  `unresolved=${result.stats.droppedUnresolved} malformed=${result.stats.droppedMalformed} ` +
  `collapsed=${result.stats.collapsedDuplicates}`,
);

if (result.unresolved.length > 0) {
  console.log(`Unresolved samples (first 3):`);
  for (const u of result.unresolved.slice(0, 3)) {
    console.log(`  [${u.reason}] ${u.candidate.from} --${u.candidate.type}--> ${u.candidate.to}`);
  }
}

if (!write) {
  console.log('(dry-run — pass --write to persist)');
  process.exit(0);
}

persistEdges(result.edges, edgesPath);

let manifest: IndexManifest;
if (existsSync(manifestPath)) {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
} else {
  manifest = {
    version: 1,
    built_at: new Date().toISOString(),
    raw_files_count: 0,
    raw_bytes_total: 0,
    entities_count: registry.byId.size,
    edges_count: 0,
    chunks_count: 0,
    conflicts_pending: 0,
    last_full_rebuild: 'never',
    last_incremental: 'never',
  };
}
manifest.edges_count = result.edges.length;
manifest.last_incremental = new Date().toISOString();
manifest.built_at = manifest.last_incremental;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

console.log(`Persisted: ${edgesPath}, ${manifestPath}`);
