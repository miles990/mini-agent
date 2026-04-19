# P1 hang_no_diag — mechanism (cycle #35 correction)

**Emission site**: `agent.ts:241` (classifyError fallthrough), NOT `feedback-loops.ts:151`.
`feedback-loops.ts:151` only *classifies* the subtype post-hoc by reading `dur=Xs` from the message.

## The real path

1. `callClaude` (agent.ts:1660) spawns Claude CLI subprocess.
2. Subprocess ends with ALL of:
   - `exitCode !== 143` (not SIGTERM — agent.ts:186 branch misses)
   - `exitCode === null` but `duration ≤ timeoutMs * 0.9` (agent.ts:193 branch misses)
   - no `signal`, or `signal` present but `killed === true` or `exitCode !== null` (agent.ts:197 misses)
   - no `killed` flag and no "timeout/timed out" keyword (agent.ts:200 misses)
   - empty `stderr.trim()` (agent.ts:221 misses)
3. Falls through to agent.ts:241 → `UNKNOWN "處理訊息時發生錯誤 [dur=Xs]"`.
4. `extractErrorSubtype` reads `dur>=600` with no `killed=true` and no `signal=` → returns `hang_no_diag`.

## What "hang" actually means here

Not a live hang — the process *already exited* by the time we see it. It ran 600s+, exited with an unclassified state (no stderr, likely exitCode=1 or null), and our classifier has no surface to distinguish *why*.

## Next mechanism questions (not symptoms)

- Where does the spawn close handler in agent.ts clear `killed`/`signal`/`exitCode` for mid-duration exits? (likely the 5-min `progressTimeoutMs` path — if it aborts cleanly, we may not propagate `killed=true`)
- Does the abortController path (agent.ts:1622-1626) only catch `AbortError` on the local-LLM branch? Claude CLI path may throw a different shape that loses `killed`.
- 14× today on 2026-04-19 — correlate timestamps with `progress` vs `hard` timeout fires.

## Cycle #34 was imprecise

It said "`feedback-loops.ts:151` emits hang_no_diag". No — that line *reads* `dur=(\d+)s` from an already-produced error message. The producer is the UNKNOWN fallback in classifyError.

## Do NOT do next cycle

- Don't bisect — this is a classification gap in error handling, not a regression.
- Don't revert anything — the path has been this way since classifyError was written.
- Don't rewrite it yet — understand the progressTimeout vs hardTimeout propagation first.
