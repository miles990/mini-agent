import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendStaleDraftPrHandoffs,
  evaluatePrClosureGaps,
  extractClosingIssueRefs,
  extractSupersededIssueRefs,
  findApprovedBlockedPrs,
  findUntrackedPrs,
  parseTrackedPrNumbers,
  shouldAutoCloseSupersededPr,
  writeOpenPrSnapshot,
  type OpenPrSnapshotEntry,
} from '../src/pr-autopilot.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-pr-autopilot-'));
  mkdirSync(path.join(tmpDir, 'state'), { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

const activeMd = [
  '# Active Handoffs',
  '',
  '| From | To | Task | Status | Created | Done |',
  '|------|----|------|--------|---------|------|',
  '| github | codex | PR #10 fix: already tracked | needs-review | 05-07 | - |',
].join('\n') + '\n';

function pr(input: Partial<OpenPrSnapshotEntry> & Pick<OpenPrSnapshotEntry, 'number' | 'title'>): OpenPrSnapshotEntry {
  return {
    body: '',
    labels: [],
    isDraft: false,
    reviewDecision: null,
    reviewRequests: [],
    createdAt: '2026-05-07T00:00:00.000Z',
    updatedAt: '2026-05-07T00:00:00.000Z',
    ...input,
  };
}

describe('PR autopilot closure', () => {
  it('detects ready untracked PRs and stale drafts', () => {
    const now = new Date('2026-05-07T04:00:00.000Z');
    const gaps = findUntrackedPrs([
      pr({ number: 10, title: 'fix: already tracked' }),
      pr({ number: 11, title: 'fix: needs review' }),
      pr({ number: 12, title: 'fix: fresh draft', isDraft: true, createdAt: '2026-05-07T03:00:00.000Z' }),
      pr({ number: 13, title: 'fix: stale draft', isDraft: true, createdAt: '2026-05-07T00:30:00.000Z' }),
      pr({ number: 14, title: 'fix: hold', labels: ['hold'] }),
    ], activeMd, now, { draftTtlHours: 2 });

    expect(gaps.readyUntracked.map(item => item.number)).toEqual([11]);
    expect(gaps.staleDrafts.map(item => item.number)).toEqual([13]);
  });

  it('appends stale draft triage handoffs once', () => {
    const result = appendStaleDraftPrHandoffs(activeMd, [
      pr({ number: 13, title: 'fix: stale draft | needs table escape', isDraft: true }),
      pr({ number: 10, title: 'fix: already tracked', isDraft: true }),
    ], '05-07');

    expect(result.appended).toBe(1);
    expect(result.content).toContain('| github | kuro | PR #13 draft triage: fix: stale draft / needs table escape | needs-triage | 05-07 | - |');
    expect(parseTrackedPrNumbers(result.content).has(13)).toBe(true);
  });

  it('makes autonomy closure depend on the open PR snapshot', () => {
    writeOpenPrSnapshot(tmpDir, [pr({ number: 11, title: 'fix: needs review' })], new Date('2026-05-07T03:30:00.000Z'));

    const gaps = evaluatePrClosureGaps(tmpDir, activeMd, new Date('2026-05-07T04:00:00.000Z'));

    expect(gaps.snapshotMissing).toBe(false);
    expect(gaps.snapshotStale).toBe(false);
    expect(gaps.readyUntracked.map(item => item.number)).toEqual([11]);
  });

  it('treats approved but conflicting PRs as unclosed lifecycle work', () => {
    const blocked = findApprovedBlockedPrs([
      pr({ number: 21, title: 'fix: approved clean', reviewDecision: 'APPROVED', mergeStateStatus: 'CLEAN', mergeable: 'MERGEABLE' }),
      pr({ number: 22, title: 'fix: approved dirty', reviewDecision: 'APPROVED', mergeStateStatus: 'DIRTY', mergeable: 'CONFLICTING' }),
      pr({ number: 23, title: 'fix: draft dirty', isDraft: true, reviewDecision: 'APPROVED', mergeStateStatus: 'DIRTY', mergeable: 'CONFLICTING' }),
      pr({ number: 24, title: 'fix: held dirty', labels: ['hold'], reviewDecision: 'APPROVED', mergeStateStatus: 'DIRTY', mergeable: 'CONFLICTING' }),
    ]);

    expect(blocked.map(item => item.number)).toEqual([22]);
  });

  it('extracts only closing issue refs for superseded PR closure', () => {
    expect(extractClosingIssueRefs('Refs #196\nCloses #200\nfixes #201\nrelated #202')).toEqual([200, 201]);
  });

  it('extracts forge task issue refs for conflict superseded closure', () => {
    expect(extractSupersededIssueRefs('[forge] ## Task: P2 GitHub issue #323: predicate-freshness')).toEqual([323]);
  });

  it('auto-closes only low-risk superseded PRs', () => {
    expect(shouldAutoCloseSupersededPr(
      pr({ number: 217, title: 'feat: old fix', createdAt: '2026-05-07T02:24:00.000Z' }),
      [200],
      [{ number: 200, state: 'CLOSED', closedAt: '2026-05-07T02:27:00.000Z' }],
    )).toBe(true);

    expect(shouldAutoCloseSupersededPr(
      pr({ number: 218, title: 'feat: active fix', createdAt: '2026-05-07T02:24:00.000Z' }),
      [200],
      [{ number: 200, state: 'OPEN', closedAt: null }],
    )).toBe(false);
  });

  it('requires a blocked mergeable state for inferred issue refs', () => {
    const issue = { number: 323, state: 'CLOSED', closedAt: '2026-05-08T00:41:36.000Z' };
    expect(shouldAutoCloseSupersededPr(
      pr({ number: 328, title: '[forge] issue #323', createdAt: '2026-05-08T00:39:30.000Z', mergeable: 'CONFLICTING' }),
      [323],
      [issue],
      { requireBlockedMergeable: true },
    )).toBe(true);
    expect(shouldAutoCloseSupersededPr(
      pr({ number: 329, title: '[forge] issue #323', createdAt: '2026-05-08T00:39:30.000Z', mergeable: 'MERGEABLE' }),
      [323],
      [issue],
      { requireBlockedMergeable: true },
    )).toBe(false);
  });
});
