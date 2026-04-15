#!/usr/bin/env tsx
/**
 * Merge ent-telegram-ts into ent-src-telegram-ts across entities, edges, chunk-entity-index.
 * Pattern mirrors the already-merged ent-src-loop-ts (canonical=src/loop.ts, aliases=[loop.ts]).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const INDEX_DIR = path.resolve(__dirname, '..', 'memory', 'index');
const DRY_RUN = process.argv.includes('--dry-run');

const SURVIVOR = 'ent-src-telegram-ts';
const REMOVED = 'ent-telegram-ts';

type Ref = { chunk_id: string; span: string; confidence: number };
type Entity = {
  id: string;
  type: string;
  canonical_name: string;
  aliases: string[];
  first_seen: string;
  last_referenced: string;
  references: Ref[];
  meta?: Record<string, unknown>;
  resolved_type?: string;
  resolution_rule?: string;
  resolution_confidence?: string;
  alternatives?: string[];
};

function readJsonl<T>(file: string): T[] {
  const raw = fs.readFileSync(path.join(INDEX_DIR, file), 'utf8');
  return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l) as T);
}

function writeJsonl<T>(file: string, rows: T[]): void {
  const body = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
  const target = path.join(INDEX_DIR, file);
  if (DRY_RUN) {
    console.log(`[dry-run] would write ${rows.length} rows to ${file}`);
    return;
  }
  fs.writeFileSync(target, body);
}

// --- entities.jsonl ---
const entities = readJsonl<Entity>('entities.jsonl');
const survivorIdx = entities.findIndex((e) => e.id === SURVIVOR);
const removedIdx = entities.findIndex((e) => e.id === REMOVED);
if (survivorIdx < 0 || removedIdx < 0) {
  console.error(`Missing entity: survivor=${survivorIdx} removed=${removedIdx}`);
  process.exit(1);
}
const survivor = entities[survivorIdx];
const removed = entities[removedIdx];

// Union refs by chunk_id, keep highest confidence
const refMap = new Map<string, Ref>();
for (const r of [...survivor.references, ...removed.references]) {
  const prev = refMap.get(r.chunk_id);
  if (!prev || r.confidence > prev.confidence) refMap.set(r.chunk_id, r);
}
const mergedRefs = [...refMap.values()].sort((a, b) => a.chunk_id.localeCompare(b.chunk_id));

const disputed = new Set<string>([
  ...((survivor.meta?.disputed_types as string[] | undefined) ?? []),
  ...((removed.meta?.disputed_types as string[] | undefined) ?? []),
  survivor.type,
  removed.type,
]);

const merged: Entity = {
  ...survivor,
  type: 'code-symbol', // 3 refs (removed) + 1 ref (survivor); code-symbol wins by weight, matches loop.ts pattern
  aliases: Array.from(new Set([...survivor.aliases, 'telegram.ts'])),
  references: mergedRefs,
  last_referenced: survivor.last_referenced > removed.last_referenced ? survivor.last_referenced : removed.last_referenced,
  meta: {
    ...(survivor.meta ?? {}),
    disputed_types: [...disputed].filter((t) => t !== 'code-symbol'),
    merged_from: [REMOVED],
    merged_at: new Date().toISOString(),
  },
};

const nextEntities = entities.filter((e) => e.id !== REMOVED);
nextEntities[nextEntities.findIndex((e) => e.id === SURVIVOR)] = merged;

// --- entities-resolved.jsonl ---
const resolved = readJsonl<Entity>('entities-resolved.jsonl');
const nextResolved = resolved.filter((e) => e.id !== REMOVED);
const resolvedSurvivor = nextResolved.find((e) => e.id === SURVIVOR);
if (resolvedSurvivor) {
  Object.assign(resolvedSurvivor, merged, {
    resolved_type: 'code-symbol',
    resolution_rule: 'R8-basename-merge',
    resolution_confidence: 'high',
    alternatives: ['artifact'],
  });
}

// --- edges.jsonl ---
const edgesRaw = fs.readFileSync(path.join(INDEX_DIR, 'edges.jsonl'), 'utf8');
const edgeLines = edgesRaw.split('\n').filter(Boolean);
let edgeRewrites = 0;
const nextEdges = edgeLines.map((line) => {
  const obj = JSON.parse(line);
  if (obj.from !== REMOVED && obj.to !== REMOVED) return line;
  edgeRewrites++;
  if (obj.from === REMOVED) obj.from = SURVIVOR;
  if (obj.to === REMOVED) obj.to = SURVIVOR;
  return JSON.stringify(obj);
});

// --- chunk-entity-index.jsonl ---
const chunkRaw = fs.readFileSync(path.join(INDEX_DIR, 'chunk-entity-index.jsonl'), 'utf8');
const chunkLines = chunkRaw.split('\n').filter(Boolean);
let chunkRewrites = 0;
const nextChunks = chunkLines.map((line) => {
  const obj = JSON.parse(line);
  const hasRemoved =
    obj.entity_id === REMOVED ||
    (Array.isArray(obj.entity_ids) && obj.entity_ids.includes(REMOVED));
  if (!hasRemoved) return line;
  chunkRewrites++;
  if (Array.isArray(obj.entity_ids)) {
    obj.entity_ids = Array.from(new Set(obj.entity_ids.map((id: string) => (id === REMOVED ? SURVIVOR : id))));
  }
  if (obj.entity_id === REMOVED) obj.entity_id = SURVIVOR;
  return JSON.stringify(obj);
});

console.log(JSON.stringify({
  merged_entity: merged.id,
  canonical: merged.canonical_name,
  aliases: merged.aliases,
  refs: merged.references.length,
  entities_removed: 1,
  edges_rewritten: edgeRewrites,
  chunk_index_rewritten: chunkRewrites,
  dry_run: DRY_RUN,
}, null, 2));

writeJsonl('entities.jsonl', nextEntities);
writeJsonl('entities-resolved.jsonl', nextResolved);
if (!DRY_RUN) {
  fs.writeFileSync(path.join(INDEX_DIR, 'edges.jsonl'), nextEdges.join('\n') + '\n');
  fs.writeFileSync(path.join(INDEX_DIR, 'chunk-entity-index.jsonl'), nextChunks.join('\n') + '\n');
} else {
  console.log(`[dry-run] would rewrite ${edgeRewrites} edges + ${chunkRewrites} chunk-entity-index rows`);
}
