import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { appendMemoryIndexEntry, invalidateIndexCache, queryMemoryIndexSync } from '../src/memory-index.js';
import {
  closeResolvedCorrectionTasks,
  ensureCorrectionTask,
  evaluateCorrectionGate,
  parseGitStatusPorcelainV2,
} from '../src/correction-gate.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-correction-gate-'));
  invalidateIndexCache();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  invalidateIndexCache();
});

describe('correction gate', () => {
  it('flags recent unfinished pledges as correction reasons', async () => {
    await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'P1 finish promised work',
      payload: { origin: 'pledge', priority: 1 },
    });
    invalidateIndexCache();

    const snapshot = evaluateCorrectionGate(tmpDir, tmpDir);

    expect(snapshot.needsCorrection).toBe(true);
    expect(snapshot.reasons.map(r => r.type)).toContain('pending-pledge');
    expect(snapshot.suppressedActions).toContain('self-research');
  });

  it('creates one P0 correction task for active correction state', async () => {
    await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'P1 finish promised work',
      payload: { origin: 'pledge', priority: 1 },
    });
    invalidateIndexCache();

    const first = await ensureCorrectionTask(tmpDir);
    const second = await ensureCorrectionTask(tmpDir);
    invalidateIndexCache();

    expect(first?.summary).toContain('P0 correction gate');
    expect(first?.payload).toEqual(expect.objectContaining({
      correction_reason_type: 'pending-pledge',
      correction_initial_score: expect.any(Number),
      correction_initial_ship_truth: expect.any(String),
    }));
    expect(second?.id).toBe(first?.id);
    const correctionTasks = queryMemoryIndexSync(tmpDir, { type: ['task'], status: ['pending'] })
      .filter(t => t.summary?.includes('correction gate'));
    expect(correctionTasks).toHaveLength(1);
  });

  it('parses git ahead state as pending-push ship truth', () => {
    const parsed = parseGitStatusPorcelainV2([
      '# branch.oid abc123',
      '# branch.head main',
      '# branch.upstream origin/main',
      '# branch.ab +2 -0',
      '',
    ].join('\n'));

    expect(parsed).toEqual(expect.objectContaining({
      repoPresent: true,
      branch: 'main',
      headSha: 'abc123',
      ahead: 2,
      behind: 0,
      dirty: false,
      state: 'pending-push',
    }));
  });

  it('parseGitStatusPorcelainV2 sets headSha to null on initial branch', () => {
    const parsed = parseGitStatusPorcelainV2([
      '# branch.oid (initial)',
      '# branch.head main',
      '',
    ].join('\n'));
    expect(parsed.headSha).toBeNull();
    expect(parsed.branch).toBe('main');
  });

  it('does not treat empty temp memory with no pulse history as unhealthy', () => {
    mkdirSync(path.join(tmpDir, 'state'), { recursive: true });
    writeFileSync(path.join(tmpDir, 'state/task-events.jsonl'), '', 'utf-8');

    const snapshot = evaluateCorrectionGate(tmpDir, tmpDir);

    expect(snapshot.needsCorrection).toBe(false);
    expect(snapshot.guidance).toEqual([]);
  });

  it('closes active correction tasks when the gate is clean', async () => {
    await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'P0 correction gate: resolve pending-pledge',
      payload: { origin: 'scheduler', priority: 0 },
    });
    invalidateIndexCache();

    const closed = await closeResolvedCorrectionTasks(tmpDir, evaluateCorrectionGate(tmpDir, tmpDir));
    invalidateIndexCache();

    expect(closed).toHaveLength(1);
    expect(closed[0].status).toBe('completed');
    const current = queryMemoryIndexSync(tmpDir, { id: closed[0].id })[0];
    expect(current.status).toBe('completed');
    expect(current.payload).toEqual(expect.objectContaining({
      correction_resolution: 'gate-clean',
    }));
  });
});
