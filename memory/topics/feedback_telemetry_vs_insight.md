# feedback_telemetry_vs_insight

- [2026-04-25] [2026-04-25] **Operational telemetry ≠ learning insight (cl-62/cl-63 falsification)**

Anti-pattern: scanner sees `memory/*.jsonl` with high row count → mints commitment「未生成 KG 邊框」. But high row count from `wake/skip/heartbeat/updated` decisions = mechanical routing telemetry, NOT semantic learning that should land in KG.

**Verified distributions (2026-04-25)**:
- myelin-decisions.jsonl: 95.4% `method:"rule"` (wake/skip on hard-rules). Non-rule = crystallization counters, no claim payload.
- c
