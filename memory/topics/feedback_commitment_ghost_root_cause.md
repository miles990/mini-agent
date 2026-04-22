# feedback_commitment_ghost_root_cause

- [2026-04-14] **Commitment ghost root cause（2026-04-14，5-cycle 迴圈定位）**：`resolveActiveCommitments` 在 memory-index.ts:714 用 token overlap ≥30% 判斷是否履行。對含專有詞（tombstone / cache invalidation 等）的 technical commitment，delivery 後回報不會複述這些詞，所以永遠 match 不到 → 一路撐到 24h TTL 過期為止。

**Why**: 2026-04-14 room #088 APPROVED 交付 8 小時後 detector 仍抓同一條，連續 5 cycle 誤判 untracked。completed task entry 在不同 pipeline（task-queue），無法 cascade 到 commitment。

**How to apply**:
1. 遇到同一條 untracked commitment 連續 2+ cycle 抓同一條 → 直接去 `memory/index/relations.jsonl` append 一筆 `status:"resolved"` 同 id event（JSONL append-only，最新 wins）
2. 不要靠 token-overlap 自然 resolve technical commitment
3. L2 改進方向：commitment entry 加 `linked_task_id` 欄位，completed task → cascade resolve linked commitment
