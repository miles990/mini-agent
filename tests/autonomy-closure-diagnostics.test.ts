import { describe, expect, it } from 'vitest';
import { diagnoseAutonomyClosure } from '../src/autonomy-closure-diagnostics.js';
import type { AutonomyClosureSnapshot } from '../src/autonomy-closure-health.js';

describe('autonomy closure diagnostics', () => {
  it('routes PR review consensus blockers through mechanical verification repair first', () => {
    const cases = diagnoseAutonomyClosure(snapshotWithStage({
      stage: 'pr-review-consensus',
      status: 'blocked',
      summary: '1 PR consensus result(s) require changes or arbitration',
      evidence: ['PR #334: changes_requested (at least one reviewer requested changes)'],
      repair: 'Apply review feedback.',
    }));

    expect(cases).toContainEqual(expect.objectContaining({
      stage: 'pr-review-consensus',
      rootCause: expect.stringContaining('machine-readable verification evidence'),
      mechanicalAction: 'repair-pr-verification-evidence',
      fallbackTask: null,
    }));
  });

  it('creates a diagnostic fallback case for runtime dirt instead of handing raw repair to the LLM', () => {
    const cases = diagnoseAutonomyClosure(snapshotWithStage({
      stage: 'runtime-workspace',
      status: 'blocked',
      summary: 'protected runtime checkout is not clean enough for autonomous work',
      evidence: ['runtime workspace 有未整理變更 — src/github.ts'],
      repair: 'Run runtime workspace autocorrect.',
    }));

    expect(cases[0]).toEqual(expect.objectContaining({
      stage: 'runtime-workspace',
      mechanicalAction: 'none',
      fallbackTask: expect.objectContaining({
        title: 'P0 diagnostic: classify and drain runtime workspace dirt',
      }),
    }));
  });
});

function snapshotWithStage(stage: AutonomyClosureSnapshot['stages'][number]): AutonomyClosureSnapshot {
  return {
    status: 'blocked',
    score: 78,
    stages: [stage],
    blockingStages: [stage.stage],
    warningStages: [],
    recommendedTask: null,
    correction: {
      score: 100,
      needsCorrection: false,
      breakdown: {
        fulfillment: { value: 1, weight: 40, contribution: 40, detail: 'ok' },
        responsiveness: { value: 1, weight: 35, contribution: 35, detail: 'ok' },
        quality: { value: 1, weight: 25, contribution: 25, detail: 'ok' },
      },
      guidance: [],
      anomalies: [],
      reasons: [],
      suppressedActions: [],
      shipTruth: { repoPresent: false, branch: null, headSha: null, ahead: 0, behind: 0, dirty: false, dirtyPaths: [], state: 'unknown' },
      acknowledgedHolds: [],
    },
  };
}
