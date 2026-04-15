#!/usr/bin/env -S node --loader tsx
/**
 * CLI for the conflict detector. Reads entities + edges, writes conflicts.jsonl.
 *
 * Usage:
 *   pnpm tsx scripts/kg-detect-conflicts.ts            # dry-run
 *   pnpm tsx scripts/kg-detect-conflicts.ts --write    # persist + update manifest
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KG_PATHS, type IndexManifest } from '../src/kg-types.js';
import {
  loadEntities,
  loadEdges,
  detectConflicts,
  persistConflicts,
} from '../src/kg-conflict-detector.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const args = process.argv.slice(2);
const write = args.includes('--write');

const entitiesPath = resolve(REPO_ROOT, KG_PATHS.entities);
const edgesPath = resolve(REPO_ROOT, KG_PATHS.edges);
const conflictsPath = resolve(REPO_ROOT, KG_PATHS.conflicts);
const manifestPath = resolve(REPO_ROOT, KG_PATHS.manifest);

const entities = loadEntities(entitiesPath);
const edges = loadEdges(edgesPath);
console.log(`Loaded ${entities.length} entities, ${edges.length} edges`);

const result = detectConflicts(entities, edges, new Date().toISOString());
console.log('---');
console.log(`Type disputes:    ${result.stats.typeDisputes}`);
console.log(`Alias collisions: ${result.stats.aliasCollisions}`);
console.log(`Edge conflicts:   ${result.stats.edgeConflicts}`);
console.log(`Total:            ${result.stats.total}`);

if (result.conflicts.length > 0) {
  console.log('Sample (first 3):');
  for (const c of result.conflicts.slice(0, 3)) {
    console.log(`  ${c.id} [${c.type}] ${c.resolution ?? ''}`);
  }
}

if (!write) {
  console.log('(dry-run — pass --write to persist)');
  process.exit(0);
}

persistConflicts(result.conflicts, conflictsPath);

let manifest: IndexManifest;
if (existsSync(manifestPath)) {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
} else {
  manifest = {
    version: 1,
    built_at: new Date().toISOString(),
    raw_files_count: 0,
    raw_bytes_total: 0,
    entities_count: entities.length,
    edges_count: edges.length,
    chunks_count: 0,
    conflicts_pending: 0,
    last_full_rebuild: 'never',
    last_incremental: 'never',
  };
}
manifest.conflicts_pending = result.conflicts.filter((c) => c.status === 'pending').length;
manifest.last_incremental = new Date().toISOString();
manifest.built_at = manifest.last_incremental;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

console.log(`Persisted: ${conflictsPath}, ${manifestPath}`);
