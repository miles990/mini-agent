/**
 * Auto-Executor — code-layer automatic task execution + goal pipeline closure
 *
 * Modules:
 *   M5: Zombie protection — dispatched set prevents re-dispatch of done tasks
 *   M2: Immediate dispatch — no idle wait, task ready = dispatch
 *   M4: Goal auto-closure — all children done → verify → close goal
 *   M3: Complexity router — heuristic classify, skip complex tasks
 */

import { queryMemoryIndexSync, updateMemoryIndexEntry, type MemoryIndexEntry } from './memory-index.js';
import { spawnDelegation, type DelegationTask } from './delegation.js';
import { schedulerTaskDone } from './scheduler.js';
import { eventBus } from './event-bus.js';
import { slog } from './utils.js';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { getMemoryRootDir, resolveMemoryPath } from './memory-paths.js';
import { evaluateWorkspaceIsolation } from './workspace-isolation.js';
import { classifyProviderResourceHold } from './provider-resource-guard.js';
import type { MiddlewareFailureRetryEnvelope } from './middleware-failure-self-healing.js';

// =============================================================================
// Config
// =============================================================================

const COOLDOWN_MS = 3 * 60_000;
const MAX_FAILURES_PER_TASK = 3;
const ISSUE_AUTOPILOT_ORIGIN = 'github-issue';
const TIMEOUT_BY_COMPLEXITY: Record<TaskComplexity, number> = {
  simple: 300_000,   // 5 min
  medium: 600_000,   // 10 min
  complex: 1_500_000, // 25 min (not auto-dispatched, but kept for reference)
};

// =============================================================================
// State
// =============================================================================

let lastDispatchAt = 0;
let activeAutoTaskId: string | null = null;
let activeDelegationId: string | null = null;
const failCounts = new Map<string, number>();
const dispatchedSet = new Set<string>(); // M5: zombie protection
const DISPATCHED_SET_MAX = 200;
let listenerRegistered = false;

// =============================================================================
// M3: Complexity Router
// =============================================================================

export type TaskComplexity = 'simple' | 'medium' | 'complex';

export function classifyComplexity(verifyCommand: string): TaskComplexity {
  const parts = verifyCommand.split('&&').map(s => s.trim());

  if (parts.length >= 3) return 'complex';

  const allSimple = parts.every(p =>
    /^test\s+-[fdse]\s/.test(p) ||
    /^grep\s+-q\s/.test(p) ||
    /^\[\s+-[fdse]\s/.test(p)
  );
  if (allSimple) return 'simple';

  const hasMultiDir = new Set(
    verifyCommand.match(/[\w-]+\//g)?.map(m => m.split('/')[0]) ?? []
  ).size > 2;
  if (hasMultiDir) return 'complex';

  return 'medium';
}

export function isIssueAutopilotTask(entry: MemoryIndexEntry): boolean {
  const payload = (entry.payload ?? {}) as Record<string, unknown>;
  return entry.source === ISSUE_AUTOPILOT_ORIGIN || payload.origin === ISSUE_AUTOPILOT_ORIGIN;
}

export function canAutoDispatchTask(entry: MemoryIndexEntry, complexity: TaskComplexity): boolean {
  if (complexity !== 'complex') return true;
  return isIssueAutopilotTask(entry);
}

export function buildAutoDelegation(top: MemoryIndexEntry, complexity: TaskComplexity, now = Date.now()): DelegationTask {
  const topPayload = (top.payload ?? {}) as Record<string, unknown>;
  const verifyCommand = topPayload.verify_command as string;
  const acceptance = (topPayload.acceptance_criteria as string) ?? `Task completed: ${top.summary}`;
  const issueNumber = topPayload.issue_number as number | undefined;
  const repo = topPayload.repo as string | undefined;
  const issueContext = isIssueAutopilotTask(top)
    ? [
        '',
        '## GitHub Issue Lifecycle',
        repo && issueNumber ? `Source issue: ${repo}#${issueNumber}` : 'Source issue: recorded in task payload.',
        '- Work in the isolated forge worktree allocated for this delegation.',
        '- Keep the patch scoped to the issue.',
        '- Run the verification commands and include evidence in the result.',
        '- Do not close the GitHub issue unless the fix is merged or explicitly obsolete.',
      ]
    : [];

  const prompt = [
    `## Task: ${top.summary}`,
    '',
    `Task ID: ${top.id}`,
    ...issueContext,
    '',
    '## Instructions',
    'Complete this task by writing code. The task is verified by running:',
    '```',
    verifyCommand,
    '```',
    '',
    'Write the minimum code needed to make the verify command pass.',
    'After writing code, run the verify command to confirm it passes.',
  ].join('\n');

  const verify = verifyCommand.split('&&').map(v => v.trim());
  const delegationId = `auto-${top.id.slice(0, 16)}-${now}`;

  return {
    id: delegationId,
    type: 'code',
    originTask: top.id,
    prompt,
    workdir: process.cwd(),
    verify,
    acceptance,
    timeoutMs: TIMEOUT_BY_COMPLEXITY[complexity],
  };
}

export function buildRetryEnvelopeDelegation(
  top: MemoryIndexEntry,
  envelope: MiddlewareFailureRetryEnvelope,
  now = Date.now(),
): DelegationTask {
  const topPayload = (top.payload ?? {}) as Record<string, unknown>;
  const acceptance = (topPayload.acceptance_criteria as string) ?? envelope.acceptance;
  const delegationId = `retry-${top.id.slice(0, 16)}-${now}`;

  const prompt = [
    `## Retry Task: ${top.summary}`,
    '',
    `Task ID: ${top.id}`,
    `Strategy: ${envelope.strategy}`,
    '',
    '## Instructions',
    envelope.prompt,
    '',
    '## Acceptance Criteria',
    acceptance,
    ...(envelope.notes.length > 0 ? ['', '## Notes', ...envelope.notes.map(n => `- ${n}`)] : []),
  ].join('\n');

  return {
    id: delegationId,
    type: envelope.worker === 'shell' ? 'shell' : 'code',
    originTask: top.id,
    prompt,
    workdir: process.cwd(),
    maxTurns: envelope.maxTurns,
    timeoutMs: envelope.timeoutMs ?? TIMEOUT_BY_COMPLEXITY.medium,
    progressTimeoutMs: envelope.progressTimeoutMs,
    acceptance,
  };
}

// =============================================================================
// M4: Goal Auto-Closure
// =============================================================================

export function checkGoalClosure(memoryDir: string, completedTaskId: string): string | null {
  const tasks = queryMemoryIndexSync(memoryDir, { type: ['task'], id: completedTaskId, limit: 1 });
  if (tasks.length === 0) return null;

  const payload = (tasks[0].payload ?? {}) as Record<string, unknown>;
  const goalId = payload.goal_id as string | undefined;
  if (!goalId) return null;

  const siblings = queryMemoryIndexSync(memoryDir, { type: ['task'] })
    .filter(e => {
      const p = (e.payload ?? {}) as Record<string, unknown>;
      return p.goal_id === goalId;
    });

  const allDone = siblings.every(s => s.status === 'completed');
  if (!allDone) return null;

  const goals = queryMemoryIndexSync(memoryDir, { id: goalId, limit: 1 });
  if (goals.length === 0) return null;

  const goal = goals[0];
  if (goal.status === 'completed') return null;

  const goalPayload = (goal.payload ?? {}) as Record<string, unknown>;
  const goalVerify = goalPayload.verify_command as string | undefined;

  if (goalVerify) {
    const result = spawnSync('sh', ['-c', goalVerify], { timeout: 10_000, stdio: 'pipe', cwd: process.cwd() });
    if (result.status !== 0) {
      slog('AUTO-EXEC', `goal ${goalId.slice(0, 16)} verify failed — not closing`);
      return null;
    }
  }

  updateMemoryIndexEntry(memoryDir, goalId, { status: 'completed' }).catch(() => {});
  eventBus.emit('action:task', { event: 'goal-closed', goalId, childCount: siblings.length });
  slog('AUTO-EXEC', `goal ${goalId.slice(0, 16)} auto-closed (${siblings.length} children all completed)`);
  return goalId;
}

// =============================================================================
// Event Listener
// =============================================================================

function ensureListener(): void {
  if (listenerRegistered) return;
  listenerRegistered = true;

  eventBus.on('action:delegation-complete', (event) => {
    const evTaskId = event.data.taskId as string | undefined;
    const evStatus = event.data.status as string | undefined;
    if (!activeDelegationId || evTaskId !== activeDelegationId) return;

    const taskId = activeAutoTaskId;
    const success = evStatus === 'completed';

    activeDelegationId = null;
    activeAutoTaskId = null;

    if (!taskId) return;

    if (success) {
      schedulerTaskDone(taskId);
      if (dispatchedSet.size > DISPATCHED_SET_MAX) dispatchedSet.clear();
      dispatchedSet.add(taskId);
      failCounts.delete(taskId);
      slog('AUTO-EXEC', `task ${taskId.slice(0, 16)} completed successfully`);

      const memoryDir = getMemoryRootDir();
      checkGoalClosure(memoryDir, taskId);
    } else {
      const outputPreview = typeof event.data.outputPreview === 'string' ? event.data.outputPreview : '';
      const resourceHold = classifyProviderResourceHold(outputPreview);
      if (resourceHold) {
        const memoryDir = getMemoryRootDir();
        const current = queryMemoryIndexSync(memoryDir, { id: taskId, limit: 1 })[0];
        const payload = (current?.payload ?? {}) as Record<string, unknown>;
        updateMemoryIndexEntry(memoryDir, taskId, {
          status: 'hold',
          payload: {
            ...payload,
            holdCondition: {
              type: 'date-after',
              value: resourceHold.resumeAt,
            },
            provider_resource_hold: resourceHold,
          },
        }).catch(() => {});
        failCounts.delete(taskId);
        dispatchedSet.delete(taskId);
        slog('AUTO-EXEC', `task ${taskId.slice(0, 16)} held for provider quota until ${resourceHold.resumeAt}`);
        return;
      }

      const count = (failCounts.get(taskId) ?? 0) + 1;
      failCounts.set(taskId, count);
      if (count >= MAX_FAILURES_PER_TASK) {
        dispatchedSet.add(taskId);
        const memoryDir = getMemoryRootDir();
        const current = queryMemoryIndexSync(memoryDir, { id: taskId, limit: 1 })[0];
        const payload = (current?.payload ?? {}) as Record<string, unknown>;
        updateMemoryIndexEntry(memoryDir, taskId, {
          status: 'hold',
          payload: {
            ...payload,
            holdCondition: {
              type: 'manual',
              value: `auto-executor exhausted retries (${count}/${MAX_FAILURES_PER_TASK})`,
            },
            auto_executor_failures: count,
          },
        }).catch(() => {});
        slog('AUTO-EXEC', `task ${taskId.slice(0, 16)} exhausted retries (${count}/${MAX_FAILURES_PER_TASK}) — marking blocked`);
      } else {
        slog('AUTO-EXEC', `task ${taskId.slice(0, 16)} failed (${count}/${MAX_FAILURES_PER_TASK})`);
      }
    }
  });
}

// =============================================================================
// M2 + M5: Immediate Dispatch with zombie protection
// =============================================================================

export interface AutoExecuteResult {
  fired: boolean;
  reason: string;
  taskId?: string;
  delegationId?: string;
  complexity?: TaskComplexity;
}

export function checkAndDispatch(memoryDir: string): AutoExecuteResult {
  ensureListener();

  const isolation = evaluateWorkspaceIsolation(process.cwd());
  if (!isolation.ok) {
    return { fired: false, reason: `workspace isolation guard: ${isolation.reason}` };
  }

  if (activeAutoTaskId) {
    return { fired: false, reason: `previous auto-dispatch still active: ${activeAutoTaskId}` };
  }

  const elapsed = Date.now() - lastDispatchAt;
  if (elapsed < COOLDOWN_MS) {
    return { fired: false, reason: `cooldown (${Math.round((COOLDOWN_MS - elapsed) / 60000)}min remaining)` };
  }

  const entries = queryMemoryIndexSync(memoryDir, { type: ['task'], status: ['pending', 'in_progress'] });
  const actionable = entries.filter(e => {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    const verify = p.verify_command as string | undefined;
    const retryEnvelope = p.retry_envelope as MiddlewareFailureRetryEnvelope | undefined;
    const blocked = p.blockedBy as string[] | undefined;
    if ((!verify || verify.length === 0) && !retryEnvelope) return false;
    if (blocked && blocked.length > 0) return false;
    if (dispatchedSet.has(e.id)) return false; // M5: zombie protection
    if ((failCounts.get(e.id) ?? 0) >= MAX_FAILURES_PER_TASK) return false;
    return true;
  });

  if (actionable.length === 0) {
    return { fired: false, reason: 'no actionable task (all blocked/exhausted/dispatched)' };
  }

  actionable.sort((a, b) => {
    const pa = ((a.payload ?? {}) as Record<string, unknown>).priority as number ?? 5;
    const pb = ((b.payload ?? {}) as Record<string, unknown>).priority as number ?? 5;
    return pa - pb;
  });

  const top = actionable[0];
  const topPayload = (top.payload ?? {}) as Record<string, unknown>;
  const verifyCommand = topPayload.verify_command as string | undefined;
  const retryEnvelope = topPayload.retry_envelope as MiddlewareFailureRetryEnvelope | undefined;

  let delegation: DelegationTask;
  let complexity: TaskComplexity = 'medium';

  if (retryEnvelope && !verifyCommand) {
    delegation = buildRetryEnvelopeDelegation(top, retryEnvelope);
  } else {
    complexity = classifyComplexity(verifyCommand ?? '');
    if (!canAutoDispatchTask(top, complexity)) {
      return { fired: false, reason: `task too complex for auto-dispatch: ${(top.summary ?? '').slice(0, 60)}`, complexity };
    }
    delegation = buildAutoDelegation(top, complexity);
  }
  const delegationId = delegation.id!;

  try {
    spawnDelegation(delegation);
    lastDispatchAt = Date.now();
    activeAutoTaskId = top.id;
    activeDelegationId = delegationId;

    slog('AUTO-EXEC', `fired [${complexity}]: ${(top.summary ?? '').slice(0, 60)} → ${delegationId}`);

    return {
      fired: true,
      reason: `dispatched [${complexity}]: ${(top.summary ?? '').slice(0, 60)}`,
      taskId: top.id,
      delegationId,
      complexity,
    };
  } catch (err) {
    slog('AUTO-EXEC', `dispatch failed: ${(err as Error).message}`);
    return { fired: false, reason: `dispatch error: ${(err as Error).message}` };
  }
}

// =============================================================================
// Status
// =============================================================================

export function getAutoExecutorStatus(): {
  active: boolean;
  taskId: string | null;
  lastDispatchAge: number;
  failCounts: Record<string, number>;
  dispatchedCount: number;
} {
  return {
    active: activeAutoTaskId !== null,
    taskId: activeAutoTaskId,
    lastDispatchAge: lastDispatchAt > 0 ? Date.now() - lastDispatchAt : -1,
    failCounts: Object.fromEntries(failCounts),
    dispatchedCount: dispatchedSet.size,
  };
}
