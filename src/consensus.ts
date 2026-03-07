/**
 * Consensus & Conflict Resolution — Cognitive Mesh Phase 4
 *
 * Prevents multiple instances from making conflicting decisions.
 * Three mechanisms:
 *   1. Decision Journal — shared append-only log of important decisions
 *   2. Exclusive Claims — short-lived mutex for operations (reply-alex, send-telegram)
 *   3. Partition Rules — static assignment of domains to perspectives
 *
 * All state is file-based (File=Truth). Uses withFileLock for cross-process safety.
 */

import fs from 'node:fs';
import path from 'node:path';
import { withFileLock } from './filelock.js';
import { getDataDir } from './instance.js';

// =============================================================================
// Types
// =============================================================================

export interface DecisionEntry {
  ts: string;             // ISO timestamp
  instance: string;       // instance ID
  perspective: string;    // 'primary' | 'chat' | 'research' | 'code'
  decision: string;       // what was decided
  context: string;        // why
  exclusive: boolean;     // was this an exclusive operation
}

export interface Claim {
  instance: string;
  ts: number;
}

export type ExclusiveOperation =
  | 'reply-alex'
  | 'send-telegram'
  | 'write-heartbeat-md'
  | 'merge-pr'
  | 'write-soul';

// Which perspective owns which domain
export interface PartitionRule {
  domain: string;
  owner: string;          // perspective type or 'primary'
  reason: string;
}

// =============================================================================
// Constants
// =============================================================================

const CLAIM_TTL_MS = 60_000;  // Claims expire after 1 minute
const DECISIONS_DIR_NAME = 'decisions';
const CLAIMS_DIR_NAME = 'claims';

// Static partition rules — the simplest consensus: don't compete
const PARTITION_RULES: PartitionRule[] = [
  { domain: 'alex-conversation', owner: 'primary', reason: 'identity consistency' },
  { domain: 'memory-write', owner: 'primary', reason: 'judgment authority' },
  { domain: 'telegram-notify', owner: 'primary', reason: 'single notification outlet' },
  { domain: 'soul-update', owner: 'primary', reason: 'identity is singular' },
  { domain: 'research-output', owner: 'research', reason: 'outputs results only, primary decides REMEMBER' },
  { domain: 'code-changes', owner: 'code', reason: 'forge worktree natural isolation' },
  { domain: 'chat-reply', owner: 'chat', reason: 'direct reply capability' },
];

// =============================================================================
// Decision Journal
// =============================================================================

function getDecisionsDir(): string {
  const dir = path.join(getDataDir(), DECISIONS_DIR_NAME);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Log a decision to the shared journal.
 * Append-only JSONL, one file per day.
 */
export async function logDecision(entry: Omit<DecisionEntry, 'ts'>): Promise<void> {
  const dir = getDecisionsDir();
  const date = new Date().toISOString().slice(0, 10);
  const filePath = path.join(dir, `${date}.jsonl`);
  const full: DecisionEntry = { ...entry, ts: new Date().toISOString() };

  await withFileLock(filePath, async () => {
    fs.appendFileSync(filePath, JSON.stringify(full) + '\n');
  });
}

/**
 * Read recent decisions (today's journal).
 */
export function getRecentDecisions(limit = 20): DecisionEntry[] {
  const dir = getDecisionsDir();
  const date = new Date().toISOString().slice(0, 10);
  const filePath = path.join(dir, `${date}.jsonl`);

  if (!fs.existsSync(filePath)) return [];

  try {
    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
    return lines
      .slice(-limit)
      .map(line => JSON.parse(line) as DecisionEntry);
  } catch {
    return [];
  }
}

/**
 * Check if another instance recently made the same decision.
 * Prevents duplicate actions (e.g., two instances both replying to Alex).
 */
export function hasRecentDecision(
  decision: string,
  withinMs = 30_000,
  excludeInstance?: string,
): boolean {
  const recent = getRecentDecisions(50);
  const cutoff = Date.now() - withinMs;

  return recent.some(d =>
    d.decision === decision &&
    new Date(d.ts).getTime() > cutoff &&
    (!excludeInstance || d.instance !== excludeInstance),
  );
}

// =============================================================================
// Exclusive Claims
// =============================================================================

function getClaimsDir(): string {
  const dir = path.join(getDataDir(), CLAIMS_DIR_NAME);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Attempt to claim exclusive ownership of an operation.
 * Returns true if claim was successful, false if another instance holds it.
 */
export async function claimExclusive(
  operation: ExclusiveOperation,
  instanceId: string,
): Promise<boolean> {
  const claimFile = path.join(getClaimsDir(), `${operation}.claim`);

  return withFileLock(claimFile, async () => {
    // Check existing claim
    if (fs.existsSync(claimFile)) {
      try {
        const existing: Claim = JSON.parse(fs.readFileSync(claimFile, 'utf-8'));
        // Claim still valid and held by someone else
        if (Date.now() - existing.ts < CLAIM_TTL_MS && existing.instance !== instanceId) {
          return false;
        }
      } catch {
        // Corrupted claim file — treat as expired
      }
    }

    // Write our claim
    const claim: Claim = { instance: instanceId, ts: Date.now() };
    fs.writeFileSync(claimFile, JSON.stringify(claim));
    return true;
  });
}

/**
 * Release an exclusive claim.
 */
export function releaseClaim(operation: ExclusiveOperation): void {
  const claimFile = path.join(getClaimsDir(), `${operation}.claim`);
  try {
    fs.unlinkSync(claimFile);
  } catch {
    // Already released or never claimed
  }
}

/**
 * Check if an operation is currently claimed (without claiming it).
 */
export function isOperationClaimed(operation: ExclusiveOperation): { claimed: boolean; by?: string } {
  const claimFile = path.join(getClaimsDir(), `${operation}.claim`);

  if (!fs.existsSync(claimFile)) {
    return { claimed: false };
  }

  try {
    const claim: Claim = JSON.parse(fs.readFileSync(claimFile, 'utf-8'));
    if (Date.now() - claim.ts >= CLAIM_TTL_MS) {
      return { claimed: false }; // Expired
    }
    return { claimed: true, by: claim.instance };
  } catch {
    return { claimed: false };
  }
}

// =============================================================================
// Partition Rules
// =============================================================================

/**
 * Check if a perspective is allowed to perform a domain operation.
 */
export function canPerformDomain(perspective: string, domain: string): boolean {
  const rule = PARTITION_RULES.find(r => r.domain === domain);
  if (!rule) return true; // No rule = anyone can do it
  return rule.owner === perspective || rule.owner === 'primary' && perspective === 'primary';
}

/**
 * Get the partition rules for observability.
 */
export function getPartitionRules(): PartitionRule[] {
  return [...PARTITION_RULES];
}

/**
 * Get all active claims for observability.
 */
export function getActiveClaims(): Array<{ operation: string; instance: string; ageMs: number }> {
  const dir = getClaimsDir();
  const claims: Array<{ operation: string; instance: string; ageMs: number }> = [];
  const now = Date.now();

  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.claim'));
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
        const claim: Claim = JSON.parse(raw);
        if (now - claim.ts < CLAIM_TTL_MS) {
          claims.push({
            operation: file.replace('.claim', ''),
            instance: claim.instance,
            ageMs: now - claim.ts,
          });
        }
      } catch { /* skip corrupted */ }
    }
  } catch { /* dir doesn't exist */ }

  return claims;
}

// =============================================================================
// Cleanup
// =============================================================================

/**
 * Clean up expired claims and old decision journals (>7 days).
 * Call periodically (e.g., on startup or daily).
 */
export function cleanupConsensusState(): void {
  // Clean expired claims
  const claimsDir = getClaimsDir();
  try {
    const files = fs.readdirSync(claimsDir).filter(f => f.endsWith('.claim'));
    for (const file of files) {
      const filePath = path.join(claimsDir, file);
      try {
        const claim: Claim = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        if (Date.now() - claim.ts >= CLAIM_TTL_MS) {
          fs.unlinkSync(filePath);
        }
      } catch {
        // Corrupted — remove
        try { fs.unlinkSync(filePath); } catch { /* ok */ }
      }
    }
  } catch { /* ok */ }

  // Clean old decision journals (>7 days)
  const decisionsDir = getDecisionsDir();
  try {
    const files = fs.readdirSync(decisionsDir).filter(f => f.endsWith('.jsonl'));
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const file of files) {
      const filePath = path.join(decisionsDir, file);
      try {
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < cutoff) {
          fs.unlinkSync(filePath);
        }
      } catch { /* skip */ }
    }
  } catch { /* ok */ }
}
