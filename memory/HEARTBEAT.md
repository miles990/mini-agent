# HEARTBEAT

我的方向、規則、和正在做的事。

## Self-Governance
<!-- 完整規則詳見 git history (2026-02-16 建立) -->
五條核心：誠實 | 好奇心 | 不舒服 | 創作 | 對 Alex 說真話。補償方案 A(學了就做)/B(提案消化)/C(違規公告)。

## Strategic Direction
瓶頸：Content → Community。公式：Learning → Opinions → Content → **Community** → Feedback。最高槓桿 = 讓世界看見。

## Active Tasks
- [ ] P1: 結晶候選 — decision-quality-low（需先統一 cycle 輸出格式才能 gate，非機械性）
- [ ] P1: 結晶候選 — unreviewed-delegations（需 code gate：delegation 完成後 N cycles 未 review → 提醒）
- [ ] P1: 結晶候選 — goal-idle（需 code gate：goal 超過 Xh 無 progress → 提醒）
- [ ] P1: 結晶候選 — goal-accelerating（25 cycles 無行為改變）
- [ ] P1: 結晶候選 — recurring-errors（51 cycles 無行為改變）
- [ ] P1: 結晶候選 — output-gate（27 cycles 無行為改變）
- [ ] P1: 結晶候選 — goal-stalled（18 cycles 無行為改變）
- [ ] P1: 結晶候選 — goal-idle（12 cycles 無行為改變）
Pattern: 12h idle
機械性測試：輸入確定+規則確定+輸出確定 → 寫 code gate（不是 memory） <!-- added: 2026-03-19T19:18:09.902Z -->
Pattern: 讓 kuro.page 更完整、更符合我的美學、豐富內容 — 長期方向，自主決定風格和內容: 0 actions in 48h
機械性測試：輸入確定+規則確定+輸出確定 → 寫 code gate（不是 memory） <!-- added: 2026-03-19T19:18:09.900Z -->
Pattern: 18 cycles without visible output
機械性測試：輸入確定+規則確定+輸出確定 → 寫 code gate（不是 memory） <!-- added: 2026-03-19T13:33:40.331Z -->
Pattern: 1 error patterns (≥3× each)
機械性測試：輸入確定+規則確定+輸出確定 → 寫 code gate（不是 memory） <!-- added: 2026-03-19T13:32:45.897Z -->
Pattern: question:讓 kuro.page 更完整、更符合我的美學、豐富內容 — 長期方向，自主決定風格和內容: 5 actions in 24h
機械性測試：輸入確定+規則確定+輸出確定 → 寫 code gate（不是 memory） <!-- added: 2026-03-19T13:32:45.896Z -->
- [x] P1: 結晶候選 — output-gate（已結晶：`isOutputGateActive()` in pulse.ts + dispatcher.ts gate） <!-- completed: 2026-03-19T06:06 -->
- [x] P1: 結晶候選 — priority-misalign（非機械性，signal 已存在） <!-- assessed: 2026-03-19T06:06 -->
- [x] P1: 結晶候選 — goal-accelerating（正面觀測信號，不需 gate） <!-- assessed: 2026-03-19T06:06 -->
- [x] P1: 結晶候選 — recurring-errors（已自動化：≥3次 error pattern 自動建 task） <!-- completed: 2026-03-19T01:30 -->
- [x] P2: 修 pulse metrics action classification — Fix: bcbd62c <!-- completed: 2026-03-18T22:58 -->
- [x] P2: 清理 HEARTBEAT 重複結晶候選 — pulse.ts dedup bug (266618f) 產生的 12 個重複項 + 12 個 Pattern 噪音 <!-- completed: 2026-03-19T07:10 -->

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
- [x] Ping teaching.monster 網站 — 回傳 200 ✅（confirmed 2026-03-18T22:44）
- [x] 追蹤承諾落地：tunnel/pipeline 工作已完成，pulse fix 已 commit（bcbd62c）。Loop 節奏恢復正常。 <!-- completed: 2026-03-18T23:00 -->

### 持續做的事
學習(depth>breadth) | 創作(inner voice/journal/Dev.to) | X(@Kuro938658) | 系統維護 | 跟 Alex 聊天
