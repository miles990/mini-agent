/**
 * Delegation — Async Task Executor
 *
 * 讓 Kuro 從 OODA cycle 委派多步驟 coding task 給 Claude CLI subprocess。
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

// =============================================================================
// Types
// =============================================================================

export interface DelegationTask {
  id?: string;
  prompt: string;
  workdir: string;
  maxTurns?: number;
  timeoutMs?: number;
  verify?: string[];
  allowedTools?: string[];
}

export interface VerifyResult {
  cmd: string;
  passed: boolean;
  output: string;
}

export interface TaskResult {
  id: string;
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

const MAX_CONCURRENT = 2;
const MAX_TURNS_CAP = 10;
const MAX_TIMEOUT_CAP = 600_000; // 10 min
const DEFAULT_TURNS = 5;
const DEFAULT_TIMEOUT = 300_000; // 5 min
const DEFAULT_TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'];
const OUTPUT_TAIL_CHARS = 5000;

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

  // Enforce hard caps
  const maxTurns = Math.min(task.maxTurns ?? DEFAULT_TURNS, MAX_TURNS_CAP);
  const timeoutMs = Math.min(task.timeoutMs ?? DEFAULT_TIMEOUT, MAX_TIMEOUT_CAP);
  const allowedTools = task.allowedTools ?? DEFAULT_TOOLS;

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
    status: 'running',
    startedAt: new Date().toISOString(),
    output: '',
  };

  // Build Claude CLI args
  const args = [
    '-p', task.prompt,
    '--no-input',
    '--max-turns', String(task.maxTurns),
    '--allowedTools', (task.allowedTools ?? DEFAULT_TOOLS).join(','),
  ];

  slog('DELEGATION', `Starting ${taskId}: "${task.prompt.slice(0, 80)}..." (max ${task.maxTurns} turns, ${Math.round((task.timeoutMs ?? DEFAULT_TIMEOUT) / 1000)}s timeout)`);

  const child = spawn('claude', args, {
    cwd: task.workdir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      // Prevent subprocess from reading agent identity
      MINI_AGENT_DELEGATION: '1',
    },
  });

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

    // Tail output for result
    result.output = output.length > OUTPUT_TAIL_CHARS
      ? output.slice(-OUTPUT_TAIL_CHARS)
      : output;

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

function dequeueNext(): void {
  if (queue.length === 0) return;
  if (activeTasks.size >= MAX_CONCURRENT) return;

  const next = queue.shift()!;
  // Remove the placeholder entry
  activeTasks.delete(next.task.id!);
  startTask(next.task);
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
