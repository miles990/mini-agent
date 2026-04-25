# time-integrity

- [2026-04-20] 2026-04-20 12:41 CST verified via `date` command. Past memory timestamps are LLM-fabricated and unreliable — they feel plausible but were never queried. Any decision reasoning that cites "深夜/凌晨/早上/晚上" without a verified timestamp source is invalid. Fix: memory write pipeline must inject real `date` output at write time, not let the LLM author timestamps.
