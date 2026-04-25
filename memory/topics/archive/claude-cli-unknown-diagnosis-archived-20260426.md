# Claude CLI UNKNOWN 145× — Mechanism Diagnosis

**Date**: 2026-04-17 (revised with data)
**Source**: dispatcher Recurring Errors section flagged "UNKNOWN 145×" + "TIMEOUT 3×"
**Status**: ✅ Root cause identified + patch shipped (`src/agent.ts` classifyError +8 lines) — **Verified 2026-04-17 08:22** (see below)

## Verification outcome (2026-04-17 cycle #37)

Post-fix log `~/.mini-agent/instances/03bbc29a/logs/error/2026-04-17.jsonl`:

```
Total errors today: 5
UNKNOWN: 0       (was 181/198 = 91% pre-fix)
TIMEOUT: 5       (all "System memory too low — deferring to prevent OOM")
exit N/A: 5      correctly routed to TIMEOUT via d68c9bc2 early branch
```

Classification fix works as designed. 100% of memory-guard rejects now surface accurate signal.

**New problem revealed**: Actual memory pressure is severe. Free memory snapshots across 5 events: `307MB / 90MB / 90MB / 109MB / 66MB`. System runs with <500MB headroom consistently — guard triggers repeatedly. Retries are useless because 3×90s backoff doesn't give memory time to recover when the underlying consumer is persistent.

## Constraint-level investigation (2026-04-17 cycle #3, same day)

**System state snapshot** (`ps -axo rss + vm_stat`):
- Pages free: 4878 × 16KB = **78MB free** (OS-wide, not just mini-agent)
- Top aggregate consumers: Chrome (user) **2.09GB**, Sublime 539MB, claude CLI **377MB**, Claude app 319MB, VSCode 273MB, node/mini-agent 209MB
- Active claude subprocess PID 10996 = **316MB alone** (single spawn)

**Race condition confirmed**: Both retry triples (00:00–00:03 and 00:13–00:19) stack traces show `at async Promise.all (index 0)`. Main loop's own claude call (316MB resident) blocks parallel delegate spawn — each delegate needs ~300MB, system has 66–309MB. Guard catches the race deterministically, retries hit the same condition.

**Why retry-after-90s fails**: The memory consumer isn't transient. It's Chrome (2GB, stable) + mini-agent's own in-flight claude subprocess. 90s backoff doesn't help unless main loop's claude call has finished — but the guard-rejecting call IS triggered by main loop's own parallel sub-delegate.

**Structural fix candidates**:
1. **Serialize claude CLI calls**: queue instead of `Promise.all` for delegates when memory < threshold. Accept latency cost.
2. **Shrink main loop claude footprint**: trim prompt size, use shorter `--max-turns`, close stale MCP sessions.
3. **Lower guard threshold** to 200MB: risky — actual OOM cascade killed subprocesses on 2026-04-16.
4. ✅ **Wait-inside-guard** (SHIPPED `f2ccb98e`, 2026-04-17): bounded poll (120s cap, 5s interval) before reject. Preserves safety valve, absorbs transient pressure.

**Next verification point** (next cycle with memory pressure):
- Scan `~/.mini-agent/instances/03bbc29a/logs/error/` for TIMEOUT `"System memory too low"` events
- Expected: count drops (most transient cases now wait-through). Log should show `"Memory recovered to XMB after Ys — proceeding"` lines
- If TIMEOUT still dominates after 120s waits → consumer is persistent (Chrome/main-loop claude not finishing), need option 2 (shrink footprint) or option 1 (serialize)

**Not to fix**: user's Chrome (2GB). That's Alex's browser with tabs — out of scope.

## Validation outcome — hypothesis falsified

Ran distribution analysis on `~/.mini-agent/instances/03bbc29a/logs/error/2026-04-16.jsonl` (198 errors, one day):

```
UNKNOWN: 181 (91%)      exit N/A: 175 (88%)
TIMEOUT:  17             exit 143:  14
                         exit 1:     9
```

Of 175 `exit N/A` UNKNOWN: **100% have 0–2ms duration**. These never spawned a CLI process. Original hypothesis (stderr classifier mixture) was wrong — the process didn't run to produce stderr.

**Real root cause**: `agent.ts:583-590` memory pressure guard (`freeMemMB < 500` → synchronous reject). The rejection message `"System memory too low (XMB free) — deferring to prevent OOM"` contains zero keywords that `classifyError` matches. Falls to line 172 generic fallback → type UNKNOWN with no signal. Self-inflicted mis-classification.

## Fix applied

`src/agent.ts:122` — added early branch matching `"system memory too low"` / `"deferring to prevent oom"`, classified as TIMEOUT (reuses existing isOomLikely=true → 90s backoff at line 1716, appropriate for memory pressure).

Expected effect: ~88% of UNKNOWN count moves into TIMEOUT bucket with accurate message, freeing telemetry to surface the remaining ~12% (real classifier gaps).

---

## Original hypothesis (preserved for thread trace)

## What UNKNOWN actually means

`agent.ts:108-172` — `classifyError()` is a waterfall. UNKNOWN is the **fallback bucket** when no specific pattern matches. Two distinct paths land here:

1. **Line 168** — stderr present, last line is 10–300 chars → `"Claude CLI 執行失敗: {lastLine}"` (has *some* signal)
2. **Line 172** — stderr empty, OR last line <10 or >300 chars → generic `"處理訊息時發生錯誤"` (zero signal)

Both get the same `type: 'UNKNOWN'` label. The counter doesn't distinguish them.

## Why the 145× is probably not one root cause

The classifier only inspects `stderr`, `msg`, `cause.message` (combined to lowercase string) and checks against a keyword list: `econnrefused`, `timeout`, `maxbuffer`, `rate limit`, etc. The disambiguation window (10–300 char stderr last line) is narrow. Things that collapse into UNKNOWN:

- **Silent exit**: Claude CLI exits non-zero with empty stderr (internal crash, assertion, early exit). Extremely common — I'd bet this is 60%+ of the 145.
- **Signal-only termination**: stderr is literally `"KO\n"` or similar (<10 chars) → line 172 path
- **Stack-trace dumps**: JS error with full trace >300 chars → line 172 path, zero info retained
- **Unknown-keyword timeouts**: if stderr says "request took too long" instead of `timeout`/`timed out` → not caught at line 146

None of these share a root cause, but all wear the "UNKNOWN" mask.

## Concrete patch proposal

Before the final fallback at `agent.ts:172`, add exit-code–based classification. The information is already gathered (`exitCode`, `signal`, `duration` are extracted at 112-115) — it's just not being used when stderr is unhelpful:

```ts
// Before the current final fallback (line 172):
if (exitCode === 1) {
  // Generic runtime error — surface stdout head for context
  const stdoutHead = (error as { stdout?: string })?.stdout?.slice(0, 200) ?? '';
  return { type: 'UNKNOWN', retryable: true,
    message: `Claude CLI exited 1 with ${stderr ? 'noisy' : 'empty'} stderr${stdoutHead ? `; stdout head: ${stdoutHead}` : ''}`,
    modelGuidance: 'CLI exited with generic error. Silent failure suggests internal crash. On retry, simplify the prompt significantly. If stdout has partial content, extract what is usable.' };
}
if (exitCode === 137) {
  return { type: 'TIMEOUT', retryable: true, message: 'Claude CLI killed (SIGKILL/137) — likely OOM.', modelGuidance: '...' };
}
if (exitCode === 130) {
  return { type: 'UNKNOWN', retryable: false, message: 'Claude CLI cancelled (SIGINT/130).', modelGuidance: 'User or parent cancelled. Do not retry.' };
}
// Truncate long stderr instead of discarding:
if (stderr.trim() && stderr.length > 300) {
  const tail = stderr.slice(-300);
  return { type: 'UNKNOWN', retryable: true, message: `Claude CLI error (stderr truncated): ...${tail}`, ... };
}
```

Also widen the line 167 window: accept stderr last line 5–500 chars instead of 10–300 — the current bounds reject useful signals.

## Validation before patching

I don't have direct access to the behavior_log SQLite to confirm which sub-pattern dominates. Before shipping a patch, run:

```sql
-- Assuming behavior_log has error rows with context='agent.callClaude'
SELECT
  CASE WHEN LENGTH(data_error) = 0 THEN 'empty'
       WHEN LENGTH(data_error) < 10 THEN 'short'
       WHEN LENGTH(data_error) > 300 THEN 'long'
       ELSE 'normal' END AS stderr_class,
  data_exit_code,
  COUNT(*) AS n
FROM behavior_log
WHERE event = 'error' AND data_context = 'callClaude'
GROUP BY stderr_class, data_exit_code
ORDER BY n DESC;
```

Two outcomes:
- **If one bucket dominates (>70%)** → single root cause after all, patch specifically
- **If 3+ buckets each have 20%+** → confirmed the 145× is mixture, patch widens classifier across all buckets

## Related

- `pulse.ts:677-717` is what aggregates these into the "recurring error pattern" task. Threshold `ERROR_PATTERN_THRESHOLD` is the counter — worth checking if threshold hasn't been raised as UNKNOWN count grew, meaning we're just compound-interesting a bucket
- TIMEOUT 3× — separate issue, likely real timeouts at agent.ts:146 (killed||timeout keyword). Low count so not the priority right now
- Bypass pattern: `classified.type === 'UNKNOWN'` at line 1764 triggers sense event — every UNKNOWN broadcasts "api unreachable" even when API was reachable and something else failed. Noisy signal.

## Next action when picked up

1. Run the SQL above against the behavior_log store (find it via `grep -r "queryErrorLogs" src/` → logger implementation)
2. If mixture confirmed: apply the patch above
3. Add a regression guard: after patch, UNKNOWN count should drop and be replaced by more specific classifications in the telemetry
- [2026-04-16] [2026-04-17] **Root cause pivot (hypothesis falsified by data)**: `claude CLI UNKNOWN 145-181×/day` 的 88% 不是 classifier 窗口問題，是 `agent.ts:583` memory pressure guard (`freeMemMB<500`) 的 reject message `"System memory too low..."` 沒命中 `classifyError` 任何 keyword → 落入 line 172 generic fallback. 修復: `agent.ts:122` 加早期匹配分支, 分類為 TIMEOUT (commit `d68c9bc2`, 8 行). 教訓: validate-before-patching 救了一次—照原 diagnosis 會修錯 82% 的 case. 下個驗證點: scan `~/.mini-agent/instances/03bbc29a/logs/error/2026-04-17.jsonl`, UNKNOWN count 應從 ~88% 跌到 <20%, TIMEOUT 相應上升.
