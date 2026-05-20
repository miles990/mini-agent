import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendMemoryIndexEntry, queryMemoryIndexSync } from '../src/memory-index.js';
import {
  readDelegationFailureRecordsSync,
  recordDelegationFailure,
  transitionDelegationFailureStatus,
} from '../src/delegation-failure-guard.js';

vi.mock('../src/forge.js', () => ({
  forgeStatus: vi.fn(() => ({ total: 3, busy: 0, free: 1, source: 'bundled' })),
}));

import {
  classifyMiddlewareFailureBucket,
  classifyMiddlewareFailures,
  getMiddlewareFailureClassificationPath,
  closeTerminalBrainMaxTurnFollowUps,
  closeStaleMiddlewareTriageFollowUps,
  readMiddlewareFailureClassificationsSync,
  sweepMiddlewareFailures,
} from '../src/middleware-failure-self-healing.js';
import { appendFileSync, mkdirSync } from 'node:fs';

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
        lifecycleAction: 'provider-hold-fallback',
        followUpTaskId: expect.any(String),
      }),
    ]);

    const holds = queryMemoryIndexSync(memoryDir, { type: ['task'], status: ['hold'] });
    expect(holds).toHaveLength(1);
    expect(holds[0].payload?.provider_resource_hold).toEqual(expect.objectContaining({
      provider: 'claude',
      resumeAt: '2026-05-06T18:40:00.000Z',
    }));
    const fallbacks = queryMemoryIndexSync(memoryDir, { type: ['task'], status: ['pending'] });
    expect(fallbacks).toHaveLength(1);
    expect(fallbacks[0].payload?.retry_envelope).toEqual(expect.objectContaining({
      strategy: 'compressed-provider-resume',
      maxTurns: 6,
    }));
    expect(fallbacks[0].payload?.priority).toBe(1);

    expect(readDelegationFailureRecordsSync(memoryDir)[0]).toEqual(expect.objectContaining({
      taskId: 'task-budget',
      status: 'resolved',
    }));
  });

  it('classifies Claude Code "hit your limit" failures as quota holds, not P0 triage', async () => {
    await appendMemoryIndexEntry(memoryDir, {
      type: 'task',
      status: 'pending',
      summary: 'Triage middleware failed task task-hit-limit (other)',
      refs: [],
      tags: ['middleware'],
      payload: { priority: 0 },
    });

    const result = await classifyMiddlewareFailures(memoryDir, [{
      id: 'task-hit-limit',
      worker: 'agent-brain',
      status: 'failed',
      task: 'Think through the current autonomous cycle',
      error: "Claude Code returned an error result: You've hit your limit · resets May 14, 8am (Asia/Taipei)",
      completedAt: '2026-05-11T04:08:38.102Z',
    }], new Date('2026-05-11T04:08:40.000Z'));

    expect(result).toEqual(expect.objectContaining({ failed: 1, classified: 1, held: 1 }));
    expect(readMiddlewareFailureClassificationsSync(memoryDir)[0]).toEqual(expect.objectContaining({
      taskId: 'task-hit-limit',
      bucket: 'budget-or-quota',
      status: 'held',
      lifecycleAction: 'provider-hold-fallback',
    }));

    const followUps = queryMemoryIndexSync(memoryDir, { type: ['task'], status: ['pending'] });
    expect(followUps).toHaveLength(1);
    expect(followUps[0].summary).not.toContain('Triage middleware failed task');
    expect(followUps[0].payload?.priority).toBe(1);

    const held = queryMemoryIndexSync(memoryDir, { type: ['task'], status: ['hold'] });
    expect(held).toEqual(expect.arrayContaining([
      expect.objectContaining({
        summary: 'Triage middleware failed task task-hit-limit (other)',
        tags: expect.arrayContaining(['superseded-triage']),
      }),
    ]));

    await appendMemoryIndexEntry(memoryDir, {
      type: 'task',
      status: 'pending',
      summary: 'Triage middleware failed task task-hit-limit (other)',
      refs: [],
      tags: ['middleware'],
      payload: { priority: 0 },
    });
    const skippedKnown = await classifyMiddlewareFailures(memoryDir, [{
      id: 'task-hit-limit',
      worker: 'agent-brain',
      status: 'failed',
      task: 'Think through the current autonomous cycle',
      error: "Claude Code returned an error result: You've hit your limit · resets May 14, 8am (Asia/Taipei)",
    }], new Date('2026-05-11T04:09:40.000Z'));

    expect(skippedKnown).toEqual(expect.objectContaining({ skippedKnown: 1 }));
    expect(queryMemoryIndexSync(memoryDir, { type: ['task'], status: ['pending'] })
      .some(entry => entry.summary === 'Triage middleware failed task task-hit-limit (other)')).toBe(false);
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
    expect(followUps[0].summary).toContain('bounded slices after max-turns failure');
    expect(followUps[0].payload?.retry_envelope).toEqual(expect.objectContaining({
      strategy: 'decompose-and-retry',
      maxTurns: 8,
      timeoutMs: 240_000,
    }));
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
      summary: 'Retry middleware task task-turns as bounded slices after max-turns failure',
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

  it('reuses an existing duplicate provider hold instead of aborting the sweep', async () => {
    const first = await classifyMiddlewareFailures(memoryDir, [{
      id: 'task-budget-1',
      worker: 'agent-brain',
      status: 'failed',
      task: 'Review delegated work as claude',
      error: "Claude Code returned an error result: You're out of extra usage · resets 2:40am (Asia/Taipei)",
      completedAt: '2026-05-06T16:31:00.000Z',
    }], new Date('2026-05-06T16:30:00.000Z'));
    const holdId = readMiddlewareFailureClassificationsSync(memoryDir)[0].providerHoldTaskId;

    const second = await classifyMiddlewareFailures(memoryDir, [{
      id: 'task-budget-2',
      worker: 'agent-brain',
      status: 'failed',
      task: 'Review delegated work as claude again',
      error: "Claude Code returned an error result: You're out of extra usage · resets 2:40am (Asia/Taipei)",
      completedAt: '2026-05-06T16:32:00.000Z',
    }], new Date('2026-05-06T16:31:00.000Z'));

    expect(first).toEqual(expect.objectContaining({ classified: 1, held: 1 }));
    expect(second).toEqual(expect.objectContaining({ classified: 1, held: 1 }));
    expect(readMiddlewareFailureClassificationsSync(memoryDir)[0]).toEqual(expect.objectContaining({
      taskId: 'task-budget-2',
      providerHoldTaskId: holdId,
      lifecycleAction: 'provider-hold-fallback',
    }));
    expect(queryMemoryIndexSync(memoryDir, { type: ['task'], status: ['hold'] })).toHaveLength(1);
  });

  it('backfills retry playbooks for known failures classified by older code', async () => {
    const ledger = getMiddlewareFailureClassificationPath(memoryDir);
    mkdirSync(path.dirname(ledger), { recursive: true });
    appendFileSync(ledger, JSON.stringify({
      taskId: 'task-legacy-budget',
      worker: 'agent-brain',
      bucket: 'budget-or-quota',
      status: 'held',
      seenAt: '2026-05-06T16:30:00.000Z',
      lifecycleAction: 'provider-hold',
    }) + '\n', 'utf-8');

    const result = await classifyMiddlewareFailures(memoryDir, [{
      id: 'task-legacy-budget',
      worker: 'agent-brain',
      status: 'failed',
      task: 'Review delegated work as claude',
      error: "Claude Code returned an error result: You're out of extra usage · resets 2:40am (Asia/Taipei)",
    }], new Date('2026-05-06T16:31:00.000Z'));

    expect(result).toEqual(expect.objectContaining({ skippedKnown: 1, playbookUpgraded: 1 }));
    expect(readMiddlewareFailureClassificationsSync(memoryDir)[0]).toEqual(expect.objectContaining({
      taskId: 'task-legacy-budget',
      lifecycleAction: 'provider-hold-fallback',
      followUpTaskId: expect.any(String),
    }));
    expect(queryMemoryIndexSync(memoryDir, { type: ['task'], status: ['pending'] })[0].payload?.retry_envelope)
      .toEqual(expect.objectContaining({ strategy: 'compressed-provider-resume' }));
  });

  it('creates unknown middleware triage as P1, not scheduler-blocking P0', async () => {
    const result = await classifyMiddlewareFailures(memoryDir, [{
      id: 'task-unknown',
      worker: 'shell',
      status: 'failed',
      task: 'unexpected tool failure',
      error: 'unrecognized failure shape',
    }], new Date('2026-05-15T08:32:00.000Z'));

    expect(result).toEqual(expect.objectContaining({ failed: 1, classified: 1 }));
    const followUps = queryMemoryIndexSync(memoryDir, { type: ['task'], status: ['pending'] });
    expect(followUps).toEqual([
      expect.objectContaining({
        summary: 'Triage middleware failed task task-unknown (other)',
        payload: expect.objectContaining({
          origin: 'middleware-self-healing',
          middleware_failure_task_id: 'task-unknown',
          middleware_failure_bucket: 'other',
          priority: 1,
        }),
      }),
    ]);
  });

  it('closes stale middleware triage follow-ups after 100 ticks even if the failed task is still visible', async () => {
    await appendMemoryIndexEntry(memoryDir, {
      type: 'task',
      status: 'pending',
      summary: 'Triage middleware failed task task-1778478787508-3 (other)',
      refs: [],
      tags: ['middleware', 'self-healing', 'other'],
      payload: {
        origin: 'middleware-self-healing',
        middleware_failure_task_id: 'task-1778478787508-3',
        middleware_failure_bucket: 'other',
        ticksSinceLastProgress: 101,
        priority: 0,
      },
    });

    const closed = await closeStaleMiddlewareTriageFollowUps(memoryDir, [{
      id: 'task-1778478787508-3',
      worker: 'shell',
      status: 'failed',
      task: 'still failing but triage made no progress',
    }], new Date('2026-05-15T08:32:00.000Z'));

    expect(closed).toBe(1);
    const completed = queryMemoryIndexSync(memoryDir, { type: ['task'], status: ['completed'] });
    expect(completed).toEqual([
      expect.objectContaining({
        summary: 'Triage middleware failed task task-1778478787508-3 (other)',
        payload: expect.objectContaining({
          terminal_resolution: 'middleware triage follow-up exceeded 100 stale ticks without progress',
          terminal_resolved_at: '2026-05-15T08:32:00.000Z',
        }),
        tags: expect.arrayContaining(['stale-triage-closed']),
      }),
    ]);
  });

  it('closes middleware triage follow-ups whose failed task disappeared from the live middleware task list', async () => {
    await appendMemoryIndexEntry(memoryDir, {
      type: 'task',
      status: 'pending',
      summary: 'Triage middleware failed task task-1778459005838-l (other)',
      refs: [],
      tags: ['middleware', 'self-healing', 'other'],
      payload: {
        origin: 'middleware-self-healing',
        middleware_failure_task_id: 'task-1778459005838-l',
        middleware_failure_bucket: 'other',
        ticksSinceLastProgress: 12,
        priority: 0,
      },
    });

    const result = await classifyMiddlewareFailures(memoryDir, [], new Date('2026-05-15T08:32:00.000Z'));

    expect(result).toEqual(expect.objectContaining({ scanned: 0, failed: 0 }));
    const completed = queryMemoryIndexSync(memoryDir, { type: ['task'], status: ['completed'] });
    expect(completed[0]).toEqual(expect.objectContaining({
      summary: 'Triage middleware failed task task-1778459005838-l (other)',
      payload: expect.objectContaining({
        terminal_resolution: 'middleware triage follow-up closed because the failed task is no longer live',
      }),
    }));
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
      lifecycleAction: 'provider-hold-fallback',
    }));
  });

  it('routes offline and timeout failures into bounded recovery instead of blind retry', async () => {
    await classifyMiddlewareFailures(memoryDir, [{
      id: 'task-timeout',
      worker: 'shell',
      status: 'failed',
      task: 'pnpm tsx scripts/kg-extract-chunks.ts --write && pnpm tsx scripts/kg-extract-entities.ts --write',
      error: 'Worker stall: no activity timeout',
    }], new Date('2026-05-06T16:30:00.000Z'));

    const classification = readMiddlewareFailureClassificationsSync(memoryDir)[0];
    expect(classification).toEqual(expect.objectContaining({
      taskId: 'task-timeout',
      bucket: 'stall-or-timeout',
      lifecycleAction: 'recover-lane',
      followUpTaskId: expect.any(String),
    }));
    const followUps = queryMemoryIndexSync(memoryDir, { type: ['task'], status: ['pending'] });
    expect(followUps[0].payload?.retry_envelope).toEqual(expect.objectContaining({
      strategy: 'bounded-shell-probe',
      timeoutMs: 120_000,
      progressTimeoutMs: 60_000,
      commandSlices: [
        'pnpm tsx scripts/kg-extract-chunks.ts --write',
        'pnpm tsx scripts/kg-extract-entities.ts --write',
      ],
    }));
    expect(readDelegationFailureRecordsSync(memoryDir)[0]).toEqual(expect.objectContaining({
      taskId: 'task-timeout',
      status: 'needs_human',
    }));
  });

  it('closes historical offline delegation failures once middleware is reachable again', async () => {
    await classifyMiddlewareFailures(memoryDir, [{
      id: 'task-offline',
      worker: 'shell',
      status: 'failed',
      task: 'Graphify context',
      error: 'middleware offline at http://localhost:3200',
    }], new Date('2026-05-06T16:30:00.000Z'));

    expect(readDelegationFailureRecordsSync(memoryDir)[0]).toEqual(expect.objectContaining({
      taskId: 'task-offline',
      status: 'needs_human',
    }));

    const result = await sweepMiddlewareFailures(memoryDir, {
      tasks: [{
        id: 'task-healthy',
        worker: 'shell',
        status: 'completed',
        task: 'Health probe completed',
      }],
      now: new Date('2026-05-06T16:35:00.000Z'),
    });

    expect(result).toEqual(expect.objectContaining({ recoveredOffline: 1 }));
    expect(readDelegationFailureRecordsSync(memoryDir)[0]).toEqual(expect.objectContaining({
      taskId: 'task-offline',
      status: 'resolved',
      resolution: expect.stringContaining('reachable again'),
    }));
  });

  it('closes historical workspace-isolation failures once forge has a free slot', async () => {
    const decision = recordDelegationFailure(memoryDir, {
      taskId: 'task-forge',
      taskType: 'code',
      prompt: 'Implement code change',
      output: 'blocked by workspace isolation policy: forge worktree allocation failed for /repo',
    }, new Date('2026-05-06T16:30:00.000Z'));
    transitionDelegationFailureStatus(
      memoryDir,
      decision.record.signature,
      'needs_human',
      'historical diagnostic hold',
      new Date('2026-05-06T16:30:00.000Z'),
    );

    expect(readDelegationFailureRecordsSync(memoryDir)[0]).toEqual(expect.objectContaining({
      taskId: 'task-forge',
      status: 'needs_human',
    }));

    const result = await sweepMiddlewareFailures(memoryDir, {
      tasks: [],
      workdir: '/repo',
      now: new Date('2026-05-06T16:35:00.000Z'),
    });

    expect(result).toEqual(expect.objectContaining({ recoveredWorkspaceIsolation: 1 }));
    expect(readDelegationFailureRecordsSync(memoryDir)[0]).toEqual(expect.objectContaining({
      taskId: 'task-forge',
      status: 'resolved',
      resolution: expect.stringContaining('free slot'),
    }));
  });

  it('exposes the same buckets used by middleware quality health', () => {
    expect(classifyMiddlewareFailureBucket('maximum budget exceeded')).toBe('budget-or-quota');
    expect(classifyMiddlewareFailureBucket('maximum number of turns reached')).toBe('max-turns');
    expect(classifyMiddlewareFailureBucket('no activity timeout')).toBe('stall-or-timeout');
  });
});
