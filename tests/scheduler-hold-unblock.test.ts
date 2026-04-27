/**
 * Scheduler — hold task unblock logic tests
 *
 * Tests for checkHoldTasks() and HoldCondition type.
 * TDD: written before implementation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendMemoryIndexEntry,
  queryMemoryIndexSync,
  invalidateIndexCache,
} from '../src/memory-index.js';
import { checkHoldTasks, type HoldCondition } from '../src/scheduler.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-hold-'));
  invalidateIndexCache();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  invalidateIndexCache();
});

// Helper: create a task in hold status with optional holdCondition
async function createHoldTask(
  holdCondition?: HoldCondition,
  summary = 'hold task',
): Promise<string> {
  const payload: Record<string, unknown> = {};
  if (holdCondition) payload.holdCondition = holdCondition;
  const entry = await appendMemoryIndexEntry(tmpDir, {
    type: 'task',
    status: 'hold',
    summary,
    payload,
  });
  return entry.id;
}

// Helper: create a completed task
async function createCompletedTask(summary = 'done task'): Promise<string> {
  const entry = await appendMemoryIndexEntry(tmpDir, {
    type: 'task',
    status: 'completed',
    summary,
  });
  return entry.id;
}

// ─── HoldCondition type ───────────────────────────────────────────────────────

describe('HoldCondition type', () => {
  it('accepts all valid condition types', () => {
    const types: HoldCondition['type'][] = [
      'task-completed',
      'file-exists',
      'command-succeeds',
      'date-after',
      'manual',
    ];
    types.forEach(type => {
      const cond: HoldCondition = { type, value: 'test' };
      expect(cond.type).toBe(type);
    });
  });
});

// ─── checkHoldTasks — basic contract ─────────────────────────────────────────

describe('checkHoldTasks — return shape', () => {
  it('returns { unblocked: [], checked: 0 } when no hold tasks exist', () => {
    const result = checkHoldTasks(tmpDir);
    expect(result.unblocked).toEqual([]);
    expect(result.checked).toBe(0);
  });

  it('returns checked count matching number of hold tasks with conditions', async () => {
    const existingFile = path.join(tmpDir, 'sentinel.txt');
    fs.writeFileSync(existingFile, '');
    await createHoldTask({ type: 'file-exists', value: existingFile });
    await createHoldTask({ type: 'file-exists', value: existingFile });
    invalidateIndexCache();

    const result = checkHoldTasks(tmpDir);
    expect(result.checked).toBe(2);
  });

  it('skips hold tasks that have no holdCondition', async () => {
    // Task with no condition — should not be counted or unblocked
    await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'hold',
      summary: 'no condition task',
      payload: {},
    });
    invalidateIndexCache();

    const result = checkHoldTasks(tmpDir);
    expect(result.checked).toBe(0);
    expect(result.unblocked).toEqual([]);
  });
});

// ─── condition: file-exists ───────────────────────────────────────────────────

describe('checkHoldTasks — file-exists condition', () => {
  it('unblocks task when file exists', async () => {
    const existingFile = path.join(tmpDir, 'ready.txt');
    fs.writeFileSync(existingFile, '');
    const id = await createHoldTask({ type: 'file-exists', value: existingFile });
    invalidateIndexCache();

    const result = checkHoldTasks(tmpDir);
    expect(result.unblocked).toContain(id);
  });

  it('does not unblock task when file is absent', async () => {
    const missingFile = path.join(tmpDir, 'missing.txt');
    const id = await createHoldTask({ type: 'file-exists', value: missingFile });
    invalidateIndexCache();

    const result = checkHoldTasks(tmpDir);
    expect(result.unblocked).not.toContain(id);
  });

  it('updates status to pending in the index after unblocking', async () => {
    const existingFile = path.join(tmpDir, 'flag.txt');
    fs.writeFileSync(existingFile, '');
    const id = await createHoldTask({ type: 'file-exists', value: existingFile });
    invalidateIndexCache();

    checkHoldTasks(tmpDir);

    // Allow micro-task queue to flush the async updateMemoryIndexEntry
    await new Promise(r => setTimeout(r, 50));
    invalidateIndexCache();

    const entries = queryMemoryIndexSync(tmpDir, { id });
    expect(entries[0]?.status).toBe('pending');
  });
});

// ─── condition: date-after ────────────────────────────────────────────────────

describe('checkHoldTasks — date-after condition', () => {
  it('unblocks task when date is in the past', async () => {
    const pastDate = new Date(Date.now() - 10_000).toISOString();
    const id = await createHoldTask({ type: 'date-after', value: pastDate });
    invalidateIndexCache();

    const result = checkHoldTasks(tmpDir);
    expect(result.unblocked).toContain(id);
  });

  it('does not unblock task when date is in the future', async () => {
    const futureDate = new Date(Date.now() + 86_400_000).toISOString();
    const id = await createHoldTask({ type: 'date-after', value: futureDate });
    invalidateIndexCache();

    const result = checkHoldTasks(tmpDir);
    expect(result.unblocked).not.toContain(id);
  });
});

// ─── condition: manual ────────────────────────────────────────────────────────

describe('checkHoldTasks — manual condition', () => {
  it('never unblocks manual-hold tasks automatically', async () => {
    const id = await createHoldTask({ type: 'manual', value: '' });
    invalidateIndexCache();

    const result = checkHoldTasks(tmpDir);
    expect(result.unblocked).not.toContain(id);
    // manual conditions are skipped, not counted
    expect(result.checked).toBe(0);
  });
});

// ─── condition: task-completed ────────────────────────────────────────────────

describe('checkHoldTasks — task-completed condition', () => {
  it('unblocks task when referenced task is completed', async () => {
    const completedId = await createCompletedTask('prerequisite');
    invalidateIndexCache();
    const holdId = await createHoldTask({ type: 'task-completed', value: completedId });
    invalidateIndexCache();

    const result = checkHoldTasks(tmpDir);
    expect(result.unblocked).toContain(holdId);
  });

  it('does not unblock task when referenced task is pending', async () => {
    const pendingEntry = await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'not yet done',
    });
    invalidateIndexCache();
    const holdId = await createHoldTask({ type: 'task-completed', value: pendingEntry.id });
    invalidateIndexCache();

    const result = checkHoldTasks(tmpDir);
    expect(result.unblocked).not.toContain(holdId);
  });

  it('does not unblock task when referenced task does not exist', async () => {
    const holdId = await createHoldTask({ type: 'task-completed', value: 'idx-nonexistent-id' });
    invalidateIndexCache();

    const result = checkHoldTasks(tmpDir);
    expect(result.unblocked).not.toContain(holdId);
  });
});

// ─── condition: command-succeeds ──────────────────────────────────────────────

describe('checkHoldTasks — command-succeeds condition', () => {
  it('unblocks task when command exits 0', async () => {
    const id = await createHoldTask({ type: 'command-succeeds', value: 'true' });
    invalidateIndexCache();

    const result = checkHoldTasks(tmpDir);
    expect(result.unblocked).toContain(id);
  });

  it('does not unblock task when command exits non-zero', async () => {
    const id = await createHoldTask({ type: 'command-succeeds', value: 'false' });
    invalidateIndexCache();

    const result = checkHoldTasks(tmpDir);
    expect(result.unblocked).not.toContain(id);
  });
});

// ─── schedulerPick integration: hold check runs every 10 ticks ───────────────

describe('schedulerPick — hold check interval', () => {
  it('exports checkHoldTasks as a named function', () => {
    expect(typeof checkHoldTasks).toBe('function');
  });
});
