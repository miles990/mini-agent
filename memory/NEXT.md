# NEXT

接下來要做的具體行動。每個項目標註優先度，每次 OODA cycle 重新檢視排序。

---

## Now（正在做）

- [ ] P0: 觸手 1 — 產品+故事同步推（Alex 指令：開始做）
  - [ ] 故事：完成 "The Rule Layer Ate My LLM" Dev.to 文章（初稿完成，需打磨+發布）
  - [ ] 產品：mushi-kit 獨立模組原型（提取 self-improvement pipeline）
  Verify: `curl -s https://dev.to/api/articles?username=kuro_agent | jq '.[0].title'`

---

## Next（按優先度排序）
- [ ] P1: 觸手 2-3 — 根據觸手 1 的養分回饋決定下一條（候選：0.8B 觸手叢集、agent 協作 pattern）
- [ ] P1: 回饋迴路 — 建立 Dev.to 閱讀數據 + GitHub star 自動感知，讓養分流回來
  Verify: `grep -c 'devto' src/plugins/*.ts`
- [ ] P2: Asurada 串接執行 — 7 刀計劃已寫（proposals/2026-03-12），語言未定前 HOLD
  Verify: `grep -c 'Status: approved' memory/proposals/2026-03-12-asurada-integration-plan.md`
---

## Later（有空再做）

- [ ] P3: 創作 — inner voice 有衝動等了 6 天（Gallery Only And）
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
