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
// Layer 1 ships the cheapest predicate (`dirty-runtime-workspace`, ~50ms
// git status) as proof. Other predicates (`local-commit-not-pushed`,
// `low-responsiveness`, `memory-state-truth`, `ship-truth`) are scaffolded
// but return `null` until their checks are added in follow-up commits.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

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
    // Scaffolded — return null (fail-open) until each is wired in follow-ups.
    case 'local-commit-not-pushed':
    case 'low-responsiveness':
    case 'memory-state-truth':
    case 'ship-truth':
      return null;
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
