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
import { slog } from './utils.js';
import path from 'node:path';

const IDLE_THRESHOLD_MINUTES = 15;
const COOLDOWN_MS = 10 * 60_000; // 10 min between auto-dispatches

let lastDispatchAt = 0;
let activeAutoTaskId: string | null = null;

export interface AutoExecuteResult {
  fired: boolean;
  reason: string;
  taskId?: string;
  delegationId?: string;
}

export function checkAndDispatch(memoryDir: string): AutoExecuteResult {
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
    return verify && verify.length > 0 && (!blocked || blocked.length === 0);
  });

  if (actionable.length === 0) {
    return { fired: false, reason: 'no pending task with verify_command' };
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
    `Complete this task by writing code. The task is verified by running:`,
    '```',
    verifyCommand,
    '```',
    '',
    'Write the minimum code needed to make the verify command pass.',
    'Do not modify src/ files — focus on HTML, scripts, and config.',
    'After writing code, run the verify command to confirm it passes.',
  ].join('\n');

  const verify = verifyCommand.split('&&').map(v => v.trim());

  const delegation: DelegationTask = {
    id: `auto-${top.id.slice(0, 16)}-${Date.now()}`,
    type: 'code',
    prompt,
    workdir,
    verify,
    acceptance,
    timeoutMs: 300_000,
  };

  try {
    const delegationId = spawnDelegation(delegation);
    lastDispatchAt = Date.now();
    activeAutoTaskId = top.id;

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

export function onAutoTaskCompleted(taskId: string, success: boolean): void {
  if (activeAutoTaskId === taskId) {
    if (success) {
      schedulerTaskDone(taskId);
      slog('AUTO-EXEC', `task ${taskId.slice(0, 16)} completed successfully`);
    } else {
      slog('AUTO-EXEC', `task ${taskId.slice(0, 16)} failed — will retry after cooldown`);
    }
    activeAutoTaskId = null;
  }
}

export function getAutoExecutorStatus(): { active: boolean; taskId: string | null; lastDispatchAge: number } {
  return {
    active: activeAutoTaskId !== null,
    taskId: activeAutoTaskId,
    lastDispatchAge: lastDispatchAt > 0 ? Date.now() - lastDispatchAt : -1,
  };
}
