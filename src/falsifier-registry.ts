// Issue #197: Falsifier registry — structured tracking replaces text repetition.
//
// Problem: cycle output repeats falsifier conditions in natural language ~46x/day,
// inflating tokens. No deduplication, no auto-expiry, no resolved tracking.
//
// Solution: append-only JSONL registry. Each falsifier gets a stable ID
// (`fl-<8hex>`). Cycle output references `falsifier:fl-xxx` instead of restating
// the full condition. Expired/resolved entries auto-prune from active list.
//
// Storage: memory/state/falsifier-registry.jsonl — one entry per line.
// Mutations: register (new), resolve (set result), reread on every read.
//
// Schema is intentionally minimal — does NOT replace the executable
// FalsifierQuery DSL in commitment-ledger.ts. This is the lightweight
// reference layer for prose-style falsifiers in cycle output.

import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getMemoryStateDir } from './memory.js';
import { slog } from './utils.js';

// =============================================================================
// Types
// =============================================================================

export type FalsifierResult = 'confirmed' | 'falsified' | 'expired';

export interface FalsifierEntry {
  id: string;                  // fl-<8 hex chars> — stable hash of condition
  condition: string;           // human-readable predicate
  cycleCreated: number;        // cycle number when registered
  ttlCycles: number;           // expires after this many cycles
  createdAt: string;           // ISO timestamp
  resolvedAt?: string;
  result?: FalsifierResult;
  resolutionEvidence?: string; // why confirmed/falsified
}

interface RegistryFile {
  path: string;
  entries: Map<string, FalsifierEntry>;
}

// =============================================================================
// Storage
// =============================================================================

const REGISTRY_FILENAME = 'falsifier-registry.jsonl';

function registryPath(): string {
  return path.join(getMemoryStateDir(), REGISTRY_FILENAME);
}

function readRegistry(): RegistryFile {
  const filePath = registryPath();
  const entries = new Map<string, FalsifierEntry>();
  if (!existsSync(filePath)) {
    return { path: filePath, entries };
  }
  const lines = readFileSync(filePath, 'utf8').split('\n').filter((l) => l.trim());
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as FalsifierEntry;
      // Last write wins — append-only with overwrite semantics for resolve().
      entries.set(entry.id, entry);
    } catch (err) {
      slog('FALSIFIER', `parse error: ${(err as Error).message}`);
    }
  }
  return { path: filePath, entries };
}

function appendEntry(filePath: string, entry: FalsifierEntry): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  appendFileSync(filePath, JSON.stringify(entry) + '\n');
}

// =============================================================================
// ID generation
// =============================================================================

/**
 * Stable ID derived from condition text — same condition → same ID,
 * enabling natural deduplication across cycles.
 */
function generateId(condition: string): string {
  const hash = createHash('sha256').update(condition.trim()).digest('hex');
  return `fl-${hash.slice(0, 8)}`;
}

// =============================================================================
// Public API
// =============================================================================

export interface RegisterOptions {
  condition: string;
  cycleCreated: number;
  ttlCycles?: number;       // default 5
}

/**
 * Register a falsifier. If an entry with the same condition already exists
 * AND is still active, returns the existing ID without re-appending.
 * Returns the new or existing ID.
 */
export function registerFalsifier(opts: RegisterOptions): string {
  const ttl = opts.ttlCycles ?? 5;
  const id = generateId(opts.condition);
  const reg = readRegistry();
  const existing = reg.entries.get(id);
  if (existing && !existing.resolvedAt && !isExpired(existing, opts.cycleCreated)) {
    // Active duplicate — reuse ID, don't append.
    return id;
  }
  const entry: FalsifierEntry = {
    id,
    condition: opts.condition.trim(),
    cycleCreated: opts.cycleCreated,
    ttlCycles: ttl,
    createdAt: new Date().toISOString(),
  };
  appendEntry(reg.path, entry);
  slog('FALSIFIER', `registered ${id} ttl=${ttl} cycle=${opts.cycleCreated}`);
  return id;
}

export interface ResolveOptions {
  id: string;
  result: FalsifierResult;
  evidence?: string;
}

/**
 * Mark a falsifier resolved. Appends an updated entry; on reread, the latest
 * entry wins (last-write-wins via Map.set on each line parse).
 * Returns true if the falsifier existed and was updated, false otherwise.
 */
export function resolveFalsifier(opts: ResolveOptions): boolean {
  const reg = readRegistry();
  const existing = reg.entries.get(opts.id);
  if (!existing) {
    slog('FALSIFIER', `resolve miss: ${opts.id}`);
    return false;
  }
  const updated: FalsifierEntry = {
    ...existing,
    resolvedAt: new Date().toISOString(),
    result: opts.result,
    resolutionEvidence: opts.evidence,
  };
  appendEntry(reg.path, updated);
  slog('FALSIFIER', `resolved ${opts.id} → ${opts.result}`);
  return true;
}

function isExpired(entry: FalsifierEntry, currentCycle: number): boolean {
  return currentCycle - entry.cycleCreated >= entry.ttlCycles;
}

/**
 * Active falsifiers = not resolved AND not yet expired by TTL.
 * Sorted by createdAt ascending so oldest renders first.
 */
export function getActiveFalsifiers(currentCycle: number): FalsifierEntry[] {
  const reg = readRegistry();
  const active: FalsifierEntry[] = [];
  for (const entry of reg.entries.values()) {
    if (entry.resolvedAt) continue;
    if (isExpired(entry, currentCycle)) continue;
    active.push(entry);
  }
  active.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return active;
}

/**
 * Mark expired entries with result='expired' so they leave the active list
 * permanently (vs. recomputing isExpired every read). Idempotent.
 * Returns the number of entries newly marked expired.
 */
export function expireOverdueFalsifiers(currentCycle: number): number {
  const reg = readRegistry();
  let count = 0;
  for (const entry of reg.entries.values()) {
    if (entry.resolvedAt) continue;
    if (!isExpired(entry, currentCycle)) continue;
    const updated: FalsifierEntry = {
      ...entry,
      resolvedAt: new Date().toISOString(),
      result: 'expired',
    };
    appendEntry(reg.path, updated);
    count += 1;
  }
  if (count > 0) slog('FALSIFIER', `expired ${count} overdue entries`);
  return count;
}

/**
 * Compact context block for cycle output, replacing per-falsifier prose.
 * Format: `[fl-abcdef12] condition (expires in N)` per line.
 * Empty string when no active entries.
 */
export function buildFalsifierContext(currentCycle: number): string {
  const active = getActiveFalsifiers(currentCycle);
  if (active.length === 0) return '';
  const lines = active.map((e) => {
    const remaining = e.cycleCreated + e.ttlCycles - currentCycle;
    return `  [${e.id}] ${e.condition} (expires in ${remaining})`;
  });
  return `Active falsifiers (${active.length}):\n${lines.join('\n')}`;
}

/**
 * Stats for observability — useful for verifying issue #197 success criteria
 * (active count should stay manageable, expired/resolved should accumulate).
 */
export function falsifierStats(currentCycle: number): {
  active: number;
  resolved: number;
  expired: number;
  total: number;
} {
  const reg = readRegistry();
  let active = 0;
  let resolved = 0;
  let expired = 0;
  for (const entry of reg.entries.values()) {
    if (!entry.resolvedAt) {
      if (isExpired(entry, currentCycle)) expired += 1;
      else active += 1;
    } else if (entry.result === 'expired') {
      expired += 1;
    } else {
      resolved += 1;
    }
  }
  return { active, resolved, expired, total: reg.entries.size };
}
