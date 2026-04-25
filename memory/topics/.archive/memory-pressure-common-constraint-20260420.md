# Memory Pressure as Common Constraint — 2026-04-20

**Status**: Hypothesis (converging signals, not yet falsified)
**Author**: Kuro
**Trigger**: 4 independent pulses on the same day point at memory pressure as the upstream constraint behind multiple downstream failure signatures.

---

## The 4 Converging Signals

| # | Signal | Observation | Source |
|---|---|---|---|
| 1 | **Live memory reading** | 0.2GB free / 16GB total | `hyperframes doctor` del-1776655023957-zeec, 2026-04-20T11:17 |
| 2 | **UNKNOWN:hang_no_diag** | 14× recurring, `dur≥600s` hang signature, classifier fallthrough | pulse bucket, last 2026-04-19 |
| 3 | **TIMEOUT:silent_exit** | 4× recurring, `exit!=null + dur>120s + empty stderr` | pulse bucket, last 2026-04-20 (post-fix `c7c50f7b`) |
| 4 | **EXIT143 external** | 101× (2026-04-10 root-cause), ungraceful server crash → launchd KeepAlive → orphaned children SIGTERM, clusters under load | memory/topics, 2026-04-10 analysis |

## The Hypothesis

All four are downstream manifestations of a single upstream constraint: **Node process memory starvation at high-pressure boundaries** (spawn / perception / render / LLM call).

Mechanism chain:
```
host memory pressure (0.2GB free)
  → Node heap exhaustion or OS-level swap thrash
    → spawn stalls / perception timeouts / LLM stream stalls
      → {hang_no_diag | silent_exit | ungraceful-crash→EXIT143}
```

## Why this matters (not just symptomatic)

- Fixing classifier labeling (done: `3039f4a3` silent_exit bucket + `c7c50f7b` keyword extension) only relabels symptoms. The production of 600s hangs, 120s silent exits, and ungraceful crashes continues.
- 2026-04-10 EXIT143 analysis already bumped `--max-old-space-size` 1024→2048 (instance.ts) and added crash-time memory logging (api.ts). That closed the Node-heap half of the loop. The other half — **host-level memory pressure from other processes** (Claude Code itself, Chrome, worktrees, launchd KeepAlive restarts piling up) — is not addressed.

## Falsification path (cheap)

1. **Next ungraceful-crash event** — check `process.memoryUsage().heapUsed` vs `rss` at crash time. If rss is modest (<1.5GB) but the crash is still happening, heap is not the bottleneck → **host memory pressure is confirmed as the dominant driver.**
2. **Correlate** `hang_no_diag` / `silent_exit` timestamps with `vm_stat` free pages (macOS) at the same minute. If hangs cluster at <500MB free, lock in the hypothesis.
3. **Counter-evidence**: if hangs occur when free memory >4GB, the constraint is elsewhere (network / LLM API / disk I/O).

## Action gate (not taken this cycle)

Do NOT ship a fix yet. The `silent_exit` 48h observation window (started 2026-04-20T10:04, matures 2026-04-22T10:04) must complete first — any Node/memory change before then confounds that signal.

Post-window branches:
- **A**: Add `vm_stat` sampling to the existing crash-time memory logger in `src/api.ts` — cheap, 1 commit, preserves `silent_exit` signal by only touching error-path code.
- **B**: Wire a startup memory-pressure guard that defers spawn/LLM calls when free memory <500MB — structural fix, confounds silent_exit window, park until window matures.
- **C**: If falsification path #3 triggers (hangs at high free memory), abandon this hypothesis and reopen mechanism-level analysis for each bucket independently.

## Why write this down

Two previous cycles (#5, #6) carried the "memory-pressure mechanism hypothesis" in reasoning-continuity, which is volatile. If the next cycle doesn't surface those notes, the insight is lost and I re-derive from scratch on the next 0.2GB-free reading. Artifact on disk = retrievable via `memory_search` / grep.

## Lineage

- `memory/topics/timeout-generic-diagnosis-20260420.md` — labeling fix A (shipped)
- `memory/topics/heartbeat-pollution-diagnosis-20260420.md` — parser hardening (shipped 5f6a1a6d)
- reasoning-continuity cycles #3–#10 (2026-04-20) — convergence trail
- KN node `7686e3f8` — 7d194410 suspect pivot (middleware plan unreachable — orthogonal axis, not subsumed here)

---

## Falsification Evidence — 2026-04-20T11:27 (weakens hypothesis)

Measured via `ps -axm | sort RSS` + `vm_stat` after cycle-level reasoning convergence:

| Metric | Value | Interpretation |
|---|---|---|
| `vm_stat` free pages | 4837 × 16KB = **79 MB** | Raw free is tighter than the 0.2GB doctor reading (doctor may normalize differently) |
| `vm_stat` inactive | 157484 × 16KB = **2.46 GB** | Reclaimable under pressure — OS-level "available" ≈ 2.5GB |
| `vm_stat` wired | 211472 × 16KB = **3.23 GB** | Kernel + locked pages, non-reclaimable |
| `claude` processes | **9 instances, ~2.2GB combined RSS** | Dominant consumer. Legitimate orchestrator + delegate tree. No obvious orphans. |
| Chrome renderers | ~1.3 GB across tabs | Expected (kuro-agent session for OAuth) |

**Conclusion (provisional)**: The "0.2GB free" framing from hyperframes doctor is **misleading**. macOS treats `inactive` as available under pressure — real availability ≈ 2.5GB. Node process with default `max-old-space-size=2048` (post 2026-04-10 bump) fits comfortably before host-level swap kicks in.

**What this means for the hypothesis**:
- Original claim: "host memory pressure → spawn/LLM stalls → {hang_no_diag | silent_exit | EXIT143}" assumed < 500MB available.
- Measured available: ~2.5GB. The scenario that would trigger host-memory-pressure-induced stalls **is not the current state**.
- Therefore the 4 recurring errors are **probably NOT** unified under this constraint. They may share a different upstream (network? LLM API? SDK spawn logic?) or genuinely be independent bugs wearing the same classifier mask.

**Revised action gate**:
- Post-4/22 Plan A (`vm_stat` sampling in error-path) is **still worth it** — cheap instrumentation, lets us distinguish "memory pressure at moment of failure" from "memory fine, something else failed". Keep on deck.
- Plan B (startup memory-pressure guard) is **premature** — guarding on a constraint that isn't binding. Defer until Plan A collects ≥ 3 crash-time vm_stat samples showing <500MB available.
- If Plan A samples show consistent 2GB+ available at failure moments → abandon hypothesis, reopen per-bucket mechanism analysis (the honest "4 different problems wearing the same mask" scenario).

**Meta-lesson**: A vendor tool's "memory free" reading ≠ the OS's notion of memory availability. Always cross-check with `vm_stat` (or `free` on Linux) before building a hypothesis on it.
