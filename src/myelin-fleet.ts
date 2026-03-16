/**
 * myelin-fleet — Unified myelin Fleet for mini-agent.
 *
 * Replaces 8 scattered singletons with a single Fleet managing all domains.
 * Dogfooding: mini-agent is myelin's primary validation ground.
 *
 * Domains:
 * - triage:   wake/skip/quick decisions (mushi HTTP fallback)
 * - learning: research/learning event classification
 * - routing:  task graph lane routing
 */

import { createMyelin, createFleet, logDecision } from 'myelinate';
import type { Myelin, MyelinStats, TriageResult, MyelinFleet, FleetStats } from 'myelinate';
import { slog } from './utils.js';
import type { TaskLane } from './task-graph.js';

// =============================================================================
// Types
// =============================================================================

export type LearningAction = 'deep-dive' | 'index-only' | 'connect' | 'defer';
export type RoutingAction = TaskLane | 'merge';

// =============================================================================
// Heuristic functions (pure, no side effects)
// =============================================================================

/** Triage LLM fallback: call mushi HTTP for wake/skip/quick. */
async function triageLLM(event: { type: string; source?: string; context?: Record<string, unknown> }) {
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
    return { action: result.action ?? 'wake', reason: result.reason ?? 'mushi-llm' };
  } catch {
    return { action: 'wake', reason: 'mushi offline, fail-open' };
  }
}

/** Learning LLM fallback: keyword-based classification. */
async function learningLLM(event: { type: string; source?: string; context?: Record<string, unknown> }) {
  const ctx = event.context ?? {};
  const content = String(ctx.content ?? '').toLowerCase();
  const category = String(ctx.category ?? '');
  const source = String(event.source ?? '');

  if (source === 'delegation-complete' && (ctx.type === 'learn' || ctx.type === 'research')) {
    return { action: 'connect', reason: 'delegation result — connect to existing knowledge' };
  }
  if (source === 'understand') {
    const refs = ctx.refs as string[] | undefined;
    if (refs && refs.length >= 2) {
      return { action: 'connect', reason: 'cross-domain understanding — connect refs' };
    }
    return { action: 'index-only', reason: 'single-domain understanding — index' };
  }
  if (source === 'direction-change') {
    return { action: 'deep-dive', reason: 'strategy shift — needs deep analysis' };
  }
  if (category === 'learning') {
    if (/arXiv|paper|論文|study|survey|benchmark/.test(content)) {
      return { action: 'deep-dive', reason: 'research source — deep analysis' };
    }
    if (/跨域|cross-.*pollinat|bridge|連結.*與/.test(content)) {
      return { action: 'connect', reason: 'cross-domain learning — connect' };
    }
    return { action: 'index-only', reason: 'standard learning — index' };
  }
  return { action: 'index-only', reason: 'no strong learning signal' };
}

/** Routing LLM fallback: rule-based lane assignment. */
async function routingLLM(event: { type: string; source?: string; context?: Record<string, unknown> }) {
  const ctx = event.context ?? {};
  const taskType = String(ctx.taskType ?? '');
  const complexity = String(ctx.complexity ?? 'medium');
  const textLength = Number(ctx.textLength ?? 0);
  const isTechnical = Boolean(ctx.isTechnical);
  const topicOverlap = Number(ctx.topicOverlap ?? 0);

  if (event.type === 'merge-check' && topicOverlap >= 2) {
    return { action: 'merge', reason: `${topicOverlap} shared topics — merge` };
  }
  if (['code', 'learn', 'research', 'create', 'review', 'shell'].includes(taskType)) {
    return { action: 'background', reason: `delegation type: ${taskType}` };
  }
  if (taskType === 'reply') {
    if (complexity === 'high' || isTechnical || textLength > 1000) {
      return { action: 'ooda', reason: 'complex reply needs deep context' };
    }
    return { action: 'foreground', reason: 'simple reply' };
  }
  return { action: 'ooda', reason: 'default routing' };
}

// =============================================================================
// Fleet singleton
// =============================================================================

let _fleet: MyelinFleet<string> | null = null;

function getFleet(): MyelinFleet<string> {
  if (!_fleet) {
    _fleet = createFleet<string>([
      {
        name: 'triage',
        instance: createMyelin<string>({
          llm: triageLLM,
          rulesPath: './memory/myelin-rules.json',
          logPath: './memory/myelin-decisions.jsonl',
          autoLog: true,
          crystallize: { minOccurrences: 10, minConsistency: 0.95 },
        }),
      },
      {
        name: 'learning',
        instance: createMyelin<string>({
          llm: learningLLM,
          rulesPath: './memory/myelin-learning-rules.json',
          logPath: './memory/myelin-learning-decisions.jsonl',
          autoLog: true,
          failOpenAction: 'index-only',
          crystallize: { minOccurrences: 5, minConsistency: 0.90 },
        }),
      },
      {
        name: 'routing',
        instance: createMyelin<string>({
          llm: routingLLM,
          rulesPath: './memory/myelin-routing-rules.json',
          logPath: './memory/myelin-routing-decisions.jsonl',
          failOpenAction: 'ooda',
          crystallize: { minOccurrences: 8, minConsistency: 0.90 },
        }),
      },
    ]);
    slog('MYELIN', 'Fleet initialized: triage + learning + routing');
  }
  return _fleet;
}

// =============================================================================
// Public API — drop-in replacements for myelin-integration.ts exports
// =============================================================================

const TRIAGE_LOG_PATH = './memory/myelin-decisions.jsonl';

/** Log a hard-rule bypass to triage decision log. Fire-and-forget. */
export function logTriageBypass(source: string, action: 'wake' | 'skip', reason: string): void {
  try {
    logDecision(
      TRIAGE_LOG_PATH,
      { type: source, source, context: {} },
      action,
      `hard-rule: ${reason}`,
      'rule' as const,
      0,
    );
  } catch { /* fire-and-forget */ }
}

/** Get the triage myelin instance (for mushi-client direct triage). */
export function getMyelinInstance(): Myelin<string> {
  return getFleet().get('triage')!;
}

/** Get triage stats. */
export function getMyelinStats(): MyelinStats {
  return getMyelinInstance().stats();
}

/** Get stats from all active domains. */
export function getCombinedMyelinStats(): { triage: MyelinStats; learning: MyelinStats; routing: MyelinStats } {
  const fleet = getFleet();
  return {
    triage: fleet.get('triage')!.stats(),
    learning: fleet.get('learning')!.stats(),
    routing: fleet.get('routing')!.stats(),
  };
}

/** Get fleet-wide aggregated stats. */
export function getFleetStats(): FleetStats {
  return getFleet().stats();
}

// =============================================================================
// Learning event processing
// =============================================================================

/**
 * Route a learning/research event through the learning myelin.
 * Called from dispatcher postProcess (remember, understand, direction-change tags).
 */
export async function triageLearningEvent(event: {
  source: string;
  topic?: string;
  content: string;
  category?: string;
  refs?: string[];
  tags?: string[];
  delegationType?: string;
}): Promise<TriageResult<string>> {
  const result = await getFleet().triageWith('learning', {
    type: event.source,
    source: event.source,
    context: {
      topic: event.topic ?? 'general',
      content: event.content.slice(0, 500),
      category: event.category ?? 'unknown',
      refs: event.refs,
      tags: event.tags,
      type: event.delegationType,
      hasRefs: (event.refs?.length ?? 0) > 0,
      refCount: event.refs?.length ?? 0,
      contentLength: event.content.length,
    },
  });

  // triageWith returns null only if member not found — 'learning' always exists
  const r = result!;
  const emoji = r.method === 'rule' ? '⚡' : '🧠';
  slog('MYELIN-LEARN', `${emoji} ${event.source}: "${event.content.slice(0, 60)}..." → ${r.action} (${r.latencyMs}ms ${r.method})`);
  return r;
}

// =============================================================================
// Routing
// =============================================================================

/**
 * Route a task through the routing myelin.
 * Called from loop.ts and dispatcher.ts for lane assignment.
 */
export async function triageRouting(event: {
  type: 'route' | 'merge-check';
  taskType: string;
  prompt: string;
  complexity?: 'low' | 'medium' | 'high';
  isTechnical?: boolean;
  topicOverlap?: number;
  topics?: string[];
}): Promise<TriageResult<string>> {
  const result = await getFleet().triageWith('routing', {
    type: event.type,
    source: event.taskType,
    context: {
      taskType: event.taskType,
      complexity: event.complexity ?? 'medium',
      textLength: event.prompt.length,
      isTechnical: event.isTechnical ?? false,
      topicOverlap: event.topicOverlap ?? 0,
      topicCount: event.topics?.length ?? 0,
      promptShort: event.prompt.slice(0, 200),
    },
  });

  const r = result!;
  const emoji = r.method === 'rule' ? '⚡' : '🧠';
  slog('MYELIN-ROUTE', `${emoji} ${event.type}/${event.taskType}: → ${r.action} (${r.latencyMs}ms ${r.method})`);
  return r;
}

// =============================================================================
// Distillation
// =============================================================================

let _lastDistillTime = 0;
const DISTILL_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Run distillation on all myelin instances if enough time has passed.
 * Called from OODA loop housekeeping.
 */
export async function maybeDistill(): Promise<boolean> {
  const now = Date.now();
  if (now - _lastDistillTime < DISTILL_INTERVAL_MS) return false;
  _lastDistillTime = now;

  try {
    // Fleet distills triage + learning + routing in one call
    const fleet = getFleet();
    fleet.distillAll();
    slog('MYELIN', `Fleet distill complete (${fleet.names().join(', ')})`);

    // Research crystallizer (separate — Phase 3 will fold into fleet)
    try {
      const { runResearchDistillation } = await import('./small-model-research.js');
      const researchResult = runResearchDistillation();
      slog('MYELIN-RESEARCH', `Research distill: ${researchResult.stats.ruleCount} rules, ${researchResult.stats.principleCount} principles, methodology: ${researchResult.hasMethodology ? 'active' : 'building'}`);
    } catch { /* research crystallizer is optional */ }

    return true;
  } catch (err) {
    slog('MYELIN', `Distill error: ${err instanceof Error ? err.message : 'unknown'}`);
    return false;
  }
}
