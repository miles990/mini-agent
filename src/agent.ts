/**
 * Core Agent Loop
 *
 * receive → context → llm → execute → respond
 */

import { execFile } from 'node:child_process';
import path from 'node:path';
import { getMemory, getSkillsPrompt } from './memory.js';
import { loadInstanceConfig, getCurrentInstanceId } from './instance.js';
import { getLogger } from './logging.js';
import { slog, diagLog } from './utils.js';
import { notifyTelegram } from './telegram.js';
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

/** 查詢 Claude CLI 是否正在執行 */
export function isClaudeBusy(): boolean {
  return claudeBusy;
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

/** 處理 queue 中的下一則訊息 */
function drainQueue(): void {
  if (messageQueue.length === 0 || claudeBusy) return;
  const next = messageQueue.shift()!;
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
 * 單次 Claude CLI 呼叫（內部用）
 */
async function execClaude(fullPrompt: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = execFile(
      'claude',
      ['-p', '--dangerously-skip-permissions'],
      {
        encoding: 'utf-8',
        timeout: 480000, // 8 minutes
        maxBuffer: 10 * 1024 * 1024, // 10MB
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, { stderr, stdout }));
        } else {
          resolve(stdout);
        }
      },
    );
    child.stdin?.write(fullPrompt);
    child.stdin?.end();
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
    return {
      content: `訊息已排隊（第 ${position}/${MAX_QUEUE_SIZE} 位），會在目前的任務完成後處理。`,
      queued: true,
      position,
    };
  }

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
