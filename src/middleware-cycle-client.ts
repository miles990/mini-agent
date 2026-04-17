/**
 * Middleware Cycle Client — Layer C (2026-04-17)
 *
 * Dispatches Kuro's cycle LLM call to middleware agent-brain worker and polls
 * for result. Main event loop only performs POST + poll — zero for-await
 * iteration of Claude subprocess stdout. Solves 160s loop-lag catastrophe
 * observed when Claude SDK runs in Kuro's own V8 isolate.
 *
 * Design:
 *   - OFF by default — opt-in via USE_MIDDLEWARE_FOR_CYCLE=true env
 *   - Dispatch POST /dispatch with worker="agent-brain" + caller's full prompt
 *   - Poll GET /status/:taskId every 2s until completed/failed/timeout
 *   - Return plain string result matching execClaude signature
 *
 * Trade-off:
 *   - Adds ~100ms network round-trip vs in-process SDK
 *   - Completely decouples Kuro event loop from Claude iteration
 *   - Aligns with proposal brain-only-kuro-v2: cycle LLM call 透過中台跑
 */

import type { ExecOptions } from './agent.js';
import { slog } from './utils.js';

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_TIMEOUT_MS = 1_500_000;

interface DispatchResponse {
  taskId: string;
  status: string;
}

interface StatusResponse {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'timeout' | 'cancelled';
  result?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
}

function getMiddlewareUrl(): string {
  return process.env.MIDDLEWARE_URL ?? 'http://localhost:3200';
}

export function isMiddlewareCycleEnabled(): boolean {
  // Default ON (2026-04-17) — Layer C flipped to primary after verified:
  //   Layer A Verified: eventBus defer dropped idle max 160s → 126ms
  //   Layer A+cycle STILL 159s max → confirmed SDK for-await blocks main thread
  //   Layer C eliminates iteration from main thread (moves to middleware process)
  // Opt-out via USE_MIDDLEWARE_FOR_CYCLE=false. Falls through to SDK/CLI path.
  const v = process.env.USE_MIDDLEWARE_FOR_CYCLE?.toLowerCase();
  if (v === 'false' || v === '0') return false;
  return true;
}

export async function execClaudeViaMiddleware(
  fullPrompt: string,
  opts?: ExecOptions,
): Promise<string> {
  const baseUrl = getMiddlewareUrl();
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const source = opts?.source ?? 'loop';
  const startTs = Date.now();
  const pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;

  // Step 1: dispatch
  let taskId: string;
  try {
    const dispatchRes = await fetch(`${baseUrl}/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        worker: 'agent-brain',
        task: fullPrompt,
        timeoutSeconds: Math.floor(timeoutMs / 1000),
        caller: source,
      }),
    });
    if (!dispatchRes.ok) {
      const body = await dispatchRes.text().catch(() => '');
      throw new Error(`dispatch failed HTTP ${dispatchRes.status}: ${body.slice(0, 200)}`);
    }
    const dispatchData = (await dispatchRes.json()) as DispatchResponse;
    taskId = dispatchData.taskId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw Object.assign(new Error(`middleware dispatch failed: ${msg}`), {
      cause: err,
      duration: Date.now() - startTs,
      timeoutMs,
      source,
    });
  }

  slog('MW-CYCLE', `dispatched taskId=${taskId} source=${source} timeout=${Math.round(timeoutMs / 1000)}s`);

  // Step 2: poll status
  const deadline = startTs + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise<void>((r) => setTimeout(r, pollIntervalMs));
    let statusData: StatusResponse;
    try {
      const statusRes = await fetch(`${baseUrl}/status/${encodeURIComponent(taskId)}`);
      if (!statusRes.ok) continue; // transient — retry
      statusData = (await statusRes.json()) as StatusResponse;
    } catch {
      continue; // transient network error — retry
    }

    if (statusData.status === 'completed') {
      const result = statusData.result ?? '';
      const durationMs = Date.now() - startTs;
      slog(
        'MW-CYCLE',
        `completed taskId=${taskId} source=${source} duration=${durationMs}ms result_len=${result.length}`,
      );
      return result;
    }

    if (statusData.status === 'failed' || statusData.status === 'timeout' || statusData.status === 'cancelled') {
      const errMsg = statusData.error ?? `status=${statusData.status}`;
      throw Object.assign(new Error(`middleware task ${taskId} ${statusData.status}: ${errMsg.slice(0, 300)}`), {
        duration: Date.now() - startTs,
        timeoutMs,
        source,
        middlewareStatus: statusData.status,
      });
    }
    // still pending/running — loop
  }

  // Poll timeout — try to cancel upstream to free resources
  try {
    await fetch(`${baseUrl}/task/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
  } catch { /* best effort */ }

  throw Object.assign(
    new Error(`middleware poll timeout after ${timeoutMs}ms (taskId=${taskId}, cancel sent)`),
    {
      duration: Date.now() - startTs,
      timeoutMs,
      source,
      middlewareStatus: 'poll-timeout',
    },
  );
}
