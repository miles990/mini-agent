/**
 * Regression test for issue #141 — phantom-prompt + masked-forge-error.
 *
 * Documents the Layer 1 gap: `spawnDelegation` accepts a 24-char imperative
 * `Update src/agent.ts` because it lacks an envelope check. Such prompts come
 * from <kuro:delegate> parse anomalies and trigger 4× retries (fail-ejkd7t
 * shape, 6 cycles of P0 stale pressure on 2026-05-06).
 *
 * The proposed classifier `phantom_prompt:short_imperative` rejects prompts
 * that lack the `## Task:` envelope AND are shorter than 80 chars.
 *
 * This test is intentionally written against a not-yet-shipped helper
 * `isPhantomPrompt` so the failing test surfaces the gap. Implementation
 * lives in src/delegation.ts (or a dedicated guard module) once landed.
 */
import { describe, expect, it } from 'vitest';
import { isPhantomPrompt, validateShellPrompt } from '../src/delegation.js';

describe('phantom-prompt classifier (issue #141 layer 1)', () => {
  it('rejects the exact fail-ejkd7t signature', () => {
    expect(isPhantomPrompt('Update src/agent.ts')).toBe(true);
  });

  it('rejects empty prompts', () => {
    expect(isPhantomPrompt('')).toBe(true);
    expect(isPhantomPrompt('   ')).toBe(true);
  });

  it('rejects short imperatives without envelope', () => {
    expect(isPhantomPrompt('fix the bug')).toBe(true);
    expect(isPhantomPrompt('refactor delegation.ts')).toBe(true);
    expect(isPhantomPrompt('do stuff')).toBe(true);
  });

  it('accepts proper envelope even when short', () => {
    const enveloped = '## Task: x\n\n## Instructions\ny';
    expect(isPhantomPrompt(enveloped)).toBe(false);
  });

  it('accepts long-form prompts without envelope (>=80 chars)', () => {
    const longPrompt =
      'Please investigate the regression where the soft-gate skip path stays silent on null decision blocks and propose an instrumentation patch.';
    expect(longPrompt.length).toBeGreaterThanOrEqual(80);
    expect(isPhantomPrompt(longPrompt)).toBe(false);
  });

  it('accepts envelope at any length', () => {
    expect(
      isPhantomPrompt('## Task: ship\n\n## Instructions\nedit forge.ts:62 to surface stderr'),
    ).toBe(false);
  });
});

describe('shell prompt boundary guard (issue #581)', () => {
  it('accepts executable shell one-liners and comments', () => {
    expect(validateShellPrompt('cd /repo && pnpm typecheck && pnpm test')).toEqual({ ok: true });
    expect(validateShellPrompt('# progress checkpoint\npnpm tsx scripts/kg-extract-entities.ts --write --limit 100')).toEqual({ ok: true });
  });

  it('rejects bounded-shell-probe markdown envelopes before bash sees them', () => {
    const prompt = [
      '## Retry Task: Retry middleware shell lane with bounded probes after timeout',
      'Task ID: idx-af45d4ff-b34f-478e-a680-f3fe33bdaaf3',
      'Strategy: bounded-shell-probe',
      '',
      'Break the failed work into bounded probes.',
      '',
      'cd /Users/user/Workspace/mini-agent && pnpm tsx scripts/kg-extract-entities.ts --write --limit 100',
    ].join('\n');

    expect(validateShellPrompt(prompt)).toEqual(expect.objectContaining({
      ok: false,
      reason: 'markdown_heading',
    }));
  });
});
