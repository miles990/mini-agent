import { describe, expect, it } from 'vitest';

import {
  buildAutoDelegation,
  buildRetryEnvelopeDelegation,
  canAutoDispatchTask,
  classifyComplexity,
  isIssueAutopilotTask,
} from '../src/auto-executor.js';
import type { MiddlewareFailureRetryEnvelope } from '../src/middleware-failure-self-healing.js';
import type { MemoryIndexEntry } from '../src/memory-index.js';

describe('auto executor task routing', () => {
  it('keeps generic three-step verification out of automatic dispatch', () => {
    const task = taskEntry({
      id: 'idx-generic',
      source: 'scheduler',
      payload: {
        origin: 'scheduler',
        verify_command: 'pnpm typecheck && pnpm test && pnpm build',
      },
    });
    const complexity = classifyComplexity(task.payload!.verify_command as string);

    expect(complexity).toBe('complex');
    expect(canAutoDispatchTask(task, complexity)).toBe(false);
  });

  it('allows GitHub issue tasks through the complex gate because they are first-class work', () => {
    const task = githubIssueTask();
    const complexity = classifyComplexity(task.payload!.verify_command as string);

    expect(isIssueAutopilotTask(task)).toBe(true);
    expect(complexity).toBe('complex');
    expect(canAutoDispatchTask(task, complexity)).toBe(true);
  });

  it('builds delegations that can close the original issue task lifecycle', () => {
    const task = githubIssueTask();
    const delegation = buildAutoDelegation(task, 'complex', 1778058000000);

    expect(delegation).toEqual(expect.objectContaining({
      id: 'auto-idx-github-issue-1778058000000',
      type: 'code',
      originTask: task.id,
      verify: [
        'gh issue view 83 --repo miles990/mini-agent --json state,title,labels',
        'pnpm typecheck',
        'pnpm test',
      ],
      timeoutMs: 1_500_000,
    }));
    expect(delegation.prompt).toContain('GitHub Issue Lifecycle');
    expect(delegation.prompt).toContain('Source issue: miles990/mini-agent#83');
    expect(delegation.prompt).toContain('isolated forge worktree');
  });

  it('builds delegation from retry_envelope when verify_command is absent (budget-hold fallback)', () => {
    const envelope: MiddlewareFailureRetryEnvelope = {
      strategy: 'compressed-provider-resume',
      worker: 'claude',
      prompt: 'Summarize prior state into <=1200 chars, list the next single action.',
      acceptance: 'Provider-bound work is resumed only after quota reset with compressed context.',
      maxTurns: 6,
      timeoutMs: 180_000,
      notes: [
        'budget exhaustion is a resource constraint',
        'resume task must not duplicate the held provider request',
      ],
    };

    const task = taskEntry({
      id: 'idx-budget-hold-fallback',
      summary: 'Create fallback for middleware task task-123 after provider budget hold',
      payload: {
        origin: 'middleware-self-healing',
        middleware_failure_bucket: 'budget-or-quota',
        acceptance_criteria: envelope.acceptance,
        retry_envelope: envelope,
        priority: 1,
      },
    });

    const delegation = buildRetryEnvelopeDelegation(task, envelope, 1778300000000);

    expect(delegation).toEqual(expect.objectContaining({
      id: 'retry-idx-budget-hold-1778300000000',
      type: 'code',
      originTask: task.id,
      maxTurns: 6,
      timeoutMs: 180_000,
      acceptance: envelope.acceptance,
    }));
    expect(delegation.prompt).toContain('Strategy: compressed-provider-resume');
    expect(delegation.prompt).toContain('Summarize prior state');
    expect(delegation.prompt).toContain('budget exhaustion');
  });

  it('uses shell type for shell worker retry envelopes', () => {
    const envelope: MiddlewareFailureRetryEnvelope = {
      strategy: 'bounded-shell-probe',
      worker: 'shell',
      prompt: 'Break the failed work into bounded probes.',
      acceptance: 'No single silent step may run for 1800s again.',
      timeoutMs: 120_000,
      progressTimeoutMs: 60_000,
      commandSlices: [
        'cd /Users/user/Workspace/mini-agent',
        'pnpm tsx scripts/kg-extract-entities.ts --write --limit 100',
      ],
      notes: [],
    };

    const task = taskEntry({
      id: 'idx-shell-retry',
      payload: { retry_envelope: envelope },
    });

    const delegation = buildRetryEnvelopeDelegation(task, envelope);
    expect(delegation.type).toBe('shell');
    expect(delegation.prompt).toBe(
      'cd /Users/user/Workspace/mini-agent && pnpm tsx scripts/kg-extract-entities.ts --write --limit 100',
    );
    expect(delegation.prompt).not.toContain('## Retry Task:');
    expect(delegation.prompt).not.toContain('Strategy: bounded-shell-probe');
    expect(delegation.progressTimeoutMs).toBe(60_000);
  });
});

function githubIssueTask(): MemoryIndexEntry {
  return taskEntry({
    id: 'idx-github-issue-miles990-mini-agent-83',
    source: 'github-issue',
    summary: 'P1 GitHub issue #83: review-backlog clogs prompt',
    payload: {
      origin: 'github-issue',
      repo: 'miles990/mini-agent',
      issue_number: 83,
      priority: 1,
      verify_command: 'gh issue view 83 --repo miles990/mini-agent --json state,title,labels && pnpm typecheck && pnpm test',
      acceptance_criteria: 'Issue #83 is addressed with verification evidence.',
    },
  });
}

function taskEntry(overrides: Partial<MemoryIndexEntry>): MemoryIndexEntry {
  return {
    id: 'idx-task',
    ts: '2026-05-06T00:00:00.000Z',
    type: 'task',
    status: 'pending',
    summary: 'test task',
    refs: [],
    ...overrides,
  };
}
