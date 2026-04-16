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
import { slog } from './utils.js';
import { getInstanceDir, getCurrentInstanceId } from './instance.js';
import { eventBus } from './event-bus.js';
import type { DelegationTaskType, Provider } from './types.js';
import { writeActivity } from './activity-journal.js';
import { updateTask } from './memory-index.js';
import { middleware, type PlanStepSpec, type PlanStatus } from './middleware-client.js';
import { forgeCreate, forgeYolo, forgeCleanup } from './forge.js';
import { extractDelegationSummary, buildRecentDelegationSummary, persistDelegationResult, writeLaneOutput } from './delegation-summary.js';

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

export interface ForgeOutcome {
  worktree: string;
  created: boolean;
  merged: boolean;
  cleaned: boolean;
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
};

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
}

const activeTasks = new Map<string, ActiveEntry>();
const completedTasks = new Map<string, TaskResult>();


// =============================================================================
// Spawn: local taskId → middleware plan (one-step DAG)
// =============================================================================

/** Dispatch delegation via middleware — returns taskId synchronously. */
export function spawnDelegation(task: DelegationTask): string {
  const taskId = task.id ?? `del-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const taskType = task.type ?? 'code';
  const worker = CAPABILITY_TO_WORKER[taskType];
  const timeoutMs = Math.min(
    task.timeoutMs ?? TYPE_DEFAULTS[taskType].timeoutMs ?? DEFAULT_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
  );
  const workdir = task.workdir.replace(/^~/, process.env.HOME ?? '');

  // Soft concurrency cap — middleware also caps per-worker, this just surfaces
  // backpressure to callers via the local activeTasks map.
  if (activeTasks.size >= MAX_CONCURRENT) {
    slog('DELEGATION', `Capacity reached (${activeTasks.size}/${MAX_CONCURRENT}) — middleware will queue ${taskId}`);
  }

  // Forge (§Q2): allocate worktree for code workers here, before submitting plan.
  const forgeWorktree = task.forgeWorktree ?? (taskType === 'code'
    ? forgeCreate(taskId, workdir, taskType) ?? undefined
    : undefined);
  const cwd = forgeWorktree ?? workdir;

  const result: TaskResult = {
    id: taskId,
    type: taskType,
    status: 'running',
    startedAt: new Date().toISOString(),
    output: '(dispatched via middleware)',
  };

  // Synchronously reserve the slot so callers see the task via listTasks/getActiveDelegationSummaries.
  // planId gets filled in once /plan returns (or cleared on failure).
  const entry: ActiveEntry = { planId: '', result, task, forgeWorktree };
  activeTasks.set(taskId, entry);

  writeActivity({
    lane: 'background',
    summary: `started ${taskType}: ${task.prompt.slice(0, 120)}`,
    tags: ['started', 'middleware'],
  });

  commitmentStart(taskId, taskType, task.prompt);

  // Submit plan + begin polling (fire-and-forget).
  void dispatchAndPoll(entry, worker, cwd, timeoutMs).catch((err: Error) => {
    slog('DELEGATION', `dispatch ${taskId} failed: ${err.message}`);
    finalizeTask(entry, { status: 'failed', output: `dispatch error: ${err.message}` });
  });

  return taskId;
}

async function dispatchAndPoll(
  entry: ActiveEntry,
  worker: string,
  cwd: string,
  timeoutMs: number,
): Promise<void> {
  const { result, task } = entry;
  const taskId = result.id;
  const MAX_REPLAN_ROUNDS = 3;
  const priorAttempts: Array<{ error?: string; tried?: string }> = [];

  for (let round = 0; round <= MAX_REPLAN_ROUNDS; round++) {
    // ── Dispatch ──────────────────────────────────────────────────────
    // BAR Phase 2: when acceptance present, route through /accomplish (brain plans).
    // Without acceptance, fall back to manual 1-step /plan (wave nodes, legacy).
    let planId: string;
    if (task.acceptance) {
      const resp = await middleware().accomplish({
        goal: task.prompt,
        acceptance: task.acceptance,
        constraints: { must_use: [worker] },
        context: {
          caller_identity: 'kuro',
          extra: `Working directory: ${cwd}`,
          ...(priorAttempts.length > 0 ? { prior_attempts: priorAttempts } : {}),
        },
      });
      planId = resp.planId;
      const roundLabel = round > 0 ? ` (replan round ${round})` : '';
      slog('DELEGATION', `BAR dispatch ${taskId} → accomplish ${planId} (${resp.plan.steps.length} steps, hint=${worker})${roundLabel}`);
    } else {
      // Legacy /plan path — no replan support, exit loop after first round.
      let prompt = task.prompt;
      const siblingContext = buildRecentDelegationSummary(3_600_000, 400);
      if (siblingContext) {
        prompt = `${prompt}\n\n[active sibling tasks — avoid duplicate work]\n${siblingContext}`;
      }
      const step: PlanStepSpec & { cwd?: string } = {
        id: taskId, worker, label: task.prompt.slice(0, 80), task: prompt,
        dependsOn: [], timeoutSeconds: Math.max(30, Math.ceil(timeoutMs / 1000)), cwd,
      };
      const resp = await middleware().plan({
        goal: `${task.type ?? 'code'}: ${task.prompt.slice(0, 120)}`,
        steps: [step],
        failurePolicy: 'cancel-dependents',
      });
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
    const forgeOutcome: ForgeOutcome = { worktree: forgeWorktree, created: true, merged: false, cleaned: false };
    if (result.status === 'completed') {
      const merged = forgeYolo(forgeWorktree, task.workdir, task.prompt.slice(0, 80));
      forgeOutcome.merged = merged;
      if (!merged) {
        result.output += '\n[forge] merge skipped (verify failed or no changes)';
        forgeCleanup(forgeWorktree, task.workdir);
        forgeOutcome.cleaned = true;
      }
    } else {
      slog('FORGE', `Keeping failed worktree ${forgeWorktree} for diagnosis (forge auto-reclaim on next create)`);
    }
    result.forge = forgeOutcome;
  }

  slog('DELEGATION', `Finished ${result.id}: ${result.status} in ${Math.round((result.duration ?? 0) / 1000)}s`);
  eventBus.emit('action:delegation-complete', {
    taskId: result.id,
    status: result.status,
    type: result.type,
    outputPreview: result.output.slice(0, 500),
  });

  // Auto-update task-queue entry
  if (task.originTask) {
    const memDir = path.join(process.cwd(), 'memory');
    updateTask(memDir, task.originTask, {
      status: result.status === 'completed' ? 'completed' : 'pending',
      verify: [{
        name: 'delegate',
        status: result.status === 'completed' ? 'pass' : 'fail',
        detail: result.output.slice(0, 200),
        updatedAt: new Date().toISOString(),
      }],
    }).catch(() => {});
  }

  writeActivity({
    lane: 'background',
    summary: `${result.type ?? 'code'} ${result.status}: ${extractDelegationSummary(result.output, 100)}`,
    tags: [result.status],
    duration: result.duration,
  });
  commitmentClose(result.id, result.status, extractDelegationSummary(result.output, 200));

  persistDelegationResult(result);
  writeLaneOutput(result);

  activeTasks.delete(result.id);
  completedTasks.set(result.id, result);
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
