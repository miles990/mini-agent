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
});

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}
