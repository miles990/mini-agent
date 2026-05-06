import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
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

function writeHolds(memoryDir: string, holds: CorrectionHold[]): void {
  const file = holdsFilePath(memoryDir);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, holds.map(h => JSON.stringify(h)).join('\n') + '\n', 'utf-8');
}

describe('correction-holds', () => {
  it('returns empty when file is missing', () => {
    expect(loadCorrectionHolds(tmpDir)).toEqual([]);
  });

  it('appends hold and round-trips through load', () => {
    const hold: CorrectionHold = {
      id: 'hold-1',
      correction_reason_type: 'local-commit-not-pushed',
      branch: 'fix/foo',
      sha: 'abc123de',
      reason: 'orphan duplicate of PR #93',
      unblock_when: { kind: 'pr-merged', pr: 93 },
      created_at: '2026-05-06T02:42:00.000Z',
      created_by: 'kuro',
    };
    appendCorrectionHold(tmpDir, hold);
    const reloaded = loadCorrectionHolds(tmpDir);
    expect(reloaded).toEqual([hold]);
  });

  it('skips malformed jsonl lines without throwing', () => {
    const file = holdsFilePath(tmpDir);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '{"id":"hold-ok","correction_reason_type":"local-commit-not-pushed","reason":"x","unblock_when":{"kind":"timeout","until":"2099-01-01T00:00:00Z"},"created_at":"2026-05-06T00:00Z"}\nnot-json-here\n', 'utf-8');
    const holds = loadCorrectionHolds(tmpDir);
    expect(holds).toHaveLength(1);
    expect(holds[0].id).toBe('hold-ok');
  });

  it('isHoldUnblocked: timeout in the past unblocks', () => {
    const hold: CorrectionHold = {
      id: 'h', correction_reason_type: 'local-commit-not-pushed', reason: 'x',
      unblock_when: { kind: 'timeout', until: '2026-05-05T00:00:00Z' },
      created_at: '2026-05-01T00:00Z',
    };
    expect(isHoldUnblocked(hold, { now: () => new Date('2026-05-06T00:00:00Z') })).toBe(true);
  });

  it('isHoldUnblocked: timeout in the future does not unblock', () => {
    const hold: CorrectionHold = {
      id: 'h', correction_reason_type: 'local-commit-not-pushed', reason: 'x',
      unblock_when: { kind: 'timeout', until: '2099-01-01T00:00:00Z' },
      created_at: '2026-05-01T00:00Z',
    };
    expect(isHoldUnblocked(hold, { now: () => new Date('2026-05-06T00:00:00Z') })).toBe(false);
  });

  it('findActiveHold matches reason+branch+sha precedence', () => {
    const holds: CorrectionHold[] = [
      {
        id: 'broad', correction_reason_type: 'local-commit-not-pushed', reason: 'broad',
        unblock_when: { kind: 'timeout', until: '2099-01-01T00:00:00Z' },
        created_at: '2026-05-01T00:00Z',
      },
      {
        id: 'branch-only', correction_reason_type: 'local-commit-not-pushed', branch: 'fix/foo',
        reason: 'branch-only',
        unblock_when: { kind: 'timeout', until: '2099-01-01T00:00:00Z' },
        created_at: '2026-05-01T00:00Z',
      },
      {
        id: 'sha-specific', correction_reason_type: 'local-commit-not-pushed', branch: 'fix/foo', sha: 'abc12345',
        reason: 'sha-specific',
        unblock_when: { kind: 'timeout', until: '2099-01-01T00:00:00Z' },
        created_at: '2026-05-01T00:00Z',
      },
    ];
    const match = findActiveHold(holds, 'local-commit-not-pushed', { branch: 'fix/foo', sha: 'abc1234567890' });
    expect(match?.hold.id).toBe('sha-specific');
    expect(match?.matchedBy).toBe('reason+branch+sha');
  });

  it('findActiveHold returns null when only unblocked holds exist', () => {
    const holds: CorrectionHold[] = [
      {
        id: 'expired', correction_reason_type: 'local-commit-not-pushed', branch: 'fix/foo',
        reason: 'expired',
        unblock_when: { kind: 'timeout', until: '2026-05-05T00:00:00Z' },
        created_at: '2026-05-01T00:00Z',
      },
    ];
    const match = findActiveHold(holds, 'local-commit-not-pushed', { branch: 'fix/foo' }, {
      now: () => new Date('2026-05-06T00:00:00Z'),
    });
    expect(match).toBeNull();
  });

  it('findActiveHold returns null for non-matching reason type', () => {
    const holds: CorrectionHold[] = [
      {
        id: 'h', correction_reason_type: 'local-commit-not-pushed', reason: 'x',
        unblock_when: { kind: 'timeout', until: '2099-01-01T00:00:00Z' },
        created_at: '2026-05-01T00:00Z',
      },
    ];
    const match = findActiveHold(holds, 'pending-pledge', { branch: 'fix/foo' });
    expect(match).toBeNull();
  });

  it('writeHolds util preserves through reload (ordering check)', () => {
    const a: CorrectionHold = {
      id: 'a', correction_reason_type: 'local-commit-not-pushed', reason: 'first',
      unblock_when: { kind: 'timeout', until: '2099-01-01T00:00:00Z' },
      created_at: '2026-05-01T00:00Z',
    };
    const b: CorrectionHold = {
      id: 'b', correction_reason_type: 'pending-pledge', reason: 'second',
      unblock_when: { kind: 'timeout', until: '2099-01-01T00:00:00Z' },
      created_at: '2026-05-01T00:00Z',
    };
    writeHolds(tmpDir, [a, b]);
    const reloaded = loadCorrectionHolds(tmpDir);
    expect(reloaded.map(h => h.id)).toEqual(['a', 'b']);
    expect(readFileSync(holdsFilePath(tmpDir), 'utf-8').split('\n').filter(Boolean)).toHaveLength(2);
  });
});
