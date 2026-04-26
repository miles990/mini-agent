#!/usr/bin/env bun
/**
 * External watchdog for hung Kuro cycles.
 *
 * Polls /status every POLL_INTERVAL_MS. If the loop lane is busy with 0 tool calls
 * for longer than STUCK_THRESHOLD_MS, calls POST /loop/break to kill the hung cycle.
 * Runs as an independent process so it's immune to Node.js event-loop blocking.
 *
 * Usage:
 *   bun scripts/watchdog.ts
 *   PORT=3001 STUCK_THRESHOLD_MS=1800000 bun scripts/watchdog.ts
 */

const PORT = Number(process.env.PORT ?? 3001);
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? 60_000);   // 60s
const STUCK_THRESHOLD_MS = Number(process.env.STUCK_THRESHOLD_MS ?? 1_800_000); // 30 min
const BASE_URL = `http://localhost:${PORT}`;

let lastBreakAt = 0;
const MIN_BREAK_INTERVAL_MS = 5 * 60_000; // don't break more than once per 5 min

async function check(): Promise<void> {
  let status: Record<string, unknown>;
  try {
    const res = await fetch(`${BASE_URL}/status`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) { log(`/status returned ${res.status}`); return; }
    status = await res.json() as Record<string, unknown>;
  } catch (e) {
    log(`/status unreachable: ${e}`);
    return;
  }

  const loop = (status.claude as Record<string, unknown>)?.loop as Record<string, unknown> | undefined;
  if (!loop?.busy) return; // no active cycle

  const task = loop.task as Record<string, unknown> | undefined;
  const startedAt = task?.startedAt as string | undefined;
  const toolCalls = (task?.toolCalls as number | null) ?? 0;
  const cycleElapsedMs = loop.cycleElapsedMs as number | undefined
    ?? (startedAt ? Date.now() - new Date(startedAt).getTime() : 0);

  if (cycleElapsedMs < STUCK_THRESHOLD_MS) return; // not stuck yet
  if (toolCalls > 0) return; // making progress

  const now = Date.now();
  if (now - lastBreakAt < MIN_BREAK_INTERVAL_MS) {
    log(`cycle stuck (${Math.floor(cycleElapsedMs / 60_000)}min, toolCalls=${toolCalls}) — skip break (too soon since last break)`);
    return;
  }

  const lastText = (task?.lastText as string | null) ?? null;
  log(`STUCK CYCLE DETECTED: elapsed=${Math.floor(cycleElapsedMs / 60_000)}min, toolCalls=${toolCalls}, lastText=${lastText ? JSON.stringify(lastText.slice(0, 80)) : 'null'} — calling /loop/break`);
  try {
    const res = await fetch(`${BASE_URL}/loop/break`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    });
    lastBreakAt = now;
    log(`/loop/break response: ${res.status}`);
  } catch (e) {
    log(`/loop/break failed: ${e}`);
  }
}

function log(msg: string): void {
  console.log(`[watchdog ${new Date().toISOString()}] ${msg}`);
}

log(`started — port=${PORT}, poll=${POLL_INTERVAL_MS}ms, stuckThreshold=${STUCK_THRESHOLD_MS / 60_000}min`);

await check(); // immediate first check
setInterval(check, POLL_INTERVAL_MS);
