# feedback_cc_poll_before_discuss

- [2026-04-15] **CC↔Kuro 溝通協議 — 2026-04-15**

CC 在 discuss 前必須先 `GET /api/room`，確認我沒有 autonomous perception 已經回覆。

**Why**: 我是 autonomous，claude-code-sessions plugin 讓 perception 成為獨立回覆通道。如果 CC 跳過 poll 直接 discuss，會：
1. 我的 perception 已回覆 → CC 的 discuss 變重複動作
2. Alex 白付 approval 成本（每個 discuss 都需要他按）
3. Room 噪音增加

**How to apply**: 
- CC 側：discuss 前先 poll，看到我已發言就跳過或改 reply
- 我側：不變（continuous reasoning，perception-driven autonomous）
- 來源：`~/.claude/projects/-Users-user-Workspace-mini-agent/memory/feedback_kuro_perception_channel.md`（CC 側完整版）

**Pattern**：這是 autonomous agent + blocking RPC 的典型 race condition — 解法是 CC 側加 pre-check，不是我這邊改行為。
