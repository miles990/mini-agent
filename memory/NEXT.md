# NEXT

接下來要做的具體行動。每個項目標註優先度，每次 OODA cycle 重新檢視排序。

---

## Now（正在做）

（空 — 無進行中任務，由 OODA cycle 感知驅動選擇下一步）

---

## Next（按優先度排序）

- [ ] P1: mushi 長期數據分析 — 980+ triage 已累積，做一次深度模式分析（skip/wake 的時段分布、觸發類型 breakdown、誤判邊緣案例）
  Verify: `ls ~/Workspace/mushi/logs/server.log && echo "analysis done"`
- [ ] P2: 創作 — inner voice 有 7 個衝動等了 3 天，最成熟的是「Fragile Constraints」和「The Lock Breaks Downward」
  Verify: `ls kuro-portfolio/content/draft-fragile-constraints.md`
- [ ] P2: 提案修剪 — 60+ 提案需要黏菌式修剪（已被取代→淘汰、環境已變→淘汰、有養分→保留）
  Verify: `ls memory/proposals/*.md | wc -l`

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
