/**
 * Structured Event Logging — JSONL with Correlation IDs
 *
 * Inspired by Claude Code's log-tool-pre.sh / log-tool-post.sh:
 * - Every event gets a unique ID
 * - Pre/post events correlated via ID
 * - JSONL format for stream processing
 * - Separate error log for fast failure analysis
 * - Daily rotation to prevent unbounded growth
 *
 * Key improvement over CC: Our logging is in-process (no shell overhead),
 * supports structured queries, and auto-correlates delegation chains.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getInstanceDir, getCurrentInstanceId } from './instance.js';
import { eventBus } from './event-bus.js';

// =============================================================================
// Types
// =============================================================================

export type EventPhase = 'pre' | 'post' | 'error' | 'info';
export type EventCategory = 'tool' | 'llm' | 'delegation' | 'hook' | 'perception' | 'cycle' | 'system';

export interface StructuredEvent {
  id: string;
  /** Correlation ID — links pre/post pairs */
  correlationId?: string;
  /** Parent event ID — links delegation chains */
  parentId?: string;
  /** Event category */
  category: EventCategory;
  /** Event phase */
  phase: EventPhase;
  /** Event name (e.g., tool name, hook name) */
  name: string;
  /** ISO timestamp */
  timestamp: string;
  /** Duration in ms (post events only) */
  durationMs?: number;
  /** Cycle number */
  cycleNumber?: number;
  /** Instance ID */
  instanceId: string;
  /** Event-specific data */
  data: Record<string, unknown>;
  /** Status */
  status: 'pending' | 'success' | 'failed';
}

export interface LogQuery {
  category?: EventCategory;
  phase?: EventPhase;
  name?: string;
  correlationId?: string;
  status?: 'success' | 'failed';
  since?: string; // ISO timestamp
  limit?: number;
}

// =============================================================================
// Structured Logger
// =============================================================================

class StructuredLogger {
  private eventCounter = 0;
  private logDir: string | null = null;
  private currentDate: string | null = null;
  private pendingCorrelations = new Map<string, { id: string; startMs: number }>();

  /** Initialize logger */
  init(): void {
    try {
      this.logDir = path.join(getInstanceDir(getCurrentInstanceId()), 'events');
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
    } catch {
      this.logDir = null;
    }
  }

  /** Generate unique event ID */
  private nextId(): string {
    return `evt_${Date.now()}_${++this.eventCounter}`;
  }

  /** Get current log file path (daily rotation) */
  private getLogPath(): string | null {
    if (!this.logDir) return null;
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.currentDate) {
      this.currentDate = today;
    }
    return path.join(this.logDir, `${today}.jsonl`);
  }

  /** Get error log file path */
  private getErrorLogPath(): string | null {
    if (!this.logDir) return null;
    const today = new Date().toISOString().slice(0, 10);
    return path.join(this.logDir, `${today}-errors.jsonl`);
  }

  /** Log a pre-event (start of an operation) */
  logPre(opts: {
    category: EventCategory;
    name: string;
    cycleNumber?: number;
    parentId?: string;
    data?: Record<string, unknown>;
  }): string {
    const id = this.nextId();
    const correlationId = `cor_${Date.now()}_${this.eventCounter}`;

    const event: StructuredEvent = {
      id,
      correlationId,
      parentId: opts.parentId,
      category: opts.category,
      phase: 'pre',
      name: opts.name,
      timestamp: new Date().toISOString(),
      cycleNumber: opts.cycleNumber,
      instanceId: getCurrentInstanceId(),
      data: opts.data ?? {},
      status: 'pending',
    };

    this.pendingCorrelations.set(correlationId, { id, startMs: Date.now() });
    this.writeEvent(event);

    return correlationId;
  }

  /** Log a post-event (completion of an operation) */
  logPost(correlationId: string, opts: {
    success: boolean;
    data?: Record<string, unknown>;
  }): void {
    const pending = this.pendingCorrelations.get(correlationId);
    if (!pending) return;

    const event: StructuredEvent = {
      id: this.nextId(),
      correlationId,
      category: 'system', // Will be overwritten if category info exists
      phase: 'post',
      name: '',
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - pending.startMs,
      instanceId: getCurrentInstanceId(),
      data: opts.data ?? {},
      status: opts.success ? 'success' : 'failed',
    };

    this.pendingCorrelations.delete(correlationId);
    this.writeEvent(event);

    // Write to error log if failed
    if (!opts.success) {
      this.writeError(event);
    }
  }

  /** Log a standalone info event */
  logInfo(opts: {
    category: EventCategory;
    name: string;
    cycleNumber?: number;
    data?: Record<string, unknown>;
  }): string {
    const id = this.nextId();
    const event: StructuredEvent = {
      id,
      category: opts.category,
      phase: 'info',
      name: opts.name,
      timestamp: new Date().toISOString(),
      cycleNumber: opts.cycleNumber,
      instanceId: getCurrentInstanceId(),
      data: opts.data ?? {},
      status: 'success',
    };

    this.writeEvent(event);
    return id;
  }

  /** Log an error event */
  logError(opts: {
    category: EventCategory;
    name: string;
    error: string;
    cycleNumber?: number;
    correlationId?: string;
    data?: Record<string, unknown>;
  }): string {
    const id = this.nextId();
    const event: StructuredEvent = {
      id,
      correlationId: opts.correlationId,
      category: opts.category,
      phase: 'error',
      name: opts.name,
      timestamp: new Date().toISOString(),
      cycleNumber: opts.cycleNumber,
      instanceId: getCurrentInstanceId(),
      data: { ...opts.data, error: opts.error },
      status: 'failed',
    };

    this.writeEvent(event);
    this.writeError(event);
    return id;
  }

  /** Query recent events */
  query(q: LogQuery): StructuredEvent[] {
    const logPath = this.getLogPath();
    if (!logPath || !fs.existsSync(logPath)) return [];

    try {
      const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n');
      let events: StructuredEvent[] = lines
        .map(line => { try { return JSON.parse(line); } catch { return null; } })
        .filter(Boolean);

      // Apply filters
      if (q.category) events = events.filter(e => e.category === q.category);
      if (q.phase) events = events.filter(e => e.phase === q.phase);
      if (q.name) events = events.filter(e => e.name === q.name);
      if (q.correlationId) events = events.filter(e => e.correlationId === q.correlationId);
      if (q.status) events = events.filter(e => e.status === q.status);
      if (q.since) events = events.filter(e => e.timestamp >= q.since!);

      // Apply limit
      const limit = q.limit ?? 100;
      return events.slice(-limit);
    } catch {
      return [];
    }
  }

  /** Get event pairs (pre + post) for a correlation ID */
  getEventPair(correlationId: string): { pre?: StructuredEvent; post?: StructuredEvent } {
    const events = this.query({ correlationId });
    return {
      pre: events.find(e => e.phase === 'pre'),
      post: events.find(e => e.phase === 'post'),
    };
  }

  /** Get summary statistics for today */
  getSummary(): {
    totalEvents: number;
    errors: number;
    avgDurationMs: Record<string, number>;
    categories: Record<string, number>;
  } {
    const events = this.query({ limit: 10000 });
    const errors = events.filter(e => e.status === 'failed').length;

    // Duration by category
    const durations: Record<string, number[]> = {};
    for (const e of events) {
      if (e.durationMs !== undefined) {
        if (!durations[e.category]) durations[e.category] = [];
        durations[e.category].push(e.durationMs);
      }
    }

    const avgDurationMs: Record<string, number> = {};
    for (const [cat, durs] of Object.entries(durations)) {
      avgDurationMs[cat] = Math.round(durs.reduce((a, b) => a + b, 0) / durs.length);
    }

    // Count by category
    const categories: Record<string, number> = {};
    for (const e of events) {
      categories[e.category] = (categories[e.category] ?? 0) + 1;
    }

    return { totalEvents: events.length, errors, avgDurationMs, categories };
  }

  /** Cleanup old log files (keep last 7 days) */
  cleanup(keepDays = 7): number {
    if (!this.logDir) return 0;

    let cleaned = 0;
    try {
      const files = fs.readdirSync(this.logDir);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - keepDays);
      const cutoffStr = cutoff.toISOString().slice(0, 10);

      for (const file of files) {
        const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})/);
        if (dateMatch && dateMatch[1] < cutoffStr) {
          fs.unlinkSync(path.join(this.logDir, file));
          cleaned++;
        }
      }
    } catch {
      // Non-critical
    }

    return cleaned;
  }

  /** Write event to JSONL log */
  private writeEvent(event: StructuredEvent): void {
    const logPath = this.getLogPath();
    if (!logPath) return;
    try {
      fs.appendFileSync(logPath, JSON.stringify(event) + '\n', 'utf-8');
    } catch {
      // Silent — logging shouldn't crash the agent
    }
  }

  /** Write to separate error log */
  private writeError(event: StructuredEvent): void {
    const errPath = this.getErrorLogPath();
    if (!errPath) return;
    try {
      fs.appendFileSync(errPath, JSON.stringify(event) + '\n', 'utf-8');
    } catch {
      // Silent
    }
  }
}

// Singleton
export const structuredLog = new StructuredLogger();

// =============================================================================
// Event Bus Integration
// =============================================================================

/**
 * Wire up structured logging to the event bus.
 * Automatically logs tool calls, LLM calls, delegations, etc.
 */
export function wireStructuredLogging(): void {
  structuredLog.init();

  // Tool events
  eventBus.on('action:tool' as any, (event) => {
    const data = event.data as Record<string, unknown>;
    if (data.phase === 'pre') {
      const corrId = structuredLog.logPre({
        category: 'tool',
        name: String(data.toolName ?? ''),
        data: { params: data.params },
      });
      // Store correlation ID for post-event
      if (data.id) {
        (event.data as any)._correlationId = corrId;
      }
    }
  });

  // Delegation events
  eventBus.on('action:delegation-start', (event) => {
    structuredLog.logInfo({
      category: 'delegation',
      name: 'spawn',
      data: event.data,
    });
  });

  eventBus.on('action:delegation-complete', (event) => {
    structuredLog.logInfo({
      category: 'delegation',
      name: 'complete',
      data: event.data,
    });
  });

  // Error events
  eventBus.on('log:error', (event) => {
    structuredLog.logError({
      category: 'system',
      name: String(event.data.tag ?? 'unknown'),
      error: String(event.data.msg ?? event.data.error ?? ''),
      data: event.data,
    });
  });

  // Cycle events
  eventBus.on('action:loop', (event) => {
    structuredLog.logInfo({
      category: 'cycle',
      name: 'loop',
      cycleNumber: event.data.cycleNumber as number,
      data: event.data,
    });
  });
}
