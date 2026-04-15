/**
 * Knowledge Graph Schema — v0
 *
 * Schema locked 2026-04-15 between Kuro and Claude Code.
 * Source: memory/proposals/2026-04-15-knowledge-graph.md (CCs)
 *       + memory/proposals/2026-04-15-edge-type-dict-v0.md (edge dict)
 *       + room messages 2026-04-15 #016-034 (entity dict + alignment)
 *
 * Storage: memory/index/* (gitignored, fully rebuildable from raw markdown)
 * Reversibility: rm -rf memory/index/<these files> = clean revert
 */

// =============================================================================
// Entity dictionary (9 types — see room #032 for definitions)
// =============================================================================

export const ENTITY_TYPES = [
  'actor',        // human, AI agent, external org (subtype: human|agent|org)
  'concept',      // abstract idea, principle, method, theory
  'project',      // named software system / product
  'tool',         // third-party software/service
  'artifact',     // identifiable concrete output (PR, issue, doc, commit)
  'code-symbol',  // function, file, module, class
  'event',        // bounded happening in time
  'claim',        // truth-bearing assertion (can be true/false)
  'decision',     // committed choice (with authority signature)
] as const;

export type EntityType = typeof ENTITY_TYPES[number];

// =============================================================================
// Edge dictionary (14 types — Kuro msg #031 + promoted_to from #034)
// =============================================================================

export const EDGE_TYPES = [
  // Structural
  'part_of',       // A part_of B = A is component of B (subset → superset)
  'instance_of',   // A is a kind/case of pattern B
  'extends',       // A builds on B without replacing
  'supersedes',    // A replaces B; B should retire
  'promoted_to',   // claim → decision; status escalation, content preserved
  // Epistemic
  'supports',      // evidence/argument FOR
  'contradicts',   // evidence/argument AGAINST
  'analogy_to',    // structural similarity (rhetorical, partial)
  'causes',        // mechanistic causation (not pure temporal)
  // Provenance
  'authored_by',   // chunk → actor (writer of text)
  'sourced_from',  // entity → entity (external source citation)
  'decided_by',    // decision → actor (authority signature)
  // Referential
  'references',    // intentional explicit citation
  'mentions',      // co-occurrence (default fallback)
] as const;

export type EdgeType = typeof EDGE_TYPES[number];

/** Per-type confidence floor; default 0.6, raised for hallucination-prone types. */
export const EDGE_TYPE_FLOORS: Partial<Record<EdgeType, number>> = {
  analogy_to: 0.75,  // analogies easily hallucinated
};

export const DEFAULT_EDGE_FLOOR = 0.6;

/**
 * Rejected edge candidates (room #031). Kept for design memory — promote only
 * if ≥5 chunks demonstrate PPR benefit.
 */
export const REJECTED_EDGES = [
  { type: 'temporal_before', reason: 'timestamps on entities cover this' },
  { type: 'temporal_after', reason: 'timestamps on entities cover this' },
  { type: 'has_property', reason: 'properties live in entity payload, not edges' },
  { type: 'motivated_by', reason: 'too close to causes + supports' },
  { type: 'used_by', reason: 'collapses dependency / activation / domain-match' },
] as const;

const REJECTED_EDGE_TYPE_SET = new Set<string>(REJECTED_EDGES.map((r) => r.type));

/** Type guard — is this string a current edge type? */
export function isValidEdgeType(t: string): t is EdgeType {
  return (EDGE_TYPES as readonly string[]).includes(t);
}

/** Type guard — is this string a current entity type? */
export function isValidEntityType(t: string): t is EntityType {
  return (ENTITY_TYPES as readonly string[]).includes(t);
}

/** Known rejected types — used to log deprecation pressure separately from unknown types. */
export function isRejectedEdgeType(t: string): boolean {
  return REJECTED_EDGE_TYPE_SET.has(t);
}

/** Confidence floor for a given edge type, honoring per-type overrides. */
export function edgeTypeFloor(t: EdgeType): number {
  return EDGE_TYPE_FLOORS[t] ?? DEFAULT_EDGE_FLOOR;
}

// =============================================================================
// File schemas (memory/index/*.jsonl)
// =============================================================================

/** memory/index/entities.jsonl — one entity per line */
export interface EntityRecord {
  id: string;                      // ent-<kebab-slug>; type-independent so reclassification preserves id
  type: EntityType;
  subtype?: string;                // free-form refinement (e.g., actor.subtype = 'human' | 'agent' | 'org')
  canonical_name: string;
  aliases: string[];               // frontmatter seed ∪ LLM-extracted (rebuild: frontmatter is truth)
  first_seen: string;              // ISO timestamp
  last_referenced: string;         // ISO timestamp
  references: Array<{
    chunk_id: string;
    /** ≤120 chars verbatim phrase from chunk that grounds this entity. Optional — */
    /** seeded entries (frontmatter, etc.) have no span. */
    span?: string;
    /** LLM extraction confidence [0, 1]. Highest seen across references is the entity's quality signal. */
    confidence?: number;
  }>;
  meta?: Record<string, unknown>;  // type-specific extras (e.g., code-symbol: { language, kind })
}

/** memory/index/edges.jsonl — one typed relationship per line */
export interface EdgeRecord {
  from: string;                    // entity id
  to: string;                      // entity id
  type: EdgeType;
  confidence: number;              // [0, 1]; ontological certainty this edge is real. Below floor → drop
  /**
   * Optional PPR walk weight. Separates "how sure am I this edge exists"
   * (confidence) from "how strongly should the walker prefer it" (weight).
   * Lets rule-based `mentions` stay at conf=1.0 (definitely co-occur) while
   * walking at weight≈0.3 so they don't drown sparse semantic signal.
   * When unset, buildGraph falls back to confidence.
   */
  weight?: number;
  detector: 'rule' | 'llm';        // rule=1.0 always, llm=0.6-0.95 typically
  evidence_chunk_id: string;       // points to chunks.jsonl
  evidence_quote?: string;         // ≤200 chars, specific phrase grounding the type
  created: string;                 // ISO timestamp
}

/** memory/index/chunks.jsonl — text segments with stable hash ids */
export interface ChunkRecord {
  id: string;                      // chk-<sha1:12>
  source_file: string;             // raw file path (relative to repo root)
  line_range: [number, number];    // [start, end] 1-based inclusive
  section_path: string[];          // markdown heading ancestry (top → leaf)
  type: 'paragraph' | 'list_item' | 'code_block' | 'dialogue_turn' | 'frontmatter' | 'heading';
  text: string;
  text_hash: string;               // sha1 of normalized text; chunk id derives from this
  author?: 'alex' | 'kuro' | 'cc' | 'external';
  extracted_entities: string[];    // entity ids surfaced from this chunk
  created: string;                 // ISO timestamp
}

/** memory/index/conflicts.jsonl — Phase 3 conflict candidate queue */
export interface ConflictRecord {
  id: string;                      // conf-<n>
  type: 'claim_conflict' | 'edge_conflict' | 'alias_collision' | 'type_conflict';
  entities: string[];              // involved entity ids
  sources: Array<{ chunk_id: string; claim?: string }>;
  detector: 'rule' | 'llm';
  detected_at: string;             // ISO timestamp
  status: 'pending' | 'reviewed' | 'resolved' | 'dismissed';
  resolution?: string;             // free-form note when resolved/dismissed
}

/** memory/index/manifest.json — index health snapshot */
export interface IndexManifest {
  version: 1;
  built_at: string;                // ISO timestamp
  raw_files_count: number;
  raw_bytes_total: number;
  entities_count: number;
  edges_count: number;
  chunks_count: number;
  conflicts_pending: number;
  last_full_rebuild: string;
  last_incremental: string;
}

// =============================================================================
// Frontmatter (raw layer — added to library/topics/threads)
// =============================================================================

/**
 * The ONLY structural token we add to raw markdown. Kebab-case, human-readable.
 * Stable across rebuilds — entity ids in index/ resolve to this.
 */
export interface RawFrontmatter {
  id: string;                      // kebab-case-id, globally unique, never changes
  title: string;
  aliases?: string[];              // seeds for entity alignment (LLM may add more)
  tags?: string[];
  created: string;                 // YYYY-MM-DD
  updated: string;                 // YYYY-MM-DD
  // type-specific extras (not enforced by indexer):
  url?: string;                    // library
  author?: string;                 // library
  archive_mode?: 'full' | 'excerpt' | 'metadata-only';  // library
  confidence?: number;             // topic
  superseded_by?: string;          // topic — points to id of replacement
}

// =============================================================================
// Index file paths (single source of truth)
// =============================================================================

export const KG_PATHS = {
  dir: 'memory/index',
  entities: 'memory/index/entities.jsonl',
  edges: 'memory/index/edges.jsonl',
  chunks: 'memory/index/chunks.jsonl',
  conflicts: 'memory/index/conflicts.jsonl',
  manifest: 'memory/index/manifest.json',
  entity_dict: 'memory/index/entity-types.json',
  edge_dict: 'memory/index/edge-types.json',
  links_raw: 'memory/index/links-raw.jsonl',
  entity_candidates: 'memory/index/entities.candidates.jsonl',  // LLM staging, pre-registry
  edge_candidates: 'memory/index/edges.candidates.jsonl',       // LLM staging, pre-builder
  chunk_entity_index: 'memory/index/chunk-entity-index.jsonl',  // derived index
} as const;
