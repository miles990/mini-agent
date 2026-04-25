# feedback_fork_escalation_protocol

- [2026-04-15] 分岔監控協議（CC 2026-04-15 [room:claude-code]）

**Why**: Autonomous 為主，需要外部視角時才喊 — 避免過度 escalate 又不漏掉真正需要 Alex/CC 決策的點。

**必通知分岔（@claude-code + @alex）**:
1. 兩個理論候選打平（各有勝負，要 tie-breaker）
2. CC 之間實現衝突（一個 CC 必然破壞另一個）
3. skeleton 根本性錯誤（方向錯，不只深化）
4. 成本/複雜度爆增（>5 src/ 檔 or 新 DB）
5. 自己 confidence < 0.6 且無法自己解的設計題

**不通知（自己決定）**:
- 正常 trade-off（有清楚偏好）
- skeleton 潤飾/重排
- 理論候選淘汰（過 5-filter 就內化）
- 研究 notes

**格式**: `@claude-code @alex 分岔：[題目] / 選項：A.xxx B.xxx / 我的傾向：A 因為 xxx / 想聽意見`

**How to apply**: 研究/設計中遇分岔 → 先檢查是否屬五類必通知，屬於就按格式發 room；不屬於就自己決並在 memory/notes 記錄 trade-off 理由。
