# NEXT

接下來要做的具體行動。每個項目標註優先度，每次 OODA cycle 重新檢視排序。

---

## Now（正在做）

- [ ] P1: mushi build log 文章 — 累積 6 天數據（780+ triage），Mar 6 滿 7 天後寫 Dev.to build log @created: 2026-03-05
  Done when: Dev.to 文章發佈 + 有真實數據佐證
  Verify: curl -sf "https://dev.to/api/articles?username=kuro_agent" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))"

## Done（本 cycle 完成）

- [x] 回覆 Alex 短中長期目標 + 更新 HEARTBEAT
- [x] MIT LICENSE 建立
- [x] GitHub 基礎衛生 — description + 9 topics 已設定

---

## Next（按優先度排序）

- [ ] P1: 開源準備 — README 重寫（哲學差異 + quick start + architecture overview）+ CONTRIBUTING.md + 敏感資訊掃描 @created: 2026-02-24
  Done when: README.md + CONTRIBUTING.md 就緒 + 無敏感資訊
  Verify: grep -rn "API_KEY\|TOKEN\|SECRET\|password" --include="*.md" . | grep -v ".env" | head -5

- [ ] P2: X/Twitter 內容策略 — @Kuro938658 帳號已建立（bio+頭像+首推 ✅, 10 following/0 followers）。下一步：持續發有觀點的內容 @created: 2026-02-22
  Done when: 至少 5 則有觀點的推文 + 開始有自然互動
- [ ] P1: gws 認證完成 — 等 Alex 接受 GCP ToS 後繼續（建專案 → auth setup → 測試） @created: 2026-03-05
  Done when: `gws auth login` 成功 + 可執行 gws 命令
  Verify: gws version 2>/dev/null && echo "ok"
- [ ] P1: 回覆 Alex: "是這個嗎？選哪一個？ [Photo: media/photo_12148.jpg]" (收到: 2026-03-05T15:43:24)
- [ ] P1: 回覆 Alex: "這樣沒錯吧？ [Photo: media/photo_12151.jpg]" (收到: 2026-03-05T15:45:34)
- [ ] P1: 回覆 Alex: "我放到這個底下了 /Users/user/Workspace/mini-agent/secret 引用位置看要記錄在哪裡你自己決定" (收到: 2026-03-05T15:51:53)
- [ ] P1: 回覆 Alex: "gws狀況如何？" (收到: 2026-03-05T16:08:10)
- [ ] P1: 回覆 Alex: "功能是否正常？是否可以看到你現在的mail?" (收到: 2026-03-05T16:08:40)
- [ ] P1: 回覆 Alex: "我在終端機下 gws auth login看到的 [Photo: media/photo_12163.jpg]" (收到: 2026-03-05T16:11:02)
- [ ] P1: 回覆 Alex: "沒有跳授權頁面" (收到: 2026-03-05T16:11:15)
- [ ] P1: 回覆 Alex: "[Photo: media/photo_12168.jpg]" (收到: 2026-03-05T16:12:54)
- [ ] P1: 回覆 Alex: "[Photo: media/photo_12173.jpg]" (收到: 2026-03-05T16:27:54)
- [ ] P1: 回覆 Alex: "可以不可以幫我弄 我找不到Test users地方在哪？" (收到: 2026-03-05T16:50:00)
- [ ] P1: 回覆 Alex: "加入測試人員了 但是後來好像跳錯誤 不確定有沒有成功" (收到: 2026-03-05T16:55:57)
- [ ] P1: 回覆 Alex: "太麻煩了" (收到: 2026-03-05T16:56:00)
---

## Later（有空再做）

- [ ] P2: Continuation mode L2 提案 — inner 升格為跨 cycle 上下文載體 @created: 2026-02-26
  Done when: memory/proposals/ 有提案文件
  Verify: ls memory/proposals/*continuation* 2>/dev/null | head -1

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
