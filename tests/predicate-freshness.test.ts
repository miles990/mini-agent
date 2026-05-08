/**
 * Predicate freshness re-verification — GitHub issue #306 (Layer 1 + Layer 2)
 *
 * Verifies that `reverifyPredicate` returns:
 *   - true  when the underlying predicate is still stale (dispatch should proceed)
 *   - false when the predicate is now clean (dispatch should be skipped)
 *   - null  when no live source-of-truth is wired (fail-open: snapshot wins)
 *
 * The predicates wired in Layer 1 are:
 *   - `dirty-runtime-workspace` (git status --porcelain)
 *   - `local-commit-not-pushed` (git rev-list --count @{u}..HEAD)
 *
 * The predicates wired in Layer 2 (issue #323) are:
 *   - `memory-state-truth` (evaluateMemoryStateTruth source-of-truth)
 *   - `ship-truth` (git status --porcelain=v2 --branch ahead/behind/dirty check)
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

  describe('predicate checks', () => {
    it('low-responsiveness returns false when runtime is responsive', async () => {
      const result = await reverifyPredicate('low-responsiveness', { repoRoot, memoryDir });
      expect(result).toBe(false);
    });

    it('unknown predicate type returns null', async () => {
      const result = await reverifyPredicate('something-undeclared', { repoRoot, memoryDir });
      expect(result).toBeNull();
    });
  });

  describe('memory-state-truth (issue #323 Layer 2)', () => {
    it('returns false when memory dir has no malformed JSONL and no .git (clean state)', async () => {
      // memoryDir = repoRoot which has no critical JSONL files and no heartbeat → ok
      const result = await reverifyPredicate('memory-state-truth', { repoRoot, memoryDir });
      expect(result).toBe(false);
    });

    it('returns true when a critical JSONL file is malformed', async () => {
      const fs = await import('node:fs');
      const stateDir = path.join(memoryDir, 'state');
      fs.mkdirSync(stateDir, { recursive: true });
      // Write malformed JSONL (invalid JSON) to a critical path
      fs.writeFileSync(path.join(stateDir, 'task-events.jsonl'), 'not-valid-json\n', 'utf-8');
      const result = await reverifyPredicate('memory-state-truth', { repoRoot, memoryDir });
      expect(result).toBe(true);
    });

    it('returns boolean (not null) so phantom dispatches are skipped', async () => {
      const result = await reverifyPredicate('memory-state-truth', { repoRoot, memoryDir });
      expect(result).not.toBeNull();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('ship-truth (issue #323 Layer 2)', () => {
    it('returns false when repo is clean and in sync with upstream', async () => {
      const bare = mkdtempSync(path.join(os.tmpdir(), 'ship-truth-upstream-'));
      try {
        execFileSync('git', ['init', '--bare', '-q', '-b', 'main', bare], { stdio: 'pipe' });
        git('remote', 'add', 'origin', bare);
        git('push', '-q', '-u', 'origin', 'main');
        const result = await reverifyPredicate('ship-truth', { repoRoot, memoryDir });
        expect(result).toBe(false);
      } finally {
        rmSync(bare, { recursive: true, force: true });
      }
    });

    it('returns true when local has commits the upstream lacks (pending-push)', async () => {
      const bare = mkdtempSync(path.join(os.tmpdir(), 'ship-truth-ahead-'));
      try {
        execFileSync('git', ['init', '--bare', '-q', '-b', 'main', bare], { stdio: 'pipe' });
        git('remote', 'add', 'origin', bare);
        git('push', '-q', '-u', 'origin', 'main');
        git('commit', '--allow-empty', '-q', '-m', 'local-only-ship');
        const result = await reverifyPredicate('ship-truth', { repoRoot, memoryDir });
        expect(result).toBe(true);
      } finally {
        rmSync(bare, { recursive: true, force: true });
      }
    });

    it('returns true when working tree is dirty (uncommitted changes)', async () => {
      writeFileSync(path.join(repoRoot, 'ship-dirty.txt'), 'uncommitted', 'utf-8');
      const result = await reverifyPredicate('ship-truth', { repoRoot, memoryDir });
      expect(result).toBe(true);
    });

    it('returns boolean (not null) so phantom dispatches are skipped', async () => {
      const result = await reverifyPredicate('ship-truth', { repoRoot, memoryDir });
      expect(result).not.toBeNull();
      expect(typeof result).toBe('boolean');
    });
  });
});
