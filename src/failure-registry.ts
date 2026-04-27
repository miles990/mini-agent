/**
 * Agent OS Failure Pattern Registry — negative feedback loop foundation
 *
 * Records failure patterns for future retrieval (Phase 3).
 * Phase 2: write + debug read only. matchFailure() deferred to Phase 3.
 */

import { slog } from './utils.js';
import { eventBus } from './event-bus.js';

// =============================================================================
// Types
// =============================================================================

export interface FailureRecord {
  id: string;
  pattern: string;
  context: string;
  frequency: number;
  firstSeen: string;
  lastSeen: string;
}

// =============================================================================
// State
// =============================================================================

const registry = new Map<string, FailureRecord>();
let idCounter = 0;

// =============================================================================
// Write API
// =============================================================================

export function recordFailure(pattern: string, context: string): FailureRecord {
  const normalizedPattern = pattern.toLowerCase().trim();
  const existing = findByPattern(normalizedPattern);

  if (existing) {
    existing.frequency++;
    existing.lastSeen = new Date().toISOString();
    existing.context = context.slice(0, 500);
    slog('FAILURE', `repeat (${existing.frequency}x): ${pattern.slice(0, 60)}`);
    eventBus.emit('action:scheduler', { event: 'failure-recorded', pattern: pattern.slice(0, 60), frequency: existing.frequency, isNew: false });
    return existing;
  }

  const record: FailureRecord = {
    id: `fail-${++idCounter}-${Date.now()}`,
    pattern: normalizedPattern,
    context: context.slice(0, 500),
    frequency: 1,
    firstSeen: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
  };

  registry.set(record.id, record);
  slog('FAILURE', `new pattern: ${pattern.slice(0, 60)}`);
  eventBus.emit('action:scheduler', { event: 'failure-recorded', pattern: pattern.slice(0, 60), frequency: 1, isNew: true });
  return record;
}

// =============================================================================
// Read API (debug only in Phase 2)
// =============================================================================

export function getTopFailures(limit: number = 10): FailureRecord[] {
  return Array.from(registry.values())
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, limit);
}

export function getFailureCount(): number {
  return registry.size;
}

// =============================================================================
// Retrieval API (Phase 3 — pre-action check)
// =============================================================================

export function matchFailure(action: string): FailureRecord | null {
  const normalized = action.toLowerCase().trim();
  let bestMatch: FailureRecord | null = null;
  let bestScore = 0;

  for (const record of registry.values()) {
    if (record.frequency < 2) continue;
    const words = record.pattern.split(/\s+/);
    const matchCount = words.filter(w => normalized.includes(w)).length;
    const score = matchCount / words.length;
    if (score > 0.5 && score > bestScore) {
      bestScore = score;
      bestMatch = record;
    }
  }

  return bestMatch;
}

// =============================================================================
// Maintenance
// =============================================================================

export function clearOld(ttlMs: number): number {
  const cutoff = Date.now() - ttlMs;
  let removed = 0;
  for (const [id, record] of registry) {
    if (new Date(record.lastSeen).getTime() < cutoff) {
      registry.delete(id);
      removed++;
    }
  }
  if (removed > 0) slog('FAILURE', `cleared ${removed} old patterns (ttl=${Math.round(ttlMs / 86400000)}d)`);
  return removed;
}

export function clearAll(): void {
  registry.clear();
}

// =============================================================================
// Helpers
// =============================================================================

function findByPattern(normalizedPattern: string): FailureRecord | null {
  for (const record of registry.values()) {
    if (record.pattern === normalizedPattern) return record;
  }
  return null;
}
