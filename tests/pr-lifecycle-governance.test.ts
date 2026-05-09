import { describe, expect, it } from 'vitest';
import {
  analyzeBranchLifecycle,
  closeAbandonedPrHandoffs,
  closeMergedPrHandoffs,
  decidePrConflictAction,
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

  it('blocks unscoped non-memory commits on issue-scoped PRs', () => {
    const analysis = analyzeBranchLifecycle(input({
      branch: 'fix/review-backlog-issue-83',
      pullRequest: {
        number: 155,
        title: 'fix(memory): tighten review-backlog TTL + cap + read-side filter (#83)',
        body: 'Fixes #83.',
      },
      commitsAhead: [
        { sha: 'b', subject: '## Task: P0 correction gate: resolve local-commit-not-pushed' },
        { sha: 'a', subject: 'fix(memory): tighten review-backlog TTL + cap + read-side filter (#83)' },
      ],
    }));

    expect(analysis.status).toBe('scope-contaminated');
    expect(analysis.unscopedCommitSubjects).toEqual([
      '## Task: P0 correction gate: resolve local-commit-not-pushed',
    ]);
    expect(analysis.shouldBlockPush).toBe(true);
    expect(analysis.guidance.join('\n')).toContain('unscoped non-memory commit');
  });

  it('blocks feature branch push when branch is behind origin base', () => {
    const analysis = analyzeBranchLifecycle(input({
      branch: 'feat/kg-promotion-context-fabric',
      behindBase: 1,
      pullRequest: {
        number: 150,
        title: 'feat: promote curated memory into KG',
        body: '',
      },
      commitsAhead: [
        { sha: 'a', subject: 'feat: promote curated memory into KG' },
      ],
    }));

    expect(analysis.status).toBe('stale-base');
    expect(analysis.behindBase).toBe(1);
    expect(analysis.shouldBlockPush).toBe(true);
    expect(analysis.guidance.join('\n')).toContain('rebase before push');
  });

  it('downgrades scope-contaminated block when HEAD is a memory-only chore (Issue #102)', () => {
    const analysis = analyzeBranchLifecycle(input({
      branch: 'feat/correction-gate-hold-reasons',
      pullRequest: {
        number: 95,
        title: 'feat(correction-gate): respect documented hold reasons',
        body: 'Implements #94.',
      },
      commitsAhead: [
        // HEAD first (newest first, mirrors `git log` default order)
        { sha: 'c', subject: 'chore(memory): Added 19 lines of code in memory/handoffs/active.md' },
        { sha: 'b', subject: 'fix(housekeeping): graphify dispatch (#91)' },
        { sha: 'a', subject: 'feat(correction-gate): hold reasons (#94)' },
      ],
    }));

    expect(analysis.status).toBe('scope-contaminated');
    expect(analysis.foreignIssueRefs).toEqual([91]);
    expect(analysis.shouldBlockPush).toBe(false);
    expect(analysis.guidance.join('\n')).toContain('memory chore');
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

  it('does not treat host identity wording as Alex escalation by itself', () => {
    const decision = decidePrReviewAssignment({
      number: 104,
      title: 'fix: harden conflict governance and Kuro actor semantics',
      body: 'Clarify Kuro host identity and coordinator semantics.',
      reviewDecision: '',
      reviewRequests: [],
    });

    expect(decision.reviewers).toEqual(['akari', 'codex', 'claude-code']);
    expect(decision.framework).toBe('internal-governance');
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

  it('closes abandoned PR review handoff rows', () => {
    const active = [
      '# Active Handoffs',
      '',
      '| From | To | Task | Status | Created | Done |',
      '|------|----|------|--------|---------|------|',
      '| github | codex | PR #155 fix(memory): old follow-up | changes-requested | 05-06 | - |',
      '| github | claude-code | PR #155 fix(memory): old follow-up | changes-requested | 05-06 | - |',
    ].join('\n');

    const result = closeAbandonedPrHandoffs(active, [
      { number: 155, title: 'fix(memory): old follow-up' },
    ], '05-07');

    expect(result.updated).toBe(2);
    expect(result.appended).toBe(0);
    expect(result.content).toContain('| github | codex | PR #155 fix(memory): old follow-up | closed | 05-06 | 05-07 |');
    expect(result.content).toContain('| github | claude-code | PR #155 fix(memory): old follow-up | closed | 05-06 | 05-07 |');
  });

  it('attempts branch update for approved narrow verified conflicts', () => {
    expect(decidePrConflictAction({
      number: 12,
      title: 'fix: narrow bug',
      body: '## Verification\n- [x] `pnpm test` passed',
      mergeable: 'CONFLICTING',
      reviewDecision: 'APPROVED',
      changedFiles: ['src/feedback-loops.ts', 'tests/feedback-loops.test.ts'],
    })).toEqual(expect.objectContaining({
      action: 'attempt-update-branch',
      risk: 'medium',
    }));
  });

  it('routes broad conflicting PRs to decomposition instead of blind branch update', () => {
    expect(decidePrConflictAction({
      number: 90,
      title: 'fix(feedback-loops): capture sampleMsg',
      body: '## Verification\n- [x] `npx tsc --noEmit` clean',
      mergeable: 'CONFLICTING',
      reviewDecision: 'APPROVED',
      changedFiles: [
        '.githooks/post-commit',
        'memory/handoffs/active.md',
        'package.json',
        'src/dispatcher.ts',
        'src/feedback-loops.ts',
        'src/housekeeping.ts',
        'src/loop.ts',
        'src/workspace-finalizer.ts',
        'tests/workspace-finalizer.test.ts',
      ],
    })).toEqual(expect.objectContaining({
      action: 'needs-decomposition',
      risk: 'high',
    }));
  });

  it('requires verification before conflict update', () => {
    expect(decidePrConflictAction({
      number: 93,
      title: 'chore(hooks): post-commit auto-rebuild',
      body: '## Test plan\n- [ ] Verify later',
      mergeable: 'CONFLICTING',
      reviewDecision: '',
      changedFiles: ['.githooks/post-commit', 'package.json'],
    })).toEqual(expect.objectContaining({
      action: 'needs-verification',
    }));
  });

  it('closes conflicting PRs that target the protected runtime branch instead of main', () => {
    expect(decidePrConflictAction({
      number: 280,
      title: 'fix(enrich-fallback): flip status',
      body: '## Verification\n- [x] `node --check script.mjs` passed',
      baseRefName: 'runtime/main',
      mergeable: 'CONFLICTING',
      reviewDecision: '',
      changedFiles: ['scripts/ai-trend-enrich-fallback.mjs'],
    })).toEqual(expect.objectContaining({
      action: 'close-contaminated',
      risk: 'high',
      reason: expect.stringContaining('runtime/main'),
    }));
  });

  it('closes extremely broad conflicting PRs before verification repair loops', () => {
    expect(decidePrConflictAction({
      number: 281,
      title: 'fix: broad stale branch',
      body: '## Test plan\n- [ ] verify later',
      baseRefName: 'main',
      mergeable: 'CONFLICTING',
      reviewDecision: '',
      changedFiles: Array.from({ length: 21 }, (_, index) => `src/file-${index}.ts`),
    })).toEqual(expect.objectContaining({
      action: 'close-contaminated',
      risk: 'high',
    }));
  });

  // Issue #476: hasCompletedVerification must accept ## Test plan as a verification heading,
  // matching the gh pr create / Claude Code default template (PR #475 widened the same regex
  // in pr-review-runner; this site is the higher-impact gate because it changes the routed action).
  it('accepts a completed `## Test plan` block as verification evidence on conflicting PRs (issue #476)', () => {
    expect(decidePrConflictAction({
      number: 476,
      title: 'fix: narrow conflict with test-plan heading',
      body: '## Test plan\n- [x] `pnpm test` passed',
      mergeable: 'CONFLICTING',
      reviewDecision: 'APPROVED',
      changedFiles: ['src/feedback-loops.ts'],
    })).toEqual(expect.objectContaining({
      action: 'attempt-update-branch',
    }));
  });

  it('still rejects PRs with neither verification heading (no over-acceptance)', () => {
    expect(decidePrConflictAction({
      number: 477,
      title: 'fix: missing both headings',
      body: '## Summary\n- [x] some checked task but no verification heading',
      mergeable: 'CONFLICTING',
      reviewDecision: 'APPROVED',
      changedFiles: ['src/feedback-loops.ts'],
    })).toEqual(expect.objectContaining({
      action: 'needs-verification',
    }));
  });
});
