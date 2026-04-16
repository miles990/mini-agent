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

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { slog } from './utils.js';
import { getInstanceDir, getCurrentInstanceId } from './instance.js';
import { eventBus } from './event-bus.js';
import type { DelegationTaskType, Provider } from './types.js';
import { writeActivity } from './activity-journal.js';
import { updateTask } from './memory-index.js';
import { middleware, type PlanStepSpec, type PlanStatus } from './middleware-client.js';

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

export interface ForgeSlotStatus {
  total: number;
  busy: number;
  free: number;
  source: 'plugin' | 'bundled';
}

// =============================================================================
// Constants
// =============================================================================

const MAX_CONCURRENT = 6;
const MAX_TIMEOUT_MS = 600_000;
const DEFAULT_TIMEOUT_MS = 300_000;
const POLL_INTERVAL_MS = 3000;
const JOURNAL_MAX_ENTRIES = 100;

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

// Task types that don't need dependency installation (pure docs/review work)
const NO_INSTALL_TYPES: Set<DelegationTaskType> = new Set(['create', 'review', 'learn', 'research', 'plan', 'debug']);

// P1-d edit-layer gate. Set KURO_P1D_EDIT_LAYER=1 to enable convertAndDispatchAsPlan.
// v2-final spec targets a full cutover (no flag), but this env guard allows graduated rollout.
const EDIT_LAYER_ENABLED = process.env.KURO_P1D_EDIT_LAYER === '1';

// =============================================================================
// Forge (§Q2: slot management stays mini-agent-side)
// =============================================================================

const FORGE_LITE_BUNDLED = new URL('../scripts/forge-lite.sh', import.meta.url).pathname;
const FORGE_LITE_PLUGIN = path.join(
  process.env.HOME ?? '', '.claude/plugins/marketplaces/forge/scripts/forge-lite.sh'
);
const FORGE_LITE = fs.existsSync(FORGE_LITE_PLUGIN) ? FORGE_LITE_PLUGIN : FORGE_LITE_BUNDLED;

function forgeExec(cmd: string, workdir: string, timeoutMs = 15_000): string {
  return execSync(`bash "${FORGE_LITE}" ${cmd}`, {
    cwd: workdir, encoding: 'utf-8', timeout: timeoutMs,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function forgeCreate(taskId: string, workdir: string, taskType?: DelegationTaskType): string | null {
  try {
    if (!fs.existsSync(FORGE_LITE)) return null;
    const noInstall = taskType && NO_INSTALL_TYPES.has(taskType) ? ' --no-install' : '';
    const output = forgeExec(`create "${taskId}" --caller-pid ${process.pid}${noInstall}`, workdir);
    return output.split('\n').pop()!.trim();
  } catch (e) {
    slog('FORGE', `forgeCreate failed for ${taskId}: ${(e as Error).message?.split('\n')[0] ?? e}`);
    return null;
  }
}

function forgeYolo(worktreePath: string, mainDir: string, message: string): boolean {
  try {
    forgeExec(`yolo "${worktreePath}" "${message}"`, mainDir, 120_000);
    return true;
  } catch {
    return false;
  }
}

/** @DANGEROUS _reason: deletes the worktree — only call after yolo failed or task aborted */
function forgeCleanup(worktreePath: string, mainDir: string): void {
  try { forgeExec(`cleanup "${worktreePath}"`, mainDir); } catch { /* best effort */ }
}

export function forgeRecover(workdir: string): void {
  try {
    if (!fs.existsSync(FORGE_LITE)) return;
    const output = forgeExec('recover', workdir, 30_000);
    if (output) slog('FORGE', output);
  } catch { /* best effort */ }
}

export function forgeStatus(workdir: string): ForgeSlotStatus | null {
  try {
    if (!fs.existsSync(FORGE_LITE)) return null;
    const output = forgeExec('status', workdir);
    const lastLine = output.split('\n').pop() ?? '';
    const total = parseInt(lastLine.match(/total=(\d+)/)?.[1] ?? '0');
    const busy = parseInt(lastLine.match(/busy=(\d+)/)?.[1] ?? '0');
    const free = parseInt(lastLine.match(/free=(\d+)/)?.[1] ?? '0');
    return {
      total, busy, free,
      source: FORGE_LITE === FORGE_LITE_PLUGIN ? 'plugin' : 'bundled',
    };
  } catch {
    return null;
  }
}

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
// Output summary helpers (kept for foreground lane + activity journal)
// =============================================================================

export function extractDelegationSummary(output: string, maxLen: number): string {
  if (!output) return '';
  let text = output;
  text = text.replace(/<ktml:thinking>[\s\S]*?<\/ktml:thinking>/g, '');
  text = text.replace(/<thinking>[\s\S]*?<\/thinking>/g, '');
  text = text.replace(/\[forge\] merge skipped \([^)]*\)\s*$/, '').trim();

  const cleaned = text.replace(/\n/g, ' ').trim();
  if (cleaned.length <= maxLen) return cleaned;

  const conclusionMatch = text.match(
    /#{2,3}\s*(?:\d+\.\s*)?(?:FINAL ANSWER|Conclusion|結論|Summary|摘要|Key Findings?|Results?|結果)/i
  ) ?? text.match(
    /(?:^|\n)\s*(?:結論|Conclusion|FINAL ANSWER)[：:]/i
  );
  if (conclusionMatch && conclusionMatch.index !== undefined) {
    const fromConclusion = text.slice(conclusionMatch.index).replace(/\n/g, ' ').trim();
    if (fromConclusion.length > 30) return fromConclusion.slice(0, maxLen);
  }

  const startsWithThink = /^(?:#{1,3}\s*(?:\d+\.\s*)?THINK|I am verifying|Let me (?:think|analyze|verify))/i.test(text.trim());
  if (startsWithThink) return '…' + cleaned.slice(-(maxLen - 1));

  return cleaned.slice(0, maxLen);
}

function persistDelegationResult(result: TaskResult): void {
  try {
    const instanceDir = getInstanceDir(getCurrentInstanceId());
    const journalPath = path.join(instanceDir, 'delegation-journal.jsonl');

    const entry = {
      ts: result.completedAt ?? new Date().toISOString(),
      id: result.id,
      type: result.type ?? 'code',
      status: result.status,
      durationMs: result.duration,
      forgeMerged: result.forge?.merged ?? false,
      output: result.output.slice(0, 2000),
    };
    fs.appendFileSync(journalPath, JSON.stringify(entry) + '\n');

    try {
      const lines = fs.readFileSync(journalPath, 'utf-8').split('\n').filter(Boolean);
      if (lines.length > JOURNAL_MAX_ENTRIES + 20) {
        fs.writeFileSync(journalPath, lines.slice(-JOURNAL_MAX_ENTRIES).join('\n') + '\n');
      }
    } catch { /* trim is best-effort */ }
  } catch { /* fire-and-forget */ }
}

export function buildRecentDelegationSummary(maxAgeMs: number = 3_600_000, maxChars: number = 1500): string | null {
  try {
    const instanceDir = getInstanceDir(getCurrentInstanceId());
    const journalPath = path.join(instanceDir, 'delegation-journal.jsonl');
    if (!fs.existsSync(journalPath)) return null;

    const raw = fs.readFileSync(journalPath, 'utf-8');
    const lines = raw.split('\n').filter(Boolean);
    if (lines.length === 0) return null;

    const cutoff = Date.now() - maxAgeMs;
    const recent: Array<{ ts: string; id: string; type: string; status: string; durationMs: number; output: string }> = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (new Date(entry.ts).getTime() >= cutoff) recent.push(entry);
      } catch { /* skip malformed */ }
    }
    if (recent.length === 0) return null;

    recent.reverse();
    let result = '';
    for (const e of recent) {
      const durSec = Math.round((e.durationMs ?? 0) / 1000);
      const preview = extractDelegationSummary(e.output ?? '', 100);
      const line = `- [${e.type}] ${e.id}: ${e.status} (${durSec}s) — ${preview}\n`;
      if (result.length + line.length > maxChars) break;
      result += line;
    }
    return result.trim() || null;
  } catch {
    return null;
  }
}

function writeLaneOutput(result: TaskResult): void {
  try {
    const instanceId = getCurrentInstanceId();
    const laneDir = path.join(getInstanceDir(instanceId), 'lane-output');
    fs.mkdirSync(laneDir, { recursive: true });
    fs.writeFileSync(path.join(laneDir, `${result.id}.json`), JSON.stringify(result, null, 2));
  } catch { /* best effort */ }
}

// =============================================================================
// Spawn: local taskId → middleware plan (one-step DAG)
// =============================================================================

/**
 * Routes a delegation request through the middleware `/accomplish` endpoint.
 *
 * Allocates a forge worktree for code workers when needed, submits a one-step
 * DAG plan to middleware via `/accomplish`, and starts background polling to
 * track the resulting plan status until completion, failure, or timeout.
 *
 * @param task - The delegation task descriptor, including the prompt, workdir,
 *   task type, optional timeout, verify commands, and forge worktree settings.
 * @returns The resolved task ID (either `task.id` if provided, or a generated
 *   `del-<timestamp>-<random>` string) that can be used to look up the result.
 */
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

  // P1-d: when edit-layer is enabled, convertAndDispatchAsPlan enriches the prompt
  // with sibling-awareness context. When disabled, the existing literal is used unchanged.
  const step: PlanStepSpec & { cwd?: string } = EDIT_LAYER_ENABLED
    ? convertAndDispatchAsPlan(task, taskId, worker, timeoutMs, cwd)
    : {
        id: taskId,
        worker,
        label: task.prompt.slice(0, 80),
        task: task.prompt,
        dependsOn: [],
        timeoutSeconds: Math.max(30, Math.ceil(timeoutMs / 1000)),
        // middleware api.ts accepts per-step `cwd` even though the typed client
        // shape omits it — we pass it through the underlying request body.
        cwd,
      };

  const planResp = await middleware().plan({
    goal: `${task.type ?? 'code'}: ${task.prompt.slice(0, 120)}`,
    steps: [step],
    failurePolicy: 'cancel-dependents',
  });

  entry.planId = planResp.planId;
  slog('DELEGATION', `Dispatched ${taskId} → plan ${planResp.planId}`);

  // Poll until terminal. Hard deadline = 2× timeoutMs to match previous watchdog force-threshold.
  const deadline = Date.now() + Math.max(timeoutMs * 2, timeoutMs + 30_000);
  while (Date.now() < deadline) {
    if (!activeTasks.has(taskId)) return; // cancelled externally
    await sleep(POLL_INTERVAL_MS);

    let status: PlanStatus;
    try {
      status = await middleware().planStatus(planResp.planId);
    } catch (err) {
      slog('DELEGATION', `poll ${taskId} transient error: ${(err as Error).message?.split('\n')[0] ?? err}`);
      continue;
    }

    const step0 = status.steps[0];
    if (!step0) continue;

    if (step0.status === 'completed' || step0.status === 'failed'
      || step0.status === 'cancelled' || step0.status === 'skipped') {
      // Fetch per-task output (plan summary doesn't carry result text).
      let output = '';
      try {
        const t = await middleware().status(step0.id);
        output = t.result ?? t.error ?? '';
      } catch { /* keep empty */ }
      const final = step0.status === 'completed' ? 'completed'
        : step0.status === 'failed' ? 'failed' : 'failed';
      finalizeTask(entry, { status: final, output });
      return;
    }
  }

  // Deadline exceeded → mark timeout and try to cancel upstream.
  slog('DELEGATION', `Timeout ${taskId} after ${Math.round((Date.now() - new Date(result.startedAt).getTime()) / 1000)}s`);
  try { await middleware().cancelPlan(entry.planId); } catch { /* best effort */ }
  finalizeTask(entry, { status: 'timeout', output: '(middleware plan did not reach terminal state)' });
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
// P1-d edit-layer (§Q4): convert DelegationTask → PlanStepSpec
// =============================================================================

/**
 * Convert a DelegationTask into the canonical PlanStepSpec that middleware
 * expects, applying edit-layer policy:
 *
 *  - Timeout is already resolved by the caller (spawnDelegation) via TYPE_DEFAULTS;
 *    we just forward `timeoutMs` as `timeoutSeconds`.
 *  - Sibling awareness: if there are recent completed delegations, their summary
 *    is appended to the prompt so the sub-agent can avoid redundant work and
 *    coordinate with peers (draft line 116).
 *
 * Exported for unit-testing; not part of the stable external API surface.
 */
export function convertAndDispatchAsPlan(
  task: DelegationTask,
  taskId: string,
  worker: string,
  timeoutMs: number,
  cwd: string,
): PlanStepSpec & { cwd?: string } {
  // Inject sibling awareness into the prompt (last-hour window, capped at 400 chars).
  let prompt = task.prompt;
  const siblingContext = buildRecentDelegationSummary(3_600_000, 400);
  if (siblingContext) {
    prompt = `${prompt}\n\n[active sibling tasks — avoid duplicate work]\n${siblingContext}`;
  }

  return {
    id: taskId,
    worker,
    label: task.prompt.slice(0, 80), // label always uses original prompt (unaugmented)
    task: prompt,
    dependsOn: [],
    timeoutSeconds: Math.max(30, Math.ceil(timeoutMs / 1000)),
    cwd,
  };
}

// =============================================================================
// External surface: lookup, list, await, capacity
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

export function getDelegationCapacity(): { active: number; queued: number; max: number; available: number } {
  const active = [...activeTasks.values()].filter(e => e.result.status === 'running').length;
  return { active, queued: 0, max: MAX_CONCURRENT, available: Math.max(0, MAX_CONCURRENT - active) };
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

/**
 * Stale delegation recovery — middleware owns subprocess lifecycle now, so
 * there are no local orphan processes to recover. Kept as a no-op for API
 * stability (loop.ts still calls this on startup).
 */
export function recoverStaleDelegations(): void {
  // Middleware persists its own task state; nothing to recover mini-agent-side.
}

/**
 * Periodic watchdog — middleware handles timeout + stuck-process detection.
 * Kept as a no-op for API stability (loop.ts still calls this per cycle).
 */
export function watchdogDelegations(): void {
  // Middleware plan engine enforces step timeout + per-worker watchdog.
}

// =============================================================================
// Utilities
// =============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
