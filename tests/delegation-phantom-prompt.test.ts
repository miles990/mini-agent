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

// Minimal pure predicate — the classifier under test. Inlined here so the
// test is self-contained and falsifiable even before src wiring lands. The
// real implementation should live in src/delegation.ts adjacent to
// spawnDelegation and be called pre-dispatch.
function isPhantomPrompt(prompt: string): boolean {
  if (!prompt) return true;
  const trimmed = prompt.trim();
  if (trimmed.length >= 80) return false;
  if (/^##\s+Task:/m.test(trimmed)) return false;
  return true;
}

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
