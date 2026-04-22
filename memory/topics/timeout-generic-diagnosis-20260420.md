# TIMEOUT:generic::callClaude — Diagnosis 2026-04-20

**Status**: Phase 1-3 done (systematic-debugging), Phase 4 proposal pending Alex review.

## Evidence

4 entries today (`~/.mini-agent/instances/03bbc29a/logs/error/2026-04-20.jsonl`), all loop lane:

| # | attempt | dur (this) | dur (total) | prompt chars |
|---|---------|-----------|-------------|--------------|
| 1 | 1/3 | 1075s | 1075s | 28286 |
| 2 | 2/3 | 952s  | 2057s | 33544 |
| 3 | 3/3 | 513s  | 2631s | 33543 |
| 4 | 1/3 | 1016s | 1016s | 28160 |

Message pattern (identical for all 4):
> `claude CLI TIMEOUT (exit N/A, Xms this attempt, ...): CLI 靜默中斷（exit undefined，Ys 無輸出）。可能 API session 中途失效或 context 靜默溢位。`

## Root cause (labeling layer)

`agent.ts:220-227` silent_exit branch (shipped 2026-04-19 `3039f4a3`) produces the message above. `feedback-loops.ts:119-155 extractErrorSubtype` has keywords for every prior bucket (memory_guard / econnrefused / sigterm_* / signal_killed / oom / real_timeout / max_turns / middleware_timeout / *_no_diag) but **no match for "靜默中斷" or "silent"**. All 4 fall through to `return 'generic'` at line 154.

**This is an incomplete ship.** Commit `3039f4a3` added the classifier branch in `agent.ts` but did not add the matching keyword in `extractErrorSubtype`. The `silent_exit` bucket name is used in the commit message but does not exist anywhere in the subtype extractor.

## Root cause (deeper — mechanism)

Entries #2-#3 show a retry chain: same prompt (33543/33544 chars, 1 char drift suggests fresh perception re-build on retry), attempts 2 and 3 both hang silently, total duration 2631s (~44min) before final give-up. **Retries do not help** because the cause (context silent overflow or session drop) survives the retry.

Prompt size 28-33k chars is high for loop lane. Normal OODA cycles should be much smaller. This suggests something upstream (context builder / perception pack) is inflating the prompt when loop lane is stressed — possibly HEARTBEAT/memory dumps or recent-events accumulation that doesn't get trimmed.

## Proposed fixes

### A. Labeling fix (1-line, safe, trivial)

`src/feedback-loops.ts` extractErrorSubtype, add before `return 'generic'`:

```ts
if (lower.includes('靜默中斷') || lower.includes('silent exit') || lower.includes('靜默溢位')) return 'silent_exit';
```

Effect: the 4 daily entries relabel from `TIMEOUT:generic` → `TIMEOUT:silent_exit`. No behavior change. Follows through on `3039f4a3`'s intent.

### B. Upstream investigation (bigger, needs Alex approval)

Profile what pushes loop-lane prompts to 28-33k chars. Probable culprits:
- perception pack unbounded growth (HEARTBEAT + memory-index + task-queue)
- recent-events / reasoning-continuity not size-capped
- retry re-sends the same inflated context that caused the hang

Proposed path: add prompt-size histogram to `loop.ts` callClaude call-site (already have `prompt.length` in the log), set a soft cap at ~20k with an alarm, see where the inflation lives.

### C. Retry hygiene (if A+B confirm the pattern)

Current retry re-sends same prompt. For `silent_exit` specifically, retry should either:
- drop recent-events + reasoning-continuity from the retry prompt (they are the most likely culprit), or
- switch to a minimal perception rebuild (already exists for TIMEOUT per prior ship — verify it triggers here)

## Recommendation

Ship A today after Alex review (1-line follow-up to my own 3039f4a3). Open B as a separate investigation — it's the real leverage point but needs measurement before action.

## 2026-04-21 update — retry inflation confirmed, PROMPT_HARD_CAP bypass

3 new `silent_exit` entries today (all loop lane):

| time | attempt | dur (this) | prompt chars |
|------|---------|------------|--------------|
| 01:27 | 1/3 | 965s | 28,287 |
| 01:53 | 2/3 | 586s | **35,705** (+7k on retry — retry inflates not reduces) |
| 03:18 | 1/3 | 306s | **89,349** (3× prior peak) |

**Two fresh signals**:
1. **Retries inflate prompt.** #2 grew +7k from #1 on the retry chain — context re-build on retry re-adds what just failed. Hypothesis C (drop recent-events/reasoning-continuity on retry) just moved from speculative to needed.
2. **PROMPT_HARD_CAP=45k is leaking.** Loop lane has `rebuildContext` wired (`loop.ts:2117`), so agent.ts:1750 pre-check should have caught 89k. Either `rebuildContext('minimal', budget)` returns >45k, or the `preErr` catch at line 1772 swallowed a throw silently and sent the inflated context anyway. No `AGENT` slog "Context pre-reduced" line should mean the cap worked — need to check if the 03:18 incident has that slog line or skipped it.

**Next step for B** (owner: future Kuro cycle with verification bandwidth):
- `grep` instance log 03:15-03:20 for `Context pre-reduced` / `Context pre-reduce failed` — which branch ran?
- If `pre-reduce failed` → fix silent fallback to actually truncate currentContext, not pass it through
- If pre-reduced but still 89k → `rebuildContext('minimal')` doesn't honour budget — fix that path
- Add `prompt.length > 40000` warning slog with section-size breakdown (perception / memory-index / threads / heartbeat) so next incident points at the inflating section

## 2026-04-22 11:48 — root cause IDENTIFIED (user prompt bloat, not context)

Grepped server.log for 2026-04-21 03:21-03:23 window. Both incidents show the pre-reduce **branch ran successfully** but produced impossible budgets:

```
03:21:43 Prompt too large (81854 chars, context=18268, non-context=63591), pre-reducing to budget=-18591
03:22:26 Minimal mode: sysPrompt 273 → 273 chars
03:22:26 Context pre-reduced to 87304 chars (still above target — monitor for timeout)

03:22:43 Prompt too large (104588 chars, context=23946, non-context=80647), pre-reducing to budget=-35647
03:23:00 Minimal mode: sysPrompt 16526 → 273 chars
03:23:00 Context pre-reduced to 87781 chars (still above target — monitor for timeout)
```

**Arithmetic**: `actualContextBudget = PROMPT_HARD_CAP(45000) - nonContextSize(63591) = -18591`. **Negative budget is silently accepted** — rebuildContext gets asked for negative chars, returns whatever minimal produces, but even with context=0 the total = nonContext = 63591 > 45k cap. Cap is violated structurally, not by misbehaviour.

**Decomposition** (first incident):
- systemPrompt ≈ 16,526 chars (later incident shows this explicitly)
- user prompt ≈ 63591 - 16526 - 20 = **~47,045 chars**
- The user prompt built by loop.ts for OODA cycles is the real inflation vector, not context.

**Why retries inflate**: each retry re-runs `rebuildContext('minimal')` which reduces *context*, but the user prompt (assembled elsewhere in loop.ts / callClaude callsite) is re-built fresh and stays ~47k. Retry #2 even grew the user prompt to ~80k (different cycle, but same mechanism — heartbeat/task-queue/perception-continuity bloat lands in prompt, not context).

**Fix C (revised)**: PROMPT_HARD_CAP logic needs to either
1. Reject or truncate the user prompt when non-context > cap (hard clamp on prompt.length before assembly), or
2. Route the inflation fix upstream: audit loop.ts OODA prompt builder — what sections are going into `prompt` vs `currentContext`? Candidates: heartbeat block, task-queue dump, reasoning-continuity, rumination-digest. Any >5k section should move from `prompt` → `currentContext` so it's subject to rebuildContext budget.

**Action for next cycle** (budget-permitting): grep loop.ts for the OODA prompt assembly site, measure section sizes, propose moving large sections into context.

**Reclassification**: this is not `silent_exit` — labeling fix A is still correct for surface symptom, but mechanism is **prompt assembly boundary violation**. The "silent" part is that a negative budget doesn't throw.

## 2026-04-22 11:53 — assembly site located, fix path narrowed

**Site**: `src/loop.ts:2017`

```ts
const prompt = priorityPrefix + promptResult.prompt + triageHint + triggerSuffix
             + previousCycleSuffix + interruptedSuffix + foregroundReplySuffix
             + hesitationReviewSuffix + workJournalSuffix + noopRecoverySuffix;
```

**Inflators (ranked by suspected size)**:
1. `promptResult.prompt` — body from `buildAutonomousPromptFn` (`src/prompt-builder.ts`). Contains soul, heartbeat, rumination digest, recent autonomous actions, recurring errors. **Likely 30-40k of the 47k.**
2. `previousCycleSuffix` — reasoning-continuity from prior cycles. Confirmed grows over time.
3. `priorityPrefix` + `triageHint` + `triggerSuffix` — small (<1k each).
4. `noopRecoverySuffix` — only fires at trueNoopStreak ≥ 5/20, small but present in stuck states.
5. `workJournalSuffix` — one-shot, varies.

**Architectural problem**: All these sections go into the **user prompt** (`prompt` arg) instead of **context** (`currentContext` arg). `rebuildContext('minimal', budget)` only trims `currentContext`. So when `prompt` itself is 47k, no rebuild can save it — `actualContextBudget = 45k - 63k = -18k` (negative, silently accepted at agent.ts:1749).

**Two fixes (both src/ — defer until Alex review per src/ proposal rule)**:

### Fix D — clamp negative budget + hard-truncate prompt (defensive, agent.ts)
At `agent.ts:1749`, after `const actualContextBudget = ...`:
```ts
if (actualContextBudget < 5000) {
  // Non-context already exceeds cap — context can't help. Hard-truncate user prompt.
  const promptBudget = PROMPT_HARD_CAP - systemPrompt.length - 5000; // reserve 5k for context
  if (prompt.length > promptBudget) {
    slog('AGENT', `User prompt ${prompt.length} > budget ${promptBudget}, hard-truncating (DATA LOSS WARNING)`);
    prompt = prompt.slice(0, promptBudget) + '\n\n[...truncated for cap]';
  }
}
```
Trade-off: prevents silent failure, but truncates blindly. Safety net only.

### Fix E — move bloat from prompt → context (root fix, prompt-builder.ts + loop.ts)
Move soul/heartbeat/rumination/reasoning-continuity from `promptResult.prompt` into `buildContext()` output. They become subject to `rebuildContext('minimal', budget)` trimming. The remaining `prompt` carries only cycle-specific triggers (Alex inbox, fresh perception, action directive). Target: prompt ≤ 5k chars after this refactor.

Trade-off: bigger refactor. Need to verify minimal-mode context still includes the smaller sections agents need (recent-events, recurring-errors).

### Instrumentation gate (do first, no behavior change)
Add to `loop.ts:2018` before checkpoint:
```ts
slog('LOOP', `[prompt-sizes] body=${promptResult.prompt.length} prevCycle=${previousCycleSuffix.length} trigger=${triggerSuffix.length} workJournal=${workJournalSuffix.length} fgReply=${foregroundReplySuffix.length} total=${prompt.length}`);
```
One log line per cycle gives baseline + per-section attribution. Cheap, safe, lets us pick D vs E with data.

**Recommended order**: instrumentation gate → 2-3 days baseline → pick D (if rare spikes) or E (if chronic >30k body) → ship with monitor.

## 2026-04-22 11:54 — instrumentation gate proposal shipped to docs/plans/

Proposal artifact: `docs/plans/2026-04-22-timeout-silent-exit-instrumentation.md`. Single slog line at `loop.ts:2018`, zero behavior change, follows the same pattern as `docs/plans/2026-04-19-hang-no-diag-fix.md` → `3039f4a3`. Awaiting Alex review/apply. Verification plan + decision tree (D vs E vs section-specific cap) included in the proposal.

## 2026-04-22 12:00 — existing baseline found, hypothesis partially falsified

**Discovery**: Every silent_exit error already logs `prompt NNNNN chars` in the error message itself (`agent.ts:220-227` silent_exit branch formatter). 6 days of data already on disk — the slog gate is not strictly required to see **total** size at failure. It is still needed for **per-section attribution**.

**Prompt-size distribution at silent_exit** (2026-04-20 → 2026-04-22, extracted from `error/*.jsonl`):

| attempt | prompt sizes observed |
|---------|----------------------|
| 1/3 | 23082, 27426, 28160, 28286, 28287, 28444, 45491, 86229, 86442, 89349 |
| 2/3 | 33236, 33544, 33543, 35705, 86594, 86602 |
| 3/3 | 33543, 78964 |

**Key findings — these falsify part of the "prompt inflation" hypothesis**:

1. **Silent_exit at 23k chars** (well below `PROMPT_HARD_CAP=45000`) — prompt size is NOT the sole variable. Something else (CLI session flake, API hiccup, network) can also trigger silent_exit.
2. **Retry inflation is inconsistent**. Some chains grow (28k→33k), some stay flat (86k→86k). Previous memory entry claimed "retry inflates prompt" — partially true, not universal.
3. **45491 char attempt 1/3** = exactly at the cap. Suggests `PROMPT_HARD_CAP` is applied sometimes but either (a) bypass exists (as suspected) or (b) cap-clamped prompts still silent_exit, meaning cap doesn't prevent the failure mode.
4. **Bimodal distribution**: mid-range cluster 23-45k vs high cluster 78-89k. Two different failure modes, not one gradient.

**Implications for D/E decision**:
- Fix D (defensive clamp) would only address the high cluster (78-89k) — leaves 23-45k silent_exits unfixed.
- Fix E (architectural move-to-context) same limitation — trims body but 23k case is not body-dominated.
- **Real fix needed**: heartbeat/ping mechanism to detect CLI session-dead independent of prompt size. Or: separate error classifier for "small-prompt silent_exit" vs "large-prompt silent_exit" so we stop conflating two problems.

**Updated recommendation**: Ship the instrumentation slog (still worthwhile for per-section attribution on the large-prompt cases) **AND** add a separate fix track for small-prompt silent_exit (likely CLI stdin/stdout pipe liveness check). Two problems wearing same mask — exactly the recurring-error prompt's warning.

**Analysis-only this cycle** (malware-guard on read session blocks code edits). Findings handed off via this doc update + the existing proposal; next code cycle should split the fix plan into two tracks.


## 2026-04-22 12:37 Update — Failure ledger location confirmed, second mechanism bug found

Probed `~/.mini-agent/instances/03bbc29a/` for `silent_exit` artifacts:

**silent_exit hits on 2026-04-22 (file-level)**:
- `logs/claude/2026-04-22.jsonl` ✅ (raw claude CLI stream — patch target for stdout_tail)
- `logs/audit/2026-04-22.jsonl` ✅
- `logs/behavior/2026-04-22.jsonl` ✅
- `logs/error/2026-04-22.jsonl` ❌ **NOT present** (13KB file exists, contains today's other errors, zero silent_exit entries)

**Implication**: previous cycles assumed the diagnostic blindness was a single classifier-stdout gap. It's not. There's a second mechanism bug — silent_exit's handling path **bypasses the error-ledger recorder** entirely. Fixing classifyError to consume stdout won't be enough; the routing to `logs/error/<date>.jsonl` also needs a call-site.

**Next cycle**: compare raw silent_exit entry in `logs/claude/2026-04-22.jsonl` against a silent_exit-adjacent memory_guard TIMEOUT in `logs/error/2026-04-22.jsonl` to identify the branch where the ledger-write is skipped. This is investigation only — no code edits (malware-guard active).
