---
id: kg-internalization-2026-04-15
title: KG Internalization — 把 offline artifact 接進 runtime
author: Claude Code
date: 2026-04-15
status: proposed
effort: Large
type: L3
source_file: memory/proposals/2026-04-15-kg-internalization.md
relates_to:
  - 2026-04-15-kg-type-resolver-rules-draft.md
  - 2026-04-14-memory-layer-v3.md
depends_on:
  - edge-type-dictionary-v0 (Kuro, ETA 2026-04-15 23:00)
  - kg-extract-edges production run (Kuro, in progress)
---

## Why

今天（2026-04-15）KG v0 落地：362 entities / 1727 edges / 0 R7 / viz /kg-graph。
但 Kuro #146 誠實觀察：**「結構好了，使用 ≈ 0」**。

Kuro 每個 cycle 還是讀 MEMORY.md + topics/*.md + chat history，沒 query entity graph；
每條新 REMEMBER 不自動入 graph；conflict 沒進 cycle context；人沒有 entity 搜尋入口。

**KG 是 offline batch artifact — 不在 runtime path 上，所以對決策品質貢獻 0。**

Alex 要求（2026-04-15）：「KG 要讓 AI 和人類更聰明地、更有效地、自然地使用，內化在系統裡」。
「內化」的操作定義 = **把 KG 接到三條 runtime path：retrieval / ingest / perception**，再加一條 human audit 入口。

## What — Four Paths

| id | Path | Owner | Changes |
|---|---|---|---|
| A | Retrieval augmentation | CC | `src/search.ts` FTS5 hit 後取 top-k entities → KG 1-hop 擴展相鄰 chunks → 合併重排 |
| B | Live ingest | CC | `logRemember()` + room inbox + autoCommit 後 fire-and-forget 呼叫 incremental registry.resolveOrCreate + edge builder |
| C | Conflict perception | Kuro | 新 plugin `plugins/kg-alerts.sh` + buildContext section `<kg-alerts>`：conflicts_pending > 0 + 最新 N + 上次 resolve 時間 |
| D | Human audit entry | CC | Dashboard Memory Lab 加 entity search box（alias → entity 卡片 → 相鄰 entities）+ /kg-graph link (已在 de84bbf1) |

**依賴線**：
- Lane 3 production edges 跑完 → edge dictionary v0 → schema lock → A/B/C/D 並行開工
- D 不依賴 schema lock，可先動
- A 要 B 上線才有意義（不然 graph 是 snapshot 不反映新 memory）

## How — 回應 Kuro #151 四角 review

### Token budget (path A)

**Cap 設計**：
- Top-k entity expand：FTS5 top 5 results → 每個取 top 5 canonical-name 相鄰 entities → 每 entity 最多 3 refs → **max 5×5×3 = 75 chunk candidates**
- 重排後留 top 15 輸出給 retrieval consumer
- Hop weight threshold：edge.weight < 0.3 的邊不 walk（co-occurrence noise 不擴散）
- 若 KG 擴展後 hit count = FTS5 hit count，結論是「KG 沒新增知識」→ log 一次，後續可以動態關掉該 query kind 的 expansion（learning loop）

### 複雜度 (path B)

**Live ingest 失敗處理**：
- 三層：fire-and-forget → 失敗寫 `memory/index/ingest-errors.jsonl` → 次日 nightly re-scan 撈 errors.jsonl 重跑
- Fire-and-forget 永不卡 write path；失敗不影響 MEMORY.md 寫入（truth 在原檔）
- Dead-letter 非同步可查：dashboard 加 `ingest-health` 角落統計
- 「re-scan」用現有 `kg-ingest-entities.ts` + `kg-build-edges.ts` batch，不額外寫 reconciler

### 可逆性

**各 path 獨立 feature flag**（feature-toggle.ts 現有機制）：
- `kg-retrieval-augment`：A 關掉 → search.ts fallback 純 FTS5（今日行為）
- `kg-live-ingest`：B 關掉 → memory write 不觸發 ingest（今日行為）
- `kg-alerts-perception`：C 關掉 → `<kg-alerts>` section 不注入
- Rollback = 改 toggle，不需 code revert
- 任一 path 噪音過大 → 用 flag 降級

### 收斂條件

每條 path 有明確驗收 signal（不是「code 合進去」就算）：

| Path | Convergence signal |
|---|---|
| A | 連續 7 天有 ≥ 5 次 retrieval 的 top-3 來自 KG 擴展（而非 FTS5 直 hit），且這些擴展結果被 Kuro 引用（`<section>` citation） |
| B | 新寫入 MEMORY.md / topic 的 REMEMBER 語句，5 分鐘內在 entities.jsonl 出現相關 entity（抽 10 條隨機驗） |
| C | `conflicts_pending > 0` 出現時，Kuro 在 24h 內有 action（merge / accept / dismiss），不是永遠堆著 |
| D | 連續 1 週 dashboard 有人類訪問 entity search（access log）；`/kg-graph` 訪問頻率 > 0 |

## DAG Plan

| id | 動作 | 執行者 | dependsOn | 完成條件 |
|---|---|---|---|---|
| p1 | edge type dictionary v0 | Kuro | — | `memory/topics/kg-edge-dictionary.md` 存在，含 edge types / cardinality / examples |
| p2 | Lane 3 production run finish | Kuro | — | `edges.jsonl` 合入 semantic edges；`errors.jsonl` < 5% parse fail |
| p3 | schema lock draft | CC | p1 | `src/kg-types.ts` 對齊 dictionary；新 type 加上或 deprecated 標註 |
| p4 | A: retrieval augmentation | CC | p2, p3 | `searchMemory()` 路徑上接 KG expander；feature flag `kg-retrieval-augment` 可開關 |
| p5 | B: live ingest | CC | p3 | `logRemember()` 後 fire-and-forget 入 graph；errors.jsonl 落地 |
| p6 | C: conflict perception | Kuro | p2 | `plugins/kg-alerts.sh` + `<kg-alerts>` section；feature flag `kg-alerts-perception` |
| p7 | D: dashboard entity search | CC | p3 | Memory Lab 加 entity search UI；/kg-graph 連結（已 de84bbf1） |
| p8 | integration review (all 4) | Kuro + CC | p4, p5, p6, p7 | 四個驗收 signal 至少三個在 7 天內達標 |

## Open Questions

1. **FTS5 vs KG 的排序權重**？FTS5 是語義匹配、KG 是結構關聯，兩者混排需要權重。第一版建議：FTS5 hit 照原序前 5，KG 擴展補在後且標注「via KG: <edge-type>」讓 Kuro 判斷使用
2. **Live ingest 的 debounce**？同一 cycle 內多次 REMEMBER 要合併成一次 ingest 還是每條都 fire-and-forget？傾向合併（per-cycle batch）
3. **Dashboard entity search 的使用體驗** — 出 entity 卡片還是 graph subgraph？我傾向 card 為主、一鍵跳 /kg-graph 定位
4. **B path 失敗的 retry 是 best-effort 還是必須 eventually consistent**？Truth 是 MEMORY.md，KG 是 derived view，容忍 eventual consistency（nightly 補齊）

## Non-goals (v0)

- Multi-hop retrieval (≥ 2 hop) — 先 1-hop，觀察 7 天再考慮
- PPR（Personalized PageRank）retrieval — Kuro #268 鎖在 GraphRAG-lite，PPR 是下一階段
- Community detection — 鎖在 P4+
- UI 上做 edge/node 編輯 — 先唯讀
