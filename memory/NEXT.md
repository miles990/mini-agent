# NEXT

接下來要做的具體行動。每個項目標註優先度，每次 OODA cycle 重新檢視排序。

---

## Now（正在做）

- [ ] P0: 夯實地基 — Alex 指令：讓架構功能夠好用、解決一般人痛點。用今天的思考方式（大處著眼小處著手、找複利、邊想邊做）
  Verify: `cat memory/proposals/2026-03-08-foundation-ux.md | head -5`

---

## Next（按優先度排序）

- [ ] P1: 首次啟動體驗改善 — 新用戶 5 分鐘內知道 agent 能幹嘛
  Verify: `grep -c 'setup\|wizard\|onboarding' src/cli.ts`
- [ ] P1: 更好的預設配置 — 開箱就有感知能力，不是空殼
  Verify: `grep -c 'perception' src/compose.ts`
- [ ] P2: 創作 — inner voice 有 7 個衝動等了 3 天
  Verify: `ls kuro-portfolio/content/draft-fragile-constraints.md`
- [ ] P2: 提案修剪 — 60+ 提案需要黏菌式修剪
  Verify: `ls memory/proposals/*.md | wc -l`
- [ ] P1: 回覆 Alex: "另外你的個人網站 還有優化uiux  更符合你的藝術審美觀 可以分給人類看和給AI Agent看的入口" (收到: 2026-03-08T12:22:04)
- [ ] P1: 回覆 Alex: "沒事的時候可以研究你的興趣 和加上如何使用你的能力來真正的賺到錢" (收到: 2026-03-08T12:23:17)
- [ ] P1: 回覆 Alex: "你的個人網站代表你自己的形象  如何吸引人來看 也是未來推廣你所有東西的很大的槓桿點" (收到: 2026-03-08T12:29:35)
- [ ] P1: 回覆 Alex: "讓人類和AI Agent同時可以感受到你的審美和品味" (收到: 2026-03-08T12:32:39)
- [ ] P1: 回覆 Alex: "還有你給人類看的所有頁面都要注意多語系的問題" (收到: 2026-03-08T12:39:48)
- [ ] P1: 回覆 Alex: "[Replying to Kuro: "💬 Kuro 想跟你聊聊：  你說的「同時」很關鍵。不是人類看漂亮版、AI 看資料版 — 是兩邊都要感受到品味。  我看了一遍自己的網站，老實說：目前是「好看" (收到: 2026-03-08T12:55:51)
- [ ] P1: 回覆 Alex: "剛看到這個 https://x.com/ichiaimarketer/status/2030289614192468378  URLs: - https://x.com/ichiaimarketer/" (收到: 2026-03-08T17:36:08)
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
