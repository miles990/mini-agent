/**
 * Cycle Nutrient Tracker — Unified Slime Mold Efficiency System
 *
 * Connects: trigger → perceptions consumed → action type → output
 * Records per-cycle data and computes efficiency metrics.
 *
 * This is the "chemical gradient" that tells the slime mold
 * which paths yield nutrients and which are wasted exploration.
 *
 * Fire-and-forget, uses existing state infrastructure.
 */

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { readState, writeState } from './feedback-loops.js';
import { getMemoryStateDir } from './memory.js';
import { slog } from './utils.js';
import path from 'node:path';

// =============================================================================
// Types
// =============================================================================

interface CycleRecord {
  ts: string;
  trigger: string;
  perceptionsInContext: string[];
  perceptionsCited: string[];
  outputTags: string[];
  isProductive: boolean;
  isVisible: boolean;
  delegationsSpawned: number;
  durationMs: number;
  contextChars: number;
}

interface TriggerStats {
  total: number;
  productive: number;
  visible: number;
  avgDurationMs: number;
}

interface PerceptionStats {
  included: number;
  cited: number;
  actionful: number; // cited AND in a productive cycle
}

interface NutrientState {
  cycleCount: number;
  lastReportAt: string | null;
  // Rolling aggregates (last 50 cycles)
  triggerStats: Record<string, TriggerStats>;
  perceptionStats: Record<string, PerceptionStats>;
  overallProductiveRate: number;
  overallVisibleRate: number;
}

export interface NutrientReport {
  totalCycles: number;
  productiveRate: number;
  visibleRate: number;
  topTriggers: Array<{ trigger: string; rate: number; total: number }>;
  wasteTriggers: Array<{ trigger: string; rate: number; total: number }>;
  topPerceptions: Array<{ name: string; citedRate: number; actionfulRate: number }>;
  wastePerceptions: Array<{ name: string; included: number; cited: number }>;
  recommendations: string[];
}

// =============================================================================
// Constants
// =============================================================================

const CYCLE_LOG = 'cycle-nutrient.jsonl';
const REPORT_INTERVAL = 20; // Recompute every 20 cycles
const ROLLING_WINDOW = 50;  // Look at last 50 cycles for stats

// Output tags that count as "visible" (Alex or the world sees it)
const VISIBLE_TAGS = new Set(['chat', 'show', 'done', 'summary']);
// Output tags that count as "productive" (something happened)
const PRODUCTIVE_TAGS = new Set(['chat', 'show', 'done', 'summary', 'remember', 'delegate', 'archive', 'impulse', 'task']);

// =============================================================================
// Recording
// =============================================================================

/**
 * Classify a cycle's output from ParsedTags-like data.
 * Call this at the end of each OODA cycle.
 */
export function recordCycleNutrient(params: {
  trigger: string;
  context: string | null;
  action: string | null;
  response: string;
  outputTags: string[];     // e.g. ['chat', 'remember', 'delegate']
  delegationsSpawned: number;
  durationMs: number;
}): void {
  try {
    const { trigger, context, action, response, outputTags, delegationsSpawned, durationMs } = params;

    // Extract perceptions present in context
    const perceptionsInContext: string[] = [];
    if (context) {
      for (const m of context.matchAll(/<(\S+?)[\s>][\s\S]*?<\/\1>/g)) {
        perceptionsInContext.push(m[1]);
      }
    }

    // Extract perceptions cited in action (same logic as feedback-loops Loop B)
    const perceptionsCited: string[] = [];
    const skipTags = new Set(['br', 'p', 'div', 'span', 'b', 'i', 'a', 'ul', 'li', 'ol']);
    if (action) {
      const contextSet = new Set(perceptionsInContext);
      for (const m of action.matchAll(/<(\w[\w-]+)>/g)) {
        if (!skipTags.has(m[1]) && contextSet.has(m[1]) && !perceptionsCited.includes(m[1])) {
          perceptionsCited.push(m[1]);
        }
      }
      // Also keyword match
      const actionLower = action.toLowerCase();
      for (const name of perceptionsInContext) {
        if (perceptionsCited.includes(name)) continue;
        const keyword = name.replace(/-/g, ' ');
        if (keyword.length > 3 && actionLower.includes(keyword)) {
          perceptionsCited.push(name);
        }
      }
    }

    const isVisible = outputTags.some(t => VISIBLE_TAGS.has(t));
    const isProductive = outputTags.some(t => PRODUCTIVE_TAGS.has(t));

    const record: CycleRecord = {
      ts: new Date().toISOString(),
      trigger: normalizeTrigger(trigger),
      perceptionsInContext,
      perceptionsCited,
      outputTags,
      isProductive,
      isVisible,
      delegationsSpawned,
      durationMs,
      contextChars: context?.length ?? 0,
    };

    // Append to JSONL log
    const logPath = path.join(getMemoryStateDir(), CYCLE_LOG);
    appendFileSync(logPath, JSON.stringify(record) + '\n', 'utf-8');

    // Update rolling stats
    updateStats(record);
  } catch {
    // fire-and-forget
  }
}

// =============================================================================
// Stats Aggregation
// =============================================================================

function normalizeTrigger(trigger: string): string {
  // Normalize trigger reasons to categories for aggregation
  if (trigger.startsWith('telegram-user')) return 'telegram-user';
  if (trigger.startsWith('room')) return 'room';
  if (trigger.startsWith('chat')) return 'chat';
  if (trigger.startsWith('cron')) return 'cron';
  if (trigger.startsWith('workspace')) return 'workspace';
  if (trigger.startsWith('heartbeat')) return 'heartbeat';
  if (trigger.startsWith('alert')) return 'alert';
  if (trigger.startsWith('mobile')) return 'mobile';
  return trigger.split(':')[0] || 'unknown';
}

function updateStats(record: CycleRecord): void {
  const state = readState<NutrientState>('cycle-nutrient-state.json', {
    cycleCount: 0,
    lastReportAt: null,
    triggerStats: {},
    perceptionStats: {},
    overallProductiveRate: 0,
    overallVisibleRate: 0,
  });

  state.cycleCount++;

  // Update trigger stats
  const trig = record.trigger;
  if (!state.triggerStats[trig]) {
    state.triggerStats[trig] = { total: 0, productive: 0, visible: 0, avgDurationMs: 0 };
  }
  const ts = state.triggerStats[trig];
  ts.avgDurationMs = Math.round((ts.avgDurationMs * ts.total + record.durationMs) / (ts.total + 1));
  ts.total++;
  if (record.isProductive) ts.productive++;
  if (record.isVisible) ts.visible++;

  // Update perception stats
  for (const name of record.perceptionsInContext) {
    if (!state.perceptionStats[name]) {
      state.perceptionStats[name] = { included: 0, cited: 0, actionful: 0 };
    }
    state.perceptionStats[name].included++;
  }
  for (const name of record.perceptionsCited) {
    if (state.perceptionStats[name]) {
      state.perceptionStats[name].cited++;
      if (record.isProductive) {
        state.perceptionStats[name].actionful++;
      }
    }
  }

  // Recompute overall rates every REPORT_INTERVAL cycles
  if (state.cycleCount % REPORT_INTERVAL === 0) {
    recomputeFromLog(state);
    state.lastReportAt = new Date().toISOString();
    slog('NUTRIENT', `Efficiency report: productive=${(state.overallProductiveRate * 100).toFixed(0)}%, visible=${(state.overallVisibleRate * 100).toFixed(0)}%`);
  }

  writeState('cycle-nutrient-state.json', state);
}

function recomputeFromLog(state: NutrientState): void {
  try {
    const logPath = path.join(getMemoryStateDir(), CYCLE_LOG);
    if (!existsSync(logPath)) return;

    const lines = readFileSync(logPath, 'utf-8').split('\n').filter(Boolean);
    const recent = lines.slice(-ROLLING_WINDOW);

    let productive = 0;
    let visible = 0;

    // Reset stats for fresh computation
    const triggerStats: Record<string, TriggerStats> = {};
    const perceptionStats: Record<string, PerceptionStats> = {};

    for (const line of recent) {
      try {
        const r = JSON.parse(line) as CycleRecord;

        if (r.isProductive) productive++;
        if (r.isVisible) visible++;

        // Trigger
        if (!triggerStats[r.trigger]) {
          triggerStats[r.trigger] = { total: 0, productive: 0, visible: 0, avgDurationMs: 0 };
        }
        const ts = triggerStats[r.trigger];
        ts.avgDurationMs = Math.round((ts.avgDurationMs * ts.total + r.durationMs) / (ts.total + 1));
        ts.total++;
        if (r.isProductive) ts.productive++;
        if (r.isVisible) ts.visible++;

        // Perceptions
        for (const name of r.perceptionsInContext) {
          if (!perceptionStats[name]) {
            perceptionStats[name] = { included: 0, cited: 0, actionful: 0 };
          }
          perceptionStats[name].included++;
        }
        for (const name of r.perceptionsCited) {
          if (perceptionStats[name]) {
            perceptionStats[name].cited++;
            if (r.isProductive) perceptionStats[name].actionful++;
          }
        }
      } catch { /* skip bad lines */ }
    }

    state.triggerStats = triggerStats;
    state.perceptionStats = perceptionStats;
    state.overallProductiveRate = recent.length > 0 ? productive / recent.length : 0;
    state.overallVisibleRate = recent.length > 0 ? visible / recent.length : 0;
  } catch {
    // best effort
  }
}

// =============================================================================
// Report — for context injection
// =============================================================================

/**
 * Generate a nutrient efficiency report for context injection.
 * Returns null if not enough data yet.
 */
export function getNutrientReport(): NutrientReport | null {
  try {
    const state = readState<NutrientState>('cycle-nutrient-state.json', {
      cycleCount: 0,
      lastReportAt: null,
      triggerStats: {},
      perceptionStats: {},
      overallProductiveRate: 0,
      overallVisibleRate: 0,
    });

    if (state.cycleCount < 10) return null; // Not enough data

    // Rank triggers by productive rate
    const triggers = Object.entries(state.triggerStats)
      .filter(([, s]) => s.total >= 3) // Need minimum sample
      .map(([trigger, s]) => ({
        trigger,
        rate: s.total > 0 ? s.productive / s.total : 0,
        total: s.total,
      }))
      .sort((a, b) => b.rate - a.rate);

    const topTriggers = triggers.filter(t => t.rate >= 0.5);
    const wasteTriggers = triggers.filter(t => t.rate < 0.3 && t.total >= 5);

    // Rank perceptions by actionful rate
    const perceptions = Object.entries(state.perceptionStats)
      .filter(([, s]) => s.included >= 5)
      .map(([name, s]) => ({
        name,
        citedRate: s.included > 0 ? s.cited / s.included : 0,
        actionfulRate: s.included > 0 ? s.actionful / s.included : 0,
        included: s.included,
        cited: s.cited,
      }))
      .sort((a, b) => b.actionfulRate - a.actionfulRate);

    const topPerceptions = perceptions.filter(p => p.citedRate >= 0.3);
    const wastePerceptions = perceptions.filter(p => p.citedRate < 0.05 && p.included >= 10);

    // Generate recommendations
    const recommendations: string[] = [];

    for (const wt of wasteTriggers) {
      recommendations.push(
        `${wt.trigger}: ${wt.total} cycles, ${Math.round(wt.rate * 100)}% productive → mushi should skip more`,
      );
    }

    for (const wp of wastePerceptions) {
      recommendations.push(
        `${wp.name}: included ${wp.included}×, cited ${wp.cited}× → slow down or remove`,
      );
    }

    if (state.overallProductiveRate < 0.4) {
      recommendations.push(
        `Overall productive rate ${Math.round(state.overallProductiveRate * 100)}% — too many empty cycles`,
      );
    }

    return {
      totalCycles: state.cycleCount,
      productiveRate: Number(state.overallProductiveRate.toFixed(3)),
      visibleRate: Number(state.overallVisibleRate.toFixed(3)),
      topTriggers,
      wasteTriggers,
      topPerceptions: topPerceptions.map(p => ({
        name: p.name,
        citedRate: Number(p.citedRate.toFixed(3)),
        actionfulRate: Number(p.actionfulRate.toFixed(3)),
      })),
      wastePerceptions: wastePerceptions.map(p => ({
        name: p.name,
        included: p.included,
        cited: p.cited,
      })),
      recommendations,
    };
  } catch {
    return null;
  }
}

/**
 * Format report as compact context section for injection.
 */
export function formatNutrientContext(): string | null {
  const report = getNutrientReport();
  if (!report) return null;

  const lines: string[] = [];
  lines.push(`Cycles: ${report.totalCycles} | Productive: ${Math.round(report.productiveRate * 100)}% | Visible: ${Math.round(report.visibleRate * 100)}%`);

  if (report.topTriggers.length > 0) {
    const top = report.topTriggers.slice(0, 3)
      .map(t => `${t.trigger}(${Math.round(t.rate * 100)}%)`)
      .join(', ');
    lines.push(`Top triggers: ${top}`);
  }

  if (report.wasteTriggers.length > 0) {
    const waste = report.wasteTriggers.slice(0, 3)
      .map(t => `${t.trigger}(${t.total}cycles,${Math.round(t.rate * 100)}%productive)`)
      .join(', ');
    lines.push(`Waste: ${waste}`);
  }

  if (report.wastePerceptions.length > 0) {
    const wp = report.wastePerceptions.slice(0, 3)
      .map(p => `${p.name}(${p.included}incl,${p.cited}cited)`)
      .join(', ');
    lines.push(`Prune: ${wp}`);
  }

  if (report.recommendations.length > 0) {
    lines.push(`Hints: ${report.recommendations.slice(0, 2).join('; ')}`);
  }

  return lines.join('\n');
}
