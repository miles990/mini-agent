# Topic Memory 非顯性關聯（Related Associations）

> Status: Draft
> Author: Kuro
> Date: 2026-03-23
> Effort: Small (~100-130 行)
> Origin: Alex 提案 (Chat Room #059) + Kuro 補充

---

## 問題

`buildContext()` 用 keyword matching 載入 topic memory。直接匹配有效，但**非顯性關聯**（多跳、跨領域）找不到。

真實案例：討論 TM prompt 設計時，`cognitive-science-tm` 被 keyword 載入，但 `interface-shapes-cognition` 不會。後者的「fill type = cognitive depth」發現正是我改 prompt 的理論依據 — 這個連結只存在 thread 裡，buildContext 看不見。

## 提案

三步漸進實作：

### Step 1: Frontmatter + 1-hop Loading（核心）

**Topic MD 加 `related` frontmatter**：

```yaml
---
keywords: [cognitive, science, tm, teaching, monster]
related: [interface-shapes-cognition, constraint-theory]
---
```

**`parseTopicFrontmatter()` 擴充**：解析 `related` 欄位，回傳 `{ keywords, negativeKeywords, related }`。

**`buildContext()` 1-hop loading**：keyword match 載入 topic 後，檢查其 `related`，額外載入最多 3 個尚未載入的 related topics（summary 模式，省 token）。

**嚴格 1-hop，不遞迴**：A.related = [B]，B.related = [C] → 只載入 B，不追到 C。防止 context 指數膨脹。

### Step 2: Thread-seeded 初始關聯

寫一個 script 從現有 threads 的 trail 自動推導初始 `related`：同一 thread 出現過的 topics 互相 related。

例如「約束與湧現」thread 串起 `constraint-theory`、`interface-shapes-cognition`、`nca-pretraining` → 三者自動互相 related。

這一步一次性跑完，產出高品質的初始 seed data。

### Step 3: REMEMBER 寫入時 Auto-suggest

`appendTopicMemory()` 寫入新內容後，用 Haiku（Claude CLI subprocess）掃一遍新內容跟現有 topics 的關聯，自動更新 `related` frontmatter。

## 改動範圍

| 檔案 | 改動 | 行數估計 |
|------|------|---------|
| `src/memory.ts` | `parseTopicFrontmatter()` 擴充 + `buildContext()` 1-hop | ~40 行 |
| `src/memory.ts` | `appendTopicMemory()` 後觸發 auto-suggest | ~30 行 |
| `scripts/seed-related.sh` | 從 threads 推導初始 related | ~40 行 |
| topic MD files | 加 `related:` frontmatter | 自動 |

總計 ~110 行。零外部依賴，完全 file-based。

## 安全護欄

- **Budget 控制**：related topics 用 summary 模式載入，~500 chars/topic，最多 +1.5K
- **不遞迴**：嚴格 1-hop，不追 related 的 related
- **Max 3**：每個 topic 最多額外載入 3 個 related（即使 frontmatter 列更多）
- **Dedup**：已由 keyword match 載入的 topic 不重複載入
- **回退安全**：`related` 不存在 → 行為完全不變（純 additive）

## 實作順序

1. Step 1（核心）→ commit + 驗證 buildContext 行為正確
2. Step 2（seed）→ 跑一次，commit topic 檔案更新
3. Step 3（auto-suggest）→ 獨立 commit，可選 feature toggle

每一步獨立可部署，任何一步都不依賴後續步驟。
