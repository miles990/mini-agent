import { describe, expect, it } from 'vitest';
import { autofixPrVerificationSection } from '../src/github.js';

describe('GitHub PR verification autorepair', () => {
  it('renames a completed Test plan section to Verification', () => {
    const body = [
      '## Summary',
      '- Fixes a runtime issue.',
      '',
      '## Test plan',
      '- [x] `pnpm typecheck` passed',
      '- [x] `pnpm test` passed',
      '',
      '## Falsifier',
      '- Watch production logs.',
    ].join('\n');

    const result = autofixPrVerificationSection(body);

    expect(result.changed).toBe(true);
    expect(result.body).toContain('## Verification\n- [x] `pnpm typecheck` passed');
    expect(result.body).not.toContain('## Test plan');
    expect(result.body).toContain('## Falsifier');
  });

  it('renames a completed Tests section with fenced command output', () => {
    const body = [
      '## Tests',
      '',
      '```',
      '$ pnpm vitest run tests/correction-gate.test.ts',
      'Test Files  2 passed (2)',
      '```',
    ].join('\n');

    const result = autofixPrVerificationSection(body);

    expect(result.changed).toBe(true);
    expect(result.body.startsWith('## Verification')).toBe(true);
  });

  it('renames completed acceptance checks with command evidence', () => {
    const result = autofixPrVerificationSection([
      '## Acceptance checks (all PASS)',
      '1. `node scripts/build-ai-trend-preview.mjs 2026-05-08` exits 0.',
      '2. Generated preview contains expected blocks.',
    ].join('\n'));

    expect(result.changed).toBe(true);
    expect(result.body.startsWith('## Verification')).toBe(true);
  });

  it('renames shell syntax test plans that parse cleanly', () => {
    const result = autofixPrVerificationSection([
      '## Test plan',
      '- [x] `zsh -n scripts/launchd-wrappers/github-ai-trend.sh` parses cleanly',
      '- [ ] Next cron run emits done marker',
    ].join('\n'));

    expect(result.changed).toBe(true);
    expect(result.body.startsWith('## Verification')).toBe(true);
  });

  it('promotes completed verification evidence from a PR comment', () => {
    const result = autofixPrVerificationSection('## Summary\n- Wrapper fallback fix.', [{
      body: [
        '**Self-review (cannot self-approve on GH) — ready for Alex merge.**',
        '',
        'Verified:',
        '- [x] `pnpm typecheck` passed',
        '- [x] `pnpm test` passed',
      ].join('\n'),
    }]);

    expect(result.changed).toBe(true);
    expect(result.reason).toBe('promoted completed verification evidence from PR comment');
    expect(result.body).toContain('## Verification');
    expect(result.body).toContain('- [x] `pnpm typecheck` passed');
    expect(result.body).not.toContain('cannot self-approve');
  });

  it('promotes forge isolated-worktree evidence into Verification', () => {
    const result = autofixPrVerificationSection([
      'Automated forge submission from /tmp/mini-agent-forge-1.',
      '',
      'Base: origin/main',
      'Branch: feature/example',
      '',
      'This branch was verified in an isolated worktree. The runtime checkout was not used as a merge target.',
    ].join('\n'));

    expect(result.changed).toBe(true);
    expect(result.reason).toBe('promoted forge isolated-worktree verification claim');
    expect(result.body).toContain('## Verification');
    expect(result.body).toContain('verified in an isolated worktree');
    expect(result.body).toContain('Runtime checkout was not used as a merge target');
  });

  it('does not fabricate verification when the test plan is still pending', () => {
    const body = [
      '## Test plan',
      '- [ ] Next production cycle should produce a signal',
      '- [ ] No false positives',
    ].join('\n');

    const result = autofixPrVerificationSection(body);

    expect(result.changed).toBe(false);
    expect(result.reason).toBe('test evidence section has no completed evidence');
  });

  it('does not change a body that already has Verification', () => {
    const body = '## Verification\n- [x] `pnpm test` passed\n';

    const result = autofixPrVerificationSection(body);

    expect(result.changed).toBe(false);
    expect(result.body).toBe(body);
  });

  it('replaces pending runtime autocorrect verification with completed preservation evidence', () => {
    const body = [
      '## Summary',
      '- autocorrected 1 commit(s) that were made on protected runtime/main',
      '- moved the change into an isolated worktree branch so review/merge/deploy can proceed normally',
      '',
      '## Verification',
      '- pending isolated PR review',
    ].join('\n');

    const result = autofixPrVerificationSection(body);

    expect(result.changed).toBe(true);
    expect(result.body).toContain('- [x] `git push -u origin <autocorrect-branch>` passed');
    expect(result.body).toContain('- [x] `git reset --hard origin/main` passed');
    expect(result.body).not.toContain('pending isolated PR review');
  });
});
