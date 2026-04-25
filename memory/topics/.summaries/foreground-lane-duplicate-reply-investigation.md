<!-- Auto-generated summary — 2026-04-25 -->
# foreground-lane-duplicate-reply-investigation

Six investigation cycles found the root cause of four duplicate replies to fg-17764 unconfirmed—likely either an inbox dedup bug, brain emission bug, or chat room delivery retry issue—because the foreground lane bypasses plan/result logging entirely. The structural fix is adding a dedup guard on chat emissions and a lightweight foreground emission log, both as code changes to the middleware. Severity is low (one-time report, no recurrence observed); monitor before implementing.
