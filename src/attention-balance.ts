/**
 * Attention Balance — internal mechanisms for preventing attention spiral.
 *
 * Three code-level mechanisms:
 * 1. External-facing progress detector (daily, auto-creates P0 task if 2+ days idle)
 * 2. Debugging thread cost-comparison (prompt injection when same thread > 5 cycles)
 * 3. Attention distribution stats (daily summary for self-awareness)
 */

import fs from 'node:fs';
import path from 'node:path';
import { slog } from './utils.js';
import { eventBus } from './event-bus.js';
import { queryMemoryIndexSync, createTask } from './memory-index.js';

// =============================================================================
// 1. External-Facing Progress Detector
// =============================================================================

const EXTERNAL_IDLE_THRESHOLD_DAYS = 2;
const EXTERNAL_P0_TASK_MARKER = '[attention-balance] external-facing progress stall';

const INTERNAL_FILENAME_PATTERN = /heartbeat|scheduler|dispatcher|memory-index|perception-cache|retry-lane|falsifier|cycle-tasks|omlx-gate|attention-balance|architecture-validation|heartbeat-md/i;

function getRecentExternalArtifacts(memoryDir: string, days: number): string[] {
  const cutoff = Date.now() - days * 86_400_000;
  const artifacts: string[] = [];

  const dirs = ['topics', 'drafts', 'reports'].map(d => path.join(memoryDir, d));
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      for (const file of fs.readdirSync(dir)) {
        if (file.startsWith('.')) continue;
        if (INTERNAL_FILENAME_PATTERN.test(file)) continue;
        const fp = path.join(dir, file);
        const stat = fs.statSync(fp);
        if (stat.mtimeMs >= cutoff) {
          artifacts.push(file);
        }
      }
    } catch { /* dir read error, skip */ }
  }

  return artifacts;
}

function hasExistingStallTask(memoryDir: string): boolean {
  const tasks = queryMemoryIndexSync(memoryDir, {
    type: ['task'],
    status: ['pending', 'in_progress'],
  });
  return tasks.some(t => (t.summary ?? '').includes(EXTERNAL_P0_TASK_MARKER));
}

export function checkExternalFacingProgress(memoryDir: string): { stalled: boolean; daysSinceExternal: number; artifacts: string[] } {
  const artifacts = getRecentExternalArtifacts(memoryDir, EXTERNAL_IDLE_THRESHOLD_DAYS);
  const stalled = artifacts.length === 0;

  if (stalled && !hasExistingStallTask(memoryDir)) {
    try {
      createTask(memoryDir, {
        title: EXTERNAL_P0_TASK_MARKER,
        priority: 0,
        origin: 'scheduler',
        status: 'pending',
      }).catch(() => {});
      slog('ATTN', `external-facing stall detected, P0 task created`);
      eventBus.emit('action:task', { event: 'external-stall', days: EXTERNAL_IDLE_THRESHOLD_DAYS });
    } catch (err) {
      slog('ATTN', `failed to create stall task: ${err}`);
    }
  }

  return { stalled, daysSinceExternal: stalled ? EXTERNAL_IDLE_THRESHOLD_DAYS : 0, artifacts };
}

// =============================================================================
// 2. Debugging Thread Cost-Comparison
// =============================================================================

const COST_COMPARISON_THRESHOLD = 5;

interface ThreadTracker {
  taskId: string;
  summary: string;
  consecutiveCycles: number;
  firstSeenTick: number;
}

let currentThread: ThreadTracker | null = null;

export function trackDebuggingThread(taskId: string | null, summary: string, tick: number): void {
  if (!taskId) {
    currentThread = null;
    return;
  }

  if (currentThread && currentThread.taskId === taskId) {
    currentThread.consecutiveCycles++;
  } else {
    currentThread = { taskId, summary, consecutiveCycles: 1, firstSeenTick: tick };
  }
}

export function getCostComparisonPrompt(memoryDir: string): string | null {
  if (!currentThread || currentThread.consecutiveCycles <= COST_COMPARISON_THRESHOLD) {
    return null;
  }

  const externalTasks = queryMemoryIndexSync(memoryDir, {
    type: ['task'],
    status: ['pending', 'in_progress'],
  }).filter(t => {
    const summary = (t.summary ?? '').toLowerCase();
    return !/(debug|fix|bug|error|investigate|追蹤|調查|falsifier)/.test(summary);
  });

  if (externalTasks.length === 0) return null;

  const topExternal = externalTasks[0];
  const topSummary = topExternal.summary?.slice(0, 80) ?? 'unknown';

  slog('ATTN', `debugging thread ${currentThread.taskId.slice(0, 12)} at ${currentThread.consecutiveCycles} cycles, injecting cost comparison`);

  return `\n<attention-balance>\n⚠️ 同一任務已連續 ${currentThread.consecutiveCycles} cycles（「${currentThread.summary.slice(0, 60)}」）。\n\n完成這個 cycle 後，下一個 cycle 前想一下：\n- Top external-facing task：「${topSummary}」\n- 切過去做那個，預計幾個 cycle 能產出一個 artifact？\n- 如果 < 2 cycles，下個 cycle 先做那個再回來。\n\n這不是要你中斷，是提醒你看一眼切換成本有多低。\n</attention-balance>\n`;
}

export function getThreadCycles(): number {
  return currentThread?.consecutiveCycles ?? 0;
}

// =============================================================================
// 3. Attention Distribution Stats
// =============================================================================

interface CycleRecord {
  tick: number;
  taskId: string | null;
  action: string;
  isExternal: boolean;
}

const recentCycles: CycleRecord[] = [];
const MAX_CYCLE_RECORDS = 200;

export function recordCycleAttention(tick: number, taskId: string | null, action: string, taskSummary: string): void {
  const isExternal = !/(debug|fix|bug|error|investigate|追蹤|調查|falsifier|heartbeat|scheduler|dispatcher|memory-index)/.test(taskSummary.toLowerCase());

  recentCycles.push({ tick, taskId, action, isExternal });
  if (recentCycles.length > MAX_CYCLE_RECORDS) {
    recentCycles.splice(0, recentCycles.length - MAX_CYCLE_RECORDS);
  }
}

export function getAttentionStats(lastNTicks: number = 50): { internal: number; external: number; discovery: number; total: number; summary: string } {
  const recent = recentCycles.slice(-lastNTicks);
  if (recent.length === 0) return { internal: 0, external: 0, discovery: 0, total: 0, summary: 'no data' };

  let internal = 0;
  let external = 0;
  let discovery = 0;

  for (const r of recent) {
    if (r.action === 'discovery' || r.action === 'idle') discovery++;
    else if (r.isExternal) external++;
    else internal++;
  }

  const total = recent.length;
  const pct = (n: number) => Math.round((n / total) * 100);
  const summary = `internal: ${pct(internal)}% | external: ${pct(external)}% | discovery: ${pct(discovery)}% (last ${total} cycles)`;

  if (pct(internal) >= 80) {
    slog('ATTN', `attention imbalance: ${summary}`);
  }

  return { internal, external, discovery, total, summary };
}

export function getAttentionSummaryForPrompt(lastNTicks: number = 50): string | null {
  const stats = getAttentionStats(lastNTicks);
  if (stats.total < 10) return null;

  const internalPct = Math.round((stats.internal / stats.total) * 100);
  if (internalPct < 70) return null;

  return `\n<attention-stats>\n📊 注意力分佈（最近 ${stats.total} cycles）：${stats.summary}\n⚠️ Internal 佔比偏高。下個 cycle 考慮做一個 external-facing 的事（學習、創作、打磨草稿）。\n</attention-stats>\n`;
}
