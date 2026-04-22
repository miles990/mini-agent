<!-- Auto-generated summary — 2026-04-18 -->
# foreground-lane-duplicate-reply-investigation

Foreground lane duplicate replies to a single message remain unconfirmed in root cause due to missing emission-side logging—the fast-path bypasses plan/result logs entirely, making it impossible to distinguish between inbox dedup bugs, brain emission bugs, or transport retries. The structural fix requires adding dedup guards and lightweight foreground emission logs to the middleware. Low severity (one-time report, no recurrence observed) but actionable if it recurs.
