# Proposal: Learning Report 完整顯示

## Status: implemented

## TL;DR
Dashboard Learning Report 數據被截斷到 200 字元，Alex 看不到完整的學習報告。改兩行 `slice(0, 200)` → `slice(0, 2000)` 即可。

## Problem

Alex 在 TG 說：「Learning Report 點個別報告希望可展開顯示 reference 還有心得報告全文」。

根因：`src/loop.ts` 第 260 和 265 行，`logBehavior` 寫入時用 `action.slice(0, 200)` 截斷。一個典型 ACTION 報告有 500-1000 字元（含 What/Why/Changed/Verified），200 字通常只夠顯示到 Changed 的第一行。

結果：API `/api/dashboard/learning` 返回的 `changed` 欄位只有開頭幾個字（如 `"- \`research/pattern-"`），reference URL 和全文完全丟失。

## Goal

Dashboard Learning Report 能展示完整的 What/Why/Changed/Verified 內容，包含 reference URLs。

## Proposal

### 改動 1: `src/loop.ts` — 放寬 behavior log 截斷限制

```diff
- logger.logBehavior('agent', 'action.autonomous', action.slice(0, 200));
+ logger.logBehavior('agent', 'action.autonomous', action.slice(0, 2000));

- logger.logBehavior('agent', 'action.task', action.slice(0, 200));
+ logger.logBehavior('agent', 'action.task', action.slice(0, 2000));
```

只影響 `action.task` 和 `action.autonomous` 兩個 behavior type。其他 logBehavior 保持 200 字（它們不需要更多）。

### 改動 2: `dashboard.html` — 前端支援 markdown 格式展開

目前 `renderLearning` 用 `escapeHtml` 後直接塞 innerHTML。改為：支援基本 markdown 格式（backtick→code, newline→br），讓展開的內容可讀。

### 為什麼不改其他地方的 slice

- `slog` 的 `action.slice(0, 100)` — server.log 是運維用途，100 字夠
- `loop.cycle.end` 的 `action.slice(0, 100)` — 循環結束摘要，不需全文
- `telegram.chat` 等的 `.slice(0, 200)` — 通知用途，不需全文

## Alternatives Considered

| 方案 | 優點 | 缺點 | 不選的原因 |
|------|------|------|-----------|
| 本提案（放寬 slice） | 最小改動、效果立即 | JSONL 檔案略大 | — |
| 新建 detail 欄位 | 結構更乾淨 | 改 BehaviorLogEntry interface + 所有讀取端 | 過度工程 |
| 讓 API 直接讀 daily/ 日記 | 不依賴 behavior log | 日記格式不穩定、解析複雜 | 可靠度低 |

## Pros & Cons

### Pros
- 解決 Alex 直接提出的需求
- 改動極小（2 行 src/ + dashboard.html 前端）
- 向後相容（只是存更多字，不改結構）

### Cons
- behavior JSONL 檔案每條 action 記錄從 ~200B 變 ~2KB（每天約 10-15 條，影響可忽略）

## Effort: Small
## Risk: Low

## Source
Alex TG 訊息 2026-02-11T10:16:13：「Learning Report 點個別報告希望可展開顯示 reference 還有心得報告全文」
