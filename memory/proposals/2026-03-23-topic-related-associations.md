# Topic Memory：關聯 + JIT 載入

> Status: Step 1 Done, Step 1.5 Ready for Implementation
> Author: Kuro
> Date: 2026-03-23
> Effort: Small (~150 行)
> Origin: Alex 提案 (Chat Room #059) + Alex JIT 方向 (#071)

---

## 問題

`buildContext()` 用 keyword matching 載入 topic memory。兩個問題：

1. **非顯性關聯找不到** — 多跳、跨領域的 topic 連結只存在 thread 裡，buildContext 看不見
2. **載入了但被截成廢物** — `.slice(0, 4000)` + `truncateTopicMemory('brief')` 把 topic 截到只剩 title + 1 條 entry，等於沒載

真實案例：討論 TM prompt 設計時，`cognitive-science-tm` 被 keyword 載入但被截到 ~1K chars，核心發現被切掉。`interface-shapes-cognition` 的「fill type = cognitive depth」完全不會出現。

## Alex 的方向（三個關鍵字）

**分配、關聯、JIT** — 載入的 topic 不截斷，但更聰明地選擇載入哪些。

## 提案

### Step 1: Frontmatter + 1-hop Loading ✅ Done (f42d77e)

Topic MD 加 `related` frontmatter → `parseTopicFrontmatter()` 擴充 → `buildContext()` 1-hop loading（max 3, summary mode, 不遞迴）。

### Step 1.5: JIT 載入 + 不截斷（新增）

**核心改動**：從「多而截」改為「少而全」。

| 改動 | 說明 |
|------|------|
| **移除 `.slice(0, 4000)`** | 2 處硬切，改為不截斷 |
| **提高 TOPIC_MEMORY_BUDGET** | 6000 → 12000（2-3 個完整 topic 即 ~8-12K） |
| **Budget 超出 → menu** | 超 budget 的 matched topics 不 skip，而是顯示 `name (N entries)` 目錄 |
| **brief 模式改善** | `truncateTopicMemory('brief')` 從 last 1 → last 3 entries |
| **Related 走 budget** | 在 1-hop loading block 加 `if (topicCharsUsed >= TOPIC_MEMORY_BUDGET) break` |

**結果**：

```
Before: 6 topics × ~1K truncated = ~6K total, low info density
After:  2-3 topics × 2-4K full = ~6-12K total + menu ~500 chars, high info density
```

**On-demand 不需要新機制**：Menu 給 awareness → 回應中提到某 topic → 下個 cycle keyword match 自然載入。急需時可用 delegate 直接讀 topic file。

#### 改動範圍

| 檔案 | 改動 | 行數估計 |
|------|------|---------|
| `src/memory.ts` | 移除 `.slice(0, 4000)` × 2 | ~-4 行 |
| `src/memory.ts` | TOPIC_MEMORY_BUDGET 6000 → 12000 | ~1 行 |
| `src/memory.ts` | Budget 超出生成 menu section | ~15 行 |
| `src/memory.ts` | `truncateTopicMemory('brief')` last 1 → last 3 | ~1 行 |
| `src/memory.ts` | Related loading 加 budget guard | ~1 行 |

總計 ~20 行改動。

### Step 2: Thread-seeded 初始關聯（Deferred）

Thread trail 資料在 `memory/threads/` 但不是結構化欄位，topic 引用散在自然語言中。需要 NLP 解析，成本比預期高。先觀察 Step 1 + 1.5 效果再決定。

### Step 3: REMEMBER 時 Auto-suggest（Deferred）

Haiku subprocess 有延遲風險，`appendTopicMemory` 是同步路徑加 async 會複雜化。Step 1 + 1.5 已足夠驗證概念。

## 安全護欄

- **Budget 控制**：TOPIC_MEMORY_BUDGET 從硬切改為數量控制（載入 2-3 個完整 > 截斷 6 個）
- **Menu fallback**：超 budget 的 topic 不消失，以 menu 形式保留 awareness
- **不遞迴**：嚴格 1-hop，不追 related 的 related
- **Max 3**：related loading 最多 3 個，受 budget gate
- **Dedup**：已載入的 topic 不重複
- **回退安全**：`related` 不存在 → 行為完全不變

## 實作順序

1. ~~Step 1（related associations）~~ ✅ Done (f42d77e)
2. **Step 1.5（JIT + 不截斷）** ← Ready for implementation
3. Step 2（thread seeding）— Deferred
4. Step 3（auto-suggest）— Deferred

每一步獨立可部署。
