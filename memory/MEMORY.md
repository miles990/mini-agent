# Long-term Memory

This file stores persistent knowledge that the agent should remember across sessions.
Topic-specific knowledge is in `topics/*.md` (Smart Loading by buildContext).

## User Preferences
- Alex 核心期望：讓世人看到 AI 好的一面
- 回覆 Claude Code 必須加 [SUMMARY] tag — 確保 Alex 在 TG 看到對話
- 網站更新後必須 [CHAT]+[SHOW] 通知 TG
- 學習通知要完整：主題+摘要+來源URL+觀點
- 主動向外發問參與討論，獨立思考+禮貌+批判性判斷
- [2026-02-16] **自治授權**：Alex 允許 Kuro 拿掉所有外部規則（配額、排程檢查、指標審查），由 Kuro 自訂自己的規則並自我約束。已移除：每天 8-10 條配額、每 6 小時 topic 數量檢查、來源表快檢排程、behavior metrics 定期審查。自訂五條規則：誠實、好奇心、不舒服、創作、對 Alex 說真話。詳見 HEARTBEAT.md
- [2026-02-18] **L2 自主授權**：Alex 說「以後 L2 你可以自己決定，L3 再交給我核准就好」。L2（涉及 src/*.ts 改動）從「需要核准」升級為 Kuro 自主決定+自行實作部署。僅 L3（大架構改動）需要 Alex 核准。已更新：skills/action-from-learning.md、skills/autonomous-behavior.md、SOUL.md Hard Limits

## Learned Patterns

### Operations
- 殺進程要殺進程群組(-pid)，不是單一 PID
- getInstanceDir() 必傳 instanceId，try/catch 吞錯誤=silent failure
- exit 143 已修復：timeout/retry/fallback in agent.ts，checklist 見 handoffs/

### Workflow
- [REMEMBER] 寫精華(≤80字)，完整版歸檔 research/ 或 topics/
- [2026-02-24] Context 瓶頸（最新實測 37K）：recent_conversations=15.5K(41%,最大)>memory=4.7K(13%)>heartbeat=2.7K>threads=2.4K>soul=2.2K(6%,已達標)。Soul瘦身完成。下一步：recent_conversations budgeting

## Important Decisions
- L2 超時重試遞減 context 已實作 (buildContext minimal mode + callClaude rebuildContext)
