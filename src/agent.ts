/**
 * LLM Execution Layer (OODA-Only)
 *
 * Single loop lane: callClaude() → execProvider() → response
 */

import { spawn, execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, existsSync, readFileSync as readFileSyncFs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getMemory } from './memory.js';
import { getCurrentInstanceId, getInstanceDir } from './instance.js';
import { getLogger } from './logging.js';
import { slog, diagLog } from './utils.js';
import { getSystemPrompt } from './dispatcher.js';
import type { CycleMode } from './memory.js';
import { eventBus, debounce } from './event-bus.js';
import { createKuroChatStreamParser, stripTurnSeparators } from './tag-parser.js';
import { compactContext } from './context-compaction.js';
import { processContext, detectModelTier, type ModelTier } from './context-pipeline.js';
import { buildSmallModelPrompt } from './prompt-builder.js';
import { execClaudeViaSdk, isSdkEnabled } from './sdk-client.js';
import { execClaudeViaMiddleware, isMiddlewareCycleEnabled } from './middleware-cycle-client.js';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

// =============================================================================
// LLM Provider Abstraction
// =============================================================================

import type { Provider } from './types.js';
export type { Provider } from './types.js';

export function getProvider(): Provider {
  const p = process.env.AGENT_PROVIDER?.toLowerCase();
  if (p === 'codex') return 'codex';
  if (p === 'local') return 'local';
  return 'claude';
}

export function getFallback(): Provider | null {
  const f = process.env.AGENT_FALLBACK?.toLowerCase();
  if (f === 'codex' || f === 'claude' || f === 'local') return f as Provider;
  return null;
}

/** Source-to-provider default mapping.
 *  Overridable via AGENT_PROVIDER_{SOURCE} (e.g. AGENT_PROVIDER_ASK=local) */
const SOURCE_PROVIDER_DEFAULTS: Record<CallSource, Provider> = {
  loop: 'claude',
  foreground: 'claude',
  ask: 'local',
};

export function getProviderForSource(source: CallSource): Provider {
  // 1. Per-source env override: AGENT_PROVIDER_ASK=local
  const envKey = `AGENT_PROVIDER_${source.toUpperCase()}`;
  const envVal = process.env[envKey]?.toLowerCase();
  if (envVal === 'claude' || envVal === 'codex' || envVal === 'local') return envVal;

  // 2. Global override (backward compat)
  const global = process.env.AGENT_PROVIDER?.toLowerCase();
  if (global === 'claude' || global === 'codex' || global === 'local') return global as Provider;

  // 3. Source-specific default
  return SOURCE_PROVIDER_DEFAULTS[source];
}

export interface ExecOptions {
  source?: CallSource;
  onPartialOutput?: (text: string) => void;
  /** Override model for this call (e.g. 'sonnet' for routine cycles) */
  model?: string;
  /** Streaming chat callback — fires as soon as a complete <kuro:chat> tag is detected during generation */
  onStreamChat?: (text: string, reply: boolean) => void;
  /** Foreground slot ID for concurrent foreground tracking */
  fgSlotId?: string;
  /** Hard timeout in ms (default: 900_000 = 15min). FG lane should use shorter value. */
  timeoutMs?: number;
  /** No-progress timeout in ms (default: 300_000 = 5min). Kill if no stdout for this long. */
  progressTimeoutMs?: number;
  /** Thinking budget in tokens (Phase B — rubric-driven dynamic budget). 0 = disabled. */
  maxThinkingTokens?: number;
}

async function execProvider(provider: Provider, fullPrompt: string, opts?: ExecOptions): Promise<string> {
  if (provider === 'codex') return execCodex(fullPrompt, opts);
  if (provider === 'local') return execLocal(fullPrompt, opts);
  // Layer C (2026-04-17, expanded 2026-04-18): USE_MIDDLEWARE_FOR_CYCLE=true →
  // offload all Claude LLM calls to middleware agent-brain worker (isolated
  // event-loop). Original restriction to `source === 'loop'` removed — all
  // three lanes (loop / foreground / ask) benefit from event-loop decoupling,
  // and caller's opts.timeoutMs is honored by middleware-cycle-client.
  // Infrastructure failure (middleware down / dispatch 5xx) falls back to
  // local SDK/CLI so a middleware outage never degrades Kuro's availability.
  if (isMiddlewareCycleEnabled()) {
    try {
      return await execClaudeViaMiddleware(fullPrompt, opts);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isInfraFailure = /dispatch failed|ECONNREFUSED|fetch failed|middleware.*offline|EAI_AGAIN|ETIMEDOUT.*connect/i.test(msg);
      if (isInfraFailure) {
        slog('AGENT', `middleware path infra-failed (${msg.slice(0, 80)}) — falling back to local`);
        // fall through to SDK/CLI below
      } else {
        throw err;
      }
    }
  }
  // SDK primary (via child_process.fork — isolated OS process, non-blocking parent).
  // CLI fallback on SDK failure: transient fork/spawn issues shouldn't kill the cycle
  // when a proven path exists. USE_SDK=false disables SDK entirely.
  if (isSdkEnabled()) {
    try {
      return await execClaudeViaSdk(fullPrompt, opts);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Only fall through to CLI on infrastructure errors (fork/spawn/IPC).
      // Preserve real errors like API timeout / abort — caller's retry logic handles those.
      const isInfraFailure = /child crashed|child exited early|fork.*spawn|EACCES|EMFILE|ENOENT/i.test(msg);
      if (isInfraFailure) {
        slog('AGENT', `SDK path failed (${msg.slice(0, 80)}) — falling back to CLI`);
        return execClaude(fullPrompt, opts);
      }
      throw err;
    }
  }
  return execClaude(fullPrompt, opts);
}

// getSystemPrompt is now imported from dispatcher.ts

/**
 * 錯誤分類結果
 * message: 人類可讀的描述
 * modelGuidance: 給 model 的下一步指引（Claude Code 設計原則: error messages are model context）
 */
export interface ErrorClassification {
  type: 'TIMEOUT' | 'RATE_LIMIT' | 'NOT_FOUND' | 'PERMISSION' | 'MAX_BUFFER' | 'UNKNOWN';
  message: string;
  modelGuidance: string;
  retryable: boolean;
}

/**
 * Classify CLI error into structured result (provider-agnostic)
 */
function classifyError(error: unknown): ErrorClassification {
  const msg = error instanceof Error ? error.message : String(error);
  const stderr = (error as { stderr?: string })?.stderr ?? '';
  const killed = (error as { killed?: boolean })?.killed;
  const exitCode = (error as { status?: number })?.status;
  const signal = (error as { signal?: string })?.signal;
  const duration = (error as { duration?: number })?.duration;
  const timeoutMs = (error as { timeoutMs?: number })?.timeoutMs;
  // Include error.cause — Node.js fetch wraps the real error there
  // e.g. TypeError("fetch failed") { cause: Error("connect ECONNREFUSED 127.0.0.1:8000") }
  const cause = (error as { cause?: Error })?.cause;
  const causeMsg = cause instanceof Error ? cause.message : '';
  const combined = `${msg}\n${stderr}\n${causeMsg}`.toLowerCase();

  // Pre-spawn memory guard rejection (agent.ts:583-590 — freeMemMB < 500 throws this).
  // Classify as TIMEOUT so the retry loop treats it as OOM-likely (90s backoff, line 1716)
  // instead of burying it in UNKNOWN. 2026-04-17: this path accounted for 175/198 of UNKNOWN count
  // because "system memory too low" matched zero keywords and fell through to the generic fallback.
  if (combined.includes('system memory too low') || combined.includes('deferring to prevent oom')) {
    return { type: 'TIMEOUT', retryable: true, message: msg, modelGuidance: 'Pre-spawn memory guard tripped — system under memory pressure. Do not simplify the prompt; wait for concurrent subprocesses to complete. If this persists across cycles, reduce concurrent lane count.' };
  }

  // Connection error — server not running or unreachable (common with local LLM)
  if (combined.includes('econnrefused') || combined.includes('econnreset') ||
      combined.includes('epipe') || combined.includes('enotfound') ||
      (combined.includes('fetch') && combined.includes('failed') && !stderr.trim())) {
    const detail = causeMsg || msg;
    return { type: 'TIMEOUT', retryable: true, message: `無法連線到服務（${detail}）。可能是 LLM server 未啟動或網路問題。`, modelGuidance: 'Service is unreachable (connection refused/reset). The server may be down or restarting. On retry, check if the server process is alive. If this persists across retries, defer the task and switch provider.' };
  }

  if (combined.includes('enoent') || combined.includes('not found')) {
    return { type: 'NOT_FOUND', retryable: false, message: '無法找到 claude CLI。請確認已安裝 Claude Code 並且 claude 指令在 PATH 中。', modelGuidance: 'Claude CLI is not installed or not in PATH. This is a system configuration issue — do not retry. Report to user and suggest checking PATH.' };
  }
  // Exit 143 = SIGTERM (128+15) — context 過大或系統資源不足
  // exitReason 從 spawn close handler 傳入，讓下游 extractErrorSubtype 能區分 preempt/shutdown/external
  if (exitCode === 143) {
    const exitReason = (error as { exitReason?: string })?.exitReason;
    const reasonSuffix = exitReason ? `, reason=${exitReason}` : '';
    return { type: 'TIMEOUT', retryable: true, message: `Claude CLI 被 SIGTERM 終止（exit 143${reasonSuffix}）。可能是 context 過大或系統資源不足。`, modelGuidance: 'Context was likely too large. On retry, use a more focused prompt — strip non-essential context, reduce conversation history, and focus on the core task only.' };
  }
  // Duration-based timeout detection — catches race conditions where timedOut flag wasn't set
  // (e.g. process killed externally by OOM or system pressure before our timer fired)
  const longEnoughToMatter = duration && (duration > (timeoutMs ?? 0) * 0.9 || duration > 300_000);
  if (longEnoughToMatter && exitCode === null) {
    return { type: 'TIMEOUT', retryable: true, message: `處理超時（${Math.round(duration / 1000)}s）。進程可能被系統終止${signal ? `（signal: ${signal}）` : ''}。`, modelGuidance: 'Process likely killed by OOM or system pressure. On retry, reduce context size significantly and simplify the request.' };
  }
  // External signal detection — process terminated by signal but not our timeout
  if (signal && exitCode === null && !killed) {
    return { type: 'TIMEOUT', retryable: true, message: `CLI 被信號 ${signal} 終止。可能是系統資源不足。`, modelGuidance: `Process killed by signal ${signal}. This is likely a system resource issue — reduce context size on retry.` };
  }
  if (killed || combined.includes('timeout') || combined.includes('timed out')) {
    const actualDuration = duration ? `${Math.round(duration / 1000)}s` : `超過 ${timeoutMs ? Math.round(timeoutMs / 60_000) : 25} 分鐘`;
    return { type: 'TIMEOUT', retryable: true, message: `處理超時（${actualDuration}）。Claude CLI 回應太慢或暫時不可用，請稍後再試。`, modelGuidance: 'The task took too long. On retry, break it into smaller steps — do one thing at a time instead of trying to accomplish everything in a single call.' };
  }
  if (combined.includes('maxbuffer')) {
    return { type: 'MAX_BUFFER', retryable: false, message: '回應內容過大，超過緩衝區限制。請嘗試要求更簡潔的回覆。', modelGuidance: 'Response exceeded output buffer. Do NOT retry with the same prompt. Reformulate to request a shorter, more focused response — e.g., ask for a summary instead of full content.' };
  }
  if (combined.includes('credit balance') || combined.includes('billing')) {
    return { type: 'RATE_LIMIT', retryable: false, message: 'Anthropic API 餘額不足。Claude Lane 已設定走 CLI 訂閱，請確認 ANTHROPIC_API_KEY 未洩漏到子進程。', modelGuidance: 'API credits exhausted. Do NOT retry — this requires human intervention (billing). Switch to local model if available, or defer the task.' };
  }
  if (combined.includes('rate limit') || combined.includes('429')) {
    return { type: 'RATE_LIMIT', retryable: true, message: 'Claude API 達到速率限制，稍後自動重試。', modelGuidance: 'Rate limited — automatic retry with backoff is handling this. Do not change your strategy or prompt, just wait.' };
  }
  if (combined.includes('access denied') || (combined.includes('permission') && !combined.includes('skip-permissions'))) {
    return { type: 'PERMISSION', retryable: false, message: '存取被拒絕。Claude CLI 可能沒有足夠的權限執行此操作。', modelGuidance: 'Permission denied. Do NOT retry the same operation. Try an alternative approach that does not require elevated permissions, or report to user.' };
  }

  // Silent mid-duration exit — CLI returned without stderr after >= 2 minutes.
  // Before this patch, these fell through to UNKNOWN and got bucketed as `hang_no_diag`.
  if (duration && duration > 120_000 && exitCode !== null && !signal && !killed && !stderr.trim()) {
    return {
      type: 'TIMEOUT',
      retryable: true,
      message: `CLI 靜默中斷（exit ${exitCode}，${Math.round(duration / 1000)}s 無輸出）。可能 API session 中途失效或 context 靜默溢位。`,
      modelGuidance: 'CLI exited silently after >=2min with no stderr. Likely causes: mid-session auth drop, silent context overflow, or upstream provider quiet-failure. On retry, re-auth session first; if recurring, reduce context and split the task.'
    };
  }

  // Try to extract useful info from stderr.
  // 2026-04-17: previously required lastLine length 10–300 which dropped short stderr
  // ("error", "auth\n") and left 184/day exit-1 errors in opaque generic fallback bucket.
  // Now: any non-empty stderr tail up to 400 chars is preserved.
  if (stderr.trim()) {
    const lines = stderr.trim().split('\n').filter((l: string) => l.trim());
    const lastLine = lines[lines.length - 1] || '';
    if (lastLine) {
      const snippet = lastLine.length > 400 ? `${lastLine.slice(0, 400)}…` : lastLine;
      return { type: 'UNKNOWN', retryable: true, message: `Claude CLI 執行失敗（exit ${exitCode ?? 'N/A'}）：${snippet}`, modelGuidance: `Unexpected error: "${snippet}". On retry, try simplifying the prompt. If this recurs, it may be a systemic issue — log it and move on.` };
    }
  }

  // Exit 1 with empty stderr — preserve exit code so bucket is distinguishable in triage.
  // Prior behavior: all exit-1 cases collapsed into the same opaque "處理訊息時發生錯誤" message.
  // 2026-04-17 (cycle #15): also surface duration/signal so extractErrorSubtype can split
  // the :no_diag:: bin (8 recent cases were mid-duration orphaned exits with exitCode=null
  // that all collapsed to no_diag — routing needs observable attributes to distinguish them).
  const exitLabel = exitCode != null ? ` (exit ${exitCode})` : '';
  const diagParts: string[] = [];
  if (duration != null) diagParts.push(`dur=${Math.round(duration / 1000)}s`);
  if (signal) diagParts.push(`signal=${signal}`);
  if (killed) diagParts.push('killed=true');
  const diagSuffix = diagParts.length > 0 ? ` [${diagParts.join(', ')}]` : '';
  return { type: 'UNKNOWN', retryable: true, message: `處理訊息時發生錯誤${exitLabel}${diagSuffix}。請稍後再試，或嘗試換個方式描述你的需求。`, modelGuidance: `CLI exited${exitLabel}${diagSuffix} without diagnostic output. On retry, simplify the request. If this keeps happening, defer the task and report the issue — inspect cli session (auth / rate limit) as probable cause.` };
}

// =============================================================================
// Lane Types
// =============================================================================

export type CallSource = 'loop' | 'ask' | 'foreground';

interface TaskInfo {
  prompt: string;
  startedAt: number;
  toolCalls: number;
  lastTool: string | null;
  lastText: string | null;
  recentFiles: Set<string>; // Files touched by Edit/Write/Read — for cross-lane coordination
}

function formatTask(task: TaskInfo | null): { prompt: string; startedAt: string; elapsed: number; toolCalls: number; lastTool: string | null; lastText: string | null; recentFiles: string[] } | null {
  if (!task) return null;
  return {
    prompt: task.prompt,
    startedAt: new Date(task.startedAt).toISOString(),
    elapsed: Math.floor((Date.now() - task.startedAt) / 1000),
    toolCalls: task.toolCalls,
    lastTool: task.lastTool,
    lastText: task.lastText,
    recentFiles: [...task.recentFiles].slice(-10), // last 10 files
  };
}

// =============================================================================
// Memory Pressure Measurement (platform-aware)
// =============================================================================
// `os.freemem()` on macOS only counts truly free pages — inactive pages (which
// the kernel would reclaim under demand) are excluded. Result: a host with
// 2.3GB reclaimable cache can look like 69MB free, triggering false positives.
// Convergence condition (CC1): the signal we check should reflect what the OS
// would actually deliver to a new process under pressure, not a narrow metric.

let memCacheTs = 0;
let memCacheValue = 0;
const MEM_CACHE_MS = 2000;

export function getAvailableMemoryMB(): number {
  const now = Date.now();
  if (now - memCacheTs < MEM_CACHE_MS) return memCacheValue;
  let result = Math.round(os.freemem() / 1_048_576); // safe fallback
  try {
    if (process.platform === 'darwin') {
      const out = execFileSync('vm_stat', { encoding: 'utf8', timeout: 1000 });
      const pageSize = Number((out.match(/page size of (\d+)/) || [])[1] || 16384);
      const free = Number((out.match(/Pages free:\s+(\d+)/) || [])[1] || 0);
      const inactive = Number((out.match(/Pages inactive:\s+(\d+)/) || [])[1] || 0);
      const speculative = Number((out.match(/Pages speculative:\s+(\d+)/) || [])[1] || 0);
      const purgeable = Number((out.match(/Pages purgeable:\s+(\d+)/) || [])[1] || 0);
      // Available = free + inactive + speculative + purgeable (all reclaimable on demand)
      result = Math.round(((free + inactive + speculative + purgeable) * pageSize) / 1_048_576);
    } else if (process.platform === 'linux') {
      const meminfo = readFileSyncFs('/proc/meminfo', 'utf8');
      const availMatch = meminfo.match(/MemAvailable:\s+(\d+)\s+kB/);
      if (availMatch) result = Math.round(Number(availMatch[1]) / 1024);
    }
  } catch {
    // vm_stat missing or parse failure — keep os.freemem() fallback
  }
  memCacheTs = now;
  memCacheValue = result;
  return result;
}

// =============================================================================
// Lane Busy Locks
// =============================================================================

// Loop Lane (OODA cycle)
let loopBusy = false;
let loopTask: TaskInfo | null = null;
let loopChildPid: number | null = null;
let loopGeneration = 0; // Bumped on preemption — callClaude detects mismatch

// Per-PID kill reason map — bridges external kill sites (preempt/shutdown) to callClaude close handler
const externalKillReasons = new Map<number, string>();

// Foreground Lane — concurrent slot-based tracking
// Multiple DMs from different sources can run in parallel, up to MAX_FOREGROUND_CONCURRENT.
// Each callClaude(source='foreground') gets a unique fgSlotId for independent busy/task/pid tracking.
interface ForegroundSlotState {
  busy: boolean;
  task: TaskInfo | null;
  pid: number | null;
  abortController: AbortController | null;
  startedAt: number;
  lastActivityTs: number; // last stdout or state change — for TTL sweep
  // CC2: slot is zombie iff no legitimate path to output. Memory wait is a legitimate path.
  memoryWaitingSince: number | null;
}
const foregroundSlots = new Map<string, ForegroundSlotState>();
const MAX_FOREGROUND_CONCURRENT = 2; // lowered from 8 — concurrent Claude CLI subprocesses cause OOM (2026-04-16 incident: 3 simultaneous subprocesses → SIGTERM cascade)
const FG_SLOT_TTL_MS = 300_000; // 5 min — idle slots cleaned up after this
const FG_SLOT_ZOMBIE_MS = 60_000; // 1 min — busy slot with no PID/controller = zombie
const MEM_WAIT_CAP_MS = 120_000; // must match callClaude wait-guard cap
const MEM_WAIT_GRACE_MS = 30_000; // grace after cap before slot is force-swept

/** 查詢是否有任何 lane 正在執行 Claude CLI */
export function isClaudeBusy(): boolean {
  return loopBusy || [...foregroundSlots.values()].some(s => s.busy);
}

/** 查詢 loop lane 是否忙碌 */
export function isLoopBusy(): boolean {
  return loopBusy;
}

/** 查詢 foreground lane 是否全部忙碌（所有 slot 都在用） */
export function isForegroundBusy(): boolean {
  return getForegroundActiveCount() >= MAX_FOREGROUND_CONCURRENT;
}

/** 取得目前活躍的 foreground slot 數量 */
export function getForegroundActiveCount(): number {
  return [...foregroundSlots.values()].filter(s => s.busy).length;
}

/** 取得或建立 foreground slot。回傳 slotId 或 null（已滿） */
export function acquireForegroundSlot(): string | null {
  if (getForegroundActiveCount() >= MAX_FOREGROUND_CONCURRENT) return null;
  const id = `fg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  foregroundSlots.set(id, { busy: false, task: null, pid: null, abortController: null, startedAt: 0, lastActivityTs: Date.now(), memoryWaitingSince: null });
  return id;
}

/** 釋放 foreground slot */
export function releaseForegroundSlot(id: string): void {
  foregroundSlots.delete(id);
}

/**
 * Sweep stale foreground slots — absorbed from agent-broker session pool TTL pattern.
 * Cleans up: (1) idle slots past TTL, (2) zombie slots (busy but process gone).
 */
function sweepForegroundSlots(): void {
  const now = Date.now();
  for (const [id, slot] of foregroundSlots) {
    // Zombie: busy but no process handle and no abort controller — process died without cleanup
    if (slot.busy && !slot.pid && !slot.abortController && (now - slot.lastActivityTs) > FG_SLOT_ZOMBIE_MS) {
      // CC2 guard: slot legitimately waiting for memory recovery (wait-inside-guard)
      // is NOT a zombie — it has an authorized path to producing output. Only
      // force-sweep after cap + grace to prevent indefinite stalls if the wait
      // itself gets stuck.
      if (slot.memoryWaitingSince !== null && (now - slot.memoryWaitingSince) < MEM_WAIT_CAP_MS + MEM_WAIT_GRACE_MS) {
        continue;
      }
      slog('SWEEP', `Cleaning zombie foreground slot ${id} (no PID/controller, idle ${((now - slot.lastActivityTs) / 1000).toFixed(0)}s)`);
      foregroundSlots.delete(id);
      continue;
    }
    // Idle: not busy and past TTL — transparent cleanup
    if (!slot.busy && (now - slot.lastActivityTs) > FG_SLOT_TTL_MS) {
      slog('SWEEP', `TTL expired for idle foreground slot ${id} (${((now - slot.lastActivityTs) / 1000).toFixed(0)}s idle)`);
      foregroundSlots.delete(id);
    }
  }
}

let fgSweepTimer: ReturnType<typeof setInterval> | null = null;

/** Start periodic foreground slot TTL sweep (call once at startup) */
export function startForegroundSweep(): void {
  if (fgSweepTimer) return;
  fgSweepTimer = setInterval(sweepForegroundSlots, 60_000); // sweep every 60s
}

/** Stop foreground slot sweep (call on shutdown) */
export function stopForegroundSweep(): void {
  if (fgSweepTimer) {
    clearInterval(fgSweepTimer);
    fgSweepTimer = null;
  }
}

/** 查詢目前正在處理的任務 */
export function getCurrentTask(): { prompt: string; startedAt: string; elapsed: number; toolCalls: number; lastTool: string | null; lastText: string | null } | null {
  const loopResult = formatTask(loopTask);
  if (loopResult) return loopResult;
  for (const slot of foregroundSlots.values()) {
    if (slot.busy && slot.task) {
      const result = formatTask(slot.task);
      if (result) return result;
    }
  }
  return null;
}

/** 查詢所有 lane 狀態 */
export function getLaneStatus(): {
  loop: { busy: boolean; task: ReturnType<typeof formatTask> };
  foreground: { busy: boolean; activeCount: number; maxConcurrent: number; task: ReturnType<typeof formatTask>; slots: Array<{ id: string; task: ReturnType<typeof formatTask> }> };
} {
  const activeSlots = [...foregroundSlots.entries()].filter(([, s]) => s.busy);
  const firstTask = activeSlots.length > 0 ? formatTask(activeSlots[0][1].task) : null;
  return {
    loop: { busy: loopBusy, task: formatTask(loopTask) },
    foreground: {
      busy: activeSlots.length > 0,
      activeCount: activeSlots.length,
      maxConcurrent: MAX_FOREGROUND_CONCURRENT,
      task: firstTask, // backward compat: first active task
      slots: activeSlots.map(([id, s]) => ({ id, task: formatTask(s.task) })),
    },
  };
}

/** 搶佔正在執行的 loop cycle（用於 Alex 的 TG 訊息優先處理） */
export function preemptLoopCycle(): { preempted: boolean; partialOutput: string | null } {
  if (!loopBusy || (!loopChildPid && !loopAbortController)) {
    return { preempted: false, partialOutput: null };
  }

  const pid = loopChildPid;
  const partial = loopTask?.lastText ?? null;

  // Kill: abort HTTP call (local LLM) or process group (Claude/Codex)
  if (loopAbortController) {
    loopAbortController.abort();
    loopAbortController = null;
  }
  if (pid) {
    externalKillReasons.set(pid, 'preempt');
    try { process.kill(-pid, 'SIGTERM'); } catch { /* already dead */ }
    setTimeout(() => {
      try { process.kill(-pid, 'SIGKILL'); } catch { /* already dead */ }
    }, 3000);
  }

  loopGeneration++;
  loopBusy = false;
  loopTask = null;
  loopChildPid = null;

  slog('PREEMPT', `Killed loop ${pid ? `process group (pid: ${pid})` : 'HTTP call'}, generation: ${loopGeneration}`);
  eventBus.emit('action:loop', { event: 'preempted', partialOutput: partial?.slice(0, 100) });

  return { preempted: true, partialOutput: partial };
}

/** Abort a foreground slot — kill running process to make room for new P0.
 *  If slotId given, abort that specific slot. Otherwise abort the oldest active slot. */
export function abortForeground(slotId?: string): boolean {
  let targetId = slotId;
  if (!targetId) {
    // Find oldest active slot
    let oldest: { id: string; startedAt: number } | null = null;
    for (const [id, s] of foregroundSlots) {
      if (s.busy && (!oldest || s.startedAt < oldest.startedAt)) {
        oldest = { id, startedAt: s.startedAt };
      }
    }
    if (!oldest) return false;
    targetId = oldest.id;
  }

  const slot = foregroundSlots.get(targetId);
  if (!slot) return false;

  const pid = slot.pid;
  if (slot.abortController) {
    slot.abortController.abort();
  }
  if (pid) {
    externalKillReasons.set(pid, 'foreground-preempt');
    try { process.kill(-pid, 'SIGTERM'); } catch { /* already dead */ }
    setTimeout(() => { try { process.kill(-pid, 'SIGKILL'); } catch {} }, 3000);
  }

  // Clean up slot immediately — process close handler will no-op (slot already deleted)
  foregroundSlots.delete(targetId);
  slog('PREEMPT', `Aborted foreground slot ${targetId} ${pid ? `(pid: ${pid})` : '(HTTP call)'} for incoming P0`);
  return true;
}

/**
 * Kill all tracked child processes (loop + foreground lanes).
 * Called during graceful shutdown to prevent orphaned claude subprocesses.
 */
export function killAllChildProcesses(): number {
  let killed = 0;
  if (loopChildPid) {
    externalKillReasons.set(loopChildPid, 'shutdown');
    try { process.kill(-loopChildPid, 'SIGTERM'); killed++; } catch { /* already dead */ }
    loopChildPid = null;
  }
  for (const [, slot] of foregroundSlots) {
    if (slot.pid) {
      externalKillReasons.set(slot.pid, 'shutdown');
      try { process.kill(-slot.pid, 'SIGTERM'); killed++; } catch { /* already dead */ }
      slot.pid = null;
    }
  }
  return killed;
}

/** Bump generation without kill — for safety valve when process is in retry backoff */
export function bumpLoopGeneration(): void {
  loopGeneration++;
  slog('PREEMPT', `Generation bumped to ${loopGeneration} (no active process)`);
}

/**
 * Audit log: 記錄 Claude CLI 的中間工具呼叫
 */
function writeAuditLog(toolName: string, input: Record<string, unknown>): void {
  try {
    const instanceId = getCurrentInstanceId();
    if (!instanceId) return;
    const dir = getInstanceDir(instanceId);
    const auditDir = path.join(dir, 'logs', 'audit');
    if (!existsSync(auditDir)) mkdirSync(auditDir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10);
    const entry = {
      timestamp: new Date().toISOString(),
      tool: toolName,
      input: sanitizeAuditInput(input),
    };
    appendFileSync(path.join(auditDir, `${date}.jsonl`), JSON.stringify(entry) + '\n', 'utf-8');
  } catch { /* audit log failure should never break agent */ }
}

/** 清理 audit input — 截斷過長內容，隱藏敏感資訊 */
function sanitizeAuditInput(input: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === 'string') {
      // 隱藏可能包含 token 的命令
      if (v.includes('BOT_TOKEN') || v.includes('api.telegram.org/bot')) {
        result[k] = '[REDACTED: contains token]';
      } else {
        result[k] = v.length > 500 ? v.slice(0, 500) + `... [${v.length} chars]` : v;
      }
    } else {
      result[k] = v;
    }
  }
  return result;
}

/**
 * 單次 Claude CLI 呼叫（內部用）
 * 使用 stream-json 格式捕獲中間工具呼叫並寫入 audit log
 *
 * 安全機制：
 * - detached: true 建立新進程群組
 * - 手動 timeout 殺整個進程群組（包括 curl 等子進程）
 * - 防止孤兒進程繼續執行（如未授權的 Telegram API 呼叫）
 */
// =============================================================================
// Cache Usage Tracking (Stage 0 · observability)
// Parses Claude CLI stream-json usage events to reveal cache hit rate.
// Motivation: src/ had zero instrumentation for cache_read_input_tokens —
// Kuro was flying blind on whether prompts were actually cache-hitting.
// =============================================================================

export interface CacheUsageStats {
  calls: number;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  uncachedInputTokens: number; // input + cacheCreation (= non-read baseline)
}

const cacheUsageBySource: Record<string, CacheUsageStats> = {};

function recordCacheUsage(usage: Record<string, unknown>, source: string): void {
  const input = Number(usage.input_tokens ?? 0);
  const cacheCreate = Number(usage.cache_creation_input_tokens ?? 0);
  const cacheRead = Number(usage.cache_read_input_tokens ?? 0);
  const output = Number(usage.output_tokens ?? 0);

  // Skip all-zero events (some intermediate events may carry empty usage)
  if (input === 0 && cacheCreate === 0 && cacheRead === 0 && output === 0) return;

  if (!cacheUsageBySource[source]) {
    cacheUsageBySource[source] = {
      calls: 0, inputTokens: 0, cacheCreationTokens: 0,
      cacheReadTokens: 0, outputTokens: 0, uncachedInputTokens: 0,
    };
  }
  const s = cacheUsageBySource[source];
  s.calls++;
  s.inputTokens += input;
  s.cacheCreationTokens += cacheCreate;
  s.cacheReadTokens += cacheRead;
  s.outputTokens += output;
  s.uncachedInputTokens += input + cacheCreate;

  const totalInput = input + cacheCreate + cacheRead;
  const hitRatio = totalInput > 0 ? cacheRead / totalInput : 0;
  slog('CACHE', `[${source}] in=${input} create=${cacheCreate} read=${cacheRead} out=${output} hit=${(hitRatio * 100).toFixed(1)}%`);
}

/** Read cumulative cache usage stats grouped by source (loop/foreground/ask). */
export function getCacheUsageStats(): Record<string, CacheUsageStats & { hitRatio: number }> {
  const result: Record<string, CacheUsageStats & { hitRatio: number }> = {};
  for (const [source, s] of Object.entries(cacheUsageBySource)) {
    const total = s.uncachedInputTokens + s.cacheReadTokens;
    result[source] = { ...s, hitRatio: total > 0 ? s.cacheReadTokens / total : 0 };
  }
  return result;
}

async function execClaude(fullPrompt: string, opts?: ExecOptions): Promise<string> {
  // Convergence condition: cycle MUST complete in bounded time. 25min/15min defaults let
  // a single stalled CLI call block the event loop and starve the whole server for minutes
  // (2026-04-17 incident). Prefer fail-fast + retry over patient-but-dead.
  const TIMEOUT_MS = opts?.timeoutMs ?? 90_000;
  const PROGRESS_TIMEOUT_MS = opts?.progressTimeoutMs ?? 30_000;
  const startTs = Date.now();
  const source = opts?.source ?? 'loop';

  // Resolve the correct task reference for progress tracking (loop vs foreground slot)
  const activeTask = (): TaskInfo | null => {
    if (opts?.fgSlotId) {
      return foregroundSlots.get(opts.fgSlotId)?.task ?? null;
    }
    return loopTask;
  };

  // 過濾掉 ANTHROPIC_API_KEY — 讓 Claude CLI 走訂閱而非 API credit
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => k !== 'ANTHROPIC_API_KEY'),
  );

  // 不指定 --model → 走訂閱預設（Max = Opus）
  // 優先使用 per-call model（智能路由），其次 CLAUDE_MODEL env
  // --strict-mcp-config without --mcp-config → zero MCP servers loaded
  //   Subprocess is Kuro's internal brain — it shouldn't communicate with itself via MCP
  const args = ['-p', '--dangerously-skip-permissions', '--output-format', 'stream-json', '--verbose', '--strict-mcp-config'];
  // Foreground: cap max turns to prevent deep research (should be quick ack + delegate)
  // Data: foreground was doing 58-93 tool calls (5+ minutes) instead of 2-3 sentence ack
  if (opts?.source === 'foreground') {
    args.push('--max-turns', '5');
  }
  const modelOverride = opts?.model ?? process.env.CLAUDE_MODEL;
  if (modelOverride) {
    args.push('--model', modelOverride);
  }

  // CLAUDE.md JIT: run subprocess in isolated cwd (no CLAUDE.md) to prevent
  // CLI from loading full project instructions. JIT-filtered content is already
  // included in the system prompt via getSystemPrompt() → getClaudeMdJIT().
  // --add-dir allows subprocess tools to access project files.
  const projectDir = process.cwd();
  // CRITICAL: subprocess-cwd must be OUTSIDE the .mini-agent git tree.
  // ~/.mini-agent/ is a git checkout with a 43K CLAUDE.md — if subprocess runs inside it,
  // Claude CLI auto-discovers and loads CLAUDE.md on top of our JIT-filtered system prompt,
  // causing ~112K char total prompts → API timeout → EXIT143.
  const subprocessCwd = path.join(process.env.HOME ?? '/tmp', '.mini-agent-subprocess');
  if (!existsSync(subprocessCwd)) {
    mkdirSync(subprocessCwd, { recursive: true });
  }
  args.push('--add-dir', projectDir);

  // Memory pressure guard — poll-and-wait up to 120s for transient pressure to clear.
  // CC1: availability = OS-deliverable memory (free + reclaimable inactive/speculative/purgeable),
  //      not `os.freemem()` which on macOS only counts truly free pages and misses 2GB+ of
  //      reclaimable cache — causing false positives that trigger unnecessary waits.
  // CC2: mark fgSlot.memoryWaitingSince during wait so sweep doesn't misclassify the slot as
  //      zombie (busy + no pid + no controller) — the slot is legitimately waiting.
  const MEM_THRESHOLD_MB = 500;
  const MEM_POLL_MS = 5_000;
  let freeMemMB = getAvailableMemoryMB();
  if (freeMemMB < MEM_THRESHOLD_MB) {
    const waitStart = Date.now();
    const fgSlot = opts?.fgSlotId ? foregroundSlots.get(opts.fgSlotId) : null;
    if (fgSlot) fgSlot.memoryWaitingSince = waitStart;
    slog('CLAUDE', `Low memory (${freeMemMB}MB available) — polling for recovery (cap ${MEM_WAIT_CAP_MS / 1000}s)`);
    try {
      while (freeMemMB < MEM_THRESHOLD_MB && Date.now() - waitStart < MEM_WAIT_CAP_MS) {
        await new Promise<void>((r) => setTimeout(r, MEM_POLL_MS));
        freeMemMB = getAvailableMemoryMB();
      }
    } finally {
      if (fgSlot) fgSlot.memoryWaitingSince = null;
    }
    const waitedSec = Math.round((Date.now() - waitStart) / 1000);
    if (freeMemMB < MEM_THRESHOLD_MB) {
      slog('CLAUDE', `Memory still low (${freeMemMB}MB available) after ${waitedSec}s — deferring spawn`);
      return Promise.reject(Object.assign(
        new Error(`System memory too low (${freeMemMB}MB available) — deferring to prevent OOM`),
        { killed: false, status: null, signal: null, duration: 0, timeoutMs: TIMEOUT_MS },
      ));
    }
    slog('CLAUDE', `Memory recovered to ${freeMemMB}MB after ${waitedSec}s — proceeding`);
  }

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let killReason = ''; // 'progress' | 'hard' | '' (external/unknown)
    let lastStdoutDataTs = Date.now();

    const child = spawn(
      'claude',
      args,
      {
        env,
        cwd: subprocessCwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true, // 建立新進程群組，方便整體 kill
      },
    );

    // Track PID for lane management (preemption support)
    if (source === 'loop') {
      loopChildPid = child.pid ?? null;
    } else if (source === 'foreground' && opts?.fgSlotId) {
      const slot = foregroundSlots.get(opts.fgSlotId);
      if (slot) slot.pid = child.pid ?? null;
    }

    let resultText = '';
    const allTextBlocks: string[] = []; // 累積所有 assistant text blocks（含中間 turns），防止 tags 遺失
    const chatStreamParser = opts?.onStreamChat
      ? createKuroChatStreamParser((tag) => {
        const isReply = tag.attributes.reply === 'true'
          || tag.attributes.replyTo !== undefined
          || tag.attributes.replyto !== undefined;
        const cleaned = stripTurnSeparators(tag.content.trim());
        if (cleaned) opts.onStreamChat?.(cleaned, isReply);
      }, { maxDepth: Number.MAX_SAFE_INTEGER })
      : null;
    let buffer = '';
    let stderr = '';

    // Debounced streaming progress channel — fires at most every 700ms
    // Consumers (TG status, /status API, dashboards) subscribe to 'log:progress'
    const emitProgress = debounce(() => {
      if (settled) return;
      eventBus.emit('log:progress', {
        source,
        slotId: opts?.fgSlotId ?? 'loop',
        elapsedMs: Date.now() - startTs,
        toolCalls: toolCallCount,
        hasOutput: allTextBlocks.length > 0,
        lastOutputMs: Date.now() - lastStdoutDataTs,
      });
    }, 700);

    // Absorb pipe errors from preempted child — log but don't crash
    const onPipeError = (e: Error) => { if ((e as NodeJS.ErrnoException).code !== 'EPIPE') slog('CLAUDE', `pipe error: ${e.message}`); };
    child.stdin.on('error', onPipeError);
    child.stdout.on('error', onPipeError);
    child.stderr.on('error', onPipeError);
    let toolCallCount = 0;

    const killProcessGroupWithForceResolve = () => {
      try {
        process.kill(-child.pid!, 'SIGTERM');
      } catch (e) { slog('CLAUDE', `SIGTERM failed for pgid ${child.pid}: ${e}`); }
      // 5 秒後強制殺（SIGKILL 不可被攔截）
      setTimeout(() => {
        try { process.kill(-child.pid!, 'SIGKILL'); } catch (e) { slog('CLAUDE', `SIGKILL failed for pgid ${child.pid}: ${e}`); }
        // Force-resolve safety net: if close event hasn't fired 10s after SIGKILL, force reject
        setTimeout(() => {
          if (!settled) {
            settled = true;
            if (source === 'loop') loopChildPid = null;
            else if (source === 'foreground' && opts?.fgSlotId) foregroundSlots.delete(opts.fgSlotId);
            const duration = Date.now() - startTs;
            slog('CLAUDE', `Force-resolve: close event not received 10s after SIGKILL (pid ${child.pid}), elapsed=${(duration / 1000).toFixed(1)}s`);
            reject(Object.assign(new Error('Claude CLI force-resolved: close event timeout after SIGKILL'), {
              stderr, stdout: resultText, status: null, killed: true, signal: 'SIGKILL', duration, timeoutMs: TIMEOUT_MS,
            }));
          }
        }, 10_000);
      }, 5000);
    };

    // ── Progress timeout：無 stdout 就 kill（adaptive — 有 tool call 表示在工作，給更多時間）──
    // Foreground uses faster check interval (5s) for responsive stall detection
    const isForeground = source === 'foreground';
    const PROGRESS_CHECK_INTERVAL = isForeground ? 5_000 : 30_000;
    const STALL_THINKING_MS = 10_000;  // 10s no output → "thinking" (foreground only)
    const STALL_WARN_MS = 30_000;      // 30s no output → "stalled" warning (foreground only)
    let lastStallStatus: 'active' | 'thinking' | 'stalled' = 'active';

    const progressTimer = setInterval(() => {
      if (settled || timedOut) return;
      const silentMs = Date.now() - lastStdoutDataTs;

      // Foreground stall status emission — debounced at check interval
      if (isForeground) {
        let newStatus: 'active' | 'thinking' | 'stalled' = 'active';
        if (silentMs > STALL_WARN_MS) newStatus = 'stalled';
        else if (silentMs > STALL_THINKING_MS) newStatus = 'thinking';
        if (newStatus !== lastStallStatus) {
          lastStallStatus = newStatus;
          eventBus.emit('log:stall', {
            status: newStatus,
            slotId: opts?.fgSlotId ?? 'unknown',
            silentMs,
            toolCalls: toolCallCount,
          });
        }
      }

      // Adaptive: model producing tool calls = actively working, extend tolerance
      // Foreground: tighter timeout — user is waiting interactively
      const effectiveTimeout = isForeground
        ? (toolCallCount > 0 ? 300_000 : 120_000) // foreground: 5min with tools, 2min without
        : (toolCallCount > 0 ? Math.max(PROGRESS_TIMEOUT_MS, 480_000) : PROGRESS_TIMEOUT_MS);
      if (silentMs < effectiveTimeout) return;
      timedOut = true;
      killReason = 'progress';
      clearInterval(progressTimer);
      slog('CLAUDE', `No stdout data for ${effectiveTimeout / 1000}s (tools=${toolCallCount}) — killing process group ${child.pid}`);
      killProcessGroupWithForceResolve();
    }, PROGRESS_CHECK_INTERVAL);

    // ── 手動 timeout：殺整個進程群組（含子進程）──
    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      killReason = 'hard';
      clearInterval(progressTimer);
      slog('CLAUDE', `Timeout (${TIMEOUT_MS / 1000}s) — killing process group ${child.pid}`);
      killProcessGroupWithForceResolve();
    }, TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => {
      lastStdoutDataTs = Date.now();
      // Update foreground slot activity for TTL sweep
      if (source === 'foreground' && opts?.fgSlotId) {
        const slot = foregroundSlots.get(opts.fgSlotId);
        if (slot) slot.lastActivityTs = lastStdoutDataTs;
      }
      // Emit stall recovery if we were in thinking/stalled state
      if (lastStallStatus !== 'active') {
        lastStallStatus = 'active';
        eventBus.emit('log:stall', { status: 'active', slotId: opts?.fgSlotId ?? source, recovered: true });
      }
      buffer += chunk.toString('utf-8');
      // 逐行解析 stream-json
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (!line) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === 'assistant') {
            const blocks = event.message?.content ?? [];
            for (const block of blocks) {
              if (block.type === 'tool_use') {
                toolCallCount++;
                // Circuit breaker: >150 tools in >20 min = runaway chain
                if (!settled && !timedOut && toolCallCount > 150 && (Date.now() - startTs) > 1_200_000) {
                  timedOut = true;
                  killReason = 'circuit-breaker';
                  clearTimeout(timer);
                  clearInterval(progressTimer);
                  slog('CLAUDE', `Tool-count circuit breaker: ${toolCallCount} tools in ${((Date.now() - startTs) / 1000).toFixed(1)}s — killing process group ${child.pid}`);
                  killProcessGroupWithForceResolve();
                }
                const toolName = block.name ?? 'unknown';
                const toolInput = (block.input ?? {}) as Record<string, unknown>;
                writeAuditLog(toolName, toolInput);
                emitProgress();
                // 即時更新 task — 讓 /status 顯示正在做什麼
                { const task = activeTask();
                if (task) {
                  const summary = toolInput.command ?? toolInput.file_path ?? toolInput.pattern ?? toolInput.url ?? '';
                  task.toolCalls = toolCallCount;
                  task.lastTool = `${toolName}: ${String(summary).slice(0, 80)}`;
                  // Track files for cross-lane coordination
                  if (toolInput.file_path && typeof toolInput.file_path === 'string') {
                    task.recentFiles.add(toolInput.file_path);
                  }
                } }
              } else if (block.type === 'text' && block.text) {
                // 即時更新最新思考文字
                { const task = activeTask();
                if (task) {
                  task.lastText = block.text.slice(0, 200);
                } }
                // 累積所有 text blocks — 中間 turns 的 tags（如 <kuro:chat>）不能遺失
                allTextBlocks.push(block.text);
                if (!resultText) resultText = block.text;
                // Partial output callback (for cycle checkpoint)
                if (opts?.onPartialOutput) {
                  opts.onPartialOutput(resultText);
                }
                chatStreamParser?.write(block.text);
                emitProgress();
              }
            }
          } else if (event.type === 'result') {
            // Use || instead of ?? — empty string "" from event.result should NOT overwrite
            // accumulated text blocks (Claude CLI 2.x stream-json may return "" for result)
            resultText = event.result || resultText;
            // Stage 0: record cache usage for observability (see cacheUsageBySource above)
            if (event.usage && typeof event.usage === 'object') {
              recordCacheUsage(event.usage as Record<string, unknown>, source);
            }
          } else if (event.type === 'assistant' && event.message?.usage) {
            // Claude CLI stream-json also surfaces usage on assistant messages —
            // prefer these when result event lacks usage (CLI 2.x behavior varies)
            recordCacheUsage(event.message.usage as Record<string, unknown>, source);
          }
        } catch { /* ignore malformed JSON lines */ }
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });

    child.on('close', (code, signal) => {
      settled = true;
      clearTimeout(timer);
      clearInterval(progressTimer);
      emitProgress.cancel();
      const duration = Date.now() - startTs;

      // Clear PID tracking
      if (source === 'loop') {
        loopChildPid = null;
      } else if (source === 'foreground' && opts?.fgSlotId) {
        const slot = foregroundSlots.get(opts.fgSlotId);
        if (slot) slot.pid = null;
      }
      chatStreamParser?.end();

      // 處理 buffer 中剩餘的不完整行
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer.trim());
          if (event.type === 'result') resultText = event.result || resultText;
        } catch { /* ignore */ }
      }

      if (toolCallCount > 0) {
        slog('AUDIT', `Claude CLI used ${toolCallCount} tool(s) this call`);
      }

      // Exit 143 結構化 logging（SIGTERM — context 過大或系統終止）
      // exitReason 也附到 rejected error 上，讓下游 extractErrorSubtype 能區分 preempt/shutdown/external
      let exitReason: string | undefined;
      if (code === 143) {
        const childPid = child.pid;
        const externalReason = childPid ? externalKillReasons.get(childPid) : undefined;
        if (childPid) externalKillReasons.delete(childPid);
        exitReason = killReason || externalReason || 'external';
        const silentMs = Date.now() - lastStdoutDataTs; // time since last stdout (includes SIGTERM→close delay)
        slog('EXIT143', `reason=${exitReason}, prompt=${fullPrompt.length} chars, elapsed=${(duration / 1000).toFixed(1)}s, tools=${toolCallCount}, silentFor=${(silentMs / 1000).toFixed(1)}s`);
      }

      // Log unexpected signals for diagnostics
      if (signal && !timedOut) {
        slog('CLAUDE', `Process terminated by signal ${signal} (not our timeout), elapsed=${(duration / 1000).toFixed(1)}s`);
      }

      if (code !== 0 && !resultText) {
        reject(Object.assign(new Error(`Claude CLI exited with code ${code}`), { stderr, stdout: resultText, status: code, killed: timedOut, signal, duration, timeoutMs: TIMEOUT_MS, toolCallCount, exitReason }));
      } else {
        // Fallback: if resultText is empty but we received text blocks during streaming,
        // reconstruct from allTextBlocks. Claude CLI 2.x stream-json may return empty
        // event.result when tool use is involved.
        if (!resultText && allTextBlocks.length > 0) {
          resultText = allTextBlocks.join('\n');
          slog('TAGS', `Recovered response from ${allTextBlocks.length} streamed text block(s) (event.result was empty)`);
        }

        // 檢查中間 text blocks 是否有 tags 被 result 事件覆蓋而遺失
        // result 事件只包含最後一個 assistant turn 的 text，中間 turns 的 tags 會被丟棄
        const TAG_RE = /<kuro:(chat|ask|remember|show|summary|task|archive|impulse|thread|action|delegate|done|schedule|inner|goal)/i;
        if (allTextBlocks.length > 1) {
          const intermediateWithTags = allTextBlocks.slice(0, -1).filter(b => TAG_RE.test(b));
          if (intermediateWithTags.length > 0 && !TAG_RE.test(resultText)) {
            slog('TAGS', `Recovered ${intermediateWithTags.length} intermediate text block(s) with tags`);
            resultText = intermediateWithTags.join('\n') + '\n' + resultText;
          }
        }
        resolve(resultText);
      }
    });

    child.on('error', (err) => {
      settled = true;
      clearTimeout(timer);
      clearInterval(progressTimer);
      emitProgress.cancel();
      if (source === 'loop') {
        loopChildPid = null;
      } else if (source === 'foreground' && opts?.fgSlotId) {
        const slot = foregroundSlots.get(opts.fgSlotId);
        if (slot) slot.pid = null;
      }
      chatStreamParser?.end();
      reject(Object.assign(err, { stderr, stdout: resultText, killed: timedOut, duration: Date.now() - startTs, timeoutMs: TIMEOUT_MS }));
    });

    child.stdin.write(fullPrompt);
    child.stdin.end();
  });
}

/**
 * 單次 Codex CLI 呼叫（內部用）
 * 使用 JSONL 格式捕獲中間工具呼叫並寫入 audit log
 *
 * 安全機制與 execClaude 相同：detached process group + 手動 timeout
 */
async function execCodex(fullPrompt: string, opts?: ExecOptions): Promise<string> {
  const TIMEOUT_MS = 900_000; // 15 minutes (same as Claude)
  const startTs = Date.now();
  const source = opts?.source ?? 'loop';

  // Resolve the correct task reference for progress tracking (loop vs foreground slot)
  const activeTask = (): TaskInfo | null => {
    if (opts?.fgSlotId) {
      return foregroundSlots.get(opts.fgSlotId)?.task ?? null;
    }
    return loopTask;
  };

  // 過濾掉 OPENAI_API_KEY — 讓 Codex CLI 走訂閱而非 API credit
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => k !== 'OPENAI_API_KEY'),
  );

  const args = ['exec', '--dangerously-bypass-approvals-and-sandbox', '--json'];
  if (process.env.CODEX_MODEL) {
    args.push('-m', process.env.CODEX_MODEL);
  }

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let timedOut = false;

    const child = spawn(
      'codex',
      args,
      {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true,
      },
    );

    let resultText = '';
    let buffer = '';
    let stderr = '';
    let toolCallCount = 0;

    // Absorb pipe errors from preempted child — log but don't crash
    const onPipeError = (e: Error) => { if ((e as NodeJS.ErrnoException).code !== 'EPIPE') slog('CLAUDE', `pipe error: ${e.message}`); };
    child.stdin.on('error', onPipeError);
    child.stdout.on('error', onPipeError);
    child.stderr.on('error', onPipeError);

    // ── 手動 timeout：殺整個進程群組（含子進程）──
    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      slog('CODEX', `Timeout (${TIMEOUT_MS / 1000}s) — killing process group ${child.pid}`);
      try {
        process.kill(-child.pid!, 'SIGTERM');
      } catch (e) { slog('CODEX', `SIGTERM failed for pgid ${child.pid}: ${e}`); }
      setTimeout(() => {
        try { process.kill(-child.pid!, 'SIGKILL'); } catch (e) { slog('CODEX', `SIGKILL failed for pgid ${child.pid}: ${e}`); }
        // Force-resolve safety net
        setTimeout(() => {
          if (!settled) {
            settled = true;
            const duration = Date.now() - startTs;
            slog('CODEX', `Force-resolve: close event not received 10s after SIGKILL (pid ${child.pid}), elapsed=${(duration / 1000).toFixed(1)}s`);
            reject(Object.assign(new Error('Codex CLI force-resolved: close event timeout after SIGKILL'), {
              stderr, stdout: resultText, status: null, killed: true, signal: 'SIGKILL', duration, timeoutMs: TIMEOUT_MS,
            }));
          }
        }, 10_000);
      }, 5000);
    }, TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf-8');
      // 逐行解析 JSONL
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (!line) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === 'item.completed' && event.item) {
            const item = event.item;
            if (item.type === 'agent_message' && item.text) {
              resultText = item.text;
              { const task = activeTask();
              if (task) {
                task.lastText = item.text.slice(0, 200);
              } }
            } else if (item.type === 'tool_call') {
              toolCallCount++;
              const toolName = item.tool ?? 'unknown';
              const toolInput = (item.input ?? item.args ?? {}) as Record<string, unknown>;
              writeAuditLog(toolName, toolInput);
              { const task = activeTask();
              if (task) {
                const summary = toolInput.command ?? toolInput.file_path ?? toolInput.pattern ?? '';
                task.toolCalls = toolCallCount;
                task.lastTool = `${toolName}: ${String(summary).slice(0, 80)}`;
                // Track files for cross-lane coordination
                if (toolInput.file_path && typeof toolInput.file_path === 'string') {
                  task.recentFiles.add(toolInput.file_path);
                }
              } }
            }
          }
          // turn.completed — final event, usage info (no text to extract)
        } catch { /* ignore malformed JSON lines */ }
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });

    child.on('close', (code, signal) => {
      settled = true;
      clearTimeout(timer);
      const duration = Date.now() - startTs;

      // 處理 buffer 中剩餘的不完整行
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer.trim());
          if (event.type === 'item.completed' && event.item?.type === 'agent_message' && event.item.text) {
            resultText = event.item.text;
          }
        } catch { /* ignore */ }
      }

      if (toolCallCount > 0) {
        slog('AUDIT', `Codex CLI used ${toolCallCount} tool(s) this call`);
      }

      if (code !== 0 && !resultText) {
        reject(Object.assign(new Error(`Codex CLI exited with code ${code}`), { stderr, stdout: resultText, status: code, killed: timedOut, signal, duration, timeoutMs: TIMEOUT_MS }));
      } else {
        resolve(resultText);
      }
    });

    child.on('error', (err) => {
      settled = true;
      clearTimeout(timer);
      reject(Object.assign(err, { stderr, stdout: resultText, killed: timedOut, duration: Date.now() - startTs, timeoutMs: TIMEOUT_MS }));
    });

    child.stdin.write(fullPrompt);
    child.stdin.end();
  });
}

// =============================================================================
// Local LLM Provider (OpenAI-compatible API — oMLX, ollama, vLLM, etc.)
//
// Config files: llm/profiles/{profile}.json
// Profile selection: opts.model matches profile name → load that config
//                    otherwise → llm/profiles/default.json
// Env fallbacks: LOCAL_LLM_URL, LOCAL_LLM_KEY (per-profile url/key/model take precedence)
// =============================================================================

// Per-lane abort controllers for HTTP-based providers (local LLM)
let loopAbortController: AbortController | null = null;
// foreground abort controllers are now tracked per-slot in foregroundSlots
const MAX_TOOL_ROUNDS = 10;

// --- Profile types & loader ---

export interface LocalProfile {
  model?: string;
  /** Per-profile server URL (overrides LOCAL_LLM_URL) */
  url?: string;
  /** Per-profile API key (overrides LOCAL_LLM_KEY) */
  key?: string;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  presence_penalty?: number;
  repetition_penalty?: number;
  enable_thinking?: boolean;
  tools_enabled?: boolean;
  timeout_ms?: number;
  /** Server-specific extra body params (e.g. oMLX chat_template_kwargs, ollama options) */
  extra_body?: Record<string, unknown>;
}

// Structural defaults only — model and server config come from profile JSON or env
// repetition_penalty: 0 = not sent (thinking mode should omit it)
const LOCAL_PROFILE_DEFAULTS: Required<LocalProfile> = {
  model: process.env.LOCAL_LLM_MODEL || '',  // from env, or must be specified in profile JSON
  url: '',   // empty = use LOCAL_LLM_URL env or http://localhost:8000
  key: '',   // empty = use LOCAL_LLM_KEY env or 'local'
  max_tokens: 8192,
  temperature: 0.7,
  top_p: 0.8,
  top_k: 20,
  presence_penalty: 1.5,
  repetition_penalty: 0,
  enable_thinking: false,
  tools_enabled: true,
  timeout_ms: 600_000,
  extra_body: {},
};

const profileCache = new Map<string, { profile: LocalProfile; loadedAt: number }>();
const PROFILE_CACHE_TTL = 30_000; // 30s hot reload

export function loadLocalProfile(name: string): Required<LocalProfile> {
  const now = Date.now();
  const cached = profileCache.get(name);
  if (cached && now - cached.loadedAt < PROFILE_CACHE_TTL) {
    return { ...LOCAL_PROFILE_DEFAULTS, ...cached.profile };
  }

  const profilePath = path.join(process.cwd(), 'llm', 'profiles', `${name}.json`);
  let profile: LocalProfile = {};
  try {
    profile = JSON.parse(readFileSyncFs(profilePath, 'utf-8')) as LocalProfile;
    profileCache.set(name, { profile, loadedAt: now });
  } catch {
    // File not found or parse error — use defaults
  }

  return { ...LOCAL_PROFILE_DEFAULTS, ...profile };
}

/** Resolve which profile to use: opts.model as profile name, or 'default' */
function resolveLocalProfile(opts?: ExecOptions): { profile: Required<LocalProfile>; profileName: string } {
  const candidate = opts?.model;
  if (candidate) {
    // Check if it's a profile name (file exists)
    const profilePath = path.join(process.cwd(), 'llm', 'profiles', `${candidate}.json`);
    try {
      readFileSyncFs(profilePath);
      return { profile: loadLocalProfile(candidate), profileName: candidate };
    } catch {
      // Not a profile name — treat as model override on default profile
      const p = loadLocalProfile('default');
      p.model = candidate;
      return { profile: p, profileName: 'default' };
    }
  }
  return { profile: loadLocalProfile('default'), profileName: 'default' };
}

// --- Auto-routing: fast classify → pick profile ---

const ROUTE_SYSTEM = `Classify the task into exactly ONE category. Output ONLY the category name, nothing else.

Categories:
- coding (writing, debugging, refactoring code)
- reasoning (analysis, planning, complex logic, math)
- creative (writing prose, poetry, storytelling, brainstorming)
- chat (quick reply, greeting, acknowledgment, short answer)
- general (everything else)`;

/**
 * Use fast profile to classify prompt, then return the appropriate profile name.
 * Falls back to 'default' on any error.
 */
async function autoRouteProfile(prompt: string): Promise<string> {
  const fast = loadLocalProfile('fast');
  const llmUrl = fast.url || process.env.LOCAL_LLM_URL || 'http://localhost:8000';
  const llmKey = fast.key || process.env.LOCAL_LLM_KEY || 'local';
  const model = fast.model;

  try {
    const res = await fetch(`${llmUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${llmKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: ROUTE_SYSTEM },
          { role: 'user', content: prompt.slice(0, 500) },
        ],
        max_tokens: 16,
        temperature: 0.1,
        top_p: 0.8,
        ...(fast.extra_body || {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return 'default';

    const data = await res.json() as { choices?: Array<{ message?: { content: string } }> };
    const category = (data.choices?.[0]?.message?.content ?? '').trim().toLowerCase();

    const ROUTE_MAP: Record<string, string> = {
      coding: 'thinking-code',
      reasoning: 'thinking',
      creative: 'creative',
      chat: 'fast',
      general: 'default',
    };
    const profileName = ROUTE_MAP[category] ?? 'default';
    slog('LOCAL', `auto-route: "${category}" → profile=${profileName}`);
    return profileName;
  } catch {
    return 'default';
  }
}

// --- Tool types & definitions ---

interface LocalMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: LocalToolCall[];
  tool_call_id?: string;
}

interface LocalToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

const LOCAL_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'search_memory',
      description: 'Search agent memory and topics by keyword',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Search keywords' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_file',
      description: 'Read a file (max 8KB returned)',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Absolute file path' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'run_command',
      description: 'Execute shell command (10s timeout, max 8KB output)',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string', description: 'Shell command' } },
        required: ['command'],
      },
    },
  },
];

// --- Tool execution ---

async function executeLocalToolCall(call: LocalToolCall): Promise<string> {
  try {
    const args = JSON.parse(call.function.arguments) as Record<string, string>;
    switch (call.function.name) {
      case 'search_memory': {
        const { searchMemory } = await import('./memory.js');
        const results = await searchMemory(args.query);
        return JSON.stringify(results.slice(0, 5));
      }
      case 'read_file':
        return readFileSyncFs(args.path, 'utf-8').slice(0, 8000);
      case 'run_command': {
        const { exec } = await import('node:child_process');
        const { promisify } = await import('node:util');
        const execAsync = promisify(exec);
        const { stdout } = await execAsync(args.command, { timeout: 10_000, encoding: 'utf-8' });
        return stdout.slice(0, 8000);
      }
      default:
        return `Unknown tool: ${call.function.name}`;
    }
  } catch (e) {
    return `Error: ${(e as Error).message}`;
  }
}

// --- Streaming round ---

interface LocalRoundResult {
  content: string;
  toolCalls: LocalToolCall[];
}

async function streamLocalRound(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  signal: AbortSignal,
  opts?: ExecOptions,
): Promise<LocalRoundResult> {
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...body, stream: true, stream_options: { include_usage: true } }),
    signal,
  });
  if (!res.ok) {
    throw Object.assign(new Error(`Local LLM error: ${res.status} ${res.statusText}`), { status: res.status });
  }

  let content = '';
  const toolCallsMap = new Map<number, LocalToolCall>();
  let lastCbLen = 0;
  const chatStreamParser = opts?.onStreamChat
    ? createKuroChatStreamParser((tag) => {
      const isReply = tag.attributes.reply === 'true'
        || tag.attributes.replyTo !== undefined
        || tag.attributes.replyto !== undefined;
      const cleaned = stripTurnSeparators(tag.content.trim());
      if (cleaned) opts.onStreamChat?.(cleaned, isReply);
    }, { maxDepth: Number.MAX_SAFE_INTEGER })
    : null;

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ') || line === 'data: [DONE]') continue;
      try {
        const chunk = JSON.parse(line.slice(6)) as {
          choices: Array<{
            delta: {
              content?: string;
              tool_calls?: Array<{
                index: number; id?: string; type?: string;
                function?: { name?: string; arguments?: string };
              }>;
            };
          }>;
        };
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          content += delta.content;
          if (opts?.onPartialOutput && content.length - lastCbLen >= 100) {
            opts.onPartialOutput(content);
            lastCbLen = content.length;
          }
          chatStreamParser?.write(delta.content);
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const existing = toolCallsMap.get(tc.index);
            if (existing) {
              if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
            } else {
              toolCallsMap.set(tc.index, {
                id: tc.id ?? `call_${tc.index}`,
                type: 'function',
                function: { name: tc.function?.name ?? '', arguments: tc.function?.arguments ?? '' },
              });
            }
          }
        }
      } catch { /* malformed chunk */ }
    }
  }

  chatStreamParser?.end();
  if (opts?.onPartialOutput && content.length > lastCbLen) opts.onPartialOutput(content);
  return { content, toolCalls: Array.from(toolCallsMap.values()).filter(tc => tc.function.name) };
}

// --- Main entry ---

/**
 * Local LLM via OpenAI-compatible API — config-driven from llm/profiles/{profile}.json
 *
 * Features:
 * - Profile selection: opts.model='thinking' → loads llm/profiles/thinking.json
 * - Tool use: search_memory, read_file, run_command (multi-round, max 10)
 * - Always streaming for better concurrent performance
 * - Thinking mode: per-profile enable_thinking flag
 * - Per-profile url/key/model; env fallbacks: LOCAL_LLM_URL, LOCAL_LLM_KEY
 *
 * <kuro:*> tags still work (parsed by dispatcher after final response).
 */
async function execLocal(fullPrompt: string, opts?: ExecOptions): Promise<string> {
  const source = opts?.source ?? 'loop';

  // Auto-route: if no profile specified, classify first then pick the best profile
  let resolved = resolveLocalProfile(opts);
  if (!opts?.model) {
    const routed = await autoRouteProfile(fullPrompt);
    if (routed !== 'default') {
      resolved = { profile: loadLocalProfile(routed), profileName: routed };
    }
  }
  const { profile, profileName } = resolved;

  // Priority: profile-specific → env → hardcoded default
  const llmUrl = profile.url || process.env.LOCAL_LLM_URL || 'http://localhost:8000';
  const llmKey = profile.key || process.env.LOCAL_LLM_KEY || 'local';
  const model = profile.model; // already resolved via profile JSON → LOCAL_PROFILE_DEFAULTS chain

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), profile.timeout_ms);

  // Track abort controller per-lane for preemption support
  if (source === 'loop') {
    loopChildPid = null;
    loopAbortController = controller;
  } else if (source === 'foreground' && opts?.fgSlotId) {
    const slot = foregroundSlots.get(opts.fgSlotId);
    if (slot) { slot.pid = null; slot.abortController = controller; }
  }

  const url = `${llmUrl}/v1/chat/completions`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${llmKey}`,
  };
  const messages: LocalMessage[] = [{ role: 'user', content: fullPrompt }];

  slog('LOCAL', `profile=${profileName} model=${model} thinking=${profile.enable_thinking} tools=${profile.tools_enabled}`);

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const body: Record<string, unknown> = {
        model,
        messages,
        max_tokens: profile.max_tokens,
        temperature: profile.temperature,
        top_p: profile.top_p,
        top_k: profile.top_k,
        presence_penalty: profile.presence_penalty,
        ...(profile.repetition_penalty > 0 ? { repetition_penalty: profile.repetition_penalty } : {}),
        ...(profile.extra_body || {}),
        ...(profile.tools_enabled ? { tools: LOCAL_TOOLS } : {}),
      };

      // Always stream — better concurrent performance, callbacks fire only when present
      const result = await streamLocalRound(url, headers, body, controller.signal, opts);

      if (!result.toolCalls.length) return result.content;

      slog('LOCAL', `tool round ${round + 1}: ${result.toolCalls.map(c => c.function.name).join(', ')}`);
      messages.push({ role: 'assistant', content: result.content || null, tool_calls: result.toolCalls });

      for (const call of result.toolCalls) {
        const toolResult = await executeLocalToolCall(call);
        messages.push({ role: 'tool', content: toolResult, tool_call_id: call.id });
      }
    }

    return messages.filter(m => m.role === 'assistant').pop()?.content ?? '';
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      throw Object.assign(new Error('Local LLM 超時'), { killed: true, timeoutMs: profile.timeout_ms });
    }
    throw e;
  } finally {
    clearTimeout(timer);
    if (source === 'loop') loopAbortController = null;
    else if (source === 'foreground' && opts?.fgSlotId) {
      const slot = foregroundSlots.get(opts.fgSlotId);
      if (slot) slot.abortController = null;
    }
  }
}

/**
 * Resolve the model name for tier detection.
 * For local provider: check model override → profile model → env default.
 * For claude/codex: returns undefined (always large tier).
 */
function resolveModelName(provider: Provider, modelOverride?: string): string | undefined {
  if (provider !== 'local') return undefined;
  if (modelOverride) {
    // Model override might be a profile name — resolve to actual model
    const profile = loadLocalProfile(modelOverride);
    return profile.model || modelOverride;
  }
  // Default profile's model
  const profile = loadLocalProfile('default');
  return profile.model || process.env.LOCAL_LLM_MODEL || undefined;
}

/**
 * Call Claude Code via subprocess with smart retry
 * - Retries on transient errors (timeout, rate limit) with exponential backoff
 * - On TIMEOUT: rebuilds context with progressively smaller modes (focused → minimal)
 * - Releases per-lane busy during retry wait (user requests take priority)
 */
export async function callClaude(
  prompt: string,
  context: string,
  maxRetries = 2,
  options?: {
    /** 超時重試時重建 context 的回調。attempt=1 建議 'focused'，attempt=2 建議 'minimal' */
    rebuildContext?: (mode: 'focused' | 'minimal', contextBudget?: number) => Promise<string>;
    /** 呼叫來源：'chat'=用戶訊息，'loop'=OODA cycle */
    source?: CallSource;
    /** Streaming partial output callback（用於 cycle checkpoint） */
    onPartialOutput?: (text: string) => void;
    /** OODA cycle mode hint for skill filtering */
    cycleMode?: CycleMode;
    /** Model override — 智能路由選擇的模型（e.g. 'sonnet'） */
    model?: string;
    /** Streaming chat callback — fires as soon as a complete <kuro:chat> tag is detected during generation */
    onStreamChat?: (text: string, reply: boolean) => void;
    /** Foreground slot ID for concurrent foreground tracking */
    fgSlotId?: string;
    /** Hard timeout in ms (default: 15min). FG lane should use shorter value. */
    timeoutMs?: number;
    /** No-progress timeout in ms (default: 5min). Kill if no stdout for this long. */
    progressTimeoutMs?: number;
    /** Trigger reason hint — used by small model prompt builder */
    triggerReason?: string | null;
    /** Whether there are pending tasks — used by small model prompt builder */
    hasPendingTasks?: boolean;
  },
): Promise<{ response: string; systemPrompt: string; fullPrompt: string; duration: number; preempted?: boolean; error?: ErrorClassification }> {
  const source = options?.source ?? 'loop';

  // --- Model-Aware Context Pipeline ---
  // Detect model tier to adapt context and prompt for model capabilities.
  // Small models (4B) get pre-digested context + simplified prompt.
  // Large models (Opus) get denoised context + full prompt.
  const primary = getProviderForSource(source);
  const modelTier: ModelTier = detectModelTier(primary, resolveModelName(primary, options?.model));

  // Early mode selection: low-priority background triggers skip the full→focused→minimal
  // fallback chain. workspace/heartbeat/cron are poke events (file-change, tick, schedule),
  // not user-facing cycles. They don't need skill content or full guidance; they need to
  // look at the environment and possibly emit a short <kuro:inner>/<kuro:chat>.
  //
  // Convergence (not prescription): "prompt must fit PROMPT_HARD_CAP on the first attempt
  // for low-priority triggers". Avoid the 3-min compactContext + rebuildContext chain
  // observed 2026-04-17 19:16–19:20 when workspace cycles got full system prompt.
  const triggerReason = options?.triggerReason ?? '';
  // Low-priority background triggers. Keep room/room-foreground/dm/alert OFF the list —
  // user-facing cycles need full guidance. Empty/unknown triggers fall back to full prompt too,
  // to stay safe for human-initiated flows that didn't tag themselves.
  // continuation is NOT low priority — it continues substantive work from the previous cycle
  // and needs full system prompt to know identity/skills/rules. Stripping it to 273 chars
  // caused a downward spiral: no identity → "no action" → noop streak → light context → repeat.
  const lowPriorityTrigger = /^(workspace|heartbeat|cron|startup|mobile)\b/.test(triggerReason);
  const initialPromptMode: 'full' | 'minimal' | undefined = lowPriorityTrigger ? 'minimal' : undefined;

  const systemPrompt = modelTier === 'small'
    ? buildSmallModelPrompt(triggerReason || null, options?.hasPendingTasks ?? false)
    : getSystemPrompt(prompt, options?.cycleMode, initialPromptMode, triggerReason || undefined);
  if (lowPriorityTrigger) {
    slog('AGENT', `Trigger "${triggerReason.slice(0, 40)}" → minimal system prompt (${systemPrompt.length} chars, skipped fallback chain)`);
  }
  let currentContext = processContext(context, modelTier);
  let fullPrompt = `${systemPrompt}\n\n${currentContext}\n\n---\n\nUser: ${prompt}`;

  if (modelTier === 'small') {
    slog('AGENT', `Small model pipeline: context ${context.length} → ${currentContext.length} chars, prompt ${fullPrompt.length} chars`);
  }

  // Pre-check: if prompt is too large, proactively reduce context before first attempt
  // Lowered from 80K → 60K → 45K: data shows prompts >50K → 100% EXIT143.
  // Profile-based contextBudget (omlx-gate.ts) is the primary control;
  // this cap is the hard safety net ensuring CLI stability.
  const PROMPT_HARD_CAP = 45_000;
  const PROMPT_TARGET = 30_000; // Target for minimal mode — ensure Claude can process within timeout
  // Calculate actual context budget from known non-context sizes
  const nonContextSize = systemPrompt.length + prompt.length + 20; // 20 for separators
  const actualContextBudget = PROMPT_HARD_CAP - nonContextSize;
  if (fullPrompt.length > PROMPT_HARD_CAP && options?.rebuildContext) {
    slog('AGENT', `Prompt too large (${fullPrompt.length} chars, context=${currentContext.length}, non-context=${nonContextSize}), pre-reducing context to budget=${actualContextBudget}`);
    try {
      currentContext = await options.rebuildContext('focused', actualContextBudget);
      fullPrompt = `${systemPrompt}\n\n${currentContext}\n\n---\n\nUser: ${prompt}`;
      if (fullPrompt.length > PROMPT_TARGET) {
        // P1-5: Try intelligent compaction before falling back to minimal mode
        // Compaction preserves meaning while reducing size — minimal mode strips sections
        const compacted = await compactContext(currentContext, actualContextBudget);
        if (compacted) {
          currentContext = compacted;
          fullPrompt = `${systemPrompt}\n\n${currentContext}\n\n---\n\nUser: ${prompt}`;
          slog('AGENT', `P1-5 compaction: ${currentContext.length} chars`);
        }
        if (fullPrompt.length > PROMPT_TARGET) {
          currentContext = await options.rebuildContext('minimal', actualContextBudget);
          const minimalSystemPrompt = getSystemPrompt(prompt, options?.cycleMode, 'minimal');
          fullPrompt = `${minimalSystemPrompt}\n\n${currentContext}\n\n---\n\nUser: ${prompt}`;
          slog('AGENT', `Minimal mode: sysPrompt ${systemPrompt.length} → ${minimalSystemPrompt.length} chars`);
        }
      }
      slog('AGENT', `Context pre-reduced to ${fullPrompt.length} chars${fullPrompt.length > PROMPT_TARGET ? ' (still above target — monitor for timeout)' : ''}`);
    } catch (preErr) {
      // Emergency fallback: strip system prompt to minimal even if context rebuild failed
      slog('AGENT', `Context pre-reduce failed: ${preErr}, using minimal system prompt as fallback`);
      try {
        const minimalSystemPrompt = getSystemPrompt(prompt, options?.cycleMode, 'minimal');
        fullPrompt = `${minimalSystemPrompt}\n\n${currentContext}\n\n---\n\nUser: ${prompt}`;
        slog('AGENT', `Fallback: stripped system prompt ${systemPrompt.length} → ${minimalSystemPrompt.length}, total ${fullPrompt.length} chars`);
      } catch { /* truly nothing we can do, proceed with original */ }
    }
  }

  // Busy helpers — each lane tracks its own busy/task state independently
  // 'ask' source runs in parallel — no busy guard, no state tracking
  // Foreground uses per-slot tracking via fgSlotId for concurrent support
  const isLoopSource = source === 'loop';
  const isFgSource = source === 'foreground';
  const fgSlotId = options?.fgSlotId;
  const isBusy = () => {
    if (isLoopSource) return loopBusy;
    if (isFgSource) {
      // Per-slot check: this specific slot is already busy
      if (fgSlotId) {
        const slot = foregroundSlots.get(fgSlotId);
        return slot?.busy ?? false;
      }
      // No slot ID (legacy) — check global capacity
      return isForegroundBusy();
    }
    return false; // 'ask' has no busy guard
  };
  const setBusy = (v: boolean) => {
    if (isLoopSource) loopBusy = v;
    if (isFgSource && fgSlotId) {
      const slot = foregroundSlots.get(fgSlotId);
      if (slot) {
        slot.busy = v;
        const now = Date.now();
        slot.lastActivityTs = now;
        if (v) slot.startedAt = now;
      }
    }
  };
  const setTask = (v: TaskInfo | null) => {
    if (isLoopSource) loopTask = v;
    if (isFgSource && fgSlotId) {
      const slot = foregroundSlots.get(fgSlotId);
      if (slot) slot.task = v;
    }
  };

  // Busy guard — 防止同一 lane 並發呼叫（only for loop source）
  if (isBusy()) {
    return {
      response: '我正在處理另一個請求，請稍後再試。',
      systemPrompt,
      fullPrompt,
      duration: 0,
    };
  }

  // primary already resolved above for model tier detection
  const startTime = Date.now();
  let lastErrorMessage = '重試次數已用盡。';

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // 每次嘗試前檢查 busy（重試等待期間可能被其他請求佔走）
    if (isBusy()) {
      return {
        response: '重試期間收到新請求，已優先處理新請求。',
        systemPrompt,
        fullPrompt,
        duration: Date.now() - startTime,
      };
    }

    const genAtStart = loopGeneration;
    const attemptStartTime = Date.now();
    setBusy(true);
    setTask({ prompt: prompt.slice(0, 200), startedAt: attemptStartTime, toolCalls: 0, lastTool: null, lastText: null, recentFiles: new Set() });

    try {
      const result = await execProvider(primary, fullPrompt, {
        source,
        onPartialOutput: options?.onPartialOutput,
        model: options?.model,
        onStreamChat: options?.onStreamChat,
        fgSlotId,
        timeoutMs: options?.timeoutMs,
        progressTimeoutMs: options?.progressTimeoutMs,
      });

      const duration = Date.now() - startTime;

      // Preemption detection: generation changed while we were running
      if (source === 'loop' && loopGeneration !== genAtStart) {
        return { response: result.trim(), systemPrompt, fullPrompt, duration, preempted: true };
      }

      try {
        const logger = getLogger();
        const providerInfo = primary !== 'claude' ? ` [${primary}]` : '';
        const retryInfo = attempt > 0 ? ` (retry #${attempt}, ${fullPrompt.length} chars)` : '';
        logger.logBehavior('agent', 'claude.call', `${prompt.slice(0, 100)} → ${(duration / 1000).toFixed(1)}s${providerInfo}${retryInfo} [${source}]`);
      } catch { /* logger not ready */ }

      return { response: result.trim(), systemPrompt, fullPrompt, duration };
    } catch (error) {
      const duration = Date.now() - startTime;
      const attemptDuration = Date.now() - attemptStartTime;

      // Preemption detection: don't retry if preempted
      if (source === 'loop' && loopGeneration !== genAtStart) {
        const stdout = (error as { stdout?: string })?.stdout?.trim() ?? '';
        return { response: stdout, systemPrompt, fullPrompt, duration, preempted: true };
      }

      const stderr = (error as { stderr?: string })?.stderr?.trim() ?? '';
      const exitCode = (error as { status?: number })?.status;
      const classified = classifyError(error);

      // Log error — include both per-attempt and total duration for accurate debugging
      const logger = getLogger();
      logger.logError(
        new Error(`${primary} CLI ${classified.type} (exit ${exitCode ?? 'N/A'}, ${attemptDuration}ms this attempt, ${duration}ms total, attempt ${attempt + 1}/${maxRetries + 1}, prompt ${fullPrompt.length} chars, ${source} lane): ${stderr.slice(0, 500) || classified.message}`),
        'callClaude'
      );

      lastErrorMessage = `${classified.message}\n[Model Guidance: ${classified.modelGuidance}]`;

      // 如果可重試且還有機會，等待後重試
      if (classified.retryable && attempt < maxRetries) {
        // OOM-likely errors (exit 143 = SIGTERM) need longer backoff to let system reclaim memory
        const isOomLikely = exitCode === 143 || (exitCode === null && classified.type === 'TIMEOUT');
        const baseDelay = isOomLikely ? 90_000 : 30_000; // 90s/180s for OOM vs 30s/60s normal
        const delay = baseDelay * Math.pow(2, attempt);

        // TIMEOUT retry strategy depends on whether Claude was actively working:
        // tools=0 → API-side problem (rate limit, outage), rebuildContext is wasteful
        // tools>0 → context/complexity problem, reduce context
        const errToolCount = (error as { toolCallCount?: number })?.toolCallCount ?? -1;
        if (classified.type === 'TIMEOUT' && errToolCount === 0) {
          // Fast-fail path: API was unreachable, don't waste time rebuilding context
          slog('RETRY', `TIMEOUT tools=0 on attempt ${attempt + 1} — API-side issue, skipping rebuildContext, retrying same prompt (${fullPrompt.length} chars) in ${delay / 1000}s`);
        } else if (classified.type === 'TIMEOUT' && options?.rebuildContext) {
          try {
            const prevLen = currentContext.length;
            const minimalSystemPrompt = getSystemPrompt(prompt, options?.cycleMode, 'minimal');
            const minimalBudget = PROMPT_HARD_CAP - minimalSystemPrompt.length - prompt.length - 20;
            currentContext = await options.rebuildContext('minimal', minimalBudget);
            // Error trace retention: models avoid repeating mistakes when they see what went wrong
            const errorTrace = `## Previous Attempt Failed\nType: ${classified.type} | Duration: ${attemptDuration}ms | Tool calls: ${errToolCount}\nGuidance: ${classified.modelGuidance}\nContext reduced from ${prevLen} to ${currentContext.length} chars for retry.`;
            fullPrompt = `${minimalSystemPrompt}\n\n${currentContext}\n\n${errorTrace}\n\n---\n\nUser: ${prompt}`;
            slog('RETRY', `TIMEOUT tools=${errToolCount} on attempt ${attempt + 1}, prompt reduced ${prevLen + systemPrompt.length} → ${fullPrompt.length} chars (minimal + error trace, sysPrompt ${minimalSystemPrompt.length}), retrying in ${delay / 1000}s`);
          } catch (rebuildErr) {
            // Emergency fallback: even if rebuildContext fails, at least strip the system prompt
            slog('RETRY', `${classified.type} on attempt ${attempt + 1}, context rebuild failed: ${rebuildErr}`);
            try {
              const minimalSystemPrompt = getSystemPrompt(prompt, options?.cycleMode, 'minimal');
              fullPrompt = `${minimalSystemPrompt}\n\n${currentContext}\n\n---\n\nUser: ${prompt}`;
              slog('RETRY', `Emergency fallback: stripped sysPrompt ${systemPrompt.length} → ${minimalSystemPrompt.length}, total ${fullPrompt.length} chars`);
            } catch {
              slog('RETRY', `Emergency fallback also failed, retrying with same ${fullPrompt.length} char prompt in ${delay / 1000}s`);
            }
          }
        } else {
          // Error trace retention for non-TIMEOUT retries: inject what went wrong so model can adapt
          const errorTrace = `\n\n## Previous Attempt Failed\nType: ${classified.type} | Guidance: ${classified.modelGuidance}`;
          fullPrompt = fullPrompt.replace('\n\n---\n\nUser: ', `${errorTrace}\n\n---\n\nUser: `);
          slog('RETRY', `${classified.type} on attempt ${attempt + 1}, error context injected, retrying in ${delay / 1000}s`);
        }

        // 釋放 busy — 等待期間允許新請求插入
        setBusy(false);
        setTask(null);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      // 最後一次嘗試也失敗了，或不可重試 — 嘗試 fallback
      // Emit sense event for network-like failures (helps Kuro adjust behavior)
      if (classified.type === 'TIMEOUT' || classified.type === 'UNKNOWN') {
        eventBus.emit('trigger:sense', {
          type: 'api-status',
          service: primary,
          status: 'unreachable',
          error: classified.message,
          retriesExhausted: true,
        }, { priority: 'P1', source: 'agent' });
      }

      const stdout = (error as { stdout?: string })?.stdout?.trim();
      if (stdout && stdout.length > 20) {
        return { response: stdout, systemPrompt, fullPrompt, duration };
      }

      // Fallback: 主要 provider 全部失敗後，嘗試備用 provider（最多一次）
      const fallback = getFallback();
      if (fallback && fallback !== primary) {
        slog('FALLBACK', `${primary} failed after ${attempt + 1} attempt(s), trying ${fallback}`);
        setBusy(true);
        setTask({ prompt: prompt.slice(0, 200), startedAt: Date.now(), toolCalls: 0, lastTool: null, lastText: null, recentFiles: new Set() });
        try {
          const fbResult = await execProvider(fallback, fullPrompt, { source });
          const fbDuration = Date.now() - startTime;
          try {
            const fbLogger = getLogger();
            fbLogger.logBehavior('agent', 'claude.call', `${prompt.slice(0, 100)} → ${(fbDuration / 1000).toFixed(1)}s [fallback:${fallback}] [${source}]`);
          } catch { /* logger not ready */ }
          return { response: fbResult.trim(), systemPrompt, fullPrompt, duration: fbDuration };
        } catch (fbError) {
          const fbMsg = fbError instanceof Error ? fbError.message : String(fbError);
          slog('FALLBACK', `${fallback} also failed: ${fbMsg.slice(0, 200)}`);
        } finally {
          setBusy(false);
          setTask(null);
        }
      }

      return { response: `${classified.message}\n[Model Guidance: ${classified.modelGuidance}]`, systemPrompt, fullPrompt, duration, error: classified };
    } finally {
      setBusy(false);
      setTask(null);
    }
  }

  // 理論上不會到這裡，但 TypeScript 需要
  return { response: lastErrorMessage, systemPrompt, fullPrompt, duration: Date.now() - startTime };
}
