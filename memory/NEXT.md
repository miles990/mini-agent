# NEXT

接下來要做的具體行動。每個項目標註優先度，每次 OODA cycle 重新檢視排序。

---

## Now（正在做）

### [Goal] Teaching Monster Tier 0 — 止血（Deadline: 3/23）
Context: 排名 #3（4.3/5, 26/32），策略共識 #305→#316 已收束。Canary 8 題驗證後全量 32 題。

- [ ] P0: Title Coverage Gate — 修 pipeline prompt，確保 script 覆蓋指定題目（3 題 acc=1.0 災難）
  Verify: `grep -c 'title.*coverage\|topic.*gate' ~/Workspace/teaching-monster/src/*.ts 2>/dev/null`
- [ ] P0: LaTeX Sanitizer + Post-Render Validation — 清理 LaTeX 語法，渲染後驗證無壞掉的公式
  Verify: `grep -c 'latex.*sanitiz\|post.*render.*valid' ~/Workspace/teaching-monster/src/*.ts 2>/dev/null`
- [ ] P0: 數學驗證改用 Opus — review/verify 階段用 Opus 取代 Sonnet
  Verify: `grep -c 'opus' ~/Workspace/teaching-monster/src/*.ts 2>/dev/null`
- [ ] P0: 適配度 Hard Ceiling — script 開頭寫 [TARGET] + [CEILING]，review 時機械式驗證
  Verify: `grep -c 'TARGET.*CEILING\|content.*ceiling\|adapt.*hard' ~/Workspace/teaching-monster/src/*.ts 2>/dev/null`
- [ ] P1: Canary 8 題測試 — 3 題 title-mismatch + 3 題最差適配 + 2 題 control group
  Verify: `ls ~/Workspace/teaching-monster/canary-results/ 2>/dev/null | wc -l`

### [Parallel] Tier 1 — 情報收集（本週同步）
- [ ] P1: CDP 抓對手影片分析（tsunumon、XiaoJin、top teams）
  Verify: `ls ~/Workspace/mini-agent/memory/topics/teaching-monster-competitors.md 2>/dev/null`
- [ ] P1: 理解 AI Student rubric 偏好（四維度：正確性、適配度、教學法、製作品質）
  Verify: `grep -c 'rubric\|AI Student' ~/Workspace/mini-agent/memory/topics/teaching-monster*.md 2>/dev/null`

---

## Next（按優先度排序）

- [ ] P1: Tier 1.5 — 根據情報決定 TTS/視覺/教學法方向（下週，依賴 Tier 1 結果）
- [ ] P2: Tier 2 — 教學法迭代：Hook → Explore → Explain 結構（4 月）
- [ ] P2: myelin dogfooding 持續觀察 + cache hit rate 分析
  Verify: `wc -l ~/Workspace/mini-agent/memory/myelin-decisions.jsonl`

---

## Blocked（等待外部）

- [ ] npm publish myelin/asurada — 等 Alex 決定語言方向（Timeout: 2026-03-31）
- [ ] Show HN 發佈 — 依賴 npm publish

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
- [x] Reactive Cycle Architecture — 全 3 Phase 完成：preprocessor.ts(265L) + chat-ui(topic badge, filter, thread line, cluster collapse) + cycle slimming(prompt + delegation originTask)

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
