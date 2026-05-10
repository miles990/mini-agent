import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  classifyWorktrees,
  queueWorktreeLifecycleTasks,
  readWorktreeLifecycleRecords,
  type WorktreeLifecycleCase,
} from '../src/worktree-lifecycle-janitor.js';
import { queryMemoryIndexSync } from '../src/memory-index.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-worktree-lifecycle-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('worktree lifecycle janitor', () => {
  it('classifies non-root worktrees that are not represented by open PRs', () => {
    const root = path.join(tmpDir, 'repo');
    const cleanUnmerged = path.join(tmpDir, 'repo-clean-unmerged');
    const dirtyMerged = path.join(tmpDir, 'repo-dirty-merged');
    const openPr = path.join(tmpDir, 'repo-open-pr');

    git(tmpDir, ['init', '-b', 'main', root]);
    git(root, ['config', 'user.email', 'test@example.com']);
    git(root, ['config', 'user.name', 'Test']);
    writeFileSync(path.join(root, 'README.md'), 'base\n');
    git(root, ['add', 'README.md']);
    git(root, ['commit', '-m', 'init']);

    git(root, ['checkout', '-b', 'fix/old-work']);
    writeFileSync(path.join(root, 'old-work.md'), 'old work\n');
    git(root, ['add', 'old-work.md']);
    git(root, ['commit', '-m', 'old work']);
    git(root, ['checkout', 'main']);
    git(root, ['worktree', 'add', cleanUnmerged, 'fix/old-work']);

    git(root, ['checkout', '-b', 'fix/merged-dirty']);
    writeFileSync(path.join(root, 'README.md'), 'base\nmerged\n');
    git(root, ['add', 'README.md']);
    git(root, ['commit', '-m', 'merged dirty branch']);
    git(root, ['checkout', 'main']);
    git(root, ['merge', '--no-ff', 'fix/merged-dirty', '-m', 'merge dirty branch']);
    git(root, ['worktree', 'add', dirtyMerged, 'fix/merged-dirty']);
    writeFileSync(path.join(dirtyMerged, 'README.md'), 'base\nmerged\nlocal dirty\n');

    git(root, ['branch', 'fix/open-pr']);
    git(root, ['worktree', 'add', openPr, 'fix/open-pr']);

    const cases = classifyWorktrees(root, [
      { path: root, branch: 'runtime/main', detached: false },
      { path: cleanUnmerged, branch: 'fix/old-work', detached: false },
      { path: dirtyMerged, branch: 'fix/merged-dirty', detached: false },
      { path: openPr, branch: 'fix/open-pr', detached: false },
    ], [
      { number: 42, headRefName: 'fix/open-pr', title: 'active PR' },
    ]);

    expect(cases.map(item => item.bucket)).toEqual(expect.arrayContaining([
      'clean-unmerged',
      'dirty-merged-real-work',
    ]));
    expect(cases.some(item => item.branch === 'fix/open-pr')).toBe(false);
  });

  it('queues bounded scheduler-visible triage tasks and records lifecycle ids', async () => {
    const cases: WorktreeLifecycleCase[] = [
      lifecycleCase('a', 'clean-unmerged'),
      lifecycleCase('b', 'dirty-unmerged'),
      lifecycleCase('c', 'detached-clean'),
    ];

    const result = await queueWorktreeLifecycleTasks(tmpDir, cases, new Date('2026-05-10T00:00:00.000Z'), {
      maxActiveTasks: 2,
      maxQueuedPerSweep: 2,
    });

    expect(result).toEqual({ scanned: 3, actionable: 3, queued: 2, skippedKnown: 0, held: 0 });
    const tasks = queryMemoryIndexSync(tmpDir, { type: ['task'], status: ['pending'] });
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toEqual(expect.objectContaining({
      summary: expect.stringContaining('Worktree lifecycle:'),
      tags: expect.arrayContaining(['workspace', 'worktree-lifecycle']),
      payload: expect.objectContaining({
        origin: 'worktree-lifecycle-janitor',
        priority: 2,
        acceptance_criteria: expect.any(String),
      }),
    }));
    expect(readWorktreeLifecycleRecords(tmpDir)).toHaveLength(2);
  });

  it('is idempotent for known worktree cases and caps active lifecycle tasks', async () => {
    const cases: WorktreeLifecycleCase[] = [
      lifecycleCase('a', 'clean-unmerged'),
      lifecycleCase('b', 'dirty-unmerged'),
      lifecycleCase('c', 'dirty-merged-real-work'),
    ];

    await queueWorktreeLifecycleTasks(tmpDir, cases, new Date('2026-05-10T00:00:00.000Z'), {
      maxActiveTasks: 3,
      maxQueuedPerSweep: 3,
    });
    const second = await queueWorktreeLifecycleTasks(tmpDir, cases, new Date('2026-05-10T01:00:00.000Z'), {
      maxActiveTasks: 1,
      maxQueuedPerSweep: 3,
    });

    expect(second).toEqual({ scanned: 3, actionable: 3, queued: 0, skippedKnown: 3, held: 2 });
    expect(queryMemoryIndexSync(tmpDir, { type: ['task'], status: ['pending'] })).toHaveLength(1);
    expect(queryMemoryIndexSync(tmpDir, { type: ['task'], status: ['hold'] })).toHaveLength(2);
  });
});

function lifecycleCase(name: string, bucket: WorktreeLifecycleCase['bucket']): WorktreeLifecycleCase {
  return {
    id: `case-${name}`,
    path: `/tmp/worktree-${name}`,
    branch: bucket.startsWith('detached') ? '(detached)' : `fix/${name}`,
    bucket,
    dirty: bucket.includes('dirty'),
    dirtyPaths: bucket.includes('dirty') ? ['src/example.ts'] : [],
    ahead: bucket === 'detached-clean' ? null : 1,
    behind: bucket === 'detached-clean' ? null : 10,
    mergedToBase: bucket === 'dirty-merged-real-work',
  };
}

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}
