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
  fingerprint: string;
  rootCause: string;
  evidence: string[];
  probeCommands: string[];
  constraintTexture: {
    tension: string;
    bottleneck: string;
    wasteMode: string;
    convergenceRule: string;
  };
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
    .filter(stage => stage.status === 'blocked' || (snapshot.blockingStages.length === 0 && stage.status === 'warn'))
    .map(stage => diagnoseStage(stage, now));
}

function diagnoseStage(stage: AutonomyClosureStageResult, ts: string): AutonomyClosureDiagnosticCase {
  const base = diagnosticBase(stage, ts);
  if (stage.stage === 'pr-review-consensus') {
    const missingVerification = stage.evidence.some(line => /changes_requested|missing verification evidence|review feedback/i.test(line))
      || /require changes|arbitration/i.test(stage.summary);
    return {
      ...base,
      status: missingVerification ? 'mechanical-action' : 'diagnosed',
      rootCause: missingVerification
        ? 'PR review consensus is blocked by stale or missing machine-readable verification evidence.'
        : 'PR review consensus is blocked and needs GitHub lifecycle reconciliation.',
      evidence: stage.evidence,
      probeCommands: [
        'gh pr list --state open --json number,title,isDraft,mergeStateStatus,reviewDecision,reviewRequests --limit 50',
        'tail -n 20 memory/index/pr-review-claims.jsonl',
      ],
      constraintTexture: constraintTextureFor(stage, 'review consensus must be grounded in current PR state and machine-readable verification evidence'),
      mechanicalAction: missingVerification ? 'repair-pr-verification-evidence' : 'github-autopilot',
      fallbackTask: null,
    };
  }

  if (stage.stage === 'runtime-workspace') {
    return {
      ...base,
      status: 'fallback-task',
      rootCause: 'Protected runtime checkout has unclassified local changes.',
      evidence: stage.evidence,
      probeCommands: [
        'git status --short --branch',
        'git diff --name-only',
        'pnpm check:autonomy-closure -- --json',
      ],
      constraintTexture: constraintTextureFor(stage, 'runtime checkout is deploy/execution truth, not a development worktree'),
      mechanicalAction: 'none',
      fallbackTask: {
        title: 'P0 diagnostic: classify and drain runtime workspace dirt',
        verifyCommand: 'git status --short && pnpm check:autonomy-closure -- --json',
        acceptanceCriteria: 'Runtime checkout has no code dirt; generated/runtime artifacts are either shipped, moved to an isolated PR, or explicitly held with evidence.',
      },
    };
  }

  if (stage.stage === 'middleware-quality') {
    return {
      ...base,
      status: 'fallback-task',
      rootCause: 'Middleware has active failed work that is not yet resolved by the failure lifecycle.',
      evidence: stage.evidence,
      probeCommands: [
        'curl -sf http://127.0.0.1:3200/health',
        'curl -sf http://127.0.0.1:3200/tasks',
        'tail -n 30 memory/index/middleware-failure-classifications.jsonl',
      ],
      constraintTexture: constraintTextureFor(stage, 'failed delegated work must become a named bucket, a bounded retry envelope, a timed hold, or terminal telemetry'),
      mechanicalAction: 'none',
      fallbackTask: {
        title: 'P0 diagnostic: classify unresolved middleware failures',
        verifyCommand: 'pnpm check:autonomy-closure -- --json',
        acceptanceCriteria: 'Every active middleware failure is classified into a known bucket with one next action: bounded retry, lane recovery, provider hold, workspace repair, or terminal close.',
      },
    };
  }

  if (stage.stage === 'operational-efficiency') {
    return {
      ...base,
      status: 'fallback-task',
      rootCause: 'The system is spending cycles on advisory residue that has not been converted into bounded work or terminal state.',
      evidence: stage.evidence,
      probeCommands: [
        'pnpm check:autonomy-closure -- --json',
        'tail -n 50 memory/state/autonomy-closure-diagnostics.jsonl',
      ],
      constraintTexture: constraintTextureFor(stage, 'token should be spent on verified convergence, while repetitive advisory residue must be handled by code or state transitions'),
      mechanicalAction: 'none',
      fallbackTask: {
        title: 'P1 diagnostic: close operational-efficiency residue',
        verifyCommand: 'pnpm check:autonomy-closure -- --json',
        acceptanceCriteria: 'Repeated advisory signals are either resolved, transformed into small verified tasks, or suppressed by a falsifiable terminal condition.',
      },
    };
  }

  if (stage.stage === 'memory-state-truth') {
    return {
      ...base,
      status: 'fallback-task',
      rootCause: 'External file memory is not in a durable parseable state.',
      evidence: stage.evidence,
      probeCommands: [
        'git -C "$MINI_AGENT_MEMORY_DIR" status --short',
        'pnpm check:autonomy-closure -- --json',
      ],
      constraintTexture: constraintTextureFor(stage, 'memory may change often, but curated state must be parseable, snapshotted, and replayable'),
      mechanicalAction: 'none',
      fallbackTask: {
        title: 'P0 diagnostic: restore external memory state truth',
        verifyCommand: 'git -C "$MINI_AGENT_MEMORY_DIR" status --short && pnpm check:autonomy-closure -- --json',
        acceptanceCriteria: 'Critical JSONL is parseable and curated memory changes are either snapshotted or explicitly ignored as high-frequency telemetry.',
      },
    };
  }

  if (stage.stage === 'design-governance') {
    return {
      ...base,
      status: 'fallback-task',
      rootCause: 'High-risk autonomous work lacks a versioned design artifact or executable invariant plan.',
      evidence: stage.evidence,
      probeCommands: [
        'pnpm check:autonomy-closure -- --json',
        'find "$MINI_AGENT_MEMORY_DIR/proposals/design-artifacts" -maxdepth 1 -type f -name "*.md" 2>/dev/null | sort | tail -n 20',
        'rg -n "design_governance_required|design-depth|Constraint Texture|```mermaid" "$MINI_AGENT_MEMORY_DIR" src tests',
      ],
      constraintTexture: constraintTextureFor(stage, 'high-risk work must externalize the intended data flow, state machine, failure path, tests, and backtest before implementation proceeds'),
      mechanicalAction: 'none',
      fallbackTask: {
        title: 'P1 diagnostic: create missing design-governance artifact',
        verifyCommand: 'pnpm check:autonomy-closure -- --json',
        acceptanceCriteria: 'Every high-risk active implementation task has a design artifact or an explicit trivial exemption; artifacts include Constraint Texture, Mermaid data flow/state/operator diagrams, failure path, acceptance/falsifier, test plan, review plan, and effect backtest.',
      },
    };
  }

  return {
    ...base,
    status: 'fallback-task',
    rootCause: `${stage.stage} is blocked and has no deterministic repair probe yet.`,
    evidence: stage.evidence,
    probeCommands: [
      'pnpm check:autonomy-closure -- --json',
      `rg -n "${escapeForRg(stage.stage)}|${escapeForRg(stage.summary.slice(0, 40))}" memory src tests`,
    ],
    constraintTexture: constraintTextureFor(stage, 'unknown closure failures must first become observable, fingerprinted, and bounded before retry'),
    mechanicalAction: 'none',
    fallbackTask: {
      title: `P0 diagnostic: repair ${stage.stage}`,
      verifyCommand: 'pnpm check:autonomy-closure -- --json',
      acceptanceCriteria: `${stage.summary} ${stage.repair ?? ''}`.trim(),
    },
  };
}

function diagnosticBase(stage: AutonomyClosureStageResult, ts: string): Pick<AutonomyClosureDiagnosticCase, 'id' | 'ts' | 'stage' | 'fingerprint'> {
  const fingerprint = diagnosticFingerprint(stage);
  return {
    id: `acd-${Date.parse(ts)}-${stage.stage}-${fingerprint.slice(0, 10)}`,
    ts,
    stage: stage.stage,
    fingerprint,
  };
}

export function diagnosticFingerprint(stage: AutonomyClosureStageResult): string {
  const evidenceKey = stage.evidence
    .map(line => line.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<ts>'))
    .slice(0, 5)
    .join('|');
  return `${stage.stage}:${stage.status}:${stableSlug(stage.summary)}:${stableSlug(evidenceKey)}`;
}

function constraintTextureFor(stage: AutonomyClosureStageResult, convergenceRule: string): AutonomyClosureDiagnosticCase['constraintTexture'] {
  return {
    tension: `${stage.stage}:${stage.status}`,
    bottleneck: stage.summary,
    wasteMode: stage.status === 'blocked'
      ? 'blocked cycles repeat unless a mechanical action or bounded fallback task changes state'
      : 'warning cycles degrade efficiency unless converted into verified terminal state',
    convergenceRule,
  };
}

function stableSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '<url>')
    .replace(/\btask-[a-z0-9-]+\b/g, 'task-<id>')
    .replace(/#[0-9]+/g, '#n')
    .replace(/\b[0-9a-f]{7,40}\b/g, '<sha>')
    .replace(/\b\d+\b/g, '<n>')
    .replace(/[^a-z0-9#<>|:-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 160);
}

function escapeForRg(value: string): string {
  return value.replace(/[\\"]/g, '\\$&');
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
