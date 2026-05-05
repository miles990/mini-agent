import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getDelegationFailureGuardPath,
  markDelegationFailureDiagnosticCreated,
  readDelegationFailureRecordsSync,
  recordDelegationFailure,
} from '../src/delegation-failure-guard.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-delegation-failures-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('delegation failure guard', () => {
  it('detects repeated equivalent failures across different task ids', () => {
    const first = recordDelegationFailure(tmpDir, {
      taskId: 'del-111-a',
      taskType: 'shell',
      prompt: 'Run ai trend cron verification',
      output: 'Shell error: Command exited 1: head: scripts/arxiv-trend.mjs: No such file or directory',
    }, new Date('2026-05-05T00:00:00.000Z'));
    const second = recordDelegationFailure(tmpDir, {
      taskId: 'del-222-b',
      taskType: 'shell',
      prompt: 'Run ai trend cron verification',
      output: 'Shell error: Command exited 1: head: scripts/arxiv-trend.mjs: No such file or directory',
    }, new Date('2026-05-05T00:01:00.000Z'));

    expect(getDelegationFailureGuardPath(tmpDir)).toBe(path.join(tmpDir, 'index', 'delegation-failures.jsonl'));
    expect(first.repeated).toBe(false);
    expect(second.repeated).toBe(true);
    expect(second.needsDiagnosticTask).toBe(true);
    expect(second.record.frequency).toBe(2);
    expect(readDelegationFailureRecordsSync(tmpDir)).toEqual([
      expect.objectContaining({
        taskId: 'del-222-b',
        frequency: 2,
      }),
    ]);
  });

  it('does not request duplicate diagnostic tasks after one is linked', () => {
    const second = recordDelegationFailure(tmpDir, {
      taskId: 'del-1',
      taskType: 'code',
      prompt: 'Fix failing middleware task',
      output: 'task task-123 failed: ANTHROPIC_API_KEY not set for Managed Agents',
    });
    recordDelegationFailure(tmpDir, {
      taskId: 'del-2',
      taskType: 'code',
      prompt: 'Fix failing middleware task',
      output: 'task task-456 failed: ANTHROPIC_API_KEY not set for Managed Agents',
    });
    markDelegationFailureDiagnosticCreated(tmpDir, second.record.signature, 'idx-diagnose');

    const third = recordDelegationFailure(tmpDir, {
      taskId: 'del-3',
      taskType: 'code',
      prompt: 'Fix failing middleware task',
      output: 'task task-789 failed: ANTHROPIC_API_KEY not set for Managed Agents',
    });

    expect(third.repeated).toBe(true);
    expect(third.needsDiagnosticTask).toBe(false);
    expect(third.record.diagnosticTaskId).toBe('idx-diagnose');
  });
});
