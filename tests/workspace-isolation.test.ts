import { describe, expect, it } from 'vitest';

import { isCodePath, isSafeRuntimeBranch, parseDirtyPaths } from '../src/workspace-isolation.js';

describe('workspace isolation guard', () => {
  it('parses porcelain paths without losing renamed or untracked paths', () => {
    expect(parseDirtyPaths([
      ' M memory/inner-notes.md',
      'M  scripts/check-runtime-workspace.ts',
      '?? papers/',
      'A  src/workspace-isolation.ts',
    ].join('\n'))).toEqual([
      'memory/inner-notes.md',
      'scripts/check-runtime-workspace.ts',
      'papers/',
      'src/workspace-isolation.ts',
    ]);
  });

  it('treats source, config, and managed output paths as blocking dirt but allows memory dirt', () => {
    expect(isCodePath('src/auto-executor.ts')).toBe(true);
    expect(isCodePath('tests/auto-executor.test.ts')).toBe(true);
    expect(isCodePath('package.json')).toBe(true);
    expect(isCodePath('kuro-portfolio/ai-trend/index.html')).toBe(true);
    expect(isCodePath('knowledge-graph/')).toBe(true);
    expect(isCodePath('memory/inner-notes.md')).toBe(false);
    expect(isCodePath('papers/')).toBe(false);
  });

  it('only treats runtime/main as safe for the protected runtime checkout', () => {
    expect(isSafeRuntimeBranch('runtime/main')).toBe(true);
    expect(isSafeRuntimeBranch('main')).toBe(false);
    expect(isSafeRuntimeBranch('fix/example')).toBe(false);
    expect(isSafeRuntimeBranch(null)).toBe(false);
  });
});
