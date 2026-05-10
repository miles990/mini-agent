import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('workspace janitor', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-workspace-janitor-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('schedules branch deletion after removing a clean squash-merged PR worktree', () => {
    const repoDir = path.join(tmpDir, 'repo');
    const worktreeDir = path.join(tmpDir, 'repo-fix');
    const binDir = path.join(tmpDir, 'bin');
    mkdirSync(repoDir);
    mkdirSync(binDir);

    git(repoDir, ['init', '-b', 'main']);
    git(repoDir, ['config', 'user.email', 'test@example.com']);
    git(repoDir, ['config', 'user.name', 'Test']);
    writeFileSync(path.join(repoDir, 'README.md'), 'base\n');
    git(repoDir, ['add', 'README.md']);
    git(repoDir, ['commit', '-m', 'init']);
    git(repoDir, ['branch', 'fix/squash']);
    git(repoDir, ['worktree', 'add', worktreeDir, 'fix/squash']);

    const ghPath = path.join(binDir, 'gh');
    writeFileSync(ghPath, [
      '#!/bin/sh',
      'case "$*" in',
      '  *"--state merged"*) printf \'[{"headRefName":"fix/squash"}]\\n\' ;;',
      '  *"--state open"*) printf \'[]\\n\' ;;',
      '  *) exit 1 ;;',
      'esac',
      '',
    ].join('\n'));
    chmodSync(ghPath, 0o755);

    const out = execFileSync(path.join(process.cwd(), 'node_modules/.bin/tsx'), [path.join(process.cwd(), 'scripts/workspace-janitor.ts'), '--json'], {
      cwd: repoDir,
      encoding: 'utf-8',
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
        MINI_AGENT_RUNTIME_WORKSPACE: path.join(tmpDir, 'runtime'),
      },
    });
    const parsed = JSON.parse(out) as { actions: Array<{ type: string; target: string; command?: string[] }> };

    expect(parsed.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'remove-worktree',
        target: expect.stringContaining('repo-fix'),
      }),
      expect.objectContaining({
        type: 'delete-local-branch',
        target: 'fix/squash',
        command: ['git', 'branch', '-D', 'fix/squash'],
      }),
    ]));
    expect(parsed.actions.findIndex(action => action.type === 'remove-worktree')).toBeLessThan(
      parsed.actions.findIndex(action => action.type === 'delete-local-branch'),
    );
  });

  it('removes a clean worktree whose branch is already merged into base even when GitHub history is missing it', () => {
    const repoDir = path.join(tmpDir, 'repo');
    const worktreeDir = path.join(tmpDir, 'repo-old-fix');
    const binDir = path.join(tmpDir, 'bin');
    mkdirSync(repoDir);
    mkdirSync(binDir);

    git(repoDir, ['init', '-b', 'main']);
    git(repoDir, ['config', 'user.email', 'test@example.com']);
    git(repoDir, ['config', 'user.name', 'Test']);
    writeFileSync(path.join(repoDir, 'README.md'), 'base\n');
    git(repoDir, ['add', 'README.md']);
    git(repoDir, ['commit', '-m', 'init']);
    git(repoDir, ['checkout', '-b', 'fix/old-merged']);
    writeFileSync(path.join(repoDir, 'README.md'), 'base\nold fix\n');
    git(repoDir, ['add', 'README.md']);
    git(repoDir, ['commit', '-m', 'old fix']);
    git(repoDir, ['checkout', 'main']);
    git(repoDir, ['merge', '--no-ff', 'fix/old-merged', '-m', 'merge old fix']);
    git(repoDir, ['worktree', 'add', worktreeDir, 'fix/old-merged']);

    const ghPath = path.join(binDir, 'gh');
    writeFileSync(ghPath, [
      '#!/bin/sh',
      'case "$*" in',
      '  *"--state merged"*) printf \'[]\\n\' ;;',
      '  *"--state open"*) printf \'[]\\n\' ;;',
      '  *) exit 1 ;;',
      'esac',
      '',
    ].join('\n'));
    chmodSync(ghPath, 0o755);

    const out = execFileSync(path.join(process.cwd(), 'node_modules/.bin/tsx'), [path.join(process.cwd(), 'scripts/workspace-janitor.ts'), '--json'], {
      cwd: repoDir,
      encoding: 'utf-8',
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
        MINI_AGENT_RUNTIME_WORKSPACE: path.join(tmpDir, 'runtime'),
      },
    });
    const parsed = JSON.parse(out) as { actions: Array<{ type: string; target: string; reason: string; command?: string[] }> };

    expect(parsed.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'remove-worktree',
        target: expect.stringContaining('repo-old-fix'),
        reason: expect.stringContaining('already merged into main'),
      }),
      expect.objectContaining({
        type: 'delete-local-branch',
        target: 'fix/old-merged',
        command: ['git', 'branch', '-d', 'fix/old-merged'],
      }),
    ]));
  });

  it('removes an already-merged worktree when only disposable untracked artifacts remain', () => {
    const repoDir = path.join(tmpDir, 'repo');
    const worktreeDir = path.join(tmpDir, 'repo-artifact-only');
    const binDir = path.join(tmpDir, 'bin');
    mkdirSync(repoDir);
    mkdirSync(binDir);

    git(repoDir, ['init', '-b', 'main']);
    git(repoDir, ['config', 'user.email', 'test@example.com']);
    git(repoDir, ['config', 'user.name', 'Test']);
    writeFileSync(path.join(repoDir, 'README.md'), 'base\n');
    git(repoDir, ['add', 'README.md']);
    git(repoDir, ['commit', '-m', 'init']);
    git(repoDir, ['checkout', '-b', 'fix/artifact-only']);
    writeFileSync(path.join(repoDir, 'README.md'), 'base\nartifact fix\n');
    git(repoDir, ['add', 'README.md']);
    git(repoDir, ['commit', '-m', 'artifact fix']);
    git(repoDir, ['checkout', 'main']);
    git(repoDir, ['merge', '--no-ff', 'fix/artifact-only', '-m', 'merge artifact fix']);
    git(repoDir, ['worktree', 'add', worktreeDir, 'fix/artifact-only']);
    writeFileSync(path.join(worktreeDir, '.runtime-autocorrect.patch'), 'temporary patch payload\n');

    const ghPath = path.join(binDir, 'gh');
    writeFileSync(ghPath, [
      '#!/bin/sh',
      'case "$*" in',
      '  *"--state merged"*) printf \'[]\\n\' ;;',
      '  *"--state open"*) printf \'[]\\n\' ;;',
      '  *) exit 1 ;;',
      'esac',
      '',
    ].join('\n'));
    chmodSync(ghPath, 0o755);

    const out = execFileSync(path.join(process.cwd(), 'node_modules/.bin/tsx'), [path.join(process.cwd(), 'scripts/workspace-janitor.ts'), '--json'], {
      cwd: repoDir,
      encoding: 'utf-8',
      env: {
        ...process.env,
        PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ''}`,
        MINI_AGENT_RUNTIME_WORKSPACE: path.join(tmpDir, 'runtime'),
      },
    });
    const parsed = JSON.parse(out) as { actions: Array<{ type: string; target: string; reason: string; command?: string[] }> };

    expect(parsed.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'remove-worktree',
        target: expect.stringContaining('repo-artifact-only'),
        reason: expect.stringContaining('only disposable artifact(s) remain: .runtime-autocorrect.patch'),
        command: expect.arrayContaining(['git', 'worktree', 'remove', '--force']),
      }),
      expect.objectContaining({
        type: 'delete-local-branch',
        target: 'fix/artifact-only',
        command: ['git', 'branch', '-d', 'fix/artifact-only'],
      }),
    ]));
  });
});

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}
