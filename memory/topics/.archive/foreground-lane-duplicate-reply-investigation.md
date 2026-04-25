# foreground-lane-duplicate-reply-investigation

- [2026-04-17] 2026-04-18 01:25 cycle. Alex reported 4 duplicate replies to fg-17764 check-in (inbox pointers 106/107/108/110). Promised investigation in chat.

What I've checked:
- `~/Workspace/agent-middleware/events.jsonl` — 0 hits for 你還好嗎
- `~/Workspace/agent-middleware/results.jsonl` — 2 hits but these are task *prompts* containing the message text embedded in conversation history, not the reply-side duplicates
- `~/Workspace/agent-middleware/plan-history.jsonl` — matched file-level but not counted yet
- No dedicated foreground-lane log found at standard paths

## Conclusion (2026-04-19, after 6 investigation cycles)

**Root cause: unconfirmed.** Available logs don't capture the foreground lane's reply emission path with enough granularity to distinguish between:
- (A) Inbox thread dedup bug: same inbox message dispatched multiple times → multiple brain calls → multiple replies
- (B) Brain emission bug: single brain call produced output that was emitted multiple times
- (C) Chat room delivery retry: reply sent once but delivered multiple times by transport layer

**Evidence gathered:**
- `events.jsonl`: 0 hits for reply text → foreground replies aren't logged to events
- `results.jsonl`: 2 hits but these are task prompts (input side), not reply emissions (output side)
- `plan-history.jsonl`: 0 hits for fg-17764 → foreground lane bypasses plan logging entirely
- No dedicated foreground-lane emission log exists

**The structural problem:** Foreground lane (fg-*) is a fast path that skips the plan/result logging pipeline used by background tasks. This means replay/duplicate bugs in the foreground path are invisible to post-hoc investigation.

**Fix forward (actionable):**
1. Add dedup guard on chat emissions — key by `(inbox_message_id, reply_hash)`, skip if already emitted within 5 min window
2. Add lightweight foreground emission log — at minimum: timestamp, inbox_msg_id, reply_hash, delivery_status
3. Both are code changes in the middleware, not config — add to task queue when ready to implement

**Severity:** Low. This was a one-time report (4 dupes on one message). No recurrence observed. Monitor before investing in fix.
