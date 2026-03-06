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
export const DEMOTION_THRESHOLD = 200;

/** Observation period after promotion (cycles) */
export const OBSERVATION_CYCLES = 50;

const STATE_FILE = 'context-optimizer.json';

/** Sections that must NEVER be demoted — core identity and critical perceptions */
const PROTECTED_SECTIONS = new Set([
  'environment',
  'soul',
  'inbox',
  'workspace',
  'telegram',
  'memory',
  'heartbeat',
  'recent_conversations',
  'next',
  'priority-focus',
  'self',
  'chat-room-recent',
]);

/** Keywords for conditional loading when a section is demoted */
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
  coach: ['coach', 'habit', 'behavior', 'pattern', 'streak'],
  commitments: ['commitment', 'promise', 'overdue', 'committed', 'pledge'],
  'background-completed': ['background', 'delegation', 'delegate', 'completed'],
  'recent-activity': ['activity', 'journal', 'recent'],
  threads: ['thread', 'thinking'],
  'working-memory': ['inner', 'working', 'scratch'],
  'inner-voice': ['impulse', 'voice', 'creative'],
  'conversation-threads': ['conversation', 'thread', 'pending', 'question'],
  'stale-tasks': ['stale', 'task', 'overdue'],
  'structural-health': ['structural', 'health', 'warning'],
  'decision-quality-warning': ['quality', 'decision', 'warning'],
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
// Singleton
// =============================================================================

let instance: ContextOptimizer | null = null;

export function getContextOptimizer(): ContextOptimizer {
  if (!instance) {
    instance = new ContextOptimizer();
  }
  return instance;
}

/** Reset singleton (for testing) */
export function resetContextOptimizer(): void {
  instance = null;
}
