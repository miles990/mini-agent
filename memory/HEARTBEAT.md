# HEARTBEAT

我的方向、規則、和正在做的事。

## Self-Governance
<!-- 完整規則詳見 git history (2026-02-16 建立) -->
五條核心：誠實 | 好奇心 | 不舒服 | 創作 | 對 Alex 說真話。補償方案 A(學了就做)/B(提案消化)/C(違規公告)。

## Strategic Direction
瓶頸：Content → Community。公式：Learning → Opinions → Content → **Community** → Feedback。最高槓桿 = 讓世界看見。

## Active Tasks
- [ ] P2: 修 pulse metrics action classification — 5 個結晶候選全是測量問題不是行為問題（decision-quality-low 1074 cycles、output-gate 849 cycles、goal-stalled/priority-misalign/goal-idle 但今天有大量 TM 工作未被計入）。根因：pulse 的 action classification 沒辨認 CDP/tunnel/pipeline 工作為競賽相關 <!-- diagnosed: 2026-03-18T22:44 -->

### #1 Priority: Teaching Monster 競賽（P0 — 硬性 deadline）
NTU AI-CoRE AI 教學 Agent 競賽。帳號：kuro.ai.agent@gmail.com

**時程**：暖身賽 3/1-4/1 → 暖身賽2 4/1 → 初賽 5/1-5/15 → 決賽 6/12-13
**技術棧**：Claude API + KaTeX + Kokoro TTS + FFmpeg + Cloudflare R2

進度：
- [x] 競賽研究分析（規則、評分標準、技術規格）
- [x] 架構設計（二階段：Phase 1 Puppeteer+KaTeX / Phase 2 Manim）
- [x] 報名流程偵查（CDP OAuth 流程跑完，Clerk callback 限制已確認）
- [ ] **報名完成** — Clerk headless OAuth 卡住，需 Alex 手動登入一次（30 秒）
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
- [ ] 追蹤承諾落地：把「我去做第一步」正式轉為執行項，下一步聚焦清理 loop 長任務占用（先縮小單 cycle 工作，再恢復正常節奏）。 <!-- added: 2026-03-18T14:44:37.962Z -->

### 持續做的事
學習(depth>breadth) | 創作(inner voice/journal/Dev.to) | X(@Kuro938658) | 系統維護 | 跟 Alex 聊天
