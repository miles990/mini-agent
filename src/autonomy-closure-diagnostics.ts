import fs from 'node:fs';
import path from 'node:path';
import {
  type AutonomyClosureSnapshot,
  type AutonomyClosureStage,
  type AutonomyClosureStageResult,
} from './autonomy-closure-health.js';
import { autoRepairPrVerificationEvidence, githubAutoActions } from './github.js';
import { slog } from './utils.js';

export type AutonomyClosureMechanicalAction =
  | 'github-autopilot'
  | 'repair-pr-verification-evidence'
  | 'none';

export interface AutonomyClosureDiagnosticCase {
  id: string;
  ts: string;
  stage: AutonomyClosureStage;
  status: 'diagnosed' | 'mechanical-action' | 'fallback-task';
  rootCause: string;
  evidence: string[];
  mechanicalAction: AutonomyClosureMechanicalAction;
  fallbackTask: {
    title: string;
    verifyCommand: string;
    acceptanceCriteria: string;
  } | null;
}

export interface AutonomyClosureDiagnosticResult {
  cases: AutonomyClosureDiagnosticCase[];
  actionsRun: AutonomyClosureMechanicalAction[];
}

export async function diagnoseAndRepairAutonomyClosure(
  memoryDir: string,
  snapshot: AutonomyClosureSnapshot,
): Promise<AutonomyClosureDiagnosticResult> {
  const cases = diagnoseAutonomyClosure(snapshot);
  const actionsRun: AutonomyClosureMechanicalAction[] = [];

  for (const diagnostic of cases) {
    if (diagnostic.mechanicalAction === 'repair-pr-verification-evidence') {
      await autoRepairPrVerificationEvidence();
      actionsRun.push(diagnostic.mechanicalAction);
      continue;
    }
    if (diagnostic.mechanicalAction === 'github-autopilot') {
      await githubAutoActions();
      actionsRun.push(diagnostic.mechanicalAction);
      continue;
    }
  }

  appendDiagnosticCases(memoryDir, cases, { actionsRun });
  if (cases.length > 0) {
    const fallbackCount = cases.filter(c => c.fallbackTask).length;
    slog('AUTONOMY', `diagnosed ${cases.length} closure blocker(s); actions=${actionsRun.join(',') || 'none'} fallbackTasks=${fallbackCount}`);
  }
  return { cases, actionsRun };
}

export function diagnoseAutonomyClosure(snapshot: AutonomyClosureSnapshot): AutonomyClosureDiagnosticCase[] {
  const now = new Date().toISOString();
  return snapshot.stages
    .filter(stage => stage.status === 'blocked')
    .map(stage => diagnoseStage(stage, now));
}

function diagnoseStage(stage: AutonomyClosureStageResult, ts: string): AutonomyClosureDiagnosticCase {
  if (stage.stage === 'pr-review-consensus') {
    const missingVerification = stage.evidence.some(line => /changes_requested|missing verification evidence|review feedback/i.test(line))
      || /require changes|arbitration/i.test(stage.summary);
    return {
      id: `acd-${Date.parse(ts)}-${stage.stage}`,
      ts,
      stage: stage.stage,
      status: missingVerification ? 'mechanical-action' : 'diagnosed',
      rootCause: missingVerification
        ? 'PR review consensus is blocked by stale or missing machine-readable verification evidence.'
        : 'PR review consensus is blocked and needs GitHub lifecycle reconciliation.',
      evidence: stage.evidence,
      mechanicalAction: missingVerification ? 'repair-pr-verification-evidence' : 'github-autopilot',
      fallbackTask: null,
    };
  }

  if (stage.stage === 'runtime-workspace') {
    return {
      id: `acd-${Date.parse(ts)}-${stage.stage}`,
      ts,
      stage: stage.stage,
      status: 'fallback-task',
      rootCause: 'Protected runtime checkout has unclassified local changes.',
      evidence: stage.evidence,
      mechanicalAction: 'none',
      fallbackTask: {
        title: 'P0 diagnostic: classify and drain runtime workspace dirt',
        verifyCommand: 'git status --short && pnpm check:autonomy-closure -- --json',
        acceptanceCriteria: 'Runtime checkout has no code dirt; generated/runtime artifacts are either shipped, moved to an isolated PR, or explicitly held with evidence.',
      },
    };
  }

  return {
    id: `acd-${Date.parse(ts)}-${stage.stage}`,
    ts,
    stage: stage.stage,
    status: 'fallback-task',
    rootCause: `${stage.stage} is blocked and has no deterministic repair probe yet.`,
    evidence: stage.evidence,
    mechanicalAction: 'none',
    fallbackTask: {
      title: `P0 diagnostic: repair ${stage.stage}`,
      verifyCommand: 'pnpm check:autonomy-closure -- --json',
      acceptanceCriteria: `${stage.summary} ${stage.repair ?? ''}`.trim(),
    },
  };
}

function appendDiagnosticCases(
  memoryDir: string,
  cases: AutonomyClosureDiagnosticCase[],
  outcome: Pick<AutonomyClosureDiagnosticResult, 'actionsRun'>,
): void {
  if (cases.length === 0) return;
  const file = path.join(memoryDir, 'state', 'autonomy-closure-diagnostics.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = cases.map(diagnostic => JSON.stringify({
    ...diagnostic,
    actionsRun: outcome.actionsRun,
  }));
  fs.appendFileSync(file, lines.join('\n') + '\n', 'utf-8');
}
