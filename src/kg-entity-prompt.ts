/**
 * LLM Entity Extractor — Pure Functions
 *
 * Contract (room msgs #042-049, 2026-04-15):
 *   - Extractor: chunk batch → EntityCandidate[] (pre-dedup, no ids)
 *   - Registry (CC): candidates → EntityRecord (id-assigned, deduped)
 *
 * This file has NO IO. Only prompt building + response parsing.
 * Runner (scripts/kg-extract-entities.ts) handles LLM call + batching + IO.
 */

import type { ChunkRecord } from './kg-types.js';
import { ENTITY_TYPES, type EntityType } from './kg-types.js';

// =============================================================================
// Output shape (producer side — registry consumes this)
// =============================================================================

export interface EntityCandidate {
  type: EntityType;            // field name aligned with registry (kg-entity-registry.ts)
  canonical_name: string;      // preferred surface form (not an id)
  aliases: string[];           // other forms seen in the span
  span: string;                // ≤120 chars — the exact phrase grounding this entity
  confidence: number;          // [0, 1]
}

/** JSONL wrapper for entities.candidates.jsonl — one line per chunk. */
export interface CandidateBatch {
  chunk_id: string;
  candidates: EntityCandidate[];
}

// =============================================================================
// Rubric (kept inline — prompt + code share one source)
// =============================================================================

const TYPE_DEFINITIONS: Record<EntityType, string> = {
  actor:        'human, AI agent, or external org (e.g. Alex, Kuro, Claude Code, Anthropic)',
  concept:      'abstract idea, principle, method, theory (e.g. constraint texture, PPR, FLP)',
  project:      'named software system or product (e.g. mini-agent, Teaching Monster, myelin)',
  tool:         'third-party software or service (e.g. Claude CLI, Chrome CDP, sqlite)',
  artifact:     'identifiable concrete output: PR, issue, doc, commit, file path',
  'code-symbol': 'function, class, module, file — something dereferencable in code',
  event:        'bounded happening in time (e.g. "2026-04-13 three-point feedback", "TM warmup comp 2")',
  claim:        'truth-bearing assertion that could be right or wrong (NOT every statement — only load-bearing claims)',
  decision:     'committed choice with authority signature (Alex/Kuro approved X, chose Y over Z)',
};

const FEW_SHOTS = `Example 1 — concept + project:
Chunk: "PPR (Personalized PageRank) 是 mini-agent retrieval pipeline 的核心 ranker。"
Output: [
  {"type":"concept","canonical_name":"Personalized PageRank","aliases":["PPR"],"span":"PPR (Personalized PageRank)","confidence":0.95},
  {"type":"project","canonical_name":"mini-agent","aliases":[],"span":"mini-agent retrieval pipeline","confidence":0.9}
]

Example 2 — actor + decision:
Chunk: "Alex 核准 L2 自主授權（2026-02-18）— src/*.ts 自主決定+實作部署，僅 L3 需 Alex 核准。"
Output: [
  {"type":"actor","canonical_name":"Alex","aliases":[],"span":"Alex 核准","confidence":1.0},
  {"type":"decision","canonical_name":"L2 autonomous authorization (2026-02-18)","aliases":["L2 自主授權"],"span":"Alex 核准 L2 自主授權（2026-02-18）","confidence":0.9}
]

Example 3 — code-symbol with repo-relative path normalization:
Chunk: "loop.ts 的 rebuildContext 邏輯在 L2 超時重試時觸發（參考 src/loop.ts:412）。"
Output: [
  {"type":"code-symbol","canonical_name":"src/loop.ts","aliases":["loop.ts"],"span":"loop.ts 的 rebuildContext","confidence":0.9},
  {"type":"code-symbol","canonical_name":"src/loop.ts::rebuildContext","aliases":["rebuildContext"],"span":"loop.ts 的 rebuildContext 邏輯","confidence":0.85}
]`;

// =============================================================================
// Prompt builder
// =============================================================================

/** Build a single-batch extraction prompt. Caller decides batch size. */
export function buildEntityPrompt(chunks: ChunkRecord[]): string {
  if (chunks.length === 0) throw new Error('buildEntityPrompt: empty batch');

  const typeList = ENTITY_TYPES
    .map((t) => `- ${t}: ${TYPE_DEFINITIONS[t]}`)
    .join('\n');

  const chunkBlock = chunks
    .map((c) => `[${c.id}] (${c.type}) ${oneLine(c.text)}`)
    .join('\n');

  return `You extract named entities from Kuro's personal memory markdown.

ENTITY TYPES (closed set — if it fits none, skip it):
${typeList}

RULES:
1. Extract ONLY entities that are explicitly named in the text. No inferring.
2. Every candidate MUST cite a span (≤120 chars) taken verbatim from the chunk.
3. Common words are NOT entities (skip "the system", "this project" without proper name).
4. If unsure between two kinds, pick the more specific one. If still unsure, skip.
5. canonical_name = the most complete form in the chunk; aliases = other surface forms.
6. confidence: 0.95+ for proper nouns, 0.7-0.9 for contextually-defined terms, <0.6 → skip.
7. File paths (artifact / code-symbol): canonical_name MUST be the repo-relative path from the mini-agent root (e.g. "src/loop.ts", "scripts/kg-extract-entities.ts", "memory/topics/source.md"). If the chunk only shows the basename ("loop.ts"), put the basename in aliases and infer the repo-relative canonical from context. For functions/classes inside a file, use "<repo-relative-path>::<symbol>" (e.g. "src/loop.ts::rebuildContext"). Bare basenames without a path prefix are NEVER a valid canonical_name for files.

${FEW_SHOTS}

---

CHUNKS TO PROCESS (${chunks.length} total):
${chunkBlock}

---

OUTPUT FORMAT — one JSON object per chunk id that has ≥1 entity, keyed by chunk id:
\`\`\`json
{
  "<chunk_id>": [{"type":"...","canonical_name":"...","aliases":[...],"span":"...","confidence":0.0}, ...],
  ...
}
\`\`\`
Chunks with NO entities: omit their key. Do not emit empty arrays.
Return ONLY the JSON block — no prose before or after.`;
}

// =============================================================================
// Response parser
// =============================================================================

export interface ParseResult {
  candidates: EntityCandidate[];
  skipped: Array<{ chunk_id?: string; reason: string; raw?: unknown }>;
}

/** Parse LLM response. Tolerates fenced code blocks + partial garbage. */
export function parseEntityCandidates(
  rawResponse: string,
  batch: ChunkRecord[],
): ParseResult {
  const result: ParseResult = { candidates: [], skipped: [] };
  const validIds = new Set(batch.map((c) => c.id));

  const json = extractJsonBlock(rawResponse);
  if (!json) {
    result.skipped.push({ reason: 'no_json_block_found' });
    return result;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    result.skipped.push({ reason: `json_parse_error: ${(e as Error).message}` });
    return result;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    result.skipped.push({ reason: 'root_not_object', raw: parsed });
    return result;
  }

  for (const [chunkId, rawList] of Object.entries(parsed as Record<string, unknown>)) {
    if (!validIds.has(chunkId)) {
      result.skipped.push({ chunk_id: chunkId, reason: 'unknown_chunk_id' });
      continue;
    }
    if (!Array.isArray(rawList)) {
      result.skipped.push({ chunk_id: chunkId, reason: 'value_not_array', raw: rawList });
      continue;
    }
    for (const raw of rawList) {
      const cand = validateCandidate(raw, chunkId);
      if ('error' in cand) {
        result.skipped.push({ chunk_id: chunkId, reason: cand.error, raw });
      } else {
        result.candidates.push(cand);
      }
    }
  }

  return result;
}

// =============================================================================
// Internals
// =============================================================================

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function extractJsonBlock(s: string): string | null {
  const fence = s.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fence) return fence[1].trim();
  const firstBrace = s.indexOf('{');
  const lastBrace = s.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return s.slice(firstBrace, lastBrace + 1);
  }
  return null;
}

function validateCandidate(
  raw: unknown,
  _chunkId: string,
): EntityCandidate | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'not_object' };
  const r = raw as Record<string, unknown>;

  const type = r.type;
  if (typeof type !== 'string' || !(ENTITY_TYPES as readonly string[]).includes(type)) {
    return { error: `invalid_type:${String(type)}` };
  }

  const name = r.canonical_name;
  if (typeof name !== 'string' || name.trim().length === 0) {
    return { error: 'missing_canonical_name' };
  }

  const aliases = Array.isArray(r.aliases)
    ? r.aliases.filter((a): a is string => typeof a === 'string')
    : [];

  const span = typeof r.span === 'string' ? r.span.slice(0, 120) : '';
  if (span.length === 0) return { error: 'missing_span' };

  const conf = typeof r.confidence === 'number' ? r.confidence : NaN;
  if (!Number.isFinite(conf) || conf < 0 || conf > 1) {
    return { error: `invalid_confidence:${String(r.confidence)}` };
  }
  if (conf < 0.6) return { error: `confidence_below_floor:${conf}` };

  return {
    type: type as EntityType,
    canonical_name: name.trim(),
    aliases,
    span,
    confidence: conf,
  };
}
