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

// =============================================================================
// Auto-ingest trigger — dispatches KG rebuild when enough new writes accumulate
// =============================================================================

const INGEST_THRESHOLD = 10; // minimum new writes before triggering rebuild
const INGEST_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4h cooldown between triggers
const MANIFEST_PATH = path.join(ROOT, 'memory/index/manifest.json');

let lastTriggerTs = 0;

/** Check if enough new memory writes have accumulated to warrant a KG rebuild. */
export function shouldTriggerKGIngest(): { should: boolean; newWrites: number; reason: string } {
  if (!isEnabled('kg-live-ingest')) {
    return { should: false, newWrites: 0, reason: 'feature disabled' };
  }

  // Cooldown gate
  if (Date.now() - lastTriggerTs < INGEST_COOLDOWN_MS) {
    return { should: false, newWrites: 0, reason: 'cooldown active' };
  }

  // Read manifest to get last_incremental timestamp
  let lastIncrementalTs = 0;
  try {
    if (fs.existsSync(MANIFEST_PATH)) {
      const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
      if (manifest.last_incremental && manifest.last_incremental !== 'never') {
        lastIncrementalTs = new Date(manifest.last_incremental).getTime();
      }
    }
  } catch { /* no manifest = never ran */ }

  // Count new writes since last ingest
  let newWrites = 0;
  try {
    if (!fs.existsSync(LOG_PATH)) {
      return { should: false, newWrites: 0, reason: 'no log file' };
    }
    for (const line of fs.readFileSync(LOG_PATH, 'utf8').split('\n')) {
      const s = line.trim();
      if (!s) continue;
      try {
        const ev = JSON.parse(s) as MemoryWriteEvent;
        if (new Date(ev.ts).getTime() > lastIncrementalTs) newWrites++;
      } catch { /* skip */ }
    }
  } catch {
    return { should: false, newWrites: 0, reason: 'log read error' };
  }

  if (newWrites < INGEST_THRESHOLD) {
    return { should: false, newWrites, reason: `below threshold (${newWrites}/${INGEST_THRESHOLD})` };
  }

  return { should: true, newWrites, reason: `${newWrites} new writes since last ingest` };
}

/** Mark that a KG ingest was triggered (updates cooldown timer). */
export function markKGIngestTriggered(): void {
  lastTriggerTs = Date.now();
}

// =============================================================================
// KG Service Push — send accumulated writes to external KG service
// =============================================================================

const KG_SERVICE_URL = 'http://localhost:3300';
const KG_PUSH_TIMEOUT = 5000;

/**
 * Push recent memory writes to external KG service's write buffer.
 * Fire-and-forget — never blocks the cycle.
 */
export async function pushToKGService(): Promise<{ pushed: number; errors: number }> {
  if (!isEnabled('kg-service-push')) return { pushed: 0, errors: 0 };

  let pushed = 0;
  let errors = 0;

  try {
    if (!fs.existsSync(LOG_PATH)) return { pushed: 0, errors: 0 };

    // Read manifest to get last push timestamp
    let lastPushTs = 0;
    const pushStatePath = path.join(ROOT, 'memory/index/kg-push-state.json');
    try {
      if (fs.existsSync(pushStatePath)) {
        const state = JSON.parse(fs.readFileSync(pushStatePath, 'utf8'));
        lastPushTs = new Date(state.lastPushTs ?? 0).getTime();
      }
    } catch { /* no state = push everything */ }

    // Collect writes since last push
    const writes: MemoryWriteEvent[] = [];
    for (const line of fs.readFileSync(LOG_PATH, 'utf8').split('\n')) {
      const s = line.trim();
      if (!s) continue;
      try {
        const ev = JSON.parse(s) as MemoryWriteEvent;
        if (new Date(ev.ts).getTime() > lastPushTs) writes.push(ev);
      } catch { /* skip */ }
    }

    if (writes.length === 0) return { pushed: 0, errors: 0 };

    // Batch writes into KG service buffer (POST /api/write)
    for (const w of writes) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), KG_PUSH_TIMEOUT);
        const preview = w.preview || `Memory write: ${w.source} → ${w.file}`;
        const resp = await fetch(`${KG_SERVICE_URL}/api/write`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: preview,
            source_agent: 'kuro',
            context: `source=${w.source} file=${w.file}`,
            metadata: { source: w.source, file: w.file, bytes: w.bytes, topic: w.topic },
          }),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (resp.ok) pushed++;
        else errors++;
      } catch {
        errors++;
      }
    }

    // Update push state
    if (pushed > 0) {
      const lastTs = writes[writes.length - 1].ts;
      try {
        fs.writeFileSync(pushStatePath, JSON.stringify({ lastPushTs: lastTs, pushed, errors }, null, 2) + '\n');
      } catch { /* best effort */ }
    }
  } catch (err) {
    logIngestError('pushToKGService', 'batch', err);
  }

  return { pushed, errors };
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
