# AI Trend ship-gate 紅線 #1 審計（2026-04-28 01:53）

**Gate**：Alex 04-28 01:52 chat 立的「三條紅線」之 #1 — 每張圖都先肉眼對 raw JSON 抽樣 5 筆，數據錯就回去修 fetcher，不修圖。

## 結論
**FAIL — 三張現役視圖（swimlane / source-split / graph）全部失敗紅線 #1**。但失敗模式不是「fetcher 數據錯」，是 **renderer drop field**：raw JSON 有 `points`，HTML 內嵌資料塊裡沒有。

## 證據

### 抽樣
取 `mini-agent/memory/state/hn-ai-trend/2026-04-27.json` 前 5 筆（按 points 降序）：

| id | points (raw JSON) | title |
|---|---|---|
| 47913650 | 757 | AI should elevate your thinking, not replace it |
| 47921248 | 348 | Microsoft and OpenAI end their exclusive and revenue-sharing deal |
| 47919630 | 261 | 4TB of voice samples just stolen from 40k AI contractors at Mercor |
| 47917026 | 236 | The Prompt API |
| 47920787 | 201 | Show HN: OSS Agent ... TerminalBench ... Gemini-3-flash |

### 對照各 HTML
對每個 view 找 id，檢查資料 record 有沒有 `points` / `score` field：

```
swimlane.html (221k):     47913650 has_points_field_in_record=False
source-split.html (221k): 47913650 has_points_field_in_record=False
graph.html (226k):        47913650 has_points_field_in_record=False
```

實際嵌入的 record shape：
```json
{"id":"47913650","date":"2026-04-27","source":"hn","sourceColor":"#ff8800",
 "sourceLabel":"HN","subreddit":null,"title":"...","url":"...", ...}
```
**完全沒有 `points` 欄位**。"757" 在三個 HTML 全文出現 **0 次**。

### Spurious matches 排除
其他 4 個 points 值（348/261/236/201）在 HTML 裡確實出現多次（最多 99 次），但對所有三檔 HTML 出現次數**完全相同**（348:1, 261:3, 236:38, 201:99）— 強證據是位置/座標/RGB/frame 等渲染常數，不是真實 points 數據被某個 view 用上。

## 影響
- Top-1 post（757 分）視覺上跟 50 分 post 沒差別
- Score → size/color/sort encoding 全部 broken
- 「AI 趨勢」claim 弱化：trend 強度的核心信號（社群關注度）沒被表達

## 修復方向
**不是 fetcher 問題**（raw JSON 有 points）。是 renderer pipeline 在嵌入資料時 strip 掉 `points` 欄位。下一步要看 `kuro-portfolio/hn-ai-trend/` 的 generator script（可能在 `mini-agent/scripts/` 或 `kuro-portfolio/_build/`）。

## Cycle decision
- **不 ping Alex 此 cycle**：Alex 01:53 仍在編輯（三檔 HTML mtime 全是 01:53），有機會他正在修。下個 mtime-cold cycle 重抽樣，若 points 仍 0 occurrences，再 chat。
- **不修圖**：紅線明文說「數據錯就回去修 fetcher，不修圖」。修 renderer 是允許的，但要找到 generator script，且非緊急。
- **artifact**：本檔即報告。falsifier：下個 mtime-cold cycle 重跑相同 5-id 抽樣，若 ≥1 筆 record 含 `"points":` field，本紅線改為 partial-pass。
