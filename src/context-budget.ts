/**
 * Agent OS Context Budget Manager — Progressive Context Triage (PCT)
 *
 * Manages context window as the agent's primary resource.
 * Not RAM (can't byte-address or swap), but a budget to allocate across sections.
 */

import { slog } from './utils.js';

// =============================================================================
// Types
// =============================================================================

export interface SectionInput {
  name: string;
  content: string;
  basePriority: number;    // 0 = critical (never trim), 1 = high, 2 = medium, 3 = low
  isTaskRelevant?: boolean; // boosted when matches current task
}

export interface SectionBudget {
  name: string;
  priority: number;
  originalTokens: number;
  allocatedTokens: number;
  trimmed: boolean;
}

export interface BudgetAllocation {
  sections: SectionBudget[];
  totalBudget: number;
  totalRequested: number;
  pressure: PressureLevel;
  trimmedSections: string[];
}

export type PressureLevel = 'normal' | 'warning' | 'critical';

export interface PressureStatus {
  level: PressureLevel;
  usage: number;
  budget: number;
  ratio: number;
  action: string;
}

// =============================================================================
// Config
// =============================================================================

const DEFAULT_BUDGET = 180_000;
const WARNING_THRESHOLD = 0.75;
const CRITICAL_THRESHOLD = 0.90;
const TASK_RELEVANCE_BOOST = 200;

// =============================================================================
// Budget Allocation
// =============================================================================

export function allocateBudget(
  sections: SectionInput[],
  totalBudget: number = DEFAULT_BUDGET,
): BudgetAllocation {
  const estimated = sections.map(s => ({
    ...s,
    tokens: estimateTokens(s.content),
  }));

  const totalRequested = estimated.reduce((sum, s) => sum + s.tokens, 0);
  const pressure = getPressureLevel(totalRequested, totalBudget);

  // No trimming needed
  if (totalRequested <= totalBudget) {
    return {
      sections: estimated.map(s => ({
        name: s.name,
        priority: s.basePriority,
        originalTokens: s.tokens,
        allocatedTokens: s.tokens,
        trimmed: false,
      })),
      totalBudget,
      totalRequested,
      pressure,
      trimmedSections: [],
    };
  }

  // Need to trim — sort by priority (higher number = lower priority = trim first)
  const sorted = [...estimated].sort((a, b) => {
    const pa = a.basePriority - (a.isTaskRelevant ? TASK_RELEVANCE_BOOST : 0);
    const pb = b.basePriority - (b.isTaskRelevant ? TASK_RELEVANCE_BOOST : 0);
    return pb - pa; // highest priority number first (trim candidates)
  });

  let remaining = totalBudget;
  const allocations = new Map<string, SectionBudget>();
  const trimmed: string[] = [];

  // First pass: allocate critical sections (priority 0) in full
  for (const s of estimated) {
    if (s.basePriority === 0) {
      allocations.set(s.name, {
        name: s.name,
        priority: s.basePriority,
        originalTokens: s.tokens,
        allocatedTokens: s.tokens,
        trimmed: false,
      });
      remaining -= s.tokens;
    }
  }

  // Second pass: trim from lowest priority until within budget
  for (const s of sorted) {
    if (s.basePriority === 0) continue; // already allocated
    if (remaining <= 0) {
      allocations.set(s.name, {
        name: s.name,
        priority: s.basePriority,
        originalTokens: s.tokens,
        allocatedTokens: 0,
        trimmed: true,
      });
      trimmed.push(s.name);
      continue;
    }

    if (s.tokens <= remaining) {
      allocations.set(s.name, {
        name: s.name,
        priority: s.basePriority,
        originalTokens: s.tokens,
        allocatedTokens: s.tokens,
        trimmed: false,
      });
      remaining -= s.tokens;
    } else {
      // Partial allocation — truncate content
      allocations.set(s.name, {
        name: s.name,
        priority: s.basePriority,
        originalTokens: s.tokens,
        allocatedTokens: remaining,
        trimmed: true,
      });
      trimmed.push(s.name);
      remaining = 0;
    }
  }

  const result = sections.map(s => allocations.get(s.name)!);

  if (trimmed.length > 0) {
    slog('BUDGET', `trimmed ${trimmed.length} sections: ${trimmed.join(', ')} (pressure=${pressure})`);
  }

  return {
    sections: result,
    totalBudget,
    totalRequested,
    pressure,
    trimmedSections: trimmed,
  };
}

// =============================================================================
// Pressure Monitor
// =============================================================================

export function pressureCheck(currentUsage: number, maxBudget: number = DEFAULT_BUDGET): PressureStatus {
  const ratio = currentUsage / maxBudget;
  const level = getPressureLevel(currentUsage, maxBudget);

  let action: string;
  switch (level) {
    case 'critical':
      action = 'force-trim low-priority sections, skip optional perception';
      break;
    case 'warning':
      action = 'trim P3 sections, compress history';
      break;
    default:
      action = 'none';
  }

  return { level, usage: currentUsage, budget: maxBudget, ratio, action };
}

export function trimContent(content: string, maxTokens: number): string {
  const estimated = estimateTokens(content);
  if (estimated <= maxTokens) return content;

  const ratio = maxTokens / estimated;
  const targetChars = Math.floor(content.length * ratio * 0.95);
  return content.slice(0, targetChars) + '\n\n[... trimmed by context budget manager]';
}

// =============================================================================
// Status
// =============================================================================

export function getBudgetStatus(allocation: BudgetAllocation): string {
  const pct = Math.round((allocation.totalRequested / allocation.totalBudget) * 100);
  return `ContextBudget: ${pct}% (${allocation.totalRequested}/${allocation.totalBudget} tokens, pressure=${allocation.pressure}, trimmed=${allocation.trimmedSections.length})`;
}

// =============================================================================
// Helpers
// =============================================================================

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

function getPressureLevel(usage: number, budget: number): PressureLevel {
  const ratio = usage / budget;
  if (ratio >= CRITICAL_THRESHOLD) return 'critical';
  if (ratio >= WARNING_THRESHOLD) return 'warning';
  return 'normal';
}
