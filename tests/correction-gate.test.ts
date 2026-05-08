import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { appendMemoryIndexEntry, invalidateIndexCache, queryMemoryIndexSync } from '../src/memory-index.js';
import { appendCorrectionHold } from '../src/correction-holds.js';
import {
  closeResolvedCorrectionTasks,
  ensureCorrectionTask,
  evaluateCorrectionGate,
  getBlockingRuntimeDirtyPaths,
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

  it('reuses held correction tasks instead of creating a duplicate P0', async () => {
    await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'P1 finish promised work',
      payload: { origin: 'pledge', priority: 1 },
    });
    const held = await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'hold',
      summary: 'P0 correction gate: resolve low-responsiveness',
      payload: { origin: 'scheduler', priority: 0, correction_reason_type: 'low-responsiveness' },
    });
    invalidateIndexCache();

    const task = await ensureCorrectionTask(tmpDir);

    expect(task?.id).toBe(held.id);
    const correctionTasks = queryMemoryIndexSync(tmpDir, { type: ['task'], status: ['pending', 'hold'] })
      .filter(t => t.summary?.includes('correction gate'));
    expect(correctionTasks).toHaveLength(1);
  });

  it('does not suppress exploration for bounded background maintenance tasks', async () => {
    await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'KG discussion old topic: close or refresh stale context',
      tags: ['kg', 'discussion-lifecycle', 'stale-discussion'],
      payload: {
        origin: 'kg-discussion-janitor',
        priority: 2,
        ticksSinceLastProgress: 50,
      },
    });
    invalidateIndexCache();

    const snapshot = evaluateCorrectionGate(tmpDir, tmpDir);

    expect(snapshot.reasons.map(r => r.type)).not.toContain('low-responsiveness');
    expect(snapshot.suppressedActions).not.toContain('self-research');
  });

  it('does not escalate low-priority backlog into low-responsiveness correction', async () => {
    await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'P2 GitHub issue #368: investigate sub-threshold silent exit',
      tags: ['github', 'issue', 'P2'],
      payload: {
        origin: 'github-issue',
        priority: 2,
        ticksSinceLastProgress: 50,
      },
    });
    invalidateIndexCache();

    const snapshot = evaluateCorrectionGate(tmpDir, tmpDir);

    expect(snapshot.reasons.map(r => r.type)).not.toContain('low-responsiveness');
  });

  it('does not let middleware self-healing fallback tasks open the correction gate', async () => {
    await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'Create fallback for middleware task task-123 after provider budget hold',
      tags: ['middleware', 'self-healing', 'budget-or-quota'],
      payload: {
        origin: 'middleware-self-healing',
        priority: 0,
        middleware_failure_bucket: 'budget-or-quota',
        ticksSinceLastProgress: 50,
      },
    });
    invalidateIndexCache();

    const snapshot = evaluateCorrectionGate(tmpDir, tmpDir);

    expect(snapshot.reasons.map(r => r.type)).not.toContain('low-responsiveness');
  });

  it('does not let stale correction tasks create a self-referential responsiveness loop', async () => {
    await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'P0 correction gate: resolve low-responsiveness',
      payload: {
        origin: 'scheduler',
        priority: 0,
        correction_reason_type: 'low-responsiveness',
        ticksSinceLastProgress: 99,
      },
    });
    invalidateIndexCache();

    const snapshot = evaluateCorrectionGate(tmpDir, tmpDir);

    expect(snapshot.needsCorrection).toBe(false);
    expect(snapshot.reasons.map(r => r.type)).not.toContain('low-responsiveness');
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
      dirtyPaths: [],
      state: 'pending-push',
    }));
  });

  it('parses dirty runtime paths as dirty ship truth', () => {
    const parsed = parseGitStatusPorcelainV2([
      '# branch.oid abc123',
      '# branch.head runtime/main',
      '# branch.upstream origin/main',
      '# branch.ab +0 -0',
      '1 .M N... 100644 100644 100644 abc abc kuro-portfolio/ai-trend/index.html',
      '? knowledge-graph/',
      '',
    ].join('\n'));

    expect(parsed).toEqual(expect.objectContaining({
      dirty: true,
      dirtyPaths: ['kuro-portfolio/ai-trend/index.html', 'knowledge-graph/'],
      state: 'dirty',
    }));
  });

  it('does not flag protected runtime checkout when a file is only stat-dirty', () => {
    const memoryDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-correction-gate-memory-'));
    try {
      execGit(['init'], tmpDir);
      execGit(['config', 'user.email', 'test@example.com'], tmpDir);
      execGit(['config', 'user.name', 'Test User'], tmpDir);
      writeFileSync(path.join(tmpDir, 'src-file.ts'), 'export const value = 1;\n', 'utf-8');
      execGit(['add', 'src-file.ts'], tmpDir);
      execGit(['commit', '-m', 'init'], tmpDir);
      execGit(['branch', '-M', 'runtime/main'], tmpDir);
      process.env.MINI_AGENT_RUNTIME_WORKSPACE = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: tmpDir,
        encoding: 'utf-8',
      }).trim();

      writeFileSync(path.join(tmpDir, 'src-file.ts'), 'export const value = 1;\n', 'utf-8');

      const snapshot = evaluateCorrectionGate(memoryDir, tmpDir);

      expect(snapshot.needsCorrection).toBe(false);
      expect(snapshot.shipTruth.dirty).toBe(false);
      expect(snapshot.shipTruth.dirtyPaths).toEqual([]);
    } finally {
      delete process.env.MINI_AGENT_RUNTIME_WORKSPACE;
      rmSync(memoryDir, { recursive: true, force: true });
    }
  });

  it('flags protected runtime checkout when it is on main instead of runtime/main', () => {
    try {
      execGit(['init'], tmpDir);
      execGit(['config', 'user.email', 'test@example.com'], tmpDir);
      execGit(['config', 'user.name', 'Test User'], tmpDir);
      writeFileSync(path.join(tmpDir, 'README.md'), 'runtime guard fixture\n', 'utf-8');
      execGit(['add', 'README.md'], tmpDir);
      execGit(['commit', '-m', 'init'], tmpDir);
      execGit(['branch', '-M', 'main'], tmpDir);
      process.env.MINI_AGENT_RUNTIME_WORKSPACE = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: tmpDir,
        encoding: 'utf-8',
      }).trim();

      const snapshot = evaluateCorrectionGate(tmpDir, tmpDir);

      expect(snapshot.needsCorrection).toBe(true);
      expect(snapshot.reasons.map(r => r.type)).toContain('runtime-workspace-wrong-branch');
      expect(snapshot.guidance.join('\n')).toContain('只能在 runtime/main');
    } finally {
      delete process.env.MINI_AGENT_RUNTIME_WORKSPACE;
    }
  });

  it('acknowledges an active runtime-workspace-wrong-branch hold instead of emitting a correction reason', () => {
    try {
      execGit(['init'], tmpDir);
      execGit(['config', 'user.email', 'test@example.com'], tmpDir);
      execGit(['config', 'user.name', 'Test User'], tmpDir);
      writeFileSync(path.join(tmpDir, 'README.md'), 'runtime guard fixture\n', 'utf-8');
      execGit(['add', 'README.md'], tmpDir);
      execGit(['commit', '-m', 'init'], tmpDir);
      execGit(['branch', '-M', 'fix/issue-189-active-pr'], tmpDir);
      process.env.MINI_AGENT_RUNTIME_WORKSPACE = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: tmpDir,
        encoding: 'utf-8',
      }).trim();

      appendCorrectionHold(tmpDir, {
        id: 'hold-runtime-branch',
        correction_reason_type: 'runtime-workspace-wrong-branch',
        reason: 'active PR work; will rebase/merge before runtime restart',
        unblock_when: { kind: 'timeout', until: '2099-01-01T00:00:00Z' },
        created_at: '2026-05-07T00:00:00Z',
        created_by: 'test',
      });
      invalidateIndexCache();

      const snapshot = evaluateCorrectionGate(tmpDir, tmpDir);

      expect(snapshot.reasons.map(r => r.type)).not.toContain('runtime-workspace-wrong-branch');
      expect(snapshot.acknowledgedHolds.map(h => h.hold.id)).toContain('hold-runtime-branch');
      expect(snapshot.guidance.join('\n')).toContain('active hold');
    } finally {
      delete process.env.MINI_AGENT_RUNTIME_WORKSPACE;
    }
  });

  it('classifies only managed/code dirt as blocking runtime dirt', () => {
    expect(getBlockingRuntimeDirtyPaths([
      'memory/inner-notes.md',
      'memory/handoffs/active.md',
      'kuro-portfolio/ai-trend/index.html',
      'knowledge-graph/',
      'src/correction-gate.ts',
    ])).toEqual([
      'kuro-portfolio/ai-trend/index.html',
      'knowledge-graph/',
      'src/correction-gate.ts',
    ]);
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

  it('acknowledges an active low-responsiveness hold instead of emitting a correction reason', async () => {
    await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'stale resolved task',
      payload: { ticksSinceLastProgress: 10 },
    });
    appendCorrectionHold(tmpDir, {
      id: 'hold-low-resp',
      correction_reason_type: 'low-responsiveness',
      reason: 'signal lag confirmed',
      unblock_when: { kind: 'timeout', until: '2099-01-01T00:00:00Z' },
      created_at: '2026-05-06T00:00:00Z',
      created_by: 'test',
    });
    invalidateIndexCache();

    const snapshot = evaluateCorrectionGate(tmpDir, tmpDir);

    expect(snapshot.reasons.map(r => r.type)).not.toContain('low-responsiveness');
    expect(snapshot.acknowledgedHolds.map(h => h.hold.id)).toContain('hold-low-resp');
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

function execGit(args: string[], cwd = tmpDir): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}
