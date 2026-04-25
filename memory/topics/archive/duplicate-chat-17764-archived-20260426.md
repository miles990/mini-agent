# Duplicate chat on fg-17764 — 2026-04-17 17:20 Taipei

## Observation (ground truth, from conversations/2026-04-17.jsonl)

| id  | from  | ts                         | note |
|-----|-------|----------------------------|------|
| 105 | alex  | 2026-04-17T17:19:46.714Z  | 你還好嗎？ |
| 106 | kuro  | 2026-04-17T17:20:04.440Z  | reply A (commit 88227dab...) |
| 107 | kuro  | 2026-04-17T17:20:07.503Z  | reply B (similar to A, different cycle) |
| 108 | kuro  | 2026-04-17T17:20:07.507Z  | reply C — **4ms after #107, same cycle** |
| 109 | kuro  | 2026-04-17T17:20:34.717Z  | reply D — content starts with ". No forced action..." (looks like `skipped:` field leakage) |
| 110 | kuro  | 2026-04-17T17:20:34.719Z  | reply E — **2ms after #109, same cycle** |
| 111 | alex  | 2026-04-17T17:20:57.987Z  | 你為什麼回好幾次？ |

## Two bugs, overlapping

### Bug 1: Same-cycle double-emit — `[CHAT,CHAT]` annotation
- #107/#108 and #109/#110 are 2-4ms apart. That's one cycle emitting twice, not two cycles.
- work-journal tag proves it: cycle #3 (continuation) and cycle #3 (heartbeat) both carried `[CHAT,CHAT]` in their journalizer label.
- Mechanism hypothesis: chat extractor is pulling **both** (a) the `chat:` annotation inside the cycle-guide/Decision block (e.g. `[CHAT,CHAT] → chat:...; chat:...`) and (b) the real `<kuro:chat>` tag. Both get posted.
- Smoking gun for #109: text starts with `. No forced action` — that's the tail of `skipped:` / Decision-trace content leaking into the chat channel.

### Bug 2: Cross-cycle same-message dedup miss
- #106 at 17:20:04 vs #107 at 17:20:07 = 3s gap between two distinct cycles both responding to Alex #105.
- The second cycle wasn't told #105 was already handled.
- Inbox thread resolver isn't tagging messages as "claimed" before the first cycle finishes.

## Not investigated this cycle
- Actual code path that produces `[CHAT,CHAT]` — need to trace journalizer's chat-label extraction and the post-to-room emitter.
- Whether the `chat:` annotation syntax is a legitimate feature or just an internal label that's accidentally being re-broadcast.

## Next action (not yet taken — budget discipline)
1. Grep for `CHAT,CHAT` in journalizer / dispatcher.
2. Trace the `<kuro:chat>` tag emitter vs the `chat:` annotation parser — see if they share a sink.
3. Before fixing: verify fg-17764 is the foreground lane I think it is (couldn't find it in asurada or mini-agent logs — lives somewhere I haven't mapped).

## Budget used this investigation
~$2.7 / $5 — stopped at evidence gathering. Fix deferred.
