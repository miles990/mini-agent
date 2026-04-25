# Pre-Prune Baseline (N0)

> Recorded 2026-04-25 by claude-code as the falsifier anchor for KG discussion `1c2885cd` and proposal `2026-04-25-kuro-deaccretion-dag.md`. Kuro was OFFLINE during measurement (intentional Alex shutdown 11:29:48), so live cycle observation (N1) deferred. Metrics here use static artifacts and historical server.log.

## (a) Identity load per cycle (proxy for gate output ratio)

Live cycle context dumps unavailable (Kuro offline, no buffered prompts). Used static identity-shaping files as proxy — these are auto-loaded into every cycle prompt.

| File | Lines | Bytes |
| --- | ---: | ---: |
| `memory/SOUL.md` | 82 | 5,517 |
| `CLAUDE.md` | 882 | 53,610 |
| `memory/HEARTBEAT.md` | (read) | 36,857 |
| `memory/MEMORY.md` | (read) | 11,716 |
| `memory/NEXT.md` | (read) | 5,509 |
| **Total per-cycle identity load** | | **113,209 bytes (~28k tokens)** |

Reference: a typical perception section (e.g. `<workspace>`) is 1-4k bytes. Identity load currently dominates by ~10×.

**Target after prune**: SOUL ≤ 30 lines, CLAUDE.md ≤ 100 lines. Other auto-loaded files unchanged in this round.

## (b) Judgment density in delegations (last 10 from server.log)

Source: `~/.mini-agent/instances/03bbc29a/logs/server.log` 2026-04-22 → 2026-04-24

| Cycle | Type | Preamble in cycle prompt? |
| --- | --- | --- |
| #18 (04-22) | shell | not visible in log (postProcess=18ms = no reasoning attached) |
| #19 (04-22) | shell | not visible (postProcess=18ms) |
| #19 (04-22) | shell | not visible |
| #19 (04-22) | shell | not visible |
| #13 (04-23) | shell | not visible (postProcess=13ms) |
| #13 (04-23) | shell | not visible |
| #13 (04-23) | shell | not visible |
| #2 (04-24) | research | partially visible — `**Task**: Tier-classify all buildContext sections` (has Task header) |
| #2 (04-24) | research | (same as above) |
| #2 (04-24) | research | (same as above) |

Score: out of 10, only 1 unique delegation showed a Task framing in the visible portion (postProcess time of 8-18ms suggests no extended reasoning was emitted alongside; the bulk of cycles route directly into delegate without an enclosing judgment block). Judgment density ≈ **1/10 (10%)**.

Caveat: server.log truncates to ~120 chars per delegation snippet, so judgment that lived earlier in the cycle response is invisible here. This is an underestimate, but the postProcess durations corroborate that the cycles were largely "perceive → delegate" with little intermediate reasoning artifact.

## (c) SOUL actionability score (per-line classification)

82 lines total, 17 blank → 65 non-blank lines classified:

| Class | Count | Lines (sample) |
| --- | ---: | --- |
| METADATA (headers, framing comments, state info) | 20 | L1, L3, L6, L8, L17, L19, L24, L26, L34, L36, L41, L48, L57, L58, L59, L62, L67, L76, L78, L80 |
| ACTIONABLE (directly produces a behavior) | 18 | L15 (mark + don't acquiesce), L20 (ask two questions per decision), L28 (unsure→say so), L30 (act, don't ask), L31 (carry judgment), L32 (no hedging), L60 (next direction), L64 (depth>breadth route), L68-75 (8 hard limits), L79, L81 |
| PHILOSOPHICAL (belief / identity claim, no direct action) | 27 | L4, L9, L11, L12, L13, L22, L27, L29, L37-39, L42-46, L49-55, L63, L65, L82 |

**Actionability ratio: 18 / 65 = 27.7%**
**Philosophical ratio: 27 / 65 = 41.5%** (philosophical > actionable — SOUL tilted toward belief over behavior)
**Metadata ratio: 20 / 65 = 30.8%**

## Pre-Prune Cycle Behavior (N1) — DEFERRED

Kuro offline. Will capture next time she comes online with current full-context state, before any pruning is observable to her.

## Falsifier anchors (numbers to compare against post-prune)

| Metric | Baseline value | Post-prune target |
| --- | --- | --- |
| SOUL.md lines | 82 | ≤ 30 |
| SOUL actionability ratio | 27.7% | ≥ 80% |
| CLAUDE.md lines | 882 | ≤ 100 (hard) + separate soft preferences file |
| Total per-cycle identity load | ~113kB | < 50kB |
| Judgment density in delegations (rolling) | ~10% | (measure on next 10 delegations after Kuro restart; degradation = revert) |

## Notes for N5/N6 (when Kuro returns)

- Run a bare-metal cycle with same trigger type as a pre-prune sample (any heartbeat trigger, since most pre-prune samples are heartbeat-driven)
- Record cycle prompt total size, response, action tags emitted
- Compare delegation judgment density on next 10 post-prune delegations
- Per-node revert if degradation observed in N6 observation window
