/**
 * LLM Execution Layer (OODA-Only)
 *
 * Single loop lane: callClaude() → execProvider() → response
 */

import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { getMemory } from './memory.js';
import { getCurrentInstanceId, getInstanceDir } from './instance.js';
import { getLogger } from './logging.js';
import { slog, diagLog } from './utils.js';
import { getSystemPrompt } from './dispatcher.js';
import { eventBus } from './event-bus.js';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

// =============================================================================
// LLM Provider Abstraction
// =============================================================================

export type Provider = 'claude' | 'codex';

export function getProvider(): Provider {
  const p = process.env.AGENT_PROVIDER?.toLowerCase();
  if (p === 'codex') return 'codex';
  return 'claude';
}

export function getFallback(): Provider | null {
  const f = process.env.AGENT_FALLBACK?.toLowerCase();
  if (f === 'codex' || f === 'claude') return f as Provider;
  return null;
}

interface ExecOptions {
  source?: CallSource;
  onPartialOutput?: (text: string) => void;
}

async function execProvider(provider: Provider, fullPrompt: string, opts?: ExecOptions): Promise<string> {
  return provider === 'codex' ? execCodex(fullPrompt, opts) : execClaude(fullPrompt, opts);
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
  const combined = `${msg}\n${stderr}`.toLowerCase();

  if (combined.includes('enoent') || combined.includes('not found')) {
    return { type: 'NOT_FOUND', retryable: false, message: '無法找到 claude CLI。請確認已安裝 Claude Code 並且 claude 指令在 PATH 中。' };
  }
  // Exit 143 = SIGTERM (128+15) — context 過大或系統資源不足
  if (exitCode === 143) {
    return { type: 'TIMEOUT', retryable: true, message: 'Claude CLI 被 SIGTERM 終止（exit 143）。可能是 context 過大或系統資源不足。' };
  }
  if (killed || combined.includes('timeout') || combined.includes('timed out')) {
    return { type: 'TIMEOUT', retryable: true, message: '處理超時（超過 8 分鐘）。Claude CLI 回應太慢或暫時不可用，請稍後再試。' };
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

export type CallSource = 'loop';

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
// Loop Lane Busy Lock (OODA-Only)
// =============================================================================

let loopBusy = false;
let loopTask: TaskInfo | null = null;
let loopChildPid: number | null = null;
let loopGeneration = 0; // Bumped on preemption — callClaude detects mismatch

/** 查詢 Claude CLI 是否正在執行 */
export function isClaudeBusy(): boolean {
  return loopBusy;
}

/** 查詢 loop lane 是否忙碌 */
export function isLoopBusy(): boolean {
  return loopBusy;
}

/** 查詢目前正在處理的任務 */
export function getCurrentTask(): { prompt: string; startedAt: string; elapsed: number; toolCalls: number; lastTool: string | null; lastText: string | null } | null {
  return formatTask(loopTask);
}

/** 查詢 loop lane 狀態 */
export function getLaneStatus(): {
  loop: { busy: boolean; task: ReturnType<typeof formatTask> };
} {
  return {
    loop: { busy: loopBusy, task: formatTask(loopTask) },
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
  // 可透過 CLAUDE_MODEL env 覆蓋
  const args = ['-p', '--dangerously-skip-permissions', '--output-format', 'stream-json', '--verbose'];
  if (process.env.CLAUDE_MODEL) {
    args.push('--model', process.env.CLAUDE_MODEL);
  }

  return new Promise<string>((resolve, reject) => {
    let settled = false;

    const child = spawn(
      'claude',
      args,
      {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true, // 建立新進程群組，方便整體 kill
      },
    );

    // Track PID for loop lane (preemption support)
    if (source === 'loop') {
      loopChildPid = child.pid ?? null;
    }

    let resultText = '';
    let buffer = '';
    let stderr = '';
    let toolCallCount = 0;

    // ── 手動 timeout：殺整個進程群組（含子進程）──
    const timer = setTimeout(() => {
      if (settled) return;
      slog('CLAUDE', `Timeout (${TIMEOUT_MS / 1000}s) — killing process group ${child.pid}`);
      try {
        process.kill(-child.pid!, 'SIGTERM');
      } catch { /* already dead */ }
      // 5 秒後強制殺（SIGKILL 不可被攔截）
      setTimeout(() => {
        try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* already dead */ }
      }, 5000);
    }, TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => {
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
                // 累積文字（備用，result 事件優先）
                if (!resultText) resultText = block.text;
                // Partial output callback (for cycle checkpoint)
                if (opts?.onPartialOutput) {
                  opts.onPartialOutput(resultText);
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

    child.on('close', (code) => {
      settled = true;
      clearTimeout(timer);

      // Clear PID tracking
      if (source === 'loop') {
        loopChildPid = null;
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
        const elapsed = ((Date.now() - startTs) / 1000).toFixed(1);
        slog('EXIT143', `prompt=${fullPrompt.length} chars, elapsed=${elapsed}s, tools=${toolCallCount}`);
      }

      if (code !== 0 && !resultText) {
        reject(Object.assign(new Error(`Claude CLI exited with code ${code}`), { stderr, stdout: resultText, status: code }));
      } else {
        resolve(resultText);
      }
    });

    child.on('error', (err) => {
      settled = true;
      clearTimeout(timer);
      if (source === 'loop') {
        loopChildPid = null;
      }
      reject(Object.assign(err, { stderr, stdout: resultText }));
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

    // ── 手動 timeout：殺整個進程群組（含子進程）──
    const timer = setTimeout(() => {
      if (settled) return;
      slog('CODEX', `Timeout (${TIMEOUT_MS / 1000}s) — killing process group ${child.pid}`);
      try {
        process.kill(-child.pid!, 'SIGTERM');
      } catch { /* already dead */ }
      setTimeout(() => {
        try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* already dead */ }
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

    child.on('close', (code) => {
      settled = true;
      clearTimeout(timer);

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
        reject(Object.assign(new Error(`Codex CLI exited with code ${code}`), { stderr, stdout: resultText, status: code }));
      } else {
        resolve(resultText);
      }
    });

    child.on('error', (err) => {
      settled = true;
      clearTimeout(timer);
      reject(Object.assign(err, { stderr, stdout: resultText }));
    });

    child.stdin.write(fullPrompt);
    child.stdin.end();
  });
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
  },
): Promise<{ response: string; systemPrompt: string; fullPrompt: string; duration: number; preempted?: boolean }> {
  const source = options?.source ?? 'loop';
  const systemPrompt = getSystemPrompt(prompt);
  let currentContext = context;
  let fullPrompt = `${systemPrompt}\n\n${currentContext}\n\n---\n\nUser: ${prompt}`;

  // Busy helpers (OODA-Only: single loop lane)
  const isBusy = () => loopBusy;
  const setBusy = (v: boolean) => { loopBusy = v; };
  const setTask = (v: TaskInfo | null) => { loopTask = v; };

  // Busy guard — 防止同一 lane 並發呼叫
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
          const retryMode = attempt === 0 ? 'focused' : 'minimal';
          try {
            const prevLen = currentContext.length;
            currentContext = await options.rebuildContext(retryMode);
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

