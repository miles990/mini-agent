/**
 * Recurrence — replaces the standalone cron subsystem.
 *
 * A recurring task is a normal memory-index task carrying payload.recurrence
 * (a cron expression). It is held via a date-after HoldCondition until its
 * next fire time; on completion the scheduler re-arms it.
 *
 * TDD: written before implementation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendMemoryIndexEntry,
  updateMemoryIndexEntry,
  queryMemoryIndexSync,
  invalidateIndexCache,
} from '../src/memory-index.js';
import {
  isValidRecurrence,
  nextFireTime,
  syncRecurringTasks,
  rearmRecurringTasks,
  listRecurringTasks,
  getRecurringTaskCount,
  type RecurringSeed,
} from '../src/recurrence.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'recurrence-'));
  invalidateIndexCache();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  invalidateIndexCache();
});

const flush = () => new Promise(r => setTimeout(r, 50));

// ─── nextFireTime ─────────────────────────────────────────────────────────────

describe('nextFireTime', () => {
  it('returns the next daily occurrence strictly after `from`', () => {
    const from = new Date(2026, 4, 20, 8, 0, 0); // 2026-05-20 08:00 local
    const next = nextFireTime('0 10 * * *', from);
    expect(next.getHours()).toBe(10);
    expect(next.getMinutes()).toBe(0);
    expect(next.getTime()).toBeGreaterThan(from.getTime());
    // same day, since 10:00 is still ahead of 08:00
    expect(next.getDate()).toBe(20);
  });

  it('rolls to the next day when the time today has passed', () => {
    const from = new Date(2026, 4, 20, 12, 0, 0); // 12:00, past 10:00
    const next = nextFireTime('0 10 * * *', from);
    expect(next.getHours()).toBe(10);
    expect(next.getDate()).toBe(21);
  });

  it('handles weekly (day-of-week) expressions', () => {
    const from = new Date(2026, 4, 20, 12, 0, 0); // Wed 2026-05-20
    const next = nextFireTime('0 10 * * 0', from); // Sundays 10:00
    expect(next.getDay()).toBe(0);
    expect(next.getHours()).toBe(10);
    expect(next.getTime()).toBeGreaterThan(from.getTime());
  });

  it('defaults `from` to now and returns a future date', () => {
    const next = nextFireTime('*/30 * * * *');
    expect(next.getTime()).toBeGreaterThan(Date.now());
  });

  it('throws on an invalid expression', () => {
    expect(() => nextFireTime('not a cron')).toThrow();
  });
});

// ─── isValidRecurrence ────────────────────────────────────────────────────────

describe('isValidRecurrence', () => {
  it('accepts valid cron expressions', () => {
    expect(isValidRecurrence('0 10 * * 0')).toBe(true);
    expect(isValidRecurrence('*/30 * * * *')).toBe(true);
    expect(isValidRecurrence('45 23 * * *')).toBe(true);
  });

  it('rejects garbage', () => {
    expect(isValidRecurrence('not a cron')).toBe(false);
    expect(isValidRecurrence('')).toBe(false);
    expect(isValidRecurrence('99 99 99 99 99')).toBe(false);
  });
});

// ─── syncRecurringTasks ───────────────────────────────────────────────────────

describe('syncRecurringTasks', () => {
  const seeds: RecurringSeed[] = [
    { schedule: '45 23 * * *', task: 'Daily review of behavior logs and error patterns' },
    { schedule: '0 10 * * 0', task: 'Weekly AI frontier report compilation for Alex' },
  ];

  it('creates a held recurring task for each new seed', async () => {
    const result = await syncRecurringTasks(tmpDir, seeds);
    expect(result.created).toBe(2);
    await flush();
    invalidateIndexCache();

    const tasks = listRecurringTasks(tmpDir);
    expect(tasks).toHaveLength(2);
    for (const t of tasks) {
      expect(t.status).toBe('hold');
      const p = t.payload as Record<string, unknown>;
      expect(typeof p.recurrence).toBe('string');
      expect(typeof p.recurrenceKey).toBe('string');
      const hold = p.holdCondition as { type: string; value: string };
      expect(hold.type).toBe('date-after');
      expect(new Date(hold.value).getTime()).toBeGreaterThan(Date.now());
    }
  });

  it('is idempotent — re-running with the same seeds creates nothing', async () => {
    await syncRecurringTasks(tmpDir, seeds);
    await flush();
    invalidateIndexCache();

    const result = await syncRecurringTasks(tmpDir, seeds);
    expect(result.created).toBe(0);
    expect(result.unchanged).toBe(2);
    await flush();
    invalidateIndexCache();
    expect(listRecurringTasks(tmpDir)).toHaveLength(2);
  });

  it('updates the recurrence expression when a seed schedule changes', async () => {
    await syncRecurringTasks(tmpDir, seeds);
    await flush();
    invalidateIndexCache();

    const changed: RecurringSeed[] = [
      { schedule: '0 9 * * *', task: seeds[0].task }, // schedule changed
      seeds[1],
    ];
    const result = await syncRecurringTasks(tmpDir, changed);
    expect(result.updated).toBe(1);
    await flush();
    invalidateIndexCache();

    const match = listRecurringTasks(tmpDir).find(
      t => (t.payload as Record<string, unknown>).recurrenceKey === seeds[0].task,
    );
    expect((match!.payload as Record<string, unknown>).recurrence).toBe('0 9 * * *');
  });

  it('abandons a recurring task when its seed is removed', async () => {
    await syncRecurringTasks(tmpDir, seeds);
    await flush();
    invalidateIndexCache();

    const result = await syncRecurringTasks(tmpDir, [seeds[0]]); // drop seeds[1]
    expect(result.removed).toBe(1);
    await flush();
    invalidateIndexCache();

    expect(listRecurringTasks(tmpDir)).toHaveLength(1);
    const abandoned = queryMemoryIndexSync(tmpDir, { type: 'task', status: 'abandoned' });
    expect(abandoned).toHaveLength(1);
  });

  it('skips disabled seeds and abandons a task that becomes disabled', async () => {
    const created = await syncRecurringTasks(tmpDir, [
      { ...seeds[0], enabled: false },
      seeds[1],
    ]);
    expect(created.created).toBe(1);
    await flush();
    invalidateIndexCache();
    expect(listRecurringTasks(tmpDir)).toHaveLength(1);

    // now disable the previously-enabled one
    const result = await syncRecurringTasks(tmpDir, [
      { ...seeds[0], enabled: false },
      { ...seeds[1], enabled: false },
    ]);
    expect(result.removed).toBe(1);
    await flush();
    invalidateIndexCache();
    expect(listRecurringTasks(tmpDir)).toHaveLength(0);
  });
});

// ─── rearmRecurringTasks ──────────────────────────────────────────────────────

describe('rearmRecurringTasks', () => {
  it('re-arms a completed recurring task back to hold with a future fire time', async () => {
    await syncRecurringTasks(tmpDir, [
      { schedule: '0 10 * * *', task: 'Daily review of behavior logs and error patterns' },
    ]);
    await flush();
    invalidateIndexCache();

    const task = listRecurringTasks(tmpDir)[0];
    await updateMemoryIndexEntry(tmpDir, task.id, {
      status: 'completed',
      payload: task.payload,
    });
    await flush();
    invalidateIndexCache();

    const result = await rearmRecurringTasks(tmpDir);
    expect(result.rearmed).toContain(task.id);
    await flush();
    invalidateIndexCache();

    const rearmed = queryMemoryIndexSync(tmpDir, { id: task.id })[0];
    expect(rearmed.status).toBe('hold');
    const p = rearmed.payload as Record<string, unknown>;
    const hold = p.holdCondition as { type: string; value: string };
    expect(hold.type).toBe('date-after');
    expect(new Date(hold.value).getTime()).toBeGreaterThan(Date.now());
    // recurrence metadata preserved
    expect(p.recurrence).toBe('0 10 * * *');
    expect(p.recurrenceKey).toBe('Daily review of behavior logs and error patterns');
  });

  it('leaves a completed non-recurring task untouched', async () => {
    const entry = await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'completed',
      summary: 'one-off task that should not re-arm',
    });
    invalidateIndexCache();

    const result = await rearmRecurringTasks(tmpDir);
    expect(result.rearmed).not.toContain(entry.id);
    await flush();
    invalidateIndexCache();
    expect(queryMemoryIndexSync(tmpDir, { id: entry.id })[0].status).toBe('completed');
  });

  it('returns an empty result when there is nothing to re-arm', async () => {
    const result = await rearmRecurringTasks(tmpDir);
    expect(result.rearmed).toEqual([]);
  });
});

// ─── listRecurringTasks / getRecurringTaskCount ───────────────────────────────

describe('listRecurringTasks / getRecurringTaskCount', () => {
  it('counts only non-abandoned recurring tasks', async () => {
    await syncRecurringTasks(tmpDir, [
      { schedule: '0 10 * * *', task: 'recurring task alpha for counting' },
      { schedule: '0 11 * * *', task: 'recurring task beta for counting' },
    ]);
    await flush();
    invalidateIndexCache();
    expect(getRecurringTaskCount(tmpDir)).toBe(2);

    // a plain non-recurring task is not counted
    await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'plain non-recurring task',
    });
    invalidateIndexCache();
    expect(getRecurringTaskCount(tmpDir)).toBe(2);
  });
});
