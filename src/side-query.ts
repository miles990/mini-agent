/**
 * Side Query — Lightweight Claude CLI subprocess for quick LLM queries
 *
 * Used for tasks like semantic ranking, summarization, and classification
 * that need LLM intelligence but don't need the full execClaude infrastructure.
 *
 * Design principles (from Claude Code's sideQuery pattern):
 * - Low max_tokens (256 default) — keep queries cheap
 * - Timeout-guarded — sideQuery must not block the main loop
 * - Fire-and-forget safe — null return on any failure
 * - No API key needed — uses Claude CLI subscription
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { eventBus } from './event-bus.js';
import { execClaudeViaSdk, isSdkEnabled } from './sdk-client.js';

// Use the same subprocess cwd as execClaude — outside .mini-agent git tree
// to avoid loading the 43K CLAUDE.md via auto-discovery
const SUBPROCESS_CWD = path.join(process.env.HOME ?? '/tmp', '.mini-agent-subprocess');

export interface SideQueryOptions {
  model?: string;
  timeout?: number;
  maxTokens?: number;
}

/**
 * Run a lightweight LLM query via Claude CLI subprocess.
 *
 * Returns the model's text response, or null on any failure (timeout, parse error, etc.).
 * Designed for semantic ranking, classification, and other cheap sidecar tasks.
 */
export async function sideQuery(
  prompt: string,
  opts?: SideQueryOptions,
): Promise<string | null> {
  const model = opts?.model ?? 'claude-haiku-4-5-20251001';
  const timeout = opts?.timeout ?? 15_000;
  const start = Date.now();

  // Phase A3 canary: when USE_SDK=true, route side-query through Agent SDK.
  // side-query is the designated canary path per thinking-mechanisms-upgrade proposal.
  // Kept null-on-failure semantics for compatibility with downstream fire-and-forget callers.
  if (isSdkEnabled()) {
    try {
      const result = await execClaudeViaSdk(prompt, {
        source: 'ask',
        model,
        timeoutMs: timeout,
      });
      eventBus.emit('log:info', {
        tag: 'side-query',
        msg: `[canary-sdk] model=${model} duration=${Date.now() - start}ms result=${result.length}ch`,
      });
      return result.trim() || null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      eventBus.emit('log:info', {
        tag: 'side-query',
        msg: `[canary-sdk] failed: ${msg.slice(0, 200)}`,
      });
      return null;
    }
  }

  // Ensure subprocess cwd exists
  if (!existsSync(SUBPROCESS_CWD)) {
    mkdirSync(SUBPROCESS_CWD, { recursive: true });
  }

  // Filter out ANTHROPIC_API_KEY — CLI uses subscription
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => k !== 'ANTHROPIC_API_KEY'),
  );

  return new Promise<string | null>((resolve) => {
    const args = ['-p', '--model', model, '--output-format', 'text'];

    const child = spawn('claude', args, {
      env,
      cwd: SUBPROCESS_CWD,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const settle = (result: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const duration = Date.now() - start;
      eventBus.emit('log:info', {
        tag: 'side-query',
        msg: `model=${model} duration=${duration}ms result=${result ? `${result.length}ch` : 'null'}`,
      });
      resolve(result);
    };

    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      settle(null);
    }, timeout);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', () => settle(null));

    child.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        settle(stdout.trim());
      } else {
        if (stderr) {
          eventBus.emit('log:info', {
            tag: 'side-query',
            msg: `failed: exit=${code} stderr=${stderr.slice(0, 200)}`,
          });
        }
        settle(null);
      }
    });

    // Send prompt via stdin
    child.stdin?.write(prompt);
    child.stdin?.end();
  });
}
