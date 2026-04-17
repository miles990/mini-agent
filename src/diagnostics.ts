/**
 * Diagnostics — event-loop + timing + slow-request instrumentation.
 *
 * Purpose: make main-thread blockages visible. For months we've been guessing at
 * where cycles stall (SDK? perception? post-process? worker messaging?). This
 * module logs structured data so the next incident can be diagnosed from evidence.
 *
 * Three signals, all flowing through slog so they land in server.log:
 *
 * 1. `[PROFILE] event-loop lag …` — every 1s we schedule setImmediate; the delta
 *    between scheduled and actual execution is main-thread busyness. Anything over
 *    100ms means HTTP/cron/timers were starved that long. Published continuously so
 *    we can see when the event loop goes silent.
 *
 * 2. `[TIMING] {label} …` — wrap any awaitable in `timed(label, fn)` to log its
 *    duration if it exceeds a threshold (default 500ms). Gives per-phase latency
 *    without having to dump every fast op.
 *
 * 3. `[SLOW-HTTP] {method} {path} …` — Express middleware logs every request whose
 *    end-to-end handler time exceeds 500ms, alongside the concurrent event-loop
 *    lag and the request url. If a cycle is blocking the loop, every parallel
 *    HTTP hit will show the same lag — pointing at the shared bottleneck.
 *
 * These are fire-and-forget; they don't change behavior, only visibility.
 */

import { performance } from 'node:perf_hooks';
import type { Request, Response, NextFunction } from 'express';
import { slog } from './utils.js';

// =============================================================================
// Event-loop lag monitor
// =============================================================================

let lagMonitorHandle: NodeJS.Timeout | null = null;
// Rolling stats: max lag observed since last log, plus sample count.
// We log every 5s rather than on every tick to avoid drowning the log file.
let maxLagSinceLog = 0;
let samplesSinceLog = 0;

const LAG_WARN_THRESHOLD_MS = 100;  // individual spike worth logging immediately
const LAG_LOG_INTERVAL_MS = 5_000;  // roll-up window
let lastRollupTs = Date.now();

export function startEventLoopLagMonitor(): void {
  if (lagMonitorHandle) return;
  const TICK_MS = 1_000;
  let lastSchedule = performance.now();

  const tick = (): void => {
    const now = performance.now();
    const delta = now - lastSchedule - TICK_MS;
    const lag = Math.max(0, Math.round(delta));
    lastSchedule = now;

    samplesSinceLog++;
    if (lag > maxLagSinceLog) maxLagSinceLog = lag;

    // Immediate log for big spikes so we don't lose context
    if (lag > LAG_WARN_THRESHOLD_MS * 5) {
      slog('PROFILE', `event-loop lag SPIKE ${lag}ms — main thread stalled`);
    }

    // Rollup every LAG_LOG_INTERVAL_MS
    const nowMs = Date.now();
    if (nowMs - lastRollupTs >= LAG_LOG_INTERVAL_MS) {
      if (maxLagSinceLog > LAG_WARN_THRESHOLD_MS) {
        slog('PROFILE', `event-loop rollup ${(nowMs - lastRollupTs) / 1000}s: maxLag=${maxLagSinceLog}ms samples=${samplesSinceLog}`);
      }
      maxLagSinceLog = 0;
      samplesSinceLog = 0;
      lastRollupTs = nowMs;
    }

    lagMonitorHandle = setTimeout(tick, TICK_MS);
    // unref so the monitor doesn't hold the process open during shutdown
    lagMonitorHandle.unref?.();
  };
  lagMonitorHandle = setTimeout(tick, TICK_MS);
  lagMonitorHandle.unref?.();
}

export function stopEventLoopLagMonitor(): void {
  if (lagMonitorHandle) {
    clearTimeout(lagMonitorHandle);
    lagMonitorHandle = null;
  }
}

/** Best-effort snapshot of current max lag (since last rollup) — for slow-http diag. */
export function currentMaxLag(): number {
  return maxLagSinceLog;
}

// =============================================================================
// Timing wrapper
// =============================================================================

/**
 * Wrap an async operation and log its duration when it exceeds a threshold.
 * Returns the awaited value unchanged — drop-in for any `await fn()` call site.
 */
export async function timed<T>(
  label: string,
  fn: () => Promise<T>,
  opts?: { thresholdMs?: number; alwaysLog?: boolean },
): Promise<T> {
  const threshold = opts?.thresholdMs ?? 500;
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const elapsed = Math.round(performance.now() - start);
    if (opts?.alwaysLog || elapsed >= threshold) {
      slog('TIMING', `${label} ${elapsed}ms`);
    }
  }
}

/** Synchronous variant for non-async blocks. */
export function timedSync<T>(
  label: string,
  fn: () => T,
  opts?: { thresholdMs?: number; alwaysLog?: boolean },
): T {
  const threshold = opts?.thresholdMs ?? 500;
  const start = performance.now();
  try {
    return fn();
  } finally {
    const elapsed = Math.round(performance.now() - start);
    if (opts?.alwaysLog || elapsed >= threshold) {
      slog('TIMING', `${label} ${elapsed}ms (sync)`);
    }
  }
}

// =============================================================================
// HTTP slow-request middleware
// =============================================================================

const SLOW_HTTP_THRESHOLD_MS = 500;

/**
 * Express middleware — logs any request whose handler took longer than
 * SLOW_HTTP_THRESHOLD_MS, together with the concurrent max event-loop lag.
 * If lag is high while a slow-http fires, the two observations line up:
 * "HTTP was slow because main thread was blocked for N ms during that request".
 */
export function slowRequestMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = performance.now();
  const startLag = currentMaxLag();

  res.on('finish', () => {
    const elapsed = Math.round(performance.now() - start);
    if (elapsed >= SLOW_HTTP_THRESHOLD_MS) {
      const endLag = currentMaxLag();
      const loopLagDuringReq = Math.max(startLag, endLag);
      slog(
        'SLOW-HTTP',
        `${req.method} ${req.originalUrl || req.url} ${elapsed}ms status=${res.statusCode} loopLag=${loopLagDuringReq}ms`,
      );
    }
  });

  next();
}
