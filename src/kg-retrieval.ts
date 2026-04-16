/**
 * KG Retrieval Augmentation (Path A)
 *
 * Expands FTS5 search with KG entity relationships.
 * Loads entities + edges into memory (small: ~411 entities, ~4K edges).
 * Given a query, finds matching entities by name/alias, walks 1-hop neighbors,
 * and returns neighbor names as additional search terms for FTS5.
 *
 * Feature-flagged: `kg-retrieval-augment` (default OFF).
 * When OFF, all exports are no-ops — zero overhead.
 *
 * Design: memory/proposals/2026-04-15-kg-internalization.md (Path A)
 */

import fs from 'node:fs';
import path from 'node:path';
import { KG_PATHS, type EntityRecord, type EdgeRecord } from './kg-types.js';
import { isEnabled } from './features.js';
import { slog } from './utils.js';

// ─── In-memory index ───

/** Stop words — too common to be useful as entity-matching tokens */
const TOKEN_STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'has', 'was',
  'is', 'it', 'in', 'to', 'of', 'on', 'at', 'an', 'or', 'if', 'no', 'so',
  'do', 'my', 'up', 'this', 'that', 'with', 'from', 'have', 'been', 'will',
]);

interface KGSearchIndex {
  entities: Map<string, EntityRecord>;
  /** lowercase full canonical_name or alias → entity id */
  nameToId: Map<string, string>;
  /** lowercase individual token (from entity names) → entity ids */
  tokenToIds: Map<string, Set<string>>;
  /** entity id → outgoing edges */
  adjacency: Map<string, Array<{ to: string; weight: number; type: string }>>;
  loadedAt: number;
  entityCount: number;
  edgeCount: number;
}

let _cache: KGSearchIndex | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min — matches prompt cache TTL

// ─── Index loading ───

function loadIndex(memoryDir: string): KGSearchIndex {
  const entitiesPath = path.resolve(memoryDir, 'index/entities.jsonl');
  const edgesPath = path.resolve(memoryDir, 'index/edges.jsonl');

  const entities = new Map<string, EntityRecord>();
  const nameToId = new Map<string, string>();
  const tokenToIds = new Map<string, Set<string>>();
  const adjacency = new Map<string, Array<{ to: string; weight: number; type: string }>>();

  /** Tokenize a name into searchable words */
  function tokenize(name: string): string[] {
    return name.toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 2 && !TOKEN_STOP_WORDS.has(t));
  }

  /** Index a name (full + tokens) for an entity */
  function indexName(name: string, entityId: string): void {
    const lower = name.toLowerCase().trim();
    if (lower.length >= 2) nameToId.set(lower, entityId);
    for (const token of tokenize(name)) {
      if (!tokenToIds.has(token)) tokenToIds.set(token, new Set());
      tokenToIds.get(token)!.add(entityId);
    }
  }

  // Load entities
  let entityCount = 0;
  if (fs.existsSync(entitiesPath)) {
    const raw = fs.readFileSync(entitiesPath, 'utf-8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entity = JSON.parse(line) as EntityRecord;
        entities.set(entity.id, entity);
        indexName(entity.canonical_name, entity.id);
        for (const alias of entity.aliases) {
          indexName(alias, entity.id);
        }
        entityCount++;
      } catch { /* skip malformed */ }
    }
  }

  // Load edges (bidirectional — walk both from→to and to→from)
  let edgeCount = 0;
  if (fs.existsSync(edgesPath)) {
    const raw = fs.readFileSync(edgesPath, 'utf-8');
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const edge = JSON.parse(line) as EdgeRecord;
        const w = edge.weight ?? edge.confidence;
        // Forward edge
        if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
        adjacency.get(edge.from)!.push({ to: edge.to, weight: w, type: edge.type });
        // Reverse edge (for bidirectional walking)
        if (!adjacency.has(edge.to)) adjacency.set(edge.to, []);
        adjacency.get(edge.to)!.push({ to: edge.from, weight: w, type: edge.type });
        edgeCount++;
      } catch { /* skip malformed */ }
    }
  }

  slog('KG-RETRIEVAL', `Index loaded: ${entityCount} entities, ${edgeCount} edges, ${nameToId.size} names, ${tokenToIds.size} tokens`);
  return { entities, nameToId, tokenToIds, adjacency, loadedAt: Date.now(), entityCount, edgeCount };
}

function ensureCache(memoryDir: string): KGSearchIndex | null {
  if (_cache && Date.now() - _cache.loadedAt < CACHE_TTL_MS) return _cache;

  try {
    _cache = loadIndex(memoryDir);
    return _cache;
  } catch (err) {
    slog('KG-RETRIEVAL', `Index load failed: ${err}`);
    return null;
  }
}

// ─── Query expansion ───

/** Weight threshold — edges at or above this are walked. */
const WALK_WEIGHT_THRESHOLD = 0.3;

/** Max neighbors to collect per matched entity (prevents noise from highly-connected nodes). */
const MAX_NEIGHBORS_PER_ENTITY = 5;

/** Max additional terms to return — caps FTS5 query growth. */
const MAX_EXPANSION_TERMS = 10;

/**
 * Expand a search query using KG entity relationships.
 *
 * 1. Match query words/phrases against entity canonical_names and aliases
 * 2. Walk 1-hop neighbors (weight > 0.3)
 * 3. Return neighbor canonical_names as additional FTS5 search terms
 *
 * Returns empty array when feature flag is off or no matches found.
 */
export function kgExpandQuery(query: string, memoryDir: string): string[] {
  if (!isEnabled('kg-retrieval-augment')) return [];

  const cache = ensureCache(memoryDir);
  if (!cache || cache.entityCount === 0) return [];

  const words = query.toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2 && !TOKEN_STOP_WORDS.has(w));
  if (words.length === 0) return [];

  // Phase 1: match query → entities
  const matchedIds = new Set<string>();

  // Try full phrase match first (most specific)
  const fullPhrase = words.join(' ');
  const fullMatch = cache.nameToId.get(fullPhrase);
  if (fullMatch) matchedIds.add(fullMatch);

  // Multi-word phrase matches (2-4 tokens)
  for (let len = Math.min(words.length, 4); len >= 2; len--) {
    for (let i = 0; i <= words.length - len; i++) {
      const phrase = words.slice(i, i + len).join(' ');
      const id = cache.nameToId.get(phrase);
      if (id) matchedIds.add(id);
    }
  }

  // Single word exact name matches
  for (const word of words) {
    const id = cache.nameToId.get(word);
    if (id) matchedIds.add(id);
  }

  // Token-based matches: find entities whose name contains query tokens
  // Only use tokens that appear in ≤ 20 entities to avoid noise
  for (const word of words) {
    const ids = cache.tokenToIds.get(word);
    if (ids && ids.size <= 20) {
      for (const id of ids) matchedIds.add(id);
    }
  }

  if (matchedIds.size === 0) return [];

  // Phase 2: walk 1-hop neighbors (weight >= threshold)
  // Prefer semantic edges (non-mentions) over co-occurrence; cap per entity to reduce noise
  const neighborIds = new Set<string>();
  for (const eid of matchedIds) {
    const neighbors = cache.adjacency.get(eid) || [];
    // Sort: semantic edges first (non-mentions), then by weight descending
    const sorted = [...neighbors]
      .filter(n => n.weight >= WALK_WEIGHT_THRESHOLD && !matchedIds.has(n.to))
      .sort((a, b) => {
        const aScore = a.type !== 'mentions' ? 1 : 0;
        const bScore = b.type !== 'mentions' ? 1 : 0;
        return bScore - aScore || b.weight - a.weight;
      });
    let added = 0;
    for (const n of sorted) {
      if (added >= MAX_NEIGHBORS_PER_ENTITY) break;
      if (!neighborIds.has(n.to)) {
        neighborIds.add(n.to);
        added++;
      }
    }
  }

  if (neighborIds.size === 0) return [];

  // Phase 3: collect neighbor names as expansion terms
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const nid of neighborIds) {
    const entity = cache.entities.get(nid);
    if (!entity) continue;
    const name = entity.canonical_name.toLowerCase().trim();
    if (name.length >= 2 && !seen.has(name)) {
      terms.push(entity.canonical_name); // preserve original casing for FTS5
      seen.add(name);
    }
  }

  return terms.slice(0, MAX_EXPANSION_TERMS);
}

/**
 * Get matched entity IDs for a query (for diagnostics / logging).
 */
export function kgMatchEntities(query: string, memoryDir: string): string[] {
  if (!isEnabled('kg-retrieval-augment')) return [];

  const cache = ensureCache(memoryDir);
  if (!cache) return [];

  const words = query.toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2 && !TOKEN_STOP_WORDS.has(w));
  const matchedIds: string[] = [];

  for (const word of words) {
    // Exact name match
    const id = cache.nameToId.get(word);
    if (id && !matchedIds.includes(id)) matchedIds.push(id);
    // Token match
    const ids = cache.tokenToIds.get(word);
    if (ids && ids.size <= 20) {
      for (const tid of ids) {
        if (!matchedIds.includes(tid)) matchedIds.push(tid);
      }
    }
  }

  return matchedIds;
}

/** Invalidate cache (for testing or after KG rebuild). */
export function invalidateKGCache(): void {
  _cache = null;
}
