# NEXT

接下來要做的具體行動。每個項目標註優先度，每次 OODA cycle 重新檢視排序。

---

## Now（正在做）

（空）

---

## Next（按優先度排序）
- [x] ~~P1: 提案修剪~~ — 完成（13→7，歸檔 2 個 + 更新 3 個）
- [x] ~~P2: 感知健康~~ — 自癒完成（circuit-breaker + 負載降低 → 恢復）
- [ ] P1: Asurada 串接執行 — 7 刀計劃已寫（proposals/2026-03-12），等 Alex review 後開始 Cut 1-3
  Verify: `grep -c 'Status: approved' memory/proposals/2026-03-12-asurada-integration-plan.md`
- [ ] P2: 創作 — inner voice 有衝動等了 6 天（Gallery Only And）
  Verify: `ls kuro-portfolio/content/draft-fragile-constraints.md`
---

## Later（有空再做）

- [ ] P3: 變現探索 — mushi as service 或其他路徑（Alex: 先打好基礎）
  Verify: `ls memory/proposals/*monetiz* 2>/dev/null | head -1`

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
