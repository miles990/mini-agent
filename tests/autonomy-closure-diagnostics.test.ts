import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  diagnoseAndRepairAutonomyClosure,
  diagnoseAutonomyClosure,
  diagnosticFingerprint,
} from '../src/autonomy-closure-diagnostics.js';
import type { AutonomyClosureSnapshot } from '../src/autonomy-closure-health.js';

let tmpDir: string | null = null;

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  tmpDir = null;
});

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

  it('diagnoses missing design artifacts as a bounded design-governance task', () => {
    const cases = diagnoseAutonomyClosure(snapshotWithStage({
      stage: 'design-governance',
      status: 'blocked',
      summary: '1 missing and 0 incomplete design artifact(s)',
      evidence: ['idx-design missing design artifact: high-risk summary touches autonomous workflow/data/state infrastructure'],
      repair: 'Create design artifact before implementation.',
    }));

    expect(cases[0]).toEqual(expect.objectContaining({
      stage: 'design-governance',
      rootCause: expect.stringContaining('High-risk autonomous work lacks'),
      probeCommands: expect.arrayContaining([
        expect.stringContaining('proposals/design-artifacts'),
      ]),
      fallbackTask: expect.objectContaining({
        title: 'P1 diagnostic: create missing design-governance artifact',
        acceptanceCriteria: expect.stringContaining('Mermaid data flow/state/operator diagrams'),
      }),
    }));
  });

  it('routes unsnapshotted curated memory through a mechanical snapshot action', () => {
    const cases = diagnoseAutonomyClosure(warningSnapshotWithStage({
      stage: 'memory-state-truth',
      status: 'warn',
      summary: '1 curated memory git change(s) not snapshotted',
      evidence: [' M handoffs/active.md (curated-knowledge)'],
      repair: 'Commit curated memory changes locally; keep high-frequency telemetry ignored.',
    }));

    expect(cases[0]).toEqual(expect.objectContaining({
      stage: 'memory-state-truth',
      status: 'mechanical-action',
      mechanicalAction: 'snapshot-curated-memory',
      fallbackTask: null,
      probeCommands: expect.arrayContaining([
        'git -C "$MINI_AGENT_MEMORY_DIR" status --short',
      ]),
    }));
  });

  it('recognizes unsnapshotted curated memory from evidence even when summary wording changes', () => {
    const cases = diagnoseAutonomyClosure(warningSnapshotWithStage({
      stage: 'memory-state-truth',
      status: 'warn',
      summary: 'external memory has durable edits waiting for local snapshot',
      evidence: [' M handoffs/active.md (curated-knowledge)'],
      repair: 'Commit curated memory changes locally; keep high-frequency telemetry ignored.',
    }));

    expect(cases[0]).toEqual(expect.objectContaining({
      stage: 'memory-state-truth',
      status: 'mechanical-action',
      mechanicalAction: 'snapshot-curated-memory',
      fallbackTask: null,
    }));
  });

  it('self-heals curated memory dirt while leaving high-frequency telemetry local', async () => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-autonomy-diagnostics-'));
    initGitMemory(tmpDir);
    mkdirSync(path.join(tmpDir, 'state'), { recursive: true });
    writeFileSync(path.join(tmpDir, 'inner-notes.md'), '# Notes\n', 'utf-8');
    writeFileSync(path.join(tmpDir, 'state', 'autonomy-closure-diagnostics.jsonl'), '{"telemetry":true}\n', 'utf-8');

    const result = await diagnoseAndRepairAutonomyClosure(tmpDir, warningSnapshotWithStage({
      stage: 'memory-state-truth',
      status: 'warn',
      summary: '1 curated memory git change(s) not snapshotted',
      evidence: [' M inner-notes.md (curated-knowledge)'],
      repair: 'Commit curated memory changes locally; keep high-frequency telemetry ignored.',
    }));
    const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
      cwd: tmpDir,
      encoding: 'utf-8',
    });

    expect(result.actionsRun).toEqual(['snapshot-curated-memory']);
    expect(status).not.toContain('inner-notes.md');
    expect(status).toContain('state/autonomy-closure-diagnostics.jsonl');
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

function warningSnapshotWithStage(stage: AutonomyClosureSnapshot['stages'][number]): AutonomyClosureSnapshot {
  return {
    ...snapshotWithStage(stage),
    status: 'degraded',
    blockingStages: [],
    warningStages: [stage.stage],
  };
}

function initGitMemory(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' });
}
