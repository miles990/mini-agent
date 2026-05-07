import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { queryMemoryIndexSync } from '../src/memory-index.js';
import { readDelegationFailureRecordsSync } from '../src/delegation-failure-guard.js';
import {
  classifyMiddlewareFailureBucket,
  classifyMiddlewareFailures,
  readMiddlewareFailureClassificationsSync,
} from '../src/middleware-failure-self-healing.js';

let memoryDir: string;

beforeEach(() => {
  memoryDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-middleware-self-heal-'));
});

afterEach(() => {
  rmSync(memoryDir, { recursive: true, force: true });
});

describe('middleware failure self-healing', () => {
  it('classifies provider budget failures and creates an active provider hold', async () => {
    const result = await classifyMiddlewareFailures(memoryDir, [{
      id: 'task-budget',
      worker: 'agent-brain',
      status: 'failed',
      task: 'Review delegated work as claude',
      error: "Claude Code returned an error result: You're out of extra usage · resets 2:40am (Asia/Taipei)",
      completedAt: '2026-05-06T16:31:00.000Z',
    }], new Date('2026-05-06T16:30:00.000Z'));

    expect(result).toEqual(expect.objectContaining({ failed: 1, classified: 1, held: 1 }));

    const classifications = readMiddlewareFailureClassificationsSync(memoryDir);
    expect(classifications).toEqual([
      expect.objectContaining({
        taskId: 'task-budget',
        bucket: 'budget-or-quota',
        status: 'held',
        lifecycleAction: 'provider-hold',
      }),
    ]);

    const holds = queryMemoryIndexSync(memoryDir, { type: ['task'], status: ['hold'] });
    expect(holds).toHaveLength(1);
    expect(holds[0].payload?.provider_resource_hold).toEqual(expect.objectContaining({
      provider: 'claude',
      resumeAt: '2026-05-06T18:40:00.000Z',
    }));

    expect(readDelegationFailureRecordsSync(memoryDir)[0]).toEqual(expect.objectContaining({
      taskId: 'task-budget',
      status: 'resolved',
    }));
  });

  it('is idempotent for already classified middleware task ids', async () => {
    const task = {
      id: 'task-budget',
      worker: 'agent-brain',
      status: 'failed',
      task: 'Review delegated work as claude',
      error: "Claude Code returned an error result: You're out of extra usage · resets 2:40am (Asia/Taipei)",
      completedAt: '2026-05-06T16:31:00.000Z',
    };

    await classifyMiddlewareFailures(memoryDir, [task], new Date('2026-05-06T16:30:00.000Z'));
    const second = await classifyMiddlewareFailures(memoryDir, [task], new Date('2026-05-06T16:31:00.000Z'));

    expect(second).toEqual(expect.objectContaining({ classified: 0, skippedKnown: 1 }));
    expect(queryMemoryIndexSync(memoryDir, { type: ['task'], status: ['hold'] })).toHaveLength(1);
    expect(readDelegationFailureRecordsSync(memoryDir)[0].frequency).toBe(1);
  });

  it('classifies max-turn failures and creates a decomposition follow-up', async () => {
    const result = await classifyMiddlewareFailures(memoryDir, [{
      id: 'task-turns',
      worker: 'coder',
      status: 'failed',
      task: 'Implement a large repair for a previous maximum budget failure',
      error: 'Task failed: reached maximum number of turns',
    }], new Date('2026-05-06T16:30:00.000Z'));

    expect(result).toEqual(expect.objectContaining({ failed: 1, classified: 1, held: 0 }));
    expect(readMiddlewareFailureClassificationsSync(memoryDir)[0]).toEqual(expect.objectContaining({
      bucket: 'max-turns',
      status: 'classified',
      followUpTaskId: expect.any(String),
      lifecycleAction: 'decompose',
    }));
    const followUps = queryMemoryIndexSync(memoryDir, { type: ['task'], status: ['pending'] });
    expect(followUps).toHaveLength(1);
    expect(followUps[0].summary).toContain('Decompose middleware task task-turns');
  });

  it('reclassifies a known task when better error-only signal changes the bucket', async () => {
    await classifyMiddlewareFailures(memoryDir, [{
      id: 'task-reclassify',
      worker: 'coder',
      status: 'failed',
      task: 'Task text mentions maximum budget from a different failure',
      error: 'Task failed: reached maximum number of turns',
    }], new Date('2026-05-06T16:30:00.000Z'));

    const second = await classifyMiddlewareFailures(memoryDir, [{
      id: 'task-reclassify',
      worker: 'coder',
      status: 'failed',
      task: 'Task text mentions maximum budget from a different failure',
      error: 'Task failed: reached maximum budget',
    }], new Date('2026-05-06T16:31:00.000Z'));

    expect(second).toEqual(expect.objectContaining({ classified: 1, skippedKnown: 0, held: 1 }));
    expect(readMiddlewareFailureClassificationsSync(memoryDir)[0]).toEqual(expect.objectContaining({
      taskId: 'task-reclassify',
      bucket: 'budget-or-quota',
      status: 'held',
      lifecycleAction: 'provider-hold',
    }));
  });

  it('routes offline and timeout failures into lane recovery instead of blind retry', async () => {
    await classifyMiddlewareFailures(memoryDir, [{
      id: 'task-timeout',
      worker: 'researcher',
      status: 'failed',
      task: 'Research context',
      error: 'Worker stall: no activity timeout',
    }], new Date('2026-05-06T16:30:00.000Z'));

    const classification = readMiddlewareFailureClassificationsSync(memoryDir)[0];
    expect(classification).toEqual(expect.objectContaining({
      taskId: 'task-timeout',
      bucket: 'stall-or-timeout',
      lifecycleAction: 'recover-lane',
      followUpTaskId: expect.any(String),
    }));
    expect(readDelegationFailureRecordsSync(memoryDir)[0]).toEqual(expect.objectContaining({
      taskId: 'task-timeout',
      status: 'needs_human',
    }));
  });

  it('exposes the same buckets used by middleware quality health', () => {
    expect(classifyMiddlewareFailureBucket('maximum budget exceeded')).toBe('budget-or-quota');
    expect(classifyMiddlewareFailureBucket('maximum number of turns reached')).toBe('max-turns');
    expect(classifyMiddlewareFailureBucket('no activity timeout')).toBe('stall-or-timeout');
  });
});
