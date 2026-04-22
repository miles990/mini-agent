# Memory Pressure Profile — 2026-04-20 11:33

Sampled during cycle, following `memory-pressure-common-constraint-20260420.md` hypothesis.

## Headline numbers
- **RAM free**: 615 MB (38,446 pages × 16KB)
- **Swap**: 9585/10240 MB used = **93.6% exhausted, 654 MB free**
- **Compressor**: ~7 GB compressed (448,919 pages × 16KB)
- **vm.memory_pressure sysctl**: 0 ← misleading on Apple Silicon, ignore
- **Wired**: 219,051 pages ≈ 3.4 GB (kernel + always-resident)

## Swap I/O lifetime (since boot 16h ago)
- Swapins: 46,179,684
- Swapouts: 55,428,528
- Ratio: 1.2 swapouts per swapin → system has been pushing stuff to swap faster than reading back. Consistent with "filling swap" trajectory.

## Top hogs (RSS)
| PID | RSS | Command |
|-----|-----|---------|
| 98021 | 513 MB | Chrome renderer (1 tab) |
| 40204 | 293 MB | `claude -p --model haiku` @ 11:33 |
| 26374 | 268 MB | Chrome main |
| 38214 | 260 MB | `claude -p --model haiku` @ 11:33 |
| 37282 | 241 MB | `claude -p --model haiku` @ 11:33 |
| 39395 | 219 MB | `claude -p --model haiku` @ 11:33 |
| 70724 | 201 MB | Main agent (`claude --dangerously-skip-permissions --chrome`) — THIS is Kuro |
| 37911 | 209 MB | `claude -p --model haiku` @ 11:33 |
| 555 | 160 MB | mds_stores (system) |

## The pattern
**5× haiku subprocess RSS ≈ 1.22 GB**, all spawned at 11:33 (same minute).
- If they're from perception-analyzer + other cycle Haiku calls, they should exit within seconds-minutes.
- If they linger past next sampling window → **leak**, direct mechanism for callClaude silent_exit/hang_no_diag:
  - spawn N → swap fills → new spawn competes for <1GB RAM → kernel OOM-kills the spawning process → silent_exit signature

## Falsification gate
Re-sample at next cycle (+~2min):
- **IF** all 11:33 haiku PIDs have exited → normal churn, memory is baseline-tight but not leaking. Hypothesis downgrades to "tight envelope, no acute leak."
- **IF** 11:33 PIDs still present AND another batch spawns on top → **leak confirmed**. Action: ship perception-analyzer KN cache migration (P2 #2) OUT of band of silent_exit window, OR build subprocess reaper.

## Non-code interventions available (don't contaminate 4/22 10:04 window)
1. Close Chrome tab 98021 (renderer 513 MB) — Alex-owned, needs permission. DON'T auto-kill.
2. Kill old orphaned haiku PIDs IF confirmed orphaned (next cycle).
3. `sudo purge` — flushes inactive/speculative pages, frees ~2-4 GB typically. Safe, no code change.

## Decision for next cycle
Read this file → re-sample `ps aux | grep 'claude -p' | awk '{print $2,$9}'` → branch on PID survival.

Status: DIAGNOSTIC, no action taken yet. Silent_exit window still holding (matures 2026-04-22T10:04).
