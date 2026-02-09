/**
 * Core Agent Loop
 *
 * receive → context → llm → execute → respond
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getMemory, getSkillsPrompt } from './memory.js';
import { loadInstanceConfig, getCurrentInstanceId } from './instance.js';
import { getLogger } from './logging.js';
import { diagLog } from './utils.js';
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

- Keep responses concise and helpful
- You have access to memory context and environment perception data below
${getSkillsPrompt()}`;
}

/**
 * Classify Claude CLI error into user-friendly message
 */
function classifyClaudeError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  const stderr = (error as { stderr?: string })?.stderr ?? '';
  const combined = `${msg}\n${stderr}`.toLowerCase();

  if (combined.includes('enoent') || combined.includes('not found')) {
    return '無法找到 claude CLI。請確認已安裝 Claude Code 並且 claude 指令在 PATH 中。';
  }
  if (combined.includes('timeout') || combined.includes('timed out')) {
    return '處理超時（超過 2 分鐘）。這個請求可能太複雜，請嘗試簡化問題。';
  }
  if (combined.includes('maxbuffer')) {
    return '回應內容過大，超過緩衝區限制。請嘗試要求更簡潔的回覆。';
  }
  if (combined.includes('permission') || combined.includes('access denied')) {
    return '存取被拒絕。Claude CLI 可能沒有足夠的權限執行此操作。';
  }

  // Try to extract useful info from stderr
  if (stderr.trim()) {
    // Take last meaningful line from stderr
    const lines = stderr.trim().split('\n').filter((l: string) => l.trim());
    const lastLine = lines[lines.length - 1] || '';
    if (lastLine.length > 10 && lastLine.length < 300) {
      return `Claude CLI 執行失敗：${lastLine}`;
    }
  }

  return '處理訊息時發生錯誤。請稍後再試，或嘗試換個方式描述你的需求。';
}

/**
 * Call Claude Code via subprocess
 * Uses a temp file to pass the prompt (avoids shell escaping issues)
 * Captures stderr for better error diagnostics
 */
export async function callClaude(
  prompt: string,
  context: string
): Promise<{ response: string; systemPrompt: string; fullPrompt: string; duration: number }> {
  const systemPrompt = getSystemPrompt();
  const fullPrompt = `${systemPrompt}\n\n${context}\n\n---\n\nUser: ${prompt}`;

  // Write prompt to temp file
  const tmpFile = path.join(os.tmpdir(), `mini-agent-prompt-${Date.now()}.txt`);
  fs.writeFileSync(tmpFile, fullPrompt, 'utf-8');

  const startTime = Date.now();
  try {
    const result = execSync(`cat "${tmpFile}" | claude -p --dangerously-skip-permissions`, {
      encoding: 'utf-8',
      timeout: 180000, // 3 minutes (web operations may take longer)
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
    const duration = Date.now() - startTime;

    // 行為記錄：Claude 呼叫
    try {
      const logger = getLogger();
      logger.logBehavior('agent', 'claude.call', `${prompt.slice(0, 100)} → ${(duration / 1000).toFixed(1)}s`);
    } catch { /* logger not ready */ }

    return { response: result.trim(), systemPrompt, fullPrompt, duration };
  } catch (error) {
    const duration = Date.now() - startTime;
    const stderr = (error as { stderr?: string })?.stderr?.trim() ?? '';
    const exitCode = (error as { status?: number })?.status;
    const friendlyMessage = classifyClaudeError(error);

    // Log the actual error for debugging
    const logger = getLogger();
    logger.logError(
      new Error(`Claude CLI failed (exit ${exitCode}, ${duration}ms, prompt ${fullPrompt.length} chars): ${stderr.slice(0, 500) || friendlyMessage}`),
      'callClaude'
    );

    // Try to extract partial stdout (Claude may have produced some output before failing)
    const stdout = (error as { stdout?: string })?.stdout?.trim();
    if (stdout && stdout.length > 20) {
      // Claude produced partial output — use it
      return { response: stdout, systemPrompt, fullPrompt, duration };
    }

    // No usable output — return friendly error as the response
    return { response: friendlyMessage, systemPrompt, fullPrompt, duration };
  } finally {
    // Clean up temp file
    try {
      fs.unlinkSync(tmpFile);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Process a user message
 */
export async function processMessage(userMessage: string): Promise<AgentResponse> {
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
    }
  }

  // Clean response from all tags
  const cleanContent = response
    .replace(/\[REMEMBER\].*?\[\/REMEMBER\]/gs, '')
    .replace(/\[TASK[^\]]*\].*?\[\/TASK\]/gs, '')
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

  return {
    content: cleanContent,
    shouldRemember,
    taskAdded,
  };
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
