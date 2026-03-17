# NEXT

接下來要做的具體行動。每個項目標註優先度，每次 OODA cycle 重新檢視排序。

---

## Now（正在做）

- [ ] P0: Teaching Monster Phase 1 pipeline 開發（Claude API → KaTeX → TTS → FFmpeg）
  Verify: `ls ~/Workspace/teaching-monster/src/*.ts 2>/dev/null | wc -l`
- [ ] P1: Reactive Cycle Architecture 實作（Phase 1: Event Emission + Chat-UI）
  Verify: `grep -c 'emitEvent' ~/Workspace/mini-agent/src/loop.ts`

---

## Next（按優先度排序）

- [ ] P1: Teaching Monster 暖身賽提交（deadline: 4/1）
  Verify: `curl -s -o /dev/null -w "%{http_code}" https://teaching.monster`
- [ ] P2: 研究大金老師教學影片 + 教學法技巧應用到 pipeline
  Verify: `grep -c 'Scenario-First' ~/Workspace/teaching-monster/src/*.ts 2>/dev/null`
- [ ] P2: myelin dogfooding 持續觀察 + cache hit rate 分析
  Verify: `wc -l ~/Workspace/mini-agent/memory/myelin-decisions.jsonl`

---

## Blocked（等待外部）

- [ ] npm publish myelin/asurada — 等 Alex 決定語言方向（Timeout: 2026-03-31）
- [ ] Show HN 發佈 — 依賴 npm publish
- [ ] Teaching Monster 報名 — Clerk headless OAuth 卡住，需 Alex 手動登入一次（30秒）

---

## Done（本週完成）

- [x] 三層結晶化閉環 — templates.ts + methodology.ts + feedback-loop.ts（commit becc1a7 + 7f2e052, 104 tests）
- [x] Show HN 文章 v3 — 競品差異化 + 三層故事 + 數字標題（commit 658742a）
- [x] myelin 正式整合到 mini-agent — myelin-integration.ts(249L) + research-crystallizer.ts(451L) + small-model-research.ts，build clean，0 rules（等數據）
- [x] README 學術引用凸顯 — 頂部 callout + 表格升級（commit a6eeb67）
- [x] Alex 結晶化深度 Q&A — #127/#128/#130/#132/#133/#136/#137/#139 全部回覆（Chat Room + code）
- [x] docs/theory.md — myelin 理論框架，9 篇論文引用（commit 2f2ebcb）
- [x] Amodei 文章分析 — threads.com 連結，結晶化=安全機制的觀點
- [x] myelin Phase 0 — 104/104 tests, build clean, GitHub repo 上線
- [x] Dev.to "The Rule Layer Ate My LLM" 發布（2026-03-15）
- [x] Crystallization 深度研究 — #084 完成，30+ 來源，結構化報告交付
- [x] myelin feedback plan L1-L5 全實作 — 16 項反饋，126 tests pass（commit c1c606a）
- [x] task-queue 衛生清理 — 95 tasks 全部 resolved，0 pending

---

## Later（有空再做）

- [ ] P3: 創作 — inner voice 有 11 個衝動等待表達
  Verify: `ls kuro-portfolio/content/draft-fragile-constraints.md`

---

## 規則

### 1. 優先度規則
- **P0**: 緊急且重要（影響系統運作）
- **P1**: 重要不緊急（本週應該推進）
- **P2**: 一般優先度（有空再做）
- **P3**: 低優先度（想法備忘）

### 2. 動態調整
- 每次 OODA cycle 檢視 "Now" 和 "Next" sections
- 根據當前狀況重新排序
- "Now" 空了就從 "Next" 挑最高優先度的開始

### 3. 完成即刪除
- 完成的任務從清單移除
- 重要成果記錄到 MEMORY.md 或 topics/*.md

### 4. 保持簡短
- **Now**: 最多 1 個（專注）
- **Next**: 最多 5 個
- **Later**: 不限但定期清理

### 5. 完成標準必須嚴格
- 每個 Done when 要有可驗證的產出
- 必須附 Verify 命令
