/**
 * Edge Builder — turns LLM-extracted edge candidates into EdgeRecord[].
 *
 * Constraint Texture: code does floor enforcement, dedup, id resolution. LLM
 * does relation classification + evidence quoting. The builder never invents
 * relationships and never relaxes a floor.
 *
 * Resolution requires entities already in the registry (run entity ingestion
 * first). Unresolved candidates are returned in `unresolved` for diagnostics
 * — they're not silently dropped.
 *
 * Dedup key: (from, to, type). Multiple candidates collapse to the highest
 * confidence; evidence_quote and chunk_id of the winner are kept.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  DEFAULT_EDGE_FLOOR,
  EDGE_TYPES,
  EDGE_TYPE_FLOORS,
  KG_PATHS,
  type EdgeRecord,
  type EdgeType,
} from './kg-types.js';
import { findExisting, type Registry, type EntityCandidate } from './kg-entity-registry.js';

// ─── Candidate shape (LLM output) ───

export interface EdgeCandidate {
  /** Resolution probe: canonical_name OR alias of the source entity. */
  from: string;
  /** Resolution probe: canonical_name OR alias of the target entity. */
  to: string;
  type: EdgeType;
  confidence: number;
  /** Chunk that grounds this edge — required (no phrase, no typed edge rule). */
  evidence_chunk_id: string;
  /** ≤200 chars; specific phrase justifying the type (CT enforcement). */
  evidence_quote?: string;
  /** Defaults to 'llm'. */
  detector?: 'rule' | 'llm';
}

export interface BuildEdgesStats {
  candidates: number;
  kept: number;
  droppedBelowFloor: number;
  droppedUnresolved: number;
  droppedMalformed: number;
  collapsedDuplicates: number;
}

export interface BuildEdgesResult {
  edges: EdgeRecord[];
  unresolved: Array<{ candidate: EdgeCandidate; reason: 'from_missing' | 'to_missing' | 'both_missing' }>;
  stats: BuildEdgesStats;
}

// ─── Floor lookup ───

function floorFor(type: EdgeType): number {
  return EDGE_TYPE_FLOORS[type] ?? DEFAULT_EDGE_FLOOR;
}

// ─── Resolution (read-only against registry) ───

function probeAsCandidate(probe: string): EntityCandidate {
  // findExisting only uses canonical_name + aliases for matching;
  // type/subtype are required by the interface but not by lookup logic.
  return { canonical_name: probe, type: 'concept' };
}

function resolveProbe(reg: Registry, probe: string): string | undefined {
  const found = findExisting(reg, probeAsCandidate(probe));
  return found?.id;
}

// ─── Validation ───

function isValid(c: EdgeCandidate): boolean {
  if (!c.from || !c.to || !c.type) return false;
  if (typeof c.confidence !== 'number') return false;
  if (c.confidence < 0 || c.confidence > 1) return false;
  if (!EDGE_TYPES.includes(c.type)) return false;
  if (!c.evidence_chunk_id) return false;
  return true;
}

// ─── Build ───

export function buildEdges(
  candidates: EdgeCandidate[],
  reg: Registry,
  now: string,
): BuildEdgesResult {
  const stats: BuildEdgesStats = {
    candidates: candidates.length,
    kept: 0,
    droppedBelowFloor: 0,
    droppedUnresolved: 0,
    droppedMalformed: 0,
    collapsedDuplicates: 0,
  };
  const unresolved: BuildEdgesResult['unresolved'] = [];

  // Group by dedup key, keep highest confidence.
  const byKey = new Map<string, EdgeRecord>();

  for (const c of candidates) {
    if (!isValid(c)) {
      stats.droppedMalformed++;
      continue;
    }

    if (c.confidence < floorFor(c.type)) {
      stats.droppedBelowFloor++;
      continue;
    }

    const fromId = resolveProbe(reg, c.from);
    const toId = resolveProbe(reg, c.to);
    if (!fromId || !toId) {
      stats.droppedUnresolved++;
      const reason: 'from_missing' | 'to_missing' | 'both_missing' =
        !fromId && !toId ? 'both_missing' : !fromId ? 'from_missing' : 'to_missing';
      unresolved.push({ candidate: c, reason });
      continue;
    }

    // Self-loop guard — no semantic value, easily LLM artifact.
    if (fromId === toId) {
      stats.droppedMalformed++;
      continue;
    }

    const key = `${fromId}\t${toId}\t${c.type}`;
    const existing = byKey.get(key);
    if (existing) {
      stats.collapsedDuplicates++;
      if (c.confidence > existing.confidence) {
        existing.confidence = c.confidence;
        existing.evidence_chunk_id = c.evidence_chunk_id;
        if (c.evidence_quote) existing.evidence_quote = c.evidence_quote;
        existing.detector = c.detector ?? 'llm';
      }
      continue;
    }

    const rec: EdgeRecord = {
      from: fromId,
      to: toId,
      type: c.type,
      confidence: c.confidence,
      detector: c.detector ?? 'llm',
      evidence_chunk_id: c.evidence_chunk_id,
      ...(c.evidence_quote ? { evidence_quote: c.evidence_quote } : {}),
      created: now,
    };
    byKey.set(key, rec);
  }

  // Stable order: from, to, type. Reviewable diffs.
  const edges = [...byKey.values()].sort((a, b) => {
    if (a.from !== b.from) return a.from.localeCompare(b.from);
    if (a.to !== b.to) return a.to.localeCompare(b.to);
    return a.type.localeCompare(b.type);
  });

  stats.kept = edges.length;
  return { edges, unresolved, stats };
}

// ─── Persist ───

export function persistEdges(edges: EdgeRecord[], path = KG_PATHS.edges): void {
  mkdirSync(dirname(path), { recursive: true });
  const payload = edges.map((e) => JSON.stringify(e)).join('\n') + (edges.length ? '\n' : '');
  writeFileSync(path, payload);
}
