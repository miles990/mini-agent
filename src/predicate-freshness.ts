// Layer 1 of issue #306: re-verify P0 conditions before dispatch.
//
// The scheduler emits correction tasks based on a snapshot evaluation
// (`evaluateCorrectionGate`) that can lag behind ground truth — git status
// races, autonomy-closure score updates, etc. This module performs a cheap
// live re-check against the source-of-truth for each predicate type so
// stale snapshots do not produce phantom P0 tasks.
//
// Contract: `reverifyPredicate(type, ctx)` returns:
//   - true  → predicate still stale, dispatch the correction task
//   - false → predicate is now clean, skip dispatch (caller logs skip)
//   - null  → no live source-of-truth wired for this type yet (fail-open: dispatch)
//
// Layer 1 ships the three cheapest predicates as proof:
//   - `dirty-runtime-workspace`  (~50ms `git status --porcelain`)
//   - `local-commit-not-pushed`  (~50ms `git rev-list --count @{u}..HEAD`)
//   - `low-responsiveness`       (memory-index re-query, recomputes avgStaleness)
// Remaining predicates (`memory-state-truth`, `ship-truth`) are scaffolded
// but return `null` until their checks are added in follow-up commits.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { queryMemoryIndexSync, type MemoryIndexEntry } from './memory-index.js';
import { evaluateMemoryStateTruth } from './external-memory-health.js';
// NB: avoid importing from correction-gate.ts — it would form an import cycle
// because correction-gate.ts imports from modules that could circle back here.
// The ship-truth git check below is a standalone implementation using
// execFileAsync directly; it mirrors `readShipTruth` in correction-gate.ts.
// If the ship-truth logic drifts, both should be updated together.

const execFileAsync = promisify(execFile);

export interface FreshnessContext {
  repoRoot: string;
  memoryDir: string;
}

export type PredicateType =
  | 'dirty-runtime-workspace'
  | 'local-commit-not-pushed'
  | 'low-responsiveness'
  | 'memory-state-truth'
  | 'ship-truth'
  | string;

/**
 * Live re-evaluate whether a correction predicate is still stale.
 * Returns false to skip a phantom dispatch, true to proceed, null when
 * no live check is wired (fail-open).
 */
export async function reverifyPredicate(
  type: PredicateType,
  ctx: FreshnessContext,
): Promise<boolean | null> {
  switch (type) {
    case 'dirty-runtime-workspace':
      return checkDirtyRuntimeWorkspace(ctx);
    case 'local-commit-not-pushed':
      return checkLocalCommitNotPushed(ctx);
    case 'low-responsiveness':
      return checkLowResponsiveness(ctx);
    case 'memory-state-truth':
      return checkMemoryStateTruth(ctx);
    case 'ship-truth':
      return checkShipTruth(ctx);
    default:
      return null;
  }
}

/**
 * Source-of-truth: `git status --porcelain` against the runtime checkout.
 * Stale (true) when there is uncommitted work; fresh (false) when clean.
 */
async function checkDirtyRuntimeWorkspace(ctx: FreshnessContext): Promise<boolean | null> {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
      cwd: ctx.repoRoot,
      timeout: 5000,
    });
    return stdout.trim().length > 0;
  } catch {
    // Fail-open: if git status itself fails, let the snapshot win.
    return null;
  }
}

/**
 * Source-of-truth: `git rev-list --count @{u}..HEAD` against the runtime
 * checkout. Stale (true) when local commits exist that the upstream does
 * not have; fresh (false) when zero commits are ahead. Fail-open (null)
 * when no upstream is configured or the command errors — phantom-skip
 * must never silently drop a real correction.
 */
async function checkLocalCommitNotPushed(ctx: FreshnessContext): Promise<boolean | null> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['rev-list', '--count', '@{u}..HEAD'],
      { cwd: ctx.repoRoot, timeout: 5000 },
    );
    const ahead = Number.parseInt(stdout.trim(), 10);
    if (!Number.isFinite(ahead)) return null;
    return ahead > 0;
  } catch {
    // Common cause: no upstream configured (detached HEAD, fresh branch).
    // Fail-open so the snapshot decision wins.
    return null;
  }
}

/**
 * Source-of-truth: re-query memory-index for `pending|in_progress` non-goal,
 * non-background, non-correction tasks and recompute avgStaleness from
 * `payload.ticksSinceLastProgress` — exactly mirroring the snapshot math in
 * `correction-gate.ts:evaluateCorrectionGate`.
 *
 * Stale (true) when responsiveness < 0.5 (matches snapshot threshold).
 * Fresh (false) when responsiveness ≥ 0.5 — typically because a stale task
 * was completed/progressed between snapshot and dispatch. Fail-open (null)
 * when memory-index query throws.
 */
async function checkLowResponsiveness(ctx: FreshnessContext): Promise<boolean | null> {
  try {
    const allTasks = queryMemoryIndexSync(ctx.memoryDir, { type: ['task'] });
    const activeTasks = allTasks.filter(t =>
      ['pending', 'in_progress'].includes(t.status) &&
      !((t.payload as Record<string, unknown>)?.goal_id) &&
      !isBackgroundMaintenanceTask(t) &&
      !isCorrectionTask(t),
    );
    if (activeTasks.length === 0) {
      // Snapshot uses 0.8 baseline when no active tasks — definitely fresh.
      return false;
    }
    const avgStaleness = activeTasks.reduce(
      (sum, t) => sum + (((t.payload as Record<string, unknown>)?.ticksSinceLastProgress as number) ?? 0),
      0,
    ) / activeTasks.length;
    const responsiveness = Math.max(0, 1 - avgStaleness / 10);
    return responsiveness < 0.5;
  } catch {
    // Memory-index unavailable / corrupt — fail-open so snapshot wins.
    return null;
  }
}

/**
 * Source-of-truth: re-evaluate `evaluateMemoryStateTruth` against the live
 * memory directory. Returns true (stale) when the status is `blocked` or
 * `warn` — meaning malformed JSONL files or unsnapshotted git changes exist.
 * Returns false (fresh) when status is `ok`. Fail-open (null) on unexpected
 * error so the snapshot decision wins rather than silently dropping a real
 * correction.
 *
 * Wired in issue #323 as Layer 2 follow-up to #306.
 */
async function checkMemoryStateTruth(ctx: FreshnessContext): Promise<boolean | null> {
  try {
    const result = evaluateMemoryStateTruth(ctx.memoryDir, ctx.repoRoot);
    return result.status !== 'ok';
  } catch {
    return null;
  }
}

/**
 * Source-of-truth: `git status --porcelain=v2 --branch` against the runtime
 * checkout. Returns true (stale) when ahead > 0 (pending-push), behind > 0
 * (behind/diverged), or there are dirty tracked files. Returns false (fresh)
 * when clean and in sync. Fail-open (null) when git errors or no repo exists.
 *
 * This mirrors `readShipTruth` in correction-gate.ts without importing it
 * (to avoid a potential import cycle). If the logic drifts, both should be
 * updated together.
 *
 * Wired in issue #323 as Layer 2 follow-up to #306.
 */
async function checkShipTruth(ctx: FreshnessContext): Promise<boolean | null> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['status', '--porcelain=v2', '--branch'],
      { cwd: ctx.repoRoot, timeout: 5000 },
    );
    let ahead = 0;
    let behind = 0;
    let dirty = false;
    for (const line of stdout.split('\n')) {
      if (line.startsWith('# branch.ab ')) {
        const aheadMatch = line.match(/\+(\d+)/);
        const behindMatch = line.match(/-(\d+)/);
        ahead = aheadMatch ? Number(aheadMatch[1]) : 0;
        behind = behindMatch ? Number(behindMatch[1]) : 0;
      } else if (line && !line.startsWith('#')) {
        dirty = true;
      }
    }
    return ahead > 0 || behind > 0 || dirty;
  } catch {
    return null;
  }
}

/**
 * Duplicated from `correction-gate.ts` to avoid an import cycle.
 * Background maintenance tasks (e.g. KG discussion janitor, low-priority
 * discussion-lifecycle items) don't count toward responsiveness math.
 */
function isBackgroundMaintenanceTask(task: MemoryIndexEntry): boolean {
  const payload = (task.payload ?? {}) as Record<string, unknown>;
  if (payload.origin === 'kg-discussion-janitor') return true;
  const priority = Number(payload.priority);
  return Number.isFinite(priority) && priority >= 2 && Boolean(task.tags?.includes('discussion-lifecycle'));
}

/**
 * Duplicated from `correction-gate.ts` to avoid an import cycle.
 * Correction tasks emitted by the gate itself must not feed back into
 * responsiveness — that would lock the gate open whenever it is open.
 */
function isCorrectionTask(entry: Pick<MemoryIndexEntry, 'summary' | 'payload'>): boolean {
  const payload = (entry.payload ?? {}) as Record<string, unknown>;
  return (entry.summary ?? '').includes('correction gate') || payload.origin === 'correction-gate';
}
