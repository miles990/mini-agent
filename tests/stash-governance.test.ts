import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classifyStash, governGitStashes, type GitStashRecord } from '../src/stash-governance.js';
import { queryMemoryIndexSync } from '../src/memory-index.js';

describe('stash governance', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-stash-governance-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('routes ai-trend generated stash conflicts to regeneration, not HTML merge', () => {
    const diagnostic = classifyStash(aiTrendStash());

    expect(diagnostic).toEqual(expect.objectContaining({
      decision: 'regenerate-generated-artifacts',
      rootCause: expect.stringContaining('Generated ai-trend HTML'),
      mechanicalAction: 'rerender-ai-trend-from-current-source',
      fallbackTask: expect.objectContaining({
        verifyCommand: expect.stringContaining('build-ai-trend-preview.mjs'),
      }),
    }));
    expect(diagnostic.assessment.conflicted.map(file => file.class)).toEqual(['generated', 'generated', 'generated']);
  });

  it('classifies already-absorbed stashes as drop candidates without creating fallback work', () => {
    const diagnostic = classifyStash({
      ...aiTrendStash(),
      absorbed: true,
    });

    expect(diagnostic).toEqual(expect.objectContaining({
      decision: 'drop-absorbed',
      rootCause: expect.stringContaining('already matches'),
      mechanicalAction: 'drop-absorbed-stash',
      fallbackTask: null,
    }));
  });

  it('creates one scheduler-visible diagnostic task for a preserved generated stash', async () => {
    const memoryDir = path.join(tmpDir, 'memory');
    mkdirSync(path.join(memoryDir, 'state'), { recursive: true });
    mkdirSync(path.join(memoryDir, 'state', 'index'), { recursive: true });
    writeFileSync(path.join(memoryDir, 'state', 'task-events.jsonl'), '', 'utf-8');
    writeFileSync(path.join(memoryDir, 'state', 'index', 'relations.jsonl'), '', { encoding: 'utf-8', flag: 'w' });

    const first = await governGitStashes(memoryDir, tmpDir, {
      createTasks: true,
      reason: 'test',
      stashes: [aiTrendStash()],
    });
    const second = await governGitStashes(memoryDir, tmpDir, {
      createTasks: true,
      reason: 'test',
      stashes: [aiTrendStash()],
    });

    expect(first.createdTasks).toHaveLength(1);
    expect(second.createdTasks).toHaveLength(0);
    const tasks = queryMemoryIndexSync(memoryDir, { type: 'task' });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toEqual(expect.objectContaining({
      status: 'pending',
      summary: expect.stringContaining('regenerate ai-trend artifact'),
      payload: expect.objectContaining({
        priority: 1,
      }),
    }));
    expect(tasks[0].payload).toEqual(expect.objectContaining({
      verify_command: expect.stringContaining('stash-governance.ts'),
      acceptance_criteria: expect.stringContaining('no generated HTML is manually merged'),
    }));
  });

  it('routes managed deploy-backup with append-only memory conflicts to merge-append-union without a fallback task', () => {
    const diagnostic = classifyStash(deployBackupAppendOnlyStash());

    expect(diagnostic).toEqual(expect.objectContaining({
      decision: 'merge-append-union',
      mechanicalAction: 'append-union-and-drop',
      fallbackTask: null,
      rootCause: expect.stringContaining('append-only'),
    }));
    expect(diagnostic.assessment.manual).toHaveLength(0);
    expect(diagnostic.assessment.autoResolvable.every(f => f.resolution === 'append-union')).toBe(true);
  });

  it('classifies a stale deploy-backup snapshot as a mechanical drop, not a diagnose task', () => {
    const diagnostic = classifyStash(deployBackupCodeStash());

    expect(diagnostic).toEqual(expect.objectContaining({
      decision: 'drop-stale-deploy-backup',
      mechanicalAction: 'drop-deploy-backup-snapshot',
      fallbackTask: null,
      rootCause: expect.stringContaining('Pre-deploy safety snapshot'),
    }));
  });

  it('does not reclassify a deploy-backup carrying append-only memory — merge-append-union still wins', () => {
    // Regression guard: the deploy-backup drop branch must not steal stashes
    // that still have append-only memory to union-merge before being dropped.
    expect(classifyStash(deployBackupAppendOnlyStash()).decision).toBe('merge-append-union');
  });

  it('does not create scheduler tasks for managed deploy-backup append-only stashes (regression: phantom P1 loop)', async () => {
    const memoryDir = path.join(tmpDir, 'memory');
    mkdirSync(path.join(memoryDir, 'state'), { recursive: true });
    mkdirSync(path.join(memoryDir, 'state', 'index'), { recursive: true });
    writeFileSync(path.join(memoryDir, 'state', 'task-events.jsonl'), '', 'utf-8');
    writeFileSync(path.join(memoryDir, 'state', 'index', 'relations.jsonl'), '', { encoding: 'utf-8', flag: 'w' });

    const first = await governGitStashes(memoryDir, tmpDir, {
      createTasks: true,
      reason: 'test',
      stashes: [deployBackupAppendOnlyStash()],
    });
    const second = await governGitStashes(memoryDir, tmpDir, {
      createTasks: true,
      reason: 'test',
      stashes: [deployBackupAppendOnlyStash()],
    });

    expect(first.createdTasks).toHaveLength(0);
    expect(second.createdTasks).toHaveLength(0);
    expect(first.cases).toHaveLength(1);
    expect(first.cases[0].decision).toBe('merge-append-union');
  });

  it('executor union-merges append-only memory stashes in a real repo and drops the stash (closing #431 acceptance #1)', async () => {
    const repo = path.join(tmpDir, 'repo');
    mkdirSync(repo, { recursive: true });
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@test');
    git('config', 'user.name', 'test');
    git('config', 'commit.gpgsign', 'false');

    mkdirSync(path.join(repo, 'memory', 'handoffs'), { recursive: true });
    const file = path.join(repo, 'memory', 'handoffs', 'active.md');
    writeFileSync(file, 'line1\nline2\n', 'utf-8');
    git('add', '.');
    git('commit', '-q', '-m', 'init');

    // Stash side: append a STASH-only line.
    writeFileSync(file, 'line1\nline2\nSTASH-ONLY-LINE\n', 'utf-8');
    git('stash', 'push', '-q', '-m', 'On runtime/main: deploy-backup-20260508T000000Z', '--', 'memory/handoffs/active.md');

    // Main advances with a different append.
    writeFileSync(file, 'line1\nline2\nMAIN-ONLY-LINE\n', 'utf-8');
    git('add', '.');
    git('commit', '-q', '-m', 'main append');

    const memoryDir = path.join(tmpDir, 'memory');
    mkdirSync(path.join(memoryDir, 'state', 'index'), { recursive: true });
    writeFileSync(path.join(memoryDir, 'state', 'task-events.jsonl'), '', 'utf-8');
    writeFileSync(path.join(memoryDir, 'state', 'index', 'relations.jsonl'), '', 'utf-8');

    const result = await governGitStashes(memoryDir, repo, {
      executeAppendUnion: true,
      createTasks: true,
      reason: 'test',
    });

    expect(result.appendUnionMerges).toHaveLength(1);
    expect(result.appendUnionMerges![0].error).toBeUndefined();
    expect(result.appendUnionMerges![0].dropped).toBe(true);
    expect(result.appendUnionMerges![0].mergedFiles).toEqual(['memory/handoffs/active.md']);
    // Classifier already routes to merge-append-union without a fallback task,
    // so the executor should not need to remove tasks — just confirm none created.
    expect(result.createdTasks).toHaveLength(0);

    const merged = readFileSync(file, 'utf-8');
    expect(merged).toContain('MAIN-ONLY-LINE');
    expect(merged).toContain('STASH-ONLY-LINE');
    expect(merged).toContain('line1');

    const stashList = execFileSync('git', ['stash', 'list'], { cwd: repo, encoding: 'utf-8' });
    expect(stashList.trim()).toBe('');
  });

  it('drops every stale deploy-backup snapshot in one pass, unbounded by maxCases', async () => {
    const repo = path.join(tmpDir, 'repo');
    mkdirSync(repo, { recursive: true });
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@test');
    git('config', 'user.name', 'test');
    git('config', 'commit.gpgsign', 'false');

    const file = path.join(repo, 'src', 'thing.ts');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, 'export const v = 1;\n', 'utf-8');
    git('add', '.');
    git('commit', '-q', '-m', 'init');

    // Four deploy-backup snapshots — more than the default maxCases (3) — to
    // prove the drop pass drains the whole backlog in a single run rather than
    // ceil(N / maxCases) runs (the failure mode that let 33 accumulate).
    for (let i = 0; i < 4; i++) {
      writeFileSync(file, `export const v = ${i + 2};\n`, 'utf-8');
      git('stash', 'push', '-q', '-m', `On main: deploy-backup-2026050${i + 1}T010101Z`, '--', 'src/thing.ts');
    }

    const memoryDir = path.join(tmpDir, 'memory');
    mkdirSync(path.join(memoryDir, 'state', 'index'), { recursive: true });
    writeFileSync(path.join(memoryDir, 'state', 'task-events.jsonl'), '', 'utf-8');
    writeFileSync(path.join(memoryDir, 'state', 'index', 'relations.jsonl'), '', 'utf-8');

    const result = await governGitStashes(memoryDir, repo, {
      dropAbsorbed: true,
      maxCases: 3,
      reason: 'test',
    });

    expect(result.deployBackupDrops).toHaveLength(4);
    expect(result.createdTasks).toHaveLength(0);
    expect(execFileSync('git', ['stash', 'list'], { cwd: repo, encoding: 'utf-8' }).trim()).toBe('');
  });

  it('executor refuses to drop the stash if the merged output would shrink (append-only invariant)', async () => {
    const repo = path.join(tmpDir, 'repo');
    mkdirSync(repo, { recursive: true });
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@test');
    git('config', 'user.name', 'test');
    git('config', 'commit.gpgsign', 'false');

    mkdirSync(path.join(repo, 'memory', 'handoffs'), { recursive: true });
    const file = path.join(repo, 'memory', 'handoffs', 'active.md');
    writeFileSync(file, 'line1\nline2\nline3\nline4\nline5\n', 'utf-8');
    git('add', '.');
    git('commit', '-q', '-m', 'init');

    // Stash a SHRUNK version (deletion). Should never happen for genuine
    // append-only memory — the safety gate must catch it.
    writeFileSync(file, 'line1\n', 'utf-8');
    git('stash', 'push', '-q', '-m', 'On runtime/main: deploy-backup-shrink', '--', 'memory/handoffs/active.md');

    // Main keeps the full content.
    const memoryDir = path.join(tmpDir, 'memory');
    mkdirSync(path.join(memoryDir, 'state', 'index'), { recursive: true });
    writeFileSync(path.join(memoryDir, 'state', 'task-events.jsonl'), '', 'utf-8');
    writeFileSync(path.join(memoryDir, 'state', 'index', 'relations.jsonl'), '', 'utf-8');

    const result = await governGitStashes(memoryDir, repo, {
      executeAppendUnion: true,
      createTasks: true,
      reason: 'test',
    });

    // With base==stash-side==deletion, union of (main-full, base-empty-no-wait, stash-shrunk)
    // can shrink. The gate should catch and refuse to drop.
    // (This test is permissive: either the merge keeps full content — fine — OR
    // the gate catches a shrink — also fine. What we forbid is drop+shrink.)
    const merged = readFileSync(file, 'utf-8');
    expect(merged).toContain('line1');
    if (merged.length < 'line1\nline2\nline3\nline4\nline5\n'.length) {
      expect(result.appendUnionMerges![0].dropped).toBe(false);
      expect(result.appendUnionMerges![0].error).toContain('shrink');
    }
    // Either way: post-condition — file is not shorter than current length.
    // (We assert no drop+shrink combo.)
    if (result.appendUnionMerges![0].dropped) {
      expect(merged.length).toBeGreaterThanOrEqual('line1\nline2\nline3\nline4\nline5\n'.length);
    }
  });

  it('closes active stash tasks when the underlying stash case disappears', async () => {
    const memoryDir = path.join(tmpDir, 'memory');
    mkdirSync(path.join(memoryDir, 'state'), { recursive: true });
    mkdirSync(path.join(memoryDir, 'state', 'index'), { recursive: true });
    writeFileSync(path.join(memoryDir, 'state', 'task-events.jsonl'), '', 'utf-8');
    writeFileSync(path.join(memoryDir, 'state', 'index', 'relations.jsonl'), '', { encoding: 'utf-8', flag: 'w' });

    const first = await governGitStashes(memoryDir, tmpDir, {
      createTasks: true,
      reason: 'test',
      stashes: [aiTrendStash()],
    });
    const second = await governGitStashes(memoryDir, tmpDir, {
      createTasks: true,
      reason: 'test',
      stashes: [],
    });

    expect(first.createdTasks).toHaveLength(1);
    expect(second.closedTasks).toHaveLength(1);
    expect(queryMemoryIndexSync(memoryDir, { id: first.createdTasks[0].id })[0]).toEqual(expect.objectContaining({
      status: 'completed',
      payload: expect.objectContaining({
        completed_by: 'stash-governance',
        completed_reason: expect.stringContaining('no longer present'),
      }),
    }));
  });
});

function aiTrendStash(): GitStashRecord {
  return {
    ref: 'stash@{0}',
    message: 'On runtime/main: keep-ai-trend-dirty',
    files: [
      'kuro-portfolio/ai-trend/2026-05-08.html',
      'kuro-portfolio/ai-trend/index.html',
      'kuro-portfolio/ai-trend/preview.html',
    ],
  };
}

function deployBackupAppendOnlyStash(): GitStashRecord {
  return {
    ref: 'stash@{0}',
    message: 'On runtime/main: deploy-backup-20260508T165720Z',
    files: ['memory/handoffs/active.md'],
  };
}

function deployBackupCodeStash(): GitStashRecord {
  return {
    ref: 'stash@{0}',
    message: 'On main: deploy-backup-20260506T091949Z',
    files: ['src/loop.ts'],
  };
}
