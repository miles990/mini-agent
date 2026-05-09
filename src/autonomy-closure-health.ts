import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { evaluateCorrectionGate, type CorrectionGateSnapshot } from './correction-gate.js';
import { createTask, queryMemoryIndexSync, updateMemoryIndexEntry, type MemoryIndexEntry } from './memory-index.js';
import { evaluatePrReviewConsensus, parsePrReviewHandoffs, readPrReviewClaimsSync } from './pr-review-runner.js';
import { evaluateRuntimeMemoryPlacement } from './memory-paths.js';
import { eventBus } from './event-bus.js';
import { readTestHealthSnapshot, summarizeTestHealth } from './test-health-autopilot.js';
import { evaluatePrClosureGaps, readOpenPrSnapshot } from './pr-autopilot.js';
import { evaluateKgExternalMemoryTruth, evaluateMemoryStateTruth } from './external-memory-health.js';
import { evaluateMiddlewareQuality } from './middleware-quality-health.js';
import { readClassifiedMiddlewareTaskIds } from './middleware-failure-self-healing.js';
import { getFeature } from './features.js';
import { evaluatePublicWriteIdentity } from './public-write-identity.js';

export type AutonomyClosureStage =
  | 'runtime-workspace'
  | 'task-execution'
  | 'test-health'
  | 'issue-autopilot'
  | 'pr-review-consensus'
  | 'public-write-identity'
  | 'ship-and-deploy'
  | 'self-improvement'
  | 'memory-context'
  | 'memory-state-truth'
  | 'kg-context-fabric'
  | 'middleware-quality'
  | 'operational-efficiency';

export type AutonomyClosureStageStatus = 'ok' | 'warn' | 'blocked';
export type AutonomyClosureStatus = 'healthy' | 'degraded' | 'blocked';

export interface AutonomyClosureStageResult {
  stage: AutonomyClosureStage;
  status: AutonomyClosureStageStatus;
  summary: string;
  evidence: string[];
  repair?: string;
}

export interface AutonomyClosureSnapshot {
  status: AutonomyClosureStatus;
  score: number;
  stages: AutonomyClosureStageResult[];
  blockingStages: AutonomyClosureStage[];
  warningStages: AutonomyClosureStage[];
  recommendedTask: {
    priority: 0 | 1;
    title: string;
    verifyCommand: string;
    acceptanceCriteria: string;
  } | null;
  correction: CorrectionGateSnapshot;
}

export interface AutonomyClosureOptions {
  repoRoot?: string;
  now?: Date;
}

const ACTIVE_STATUSES = ['pending', 'in_progress', 'needs-decomposition', 'blocked', 'hold'];
const AUTONOMY_CLOSURE_ORIGIN = 'autonomy-closure';

export function evaluateAutonomyClosure(
  memoryDir: string,
  options: AutonomyClosureOptions = {},
): AutonomyClosureSnapshot {
  const repoRoot = options.repoRoot ?? process.cwd();
  const correction = evaluateCorrectionGate(memoryDir, repoRoot);
  const openTasks = queryMemoryIndexSync(memoryDir, { type: ['task'], status: ACTIVE_STATUSES })
    .filter(task => !isAutonomyClosureTask(task));
  const kgStage = kgContextFabricStage(memoryDir, options.now ?? new Date());
  const middlewareStage = middlewareQualityStage(memoryDir, options.now ?? new Date());
  const stages: AutonomyClosureStageResult[] = [
    runtimeWorkspaceStage(correction),
    taskExecutionStage(openTasks),
    testHealthStage(memoryDir),
    issueAutopilotStage(openTasks, options.now ?? new Date()),
    prReviewConsensusStage(memoryDir, options.now ?? new Date()),
    publicWriteIdentityStage(memoryDir),
    shipAndDeployStage(correction),
    selfImprovementStage(openTasks),
    memoryContextStage(memoryDir, repoRoot),
    memoryStateTruthStage(memoryDir, repoRoot),
    kgStage,
    middlewareStage,
    operationalEfficiencyStage(correction, kgStage, middlewareStage),
  ];

  const blockingStages = stages.filter(s => s.status === 'blocked').map(s => s.stage);
  const warningStages = stages.filter(s => s.status === 'warn').map(s => s.stage);
  const penalty = stages.reduce((sum, stage) => {
    if (stage.status === 'blocked') return sum + 22;
    if (stage.status === 'warn') return sum + 8;
    return sum;
  }, 0);
  const score = Math.max(0, Math.min(100, 100 - penalty));
  const status: AutonomyClosureStatus = blockingStages.length > 0
    ? 'blocked'
    : warningStages.length > 0 ? 'degraded' : 'healthy';

  return {
    status,
    score,
    stages,
    blockingStages,
    warningStages,
    recommendedTask: buildRecommendedTask(stages, status),
    correction,
  };
}

function publicWriteIdentityStage(memoryDir: string): AutonomyClosureStageResult {
  const snapshot = evaluatePublicWriteIdentity(memoryDir);
  if (snapshot.status === 'blocked') {
    return {
      stage: 'public-write-identity',
      status: 'blocked',
      summary: snapshot.summary,
      evidence: snapshot.openMismatches.slice(0, 5).map(record =>
        `${record.service} ${record.action} ${record.subject}: expected=${record.expectedActor} actual=${record.actualActor} source=${record.source}`,
      ),
      repair: 'Stop that outbound channel until it uses Kuro-owned credentials; record a resolved provenance entry only after the account boundary is fixed.',
    };
  }
  if (snapshot.status === 'warn') {
    return {
      stage: 'public-write-identity',
      status: 'warn',
      summary: snapshot.summary,
      evidence: snapshot.unknownActors.slice(0, 5).map(record =>
        `${record.service} ${record.action} ${record.subject}: actor unverified source=${record.source}`,
      ),
      repair: 'Record the actual public actor after each outbound write, or use a managed tool path that records it automatically.',
    };
  }
  return {
    stage: 'public-write-identity',
    status: 'ok',
    summary: snapshot.summary,
    evidence: snapshot.recent.slice(0, 5).map(record =>
      `${record.service} ${record.action} ${record.subject}: ${record.actualActor}`,
    ),
  };
}

export async function ensureAutonomyClosureTask(
  memoryDir: string,
  snapshot = evaluateAutonomyClosure(memoryDir),
): Promise<MemoryIndexEntry | null> {
  if (snapshot.status === 'healthy') {
    await closeResolvedAutonomyClosureTasks(memoryDir, snapshot);
    return null;
  }

  const existing = queryMemoryIndexSync(memoryDir, {
    type: ['task'],
    status: ACTIVE_STATUSES,
  }).find(isAutonomyClosureTask);

  const recommendation = snapshot.recommendedTask;
  if (!recommendation) return null;

  if (snapshot.correction.needsCorrection && !recommendation.title.includes('operational-efficiency')) {
    return null;
  }

  if (existing) {
    const existingPayload = (existing.payload ?? {}) as Record<string, unknown>;
    const shouldReleaseStaleHold = existing.status === 'hold' && !existingPayload.holdCondition;
    const refreshed = await updateMemoryIndexEntry(memoryDir, existing.id, {
      ...(shouldReleaseStaleHold ? { status: 'pending' } : {}),
      summary: recommendation.title,
      payload: {
        ...existingPayload,
        origin: AUTONOMY_CLOSURE_ORIGIN,
        priority: recommendation.priority,
        assignee: 'kuro',
        verify_command: recommendation.verifyCommand,
        acceptance_criteria: recommendation.acceptanceCriteria,
        closure_status: snapshot.status,
        closure_score: snapshot.score,
        blocking_stages: snapshot.blockingStages,
        warning_stages: snapshot.warningStages,
        closure_refreshed_at: new Date().toISOString(),
        ...(shouldReleaseStaleHold ? { closure_unheld_reason: 'refreshed stale autonomy closure hold without unblock condition' } : {}),
      },
      tags: ['autonomy-closure', snapshot.status],
    });
    return refreshed ?? existing;
  }

  const task = await createTask(memoryDir, {
    title: recommendation.title,
    origin: 'scheduler',
    priority: recommendation.priority,
    assignee: 'kuro',
    verify_command: recommendation.verifyCommand,
    acceptance_criteria: recommendation.acceptanceCriteria,
  });

  const enriched = await updateMemoryIndexEntry(memoryDir, task.id, {
    payload: {
      ...((task.payload ?? {}) as Record<string, unknown>),
      origin: AUTONOMY_CLOSURE_ORIGIN,
      closure_status: snapshot.status,
      closure_score: snapshot.score,
      blocking_stages: snapshot.blockingStages,
      warning_stages: snapshot.warningStages,
      closure_started_at: new Date().toISOString(),
    },
    tags: ['autonomy-closure', snapshot.status],
  });

  eventBus.emit('action:task', {
    event: 'autonomy-closure-repair-queued',
    taskId: task.id,
    status: snapshot.status,
    score: snapshot.score,
    blockingStages: snapshot.blockingStages,
    warningStages: snapshot.warningStages,
  });

  return enriched ?? task;
}

export async function closeResolvedAutonomyClosureTasks(
  memoryDir: string,
  snapshot = evaluateAutonomyClosure(memoryDir),
): Promise<MemoryIndexEntry[]> {
  if (snapshot.status !== 'healthy') return [];
  const tasks = queryMemoryIndexSync(memoryDir, {
    type: ['task'],
    status: ACTIVE_STATUSES,
  }).filter(isAutonomyClosureTask);

  const closed: MemoryIndexEntry[] = [];
  for (const task of tasks) {
    const updated = await updateMemoryIndexEntry(memoryDir, task.id, {
      status: 'completed',
      payload: {
        ...((task.payload ?? {}) as Record<string, unknown>),
        closure_resolved_at: new Date().toISOString(),
        closure_final_score: snapshot.score,
      },
    });
    if (updated) closed.push(updated);
  }
  return closed;
}

export function isAutonomyClosureTask(entry: Pick<MemoryIndexEntry, 'summary' | 'payload' | 'tags'>): boolean {
  const payload = (entry.payload ?? {}) as Record<string, unknown>;
  return payload.origin === AUTONOMY_CLOSURE_ORIGIN
    || (entry.summary ?? '').includes('autonomy closure')
    || (entry.tags ?? []).includes('autonomy-closure');
}

function runtimeWorkspaceStage(correction: CorrectionGateSnapshot): AutonomyClosureStageResult {
  const runtimeReasons = correction.reasons.filter(reason =>
    ['runtime-workspace-wrong-branch', 'dirty-runtime-workspace', 'local-commit-not-pushed'].includes(reason.type),
  );
  if (runtimeReasons.length > 0) {
    return {
      stage: 'runtime-workspace',
      status: 'blocked',
      summary: 'protected runtime checkout is not clean enough for autonomous work',
      evidence: runtimeReasons.map(reason => reason.message),
      repair: 'Run runtime workspace autocorrect or move the change into an isolated worktree PR.',
    };
  }
  return {
    stage: 'runtime-workspace',
    status: 'ok',
    summary: `runtime workspace ${correction.shipTruth.state}`,
    evidence: [`branch=${correction.shipTruth.branch ?? 'unknown'}`, `dirty=${correction.shipTruth.dirty}`],
  };
}

function taskExecutionStage(openTasks: MemoryIndexEntry[]): AutonomyClosureStageResult {
  const exhausted = openTasks.filter(task => {
    const payload = (task.payload ?? {}) as Record<string, unknown>;
    return task.status === 'hold' && Number(payload.auto_executor_failures ?? 0) >= 3;
  });
  const blocked = openTasks.filter(task => ['blocked', 'needs-decomposition'].includes(String(task.status)));
  if (exhausted.length > 0) {
    return {
      stage: 'task-execution',
      status: 'blocked',
      summary: `${exhausted.length} task(s) exhausted autonomous retries`,
      evidence: exhausted.slice(0, 5).map(formatTaskEvidence),
      repair: 'Create a diagnostic repair task or split the failing task into smaller verified slices.',
    };
  }
  if (blocked.length > 0) {
    return {
      stage: 'task-execution',
      status: 'warn',
      summary: `${blocked.length} task(s) need decomposition or unblock`,
      evidence: blocked.slice(0, 5).map(formatTaskEvidence),
      repair: 'Prefer decomposition before retrying the same failed command.',
    };
  }
  return {
    stage: 'task-execution',
    status: 'ok',
    summary: `${openTasks.length} open task(s), none exhausted`,
    evidence: openTasks.slice(0, 5).map(formatTaskEvidence),
  };
}

function testHealthStage(memoryDir: string): AutonomyClosureStageResult {
  const snapshot = readTestHealthSnapshot(memoryDir);
  if (!snapshot) {
    return {
      stage: 'test-health',
      status: 'ok',
      summary: 'no recorded test failure',
      evidence: [],
    };
  }
  if (snapshot.status === 'failed') {
    return {
      stage: 'test-health',
      status: 'blocked',
      summary: summarizeTestHealth(snapshot),
      evidence: [
        `checkedAt=${snapshot.checkedAt}`,
        `exitCode=${snapshot.exitCode}`,
        ...snapshot.failedFiles.slice(0, 5).map(f => `${f.file}${f.failedCount ? ` (${f.failedCount} failed)` : ''}`),
      ],
      repair: 'Run the failing test files in isolation, fix the root cause or stale test expectation, then rerun pnpm check:test-health.',
    };
  }
  return {
    stage: 'test-health',
    status: 'ok',
    summary: summarizeTestHealth(snapshot),
    evidence: [`checkedAt=${snapshot.checkedAt}`, `exitCode=${snapshot.exitCode}`],
  };
}

function issueAutopilotStage(openTasks: MemoryIndexEntry[], now: Date): AutonomyClosureStageResult {
  const issueTasks = openTasks.filter(task => {
    const payload = (task.payload ?? {}) as Record<string, unknown>;
    return task.source === 'github-issue' || payload.origin === 'github-issue' || typeof payload.issue_number === 'number';
  });
  const staleIssueTasks = issueTasks.filter(task => {
    const status = String(task.status);
    if (status === 'hold') return !hasActiveTimedHold(task, now);
    return ['blocked', 'needs-decomposition'].includes(status);
  });
  if (staleIssueTasks.length > 0) {
    return {
      stage: 'issue-autopilot',
      status: 'warn',
      summary: `${staleIssueTasks.length} GitHub issue task(s) are not flowing`,
      evidence: staleIssueTasks.slice(0, 5).map(formatTaskEvidence),
      repair: 'Reconcile GitHub issue state and queue a smaller repair task if the issue is still open.',
    };
  }
  return {
    stage: 'issue-autopilot',
    status: 'ok',
    summary: `${issueTasks.length} GitHub issue task(s) visible to scheduler`,
    evidence: issueTasks.slice(0, 5).map(formatTaskEvidence),
  };
}

function hasActiveTimedHold(task: MemoryIndexEntry, now: Date): boolean {
  const payload = (task.payload ?? {}) as Record<string, unknown>;
  const condition = payload.holdCondition as Record<string, unknown> | undefined;
  if (condition?.type !== 'date-after' || typeof condition.value !== 'string') return false;
  const releaseAt = Date.parse(condition.value);
  return Number.isFinite(releaseAt) && releaseAt > now.getTime();
}

function prReviewConsensusStage(memoryDir: string, now: Date): AutonomyClosureStageResult {
  const activePath = path.join(memoryDir, 'handoffs', 'active.md');
  if (!existsSync(activePath)) {
    return {
      stage: 'pr-review-consensus',
      status: 'ok',
      summary: 'no active PR review handoff file',
      evidence: [],
    };
  }

  const activeContent = readFileSync(activePath, 'utf-8');
  const openPrGaps = evaluatePrClosureGaps(memoryDir, activeContent, now);
  const handoffsRaw = parsePrReviewHandoffs(activeContent);
  const openPrSnapshot = readOpenPrSnapshot(memoryDir);
  const openPrNumbers = openPrSnapshot ? new Set(openPrSnapshot.prs.map(pr => pr.number)) : null;
  const handoffs = openPrNumbers
    ? handoffsRaw.filter(handoff => openPrNumbers.has(handoff.prNumber))
    : handoffsRaw;
  const claims = openPrNumbers
    ? readPrReviewClaimsSync(memoryDir).filter(claim => openPrNumbers.has(claim.prNumber))
    : readPrReviewClaimsSync(memoryDir);
  const consensuses = evaluatePrReviewConsensus(handoffs, claims);
  const missing = consensuses.filter(c => c.status === 'pending' && c.missingReviewers.length > 0);
  const changes = consensuses.filter(c => c.status === 'changes_requested' || c.status === 'disputed');
  if (changes.length > 0) {
    return {
      stage: 'pr-review-consensus',
      status: 'blocked',
      summary: `${changes.length} PR consensus result(s) require changes or arbitration`,
      evidence: changes.slice(0, 5).map(c => `PR #${c.prNumber}: ${c.status} (${c.summary})`),
      repair: 'Apply review feedback, request a new claim, then allow merge automation to continue.',
    };
  }
  if (missing.length > 0) {
    return {
      stage: 'pr-review-consensus',
      status: 'warn',
      summary: `${missing.length} PR(s) still missing internal review claims`,
      evidence: missing.slice(0, 5).map(c => `PR #${c.prNumber}: missing ${c.missingReviewers.join(', ')}`),
      repair: 'Run GitHub automation to produce internal review claims and consensus.',
    };
  }
  if (
    openPrGaps.snapshotMissing
    || openPrGaps.snapshotStale
    || openPrGaps.readyUntracked.length > 0
    || openPrGaps.staleDrafts.length > 0
    || openPrGaps.approvedBlocked.length > 0
  ) {
    const evidence: string[] = [];
    if (openPrGaps.snapshotMissing) evidence.push('open PR snapshot missing');
    if (openPrGaps.snapshotStale) evidence.push(`open PR snapshot stale: generatedAt=${openPrGaps.snapshotGeneratedAt ?? 'unknown'}`);
    evidence.push(...openPrGaps.readyUntracked.slice(0, 5).map(pr => `PR #${pr.number}: ready but not tracked for review (${pr.title})`));
    evidence.push(...openPrGaps.staleDrafts.slice(0, 5).map(pr => `PR #${pr.number}: stale draft needs triage (${pr.title})`));
    evidence.push(...openPrGaps.approvedBlocked.slice(0, 5).map(pr => `PR #${pr.number}: approved but not mergeable (${pr.mergeStateStatus ?? pr.mergeable ?? 'unknown'}: ${pr.title})`));

    return {
      stage: 'pr-review-consensus',
      status: openPrGaps.approvedBlocked.length > 0 ? 'blocked' : 'warn',
      summary: 'open PR lifecycle has unclosed tracking gaps',
      evidence,
      repair: 'Run GitHub automation to refresh open-prs.json, queue PR review handoffs, update approved conflicts, and triage stale drafts.',
    };
  }
  if (handoffs.length === 0) {
    return {
      stage: 'pr-review-consensus',
      status: 'ok',
      summary: 'no pending PR review handoffs and open PR snapshot is current',
      evidence: [`snapshot=${openPrGaps.snapshotGeneratedAt ?? 'current'}`],
    };
  }
  return {
    stage: 'pr-review-consensus',
    status: 'ok',
    summary: `${consensuses.length} PR review consensus record(s) current`,
    evidence: consensuses.slice(0, 5).map(c => `PR #${c.prNumber}: ${c.status}`),
  };
}

function shipAndDeployStage(correction: CorrectionGateSnapshot): AutonomyClosureStageResult {
  if (correction.shipTruth.state === 'behind' || correction.shipTruth.state === 'diverged') {
    return {
      stage: 'ship-and-deploy',
      status: 'blocked',
      summary: `runtime checkout ship truth is ${correction.shipTruth.state}`,
      evidence: [`ahead=${correction.shipTruth.ahead}`, `behind=${correction.shipTruth.behind}`],
      repair: 'Rebase or reset protected runtime checkout to origin/main after preserving local work.',
    };
  }
  return {
    stage: 'ship-and-deploy',
    status: 'ok',
    summary: `ship truth ${correction.shipTruth.state}`,
    evidence: [`ahead=${correction.shipTruth.ahead}`, `behind=${correction.shipTruth.behind}`],
  };
}

function selfImprovementStage(openTasks: MemoryIndexEntry[]): AutonomyClosureStageResult {
  const selfResearch = openTasks.filter(task => (task.summary ?? '').includes('execute self-research'));
  const maintenance = openTasks.filter(task => (task.summary ?? '').includes('autonomous maintenance'));
  if (selfResearch.length > 1) {
    return {
      stage: 'self-improvement',
      status: 'warn',
      summary: `${selfResearch.length} self-research tasks are queued at once`,
      evidence: selfResearch.slice(0, 5).map(formatTaskEvidence),
      repair: 'Keep one measurable self-improvement experiment active and close stale duplicates.',
    };
  }
  return {
    stage: 'self-improvement',
    status: 'ok',
    summary: `${selfResearch.length} self-research task(s), ${maintenance.length} maintenance task(s)`,
    evidence: [...selfResearch, ...maintenance].slice(0, 5).map(formatTaskEvidence),
  };
}

function memoryContextStage(memoryDir: string, repoRoot: string): AutonomyClosureStageResult {
  const placement = evaluateRuntimeMemoryPlacement(repoRoot);
  const hasTaskEvents = existsSync(path.join(memoryDir, 'state', 'task-events.jsonl'));
  const hasRelations = existsSync(path.join(memoryDir, 'index', 'relations.jsonl'));
  const hasHandoffs = existsSync(path.join(memoryDir, 'handoffs', 'active.md'));
  if (!placement.ok) {
    return {
      stage: 'memory-context',
      status: 'blocked',
      summary: 'runtime memory placement is unsafe',
      evidence: [placement.reason, `memoryRoot=${placement.memoryRoot}`],
      repair: 'Move memory/context outside protected runtime checkout and keep KG promotion reading curated memory.',
    };
  }
  if (!hasTaskEvents && !hasRelations && !hasHandoffs) {
    return {
      stage: 'memory-context',
      status: 'warn',
      summary: 'memory context has no observable task/relation/handoff files yet',
      evidence: [`memoryRoot=${memoryDir}`],
      repair: 'Initialize memory index and handoff files so context can become reusable memory.',
    };
  }
  return {
    stage: 'memory-context',
    status: 'ok',
    summary: 'memory context is observable',
    evidence: [
      `memoryRoot=${memoryDir}`,
      `taskEvents=${hasTaskEvents}`,
      `relations=${hasRelations}`,
      `handoffs=${hasHandoffs}`,
    ],
  };
}

function memoryStateTruthStage(memoryDir: string, repoRoot: string): AutonomyClosureStageResult {
  const result = evaluateMemoryStateTruth(memoryDir, repoRoot);
  return {
    stage: 'memory-state-truth',
    status: result.status,
    summary: result.summary,
    evidence: result.evidence,
    repair: result.repair,
  };
}

function kgContextFabricStage(memoryDir: string, now: Date): AutonomyClosureStageResult {
  const retrieval = getFeature('kg-retrieval-augment');
  const jit = getFeature('kg-jit-augment');
  const push = getFeature('kg-service-push');
  const features = [retrieval, jit, push].filter((feature): feature is Exclude<typeof feature, null> => feature !== null);
  const disabled = features
    .filter(feature => !feature.enabled)
    .map(feature => feature.name);
  if (disabled.length > 0) {
    return {
      stage: 'kg-context-fabric',
      status: 'warn',
      summary: `KG context feature(s) disabled: ${disabled.join(', ')}`,
      evidence: disabled,
      repair: 'Re-enable KG retrieval/JIT/push features so KG remains the shared context, classification, linking, and analysis fabric.',
    };
  }
  const result = evaluateKgExternalMemoryTruth(memoryDir, now);
  return {
    stage: 'kg-context-fabric',
    status: result.status,
    summary: result.summary,
    evidence: result.evidence,
    repair: result.repair,
  };
}

function middlewareQualityStage(memoryDir: string, now: Date): AutonomyClosureStageResult {
  const result = evaluateMiddlewareQuality({
    now,
    classifiedFailedTaskIds: readClassifiedMiddlewareTaskIds(memoryDir),
  });
  return {
    stage: 'middleware-quality',
    status: result.status,
    summary: result.summary,
    evidence: result.evidence,
    repair: result.repair,
  };
}

function operationalEfficiencyStage(
  correction: CorrectionGateSnapshot,
  kgStage: AutonomyClosureStageResult,
  middlewareStage: AutonomyClosureStageResult,
): AutonomyClosureStageResult {
  const evidence: string[] = [];

  if (correction.needsCorrection) {
    evidence.push(`correction=${correction.reasons.map(reason => reason.type).join(',') || 'needs-correction'}`);
    evidence.push(...correction.guidance.slice(0, 2));
  }

  const kgStale = extractEvidenceNumber(kgStage.evidence, 'staleOpenDiscussions');
  const kgQueued = extractEvidenceNumber(kgStage.evidence, 'queuedStaleDiscussions');
  if ((kgStale ?? 0) > 0) {
    evidence.push(`kgStaleOpenDiscussions=${kgStale}`);
    if ((kgQueued ?? 0) > 0) evidence.push(`kgQueuedStaleDiscussions=${kgQueued}`);
  }

  if (middlewareStage.status !== 'ok') {
    const middlewareStaleFailed = extractEvidenceNumber(middlewareStage.evidence, 'staleFailed');
    const middlewareBuckets = middlewareStage.evidence.find(item => item.startsWith('failureBuckets='));
    if ((middlewareStaleFailed ?? 0) > 0) evidence.push(`middlewareStaleFailed=${middlewareStaleFailed}`);
    if (middlewareBuckets?.includes('max-turns')) evidence.push(middlewareBuckets);
  }

  if (evidence.length === 0) {
    return {
      stage: 'operational-efficiency',
      status: 'ok',
      summary: 'no unresolved efficiency advisories',
      evidence: [],
    };
  }

  return {
    stage: 'operational-efficiency',
    status: 'warn',
    summary: `${evidence.length} efficiency signal(s) need autonomous convergence`,
    evidence: evidence.slice(0, 8),
    repair: 'Convert advisory signals into bounded autonomous work: split stale tasks, classify middleware max-turns into smaller retries/fallbacks, and close or refresh stale KG discussions until the next closure check has no efficiency advisories.',
  };
}

function extractEvidenceNumber(evidence: string[], key: string): number | null {
  const line = evidence.find(item => item.startsWith(`${key}=`));
  if (!line) return null;
  const raw = line.slice(key.length + 1);
  const match = raw.match(/^\d+/);
  return match ? Number(match[0]) : null;
}

function buildRecommendedTask(
  stages: AutonomyClosureStageResult[],
  status: AutonomyClosureStatus,
): AutonomyClosureSnapshot['recommendedTask'] {
  if (status === 'healthy') return null;
  const primary = stages.find(s => s.status === 'blocked') ?? stages.find(s => s.status === 'warn');
  if (!primary) return null;
  const priority: 0 | 1 = primary.status === 'blocked' ? 0 : 1;
  return {
    priority,
    title: `P${priority} autonomy closure: repair ${primary.stage}`,
    verifyCommand: 'pnpm check:autonomy-closure -- --json',
    acceptanceCriteria: [
      primary.summary,
      primary.repair ?? 'Restore the autonomous closed loop and leave falsifiable evidence.',
      'Expected loop: issue/task visible -> isolated worktree -> PR -> review consensus -> merge -> deploy -> runtime clean -> memory/KG context updated.',
    ].join(' '),
  };
}

function formatTaskEvidence(task: MemoryIndexEntry): string {
  return `${task.id.slice(0, 12)} ${task.status}: ${(task.summary ?? '').slice(0, 100)}`;
}
