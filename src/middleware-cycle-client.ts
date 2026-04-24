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
import { buildForensicEntryShell, writeForensicEntry } from './forensic-log.js';

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
  // Default OFF — env must be explicit true. Kuro opts-in via launchd plist
  // EnvironmentVariables: USE_MIDDLEWARE_FOR_CYCLE=true. This keeps behavior
  // deterministic: unset env = legacy SDK path; only plist-configured agents
  // get Layer C.
  const v = process.env.USE_MIDDLEWARE_FOR_CYCLE?.toLowerCase();
  return v === 'true' || v === '1';
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

  // Forensic: Layer 1 federation — record middleware call envelope with taskId
  // as the correlation key. Post-hoc Layer 2 analyzer joins against
  // middleware server.log [MW-CYCLE] using this taskId. Schema consensus:
  // KG discussion 8eee635f (CC + Kuro + Akari). tool_use-level forensic is
  // out of scope (middleware does not surface per-tool events to the caller).
  let taskId: string | null = null;
  const flushForensic = (opts2: {
    status: string;
    errorSubtype?: string;
    retryable?: boolean | null;
    errMsg?: string;
    timedOut?: boolean;
  }): void => {
    try {
      const now = Date.now();
      const entry = buildForensicEntryShell({
        backend: 'middleware',
        cwd: process.cwd(),
        fullPrompt,
        systemPromptSize: 0,
        userPromptSize: fullPrompt.length,
        contextSource: { lane: source },
        timeoutMs,
        workerType: source,
        middlewareTaskId: taskId ?? undefined,
      });
      entry.ts_end = new Date(now).toISOString();
      entry.duration_ms = now - startTs;
      entry.middleware_status = opts2.status;
      entry.exit_code = opts2.status === 'completed' ? 0 : null;
      entry.error_subtype = opts2.errorSubtype ?? null;
      entry.retryable = opts2.retryable ?? null;
      entry.timed_out = opts2.timedOut ?? false;
      if (opts2.errMsg) entry.stderr_full = opts2.errMsg.slice(0, 2000);
      writeForensicEntry(entry, fullPrompt);
    } catch { /* fail-open */ }
  };

  // Step 1: dispatch
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
    flushForensic({ status: 'dispatch-failed', errorSubtype: 'dispatch_failed', retryable: true, errMsg: msg });
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
      flushForensic({ status: 'completed' });
      return result;
    }

    if (statusData.status === 'failed' || statusData.status === 'timeout' || statusData.status === 'cancelled') {
      const errMsg = statusData.error ?? `status=${statusData.status}`;
      flushForensic({
        status: statusData.status,
        errorSubtype: `middleware_${statusData.status}`,
        retryable: statusData.status !== 'failed',
        timedOut: statusData.status === 'timeout',
        errMsg,
      });
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

  flushForensic({ status: 'poll-timeout', errorSubtype: 'poll_timeout', retryable: true, timedOut: true });
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
