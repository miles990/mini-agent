import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '..');

function hook(name: string): string {
  return fs.readFileSync(path.join(repoRoot, '.githooks', name), 'utf-8');
}

describe('git hooks', () => {
  it('pre-commit skips runtime guard when a fresh worktree has no local tsx binary', () => {
    const script = hook('pre-commit');
    expect(script).toContain('node_modules/.bin/tsx');
    expect(script).toContain("run 'pnpm install'");
    expect(script.indexOf('node_modules/.bin/tsx')).toBeLessThan(script.indexOf('pnpm exec tsx'));
  });

  it('pre-push skips PR lifecycle guard when a fresh worktree has no local tsx binary', () => {
    const script = hook('pre-push');
    expect(script).toContain('node_modules/.bin/tsx');
    expect(script).toContain("run 'pnpm install'");
    expect(script.indexOf('node_modules/.bin/tsx')).toBeLessThan(script.indexOf('pnpm exec tsx'));
  });
});
