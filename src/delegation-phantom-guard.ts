/**
 * Phantom-prompt classifier for delegation entry guards.
 *
 * Background: issue #141 (fail-ejkd7t shape) — `spawnDelegation` accepted a
 * 24-char imperative `Update src/agent.ts` that triggered 4× retries and 6
 * cycles of P0 stale pressure on 2026-05-06. Such prompts originate from
 * `<kuro:delegate>` parse anomalies and lack the `## Task:` envelope that
 * well-formed delegation prompts always carry.
 *
 * The spec for this predicate is pinned in
 * `tests/delegation-phantom-prompt.test.ts` (PR #143, merged) — see that
 * file for the falsifiable contract.
 *
 * This module ships the production helper. Wiring it into the delegation
 * entry path (`spawnDelegation` in src/delegation.ts) is a follow-up PR so
 * each step is independently reviewable.
 */

/**
 * Returns true when `prompt` matches the phantom-prompt shape:
 *   - empty / whitespace-only, OR
 *   - shorter than 80 chars AND lacks a `## Task:` envelope header.
 *
 * Pure predicate, no side effects. Safe to call at any dispatch boundary.
 */
export function isPhantomPrompt(prompt: string | null | undefined): boolean {
  if (!prompt) return true;
  const trimmed = prompt.trim();
  if (trimmed.length >= 80) return false;
  if (/^##\s+Task:/m.test(trimmed)) return false;
  return true;
}

/**
 * Classifier label used by error-pattern bookkeeping when a phantom prompt
 * is rejected at the gate. Stable string — downstream classifiers may key
 * on it.
 */
export const PHANTOM_PROMPT_REASON = 'phantom_prompt:short_imperative' as const;
