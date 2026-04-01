/**
 * Context Compaction (P1-5)
 *
 * Intelligently compresses large context using Haiku sideQuery,
 * preserving key information while reducing token count.
 *
 * Design: Claude Code uses 3 compression modes + 9-section summaries.
 * We use a simpler approach: Haiku summarizes the full context into
 * a structured compact form, keeping recent/actionable info verbatim.
 *
 * Integration: Called from agent.ts when focused mode context still
 * exceeds budget, BEFORE falling back to minimal mode.
 */

import { sideQuery } from './side-query.js';
import { eventBus } from './event-bus.js';

/**
 * Compact a context string to fit within a target budget.
 *
 * Uses Haiku to summarize while preserving:
 * - Current task/intent (most important)
 * - User messages (verbatim)
 * - Pending tasks and active decisions
 * - Recent errors and key technical details
 *
 * Returns compacted context, or null if compaction fails/unnecessary.
 */
export async function compactContext(
  context: string,
  targetChars: number,
): Promise<string | null> {
  // Don't compact if already close to target
  if (context.length <= targetChars * 1.1) return null;

  // Don't attempt if context is tiny (nothing to compact)
  if (context.length < 5000) return null;

  const reductionRatio = Math.round((1 - targetChars / context.length) * 100);

  const prompt = `You are compacting an AI agent's context to fit a token budget.
Current size: ${context.length} chars. Target: ${targetChars} chars (${reductionRatio}% reduction needed).

Rules:
1. PRESERVE VERBATIM: user messages, active tasks, current work, next steps, active decisions
2. SUMMARIZE: perception data, old activity logs, topic memory details, conversation history
3. DROP: redundant status checks, stale warnings, already-resolved items
4. Keep the same XML tag structure where possible (e.g., <heartbeat>, <memory-index>, <inner_notes>)
5. Most recent information is most valuable — summarize oldest content first
6. Output ONLY the compacted context, no commentary

Context to compact:

${context}`;

  const result = await sideQuery(prompt, {
    model: 'claude-haiku-4-5-20251001',
    timeout: 45_000, // Compaction processes more text than ranking
  });

  if (!result || result.length > targetChars * 1.2) {
    // Compaction failed or didn't reduce enough
    eventBus.emit('log:info', {
      tag: 'compact-context',
      msg: `failed: input=${context.length} target=${targetChars} output=${result?.length ?? 0}`,
    });
    return null;
  }

  eventBus.emit('log:info', {
    tag: 'compact-context',
    msg: `success: ${context.length} → ${result.length} chars (${Math.round((1 - result.length / context.length) * 100)}% reduction)`,
  });

  return result;
}
