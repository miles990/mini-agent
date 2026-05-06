import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { evaluateAutonomyClosure } from '../src/autonomy-closure-health.js';
import { buildTestHealthSnapshot, writeTestHealthSnapshot } from '../src/test-health-autopilot.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-test-health-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('test health autopilot', () => {
  it('extracts failed vitest files into a durable snapshot', () => {
    const snapshot = buildTestHealthSnapshot('pnpm exec vitest run', 1, [
      ' ❯ tests/delegation-arbiter.test.ts (11 tests | 7 failed) 11ms',
      ' FAIL  tests/delegation-arbiter.test.ts > delegation arbitration mapping > acquires a write lease',
      ' ❯ tests/self-research-autopilot.test.ts (6 tests | 5 failed) 109ms',
    ].join('\n'), new Date('2026-05-07T00:00:00.000Z'));

    expect(snapshot.status).toBe('failed');
    expect(snapshot.failedFiles).toEqual([
      { file: 'tests/delegation-arbiter.test.ts', failedCount: 7 },
      { file: 'tests/self-research-autopilot.test.ts', failedCount: 5 },
    ]);
    expect(snapshot.failedTests).toEqual([
      'tests/delegation-arbiter.test.ts',
    ]);
  });

  it('makes a recorded test failure block autonomy closure', () => {
    const snapshot = buildTestHealthSnapshot('pnpm exec vitest run', 1, [
      ' ❯ tests/delegation-arbiter.test.ts (11 tests | 7 failed) 11ms',
    ].join('\n'), new Date('2026-05-07T00:00:00.000Z'));
    writeTestHealthSnapshot(tmpDir, snapshot);

    const closure = evaluateAutonomyClosure(tmpDir, { repoRoot: tmpDir });
    const stage = closure.stages.find(s => s.stage === 'test-health');

    expect(stage).toEqual(expect.objectContaining({
      status: 'blocked',
      summary: expect.stringContaining('tests failed'),
    }));
    expect(closure.blockingStages).toContain('test-health');
    expect(closure.recommendedTask?.title).toBe('P0 autonomy closure: repair test-health');
  });

  it('treats a passing recorded test run as healthy', () => {
    const snapshot = buildTestHealthSnapshot('pnpm exec vitest run', 0, '✓ all tests passed', new Date('2026-05-07T00:00:00.000Z'));
    writeTestHealthSnapshot(tmpDir, snapshot);

    const closure = evaluateAutonomyClosure(tmpDir, { repoRoot: tmpDir });
    const stage = closure.stages.find(s => s.stage === 'test-health');

    expect(stage).toEqual(expect.objectContaining({
      status: 'ok',
      summary: 'tests passed: pnpm exec vitest run',
    }));
  });
});
