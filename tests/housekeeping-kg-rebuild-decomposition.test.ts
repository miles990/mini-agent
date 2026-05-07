/**
 * Regression test for issue #277 — Shell-worker wall-clock kills KG-rebuild chain.
 *
 * Symptom: agent-middleware shell-worker tasks for KG-rebuild were recurringly
 * killed at the 1800s wall-clock cap because housekeeping.ts:851 chained 7
 * LLM-calling `pnpm tsx` scripts with `&&` into a single shell delegation.
 *
 * Fix: decompose into 7 sequential delegations so each step gets its own
 * wall-clock + progressTimeout budget; failures isolate to the offending step.
 *
 * This test pins the decomposed structure so the regression cannot re-land
 * silently. It does NOT exercise the live middleware — it just asserts the
 * static shape of the exported `KG_REBUILD_STEPS` array.
 */
import { describe, expect, it } from 'vitest';
import { KG_REBUILD_STEPS } from '../src/housekeeping.js';

describe('KG rebuild decomposition (issue #277)', () => {
  it('exposes the full 7-step pipeline', () => {
    expect(KG_REBUILD_STEPS).toHaveLength(7);
  });

  it('preserves the original pipeline order', () => {
    const labels = KG_REBUILD_STEPS.map(s => s.label);
    expect(labels).toEqual([
      'extract-chunks',
      'extract-entities',
      'extract-edges',
      'build-cooccurrence',
      'build-frontmatter-edges',
      'detect-conflicts',
      'viz',
    ]);
  });

  it('keeps each step a SINGLE shell command — no `&&` re-chaining of pnpm tsx', () => {
    // This is the core regression assertion. If anyone re-collapses the chain
    // (e.g. by joining steps with " && "), this test must fail.
    for (const step of KG_REBUILD_STEPS) {
      const tsxCount = (step.cmd.match(/pnpm\s+tsx\s+/g) ?? []).length;
      expect(tsxCount, `step "${step.label}" should invoke at most one pnpm tsx`).toBeLessThanOrEqual(1);
      expect(step.cmd, `step "${step.label}" should not chain commands with &&`).not.toMatch(/&&/);
    }
  });

  it('every step references the kg-* extractor script implied by its label', () => {
    for (const step of KG_REBUILD_STEPS) {
      expect(step.cmd, `step "${step.label}" should call its kg-${step.label} script`)
        .toContain(`scripts/kg-${step.label}.ts`);
    }
  });

  it('every step carries a non-empty acceptance descriptor', () => {
    for (const step of KG_REBUILD_STEPS) {
      expect(step.acceptance.length, `step "${step.label}" needs an acceptance string`).toBeGreaterThan(0);
    }
  });

  it('extract-entities and extract-edges keep the --limit 100 guard', () => {
    const entities = KG_REBUILD_STEPS.find(s => s.label === 'extract-entities');
    const edges = KG_REBUILD_STEPS.find(s => s.label === 'extract-edges');
    expect(entities?.cmd).toContain('--limit 100');
    expect(edges?.cmd).toContain('--limit 100');
  });
});
