import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  markDelegationFailureDiagnosticCreated,
  readDelegationFailureRecordsSync,
  recordDelegationFailure,
} from '../src/delegation-failure-guard.js';
import { diagnoseDelegationFailure, diagnosePendingDelegationFailures } from '../src/delegation-failure-diagnostics.js';
import { createTask, queryMemoryIndexSync } from '../src/memory-index.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-delegation-diagnostics-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('delegation failure diagnostics', () => {
  it('classifies missing environment failures as needs_human and holds the diagnostic task', async () => {
    recordDelegationFailure(tmpDir, {
      taskId: 'del-1',
      taskType: 'code',
      prompt: 'Run managed agent',
      output: 'task task-123 failed: ANTHROPIC_API_KEY not set for Managed Agents',
    });
    const second = recordDelegationFailure(tmpDir, {
      taskId: 'del-2',
      taskType: 'code',
      prompt: 'Run managed agent',
      output: 'task task-456 failed: ANTHROPIC_API_KEY not set for Managed Agents',
    });
    const task = await createTask(tmpDir, {
      title: 'Diagnose repeated delegation failure in managed agent',
      origin: 'kuro',
      status: 'pending',
    });
    markDelegationFailureDiagnosticCreated(tmpDir, second.record.signature, task.id);

    const diagnosis = await diagnoseDelegationFailure(tmpDir, second.record.signature);

    expect(diagnosis).toEqual(expect.objectContaining({
      status: 'needs_human',
      category: 'missing_environment',
      taskId: task.id,
    }));
    expect(existsSync(diagnosis!.reportPath)).toBe(true);
    expect(readFileSync(diagnosis!.reportPath, 'utf-8')).toContain('ANTHROPIC_API_KEY not set');
    expect(readDelegationFailureRecordsSync(tmpDir)[0]).toEqual(expect.objectContaining({
      status: 'needs_human',
    }));
    expect(queryMemoryIndexSync(tmpDir, { id: task.id })[0]).toEqual(expect.objectContaining({
      status: 'hold',
    }));
  });

  it('marks known shell prompt injection failures resolved', async () => {
    const first = recordDelegationFailure(tmpDir, {
      taskId: 'del-1',
      taskType: 'shell',
      prompt: 'printf BROKEN >&2; exit 7',
      output: "Shell error: /bin/bash: -c: line 0: syntax error near unexpected token `newline' /bin/bash: -c: line 0: `<arbitration>'",
    });
    const task = await createTask(tmpDir, {
      title: 'Diagnose shell prompt injection failure',
      origin: 'kuro',
      status: 'pending',
    });
    markDelegationFailureDiagnosticCreated(tmpDir, first.record.signature, task.id);

    const diagnosis = await diagnoseDelegationFailure(tmpDir, first.record.signature);

    expect(diagnosis).toEqual(expect.objectContaining({
      status: 'resolved',
      category: 'shell_prompt_injection',
    }));
    expect(queryMemoryIndexSync(tmpDir, { id: task.id })[0]).toEqual(expect.objectContaining({
      status: 'completed',
    }));
  });

  it('classifies provider quota exhaustion as a resolved resource hold class', async () => {
    const first = recordDelegationFailure(tmpDir, {
      taskId: 'del-1',
      taskType: 'code',
      prompt: 'Run provider task',
      output: "Claude Code returned an error result: You're out of extra usage · resets 2:40am (Asia/Taipei)",
    });
    const task = await createTask(tmpDir, {
      title: 'Diagnose provider quota failure',
      origin: 'kuro',
      status: 'pending',
    });
    markDelegationFailureDiagnosticCreated(tmpDir, first.record.signature, task.id);

    const diagnosis = await diagnoseDelegationFailure(tmpDir, first.record.signature);

    expect(diagnosis).toEqual(expect.objectContaining({
      status: 'resolved',
      category: 'provider_quota',
    }));
    expect(queryMemoryIndexSync(tmpDir, { id: task.id })[0]).toEqual(expect.objectContaining({
      status: 'completed',
    }));
  });

  it('classifies repeated open max-turn failures without waiting for a linked diagnostic task', async () => {
    recordDelegationFailure(tmpDir, {
      taskId: 'del-1',
      taskType: 'code',
      prompt: 'Run oversized implementation task',
      output: 'Claude Code returned an error result: Reached maximum number of turns (15)',
    });
    const second = recordDelegationFailure(tmpDir, {
      taskId: 'del-2',
      taskType: 'code',
      prompt: 'Run oversized implementation task',
      output: 'Claude Code returned an error result: Reached maximum number of turns (15)',
    });

    const diagnoses = await diagnosePendingDelegationFailures(tmpDir);

    expect(second.record.frequency).toBe(2);
    expect(diagnoses).toHaveLength(1);
    expect(diagnoses[0]).toEqual(expect.objectContaining({
      status: 'resolved',
      category: 'max_turns',
      taskId: undefined,
    }));
    expect(readDelegationFailureRecordsSync(tmpDir)[0]).toEqual(expect.objectContaining({
      status: 'resolved',
    }));
  });

  it('resolves delegation test-envelope failures that leaked into live state', async () => {
    const first = recordDelegationFailure(tmpDir, {
      taskId: 'del-1',
      taskType: 'code',
      prompt: [
        '## Task:',
        'Update src/agent.ts',
        '',
        '## Context:',
        'This is an explicit test envelope that should pass the phantom-prompt pre-dispatch guard.',
      ].join('\n'),
      output: 'blocked by workspace isolation policy: forge worktree allocation failed for repo',
    });
    const task = await createTask(tmpDir, {
      title: 'Diagnose leaked delegation test artifact',
      origin: 'kuro',
      status: 'pending',
    });
    markDelegationFailureDiagnosticCreated(tmpDir, first.record.signature, task.id);

    const diagnosis = await diagnoseDelegationFailure(tmpDir, first.record.signature);

    expect(diagnosis).toEqual(expect.objectContaining({
      status: 'resolved',
      category: 'test_artifact',
    }));
    expect(queryMemoryIndexSync(tmpDir, { id: task.id })[0]).toEqual(expect.objectContaining({
      status: 'completed',
    }));
  });

  it('resolves stale middleware-offline delegation signatures after preflight exists', async () => {
    const first = recordDelegationFailure(tmpDir, {
      taskId: 'del-1',
      taskType: 'graphify',
      prompt: 'cd /Users/user/Workspace/mini-agent && pnpm tsx scripts/kg-extract-entities.ts --write --limit 100',
      output: '[brain-runtime] status=failed primary=none claims=0 [shell:primary.failed] middleware offline at http://localhost:3200',
    });

    const diagnosis = await diagnoseDelegationFailure(tmpDir, first.record.signature);

    expect(diagnosis).toEqual(expect.objectContaining({
      status: 'resolved',
      category: 'middleware_failed',
    }));
  });

  it('resolves stale graphify wall-clock timeouts so bounded rebuild steps can take over', async () => {
    const first = recordDelegationFailure(tmpDir, {
      taskId: 'del-1',
      taskType: 'graphify',
      prompt: 'cd /Users/user/Workspace/mini-agent && pnpm tsx scripts/kg-extract-entities.ts --write --limit 100',
      output: '[brain-runtime] status=failed primary=none claims=0 [shell:primary.failed] task task-1 did not complete within 600000ms',
    });

    const diagnosis = await diagnoseDelegationFailure(tmpDir, first.record.signature);

    expect(diagnosis).toEqual(expect.objectContaining({
      status: 'resolved',
      category: 'middleware_failed',
    }));
  });

  it('picks up repeated open records when diagnosing pending failures', async () => {
    recordDelegationFailure(tmpDir, {
      taskId: 'del-1',
      taskType: 'code',
      prompt: 'Run provider task',
      output: "Claude Code returned an error result: You're out of extra usage · resets 2:40am (Asia/Taipei)",
    });
    recordDelegationFailure(tmpDir, {
      taskId: 'del-2',
      taskType: 'code',
      prompt: 'Run provider task',
      output: "Claude Code returned an error result: You're out of extra usage · resets 2:40am (Asia/Taipei)",
    });

    const diagnoses = await diagnosePendingDelegationFailures(tmpDir);

    expect(diagnoses).toEqual([
      expect.objectContaining({
        status: 'resolved',
        category: 'provider_quota',
      }),
    ]);
  });

  it('diagnoses pending linked failures in batches', async () => {
    const first = recordDelegationFailure(tmpDir, {
      taskId: 'del-1',
      taskType: 'shell',
      prompt: 'Run broken command',
      output: 'Shell error: Command exited 7',
    });
    const task = await createTask(tmpDir, {
      title: 'Diagnose command failure',
      origin: 'kuro',
      status: 'pending',
    });
    markDelegationFailureDiagnosticCreated(tmpDir, first.record.signature, task.id);

    const diagnoses = await diagnosePendingDelegationFailures(tmpDir);

    expect(diagnoses).toHaveLength(1);
    expect(diagnoses[0]).toEqual(expect.objectContaining({
      category: 'command_failed',
      status: 'needs_human',
    }));
  });
});
