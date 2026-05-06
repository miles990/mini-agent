import { describe, expect, it } from 'vitest';
import { analyzeWorkspaceState, formatWorkspaceConstraint, type WorkspaceGitState } from '../src/workspace-finalizer.js';

function state(patch: Partial<WorkspaceGitState>): WorkspaceGitState {
  return {
    branch: 'main',
    baseBranch: 'main',
    dirty: false,
    commitsAhead: [],
    pullRequest: null,
    ...patch,
  };
}

describe('workspace finalizer', () => {
  it('allows new scope on clean main', () => {
    const snapshot = analyzeWorkspaceState(state({}), new Date('2026-05-06T00:00:00.000Z'));

    expect(snapshot.status).toBe('main');
    expect(snapshot.canAcceptNewScope).toBe(true);
    expect(snapshot.shouldReturnToBase).toBe(false);
  });

  it('blocks new autonomous scope on an open PR branch', () => {
    const snapshot = analyzeWorkspaceState(state({
      branch: 'fix/example',
      pullRequest: { number: 90, title: 'fix example' },
      commitsAhead: [{ sha: 'abc', subject: 'fix: example' }],
    }));

    expect(snapshot.status).toBe('pending-review');
    expect(snapshot.canAcceptNewScope).toBe(false);
    expect(snapshot.shouldReturnToBase).toBe(true);
    expect(formatWorkspaceConstraint(snapshot)).toContain('Do not stack a new issue/task on this branch');
  });

  it('detects commits for another issue riding on the current PR branch', () => {
    const snapshot = analyzeWorkspaceState(state({
      branch: 'fix/error-patterns-lastmessage',
      pullRequest: { number: 90, title: 'fix feedback loops' },
      commitsAhead: [
        { sha: 'one', subject: 'fix(feedback-loops): capture sampleMsg per error bucket' },
        { sha: 'two', subject: 'fix(housekeeping): emit shell pipeline for graphify dispatch (#91)' },
      ],
    }));

    expect(snapshot.status).toBe('scope-contaminated');
    expect(snapshot.issueRefs).toEqual([91]);
    expect(snapshot.foreignIssueRefs).toEqual([91]);
    expect(snapshot.guidance.join('\n')).toContain('#91');
  });

  it('reports dirty worktree as return blocker', () => {
    const snapshot = analyzeWorkspaceState(state({
      branch: 'fix/example',
      dirty: true,
      pullRequest: { number: 90, title: 'fix example' },
    }));

    expect(snapshot.returnBlockedReason).toBe('dirty-worktree');
  });
});
