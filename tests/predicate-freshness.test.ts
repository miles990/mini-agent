/**
 * Predicate freshness re-verification — GitHub issue #306 (Layer 1)
 *
 * Verifies that `reverifyPredicate` returns:
 *   - true  when the underlying predicate is still stale (dispatch should proceed)
 *   - false when the predicate is now clean (dispatch should be skipped)
 *   - null  when no live source-of-truth is wired (fail-open: snapshot wins)
 *
 * The two cheap predicates wired in Layer 1 are:
 *   - `dirty-runtime-workspace` (git status --porcelain)
 *   - `local-commit-not-pushed` (git rev-list --count @{u}..HEAD)
 *
 * Remaining predicates (`low-responsiveness`, `memory-state-truth`, `ship-truth`)
 * are scaffolded — they MUST return null until their checks land in follow-up
 * commits, so the scheduler keeps the snapshot decision rather than silently
 * dropping a real correction.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { reverifyPredicate } from '../src/predicate-freshness.js';

let repoRoot: string;
let memoryDir: string;

function git(...args: string[]): void {
  execFileSync('git', args, { cwd: repoRoot, stdio: 'pipe' });
}

beforeEach(() => {
  repoRoot = mkdtempSync(path.join(os.tmpdir(), 'predicate-freshness-'));
  memoryDir = repoRoot;
  // Initialise a minimal git repo with one commit so HEAD resolves.
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  git('commit', '--allow-empty', '-q', '-m', 'init');
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe('issue #306 — reverifyPredicate', () => {
  describe('dirty-runtime-workspace', () => {
    it('returns false when working tree is clean (skip phantom dispatch)', async () => {
      const result = await reverifyPredicate('dirty-runtime-workspace', { repoRoot, memoryDir });
      expect(result).toBe(false);
    });

    it('returns true when working tree has uncommitted changes', async () => {
      writeFileSync(path.join(repoRoot, 'dirty.txt'), 'unstaged content', 'utf-8');
      const result = await reverifyPredicate('dirty-runtime-workspace', { repoRoot, memoryDir });
      expect(result).toBe(true);
    });

    it('returns null (fail-open) when path is not a git repo', async () => {
      const nonRepo = mkdtempSync(path.join(os.tmpdir(), 'predicate-not-a-repo-'));
      try {
        const result = await reverifyPredicate('dirty-runtime-workspace', { repoRoot: nonRepo, memoryDir: nonRepo });
        expect(result).toBeNull();
      } finally {
        rmSync(nonRepo, { recursive: true, force: true });
      }
    });
  });

  describe('local-commit-not-pushed', () => {
    it('returns null (fail-open) when no upstream is configured', async () => {
      // Fresh repo with no remote/upstream → @{u} resolution fails → null.
      const result = await reverifyPredicate('local-commit-not-pushed', { repoRoot, memoryDir });
      expect(result).toBeNull();
    });

    it('returns false when local HEAD is in sync with the upstream', async () => {
      // Set up a bare upstream and push so @{u} = HEAD (0 ahead).
      const bare = mkdtempSync(path.join(os.tmpdir(), 'predicate-upstream-'));
      try {
        execFileSync('git', ['init', '--bare', '-q', '-b', 'main', bare], { stdio: 'pipe' });
        git('remote', 'add', 'origin', bare);
        git('push', '-q', '-u', 'origin', 'main');
        const result = await reverifyPredicate('local-commit-not-pushed', { repoRoot, memoryDir });
        expect(result).toBe(false);
      } finally {
        rmSync(bare, { recursive: true, force: true });
      }
    });

    it('returns true when local has commits the upstream lacks', async () => {
      const bare = mkdtempSync(path.join(os.tmpdir(), 'predicate-upstream-ahead-'));
      try {
        execFileSync('git', ['init', '--bare', '-q', '-b', 'main', bare], { stdio: 'pipe' });
        git('remote', 'add', 'origin', bare);
        git('push', '-q', '-u', 'origin', 'main');
        // Now create a local-only commit so HEAD is ahead of @{u}.
        git('commit', '--allow-empty', '-q', '-m', 'local-only');
        const result = await reverifyPredicate('local-commit-not-pushed', { repoRoot, memoryDir });
        expect(result).toBe(true);
      } finally {
        rmSync(bare, { recursive: true, force: true });
      }
    });
  });

  it('low-responsiveness returns false when no active tasks', async () => {
    const result = await reverifyPredicate('low-responsiveness', { repoRoot, memoryDir });
    expect(result).toBe(false);
  });

  describe('scaffolded predicates (fail-open until wired)', () => {
    it('memory-state-truth returns null', async () => {
      const result = await reverifyPredicate('memory-state-truth', { repoRoot, memoryDir });
      expect(result).toBeNull();
    });

    it('ship-truth returns null', async () => {
      const result = await reverifyPredicate('ship-truth', { repoRoot, memoryDir });
      expect(result).toBeNull();
    });

    it('unknown predicate type returns null', async () => {
      const result = await reverifyPredicate('something-undeclared', { repoRoot, memoryDir });
      expect(result).toBeNull();
    });
  });
});
