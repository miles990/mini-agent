import { describe, expect, it } from 'vitest';
import { diagnoseAutonomyClosure, diagnosticFingerprint } from '../src/autonomy-closure-diagnostics.js';
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
      fingerprint: expect.stringContaining('pr-review-consensus:blocked'),
      probeCommands: expect.arrayContaining([
        expect.stringContaining('gh pr list'),
      ]),
      constraintTexture: expect.objectContaining({
        convergenceRule: expect.stringContaining('machine-readable verification evidence'),
      }),
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
      probeCommands: expect.arrayContaining([
        'git status --short --branch',
      ]),
      fallbackTask: expect.objectContaining({
        title: 'P0 diagnostic: classify and drain runtime workspace dirt',
      }),
    }));
  });

  it('diagnoses warning-only degraded states before they become blockers', () => {
    const cases = diagnoseAutonomyClosure({
      ...snapshotWithStage({
        stage: 'operational-efficiency',
        status: 'warn',
        summary: '1 efficiency signal(s) need autonomous convergence',
        evidence: ['failureBuckets=max-turns:1'],
        repair: 'Convert advisory signals into bounded autonomous work.',
      }),
      status: 'degraded',
      blockingStages: [],
      warningStages: ['operational-efficiency'],
    });

    expect(cases).toHaveLength(1);
    expect(cases[0]).toEqual(expect.objectContaining({
      stage: 'operational-efficiency',
      status: 'fallback-task',
      rootCause: expect.stringContaining('advisory residue'),
      fallbackTask: expect.objectContaining({
        title: 'P1 diagnostic: close operational-efficiency residue',
      }),
    }));
  });

  it('normalizes timestamps and ids into stable fingerprints for recurrence detection', () => {
    const first = diagnosticFingerprint({
      stage: 'middleware-quality',
      status: 'blocked',
      summary: 'middleware quality unhealthy: 42 task(s), 8 failed',
      evidence: ['failedTask=task-1778289376823-8w agent-brain failed 2026-05-09T01:20:00.000Z'],
    });
    const second = diagnosticFingerprint({
      stage: 'middleware-quality',
      status: 'blocked',
      summary: 'middleware quality unhealthy: 43 task(s), 9 failed',
      evidence: ['failedTask=task-1778289999999-xy agent-brain failed 2026-05-09T01:30:00.000Z'],
    });

    expect(first).toBe(second);
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
