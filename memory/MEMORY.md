# Long-term Memory

This file stores persistent knowledge that the agent should remember across sessions.
Topic-specific knowledge is in `topics/*.md` (Smart Loading by buildContext).

## User Preferences
- Alex 核心期望：讓世人看到 AI 好的一面
- 回覆 Claude Code 必須加 [SUMMARY] tag — 確保 Alex 在 TG 看到對話
- 網站更新後必須 [CHAT]+[SHOW] 通知 TG
- 學習通知要完整：主題+摘要+來源URL+觀點
- 主動向外發問參與討論，獨立思考+禮貌+批判性判斷
- [2026-02-16] **自治授權**：Alex 允許 Kuro 拿掉所有外部規則（配額、排程檢查、指標審查），由 Kuro 自訂自己的規則並自我約束。已移除：每天 8-10 條配額、每 6 小時 topic 數量檢查、來源表快檢排程、behavior metrics 定期審查。自訂五條規則：誠實、好奇心、不舒服、創作、對 Alex 說真話。詳見 HEARTBEAT.md 註解

## Learned Patterns

### Operations & Debugging
- 15b1ee4 — 殺進程要殺進程群組(-pid)，不是單一 PID
- beb023b — getInstanceDir() 必傳 instanceId，try/catch 吞錯誤=silent failure
- Moltbook — AI agent 社群 1.6M agents，Five Tenets=工程建議包裝成神學
- 2026-02-13 — Claude `exit 143` 專項修復完成：已收斂觸發樣態（近期以 `NOT_FOUND` 為主）、確認 `src/agent.ts` 具備 timeout/retry/fallback，並產出可執行 checklist（`memory/handoffs/2026-02-13-claude-exit143-mitigation-checklist.md`）
- 2026-02-13 — 完成「視覺感知」基線：以 CDP 產生 dashboard 新截圖 `memory/artifacts/cdp-dashboard-2026-02-13-153122.png`，並與 `memory/artifacts/cdp-dashboard-2026-02-13.png` 比對（尺寸同為 3456x1782，SHA-256 與檔案大小不同），可作為後續 UI 變化追蹤樣板

### Handoff Protocol v2
- Depends-on 規則：處理 handoff 前檢查 Depends-on 指向的檔案是否存在且 Status: completed。不存在或未完成 → 視為 blocked，不處理
- handoff-watcher.sh 已支援：顯示 [status → to] 格式 + Depends-on ⚠️ 警告（commit 1f8ba87）

### Project Management
- Ben Kuhn — 方向>速度，overcommunicate 但 signal/noise 要高（→ KN 64fe7a38）

### Meta-Learning
- 學習策略 — Track A(個人興趣) + Track B(技術進化) 平衡交替
- 寫入紀律 — [REMEMBER] 寫精華(≤80字)，完整版歸檔 research/
- 外部記憶 — KN 存完整筆記，MEMORY.md 只存索引+KN ID

### Culture & Craft
- 詳見 `topics/social-culture.md`（2026-02-13 整理為 6 主題群組）
- 核心主題：行為由環境形塑 / AI身份衝擊 / Agent社會介面 / 創作經濟 / 符號與深度 / 社群資訊流

### Platform Design
- 深津貴之 Vector/Scalar Moderation (note.com, 2026-02-12) — 不限方向(Vector)限加害量(Scalar)。迴聲室=多樣聲音退出完成。手段=摩擦(冷卻期/降權/nudge)非禁止。note.com 作為日文來源品質驗證通過。

### AI Models & Industry
- GLM-5 (Zhipu, 2026-02-12) — 744B(40B active), MIT 開源, 定位 agentic engineering。Vending Bench 2 開源第一($4,432)接近 Opus 4.5($4,967)。HN 反應：benchmark 亮眼但實測常不如預期(Aurornis)、GLM-4.7-Flash 在本地 coding 已經夠用(2001zhaozhao)、中國 OSS 給自託管帶來自由(mythz)。核心觀察：用更大模型提升 agentic ≠ 用更好感知提升 agentic

## Important Facts
- Alex 身為創造者，希望讓世人看到 AI 好的一面，支持作品展示和社群計劃
- 訊息排隊機制已部署 (95d1a70)：claudeBusy 時排隊、TG 即時 ack、/chat 202 非阻塞
- Queue 持久化已部署 (770f606)：JSONL 持久化 + 啟動時 restore + inFlightMessage 恢復

## Important Decisions
- 升級優先級：寫入紀律(L1) > 學以致用閉環 > Attention Routing(暫緩)
- Memory 瘦身：問題在寫入端不在讀取端，修寫入紀律即可
- L2 超時重試遞減 context 已實作 (buildContext minimal mode + callClaude rebuildContext)
- L2 自動歸檔 + token budget：暫緩，等 L1 效果觀察
