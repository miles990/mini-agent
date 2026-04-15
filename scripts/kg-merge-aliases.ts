#!/usr/bin/env -S node --loader tsx
/**
 * Alias-collision merge — fold duplicate entity records into canonical ones.
 *
 * Use when the conflict detector flags `alias_collision`: two entity ids end
 * up claiming the same canonical alias (e.g., ent-loop-ts vs ent-src-loop-ts).
 * Merge direction: loser → winner. Loser's aliases + references fold into
 * winner; all edges referencing loser get rewritten to winner. Loser entity
 * record is then removed from entities.jsonl.
 *
 * Idempotent: after merge, re-running with the same pair is a no-op
 * (loser no longer exists).
 *
 * Usage:
 *   pnpm tsx scripts/kg-merge-aliases.ts --loser ent-loop-ts --winner ent-src-loop-ts             # dry-run
 *   pnpm tsx scripts/kg-merge-aliases.ts --loser ent-loop-ts --winner ent-src-loop-ts --write     # persist
 *
 *   # Batch mode: JSON file with [{loser, winner}, ...]
 *   pnpm tsx scripts/kg-merge-aliases.ts --batch merges.json --write
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KG_PATHS, type EdgeRecord, type EntityRecord, type IndexManifest } from '../src/kg-types.js';
import { persistEdges } from '../src/kg-edge-builder.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

function parseArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

const write = process.argv.includes('--write');
const loserArg = parseArg('--loser');
const winnerArg = parseArg('--winner');
const batchPath = parseArg('--batch');

interface MergePair { loser: string; winner: string }
const pairs: MergePair[] = [];

if (batchPath) {
  const arr = JSON.parse(readFileSync(resolve(batchPath), 'utf-8'));
  if (!Array.isArray(arr)) throw new Error('batch file must be JSON array');
  for (const p of arr) {
    if (!p.loser || !p.winner) throw new Error(`batch entry missing loser/winner: ${JSON.stringify(p)}`);
    pairs.push({ loser: p.loser, winner: p.winner });
  }
} else if (loserArg && winnerArg) {
  pairs.push({ loser: loserArg, winner: winnerArg });
} else {
  console.error('Usage: --loser <id> --winner <id> [--write]');
  console.error('   or: --batch <merges.json> [--write]');
  process.exit(1);
}

const entitiesPath = resolve(REPO_ROOT, KG_PATHS.entities);
const edgesPath = resolve(REPO_ROOT, KG_PATHS.edges);
const manifestPath = resolve(REPO_ROOT, KG_PATHS.manifest);

// ── Load entities ──
const entities = new Map<string, EntityRecord>();
for (const line of readFileSync(entitiesPath, 'utf-8').split('\n')) {
  const t = line.trim();
  if (!t) continue;
  try {
    const rec = JSON.parse(t) as EntityRecord;
    entities.set(rec.id, rec);
  } catch { /* skip */ }
}
console.log(`Loaded ${entities.size} entities`);

// ── Apply merges ──
type MergeReport = { loser: string; winner: string; aliasesAdded: number; refsAdded: number; skipped?: string };
const reports: MergeReport[] = [];
const rewriteMap = new Map<string, string>();  // loser id → winner id

for (const { loser, winner } of pairs) {
  const loserRec = entities.get(loser);
  const winnerRec = entities.get(winner);
  if (!loserRec) {
    reports.push({ loser, winner, aliasesAdded: 0, refsAdded: 0, skipped: 'loser already merged / missing' });
    continue;
  }
  if (!winnerRec) {
    reports.push({ loser, winner, aliasesAdded: 0, refsAdded: 0, skipped: 'winner missing' });
    continue;
  }
  if (loser === winner) {
    reports.push({ loser, winner, aliasesAdded: 0, refsAdded: 0, skipped: 'self-merge' });
    continue;
  }

  // Fold aliases (dedupe case-insensitive; canonical_name of loser becomes alias).
  const knownAliases = new Set(
    [winnerRec.canonical_name, ...winnerRec.aliases].map((a) => a.trim().toLowerCase()),
  );
  let aliasesAdded = 0;
  const loserProbes = [loserRec.canonical_name, ...loserRec.aliases];
  for (const probe of loserProbes) {
    const key = probe.trim().toLowerCase();
    if (!knownAliases.has(key)) {
      winnerRec.aliases.push(probe);
      knownAliases.add(key);
      aliasesAdded++;
    }
  }

  // Fold references (dedupe by chunk_id; keep max confidence).
  const refByChunk = new Map<string, { chunk_id: string; span?: string; confidence?: number }>();
  for (const r of winnerRec.references) refByChunk.set(r.chunk_id, r);
  let refsAdded = 0;
  for (const r of loserRec.references) {
    const existing = refByChunk.get(r.chunk_id);
    if (!existing) {
      refByChunk.set(r.chunk_id, r);
      refsAdded++;
    } else if (typeof r.confidence === 'number' && (!existing.confidence || r.confidence > existing.confidence)) {
      existing.confidence = r.confidence;
    }
  }
  winnerRec.references = [...refByChunk.values()];

  // last_referenced = max.
  if (loserRec.last_referenced > winnerRec.last_referenced) {
    winnerRec.last_referenced = loserRec.last_referenced;
  }

  // first_seen = min.
  if (loserRec.first_seen < winnerRec.first_seen) {
    winnerRec.first_seen = loserRec.first_seen;
  }

  entities.delete(loser);
  rewriteMap.set(loser, winner);
  reports.push({ loser, winner, aliasesAdded, refsAdded });
}

// ── Rewrite edges ──
const existingEdges: EdgeRecord[] = [];
if (existsSync(edgesPath)) {
  for (const line of readFileSync(edgesPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { existingEdges.push(JSON.parse(t)); } catch { /* skip */ }
  }
}

let edgesRewritten = 0;
let selfLoopsDropped = 0;
const deduped = new Map<string, EdgeRecord>();
for (const e of existingEdges) {
  const from = rewriteMap.get(e.from) ?? e.from;
  const to = rewriteMap.get(e.to) ?? e.to;
  if (from !== e.from || to !== e.to) edgesRewritten++;
  if (from === to) { selfLoopsDropped++; continue; }  // merge can induce self-loops
  const out: EdgeRecord = { ...e, from, to };
  const key = `${from}\t${to}\t${e.type}`;
  const prior = deduped.get(key);
  // Keep higher confidence on dedup.
  if (!prior || e.confidence > prior.confidence) deduped.set(key, out);
}

const edges = [...deduped.values()];

// ── Report ──
console.log('\n--- merge report ---');
for (const r of reports) {
  if (r.skipped) console.log(`  skip ${r.loser} → ${r.winner}: ${r.skipped}`);
  else console.log(`  merge ${r.loser} → ${r.winner}: +${r.aliasesAdded} aliases, +${r.refsAdded} refs`);
}
console.log(`\nEntities: ${entities.size} (after merge)`);
console.log(`Edges rewritten: ${edgesRewritten}`);
console.log(`Self-loops dropped: ${selfLoopsDropped}`);
console.log(`Edges total after dedup: ${edges.length} (was ${existingEdges.length})`);

if (!write) {
  console.log('\n(dry-run — pass --write to persist)');
  process.exit(0);
}

// ── Persist ──
const sorted = [...entities.values()].sort((a, b) => {
  if (a.first_seen !== b.first_seen) return a.first_seen.localeCompare(b.first_seen);
  return a.id.localeCompare(b.id);
});
writeFileSync(
  entitiesPath,
  sorted.map((r) => JSON.stringify(r)).join('\n') + (sorted.length ? '\n' : ''),
);
console.log(`Persisted ${entitiesPath} (${entities.size} entities)`);

persistEdges(edges, edgesPath);
console.log(`Persisted ${edgesPath} (${edges.length} edges)`);

// Sync manifest.
const now = new Date().toISOString();
let manifest: IndexManifest;
if (existsSync(manifestPath)) {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
} else {
  manifest = {
    version: 1, built_at: now, raw_files_count: 0, raw_bytes_total: 0,
    entities_count: entities.size, edges_count: edges.length, chunks_count: 0,
    conflicts_pending: 0, last_full_rebuild: 'never', last_incremental: now,
  };
}
manifest.entities_count = entities.size;
manifest.edges_count = edges.length;
manifest.last_incremental = now;
manifest.built_at = now;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Synced manifest: entities=${entities.size} edges=${edges.length}`);
