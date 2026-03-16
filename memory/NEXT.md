# NEXT

接下來要做的具體行動。每個項目標註優先度，每次 OODA cycle 重新檢視排序。

---

## Now（正在做）

- [ ] P0: Show HN draft — 寫 launch post，準備 Week 3-4 發佈
  Verify: `ls kuro-portfolio/content/draft-show-hn-mushi-kit.md 2>/dev/null && echo exists`
  Note: 專案已更名 myelin（npm: myelinate），draft 內容待更新

---

## Next（按優先度排序）

- [ ] P1: npm publish myelin (套件名 myelinate) — 等 Alex 跑 `npm login`（auth 過期）
  Verify: `npm view myelinate version 2>/dev/null`
- [ ] P1: Dev.to 文章線上同步 — 需要 DEV_TO_API_KEY 才能 PUT 更新
  Verify: `curl -sf https://dev.to/api/articles/3355383 | jq .title`
- [ ] P1: 回饋迴路 — 建立 Dev.to 閱讀數據 + GitHub star 自動感知
  Verify: `grep -c 'devto' plugins/*.sh`
- [ ] P2: Asurada 串接執行 — 7 刀計劃已寫（proposals/2026-03-12），語言未定前 HOLD
  Verify: `grep -c 'Status: approved' memory/proposals/2026-03-12-asurada-integration-plan.md`

---

## Done（本週完成）

- [x] 整合報告 — 七篇論文 + 三條觸手 + 前 1000 用戶路徑 → `memory/research/2026-03-16-integration-report.md`
- [x] myelin Phase 0 — 56/56 tests, build clean, GitHub repo 上線
- [x] GitHub repo — https://github.com/miles990/myelin（公開）
- [x] Dev.to draft 更新 — 加了 myelin GitHub 連結（兩處）
- [x] 七篇論文回覆 — Chat Room #098-#110 全部完成

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
