/**
 * Ingest pipeline — chunks → (LLM) → registry → entities.jsonl + edges.jsonl.
 *
 * Pure orchestration. LLM functions are injected so this module is unit-testable
 * without API calls. Kuro's `kg-entity-prompt.ts` and `kg-edge-prompt.ts` plug
 * in via the EntityExtractor / EdgeClassifier interfaces.
 *
 * Pipeline:
 *   1. For each chunk → extractor returns EntityCandidate[]
 *   2. registry.resolveOrCreate per candidate → builds entities + maps chunk_id
 *      to resolved entity ids
 *   3. For each chunk → classifier returns EdgeCandidate[] (probes by name)
 *   4. buildEdges resolves probes → registry ids, applies floors & dedup
 *   5. persistRegistry + persistEdges
 *
 * Skipped chunks: heading / frontmatter / code_block bypass extractor (Kuro's
 * cost gate decision — these rarely contain semantic entities and would burn
 * tokens for nothing). Override via `extractFromAllTypes: true` for ablation.
 */

import type { ChunkRecord } from './kg-types.js';
import {
  type Registry,
  type EntityCandidate,
  resolveOrCreate,
  emptyRegistry,
} from './kg-entity-registry.js';
import {
  type EdgeCandidate,
  buildEdges,
  type BuildEdgesResult,
} from './kg-edge-builder.js';

// ─── Injected LLM contracts ───

export type EntityExtractor = (chunk: ChunkRecord) => Promise<EntityCandidate[]>;
export type EdgeClassifier = (chunk: ChunkRecord, entityIds: string[]) => Promise<EdgeCandidate[]>;

// Default skipped types (Kuro's cost gate).
const DEFAULT_SKIP_TYPES = new Set<ChunkRecord['type']>(['heading', 'frontmatter', 'code_block']);

export interface IngestOptions {
  extractor: EntityExtractor;
  classifier: EdgeClassifier;
  /** Override skip set; default skips heading/frontmatter/code_block. */
  skipChunkTypes?: Set<ChunkRecord['type']>;
  /** When true, skipChunkTypes is ignored (run extractor/classifier on all chunks). */
  extractFromAllTypes?: boolean;
  /** ISO timestamp; tests pass a fixed value for determinism. */
  now?: string;
  /** Existing registry to extend; default starts empty. */
  baseRegistry?: Registry;
  /** Concurrent chunk processing (LLM dispatch). Default 1 (sequential). */
  concurrency?: number;
  /** Per-batch progress callback. */
  onChunkProcessed?: (i: number, total: number) => void;
}

export interface IngestResult {
  registry: Registry;
  edges: BuildEdgesResult;
  stats: {
    chunksTotal: number;
    chunksProcessed: number;
    chunksSkipped: number;
    entitiesCreated: number;
    entitiesEnriched: number;
  };
}

// ─── Driver ───

export async function ingest(
  chunks: ChunkRecord[],
  opts: IngestOptions,
): Promise<IngestResult> {
  const now = opts.now ?? new Date().toISOString();
  const skip = opts.extractFromAllTypes ? new Set<ChunkRecord['type']>() : (opts.skipChunkTypes ?? DEFAULT_SKIP_TYPES);
  const registry = opts.baseRegistry ?? emptyRegistry();
  const concurrency = Math.max(1, opts.concurrency ?? 1);

  let processed = 0;
  let skipped = 0;
  let created = 0;
  let enriched = 0;

  // Phase 1: entity extraction. Per-chunk entity ids retained for phase 2.
  const chunkToEntityIds = new Map<string, string[]>();

  // Sequential or bounded-concurrency dispatch.
  const eligible = chunks.filter((c) => {
    if (skip.has(c.type)) {
      skipped++;
      return false;
    }
    return true;
  });

  await runWithConcurrency(eligible, concurrency, async (chunk) => {
    const candidates = await opts.extractor(chunk);
    const ids: string[] = [];
    for (const cand of candidates) {
      const r = resolveOrCreate(registry, cand, chunk.id, now);
      if (r.created) created++;
      else if (r.enriched) enriched++;
      ids.push(r.id);
    }
    chunkToEntityIds.set(chunk.id, ids);
    processed++;
    opts.onChunkProcessed?.(processed, eligible.length);
  });

  // Phase 2: edge classification. Only chunks with ≥2 entities are worth probing.
  const allEdgeCandidates: EdgeCandidate[] = [];
  await runWithConcurrency(eligible, concurrency, async (chunk) => {
    const ids = chunkToEntityIds.get(chunk.id) ?? [];
    if (ids.length < 2) return;
    const cands = await opts.classifier(chunk, ids);
    allEdgeCandidates.push(...cands);
  });

  const edges = buildEdges(allEdgeCandidates, registry, now);

  return {
    registry,
    edges,
    stats: {
      chunksTotal: chunks.length,
      chunksProcessed: processed,
      chunksSkipped: skipped,
      entitiesCreated: created,
      entitiesEnriched: enriched,
    },
  };
}

// ─── No-op extractor for smoke tests / dry runs ───

export const noopExtractor: EntityExtractor = async () => [];
export const noopClassifier: EdgeClassifier = async () => [];

// ─── Tiny pool ───

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  if (limit === 1) {
    for (const item of items) await fn(item);
    return;
  }
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}
