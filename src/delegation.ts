/**
 * Delegation — Async Task Executor
 *
 * 讓 Kuro 從 OODA cycle 委派任務。支援三種 executor：
 * - Claude CLI subprocess（code/learn/research/create/review）— 需要語言理解
 * - Shell executor（shell）— 直接跑 bash 命令，零 Claude token
 * - Browse executor（browse）— browser-use + ChatClaudeCLI Python subprocess
 * Fire-and-forget：spawnDelegation() 立即返回 taskId，不阻塞主 loop。
 *
 * Safety:
 * - Max 2 concurrent delegations (queued beyond that)
 * - Max 10 turns, 10 min hard cap
 * - Subprocess 不讀 SOUL.md、不寫 memory/、不發 Telegram
 */

import { spawn, execSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { slog } from './utils.js';
import { getInstanceDir, getCurrentInstanceId } from './instance.js';
import { eventBus } from './event-bus.js';
import type { DelegationTaskType, Provider } from './types.js';
import { writeActivity } from './activity-journal.js';
import { updateTask } from './memory-index.js';

// =============================================================================
// Types
// =============================================================================

export interface DelegationTask {
  id?: string;
  type?: DelegationTaskType;
  provider?: Provider;
  originTask?: string; // task-queue entry ID — 完成後自動更新此 task
  prompt: string;
  workdir: string;
  maxTurns?: number;
  timeoutMs?: number;
  verify?: string[];
  allowedTools?: string[];
  context?: string;
  forgeWorktree?: string; // Resume: use existing forge worktree instead of creating new
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
  confidence?: number; // 1-10 self-assessed quality score from local LLM
  verifyResults?: VerifyResult[];
  forge?: ForgeOutcome;
}

// =============================================================================
// Constants
// =============================================================================

const MAX_CONCURRENT = 6;
const MAX_TURNS_CAP = 10;
const MAX_TIMEOUT_CAP = 600_000; // 10 min
const DEFAULT_TIMEOUT = 300_000; // 5 min
const DEFAULT_TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'];
const OUTPUT_TAIL_CHARS = 5000;
/** @DANGEROUS _reason: unbounded output accumulation caused Claude Code's 36.8GB memory incident */
const MAX_OUTPUT_BUFFER_CHARS = 200_000; // 200KB hard cap on raw output accumulation
const BROWSER_ROUTING_KEYWORDS = [
  'CDP',
  'click',
  'login',
  'OAuth',
  '瀏覽器',
  'browser',
  'headless',
  'puppeteer',
  'Chrome',
  'navigate',
  'screenshot',
] as const;
// Forge decay is handled by forge-lite.sh's slot abandonment mechanism:
// subprocess PID dies → is_slot_abandoned() detects → next create reclaims slot
// TTL controlled by FORGE_SLOT_TTL_MINUTES env var in forge-lite.sh (default: 60min)

// =============================================================================
// Delegation State Persistence (survives restart)
// =============================================================================

interface ActiveDelegationState {
  taskId: string;
  pid: number;
  startedAt: string;
  timeoutMs: number;
  worktree?: string;
  workdir: string;
}

function getStateFilePath(): string {
  return path.join(getInstanceDir(getCurrentInstanceId()), 'delegation-active.json');
}

function loadStateEntries(filePath: string): ActiveDelegationState[] {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      slog('WARN', `delegation state file corrupted (not array), resetting`);
      return [];
    }
    return parsed;
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'ENOENT') return []; // file missing = OK
    slog('WARN', `delegation state file read error: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

function saveToStateFile(entry: ActiveDelegationState): void {
  try {
    const filePath = getStateFilePath();
    const entries = loadStateEntries(filePath);
    entries.push(entry);
    fs.writeFileSync(filePath, JSON.stringify(entries));
  } catch (err) { slog('WARN', `delegation state save failed: ${err instanceof Error ? err.message : err}`); }
}

function removeFromStateFile(taskId: string): void {
  try {
    const filePath = getStateFilePath();
    const entries = loadStateEntries(filePath).filter(e => e.taskId !== taskId);
    fs.writeFileSync(filePath, JSON.stringify(entries));
  } catch (err) { slog('WARN', `delegation state remove failed: ${err instanceof Error ? err.message : err}`); }
}

// Type-specific defaults for non-code delegation tasks
const TYPE_DEFAULTS: Record<DelegationTaskType, { tools: string[]; maxTurns: number; timeoutMs: number; provider: Provider }> = {
  code:     { tools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'LSP'], maxTurns: 5, timeoutMs: 300_000, provider: 'claude' },
  learn:    { tools: ['Bash', 'Read', 'Glob', 'Grep', 'WebFetch'], maxTurns: 3, timeoutMs: 300_000, provider: 'local' },
  research: { tools: ['Bash', 'Read', 'Glob', 'Grep', 'WebFetch'], maxTurns: 5, timeoutMs: 480_000, provider: 'local' },
  create:   { tools: ['Read', 'Write', 'Edit'], maxTurns: 5, timeoutMs: 480_000, provider: 'claude' },
  review:   { tools: ['Bash', 'Read', 'Glob', 'Grep'], maxTurns: 3, timeoutMs: 180_000, provider: 'claude' },
  shell:    { tools: [], maxTurns: 1, timeoutMs: 60_000, provider: 'claude' },
  browse:   { tools: [], maxTurns: 1, timeoutMs: 180_000, provider: 'claude' },
  akari:    { tools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'LSP'], maxTurns: 5, timeoutMs: 480_000, provider: 'claude' },
  plan:     { tools: ['Read', 'Glob', 'Grep'], maxTurns: 5, timeoutMs: 300_000, provider: 'claude' },
  debug:    { tools: ['Bash', 'Read', 'Glob', 'Grep', 'LSP'], maxTurns: 5, timeoutMs: 300_000, provider: 'claude' },
};

// =============================================================================
// Forge — Worktree Isolation (Slime Mold Model)
// =============================================================================

/**
 * Cross-platform sandbox: kernel-level file write isolation for forge worktrees.
 * - macOS: sandbox-exec (Seatbelt framework)
 * - Linux: Landlock LSM (kernel 5.13+) via Python helper
 * - Other: null (fallback to detect+revert)
 *
 * Returns a wrapper that prefixes spawn args, or null if unavailable.
 */
interface SandboxWrapper {
  cmd: string;
  prefixArgs: string[];
  platform: 'sandbox-exec' | 'landlock';
}

const LANDLOCK_HELPER = new URL('../scripts/landlock-sandbox.py', import.meta.url).pathname;

function buildSandbox(mainDir: string, worktreeDir: string): SandboxWrapper | null {
  const home = process.env.HOME ?? '/tmp';

  if (process.platform === 'darwin') {
    try { execSync('which sandbox-exec', { stdio: 'ignore' }); } catch { return null; }
    // macOS 26+: (allow default) overrides subsequent deny rules.
    // Use whitelist approach: (deny default) + explicit allows for everything except mainDir.
    const profile = `(version 1)
(deny default)
(allow process*)
(allow sysctl*)
(allow mach*)
(allow signal)
(allow ipc*)
(allow network*)
(allow system*)
(allow file-read*)
(allow file-ioctl)
(allow file-write*
  (subpath "${worktreeDir}")
  (subpath "/tmp")
  (subpath "/private/tmp")
  (subpath "/private/var")
  (subpath "/dev")
  (subpath "${home}/.npm")
  (subpath "${home}/.bun")
  (subpath "${home}/.nvm")
  (subpath "${home}/.cache")
  (subpath "${home}/.config")
  (subpath "${home}/.codex")
  (subpath "${home}/Library")
)`;
    return { cmd: 'sandbox-exec', prefixArgs: ['-p', profile], platform: 'sandbox-exec' };
  }

  if (process.platform === 'linux') {
    // Landlock via Python helper (kernel 5.13+, zero dependencies)
    if (fs.existsSync(LANDLOCK_HELPER)) {
      try { execSync('python3 --version', { stdio: 'ignore' }); } catch { return null; }
      return {
        cmd: 'python3',
        prefixArgs: [LANDLOCK_HELPER, '--deny', mainDir, '--allow', worktreeDir, '--'],
        platform: 'landlock',
      };
    }
  }

  return null;
}

// Resolve forge-lite.sh: prefer plugin (always latest) → fallback to bundled copy
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

// Task types that don't need dependency installation (pure docs/review work)
const NO_INSTALL_TYPES: Set<DelegationTaskType> = new Set(['create', 'review', 'learn', 'research', 'plan', 'debug']);

function forgeCreate(taskId: string, workdir: string, taskType?: DelegationTaskType): string | null {
  try {
    if (!fs.existsSync(FORGE_LITE)) return null;
    const noInstall = taskType && NO_INSTALL_TYPES.has(taskType) ? ' --no-install' : '';
    const output = forgeExec(`create "${taskId}" --caller-pid ${process.pid}${noInstall}`, workdir);
    // Last line is the worktree path (git output precedes it)
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

/** @DANGEROUS _reason: merges worktree changes into main directory, then deletes worktree — irreversible file changes */
function forgeCleanup(worktreePath: string, mainDir: string): void {
  try {
    forgeExec(`cleanup "${worktreePath}"`, mainDir);
  } catch { /* best effort */ }
}

/**
 * Run forge-lite.sh recover on startup — cleans up crash state and stale worktrees.
 */
export function forgeRecover(workdir: string): void {
  try {
    if (!fs.existsSync(FORGE_LITE)) return;
    const output = forgeExec('recover', workdir, 30_000);
    if (output) slog('FORGE', output);
  } catch { /* best effort */ }
}

/**
 * Get forge slot status — returns parsed slot info for monitoring/API.
 */
export interface ForgeSlotStatus {
  total: number;
  busy: number;
  free: number;
  source: 'plugin' | 'bundled';
}

export function forgeStatus(workdir: string): ForgeSlotStatus | null {
  try {
    if (!fs.existsSync(FORGE_LITE)) return null;
    const output = forgeExec('status', workdir);
    // Last line: "total=3 busy=1 free=2"
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

function logForgeOutcome(taskId: string, outcome: ForgeOutcome, status: string, durationMs?: number): void {
  try {
    const instanceDir = getInstanceDir(getCurrentInstanceId());
    const logPath = path.join(instanceDir, 'forge-log.jsonl');
    const entry = {
      ts: new Date().toISOString(),
      taskId,
      ...outcome,
      taskStatus: status,
      durationMs,
    };
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
  } catch { /* fire-and-forget */ }
}

/**
 * Log structured delegation lifecycle record for ALL task types.
 * Compound value: accumulates into "which type succeeds?", "avg duration?", "codex vs claude?" insights.
 */
function logDelegationLifecycle(result: TaskResult, provider: Provider): void {
  try {
    const instanceDir = getInstanceDir(getCurrentInstanceId());
    const logPath = path.join(instanceDir, 'delegation-lifecycle.jsonl');
    const entry = {
      ts: result.completedAt ?? new Date().toISOString(),
      id: result.id,
      type: result.type ?? 'code',
      provider,
      status: result.status,
      durationMs: result.duration,
      confidence: result.confidence ?? null,
      verifyPassed: result.verifyResults?.filter(v => v.passed).length ?? null,
      verifyTotal: result.verifyResults?.length ?? null,
      forged: !!result.forge,
      forgeMerged: result.forge?.merged ?? false,
      outputLen: result.output.length,
    };
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
  } catch { /* fire-and-forget */ }
}

const JOURNAL_MAX_ENTRIES = 100;

/**
 * Extract a useful summary from delegation output.
 * Instead of blindly taking the first N chars (which captures THINK preambles),
 * strips thinking blocks, looks for conclusion sections, or takes the last N chars.
 */
export function extractDelegationSummary(output: string, maxLen: number): string {
  if (!output) return '';

  let text = output;

  // Strip thinking blocks
  text = text.replace(/<ktml:thinking>[\s\S]*?<\/ktml:thinking>/g, '');
  text = text.replace(/<thinking>[\s\S]*?<\/thinking>/g, '');

  // Strip forge suffix noise
  text = text.replace(/\[forge\] merge skipped \([^)]*\)\s*$/, '').trim();

  const cleaned = text.replace(/\n/g, ' ').trim();
  if (cleaned.length <= maxLen) return cleaned;

  // Look for conclusion markers (heading-prefixed or bare with colon)
  const conclusionMatch = text.match(
    /#{2,3}\s*(?:\d+\.\s*)?(?:FINAL ANSWER|Conclusion|結論|Summary|摘要|Key Findings?|Results?|結果)/i
  ) ?? text.match(
    /(?:^|\n)\s*(?:結論|Conclusion|FINAL ANSWER)[：:]/i
  );
  if (conclusionMatch && conclusionMatch.index !== undefined) {
    const fromConclusion = text.slice(conclusionMatch.index).replace(/\n/g, ' ').trim();
    if (fromConclusion.length > 30) {
      return fromConclusion.slice(0, maxLen);
    }
  }

  // Check if output starts with a THINK/reasoning preamble
  const startsWithThink = /^(?:#{1,3}\s*(?:\d+\.\s*)?THINK|I am verifying|Let me (?:think|analyze|verify))/i.test(text.trim());
  if (startsWithThink) {
    // Reasoning-heavy output — take the last N chars (conclusions are at the end)
    return '…' + cleaned.slice(-(maxLen - 1));
  }

  // Output starts with content (not reasoning) — first N chars is fine
  return cleaned.slice(0, maxLen);
}

/**
 * Persist delegation result (including output summary) to a rolling journal.
 * This ensures tentacle knowledge survives beyond the one-cycle <background-completed> window.
 */
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

    // Rolling cap: trim to last JOURNAL_MAX_ENTRIES
    try {
      const lines = fs.readFileSync(journalPath, 'utf-8').split('\n').filter(Boolean);
      if (lines.length > JOURNAL_MAX_ENTRIES + 20) {
        fs.writeFileSync(journalPath, lines.slice(-JOURNAL_MAX_ENTRIES).join('\n') + '\n');
      }
    } catch { /* trim is best-effort */ }
  } catch { /* fire-and-forget */ }
}

/**
 * Build a compact summary of recent delegation completions from the journal.
 * Read-only — does not consume or remove lane-output files.
 * Used by foreground lane for cross-lane awareness.
 */
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
        if (new Date(entry.ts).getTime() >= cutoff) {
          recent.push(entry);
        }
      } catch { /* skip malformed lines */ }
    }

    if (recent.length === 0) return null;

    // Format compact summary, newest first
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

// =============================================================================
// State
// =============================================================================

const activeTasks = new Map<string, { process: ChildProcess; result: TaskResult }>();
const completedTasks = new Map<string, TaskResult>();
const queue: Array<{ task: DelegationTask; resolve: (id: string) => void }> = [];

// =============================================================================
// Sibling Awareness — let concurrent delegations know about each other
// =============================================================================

/**
 * Kill all active delegation child processes.
 * Called during graceful shutdown to prevent orphaned subprocesses.
 */
export function killAllDelegations(): number {
  let killed = 0;
  for (const [, { process: child }] of activeTasks) {
    if (child?.pid) {
      try { child.kill('SIGTERM'); killed++; } catch { /* already dead */ }
    }
  }
  return killed;
}

/** Expose delegation capacity to decision layer — callers can check before spawning */
export function getDelegationCapacity(): { active: number; queued: number; max: number; available: number } {
  const active = [...activeTasks.values()].filter(t => t.result.status === 'running').length;
  return { active, queued: queue.length, max: MAX_CONCURRENT, available: Math.max(0, MAX_CONCURRENT - active) };
}

/** Get summaries of all currently running delegations for sibling awareness */
export function getActiveDelegationSummaries(): Array<{ id: string; type: string; prompt: string }> {
  const summaries: Array<{ id: string; type: string; prompt: string }> = [];
  for (const [id, { result }] of activeTasks) {
    if (result.status !== 'running') continue;
    // Read original prompt from spec file (result doesn't store prompt)
    let prompt = '';
    try {
      const specPath = path.join(getDelegationDir(id), 'spec.json');
      const spec = JSON.parse(fs.readFileSync(specPath, 'utf-8')) as DelegationTask;
      prompt = spec.prompt.slice(0, 120);
    } catch {
      prompt = '(unknown)';
    }
    summaries.push({ id, type: result.type ?? 'code', prompt });
  }
  return summaries;
}

// =============================================================================
// Path Helpers
// =============================================================================

function getDelegationDir(taskId: string): string {
  const instanceId = getCurrentInstanceId();
  return path.join(getInstanceDir(instanceId), 'delegations', taskId);
}

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Spawn an async delegation task. Returns taskId immediately.
 */
export function spawnDelegation(task: DelegationTask): string {
  const taskId = task.id ?? `del-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  // Resolve type-specific defaults
  const taskType = task.type ?? 'code';
  const typeDefaults = TYPE_DEFAULTS[taskType];
  const originalProvider = task.provider ?? typeDefaults.provider;
  const matchedKeywords = BROWSER_ROUTING_KEYWORDS.filter((keyword) =>
    task.prompt.toLowerCase().includes(keyword.toLowerCase())
  );
  const shouldForceBrowserProvider = matchedKeywords.length > 0 && taskType !== 'code';
  const provider = shouldForceBrowserProvider ? 'codex' : originalProvider;
  if (shouldForceBrowserProvider && provider !== originalProvider) {
    slog('behavior', 'delegation routing gate: browser task forced to codex', {
      keywords: matchedKeywords,
      originalProvider,
    });
  }
  const maxTurns = Math.min(task.maxTurns ?? typeDefaults.maxTurns, MAX_TURNS_CAP);
  const timeoutMs = Math.min(task.timeoutMs ?? typeDefaults.timeoutMs, MAX_TIMEOUT_CAP);
  const allowedTools = task.allowedTools ?? typeDefaults.tools;

  // Resolve workdir (expand ~)
  const workdir = task.workdir.replace(/^~/, process.env.HOME ?? '');

  const normalizedTask: DelegationTask = {
    ...task,
    id: taskId,
    provider,
    maxTurns,
    timeoutMs,
    allowedTools,
    workdir,
  };

  // Browse concurrency limit (Chrome is resource-heavy — max 1 browse at a time)
  if (taskType === 'browse') {
    const activeBrowse = [...activeTasks.values()].filter(t => t.result.type === 'browse' && t.result.status === 'running');
    if (activeBrowse.length >= 1) {
      slog('DELEGATION', `Queued browse ${taskId} (1 browse already active)`);
      queue.push({ task: normalizedTask, resolve: () => {} });
      const result: TaskResult = { id: taskId, type: 'browse', status: 'running', startedAt: new Date().toISOString(), output: '(queued — browse slot busy)' };
      activeTasks.set(taskId, { process: null as unknown as ChildProcess, result });
      return taskId;
    }
  }

  // Check concurrency
  if (activeTasks.size >= MAX_CONCURRENT) {
    slog('DELEGATION', `Queued ${taskId} (${activeTasks.size}/${MAX_CONCURRENT} active)`);
    queue.push({
      task: normalizedTask,
      resolve: () => {}, // id already known
    });
    // Create result entry as queued/running
    const result: TaskResult = {
      id: taskId,
      status: 'running',
      startedAt: new Date().toISOString(),
      output: '(queued — waiting for slot)',
    };
    activeTasks.set(taskId, { process: null as unknown as ChildProcess, result });
    // Dequeue will actually spawn
    return taskId;
  }

  startTask(normalizedTask);

  // Write activity journal on delegation start (visible to ask/foreground lanes)
  writeActivity({
    lane: 'background',
    summary: `started ${taskType}: ${task.prompt.slice(0, 120)}`,
    tags: ['started'],
  });

  return taskId;
}

/**
 * List all tasks (active + optionally completed).
 */
/** Get a specific task result by ID (active or completed). */
export function getTaskResult(taskId: string): TaskResult | undefined {
  return activeTasks.get(taskId)?.result ?? completedTasks.get(taskId);
}

/**
 * Await a delegation task's completion. Returns the TaskResult when done.
 * Used by Wave Chaining: Wave N+1 waits for Wave N to finish before spawning.
 * If already completed, resolves immediately. Rejects on timeout.
 */
export function awaitDelegation(taskId: string, timeoutMs = 600_000): Promise<TaskResult> {
  return new Promise((resolve, reject) => {
    // Already completed?
    const completed = completedTasks.get(taskId);
    if (completed) { resolve(completed); return; }

    // Not even tracked? Might have been cleaned up
    const active = activeTasks.get(taskId);
    if (!active) {
      reject(new Error(`Unknown delegation: ${taskId}`));
      return;
    }

    // Already finished (status changed but not yet moved to completedTasks)
    if (active.result.status !== 'running') {
      resolve(active.result);
      return;
    }

    // Listen for completion event
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
      // Fetch final result (might be in completedTasks by now)
      const result = completedTasks.get(taskId) ?? activeTasks.get(taskId)?.result;
      if (result) resolve(result);
      else reject(new Error(`Result disappeared: ${taskId}`));
    };

    eventBus.on('action:delegation-complete', handler);
  });
}

export function listTasks(options?: { includeCompleted?: boolean }): TaskResult[] {
  const results: TaskResult[] = [];
  for (const { result } of activeTasks.values()) {
    results.push(result);
  }
  if (options?.includeCompleted) {
    for (const result of completedTasks.values()) {
      results.push(result);
    }
  }
  return results;
}

/**
 * Cleanup completed tasks older than 24h (in-memory + disk).
 */
export function cleanupTasks(): void {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;

  // Clean in-memory map
  for (const [id, result] of completedTasks) {
    if (result.completedAt && new Date(result.completedAt).getTime() < cutoff) {
      completedTasks.delete(id);
    }
  }

  // Clean disk: remove delegation directories older than 24h
  try {
    const instanceId = getCurrentInstanceId();
    const delegationsDir = path.join(getInstanceDir(instanceId), 'delegations');
    if (!fs.existsSync(delegationsDir)) return;

    for (const entry of fs.readdirSync(delegationsDir)) {
      if (!entry.startsWith('del-')) continue;
      // Skip if still active in memory
      if (activeTasks.has(entry)) continue;

      const dir = path.join(delegationsDir, entry);
      try {
        const stat = fs.statSync(dir);
        if (stat.mtimeMs < cutoff) {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      } catch { /* best effort */ }
    }
  } catch { /* best effort */ }
}

// =============================================================================
// Spawn Helpers
// =============================================================================

function spawnWithSandbox(
  cmd: string, args: string[],
  opts: Parameters<typeof spawn>[2],
  sandbox: SandboxWrapper | null,
): ChildProcess {
  if (sandbox) {
    return spawn(sandbox.cmd, [...sandbox.prefixArgs, cmd, ...args], opts);
  }
  return spawn(cmd, args, opts);
}

/** Per-type output expectations — defines what good output looks like */
function getThinkingPreamble(type: string): string {
  switch (type) {
    case 'research':
      return `Your goal: verified evidence for the question below.
What counts: facts with source URLs. Flag unverified as [UNVERIFIED].
What doesn't count: fabricated URLs, names, or data.
Caller-supplied facts (URLs, repo names, star counts, numbers in the prompt) are UNVERIFIED caller claims — the caller may have misremembered or hallucinated them. Independently verify (curl/gh/search) before building on them. If verification fails, lead with "⚠️ Could not verify [claim] — [what I found instead]" and proceed from primary source, not from the unverified claim.
Lead with the answer. Under 500 words.

`;
    case 'learn':
      return `Your goal: fill a specific knowledge gap with real information.
What counts: insights based on sources you actually read. Flag guesses as [UNVERIFIED].
What doesn't count: fabricated URLs, names, or sources.
Caller-supplied facts (URLs, repo names, star counts, numbers in the prompt) are UNVERIFIED caller claims — the caller may have misremembered or hallucinated them. Independently verify (curl/gh/search) before building on them. If verification fails, lead with "⚠️ Could not verify [claim] — [what I found instead]" and proceed from primary source, not from the unverified claim.
Lead with the key insight. Under 500 words.

`;
    case 'review':
      return `Your goal: honest assessment based on actual code/content.
What counts: real issues found by inspecting the actual content.
What doesn't count: fabricated issues or guesses about code you didn't read.
Use Grep to find references before declaring code unused. Check imports and call sites.

`;
    case 'create':
      return `Your goal: output that matches the intent and feels genuine, not generic.

`;
    case 'plan':
      return `Your goal: analyze the problem and produce a concrete implementation plan.
You have READ-ONLY access — no writing or editing. Focus on:
- Understanding the current code structure (read files, search patterns)
- Identifying the specific files and functions that need changes
- Listing concrete steps with file paths and line numbers
- Flagging risks, trade-offs, and dependencies
Output: numbered steps, each with file:line target and what to change.

`;
    case 'debug':
      return `Your goal: diagnose the root cause of the issue described below.
You have DIAGNOSTIC access — you can run commands and read files, but cannot edit.
- Start with the error/symptom, trace backwards to the source
- Distinguish symptoms from root cause — fix the source, not the output
- Use grep/glob to find related code paths, run commands to reproduce
- Provide evidence: file:line, actual vs expected values, reproduction steps
Output: root cause with evidence, then recommended fix (but don't apply it).

`;
    default: // code — CC-inspired methodology
      return `Your goal: make the requested code change correctly and completely.
Methodology:
- Read existing code before editing — understand context first
- Use Edit (old_string/new_string) for existing files, Write only for new files
- Use Grep/Glob for code navigation, not Bash grep/find
- If the LSP tool is available, use it for goToDefinition and findReferences
- After changes, verify: run typecheck (pnpm tsc --noEmit) or tests if relevant
- One focused change per task — don't refactor unrelated code

`;
  }
}

function buildDelegationPrompt(task: DelegationTask, forgeConstraint: string): string {
  const taskType = task.type ?? 'code';
  const preamble = getThinkingPreamble(taskType);
  const base = task.context
    ? `<context>\n${task.context}\n</context>\n\n${preamble}${task.prompt}`
    : `${preamble}${task.prompt}`;
  const provider = task.provider ?? TYPE_DEFAULTS[taskType].provider;
  // Local LLM: append confidence self-assessment instruction
  const confidenceSuffix = provider === 'local'
    ? '\n\nAt the very end of your response, rate your confidence in this answer on a scale of 1-10 using exactly this format: [CONFIDENCE: N]'
    : '';
  return base + forgeConstraint + confidenceSuffix;
}

// =============================================================================
// Internal — Task Execution
// =============================================================================

function startTask(task: DelegationTask): void {
  const taskId = task.id!;
  const dir = getDelegationDir(taskId);
  fs.mkdirSync(dir, { recursive: true });

  // Write spec
  fs.writeFileSync(path.join(dir, 'spec.json'), JSON.stringify(task, null, 2));

  const result: TaskResult = {
    id: taskId,
    type: task.type ?? 'code',
    status: 'running',
    startedAt: new Date().toISOString(),
    output: '',
  };

  // Branch: shell executor / codex executor / claude CLI executor
  const taskType = task.type ?? 'code';
  const provider = task.provider ?? TYPE_DEFAULTS[taskType].provider;
  // Forge worktree for non-shell tasks — slime mold isolation
  let effectiveWorkdir = task.workdir;
  let forgeWorktreePath: string | null = null;
  if (taskType !== 'shell' && taskType !== 'browse') {
    if (task.forgeWorktree && fs.existsSync(task.forgeWorktree)) {
      // Resume: reuse existing forge worktree (has partial work)
      forgeWorktreePath = task.forgeWorktree;
      effectiveWorkdir = forgeWorktreePath;
      slog('DELEGATION', `Forge resume worktree: ${forgeWorktreePath}`);
    } else {
      forgeWorktreePath = forgeCreate(taskId, task.workdir, taskType);
      if (forgeWorktreePath) {
        effectiveWorkdir = forgeWorktreePath;
        slog('DELEGATION', `Forge worktree: ${forgeWorktreePath}`);
      }
    }
  }

  // Forge isolation: snapshot main dir git state BEFORE delegate runs
  // After delegate finishes, any new dirty files in main = isolation leak → auto-revert
  let mainDirtyBefore = new Set<string>();
  if (forgeWorktreePath) {
    try {
      const status = execSync('git status --porcelain', { cwd: task.workdir, encoding: 'utf-8' });
      for (const line of status.split('\n')) {
        const file = line.slice(3).trim();
        if (file) mainDirtyBefore.add(file);
      }
    } catch { /* best effort */ }
  }

  // Forge sandbox: kernel-level file write isolation (macOS sandbox-exec / Linux Landlock)
  const sandbox = forgeWorktreePath
    ? buildSandbox(path.resolve(task.workdir), path.resolve(forgeWorktreePath))
    : null;
  if (sandbox) {
    slog('DELEGATION', `Sandbox (${sandbox.platform}) enabled for ${taskId}: writes blocked to ${task.workdir}`);
  }

  // Forge prompt hint (soft guidance — sandbox is the real enforcement)
  const forgeConstraint = forgeWorktreePath
    ? `\n\nYou are working in an isolated git worktree: ${forgeWorktreePath}\nUse only relative paths. All changes will be merged back to main when complete.`
    : '';

  let child: ChildProcess;
  const isLocal = taskType !== 'shell' && provider === 'local';
  const isCodex = taskType !== 'shell' && provider === 'codex';

  if (taskType === 'browse') {
    // Browse executor — browser-use + ChatClaudeCLI (Python subprocess)
    const browserUseVenv = path.resolve(process.env.HOME ?? '', '.mini-agent-subprocess/browser-use-workspace/.venv/bin/python');
    const runnerScript = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../scripts/browser-use-run.py');
    slog('DELEGATION', `Starting browse ${taskId}: "${task.prompt.slice(0, 80)}..." (${Math.round((task.timeoutMs ?? DEFAULT_TIMEOUT) / 1000)}s timeout)`);
    child = spawn(browserUseVenv, [runnerScript], {
      cwd: task.workdir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    child.stdin!.write(task.prompt);
    child.stdin!.end();
  } else if (taskType === 'shell') {
    // Shell executor — run prompt as bash command directly.
    // Auto-wrap with rtk for single-line read-only commands (ls/find/tree/grep/diff/wc)
    // — ~60% output compression on ls-family, graceful fallback if rtk missing.
    const trimmed = task.prompt.trim();
    const isSingleLine = !/[\n;|&]/.test(trimmed);
    const rtkSafe = /^(ls|find|tree|grep|diff|wc)\b/.test(trimmed);
    const bashCmd = isSingleLine && rtkSafe
      ? `command -v rtk >/dev/null 2>&1 && rtk ${trimmed} || ${trimmed}`
      : task.prompt;
    slog('DELEGATION', `Starting shell ${taskId}: "${bashCmd.slice(0, 80)}..." (${Math.round((task.timeoutMs ?? DEFAULT_TIMEOUT) / 1000)}s timeout)`);
    child = spawn('bash', ['-c', bashCmd], {
      cwd: effectiveWorkdir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
  } else if (isLocal) {
    // Local LLM executor — lightweight delegate via oMLX/OpenAI-compatible API
    const fullPrompt = buildDelegationPrompt(task, forgeConstraint);
    const localScript = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../scripts/local-delegate.mjs');
    slog('DELEGATION', `Starting local ${taskId}: "${task.prompt.slice(0, 80)}..." (${Math.round((task.timeoutMs ?? DEFAULT_TIMEOUT) / 1000)}s timeout)`);
    child = spawnWithSandbox('node', [localScript], {
      cwd: effectiveWorkdir, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, LOCAL_LLM_PROFILE: 'fast' }, detached: true,
    }, sandbox);
    child.stdin!.write(fullPrompt);
    child.stdin!.end();
  } else if (isCodex) {
    // Codex CLI executor — cheaper than Claude for code/learn/research
    const codexArgs = ['exec', '--dangerously-bypass-approvals-and-sandbox', '--json'];
    if (process.env.CODEX_MODEL) {
      codexArgs.push('-m', process.env.CODEX_MODEL);
    }
    const codexEnv = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => k !== 'OPENAI_API_KEY'),
    );
    const fullPrompt = buildDelegationPrompt(task, forgeConstraint);

    slog('DELEGATION', `Starting codex ${taskId}: "${task.prompt.slice(0, 80)}..." (${Math.round((task.timeoutMs ?? DEFAULT_TIMEOUT) / 1000)}s timeout)`);
    child = spawnWithSandbox('codex', codexArgs, {
      cwd: effectiveWorkdir, stdio: ['pipe', 'pipe', 'pipe'], env: codexEnv, detached: true,
    }, sandbox);
    child.stdin!.write(fullPrompt);
    child.stdin!.end();
  } else {
    // Claude CLI executor
    const fullPrompt = buildDelegationPrompt(task, forgeConstraint);

    let systemPrompt = 'You are Kuro\'s delegate. Complete the task and output the result. Never fabricate URLs, names, or data — if you cannot verify something, say so. Your caller handles communication, so do not post to chat rooms or send notifications.';

    // Akari: inject identity + accumulated context
    if (taskType === 'akari') {
      const akariDir = path.join(task.workdir, 'memory', 'akari');
      const soulPath = path.join(akariDir, 'SOUL.md');
      const ctxPath = path.join(akariDir, 'context.md');
      let akariContext = '';
      try { akariContext += '\n\n<akari-identity>\n' + fs.readFileSync(soulPath, 'utf-8') + '\n</akari-identity>'; } catch { /* SOUL.md missing */ }
      try { akariContext += '\n\n<akari-context>\n' + fs.readFileSync(ctxPath, 'utf-8') + '\n</akari-context>'; } catch { /* context.md missing */ }
      // Load Alex's feedback memories as orientation
      const feedbackDir = path.resolve(process.env.HOME ?? '/tmp', '.claude/projects/-Users-user--mini-agent-subprocess/memory');
      try {
        const feedbackFiles = fs.readdirSync(feedbackDir).filter(f => f.startsWith('feedback_'));
        if (feedbackFiles.length > 0) {
          const feedbackContent = feedbackFiles.map(f => {
            try { return fs.readFileSync(path.join(feedbackDir, f), 'utf-8').trim(); } catch { return ''; }
          }).filter(Boolean).join('\n---\n');
          akariContext += '\n\n<alex-feedback-compass>\n' + feedbackContent + '\n</alex-feedback-compass>';
        }
      } catch { /* feedback dir missing */ }
      systemPrompt = 'You are Akari（あかり）, Kuro\'s analytical partner. Read your <akari-identity> to understand who you are. Read <akari-context> for accumulated cross-invocation context. Read <alex-feedback-compass> to understand Alex\'s constraints on Kuro — flag when Kuro drifts from these.\n\nEvery response MUST include: (1) direct answer with confidence + evidence, (2) blindSpots — things not asked but relevant, (3) meta — pattern/bias/better-question observations about Kuro. When uncertain, say "I don\'t know" with specifics about what would change the answer.' + akariContext;
    }

    const args = [
      '-p', fullPrompt,
      '--allowedTools', (task.allowedTools ?? DEFAULT_TOOLS).join(','),
      '--setting-sources', 'user',
      '--strict-mcp-config',
      '--append-system-prompt', systemPrompt,
    ];

    slog('DELEGATION', `Starting claude ${taskId}: "${task.prompt.slice(0, 80)}..." (max ${task.maxTurns} turns, ${Math.round((task.timeoutMs ?? DEFAULT_TIMEOUT) / 1000)}s timeout)`);
    child = spawnWithSandbox('claude', args, {
      cwd: effectiveWorkdir, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env },
    }, sandbox);
  }

  activeTasks.set(taskId, { process: child, result });

  // Persist for crash recovery
  saveToStateFile({
    taskId,
    pid: child.pid!,
    startedAt: result.startedAt,
    timeoutMs: task.timeoutMs ?? DEFAULT_TIMEOUT,
    worktree: forgeWorktreePath ?? undefined,
    workdir: task.workdir,
  });

  // Collect output
  let output = '';
  const outputPath = path.join(dir, 'output.txt');

  child.stdout?.on('data', (chunk: Buffer) => {
    if (output.length < MAX_OUTPUT_BUFFER_CHARS) {
      output += chunk.toString();
      if (output.length >= MAX_OUTPUT_BUFFER_CHARS) {
        output = output.slice(0, MAX_OUTPUT_BUFFER_CHARS) + `\n[TRUNCATED: output exceeded ${MAX_OUTPUT_BUFFER_CHARS} chars — keeping first ${MAX_OUTPUT_BUFFER_CHARS} chars]`;
        slog('DELEGATION', `Output buffer cap reached for ${taskId} (${MAX_OUTPUT_BUFFER_CHARS} chars)`);
      }
    }
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    if (output.length < MAX_OUTPUT_BUFFER_CHARS) {
      output += chunk.toString();
    }
  });

  // Timeout handler
  let processExited = false;
  const killChild = (signal: NodeJS.Signals) => {
    try {
      // For detached processes (codex/local), kill the entire process group
      if ((isCodex || isLocal) && child.pid) {
        process.kill(-child.pid, signal);
      } else {
        child.kill(signal);
      }
    } catch { /* already dead */ }
  };
  const timeout = setTimeout(() => {
    slog('DELEGATION', `Timeout ${taskId} after ${Math.round((task.timeoutMs ?? DEFAULT_TIMEOUT) / 1000)}s`);
    killChild('SIGTERM');
    // Give it 5s to clean up, then force kill
    setTimeout(() => {
      if (!processExited) killChild('SIGKILL');
    }, 5000);
    result.status = 'timeout';
  }, task.timeoutMs ?? DEFAULT_TIMEOUT);

  // Completion handler — try/finally ensures cleanup ALWAYS runs (no zombie tasks)
  child.on('close', async (code) => {
    processExited = true;
    clearTimeout(timeout);

    try {
      // Write output file
      try { fs.writeFileSync(outputPath, output); } catch { /* best effort */ }

      // Tail output for result — parse codex JSONL to extract agent_message text
      if (isCodex) {
        const parsed = parseCodexOutput(output);
        result.output = parsed || (output.length > OUTPUT_TAIL_CHARS ? output.slice(-OUTPUT_TAIL_CHARS) : output);
      } else {
        result.output = output.length > OUTPUT_TAIL_CHARS
          ? output.slice(-OUTPUT_TAIL_CHARS)
          : output;
      }

      // Parse confidence self-assessment from local LLM output
      const confMatch = result.output.match(/\[CONFIDENCE:\s*(\d+)\]/);
      if (confMatch) {
        result.confidence = Math.min(10, Math.max(1, parseInt(confMatch[1], 10)));
        result.output = result.output.replace(/\s*\[CONFIDENCE:\s*\d+\]\s*$/, '').trim();
      }

      // Only update status if not already set to timeout
      if (result.status !== 'timeout') {
        result.status = code === 0 ? 'completed' : 'failed';
      }

      // CC absorption Phase 3b: auto-inject typecheck for code delegations (hard gate)
      // Insight: CC enforces "read before edit" as a tool-level hard gate.
      // We apply the same principle: code delegations that modify TS must pass typecheck.
      const verifyCommands = [...(task.verify ?? [])];
      if (result.status === 'completed' && (task.type === 'code' || task.type === 'akari')) {
        const tsconfigExists = fs.existsSync(path.join(effectiveWorkdir, 'tsconfig.json'));
        if (tsconfigExists && !verifyCommands.some(c => c.includes('tsc'))) {
          verifyCommands.push('npx tsc --noEmit 2>&1 | head -20');
        }
      }

      // Run verify commands (in forge worktree if active)
      if (verifyCommands.length > 0) {
        result.verifyResults = await runVerifyCommands(verifyCommands, effectiveWorkdir);
        const allPassed = result.verifyResults.every(v => v.passed);
        if (!allPassed && result.status === 'completed') {
          result.status = 'failed';
        }
      }

      // Forge isolation enforcement: detect and revert leaked changes in main dir
      // Exclude dirs that Kuro's own loop modifies concurrently (not written by delegations)
      const CONCURRENT_DIRS = ['memory/state/', 'memory/conversations/', 'memory/topics/'];
      if (forgeWorktreePath) {
        try {
          const statusAfter = execSync('git status --porcelain', { cwd: task.workdir, encoding: 'utf-8' });
          const leaked: string[] = [];
          for (const line of statusAfter.split('\n')) {
            const file = line.slice(3).trim();
            if (file && !mainDirtyBefore.has(file) && !CONCURRENT_DIRS.some(d => file.startsWith(d))) leaked.push(file);
          }
          if (leaked.length > 0) {
            slog('FORGE', `Isolation breach detected in ${taskId}: ${leaked.length} file(s) leaked to main dir — reverting`);
            for (const file of leaked) {
              try {
                // Revert tracked files, remove untracked files
                const statusLine = statusAfter.split('\n').find(l => l.slice(3).trim() === file) ?? '';
                if (statusLine.startsWith('?')) {
                  fs.unlinkSync(path.join(task.workdir, file));
                } else {
                  execSync(`git checkout -- "${file}"`, { cwd: task.workdir });
                }
              } catch { /* best effort per file */ }
            }
            result.output += `\n[forge] isolation breach: ${leaked.length} file(s) reverted from main dir (${leaked.slice(0, 5).join(', ')})`;
          }
        } catch { /* best effort */ }
      }

      // Forge: merge successful changes back to main, or cleanup
      if (forgeWorktreePath) {
        const forgeOutcome: ForgeOutcome = { worktree: forgeWorktreePath, created: true, merged: false, cleaned: false };
        if (result.status === 'completed') {
          const merged = forgeYolo(forgeWorktreePath, task.workdir, task.prompt.slice(0, 80));
          forgeOutcome.merged = merged;
          if (!merged) {
            result.output += '\n[forge] merge skipped (verify failed or no changes)';
            forgeCleanup(forgeWorktreePath, task.workdir);
            forgeOutcome.cleaned = true;
          }
        } else {
          // Failed/timeout: leave worktree for diagnosis
          // forge-lite.sh auto-reclaims when subprocess PID is dead (FORGE_SLOT_TTL_MINUTES)
          slog('FORGE', `Keeping failed worktree ${forgeWorktreePath} for diagnosis (forge auto-reclaim on next create)`);
          forgeOutcome.cleaned = false;
        }
        result.forge = forgeOutcome;
        logForgeOutcome(taskId, forgeOutcome, result.status, result.duration);
      }

      const verifyStr = result.verifyResults
        ? ` (${result.verifyResults.filter(v => v.passed).length}/${result.verifyResults.length} verify passed)`
        : '';
      slog('DELEGATION', `Finished ${taskId}: ${result.status}${verifyStr} in ${Math.round((result.duration ?? 0) / 1000)}s`);
      eventBus.emit('action:delegation-complete', { taskId, status: result.status, type: result.type, outputPreview: result.output.slice(0, 500) });
      // Phase 3b: Auto-update task-queue if this delegation has an originTask
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
    } catch (err) {
      slog('DELEGATION', `Close handler error ${taskId}: ${err}`);
      if (result.status === 'running') result.status = 'failed';
    } finally {
      // MUST always execute — prevents zombie tasks and stuck queues
      result.completedAt ??= new Date().toISOString();
      result.duration ??= Date.now() - new Date(result.startedAt).getTime();
      logDelegationLifecycle(result, provider);
      persistDelegationResult(result);
      try { fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2)); } catch {}
      activeTasks.delete(taskId);
      completedTasks.set(taskId, result);
      writeLaneOutput(result);
      removeFromStateFile(taskId);
      dequeueNext();
    }
  });

  child.on('error', (err) => {
    clearTimeout(timeout);
    result.status = 'failed';
    result.output = `spawn error: ${err.message}`;
    result.completedAt = new Date().toISOString();
    result.duration = Date.now() - new Date(result.startedAt).getTime();

    activeTasks.delete(taskId);
    completedTasks.set(taskId, result);
    removeFromStateFile(taskId);

    slog('DELEGATION', `Error ${taskId}: ${err.message}`);
    eventBus.emit('action:delegation-complete', { taskId, status: 'failed' });
    writeActivity({
      lane: 'background',
      summary: `${result.type ?? 'code'} failed: ${err.message.slice(0, 100)}`,
      tags: ['failed'],
      duration: result.duration,
    });

    dequeueNext();
  });
}

/**
 * Write task result to lane-output/ for main cycle consumption.
 */
function writeLaneOutput(result: TaskResult): void {
  try {
    const instanceId = getCurrentInstanceId();
    const laneDir = path.join(getInstanceDir(instanceId), 'lane-output');
    fs.mkdirSync(laneDir, { recursive: true });
    fs.writeFileSync(
      path.join(laneDir, `${result.id}.json`),
      JSON.stringify(result, null, 2)
    );
  } catch { /* best effort */ }
}

function dequeueNext(): void {
  if (queue.length === 0) return;
  if (activeTasks.size >= MAX_CONCURRENT) return;

  const next = queue.shift()!;
  // Remove the placeholder entry
  activeTasks.delete(next.task.id!);
  startTask(next.task);
}

/**
 * Parse Codex CLI JSONL output to extract the last agent_message text.
 */
function parseCodexOutput(raw: string): string {
  let lastMessage = '';
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as { type?: string; item?: { type?: string; text?: string } };
      if (event.type === 'item.completed' && event.item?.type === 'agent_message' && event.item.text) {
        lastMessage = event.item.text;
      }
    } catch { /* ignore malformed JSONL lines */ }
  }
  return lastMessage;
}

async function runVerifyCommands(commands: string[], workdir: string): Promise<VerifyResult[]> {
  const { execSync } = await import('node:child_process');
  const results: VerifyResult[] = [];

  for (const cmd of commands) {
    try {
      const output = execSync(cmd, {
        cwd: workdir,
        timeout: 30_000,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      results.push({ cmd, passed: true, output: output.slice(0, 1000) });
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      const combined = (e.stdout ?? '') + (e.stderr ?? '');
      const output = combined || (e.message ?? 'unknown error');
      results.push({ cmd, passed: false, output: output.slice(0, 1000) });
    }
  }

  return results;
}

// =============================================================================
// Startup Recovery — kill orphans, release slots, clean up
// =============================================================================

/**
 * Called on startup to recover delegations from a previous crashed instance.
 * Kills orphan processes, then re-spawns tasks that had work in progress.
 * Tasks with forge worktrees containing partial changes get resumed (not lost).
 */
export function recoverStaleDelegations(): void {
  try {
    const filePath = getStateFilePath();
    if (!fs.existsSync(filePath)) return;

    let entries: ActiveDelegationState[] = [];
    try { entries = JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch { return; }
    if (entries.length === 0) return;

    slog('DELEGATION', `Recovering ${entries.length} stale delegation(s) from previous instance`);
    let resumed = 0;
    let cleaned = 0;

    for (const entry of entries) {
      // Kill orphan process (and its process group) if still alive
      try {
        process.kill(entry.pid, 0); // test if alive
        slog('DELEGATION', `Killing orphan pid ${entry.pid} (${entry.taskId})`);
        // Kill process group first (handles detached codex subprocesses)
        try { process.kill(-entry.pid, 'SIGTERM'); } catch { /* not a group leader */ }
        process.kill(entry.pid, 'SIGTERM');
        setTimeout(() => {
          try { process.kill(-entry.pid, 'SIGKILL'); } catch {}
          try { process.kill(entry.pid, 'SIGKILL'); } catch {}
        }, 3000);
      } catch { /* already dead — good */ }

      // Try to read original task spec
      const specPath = path.join(getDelegationDir(entry.taskId), 'spec.json');
      let spec: DelegationTask | null = null;
      try { spec = JSON.parse(fs.readFileSync(specPath, 'utf-8')); } catch {}

      // Check if forge worktree has partial work worth resuming
      let hasPartialWork = false;
      if (entry.worktree && fs.existsSync(entry.worktree)) {
        try {
          const diff = execSync(`git -C "${entry.worktree}" diff --name-only HEAD 2>/dev/null || true`, {
            encoding: 'utf-8', timeout: 5000,
          }).trim();
          const staged = execSync(`git -C "${entry.worktree}" diff --cached --name-only 2>/dev/null || true`, {
            encoding: 'utf-8', timeout: 5000,
          }).trim();
          hasPartialWork = !!(diff || staged);
        } catch { /* treat as no work */ }
      }

      if (spec && hasPartialWork && entry.worktree) {
        // Resume: re-spawn with existing worktree and modified prompt
        slog('DELEGATION', `Resuming ${entry.taskId} — forge worktree has partial work`);
        spawnDelegation({
          ...spec,
          id: undefined, // new task ID
          prompt: `[RESUME] This task was interrupted by a restart. The worktree has partial changes from the previous attempt. Check git diff to see what was already done, then continue and complete the task.\n\nOriginal task:\n${spec.prompt}`,
          forgeWorktree: entry.worktree,
        });
        resumed++;
      } else if (spec) {
        // No partial work — re-spawn fresh
        slog('DELEGATION', `Re-spawning ${entry.taskId} — no partial work found`);
        if (entry.worktree) forgeCleanup(entry.worktree, entry.workdir);
        spawnDelegation({ ...spec, id: undefined });
        resumed++;
      } else {
        // No spec found — just clean up
        slog('DELEGATION', `Cleaning up ${entry.taskId} — no spec found`);
        if (entry.worktree) forgeCleanup(entry.worktree, entry.workdir);
        cleaned++;
      }
    }

    // Remove only the recovered entries — preserve any new ones added by re-spawned tasks.
    // (spawnDelegation → startTask → saveToStateFile adds new entries during recovery)
    const recoveredIds = new Set(entries.map(e => e.taskId));
    try {
      let current: ActiveDelegationState[] = [];
      try { current = JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch {}
      const remaining = current.filter(e => !recoveredIds.has(e.taskId));
      fs.writeFileSync(filePath, JSON.stringify(remaining));
    } catch {
      // Fallback: clear if read fails
      fs.writeFileSync(filePath, '[]');
    }
    slog('DELEGATION', `Recovery complete: ${resumed} resumed, ${cleaned} cleaned`);
  } catch (err) {
    slog('DELEGATION', `Recovery error: ${err}`);
  }
}


// =============================================================================
// Watchdog — catch tasks stuck beyond timeout + grace period
// =============================================================================

/**
 * Periodic health check. Two thresholds:
 * - MAX_TIMEOUT_CAP + 30s: try to kill (SIGKILL process group + direct)
 * - MAX_TIMEOUT_CAP * 2: force-finalize (remove from activeTasks, write result)
 * Call from OODA cycle housekeeping.
 */
export function watchdogDelegations(): void {
  const now = Date.now();
  const forceThreshold = MAX_TIMEOUT_CAP * 2; // 20 min — absolute last resort
  for (const [taskId, { process: child, result }] of activeTasks) {
    if (!result.startedAt) continue;
    const elapsed = now - new Date(result.startedAt).getTime();

    if (elapsed > forceThreshold) {
      // Force-finalize: task is hopelessly stuck, clean up everything
      slog('DELEGATION', `Watchdog: force-finalizing stuck ${taskId} (${Math.round(elapsed / 1000)}s)`);
      try {
        if (child?.pid) {
          try { process.kill(-child.pid, 'SIGKILL'); } catch {}
          try { child.kill('SIGKILL'); } catch {}
        }
      } catch {}

      result.status = 'timeout';
      result.completedAt = new Date().toISOString();
      result.duration = elapsed;
      result.output = result.output || '(watchdog: force-finalized — process stuck beyond 2x timeout)';

      activeTasks.delete(taskId);
      completedTasks.set(taskId, result);
      writeLaneOutput(result);
      persistDelegationResult(result);
      try {
        const dir = getDelegationDir(taskId);
        fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
      } catch {}
      removeFromStateFile(taskId);
      dequeueNext();
    } else if (elapsed > MAX_TIMEOUT_CAP + 30_000) {
      // Try to kill (process group + direct)
      slog('DELEGATION', `Watchdog: killing stuck ${taskId} (${Math.round(elapsed / 1000)}s)`);
      try {
        if (child?.pid) {
          try { process.kill(-child.pid, 'SIGKILL'); } catch {}
        }
        child?.kill('SIGKILL');
      } catch {}
    }
  }
}
