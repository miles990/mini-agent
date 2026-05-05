import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readActorOutcomeStatsSync } from '../src/actor-outcome-stats.js';
import { appendBrainRunEvent } from '../src/brain-run-ledger.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-actor-outcomes-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('actor outcome stats', () => {
  it('summarizes actor success rate by intent from brain-run events', () => {
    appendBrainRunEvent(tmpDir, {
      taskId: 'task-1',
      intent: 'code',
      event: 'actor_finished',
      status: 'success',
      actor: 'codex',
      role: 'primary',
      durationMs: 1000,
      createdAt: '2026-05-05T00:02:00.000Z',
    });
    appendBrainRunEvent(tmpDir, {
      taskId: 'task-2',
      intent: 'code',
      event: 'actor_finished',
      status: 'failed',
      actor: 'codex',
      role: 'primary',
      durationMs: 3000,
      createdAt: '2026-05-05T00:01:00.000Z',
    });
    appendBrainRunEvent(tmpDir, {
      taskId: 'task-3',
      intent: 'review',
      event: 'actor_finished',
      status: 'success',
      actor: 'claude',
      role: 'reviewer',
      createdAt: '2026-05-05T00:00:00.000Z',
    });

    const stats = readActorOutcomeStatsSync(tmpDir, { intent: 'code' });

    expect(stats.codex).toEqual(expect.objectContaining({
      actor: 'codex',
      intent: 'code',
      total: 2,
      success: 1,
      failed: 1,
      skipped: 0,
      successRate: 0.5,
      avgDurationMs: 2000,
      confidence: 0.2,
      lastFinishedAt: '2026-05-05T00:02:00.000Z',
    }));
    expect(stats.claude).toBeUndefined();
  });
});
