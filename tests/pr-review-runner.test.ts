import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendPrReviewClaim,
  applyPrReviewConsensusToHandoffs,
  createPrReviewClaim,
  evaluatePrReviewConsensus,
  getPrReviewClaimsPath,
  parsePrReviewHandoffs,
  readPrReviewClaimsSync,
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
});
