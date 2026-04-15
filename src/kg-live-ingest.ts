/**
 * KG Live Ingest — observation stage.
 *
 * Proposal path B first step: fire-and-forget hook that captures every
 * memory write into memory/index/live-ingest-log.jsonl so we can measure
 * ingest volume before wiring LLM-based entity/edge extraction. Second
 * stage will reuse the same entry point but route events through the
 * registry + edge builder.
 *
 * Design constraints:
 *   - Never throws in the caller's path (fire-and-forget).
 *   - Feature flag `kg-live-ingest` gates everything (default off).
 *   - Errors land in memory/index/ingest-errors.jsonl for later re-scan.
 */

import fs from 'node:fs';
import path from 'node:path';
import { isEnabled } from './features.js';

const ROOT = process.cwd();
const LOG_PATH = path.join(ROOT, 'memory/index/live-ingest-log.jsonl');
const ERRORS_PATH = path.join(ROOT, 'memory/index/ingest-errors.jsonl');

export type WriteSource =
  | 'memory-md'
  | 'topic'
  | 'daily'
  | 'heartbeat'
  | 'remember-tag'
  | 'room'
  | 'other';

export interface MemoryWriteEvent {
  ts: string;
  source: WriteSource;
  file: string;
  bytes: number;
  topic?: string;
  preview?: string;
}

function appendLine(file: string, obj: unknown): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(obj) + '\n');
  } catch {
    // Silent — fire-and-forget must never throw back into caller.
  }
}

/**
 * Record a memory write. Caller must not await — this is fire-and-forget.
 * Returns quickly after the single fs.appendFileSync.
 */
export function onMemoryWrite(event: Omit<MemoryWriteEvent, 'ts'>): void {
  if (!isEnabled('kg-live-ingest')) return;
  try {
    const ev: MemoryWriteEvent = {
      ts: new Date().toISOString(),
      ...event,
      preview: event.preview?.slice(0, 160),
    };
    appendLine(LOG_PATH, ev);
  } catch (err) {
    logIngestError('onMemoryWrite', event.file, err);
  }
}

export function logIngestError(stage: string, file: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  appendLine(ERRORS_PATH, {
    ts: new Date().toISOString(),
    stage,
    file,
    error: msg,
  });
}

/** Snapshot of live-ingest volume — used by dashboards / diagnostics. */
export function getIngestStats(): {
  writes: number;
  errors: number;
  first_ts?: string;
  last_ts?: string;
  by_source: Record<string, number>;
} {
  const stats = {
    writes: 0,
    errors: 0,
    first_ts: undefined as string | undefined,
    last_ts: undefined as string | undefined,
    by_source: {} as Record<string, number>,
  };

  try {
    if (fs.existsSync(LOG_PATH)) {
      for (const line of fs.readFileSync(LOG_PATH, 'utf8').split('\n')) {
        const s = line.trim();
        if (!s) continue;
        try {
          const ev = JSON.parse(s) as MemoryWriteEvent;
          stats.writes++;
          stats.by_source[ev.source] = (stats.by_source[ev.source] ?? 0) + 1;
          if (!stats.first_ts) stats.first_ts = ev.ts;
          stats.last_ts = ev.ts;
        } catch {
          // skip malformed line
        }
      }
    }
    if (fs.existsSync(ERRORS_PATH)) {
      const content = fs.readFileSync(ERRORS_PATH, 'utf8');
      stats.errors = content.split('\n').filter((l) => l.trim()).length;
    }
  } catch {
    // Best-effort stats; never throw.
  }

  return stats;
}
