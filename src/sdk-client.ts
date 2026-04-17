/**
 * SDK Client — Agent SDK 執行層（worker_threads 隔離）
 *
 * 2026-04-17 root fix: SDK query() was running on the main Node event loop and
 * blocking HTTP / cron / perception whenever a cycle was in flight. Moved the SDK
 * call into a dedicated worker_threads Worker — main thread only exchanges messages.
 *
 * Convergence condition: HTTP event loop stays responsive regardless of SDK latency.
 *
 * Signature preserved: (fullPrompt, opts) → Promise<string>, same as execClaude.
 */

import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { ExecOptions } from './agent.js';
import { slog } from './utils.js';

const WORKER_URL = new URL('./sdk-worker.js', import.meta.url);

interface SdkMessage {
  type: string;
  message?: {
    type: string;
    message?: {
      content?: Array<{ type: string; text?: string; thinking?: string; signature?: string }>;
      stop_reason?: string;
      model?: string;
      usage?: Record<string, unknown>;
    };
    usage?: Record<string, unknown>;
  };
}

export async function execClaudeViaSdk(
  fullPrompt: string,
  opts?: ExecOptions,
): Promise<string> {
  // Convergence condition: cycle MUST complete in bounded time.
  const timeoutMs = opts?.timeoutMs ?? 90_000;
  const progressTimeoutMs = opts?.progressTimeoutMs ?? 30_000;
  const source = opts?.source ?? 'loop';
  const startTs = Date.now();

  // Maintain the ANTHROPIC_API_KEY filter (force subscription auth, never API-billed).
  const filteredEnv = Object.fromEntries(
    Object.entries(process.env).filter(([k, v]) => k !== 'ANTHROPIC_API_KEY' && v !== undefined),
  ) as Record<string, string>;

  return new Promise<string>((resolve, reject) => {
    const chunks: string[] = [];
    const blocksByType: Record<string, number> = {};
    let thinkingChars = 0;
    let signatureChars = 0;
    let stopReason: string | null = null;
    let resultUsage: Record<string, unknown> | null = null;
    let model: string | null = null;
    let lastProgressTs = Date.now();
    let settled = false;

    let workerPath: string;
    try {
      workerPath = fileURLToPath(WORKER_URL);
    } catch {
      workerPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'sdk-worker.js');
    }

    const worker = new Worker(workerPath, {
      workerData: {
        fullPrompt,
        queryOptions: {},
        env: filteredEnv,
        source,
        model: opts?.model,
        maxThinkingTokens: opts?.maxThinkingTokens,
      },
    });

    const finish = (err: Error | null, result?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      clearInterval(stallHandle);
      worker.terminate().catch(() => { /* already gone */ });
      if (err) reject(err);
      else resolve(result ?? '');
    };

    const abortWorker = (reason: string): void => {
      try { worker.postMessage({ type: 'abort', reason }); } catch { /* worker already exited */ }
    };

    const timeoutHandle = setTimeout(() => {
      abortWorker(`SDK query timeout after ${timeoutMs}ms`);
      // Give the worker 2s to clean up, then hard-terminate via finish().
      setTimeout(() => {
        finish(Object.assign(new Error(`SDK query timeout after ${timeoutMs}ms`), {
          duration: Date.now() - startTs, timeoutMs, progressTimeoutMs, source,
        }));
      }, 2000);
    }, timeoutMs);

    const stallHandle = setInterval(() => {
      if (Date.now() - lastProgressTs > progressTimeoutMs) {
        abortWorker(`SDK query stalled — no progress for ${progressTimeoutMs}ms`);
        setTimeout(() => {
          finish(Object.assign(new Error(`SDK query stalled — no progress for ${progressTimeoutMs}ms`), {
            duration: Date.now() - startTs, timeoutMs, progressTimeoutMs, source,
          }));
        }, 2000);
      }
    }, 5_000);

    worker.on('message', (msg: SdkMessage) => {
      if (msg.type === 'sdk-message' && msg.message) {
        lastProgressTs = Date.now();
        const m = msg.message;
        if (m.type === 'assistant' && m.message?.content) {
          for (const block of m.message.content) {
            blocksByType[block.type] = (blocksByType[block.type] ?? 0) + 1;
            if (block.type === 'thinking') {
              thinkingChars += (block.thinking ?? '').length;
              signatureChars += (block.signature ?? '').length;
            } else if (typeof block.text === 'string') {
              chunks.push(block.text);
              if (opts?.onPartialOutput && block.text) {
                try { opts.onPartialOutput(block.text); } catch { /* swallow consumer errors */ }
              }
            }
          }
          if (m.message.stop_reason) stopReason = m.message.stop_reason;
          if (m.message.model) model = m.message.model;
        } else if (m.type === 'result') {
          const durationMs = Date.now() - startTs;
          resultUsage = (m as { usage?: Record<string, unknown> }).usage ?? null;
          const inputTok = (resultUsage?.input_tokens as number | undefined) ?? 0;
          const outputTok = (resultUsage?.output_tokens as number | undefined) ?? 0;
          const cacheRead = (resultUsage?.cache_read_input_tokens as number | undefined) ?? 0;
          const cacheCreate = (resultUsage?.cache_creation_input_tokens as number | undefined) ?? 0;
          const thinkingState =
            thinkingChars > 0 ? 'visible' : signatureChars > 0 ? 'signature_only' : 'none';
          const blocksStr = Object.entries(blocksByType)
            .map(([k, v]) => `${k}:${v}`)
            .join(',');
          slog(
            'SDK',
            `source=${source} worker model=${model ?? '?'} blocks={${blocksStr}} ` +
              `thinking=${thinkingState}(chars=${thinkingChars},sig=${signatureChars}) ` +
              `stop=${stopReason ?? '?'} ` +
              `tok={in:${inputTok},out:${outputTok},cacheR:${cacheRead},cacheW:${cacheCreate}} ` +
              `duration=${durationMs}ms`,
          );
        }
      } else if (msg.type === 'done') {
        finish(null, chunks.join(''));
      } else if (msg.type === 'error') {
        finish(Object.assign(new Error(`SDK query failed: ${(msg as unknown as { message: string }).message}`), {
          duration: Date.now() - startTs, timeoutMs, progressTimeoutMs, source,
        }));
      }
    });

    worker.on('error', (err) => {
      finish(Object.assign(new Error(`SDK worker crashed: ${err.message}`), {
        cause: err, duration: Date.now() - startTs, timeoutMs, progressTimeoutMs, source,
      }));
    });

    worker.on('exit', (code) => {
      if (!settled) {
        finish(Object.assign(new Error(`SDK worker exited early with code ${code}`), {
          duration: Date.now() - startTs, timeoutMs, progressTimeoutMs, source,
        }));
      }
    });
  });
}

/**
 * Check if SDK path is enabled via feature flag.
 *
 * A4 (2026-04-17): default FLIPPED to true — SDK is primary path.
 * Legacy CLI subprocess path remains fully functional, reachable via
 * USE_SDK=false (explicit opt-out).
 *
 * With the worker_threads isolation added 2026-04-17 evening, SDK no longer
 * blocks the main event loop, so enabling it again is safe.
 *
 * Default: true (SDK).  USE_SDK=false → legacy CLI path.
 */
export function isSdkEnabled(): boolean {
  const v = process.env.USE_SDK?.toLowerCase();
  if (v === 'false' || v === '0') return false;
  return true;
}
