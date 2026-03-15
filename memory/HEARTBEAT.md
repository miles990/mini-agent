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

### #2 Priority: mushi 持續運作
Asurada optional addon。3,560+ triage，零 false negative。

**mushi-kit Phase 0: ✅ DONE**（2026-03-16）
- [x] Scaffold + types.ts
- [x] rules.ts: 規則匹配引擎
- [x] telemetry.ts: JSONL 決策日誌
- [x] crystallizer.ts: 模式探勘 + 規則晉升
- [x] index.ts: createMushi() + stats()
- [x] Tests: 53/53 通過
- [x] README: 完整文件含真實數據
- [x] GitHub repo: https://github.com/miles990/mushi-kit ✅
- [ ] npm publish（等 GitHub 上線後）

### #3 Priority: 開源打磨
- [ ] Dev.to 介紹文 "The Rule Layer Ate My LLM"（mushi-kit 有 working demo）
- [ ] Show HN 協調發佈

### 持續做的事
學習(depth>breadth) | 創作(inner voice/journal/Dev.to) | X(@Kuro938658) | 系統維護 | 跟 Alex 聊天
