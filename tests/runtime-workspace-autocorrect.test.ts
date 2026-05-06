import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { autocorrectRuntimeWorkspace } from '../src/runtime-workspace-autocorrect.js';

describe('runtime workspace autocorrect', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-runtime-autocorrect-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('moves runtime-local commits into an isolated worktree branch and resets runtime', () => {
    const remote = path.join(tmpDir, 'remote.git');
    const repo = path.join(tmpDir, 'mini-agent');
    git(tmpDir, ['init', '--bare', remote]);
    git(tmpDir, ['clone', remote, repo]);
    git(repo, ['config', 'user.email', 'test@example.com']);
    git(repo, ['config', 'user.name', 'Test User']);
    writeFileSync(path.join(repo, 'README.md'), 'base\n');
    git(repo, ['add', 'README.md']);
    git(repo, ['commit', '-m', 'init']);
    git(repo, ['branch', '-M', 'runtime/main']);
    git(repo, ['push', '-u', 'origin', 'runtime/main:main']);
    git(repo, ['fetch', 'origin', 'main']);
    git(repo, ['branch', '--set-upstream-to=origin/main', 'runtime/main']);

    writeFileSync(path.join(repo, 'README.md'), 'base\nruntime local\n');
    git(repo, ['commit', '-am', 'diag: runtime local change']);
    const localHead = gitOut(repo, ['rev-parse', 'HEAD']);

    const result = autocorrectRuntimeWorkspace(repo, {
      apply: true,
      createPr: false,
      worktreeParent: tmpDir,
    });

    expect(result).toEqual(expect.objectContaining({
      status: 'created-worktree',
      resetRuntime: true,
    }));
    expect(result.branch).toBe(`fix/runtime-autocorrect-${localHead.slice(0, 8)}`);
    expect(gitOut(repo, ['rev-parse', 'HEAD'])).toBe(gitOut(repo, ['rev-parse', 'origin/main']));
    expect(gitOut(repo, ['status', '--short', '--branch'])).toContain('runtime/main...origin/main');
    expect(gitOut(result.worktree!, ['rev-parse', 'HEAD'])).toBe(localHead);
  });

  it('moves tracked runtime dirt into an isolated worktree branch and resets runtime', () => {
    const remote = path.join(tmpDir, 'dirty-remote.git');
    const repo = path.join(tmpDir, 'dirty-mini-agent');
    git(tmpDir, ['init', '--bare', remote]);
    git(tmpDir, ['clone', remote, repo]);
    git(repo, ['config', 'user.email', 'test@example.com']);
    git(repo, ['config', 'user.name', 'Test User']);
    writeFileSync(path.join(repo, 'README.md'), 'base\n');
    git(repo, ['add', 'README.md']);
    git(repo, ['commit', '-m', 'init']);
    git(repo, ['branch', '-M', 'runtime/main']);
    git(repo, ['push', '-u', 'origin', 'runtime/main:main']);
    git(repo, ['fetch', 'origin', 'main']);
    git(repo, ['branch', '--set-upstream-to=origin/main', 'runtime/main']);

    writeFileSync(path.join(repo, 'README.md'), 'base\ntracked dirty\n');

    const result = autocorrectRuntimeWorkspace(repo, {
      apply: true,
      createPr: false,
      worktreeParent: tmpDir,
    });

    expect(result.status).toBe('created-worktree');
    expect(gitOut(repo, ['rev-parse', 'HEAD'])).toBe(gitOut(repo, ['rev-parse', 'origin/main']));
    expect(gitOut(repo, ['status', '--short', '--branch'])).toContain('runtime/main...origin/main');
    expect(gitOut(result.worktree!, ['show', '--format=', '--name-only', 'HEAD'])).toContain('README.md');
    expect(gitOut(result.worktree!, ['show', 'HEAD:README.md'])).toContain('tracked dirty');
  });

  it('blocks when runtime checkout has untracked changes', () => {
    const repo = path.join(tmpDir, 'repo-untracked');
    git(tmpDir, ['init', '-b', 'runtime/main', repo]);
    git(repo, ['config', 'user.email', 'test@example.com']);
    git(repo, ['config', 'user.name', 'Test User']);
    writeFileSync(path.join(repo, 'README.md'), 'base\n');
    git(repo, ['add', 'README.md']);
    git(repo, ['commit', '-m', 'init']);
    writeFileSync(path.join(repo, 'new-file.txt'), 'untracked\n');

    expect(autocorrectRuntimeWorkspace(repo, { apply: true })).toEqual(expect.objectContaining({
      status: 'blocked',
      reason: expect.stringContaining('untracked changes'),
    }));
  });

  it('is idempotent: re-uses existing remote branch and PR when retry runs after partial failure', () => {
    const remote = path.join(tmpDir, 'idem-remote.git');
    const repo = path.join(tmpDir, 'idem-mini-agent');
    git(tmpDir, ['init', '--bare', remote]);
    git(tmpDir, ['clone', remote, repo]);
    git(repo, ['config', 'user.email', 'test@example.com']);
    git(repo, ['config', 'user.name', 'Test User']);
    writeFileSync(path.join(repo, 'README.md'), 'base\n');
    git(repo, ['add', 'README.md']);
    git(repo, ['commit', '-m', 'init']);
    git(repo, ['branch', '-M', 'runtime/main']);
    git(repo, ['push', '-u', 'origin', 'runtime/main:main']);
    git(repo, ['fetch', 'origin', 'main']);
    git(repo, ['branch', '--set-upstream-to=origin/main', 'runtime/main']);

    writeFileSync(path.join(repo, 'README.md'), 'base\nruntime local\n');
    git(repo, ['commit', '-am', 'diag: runtime local change']);
    const localHead = gitOut(repo, ['rev-parse', 'HEAD']);
    const expectedBranch = `fix/runtime-autocorrect-${localHead.slice(0, 8)}`;

    // Simulate a prior partial run: branch already pushed to origin, but runtime
    // was never reset (e.g. because gh pr create failed mid-sequence).
    execFileSync('git', ['push', 'origin', `HEAD:refs/heads/${expectedBranch}`], { cwd: repo, stdio: 'ignore' });

    // Retry the autocorrect — must NOT throw on cherry-pick / push, must still reset runtime.
    const result = autocorrectRuntimeWorkspace(repo, {
      apply: true,
      createPr: false,
      worktreeParent: tmpDir,
    });

    expect(result.status).toBe('created-worktree');
    expect(result.branch).toBe(expectedBranch);
    expect(gitOut(repo, ['rev-parse', 'HEAD'])).toBe(gitOut(repo, ['rev-parse', 'origin/main']));
    expect(gitOut(repo, ['status', '--short', '--branch'])).toContain('runtime/main...origin/main');
  });
});

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function gitOut(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
}
