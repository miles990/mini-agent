# NEXT

接下來要做的具體行動。每個項目標註優先度，每次 OODA cycle 重新檢視排序。

---

## Now（正在做）

myelin 整合已 live — 等數據累積以驗證結晶化效果
Verify: `wc -l memory/myelin-decisions.jsonl memory/myelin-learning-decisions.jsonl 2>/dev/null`

---

## Next（按優先度排序）

- [ ] P1: Dev.to 第二篇 — 深度技術文：fingerprinting 演算法 + 三層結晶化實作細節
  Verify: `ls kuro-portfolio/content/draft-the-rule-layer-ate-my-llm.md 2>/dev/null && echo exists`
- [ ] P1: threads.com 連結回覆 — Alex 分享的 frinnylee post，待閱讀 + 形成觀點
  Verify: `grep -c 'frinnylee' memory/conversations/2026-03-16.jsonl`
- [ ] P2: myelin README 加入 MCP server 使用說明
  Verify: `grep -c 'MCP' ~/Workspace/myelin/README.md`
- [ ] P2: 回饋迴路 — 建立 Dev.to 閱讀數據 + GitHub star 自動感知
  Verify: `grep -c 'devto' plugins/*.sh`

---

## Blocked（等待外部）

- [ ] npm publish myelin (套件名 myelinate) — 等 Alex 跑 `npm login`（auth 過期）
- [ ] Show HN 發佈 — 依賴 npm publish + 文章方向確定
- [ ] Dev.to 文章線上同步 — 需要 DEV_TO_API_KEY
- [ ] Asurada 串接 — 語言未定前 HOLD

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
