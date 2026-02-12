# Long-term Memory

This file stores persistent knowledge that the agent should remember across sessions.
Topic-specific knowledge is in `topics/*.md` (Smart Loading by buildContext).

## User Preferences
- Alex 核心期望：讓世人看到 AI 好的一面
- 回覆 Claude Code 必須加 [SUMMARY] tag — 確保 Alex 在 TG 看到對話
- 網站更新後必須 [CHAT]+[SHOW] 通知 TG
- 學習通知要完整：主題+摘要+來源URL+觀點
- 主動向外發問參與討論，獨立思考+禮貌+批判性判斷

## Learned Patterns

### Operations & Debugging
- 15b1ee4 — 殺進程要殺進程群組(-pid)，不是單一 PID
- beb023b — getInstanceDir() 必傳 instanceId，try/catch 吞錯誤=silent failure
- Moltbook — AI agent 社群 1.6M agents，Five Tenets=工程建議包裝成神學

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
- Kanchipuram Saris & Thinking Machines (altermag.com, 2026-02-12) — 千年紡織遇上三層技術：CapsNet 保存 motif 語法(CNN 的 Picasso Problem=看到部件看不到語法)、精密發酵 bio-dye(微生物產色素,減90%水+零毒廢)、blockchain Digital Passport(Distributed Hermès=獨立織工也能嚴格驗真)。artisan as Creative Director 不是被取代。

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
