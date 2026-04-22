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
  status: 'pending' | 'kept' | 'refuted' | 'expired';
  created_at: string;
  resolved_at?: string;
  resolution_evidence?: string;
}

export interface CommitmentAudit {
  pending: number;
  kept: number;
  refuted: number;
  expired: number;
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

export function auditCommitments(currentCycleId: number): CommitmentAudit {
  const lines = readAllLines();
  const map = deduplicateLines(lines);
  const all = [...map.values()];

  const pending = all.filter(e => e.status === 'pending').length;
  const kept = all.filter(e => e.status === 'kept').length;
  const refuted = all.filter(e => e.status === 'refuted').length;
  const expired = all.filter(e => e.status === 'expired').length;

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
    analysisParalysis,
    noopSpiral,
    performativeSkepticism,
    recentCyclesWithoutCommitment,
  };
}

export function expireOverdueCommitments(currentCycleId: number): number {
  const pending = readPendingCommitments();
  let count = 0;
  for (const entry of pending) {
    if (currentCycleId - entry.cycle_id >= entry.ttl_cycles) {
      updateCommitmentStatus(
        entry.id,
        'expired',
        `ttl_cycles=${entry.ttl_cycles} exceeded at cycle ${currentCycleId}`,
      );
      count++;
    }
  }
  if (count > 0) slog('LEDGER', `expired ${count} overdue commitments`);
  return count;
}

export function buildLedgerSection(currentCycleId: number): string {
  expireOverdueCommitments(currentCycleId);
  const audit = auditCommitments(currentCycleId);
  const pending = readPendingCommitments();

  const lines: string[] = ['<commitment-ledger>'];

  if (pending.length === 0) {
    lines.push('No pending commitments.');
  } else {
    lines.push(`Pending commitments (${pending.length}):`);
    for (const e of pending) {
      const age = currentCycleId - e.cycle_id;
      const remaining = e.ttl_cycles - age;
      const falsifierPart = e.falsifier ? ` | falsifier: ${e.falsifier}` : ' | no falsifier';
      lines.push(`  [${e.id}] cycle=${e.cycle_id} ttl=${remaining} remaining — ${e.prediction}${falsifierPart}`);
    }
  }

  lines.push('');
  lines.push(`Stats: pending=${audit.pending} kept=${audit.kept} refuted=${audit.refuted} expired=${audit.expired}`);

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
