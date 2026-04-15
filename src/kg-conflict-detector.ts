/**
 * Conflict Detector — surfaces inconsistencies in entities.jsonl + edges.jsonl.
 *
 * Pure deterministic rules. LLM-driven conflict reasoning (semantic
 * contradictions in claims) is a Phase 3 follow-on; this file handles the
 * mechanical surface conflicts that emerge from registry resolution:
 *
 *   1. Type disputes — entity has meta.disputed_types (resolveOrCreate already
 *      detected the disagreement; we materialize it as a ConflictRecord).
 *   2. Alias collisions — distinct entities sharing a normalized alias. The
 *      registry's first-wins index hides the second one; we surface it here.
 *
 * Edge conflicts (e.g. supports vs contradicts on same A/B pair) are detected
 * once edges.jsonl exists.
 */

import { existsSync, readFileSync } from 'node:fs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  KG_PATHS,
  type ConflictRecord,
  type EdgeRecord,
  type EntityRecord,
} from './kg-types.js';

// ─── Loaders ───

export function loadEntities(path = KG_PATHS.entities): EntityRecord[] {
  if (!existsSync(path)) return [];
  const out: EntityRecord[] = [];
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch { /* skip */ }
  }
  return out;
}

export function loadEdges(path = KG_PATHS.edges): EdgeRecord[] {
  if (!existsSync(path)) return [];
  const out: EdgeRecord[] = [];
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch { /* skip */ }
  }
  return out;
}

// ─── Detection rules ───

function normalizeAlias(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Type disputes: entity.meta.disputed_types is non-empty. Separate from
 * claim_conflict — type dispute and claim dispute have different resolution paths.
 */
export function detectTypeDisputes(entities: EntityRecord[], now: string): ConflictRecord[] {
  const out: ConflictRecord[] = [];
  let n = 1;
  for (const e of entities) {
    const disputed = e.meta?.disputed_types as string[] | undefined;
    if (!disputed || disputed.length === 0) continue;

    const sources = e.references.slice(0, 5).map((r) => ({
      chunk_id: r.chunk_id,
      ...(r.span ? { claim: `${e.type}: ${r.span}` } : {}),
    }));

    out.push({
      id: `conf-type-${n++}`,
      type: 'type_conflict',
      entities: [e.id],
      sources,
      detector: 'rule',
      detected_at: now,
      status: 'pending',
      resolution: `competing types: registered=${e.type}, disputed=${disputed.join(',')}`,
    });
  }
  return out;
}

/**
 * Alias collision: a normalized alias maps to multiple distinct entity ids
 * across all entities (canonical_name + aliases). Surfaces what registry
 * first-wins index hides.
 */
export function detectAliasCollisions(entities: EntityRecord[], now: string): ConflictRecord[] {
  const aliasOwners = new Map<string, Set<string>>();
  for (const e of entities) {
    const surfaces = [e.canonical_name, ...e.aliases];
    for (const s of surfaces) {
      const key = normalizeAlias(s);
      if (!key) continue;
      const set = aliasOwners.get(key) ?? new Set();
      set.add(e.id);
      aliasOwners.set(key, set);
    }
  }

  const out: ConflictRecord[] = [];
  let n = 1;
  for (const [alias, owners] of aliasOwners) {
    if (owners.size < 2) continue;
    const ids = [...owners].sort();
    out.push({
      id: `conf-alias-${n++}`,
      type: 'alias_collision',
      entities: ids,
      sources: [],
      detector: 'rule',
      detected_at: now,
      status: 'pending',
      resolution: `alias "${alias}" claimed by ${ids.length} entities`,
    });
  }
  return out;
}

/**
 * Edge conflict: same (from, to) pair carries both `supports` and `contradicts`.
 * High-signal — usually a real disagreement worth surfacing to Alex.
 */
export function detectEdgeConflicts(edges: EdgeRecord[], now: string): ConflictRecord[] {
  const byPair = new Map<string, Map<string, EdgeRecord>>();
  for (const e of edges) {
    const key = `${e.from}\t${e.to}`;
    const types = byPair.get(key) ?? new Map();
    types.set(e.type, e);
    byPair.set(key, types);
  }

  const out: ConflictRecord[] = [];
  let n = 1;
  for (const [pair, types] of byPair) {
    const supportEdge = types.get('supports');
    const contraEdge = types.get('contradicts');
    if (!supportEdge || !contraEdge) continue;
    const [from, to] = pair.split('\t');
    out.push({
      id: `conf-edge-${n++}`,
      type: 'edge_conflict',
      entities: [from, to],
      sources: [
        { chunk_id: supportEdge.evidence_chunk_id, claim: `supports: ${supportEdge.evidence_quote ?? ''}` },
        { chunk_id: contraEdge.evidence_chunk_id, claim: `contradicts: ${contraEdge.evidence_quote ?? ''}` },
      ],
      detector: 'rule',
      detected_at: now,
      status: 'pending',
      resolution: `same pair has both supports and contradicts edges`,
    });
  }
  return out;
}

// ─── Driver + persist ───

export interface DetectStats {
  typeDisputes: number;
  aliasCollisions: number;
  edgeConflicts: number;
  total: number;
}

export interface DetectResult {
  conflicts: ConflictRecord[];
  stats: DetectStats;
}

export function detectConflicts(
  entities: EntityRecord[],
  edges: EdgeRecord[],
  now: string,
): DetectResult {
  const types = detectTypeDisputes(entities, now);
  const aliases = detectAliasCollisions(entities, now);
  const edgeConflicts = detectEdgeConflicts(edges, now);
  return {
    conflicts: [...types, ...aliases, ...edgeConflicts],
    stats: {
      typeDisputes: types.length,
      aliasCollisions: aliases.length,
      edgeConflicts: edgeConflicts.length,
      total: types.length + aliases.length + edgeConflicts.length,
    },
  };
}

export function persistConflicts(conflicts: ConflictRecord[], path = KG_PATHS.conflicts): void {
  mkdirSync(dirname(path), { recursive: true });
  const payload = conflicts.map((c) => JSON.stringify(c)).join('\n') + (conflicts.length ? '\n' : '');
  writeFileSync(path, payload);
}
