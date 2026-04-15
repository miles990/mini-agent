/**
 * Entity Registry — deterministic resolution layer.
 *
 * Bridges LLM-extracted candidates (semantic) and entities.jsonl (storage).
 * Pure functions where possible; the only IO is load/persist.
 *
 * Constraint Texture: code does dedup, alias normalization, id assignment,
 * collision-handling. LLM does the upstream extraction (canonical_name + type
 * + aliases inferred from chunk text). The registry never invents semantics.
 *
 * Id derivation: ent-<kebab(canonical_name)>. Type-independent so a later
 * reclassification (e.g. concept → decision via promoted_to) preserves identity.
 * On slug collision with different canonical_name, append numeric suffix.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import {
  ENTITY_TYPES,
  KG_PATHS,
  type EntityRecord,
  type EntityType,
} from './kg-types.js';

// ─── Slug normalization ───

/** Kebab-case slug. Lowercase, alphanumeric + hyphens, collapse repeats, trim. */
export function kebabSlug(input: string): string {
  return input
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

/** Normalize an alias for matching (case-insensitive, whitespace-collapsed). */
function normalizeAlias(alias: string): string {
  return alias.trim().toLowerCase().replace(/\s+/g, ' ');
}

// ─── Registry shape ───

export interface Registry {
  /** entity id → record */
  byId: Map<string, EntityRecord>;
  /** normalized alias / canonical_name → entity id (first wins on collision) */
  aliasIndex: Map<string, string>;
}

export function emptyRegistry(): Registry {
  return { byId: new Map(), aliasIndex: new Map() };
}

// ─── Load / persist ───

export function loadRegistry(path = KG_PATHS.entities): Registry {
  const reg = emptyRegistry();
  if (!existsSync(path)) return reg;
  const raw = readFileSync(path, 'utf-8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec: EntityRecord;
    try {
      rec = JSON.parse(trimmed) as EntityRecord;
    } catch {
      continue;
    }
    if (!rec.id || !rec.canonical_name || !rec.type) continue;
    insertIntoIndex(reg, rec);
  }
  return reg;
}

function insertIntoIndex(reg: Registry, rec: EntityRecord): void {
  reg.byId.set(rec.id, rec);
  reg.aliasIndex.set(normalizeAlias(rec.canonical_name), rec.id);
  for (const alias of rec.aliases ?? []) {
    const key = normalizeAlias(alias);
    if (!reg.aliasIndex.has(key)) reg.aliasIndex.set(key, rec.id);
  }
}

export function persistRegistry(reg: Registry, path = KG_PATHS.entities): void {
  mkdirSync(dirname(path), { recursive: true });
  // Stable ordering: by first_seen, then id. Makes diffs reviewable.
  const records = [...reg.byId.values()].sort((a, b) => {
    if (a.first_seen !== b.first_seen) return a.first_seen.localeCompare(b.first_seen);
    return a.id.localeCompare(b.id);
  });
  const payload = records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : '');
  writeFileSync(path, payload);
}

// ─── Resolution ───

export interface EntityCandidate {
  canonical_name: string;
  type: EntityType;
  subtype?: string;
  aliases?: string[];
  meta?: Record<string, unknown>;
  /** ≤120 chars verbatim phrase from chunk that grounds this entity. Optional — */
  /** seeded entries (frontmatter, etc.) have no span. */
  span?: string;
  /** LLM extraction confidence [0, 1]. Carried into references entry. */
  confidence?: number;
}

export interface ResolveResult {
  id: string;
  created: boolean;
  /** True when an existing entity's record was mutated (alias added, type widened). */
  enriched: boolean;
}

/**
 * Try to find an existing entity by canonical_name or any alias.
 * Returns undefined if no match.
 */
export function findExisting(reg: Registry, candidate: EntityCandidate): EntityRecord | undefined {
  const probes = [candidate.canonical_name, ...(candidate.aliases ?? [])];
  for (const probe of probes) {
    const id = reg.aliasIndex.get(normalizeAlias(probe));
    if (id) return reg.byId.get(id);
  }
  return undefined;
}

/**
 * Allocate a fresh entity id. Slug collision → numeric suffix.
 * Caller has already verified `findExisting` returned undefined.
 */
function assignNewId(reg: Registry, canonical_name: string): string {
  const base = `ent-${kebabSlug(canonical_name)}`;
  if (!reg.byId.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!reg.byId.has(candidate)) return candidate;
  }
  throw new Error(`assignNewId: exhausted suffix range for ${base}`);
}

/**
 * Resolve a candidate into the registry. Mutates `reg` in place.
 *
 * - If found: append new aliases (dedupe), update last_referenced, append chunk_id to references.
 * - If not found: create EntityRecord, insert.
 *
 * Type widening / collision: if found entity has a different `type`, the
 * candidate's type is recorded in `meta.disputed_types` rather than overwriting —
 * surfaces the conflict to the conflict detector (CC#3) without losing data.
 */
export function resolveOrCreate(
  reg: Registry,
  candidate: EntityCandidate,
  chunk_id: string,
  now: string,
): ResolveResult {
  if (!ENTITY_TYPES.includes(candidate.type)) {
    throw new Error(`resolveOrCreate: unknown entity type "${candidate.type}"`);
  }

  const existing = findExisting(reg, candidate);
  if (existing) {
    let enriched = false;

    // Append new aliases.
    const knownAliases = new Set(existing.aliases.map(normalizeAlias));
    knownAliases.add(normalizeAlias(existing.canonical_name));
    for (const alias of candidate.aliases ?? []) {
      const key = normalizeAlias(alias);
      if (!knownAliases.has(key)) {
        existing.aliases.push(alias);
        reg.aliasIndex.set(key, existing.id);
        knownAliases.add(key);
        enriched = true;
      }
    }

    // Type drift → record but don't overwrite.
    if (existing.type !== candidate.type) {
      const meta = (existing.meta ??= {});
      const disputed = (meta.disputed_types as string[] | undefined) ?? [];
      if (!disputed.includes(candidate.type)) {
        disputed.push(candidate.type);
        meta.disputed_types = disputed;
        enriched = true;
      }
    }

    // subtype refinement: only set if missing.
    if (candidate.subtype && !existing.subtype) {
      existing.subtype = candidate.subtype;
      enriched = true;
    }

    // Reference tracking — dedupe on chunk_id.
    if (!existing.references.some((r) => r.chunk_id === chunk_id)) {
      existing.references.push({
        chunk_id,
        ...(candidate.span ? { span: candidate.span } : {}),
        ...(typeof candidate.confidence === 'number' ? { confidence: candidate.confidence } : {}),
      });
      enriched = true;
    }

    if (now > existing.last_referenced) {
      existing.last_referenced = now;
      enriched = true;
    }

    return { id: existing.id, created: false, enriched };
  }

  // Create new.
  const id = assignNewId(reg, candidate.canonical_name);
  const aliases = [...new Set((candidate.aliases ?? []).map((a) => a.trim()).filter(Boolean))];
  const rec: EntityRecord = {
    id,
    type: candidate.type,
    ...(candidate.subtype ? { subtype: candidate.subtype } : {}),
    canonical_name: candidate.canonical_name,
    aliases,
    first_seen: now,
    last_referenced: now,
    references: [{
      chunk_id,
      ...(candidate.span ? { span: candidate.span } : {}),
      ...(typeof candidate.confidence === 'number' ? { confidence: candidate.confidence } : {}),
    }],
    ...(candidate.meta ? { meta: { ...candidate.meta } } : {}),
  };
  insertIntoIndex(reg, rec);
  return { id, created: true, enriched: false };
}

// ─── Stats (for ingest reports) ───

export interface RegistryStats {
  total: number;
  byType: Record<string, number>;
  withDisputedTypes: number;
}

export function summarize(reg: Registry): RegistryStats {
  const byType: Record<string, number> = {};
  let disputed = 0;
  for (const rec of reg.byId.values()) {
    byType[rec.type] = (byType[rec.type] ?? 0) + 1;
    if (rec.meta?.disputed_types) disputed++;
  }
  return { total: reg.byId.size, byType, withDisputedTypes: disputed };
}
