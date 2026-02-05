/**
 * Core Agent Loop
 *
 * receive → context → llm → execute → respond
 */

import { spawn } from 'node:child_process';
import { buildContext, appendDailyNote, appendMemory } from './memory.js';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface AgentResponse {
  content: string;
  shouldRemember?: string;
}

/**
 * Call Claude Code via subprocess
 */
async function callClaude(prompt: string, context: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const fullPrompt = `${context}\n\n---\n\nUser: ${prompt}`;

    const proc = spawn('claude', ['-p', fullPrompt], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr || `Claude exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });

    // Timeout after 2 minutes
    setTimeout(() => {
      proc.kill();
      reject(new Error('Claude timeout'));
    }, 120000);
  });
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

  return {
    content: response.replace(/\[REMEMBER\].*?\[\/REMEMBER\]/gs, '').trim(),
    shouldRemember,
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
