/**
 * Core Agent Loop
 *
 * receive → context → llm → execute → respond
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildContext, appendDailyNote, appendMemory, addTask } from './memory.js';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface AgentResponse {
  content: string;
  shouldRemember?: string;
  taskAdded?: string;
}

const SYSTEM_PROMPT = `You are a personal AI assistant with memory and task capabilities.

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

/**
 * Call Claude Code via subprocess
 * Uses a temp file to pass the prompt (avoids shell escaping issues)
 */
async function callClaude(prompt: string, context: string): Promise<string> {
  const fullPrompt = `${SYSTEM_PROMPT}\n\n${context}\n\n---\n\nUser: ${prompt}`;

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
  // 1. Build context from memory
  const context = await buildContext();

  // 2. Call Claude
  const response = await callClaude(userMessage, context);

  // 3. Log to daily notes
  await appendDailyNote(`User: ${userMessage.slice(0, 100)}...`);
  await appendDailyNote(`Assistant: ${response.slice(0, 100)}...`);

  // 4. Check if should remember something
  let shouldRemember: string | undefined;
  if (response.includes('[REMEMBER]')) {
    const match = response.match(/\[REMEMBER\](.*?)\[\/REMEMBER\]/s);
    if (match) {
      shouldRemember = match[1].trim();
      await appendMemory(shouldRemember);
    }
  }

  // 5. Check if should add a task
  let taskAdded: string | undefined;
  if (response.includes('[TASK')) {
    const match = response.match(/\[TASK(?:\s+schedule="([^"]*)")?\](.*?)\[\/TASK\]/s);
    if (match) {
      const schedule = match[1];
      const taskContent = match[2].trim();
      await addTask(taskContent, schedule);
      taskAdded = taskContent;
    }
  }

  // Clean response from all tags
  let cleanContent = response
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
  const context = await buildContext();

  // Check if there are active tasks
  if (!context.includes('## Active Tasks') || context.includes('<!-- Add tasks below')) {
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
    await appendDailyNote(`[Heartbeat] ${response.slice(0, 100)}...`);
    return response;
  } catch (error) {
    console.error('Heartbeat error:', error);
    return null;
  }
}
