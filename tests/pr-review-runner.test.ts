import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendMissingInternalPrReviewClaims,
  appendPrReviewClaim,
  applyPrReviewConsensusToHandoffs,
  computePrReviewInputHash,
  createPrReviewClaim,
  createInternalPrReviewClaim,
  evaluatePrReviewConsensus,
  getPrReviewClaimsPath,
  parsePrReviewHandoffs,
  readPrReviewClaimsSync,
  reconcilePrReviewHandoffs,
  runPrReviewConsensus,
} from '../src/pr-review-runner.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-pr-review-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function activeMd(): string {
  return [
    '# Active Handoffs',
    '',
    '| From | To | Task | Status | Created | Done |',
    '|------|----|------|--------|---------|------|',
    '| github | akari | PR #96 fix(housekeeping): emit shell-executable cmd | needs-review | 05-06 | - |',
    '| github | codex | PR #96 fix(housekeeping): emit shell-executable cmd | needs-review | 05-06 | - |',
    '| github | claude-code | PR #96 fix(housekeeping): emit shell-executable cmd | needs-review | 05-06 | - |',
  ].join('\n') + '\n';
}

describe('PR review runner', () => {
  it('writes and reads PR review claims as JSONL file truth', () => {
    const claim = createPrReviewClaim({
      prNumber: 96,
      reviewer: 'codex',
      framework: 'code-review',
      verdict: 'approve',
      risk: 'low',
      summary: 'Diff is scoped and tests cover the behavior.',
      evidence: ['tests/pr-review-runner.test.ts'],
    }, new Date('2026-05-06T00:00:00Z'));

    appendPrReviewClaim(tmpDir, claim);

    expect(getPrReviewClaimsPath(tmpDir)).toBe(path.join(tmpDir, 'index', 'pr-review-claims.jsonl'));
    expect(readPrReviewClaimsSync(tmpDir)).toEqual([claim]);
  });

  it('parses review handoff rows from active.md', () => {
    expect(parsePrReviewHandoffs(activeMd()).map(h => [h.prNumber, h.reviewer, h.status])).toEqual([
      [96, 'akari', 'needs-review'],
      [96, 'codex', 'needs-review'],
      [96, 'claude-code', 'needs-review'],
    ]);
  });

  it('keeps consensus pending until required reviewers report', () => {
    const handoffs = parsePrReviewHandoffs(activeMd());
    const claims = [
      createPrReviewClaim({
        prNumber: 96,
        reviewer: 'codex',
        framework: 'code-review',
        verdict: 'approve',
        risk: 'low',
        summary: 'Code review approves.',
        evidence: ['diff'],
      }),
    ];

    const consensus = evaluatePrReviewConsensus(handoffs, claims)[0];

    expect(consensus.status).toBe('commented');
    expect(consensus.missingReviewers).toEqual(['akari', 'claude-code']);
    expect(consensus.summary).toContain('waiting for akari, claude-code');
  });

  it('marks handoffs review-approved when all required reviewers approve', () => {
    const handoffs = parsePrReviewHandoffs(activeMd());
    const claims = (['akari', 'codex', 'claude-code'] as const).map(reviewer => createPrReviewClaim({
      prNumber: 96,
      reviewer,
      framework: reviewer === 'akari' ? 'tanren-review' : 'code-review',
      verdict: 'approve',
      risk: 'low',
      summary: `${reviewer} approves.`,
      evidence: ['diff'],
    }));
    const consensus = evaluatePrReviewConsensus(handoffs, claims);

    const updated = applyPrReviewConsensusToHandoffs(activeMd(), consensus);

    expect(consensus[0].status).toBe('approved');
    expect(updated.match(/review-approved/g)?.length).toBe(3);
  });

  it('marks handoffs changes-requested when any reviewer requests changes', () => {
    const handoffs = parsePrReviewHandoffs(activeMd());
    const claims = [
      createPrReviewClaim({
        prNumber: 96,
        reviewer: 'akari',
        framework: 'tanren-review',
        verdict: 'approve',
        risk: 'low',
        summary: 'Direction is coherent.',
        evidence: ['handoff'],
      }),
      createPrReviewClaim({
        prNumber: 96,
        reviewer: 'codex',
        framework: 'code-review',
        verdict: 'request_changes',
        risk: 'medium',
        summary: 'Missing regression coverage.',
        evidence: ['tests missing'],
      }),
    ];

    const consensus = evaluatePrReviewConsensus(handoffs, claims);
    const updated = applyPrReviewConsensusToHandoffs(activeMd(), consensus);

    expect(consensus[0].status).toBe('changes_requested');
    expect(updated.match(/changes-requested/g)?.length).toBe(3);
  });

  it('runs consensus against memory/handoffs/active.md', () => {
    const handoffsDir = path.join(tmpDir, 'handoffs');
    mkdirSync(handoffsDir, { recursive: true });
    writeFileSync(path.join(handoffsDir, 'active.md'), activeMd(), 'utf-8');
    appendPrReviewClaim(tmpDir, createPrReviewClaim({
      prNumber: 96,
      reviewer: 'codex',
      framework: 'code-review',
      verdict: 'approve',
      risk: 'low',
      summary: 'Code path looks sound.',
      evidence: ['diff'],
    }));

    const result = runPrReviewConsensus(tmpDir);
    const updated = readFileSync(path.join(handoffsDir, 'active.md'), 'utf-8');

    expect(result.updated).toBe(true);
    expect(result.consensuses[0]).toEqual(expect.objectContaining({
      prNumber: 96,
      status: 'commented',
      receivedReviewers: ['codex'],
      missingReviewers: ['akari', 'claude-code'],
    }));
    expect(updated.match(/review-pending/g)?.length).toBe(3);
  });

  it('removes stale review handoff rows when assignment policy changes', () => {
    const content = activeMd()
      + '| github | alex | PR #96 fix(housekeeping): emit shell-executable cmd | needs-review | 05-06 | - |\n';

    const updated = reconcilePrReviewHandoffs(content, [{
      prNumber: 96,
      reviewers: ['akari', 'codex', 'claude-code'],
    }]);

    expect(updated).toContain('| github | akari | PR #96');
    expect(updated).not.toContain('| github | alex | PR #96');
  });

  it('creates internal review claims for non-human reviewers with verification evidence', () => {
    const claim = createInternalPrReviewClaim({
      prNumber: 104,
      title: 'fix: harden conflict governance and Kuro actor semantics',
      body: '## Verification\n- `pnpm typecheck` passed\n- `pnpm test` passed',
      headSha: 'abc123',
      reviewer: 'codex',
      framework: 'internal-governance',
      changedFiles: ['src/actor-registry.ts', 'tests/actor-registry.test.ts'],
    }, new Date('2026-05-06T00:00:00Z'));

    expect(claim).toEqual(expect.objectContaining({
      prNumber: 104,
      reviewer: 'codex',
      verdict: 'approve',
      risk: 'medium',
      headSha: 'abc123',
      reviewInputHash: expect.any(String),
    }));
  });

  it('accepts tsc verification evidence in PR bodies', () => {
    const claim = createInternalPrReviewClaim({
      prNumber: 89,
      title: 'fix(loop): dump head bytes on hasMarker=false soft-gate skip',
      body: '## Verification\n- [x] `tsc --noEmit` passes',
      headSha: 'abc123',
      reviewer: 'akari',
      framework: 'tanren-review',
      changedFiles: ['src/loop.ts'],
    }, new Date('2026-05-06T00:00:00Z'));

    expect(claim).toEqual(expect.objectContaining({
      prNumber: 89,
      reviewer: 'akari',
      verdict: 'approve',
    }));
  });

  it('does not create internal claims for Alex review rows', () => {
    expect(createInternalPrReviewClaim({
      prNumber: 104,
      title: 'fix: requires alex-review',
      reviewer: 'alex',
      framework: 'human-escalation',
      changedFiles: ['src/actor-registry.ts'],
    })).toBeNull();
  });

  it('appends missing internal review claims only once per reviewer', () => {
    const candidates = (['akari', 'codex', 'claude-code'] as const).map(reviewer => ({
      prNumber: 104,
      title: 'fix: harden conflict governance',
      body: '## Verification\n- `pnpm test` passed',
      headSha: 'abc123',
      reviewer,
      framework: 'internal-governance' as const,
      changedFiles: ['src/conflict-governance.ts', 'tests/conflict-governance.test.ts'],
    }));

    const first = appendMissingInternalPrReviewClaims(tmpDir, candidates, new Date('2026-05-06T00:00:00Z'));
    const second = appendMissingInternalPrReviewClaims(tmpDir, candidates, new Date('2026-05-06T00:01:00Z'));

    expect(first.created).toHaveLength(3);
    expect(second.created).toHaveLength(0);
    expect(readPrReviewClaimsSync(tmpDir, 104)).toHaveLength(3);
  });

  it('creates a new review claim when the PR input changes after requested changes', () => {
    const baseCandidate = {
      prNumber: 104,
      title: 'fix: harden conflict governance',
      body: 'Missing verification section',
      headSha: 'abc123',
      reviewer: 'codex' as const,
      framework: 'internal-governance' as const,
      changedFiles: ['src/conflict-governance.ts'],
    };
    const fixedCandidate = {
      ...baseCandidate,
      body: '## Verification\n- `pnpm test` passed',
    };

    const first = appendMissingInternalPrReviewClaims(tmpDir, [baseCandidate], new Date('2026-05-06T00:00:00Z'));
    const duplicate = appendMissingInternalPrReviewClaims(tmpDir, [baseCandidate], new Date('2026-05-06T00:01:00Z'));
    const fixed = appendMissingInternalPrReviewClaims(tmpDir, [fixedCandidate], new Date('2026-05-06T00:02:00Z'));
    const claims = readPrReviewClaimsSync(tmpDir, 104);

    expect(first.created).toHaveLength(1);
    expect(first.created[0].verdict).toBe('request_changes');
    expect(duplicate.created).toHaveLength(0);
    expect(fixed.created).toHaveLength(1);
    expect(fixed.created[0].verdict).toBe('approve');
    expect(claims).toHaveLength(2);
    expect(new Set(claims.map(c => c.reviewInputHash)).size).toBe(2);
  });

  it('changes the review input fingerprint when the head sha changes', () => {
    const candidate = {
      prNumber: 104,
      title: 'fix: harden conflict governance',
      body: '## Verification\n- `pnpm test` passed',
      reviewer: 'codex' as const,
      framework: 'internal-governance' as const,
      changedFiles: ['tests/conflict-governance.test.ts', 'src/conflict-governance.ts'],
    };

    expect(computePrReviewInputHash({ ...candidate, headSha: 'abc123' }))
      .not.toBe(computePrReviewInputHash({ ...candidate, headSha: 'def456' }));
    expect(computePrReviewInputHash({ ...candidate, changedFiles: [...candidate.changedFiles].reverse(), headSha: 'abc123' }))
      .toBe(computePrReviewInputHash({ ...candidate, headSha: 'abc123' }));
  });

  it('uses the current review policy version in the input fingerprint', () => {
    const hash = computePrReviewInputHash({
      prNumber: 89,
      title: 'fix(loop): dump head bytes on hasMarker=false soft-gate skip',
      body: '## Verification\n- [x] `tsc --noEmit` passes',
      headSha: 'a08d45898b3049b027c7b18a0d612e300b604333',
      reviewer: 'akari',
      framework: 'tanren-review',
      changedFiles: ['src/loop.ts'],
    });

    expect(hash).not.toBe('888b5ec0d453625c');
  });
});
