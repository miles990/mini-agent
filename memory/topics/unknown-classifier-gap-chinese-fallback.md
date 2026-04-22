# UNKNOWN Classifier Gap: Chinese CLI Fallback Pattern

## Observation (2026-04-17 cycle #14)

After d68c9bc2 (classify memory_guard rejection as TIMEOUT, committed 05:31), today's error log shows:

- `TIMEOUT:memory_guard::callClaude` — 17 count, resolved=true ✅ (fix working)
- `UNKNOWN:no_diag::callClaude` — **8 new entries post-commit (11:49 to 13:48)**

The commit did NOT reduce the raw UNKNOWN count to zero. But that's not a failure — commit message explicitly predicted: "telemetry surfaces the remaining real classifier gaps instead of drowning them in UNKNOWN." **Prediction confirmed.**

## Mechanism Finding — What the 8 Remaining UNKNOWNs Are

All 8 entries share identical signature:

```
exit N/A, 703_374ms – 1_886_096ms, prompt 19_967–39_110 chars
error text: "處理訊息時發生錯誤。請稍後再試，或嘗試換個方式描述你的需求。"
lanes: ask / loop / foreground (not lane-specific)
```

Key properties:
1. **Chinese generic fallback string** — this is Claude CLI writing a localized "something went wrong" to stdout when upstream fails
2. **exit N/A** — process didn't cleanly terminate (no exit code captured)
3. **Very long duration (12–31 min)** — hit an internal CLI timeout before the error fired
4. **Prompt size is normal** (20–40k chars) — not an oversized-prompt issue
5. **Not memory_guard** — guard fires at 0-2ms, these run 700s+

Not matched by current classifier because:
- `msg` / `stderr` / `causeMsg` contain only the Chinese string
- `combined.toLowerCase()` doesn't help — no English keywords like "timeout", "econnrefused", "killed", "oom"
- Falls through to generic UNKNOWN fallback (agent.ts classifyError tail)

## Root Cause Hypothesis

Upstream Claude API / server-side failure. CLI receives error, wraps in localized Chinese fallback message, writes to stdout (not stderr), exits without exit code. The 12–30 min duration suggests CLI was stuck in retry or hit internal stream timeout before giving up.

## Proposed Fix (next cycle)

Add another early branch in `classifyError` (src/agent.ts, after memory_guard branch):

```ts
// Claude CLI Chinese generic fallback (upstream API failure surfaced via localized error string)
// 處理訊息時發生錯誤。請稍後再試 = "error processing message, please try again later"
// Signature: exit N/A + this string + long duration (stream timeout). Retryable but unlikely to
// succeed quickly — use longer backoff to avoid pounding a failing upstream.
if (msg.includes('處理訊息時發生錯誤') || msg.includes('請稍後再試，或嘗試換個方式描述')) {
  return { type: 'TIMEOUT', retryable: true, message: msg, modelGuidance: 'Claude CLI upstream failure (Chinese fallback). Likely API-side issue — consider reducing prompt size or deferring to next cycle rather than immediate retry.' };
}
```

Classifier should route these to TIMEOUT bucket `upstream_cli_fallback` or similar — distinguish from `real_timeout` (which is a genuine local timeout signal, not upstream).

## Verification

Apply fix → watch error log for 24h → expect `UNKNOWN:no_diag` count to drop toward zero, `TIMEOUT:upstream_cli_fallback` (or similar bucket) to appear with matching count. Commit ≠ done — the numbers must move.

## Related

- d68c9bc2 (first pass — memory_guard branch)
- topics/claude-cli-unknown-diagnosis.md (root cause history)
- topics/learned_timeout_memory_guard_signal.md (crystallized rule)
