import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { queryMemoryIndexSync } from '../src/memory-index.js';
import { maybeQueueSelfResearch } from '../src/self-research-autopilot.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-self-research-autopilot-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('self research autopilot', () => {
  it('queues a proposal-backed P2 task on idle heartbeat when no task is active', async () => {
    const result = await maybeQueueSelfResearch(tmpDir, {
      triggerReason: 'heartbeat',
      now: new Date('2026-05-05T00:00:00.000Z'),
    });

    expect(result.queued).toBe(true);
    expect(result.proposalPath).toBe(path.join(tmpDir, 'proposals/self-research-202605050000-actor_selection.md'));
    expect(result.task).toEqual(expect.objectContaining({
      type: 'task',
      status: 'pending',
      summary: expect.stringContaining('P2 execute self-research actor_selection'),
    }));

    const payload = result.task?.payload ?? {};
    expect(payload).toEqual(expect.objectContaining({
      origin: 'scheduler',
      priority: 2,
      verify_command: expect.stringContaining('test -s'),
    }));
    expect(payload.verify_command).toContain('self-research-202605050000-actor_selection-actor-selection-eval.md');
    expect(queryMemoryIndexSync(tmpDir, { type: ['task'], status: ['pending'] })).toHaveLength(1);
  });

  it('does not queue when real work is already pending', async () => {
    mkdirSync(path.join(tmpDir, 'state'), { recursive: true });
    writeFileSync(
      path.join(tmpDir, 'state/task-events.jsonl'),
      JSON.stringify({
        id: 'idx-existing',
        ts: '2026-05-05T00:00:00.000Z',
        type: 'task',
        status: 'pending',
        summary: 'P1 existing work',
        refs: [],
        payload: { origin: 'alex', priority: 1 },
      }) + '\n',
      'utf-8',
    );

    const result = await maybeQueueSelfResearch(tmpDir, {
      triggerReason: 'heartbeat',
      now: new Date('2026-05-05T00:00:00.000Z'),
    });

    expect(result).toEqual({ queued: false, reason: 'active-tasks-present' });
  });

  it('does not queue more than one proposal per day', async () => {
    const first = await maybeQueueSelfResearch(tmpDir, {
      triggerReason: 'heartbeat',
      now: new Date('2026-05-05T00:00:00.000Z'),
    });
    expect(first.queued).toBe(true);

    const task = first.task!;
    writeFileSync(
      path.join(tmpDir, 'state/task-events.jsonl'),
      JSON.stringify({ ...task, ts: '2026-05-05T00:01:00.000Z', status: 'completed' }) + '\n',
      { flag: 'a', encoding: 'utf-8' },
    );

    const second = await maybeQueueSelfResearch(tmpDir, {
      triggerReason: 'heartbeat',
      now: new Date('2026-05-05T12:00:00.000Z'),
    });

    expect(second).toEqual({ queued: false, reason: 'daily-proposal-already-exists' });
  });

  it('ignores direct-message style triggers', async () => {
    const result = await maybeQueueSelfResearch(tmpDir, {
      triggerReason: 'telegram-user',
      now: new Date('2026-05-05T00:00:00.000Z'),
    });

    expect(result).toEqual({ queued: false, reason: 'not-idle-trigger' });
  });
});
