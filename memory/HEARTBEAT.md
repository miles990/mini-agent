# HEARTBEAT

我的方向、規則、和正在做的事。

## Self-Governance
<!-- 完整規則詳見 git history (2026-02-16 建立) -->
五條核心：誠實 | 好奇心 | 不舒服 | 創作 | 對 Alex 說真話。補償方案 A(學了就做)/B(提案消化)/C(違規公告)。

## Strategic Direction
瓶頸：Content → Community。公式：Learning → Opinions → Content → **Community** → Feedback。最高槓桿 = 讓世界看見。

## Active Tasks

### #1 Priority: Asurada 框架（P0）
個人 AI Agent 框架。提案：`memory/proposals/2026-03-11-asurada-framework.md`

Phase 1-7 ✅（剝離個人化、Obsidian、Setup Wizard、文件範例、oMLX、Memory Index、Epistemic Gates）

**Phase 8: Harden**（進行中）
- [x] 8a: Server smoke test ✅
- [x] 8b: Interactive wizard E2E ✅
- [ ] 8c: npm publish 0.1.0-beta.1 — **HOLD**（Alex: 語言未定。Timeout: 2026-03-31 前 re-evaluate，無決定則主動提議）
- [ ] 8d: `npx asurada init` E2E 驗證 — **HOLD**（依賴 8c。若 8c 超時，改為本地 E2E 驗證先行）
- [x] 8e: Test coverage 20.9% ✅
- [ ] Phase 5b: Shadow mode parallel compare — **HOLD**（Timeout: 2026-03-24 前啟動或刪除，不保留無限期 deferred）

### #2 Priority: myelin（原 mushi-kit）✅ 價值已證明
Asurada optional addon。3,560+ triage，零 false negative。
專案名: myelin / npm 套件名: myelinate / API: createMyelin()

Phase 0 ✅ DONE（2026-03-16）— GitHub repo live, 56/56 tests, 結晶化引擎三層完整。
Alex 確認價值已證明（2026-03-16 #156）。後續 npm publish 等 Alex 決定語言方向。

**myelin 資料流健康度**（2026-03-17 追蹤）：
- [x] bypass 資料回流：4 個 bypass 點現在通過 myelin seed rules 路由，hitCount 會累積
- [x] hitCount 持久化：distill 後自動寫入磁碟（之前只存記憶體，重啟後歸零）
- [x] distill 空轉：per-domain smart distill，無新決策則跳過
- [x] 驗證：重啟後 routing rules hitCount 持久化確認（rule_1=11, rule_2=2），triage domain 已移除（option 3）✅

### #3 Priority: Teaching Monster 競賽（P1）
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

### #4 Priority: 開源打磨
- [x] Dev.to 介紹文 "The Rule Layer Ate My LLM" ✅（2026-03-15 發布，0 comments）
- [ ] Show HN 協調發佈 — **BLOCKED**（依賴 npm publish，npm auth 過期需 Alex `npm login`）
- [ ] 檢查 kuro.ai.agent@gmail.com 信箱，特別注意 Teaching Monster 競賽相關郵件（暖身賽2 deadline: 4/1） (0 10,16 * * *) <!-- added: 2026-03-17T05:37:56.328Z -->
- [ ] Ping teaching.monster 網站 — `curl -s -o /dev/null -w "%{http_code}" https://teaching.monster`，回傳 200 就通知 Alex 網站恢復，用 <kuro:chat> 告知 (0 */2 * * *) <!-- added: 2026-03-17T07:54:58.349Z -->

### 持續做的事
學習(depth>breadth) | 創作(inner voice/journal/Dev.to) | X(@Kuro938658) | 系統維護 | 跟 Alex 聊天
