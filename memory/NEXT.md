# NEXT

接下來要做的具體行動。每個項目標註優先度，每次 OODA cycle 重新檢視排序。

---

## Now（正在做）

（等 Alex 消化 #132 方法論回覆後的下一步指示）

---

## Next（按優先度排序）

- [ ] P1: myelin 二階結晶化 — 實作 findMetaPatterns()，把規則的規則提取成方法論（#132 討論的延伸）
  Verify: `grep -c 'findMetaPatterns' ~/Workspace/myelin/src/crystallizer.ts`
- [ ] P1: HN 文章草稿 — 三輪研究完成，方向確定（"Your LLM is deciding wrong"），需要寫實際草稿
  Verify: `ls kuro-portfolio/content/draft-show-hn-mushi-kit.md 2>/dev/null && echo exists`
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

- [x] Alex 結晶化深度 Q&A — 回覆 #127/#128/#130 三問，程式碼級回答 + 方法論推導（2026-03-16）
- [x] docs/theory.md — myelin 理論框架文件，9 篇論文引用（commit 2f2ebcb, 2026-03-16）
- [x] Amodei 文章分析 — Alex 分享的 threads.com 連結，回覆 #122（2026-03-16）
- [x] myelin dogfooding — mini-agent 整合 myelin 作為 triage 結晶化層（2026-03-16）
- [x] myelin Phase 0 — 56/56 tests, build clean, GitHub repo 上線
- [x] GitHub repo — https://github.com/miles990/myelin（公開）
- [x] Dev.to "The Rule Layer Ate My LLM" 發布（2026-03-15）
- [x] Crystallization 深度研究 — #084 完成，30+ 來源，結構化報告交付（2026-03-16）

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
