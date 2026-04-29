/**
 * Auto-Executor — code-layer automatic task execution
 *
 * Closes the pipeline's last mile: when the agent idles on code tasks,
 * this module bypasses LLM decision and fires a delegate subprocess.
 *
 * Flow: activity-stream detects idle → scheduler has pending code task
 *       → spawnDelegation fires forge worktree subprocess → verify → close
 */

import { minutesSinceLastCodeOutput } from './activity-stream.js';
import { queryMemoryIndexSync } from './memory-index.js';
import { spawnDelegation, type DelegationTask } from './delegation.js';
import { schedulerTaskDone } from './scheduler.js';
import { eventBus } from './event-bus.js';
import { slog } from './utils.js';
import path from 'node:path';

const IDLE_THRESHOLD_MINUTES = 15;
const COOLDOWN_MS = 10 * 60_000;
const MAX_FAILURES_PER_TASK = 3;

let lastDispatchAt = 0;
let activeAutoTaskId: string | null = null;
let activeDelegationId: string | null = null;
const failCounts = new Map<string, number>();

let listenerRegistered = false;

export interface AutoExecuteResult {
  fired: boolean;
  reason: string;
  taskId?: string;
  delegationId?: string;
}

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
      failCounts.delete(taskId);
      slog('AUTO-EXEC', `task ${taskId.slice(0, 16)} completed successfully`);
    } else {
      const count = (failCounts.get(taskId) ?? 0) + 1;
      failCounts.set(taskId, count);
      slog('AUTO-EXEC', `task ${taskId.slice(0, 16)} failed (${count}/${MAX_FAILURES_PER_TASK})`);
    }
  });
}

export function checkAndDispatch(memoryDir: string): AutoExecuteResult {
  ensureListener();

  const idleMinutes = minutesSinceLastCodeOutput();
  if (idleMinutes < IDLE_THRESHOLD_MINUTES) {
    return { fired: false, reason: `not idle enough (${idleMinutes}min < ${IDLE_THRESHOLD_MINUTES}min)` };
  }

  const elapsed = Date.now() - lastDispatchAt;
  if (elapsed < COOLDOWN_MS) {
    return { fired: false, reason: `cooldown (${Math.round((COOLDOWN_MS - elapsed) / 60000)}min remaining)` };
  }

  if (activeAutoTaskId) {
    return { fired: false, reason: `previous auto-dispatch still active: ${activeAutoTaskId}` };
  }

  const entries = queryMemoryIndexSync(memoryDir, { type: ['task'], status: ['pending', 'in_progress'] });
  const actionable = entries.filter(e => {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    const verify = p.verify_command as string | undefined;
    const blocked = p.blockedBy as string[] | undefined;
    if (!verify || verify.length === 0) return false;
    if (blocked && blocked.length > 0) return false;
    if ((failCounts.get(e.id) ?? 0) >= MAX_FAILURES_PER_TASK) return false;
    return true;
  });

  if (actionable.length === 0) {
    return { fired: false, reason: 'no pending task with verify_command (or all exhausted retries)' };
  }

  actionable.sort((a, b) => {
    const pa = ((a.payload ?? {}) as Record<string, unknown>).priority as number ?? 5;
    const pb = ((b.payload ?? {}) as Record<string, unknown>).priority as number ?? 5;
    return pa - pb;
  });

  const top = actionable[0];
  const topPayload = (top.payload ?? {}) as Record<string, unknown>;
  const verifyCommand = topPayload.verify_command as string;
  const acceptance = (topPayload.acceptance_criteria as string) ?? `Task completed: ${top.summary}`;
  const workdir = path.join(process.cwd());

  const prompt = [
    `## Task: ${top.summary}`,
    '',
    `Task ID: ${top.id}`,
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
  const delegationId = `auto-${top.id.slice(0, 16)}-${Date.now()}`;

  const delegation: DelegationTask = {
    id: delegationId,
    type: 'code',
    prompt,
    workdir,
    verify,
    acceptance,
    timeoutMs: 300_000,
  };

  try {
    spawnDelegation(delegation);
    lastDispatchAt = Date.now();
    activeAutoTaskId = top.id;
    activeDelegationId = delegationId;

    slog('AUTO-EXEC', `fired: ${(top.summary ?? '').slice(0, 60)} → delegation ${delegationId}`);

    return {
      fired: true,
      reason: `idle ${idleMinutes}min, dispatched: ${(top.summary ?? '').slice(0, 60)}`,
      taskId: top.id,
      delegationId,
    };
  } catch (err) {
    slog('AUTO-EXEC', `dispatch failed: ${(err as Error).message}`);
    return { fired: false, reason: `dispatch error: ${(err as Error).message}` };
  }
}

export function getAutoExecutorStatus(): { active: boolean; taskId: string | null; lastDispatchAge: number; failCounts: Record<string, number> } {
  return {
    active: activeAutoTaskId !== null,
    taskId: activeAutoTaskId,
    lastDispatchAge: lastDispatchAt > 0 ? Date.now() - lastDispatchAt : -1,
    failCounts: Object.fromEntries(failCounts),
  };
}
