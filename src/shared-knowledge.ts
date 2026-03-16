/**
 * Shared Knowledge Bus — system-wide real-time knowledge base.
 *
 * Any component can:
 *   observe(event) — write an observation (routing decision, delegation outcome, etc.)
 *   query(filter)  — read recent observations matching a filter
 *   stats(opts)    — get aggregated stats (counts, averages, distributions)
 *   pattern(opts)  — find recurring patterns across components
 *
 * Architecture:
 *   In-memory ring buffer (last 2000 events) for real-time queries
 *   + JSONL persistence (append-only, rotate daily)
 *   + Auto-aggregation (sliding window stats updated on each observe)
 *   + EventBus integration (emit 'kb:observe' for subscribers)
 *
 * Design:
 *   File = Truth — JSONL is the source, memory is read cache
 *   No database — fits mini-agent philosophy
 *   Fire-and-forget writes — observe() never blocks callers
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { eventBus } from './event-bus.js';
import { slog } from './utils.js';

// =============================================================================
// Types
// =============================================================================

/** Sources that can write observations */
export type KBSource =
  | 'routing'      // task-graph routing decisions
  | 'delegation'   // delegation spawn/outcome
  | 'foreground'   // foreground slot activity
  | 'ooda'         // main cycle decisions
  | 'batch'        // batch buffer flushes
  | 'myelin'       // myelin crystallization events
  | 'mushi'        // mushi triage decisions
  | 'inbox'        // inbox classification
  | 'perception'   // perception stream events
  | 'system';      // system-level events

/** Event types */
export type KBEventType =
  | 'decision'     // a routing/scheduling decision was made
  | 'outcome'      // a task completed (success/fail/timeout)
  | 'spawn'        // a task was spawned
  | 'merge'        // tasks were merged
  | 'batch-flush'  // a batch buffer flushed
  | 'route'        // an item was routed to a lane
  | 'skip'         // an event was skipped (triage/dedup)
  | 'crystallize'  // a pattern was crystallized into a rule
  | 'metric';      // a metric observation (latency, utilization, etc.)

/** A single observation in the knowledge base */
export interface KBEvent {
  ts: string;                           // ISO timestamp
  source: KBSource;                     // which component
  type: KBEventType;                    // what happened
  data: Record<string, unknown>;        // event-specific payload
  tags?: string[];                      // searchable tags
  correlationId?: string;               // links related events (e.g. same inbox item)
  outcome?: 'success' | 'fail' | 'timeout' | 'skip'; // for outcome events
  durationMs?: number;                  // for timed events
}

/** Filter for querying events */
export interface KBFilter {
  source?: KBSource | KBSource[];
  type?: KBEventType | KBEventType[];
  tags?: string[];                      // any tag matches
  correlationId?: string;
  since?: number;                       // ms ago (e.g. 60000 = last minute)
  limit?: number;                       // max results (default 50)
}

/** Aggregated stats */
export interface KBStats {
  source: string;
  type: string;
  count: number;
  successRate?: number;                 // for outcome events
  avgDurationMs?: number;               // for timed events
  lastSeen: string;                     // ISO timestamp
}

/** Pattern: a recurring observation across components */
export interface KBPattern {
  description: string;
  frequency: number;                    // occurrences in window
  confidence: number;                   // 0-1
  sources: KBSource[];                  // which components involved
  recommendation?: string;              // actionable insight
}

// =============================================================================
// Ring Buffer (in-memory, real-time)
// =============================================================================

const MAX_BUFFER_SIZE = 2000;
const buffer: KBEvent[] = [];

// =============================================================================
// Sliding Window Aggregation
// =============================================================================

interface AggBucket {
  count: number;
  successes: number;
  failures: number;
  totalDurationMs: number;
  timedCount: number;
  lastSeen: string;
}

// key: `${source}:${type}`
const aggregation = new Map<string, AggBucket>();

function updateAggregation(event: KBEvent): void {
  const key = `${event.source}:${event.type}`;
  let bucket = aggregation.get(key);
  if (!bucket) {
    bucket = { count: 0, successes: 0, failures: 0, totalDurationMs: 0, timedCount: 0, lastSeen: '' };
    aggregation.set(key, bucket);
  }
  bucket.count++;
  bucket.lastSeen = event.ts;
  if (event.outcome === 'success') bucket.successes++;
  if (event.outcome === 'fail' || event.outcome === 'timeout') bucket.failures++;
  if (event.durationMs != null) {
    bucket.totalDurationMs += event.durationMs;
    bucket.timedCount++;
  }
}

// =============================================================================
// Persistence (JSONL)
// =============================================================================

let _logDir: string | null = null;
let _currentDate: string | null = null;
let _currentPath: string | null = null;

function getLogPath(): string | null {
  if (!_logDir) return null;
  const today = new Date().toISOString().slice(0, 10);
  if (today !== _currentDate) {
    _currentDate = today;
    _currentPath = path.join(_logDir, `kb-${today}.jsonl`);
  }
  return _currentPath;
}

function persistEvent(event: KBEvent): void {
  const logPath = getLogPath();
  if (!logPath) return;
  try {
    appendFileSync(logPath, JSON.stringify(event) + '\n');
  } catch { /* fire-and-forget */ }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Initialize the shared knowledge bus.
 * Call once at startup with the instance data directory.
 */
export function initSharedKnowledge(dataDir: string): void {
  _logDir = path.join(dataDir, 'knowledge');
  if (!existsSync(_logDir)) {
    mkdirSync(_logDir, { recursive: true });
  }

  // Load today's events into buffer for warm start
  const logPath = getLogPath();
  if (logPath && existsSync(logPath)) {
    try {
      const lines = readFileSync(logPath, 'utf-8').trim().split('\n');
      for (const line of lines.slice(-MAX_BUFFER_SIZE)) {
        if (!line) continue;
        try {
          const event = JSON.parse(line) as KBEvent;
          buffer.push(event);
          updateAggregation(event);
        } catch { /* skip malformed */ }
      }
      slog('KB', `Loaded ${buffer.length} events from today's log`);
    } catch { /* cold start is fine */ }
  }
}

/**
 * Record an observation. Fire-and-forget — never blocks callers.
 */
export function observe(event: Omit<KBEvent, 'ts'>): void {
  const full: KBEvent = { ...event, ts: new Date().toISOString() };

  // In-memory ring buffer
  buffer.push(full);
  if (buffer.length > MAX_BUFFER_SIZE) {
    buffer.splice(0, buffer.length - MAX_BUFFER_SIZE);
  }

  // Aggregation
  updateAggregation(full);

  // Persist (fire-and-forget)
  persistEvent(full);

  // Notify subscribers
  eventBus.emit('kb:observe', { ...full } as Record<string, unknown>);
}

/**
 * Query recent events matching a filter.
 * Searches the in-memory buffer (last 2000 events).
 */
export function query(filter: KBFilter): KBEvent[] {
  const limit = filter.limit ?? 50;
  const now = Date.now();
  const results: KBEvent[] = [];

  // Iterate backwards (most recent first)
  for (let i = buffer.length - 1; i >= 0 && results.length < limit; i--) {
    const e = buffer[i];

    // Source filter
    if (filter.source) {
      const sources = Array.isArray(filter.source) ? filter.source : [filter.source];
      if (!sources.includes(e.source)) continue;
    }

    // Type filter
    if (filter.type) {
      const types = Array.isArray(filter.type) ? filter.type : [filter.type];
      if (!types.includes(e.type)) continue;
    }

    // Tag filter (any match)
    if (filter.tags && filter.tags.length > 0) {
      if (!e.tags || !filter.tags.some(t => e.tags!.includes(t))) continue;
    }

    // Correlation filter
    if (filter.correlationId && e.correlationId !== filter.correlationId) continue;

    // Time filter
    if (filter.since) {
      const eventTime = new Date(e.ts).getTime();
      if (now - eventTime > filter.since) continue;
    }

    results.push(e);
  }

  return results;
}

/**
 * Get aggregated stats, optionally filtered by source/type.
 */
export function stats(filter?: { source?: KBSource; type?: KBEventType }): KBStats[] {
  const results: KBStats[] = [];

  for (const [key, bucket] of aggregation) {
    const [source, type] = key.split(':');

    if (filter?.source && source !== filter.source) continue;
    if (filter?.type && type !== filter.type) continue;

    results.push({
      source,
      type,
      count: bucket.count,
      successRate: (bucket.successes + bucket.failures) > 0
        ? bucket.successes / (bucket.successes + bucket.failures)
        : undefined,
      avgDurationMs: bucket.timedCount > 0
        ? Math.round(bucket.totalDurationMs / bucket.timedCount)
        : undefined,
      lastSeen: bucket.lastSeen,
    });
  }

  // Sort by count descending
  results.sort((a, b) => b.count - a.count);
  return results;
}

/**
 * Find recurring patterns across components.
 * Looks for co-occurring events and stable distributions.
 */
export function patterns(): KBPattern[] {
  const found: KBPattern[] = [];
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;

  // Pattern 1: Lane utilization imbalance
  const recentRouting = query({ source: 'routing', type: 'route', since: oneHour, limit: 200 });
  if (recentRouting.length >= 10) {
    const laneCounts = new Map<string, number>();
    for (const e of recentRouting) {
      const lane = String(e.data.lane ?? 'unknown');
      laneCounts.set(lane, (laneCounts.get(lane) ?? 0) + 1);
    }
    const total = recentRouting.length;
    for (const [lane, count] of laneCounts) {
      const ratio = count / total;
      if (ratio > 0.8) {
        found.push({
          description: `${Math.round(ratio * 100)}% of tasks routed to ${lane} in last hour`,
          frequency: count,
          confidence: ratio,
          sources: ['routing'],
          recommendation: `Consider rebalancing: ${lane} is handling ${Math.round(ratio * 100)}% of work`,
        });
      }
    }
  }

  // Pattern 2: Delegation completion clustering
  const recentOutcomes = query({ source: 'delegation', type: 'outcome', since: oneHour, limit: 200 });
  if (recentOutcomes.length >= 3) {
    // Check for burst patterns (multiple completions within 15s)
    const timestamps = recentOutcomes.map(e => new Date(e.ts).getTime()).sort();
    let burstCount = 0;
    for (let i = 1; i < timestamps.length; i++) {
      if (timestamps[i] - timestamps[i - 1] < 15_000) burstCount++;
    }
    if (burstCount >= 2) {
      found.push({
        description: `Delegation completions tend to cluster (${burstCount} pairs within 15s)`,
        frequency: burstCount,
        confidence: burstCount / Math.max(recentOutcomes.length - 1, 1),
        sources: ['delegation', 'batch'],
        recommendation: 'DelegationBatchBuffer is capturing these clusters effectively',
      });
    }
  }

  // Pattern 3: Foreground escalation candidates
  const fgOutcomes = query({ source: 'foreground', type: 'outcome', since: oneHour, limit: 200 });
  const longFg = fgOutcomes.filter(e => (e.durationMs ?? 0) > 120_000); // > 2min
  if (longFg.length >= 3 && fgOutcomes.length > 0) {
    found.push({
      description: `${longFg.length}/${fgOutcomes.length} foreground calls took >2min — may benefit from OODA depth`,
      frequency: longFg.length,
      confidence: longFg.length / fgOutcomes.length,
      sources: ['foreground', 'routing'],
      recommendation: 'Consider raising complexity threshold for foreground→OODA escalation',
    });
  }

  // Pattern 4: Myelin crystallization readiness
  for (const [key, bucket] of aggregation) {
    if (bucket.count >= 8 && key.includes('routing')) {
      const successRate = bucket.successes / Math.max(bucket.successes + bucket.failures, 1);
      if (successRate >= 0.9) {
        found.push({
          description: `${key}: ${bucket.count} observations, ${Math.round(successRate * 100)}% success — ready for crystallization`,
          frequency: bucket.count,
          confidence: successRate,
          sources: ['myelin'],
          recommendation: 'Run myelin distill to crystallize this pattern',
        });
      }
    }
  }

  return found;
}

/**
 * Get a compact summary for injection into OODA context.
 * Returns null if no significant patterns.
 */
export function getKnowledgeSummary(): string | null {
  const allStats = stats();
  if (allStats.length === 0) return null;

  const lines: string[] = [];
  const totalEvents = allStats.reduce((sum, s) => sum + s.count, 0);
  lines.push(`Knowledge Bus: ${totalEvents} observations, ${allStats.length} categories`);

  // Top 5 by count
  for (const s of allStats.slice(0, 5)) {
    let detail = `${s.source}:${s.type} — ${s.count}x`;
    if (s.avgDurationMs != null) detail += `, avg ${s.avgDurationMs}ms`;
    if (s.successRate != null) detail += `, ${Math.round(s.successRate * 100)}% success`;
    lines.push(`  ${detail}`);
  }

  // Active patterns
  const activePatterns = patterns();
  if (activePatterns.length > 0) {
    lines.push('Patterns:');
    for (const p of activePatterns.slice(0, 3)) {
      lines.push(`  ⚡ ${p.description}`);
      if (p.recommendation) lines.push(`    → ${p.recommendation}`);
    }
  }

  return lines.join('\n');
}

/**
 * Get current buffer size and aggregation state (for /status API).
 */
export function getKBStatus(): { bufferSize: number; categories: number; totalObservations: number; patterns: number } {
  const allStats = stats();
  return {
    bufferSize: buffer.length,
    categories: allStats.length,
    totalObservations: allStats.reduce((sum, s) => sum + s.count, 0),
    patterns: patterns().length,
  };
}
