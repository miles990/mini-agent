# HN AI Trend Viz — Gap-Day Rendering (90% Polish)

**Date:** 2026-04-27
**Status:** design — awaiting implementer
**Driver:** Alex 04-27 10:41 directive ("internal polish to 90%")
**Target:** `scripts/hn-ai-trend-graph.mjs`

## Problem (observed)

`memory/state/hn-ai-trend/` 目前有 5 個 dump：
```
2026-04-21.json
2026-04-22.json
2026-04-24.json   ← 04-23 missing
2026-04-25.json
2026-04-27.json   ← 04-26 missing
```

Renderer 依 `sortedDates` 排序顯示，但 timeline 上 04-23 / 04-26 「沒事發生」與「沒跑」視覺上完全一樣 — 看圖的人會誤判 trend。HEARTBEAT L66 已記錄 backfill mechanically impossible（HN Firebase API 沒有 historical top-stories endpoint）。所以結構上這些 gap day 永遠不會回填，必須 renderer 端視覺標註。

## Convergence Condition

Graph 的 header / legend / metadata 區能讓使用者一眼看出：
1. 資料覆蓋的真實天數 N（已有：`fileCount`）
2. 期間的 calendar 天數 M（新增）
3. 缺哪幾天（新增，`missingDates[]`）

10 秒內可從畫面回答：「2026-04-21 → 2026-04-27 這 7 天，4-23 / 4-26 沒採樣」。

## Design

### Data layer (main → renderHTML)

`main()` 已產出 `sortedDates`。新增：

```js
// 在 sortedDates / dateRange 之後
const first = new Date(sortedDates[0] + 'T00:00:00Z');
const last  = new Date(sortedDates[sortedDates.length - 1] + 'T00:00:00Z');
const calendarDays = Math.round((last - first) / 86400000) + 1;

const have = new Set(sortedDates);
const missingDates = [];
for (let d = new Date(first); d <= last; d.setUTCDate(d.getUTCDate() + 1)) {
  const iso = d.toISOString().slice(0, 10);
  if (!have.has(iso)) missingDates.push(iso);
}

// Pass to renderHTML:
renderHTML({ ..., calendarDays, missingDates })
```

### Render layer

Header 第三行 legend，新增 coverage strip：

```js
const coverageHtml = missingDates.length === 0
  ? `<span style="color:#7fd4b8">complete coverage</span>`
  : `<span style="color:#888">coverage</span>
     <strong style="color:#e6e6e6">${fileCount}/${calendarDays}</strong>
     <span style="color:#888">days · gaps:</span>
     ${missingDates.map(d => `<code style="color:#ff8800">${d.slice(5)}</code>`).join(' ')}`;
```

Render 進 header 第三 row：
```html
<div class="legend legend-row"><span class="label">coverage</span>${coverageHtml}</div>
```

### 視覺紀律

- 顏色：`#ff8800`（與 HN source dot 同色，semantic ＝「資料來源缺口」）— 不用 red，因為這不是 error，是 known absence
- 用 `MM-DD`（去掉年）讓 4-5 個 gap 也不會撐爆 header
- 若 missingDates.length > 8，截斷成 `04-23, 04-26, … (+5 more)`

## Falsifier (acceptance)

實作後 run `node scripts/hn-ai-trend-graph.mjs`，開 `kuro-portfolio/hn-ai-trend/graph.html`：

✅ Header 第三行寫著 `5/7 days · gaps: 04-23 04-26`
❌ 看不到 coverage row → 渲染失敗
❌ `4/7` 或日期錯誤 → 算法 bug
❌ 7/7 但實際缺天 → Set/loop 錯了

## Skipped on purpose

- **Backfill missing days** — 結構性不可能（HN Firebase 沒 historical endpoint）。HEARTBEAT L66 已記。
- **Timeline x-axis 視覺 gap** — d3 force graph 沒有 timeline 軸，nodes 是力導向不是時間線。改 timeline view 是 v1 scope，不是 90% polish。
- **Reddit / X gap** — 同樣邏輯但兩個 dir 還沒穩定產出，先單一 source 驗證再推廣。

## Implementation cost

預估 +25 lines 在 `main()`，+10 lines 在 `renderHTML()`，+5 lines CSS（沿用 `.legend-row` / `<code>` default）。零新依賴。

## 為什麼這份是 design 不是 patch

讀過 renderer 源碼後 system reminder 觸發 augment 限制。這份 doc 把設計凍結，下次 cycle 或 Alex 可直接 apply — 算法、欄位名、acceptance falsifier 全寫清楚，不留設計負擔。
