#!/usr/bin/env -S node --loader tsx
/**
 * KG Ingest CLI — runs the chunk → entities + edges pipeline.
 *
 * v0 default: noop extractors (smoke test that pipeline wiring is sound).
 * Real LLM extractors plug in once Kuro's kg-entity-prompt.ts and
 * kg-edge-prompt.ts are ready. Replace the imports here.
 *
 * Usage:
 *   pnpm tsx scripts/kg-ingest.ts                # noop dry-run, stats only
 *   pnpm tsx scripts/kg-ingest.ts --write        # also persist entities + edges
 *   pnpm tsx scripts/kg-ingest.ts --limit 100    # first N chunks
 *   pnpm tsx scripts/kg-ingest.ts --concurrency 4
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KG_PATHS, type ChunkRecord, type IndexManifest } from '../src/kg-types.js';
import { loadRegistry, persistRegistry, summarize } from '../src/kg-entity-registry.js';
import { persistEdges } from '../src/kg-edge-builder.js';
import { ingest, noopExtractor, noopClassifier } from '../src/kg-ingest.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const args = process.argv.slice(2);
const write = args.includes('--write');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : Infinity;
const concIdx = args.indexOf('--concurrency');
const concurrency = concIdx >= 0 ? parseInt(args[concIdx + 1], 10) : 1;

const chunksPath = resolve(REPO_ROOT, KG_PATHS.chunks);
const entitiesPath = resolve(REPO_ROOT, KG_PATHS.entities);
const edgesPath = resolve(REPO_ROOT, KG_PATHS.edges);
const manifestPath = resolve(REPO_ROOT, KG_PATHS.manifest);

if (!existsSync(chunksPath)) {
  console.error(`No chunks file at ${chunksPath} — run scripts/kg-extract-chunks.ts first.`);
  process.exit(1);
}

const chunks: ChunkRecord[] = [];
for (const line of readFileSync(chunksPath, 'utf-8').split('\n')) {
  const trimmed = line.trim();
  if (!trimmed) continue;
  try {
    chunks.push(JSON.parse(trimmed));
  } catch {
    /* skip malformed */
  }
  if (chunks.length >= limit) break;
}

console.log(`Loaded ${chunks.length} chunks from ${KG_PATHS.chunks}`);
console.log(`Mode: ${write ? 'WRITE' : 'DRY-RUN'} | concurrency=${concurrency}`);

const baseRegistry = loadRegistry(entitiesPath);
console.log(`Base registry: ${baseRegistry.byId.size} entities`);

const result = await ingest(chunks, {
  extractor: noopExtractor,
  classifier: noopClassifier,
  baseRegistry,
  concurrency,
  onChunkProcessed: (i, total) => {
    if (i % 1000 === 0 || i === total) {
      console.log(`  progress: ${i}/${total}`);
    }
  },
});

const summary = summarize(result.registry);

console.log('---');
console.log(`Chunks: total=${result.stats.chunksTotal} processed=${result.stats.chunksProcessed} skipped=${result.stats.chunksSkipped}`);
console.log(`Entities: created=${result.stats.entitiesCreated} enriched=${result.stats.entitiesEnriched} total=${summary.total} disputed=${summary.withDisputedTypes}`);
console.log(`  byType: ${JSON.stringify(summary.byType)}`);
console.log(`Edges: candidates=${result.edges.stats.candidates} kept=${result.edges.stats.kept} below_floor=${result.edges.stats.droppedBelowFloor} unresolved=${result.edges.stats.droppedUnresolved} malformed=${result.edges.stats.droppedMalformed} collapsed=${result.edges.stats.collapsedDuplicates}`);

if (!write) {
  console.log('(dry-run — pass --write to persist)');
  process.exit(0);
}

persistRegistry(result.registry, entitiesPath);
persistEdges(result.edges.edges, edgesPath);

// Update manifest counts.
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
    chunks_count: 0,
    conflicts_pending: 0,
    last_full_rebuild: 'never',
    last_incremental: 'never',
  };
}
manifest.entities_count = result.registry.byId.size;
manifest.edges_count = result.edges.edges.length;
manifest.chunks_count = chunks.length;
manifest.last_incremental = new Date().toISOString();
manifest.built_at = manifest.last_incremental;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

console.log(`Persisted: ${entitiesPath}, ${edgesPath}, ${manifestPath}`);
