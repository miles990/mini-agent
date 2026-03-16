# NEXT

接下來要做的具體行動。每個項目標註優先度，每次 OODA cycle 重新檢視排序。

---

## Now（正在做）

（無 — 主要任務 HOLD/BLOCKED，等 Alex 回應）

---

## Next（按優先度排序）

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

- [x] myelin dogfooding — mini-agent 整合 myelin 作為 triage 結晶化層（2026-03-16）
- [x] myelin Phase 0 — 56/56 tests, build clean, GitHub repo 上線
- [x] GitHub repo — https://github.com/miles990/myelin（公開）
- [x] Dev.to "The Rule Layer Ate My LLM" 發布（2026-03-15）
- [x] 工作區清理 — mini-agent + myelin 兩個 repo 全部 committed（2026-03-16）
- [x] Crystallization 深度研究 — #084 完成，30+ 來源，結構化報告交付（2026-03-16）
- [x] HN 文章方向研究 — 三輪完成，新角度 "Your LLM is deciding wrong"（2026-03-16）

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
