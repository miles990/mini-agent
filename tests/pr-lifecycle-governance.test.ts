import { describe, expect, it } from 'vitest';
import {
  analyzeBranchLifecycle,
  closeMergedPrHandoffs,
  decidePrReviewAssignment,
  extractAllowedIssueRefs,
  extractIssueRefs,
  parseGitLogRecords,
  type BranchLifecycleInput,
} from '../src/pr-lifecycle-governance.js';

function input(patch: Partial<BranchLifecycleInput>): BranchLifecycleInput {
  return {
    branch: 'main',
    baseBranch: 'main',
    dirty: false,
    commitsAhead: [],
    pullRequest: null,
    ...patch,
  };
}

describe('PR lifecycle governance', () => {
  it('allows clean base branch to accept new scope', () => {
    const analysis = analyzeBranchLifecycle(input({}));

    expect(analysis.status).toBe('base');
    expect(analysis.canAcceptNewScope).toBe(true);
    expect(analysis.shouldBlockPush).toBe(false);
  });

  it('detects PR scope contamination and blocks push', () => {
    const analysis = analyzeBranchLifecycle(input({
      branch: 'fix/error-patterns-lastmessage',
      pullRequest: {
        number: 90,
        title: 'fix(feedback-loops): capture sampleMsg',
        body: 'Closes #90.',
      },
      commitsAhead: [
        { sha: 'a', subject: 'fix(feedback-loops): capture sampleMsg (#90)' },
        { sha: 'b', subject: 'fix(housekeeping): graphify dispatch (#91)' },
      ],
    }));

    expect(analysis.status).toBe('scope-contaminated');
    expect(analysis.allowedIssueRefs).toEqual([90]);
    expect(analysis.foreignIssueRefs).toEqual([91]);
    expect(analysis.shouldBlockPush).toBe(true);
  });

  it('allows commits that reference the issue implemented by PR body', () => {
    const analysis = analyzeBranchLifecycle(input({
      branch: 'feat/correction-gate-hold-reasons',
      pullRequest: {
        number: 95,
        title: 'feat(correction-gate): respect documented hold reasons',
        body: 'Implements #94.',
      },
      commitsAhead: [
        { sha: 'a', subject: 'feat(correction-gate): hold reasons (#94)' },
      ],
    }));

    expect(analysis.status).toBe('pending-review');
    expect(analysis.allowedIssueRefs).toEqual([94, 95]);
    expect(analysis.foreignIssueRefs).toEqual([]);
    expect(analysis.shouldBlockPush).toBe(false);
  });

  it('marks PR without reviewer signal as not complete', () => {
    const analysis = analyzeBranchLifecycle(input({
      branch: 'fix/example',
      pullRequest: { number: 12, title: 'fix example', body: 'Closes #12.' },
    }));

    expect(analysis.status).toBe('pending-review');
    expect(analysis.hasReviewerSignal).toBe(false);
    expect(analysis.guidance.join('\n')).toContain('No reviewer signal');
  });

  it('extracts issue refs and allowed refs from common PR text', () => {
    expect(extractIssueRefs('fix #12, refs owner/repo#34 and not abc#no')).toEqual([12, 34]);
    expect(extractAllowedIssueRefs({
      number: 90,
      title: 'fix thing (#91)',
      body: 'Implements #94\nCloses #95\nExample contamination: #96 is not allowed by plain mention.',
    })).toEqual([90, 91, 94, 95]);
  });

  it('parses git log records emitted with unit separators', () => {
    const parsed = parseGitLogRecords('abc\x1fsubject one\x1fbody one\x1edef\x1fsubject two\x1f\x1e');

    expect(parsed).toEqual([
      { sha: 'abc', subject: 'subject one', body: 'body one' },
      { sha: 'def', subject: 'subject two', body: '' },
    ]);
  });

  it('assigns governance PRs to internal Tanren-led multi-brain review', () => {
    const decision = decidePrReviewAssignment({
      number: 98,
      title: 'fix: gate PR branch scope contamination',
      body: 'Adds git hook governance and lifecycle policy.',
      reviewDecision: '',
      reviewRequests: [],
    });

    expect(decision).toEqual(expect.objectContaining({
      needsAssignment: true,
      reviewer: 'akari',
      reviewers: ['akari', 'codex', 'claude-code'],
      framework: 'internal-governance',
      status: 'ready',
    }));
  });

  it('escalates only human-gated PRs to Alex', () => {
    const decision = decidePrReviewAssignment({
      number: 99,
      title: 'fix: rotate secret handling human-gate',
      reviewDecision: '',
      reviewRequests: [],
    });

    expect(decision.reviewers).toEqual(['akari', 'alex']);
    expect(decision.framework).toBe('human-escalation');
  });

  it('assigns code PRs to cross-model code review', () => {
    const decision = decidePrReviewAssignment({
      number: 12,
      title: 'fix(runtime): prevent loop retry storm',
      body: 'Touches src/loop.ts and tests.',
      reviewDecision: '',
      reviewRequests: [],
    });

    expect(decision.reviewers).toEqual(['codex', 'claude-code']);
    expect(decision.framework).toBe('code-review');
  });

  it('does not assign review when PR already has a reviewer signal', () => {
    expect(decidePrReviewAssignment({
      number: 12,
      title: 'fix: code path',
      reviewDecision: 'REVIEW_REQUIRED',
      reviewRequests: [],
    }).needsAssignment).toBe(false);

    expect(decidePrReviewAssignment({
      number: 13,
      title: 'fix: code path',
      reviewDecision: '',
      reviewRequests: [{ login: 'reviewer' }],
    }).needsAssignment).toBe(false);
  });

  it('closes merged PR handoff rows and appends missing closure rows', () => {
    const active = [
      '# Active Handoffs',
      '',
      '| From | To | Task | Status | Created | Done |',
      '|------|----|------|--------|---------|------|',
      '| github | akari | PR #98 fix: gate PR branch scope contamination | needs-review | 05-06 | - |',
      '| github | codex | PR #98 fix: gate PR branch scope contamination | needs-review | 05-06 | - |',
    ].join('\n');

    const result = closeMergedPrHandoffs(active, [
      { number: 98, title: 'fix: gate PR branch scope contamination' },
      { number: 99, title: 'fix: another | task' },
    ], '05-07');

    expect(result.updated).toBe(2);
    expect(result.appended).toBe(1);
    expect(result.content).toContain('| github | akari | PR #98 fix: gate PR branch scope contamination | merged | 05-06 | 05-07 |');
    expect(result.content).toContain('| github | codex | PR #98 fix: gate PR branch scope contamination | merged | 05-06 | 05-07 |');
    expect(result.content).toContain('| github | kuro | PR #99 fix: another / task | merged | 05-07 | 05-07 |');
  });
});
