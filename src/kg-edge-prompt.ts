/**
 * LLM Edge Extractor — Pure Functions
 *
 * Contract (room msgs #052-053, 2026-04-15):
 *   - Extractor: (chunk, known entities) → EdgeCandidate[] (pre-resolution)
 *   - Builder (CC): candidates → EdgeRecord[] (id-resolved, deduped, floored)
 *
 * Two-pass design (cross-chunk parallelism):
 *   Pass A (per-chunk): both endpoints appear within the chunk. Default path.
 *   Pass B (neighborhood): known-entity co-occurrence across chunk group + LLM
 *     classifies relation from joined context. Lower recall cost than pairwise.
 *
 * Entity resolution is downstream (kg-edge-builder.ts via kg-entity-registry).
 * We emit canonical_name OR alias probes only — never invent ids.
 *
 * This file has NO IO. Runner (scripts/kg-extract-edges.ts) handles LLM call.
 */

import type { ChunkRecord } from './kg-types.js';
import { EDGE_TYPES, type EdgeType } from './kg-types.js';
import type { EdgeCandidate } from './kg-edge-builder.js';

// =============================================================================
// Output shape — mirrors entity extractor (one batch per chunk)
// =============================================================================

export interface EdgeCandidateBatch {
  chunk_id: string;
  candidates: EdgeCandidate[];
}

// =============================================================================
// Rubric (kept inline — prompt + code share one source)
// =============================================================================

const TYPE_DEFINITIONS: Record<EdgeType, string> = {
  // Structural
  part_of:      'A is a component/subset of B (strict hierarchy, not just "mentioned with")',
  instance_of:  'A is a concrete case of pattern B (A exemplifies B)',
  extends:      'A builds on B without replacing B (both coexist)',
  supersedes:   'A replaces B; B should retire (explicit deprecation signal)',
  promoted_to:  'claim escalated to decision — status change, content preserved',
  // Epistemic
  supports:     'A is evidence/argument FOR B (strengthens B\'s credibility)',
  contradicts:  'A is evidence/argument AGAINST B (weakens B or negates it)',
  analogy_to:   'structural similarity rhetorically invoked — partial, not identity',
  causes:       'mechanistic causation (A brought about B via identifiable mechanism; not mere temporal order)',
  // Provenance
  authored_by:  'chunk/artifact was written/produced by actor',
  sourced_from: 'entity explicitly cites external source (paper, URL, repo, book)',
  decided_by:   'decision carries authority signature of actor',
  // Referential
  references:   'intentional explicit citation (link, name-drop with direction)',
  mentions:     'co-occurrence without stronger relation — fallback only',
};

const FEW_SHOTS = `Example 1 — supports + sourced_from:
Chunk: "FLP impossibility (Fischer-Lynch-Paterson 1985) 證明 asynchronous consensus 在有 failure 時不可能收斂，這支持了 Kuro 的 two-agent split design。"
Entities in chunk: [FLP impossibility, Kuro, two-agent split]
Output:
[
  {"from":"FLP impossibility","to":"two-agent split","type":"supports","confidence":0.85,"evidence_chunk_id":"<chunk_id>","evidence_quote":"支持了 Kuro 的 two-agent split design"},
  {"from":"FLP impossibility","to":"Fischer-Lynch-Paterson 1985","type":"sourced_from","confidence":0.95,"evidence_chunk_id":"<chunk_id>","evidence_quote":"Fischer-Lynch-Paterson 1985"}
]

Example 2 — part_of + instance_of (structural):
Chunk: "kg-edge-builder.ts 是 KG pipeline 的 deterministic 側；它是 constraint-texture pattern 的一個具體實例。"
Entities: [kg-edge-builder.ts, KG pipeline, constraint-texture pattern]
Output:
[
  {"from":"kg-edge-builder.ts","to":"KG pipeline","type":"part_of","confidence":0.9,"evidence_chunk_id":"<chunk_id>","evidence_quote":"是 KG pipeline 的 deterministic 側"},
  {"from":"kg-edge-builder.ts","to":"constraint-texture pattern","type":"instance_of","confidence":0.8,"evidence_chunk_id":"<chunk_id>","evidence_quote":"是 constraint-texture pattern 的一個具體實例"}
]

Example 3 — NEGATIVE (do not emit): two entities appear but no stated relation.
Chunk: "今天跑了 TM poll，也順便看 KG pipeline 的進度。"
Entities: [TM poll, KG pipeline]
Output: []   // temporal co-occurrence ≠ relation; 'mentions' only if explicit linking phrase exists`;

const RULES = `Rules (in priority order):

1. Evidence-grounded only. Every edge MUST have an evidence_quote ≤200 chars directly lifted from the chunk that licenses the TYPE. No quote → no edge.

2. Prefer stronger types over 'mentions'. 'mentions' is last-resort fallback when entities co-occur with an explicit linking phrase but no stronger relation fits. Silent co-occurrence emits NOTHING.

3. Endpoint probes are canonical_name or alias strings — NEVER ids, NEVER invented names. If an entity is referenced by a pronoun ("it", "這個"), resolve to its nearest antecedent from the entity list; if ambiguous, skip.

4. Direction matters for directed types. A supports B ≠ B supports A. Check the evidence_quote phrasing before assigning direction.

5. Confidence calibration:
   - 0.9+ : explicit linking phrase ("supports", "replaces", "part of", "cited from")
   - 0.75–0.89 : strong implication, one reasonable reading
   - 0.60–0.74 : plausible but requires inference (analogy_to minimum is 0.75 — this range is effectively blocked for it)
   - <0.60 : do not emit (builder will drop anyway)

6. Self-loops forbidden. If from.resolves == to.resolves, skip.

7. analogy_to requires explicit analogy marker ("像", "類似", "like", "analogous to"). Do not infer structural similarity without a marker.

8. causes vs supports: causes requires mechanistic chain ("A 導致 B" with identifiable pathway); supports is evidential ("A 證明 B"). When in doubt, prefer supports.

9. Output must be valid JSON array. No markdown fences, no commentary. Empty array is valid output.`;

// =============================================================================
// Prompt builder
// =============================================================================

export interface BuildEdgePromptInput {
  chunk: ChunkRecord;
  /** Canonical names + aliases of entities found in this chunk (from entity pass). */
  entities: Array<{ canonical_name: string; aliases?: string[] }>;
}

export function buildEdgePrompt({ chunk, entities }: BuildEdgePromptInput): string {
  const entityList = entities
    .map((e) => {
      const aliasStr = e.aliases && e.aliases.length ? ` (aliases: ${e.aliases.join(', ')})` : '';
      return `- ${e.canonical_name}${aliasStr}`;
    })
    .join('\n');

  const typeRubric = EDGE_TYPES.map((t) => `- ${t}: ${TYPE_DEFINITIONS[t]}`).join('\n');

  return `You extract typed relational edges from a text chunk.

## Edge types (14 total)
${typeRubric}

## Rules
${RULES}

## Few-shots
${FEW_SHOTS}

## Task
Chunk id: ${chunk.id}
Chunk text:
"""
${chunk.text}
"""

Entities present in this chunk (resolve probes to these; do not invent new entities):
${entityList || '(none — emit empty array)'}

Emit a JSON array of EdgeCandidate objects. evidence_chunk_id must equal "${chunk.id}". Output JSON only.`;
}

// =============================================================================
// Response parser
// =============================================================================

export interface ParseResult {
  candidates: EdgeCandidate[];
  errors: string[];
}

export function parseEdgeResponse(raw: string, chunkId: string): ParseResult {
  const errors: string[] = [];
  const trimmed = raw.trim();

  // Strip accidental fence.
  const unfenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced);
  } catch (e) {
    errors.push(`JSON parse failed: ${(e as Error).message}`);
    return { candidates: [], errors };
  }

  if (!Array.isArray(parsed)) {
    errors.push('Response is not a JSON array');
    return { candidates: [], errors };
  }

  const candidates: EdgeCandidate[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i] as Partial<EdgeCandidate> & Record<string, unknown>;
    if (typeof item !== 'object' || item === null) {
      errors.push(`item[${i}]: not an object`);
      continue;
    }
    if (typeof item.from !== 'string' || typeof item.to !== 'string' || typeof item.type !== 'string') {
      errors.push(`item[${i}]: from/to/type must be strings`);
      continue;
    }
    if (!EDGE_TYPES.includes(item.type as EdgeType)) {
      errors.push(`item[${i}]: unknown type "${item.type}"`);
      continue;
    }
    if (typeof item.confidence !== 'number' || item.confidence < 0 || item.confidence > 1) {
      errors.push(`item[${i}]: confidence must be [0,1]`);
      continue;
    }
    // Chunk id override protection — runner trusts its own chunk id.
    candidates.push({
      from: item.from,
      to: item.to,
      type: item.type as EdgeType,
      confidence: item.confidence,
      evidence_chunk_id: chunkId,
      ...(typeof item.evidence_quote === 'string' ? { evidence_quote: item.evidence_quote.slice(0, 200) } : {}),
      detector: 'llm',
    });
  }

  return { candidates, errors };
}
