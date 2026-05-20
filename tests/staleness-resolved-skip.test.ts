/**
 * Staleness sweep — resolved-but-pending tasks (GitHub issue #525)
 *
 * A task already marked resolved in task-events.jsonl can linger as `pending`
 * in the index snapshot. incrementTaskStaleness must complete such tasks, not
 * tick + re-escalate them to P0 — that was the phantom-P0 recurrence loop.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendMemoryIndexEntry,
  incrementTaskStaleness,
  queryMemoryIndexSync,
  invalidateIndexCache,
} from '../src/memory-index.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'staleness-resolved-'));
  invalidateIndexCache();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  invalidateIndexCache();
});

// Append a stack_rank resolution event for a task id (not an index entry, so
// the index keeps showing the task as `pending` — the #525 desync scenario).
function appendResolvedEvent(taskId: string): void {
  const file = path.join(tmpDir, 'state', 'task-events.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify({
    kind: 'stack_rank',
    task_id: taskId,
    to: 'resolved-phantom',
  }) + '\n');
}

describe('incrementTaskStaleness — resolved-but-pending tasks', () => {
  it('completes a resolved-but-pending task instead of escalating it', async () => {
    const task = await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'P0 phantom task already resolved in task-events',
      payload: { priority: 1 },
    });
    appendResolvedEvent(task.id);
    invalidateIndexCache();

    await incrementTaskStaleness(tmpDir);
    invalidateIndexCache();

    const after = queryMemoryIndexSync(tmpDir, { id: task.id, limit: 1 })[0];
    expect(after.status).toBe('completed');
    // not escalated to P0
    expect((after.payload as Record<string, unknown>).priority).not.toBe(0);
    expect((after.payload as Record<string, unknown>).escalated_at).toBeUndefined();
    expect((after.payload as Record<string, unknown>).terminal_resolution).toMatch(/resolved per task-events/);
  });

  it('leaves an unresolved pending task pending after one tick', async () => {
    const task = await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'P1 genuinely active task with no resolution event',
      payload: { priority: 1 },
    });
    invalidateIndexCache();

    await incrementTaskStaleness(tmpDir);
    invalidateIndexCache();

    const after = queryMemoryIndexSync(tmpDir, { id: task.id, limit: 1 })[0];
    expect(after.status).toBe('pending');
  });

  it('still escalates a genuinely stale unresolved task to P0', async () => {
    const task = await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'P2 unresolved task that goes stale without progress',
      payload: { priority: 2 },
    });
    invalidateIndexCache();

    // >5 ticks crosses the staleness escalation boundary
    for (let i = 0; i < 6; i++) {
      await incrementTaskStaleness(tmpDir);
      invalidateIndexCache();
    }

    const after = queryMemoryIndexSync(tmpDir, { id: task.id, limit: 1 })[0];
    expect(after.status).toBe('pending');
    expect((after.payload as Record<string, unknown>).priority).toBe(0);
    expect((after.payload as Record<string, unknown>).escalated_at).toBeDefined();
  });
});
