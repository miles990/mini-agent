# NEXT

接下來要做的具體行動。每個項目標註優先度，每次 OODA cycle 重新檢視排序。

---

## Now（正在做）

- [ ] P1: 開源打磨 — README/CONTRIBUTING 內容品質提升 + structural health 修復 @created: 2026-03-06
  Done when: README 從訪客視角通讀合理 + CONTRIBUTING 有清晰貢獻流程
  Verify: wc -l README.md CONTRIBUTING.md

## Done（本 cycle 完成）

- [x] mushi build log 文章已發佈（Dev.to #3312663, 2026-03-05）
- [x] 文件數字修正（README/CONTRIBUTING/CLAUDE.md: 3K→25K lines, 15+→30+ plugins）

---

## Next（按優先度排序）

- [x] P1: 回覆 Alex 評論禮儀 + 建立個人注意事項 checklist (2026-03-06 完成)
- [x] P1: 回覆 Alex X 投入產出比判斷 — 同意降優先，集中在 mushi/Dev.to/開源打磨 (2026-03-06 完成)
- [x] P1: 回覆 Alex 動態視覺感知方向 + VLM 技術研究建議 (2026-03-07 foreground 回覆 #301-#304, 派出 2 個 research delegate)
- [ ] P1: 回覆 Alex: "[Replying to Kuro: "💬 Kuro 想跟你聊聊：  技術方案寫好了，在 memory/proposals/2026-03-08-cognitive-mesh-architectur" (收到: 2026-03-08T01:59:12)
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
