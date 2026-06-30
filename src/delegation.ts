/**
 * Delegation — Converter to middleware /plan
 *
 * Per proposal 2026-04-15-middleware-as-organ §Q4 (no flag, no fallback, no
 * dual path): all delegate dispatch now routes through agent-middleware's DAG
 * plan engine. mini-agent owns:
 *   - edit-layer policy (TYPE_DEFAULTS → capability→worker mapping)
 *   - forge slot allocation (§Q2, kept mini-agent-side)
 *   - local result tracking for sibling awareness / pulse / foreground lane
 *   - commitment bridge (§5, hooks into middleware /commit ledger)
 *
 * middleware owns: subprocess spawn, sandbox, watchdog, recover, truth store.
 *
 * Subprocess (in middleware) does not read SOUL.md / write memory / send Telegram.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getMemoryRootDir, resolveMemoryPath } from './memory-paths.js';
import { slog } from './utils.js';
import { getInstanceDir, getCurrentInstanceId } from './instance.js';
import { eventBus } from './event-bus.js';
import type { DelegationTaskType, Provider } from './types.js';
import { writeActivity } from './activity-journal.js';
import { createTask, updateTask } from './memory-index.js';
import { middleware, type PlanStepSpec, type PlanStatus } from './middleware-client.js';
import { finalizeForgeWorkspace, prepareForgeWorkspace, type ForgeOutcome } from './forge.js';
import { extractDelegationSummary, buildRecentDelegationSummary, persistDelegationResult, writeLaneOutput } from './delegation-summary.js';
import { decideArbitration } from './brain-arbiter.js';
import type { ArbitrationDecision, WorkIntent, WorkItem, WorkPriority, WorkRisk } from './brain-types.js';
import { WriteLeaseManager, type WriteLease } from './write-lease.js';
import { appendProviderClaim } from './claim-ledger.js';
import { createProviderClaim } from './provider-claims.js';
import { observe as kbObserve } from './shared-knowledge.js';
import { BrainRuntime, type BrainRuntimeResult } from './brain-runtime.js';
import { createDefaultMiddlewareProviders } from './middleware-provider.js';
import { createDefaultMiddlewarePeers } from './middleware-peer-agent.js';
import type { BrainRequest } from './brain-types.js';
import { getCachedAvailableBrainActors, isBrainRuntimeDelegationEnabled, refreshBrainHealth } from './brain-health.js';
import { readActorOutcomeStatsSync } from './actor-outcome-stats.js';
import { filterActorsForProviderResourceHolds } from './provider-resource-guard.js';
import {
  getDelegationFailureCode,
  markDelegationFailureDiagnosticCreated,
  recordDelegationFailure,
  shouldSuppressUnchangedDelegationRetry,
} from './delegation-failure-guard.js';
import { diagnoseDelegationFailure } from './delegation-failure-diagnostics.js';
import { buildConstraintTexturePromptSection } from './constraint-texture.js';

// =============================================================================
// Phantom-prompt classifier (issue #141 Layer 1)
// =============================================================================

/**
 * Returns true if `prompt` is too thin to be a real delegation envelope.
 * Pinned by tests/delegation-phantom-prompt.test.ts. Used as the pre-dispatch
 * gate in `spawnDelegation` to block fail-ejkd7t-shaped repeats where a
 * 24-char imperative like `Update src/agent.ts` slipped through and triggered
 * 4× retries with masked forge errors.
 */
export function isPhantomPrompt(prompt: string): boolean {
  if (!prompt) return true;
  const trimmed = prompt.trim();
  if (trimmed.length >= 80) return false;
  if (/^##\s+Task:/m.test(trimmed)) return false;
  return true;
}

export interface ShellPromptValidation {
  ok: boolean;
  reason?: string;
  line?: string;
}

/**
 * Shell delegations are passed to `/bin/bash -c` literally. Reject markdown or
 * prose envelopes at the dispatch boundary so one bad caller fails once with a
 * typed error instead of producing a command-not-found storm.
 */
export function validateShellPrompt(prompt: string): ShellPromptValidation {
  const lines = prompt.split(/\r?\n/);
  let hasExecutableLine = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#!')) {
      continue;
    }
    if (/^#{2,6}\s+\S/.test(line)) {
      return { ok: false, reason: 'markdown_heading', line };
    }
    if (/^#/.test(line)) continue;
    if (/^```/.test(line)) {
      return { ok: false, reason: 'markdown_fence', line };
    }
    if (/^(?:[-*]|\d+\.)\s+/.test(line)) {
      return { ok: false, reason: 'markdown_list', line };
    }
    if (/^<\/?[A-Za-z][^>]*>$/.test(line)) {
      return { ok: false, reason: 'xml_envelope', line };
    }
    if (/^(?:Task ID|Strategy|Instructions|Acceptance Criteria|Notes|Retry Task)\s*:/i.test(line)) {
      return { ok: false, reason: 'prose_field', line };
    }
    if (/^[A-Z][A-Za-z]+(?:\s+[a-z][A-Za-z/'-]+){2,}[.!?]?$/.test(line)) {
      return { ok: false, reason: 'prose_sentence', line };
    }
    hasExecutableLine = true;
  }

  if (!hasExecutableLine) {
    return { ok: false, reason: 'empty_or_comment_only' };
  }

  return { ok: true };
}

// =============================================================================
// Types (stable external surface)
// =============================================================================

export interface DelegationTask {
  id?: string;
  type?: DelegationTaskType;
  provider?: Provider;
  originTask?: string;
  prompt: string;
  workdir: string;
  maxTurns?: number;
  timeoutMs?: number;
  /**
   * Per-task stall-kill cap for shell workers (ms).
   * Overrides the worker-level `progressTimeoutSeconds` for this task only.
   * Use for LLM-heavy shell pipelines (e.g. KG extraction) that produce no
   * stdout during long LLM round-trips and would otherwise be killed by the
   * default 300s worker stall cap. Set to 600_000 (10min) for KG ingest.
   */
  progressTimeoutMs?: number;
  verify?: string[];
  allowedTools?: string[];
  context?: string;
  /** Convergence condition — when present, dispatch routes via /accomplish (brain plans). */
  acceptance?: string;
  forgeWorktree?: string;
}

export interface VerifyResult {
  cmd: string;
  passed: boolean;
  output: string;
}

export interface TaskResult {
  id: string;
  type?: DelegationTaskType;
  status: 'running' | 'completed' | 'failed' | 'timeout';
  startedAt: string;
  completedAt?: string;
  duration?: number;
  output: string;
  confidence?: number;
  verifyResults?: VerifyResult[];
  forge?: ForgeOutcome;
  runtime?: DelegationRuntimeTrace;
}

export interface DelegationRuntimeTrace {
  engine: 'brain-runtime';
  mode: ArbitrationDecision['mode'];
  status: BrainRuntimeResult['status'];
  primary: string | null;
  runs: Array<{
    actor: string;
    role: string;
    status: string;
    finishReason?: string;
    claimIds: string[];
    error?: string;
  }>;
  claimIds: string[];
}

// Re-exports for backward compatibility (callers can import from forge.ts directly)
export { forgeRecover, forgeStatus, type ForgeSlotStatus } from './forge.js';
export { extractDelegationSummary, buildRecentDelegationSummary } from './delegation-summary.js';

// =============================================================================
// Constants
// =============================================================================

const MAX_CONCURRENT = 6;
const MAX_TIMEOUT_MS = 600_000;
const DEFAULT_TIMEOUT_MS = 300_000;
const POLL_INTERVAL_MS = 3000;

/**
 * Capability → middleware worker name.
 * Middleware registers `coder/researcher/learn/reviewer/create/planner/debugger/shell/web-browser/cloud-agent`.
 */
const CAPABILITY_TO_WORKER: Record<DelegationTaskType, string> = {
  code: 'coder',
  research: 'researcher',
  learn: 'learn',
  review: 'reviewer',
  create: 'create',
  plan: 'planner',
  debug: 'debugger',
  shell: 'shell',
  browse: 'web-browser',
  akari: 'cloud-agent',
  graphify: 'shell',
};

/** Per-type timeout defaults (fallback when caller doesn't specify). */
const TYPE_DEFAULTS: Record<DelegationTaskType, { timeoutMs: number }> = {
  code:     { timeoutMs: 300_000 },
  learn:    { timeoutMs: 300_000 },
  research: { timeoutMs: 480_000 },
  create:   { timeoutMs: 480_000 },
  review:   { timeoutMs: 180_000 },
  shell:    { timeoutMs: 60_000 },
  browse:   { timeoutMs: 180_000 },
  akari:    { timeoutMs: 480_000 },
  plan:     { timeoutMs: 300_000 },
  debug:    { timeoutMs: 300_000 },
  graphify: { timeoutMs: 600_000 },
};
const RAW_PROMPT_TYPES = new Set<DelegationTaskType>(['shell', 'graphify']);

// P1-d edit-layer: always active (v2-final §6 — no flag, no dual path).

// =============================================================================
// Commitment bridge (§5)
// =============================================================================

const commitmentBridge = new Map<string, Promise<string | null>>();

function commitmentStart(taskId: string, taskType: string, prompt: string): void {
  const promise = (async (): Promise<string | null> => {
    try {
      const cycleId = process.env.KURO_CYCLE_ID;
      const res = await middleware().createCommitment({
        owner: 'kuro',
        source: {
          channel: 'delegate',
          message_id: taskId,
          ...(cycleId ? { cycle_id: cycleId } : {}),
        },
        text: prompt.slice(0, 500),
        parsed: { action: `delegate:${taskType}` },
        acceptance: `delegate ${taskType} produces verified output`,
        linked_task_id: taskId,
      });
      return res.id;
    } catch (err) {
      slog('DELEGATION', `commitment create skipped (${taskId}): ${(err as Error).message?.split('\n')[0] ?? err}`);
      return null;
    }
  })();
  commitmentBridge.set(taskId, promise);
  void promise.catch(() => {});
}

function commitmentClose(taskId: string, status: string, evidence: string): void {
  const promise = commitmentBridge.get(taskId);
  if (!promise) return;
  commitmentBridge.delete(taskId);
  void (async () => {
    try {
      const id = await promise;
      if (!id) return;
      await middleware().resolveCommitment(id, {
        kind: 'task-close',
        evidence: `delegate ${status}: ${evidence.slice(0, 300)}`,
      });
    } catch (err) {
      slog('DELEGATION', `commitment resolve skipped (${taskId}): ${(err as Error).message?.split('\n')[0] ?? err}`);
    }
  })();
}

// =============================================================================
// Local result tracking (populated from middleware poll loop)
// =============================================================================

interface ActiveEntry {
  planId: string;
  result: TaskResult;
  task: DelegationTask;
  forgeWorktree?: string;
  arbitration: ArbitrationDecision;
  writeLease?: WriteLease;
  runtime?: DelegationRuntimeTrace;
}

const activeTasks = new Map<string, ActiveEntry>();
const completedTasks = new Map<string, TaskResult>();
const writeLeases = new WriteLeaseManager();


// =============================================================================
// Spawn: local taskId → middleware plan (one-step DAG)
// =============================================================================

/** Dispatch delegation via middleware — returns taskId synchronously. */
export function spawnDelegation(task: DelegationTask): string {
  const taskId = task.id ?? `del-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const taskType = task.type ?? 'code';

  // Layer 1 phantom-prompt gate (issue #141): reject thin prompts pre-dispatch.
  // Spec pinned by tests/delegation-phantom-prompt.test.ts.
  if (!RAW_PROMPT_TYPES.has(taskType) && isPhantomPrompt(task.prompt)) {
    const preview = (task.prompt ?? '').trim().slice(0, 60);
    slog(
      'DELEGATION',
      `phantom_prompt rejected ${taskId} type=${taskType} len=${(task.prompt ?? '').length} preview="${preview}"`,
    );
    const failed: TaskResult = {
      id: taskId,
      type: taskType,
      status: 'failed',
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      output: `phantom_prompt: prompt lacks "## Task:" envelope and is shorter than 80 chars (got ${(task.prompt ?? '').length}). Rejected pre-dispatch to avoid fail-ejkd7t-shaped retries (#141).`,
    };
    completedTasks.set(taskId, failed);
    return taskId;
  }

  const retrySuppression = shouldSuppressUnchangedDelegationRetry(getMemoryRootDir(), {
    taskType,
    prompt: task.prompt,
  });
  if (retrySuppression.suppress) {
    const now = new Date().toISOString();
    const output = [
      `token_economy_suppressed: ${retrySuppression.reason}`,
      retrySuppression.record ? `failure_signature: ${retrySuppression.record.signature}` : undefined,
      'mechanical_action: create a smaller diagnostic/probe task; do not spend provider turns on the same broad prompt.',
    ].filter(Boolean).join('\n');
    const failed: TaskResult = {
      id: taskId,
      type: taskType,
      status: 'failed',
      startedAt: now,
      completedAt: now,
      duration: 0,
      output,
    };
    completedTasks.set(taskId, failed);
    writeActivity({
      lane: 'background',
      summary: `suppressed ${taskType}: ${retrySuppression.reason ?? task.prompt.slice(0, 100)}`,
      tags: ['skipped', 'token-economy', 'max-turns'],
      duration: 0,
    });
    if (task.originTask) {
      void updateTask(getMemoryRootDir(), task.originTask, {
        status: 'hold',
        verify: [{
          name: 'token-economy',
          status: 'unknown',
          detail: retrySuppression.reason ?? 'unchanged retry suppressed',
          updatedAt: now,
        }],
        staleWarning: retrySuppression.reason,
      }).catch(() => {});
    }
    eventBus.emit('action:delegation-complete', {
      taskId,
      status: 'failed',
      type: taskType,
      outputPreview: output.slice(0, 500),
      durationMs: 0,
      tokenEconomySuppressed: true,
    });
    return taskId;
  }
  const worker = CAPABILITY_TO_WORKER[taskType];
  const workItem = buildWorkItemForDelegation(taskId, task, taskType);
  const timeoutMs = Math.min(
    task.timeoutMs ?? TYPE_DEFAULTS[taskType].timeoutMs ?? DEFAULT_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
  );
  const workdir = task.workdir.replace(/^~/, process.env.HOME ?? '');
  const memDir = getMemoryRootDir();
  const availableActors = isBrainRuntimeDelegationEnabled()
    ? filterActorsForProviderResourceHolds(getCachedAvailableBrainActors(), memDir)
    : undefined;
  const arbitration = decideArbitration(
    workItem,
    isBrainRuntimeDelegationEnabled()
      ? {
          availableActors,
          actorStats: readActorOutcomeStatsSync(memDir, { intent: workItem.intent, limit: 300 }),
        }
      : undefined,
  );

  // Soft concurrency cap — middleware also caps per-worker, this just surfaces
  // backpressure to callers via the local activeTasks map.
  if (activeTasks.size >= MAX_CONCURRENT) {
    slog('DELEGATION', `Capacity reached (${activeTasks.size}/${MAX_CONCURRENT}) — middleware will queue ${taskId}`);
  }

  // Forge (§Q2): workspace isolation is a single adapter decision. Delegation
  // only consumes the prepared cwd; forge owns worktree allocation policy.
  const needsWorkspaceIsolation = workItem.risk === 'workspace_write';
  const preparedWorkspace = prepareForgeWorkspace({
    taskId,
    workdir,
    taskType,
    requiresIsolation: needsWorkspaceIsolation,
    explicitWorktree: task.forgeWorktree,
  });
  const cwd = preparedWorkspace.cwd;

  const result: TaskResult = {
    id: taskId,
    type: taskType,
    status: 'running',
    startedAt: new Date().toISOString(),
    output: '(dispatched via middleware)',
  };

  // Synchronously reserve the slot so callers see the task via listTasks/getActiveDelegationSummaries.
  // planId gets filled in once /plan returns (or cleared on failure).
  const entry: ActiveEntry = { planId: '', result, task, forgeWorktree: preparedWorkspace.worktree, arbitration };
  activeTasks.set(taskId, entry);

  if (preparedWorkspace.blockedReason) {
    finalizeTask(entry, {
      status: 'failed',
      output: preparedWorkspace.blockedReason,
    });
    return taskId;
  }

  writeActivity({
    lane: 'background',
    summary: `started ${taskType}: ${task.prompt.slice(0, 120)} [${arbitration.mode}:${arbitration.primary}]`,
    tags: ['started', 'middleware', `arbiter:${arbitration.mode}`, `primary:${arbitration.primary}`],
  });

  slog(
    'ARBITER',
    `${taskId} ${taskType} → ${arbitration.mode} primary=${arbitration.primary} reviewers=${arbitration.reviewers.join(',') || 'none'} lease=${arbitration.writeLeaseRequired} claims=${arbitration.kgClaimsRequired}: ${arbitration.reason}`,
  );
  eventBus.emit('action:arbitration', {
    taskId,
    type: taskType,
    mode: arbitration.mode,
    primary: arbitration.primary,
    reviewers: arbitration.reviewers,
    writeLeaseRequired: arbitration.writeLeaseRequired,
    kgClaimsRequired: arbitration.kgClaimsRequired,
    humanApprovalRequired: arbitration.humanApprovalRequired,
    reason: arbitration.reason,
    selectionTrace: arbitration.selectionTrace,
  });

  if (arbitration.humanApprovalRequired) {
    finalizeTask(entry, {
      status: 'failed',
      output: `blocked by arbiter: ${arbitration.reason}`,
    });
    return taskId;
  }

  if (arbitration.writeLeaseRequired) {
    try {
      entry.writeLease = writeLeases.acquire({
        taskId,
        holder: arbitration.primary,
        fileScopes: workItem.writeScope ?? [workdir],
      });
      slog('WRITE-LEASE', `${taskId} acquired ${entry.writeLease.id}: ${entry.writeLease.fileScopes.join(', ')}`);
      eventBus.emit('action:arbitration', {
        taskId,
        type: taskType,
        leaseId: entry.writeLease.id,
        leaseScopes: entry.writeLease.fileScopes,
      });
    } catch (err) {
      finalizeTask(entry, {
        status: 'failed',
        output: `blocked by write lease: ${err instanceof Error ? err.message : String(err)}`,
      });
      return taskId;
    }
  }

  if (worker === 'shell') {
    const shellPrompt = validateShellPrompt(task.prompt);
    if (!shellPrompt.ok) {
      const detail = shellPrompt.line ? ` at line "${shellPrompt.line.slice(0, 120)}"` : '';
      finalizeTask(entry, {
        status: 'failed',
        output: `shell_received_prose: ${shellPrompt.reason ?? 'invalid_shell_prompt'}${detail}. Shell delegations execute literal bash; pass an executable command/script or route prose through a non-shell worker.`,
      });
      return taskId;
    }
  }

  commitmentStart(taskId, taskType, task.prompt);

  // Submit plan + begin polling (fire-and-forget).
  const dispatchPromise = isBrainRuntimeDelegationEnabled()
    ? dispatchViaBrainRuntime(entry, cwd, timeoutMs)
    : dispatchAndPoll(entry, worker, cwd, timeoutMs);

  void dispatchPromise.catch((err: Error) => {
    slog('DELEGATION', `dispatch ${taskId} failed: ${err.message}`);
    finalizeTask(entry, { status: 'failed', output: `dispatch error: ${err.message}` });
  });

  return taskId;
}

async function dispatchViaBrainRuntime(
  entry: ActiveEntry,
  cwd: string,
  timeoutMs: number,
): Promise<void> {
  const { result, task, arbitration } = entry;
  const request = buildBrainRequestForDelegation(entry, cwd, timeoutMs);
  const providers = createDefaultMiddlewareProviders();
  const peers = createDefaultMiddlewarePeers();
  await refreshBrainHealth(providers, peers);
  const runtime = new BrainRuntime({
    providers,
    peers,
    memoryDir: getMemoryRootDir(),
  });

  const runtimeResult = await runtime.execute({
    workItem: buildWorkItemForDelegation(result.id, task, result.type ?? task.type ?? 'code'),
    request,
    decision: arbitration,
  });
  entry.runtime = runtimeTraceFromResult(arbitration, runtimeResult);
  result.runtime = entry.runtime;

  eventBus.emit('action:brain-runtime', {
    taskId: result.id,
    mode: entry.runtime.mode,
    status: entry.runtime.status,
    primary: entry.runtime.primary,
    runs: entry.runtime.runs,
    claimIds: entry.runtime.claimIds,
  });

  finalizeTask(entry, {
    status: runtimeResult.status === 'success' || runtimeResult.status === 'partial' ? 'completed' : 'failed',
    output: formatBrainRuntimeOutput(runtimeResult),
  });
}

function buildBrainRequestForDelegation(entry: ActiveEntry, cwd: string, timeoutMs: number): BrainRequest {
  const taskType = entry.result.type ?? entry.task.type ?? 'code';
  const workItem = buildWorkItemForDelegation(entry.result.id, entry.task, taskType);
  const context = [
    formatArbitrationContext(entry.arbitration, workItem),
    entry.task.context,
    entry.task.acceptance ? `Acceptance: ${entry.task.acceptance}` : undefined,
  ].filter(Boolean).join('\n\n');
  return {
    taskId: entry.result.id,
    source: 'background',
    intent: workItem.intent,
    prompt: RAW_PROMPT_TYPES.has(taskType)
      ? entry.task.prompt
      : [context, entry.task.prompt].filter(Boolean).join('\n\n'),
    systemPrompt: 'You are running as a mini-agent delegated brain provider. Return the requested result with concise evidence.',
    cwd,
    timeoutMs,
    maxTurns: entry.task.maxTurns,
    tools: toolsForDelegation(taskType),
    risk: workItem.risk,
  };
}

function toolsForDelegation(type: DelegationTaskType): BrainRequest['tools'] {
  switch (type) {
    case 'code':
    case 'create':
    case 'debug':
      return ['read', 'write', 'shell'];
    case 'shell':
    case 'graphify':
      return ['shell'];
    case 'research':
    case 'learn':
    case 'browse':
      return ['read', 'web'];
    default:
      return ['read'];
  }
}

function formatBrainRuntimeOutput(result: BrainRuntimeResult): string {
  const lines = [
    `[brain-runtime] status=${result.status} primary=${result.primary ?? 'none'} claims=${result.claims.length}`,
  ];
  for (const run of result.runs) {
    const label = `[${run.actor}:${run.role}:${run.status}]`;
    if (run.error) {
      lines.push(`${label} ${run.error}`);
      continue;
    }
    const output = run.result && 'text' in run.result
      ? run.result.text
      : run.result && 'coordinator' in run.result ? run.result.response
      : run.result && 'response' in run.result ? run.result.response : '';
    if (output) lines.push(`${label} ${output}`);
  }
  return lines.join('\n');
}

function runtimeTraceFromResult(
  arbitration: ArbitrationDecision,
  result: BrainRuntimeResult,
): DelegationRuntimeTrace {
  return {
    engine: 'brain-runtime',
    mode: arbitration.mode,
    status: result.status,
    primary: result.primary,
    runs: result.runs.map(run => ({
      actor: run.actor,
      role: run.role,
      status: run.status,
      finishReason: run.result && 'finishReason' in run.result ? run.result.finishReason : undefined,
      claimIds: run.claimIds,
      ...(run.error ? { error: run.error } : {}),
    })),
    claimIds: result.claims.map(claim => claim.id),
  };
}

async function dispatchAndPoll(
  entry: ActiveEntry,
  worker: string,
  cwd: string,
  timeoutMs: number,
): Promise<void> {
  const { result, task, arbitration } = entry;
  const taskId = result.id;
  const taskType = result.type ?? task.type ?? 'code';
  const MAX_REPLAN_ROUNDS = 3;
  const priorAttempts: Array<{ error?: string; tried?: string }> = [];

  for (let round = 0; round <= MAX_REPLAN_ROUNDS; round++) {
    await assertMiddlewareWorkerReady(worker);
    // ── Dispatch ──────────────────────────────────────────────────────
    // BAR Phase 2: when acceptance present, route through /accomplish (brain plans).
    // Without acceptance, fall back to manual 1-step /plan (wave nodes, legacy).
    let planId: string;
    if (task.acceptance) {
      const workItem = buildWorkItemForDelegation(taskId, task, taskType);
      const arbitrationExtra = formatArbitrationContext(arbitration, workItem);
      const resp = await middleware().accomplish({
        goal: task.prompt,
        acceptance: task.acceptance,
        constraints: { must_use: [worker] },
        context: {
          caller_identity: 'kuro',
          extra: `Working directory: ${cwd}\n${arbitrationExtra}`,
          ...(priorAttempts.length > 0 ? { prior_attempts: priorAttempts } : {}),
        },
      });
      planId = resp.planId;
      const roundLabel = round > 0 ? ` (replan round ${round})` : '';
      slog('DELEGATION', `BAR dispatch ${taskId} → accomplish ${planId} (${resp.plan.steps.length} steps, hint=${worker})${roundLabel}`);
    } else {
      // Legacy /plan path — no replan support, exit loop after first round.
      // NB: sibling context is natural-language prompt annotation — safe for
      // LLM workers (agent-brain/coder/researcher/etc.) that interpret `task`
      // as prompt, but will be concat'd into `/bin/bash -c` for shell worker,
      // causing syntax errors on punctuation (e.g. "(30s)" parsed as subshell).
      // 2026-04-18 incident: shell task failed exit 2 — skip annotation for shell.
      let prompt = task.prompt;
      if (worker !== 'shell') {
        const workItem = buildWorkItemForDelegation(taskId, task, taskType);
        prompt = `${formatArbitrationContext(arbitration, workItem)}\n\n${prompt}`;
        const siblingContext = buildRecentDelegationSummary(3_600_000, 400);
        if (siblingContext) {
          prompt = `${prompt}\n\n[active sibling tasks — avoid duplicate work]\n${siblingContext}`;
        }
      }
      const step: PlanStepSpec & { cwd?: string } = {
        id: taskId, worker, label: task.prompt.slice(0, 80), task: prompt,
        dependsOn: [], timeoutSeconds: Math.max(30, Math.ceil(timeoutMs / 1000)), cwd,
        ...(task.progressTimeoutMs !== undefined
          ? { progressTimeoutSeconds: Math.ceil(task.progressTimeoutMs / 1000) }
          : {}),
      };
      // 2026-04-20: middleware().plan() had no per-call timeout; a blocking /plan
      // endpoint manifested as silent 600s hang_no_diag (unclassifiable). 120s
      // Promise.race converts that into actionable `plan_rpc_unreachable` subtype.
      // Paired with extractErrorSubtype() in feedback-loops.ts.
      const PLAN_RPC_TIMEOUT_MS = 120_000;
      let planTimer: ReturnType<typeof setTimeout> | undefined;
      const timeoutGuard = new Promise<never>((_, reject) => {
        planTimer = setTimeout(
          () => reject(new Error(`middleware /plan timed out after ${PLAN_RPC_TIMEOUT_MS}ms (plan_rpc_unreachable)`)),
          PLAN_RPC_TIMEOUT_MS
        );
      });
      let resp;
      try {
        resp = await Promise.race([
          middleware().plan({
            goal: `${task.type ?? 'code'}: ${task.prompt.slice(0, 120)}`,
            steps: [step],
            failurePolicy: 'cancel-dependents',
          }),
          timeoutGuard,
        ]);
      } finally {
        if (planTimer) clearTimeout(planTimer);
      }
      planId = resp.planId;
      slog('DELEGATION', `Dispatched ${taskId} → plan ${planId}`);
    }

    entry.planId = planId;

    // ── Poll until terminal ──────────────────────────────────────────
    // Hard deadline = 2× timeoutMs to match previous watchdog force-threshold.
    const deadline = Date.now() + Math.max(timeoutMs * 2, timeoutMs + 30_000);
    let terminalStatus: PlanStatus | undefined;

    while (Date.now() < deadline) {
      if (!activeTasks.has(taskId)) return; // cancelled externally
      await sleep(POLL_INTERVAL_MS);

      let status: PlanStatus;
      try {
        status = await middleware().planStatus(planId);
      } catch (err) {
        slog('DELEGATION', `poll ${taskId} transient error: ${(err as Error).message?.split('\n')[0] ?? err}`);
        continue;
      }

      const terminalCount = status.steps.filter(s =>
        s.status === 'completed' || s.status === 'failed'
        || s.status === 'cancelled' || s.status === 'skipped'
      ).length;
      if (terminalCount >= status.totalSteps) {
        terminalStatus = status;
        break;
      }
    }

    // ── Timeout — no terminal status reached ─────────────────────────
    if (!terminalStatus) {
      slog('DELEGATION', `Timeout ${taskId} after ${Math.round((Date.now() - new Date(result.startedAt).getTime()) / 1000)}s`);
      try { await middleware().cancelPlan(planId); } catch { /* best effort */ }
      finalizeTask(entry, { status: 'timeout', output: '(middleware plan did not reach terminal state)' });
      return;
    }

    // ── Collect output from all terminal steps ───────────────────────
    const outputs: string[] = [];
    const failedErrors: Array<{ error?: string; tried?: string }> = [];

    for (const step of terminalStatus.steps) {
      if (step.status === 'completed') {
        try {
          const t = await middleware().status(step.id);
          outputs.push(t.result ?? t.error ?? '');
        } catch { /* skip */ }
      } else if (step.status === 'failed') {
        try {
          const t = await middleware().status(step.id);
          const errText = t.error ?? t.result ?? '(unknown error)';
          outputs.push(`[FAILED ${step.label ?? step.id}] ${errText}`);
          failedErrors.push({
            tried: `${worker}: ${step.label ?? task.prompt.slice(0, 80)}`,
            error: errText.slice(0, 500),
          });
        } catch { /* skip */ }
      }
    }

    const hasFailed = terminalStatus.failed > 0;
    const output = outputs.filter(Boolean).join('\n---\n') || '(no output)';

    // ── Success or no replan possible → finalize ─────────────────────
    if (!hasFailed || !task.acceptance || round >= MAX_REPLAN_ROUNDS) {
      if (hasFailed && round >= MAX_REPLAN_ROUNDS) {
        slog('DELEGATION', `Replan exhausted for ${taskId} after ${MAX_REPLAN_ROUNDS} rounds — finalizing as failed`);
      }
      finalizeTask(entry, { status: hasFailed ? 'failed' : 'completed', output });
      return;
    }

    // ── Replan: accumulate failure context, loop ─────────────────────
    priorAttempts.push(...failedErrors);
    slog('DELEGATION', `Replan ${taskId} round ${round + 1}/${MAX_REPLAN_ROUNDS} — ${failedErrors.length} failed step(s), brain gets prior_attempts`);
  }
}

async function assertMiddlewareWorkerReady(worker: string): Promise<void> {
  const HEALTH_TIMEOUT_MS = 5_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutGuard = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`middleware health preflight timed out after ${HEALTH_TIMEOUT_MS}ms`)),
      HEALTH_TIMEOUT_MS,
    );
  });
  try {
    const health = await Promise.race([middleware().health(), timeoutGuard]);
    if (health.status !== 'ok') {
      throw new Error(`middleware health preflight failed: status=${health.status}`);
    }
    if (!health.workers.includes(worker)) {
      throw new Error(`middleware health preflight failed: worker ${worker} unavailable`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`preflight blocked delegation before provider spend: ${message}`);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function buildWorkItemForDelegation(
  taskId: string,
  task: DelegationTask,
  taskType: DelegationTaskType,
): WorkItem {
  const intent = intentForDelegationType(taskType);
  const risk = riskForDelegationType(taskType, task);
  return {
    id: taskId,
    title: task.prompt.slice(0, 120) || `${taskType} delegation`,
    intent,
    priority: priorityForDelegation(task),
    risk,
    prompt: task.prompt,
    writeScope: inferWriteScope(taskType, task),
    tags: [taskType, ...(task.provider ? [`provider:${task.provider}`] : [])],
  };
}

function intentForDelegationType(type: DelegationTaskType): WorkIntent {
  switch (type) {
    case 'code': return 'code';
    case 'debug': return 'diagnose';
    case 'research':
    case 'learn':
    case 'browse': return 'research';
    case 'review': return 'review';
    case 'plan': return 'plan';
    case 'shell':
    case 'graphify': return 'verify';
    case 'akari': return 'architecture';
    case 'create': return 'code';
    default: return 'plan';
  }
}

function riskForDelegationType(type: DelegationTaskType, task: DelegationTask): WorkRisk {
  if (/\b(deploy|push|publish|delete|remove|rm\s+-rf)\b/i.test(task.prompt)) {
    return 'external_write';
  }
  if (type === 'code' || type === 'create' || Boolean(task.forgeWorktree)) {
    return 'workspace_write';
  }
  return 'read_only';
}

function priorityForDelegation(task: DelegationTask): WorkPriority {
  if (/\b(P0|urgent|ASAP|緊急|馬上)\b/i.test(task.prompt)) return 'P0';
  if (/\b(P2|low priority|低優先)\b/i.test(task.prompt)) return 'P2';
  return 'P1';
}

function inferWriteScope(type: DelegationTaskType, task: DelegationTask): string[] | undefined {
  if (type !== 'code' && type !== 'create' && !task.forgeWorktree) return undefined;
  const matches = [...task.prompt.matchAll(/\b((?:src|tests|scripts|plugins|docs|memory|kuro-portfolio)\/[A-Za-z0-9._/@+-]+)\b/g)];
  const scopes = [...new Set(matches.map(m => m[1]))];
  return scopes.length > 0 ? scopes : [task.workdir];
}

function formatArbitrationContext(decision: ArbitrationDecision, workItem?: WorkItem): string {
  const reviewers = decision.reviewers.length > 0 ? decision.reviewers.join(', ') : 'none';
  const selection = formatSelectionTrace(decision);
  const texture = workItem ? buildConstraintTexturePromptSection(workItem) : '';
  return [
    '<arbitration>',
    `mode: ${decision.mode}`,
    `primary: ${decision.primary}`,
    `reviewers: ${reviewers}`,
    `write_lease_required: ${decision.writeLeaseRequired ? 'yes' : 'no'}`,
    `kg_claims_required: ${decision.kgClaimsRequired ? 'yes' : 'no'}`,
    `reason: ${decision.reason}`,
    ...(selection ? [`selection_trace:\n${selection}`] : []),
    '</arbitration>',
    texture,
  ].join('\n');
}

function formatSelectionTrace(decision: ArbitrationDecision): string {
  const selected = decision.selectionTrace?.selected ?? [];
  if (selected.length === 0) return '';
  return selected
    .slice(0, 6)
    .map(item => {
      const score = item.score === undefined ? '' : ` score=${item.score}`;
      const reasons = item.reasons.slice(0, 2).join('; ');
      return `  - ${item.role}:${item.actor}${score} ${reasons}`.trimEnd();
    })
    .join('\n');
}

function finalizeTask(
  entry: ActiveEntry,
  final: { status: 'completed' | 'failed' | 'timeout'; output: string },
): void {
  const { result, task, forgeWorktree } = entry;
  if (!activeTasks.has(result.id)) return; // already finalized

  result.status = final.status;
  result.output = final.output || result.output;
  result.completedAt = new Date().toISOString();
  result.duration = Date.now() - new Date(result.startedAt).getTime();

  // Forge merge/cleanup on completion
  if (forgeWorktree) {
    const finalized = finalizeForgeWorkspace({
      worktree: forgeWorktree,
      mainDir: task.workdir,
      status: result.status,
      message: task.prompt.slice(0, 80),
    });
    if (finalized.outputSuffix) result.output += finalized.outputSuffix;
    result.forge = finalized.outcome;
  }

  slog('DELEGATION', `Finished ${result.id}: ${result.status} in ${Math.round((result.duration ?? 0) / 1000)}s`);
  const failureDecision = result.status === 'completed'
    ? null
    : recordRepeatedDelegationFailure(entry);
  const providerClaimId = recordDelegationClaim(entry);
  eventBus.emit('action:delegation-complete', {
    taskId: result.id,
    status: result.status,
    type: result.type,
    outputPreview: result.output.slice(0, 500),
    durationMs: result.duration,
    ...(entry.runtime ? { runtime: entry.runtime } : {}),
    ...(providerClaimId ? { providerClaimId } : {}),
    ...(failureDecision?.repeated ? {
      repeatedFailure: {
        signature: failureDecision.record.signature,
        frequency: failureDecision.record.frequency,
        diagnosticTaskId: failureDecision.record.diagnosticTaskId,
      },
    } : {}),
    ...(entry.writeLease ? { writeLeaseId: entry.writeLease.id } : {}),
  });

  // Auto-update task-queue entry
  if (task.originTask) {
    const memDir = getMemoryRootDir();
    updateTask(memDir, task.originTask, {
      status: result.status === 'completed' ? 'completed' : failureDecision?.repeated ? 'hold' : 'pending',
      verify: [{
        name: 'delegate',
        status: result.status === 'completed' ? 'pass' : 'fail',
        detail: failureDecision?.repeated
          ? `repeated delegation failure (${failureDecision.record.frequency}x); diagnostic task: ${failureDecision.record.diagnosticTaskId ?? 'pending'}`
          : result.output.slice(0, 200),
        updatedAt: new Date().toISOString(),
      }],
      ...(failureDecision?.repeated ? {
        staleWarning: `Held after repeated delegation failure (${failureDecision.record.frequency}x): ${failureDecision.record.error.slice(0, 160)}`,
      } : {}),
    }).catch(() => {});
  }

  writeActivity({
    lane: 'background',
    summary: `${result.type ?? 'code'} ${result.status}: ${extractDelegationSummary(result.output, 100)}`,
    tags: [
      result.status,
      ...(entry.runtime ? ['brain-runtime', `primary:${entry.runtime.primary ?? 'none'}`] : []),
      ...(entry.writeLease ? [`lease:${entry.writeLease.id}`] : []),
    ],
    duration: result.duration,
  });
  commitmentClose(result.id, result.status, extractDelegationSummary(result.output, 200));

  persistDelegationResult(result);
  writeLaneOutput(result);

  if (entry.writeLease) {
    writeLeases.release(entry.writeLease.id);
    slog('WRITE-LEASE', `${result.id} released ${entry.writeLease.id}`);
  }

  activeTasks.delete(result.id);
  completedTasks.set(result.id, result);
}

function recordRepeatedDelegationFailure(entry: ActiveEntry): ReturnType<typeof recordDelegationFailure> | null {
  const { result, task } = entry;
  if (!shouldGuardDelegationFailure(result.output)) return null;
  const memDir = getMemoryRootDir();
  try {
    const decision = recordDelegationFailure(memDir, {
      taskId: result.id,
      taskType: result.type,
      prompt: task.prompt,
      output: result.output,
    });

    if (decision.repeated) {
      result.output += `\n\n[delegation-failure-guard] repeated failure ${decision.record.frequency}x. Holding the origin task and creating a Kuro diagnostic task instead of retrying unchanged.`;
      slog('DELEGATION', `Repeated failure ${decision.record.frequency}x for ${result.id}: ${decision.record.signature.slice(0, 120)}`);
      eventBus.emit('action:delegation-failure', {
        taskId: result.id,
        signature: decision.record.signature,
        frequency: decision.record.frequency,
        diagnosticTaskId: decision.record.diagnosticTaskId,
      });
    }

    if (decision.needsDiagnosticTask) {
      const failureCode = getDelegationFailureCode(decision.record.signature);
      void createTask(memDir, {
        title: `Diagnose ${failureCode}: repeated delegation failure: ${task.prompt.slice(0, 100)}`,
        origin: 'kuro',
        status: 'pending',
        assignee: 'kuro',
      }).then(created => {
        markDelegationFailureDiagnosticCreated(memDir, decision.record.signature, created.id);
        decision.record.diagnosticTaskId = created.id;
        eventBus.emit('action:task', { content: created.summary ?? created.id, entry: created });
        return diagnoseDelegationFailure(memDir, decision.record.signature);
      }).catch(err => {
        slog('DELEGATION', `failed to create diagnostic task for ${result.id}: ${err instanceof Error ? err.message : String(err)}`);
      });
    }

    return decision;
  } catch (err) {
    slog('DELEGATION', `failure guard error for ${result.id}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function shouldGuardDelegationFailure(output: string): boolean {
  const normalized = output.toLowerCase();
  if (normalized.includes('cancelled via killalldelegations')) return false;
  if (normalized.includes('blocked by write lease')) return false;
  if (normalized.includes('blocked by arbiter')) return false;
  return true;
}

function recordDelegationClaim(entry: ActiveEntry): string | undefined {
  const { result, arbitration } = entry;
  try {
    const summary = extractDelegationSummary(result.output, 400);
    const claim = createProviderClaim({
      provider: arbitration.primary,
      taskId: result.id,
      subject: `delegation:${result.id}`,
      predicate: result.status === 'completed' ? 'reported_result' : 'reported_failure',
      object: summary || result.output.slice(0, 400) || '(no output)',
      evidence: [
        `delegation status: ${result.status}`,
        ...(result.duration !== undefined ? [`duration_ms: ${result.duration}`] : []),
        result.output.slice(0, 500),
      ],
      confidence: result.status === 'completed' ? 0.7 : 0.35,
    });
    appendProviderClaim(getMemoryRootDir(), claim);
    kbObserve({
      source: 'claims',
      type: 'claim',
      data: {
        claimId: claim.id,
        taskId: result.id,
        provider: claim.provider,
        status: claim.status,
        predicate: claim.predicate,
      },
      tags: ['provider-claim', claim.provider, result.type ?? 'delegation'],
      correlationId: result.id,
      outcome: result.status === 'completed' ? 'success' : 'fail',
      durationMs: result.duration,
    });
    return claim.id;
  } catch (err) {
    slog('CLAIMS', `record skipped for ${result.id}: ${(err as Error).message?.split('\n')[0] ?? err}`);
    return undefined;
  }
}

// =============================================================================
// External surface: lookup, list, await
// =============================================================================

export function getTaskResult(taskId: string): TaskResult | undefined {
  return activeTasks.get(taskId)?.result ?? completedTasks.get(taskId);
}

export function listTasks(options?: { includeCompleted?: boolean }): TaskResult[] {
  const results: TaskResult[] = [];
  for (const { result } of activeTasks.values()) results.push(result);
  if (options?.includeCompleted) {
    for (const result of completedTasks.values()) results.push(result);
  }
  return results;
}

export function getActiveDelegationSummaries(): Array<{ id: string; type: string; prompt: string }> {
  const summaries: Array<{ id: string; type: string; prompt: string }> = [];
  for (const { result, task } of activeTasks.values()) {
    if (result.status !== 'running') continue;
    summaries.push({
      id: result.id,
      type: result.type ?? task.type ?? 'code',
      prompt: task.prompt.slice(0, 140),
    });
  }
  return summaries;
}

export function getActiveWriteLeases(): WriteLease[] {
  return writeLeases.active();
}

export function awaitDelegation(taskId: string, timeoutMs = 600_000): Promise<TaskResult> {
  return new Promise((resolve, reject) => {
    const completed = completedTasks.get(taskId);
    if (completed) { resolve(completed); return; }

    const active = activeTasks.get(taskId);
    if (!active) {
      reject(new Error(`Unknown delegation: ${taskId}`));
      return;
    }

    if (active.result.status !== 'running') { resolve(active.result); return; }

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      eventBus.off('action:delegation-complete', handler);
      reject(new Error(`awaitDelegation timeout: ${taskId} after ${timeoutMs}ms`));
    }, timeoutMs);

    const handler = (event?: { data: Record<string, unknown> }) => {
      if (settled) return;
      if (event?.data?.taskId !== taskId) return;
      settled = true;
      clearTimeout(timer);
      eventBus.off('action:delegation-complete', handler);
      const result = completedTasks.get(taskId) ?? activeTasks.get(taskId)?.result;
      if (result) resolve(result);
      else reject(new Error(`Result disappeared: ${taskId}`));
    };

    eventBus.on('action:delegation-complete', handler);
  });
}

// =============================================================================
// Lifecycle management: cancel all, cleanup, recover/watchdog (now middleware-owned)
// =============================================================================

export function killAllDelegations(): number {
  let killed = 0;
  const snapshot = [...activeTasks.values()];
  for (const entry of snapshot) {
    if (entry.planId) {
      void middleware().cancelPlan(entry.planId).catch(() => {});
    }
    finalizeTask(entry, { status: 'failed', output: 'cancelled via killAllDelegations' });
    killed++;
  }
  return killed;
}

/** Cleanup completed tasks older than 24h (in-memory + lane-output files). */
export function cleanupTasks(): void {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;

  for (const [id, result] of completedTasks) {
    if (result.completedAt && new Date(result.completedAt).getTime() < cutoff) {
      completedTasks.delete(id);
    }
  }

  try {
    const instanceId = getCurrentInstanceId();
    const laneDir = path.join(getInstanceDir(instanceId), 'lane-output');
    if (!fs.existsSync(laneDir)) return;
    for (const entry of fs.readdirSync(laneDir)) {
      const filePath = path.join(laneDir, entry);
      try {
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < cutoff) fs.rmSync(filePath, { force: true });
      } catch { /* best effort */ }
    }
  } catch { /* best effort */ }
}

// =============================================================================
// Utilities
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
