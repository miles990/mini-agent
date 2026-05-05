# silent_exit_void rootCause diagnosis (2026-05-05)

**Counter**: 33 events across 8 days (2026-04-26 → 2026-05-05).
**Today**: 4 events 10:15-12:30, prompts 14-16KB (not bloated).

## Symptom shape (all 33 events)
- `exit undefined` (NOT null) in error object — `error.status` missing
- `stdout=empty` (zero output produced)
- `stderr` empty (no diagnostic from CLI)
- duration spans 175s-1212s

## Why classified as silent_exit_void
`src/agent.ts:222` condition: `duration > 120_000 && exitCode !== null && !signal && !killed && !stderr.trim()`.
In JS strict equality, `undefined !== null` is **true**, so any error object missing `.status` (instead of explicitly null) falls here. The bucket name "silent_exit" is accurate — process produced nothing — but the cause is heterogeneous.

## Two duration clusters (real signal in the noise)
- **Short (175-446s)**: 12/33 events. Near agent default 300s timeout. Likely CLI-internal hang during streaming setup or auth handshake.
- **Long (556-1212s)**: 21/33 events. Approaching middleware's 1500s `DEFAULT_TIMEOUT_MS`. Likely upstream API long-poll hang (Anthropic API silent during request).

Today's 4 events (287s, 1212s, 905s, 1010s) skew long-cluster — consistent with mac-sleep / DNS instability window that drove 23× econnrefused (commit 360f0ebd). When mac wakes mid-recovery, TCP handshake succeeds but response stalls = long silent hang.

## Why current sub-classifier is too coarse
`feedback-loops.ts:176`: `if (lower.includes('stdout=empty')) return 'silent_exit_void'` — single bucket for both clusters. Operator can't see which root cause to address.

## Proposed fix (deferred, low priority)
Add `dur=Xs` to the agent.ts:229 message string, then in feedback-loops.ts:176 split:
- `silent_exit_void:short` (<300s) → CLI-internal, retry usually succeeds
- `silent_exit_void:long` (>900s) → upstream API hang, may need provider failover

Deferred because: 4/day rate, all retryable, attempt 2-3 paths in error logs show retries succeed (no user-visible failure).

## Connection to econnrefused/DNS family
Both econnrefused (23×, commit 360f0ebd) and silent_exit_void:long (21/33) share network-instability root cause from mac-sleep transient state. econnrefused = DNS lookup failed pre-connect; silent_exit_void:long = connect succeeded, response never came. Same mac-sleep family, different network-stack failure mode.

## Falsifier
- If next 7 days show silent_exit_void duration distribution with **>80% in long cluster** and **temporal correlation r > 0.5 with mac-sleep transitions** → upstream-hang hypothesis confirmed, prioritize provider failover patch.
- If distribution shifts toward short cluster → CLI-internal hang dominant, look at CLI session/auth refresh logic.
- If 0 new events in 14 days → mac-sleep window was the real driver, monitor passively.
