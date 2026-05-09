// Layer 1 + Layer 2 of issue #306 / #323: re-verify P0 conditions before dispatch.
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
// Layer 1 wired three cheap predicates:
//   - `dirty-runtime-workspace`  (~50ms `git status --porcelain`)
//   - `local-commit-not-pushed`  (~50ms `git rev-list --count @{u}..HEAD`)
//   - `low-responsiveness`       (memory-index re-query, recomputes avgStaleness)
// Layer 2 (issue #323) adds the remaining two:
//   - `memory-state-truth`       (live `evaluateMemoryStateTruth` — JSONL parse,
//                                 HEARTBEAT phantom check, curated-memory git status)
//   - `ship-truth`               (live `git rev-list --left-right --count @{u}...HEAD`
//                                 → `behind > 0` is the snapshot-trigger condition)

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { queryMemoryIndexSync, type MemoryIndexEntry } from './memory-index.js';
import { evaluateMemoryStateTruth } from './external-memory-health.js';
// NB: avoid importing from correction-gate.ts — historically it formed an
// import cycle with this module. Re-implement the small slice we need
// (ahead/behind via `git rev-list --left-right --count`) inline.

const execFileAsync = promisify(execFile);

export interface FreshnessContext {
  repoRoot: string;
  memoryDir: string;
  /**
   * Optional task entry being re-verified. Predicates that need
   * task-specific metadata (e.g. github-issue-open needs repo + issue number)
   * read it from here. Other predicates ignore it.
   */
  entry?: { id?: string; summary?: string; payload?: Record<string, unknown> };
  /**
   * Test injection: override the live `gh issue view` call. Returns the
   * issue state (`OPEN` | `CLOSED`) or null when unavailable. Defaults to
   * a real `execFile('gh', ['issue', 'view', ...])` when not provided.
   */
  ghIssueView?: (repo: string, issueNumber: number) => Promise<{ state: string } | null>;
}

export type PredicateType =
  | 'dirty-runtime-workspace'
  | 'local-commit-not-pushed'
  | 'low-responsiveness'
  | 'memory-state-truth'
  | 'ship-truth'
  | 'github-issue-open'
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
    case 'github-issue-open':
      return checkGitHubIssueOpen(ctx);
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
 * Source-of-truth: `evaluateMemoryStateTruth` from external-memory-health.
 * That helper is the single producer of the `memory-state-truth` autonomy
 * stage status (see autonomy-closure-health.ts:516-525), so calling it
 * gives us the exact same answer the snapshot would compute right now.
 *
 * Stale (true) when status is `blocked` or `warn` — i.e. malformed JSONL,
 * HEARTBEAT phantom recurring-error tasks, or curated memory dirty.
 * Fresh (false) when status is `ok`. Fail-open (null) when the helper
 * itself throws.
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
 * Source-of-truth: `git rev-list --left-right --count @{u}...HEAD` against
 * the runtime checkout. The snapshot's ship-and-deploy stage marks the
 * predicate stale when `state ∈ {behind, diverged}` (autonomy-closure-
 * health.ts:442-451), both of which require `behind > 0`. So we just need
 * the live behind count.
 *
 * Stale (true) when behind > 0. Fresh (false) when behind === 0.
 * Fail-open (null) when no upstream is configured or git errors —
 * matches the snapshot's `state: 'unknown'` path which doesn't block.
 */
async function checkShipTruth(ctx: FreshnessContext): Promise<boolean | null> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['rev-list', '--left-right', '--count', '@{u}...HEAD'],
      { cwd: ctx.repoRoot, timeout: 5000 },
    );
    // Output: "<behind>\t<ahead>"
    const parts = stdout.trim().split(/\s+/);
    const behind = Number.parseInt(parts[0] ?? '', 10);
    if (!Number.isFinite(behind)) return null;
    return behind > 0;
  } catch {
    // No upstream / detached HEAD / git error → fail-open.
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
  if (payload.origin === 'middleware-self-healing') return true;
  const priority = Number(payload.priority);
  return Number.isFinite(priority) && priority >= 2;
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

/**
 * Source-of-truth: `gh issue view N --repo R --json state` against GitHub.
 *
 * Used for heartbeat-derived `idx-github-issue-*` tasks. Without this
 * predicate the scheduler dispatches an issue-task whose underlying
 * issue was already closed (autopilot reconciliation may not have run
 * yet between snapshot and dispatch), producing phantom P0 cycles —
 * the failure mode reported in mini-agent#465.
 *
 * Stale (true) when the live issue state is `OPEN` (matches snapshot →
 * proceed with dispatch). Fresh (false) when the live state is `CLOSED`
 * (snapshot was lagging → caller skips dispatch). Fail-open (null) when:
 *   - ctx.entry is missing or lacks `repo`/`issue_number` payload fields;
 *   - the `gh` call throws or returns malformed JSON.
 *
 * Test injection via `ctx.ghIssueView` bypasses the real `gh` binary.
 */
export async function checkGitHubIssueOpen(ctx: FreshnessContext): Promise<boolean | null> {
  const meta = extractGitHubIssueMeta(ctx.entry);
  if (!meta) return null;
  try {
    const result = ctx.ghIssueView
      ? await ctx.ghIssueView(meta.repo, meta.issueNumber)
      : await defaultGhIssueView(meta.repo, meta.issueNumber);
    if (!result || typeof result.state !== 'string') return null;
    return result.state.toUpperCase() === 'OPEN';
  } catch {
    return null;
  }
}

function extractGitHubIssueMeta(
  entry: FreshnessContext['entry'],
): { repo: string; issueNumber: number } | null {
  if (!entry) return null;
  const payload = (entry.payload ?? {}) as Record<string, unknown>;
  const repo = typeof payload.repo === 'string' ? payload.repo.trim() : '';
  const issueNumber = Number(payload.issue_number);
  if (!repo || !/^[^/\s]+\/[^/\s]+$/.test(repo)) return null;
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) return null;
  return { repo, issueNumber };
}

async function defaultGhIssueView(
  repo: string,
  issueNumber: number,
): Promise<{ state: string } | null> {
  const { stdout } = await execFileAsync(
    'gh',
    ['issue', 'view', String(issueNumber), '--repo', repo, '--json', 'state'],
    { timeout: 5000 },
  );
  const parsed = JSON.parse(stdout) as { state?: unknown };
  if (typeof parsed.state !== 'string') return null;
  return { state: parsed.state };
}

