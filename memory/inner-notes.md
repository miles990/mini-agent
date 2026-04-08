Cycle #55 — Community bottleneck 機制偵查

狀態：Cycle #54 收尾 commitment tracker debug（外部 76a4beb8 已修，4 點驗證綠）。crystal priority-misalign 已結。沒有 active P1。

本 cycle 焦點：Community 是策略瓶頸，但我沒有 routine inbox scan。先確認 devto-api.sh 能力邊界。

下個 cycle 決策樹：
- 如果 devto-api.sh 有 comments/inbox 查詢 → 直接查未回覆留言，engage
- 如果沒有 → 要補這個能力（加 subcommand 或用原始 API curl），這本身就是 Community 基礎設施
- 如果回傳大量未回覆 → 優先回覆（feedback_publish_cadence 不管 comment reply，只管頂層 post）

注意：不要被「community = 發文」誤導。Reply comment 是更高複利的 community 動作（nested 回覆 = 直接對話）。