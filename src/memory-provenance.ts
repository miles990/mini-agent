/**
 * Memory Provenance Writer — B3 (2026-04-24)
 *
 * Append-only ledger answering "where did this memory fact come from?"
 * Written as a tail after each successful `appendMemory()` commit.
 *
 * Design (from docs/plans/2026-04-24-B3-memory-provenance.md §Corrected scope):
 * - Target file: memory/state/memory-provenance.jsonl (sibling of decision-provenance.jsonl)
 * - Append-only, one JSON object per line, \n terminated
 * - Best-effort: failure logged via slog("PROVENANCE_WRITE_FAIL"), NEVER throws to caller
 * - evidence_ref is accepted as `string[]` per finalized B1 schema — serialized verbatim
 *
 * Silent-abort guard (5fdd134f lesson): every catch branch slogs.
 * No empty `catch {}` anywhere in this file.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import { existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { slog } from './utils.js';

/**
 * N0-aligned shape (2026-04-24, cl-6 close).
 * Mirrors decision-provenance envelope so middleware consumers can treat
 * memory-provenance and decision-provenance uniformly via `subsystem` discriminator.
 *
 * Classifier fields (`reason` / `evidence_kind` / `confidence`) are written as
 * `null` until N5 lands and `memory-classifier.ts` is wired into the write path.
 */
export interface ProvenanceRecord {
  /** Subsystem discriminator — literal constant for memory subsystem */
  subsystem: 'memory';
  /** Stable id for the memory fact — content-hash based, see memoryIdForContent() */
  decision: string;
  /** ISO timestamp of the write */
  ts: string;
  /** Entry point that produced the fact */
  source: 'appendMemory' | 'appendTopicMemory' | 'api-triple';
  /** Classifier output — memory_kind. null until N5 wires memory-classifier */
  reason: string | null;
  /** Classifier output — evidence_kind. null until N5 wires memory-classifier */
  evidence_kind: string | null;
  /** Classifier output — confidence ∈ [0,1]. null until N5 wires memory-classifier */
  confidence: number | null;
  /** Caller-supplied inputs envelope (N0 spec §inputs) */
  inputs: {
    /** Tool-log reference ids (B1 schema §evidence_ref). May be empty. */
    evidence_ref: string[];
    /** Agent cycle number if known (helps correlate with cycle-state) */
    source_cycle: number | null;
  };
  /** MEMORY.md section or topic name the fact landed in (debug-only) */
  section?: string;
  /** Trust level carried from the caller (debug-only) */
  trust?: string;
  /** First 120 chars of content for human debugging (not a semantic field) */
  contentPreview?: string;
  /** UTF-8 byte length of the original content */
  bytes?: number;
}

/**
 * Derive a stable memoryId from content.
 * sha1 first 16 hex chars — collision-resistant enough for debugging purposes,
 * deterministic so re-writes of the same content map to the same id.
 */
export function memoryIdForContent(content: string): string {
  const hash = crypto.createHash('sha1').update(content, 'utf8').digest('hex').slice(0, 16);
  return `memory-md:${hash}`;
}

const provenancePath = (): string => {
  const stateDir = path.join(process.cwd(), 'memory', 'state');
  if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
  return path.join(stateDir, 'memory-provenance.jsonl');
};

/**
 * Append one provenance row. Best-effort.
 *
 * Contract: NEVER throws. Logs via slog on any failure so silent-abort
 * is impossible to regress into (5fdd134f lesson).
 */
export function appendProvenance(record: ProvenanceRecord): void {
  try {
    const line = JSON.stringify(record);
    appendFileSync(provenancePath(), line + '\n');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    slog('memory-provenance', 'PROVENANCE_WRITE_FAIL', {
      decision: record.decision,
      source: record.source,
      err: msg,
    });
  }
}
