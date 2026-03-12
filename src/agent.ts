/**
 * LLM Execution Layer (OODA-Only)
 *
 * Single loop lane: callClaude() → execProvider() → response
 */

import { spawn, execSync as execSyncChild } from 'node:child_process';
import { appendFileSync, mkdirSync, existsSync, readFileSync as readFileSyncFs } from 'node:fs';
import path from 'node:path';
import { getMemory } from './memory.js';
import { getCurrentInstanceId, getInstanceDir } from './instance.js';
import { getLogger } from './logging.js';
import { slog, diagLog } from './utils.js';
import { getSystemPrompt } from './dispatcher.js';
import type { CycleMode } from './memory.js';
import { eventBus } from './event-bus.js';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

// =============================================================================
// LLM Provider Abstraction
// =============================================================================

export type Provider = 'claude' | 'codex' | 'qwen';

export function getProvider(): Provider {
  const p = process.env.AGENT_PROVIDER?.toLowerCase();
  if (p === 'codex') return 'codex';
  if (p === 'qwen') return 'qwen';
  return 'claude';
}

export function getFallback(): Provider | null {
  const f = process.env.AGENT_FALLBACK?.toLowerCase();
  if (f === 'codex' || f === 'claude' || f === 'qwen') return f as Provider;
  return null;
}

interface ExecOptions {
  source?: CallSource;
  onPartialOutput?: (text: string) => void;
  /** Override model for this call (e.g. 'sonnet' for routine cycles) */
  model?: string;
  /** Streaming chat callback — fires as soon as a complete <kuro:chat> tag is detected during generation */
  onStreamChat?: (text: string, reply: boolean) => void;
}

async function execProvider(provider: Provider, fullPrompt: string, opts?: ExecOptions): Promise<string> {
  if (provider === 'codex') return execCodex(fullPrompt, opts);
  if (provider === 'qwen') return execQwen(fullPrompt, opts);
  return execClaude(fullPrompt, opts);
}

// getSystemPrompt is now imported from dispatcher.ts

/**
 * 錯誤分類結果
 */
interface ErrorClassification {
  type: 'TIMEOUT' | 'RATE_LIMIT' | 'NOT_FOUND' | 'PERMISSION' | 'MAX_BUFFER' | 'UNKNOWN';
  message: string;
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
  const combined = `${msg}\n${stderr}`.toLowerCase();

  if (combined.includes('enoent') || combined.includes('not found')) {
    return { type: 'NOT_FOUND', retryable: false, message: '無法找到 claude CLI。請確認已安裝 Claude Code 並且 claude 指令在 PATH 中。' };
  }
  // Exit 143 = SIGTERM (128+15) — context 過大或系統資源不足
  if (exitCode === 143) {
    return { type: 'TIMEOUT', retryable: true, message: 'Claude CLI 被 SIGTERM 終止（exit 143）。可能是 context 過大或系統資源不足。' };
  }
  // Duration-based timeout detection — catches race conditions where timedOut flag wasn't set
  // (e.g. process killed externally by OOM or system pressure before our timer fired)
  if (duration && timeoutMs && duration > timeoutMs * 0.9 && exitCode === null) {
    return { type: 'TIMEOUT', retryable: true, message: `處理超時（${Math.round(duration / 1000)}s）。進程可能被系統終止${signal ? `（signal: ${signal}）` : ''}。` };
  }
  // External signal detection — process terminated by signal but not our timeout
  if (signal && exitCode === null && !killed) {
    return { type: 'TIMEOUT', retryable: true, message: `CLI 被信號 ${signal} 終止。可能是系統資源不足。` };
  }
  if (killed || combined.includes('timeout') || combined.includes('timed out')) {
    return { type: 'TIMEOUT', retryable: true, message: '處理超時（超過 15 分鐘）。Claude CLI 回應太慢或暫時不可用，請稍後再試。' };
  }
  if (combined.includes('maxbuffer')) {
    return { type: 'MAX_BUFFER', retryable: false, message: '回應內容過大，超過緩衝區限制。請嘗試要求更簡潔的回覆。' };
  }
  if (combined.includes('credit balance') || combined.includes('billing')) {
    return { type: 'RATE_LIMIT', retryable: false, message: 'Anthropic API 餘額不足。Claude Lane 已設定走 CLI 訂閱，請確認 ANTHROPIC_API_KEY 未洩漏到子進程。' };
  }
  if (combined.includes('rate limit') || combined.includes('429')) {
    return { type: 'RATE_LIMIT', retryable: true, message: 'Claude API 達到速率限制，稍後自動重試。' };
  }
  if (combined.includes('access denied') || (combined.includes('permission') && !combined.includes('skip-permissions'))) {
    return { type: 'PERMISSION', retryable: false, message: '存取被拒絕。Claude CLI 可能沒有足夠的權限執行此操作。' };
  }

  // Try to extract useful info from stderr
  if (stderr.trim()) {
    const lines = stderr.trim().split('\n').filter((l: string) => l.trim());
    const lastLine = lines[lines.length - 1] || '';
    if (lastLine.length > 10 && lastLine.length < 300) {
      return { type: 'UNKNOWN', retryable: true, message: `Claude CLI 執行失敗：${lastLine}` };
    }
  }

  return { type: 'UNKNOWN', retryable: true, message: '處理訊息時發生錯誤。請稍後再試，或嘗試換個方式描述你的需求。' };
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
}

function formatTask(task: TaskInfo | null): { prompt: string; startedAt: string; elapsed: number; toolCalls: number; lastTool: string | null; lastText: string | null } | null {
  if (!task) return null;
  return {
    prompt: task.prompt,
    startedAt: new Date(task.startedAt).toISOString(),
    elapsed: Math.floor((Date.now() - task.startedAt) / 1000),
    toolCalls: task.toolCalls,
    lastTool: task.lastTool,
    lastText: task.lastText,
  };
}

// =============================================================================
// Lane Busy Locks
// =============================================================================

// Loop Lane (OODA cycle)
let loopBusy = false;
let loopTask: TaskInfo | null = null;
let loopChildPid: number | null = null;
let loopGeneration = 0; // Bumped on preemption — callClaude detects mismatch

// Foreground Lane (DM response while loop is busy)
let foregroundBusy = false;
let foregroundTask: TaskInfo | null = null;
let foregroundChildPid: number | null = null;

/** 查詢是否有任何 lane 正在執行 Claude CLI */
export function isClaudeBusy(): boolean {
  return loopBusy || foregroundBusy;
}

/** 查詢 loop lane 是否忙碌 */
export function isLoopBusy(): boolean {
  return loopBusy;
}

/** 查詢 foreground lane 是否忙碌 */
export function isForegroundBusy(): boolean {
  return foregroundBusy;
}

/** 查詢目前正在處理的任務 */
export function getCurrentTask(): { prompt: string; startedAt: string; elapsed: number; toolCalls: number; lastTool: string | null; lastText: string | null } | null {
  return formatTask(loopTask) ?? formatTask(foregroundTask);
}

/** 查詢所有 lane 狀態 */
export function getLaneStatus(): {
  loop: { busy: boolean; task: ReturnType<typeof formatTask> };
  foreground: { busy: boolean; task: ReturnType<typeof formatTask> };
} {
  return {
    loop: { busy: loopBusy, task: formatTask(loopTask) },
    foreground: { busy: foregroundBusy, task: formatTask(foregroundTask) },
  };
}

/** 搶佔正在執行的 loop cycle（用於 Alex 的 TG 訊息優先處理） */
export function preemptLoopCycle(): { preempted: boolean; partialOutput: string | null } {
  if (!loopBusy || !loopChildPid) {
    return { preempted: false, partialOutput: null };
  }

  const pid = loopChildPid;
  const partial = loopTask?.lastText ?? null;

  // Kill process group (includes child processes like curl)
  // For qwen HTTP calls, abort the fetch instead
  if (qwenAbortController) {
    qwenAbortController.abort();
    qwenAbortController = null;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch { /* already dead */ }

  // SIGKILL fallback after 3s
  setTimeout(() => {
    try { process.kill(-pid, 'SIGKILL'); } catch { /* already dead */ }
  }, 3000);

  loopGeneration++;
  loopBusy = false;
  loopTask = null;
  loopChildPid = null;

  slog('PREEMPT', `Killed loop process group (pid: ${pid}), generation: ${loopGeneration}`);
  eventBus.emit('action:loop', { event: 'preempted', partialOutput: partial?.slice(0, 100) });

  return { preempted: true, partialOutput: partial };
}

/** Abort foreground lane — kill running foreground process to make room for new P0 */
export function abortForeground(): boolean {
  if (!foregroundBusy || !foregroundChildPid) return false;
  const pid = foregroundChildPid;
  try { process.kill(-pid, 'SIGTERM'); } catch { /* already dead */ }
  setTimeout(() => { try { process.kill(-pid, 'SIGKILL'); } catch {} }, 3000);
  foregroundBusy = false;
  foregroundTask = null;
  foregroundChildPid = null;
  slog('PREEMPT', `Aborted foreground process (pid: ${pid}) for incoming P0`);
  return true;
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
async function execClaude(fullPrompt: string, opts?: ExecOptions): Promise<string> {
  const TIMEOUT_MS = 900_000; // 15 minutes
  const startTs = Date.now();
  const source = opts?.source ?? 'loop';

  // 過濾掉 ANTHROPIC_API_KEY — 讓 Claude CLI 走訂閱而非 API credit
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => k !== 'ANTHROPIC_API_KEY'),
  );

  // 不指定 --model → 走訂閱預設（Max = Opus）
  // 優先使用 per-call model（智能路由），其次 CLAUDE_MODEL env
  // --strict-mcp-config without --mcp-config → zero MCP servers loaded
  //   Subprocess is Kuro's internal brain — it shouldn't communicate with itself via MCP
  const args = ['-p', '--dangerously-skip-permissions', '--output-format', 'stream-json', '--verbose', '--strict-mcp-config'];
  const modelOverride = opts?.model ?? process.env.CLAUDE_MODEL;
  if (modelOverride) {
    args.push('--model', modelOverride);
  }

  // CLAUDE.md JIT: run subprocess in isolated cwd (no CLAUDE.md) to prevent
  // CLI from loading full project instructions. JIT-filtered content is already
  // included in the system prompt via getSystemPrompt() → getClaudeMdJIT().
  // --add-dir allows subprocess tools to access project files.
  const projectDir = process.cwd();
  const subprocessCwd = path.join(process.env.HOME ?? '/tmp', '.mini-agent', 'subprocess-cwd');
  if (!existsSync(subprocessCwd)) {
    mkdirSync(subprocessCwd, { recursive: true });
  }
  args.push('--add-dir', projectDir);

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let timedOut = false;
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
    } else if (source === 'foreground') {
      foregroundChildPid = child.pid ?? null;
    }

    let resultText = '';
    const allTextBlocks: string[] = []; // 累積所有 assistant text blocks（含中間 turns），防止 tags 遺失
    const streamedChatTexts = new Set<string>(); // Track chats already fired via streaming
    let buffer = '';
    let stderr = '';

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
            else if (source === 'foreground') foregroundChildPid = null;
            const duration = Date.now() - startTs;
            slog('CLAUDE', `Force-resolve: close event not received 10s after SIGKILL (pid ${child.pid}), elapsed=${(duration / 1000).toFixed(1)}s`);
            reject(Object.assign(new Error('Claude CLI force-resolved: close event timeout after SIGKILL'), {
              stderr, stdout: resultText, status: null, killed: true, signal: 'SIGKILL', duration, timeoutMs: TIMEOUT_MS,
            }));
          }
        }, 10_000);
      }, 5000);
    };

    // ── Progress timeout：5 分鐘無 stdout 就 kill ──
    const progressTimer = setInterval(() => {
      if (settled || timedOut) return;
      if (Date.now() - lastStdoutDataTs < 300_000) return;
      timedOut = true;
      clearInterval(progressTimer);
      slog('CLAUDE', `No stdout data for 5 minutes — killing process group ${child.pid}`);
      killProcessGroupWithForceResolve();
    }, 30_000);

    // ── 手動 timeout：殺整個進程群組（含子進程）──
    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      clearInterval(progressTimer);
      slog('CLAUDE', `Timeout (${TIMEOUT_MS / 1000}s) — killing process group ${child.pid}`);
      killProcessGroupWithForceResolve();
    }, TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => {
      lastStdoutDataTs = Date.now();
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
                const toolName = block.name ?? 'unknown';
                const toolInput = (block.input ?? {}) as Record<string, unknown>;
                writeAuditLog(toolName, toolInput);
                // 即時更新 task — 讓 /status 顯示正在做什麼
                if (loopTask) {
                  const summary = toolInput.command ?? toolInput.file_path ?? toolInput.pattern ?? toolInput.url ?? '';
                  loopTask.toolCalls = toolCallCount;
                  loopTask.lastTool = `${toolName}: ${String(summary).slice(0, 80)}`;
                }
              } else if (block.type === 'text' && block.text) {
                // 即時更新最新思考文字
                if (loopTask) {
                  loopTask.lastText = block.text.slice(0, 200);
                }
                // 累積所有 text blocks — 中間 turns 的 tags（如 <kuro:chat>）不能遺失
                allTextBlocks.push(block.text);
                if (!resultText) resultText = block.text;
                // Partial output callback (for cycle checkpoint)
                if (opts?.onPartialOutput) {
                  opts.onPartialOutput(resultText);
                }
                // Streaming chat detection — fire callback for complete <kuro:chat> tags as they arrive
                if (opts?.onStreamChat) {
                  const accumulated = allTextBlocks.join('\n');
                  for (const m of accumulated.matchAll(/<kuro:chat(?:\s+reply="true")?>([\s\S]*?)<\/kuro:chat>/g)) {
                    const chatText = m[1].trim();
                    if (chatText && !streamedChatTexts.has(chatText)) {
                      streamedChatTexts.add(chatText);
                      const isReply = m[0].startsWith('<kuro:chat reply="true">');
                      opts.onStreamChat(chatText, isReply);
                    }
                  }
                }
              }
            }
          } else if (event.type === 'result') {
            resultText = event.result ?? resultText;
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
      const duration = Date.now() - startTs;

      // Clear PID tracking
      if (source === 'loop') {
        loopChildPid = null;
      } else if (source === 'foreground') {
        foregroundChildPid = null;
      }

      // 處理 buffer 中剩餘的不完整行
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer.trim());
          if (event.type === 'result') resultText = event.result ?? resultText;
        } catch { /* ignore */ }
      }

      if (toolCallCount > 0) {
        slog('AUDIT', `Claude CLI used ${toolCallCount} tool(s) this call`);
      }

      // Exit 143 結構化 logging（SIGTERM — context 過大或系統終止）
      if (code === 143) {
        slog('EXIT143', `prompt=${fullPrompt.length} chars, elapsed=${(duration / 1000).toFixed(1)}s, tools=${toolCallCount}`);
      }

      // Log unexpected signals for diagnostics
      if (signal && !timedOut) {
        slog('CLAUDE', `Process terminated by signal ${signal} (not our timeout), elapsed=${(duration / 1000).toFixed(1)}s`);
      }

      if (code !== 0 && !resultText) {
        reject(Object.assign(new Error(`Claude CLI exited with code ${code}`), { stderr, stdout: resultText, status: code, killed: timedOut, signal, duration, timeoutMs: TIMEOUT_MS }));
      } else {
        // 檢查中間 text blocks 是否有 tags 被 result 事件覆蓋而遺失
        // result 事件只包含最後一個 assistant turn 的 text，中間 turns 的 tags 會被丟棄
        const TAG_RE = /\[(CHAT|ASK|REMEMBER|SHOW|SUMMARY|TASK|ARCHIVE|IMPULSE|THREAD)\b/;
        if (allTextBlocks.length > 1) {
          const intermediateWithTags = allTextBlocks.slice(0, -1).filter(b => TAG_RE.test(b));
          if (intermediateWithTags.length > 0) {
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
      if (source === 'loop') {
        loopChildPid = null;
      } else if (source === 'foreground') {
        foregroundChildPid = null;
      }
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
              if (loopTask) {
                loopTask.lastText = item.text.slice(0, 200);
              }
            } else if (item.type === 'tool_call') {
              toolCallCount++;
              const toolName = item.tool ?? 'unknown';
              const toolInput = (item.input ?? item.args ?? {}) as Record<string, unknown>;
              writeAuditLog(toolName, toolInput);
              if (loopTask) {
                const summary = toolInput.command ?? toolInput.file_path ?? toolInput.pattern ?? '';
                loopTask.toolCalls = toolCallCount;
                loopTask.lastTool = `${toolName}: ${String(summary).slice(0, 80)}`;
              }
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
// oMLX / Qwen Provider (config-driven, tool use + streaming + thinking)
//
// Config files: llm/qwen/{profile}.json
// Profile selection: opts.model matches profile name → load that config
//                    otherwise → llm/qwen/default.json
// Env overrides: OMLX_URL, OMLX_KEY, OMLX_MODEL take precedence over JSON
// =============================================================================

let qwenAbortController: AbortController | null = null;
const MAX_TOOL_ROUNDS = 10;

// --- Profile types & loader ---

interface QwenProfile {
  model?: string;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  presence_penalty?: number;
  repetition_penalty?: number;
  enable_thinking?: boolean;
  tools_enabled?: boolean;
  timeout_ms?: number;
}

// Qwen3 official recommended defaults (non-thinking mode)
// repetition_penalty: 0 = not sent (thinking mode should omit it)
const QWEN_PROFILE_DEFAULTS: Required<QwenProfile> = {
  model: 'Qwen3.5-9B-MLX-4bit',
  max_tokens: 8192,
  temperature: 0.7,
  top_p: 0.8,
  top_k: 20,
  presence_penalty: 1.5,
  repetition_penalty: 0,
  enable_thinking: false,
  tools_enabled: true,
  timeout_ms: 600_000,
};

const profileCache = new Map<string, { profile: QwenProfile; loadedAt: number }>();
const PROFILE_CACHE_TTL = 30_000; // 30s hot reload

function loadQwenProfile(name: string): Required<QwenProfile> {
  const now = Date.now();
  const cached = profileCache.get(name);
  if (cached && now - cached.loadedAt < PROFILE_CACHE_TTL) {
    return { ...QWEN_PROFILE_DEFAULTS, ...cached.profile };
  }

  const profilePath = path.join(process.cwd(), 'llm', 'qwen', `${name}.json`);
  let profile: QwenProfile = {};
  try {
    profile = JSON.parse(readFileSyncFs(profilePath, 'utf-8')) as QwenProfile;
    profileCache.set(name, { profile, loadedAt: now });
  } catch {
    // File not found or parse error — use defaults
  }

  return { ...QWEN_PROFILE_DEFAULTS, ...profile };
}

/** Resolve which profile to use: opts.model as profile name, or 'default' */
function resolveQwenProfile(opts?: ExecOptions): { profile: Required<QwenProfile>; profileName: string } {
  const candidate = opts?.model;
  if (candidate) {
    // Check if it's a profile name (file exists)
    const profilePath = path.join(process.cwd(), 'llm', 'qwen', `${candidate}.json`);
    try {
      readFileSyncFs(profilePath);
      return { profile: loadQwenProfile(candidate), profileName: candidate };
    } catch {
      // Not a profile name — treat as model override on default profile
      const p = loadQwenProfile('default');
      p.model = candidate;
      return { profile: p, profileName: 'default' };
    }
  }
  return { profile: loadQwenProfile('default'), profileName: 'default' };
}

// --- Tool types & definitions ---

interface QwenMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: QwenToolCall[];
  tool_call_id?: string;
}

interface QwenToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

const QWEN_TOOLS = [
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

async function executeQwenToolCall(call: QwenToolCall): Promise<string> {
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
      case 'run_command':
        return execSyncChild(args.command, { timeout: 10_000, encoding: 'utf-8' }).slice(0, 8000);
      default:
        return `Unknown tool: ${call.function.name}`;
    }
  } catch (e) {
    return `Error: ${(e as Error).message}`;
  }
}

// --- Streaming round ---

interface QwenRoundResult {
  content: string;
  toolCalls: QwenToolCall[];
}

async function streamQwenRound(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  signal: AbortSignal,
  opts?: ExecOptions,
): Promise<QwenRoundResult> {
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...body, stream: true, stream_options: { include_usage: true } }),
    signal,
  });
  if (!res.ok) {
    throw Object.assign(new Error(`oMLX error: ${res.status} ${res.statusText}`), { status: res.status });
  }

  let content = '';
  const toolCallsMap = new Map<number, QwenToolCall>();
  let lastCbLen = 0;
  let chatSearchPos = 0;

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
          if (opts?.onStreamChat && content.length > chatSearchPos) {
            const tail = content.slice(chatSearchPos);
            const m = tail.match(/<kuro:chat(\s+reply="true")?>([\s\S]*?)<\/kuro:chat>/);
            if (m) {
              opts.onStreamChat(m[2].trim(), !!m[1]);
              chatSearchPos += m.index! + m[0].length;
            }
          }
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

  if (opts?.onPartialOutput && content.length > lastCbLen) opts.onPartialOutput(content);
  return { content, toolCalls: Array.from(toolCallsMap.values()).filter(tc => tc.function.name) };
}

// --- Non-streaming round ---

async function fetchQwenRound(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<QwenRoundResult> {
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...body, stream: false }),
    signal,
  });
  if (!res.ok) {
    throw Object.assign(new Error(`oMLX error: ${res.status} ${res.statusText}`), { status: res.status });
  }
  const data = await res.json() as {
    choices: Array<{ message: { content: string | null; tool_calls?: QwenToolCall[] } }>;
  };
  const msg = data.choices[0]?.message;
  return { content: msg?.content ?? '', toolCalls: msg?.tool_calls ?? [] };
}

// --- Main entry ---

/**
 * oMLX HTTP call — config-driven from llm/qwen/{profile}.json
 *
 * Features:
 * - Profile selection: opts.model='thinking' → loads llm/qwen/thinking.json
 * - Tool use: search_memory, read_file, run_command (multi-round, max 10)
 * - Streaming: auto-enabled when onPartialOutput/onStreamChat callbacks present
 * - Thinking mode: per-profile enable_thinking flag
 * - Env overrides: OMLX_URL, OMLX_KEY, OMLX_MODEL override profile values
 *
 * <kuro:*> tags still work (parsed by dispatcher after final response).
 */
async function execQwen(fullPrompt: string, opts?: ExecOptions): Promise<string> {
  const source = opts?.source ?? 'loop';
  const { profile, profileName } = resolveQwenProfile(opts);

  // Env overrides take precedence
  const omlxUrl = process.env.OMLX_URL ?? 'http://localhost:8000';
  const omlxKey = process.env.OMLX_KEY ?? 'omlx-local';
  const model = process.env.OMLX_MODEL ?? profile.model;

  const controller = new AbortController();
  qwenAbortController = controller;
  const timer = setTimeout(() => controller.abort(), profile.timeout_ms);

  if (source === 'loop') loopChildPid = null;
  else if (source === 'foreground') foregroundChildPid = null;

  const url = `${omlxUrl}/v1/chat/completions`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${omlxKey}`,
  };
  const messages: QwenMessage[] = [{ role: 'user', content: fullPrompt }];
  const useStreaming = !!(opts?.onPartialOutput || opts?.onStreamChat);

  slog('QWEN', `profile=${profileName} model=${model} thinking=${profile.enable_thinking} tools=${profile.tools_enabled}`);

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
        chat_template_kwargs: { enable_thinking: profile.enable_thinking },
        ...(profile.tools_enabled ? { tools: QWEN_TOOLS } : {}),
      };

      const result = (useStreaming && round === 0)
        ? await streamQwenRound(url, headers, body, controller.signal, opts)
        : await fetchQwenRound(url, headers, body, controller.signal);

      if (!result.toolCalls.length) return result.content;

      slog('QWEN', `tool round ${round + 1}: ${result.toolCalls.map(c => c.function.name).join(', ')}`);
      messages.push({ role: 'assistant', content: result.content || null, tool_calls: result.toolCalls });

      for (const call of result.toolCalls) {
        const toolResult = await executeQwenToolCall(call);
        messages.push({ role: 'tool', content: toolResult, tool_call_id: call.id });
      }
    }

    return messages.filter(m => m.role === 'assistant').pop()?.content ?? '';
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      throw Object.assign(new Error('oMLX 超時'), { killed: true, timeoutMs: profile.timeout_ms });
    }
    throw e;
  } finally {
    clearTimeout(timer);
    qwenAbortController = null;
  }
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
    rebuildContext?: (mode: 'focused' | 'minimal') => Promise<string>;
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
  },
): Promise<{ response: string; systemPrompt: string; fullPrompt: string; duration: number; preempted?: boolean }> {
  const source = options?.source ?? 'loop';
  const systemPrompt = getSystemPrompt(prompt, options?.cycleMode);
  let currentContext = context;
  let fullPrompt = `${systemPrompt}\n\n${currentContext}\n\n---\n\nUser: ${prompt}`;

  // Pre-check: if prompt is too large, proactively reduce context before first attempt
  const PROMPT_HARD_CAP = 80_000;
  if (fullPrompt.length > PROMPT_HARD_CAP && options?.rebuildContext) {
    slog('AGENT', `Prompt too large (${fullPrompt.length} chars), pre-reducing context`);
    try {
      currentContext = await options.rebuildContext('focused');
      fullPrompt = `${systemPrompt}\n\n${currentContext}\n\n---\n\nUser: ${prompt}`;
      if (fullPrompt.length > PROMPT_HARD_CAP) {
        currentContext = await options.rebuildContext('minimal');
        fullPrompt = `${systemPrompt}\n\n${currentContext}\n\n---\n\nUser: ${prompt}`;
      }
      slog('AGENT', `Context pre-reduced to ${fullPrompt.length} chars`);
    } catch { /* proceed with original */ }
  }

  // Busy helpers — each lane tracks its own busy/task state independently
  // 'ask' source runs in parallel — no busy guard, no state tracking
  const isLoopSource = source === 'loop';
  const isFgSource = source === 'foreground';
  const isBusy = () => {
    if (isLoopSource) return loopBusy;
    if (isFgSource) return foregroundBusy;
    return false; // 'ask' has no busy guard
  };
  const setBusy = (v: boolean) => {
    if (isLoopSource) loopBusy = v;
    if (isFgSource) foregroundBusy = v;
  };
  const setTask = (v: TaskInfo | null) => {
    if (isLoopSource) loopTask = v;
    if (isFgSource) foregroundTask = v;
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

  const primary = getProvider();
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
    setBusy(true);
    setTask({ prompt: prompt.slice(0, 200), startedAt: Date.now(), toolCalls: 0, lastTool: null, lastText: null });

    try {
      const result = await execProvider(primary, fullPrompt, {
        source,
        onPartialOutput: options?.onPartialOutput,
        model: options?.model,
        onStreamChat: options?.onStreamChat,
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

      // Preemption detection: don't retry if preempted
      if (source === 'loop' && loopGeneration !== genAtStart) {
        const stdout = (error as { stdout?: string })?.stdout?.trim() ?? '';
        return { response: stdout, systemPrompt, fullPrompt, duration, preempted: true };
      }

      const stderr = (error as { stderr?: string })?.stderr?.trim() ?? '';
      const exitCode = (error as { status?: number })?.status;
      const classified = classifyError(error);

      // Log error
      const logger = getLogger();
      logger.logError(
        new Error(`${primary} CLI ${classified.type} (exit ${exitCode}, ${duration}ms, attempt ${attempt + 1}/${maxRetries + 1}, prompt ${fullPrompt.length} chars, ${source} lane): ${stderr.slice(0, 500) || classified.message}`),
        'callClaude'
      );

      lastErrorMessage = classified.message;

      // 如果可重試且還有機會，等待後重試
      if (classified.retryable && attempt < maxRetries) {
        const delay = 30_000 * Math.pow(2, attempt); // 30s, 60s

        // TIMEOUT 時嘗試縮減 context（最有效的重試策略）
        if (classified.type === 'TIMEOUT' && options?.rebuildContext) {
          let retryMode: 'focused' | 'minimal' = attempt === 0 ? 'focused' : 'minimal';
          try {
            const prevLen = currentContext.length;
            currentContext = await options.rebuildContext(retryMode);
            // Hard cap: if focused mode didn't actually reduce size, escalate to minimal
            if (retryMode === 'focused' && currentContext.length >= prevLen * 0.8) {
              slog('RETRY', `focused mode ineffective (${prevLen} → ${currentContext.length}), escalating to minimal`);
              retryMode = 'minimal';
              currentContext = await options.rebuildContext(retryMode);
            }
            fullPrompt = `${systemPrompt}\n\n${currentContext}\n\n---\n\nUser: ${prompt}`;
            slog('RETRY', `TIMEOUT on attempt ${attempt + 1}, context reduced ${prevLen} → ${currentContext.length} chars (${retryMode} mode), retrying in ${delay / 1000}s`);
          } catch {
            slog('RETRY', `${classified.type} on attempt ${attempt + 1}, context rebuild failed, retrying with same context in ${delay / 1000}s`);
          }
        } else {
          slog('RETRY', `${classified.type} on attempt ${attempt + 1}, retrying in ${delay / 1000}s`);
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
        setTask({ prompt: prompt.slice(0, 200), startedAt: Date.now(), toolCalls: 0, lastTool: null, lastText: null });
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

      return { response: classified.message, systemPrompt, fullPrompt, duration };
    } finally {
      setBusy(false);
      setTask(null);
    }
  }

  // 理論上不會到這裡，但 TypeScript 需要
  return { response: lastErrorMessage, systemPrompt, fullPrompt, duration: Date.now() - startTime };
}

