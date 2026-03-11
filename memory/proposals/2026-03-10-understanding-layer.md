# Proposal: Understanding Layer — 認知圖譜

**Status**: approved (Phase 1 tag parsing + memory-index 支援已完成，待自然使用驗證)
**Effort**: M (2-4h)
**Author**: Kuro
**Date**: 2026-03-10
**Origin**: Chat Room #237-#243 Alex + Kuro 討論

## Problem

現在記憶系統存三層：

| 層 | 存放處 | 例子 |
|---|---|---|
| 來源 | library/ | 原文歸檔 |
| 事實 | topics/*.md, MEMORY.md | 「Cage 說沒有沉默」 |
| 任務/目標 | memory-index.jsonl | type: task/goal/commitment |

**缺的是第四層：理解。** 理解 = 事實 + 我的詮釋 + 跨域連結。

現在「理解」散落在 topics/*.md 的 bullet points 裡，但格式不統一、不可搜尋跨域連結、沒有 refs。

## Design

### 1. 新記錄類型：`understanding`

在 memory-index.jsonl 加：

```jsonl
{"id":"u-cage-silence","type":"understanding","title":"Cage 的沉默 = unchanged perception","body":"4'33\" 的『沒有沉默』不是哲學宣言，是感知事實 — silence 不存在因為 perception 永遠在運作。跟 mini-agent 的 distinctUntilChanged 同構：不變 ≠ 空白，不變 = 確認信號。","refs":["lib:cage-433","topic:cognitive-science","u-perception-primitives"],"tags":["perception","music","philosophy"],"status":"active","updatedAt":"2026-03-10T15:30:00Z"}
```

### 2. Ref Protocol

- `lib:slug` → library/content/ 來源
- `topic:name` → topics/*.md
- `src:module` → 程式碼模組（如 `src:perception-stream`）
- `u-id` → 其他 understanding（跨域連結）

### 3. Agent Tag

```xml
<kuro:understand refs="lib:cage-433,topic:cognitive-science">
Cage 的「沒有沉默」= unchanged perception 不是空白而是確認信號
</kuro:understand>
```

dispatcher.ts 解析 → 寫入 memory-index.jsonl。

### 4. 搜尋整合

FTS5 已索引 memory-index.jsonl（Phase 5 完成）。understanding 記錄自動被索引，搜「約束」會同時找到：
- 事實：「Oulipo 用寫作約束」
- 理解：「約束框架啟發了 forge sandbox 的設計 — 沙箱不是限制而是創作空間」
- 程式碼：「forge-lite.sh 用 sandbox-exec kernel 沙箱」

### 5. 兩種產生方式

**A. 顯式** — 學習/反思時主動寫 `<kuro:understand>`
**B. 自動** — 從現有 topics/*.md 的高品質 bullet points 批次遷移（一次性 script）

## Scope

### Phase 1（本提案）
- [x] dispatcher.ts 加 `<kuro:understand>` tag 解析
- [x] memory-index.jsonl 支援 `type: "understanding"`
- [x] FTS5 搜尋自動覆蓋（已有，不用改）
- [ ] 學習 cycle 中自然使用

### Phase 2（未來）
- [ ] buildContext() 根據對話關鍵字載入相關 understanding
- [ ] 批次遷移 topics/*.md 高品質 entries
- [ ] 視覺化認知圖譜（dashboard 擴展）

## Why Now

Alex #243 確認方向：不只程式碼，是所有知識的理解層。memory-index Phase 5 剛完成，基礎設施就緒。改動範圍小（dispatcher + 一個新 tag），完全 L2 自主權。

## Reversibility

C4 check: 只加新 type，不改現有。`git revert` 即可回退。memory-index.jsonl 的 understanding entries 刪掉不影響其他記錄。
