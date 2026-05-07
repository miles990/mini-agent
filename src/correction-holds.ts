import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import type { CorrectionReasonType } from './correction-gate.js';

export type UnblockWhen =
  | { kind: 'pr-merged'; pr: number; repo?: string }
  | { kind: 'branch-deleted'; branch: string }
  | { kind: 'sha-pushed'; sha: string }
  | { kind: 'timeout'; until: string };

export interface CorrectionHold {
  id: string;
  correction_reason_type: CorrectionReasonType;
  branch?: string;
  sha?: string;
  reason: string;
  unblock_when: UnblockWhen;
  created_at: string;
  created_by?: string;
}

const HOLDS_PATH = 'state/correction-holds.jsonl';

export function holdsFilePath(memoryDir: string): string {
  return path.join(memoryDir, HOLDS_PATH);
}

export function loadCorrectionHolds(memoryDir: string): CorrectionHold[] {
  const file = holdsFilePath(memoryDir);
  if (!existsSync(file)) return [];
  const raw = readFileSync(file, 'utf-8');
  const out: CorrectionHold[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as CorrectionHold;
      if (parsed && parsed.id && parsed.correction_reason_type && parsed.unblock_when) {
        out.push(parsed);
      }
    } catch {
      // Skip malformed lines
    }
  }
  return out;
}

export function appendCorrectionHold(memoryDir: string, hold: CorrectionHold): void {
  const file = holdsFilePath(memoryDir);
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, JSON.stringify(hold) + '\n', 'utf-8');
}

export interface UnblockCheckOptions {
  repoRoot?: string;
  now?: () => Date;
}

export function isHoldUnblocked(
  hold: CorrectionHold,
  options: UnblockCheckOptions = {},
): boolean {
  const u = hold.unblock_when;
  const now = options.now ? options.now() : new Date();
  const repoRoot = options.repoRoot ?? process.cwd();

  if (u.kind === 'timeout') {
    const until = new Date(u.until).getTime();
    if (Number.isNaN(until)) return false;
    return now.getTime() >= until;
  }

  if (u.kind === 'sha-pushed') {
    try {
      const out = execSync(`git ls-remote origin`, {
        cwd: repoRoot, encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'],
      });
      return out.includes(u.sha);
    } catch {
      return false;
    }
  }

  if (u.kind === 'branch-deleted') {
    try {
      const out = execSync(`git ls-remote --heads origin ${u.branch}`, {
        cwd: repoRoot, encoding: 'utf-8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'],
      });
      return out.trim() === '';
    } catch {
      return false;
    }
  }

  if (u.kind === 'pr-merged') {
    try {
      const repoArg = u.repo ? `--repo ${u.repo}` : '';
      const out = execSync(`gh pr view ${u.pr} ${repoArg} --json state -q .state`, {
        cwd: repoRoot, encoding: 'utf-8', timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'],
      });
      return out.trim() === 'MERGED';
    } catch {
      return false;
    }
  }

  return false;
}

export interface ActiveHoldMatch {
  hold: CorrectionHold;
  matchedBy: 'reason+branch+sha' | 'reason+branch' | 'reason';
}

/**
 * Find the most-specific active (not-yet-unblocked) hold matching the given reason.
 * Match precedence: reason+branch+sha (strongest) > reason+branch > reason-only (weakest).
 */
export function findActiveHold(
  holds: CorrectionHold[],
  reasonType: CorrectionReasonType,
  context: { branch?: string | null; sha?: string | null },
  options: UnblockCheckOptions = {},
): ActiveHoldMatch | null {
  const candidates = holds.filter(h => h.correction_reason_type === reasonType && !isHoldUnblocked(h, options));
  if (candidates.length === 0) return null;

  const branch = context.branch ?? null;
  const sha = context.sha ?? null;

  if (branch && sha) {
    const exact = candidates.find(h => h.branch === branch && h.sha && sha.startsWith(h.sha));
    if (exact) return { hold: exact, matchedBy: 'reason+branch+sha' };
  }
  if (branch) {
    const branchMatch = candidates.find(h => h.branch === branch && !h.sha);
    if (branchMatch) return { hold: branchMatch, matchedBy: 'reason+branch' };
  }
  const generic = candidates.find(h => !h.branch && !h.sha);
  if (generic) return { hold: generic, matchedBy: 'reason' };

  return null;
}

/**
 * Issue #316: shared filter to drop correction tasks that have an active hold.
 * Used by both `getP0TaskPreviews` (prompt header) and `Scheduler.stackRank`
 * (dispatch path) so the two paths stay consistent. Without this, scheduler
 * Rule 4 stack-ranks held correction tasks (priority 0 + +8000 score boost),
 * causing same-task re-emission every cycle while the hold is active.
 */
export function filterHeldCorrectionTasks<
  T extends { summary?: string; payload?: Record<string, unknown> | unknown }
>(
  tasks: T[],
  memoryDir: string,
  repoRoot: string,
): T[] {
  let holds: CorrectionHold[] | null = null;
  return tasks.filter(t => {
    const summary = (t as { summary?: string }).summary ?? '';
    if (!summary.includes('correction gate')) return true;
    if (holds === null) holds = loadCorrectionHolds(memoryDir);
    if (holds.length === 0) return true;
    const payload = ((t as { payload?: Record<string, unknown> }).payload ?? {}) as Record<string, unknown>;
    const reasonFromPayload = typeof payload.correction_reason_type === 'string'
      ? payload.correction_reason_type
      : null;
    const match = summary.match(/correction gate: resolve ([a-z-]+)/i);
    const reason = reasonFromPayload ?? match?.[1] ?? null;
    if (!reason) return true;
    const hold = findActiveHold(holds, reason as CorrectionReasonType, {}, { repoRoot });
    return !hold;
  });
}
