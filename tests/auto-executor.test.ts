import { describe, expect, it } from 'vitest';

import {
  buildAutoDelegation,
  canAutoDispatchTask,
  classifyComplexity,
  isIssueAutopilotTask,
} from '../src/auto-executor.js';
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
