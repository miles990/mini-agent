/**
 * Scheduler dispatch suppression — GitHub issue #196
 *
 * Task 連續 terminal state 應暫停重派:
 * After DISPATCH_SUPPRESSION_THRESHOLD consecutive terminal signals,
 * a task is excluded from the dispatch queue until an external trigger resets it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendMemoryIndexEntry,
  invalidateIndexCache,
  queryMemoryIndexSync,
} from '../src/memory-index.js';
import {
  clearProcessTable,
  getProcess,
  registerProcess,
} from '../src/process-table.js';
import {
  schedulerPick,
  entryToSnapshot,
  recordTaskTerminalSignal,
  resetTaskSuppression,
  resetAllSuppressions,
  resetCurrentTask,
  resetSchedulerStateForTest,
  advanceTick,
  isTaskSuppressed,
  getSuppressedTaskIds,
  getTerminalSignalCount,
  DISPATCH_SUPPRESSION_THRESHOLD,
} from '../src/scheduler.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-suppress-'));
  invalidateIndexCache();
  resetAllSuppressions();
  resetCurrentTask();
  resetSchedulerStateForTest();
  clearProcessTable();
  vi.stubEnv('MINI_AGENT_DISABLE_MIDDLEWARE_QUALITY_CLOSURE', '1');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  invalidateIndexCache();
  resetAllSuppressions();
  resetCurrentTask();
  resetSchedulerStateForTest();
  clearProcessTable();
  vi.unstubAllEnvs();
});

// ─── Constants ────────────────────────────────────────────────────────────────

describe('DISPATCH_SUPPRESSION_THRESHOLD', () => {
  it('is exported and equals 3', () => {
    expect(DISPATCH_SUPPRESSION_THRESHOLD).toBe(3);
  });
});

// ─── recordTaskTerminalSignal ─────────────────────────────────────────────────

describe('recordTaskTerminalSignal', () => {
  it('increments terminal signal count', () => {
    recordTaskTerminalSignal('task-a');
    expect(getTerminalSignalCount('task-a')).toBe(1);
    recordTaskTerminalSignal('task-a');
    expect(getTerminalSignalCount('task-a')).toBe(2);
  });

  it('does not suppress before threshold', () => {
    for (let i = 0; i < DISPATCH_SUPPRESSION_THRESHOLD - 1; i++) {
      recordTaskTerminalSignal('task-b');
    }
    expect(isTaskSuppressed('task-b')).toBe(false);
  });

  it('suppresses at threshold', () => {
    for (let i = 0; i < DISPATCH_SUPPRESSION_THRESHOLD; i++) {
      recordTaskTerminalSignal('task-c');
    }
    expect(isTaskSuppressed('task-c')).toBe(true);
  });

  it('does not double-suppress beyond threshold', () => {
    for (let i = 0; i < DISPATCH_SUPPRESSION_THRESHOLD + 5; i++) {
      recordTaskTerminalSignal('task-d');
    }
    expect(isTaskSuppressed('task-d')).toBe(true);
    expect(getSuppressedTaskIds().filter(id => id === 'task-d')).toHaveLength(1);
  });

  it('tracks counts independently per task', () => {
    recordTaskTerminalSignal('task-x');
    recordTaskTerminalSignal('task-x');
    recordTaskTerminalSignal('task-y');
    expect(getTerminalSignalCount('task-x')).toBe(2);
    expect(getTerminalSignalCount('task-y')).toBe(1);
  });
});

// ─── isTaskSuppressed / getSuppressedTaskIds ──────────────────────────────────

describe('isTaskSuppressed', () => {
  it('returns false for unknown task', () => {
    expect(isTaskSuppressed('unknown-task')).toBe(false);
  });

  it('returns false before threshold', () => {
    recordTaskTerminalSignal('task-e');
    expect(isTaskSuppressed('task-e')).toBe(false);
  });

  it('returns true after threshold', () => {
    for (let i = 0; i < DISPATCH_SUPPRESSION_THRESHOLD; i++) {
      recordTaskTerminalSignal('task-f');
    }
    expect(isTaskSuppressed('task-f')).toBe(true);
  });
});

describe('getSuppressedTaskIds', () => {
  it('returns empty array initially', () => {
    expect(getSuppressedTaskIds()).toEqual([]);
  });

  it('lists all suppressed tasks', () => {
    for (let i = 0; i < DISPATCH_SUPPRESSION_THRESHOLD; i++) {
      recordTaskTerminalSignal('t1');
      recordTaskTerminalSignal('t2');
    }
    const ids = getSuppressedTaskIds();
    expect(ids).toContain('t1');
    expect(ids).toContain('t2');
  });
});

// ─── resetTaskSuppression ─────────────────────────────────────────────────────

describe('resetTaskSuppression', () => {
  it('clears suppression state for a task', () => {
    for (let i = 0; i < DISPATCH_SUPPRESSION_THRESHOLD; i++) {
      recordTaskTerminalSignal('task-g');
    }
    expect(isTaskSuppressed('task-g')).toBe(true);
    resetTaskSuppression('task-g');
    expect(isTaskSuppressed('task-g')).toBe(false);
  });

  it('resets signal count so task can be suppressed again', () => {
    for (let i = 0; i < DISPATCH_SUPPRESSION_THRESHOLD; i++) {
      recordTaskTerminalSignal('task-h');
    }
    resetTaskSuppression('task-h');
    expect(getTerminalSignalCount('task-h')).toBe(0);

    // Can suppress again after reset
    for (let i = 0; i < DISPATCH_SUPPRESSION_THRESHOLD; i++) {
      recordTaskTerminalSignal('task-h');
    }
    expect(isTaskSuppressed('task-h')).toBe(true);
  });

  it('is a no-op for tasks that were never recorded', () => {
    expect(() => resetTaskSuppression('task-never')).not.toThrow();
    expect(isTaskSuppressed('task-never')).toBe(false);
  });
});

// ─── resetAllSuppressions ────────────────────────────────────────────────────

describe('resetAllSuppressions', () => {
  it('clears all suppressed tasks', () => {
    for (let i = 0; i < DISPATCH_SUPPRESSION_THRESHOLD; i++) {
      recordTaskTerminalSignal('t1');
      recordTaskTerminalSignal('t2');
    }
    expect(getSuppressedTaskIds().length).toBeGreaterThan(0);
    resetAllSuppressions();
    expect(getSuppressedTaskIds()).toEqual([]);
  });

  it('clears all signal counts', () => {
    recordTaskTerminalSignal('t3');
    resetAllSuppressions();
    expect(getTerminalSignalCount('t3')).toBe(0);
  });

  it('is safe to call when nothing is suppressed', () => {
    expect(() => resetAllSuppressions()).not.toThrow();
  });
});

// ─── schedulerPick integration — suppressed tasks are excluded ────────────────

describe('schedulerPick — suppressed tasks excluded from dispatch', () => {
  it('idles instead of opening a full discovery cycle when no tasks are schedulable', () => {
    advanceTick();
    const decision = schedulerPick(tmpDir, []);

    expect(decision.action).toBe('idle');
    expect(decision.reason).toContain('next discovery slot');
  });

  it('keeps periodic discovery when no tasks are schedulable', () => {
    for (let i = 0; i < 10; i++) advanceTick();
    const decision = schedulerPick(tmpDir, []);

    expect(decision.action).toBe('discovery');
    expect(decision.reason).toContain('discovery slot');
  });

  it('keeps direct external signals on the full open-cycle path even with no tasks', () => {
    advanceTick();
    const decision = schedulerPick(tmpDir, [{ source: 'room', priority: 0, isAlexDirectMessage: true }]);

    expect(decision.action).toBe('discovery');
    expect(decision.reason).toContain('direct signal');
  });

  it('does not pick a suppressed task', async () => {
    const task = await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'P1 task that keeps saying done',
      payload: { priority: 1 },
    });
    invalidateIndexCache();

    // Suppress the task
    for (let i = 0; i < DISPATCH_SUPPRESSION_THRESHOLD; i++) {
      recordTaskTerminalSignal(task.id);
    }
    expect(isTaskSuppressed(task.id)).toBe(true);

    const decision = schedulerPick(tmpDir, []);
    expect(decision.taskId).not.toBe(task.id);
  });

  it('picks the task again after suppression is reset', async () => {
    const task = await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'P0 high priority task',
      payload: { priority: 0 },
    });
    invalidateIndexCache();

    // Suppress then reset
    for (let i = 0; i < DISPATCH_SUPPRESSION_THRESHOLD; i++) {
      recordTaskTerminalSignal(task.id);
    }
    resetTaskSuppression(task.id);
    invalidateIndexCache();

    const decision = schedulerPick(tmpDir, []);
    expect(decision.taskId).toBe(task.id);
  });

  it('still picks non-suppressed tasks when some tasks are suppressed', async () => {
    const suppressed = await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'P1 stuck task',
      payload: { priority: 1 },
    });
    const active = await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'P1 active task',
      payload: { priority: 1 },
    });
    invalidateIndexCache();

    for (let i = 0; i < DISPATCH_SUPPRESSION_THRESHOLD; i++) {
      recordTaskTerminalSignal(suppressed.id);
    }

    const decision = schedulerPick(tmpDir, []);
    expect(decision.taskId).toBe(active.id);
    expect(decision.taskId).not.toBe(suppressed.id);
  });

  it('keeps suppression across routine scheduler events', async () => {
    const task = await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'P0 task suppressed by repeated terminal signals',
      payload: { priority: 0 },
    });
    invalidateIndexCache();

    for (let i = 0; i < DISPATCH_SUPPRESSION_THRESHOLD; i++) {
      recordTaskTerminalSignal(task.id);
    }

    const decision = schedulerPick(tmpDir, [{ source: 'heartbeat', priority: 3, isAlexDirectMessage: false }]);

    expect(isTaskSuppressed(task.id)).toBe(true);
    expect(decision.taskId).not.toBe(task.id);
  });

  it('does not force a stale correction task when the correction gate is clean', async () => {
    const correction = await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'P0 correction gate: resolve low-responsiveness',
      payload: { origin: 'scheduler', priority: 0, correction_reason_type: 'low-responsiveness' },
    });
    const normal = await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'P1 normal work',
      payload: { priority: 1 },
    });
    invalidateIndexCache();

    const decision = schedulerPick(tmpDir, []);

    expect(decision.taskId).toBe(normal.id);
    expect(decision.taskId).not.toBe(correction.id);
  });

  it('completes a stale autonomy-closure task before dispatch when its stage is no longer active', async () => {
    fs.mkdirSync(path.join(tmpDir, 'state'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'index'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'index', 'relations.jsonl'), '', 'utf-8');

    const closure = await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'P1 autonomy closure: repair memory-state-truth',
      tags: ['autonomy-closure'],
      payload: { origin: 'autonomy-closure', priority: 1 },
    });
    registerProcess(entryToSnapshot(closure));
    invalidateIndexCache();

    const decision = schedulerPick(tmpDir, []);

    expect(decision.taskId).not.toBe(closure.id);
    const latest = queryMemoryIndexSync(tmpDir, { id: closure.id, limit: 1 })[0];
    expect(latest.status).toBe('completed');
    expect(latest.payload?.closure_dispatch_skipped_reason).toMatch(/^(closure-healthy|stage-no-longer-active:memory-state-truth)$/);
    expect(getProcess(closure.id)?.state).toBe('completed');
  });

  it('does not pick a task whose stack-rank resolved summary is a title variant', async () => {
    const resolved = await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'P0 GitHub issue #453: silent_exit_void_midprompt follow-up recovery recipe',
      payload: { priority: 0 },
    });
    const active = await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'P0 active fallback work',
      payload: { priority: 0 },
    });
    fs.mkdirSync(path.join(tmpDir, 'state'), { recursive: true });
    fs.appendFileSync(path.join(tmpDir, 'state', 'task-events.jsonl'), JSON.stringify({
      kind: 'stack_rank',
      task: 'silent_exit_void_midprompt follow-up recovery recipe',
      to: 'resolved-phantom',
    }) + '\n');
    invalidateIndexCache();

    const decision = schedulerPick(tmpDir, []);

    expect(decision.taskId).toBe(active.id);
    expect(decision.taskId).not.toBe(resolved.id);
  });

  it('does not pick a task matched by a phantom closure marker', async () => {
    const phantom = await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'Diagnose fail-8wyvhk: repeated delegation failure from an explicit test envelope',
      payload: { priority: 0 },
    });
    const active = await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'P0 active incident that still exists',
      payload: { priority: 0 },
    });
    fs.mkdirSync(path.join(tmpDir, 'state'), { recursive: true });
    fs.appendFileSync(path.join(tmpDir, 'state', 'phantom-closures.jsonl'), JSON.stringify({
      code: 'fail-8wyvhk',
      task: 'Diagnose fail-8wyvhk',
      resolved_at: new Date().toISOString(),
      evidence: 'delegation failure record is resolved as test_artifact',
    }) + '\n');
    invalidateIndexCache();

    const decision = schedulerPick(tmpDir, []);

    expect(decision.taskId).toBe(active.id);
    expect(decision.taskId).not.toBe(phantom.id);
  });

  it('resets suppression on a human-directed scheduler event', async () => {
    const task = await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'P0 task revived by Alex message',
      payload: { priority: 0 },
    });
    invalidateIndexCache();

    for (let i = 0; i < DISPATCH_SUPPRESSION_THRESHOLD; i++) {
      recordTaskTerminalSignal(task.id);
    }
    expect(isTaskSuppressed(task.id)).toBe(true);

    const decision = schedulerPick(tmpDir, [{ source: 'room', priority: 0, isAlexDirectMessage: true }]);

    expect(isTaskSuppressed(task.id)).toBe(false);
    expect(getTerminalSignalCount(task.id)).toBe(0);
    expect(decision.taskId).toBe(task.id);
  });
});
