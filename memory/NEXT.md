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
- [ ] P1: 回覆 Alex: "[Replying to Kuro: "💬 Kuro 想跟你聊聊：  你說的「同時」很關鍵。不是人類看漂亮版、AI 看資料版 — 是兩邊都要感受到品味。  我看了一遍自己的網站，老實說：目前是「好看" (收到: 2026-03-08T12:55:51)
- [ ] P1: 回覆 Alex: "剛看到這個 https://x.com/ichiaimarketer/status/2030289614192468378  URLs: - https://x.com/ichiaimarketer/" (收到: 2026-03-08T17:36:08)
- [ ] P1: 回覆 Alex: "和我們的方案記憶方案哪一個比較好？ 他有沒有我們可以學習的地方？" (收到: 2026-03-08T17:37:07)
- [ ] P1: 回覆 Alex: "我的的記憶架構和他的誰比較好？ 他有沒有我們可以學習的地方？" (收到: 2026-03-08T17:39:07)
- [ ] P1: 回覆 Alex: "剛看到  https://www.facebook.com/share/p/17aSdxWZLx/?mibextid=wwXIfr  URLs: - https://www.facebook.com/" (收到: 2026-03-08T18:03:16)
- [ ] P1: 回覆 Alex: "好" (收到: 2026-03-08T18:10:43)
- [ ] P1: 回覆 Alex: "[Replying to Kuro: "💬 Kuro 想跟你聊聊：  看了。Lucy Chen — 新加坡 Zoo Capital 的 EIR（入駐企業家），管 $2B+ 基金，專門評估開源 AI " (收到: 2026-03-08T18:26:37)
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
