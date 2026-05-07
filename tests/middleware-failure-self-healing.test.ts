import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendMemoryIndexEntry, queryMemoryIndexSync } from '../src/memory-index.js';
import { readDelegationFailureRecordsSync } from '../src/delegation-failure-guard.js';
import {
  classifyMiddlewareFailureBucket,
  classifyMiddlewareFailures,
  closeTerminalBrainMaxTurnFollowUps,
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

  it('treats agent-brain max-turn failures as terminal telemetry', async () => {
    const result = await classifyMiddlewareFailures(memoryDir, [{
      id: 'task-brain-turns',
      worker: 'agent-brain',
      status: 'failed',
      task: 'Think through the current autonomous cycle',
      error: 'Claude Code returned an error result: Reached maximum number of turns (30)',
    }], new Date('2026-05-07T08:00:00.000Z'));

    expect(result).toEqual(expect.objectContaining({ failed: 1, classified: 1, held: 0 }));
    expect(readMiddlewareFailureClassificationsSync(memoryDir)[0]).toEqual(expect.objectContaining({
      taskId: 'task-brain-turns',
      bucket: 'max-turns',
      status: 'classified',
      lifecycleAction: 'terminal-cancelled',
    }));
    expect(queryMemoryIndexSync(memoryDir, { type: ['task'], status: ['pending'] })).toHaveLength(0);
    expect(readDelegationFailureRecordsSync(memoryDir)[0]).toEqual(expect.objectContaining({
      taskId: 'task-brain-turns',
      status: 'resolved',
    }));
  });

  it('treats delegated brain-provider prompts as terminal even when worker is mislabeled coder', async () => {
    const result = await classifyMiddlewareFailures(memoryDir, [{
      id: 'task-brain-coded',
      worker: 'coder',
      status: 'failed',
      task: 'You are running as a mini-agent delegated brain provider. Return the requested result with concise evidence.',
      error: 'Claude Code returned an error result: Reached maximum number of turns (30)',
    }], new Date('2026-05-07T09:50:00.000Z'));

    expect(result).toEqual(expect.objectContaining({ failed: 1, classified: 1, held: 0 }));
    expect(readMiddlewareFailureClassificationsSync(memoryDir)[0]).toEqual(expect.objectContaining({
      taskId: 'task-brain-coded',
      bucket: 'max-turns',
      lifecycleAction: 'terminal-cancelled',
    }));
    expect(queryMemoryIndexSync(memoryDir, { type: ['task'], status: ['pending'] })).toHaveLength(0);
  });

  it('closes legacy brain-provider max-turn follow-ups created before classifier fix', async () => {
    const legacy = await appendMemoryIndexEntry(memoryDir, {
      type: 'task',
      status: 'pending',
      summary: 'Decompose middleware task task-legacy after max-turns failure',
      source: 'test',
      tags: ['middleware', 'self-healing', 'max-turns'],
      payload: {
        origin: 'middleware-self-healing',
        middleware_failure_task_id: 'task-legacy',
        middleware_worker: 'coder',
        middleware_failure_bucket: 'max-turns',
        failed_task_excerpt: 'You are running as a mini-agent delegated brain provider. Return the requested result with concise evidence.',
      },
    });

    expect(await closeTerminalBrainMaxTurnFollowUps(memoryDir, new Date('2026-05-07T09:51:00.000Z'))).toBe(1);

    const completed = queryMemoryIndexSync(memoryDir, { type: ['task'], status: ['completed'] });
    expect(completed).toEqual([
      expect.objectContaining({
        id: legacy.id,
        payload: expect.objectContaining({
          terminal_resolution: expect.stringContaining('brain-provider max-turns'),
        }),
        tags: expect.arrayContaining(['terminal-cancelled']),
      }),
    ]);
  });

  it('reuses an existing duplicate follow-up instead of aborting the sweep', async () => {
    const existing = await appendMemoryIndexEntry(memoryDir, {
      type: 'task',
      status: 'pending',
      summary: 'Decompose middleware task task-turns after max-turns failure',
      source: 'test',
      payload: {
        middleware_failure_task_id: 'older-task-id',
        middleware_failure_bucket: 'max-turns',
      },
    });

    const result = await classifyMiddlewareFailures(memoryDir, [{
      id: 'task-turns',
      worker: 'coder',
      status: 'failed',
      task: 'Implement a large repair',
      error: 'Task failed: reached maximum number of turns',
    }], new Date('2026-05-06T16:30:00.000Z'));

    expect(result).toEqual(expect.objectContaining({ failed: 1, classified: 1 }));
    expect(readMiddlewareFailureClassificationsSync(memoryDir)[0]).toEqual(expect.objectContaining({
      taskId: 'task-turns',
      followUpTaskId: existing.id,
      lifecycleAction: 'decompose',
    }));
    expect(queryMemoryIndexSync(memoryDir, { type: ['task'], status: ['pending'] })).toHaveLength(1);
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
