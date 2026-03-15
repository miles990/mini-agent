/**
 * Phase 0 Preprocessing Pipeline
 *
 * Runs 0.8B concurrent tasks BEFORE buildContext to compress context.
 * Three preprocessors:
 *   P0a: Message priority re-scoring (content-aware) — deferred (inbox already has priority)
 *   P0b: Perception section summarization (full output → 1-line summary)
 *   P0c: HEARTBEAT diff (full content → changes-only summary)
 *
 * Design: fail-open — if 0.8B fails, buildContext uses raw data as before.
 * Feature flag: preprocess (default on in autonomous mode).
 */

import fs from 'node:fs';
import path from 'node:path';
import { callLocalConcurrent } from './omlx-gate.js';
import type { LocalLLMTask } from './omlx-gate.js';
import { eventBus } from './event-bus.js';
import { perceptionStreams } from './perception-stream.js';

// =============================================================================
// Types
// =============================================================================

export interface Phase0Results {
  /** P0b: Perception section summaries (name → 1-line summary). Missing = use raw. */
  perceptionSummaries: Map<string, string>;
  /** P0c: HEARTBEAT diff summary. null = use full heartbeat. */
  heartbeatDiff: string | null;
  /** Total wall-clock time for Phase 0 */
  totalLatencyMs: number;
  /** Number of 0.8B tasks dispatched */
  taskCount: number;
}

// =============================================================================
// State
// =============================================================================

/** Snapshot of previous cycle's HEARTBEAT for diffing */
let lastHeartbeatSnapshot = '';

// =============================================================================
// P0b: Perception Summarization
// =============================================================================

/**
 * Build 0.8B tasks that summarize changed perception sections into 1-line each.
 * Only targets sections with >100 chars of output that have changed since last build.
 */
function buildPerceptionSummaryTasks(): LocalLLMTask[] {
  if (!perceptionStreams.isActive()) return [];

  const cachedResults = perceptionStreams.getCachedResults();
  const tasks: LocalLLMTask[] = [];

  for (const r of cachedResults) {
    // Skip unchanged sections (already compressed to "unchanged" line by buildContext)
    if (!perceptionStreams.hasChangedSinceLastBuild(r.name)) continue;
    // Skip tiny outputs — not worth summarizing
    if (!r.output || r.output.length < 100) continue;

    tasks.push({
      id: `perc:${r.name}`,
      prompt: `Summarize the key information in 1-2 sentences (max 60 words). If nothing notable, say "unchanged".\n\n${r.output.slice(0, 500)}`,
      maxTokens: 80,
      timeoutMs: 5_000,
    });
  }

  return tasks;
}

// =============================================================================
// P0c: HEARTBEAT Diff
// =============================================================================

/**
 * Build a 0.8B task to summarize HEARTBEAT changes since last cycle.
 * Returns null if no changes detected (pure logic diff).
 */
function buildHeartbeatDiffTask(currentContent: string): LocalLLMTask | null {
  // First cycle: store snapshot, no diff available
  if (!lastHeartbeatSnapshot) {
    lastHeartbeatSnapshot = currentContent;
    return null;
  }

  // No change: skip
  if (currentContent === lastHeartbeatSnapshot) {
    lastHeartbeatSnapshot = currentContent;
    return null;
  }

  // Simple line-level diff: find added/changed lines
  const oldLines = new Set(lastHeartbeatSnapshot.split('\n'));
  const added = currentContent.split('\n')
    .filter(l => !oldLines.has(l) && l.trim().length > 0)
    .slice(0, 15)
    .join('\n')
    .slice(0, 500);

  lastHeartbeatSnapshot = currentContent;

  // Trivial diff (whitespace-only changes, etc.)
  if (added.length < 20) return null;

  return {
    id: 'hb-diff',
    prompt: `What changed in this task list? Summarize in 1-3 sentences.\nChanges:\n${added}`,
    maxTokens: 120,
    timeoutMs: 5_000,
  };
}

// =============================================================================
// Main Orchestrator
// =============================================================================

/**
 * Run Phase 0 preprocessing pipeline.
 * Dispatches P0b + P0c tasks concurrently via 0.8B, returns results.
 * Fail-open: if 0.8B is down, returns empty results and buildContext uses raw data.
 */
export async function runPhase0(): Promise<Phase0Results> {
  const start = Date.now();
  const results: Phase0Results = {
    perceptionSummaries: new Map(),
    heartbeatDiff: null,
    totalLatencyMs: 0,
    taskCount: 0,
  };

  // Gather tasks from all preprocessors
  const tasks: LocalLLMTask[] = [];

  // P0b: Perception summarization
  const perceptionTasks = buildPerceptionSummaryTasks();
  tasks.push(...perceptionTasks);

  // P0c: HEARTBEAT diff
  try {
    const hbPath = path.join(process.cwd(), 'memory', 'HEARTBEAT.md');
    const hbContent = fs.readFileSync(hbPath, 'utf-8');
    const hbTask = buildHeartbeatDiffTask(hbContent);
    if (hbTask) tasks.push(hbTask);
  } catch { /* no heartbeat file — skip */ }

  // No tasks: return immediately (zero cost)
  if (tasks.length === 0) {
    results.totalLatencyMs = Date.now() - start;
    return results;
  }

  results.taskCount = tasks.length;

  // Run all tasks concurrently (sweet spot: 3 concurrent, benchmark: ~200ms)
  const llmResults = await callLocalConcurrent(tasks, 3);

  // Parse results
  for (const r of llmResults) {
    if (r.id.startsWith('perc:') && r.content) {
      const name = r.id.slice(5);
      const summary = r.content.trim();
      // Only use summary if it's meaningful (not "unchanged" and not too short)
      if (summary.toLowerCase() !== 'unchanged' && summary.length > 10) {
        results.perceptionSummaries.set(name, summary);
      }
    } else if (r.id === 'hb-diff' && r.content) {
      const diff = r.content.trim();
      if (diff.length > 10) {
        results.heartbeatDiff = diff;
      }
    }
  }

  results.totalLatencyMs = Date.now() - start;

  eventBus.emit('log:info', {
    message: `[preprocess] Phase 0 complete: ${tasks.length} tasks in ${results.totalLatencyMs}ms | `
      + `perception summaries: ${results.perceptionSummaries.size}/${perceptionTasks.length} | `
      + `heartbeat diff: ${results.heartbeatDiff ? 'yes' : 'no'}`,
  });

  return results;
}
