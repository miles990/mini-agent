/**
 * Context Optimizer — Citation-Driven Auto-Demotion
 *
 * Tracks per-section citation data. After DEMOTION_THRESHOLD consecutive cycles
 * with zero citations, demotes an always-load section to conditional-load.
 * Auto-promotes back when cited, with OBSERVATION_CYCLES observation period.
 *
 * Integrates with:
 * - feedback-loops.ts: receives citation data each cycle
 * - memory.ts buildContext(): controls section loading via shouldLoad()
 */

import fs from 'node:fs';
import path from 'node:path';
import { readState, writeState } from './feedback-loops.js';
import { slog } from './utils.js';

// =============================================================================
// Types
// =============================================================================

export interface SectionDemotionState {
  /** Per-section consecutive zero-citation count */
  zeroCounts: Record<string, number>;
  /** Demoted sections with metadata */
  demoted: Record<string, { demotedAt: string; keywords: string[] }>;
  /** Sections in observation period after promotion */
  observation: Record<string, { promotedAt: string; remainingCycles: number }>;
  /** Total cycles processed */
  totalCycles: number;
}

// =============================================================================
// Constants
// =============================================================================

/** Consecutive zero-citation cycles before demotion */
export const DEMOTION_THRESHOLD = 50;

/** Observation period after promotion (cycles) */
export const OBSERVATION_CYCLES = 50;

const STATE_FILE = 'context-optimizer.json';

/** Sections that must NEVER be demoted — core identity and critical perceptions */
const PROTECTED_SECTIONS = new Set([
  'environment',
  'soul-core',
  'inbox',
  'workspace',
  'telegram',
  'memory',
  'heartbeat-active',
  'recent_conversations',
  'next',
  'priority-focus',
  'self',
  'chat-room-recent',
]);

/**
 * Keywords for conditional loading when a section is demoted.
 * Only sections actually gated by shouldLoad() in memory.ts are listed here.
 * Sections using only `!isLight` guard are NOT tracked (no effect if demoted).
 */
export const SECTION_KEYWORDS: Record<string, string[]> = {
  temporal: ['time', 'schedule', 'when', 'date', 'calendar'],
  capabilities: ['capability', 'tool', 'plugin', 'skill', 'mcp', 'provider', 'model'],
  process: ['process', 'memory', 'cpu', 'pid', 'debug', 'slow', 'performance', 'kill'],
  system: ['system', 'disk', 'cpu', 'resource', 'space', 'full'],
  logs: ['error', 'log', 'fail', 'bug', 'debug', 'crash'],
  network: ['port', 'network', 'service', 'connect', 'http', 'api', 'url'],
  config: ['config', 'setting', 'compose', 'cron', 'loop', 'skill'],
  activity: ['activity', 'behavior', 'action', 'recent'],
  trail: ['trail', 'decision', 'triage', 'scout'],
  achievements: ['achievement', 'milestone', 'ship', 'momentum'],
  pulse: ['pulse', 'habit', 'behavior', 'pattern', 'streak', 'action ratio', 'momentum', 'signal'],
  commitments: ['commitment', 'promise', 'overdue', 'committed', 'pledge'],
  'route-efficiency': ['route', 'efficiency', 'nutrient', 'slime', 'path', 'forge'],
  'stale-tasks': ['stale', 'overdue', 'stuck', 'abandon', 'backlog'],
  'recent-activity': ['activity', 'behavior', 'journal', 'recent action', 'what did'],
  'decision-quality-warning': ['quality', 'decision', 'score', 'depth', 'dq'],
  'structural-health': ['health', 'structural', 'report', 'upgrade', 'commit'],
  'problem-alignment': ['alignment', 'priority', 'problem', 'direction', 'focus', 'wrong question'],
  'myelin-framework': ['myelin', 'rule', 'crystallize', 'decision', 'triage', 'route', 'pattern'],
};

// =============================================================================
// ContextOptimizer
// =============================================================================

export class ContextOptimizer {
  private state: SectionDemotionState;

  constructor() {
    this.state = readState<SectionDemotionState>(STATE_FILE, {
      zeroCounts: {},
      demoted: {},
      observation: {},
      totalCycles: 0,
    });

    // Clean up zeroCounts for sections not in SECTION_KEYWORDS
    // (legacy entries that can't be properly demoted — no keywords = never loadable)
    for (const key of Object.keys(this.state.zeroCounts)) {
      if (!SECTION_KEYWORDS[key]) {
        delete this.state.zeroCounts[key];
      }
    }
  }

  /**
   * Record one cycle's citation data. Handles demotion, promotion, and observation.
   */
  recordCycle({ citedSections }: { citedSections: string[] }): void {
    this.state.totalCycles++;
    const citedSet = new Set(citedSections);

    // Track sections newly promoted this cycle (skip observation tick for them)
    const newlyPromoted = new Set<string>();

    // All known sections (from SECTION_KEYWORDS + already tracked)
    const allTracked = new Set([
      ...Object.keys(SECTION_KEYWORDS),
      ...Object.keys(this.state.zeroCounts),
    ]);

    for (const section of allTracked) {
      if (PROTECTED_SECTIONS.has(section)) continue;
      // Only track sections with defined keywords — demoting without keywords makes them permanently unreachable
      if (!SECTION_KEYWORDS[section]) continue;

      if (citedSet.has(section)) {
        // Section was cited — reset zero count
        this.state.zeroCounts[section] = 0;

        // If demoted, auto-promote with observation period
        if (this.state.demoted[section]) {
          delete this.state.demoted[section];
          this.state.observation[section] = {
            promotedAt: new Date().toISOString(),
            remainingCycles: OBSERVATION_CYCLES,
          };
          newlyPromoted.add(section);
          slog('CTX-OPT', `Auto-promoted: ${section} (cited while demoted → observation period)`);
        }
      } else {
        // Not cited — increment zero count
        this.state.zeroCounts[section] = (this.state.zeroCounts[section] ?? 0) + 1;

        // Check for demotion threshold
        if (
          !this.state.demoted[section] &&
          !this.state.observation[section] &&
          this.state.zeroCounts[section] >= DEMOTION_THRESHOLD
        ) {
          const keywords = SECTION_KEYWORDS[section] ?? [];
          this.state.demoted[section] = {
            demotedAt: new Date().toISOString(),
            keywords,
          };
          slog('CTX-OPT', `Auto-demoted: ${section} (${DEMOTION_THRESHOLD} consecutive zero-citation cycles)`);
        }
      }
    }

    // Tick observation periods (skip sections just promoted this cycle)
    for (const [section, obs] of Object.entries(this.state.observation)) {
      if (newlyPromoted.has(section)) continue;
      obs.remainingCycles--;

      if (obs.remainingCycles <= 0) {
        // Observation complete
        delete this.state.observation[section];
        // Zero count continues from where it is — will naturally accumulate
        // toward demotion again if section remains uncited
      }
    }
  }

  /** Check if a section is currently demoted */
  isDemoted(section: string): boolean {
    return section in this.state.demoted;
  }

  /** Check if a section is in observation period */
  isInObservation(section: string): boolean {
    return section in this.state.observation;
  }

  /** Get keywords for a demoted section (for conditional loading) */
  getLoadableKeywords(section: string): string[] | undefined {
    return this.state.demoted[section]?.keywords;
  }

  /** Get list of all currently demoted section names */
  getDemotedSections(): string[] {
    return Object.keys(this.state.demoted);
  }

  /** Persist state via writeState */
  save(): void {
    writeState(STATE_FILE, this.state);
  }

  /** Get current state for inspection */
  getState(): SectionDemotionState {
    return this.state;
  }
}

// =============================================================================
// Cold Storage — MEMORY.md entry migration
// =============================================================================

/**
 * Identify MEMORY.md entries older than threshold in non-protected sections.
 */
export function identifyColdEntries(content: string, maxAgeDays: number): string[] {
  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  const protectedSections = ['User Preferences', 'Important Facts', 'Important Decisions'];

  const lines = content.split('\n');
  const cold: string[] = [];
  let inProtected = false;

  for (const line of lines) {
    const sectionMatch = line.match(/^## (.+)/);
    if (sectionMatch) {
      inProtected = protectedSections.some(s => sectionMatch[1].includes(s));
      continue;
    }
    if (inProtected) continue;

    const dateMatch = line.match(/^- \[(\d{4}-\d{2}-\d{2})\]/);
    if (dateMatch) {
      const entryDate = new Date(dateMatch[1]).getTime();
      if (entryDate < cutoff) {
        cold.push(line);
      }
    }
  }

  return cold;
}

/**
 * Move cold entries from MEMORY.md to cold-storage.md.
 * Returns count of migrated entries.
 */
export function migrateToColdStorage(
  memoryDir: string,
  maxAgeDays = 30,
): { migrated: number } {
  const memoryPath = path.join(memoryDir, 'MEMORY.md');
  if (!fs.existsSync(memoryPath)) return { migrated: 0 };

  const content = fs.readFileSync(memoryPath, 'utf-8');
  const coldEntries = identifyColdEntries(content, maxAgeDays);

  if (coldEntries.length === 0) return { migrated: 0 };

  // Remove cold entries from MEMORY.md
  const coldSet = new Set(coldEntries);
  const updatedLines = content.split('\n').filter(line => !coldSet.has(line));
  fs.writeFileSync(memoryPath, updatedLines.join('\n'));

  // Append to cold-storage.md
  const coldPath = path.join(memoryDir, 'cold-storage.md');
  const date = new Date().toISOString().slice(0, 10);
  const header = fs.existsSync(coldPath) ? '' : '# Cold Storage\n\nEntries migrated from MEMORY.md (still searchable via FTS5).\n\n';
  const section = `\n## Migrated ${date}\n${coldEntries.join('\n')}\n`;
  fs.appendFileSync(coldPath, header + section);

  return { migrated: coldEntries.length };
}

// =============================================================================
// Display
// =============================================================================

/** Format context health for injection into buildContext */
export function formatContextHealth(): string | null {
  try {
    const opt = getContextOptimizer();
    const state = opt.getState();

    const demoted = opt.getDemotedSections();
    const observing = Object.entries(state.observation)
      .map(([name, obs]) => `${name}(${obs.remainingCycles} cycles left)`);

    const lines = [
      `Cycles tracked: ${state.totalCycles}`,
      `Demoted sections: ${demoted.length > 0 ? demoted.join(', ') : 'none'}`,
      `In observation: ${observing.length > 0 ? observing.join(', ') : 'none'}`,
    ];

    return lines.join('\n');
  } catch {
    return null;
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: ContextOptimizer | null = null;

export function getContextOptimizer(): ContextOptimizer {
  if (!instance) {
    instance = new ContextOptimizer();
  }
  return instance;
}

export function resetContextOptimizer(): void {
  instance = null;
}
