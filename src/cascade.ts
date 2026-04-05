/**
 * Cascade Metrics — observability for multi-layer LLM routing.
 *
 * Records per-call metrics (latency, decision, fallback) to a JSONL file.
 * Use getCascadeFallbackRates() to read aggregated stats for routing decisions.
 */

import fs from 'node:fs';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { getMemoryStateDir } from './memory.js';
import { callLocalSmart } from './omlx-gate.js';
import { diagLog, slog } from './utils.js';

// =============================================================================
// Types
// =============================================================================

export interface CascadeMetric {
  ts: string;           // ISO timestamp
  layer: '0.8B' | '9B' | 'claude';
  task: string;         // 'chat-classify' | 'memory-query' | 'inner-update'
  latencyMs: number;
  decision: string;     // the classification result
  inputChars: number;
  fallback: boolean;    // whether it fell back to upper layer
}

// =============================================================================
// Recording
// =============================================================================

/**
 * Append a cascade metric to memory/state/cascade-metrics.jsonl.
 * Fire-and-forget — errors silently ignored to avoid disrupting the main loop.
 */
export function recordCascadeMetric(metric: CascadeMetric): void {
  try {
    const stateDir = getMemoryStateDir();
    const metricsPath = path.join(stateDir, 'cascade-metrics.jsonl');
    fs.appendFileSync(metricsPath, JSON.stringify(metric) + '\n');
  } catch { /* fire-and-forget */ }
}

// =============================================================================
// Reading — aggregate stats for routing decisions
// =============================================================================

/**
 * Compute fallback rates per task type from recent cascade metrics.
 * Returns a map of task → { calls, fallbackRate, avgLatencyMs }.
 * Consumers can use this to skip layers that consistently fail.
 */
export function getCascadeFallbackRates(maxAgeDays = 7): Map<string, { calls: number; fallbackRate: number; avgLatencyMs: number }> {
  const stats = new Map<string, { calls: number; fallbacks: number; totalLatency: number }>();
  try {
    const stateDir = getMemoryStateDir();
    const metricsPath = path.join(stateDir, 'cascade-metrics.jsonl');
    if (!existsSync(metricsPath)) return new Map();

    const cutoff = Date.now() - maxAgeDays * 86_400_000;
    const lines = readFileSync(metricsPath, 'utf-8').split('\n').filter(Boolean);

    for (const line of lines) {
      try {
        const m = JSON.parse(line) as CascadeMetric;
        if (new Date(m.ts).getTime() < cutoff) continue;
        const key = `${m.layer}:${m.task}`;
        const s = stats.get(key) ?? { calls: 0, fallbacks: 0, totalLatency: 0 };
        s.calls++;
        if (m.fallback) s.fallbacks++;
        s.totalLatency += m.latencyMs;
        stats.set(key, s);
      } catch { /* skip malformed lines */ }
    }
  } catch { /* file read failure — return empty */ }

  const result = new Map<string, { calls: number; fallbackRate: number; avgLatencyMs: number }>();
  for (const [key, s] of stats) {
    result.set(key, {
      calls: s.calls,
      fallbackRate: s.calls > 0 ? s.fallbacks / s.calls : 0,
      avgLatencyMs: s.calls > 0 ? Math.round(s.totalLatency / s.calls) : 0,
    });
  }
  return result;
}

// =============================================================================
// Task B: Working Memory Update (9B)
// =============================================================================

/**
 * Generate working memory update using 9B model.
 * Called when Claude didn't emit <kuro:inner> in its response.
 * Fail-open: on error, keeps existing inner-notes unchanged.
 *
 * @param memoryDir - path to the memory directory containing inner-notes.md
 * @param response - the full Claude response text (truncated internally)
 * @param tagsProcessed - list of tags that were processed this cycle
 */
export function generateWorkingMemory(
  memoryDir: string,
  response: string,
  tagsProcessed: string[],
): void {
  const start = Date.now();
  let fallback = false;

  try {
    // Read previous inner notes
    const innerPath = path.join(memoryDir, 'inner-notes.md');
    const prevInner = existsSync(innerPath)
      ? readFileSync(innerPath, 'utf-8').trim().slice(0, 500)
      : '(none)';

    // Extract decision + action from response (first ~500 chars covers both)
    const responsePreview = response.slice(0, 500);

    const prompt = `Update the AI assistant's working memory based on this cycle's activity.

Previous memory:
${prevInner}

This cycle's output:
${responsePreview}

Tags emitted: ${tagsProcessed.join(', ') || 'none'}

Write a concise working memory (3-5 lines) tracking:
1. Current task progress
2. Important context for next cycle
3. Atmosphere note (conversation tone and rhythm)
Keep insights from previous memory if still relevant. Drop completed items.
Output ONLY the working memory text, no explanation.`;

    const raw = callLocalSmart(prompt, 128, 15_000);
    const cleaned = raw.trim();

    if (cleaned.length >= 10 && cleaned.length < 2000) {
      // Atomic write
      const tmpPath = innerPath + '.tmp';
      fs.writeFileSync(tmpPath, cleaned, 'utf-8');
      fs.renameSync(tmpPath, innerPath);
      slog('CASCADE', `working memory updated (${cleaned.length} chars)`);
    } else {
      fallback = true;
    }
  } catch (err) {
    fallback = true;
    const reason = err instanceof Error ? err.message : String(err);
    slog('CASCADE', `9B working memory failed: ${reason.slice(0, 200)}`);
  }

  const latencyMs = Date.now() - start;
  recordCascadeMetric({
    ts: new Date().toISOString(),
    layer: '9B',
    task: 'inner-update',
    latencyMs,
    decision: fallback ? 'fallback-keep' : 'updated',
    inputChars: response.length,
    fallback,
  });
}
