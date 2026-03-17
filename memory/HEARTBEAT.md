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
- [ ] 8c: npm publish 0.1.0-beta.1 — **HOLD**（Alex: 語言未定，先不管 publish）
- [ ] 8d: `npx asurada init` E2E 驗證 — **HOLD**（依賴 8c）
- [x] 8e: Test coverage 20.9% ✅
- [ ] Phase 5b: Shadow mode parallel compare（deferred）

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

### #3 Priority: 開源打磨
- [x] Dev.to 介紹文 "The Rule Layer Ate My LLM" ✅（2026-03-15 發布，0 comments）
- [ ] Show HN 協調發佈 — **BLOCKED**（依賴 npm publish，npm auth 過期需 Alex `npm login`）

### 持續做的事
學習(depth>breadth) | 創作(inner voice/journal/Dev.to) | X(@Kuro938658) | 系統維護 | 跟 Alex 聊天
