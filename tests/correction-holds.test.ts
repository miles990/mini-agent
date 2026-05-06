import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  loadCorrectionHolds,
  appendCorrectionHold,
  isHoldUnblocked,
  findActiveHold,
  holdsFilePath,
  type CorrectionHold,
} from '../src/correction-holds.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-correction-holds-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('correction-holds storage', () => {
  it('returns [] when holds file does not exist', () => {
    expect(loadCorrectionHolds(tmpDir)).toEqual([]);
  });

  it('appends and round-trips a hold record', () => {
    const hold: CorrectionHold = {
      id: 'hold-1',
      correction_reason_type: 'local-commit-not-pushed',
      branch: 'fix/x',
      sha: 'deadbee',
      reason: 'duplicate of PR #99',
      unblock_when: { kind: 'pr-merged', pr: 99 },
      created_at: '2026-05-06T00:00:00Z',
      created_by: 'kuro',
    };
    appendCorrectionHold(tmpDir, hold);

    const file = holdsFilePath(tmpDir);
    expect(file.endsWith('state/correction-holds.jsonl')).toBe(true);
    expect(readFileSync(file, 'utf-8').trim()).toBe(JSON.stringify(hold));

    const loaded = loadCorrectionHolds(tmpDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual(hold);
  });

  it('skips malformed JSON lines without throwing', () => {
    mkdirSync(path.join(tmpDir, 'state'), { recursive: true });
    const valid: CorrectionHold = {
      id: 'hold-2',
      correction_reason_type: 'pending-pledge',
      reason: 'ack pending',
      unblock_when: { kind: 'timeout', until: '2099-01-01T00:00:00Z' },
      created_at: '2026-05-06T00:00:00Z',
    };
    writeFileSync(
      holdsFilePath(tmpDir),
      ['{not-json', JSON.stringify(valid), '', '{"id":"x"}'].join('\n'),
      'utf-8',
    );
    const loaded = loadCorrectionHolds(tmpDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('hold-2');
  });
});

describe('isHoldUnblocked / timeout', () => {
  const baseHold: CorrectionHold = {
    id: 'h',
    correction_reason_type: 'local-commit-not-pushed',
    reason: 'r',
    unblock_when: { kind: 'timeout', until: '2026-05-06T00:00:00Z' },
    created_at: '2026-05-01T00:00:00Z',
  };

  it('returns true when current time is past the until timestamp', () => {
    expect(
      isHoldUnblocked(baseHold, { now: () => new Date('2026-05-07T00:00:00Z') }),
    ).toBe(true);
  });

  it('returns false when current time is before the until timestamp', () => {
    expect(
      isHoldUnblocked(baseHold, { now: () => new Date('2026-05-05T00:00:00Z') }),
    ).toBe(false);
  });

  it('returns false when until is unparseable', () => {
    const broken: CorrectionHold = { ...baseHold, unblock_when: { kind: 'timeout', until: 'not-a-date' } };
    expect(isHoldUnblocked(broken, { now: () => new Date('2099-01-01T00:00:00Z') })).toBe(false);
  });
});

describe('findActiveHold precedence', () => {
  const futureUnblock = { kind: 'timeout' as const, until: '2099-01-01T00:00:00Z' };
  const ctx = (overrides: Partial<{ branch: string | null; sha: string | null }> = {}) => ({
    branch: 'main',
    sha: 'abc1234deadbeef',
    ...overrides,
  });

  it('returns null when no holds exist', () => {
    expect(findActiveHold([], 'local-commit-not-pushed', ctx())).toBeNull();
  });

  it('prefers reason+branch+sha exact match over branch-only or generic', () => {
    const holds: CorrectionHold[] = [
      {
        id: 'generic',
        correction_reason_type: 'local-commit-not-pushed',
        reason: 'g', unblock_when: futureUnblock, created_at: '',
      },
      {
        id: 'branch-only',
        correction_reason_type: 'local-commit-not-pushed',
        branch: 'main',
        reason: 'b', unblock_when: futureUnblock, created_at: '',
      },
      {
        id: 'exact',
        correction_reason_type: 'local-commit-not-pushed',
        branch: 'main',
        sha: 'abc1234',
        reason: 'e', unblock_when: futureUnblock, created_at: '',
      },
    ];
    const match = findActiveHold(holds, 'local-commit-not-pushed', ctx());
    expect(match?.hold.id).toBe('exact');
    expect(match?.matchedBy).toBe('reason+branch+sha');
  });

  it('falls back to branch-only when sha differs', () => {
    const holds: CorrectionHold[] = [
      {
        id: 'branch-only',
        correction_reason_type: 'local-commit-not-pushed',
        branch: 'main',
        reason: 'b', unblock_when: futureUnblock, created_at: '',
      },
      {
        id: 'exact-other',
        correction_reason_type: 'local-commit-not-pushed',
        branch: 'main',
        sha: '0000000',
        reason: 'e', unblock_when: futureUnblock, created_at: '',
      },
    ];
    const match = findActiveHold(holds, 'local-commit-not-pushed', ctx());
    expect(match?.hold.id).toBe('branch-only');
    expect(match?.matchedBy).toBe('reason+branch');
  });

  it('skips holds whose unblock condition is satisfied', () => {
    const past = { kind: 'timeout' as const, until: '2020-01-01T00:00:00Z' };
    const holds: CorrectionHold[] = [
      {
        id: 'expired',
        correction_reason_type: 'local-commit-not-pushed',
        branch: 'main',
        sha: 'abc1234',
        reason: 'old', unblock_when: past, created_at: '',
      },
    ];
    expect(findActiveHold(holds, 'local-commit-not-pushed', ctx())).toBeNull();
  });

  it('does not match a different reason type', () => {
    const holds: CorrectionHold[] = [
      {
        id: 'pp',
        correction_reason_type: 'pending-pledge',
        reason: '', unblock_when: futureUnblock, created_at: '',
      },
    ];
    expect(findActiveHold(holds, 'local-commit-not-pushed', ctx())).toBeNull();
  });
});
