/**
 * myelin integration — crystallization layers for mini-agent.
 *
 * Two myelin instances:
 * 1. Triage myelin — wraps mushi HTTP with rule engine for wake/skip/quick decisions.
 *    Rule match → 0ms, $0. No match → falls back to mushi LLM.
 * 2. Learning myelin — crystallizes learning/research patterns.
 *    Records what topics get studied, what actions follow understanding events,
 *    and crystallizes stable patterns into zero-cost rules.
 *
 * All decisions logged + auto-crystallized over time.
 */

import { createMyelin } from 'myelinate';
import type { Myelin, MyelinStats, TriageResult } from 'myelinate';
import { slog } from './utils.js';
import { runResearchDistillation } from './small-model-research.js';

// =============================================================================
// Instance 1: Triage (existing — wake/skip/quick)
// =============================================================================

let _triageInstance: Myelin | null = null;

/** Get or create the singleton triage myelin instance. */
export function getMyelinInstance(): Myelin {
  if (!_triageInstance) {
    _triageInstance = createMyelin({
      llm: async (event) => {
        // Fallback: call existing mushi HTTP service for LLM decisions
        try {
          const res = await fetch('http://localhost:3000/api/triage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              trigger: event.type,
              source: event.source ?? event.type,
              metadata: event.context ?? {},
            }),
            signal: AbortSignal.timeout(3000),
          });
          if (!res.ok) throw new Error(`mushi HTTP ${res.status}`);
          const result = await res.json() as { action?: string; reason?: string };
          const action = (result.action ?? 'wake') as 'wake' | 'skip' | 'quick';
          return { action, reason: result.reason ?? 'mushi-llm' };
        } catch {
          return { action: 'wake' as const, reason: 'mushi offline, fail-open' };
        }
      },
      rulesPath: './memory/myelin-rules.json',
      logPath: './memory/myelin-decisions.jsonl',
      autoLog: true,
      crystallize: { minOccurrences: 10, minConsistency: 0.95 },
    });
    slog('MYELIN', 'Initialized triage layer — crystallization active');
  }
  return _triageInstance;
}

/** Get triage myelin stats for observability. */
export function getMyelinStats(): MyelinStats {
  return getMyelinInstance().stats();
}

// =============================================================================
// Instance 2: Learning/Research Crystallization
// =============================================================================

/**
 * Learning actions — what to do with a learning/research event.
 *
 * - 'deep-dive'  : worth a full LLM cycle or delegation (novel, high-value)
 * - 'index-only' : just record to memory, no further action needed (routine/familiar)
 * - 'connect'    : link to existing knowledge, no new research needed
 * - 'defer'      : low priority now, queue for later
 */
export type LearningAction = 'deep-dive' | 'index-only' | 'connect' | 'defer';

let _learningInstance: Myelin<LearningAction> | null = null;

/** Get or create the learning/research myelin instance. */
export function getLearningMyelin(): Myelin<LearningAction> {
  if (!_learningInstance) {
    _learningInstance = createMyelin<LearningAction>({
      llm: async (event) => {
        // Default heuristic when no LLM available:
        // Use simple keyword-based classification as the "LLM" fallback.
        // Over time, myelin will crystallize these patterns into rules
        // and this function will be called less and less.
        const ctx = event.context ?? {};
        const topic = String(ctx.topic ?? '').toLowerCase();
        const content = String(ctx.content ?? '').toLowerCase();
        const category = String(ctx.category ?? '');
        const source = String(event.source ?? '');

        // Research delegation results are always worth connecting
        if (source === 'delegation-complete' && (ctx.type === 'learn' || ctx.type === 'research')) {
          return { action: 'connect', reason: 'delegation result — connect to existing knowledge' };
        }

        // Understanding events from explicit <kuro:understand> tags
        if (source === 'understand') {
          // If it has cross-domain refs, it's connection-worthy
          const refs = ctx.refs as string[] | undefined;
          if (refs && refs.length >= 2) {
            return { action: 'connect', reason: 'cross-domain understanding — connect refs' };
          }
          return { action: 'index-only', reason: 'single-domain understanding — index' };
        }

        // Direction changes are always worth a deep-dive
        if (source === 'direction-change') {
          return { action: 'deep-dive', reason: 'strategy shift — needs deep analysis' };
        }

        // Learning memories — classify by pattern density
        if (category === 'learning') {
          // Check for research indicators
          const hasResearchMarkers = /arXiv|paper|論文|study|survey|benchmark/.test(content);
          const hasCrossRef = /跨域|cross-.*pollinat|bridge|連結.*與/.test(content);

          if (hasResearchMarkers) {
            return { action: 'deep-dive', reason: 'research source — deep analysis' };
          }
          if (hasCrossRef) {
            return { action: 'connect', reason: 'cross-domain learning — connect' };
          }
          return { action: 'index-only', reason: 'standard learning — index' };
        }

        // Default: just index
        return { action: 'index-only', reason: 'no strong learning signal' };
      },
      rulesPath: './memory/myelin-learning-rules.json',
      logPath: './memory/myelin-learning-decisions.jsonl',
      autoLog: true,
      failOpenAction: 'index-only' as LearningAction,
      crystallize: {
        minOccurrences: 5,    // Learning patterns stabilize faster
        minConsistency: 0.90, // Slightly lower threshold — learning is more variable
      },
    });
    slog('MYELIN', 'Initialized learning layer — research crystallization active');
  }
  return _learningInstance;
}

/** Get learning myelin stats. */
export function getLearningMyelinStats(): MyelinStats {
  return getLearningMyelin().stats();
}

// =============================================================================
// Learning Event Processing
// =============================================================================

/**
 * Route a learning/research event through the learning myelin.
 * Returns the action decision — caller decides what to do with it.
 *
 * This is the main integration point. Called from:
 * - dispatcher postProcess (remember tags with 'learning' category)
 * - dispatcher postProcess (understand tags)
 * - dispatcher postProcess (direction-change tags)
 * - delegation complete handler (learn/research type tasks)
 */
export async function triageLearningEvent(event: {
  source: string;
  topic?: string;
  content: string;
  category?: string;
  refs?: string[];
  tags?: string[];
  delegationType?: string;
}): Promise<TriageResult<LearningAction>> {
  const myelin = getLearningMyelin();

  const result = await myelin.triage({
    type: event.source,
    source: event.source,
    context: {
      topic: event.topic ?? 'general',
      content: event.content.slice(0, 500), // Cap for rule matching
      category: event.category ?? 'unknown',
      refs: event.refs,
      tags: event.tags,
      type: event.delegationType,
      hasRefs: (event.refs?.length ?? 0) > 0,
      refCount: event.refs?.length ?? 0,
      contentLength: event.content.length,
    },
  });

  const emoji = result.method === 'rule' ? '⚡' : '🧠';
  slog('MYELIN-LEARN', `${emoji} ${event.source}: "${event.content.slice(0, 60)}..." → ${result.action} (${result.latencyMs}ms ${result.method})`);

  return result;
}

// =============================================================================
// Distillation — periodic crystallization of learning patterns
// =============================================================================

let _lastDistillTime = 0;
const DISTILL_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Run distillation on both myelin instances if enough time has passed.
 * Call this from the OODA loop's housekeeping phase.
 * Returns true if distillation ran.
 */
export async function maybeDistill(): Promise<boolean> {
  const now = Date.now();
  if (now - _lastDistillTime < DISTILL_INTERVAL_MS) return false;
  _lastDistillTime = now;

  try {
    // Distill triage myelin
    const triageMyelin = getMyelinInstance();
    const triageResult = triageMyelin.distill();
    slog('MYELIN', `Triage distill: ${triageResult.rules.length} rules, ${triageResult.templates.length} templates`);

    // Distill learning myelin
    const learningMyelin = getLearningMyelin();
    const learningResult = learningMyelin.distill();
    slog('MYELIN-LEARN', `Learning distill: ${learningResult.rules.length} rules, ${learningResult.templates.length} templates`);

    // Distill research crystallizer (three-layer: rules → templates → methodology)
    try {
      const researchResult = runResearchDistillation();
      slog('MYELIN-RESEARCH', `Research distill: ${researchResult.stats.ruleCount} rules, ${researchResult.stats.principleCount} principles, methodology: ${researchResult.hasMethodology ? 'active' : 'building'}`);
    } catch { /* research crystallizer is optional */ }

    return true;
  } catch (err) {
    slog('MYELIN', `Distill error: ${err instanceof Error ? err.message : 'unknown'}`);
    return false;
  }
}

/**
 * Get combined stats from both myelin instances.
 * Useful for observability dashboards.
 */
export function getCombinedMyelinStats(): { triage: MyelinStats; learning: MyelinStats } {
  return {
    triage: getMyelinInstance().stats(),
    learning: getLearningMyelin().stats(),
  };
}
