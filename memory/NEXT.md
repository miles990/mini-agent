# NEXT

接下來要做的具體行動。每個項目標註優先度，每次 OODA cycle 重新檢視排序。

---

## Now（正在做）

- [ ] P1: loop.ts 模組化拆分 — 3,413 行單體文件，槓桿點（複利：可測試 + 迭代速度 + 可讀性）
  第一刀已完成：inbox processing 提取到 inbox-processor.ts（c2b9c6a）
  下一刀：計劃共 5 刀，繼續提取 standalone functions
  Verify: `wc -l src/loop.ts | awk '{print $1}'`

---

## Next（按優先度排序）

- [ ] P2: Cognitive Mesh 接通 — buildContextForPerspective 實作 + mushi /api/route endpoint
  Verify: `grep -n 'buildContextForPerspective' src/perspective.ts | head -3`

---

## Later（有空再做）

- [ ] P3: 變現探索 — Cold Email Reviewer Bot 或其他路徑（Alex: 先打好基礎） @created: 2026-02-18
  Done when: 有具體 MVP 規格
  Verify: ls memory/proposals/*monetiz* 2>/dev/null | head -1

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
