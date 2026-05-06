import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { getMemoryStateDir } from './memory.js';
import { slog } from './utils.js';

// =============================================================================
// Types
// =============================================================================

export interface CommitmentEntry {
  id: string;
  cycle_id: number;
  prediction: string;
  falsifier: string | null;
  ttl_cycles: number;
  status: 'pending' | 'kept' | 'refuted' | 'expired' | 'abandoned' | 'resolved';
  created_at: string;
  resolved_at?: string;
  resolution_evidence?: string;
  // Phase 1.5: structured falsifier executable by per-cycle resolver.
  // Legacy entries (undefined) keep expire-on-TTL behavior.
  falsifier_query?: FalsifierQuery;
  last_checked_cycle?: number;
  check_budget?: 'cheap' | 'delegate';
  // Phase 2 (cycle 14, 2026-05-05): trust layer fields. See
  // docs/plans/2026-05-05-commitment-counterparty-ack.md decision table.
  // Both nullable for backward-compat with 1740 legacy entries.
  counterparty?: Counterparty;
  ack_at?: string;
}

// Phase 2 (cycle 14, 2026-05-05): commitment counterparty discriminated union.
// 'self' = self-promise (default for legacy). 'agent' = directed at specific peer
// (alex/akari/claude-code) — ttl-expired without ack ≠ refuted, just abandoned.
// 'system' = cron/scheduler/KG-decay style automated counterparties.
export type Counterparty =
  | { kind: 'self' }
  | { kind: 'agent'; agent_id: string }
  | { kind: 'system' };

// Phase 1.5: executable falsifier DSL. Five kinds cover the common cases;
// `manual` is the escape hatch for predictions that truly need human judgment.
export type FalsifierQuery =
  | { kind: 'kg_count';    query: string; op: '<=' | '>=' | '=='; threshold: number }
  | { kind: 'log_grep';    path: string; pattern: string; since_iso: string; op: '<=' | '>=' | '=='; threshold: number }
  | { kind: 'file_exists'; path: string; must: boolean }
  | { kind: 'metric';      metric: string; op: '<=' | '>=' | '=='; threshold: number }
  | { kind: 'manual';      description: string };

export interface QueryResult {
  conclusive: boolean;
  verdict?: 'kept' | 'refuted';
  evidence: string;
}

export interface CommitmentAudit {
  pending: number;
  kept: number;
  refuted: number;
  expired: number;
  abandoned: number;
  resolved: number;
  analysisParalysis: boolean;
  noopSpiral: boolean;
  performativeSkepticism: boolean;
  recentCyclesWithoutCommitment: number;
}

// =============================================================================
// Storage helpers
// =============================================================================

const LEDGER_FILE = 'commitments.jsonl';

// Tracks the highest cycle_id that had a new commitment written, used to
// detect analysis paralysis across process restarts without a separate state file.
let _lastCommitmentCycleId: number | null = null;

function getLedgerPath(): string {
  const dir = getMemoryStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return path.join(dir, LEDGER_FILE);
}

function readAllLines(): string[] {
  const p = getLedgerPath();
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf-8').split('\n').filter(Boolean);
}

// Dedup by id — last line with a given id wins (append-only update semantics).
function deduplicateLines(lines: string[]): Map<string, CommitmentEntry> {
  const map = new Map<string, CommitmentEntry>();
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as CommitmentEntry;
      if (entry.id) map.set(entry.id, entry);
    } catch { /* skip malformed lines */ }
  }
  return map;
}

function appendLine(entry: CommitmentEntry): void {
  const p = getLedgerPath();
  appendFileSync(p, JSON.stringify(entry) + '\n', 'utf-8');
}

// =============================================================================
// Public API
// =============================================================================

export function writeCommitment(
  entry: Omit<CommitmentEntry, 'id' | 'created_at' | 'status'>,
): string {
  const id = `cl-${entry.cycle_id}-${Date.now()}`;
  const full: CommitmentEntry = {
    ...entry,
    id,
    status: 'pending',
    created_at: new Date().toISOString(),
  };
  // Phase 2: forbidden-combo guard (decision table rows). Throws synchronously.
  if (full.counterparty?.kind === 'agent' && !full.counterparty.agent_id) {
    throw new Error(`commitment ${id}: counterparty.kind=agent requires agent_id`);
  }
  if (full.ack_at && !full.counterparty) {
    throw new Error(`commitment ${id}: ack_at requires counterparty (use resolved_at for self-resolution)`);
  }
  // Cycle 80 STRUCTURAL fix: auto-populate falsifier_query from explicit DSL
  // markers in the falsifier text when not already set by caller. Opt-in;
  // prose falsifiers leave falsifier_query undefined (legacy expire-on-TTL).
  if (!full.falsifier_query && full.falsifier) {
    const parsed = parseFalsifierToQuery(full.falsifier);
    if (parsed) full.falsifier_query = parsed;
  }
  appendLine(full);
  _lastCommitmentCycleId = entry.cycle_id;
  slog('LEDGER', `commitment written ${id} cycle=${entry.cycle_id}`);
  return id;
}

export function readPendingCommitments(): CommitmentEntry[] {
  const lines = readAllLines();
  const map = deduplicateLines(lines);
  return [...map.values()].filter(e => e.status === 'pending');
}

export function updateCommitmentStatus(
  id: string,
  status: CommitmentEntry['status'],
  evidence?: string,
): void {
  const lines = readAllLines();
  const map = deduplicateLines(lines);
  const existing = map.get(id);
  if (!existing) {
    slog('LEDGER', `updateCommitmentStatus: id not found ${id}`);
    return;
  }
  const updated: CommitmentEntry = {
    ...existing,
    status,
    resolved_at: new Date().toISOString(),
    ...(evidence !== undefined ? { resolution_evidence: evidence } : {}),
  };
  appendLine(updated);
  slog('LEDGER', `commitment ${id} → ${status}`);
}

export function ackCommitment(id: string, by_agent_id?: string): boolean {
  const lines = readAllLines();
  const map = deduplicateLines(lines);
  const existing = map.get(id);
  if (!existing) {
    slog('LEDGER', `ackCommitment: id not found ${id}`);
    return false;
  }
  if (!existing.counterparty) {
    slog('LEDGER', `ackCommitment: ${id} has no counterparty (cannot ack)`);
    return false;
  }
  if (existing.ack_at) {
    slog('LEDGER', `ackCommitment: ${id} already acked at ${existing.ack_at}`);
    return false;
  }
  if (
    by_agent_id &&
    existing.counterparty.kind === 'agent' &&
    existing.counterparty.agent_id &&
    existing.counterparty.agent_id !== by_agent_id
  ) {
    slog('LEDGER', `ackCommitment: ${id} ack-by mismatch ${by_agent_id} vs expected ${existing.counterparty.agent_id}`);
    return false;
  }
  const updated: CommitmentEntry = {
    ...existing,
    ack_at: new Date().toISOString(),
  };
  appendLine(updated);
  slog('LEDGER', `commitment ${id} acked by ${by_agent_id || existing.counterparty.kind}`);
  return true;
}

export function auditCommitments(currentCycleId: number): CommitmentAudit {
  const lines = readAllLines();
  const map = deduplicateLines(lines);
  const all = [...map.values()];

  const pending = all.filter(e => e.status === 'pending').length;
  const kept = all.filter(e => e.status === 'kept').length;
  const refuted = all.filter(e => e.status === 'refuted').length;
  const expired = all.filter(e => e.status === 'expired').length;
  const abandoned = all.filter(e => e.status === 'abandoned').length;
  const resolved = all.filter(e => e.status === 'resolved').length;

  // Analysis paralysis: no new commitment written in the last 5 cycles.
  // We track the last cycle that produced a commitment across process restarts
  // by scanning created_at entries when the in-memory marker is absent.
  let lastCycleWithCommitment = _lastCommitmentCycleId;
  if (lastCycleWithCommitment === null && all.length > 0) {
    lastCycleWithCommitment = Math.max(...all.map(e => e.cycle_id));
  }
  const recentCyclesWithoutCommitment =
    lastCycleWithCommitment === null
      ? currentCycleId
      : currentCycleId - lastCycleWithCommitment;

  const PARALYSIS_THRESHOLD = 5;
  const analysisParalysis = recentCyclesWithoutCommitment >= PARALYSIS_THRESHOLD;

  // Noop spiral: >50% of pending commitments have no falsifier.
  // A falsifier is what makes a commitment Popperian — without one the agent
  // can never be wrong, so the commitment is unfalsifiable (i.e., meaningless).
  const pendingEntries = all.filter(e => e.status === 'pending');
  const noFalsifierCount = pendingEntries.filter(e => e.falsifier === null).length;
  const noopSpiral =
    pendingEntries.length >= 3 && noFalsifierCount / pendingEntries.length > 0.5;

  // Performative skepticism: execution rate < 30% over last 20 entries.
  // Rate = (kept + refuted) / total — both represent actual follow-through.
  // Pure pending and expired entries mean the agent made promises but never
  // tried hard enough to either keep or actively falsify them.
  const last20 = all.slice(-20);
  const last20Resolved = last20.filter(
    e => e.status === 'kept' || e.status === 'refuted',
  ).length;
  const performativeSkepticism =
    last20.length >= 5 && last20Resolved / last20.length < 0.3;

  return {
    pending,
    kept,
    refuted,
    expired,
    abandoned,
    resolved,
    analysisParalysis,
    noopSpiral,
    performativeSkepticism,
    recentCyclesWithoutCommitment,
  };
}

// =============================================================================
// Phase 1.5: Falsifier executor
// =============================================================================

// Cheap, synchronous query runners. Network-bound kinds (kg_count) and
// runtime metric checks return inconclusive for now; file-local checks execute
// inline so ledger commitments can resolve without delegation.

/**
 * Parse a falsifier string for explicit FalsifierQuery DSL markers.
 * Returns undefined if no parseable marker is found (prose falsifiers stay
 * unstructured — conservative, no false-positive auto-resolution).
 *
 * Supported DSL markers (opt-in, write anywhere in the falsifier text):
 *   file_exists:/abs/path      -> { kind:'file_exists', path, must:true }
 *   file_not_exists:/abs/path  -> { kind:'file_exists', path, must:false }
 *   grep:/abs/path "pattern" [since:ISO] >=N
 *   grep:/abs/path "pattern" [since:ISO] <=N
 *   grep:/abs/path "pattern" [since:ISO] ==N
 *
 * Closes the cycle 80 STRUCTURAL gap: dispatcher.ts:1024 + loop.ts:2659
 * writeCommitment calls now auto-populate falsifier_query so
 * resolveReadyCommitments can resolve agent-written commitments. Without
 * this, recent commitments aged out 100% as expired/abandoned despite the
 * resolver being wired in buildLedgerSection.
 */
export function parseFalsifierToQuery(falsifier: string): FalsifierQuery | undefined {
  const stop = String.raw`(?=[\s,;。、)）]|$)`;
  const neg = falsifier.match(new RegExp(String.raw`\bfile_not_exists:(\/\S+?)` + stop));
  if (neg) return { kind: 'file_exists', path: neg[1], must: false };
  const pos = falsifier.match(new RegExp(String.raw`\bfile_exists:(\/\S+?)` + stop));
  if (pos) return { kind: 'file_exists', path: pos[1], must: true };

  const grep = falsifier.match(
    /\bgrep:(\/\S+?)\s+"((?:[^"\\]|\\.)*)"(?:\s+since:(\S+?))?\s+(>=|<=|==)\s*(\d+)/,
  );
  if (grep) {
    return {
      kind: 'log_grep',
      path: grep[1],
      pattern: unescapeQuotedPattern(grep[2]),
      since_iso: grep[3] ?? new Date().toISOString(),
      op: grep[4] as '<=' | '>=' | '==',
      threshold: Number.parseInt(grep[5], 10),
    };
  }
  return undefined;
}

function runQuery(q: FalsifierQuery): QueryResult {
  switch (q.kind) {
    case 'file_exists': {
      const exists = existsSync(q.path);
      if (exists === q.must) {
        return {
          conclusive: true,
          verdict: 'kept',
          evidence: `file_exists(${q.path}) = ${exists}, expected ${q.must}`,
        };
      }
      return {
        conclusive: true,
        verdict: 'refuted',
        evidence: `file_exists(${q.path}) = ${exists}, expected ${q.must}`,
      };
    }
    case 'manual':
      return {
        conclusive: false,
        evidence: `manual: ${q.description} (awaiting manual resolution)`,
      };
    case 'log_grep':
      return runLogGrepQuery(q);
    case 'kg_count':
    case 'metric':
      return {
        conclusive: false,
        evidence: `kind=${q.kind} executor not yet implemented (Phase 1.5 stub)`,
      };
  }
}

function runLogGrepQuery(q: Extract<FalsifierQuery, { kind: 'log_grep' }>): QueryResult {
  if (!existsSync(q.path)) {
    return {
      conclusive: true,
      verdict: 'refuted',
      evidence: `log_grep: file ${q.path} does not exist`,
    };
  }

  let re: RegExp;
  try {
    re = new RegExp(q.pattern);
  } catch (err) {
    return {
      conclusive: false,
      evidence: `log_grep: invalid regex /${q.pattern}/: ${(err as Error).message}`,
    };
  }

  const sinceMs = Date.parse(q.since_iso);
  const useSince = !Number.isNaN(sinceMs);
  const content = readFileSync(q.path, 'utf-8');
  let count = 0;

  for (const line of content.split('\n')) {
    if (!re.test(line)) continue;
    if (!useSince) {
      count++;
      continue;
    }

    const tsMatch = line.match(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b/);
    if (!tsMatch) {
      count++;
      continue;
    }
    if (Date.parse(tsMatch[0]) >= sinceMs) count++;
  }

  const kept =
    q.op === '>=' ? count >= q.threshold :
    q.op === '<=' ? count <= q.threshold :
    count === q.threshold;

  return {
    conclusive: true,
    verdict: kept ? 'kept' : 'refuted',
    evidence: `log_grep ${q.path} /${q.pattern}/ since ${q.since_iso} -> count=${count} ${q.op}${q.threshold} -> ${kept ? 'kept' : 'refuted'}`,
  };
}

function unescapeQuotedPattern(pattern: string): string {
  return pattern.replace(/\\(["\\])/g, '$1');
}

export function resolveReadyCommitments(
  currentCycleId: number,
): { resolved: number; skipped: number } {
  const pending = readPendingCommitments();
  let resolved = 0;
  let skipped = 0;
  for (const entry of pending) {
    if (!entry.falsifier_query) { skipped++; continue; }
    if (entry.last_checked_cycle === currentCycleId) { skipped++; continue; }
    // delegate-budget queries are deferred-async — skip for now, next-cycle resolution.
    if (entry.check_budget === 'delegate') { skipped++; continue; }

    const result = runQuery(entry.falsifier_query);
    if (result.conclusive && result.verdict) {
      updateCommitmentStatus(entry.id, result.verdict, result.evidence);
      resolved++;
    } else {
      // Throttle: mark as checked-this-cycle so we don't re-run until next cycle.
      appendLine({ ...entry, last_checked_cycle: currentCycleId });
      skipped++;
    }
  }
  if (resolved > 0 || skipped > 0) {
    slog('LEDGER', `resolveReady: resolved=${resolved} skipped=${skipped}`);
  }
  return { resolved, skipped };
}

export function expireOverdueCommitments(currentCycleId: number): number {
  const pending = readPendingCommitments();
  let expiredCount = 0;
  let abandonedCount = 0;
  for (const entry of pending) {
    if (currentCycleId - entry.cycle_id >= entry.ttl_cycles) {
      // Phase C (cycle 16, 2026-05-05): trust-layer terminal-state distinction.
      // Agent-directed commitment that exceeded ttl WITHOUT acknowledgment
      // is 'abandoned' (counterparty never engaged), not 'expired' (own
      // falsifier ran out of time). cl-373 Alex 9hr no-reply was the
      // motivating case: monolithic 'expired' lost the trust-layer signal.
      const isAgentCommitment =
        entry.counterparty?.kind === 'agent' && !entry.ack_at;
      if (isAgentCommitment) {
        updateCommitmentStatus(
          entry.id,
          'abandoned',
          `ttl_cycles=${entry.ttl_cycles} exceeded at cycle ${currentCycleId}; counterparty=${(entry.counterparty as { kind: 'agent'; agent_id: string }).agent_id} never acked`,
        );
        abandonedCount++;
      } else {
        updateCommitmentStatus(
          entry.id,
          'expired',
          `ttl_cycles=${entry.ttl_cycles} exceeded at cycle ${currentCycleId}`,
        );
        expiredCount++;
      }
    }
  }
  if (expiredCount > 0) slog('LEDGER', `expired ${expiredCount} overdue commitments`);
  if (abandonedCount > 0) slog('LEDGER', `abandoned ${abandonedCount} unacked agent commitments`);
  return expiredCount + abandonedCount;
}

export function buildLedgerSection(currentCycleId: number): string {
  // Phase 1.5: try to resolve via structured queries BEFORE TTL expiry fires.
  // This is what turns the ledger from a timer into a cognitive probe.
  try { resolveReadyCommitments(currentCycleId); } catch (e) {
    slog('LEDGER', `resolveReadyCommitments failed: ${(e as Error).message}`);
  }
  expireOverdueCommitments(currentCycleId);
  const audit = auditCommitments(currentCycleId);
  const pending = readPendingCommitments();

  const lines: string[] = ['<commitment-ledger>'];

  if (pending.length === 0) {
    lines.push('No pending commitments.');
  } else {
    lines.push(`Pending commitments (${pending.length}):`);
    for (const e of pending) {
      const age = Math.max(0, currentCycleId - e.cycle_id);
      const remaining = Math.max(0, e.ttl_cycles - age);
      const falsifierPart = e.falsifier ? ` | falsifier: ${e.falsifier}` : ' | no falsifier';
      lines.push(`  [${e.id}] cycle=${e.cycle_id} ttl=${remaining} remaining — ${e.prediction}${falsifierPart}`);
      if (e.falsifier_query) {
        const q = e.falsifier_query;
        const qDesc =
          q.kind === 'kg_count'    ? `kg_count(${q.query}) ${q.op} ${q.threshold}` :
          q.kind === 'log_grep'    ? `log_grep(${q.path} /${q.pattern}/) ${q.op} ${q.threshold} since ${q.since_iso}` :
          q.kind === 'file_exists' ? `file_exists(${q.path}) must=${q.must}` :
          q.kind === 'metric'      ? `metric(${q.metric}) ${q.op} ${q.threshold}` :
          /* manual */               `manual: ${q.description}`;
        const checked = e.last_checked_cycle != null
          ? ` [last checked cycle ${e.last_checked_cycle}]`
          : ' [never checked]';
        lines.push(`    query: ${qDesc}${checked}`);
      }
    }
  }

  lines.push('');
  lines.push(`Stats: pending=${audit.pending} kept=${audit.kept} refuted=${audit.refuted} resolved=${audit.resolved} expired=${audit.expired} abandoned=${audit.abandoned}`);

  // Phase B circulation fix (#82 Finding 1): surface unacked agent-counterparty
  // commitments at prompt-time so the agent learns the <kuro:ack> DSL inline
  // instead of letting them silently age into 'abandoned'. age>=2 threshold
  // gives counterparty time to respond before nagging.
  const unackedAgent = pending.filter(e =>
    e.counterparty?.kind === 'agent' &&
    !e.ack_at &&
    (currentCycleId - e.cycle_id) >= 2,
  );
  if (unackedAgent.length > 0) {
    lines.push('');
    lines.push(`Awaiting ack from counterparty (${unackedAgent.length}):`);
    for (const e of unackedAgent) {
      const age = currentCycleId - e.cycle_id;
      const cp = e.counterparty as { kind: 'agent'; agent_id: string };
      const snippet = e.prediction.length > 80 ? e.prediction.slice(0, 77) + '...' : e.prediction;
      lines.push(`  - ${e.id} (counterparty=${cp.agent_id}, age=${age} cycles): "${snippet}"`);
    }
    lines.push(`  → If counterparty has addressed any of these, emit: <kuro:ack id="cl-X" by="${(unackedAgent[0].counterparty as { kind: 'agent'; agent_id: string }).agent_id}" />`);
  }

  const warnings: string[] = [];

  if (audit.analysisParalysis) {
    warnings.push(
      `ANALYSIS PARALYSIS: ${audit.recentCyclesWithoutCommitment} cycles without a new commitment. Make at least one concrete, falsifiable prediction this cycle.`,
    );
  }

  if (audit.noopSpiral) {
    warnings.push(
      `NOOP SPIRAL: >50% of pending commitments have no falsifier. Add observable falsifiers — what would prove each commitment wrong?`,
    );
  }

  if (audit.performativeSkepticism) {
    warnings.push(
      `PERFORMATIVE SKEPTICISM: execution rate <30% over last 20 entries. Commitments are being made but not followed through.`,
    );
  }

  if (warnings.length > 0) {
    lines.push('');
    lines.push('Failure mode warnings:');
    for (const w of warnings) lines.push(`  ⚠ ${w}`);
  }

  lines.push('</commitment-ledger>');
  return lines.join('\n');
}
