/**
 * Minimal Core Agent
 * Stripped-down version with core functionality only
 */

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { getMemory } from './memory.js';

// Get memory directory (simplified)
function getMemoryDir(): string {
  return join(process.cwd(), 'memory');
}

// =============================================================================
// Types
// =============================================================================

export interface AgentResponse {
  content: string;
  shouldRemember?: string;
  taskAdded?: string;
}

export interface ParsedTags {
  remember?: { content: string; topic?: string };
  task?: { content: string; schedule?: string };
  chats: string[];
  shows: Array<{ url: string; desc: string }>;
  cleanContent: string;
}

interface ClaudeErrorClassification {
  type: 'TIMEOUT' | 'RATE_LIMIT' | 'NOT_FOUND' | 'PERMISSION' | 'MAX_BUFFER' | 'UNKNOWN';
  message: string;
}

// =============================================================================
// State
// =============================================================================

let claudeBusy = false;

export function isClaudeBusy(): boolean {
  return claudeBusy;
}

// Stub exports for compatibility with other modules
export function getCurrentTask(): null {
  return null;
}

export function getQueueStatus(): { size: number; max: number; items: unknown[] } {
  return { size: 0, max: 0, items: [] };
}

export function hasQueuedMessages(): boolean {
  return false;
}

export function restoreQueue(): void {
  // No queue in minimal version
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export async function runHeartbeat(): Promise<string | null> {
  const memory = getMemory(getMemoryDir());
  const context = await memory.buildContext({ mode: 'full' });

  // Check if there are active tasks
  if (!context.includes('- [ ]')) {
    return null;
  }

  const prompt = 'You are checking your HEARTBEAT tasks. Review active tasks and take action if needed. Keep response brief.';

  try {
    const response = await callClaude(prompt, context);
    await memory.appendConversation('assistant', `[Heartbeat] ${response}`);
    return response;
  } catch (error) {
    console.error('Heartbeat error:', error);
    return null;
  }
}

// =============================================================================
// System Prompt
// =============================================================================

export function getSystemPrompt(): string {
  return `You are a personal AI assistant with memory and task capabilities.

## Instructions

- When the user asks you to remember something, wrap it in [REMEMBER]...[/REMEMBER] tags
  Example: [REMEMBER]User prefers TypeScript[/REMEMBER]

- When the user asks you to do something periodically/scheduled, wrap it in [TASK]...[/TASK] tags
  Format: [TASK schedule="cron or description"]task content[/TASK]
  Example: [TASK schedule="every 5 minutes"]Write a haiku to output.md with timestamp[/TASK]

- When you open a webpage or create something the user should see, wrap it in [SHOW]...[/SHOW] tags
  Format: [SHOW url="URL"]description[/SHOW]
  Example: [SHOW url="http://localhost:3000"]Portfolio 網站已啟動[/SHOW]

- Keep responses concise and helpful
- You have access to memory context below`;
}

// =============================================================================
// Tag Parser
// =============================================================================

export function parseTags(response: string): ParsedTags {
  let remember: { content: string; topic?: string } | undefined;
  if (response.includes('[REMEMBER')) {
    const match = response.match(/\[REMEMBER(?:\s+#(\S+))?\](.*?)\[\/REMEMBER\]/s);
    if (match) remember = { content: match[2].trim(), topic: match[1] };
  }

  let task: { content: string; schedule?: string } | undefined;
  if (response.includes('[TASK')) {
    const match = response.match(/\[TASK(?:\s+schedule="([^"]*)")?\](.*?)\[\/TASK\]/s);
    if (match) task = { content: match[2].trim(), schedule: match[1] };
  }

  const chats: string[] = [];
  if (response.includes('[CHAT]')) {
    for (const m of response.matchAll(/\[CHAT\](.*?)\[\/CHAT\]/gs)) {
      chats.push(m[1].trim());
    }
  }

  const shows: Array<{ url: string; desc: string }> = [];
  if (response.includes('[SHOW')) {
    for (const m of response.matchAll(/\[SHOW(?:\s+url="([^"]*)")?\](.*?)\[\/SHOW\]/gs)) {
      shows.push({ url: m[1] ?? '', desc: m[2].trim() });
    }
  }

  const cleanContent = response
    .replace(/\[REMEMBER[^\]]*\].*?\[\/REMEMBER\]/gs, '')
    .replace(/\[TASK[^\]]*\].*?\[\/TASK\]/gs, '')
    .replace(/\[SHOW[^\]]*\].*?\[\/SHOW\]/gs, '')
    .replace(/\[CHAT\].*?\[\/CHAT\]/gs, '')
    .trim();

  return { remember, task, chats, shows, cleanContent };
}

// =============================================================================
// Error Classification
// =============================================================================

function classifyClaudeError(error: unknown): ClaudeErrorClassification {
  const msg = error instanceof Error ? error.message : String(error);
  const stderr = (error as { stderr?: string })?.stderr ?? '';
  const killed = (error as { killed?: boolean })?.killed;
  const combined = `${msg}\n${stderr}`.toLowerCase();

  if (combined.includes('enoent') || combined.includes('not found')) {
    return { type: 'NOT_FOUND', message: '無法找到 claude CLI。請確認已安裝 Claude Code 並且 claude 指令在 PATH 中。' };
  }
  if (killed || combined.includes('timeout') || combined.includes('timed out')) {
    return { type: 'TIMEOUT', message: '處理超時（超過 8 分鐘）。Claude CLI 回應太慢或暫時不可用，請稍後再試。' };
  }
  if (combined.includes('maxbuffer')) {
    return { type: 'MAX_BUFFER', message: '回應內容過大，超過緩衝區限制。請嘗試要求更簡潔的回覆。' };
  }
  if (combined.includes('rate limit') || combined.includes('429')) {
    return { type: 'RATE_LIMIT', message: 'Claude API 達到速率限制，稍後自動重試。' };
  }
  if (combined.includes('access denied') || (combined.includes('permission') && !combined.includes('skip-permissions'))) {
    return { type: 'PERMISSION', message: '存取被拒絕。Claude CLI 可能沒有足夠的權限執行此操作。' };
  }

  if (stderr.trim()) {
    const lines = stderr.trim().split('\n').filter((l: string) => l.trim());
    const lastLine = lines[lines.length - 1] || '';
    if (lastLine.length > 10 && lastLine.length < 300) {
      return { type: 'UNKNOWN', message: `Claude CLI 執行失敗：${lastLine}` };
    }
  }

  return { type: 'UNKNOWN', message: '處理訊息時發生錯誤。請稍後再試，或嘗試換個方式描述你的需求。' };
}

// =============================================================================
// Claude CLI Execution
// =============================================================================

async function execClaude(fullPrompt: string): Promise<string> {
  const TIMEOUT_MS = 480_000; // 8 minutes

  // Filter out ANTHROPIC_API_KEY to use CLI subscription
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => k !== 'ANTHROPIC_API_KEY'),
  );

  const args = ['-p', '--dangerously-skip-permissions', '--output-format', 'stream-json'];
  if (process.env.CLAUDE_MODEL) {
    args.push('--model', process.env.CLAUDE_MODEL);
  }

  return new Promise<string>((resolve, reject) => {
    let settled = false;

    const child = spawn('claude', args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    });

    let resultText = '';
    let buffer = '';
    let stderr = '';

    // Timeout handler
    const timer = setTimeout(() => {
      if (settled) return;
      try {
        process.kill(-child.pid!, 'SIGTERM');
      } catch { /* already dead */ }
      setTimeout(() => {
        try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* already dead */ }
      }, 5000);
    }, TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf-8');
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
              if (block.type === 'text' && block.text) {
                if (!resultText) resultText = block.text;
              }
            }
          } else if (event.type === 'result') {
            resultText = event.result ?? resultText;
          }
        } catch { /* ignore malformed JSON */ }
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });

    child.on('close', (code) => {
      settled = true;
      clearTimeout(timer);

      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer.trim());
          if (event.type === 'result') resultText = event.result ?? resultText;
        } catch { /* ignore */ }
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

// =============================================================================
// Core Functions
// =============================================================================

export async function callClaude(prompt: string, context: string): Promise<string> {
  if (claudeBusy) {
    return '我正在處理另一個請求，請稍後再試。';
  }

  const systemPrompt = getSystemPrompt();
  const fullPrompt = `${systemPrompt}\n\n${context}\n\n---\n\nUser: ${prompt}`;

  claudeBusy = true;

  try {
    const result = await execClaude(fullPrompt);
    return result.trim();
  } catch (error) {
    const classified = classifyClaudeError(error);
    const stdout = (error as { stdout?: string })?.stdout?.trim();
    if (stdout && stdout.length > 20) {
      return stdout;
    }
    return classified.message;
  } finally {
    claudeBusy = false;
  }
}

export async function processMessage(userMessage: string): Promise<AgentResponse> {
  const memory = getMemory(getMemoryDir());

  // 1. Build context
  const context = await memory.buildContext({ mode: 'full' });

  // 2. Call Claude
  const response = await callClaude(userMessage, context);

  // 3. Parse tags
  const tags = parseTags(response);

  // 4. Save to memory
  await memory.appendConversation('user', userMessage);
  await memory.appendConversation('assistant', response);

  if (tags.remember) {
    if (tags.remember.topic) {
      await memory.appendTopicMemory(tags.remember.topic, tags.remember.content);
    } else {
      await memory.appendMemory(tags.remember.content);
    }
  }

  if (tags.task) {
    await memory.addTask(tags.task.content, tags.task.schedule);
  }

  return {
    content: tags.cleanContent,
    shouldRemember: tags.remember?.content,
    taskAdded: tags.task?.content,
  };
}
