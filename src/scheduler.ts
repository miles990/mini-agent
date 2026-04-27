/**
 * Agent OS Scheduler — deterministic task scheduling
 *
 * Replaces LLM's ad-hoc task selection with code-layer scheduling.
 * OS is inspiration, not blueprint — adapted for agent impedance mismatch.
 */

import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { queryMemoryIndexSync, updateMemoryIndexEntry, type MemoryIndexEntry } from './memory-index.js';
import { slog } from './utils.js';
import { eventBus } from './event-bus.js';
import { getProcess } from './process-table.js';

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

export interface SchedulerPolicy {
  decideNext(
    tasks: TaskSnapshot[],
    state: SchedulerState,
    events: IncomingEvent[],
  ): SchedulingDecision;
}

// =============================================================================
// Config
// =============================================================================

const ATTENTION_BUDGET = 15;
const DISCOVERY_INTERVAL = 10;
const AGING_BOOST_TICKS = 30;

// =============================================================================
// Default Scheduler
// =============================================================================

export class DefaultScheduler implements SchedulerPolicy {
  decideNext(
    tasks: TaskSnapshot[],
    state: SchedulerState,
    events: IncomingEvent[],
  ): SchedulingDecision {
    const activeTasks = tasks.filter(t => t.status === 'pending' || t.status === 'in_progress');

    if (activeTasks.length === 0) {
      return { taskId: null, reason: 'no active tasks', action: 'idle', suspended: null };
    }

    const hasP0Event = events.some(e => e.priority === 0 || e.isAlexDirectMessage);

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

    // Rule 2: Current task still active → continue (task binding)
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

    // Rule 3: Discovery slot
    if (state.totalTicks > 0 && state.totalTicks % DISCOVERY_INTERVAL === 0) {
      return { taskId: null, reason: 'discovery slot: free exploration', action: 'discovery', suspended: null };
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
  let score = (3 - t.priority) * 1000;
  if (t.source === 'alex') score += 5000;

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

export function schedulerPick(
  memoryDir: string,
  events: IncomingEvent[] = [],
): SchedulingDecision {
  // Check hold tasks every 10 ticks
  if (schedulerState.totalTicks > 0 && schedulerState.totalTicks % 10 === 0) {
    const result = checkHoldTasks(memoryDir);
    if (result.unblocked.length > 0) {
      slog('SCHED', `unblocked ${result.unblocked.length} hold tasks`);
    }
  }

  const entries = queryMemoryIndexSync(memoryDir, {
    type: ['task', 'goal'],
    status: ['pending', 'in_progress'],
  });

  const tasks: TaskSnapshot[] = entries.map(entryToSnapshot)
    .filter(t => {
      const proc = getProcess(t.id);
      return !proc || (proc.state !== 'completed' && proc.state !== 'abandoned');
    });
  const decision = scheduler.decideNext(tasks, schedulerState, events);

  if (decision.taskId) {
    setCurrentTask(decision.taskId);
  } else if (decision.action === 'idle') {
    resetCurrentTask();
  }

  if (decision.action === 'discovery') {
    schedulerState.lastDiscoveryTick = schedulerState.totalTicks;
  }

  slog('SCHED', `tick=${schedulerState.totalTicks} action=${decision.action} task=${decision.taskId?.slice(0, 12) ?? 'none'} reason=${decision.reason.slice(0, 80)}`);

  // Emit SSE event + record history
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

  return decision;
}

export function schedulerTaskDone(taskId: string): void {
  if (schedulerState.currentTaskId === taskId) {
    resetCurrentTask();
  }
  eventBus.emit('action:scheduler', { event: 'task-done', taskId });
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
    type: ['task', 'goal'],
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
    summary: entry.summary ?? entry.id,
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
  if (payload.source === 'alex') return 'alex';
  if (payload.origin === 'alex') return 'alex';
  if (payload.source === 'kuro') return 'kuro';
  if (payload.source === 'discovery') return 'discovery';
  const summary = (entry.summary ?? '').toLowerCase();
  if (summary.includes('alex') && (summary.includes('要') || summary.includes('請') || summary.includes('做') || summary.includes('點名'))) return 'alex';
  const origin = (payload.origin as string ?? '').toLowerCase();
  if (origin.includes('room') && summary.includes('alex')) return 'alex';
  return 'system';
}
