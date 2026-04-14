/**
 * Memory Compiler — Raw → Entry
 *
 * Compiles `<kuro:remember>` tags (and future tag types) into entries.jsonl.
 * See memory/proposals/2026-04-14-memory-layer-v3.md Phase 1+2.
 *
 * Attribution mapping:
 *   - Compiler-driven (live tag): "kuro" (Kuro wrote the tag)
 *   - Backfill-driven (historical): "worker:memory-compiler@v1"
 */

import { getEntriesStore } from './entries.js';
import type { Entry, EntryType, ParsedTags } from './types.js';

export interface CompileTarget {
  memoryDir: string;
}

export interface CompileRememberInput {
  content: string;
  topic?: string;
  source?: string;                     // default inferred from topic
  attribution: string;                 // "kuro" for live, "worker:memory-compiler@v1" for backfill
  createdAt?: string;                  // for backfill; ignored for live writes (uses now)
}

function inferSource(topic?: string, fallback = 'MEMORY.md'): string {
  return topic ? `topics/${topic}.md` : fallback;
}

function extractConcepts(content: string, topic?: string): string[] {
  const concepts = new Set<string>();
  if (topic) concepts.add(topic);

  // Hashtag-style concepts: "#concept" or "[concept]"
  const hashRe = /#([a-z][a-z0-9_-]{1,30})/gi;
  let m: RegExpExecArray | null;
  while ((m = hashRe.exec(content)) !== null) {
    concepts.add(m[1].toLowerCase());
  }
  return Array.from(concepts);
}

function inferType(content: string): EntryType {
  const lower = content.toLowerCase();
  if (/(decided|決定|決策|授權|approve)/.test(lower)) return 'decision';
  if (/(pattern|反模式|模式|recurring|每次)/.test(lower)) return 'pattern';
  if (/(ref[:：]|source[:：]|出處|參考|http)/.test(lower)) return 'reference';
  return 'fact';
}

/**
 * Compile a single remember/supersede/validate/exclude event into the entry store.
 * Returns the created Entry (for supersede/new) or null for dedup/exclude/validate.
 */
export function compileRemember(target: CompileTarget, input: CompileRememberInput): Entry | null {
  const store = getEntriesStore(target.memoryDir);
  try {
    return store.append({
      content: input.content,
      source: input.source ?? inferSource(input.topic),
      concepts: extractConcepts(input.content, input.topic),
      type: inferType(input.content),
      attribution: input.attribution,
    });
  } catch (e) {
    // Log and swallow — compiler failures must not break main cycle
    // eslint-disable-next-line no-console
    console.warn(`[memory-compiler] append failed: ${(e as Error).message}`);
    return null;
  }
}

export interface CompileSupersedeInput {
  target: string;
  reason: string;
  content: string;
  topic?: string;
  concepts?: string[];
  attribution: string;
}

export function compileSupersede(target: CompileTarget, input: CompileSupersedeInput): Entry | null {
  const store = getEntriesStore(target.memoryDir);
  try {
    return store.append({
      content: input.content,
      source: inferSource(input.topic),
      concepts: input.concepts ?? extractConcepts(input.content, input.topic),
      type: inferType(input.content),
      supersedes: [input.target],
      stale_reason: input.reason,
      attribution: input.attribution,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[memory-compiler] supersede failed: ${(e as Error).message}`);
    return null;
  }
}

export function compileExclude(
  target: CompileTarget,
  input: { target: string; reason: string; attribution: string },
): boolean {
  const store = getEntriesStore(target.memoryDir);
  try {
    store.exclude(input.target, input.reason, input.attribution);
    return true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[memory-compiler] exclude failed: ${(e as Error).message}`);
    return false;
  }
}

export function compileValidate(
  target: CompileTarget,
  input: { target: string; attribution: string },
): boolean {
  const store = getEntriesStore(target.memoryDir);
  try {
    store.validate(input.target, input.attribution);
    return true;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[memory-compiler] validate failed: ${(e as Error).message}`);
    return false;
  }
}

/**
 * Drive the compiler from parsed tags after a cycle response. Fire-and-forget:
 * no throw, no await contract on callers. Returns count of entries created.
 */
export interface CompileTagsResult {
  remembersCompiled: number;
  supersedesCompiled: number;
  excludesApplied: number;
  validatesApplied: number;
  skipped: number;
}

export function compileFromTags(
  memoryDir: string,
  tags: Pick<ParsedTags, 'remembers' | 'supersedes' | 'excludes' | 'validates'>,
  attribution = 'kuro',
): CompileTagsResult {
  const target: CompileTarget = { memoryDir };
  const result: CompileTagsResult = {
    remembersCompiled: 0,
    supersedesCompiled: 0,
    excludesApplied: 0,
    validatesApplied: 0,
    skipped: 0,
  };

  for (const r of tags.remembers ?? []) {
    const entry = compileRemember(target, {
      content: r.content,
      topic: r.topic,
      attribution,
    });
    if (entry) result.remembersCompiled++;
    else result.skipped++;
  }

  for (const s of tags.supersedes ?? []) {
    const entry = compileSupersede(target, {
      target: s.target,
      reason: s.reason,
      content: s.content,
      topic: s.topic,
      concepts: s.concepts,
      attribution,
    });
    if (entry) result.supersedesCompiled++;
    else result.skipped++;
  }

  for (const e of tags.excludes ?? []) {
    const ok = compileExclude(target, {
      target: e.target,
      reason: e.reason,
      attribution,
    });
    if (ok) result.excludesApplied++;
    else result.skipped++;
  }

  for (const v of tags.validates ?? []) {
    const ok = compileValidate(target, { target: v.target, attribution });
    if (ok) result.validatesApplied++;
    else result.skipped++;
  }

  return result;
}
