/**
 * Core Agent Loop
 *
 * receive → context → llm → execute → respond
 */

import { execFile, spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { getMemory, getSkillsPrompt } from './memory.js';
import { loadInstanceConfig, getCurrentInstanceId, getInstanceDir } from './instance.js';
import { getLogger } from './logging.js';
import { slog, diagLog } from './utils.js';
import { notifyTelegram, getTelegramPoller } from './telegram.js';
import type { AgentResponse } from './types.js';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * 取得系統提示詞
 */
function getSystemPrompt(): string {
  const instanceId = getCurrentInstanceId();
  const config = loadInstanceConfig(instanceId);

  // 如果實例有自訂的 persona，使用它
  if (config?.persona?.systemPrompt) {
    return config.persona.systemPrompt;
  }

  // 預設系統提示詞
  const personaDescription = config?.persona?.description
    ? `You are ${config.persona.description}.\n\n`
    : '';

  return `${personaDescription}You are a personal AI assistant with memory and task capabilities.

## Core Behavior: Smart Guidance

你的核心行為原則是「智能引導」。在所有互動中自動遵守：

1. **偵測狀態再回答**：回答前先檢查相關感知資料（<chrome>、<system>、<docker>、<network> 等），根據實際狀態給出對應建議
2. **具體可執行**：建議必須是用戶可以直接複製貼上執行的指令，不要只說「請啟用 X」
3. **解決方案優先**：遇到限制時，重點放在「怎麼解決」而非「為什麼不行」
4. **永不放棄**：不要只說「無法做到」，一定要提供替代方案或下一步行動
5. **分支引導**：根據當前狀態提供不同的路徑（例如：「如果 X 正在運行→做 A；如果沒有→做 B」）

## Instructions

- When the user asks you to remember something, wrap it in [REMEMBER]...[/REMEMBER] tags
  Example: [REMEMBER]User prefers TypeScript[/REMEMBER]

- When the user asks you to do something periodically/scheduled, wrap it in [TASK]...[/TASK] tags
  Format: [TASK schedule="cron or description"]task content[/TASK]
  Example: [TASK schedule="every 5 minutes"]Write a haiku to output.md with timestamp[/TASK]
  Example: [TASK schedule="daily at 9am"]Send daily summary[/TASK]

- When you open a webpage, display results, or create something the user should see, wrap it in [SHOW]...[/SHOW] tags
  This sends a Telegram notification so the user doesn't miss it.
  Format: [SHOW url="URL"]description[/SHOW]
  Example: [SHOW url="http://localhost:3000"]Portfolio 網站已啟動，打開看看[/SHOW]
  Example: [SHOW url="https://news.ycombinator.com/item?id=123"]這篇文章很有趣[/SHOW]

- Keep responses concise and helpful
- You have access to memory context and environment perception data below
${getSkillsPrompt()}`;
}

/**
 * 錯誤分類結果
 */
interface ClaudeErrorClassification {
  type: 'TIMEOUT' | 'RATE_LIMIT' | 'NOT_FOUND' | 'PERMISSION' | 'MAX_BUFFER' | 'UNKNOWN';
  message: string;
  retryable: boolean;
}

/**
 * Classify Claude CLI error into structured result
 */
function classifyClaudeError(error: unknown): ClaudeErrorClassification {
  const msg = error instanceof Error ? error.message : String(error);
  const stderr = (error as { stderr?: string })?.stderr ?? '';
  const killed = (error as { killed?: boolean })?.killed;
  const combined = `${msg}\n${stderr}`.toLowerCase();

  if (combined.includes('enoent') || combined.includes('not found')) {
    return { type: 'NOT_FOUND', retryable: false, message: '無法找到 claude CLI。請確認已安裝 Claude Code 並且 claude 指令在 PATH 中。' };
  }
  if (killed || combined.includes('timeout') || combined.includes('timed out')) {
    return { type: 'TIMEOUT', retryable: true, message: '處理超時（超過 8 分鐘）。Claude CLI 回應太慢或暫時不可用，請稍後再試。' };
  }
  if (combined.includes('maxbuffer')) {
    return { type: 'MAX_BUFFER', retryable: false, message: '回應內容過大，超過緩衝區限制。請嘗試要求更簡潔的回覆。' };
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

/**
 * Busy flag — 防止並發 Claude CLI 呼叫（記憶體和 CPU 保護）
 */
let claudeBusy = false;
let currentTask: { prompt: string; startedAt: number } | null = null;

/** 查詢 Claude CLI 是否正在執行 */
export function isClaudeBusy(): boolean {
  return claudeBusy;
}

/** 查詢目前正在處理的任務 */
export function getCurrentTask(): { prompt: string; startedAt: string; elapsed: number } | null {
  if (!currentTask) return null;
  return {
    prompt: currentTask.prompt,
    startedAt: new Date(currentTask.startedAt).toISOString(),
    elapsed: Math.floor((Date.now() - currentTask.startedAt) / 1000),
  };
}

// =============================================================================
// Message Queue — claudeBusy 時排隊，完成後自動 drain
// =============================================================================

interface QueueItem {
  message: string;
  onComplete?: (result: AgentResponse) => void;
  queuedAt: number;
}

const messageQueue: QueueItem[] = [];
const MAX_QUEUE_SIZE = 5;

/** 查詢 queue 狀態 */
export function getQueueStatus(): { size: number; max: number } {
  return { size: messageQueue.length, max: MAX_QUEUE_SIZE };
}

/** 查詢是否有待處理的排隊訊息 */
export function hasQueuedMessages(): boolean {
  return messageQueue.length > 0;
}

// ── Queue Persistence ──────────────────────────────────────────────────────

interface PersistedQueueEntry {
  message: string;
  queuedAt: number;
  source: 'telegram' | 'api';
}

function getQueueFilePath(): string | null {
  try {
    const instanceId = getCurrentInstanceId();
    if (!instanceId) return null;
    return path.join(getInstanceDir(instanceId), 'pending-queue.jsonl');
  } catch { return null; }
}

/** 追蹤目前正在處理的訊息（用於持久化） */
let inFlightMessage: PersistedQueueEntry | null = null;

function saveQueueToDisk(): void {
  const filePath = getQueueFilePath();
  if (!filePath) return;
  try {
    const entries: PersistedQueueEntry[] = [];
    // 正在處理中的訊息放最前面（重啟後優先恢復）
    if (inFlightMessage) entries.push(inFlightMessage);
    // 接著是排隊中的訊息
    for (const item of messageQueue) {
      entries.push({
        message: item.message,
        queuedAt: item.queuedAt,
        source: (item.onComplete ? 'telegram' : 'api') as 'telegram' | 'api',
      });
    }
    if (entries.length === 0) {
      if (existsSync(filePath)) unlinkSync(filePath);
      return;
    }
    writeFileSync(filePath, entries.map(e => JSON.stringify(e)).join('\n') + '\n', 'utf-8');
  } catch { /* non-critical */ }
}

/** 啟動時恢復持久化的 queue（在 Telegram poller 初始化後呼叫） */
export function restoreQueue(): void {
  const filePath = getQueueFilePath();
  if (!filePath || !existsSync(filePath)) return;
  try {
    const content = readFileSync(filePath, 'utf-8').trim();
    if (!content) return;
    const lines = content.split('\n').filter(l => l.trim());
    const entries = lines.map(l => JSON.parse(l) as PersistedQueueEntry);
    for (const entry of entries) {
      const onComplete = entry.source === 'telegram'
        ? async (result: AgentResponse) => {
            const poller = getTelegramPoller();
            if (!poller || !result.content) return;
            const sendResult = await poller.sendMessage(result.content);
            if (sendResult.ok) {
              slog('QUEUE', `→ [restored] ${result.content.slice(0, 100)}`);
            }
          }
        : undefined;
      messageQueue.push({ message: entry.message, onComplete, queuedAt: entry.queuedAt });
    }
    slog('QUEUE', `Restored ${entries.length} queued message(s) from disk`);
    unlinkSync(filePath);
    if (!claudeBusy && messageQueue.length > 0) {
      drainQueue();
    }
  } catch (err) {
    slog('QUEUE', `Failed to restore queue: ${err instanceof Error ? err.message : err}`);
  }
}

// ── Queue Drain ────────────────────────────────────────────────────────────

/** 處理 queue 中的下一則訊息 */
function drainQueue(): void {
  if (messageQueue.length === 0 || claudeBusy) return;
  const next = messageQueue.shift()!;
  saveQueueToDisk(); // 從 queue 移除後同步寫入磁碟
  slog('QUEUE', `Processing queued message (waited ${((Date.now() - next.queuedAt) / 1000).toFixed(0)}s, ${messageQueue.length} remaining)`);
  // 用 setImmediate 避免 stack overflow
  setImmediate(() => {
    processMessage(next.message).then(result => {
      if (next.onComplete) next.onComplete(result);
    }).catch(() => {
      if (next.onComplete) next.onComplete({ content: '處理排隊訊息時發生錯誤。' });
    });
  });
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
async function execClaude(fullPrompt: string): Promise<string> {
  const TIMEOUT_MS = 480_000; // 8 minutes

  return new Promise<string>((resolve, reject) => {
    let settled = false;

    const child = spawn(
      'claude',
      ['-p', '--dangerously-skip-permissions', '--output-format', 'stream-json', '--verbose'],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true, // 建立新進程群組，方便整體 kill
      },
    );

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
                writeAuditLog(block.name ?? 'unknown', (block.input ?? {}) as Record<string, unknown>);
              } else if (block.type === 'text' && block.text) {
                // 累積文字（備用，result 事件優先）
                if (!resultText) resultText = block.text;
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

      if (code !== 0 && !resultText) {
        reject(Object.assign(new Error(`Claude CLI exited with code ${code}`), { stderr, stdout: resultText, status: code }));
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
 * - Releases claudeBusy during retry wait (user requests take priority)
 */
export async function callClaude(
  prompt: string,
  context: string,
  maxRetries = 2,
): Promise<{ response: string; systemPrompt: string; fullPrompt: string; duration: number }> {
  const systemPrompt = getSystemPrompt();
  const fullPrompt = `${systemPrompt}\n\n${context}\n\n---\n\nUser: ${prompt}`;

  // Busy guard — 防止並發呼叫
  if (claudeBusy) {
    return {
      response: '我正在處理另一個請求，請稍後再試。',
      systemPrompt,
      fullPrompt,
      duration: 0,
    };
  }

  const startTime = Date.now();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // 每次嘗試前檢查 busy（重試等待期間可能被其他請求佔走）
    if (claudeBusy) {
      return {
        response: '重試期間收到新請求，已優先處理新請求。',
        systemPrompt,
        fullPrompt,
        duration: Date.now() - startTime,
      };
    }

    claudeBusy = true;
    currentTask = { prompt: prompt.slice(0, 200), startedAt: Date.now() };

    try {
      const result = await execClaude(fullPrompt);
      const duration = Date.now() - startTime;

      try {
        const logger = getLogger();
        const retryInfo = attempt > 0 ? ` (retry #${attempt})` : '';
        logger.logBehavior('agent', 'claude.call', `${prompt.slice(0, 100)} → ${(duration / 1000).toFixed(1)}s${retryInfo}`);
      } catch { /* logger not ready */ }

      return { response: result.trim(), systemPrompt, fullPrompt, duration };
    } catch (error) {
      const duration = Date.now() - startTime;
      const stderr = (error as { stderr?: string })?.stderr?.trim() ?? '';
      const exitCode = (error as { status?: number })?.status;
      const classified = classifyClaudeError(error);

      // Log error
      const logger = getLogger();
      logger.logError(
        new Error(`Claude CLI ${classified.type} (exit ${exitCode}, ${duration}ms, attempt ${attempt + 1}/${maxRetries + 1}, prompt ${fullPrompt.length} chars): ${stderr.slice(0, 500) || classified.message}`),
        'callClaude'
      );

      // 如果可重試且還有機會，等待後重試
      if (classified.retryable && attempt < maxRetries) {
        const delay = 30_000 * Math.pow(2, attempt); // 30s, 60s
        slog('RETRY', `${classified.type} on attempt ${attempt + 1}, retrying in ${delay / 1000}s`);
        // 釋放 busy — 等待期間允許新請求插入
        claudeBusy = false;
        currentTask = null;
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      // 最後一次嘗試也失敗了，或不可重試
      const stdout = (error as { stdout?: string })?.stdout?.trim();
      if (stdout && stdout.length > 20) {
        return { response: stdout, systemPrompt, fullPrompt, duration };
      }
      return { response: classified.message, systemPrompt, fullPrompt, duration };
    } finally {
      claudeBusy = false;
      currentTask = null;
    }
  }

  // 理論上不會到這裡，但 TypeScript 需要
  return { response: '重試次數已用盡。', systemPrompt, fullPrompt, duration: Date.now() - startTime };
}

/**
 * Process a user message
 * claudeBusy 時自動排隊，立即回傳 ack（非阻塞）
 * @param onQueueComplete — 排隊訊息處理完成後的回調（用於 Telegram 發送回覆）
 */
export async function processMessage(
  userMessage: string,
  onQueueComplete?: (result: AgentResponse) => void,
): Promise<AgentResponse> {
  // Queue 機制：busy 時排隊，立即回傳 ack
  if (claudeBusy) {
    if (messageQueue.length >= MAX_QUEUE_SIZE) {
      return {
        content: `目前排隊已滿（${MAX_QUEUE_SIZE}/${MAX_QUEUE_SIZE}），請稍後再試。`,
        queued: false,
      };
    }
    const position = messageQueue.length + 1;
    slog('QUEUE', `Message queued (position ${position}/${MAX_QUEUE_SIZE}): ${userMessage.slice(0, 80)}`);
    messageQueue.push({ message: userMessage, onComplete: onQueueComplete, queuedAt: Date.now() });
    saveQueueToDisk(); // 入列後同步寫入磁碟
    return {
      content: `訊息已排隊（第 ${position}/${MAX_QUEUE_SIZE} 位），會在目前的任務完成後處理。`,
      queued: true,
      position,
    };
  }

  // 持久化：標記為處理中（重啟後會恢復到 queue）
  inFlightMessage = {
    message: userMessage,
    queuedAt: Date.now(),
    source: onQueueComplete ? 'telegram' : 'api',
  };
  saveQueueToDisk();

  // 使用當前實例的記憶系統和日誌系統
  const memory = getMemory();
  const logger = getLogger();

  // 1. Build context from memory
  const context = await memory.buildContext();

  // 2. Call Claude (now returns friendly error as response instead of throwing)
  const claudeResult = await callClaude(userMessage, context);

  const { response, systemPrompt, fullPrompt, duration } = claudeResult;

  // 3. Log to conversation history (Hot + Warm)
  await memory.appendConversation('user', userMessage);
  await memory.appendConversation('assistant', response);

  // 4. Check if should remember something
  let shouldRemember: string | undefined;
  if (response.includes('[REMEMBER]')) {
    const match = response.match(/\[REMEMBER\](.*?)\[\/REMEMBER\]/s);
    if (match) {
      shouldRemember = match[1].trim();
      await memory.appendMemory(shouldRemember);
      logger.logBehavior('agent', 'memory.save', shouldRemember.slice(0, 200));
    }
  }

  // 5. Check if should add a task
  let taskAdded: string | undefined;
  if (response.includes('[TASK')) {
    const match = response.match(/\[TASK(?:\s+schedule="([^"]*)")?\](.*?)\[\/TASK\]/s);
    if (match) {
      const schedule = match[1];
      const taskContent = match[2].trim();
      await memory.addTask(taskContent, schedule);
      taskAdded = taskContent;
      logger.logBehavior('agent', 'task.create', taskContent.slice(0, 200));
    }
  }

  // 6. Check if should show something (webpage/result)
  if (response.includes('[SHOW')) {
    const showMatches = response.matchAll(/\[SHOW(?:\s+url="([^"]*)")?\](.*?)\[\/SHOW\]/gs);
    for (const m of showMatches) {
      const url = m[1] ?? '';
      const desc = m[2].trim();
      logger.logBehavior('agent', 'show.webpage', `${desc.slice(0, 100)}${url ? ` | ${url}` : ''}`);
    }
  }

  // 7. Check for [CHAT] tag — proactive message to user via Telegram
  if (response.includes('[CHAT]')) {
    const chatMatches = response.matchAll(/\[CHAT\](.*?)\[\/CHAT\]/gs);
    for (const m of chatMatches) {
      const chatText = m[1].trim();
      await notifyTelegram(`💬 Kuro 想跟你聊聊：\n\n${chatText}`);
      logger.logBehavior('agent', 'telegram.chat', chatText.slice(0, 200));
    }
  }

  // 8. Check for [SUMMARY] tag — collaboration summary notification
  if (response.includes('[SUMMARY]')) {
    const summaryMatches = response.matchAll(/\[SUMMARY\](.*?)\[\/SUMMARY\]/gs);
    for (const m of summaryMatches) {
      const summary = m[1].trim();
      await notifyTelegram(`🤝 ${summary}`);
      logger.logBehavior('agent', 'collab.summary', summary.slice(0, 200));
    }
  }

  // Clean response from all tags
  const cleanContent = response
    .replace(/\[REMEMBER\].*?\[\/REMEMBER\]/gs, '')
    .replace(/\[TASK[^\]]*\].*?\[\/TASK\]/gs, '')
    .replace(/\[SHOW[^\]]*\].*?\[\/SHOW\]/gs, '')
    .replace(/\[CHAT\].*?\[\/CHAT\]/gs, '')
    .replace(/\[SUMMARY\].*?\[\/SUMMARY\]/gs, '')
    .trim();

  // 6. Log Claude call
  logger.logClaudeCall(
    {
      userMessage,
      systemPrompt,
      context,
      fullPrompt,
    },
    {
      content: cleanContent,
      shouldRemember,
      taskAdded,
    },
    {
      duration,
      success: true,
    }
  );

  const result: AgentResponse = {
    content: cleanContent,
    shouldRemember,
    taskAdded,
  };

  // 處理完成：清除 in-flight 標記並持久化
  inFlightMessage = null;
  saveQueueToDisk();

  // 處理完成後 drain queue（觸發下一則排隊訊息）
  drainQueue();

  return result;
}

/**
 * Run heartbeat check
 */
export async function runHeartbeat(): Promise<string | null> {
  const memory = getMemory();
  const logger = getLogger();
  const context = await memory.buildContext();

  // Check if there are active tasks (look for unchecked checkboxes)
  if (!context.includes('- [ ]')) {
    logger.logCron('heartbeat', 'No active tasks', 'scheduled');
    return null; // No tasks to process
  }

  const prompt = `You are checking your HEARTBEAT tasks.
Review the active tasks and:
1. If any task can be completed now, do it and mark it done
2. If any task needs attention, take action
3. Report what you did (or "No action needed" if nothing to do)

Keep response brief.`;

  try {
    const { response, systemPrompt, fullPrompt, duration } = await callClaude(prompt, context);
    // 結構化記錄 Claude 呼叫
    logger.logClaudeCall(
      { userMessage: prompt, systemPrompt, context: `[${context.length} chars]`, fullPrompt },
      { content: response },
      { duration, success: true, mode: 'heartbeat' }
    );
    // Heartbeat 結果記錄為 assistant 對話
    await memory.appendConversation('assistant', `[Heartbeat] ${response}`);
    logger.logCron('heartbeat', response.slice(0, 200), 'scheduled', { duration, success: true });
    return response;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.logError(error instanceof Error ? error : new Error(errorMsg), 'runHeartbeat');
    logger.logCron('heartbeat', undefined, 'scheduled', { success: false, error: errorMsg });
    console.error('Heartbeat error:', error);
    return null;
  }
}
