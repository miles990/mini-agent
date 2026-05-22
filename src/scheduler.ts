/**
 * Agent OS Scheduler — deterministic task scheduling
 *
 * Replaces LLM's ad-hoc task selection with code-layer scheduling.
 * OS is inspiration, not blueprint — adapted for agent impedance mismatch.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { queryMemoryIndexSync, updateMemoryIndexEntry, updateMemoryIndexEntrySync, loadResolvedTaskKeysFromEvents, type MemoryIndexEntry } from './memory-index.js';
import { slog } from './utils.js';
import { eventBus } from './event-bus.js';
import { completeProcess, getProcess } from './process-table.js';
import { evaluateCorrectionGate, isCorrectionTask, type CorrectionGateSnapshot } from './correction-gate.js';
import { evaluateAutonomyClosure, isAutonomyClosureTask, type AutonomyClosureSnapshot } from './autonomy-closure-health.js';
import { reverifyPredicate } from './predicate-freshness.js';
import { filterHeldCorrectionTasks } from './correction-holds.js';
import { rearmRecurringTasks } from './recurrence.js';

// =============================================================================
// Types
// =============================================================================

export interface HoldCondition {
  type: 'task-completed' | 'file-exists' | 'command-succeeds' | 'date-after' | 'manual';
  value: string;
}

export interface TaskSnapshot {
  id: string;
  summary: string;
  status: string;
  priority: number;
  source: 'alex' | 'kuro' | 'system' | 'discovery';
  createdAt: string;
  ticksSpent: number;
  deadline: string | null;
  dependsOn: string[];
}

export interface SchedulerState {
  currentTaskId: string | null;
  ticksOnCurrent: number;
  totalTicks: number;
  lastDiscoveryTick: number;
}

export type SchedulerAction = 'continue' | 'switch' | 'discovery' | 'idle';

export interface SchedulingDecision {
  taskId: string | null;
  reason: string;
  action: SchedulerAction;
  suspended: SuspendInfo | null;
}

export interface SuspendInfo {
  taskId: string;
  reason: 'preempted' | 'attention_budget' | 'blocked';
  priorityAtSuspend: number;
}

export interface IncomingEvent {
  source: string;
  priority: number;
  isAlexDirectMessage: boolean;
}

export type SchedulerWorkMode = 'maintenance' | 'creative';

export interface SchedulerOptions {
  workMode?: SchedulerWorkMode;
}

export interface SchedulerPolicy {
  decideNext(
    tasks: TaskSnapshot[],
    state: SchedulerState,
    events: IncomingEvent[],
    options?: SchedulerOptions,
  ): SchedulingDecision;
}

// =============================================================================
// Config
// =============================================================================

const ATTENTION_BUDGET = 15;
const DISCOVERY_INTERVAL = 10;
const AGING_BOOST_TICKS = 30;
export const ALEX_CHAT_DERIVED_TASK_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * Reason tag for the creative-trunk fairness floor. The discovery slot is a
 * primary track of being, co-equal with the task queue — not a leftover that
 * only runs when nothing else is pending. Every DISCOVERY_INTERVAL ticks it
 * takes one cycle even while tasks (including standing P0 *tasks*) are bound.
 * A live P0 *event* (a genuine emergency / direct signal) still owns the cycle.
 * The correction gate must NOT override this — the bound task is not lost, it
 * resumes on the very next tick.
 */
const CREATIVE_TRUNK_REASON =
  'discovery slot: creative trunk fairness floor — yields one cycle from the task queue';

/** Consecutive terminal-signal cycles before a task is suppressed from dispatch. */
export const DISPATCH_SUPPRESSION_THRESHOLD = 3;
const STALE_MIDDLEWARE_TRIAGE_TICKS = 100;

// =============================================================================
// Default Scheduler
// =============================================================================

export class DefaultScheduler implements SchedulerPolicy {
  decideNext(
    tasks: TaskSnapshot[],
    state: SchedulerState,
    events: IncomingEvent[],
    options: SchedulerOptions = {},
  ): SchedulingDecision {
    const workMode = options.workMode ?? 'maintenance';
    const activeTasks = tasks.filter(t => t.status === 'pending' || t.status === 'in_progress');
    const hasP0Event = events.some(e => e.priority === 0 || e.isAlexDirectMessage);
    const isDiscoverySlot = state.totalTicks > 0 && state.totalTicks % DISCOVERY_INTERVAL === 0;

    if (activeTasks.length === 0) {
      if (hasP0Event) {
        return { taskId: null, reason: 'event-driven open-cycle: no tasks, direct signal needs attention', action: 'discovery', suspended: null };
      }
      if (workMode === 'creative') {
        return { taskId: null, reason: 'discovery slot: no tasks, free exploration', action: 'discovery', suspended: null };
      }
      return { taskId: null, reason: 'idle: maintenance mode has no schedulable tasks', action: 'idle', suspended: null };
    }

    if (workMode === 'creative' && !hasP0Event) {
      return { taskId: null, reason: 'creative mode: free creation is active', action: 'discovery', suspended: null };
    }

    // Rule 1: P0 event preempts non-P0 current task
    if (hasP0Event && state.currentTaskId) {
      const current = activeTasks.find(t => t.id === state.currentTaskId);
      if (current && current.priority > 0) {
        const p0Task = activeTasks.find(t => t.priority === 0);
        if (p0Task && p0Task.id !== state.currentTaskId) {
          return {
            taskId: p0Task.id,
            reason: `P0 preemption: ${p0Task.summary.slice(0, 60)}`,
            action: 'switch',
            suspended: {
              taskId: current.id,
              reason: 'preempted',
              priorityAtSuspend: current.priority,
            },
          };
        }
      }
    }

    // Rule 2: Creative-trunk fairness floor. The discovery slot fires every
    // DISCOVERY_INTERVAL ticks even while a task is bound — placed BEFORE the
    // task-binding rule so a standing P0 *task* cannot monopolise every cycle
    // and starve the creative trunk. A live P0 *event* (Rule 1 already ran)
    // still owns its cycle: !hasP0Event guards that. The bound task is not
    // dropped — currentTaskId persists, so it resumes on the next tick.
    if (workMode === 'creative' && isDiscoverySlot && !hasP0Event) {
      return { taskId: null, reason: CREATIVE_TRUNK_REASON, action: 'discovery', suspended: null };
    }

    // Rule 3: Current task still active → continue (task binding)
    if (state.currentTaskId) {
      const current = activeTasks.find(t => t.id === state.currentTaskId);
      if (current) {
        // Rule 2a: Attention budget exceeded → force re-evaluate
        if (state.ticksOnCurrent >= ATTENTION_BUDGET) {
          slog('SCHED', `attention budget exceeded for ${current.id} (${state.ticksOnCurrent} ticks)`);
          const next = this.stackRank(activeTasks, state);
          if (next && next.id !== current.id) {
            return {
              taskId: next.id,
              reason: `attention budget: switching from ${current.summary.slice(0, 40)} to ${next.summary.slice(0, 40)}`,
              action: 'switch',
              suspended: {
                taskId: current.id,
                reason: 'attention_budget',
                priorityAtSuspend: current.priority,
              },
            };
          }
        }
        return { taskId: current.id, reason: 'task binding: continue current', action: 'continue', suspended: null };
      }
    }

    // Rule 4: Stack rank and pick highest
    const next = this.stackRank(activeTasks, state);
    if (next) {
      return {
        taskId: next.id,
        reason: `stack rank: P${next.priority} ${next.summary.slice(0, 60)}`,
        action: 'switch',
        suspended: null,
      };
    }

    return { taskId: null, reason: 'no schedulable tasks', action: 'idle', suspended: null };
  }

  private stackRank(tasks: TaskSnapshot[], _state: SchedulerState): TaskSnapshot | null {
    if (tasks.length === 0) return null;
    const scored = tasks.map(t => ({ task: t, score: computeScore(t, tasks) }));
    scored.sort((a, b) => b.score - a.score);
    return scored[0].task;
  }
}

export function computeScore(t: TaskSnapshot, allTasks?: TaskSnapshot[]): number {
  const effectivePriority = t.source === 'system' ? Math.max(t.priority, 2) : t.priority;
  let score = (3 - effectivePriority) * 1000;
  if (t.summary.includes('correction gate')) score += 8000;
  if (t.source === 'alex') score += 5000;
  if (t.source === 'discovery') score += 1000;

  // Aging boost
  const ageMs = Date.now() - new Date(t.createdAt).getTime();
  const ageTicks = Math.floor(ageMs / 60_000);
  if (ageTicks > AGING_BOOST_TICKS) {
    score += Math.min((ageTicks - AGING_BOOST_TICKS) * 10, 500);
  }

  // Deadline urgency: closer deadline → higher score
  if (t.deadline) {
    const deadlineMs = new Date(t.deadline).getTime() - Date.now();
    const daysRemaining = deadlineMs / 86_400_000;
    if (daysRemaining <= 0) {
      score += 3000; // overdue
    } else if (daysRemaining <= 3) {
      score += 2000; // critical
    } else if (daysRemaining <= 7) {
      score += Math.round(1000 - daysRemaining * 100);
    }
  }

  // Dependency boost: if other tasks depend on this one, boost it
  if (allTasks) {
    const blockerCount = allTasks.filter(other =>
      other.dependsOn?.includes(t.id)
    ).length;
    if (blockerCount > 0) {
      score += blockerCount * 500;
    }
  }

  if (t.status === 'in_progress') score += 100;
  return score;
}

// =============================================================================
// State Management
// =============================================================================

let schedulerState: SchedulerState = {
  currentTaskId: null,
  ticksOnCurrent: 0,
  totalTicks: 0,
  lastDiscoveryTick: 0,
};

let needsPickNext = false;

const scheduler = new DefaultScheduler();

export function getSchedulerState(): SchedulerState {
  return { ...schedulerState };
}

export function advanceTick(): void {
  schedulerState.totalTicks++;
  if (schedulerState.currentTaskId) {
    schedulerState.ticksOnCurrent++;
  }
}

export function resetCurrentTask(): void {
  schedulerState.currentTaskId = null;
  schedulerState.ticksOnCurrent = 0;
}

export function resetSchedulerStateForTest(): void {
  schedulerState = {
    currentTaskId: null,
    ticksOnCurrent: 0,
    totalTicks: 0,
    lastDiscoveryTick: 0,
  };
}

export function setCurrentTask(taskId: string): void {
  if (schedulerState.currentTaskId !== taskId) {
    schedulerState.currentTaskId = taskId;
    schedulerState.ticksOnCurrent = 0;
  }
}

// =============================================================================
// Public API
// =============================================================================

export function checkHoldTasks(memoryDir: string): { unblocked: string[]; checked: number } {
  const holdEntries = queryMemoryIndexSync(memoryDir, {
    type: ['task', 'goal'],
    status: ['hold'],
  });

  const unblocked: string[] = [];
  let checked = 0;

  for (const entry of holdEntries) {
    const payload = (entry.payload ?? {}) as Record<string, unknown>;
    const condition = payload.holdCondition as HoldCondition | undefined;

    if (!condition) continue;
    if (condition.type === 'manual') continue;

    checked++;
    let conditionMet = false;

    switch (condition.type) {
      case 'task-completed': {
        const refs = queryMemoryIndexSync(memoryDir, { id: condition.value, limit: 1 });
        conditionMet = refs.length > 0 && refs[0].status === 'completed';
        break;
      }
      case 'file-exists': {
        conditionMet = existsSync(condition.value);
        break;
      }
      case 'command-succeeds': {
        try {
          execSync(condition.value, { stdio: 'ignore', timeout: 5000 });
          conditionMet = true;
        } catch {
          conditionMet = false;
        }
        break;
      }
      case 'date-after': {
        conditionMet = new Date() >= new Date(condition.value);
        break;
      }
    }

    if (conditionMet) {
      unblocked.push(entry.id);
      updateMemoryIndexEntry(memoryDir, entry.id, { status: 'pending' }).catch(() => {});
    }
  }

  return { unblocked, checked };
}


// =============================================================================
// Phantom-task registry (#196)
// memory/state/phantom-tasks.jsonl is a write-only log of tasks that grep/verify
// confirmed don't exist. Without consuming it, scheduler keeps redispatching them.
// Cache by mtime so we don't re-read every tick.
// =============================================================================

interface PhantomEntry {
  task?: string;
  verified_phantom_at?: string;
}

const phantomCache: { mtimeMs: number; titles: Set<string> } = {
  mtimeMs: 0,
  titles: new Set<string>(),
};

interface PhantomClosureEntry {
  task?: string;
  summary?: string;
  title?: string;
  task_id?: string;
  taskId?: string;
  code?: string;
  failureCode?: string;
  signature?: string;
  artifact?: string;
}

const phantomClosureCache: { mtimeMs: number; keys: Set<string> } = {
  mtimeMs: 0,
  keys: new Set<string>(),
};

function loadPhantomTaskTitles(memoryDir: string): Set<string> {
  const filePath = join(memoryDir, 'state', 'phantom-tasks.jsonl');
  if (!existsSync(filePath)) {
    if (phantomCache.mtimeMs !== 0) {
      phantomCache.mtimeMs = 0;
      phantomCache.titles = new Set();
    }
    return phantomCache.titles;
  }
  let mtimeMs = 0;
  try { mtimeMs = statSync(filePath).mtimeMs; } catch { return phantomCache.titles; }
  if (mtimeMs === phantomCache.mtimeMs) return phantomCache.titles;
  const titles = new Set<string>();
  try {
    const raw = readFileSync(filePath, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed) as PhantomEntry;
        if (typeof obj.task === 'string' && obj.task.length > 0) {
          titles.add(obj.task.trim());
        }
      } catch { /* skip malformed line */ }
    }
  } catch { return phantomCache.titles; }
  phantomCache.mtimeMs = mtimeMs;
  phantomCache.titles = titles;
  return titles;
}

function isPhantomTask(summary: string, phantomTitles: Set<string>): boolean {
  if (phantomTitles.size === 0) return false;
  const norm = summary.trim();
  if (phantomTitles.has(norm)) return true;
  for (const title of phantomTitles) {
    if (title.length >= 12 && norm.includes(title)) return true;
  }
  return false;
}

function loadPhantomClosureKeys(memoryDir: string): Set<string> {
  const filePath = join(memoryDir, 'state', 'phantom-closures.jsonl');
  if (!existsSync(filePath)) {
    if (phantomClosureCache.mtimeMs !== 0) {
      phantomClosureCache.mtimeMs = 0;
      phantomClosureCache.keys = new Set();
    }
    return phantomClosureCache.keys;
  }
  let mtimeMs = 0;
  try { mtimeMs = statSync(filePath).mtimeMs; } catch { return phantomClosureCache.keys; }
  if (mtimeMs === phantomClosureCache.mtimeMs) return phantomClosureCache.keys;
  const keys = new Set<string>();
  try {
    const raw = readFileSync(filePath, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed) as PhantomClosureEntry;
        for (const value of [
          obj.task,
          obj.summary,
          obj.title,
          obj.task_id,
          obj.taskId,
          obj.code,
          obj.failureCode,
          obj.signature,
          obj.artifact,
        ]) {
          if (typeof value === 'string' && value.trim().length >= 8) {
            keys.add(value.trim());
          }
        }
      } catch { /* skip malformed line */ }
    }
  } catch { return phantomClosureCache.keys; }
  phantomClosureCache.mtimeMs = mtimeMs;
  phantomClosureCache.keys = keys;
  return keys;
}

function isClosedByPhantomClosure(task: TaskSnapshot, closureKeys: Set<string>): boolean {
  if (closureKeys.size === 0) return false;
  const summary = task.summary.trim();
  if (closureKeys.has(task.id) || closureKeys.has(summary)) return true;
  for (const key of closureKeys) {
    if (key === task.id) return true;
    if (key.length >= 24 && (summary.includes(key) || key.includes(summary))) return true;
    if (/^fail-[a-z0-9]+$/i.test(key) && summary.includes(key)) return true;
    if (/^(idx|task|del)-[a-z0-9-]+$/i.test(key) && (task.id.includes(key) || summary.includes(key))) return true;
  }
  return false;
}

export function schedulerPick(
  memoryDir: string,
  events: IncomingEvent[] = [],
  options: SchedulerOptions = {},
): SchedulingDecision {
  // Recurring-task lifecycle, reconciled every tick (granularity = OODA cycle):
  //  - re-arm completed recurring tasks → hold with their next fire time
  //  - unblock hold tasks whose condition is met → pending
  // Re-arm writes are fire-and-forget (matches checkHoldTasks' own async writes).
  void rearmRecurringTasks(memoryDir).catch(err =>
    slog('SCHED', `rearmRecurringTasks failed: ${err instanceof Error ? err.message : String(err)}`),
  );
  const holdResult = checkHoldTasks(memoryDir);
  if (holdResult.unblocked.length > 0) {
    slog('SCHED', `unblocked ${holdResult.unblocked.length} hold tasks`);
  }

  const correctionSnapshot = evaluateCorrectionGate(memoryDir);
  const activeCorrectionReasons = new Set(correctionSnapshot.reasons.map(reason => reason.type));
  const autonomySnapshot = evaluateAutonomyClosure(memoryDir);
  const activeAutonomyStages = new Set([
    ...autonomySnapshot.blockingStages,
    ...autonomySnapshot.warningStages,
  ]);
  const entries = queryMemoryIndexSync(memoryDir, {
    type: ['task'],
    status: ['pending', 'in_progress'],
  });
  const entriesById = new Map(entries.map(entry => [entry.id, entry]));

  persistSuppressedTasksToHold(memoryDir, entriesById);

  const phantomTitles = loadPhantomTaskTitles(memoryDir);
  const phantomClosureKeys = loadPhantomClosureKeys(memoryDir);
  const resolvedKeys = loadResolvedTaskKeysFromEvents(memoryDir);

  const tasks: TaskSnapshot[] = entries.map(entryToSnapshot)
    .filter(t => {
      const entry = entriesById.get(t.id);
      if (!entry || !completeExpiredAlexChatDerivedTask(memoryDir, entry)) return true;
      return false;
    })
    .filter(t => {
      const entry = entriesById.get(t.id);
      if (!entry || !isStaleMiddlewareTriageTask(entry)) return true;
      completeStaleMiddlewareTriageTask(memoryDir, entry);
      return false;
    })
    .filter(t => {
      const entry = entriesById.get(t.id);
      if (!entry || !isCorrectionTask(entry)) return true;
      if (correctionTaskMatchesSnapshot(entry, correctionSnapshot, activeCorrectionReasons)) return true;
      slog('SCHED', `dispatch-correction-stale: skipping task=${t.id.slice(0, 12)} ${t.summary.slice(0, 50)}`);
      return false;
    })
    .filter(t => {
      const entry = entriesById.get(t.id);
      if (!entry || !isAutonomyClosureTask(entry)) return true;
      if (autonomyClosureTaskMatchesSnapshot(entry, autonomySnapshot, activeAutonomyStages)) return true;
      completeStaleAutonomyClosureTask(memoryDir, entry, autonomySnapshot);
      return false;
    })
    .filter(t => {
      const proc = getProcess(t.id);
      return !proc || (proc.state !== 'completed' && proc.state !== 'abandoned');
    })
    .filter(t => {
      if (isPhantomTask(t.summary, phantomTitles)) {
        slog('SCHED', `dispatch-phantom: skipping task=${t.id.slice(0, 12)} ${t.summary.slice(0, 50)} (phantom-tasks.jsonl)`);
        return false;
      }
      return true;
    })
    .filter(t => {
      if (isClosedByPhantomClosure(t, phantomClosureKeys)) {
        slog('SCHED', `dispatch-phantom-closure: skipping task=${t.id.slice(0, 12)} ${t.summary.slice(0, 50)} (phantom-closures.jsonl)`);
        return false;
      }
      return true;
    })
    .filter(t => {
      if (suppressedTaskIds.has(t.id)) {
        slog('SCHED', `dispatch-suppression: skipping task=${t.id.slice(0, 12)} ${t.summary.slice(0, 50)}`);
        return false;
      }
      return true;
    })
    .filter(t => {
      if (resolvedKeys.ids.has(t.id)) {
        slog('SCHED', `dispatch-resolved: skipping task=${t.id.slice(0, 12)} ${t.summary.slice(0, 50)} (stack_rank overlay)`);
        return false;
      }
      const summary = (t.summary ?? '').trim();
      if (summary && resolvedKeys.summaries.has(summary)) {
        slog('SCHED', `dispatch-resolved: skipping task=${t.id.slice(0, 12)} ${summary.slice(0, 50)} (stack_rank summary match)`);
        return false;
      }
      // Mirror memory-index.getP0TaskPreviews: stack_rank events sometimes
      // store a longer/shorter title variant. Require >=24 chars to avoid
      // suppressing unrelated generic work.
      if (summary.length >= 24) {
        for (const resolvedSummary of resolvedKeys.summaries) {
          if (resolvedSummary.length < 24) continue;
          if (summary.includes(resolvedSummary) || resolvedSummary.includes(summary)) {
            slog('SCHED', `dispatch-resolved: skipping task=${t.id.slice(0, 12)} ${summary.slice(0, 50)} (stack_rank substring match)`);
            return false;
          }
        }
      }
      return true;
    });

  // Issue #316: drop correction tasks whose hold is still active. Mirrors the
  // filter already applied in memory-index.getP0TaskPreviews so the dispatch
  // path stays consistent with the prompt-header preview path. Without this,
  // Rule 4 stackRank picks held correction tasks (priority 0 + +8000 boost),
  // re-emitting the same P0 every cycle while the hold is active.
  const repoRootForHolds = resolve(memoryDir, '..', '..');
  const beforeHoldFilter = tasks.length;
  const tasksAfterHolds = filterHeldCorrectionTasks(tasks, memoryDir, repoRootForHolds);
  if (tasksAfterHolds.length !== beforeHoldFilter) {
    slog('SCHED', `stack-rank-hold-filter: dropped ${beforeHoldFilter - tasksAfterHolds.length} held correction task(s)`);
  }
  const decision = scheduler.decideNext(tasksAfterHolds, schedulerState, events, options);
  // Issue #316: schedulableTaskIds must reflect the post-hold-filter set, otherwise
  // the force-correction branch below would reintroduce a held correction task.
  const schedulableTaskIds = new Set(tasksAfterHolds.map(task => task.id));
  const correctionTask = entries.find(entry => schedulableTaskIds.has(entry.id) && isCorrectionTask(entry));
  // The creative-trunk fairness floor is exempt: a pending correction task must
  // not override it. The correction task is not lost — currentTaskId persists,
  // so it resumes on the next tick. Without this, a standing correction P0
  // would re-hijack the one cycle in ten the creative trunk is owed.
  const isCreativeTrunkFloor =
    decision.action === 'discovery' && (decision.reason === CREATIVE_TRUNK_REASON || options.workMode === 'creative');
  if (correctionTask && !isCreativeTrunkFloor && (!decision.taskId || decision.action === 'discovery' || decision.action === 'idle')) {
    const forced: SchedulingDecision = {
      taskId: correctionTask.id,
      reason: `correction gate: ${(correctionTask.summary ?? '').slice(0, 80)}`,
      action: 'switch',
      suspended: null,
    };
    setCurrentTask(correctionTask.id);
    recordSchedulerDecision(forced);
    return forced;
  }

  if (decision.taskId) {
    setCurrentTask(decision.taskId);
  } else if (decision.action === 'idle') {
    resetCurrentTask();
  }

  if (decision.action === 'discovery') {
    schedulerState.lastDiscoveryTick = schedulerState.totalTicks;
  }

  recordSchedulerDecision(decision);

  return decision;
}

/**
 * Async variant of schedulerPick that adds a live predicate re-verify step
 * (Layer 1 of issue #306 — stale-signal lag fix).
 *
 * After schedulerPick selects a correction task, this function checks whether
 * the underlying predicate is still stale via reverifyPredicate(). If the
 * predicate is now clean (returns false), the dispatch is skipped and an idle
 * decision is returned instead, preventing phantom P0 cycles.
 *
 * Fail-open: when reverifyPredicate returns null (no live check wired), the
 * snapshot decision is preserved — phantom-skip must never silently drop a
 * real correction.
 */
export async function schedulerPickAsync(
  memoryDir: string,
  repoRoot: string,
  events: IncomingEvent[] = [],
  options: SchedulerOptions = {},
): Promise<SchedulingDecision> {
  const decision = schedulerPick(memoryDir, events, options);

  // Re-verify the dispatch decision against live source-of-truth.
  // Two paths:
  //   (a) correction-gate tasks (origin: correction-gate) — original Layer 1/2 path.
  //   (b) heartbeat-derived github-issue tasks (id prefix idx-github-issue-) —
  //       added for #465 to skip dispatch when the issue is already closed
  //       on GitHub but autopilot reconciliation hasn't run yet.
  if (!decision.taskId) return decision;

  const entries = queryMemoryIndexSync(memoryDir, { type: ['task'], status: ['pending', 'in_progress'] });
  const entry = entries.find(e => e.id === decision.taskId);
  if (!entry) return decision;

  const payload = (entry.payload ?? {}) as Record<string, unknown>;

  // Decide predicate type by task family. Order matters: github-issue tasks
  // are handled before the correction-task gate because they are heartbeat-
  // derived (not correction tasks) and the previous gate skipped them.
  let predicateType: string = '';
  if (typeof entry.id === 'string' && entry.id.startsWith('idx-github-issue-')) {
    predicateType = 'github-issue-open';
  } else if (isCorrectionTask(entry)) {
    predicateType =
      (typeof payload.correction_reason_type === 'string' ? payload.correction_reason_type : null)
      ?? parseCorrectionReasonFromSummaryExported(entry.summary ?? '')
      ?? '';
  } else {
    return decision; // Not a re-verifiable task family — fail-open.
  }

  if (!predicateType) return decision; // Unknown type — fail-open.

  const ctx = { repoRoot, memoryDir, entry };
  let stillStale: boolean | null;
  try {
    stillStale = await reverifyPredicate(predicateType, ctx);
  } catch {
    stillStale = null; // Fail-open on unexpected error.
  }

  if (stillStale === false) {
    // Predicate is now clean — skip dispatch to avoid phantom P0 cycle.
    slog(
      'SCHED',
      `stale-signal-skip: predicate=${predicateType} task=${decision.taskId.slice(0, 12)} resolved since snapshot`,
    );
    eventBus.emit('action:scheduler', {
      event: 'stale-signal-skip',
      predicateType,
      taskId: decision.taskId,
      ts: new Date().toISOString(),
    });
    const idle: SchedulingDecision = { taskId: null, reason: `stale-signal-skip: ${predicateType}`, action: 'idle', suspended: null };
    resetCurrentTask();
    recordSchedulerDecision(idle);
    return idle;
  }

  // stillStale === true or null → proceed with the original decision.
  return decision;
}

function isStaleMiddlewareTriageTask(entry: MemoryIndexEntry): boolean {
  const payload = (entry.payload ?? {}) as Record<string, unknown>;
  const ticks = Number(payload.ticksSinceLastProgress ?? 0);
  return payload.origin === 'middleware-self-healing'
    && payload.middleware_failure_bucket === 'other'
    && String(entry.summary ?? '').startsWith('Triage middleware failed task ')
    && Number.isFinite(ticks)
    && ticks > STALE_MIDDLEWARE_TRIAGE_TICKS;
}

function completeExpiredAlexChatDerivedTask(memoryDir: string, entry: MemoryIndexEntry, nowMs = Date.now()): boolean {
  const payload = (entry.payload ?? {}) as Record<string, unknown>;
  if (entry.source !== 'room') return false;
  if (payload.from !== 'alex') return false;

  const createdAt = typeof payload.created === 'string' ? payload.created : entry.ts;
  const createdMs = new Date(createdAt).getTime();
  if (!Number.isFinite(createdMs)) return false;
  if (nowMs - createdMs < ALEX_CHAT_DERIVED_TASK_TTL_MS) return false;

  updateMemoryIndexEntrySync(memoryDir, entry.id, {
    status: 'completed',
    payload: {
      ...payload,
      completed_by: 'alex-chat-derived-ttl',
      completed_at: new Date(nowMs).toISOString(),
      ttl_ms: ALEX_CHAT_DERIVED_TASK_TTL_MS,
    },
  });
  slog('SCHED', `alex-chat-ttl: completed stale room task=${entry.id.slice(0, 12)} ${String(entry.summary ?? '').slice(0, 50)}`);
  eventBus.emit('action:scheduler', {
    event: 'alex-chat-derived-task-ttl',
    taskId: entry.id,
    ts: new Date(nowMs).toISOString(),
  });
  return true;
}

function completeStaleMiddlewareTriageTask(memoryDir: string, entry: MemoryIndexEntry): void {
  const payload = (entry.payload ?? {}) as Record<string, unknown>;
  updateMemoryIndexEntrySync(memoryDir, entry.id, {
    status: 'completed',
    payload: {
      ...payload,
      terminal_resolution: 'middleware triage follow-up exceeded 100 stale ticks without progress',
      terminal_resolved_at: new Date().toISOString(),
    },
    tags: [...new Set([...(entry.tags ?? []), 'stale-triage-closed'])],
  });
  try { completeProcess(entry.id); } catch { /* process may not be registered */ }
  slog('SCHED', `dispatch-stale-middleware-triage: completed task=${entry.id.slice(0, 12)} ${String(entry.summary ?? '').slice(0, 50)}`);
}

function parseCorrectionReasonFromSummaryExported(summary: string): string | null {
  return parseCorrectionReasonFromSummary(summary);
}

function correctionTaskMatchesSnapshot(
  entry: MemoryIndexEntry,
  snapshot: CorrectionGateSnapshot,
  activeReasonTypes: Set<string>,
): boolean {
  if (!snapshot.needsCorrection) return false;
  const payload = (entry.payload ?? {}) as Record<string, unknown>;
  const payloadReason = typeof payload.correction_reason_type === 'string'
    ? payload.correction_reason_type
    : null;
  const summaryReason = parseCorrectionReasonFromSummary(entry.summary ?? '');
  const reason = payloadReason ?? summaryReason;
  return reason ? activeReasonTypes.has(reason) : true;
}

function autonomyClosureTaskMatchesSnapshot(
  entry: MemoryIndexEntry,
  snapshot: AutonomyClosureSnapshot,
  activeStages: Set<string>,
): boolean {
  if (snapshot.status === 'healthy') return false;
  const stage = parseAutonomyClosureStage(entry.summary ?? '');
  if (!stage) return true;
  return activeStages.has(stage);
}

function parseAutonomyClosureStage(summary: string): string | null {
  const match = summary.match(/autonomy closure:\s*repair\s+([a-z0-9-]+)/i);
  return match?.[1] ?? null;
}

function completeStaleAutonomyClosureTask(
  memoryDir: string,
  entry: MemoryIndexEntry,
  snapshot: AutonomyClosureSnapshot,
): void {
  const stage = parseAutonomyClosureStage(entry.summary ?? '');
  const reason = snapshot.status === 'healthy'
    ? 'closure-healthy'
    : `stage-no-longer-active:${stage ?? 'unknown'}`;
  const payload = (entry.payload ?? {}) as Record<string, unknown>;
  updateMemoryIndexEntrySync(memoryDir, entry.id, {
    status: 'completed',
    payload: {
      ...payload,
      closure_resolved_at: new Date().toISOString(),
      closure_final_score: snapshot.score,
      closure_dispatch_skipped_reason: reason,
    },
  });
  completeProcess(entry.id);
  slog('SCHED', `dispatch-autonomy-closure-stale: completed task=${entry.id.slice(0, 12)} reason=${reason}`);
  eventBus.emit('action:scheduler', {
    event: 'autonomy-closure-stale-skip',
    taskId: entry.id,
    stage,
    reason,
    closureStatus: snapshot.status,
    closureScore: snapshot.score,
    ts: new Date().toISOString(),
  });
}

function parseCorrectionReasonFromSummary(summary: string): string | null {
  const match = summary.match(/correction gate: resolve ([a-z-]+)/i);
  return match?.[1] ?? null;
}

function recordSchedulerDecision(decision: SchedulingDecision): void {
  slog('SCHED', `tick=${schedulerState.totalTicks} action=${decision.action} task=${decision.taskId?.slice(0, 12) ?? 'none'} reason=${decision.reason.slice(0, 80)}`);

  const historyEntry: SchedulerHistoryEntry = {
    ts: new Date().toISOString(),
    tick: schedulerState.totalTicks,
    action: decision.action,
    taskId: decision.taskId,
    reason: decision.reason,
    suspended: decision.suspended,
  };
  schedulerHistory.push(historyEntry);
  if (schedulerHistory.length > MAX_HISTORY) schedulerHistory.splice(0, schedulerHistory.length - MAX_HISTORY);
  eventBus.emit('action:scheduler', { event: 'decision', ...historyEntry });
}

export function schedulerTaskDone(taskId: string): void {
  if (schedulerState.currentTaskId === taskId) {
    resetCurrentTask();
  }
  needsPickNext = true;
  eventBus.emit('action:scheduler', { event: 'task-done', taskId });
}

// =============================================================================
// Dispatch Suppression (GitHub issue #196)
// =============================================================================

/**
 * In-memory registry tracking consecutive terminal-signal cycles per task.
 * Persists for the process lifetime; resets on restart.
 */
const terminalSignalCount = new Map<string, number>();
const suppressedTaskIds = new Set<string>();

/**
 * Record that a dispatched task produced a terminal outcome this cycle
 * (e.g. <kuro:done>, done/blocked/waiting-external signal detected).
 * After DISPATCH_SUPPRESSION_THRESHOLD consecutive calls the task is suppressed.
 */
export function recordTaskTerminalSignal(taskId: string): void {
  const prev = terminalSignalCount.get(taskId) ?? 0;
  const next = prev + 1;
  terminalSignalCount.set(taskId, next);
  if (next >= DISPATCH_SUPPRESSION_THRESHOLD && !suppressedTaskIds.has(taskId)) {
    suppressedTaskIds.add(taskId);
    slog('SCHED', `dispatch-suppressed task=${taskId.slice(0, 12)} after ${next} consecutive terminal signals`);
    eventBus.emit('action:scheduler', { event: 'dispatch-suppressed', taskId, terminalCycles: next });
  }
}

/**
 * Reset suppression state for a task.
 * Call on external triggers: new room message, file-change, PR event, etc.
 */
export function resetTaskSuppression(taskId: string): void {
  if (suppressedTaskIds.has(taskId) || terminalSignalCount.has(taskId)) {
    suppressedTaskIds.delete(taskId);
    terminalSignalCount.delete(taskId);
    slog('SCHED', `suppression-reset task=${taskId.slice(0, 12)}`);
    eventBus.emit('action:scheduler', { event: 'suppression-reset', taskId });
  }
}

/** Reset all dispatch suppression state (e.g. on broad external trigger). */
export function resetAllSuppressions(): void {
  const count = suppressedTaskIds.size;
  suppressedTaskIds.clear();
  terminalSignalCount.clear();
  if (count > 0) {
    slog('SCHED', `suppression-reset-all cleared ${count} suppressed tasks`);
    eventBus.emit('action:scheduler', { event: 'suppression-reset-all', count });
  }
}

/**
 * Cooldown a suppressed task is held for before it is re-evaluated.
 * After this window checkHoldTasks unblocks it; if it is still non-converging
 * it gets re-suppressed and re-held, capping wasted cycles to the threshold
 * (3) per cooldown window instead of an unbounded re-spin loop.
 */
const SUPPRESSION_HOLD_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/**
 * Persist dispatch suppression durably. A task suppressed in-memory (3+ terminal
 * signals) is downgraded to a held memory-index task with a date-after cooldown,
 * so it leaves the pending/in_progress dispatch pool, survives process restart,
 * and is no longer re-picked every cycle. This is the CT downgrade: non-converging
 * work loses its "active judgment" texture instead of being re-spun at full cost.
 *
 * Replaces the former resetSuppressionsForExternalEvents, which globally cleared
 * all suppression on any room/telegram message — defeating suppression entirely.
 */
function persistSuppressedTasksToHold(
  memoryDir: string,
  entriesById: Map<string, MemoryIndexEntry>,
): void {
  if (suppressedTaskIds.size === 0) return;
  const until = new Date(Date.now() + SUPPRESSION_HOLD_COOLDOWN_MS).toISOString();
  for (const taskId of [...suppressedTaskIds]) {
    const entry = entriesById.get(taskId);
    if (!entry) continue; // not in the dispatch pool — already held or resolved
    const payload = { ...((entry.payload as Record<string, unknown> | undefined) ?? {}) };
    payload.holdCondition = { type: 'date-after', value: until };
    payload.suppressionHold = true;
    void updateMemoryIndexEntry(memoryDir, taskId, { status: 'hold', payload })
      .then(() => {
        // The durable hold now owns the suppression; clear the in-memory bridge
        // so the task gets one fair re-evaluation when the cooldown expires.
        suppressedTaskIds.delete(taskId);
        terminalSignalCount.delete(taskId);
      })
      .catch(err =>
        slog('SCHED', `suppression-hold failed task=${taskId.slice(0, 12)}: ${err instanceof Error ? err.message : String(err)}`),
      );
  }
}

export function isTaskSuppressed(taskId: string): boolean {
  return suppressedTaskIds.has(taskId);
}

export function getSuppressedTaskIds(): string[] {
  return [...suppressedTaskIds];
}

export function getTerminalSignalCount(taskId: string): number {
  return terminalSignalCount.get(taskId) ?? 0;
}

export function consumeNeedsPickNext(): boolean {
  if (needsPickNext) {
    needsPickNext = false;
    return true;
  }
  return false;
}

export function getSchedulerStatus(): string {
  const s = schedulerState;
  return `Scheduler: tick=${s.totalTicks} current=${s.currentTaskId?.slice(0, 12) ?? 'none'} ticksOnCurrent=${s.ticksOnCurrent}`;
}

// =============================================================================
// History (audit trail)
// =============================================================================

export interface SchedulerHistoryEntry {
  ts: string;
  tick: number;
  action: SchedulerAction;
  taskId: string | null;
  reason: string;
  suspended: SuspendInfo | null;
}

const MAX_HISTORY = 50;
const schedulerHistory: SchedulerHistoryEntry[] = [];

export function getSchedulerHistory(limit: number = 50): SchedulerHistoryEntry[] {
  return schedulerHistory.slice(-limit);
}

export function getTopPending(memoryDir: string, limit: number = 5): { tasks: Array<TaskSnapshot & { score: number }>; totalCount: number } {
  const entries = queryMemoryIndexSync(memoryDir, {
    type: ['task'],
    status: ['pending', 'in_progress'],
  });
  const tasks = entries.map(entryToSnapshot)
    .filter(t => {
      const proc = getProcess(t.id);
      return !proc || (proc.state !== 'completed' && proc.state !== 'abandoned');
    });
  const scored = tasks.map(t => ({ ...t, score: computeScore(t, tasks) }));
  scored.sort((a, b) => b.score - a.score);
  return { tasks: scored.slice(0, limit), totalCount: scored.length };
}

// =============================================================================
// Helpers
// =============================================================================

export function entryToSnapshot(entry: MemoryIndexEntry): TaskSnapshot {
  const payload = (entry.payload ?? {}) as Record<string, unknown>;
  const priority = typeof payload.priority === 'number'
    ? payload.priority
    : parsePriorityFromSummary(entry.summary ?? '');
  const source = detectSource(entry);
  const created = (payload.created as string) ?? entry.ts;
  const ticksSpent = typeof payload.ticksSpent === 'number' ? payload.ticksSpent : 0;

  const deadline = parseDeadline(entry.summary ?? '', payload);
  const dependsOn = Array.isArray(payload.dependsOn) ? payload.dependsOn as string[] : [];

  return {
    id: entry.id,
    summary: entry.summary || (payload?.title as string) || `task-${entry.id.slice(0, 8)}`,
    status: entry.status,
    priority,
    source,
    createdAt: created,
    ticksSpent,
    deadline,
    dependsOn,
  };
}

function parseDeadline(summary: string, payload: Record<string, unknown>): string | null {
  if (typeof payload.deadline === 'string') return payload.deadline;
  const match = summary.match(/[Dd]eadline[：:\s]*(\d{1,2}\/\d{1,2})/);
  if (match) {
    const [m, d] = match[1].split('/');
    const year = new Date().getFullYear();
    return `${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

function parsePriorityFromSummary(summary: string): number {
  const match = summary.match(/(?:^|\s)P([0-3])(?:\s|$|[：:,，])/i)
    ?? summary.match(/唯一\s*P([0-3])/i)
    ?? summary.match(/priority[=:\s]*([0-3])/i);
  return match ? parseInt(match[1], 10) : 2;
}

function detectSource(entry: MemoryIndexEntry): TaskSnapshot['source'] {
  const payload = (entry.payload ?? {}) as Record<string, unknown>;
  const from = (payload.from ?? payload.source) as string | undefined;
  if (from === 'alex' || payload.origin === 'alex') return 'alex';
  if (from === 'kuro') return 'kuro';
  if (from === 'discovery' || payload.source === 'discovery') return 'discovery';
  if (from) return from as TaskSnapshot['source'];
  const summary = (entry.summary ?? '').toLowerCase();
  if (summary.includes('alex') && (summary.includes('要') || summary.includes('請') || summary.includes('做') || summary.includes('點名'))) return 'alex';
  const origin = (payload.origin as string ?? '').toLowerCase();
  if (origin.includes('room') && summary.includes('alex')) return 'alex';
  return 'system';
}
