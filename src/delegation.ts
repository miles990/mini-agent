/**
 * Delegation — Async Task Executor
 *
 * 讓 Kuro 從 OODA cycle 委派任務。支援兩種 executor：
 * - Claude CLI subprocess（code/learn/research/create/review）— 需要語言理解
 * - Shell executor（shell）— 直接跑 bash 命令，零 Claude token
 * Fire-and-forget：spawnDelegation() 立即返回 taskId，不阻塞主 loop。
 *
 * Safety:
 * - Max 2 concurrent delegations (queued beyond that)
 * - Max 10 turns, 10 min hard cap
 * - Subprocess 不讀 SOUL.md、不寫 memory/、不發 Telegram
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { slog } from './utils.js';
import { getInstanceDir, getCurrentInstanceId } from './instance.js';
import { eventBus } from './event-bus.js';
import type { DelegationTaskType, DelegationProvider } from './types.js';

// =============================================================================
// Types
// =============================================================================

export interface DelegationTask {
  id?: string;
  type?: DelegationTaskType;
  provider?: DelegationProvider;
  prompt: string;
  workdir: string;
  maxTurns?: number;
  timeoutMs?: number;
  verify?: string[];
  allowedTools?: string[];
  context?: string;
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
  verifyResults?: VerifyResult[];
}

// =============================================================================
// Constants
// =============================================================================

const MAX_CONCURRENT = 6;
const MAX_TURNS_CAP = 10;
const MAX_TIMEOUT_CAP = 600_000; // 10 min
const DEFAULT_TURNS = 5;
const DEFAULT_TIMEOUT = 300_000; // 5 min
const DEFAULT_TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'];
const OUTPUT_TAIL_CHARS = 5000;

// Type-specific defaults for non-code delegation tasks
const TYPE_DEFAULTS: Record<DelegationTaskType, { tools: string[]; maxTurns: number; timeoutMs: number; provider: DelegationProvider }> = {
  code:     { tools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'], maxTurns: 5, timeoutMs: 300_000, provider: 'codex' },
  learn:    { tools: ['Bash', 'Read', 'Glob', 'Grep', 'WebFetch'], maxTurns: 3, timeoutMs: 300_000, provider: 'codex' },
  research: { tools: ['Bash', 'Read', 'Glob', 'Grep', 'WebFetch'], maxTurns: 5, timeoutMs: 480_000, provider: 'codex' },
  create:   { tools: ['Read', 'Write', 'Edit'], maxTurns: 5, timeoutMs: 480_000, provider: 'claude' },
  review:   { tools: ['Bash', 'Read', 'Glob', 'Grep'], maxTurns: 3, timeoutMs: 180_000, provider: 'claude' },
  shell:    { tools: [], maxTurns: 1, timeoutMs: 60_000, provider: 'claude' },
};

// =============================================================================
// State
// =============================================================================

const activeTasks = new Map<string, { process: ChildProcess; result: TaskResult }>();
const completedTasks = new Map<string, TaskResult>();
const queue: Array<{ task: DelegationTask; resolve: (id: string) => void }> = [];

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
  const maxTurns = Math.min(task.maxTurns ?? typeDefaults.maxTurns, MAX_TURNS_CAP);
  const timeoutMs = Math.min(task.timeoutMs ?? typeDefaults.timeoutMs, MAX_TIMEOUT_CAP);
  const allowedTools = task.allowedTools ?? typeDefaults.tools;

  // Resolve workdir (expand ~)
  const workdir = task.workdir.replace(/^~/, process.env.HOME ?? '');

  const normalizedTask: DelegationTask = {
    ...task,
    id: taskId,
    maxTurns,
    timeoutMs,
    allowedTools,
    workdir,
  };

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
  return taskId;
}

/**
 * Get result of a delegation task.
 */
export function getTaskResult(taskId: string): TaskResult | null {
  const active = activeTasks.get(taskId);
  if (active) return active.result;
  return completedTasks.get(taskId) ?? null;
}

/**
 * List all tasks (active + optionally completed).
 */
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
 * Cleanup completed tasks older than 24h.
 */
export function cleanupTasks(): void {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, result] of completedTasks) {
    if (result.completedAt && new Date(result.completedAt).getTime() < cutoff) {
      completedTasks.delete(id);
    }
  }
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
  let child: ChildProcess;
  const isCodex = taskType !== 'shell' && provider === 'codex';

  if (taskType === 'shell') {
    // Shell executor — run prompt as bash command directly
    slog('DELEGATION', `Starting shell ${taskId}: "${task.prompt.slice(0, 80)}..." (${Math.round((task.timeoutMs ?? DEFAULT_TIMEOUT) / 1000)}s timeout)`);
    child = spawn('bash', ['-c', task.prompt], {
      cwd: task.workdir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
  } else if (isCodex) {
    // Codex CLI executor — cheaper than Claude for code/learn/research
    const codexArgs = ['exec', '--dangerously-bypass-approvals-and-sandbox', '--json'];
    if (process.env.CODEX_MODEL) {
      codexArgs.push('-m', process.env.CODEX_MODEL);
    }
    const codexEnv = Object.fromEntries(
      Object.entries(process.env).filter(([k]) => k !== 'OPENAI_API_KEY'),
    );
    const fullPrompt = task.context
      ? `<context>\n${task.context}\n</context>\n\n${task.prompt}`
      : task.prompt;

    slog('DELEGATION', `Starting codex ${taskId}: "${task.prompt.slice(0, 80)}..." (${Math.round((task.timeoutMs ?? DEFAULT_TIMEOUT) / 1000)}s timeout)`);
    child = spawn('codex', codexArgs, {
      cwd: task.workdir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: codexEnv,
      detached: true,
    });
    child.stdin!.write(fullPrompt);
    child.stdin!.end();
  } else {
    // Claude CLI executor
    const fullPrompt = task.context
      ? `<context>\n${task.context}\n</context>\n\n${task.prompt}`
      : task.prompt;

    const args = [
      '-p', fullPrompt,
      '--no-input',
      '--max-turns', String(task.maxTurns),
      '--allowedTools', (task.allowedTools ?? DEFAULT_TOOLS).join(','),
      '--setting-sources', 'user',
      '--strict-mcp-config',
      '--append-system-prompt', 'You are Kuro\'s delegate — you represent Kuro and act on his behalf. Complete the given task and output the result. Your caller handles all communication, so do not post to chat rooms or send notifications directly.',
    ];

    slog('DELEGATION', `Starting claude ${taskId}: "${task.prompt.slice(0, 80)}..." (max ${task.maxTurns} turns, ${Math.round((task.timeoutMs ?? DEFAULT_TIMEOUT) / 1000)}s timeout)`);
    child = spawn('claude', args, {
      cwd: task.workdir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
  }

  activeTasks.set(taskId, { process: child, result });

  // Collect output
  let output = '';
  const outputPath = path.join(dir, 'output.txt');

  child.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });

  child.stderr?.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });

  // Timeout handler
  const timeout = setTimeout(() => {
    slog('DELEGATION', `Timeout ${taskId} after ${Math.round((task.timeoutMs ?? DEFAULT_TIMEOUT) / 1000)}s`);
    child.kill('SIGTERM');
    // Give it 5s to clean up, then force kill
    setTimeout(() => {
      if (!child.killed) child.kill('SIGKILL');
    }, 5000);
    result.status = 'timeout';
  }, task.timeoutMs ?? DEFAULT_TIMEOUT);

  // Completion handler
  child.on('close', async (code) => {
    clearTimeout(timeout);

    // Write output file
    try {
      fs.writeFileSync(outputPath, output);
    } catch { /* best effort */ }

    // Tail output for result — parse codex JSONL to extract agent_message text
    if (isCodex) {
      const parsed = parseCodexOutput(output);
      result.output = parsed || (output.length > OUTPUT_TAIL_CHARS ? output.slice(-OUTPUT_TAIL_CHARS) : output);
    } else {
      result.output = output.length > OUTPUT_TAIL_CHARS
        ? output.slice(-OUTPUT_TAIL_CHARS)
        : output;
    }

    // Only update status if not already set to timeout
    if (result.status !== 'timeout') {
      result.status = code === 0 ? 'completed' : 'failed';
    }

    // Run verify commands
    if (task.verify && task.verify.length > 0) {
      result.verifyResults = await runVerifyCommands(task.verify, task.workdir);
      // If any verify fails, mark as failed
      const allPassed = result.verifyResults.every(v => v.passed);
      if (!allPassed && result.status === 'completed') {
        result.status = 'failed';
      }
    }

    result.completedAt = new Date().toISOString();
    result.duration = Date.now() - new Date(result.startedAt).getTime();

    // Write result file
    try {
      fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
    } catch { /* best effort */ }

    // Move to completed
    activeTasks.delete(taskId);
    completedTasks.set(taskId, result);

    // Write to lane-output/ for main cycle consumption
    writeLaneOutput(result);

    const verifyStr = result.verifyResults
      ? ` (${result.verifyResults.filter(v => v.passed).length}/${result.verifyResults.length} verify passed)`
      : '';
    slog('DELEGATION', `Finished ${taskId}: ${result.status}${verifyStr} in ${Math.round((result.duration ?? 0) / 1000)}s`);

    // Emit event for perception
    eventBus.emit('action:delegation-complete', { taskId, status: result.status });

    // Dequeue next
    dequeueNext();
  });

  child.on('error', (err) => {
    clearTimeout(timeout);
    result.status = 'failed';
    result.output = `spawn error: ${err.message}`;
    result.completedAt = new Date().toISOString();
    result.duration = Date.now() - new Date(result.startedAt).getTime();

    activeTasks.delete(taskId);
    completedTasks.set(taskId, result);

    slog('DELEGATION', `Error ${taskId}: ${err.message}`);
    eventBus.emit('action:delegation-complete', { taskId, status: 'failed' });

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
