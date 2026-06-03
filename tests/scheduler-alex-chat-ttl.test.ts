/**
 * Scheduler Alex-chat task TTL — GitHub issue #567.
 *
 * Alex room messages are promoted to high-priority scheduler tasks. Once the
 * referenced work has shipped, they can otherwise refeed forever because there
 * is no artifact-specific resolver for arbitrary chat text.
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
  ALEX_CHAT_DERIVED_TASK_TTL_MS,
  resetCurrentTask,
  resetSchedulerStateForTest,
  schedulerPick,
} from '../src/scheduler.js';

let tmpDir: string;
const now = new Date('2026-05-22T18:00:00.000Z');

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scheduler-alex-chat-ttl-'));
  invalidateIndexCache();
  resetCurrentTask();
  resetSchedulerStateForTest();
  vi.setSystemTime(now);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  invalidateIndexCache();
  resetCurrentTask();
  resetSchedulerStateForTest();
  vi.useRealTimers();
});

function isoBefore(ms: number): string {
  return new Date(now.getTime() - ms).toISOString();
}

describe('scheduler Alex-chat-derived task TTL', () => {
  it('completes expired Alex room tasks before stack ranking can refeed them', async () => {
    const task = await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      source: 'room',
      summary: '@kuro PR #556 等 review',
      ts: isoBefore(ALEX_CHAT_DERIVED_TASK_TTL_MS + 1_000),
      payload: {
        priority: 0,
        from: 'alex',
        roomMsgId: 'room-old',
        intent: 'execute',
      },
    });
    invalidateIndexCache();

    const decision = schedulerPick(tmpDir, [{ source: 'heartbeat', priority: 3, isAlexDirectMessage: false }]);
    invalidateIndexCache();

    expect(decision.taskId).toBeNull();
    const after = queryMemoryIndexSync(tmpDir, { id: task.id, limit: 1 })[0];
    expect(after.status).toBe('completed');
    expect((after.payload as Record<string, unknown>).completed_by).toBe('alex-chat-derived-ttl');
  });

  it('keeps fresh Alex room tasks schedulable', async () => {
    const task = await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      source: 'room',
      summary: '@kuro fresh direct request',
      ts: isoBefore(ALEX_CHAT_DERIVED_TASK_TTL_MS - 60_000),
      payload: {
        priority: 0,
        from: 'alex',
        roomMsgId: 'room-fresh',
        intent: 'execute',
      },
    });
    invalidateIndexCache();

    const decision = schedulerPick(tmpDir, []);

    expect(decision.taskId).toBe(task.id);
  });

  it('does not TTL non-Alex room tasks', async () => {
    const task = await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      source: 'room',
      summary: '@kuro reviewer follow-up from another agent',
      ts: isoBefore(ALEX_CHAT_DERIVED_TASK_TTL_MS + 1_000),
      payload: {
        priority: 0,
        from: 'claude',
        roomMsgId: 'room-reviewer',
        intent: 'execute',
      },
    });
    invalidateIndexCache();

    const decision = schedulerPick(tmpDir, []);

    expect(decision.taskId).toBe(task.id);
    const after = queryMemoryIndexSync(tmpDir, { id: task.id, limit: 1 })[0];
    expect(after.status).toBe('pending');
  });
});
