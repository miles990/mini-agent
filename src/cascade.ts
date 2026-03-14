/**
 * Cascade Metrics — observability for multi-layer LLM routing.
 *
 * Records per-call metrics (latency, decision, fallback) to a JSONL file
 * for analysis and tuning of the cascade routing system.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getMemoryStateDir } from './memory.js';

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
