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

// Node's native ELU (Event Loop Utilization) — definitive answer to
// "was main thread busy or idle?". active=time running JS; idle=time waiting
// I/O. If ELU=1.0 during a lag spike, something is SPINNING on the main
// thread (sync work). If ELU=0.0, event loop was idle in I/O wait — the
// lag is then due to timer-phase starvation or OS-level pause.
let lastElu = performance.eventLoopUtilization();

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
  let maxImmediateLagSinceLog = 0;  // setImmediate fires in 'check' phase
  let lastCpuUsage = process.cpuUsage();
  let lastCpuTs = Date.now();

  const tick = (): void => {
    const now = performance.now();
    const delta = now - lastSchedule - TICK_MS;
    const lag = Math.max(0, Math.round(delta));
    lastSchedule = now;

    samplesSinceLog++;
    if (lag > maxLagSinceLog) maxLagSinceLog = lag;

    // Cross-reference with setImmediate — different event-loop phase.
    // If setTimeout lags but setImmediate doesn't → timers phase starved.
    // If both lag → whole loop blocked.
    const immStart = performance.now();
    setImmediate(() => {
      const immLag = Math.round(performance.now() - immStart);
      if (immLag > maxImmediateLagSinceLog) maxImmediateLagSinceLog = immLag;
    });

    // Immediate log for big spikes, WITH process state snapshot so we can
    // correlate spike → memory pressure / CPU hog / many active handles.
    if (lag > LAG_WARN_THRESHOLD_MS * 5) {
      const mem = process.memoryUsage();
      const cpu = process.cpuUsage(lastCpuUsage);
      const elapsed = (Date.now() - lastCpuTs) * 1000; // μs
      const cpuPct = elapsed > 0 ? Math.round((cpu.user + cpu.system) / elapsed * 100) : 0;
      lastCpuUsage = process.cpuUsage();
      lastCpuTs = Date.now();

      // ELU: Node's authoritative "was the loop busy?" metric.
      // utilization 0.0 = fully idle; 1.0 = fully CPU-busy.
      const elu = performance.eventLoopUtilization(lastElu);
      lastElu = performance.eventLoopUtilization();

      // @ts-expect-error — internal API, stable enough for diagnostics
      const handles = (process._getActiveHandles?.() ?? []) as unknown[];
      // @ts-expect-error — internal API
      const requests = (process._getActiveRequests?.() ?? []) as unknown[];
      // Classify handles by constructor name for quick read:
      //   Socket, Server, Timer, ChildProcess, MessagePort, FSReqCallback, etc.
      const handleTypes: Record<string, number> = {};
      for (const h of handles) {
        const type = (h as { constructor?: { name?: string } })?.constructor?.name ?? 'Unknown';
        handleTypes[type] = (handleTypes[type] ?? 0) + 1;
      }
      const handleBreakdown = Object.entries(handleTypes)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}:${v}`)
        .join(',');

      slog(
        'PROFILE',
        `event-loop lag SPIKE ${lag}ms | ` +
          `ELU=${elu.utilization.toFixed(2)} (idle=${Math.round(elu.idle)}ms active=${Math.round(elu.active)}ms) | ` +
          `mem rss=${Math.round(mem.rss / 1048576)}MB heap=${Math.round(mem.heapUsed / 1048576)}/${Math.round(mem.heapTotal / 1048576)}MB | ` +
          `cpu=${cpuPct}% | handles=${handles.length}{${handleBreakdown}} reqs=${requests.length}`,
      );
    }

    // Rollup every LAG_LOG_INTERVAL_MS
    const nowMs = Date.now();
    if (nowMs - lastRollupTs >= LAG_LOG_INTERVAL_MS) {
      if (maxLagSinceLog > LAG_WARN_THRESHOLD_MS) {
        slog(
          'PROFILE',
          `event-loop rollup ${(nowMs - lastRollupTs) / 1000}s: ` +
            `timer maxLag=${maxLagSinceLog}ms samples=${samplesSinceLog} ` +
            `check maxLag=${maxImmediateLagSinceLog}ms`,
        );
      }
      maxLagSinceLog = 0;
      maxImmediateLagSinceLog = 0;
      samplesSinceLog = 0;
      lastRollupTs = nowMs;
    }

    lagMonitorHandle = setTimeout(tick, TICK_MS);
    // DO NOT unref: Node.js can skip the entire timer phase when the only
    // active timer is unref'd AND there's I/O pending. That made us record
    // fake lag SPIKEs (timer maxLag=150s while check maxLag=0ms) for hours.
    // We want this timer to force Node through the timer phase so we get
    // accurate lag measurements. Process shutdown is handled at the higher
    // level; holding this timer ref is fine — ~1KB of overhead.
  };
  lagMonitorHandle = setTimeout(tick, TICK_MS);
}

export function stopEventLoopLagMonitor(): void {
  if (lagMonitorHandle) {
    clearTimeout(lagMonitorHandle);
    lagMonitorHandle = null;
  }
}

// =============================================================================
// Continuous process state sampler (D23)
// =============================================================================

/**
 * Every 5 seconds, emit a one-line snapshot of process state:
 *   [PROFILE-SAMPLE] rss=Xmb heap=Y/Z cpu=N% ELU=0.XX handles=H{types} reqs=R
 *
 * This gives a continuous timeline of process health — complements SPIKE
 * events which only fire on >500ms lag. With periodic samples we can see
 * slow creep vs sudden jumps, and compare adjacent samples to attribute
 * lag to specific time windows.
 */
let sampleTimer: NodeJS.Timeout | null = null;

export function startStateSampler(): void {
  if (sampleTimer) return;
  let lastCpu = process.cpuUsage();
  let lastTs = Date.now();
  let lastSampleElu = performance.eventLoopUtilization();

  const sample = (): void => {
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage(lastCpu);
    const elapsed = (Date.now() - lastTs) * 1000;
    const cpuPct = elapsed > 0 ? Math.round((cpu.user + cpu.system) / elapsed * 100) : 0;
    lastCpu = process.cpuUsage();
    lastTs = Date.now();

    const elu = performance.eventLoopUtilization(lastSampleElu);
    lastSampleElu = performance.eventLoopUtilization();

    // @ts-expect-error — internal API
    const handles = (process._getActiveHandles?.() ?? []) as unknown[];
    // @ts-expect-error — internal API
    const requests = (process._getActiveRequests?.() ?? []) as unknown[];
    const handleTypes: Record<string, number> = {};
    for (const h of handles) {
      const type = (h as { constructor?: { name?: string } })?.constructor?.name ?? 'Unknown';
      handleTypes[type] = (handleTypes[type] ?? 0) + 1;
    }
    const handleBreakdown = Object.entries(handleTypes)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}:${v}`)
      .join(',');

    // Only log if something is interesting — skip quiet samples to avoid noise.
    // "interesting" = CPU > 5%, ELU > 0.3, handles > 10, or many active requests.
    const interesting =
      cpuPct > 5 ||
      elu.utilization > 0.3 ||
      handles.length > 10 ||
      requests.length > 2;

    if (interesting) {
      slog(
        'PROFILE-SAMPLE',
        `rss=${Math.round(mem.rss / 1048576)}MB heap=${Math.round(mem.heapUsed / 1048576)}/${Math.round(mem.heapTotal / 1048576)}MB | ` +
          `cpu=${cpuPct}% ELU=${elu.utilization.toFixed(2)} | ` +
          `handles=${handles.length}{${handleBreakdown}} reqs=${requests.length}`,
      );
    }
  };

  sampleTimer = setInterval(sample, 5_000);
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
