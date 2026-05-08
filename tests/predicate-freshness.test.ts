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
 * Layer 2 (issue #323) extends to:
 *   - `memory-state-truth` (live `evaluateMemoryStateTruth`)
 *   - `ship-truth`         (live `git rev-list --left-right --count @{u}...HEAD`)
 *
 * Unknown predicate types still return null (fail-open: snapshot wins).
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

    it('memory-state-truth returns false when curated memory is clean (skip phantom dispatch)', async () => {
      // memoryDir is a tmp git repo with one empty commit — no malformed JSONL,
      // no HEARTBEAT.md, no curated-memory dirty paths → status:'ok' → false.
      const result = await reverifyPredicate('memory-state-truth', { repoRoot, memoryDir });
      expect(result).toBe(false);
    });

    it('memory-state-truth returns true when a critical JSONL is malformed', async () => {
      const stateDir = path.join(memoryDir, 'state');
      execFileSync('mkdir', ['-p', stateDir], { stdio: 'pipe' });
      writeFileSync(path.join(stateDir, 'task-events.jsonl'), '{not valid json\n', 'utf-8');
      const result = await reverifyPredicate('memory-state-truth', { repoRoot, memoryDir });
      expect(result).toBe(true);
    });

    it('ship-truth returns null (fail-open) when no upstream is configured', async () => {
      const result = await reverifyPredicate('ship-truth', { repoRoot, memoryDir });
      expect(result).toBeNull();
    });

    it('ship-truth returns false when local HEAD is in sync with the upstream', async () => {
      const bare = mkdtempSync(path.join(os.tmpdir(), 'predicate-ship-sync-'));
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

    it('ship-truth returns true when upstream is ahead of local (behind > 0)', async () => {
      const bare = mkdtempSync(path.join(os.tmpdir(), 'predicate-ship-behind-'));
      const otherClone = mkdtempSync(path.join(os.tmpdir(), 'predicate-ship-other-'));
      try {
        execFileSync('git', ['init', '--bare', '-q', '-b', 'main', bare], { stdio: 'pipe' });
        git('remote', 'add', 'origin', bare);
        git('push', '-q', '-u', 'origin', 'main');
        // Push a new commit from another clone so origin/main moves ahead.
        execFileSync('git', ['clone', '-q', bare, otherClone], { stdio: 'pipe' });
        execFileSync('git', ['-C', otherClone, 'config', 'user.email', 'other@example.com'], { stdio: 'pipe' });
        execFileSync('git', ['-C', otherClone, 'config', 'user.name', 'Other'], { stdio: 'pipe' });
        execFileSync('git', ['-C', otherClone, 'commit', '--allow-empty', '-q', '-m', 'remote-only'], { stdio: 'pipe' });
        execFileSync('git', ['-C', otherClone, 'push', '-q', 'origin', 'main'], { stdio: 'pipe' });
        // Refresh our remote-tracking ref so @{u} sees the new commit.
        git('fetch', '-q', 'origin', 'main');
        const result = await reverifyPredicate('ship-truth', { repoRoot, memoryDir });
        expect(result).toBe(true);
      } finally {
        rmSync(bare, { recursive: true, force: true });
        rmSync(otherClone, { recursive: true, force: true });
      }
    });

    it('unknown predicate type returns null', async () => {
      const result = await reverifyPredicate('something-undeclared', { repoRoot, memoryDir });
      expect(result).toBeNull();
    });
  });
});
