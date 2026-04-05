/**
 * Active Context — Persistent Decision Injection Layer
 *
 * Inspired by Claude Code's inject-active-context.sh:
 * - Lightweight layer of "active decisions" injected into every cycle
 * - Separate from main memory — these are _current_ operating decisions
 * - Auto-expires based on TTL or explicit removal
 * - Two scopes: global (instance-level) and task-level
 *
 * Key difference from CC: Our active context is machine-managed.
 * CC relies on human writing active-context.md.
 * We auto-capture decisions from LLM output and expire them.
 *
 * Also provides dynamic context compression that goes beyond
 * the static model-tier pipeline — tracks actual token usage
 * and compresses when approaching limits.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getInstanceDir, getCurrentInstanceId } from './instance.js';
import { slog } from './utils.js';

// =============================================================================
// Types
// =============================================================================

export interface ActiveDecision {
  id: string;
  content: string;
  source: string;         // who/what created it (e.g., 'llm', 'user', 'system')
  scope: 'global' | 'task';
  taskId?: string;        // only for task-scoped decisions
  createdAt: string;
  expiresAt?: string;     // ISO timestamp, or undefined for no expiry
  priority: number;       // 0=highest, lower = more important
}

export interface ActiveContextState {
  decisions: ActiveDecision[];
  lastUpdated: string;
}

export interface ContextBudgetState {
  /** Current estimated context chars */
  currentChars: number;
  /** Budget limit from model tier */
  budgetChars: number;
  /** Utilization ratio (0-1) */
  utilization: number;
  /** Whether compression is needed */
  needsCompression: boolean;
  /** Sections sorted by priority (lowest = drop first) */
  sectionPriorities: SectionPriority[];
}

export interface SectionPriority {
  name: string;
  chars: number;
  priority: number;  // 0=highest (never drop), higher = drop first
  compressible: boolean;
}

// =============================================================================
// Active Context Manager
// =============================================================================

const ACTIVE_CONTEXT_FILE = 'active-context.json';

class ActiveContextManager {
  private state: ActiveContextState = { decisions: [], lastUpdated: new Date().toISOString() };
  private loaded = false;

  /** Load state from disk */
  load(): void {
    try {
      const dir = getInstanceDir(getCurrentInstanceId());
      const filePath = path.join(dir, ACTIVE_CONTEXT_FILE);
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8');
        this.state = JSON.parse(raw);
      }
    } catch {
      // Start fresh
    }
    this.loaded = true;
    this.pruneExpired();
  }

  /** Save state to disk */
  private save(): void {
    try {
      const dir = getInstanceDir(getCurrentInstanceId());
      const filePath = path.join(dir, ACTIVE_CONTEXT_FILE);
      this.state.lastUpdated = new Date().toISOString();
      fs.writeFileSync(filePath, JSON.stringify(this.state, null, 2), 'utf-8');
    } catch {
      // Silent fail — not critical
    }
  }

  /** Add a decision */
  addDecision(decision: Omit<ActiveDecision, 'id' | 'createdAt'>): string {
    if (!this.loaded) this.load();

    const id = `dec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const entry: ActiveDecision = {
      ...decision,
      id,
      createdAt: new Date().toISOString(),
    };

    // Dedup: don't add if very similar content exists
    const isDup = this.state.decisions.some(d =>
      d.scope === decision.scope &&
      d.content.toLowerCase() === decision.content.toLowerCase()
    );
    if (isDup) return id;

    this.state.decisions.push(entry);

    // Cap at 20 decisions
    if (this.state.decisions.length > 20) {
      // Remove oldest, lowest-priority first
      this.state.decisions.sort((a, b) => a.priority - b.priority);
      this.state.decisions = this.state.decisions.slice(0, 20);
    }

    this.save();
    return id;
  }

  /** Remove a decision */
  removeDecision(id: string): boolean {
    if (!this.loaded) this.load();
    const before = this.state.decisions.length;
    this.state.decisions = this.state.decisions.filter(d => d.id !== id);
    if (this.state.decisions.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  /** Remove decisions matching a pattern */
  removeByContent(pattern: string): number {
    if (!this.loaded) this.load();
    const regex = new RegExp(pattern, 'i');
    const before = this.state.decisions.length;
    this.state.decisions = this.state.decisions.filter(d => !regex.test(d.content));
    const removed = before - this.state.decisions.length;
    if (removed > 0) this.save();
    return removed;
  }

  /** Get all active decisions for current context */
  getDecisions(opts?: { scope?: 'global' | 'task'; taskId?: string }): ActiveDecision[] {
    if (!this.loaded) this.load();
    this.pruneExpired();

    let decisions = this.state.decisions;

    if (opts?.scope) {
      decisions = decisions.filter(d => d.scope === opts.scope);
    }
    if (opts?.taskId) {
      decisions = decisions.filter(d => d.scope === 'global' || d.taskId === opts.taskId);
    }

    return decisions.sort((a, b) => a.priority - b.priority);
  }

  /** Format for injection into context */
  formatForInjection(opts?: { scope?: 'global' | 'task'; taskId?: string }): string {
    const decisions = this.getDecisions(opts);
    if (decisions.length === 0) return '';

    const lines = decisions.map(d => {
      const scopeTag = d.scope === 'task' ? ` [${d.taskId}]` : '';
      return `- [${d.source}${scopeTag}] ${d.content}`;
    });

    return `<active-context>\n${lines.join('\n')}\n</active-context>`;
  }

  /** Prune expired decisions */
  private pruneExpired(): void {
    const now = new Date().toISOString();
    const before = this.state.decisions.length;
    this.state.decisions = this.state.decisions.filter(d =>
      !d.expiresAt || d.expiresAt > now
    );
    if (this.state.decisions.length !== before) {
      this.save();
    }
  }

  /** Get count */
  get size(): number {
    if (!this.loaded) this.load();
    return this.state.decisions.length;
  }
}

// Singleton
export const activeContext = new ActiveContextManager();

// =============================================================================
// Dynamic Context Budget Manager
// =============================================================================

/** Section priority configuration — lower number = higher priority (keep longer) */
const SECTION_PRIORITIES: Record<string, { priority: number; compressible: boolean }> = {
  // Never drop
  'soul': { priority: 0, compressible: false },
  'active-context': { priority: 1, compressible: false },
  'heartbeat': { priority: 2, compressible: false },
  'user-message': { priority: 3, compressible: false },
  'inbox': { priority: 4, compressible: false },

  // Compress before dropping
  'working-memory': { priority: 10, compressible: true },
  'recent-conversations': { priority: 11, compressible: true },
  'memory-index': { priority: 12, compressible: true },
  'delegation-results': { priority: 13, compressible: true },

  // Drop first
  'perception-data': { priority: 20, compressible: true },
  'activity-journal': { priority: 21, compressible: true },
  'cycle-history': { priority: 22, compressible: true },
  'skills': { priority: 30, compressible: true },
  'topic-memory': { priority: 31, compressible: true },
};

/**
 * Analyze context sections and compute budget state.
 * Used to decide whether compression is needed and what to compress.
 */
export function analyzeContextBudget(
  sections: Array<{ name: string; content: string }>,
  budgetChars: number,
): ContextBudgetState {
  const sectionPriorities: SectionPriority[] = sections.map(s => {
    const config = SECTION_PRIORITIES[s.name] ?? { priority: 50, compressible: true };
    return {
      name: s.name,
      chars: s.content.length,
      priority: config.priority,
      compressible: config.compressible,
    };
  });

  const currentChars = sectionPriorities.reduce((sum, s) => sum + s.chars, 0);
  const utilization = currentChars / budgetChars;

  // Sort by priority descending (highest number = drop first)
  sectionPriorities.sort((a, b) => b.priority - a.priority);

  return {
    currentChars,
    budgetChars,
    utilization,
    needsCompression: utilization > 0.85,
    sectionPriorities,
  };
}

/**
 * Apply progressive compression to context sections.
 *
 * Strategy (inspired by Claude Code but adapted for autonomous agent):
 * 1. utilization > 85%: Compress lowest-priority compressible sections
 * 2. utilization > 95%: Drop lowest-priority compressible sections
 * 3. utilization > 110%: Truncate remaining sections to fit
 *
 * Returns sections with compressed/dropped content.
 */
export function applyProgressiveCompression(
  sections: Array<{ name: string; content: string }>,
  budgetChars: number,
): Array<{ name: string; content: string; action?: 'kept' | 'compressed' | 'dropped' }> {
  const budget = analyzeContextBudget(sections, budgetChars);
  if (!budget.needsCompression) {
    return sections.map(s => ({ ...s, action: 'kept' as const }));
  }

  const result: Array<{ name: string; content: string; action: 'kept' | 'compressed' | 'dropped' }> = [];
  let remainingBudget = budgetChars;

  // Sort sections by priority (keep important ones first)
  const sorted = [...sections].sort((a, b) => {
    const pa = SECTION_PRIORITIES[a.name]?.priority ?? 50;
    const pb = SECTION_PRIORITIES[b.name]?.priority ?? 50;
    return pa - pb;
  });

  for (const section of sorted) {
    const config = SECTION_PRIORITIES[section.name] ?? { priority: 50, compressible: true };

    if (remainingBudget <= 0) {
      // No budget left — drop
      if (config.compressible) {
        result.push({ name: section.name, content: `[${section.name}: dropped — context budget exceeded]`, action: 'dropped' });
      } else {
        // Non-compressible: truncate hard
        result.push({ name: section.name, content: section.content.slice(0, 500) + '\n[... truncated]', action: 'compressed' });
        remainingBudget -= 500;
      }
      continue;
    }

    if (section.content.length <= remainingBudget) {
      // Fits within budget
      result.push({ name: section.name, content: section.content, action: 'kept' });
      remainingBudget -= section.content.length;
    } else if (config.compressible) {
      // Doesn't fit but is compressible — truncate to remaining budget
      const truncated = section.content.slice(0, Math.max(500, remainingBudget));
      result.push({
        name: section.name,
        content: truncated + `\n[... ${section.name}: truncated from ${section.content.length} to ${truncated.length} chars]`,
        action: 'compressed',
      });
      remainingBudget -= truncated.length;
    } else {
      // Not compressible — keep full, even if over budget
      result.push({ name: section.name, content: section.content, action: 'kept' });
      remainingBudget -= section.content.length;
    }
  }

  const totalKept = result.filter(r => r.action === 'kept').length;
  const totalCompressed = result.filter(r => r.action === 'compressed').length;
  const totalDropped = result.filter(r => r.action === 'dropped').length;

  if (totalCompressed > 0 || totalDropped > 0) {
    slog('CONTEXT-BUDGET', `Progressive compression: ${totalKept} kept, ${totalCompressed} compressed, ${totalDropped} dropped`);
  }

  return result;
}

/**
 * Extract decisions from LLM output.
 * Looks for patterns like:
 *   [Decision] ...
 *   [Active Decision] ...
 *   <kuro:decide> ... </kuro:decide>
 */
export function extractDecisions(llmOutput: string): Array<{ content: string; source: string }> {
  const decisions: Array<{ content: string; source: string }> = [];

  // Pattern 1: [Decision] ...
  const decisionLines = llmOutput.match(/\[Decision\]\s*(.+)/gi);
  if (decisionLines) {
    for (const line of decisionLines) {
      const content = line.replace(/\[Decision\]\s*/i, '').trim();
      if (content) decisions.push({ content, source: 'llm' });
    }
  }

  // Pattern 2: <kuro:decide>...</kuro:decide>
  const tagMatches = llmOutput.match(/<kuro:decide>([\s\S]*?)<\/kuro:decide>/g);
  if (tagMatches) {
    for (const match of tagMatches) {
      const content = match.replace(/<\/?kuro:decide>/g, '').trim();
      if (content) decisions.push({ content, source: 'llm' });
    }
  }

  return decisions;
}
