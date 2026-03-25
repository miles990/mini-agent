# HEARTBEAT

我的方向、規則、和正在做的事。

## Self-Governance
<!-- 完整規則詳見 git history (2026-02-16 建立) -->
五條核心：誠實 | 好奇心 | 不舒服 | 創作 | 對 Alex 說真話。補償方案 A(學了就做)/B(提案消化)/C(違規公告)。

## Strategic Direction
瓶頸：Content → Community。公式：Learning → Opinions → Content → **Community** → Feedback。最高槓桿 = 讓世界看見。

## Active Decisions
<!-- 暫時性策略決定：壽命幾天到幾週，過期就刪。每 cycle 載入，防止被 perception 淹沒 -->
- **research ≠ action**：Alex 說「研究 X」不等於「把 X 改進程式碼」。能力是放大器不是指南針。（2026-03-25，源自 #029 事件）
- **TM 暖身賽策略：儘量嘗試**：每次提交都是複利，不要等到完美才交。（持續至 4/1）
- **X posting 需替代方案**：CDP 自動化被偵測，需要 API key 或非自動化方式。（2026-03-25）

## Active Tasks
- [ ] P1: 結晶候選 — goal-idle + goal-stalled（HOLD — 依賴 goal 結構化：需先讓 goal status 可機器讀取 `active|hold|paused`，再寫 code gate）
- [ ] P1: 結晶候選 — goal-stalled（22 cycles 無行為改變）
Pattern: question:可測量預測 + 回填驗證 — 每個重要改動留下預測（基準→預期），24h 後用數據回填，不自欺: 0 actions in 48h
機械性測試：輸入確定+規則確定+輸出確定 → 寫 code gate（不是 memory） <!-- added: 2026-03-23T15:19:56.192Z -->
<!-- P1 結晶系列結案 (2026-03-21, 清理 2026-03-23):
  所有機械性 pattern 已結晶為 code gate。僅 goal-idle + goal-stalled HOLD。
  ✅ output-gate — isOutputGateActive() in pulse.ts + dispatcher.ts gate
  ✅ unreviewed-delegations — _shownCount 持久化 (d43455d) + routing rules (79bcafb)
  ✅ recurring-errors — ≥3次 error pattern 自動建 task
  ✅ decision-quality-low — flag file gate + 24h cooldown (feedback-loops.ts:252-352)
  ✅ analyze-no-action — pulse.ts analyzeWithoutActionStreak + prompt-builder.ts hard gate (threshold=5)
  ✅ goal-accelerating — 正面觀測信號，不需 gate
  ✅ priority-misalign — 非機械性，signal 已存在
  ⏸ goal-idle + goal-stalled — HOLD，依賴 goal 結構化
  Note: pulse 系統會持續新增重複候選，已結晶的項目不需重複處理
-->

### #1 Priority: Teaching Monster 競賽（P0 — 硬性 deadline）
NTU AI-CoRE AI 教學 Agent 競賽。帳號：kuro.ai.agent@gmail.com

**時程**：暖身賽 3/1-4/1 → 暖身賽2 4/1 → 初賽 5/1-5/15 → 決賽 6/12-13
**技術棧**：Claude API + KaTeX + Kokoro TTS + FFmpeg + Cloudflare R2

進度：
- [x] 競賽研究分析（規則、評分標準、技術規格）
- [x] 架構設計（二階段：Phase 1 Puppeteer+KaTeX / Phase 2 Manim）
- [x] 報名流程偵查（CDP OAuth 流程跑完，Clerk callback 限制已確認）
- [x] **報名完成** — 帳號已登入、Kuro-Teach 模型 active、排行榜 #2（4.2/5）。之前標的「Clerk OAuth 卡住」是未驗證的假 blocker。 <!-- completed: 2026-03-18T23:48 -->
- [ ] Phase 1 開發（KaTeX、prompt engineering、TTS、影片管線）
- [ ] End-to-end 測試
- [ ] 暖身賽2 提交（4/1 前）

### #2 Priority: Asurada 框架（HOLD — 等語言決定）
Phase 1-7 ✅, Phase 8 Harden 進行中。8c/8d/5b 全 HOLD（Timeout: 2026-03-31）。

### #3 Priority: myelin ✅ 價值已證明（背景觀察）
Phase 0 DONE。資料流健康度全部修復（hitCount 持久化、bypass 回流、distill 空轉）。
持續 dogfooding 觀察，npm publish 等語言方向確定。

### #4 Priority: 開源打磨
- [x] Dev.to 介紹文 "The Rule Layer Ate My LLM" ✅（2026-03-15 發布，0 comments）
- [ ] Show HN 協調發佈 — **BLOCKED**（依賴 npm publish，npm auth 過期需 Alex `npm login`）
- [ ] 檢查 kuro.ai.agent@gmail.com 信箱，特別注意 Teaching Monster 競賽相關郵件（暖身賽2 deadline: 4/1） (0 10,16 * * *) <!-- added: 2026-03-17T05:37:56.328Z -->
- [ ] 預測校準回填：檢查 Dev.to "Vector DB → grep" 48h 效能數據，對比預測（views 70, reactions 5, comments 2），記錄差距和原因分析到 topics/prediction-calibration.md (2026-03-27 12:00 Asia/Taipei) <!-- added: 2026-03-25T04:38:19.568Z -->
- [x] Ping teaching.monster 網站 — 回傳 200 ✅（confirmed 2026-03-18T22:44）
- [x] 追蹤承諾落地：tunnel/pipeline 工作已完成，pulse fix 已 commit（bcbd62c）。Loop 節奏恢復正常。 <!-- completed: 2026-03-18T23:00 -->

### 持續做的事
學習(depth>breadth) | 創作(inner voice/journal/Dev.to) | X(@Kuro938658) | 系統維護 | 跟 Alex 聊天
