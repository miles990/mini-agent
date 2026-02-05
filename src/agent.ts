/**
 * Core Agent Loop
 *
 * receive → context → llm → execute → respond
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getMemory } from './memory.js';
import { loadInstanceConfig, getCurrentInstanceId } from './instance.js';
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

Instructions:
- When the user asks you to remember something, wrap it in [REMEMBER]...[/REMEMBER] tags
  Example: [REMEMBER]User prefers TypeScript[/REMEMBER]

- When the user asks you to do something periodically/scheduled, wrap it in [TASK]...[/TASK] tags
  Format: [TASK schedule="cron or description"]task content[/TASK]
  Example: [TASK schedule="every 5 minutes"]Write a haiku to output.md with timestamp[/TASK]
  Example: [TASK schedule="daily at 9am"]Send daily summary[/TASK]

- Keep responses concise and helpful
- You have access to memory context provided below
`;
}

/**
 * Call Claude Code via subprocess
 * Uses a temp file to pass the prompt (avoids shell escaping issues)
 */
async function callClaude(prompt: string, context: string): Promise<string> {
  const systemPrompt = getSystemPrompt();
  const fullPrompt = `${systemPrompt}\n\n${context}\n\n---\n\nUser: ${prompt}`;

  // Write prompt to temp file
  const tmpFile = path.join(os.tmpdir(), `mini-agent-prompt-${Date.now()}.txt`);
  fs.writeFileSync(tmpFile, fullPrompt, 'utf-8');

  try {
    const result = execSync(`cat "${tmpFile}" | claude -p --dangerously-skip-permissions`, {
      encoding: 'utf-8',
      timeout: 120000,
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
    return result.trim();
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
  // 使用當前實例的記憶系統
  const memory = getMemory();

  // 1. Build context from memory
  const context = await memory.buildContext();

  // 2. Call Claude
  const response = await callClaude(userMessage, context);

  // 3. Log to daily notes
  await memory.appendDailyNote(`User: ${userMessage.slice(0, 100)}...`);
  await memory.appendDailyNote(`Assistant: ${response.slice(0, 100)}...`);

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
  const context = await memory.buildContext();

  // Check if there are active tasks (look for unchecked checkboxes)
  if (!context.includes('- [ ]')) {
    return null; // No tasks to process
  }

  const prompt = `You are checking your HEARTBEAT tasks.
Review the active tasks and:
1. If any task can be completed now, do it and mark it done
2. If any task needs attention, take action
3. Report what you did (or "No action needed" if nothing to do)

Keep response brief.`;

  try {
    const response = await callClaude(prompt, context);
    await memory.appendDailyNote(`[Heartbeat] ${response.slice(0, 100)}...`);
    return response;
  } catch (error) {
    console.error('Heartbeat error:', error);
    return null;
  }
}
