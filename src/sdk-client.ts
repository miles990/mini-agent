/**
 * SDK Client — Agent SDK 執行層（child_process.fork 隔離）
 *
 * 2026-04-17 D16 root fix: SDK query() was blocking the parent event loop
 * even when run in worker_threads — 180s API call = 180s main-thread stall.
 * Node worker_threads share libuv resources; "parent awaits long worker I/O"
 * stalls parent timers.
 *
 * Industry-standard solution: child_process.fork. Separate OS process, own
 * event loop, IPC is pure async, parent event loop never blocks regardless
 * of child latency. Same approach used by Vercel AI SDK / LangChain.js for
 * agent runtimes.
 *
 * Trade-off vs worker_threads: ~200-500ms spawn cost per call (cold Node
 * process + SDK import). Worth it — parent responsiveness matters more
 * than per-call latency.
 *
 * Signature preserved: (fullPrompt, opts) → Promise<string>, same as execClaude.
 */

import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
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

  // Maintain the ANTHROPIC_API_KEY filter (force subscription auth).
  const filteredEnv = Object.fromEntries(
    Object.entries(process.env).filter(([k, v]) => k !== 'ANTHROPIC_API_KEY' && v !== undefined),
  ) as Record<string, string>;

  let workerPath: string;
  try {
    workerPath = fileURLToPath(WORKER_URL);
  } catch {
    workerPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'sdk-worker.js');
  }

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
    let firstMessageMs = -1;
    let lastMessageTs = performance.now();
    let msgHandlerTotalMs = 0;
    let msgHandlerCount = 0;
    let partialOutputMaxMs = 0;

    // fork spawns a new Node process — separate V8, separate libuv.
    // Parent event loop stays responsive regardless of what the child does.
    // We inherit the parent's env (the child filters it at startup).
    const t_forkSpawn = performance.now();
    const child: ChildProcess = fork(workerPath, [], {
      silent: false,
      serialization: 'advanced',
      // stdio inherit: child stdout/stderr merges with parent log so slog in
      // the child (via `console.*`) still lands in server.log.
      stdio: ['pipe', 'inherit', 'inherit', 'ipc'],
    });
    const forkSpawnMs = performance.now() - t_forkSpawn;
    if (forkSpawnMs > 200) {
      slog('PROFILE', `sdk-child fork() spawn ${Math.round(forkSpawnMs)}ms`);
    }

    // Send init message to kick off the query.
    child.send({
      type: 'init',
      init: {
        fullPrompt,
        queryOptions: { maxBudgetUsd: 30 },
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
      // kill child if it hasn't already exited
      if (!child.killed) {
        try { child.kill('SIGTERM'); } catch { /* already gone */ }
      }
      if (err) reject(err);
      else resolve(result ?? '');
    };

    const abortChild = (reason: string): void => {
      try { child.send({ type: 'abort', reason }); } catch { /* child already exited */ }
    };

    const timeoutHandle = setTimeout(() => {
      abortChild(`SDK query timeout after ${timeoutMs}ms`);
      setTimeout(() => {
        finish(Object.assign(new Error(`SDK query timeout after ${timeoutMs}ms`), {
          duration: Date.now() - startTs, timeoutMs, progressTimeoutMs, source,
        }));
      }, 2000);
    }, timeoutMs);

    const stallHandle = setInterval(() => {
      if (Date.now() - lastProgressTs > progressTimeoutMs) {
        abortChild(`SDK query stalled — no progress for ${progressTimeoutMs}ms`);
        setTimeout(() => {
          finish(Object.assign(new Error(`SDK query stalled — no progress for ${progressTimeoutMs}ms`), {
            duration: Date.now() - startTs, timeoutMs, progressTimeoutMs, source,
          }));
        }, 2000);
      }
    }, 5_000);

    child.on('message', (msg: SdkMessage) => {
      const handlerStart = performance.now();
      if (firstMessageMs < 0) {
        firstMessageMs = Math.round(handlerStart - t_forkSpawn);
        if (firstMessageMs > 1000) {
          slog('PROFILE', `sdk-child first message after ${firstMessageMs}ms (fork + SDK import + first API round-trip)`);
        }
      }
      const gapMs = Math.round(handlerStart - lastMessageTs);
      lastMessageTs = handlerStart;
      if (gapMs > 10_000) {
        slog('PROFILE', `sdk-child inter-message gap ${gapMs}ms — no activity from child (API wait)`);
      }

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
                const cbStart = performance.now();
                try { opts.onPartialOutput(block.text); } catch { /* swallow */ }
                const cbMs = performance.now() - cbStart;
                if (cbMs > partialOutputMaxMs) partialOutputMaxMs = cbMs;
                if (cbMs > 500) {
                  slog('PROFILE', `onPartialOutput sync callback ${Math.round(cbMs)}ms`);
                }
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
            `source=${source} child model=${model ?? '?'} blocks={${blocksStr}} ` +
              `thinking=${thinkingState}(chars=${thinkingChars},sig=${signatureChars}) ` +
              `stop=${stopReason ?? '?'} ` +
              `tok={in:${inputTok},out:${outputTok},cacheR:${cacheRead},cacheW:${cacheCreate}} ` +
              `duration=${durationMs}ms`,
          );
          slog(
            'PROFILE',
            `sdk-child handler: count=${msgHandlerCount + 1} totalMs=${Math.round(msgHandlerTotalMs)} onPartialOutput maxMs=${Math.round(partialOutputMaxMs)}`,
          );
        }
      } else if (msg.type === 'done') {
        finish(null, chunks.join(''));
      } else if (msg.type === 'error') {
        finish(Object.assign(new Error(`SDK query failed: ${(msg as unknown as { message: string }).message}`), {
          duration: Date.now() - startTs, timeoutMs, progressTimeoutMs, source,
        }));
      }
      const handlerMs = performance.now() - handlerStart;
      msgHandlerTotalMs += handlerMs;
      msgHandlerCount++;
      if (handlerMs > 200) {
        slog('PROFILE', `sdk-child message handler slow ${Math.round(handlerMs)}ms (type=${msg.type})`);
      }
    });

    child.on('error', (err) => {
      finish(Object.assign(new Error(`SDK child crashed: ${err.message}`), {
        cause: err, duration: Date.now() - startTs, timeoutMs, progressTimeoutMs, source,
      }));
    });

    child.on('exit', (code, signal) => {
      if (!settled) {
        finish(Object.assign(new Error(`SDK child exited early (code=${code} signal=${signal})`), {
          duration: Date.now() - startTs, timeoutMs, progressTimeoutMs, source,
        }));
      }
    });
  });
}

/**
 * SDK is the primary path (2026-04-17: via child_process.fork).
 * USE_SDK=false opts into CLI subprocess path as fallback.
 */
export function isSdkEnabled(): boolean {
  const v = process.env.USE_SDK?.toLowerCase();
  if (v === 'false' || v === '0') return false;
  return true;
}
