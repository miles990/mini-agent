#!/usr/bin/env -S node --loader tsx
/**
 * Co-occurrence Edge Builder — rule-based baseline edges from entity references.
 *
 * Two entities referenced in the same chunk → `mentions` edge (confidence 1.0,
 * detector='rule'). Complements the LLM semantic edge classifier: mentions is
 * the default-fallback type in the edge dict, so overlap with later `supports`
 * / `contradicts` is expected — those have different type keys and dedup cleanly.
 *
 * Why rule-based: structural signal that needs no LLM reasoning. Lets PPR
 * traverse even before the classifier runs, and gives viz something to render.
 *
 * Dedup: (from, to, type). Same pair in multiple chunks → kept once with the
 * strongest evidence (first chunk wins; all equally strong at conf 1.0).
 *
 * Usage:
 *   pnpm tsx scripts/kg-build-cooccurrence.ts              # dry-run
 *   pnpm tsx scripts/kg-build-cooccurrence.ts --write      # append to edges.jsonl
 *   pnpm tsx scripts/kg-build-cooccurrence.ts --replace    # overwrite edges.jsonl
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KG_PATHS, type EntityRecord, type EdgeRecord } from '../src/kg-types.js';
import { persistEdges } from '../src/kg-edge-builder.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const args = process.argv.slice(2);
const write = args.includes('--write');
const replace = args.includes('--replace');
const dumpIndex = args.includes('--dump-chunk-index');  // side output for extractor (Kuro #091 Q3)

const entitiesPath = resolve(REPO_ROOT, KG_PATHS.entities);
const edgesPath = resolve(REPO_ROOT, KG_PATHS.edges);

if (!existsSync(entitiesPath)) {
  console.error(`No entities file at ${entitiesPath}`);
  process.exit(1);
}

const entities: EntityRecord[] = [];
for (const line of readFileSync(entitiesPath, 'utf-8').split('\n')) {
  const t = line.trim();
  if (!t) continue;
  try { entities.push(JSON.parse(t)); } catch { /* skip */ }
}

console.log(`Loaded ${entities.length} entities`);

// chunk_id → [entity_id, …]
const chunkIndex = new Map<string, string[]>();
for (const e of entities) {
  for (const r of e.references) {
    const list = chunkIndex.get(r.chunk_id) ?? [];
    list.push(e.id);
    chunkIndex.set(r.chunk_id, list);
  }
}

const multiEntityChunks = [...chunkIndex.entries()].filter(([, ids]) => ids.length >= 2);
console.log(`${multiEntityChunks.length} chunks have 2+ entities`);

if (dumpIndex) {
  const indexPath = resolve(REPO_ROOT, 'memory/index/chunk-entity-index.jsonl');
  const lines = [...chunkIndex.entries()]
    .map(([chunk_id, entity_ids]) => JSON.stringify({ chunk_id, entity_ids: [...new Set(entity_ids)] }))
    .join('\n') + '\n';
  writeFileSync(indexPath, lines);
  console.log(`Dumped chunk→entities index: ${indexPath} (${chunkIndex.size} chunks)`);
}

// Generate undirected pairs → two directed `mentions` edges (co-occurrence is
// symmetric; the graph treats them as separate edges but PPR walks both ways).
const now = new Date().toISOString();
const seen = new Map<string, EdgeRecord>();
let rawPairs = 0;

for (const [chunkId, ids] of multiEntityChunks) {
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      rawPairs += 2;
      for (const [from, to] of [[unique[i], unique[j]], [unique[j], unique[i]]]) {
        const key = `${from}\t${to}\tmentions`;
        if (seen.has(key)) continue;
        seen.set(key, {
          from,
          to,
          type: 'mentions',
          confidence: 1.0,   // ontologically certain — they co-occur in this chunk
          weight: 0.3,       // walk preference — don't drown sparse semantic edges (Kuro #091)
          detector: 'rule',
          evidence_chunk_id: chunkId,
          created: now,
        });
      }
    }
  }
}

const edges = [...seen.values()];
console.log(`Raw directed pairs: ${rawPairs}`);
console.log(`Deduped edges:      ${edges.length}`);
console.log(`Collapse ratio:     ${(1 - edges.length / Math.max(1, rawPairs)).toFixed(2)}`);

if (!write && !replace) {
  console.log('(dry-run — pass --write to append or --replace to overwrite)');
  process.exit(0);
}

if (replace) {
  persistEdges(edges, edgesPath);
  console.log(`Replaced ${edgesPath} with ${edges.length} edges`);
} else {
  // Append: load existing, dedup against new.
  const existing: EdgeRecord[] = [];
  if (existsSync(edgesPath)) {
    for (const line of readFileSync(edgesPath, 'utf-8').split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try { existing.push(JSON.parse(t)); } catch { /* skip */ }
    }
  }
  const merged = new Map<string, EdgeRecord>();
  for (const e of existing) merged.set(`${e.from}\t${e.to}\t${e.type}`, e);
  let added = 0;
  for (const e of edges) {
    const key = `${e.from}\t${e.to}\t${e.type}`;
    if (!merged.has(key)) { merged.set(key, e); added++; }
  }
  persistEdges([...merged.values()], edgesPath);
  console.log(`Appended ${added} new edges (total ${merged.size}) → ${edgesPath}`);
}
