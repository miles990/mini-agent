/**
 * myelin integration — crystallization layer for mushi triage.
 *
 * Wraps the existing mushi HTTP service with myelin's rule engine.
 * Rule match → 0ms, $0. No match → falls back to mushi LLM.
 * All decisions logged + auto-crystallized over time.
 */

import { createMyelin } from 'myelinate';
import type { Myelin, MyelinStats } from 'myelinate';
import { slog } from './utils.js';

let _instance: Myelin | null = null;

/** Get or create the singleton myelin instance. */
export function getMyelinInstance(): Myelin {
  if (!_instance) {
    _instance = createMyelin({
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
      crystallize: { minOccurrences: 10, minConsistency: 0.95 },
    });
    slog('MYELIN', '🧠 Initialized — crystallization layer active');
  }
  return _instance;
}

/** Get myelin stats for observability. */
export function getMyelinStats(): MyelinStats {
  return getMyelinInstance().stats();
}
