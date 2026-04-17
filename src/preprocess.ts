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

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { callLocalConcurrent } from './omlx-gate.js';
import type { LocalLLMTask } from './omlx-gate.js';
import { eventBus } from './event-bus.js';
import { perceptionStreams } from './perception-stream.js';

interface ChatMsg { id: string; from: string; text: string; replyTo?: string }

// =============================================================================
// Types
// =============================================================================

export interface Phase0Results {
  /** P0b: Perception section summaries (name → 1-line summary). Missing = use raw. */
  perceptionSummaries: Map<string, string>;
  /** P0c: HEARTBEAT diff summary. null = use full heartbeat. */
  heartbeatDiff: string | null;
  /** P0d: Conversation context summary (older messages compressed). null = use raw. */
  conversationSummary: string | null;
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

/** Cache: perception input hash → summary. Avoids re-running LLM on identical input. */
const perceptionSummaryCache = new Map<string, { inputHash: string; summary: string }>();

/**
 * Build 0.8B tasks that summarize changed perception sections into 1-line each.
 * Only targets sections with >100 chars of output that have changed since last build.
 * Skips sections whose input (first 500 chars) hasn't changed since last summary.
 */
function buildPerceptionSummaryTasks(): { tasks: LocalLLMTask[]; cached: Map<string, string> } {
  const cached = new Map<string, string>();
  if (!perceptionStreams.isActive()) return { tasks: [], cached };

  const cachedResults = perceptionStreams.getCachedResults();
  const tasks: LocalLLMTask[] = [];

  for (const r of cachedResults) {
    // Skip unchanged sections (already compressed to "unchanged" line by buildContext)
    if (!perceptionStreams.hasChangedSinceLastBuild(r.name)) continue;
    // Skip tiny outputs — not worth summarizing
    if (!r.output || r.output.length < 100) continue;

    const inputSlice = r.output.slice(0, 500);
    const inputHash = crypto.createHash('md5').update(inputSlice).digest('hex');

    // Check cache: if input hasn't changed, reuse previous summary (zero LLM cost)
    const prev = perceptionSummaryCache.get(r.name);
    if (prev && prev.inputHash === inputHash) {
      cached.set(r.name, prev.summary);
      continue;
    }

    tasks.push({
      id: `perc:${r.name}`,
      prompt: `Summarize the key information in 1-2 sentences (max 60 words). If nothing notable, say "unchanged".\n\n${inputSlice}`,
      maxTokens: 80,
      timeoutMs: 15_000, // F (2026-04-17): 5s→15s — startup observed avg latency 10s when oMLX saturated; 5s caused 0/12 success rate
    });
  }

  return { tasks, cached };
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
    timeoutMs: 15_000, // F (2026-04-17): aligned with perception timeout
  };
}

// =============================================================================
// P0d: Conversation Context Summarization
// =============================================================================

/**
 * Read today's Chat Room JSONL and build a 0.8B task to summarize older messages.
 * Recent 5 messages are kept verbatim by buildContext; this summarizes messages 6-20.
 * Returns null if not enough messages to summarize.
 */
function buildConversationSummaryTask(): LocalLLMTask | null {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const convPath = path.join(process.cwd(), 'memory', 'conversations', `${today}.jsonl`);
    if (!fs.existsSync(convPath)) return null;

    const raw = fs.readFileSync(convPath, 'utf-8');
    const msgs: ChatMsg[] = raw.split('\n')
      .filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter((m): m is ChatMsg => !!m?.id && !!m?.from && typeof m?.text === 'string');

    // Need at least 8 messages total (5 recent kept verbatim + 3+ to summarize)
    if (msgs.length < 8) return null;

    // Messages 6-20 from the end (the "older" portion)
    const recentCount = 5;
    const older = msgs.slice(Math.max(0, msgs.length - 20), msgs.length - recentCount);
    if (older.length < 3) return null;

    // Format older messages for 0.8B summarization (cap total input)
    const formatted = older.map(m => `${m.from}: ${m.text.slice(0, 200)}`).join('\n').slice(0, 1500);

    return {
      id: 'conv-summary',
      prompt: `以下是 Chat Room 最近的對話（較早的部分）。
請用 3-5 句話摘要：
1. 目前在討論什麼主題
2. 各方立場（Alex/Kuro/Claude Code）
3. 未解決的問題或待辦
4. 最後達成的共識（如果有）
保留人名和具體技術術語，不要泛化。

對話：
${formatted}`,
      maxTokens: 200,
      timeoutMs: 15_000, // F (2026-04-17): conv summary aligned
    };
  } catch { return null; }
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
    conversationSummary: null,
    totalLatencyMs: 0,
    taskCount: 0,
  };

  // Gather tasks from all preprocessors
  const tasks: LocalLLMTask[] = [];

  // P0b: Perception summarization (with input-hash cache — skip LLM for unchanged inputs)
  const { tasks: perceptionTasks, cached: cachedSummaries } = buildPerceptionSummaryTasks();
  tasks.push(...perceptionTasks);
  // Pre-populate results with cached summaries (zero LLM cost)
  for (const [name, summary] of cachedSummaries) {
    results.perceptionSummaries.set(name, summary);
  }

  // P0c: HEARTBEAT diff
  try {
    const hbPath = path.join(process.cwd(), 'memory', 'HEARTBEAT.md');
    const hbContent = fs.readFileSync(hbPath, 'utf-8');
    const hbTask = buildHeartbeatDiffTask(hbContent);
    if (hbTask) tasks.push(hbTask);
  } catch { /* no heartbeat file — skip */ }

  // P0d: Conversation context summarization
  const convTask = buildConversationSummaryTask();
  if (convTask) tasks.push(convTask);

  // No LLM tasks needed: return cached results immediately
  if (tasks.length === 0) {
    results.totalLatencyMs = Date.now() - start;
    return results;
  }

  results.taskCount = tasks.length;

  // F (2026-04-17): reverted 5→3. oMLX 9B (single-threaded server) saturated
  // at concurrency 5, causing 0/12 success rate during startup bursts.
  // I/O-bound argument was wrong — the bottleneck is oMLX server concurrency,
  // not network/disk. 3 keeps queue shallow, 15s timeout absorbs slow calls.
  // True fix = Option E (summarization worker in middleware) — tracked in proposal.
  const llmResults = await callLocalConcurrent(tasks, 3);

  // Parse results + update cache
  for (const r of llmResults) {
    if (r.id.startsWith('perc:') && r.content) {
      const name = r.id.slice(5);
      const summary = r.content.trim();
      if (summary.toLowerCase() !== 'unchanged' && summary.length > 10) {
        results.perceptionSummaries.set(name, summary);
        // Update cache for next cycle
        const inputSlice = perceptionStreams.getCachedResults().find(p => p.name === name)?.output?.slice(0, 500) ?? '';
        perceptionSummaryCache.set(name, {
          inputHash: crypto.createHash('md5').update(inputSlice).digest('hex'),
          summary,
        });
      }
    } else if (r.id === 'hb-diff' && r.content) {
      const diff = r.content.trim();
      if (diff.length > 10) {
        results.heartbeatDiff = diff;
      }
    } else if (r.id === 'conv-summary' && r.content) {
      const summary = r.content.trim();
      if (summary.length > 20) {
        results.conversationSummary = summary;
      }
    }
  }

  results.totalLatencyMs = Date.now() - start;

  eventBus.emit('log:info', {
    tag: 'preprocess', msg: `Phase 0 complete: ${tasks.length} tasks in ${results.totalLatencyMs}ms | `
      + `perception summaries: ${results.perceptionSummaries.size}/${perceptionTasks.length} | `
      + `heartbeat diff: ${results.heartbeatDiff ? 'yes' : 'no'} | `
      + `conversation summary: ${results.conversationSummary ? 'yes' : 'no'}`,
  });

  return results;
}
