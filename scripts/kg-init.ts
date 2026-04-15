#!/usr/bin/env -S node --loader tsx
/**
 * KG Init — bootstraps memory/index/ from kg-types.ts.
 *
 * Idempotent: existing data files are NEVER overwritten; only missing files
 * are created. Dict JSONs (derived from TS constants) are always rewritten —
 * they're the runtime view of kg-types.ts and must stay in sync.
 *
 * Usage: pnpm tsx scripts/kg-init.ts [--reset]
 *   --reset  also wipe data files (DESTRUCTIVE)
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ENTITY_TYPES,
  EDGE_TYPES,
  EDGE_TYPE_FLOORS,
  DEFAULT_EDGE_FLOOR,
  REJECTED_EDGES,
  KG_PATHS,
  type IndexManifest,
} from '../src/kg-types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const reset = process.argv.includes('--reset');

function abs(p: string): string {
  return resolve(REPO_ROOT, p);
}

function ensureDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Write file only if missing (or if reset). Returns true if written. */
function writeIfMissing(path: string, content: string): boolean {
  const full = abs(path);
  ensureDir(full);
  if (existsSync(full) && !reset) return false;
  writeFileSync(full, content);
  return true;
}

/** Always overwrite — for derived files that must track source of truth. */
function writeDerived(path: string, content: string): void {
  const full = abs(path);
  ensureDir(full);
  writeFileSync(full, content);
}

// ─── Derived dict JSONs (system-prompt fragment for LLM extractor) ───

const entityDict = {
  $generated_from: 'src/kg-types.ts',
  $do_not_edit: true,
  types: ENTITY_TYPES,
};

const edgeDict = {
  $generated_from: 'src/kg-types.ts',
  $do_not_edit: true,
  types: EDGE_TYPES,
  default_floor: DEFAULT_EDGE_FLOOR,
  type_floors: EDGE_TYPE_FLOORS,
  rejected: REJECTED_EDGES,
};

writeDerived(KG_PATHS.entity_dict, JSON.stringify(entityDict, null, 2) + '\n');
writeDerived(KG_PATHS.edge_dict, JSON.stringify(edgeDict, null, 2) + '\n');

// ─── Empty data files (preserve existing) ───

const dataFiles = [KG_PATHS.entities, KG_PATHS.edges, KG_PATHS.chunks, KG_PATHS.conflicts];
const writtenData: string[] = [];
for (const f of dataFiles) {
  if (writeIfMissing(f, '')) writtenData.push(f);
}

// ─── Manifest (preserve existing counts when present) ───

const manifestPath = abs(KG_PATHS.manifest);
let manifest: IndexManifest;
if (existsSync(manifestPath) && !reset) {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  manifest.built_at = new Date().toISOString();
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
writeDerived(KG_PATHS.manifest, JSON.stringify(manifest, null, 2) + '\n');

// ─── Report ───

console.log(`KG init complete (${reset ? 'RESET mode' : 'idempotent'})`);
console.log(`  dir: ${KG_PATHS.dir}`);
console.log(`  dicts: entity-types.json (${ENTITY_TYPES.length} types) + edge-types.json (${EDGE_TYPES.length} types, default floor ${DEFAULT_EDGE_FLOOR})`);
console.log(`  data files created: ${writtenData.length === 0 ? '(all existed)' : writtenData.join(', ')}`);
console.log(`  manifest: ${manifestPath}`);
