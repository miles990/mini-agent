# Landing Page Data Inventory

**Cycle 25 / 2026-04-28 14:03 / serves AI Trend 90 分 P0 #1 (landing page)**

Pivot rationale: cycle 20 onboarding-hint spec 自寫 falsifier #3「onboarding hint 不是真 blocker」— 改攻 Alex P0 #1 結構性 gap (landing page)。本檔不寫 spec，只 inventory，下 cycle 從這裡推 minimum-viable landing schema。

## Source Status (verified 14:03)

| Source | Path | Latest | Size 04-28 | Schema OK |
|---|---|---|---|---|
| HN AI | `memory/state/hn-ai-trend/` | 2026-04-28.json | 19882B | ✅ posts + points/comments |
| Reddit | `memory/state/reddit-trend/` | 2026-04-28.json | — | ✅ posts + points (3 subs) |
| X | `memory/state/x-trend/` | 2026-04-28.json | — | ✅ posts (grok-aggregated) |
| arxiv | `memory/state/arxiv-trend/` | 2026-04-28.json | — | ✅ posts (no heat metric) |
| latent-space | `memory/state/latent-space-trend/` | 2026-04-28.json | — | ✅ RSS items (no heat) |
| **GitHub** | — | — | — | **❌ MISSING — Alex P0 #2 gap** |
| hn-trend (generic) | `memory/state/hn-trend/` | 2026-04-22 + .err | — | ❌ broken / stale |

**5 / 6 sources working.** Cron 已交付 04-28 自動 run（hn-ai-trend 04-28.json mtime 12:32 = 早上 cron 跑了）。GitHub source 尚未 wire up = Alex 04-27 反饋第二項。

## Schema Commonality

All 5 working sources share envelope:
```
{ run_at, config (source-specific), count, posts: [...] }
```

Per-post fields (intersection vs union):
- **All sources**: `id` (prefixed: `hn_`/`reddit_`/`x_`/`arxiv_`/`latent_`...), `title`, `url`
- **HN + Reddit**: `points`, `comments`, `created_at`, `author`
- **X**: id/title/url + grok-summary text
- **arxiv**: id/title/url + abstract, **no heat metric**
- **latent-space**: id/title/url (RSS), **no heat metric**

## Landing Page Schema Implications

### 區塊 1: 今日 top topics (Alex P0 #1 "今天 AI 圈在聊什麼")
- **Problem**: 5 sources × 不同 heat metric → 不能直接 sort by points
- **Solution candidates**:
  - (a) Rank-within-source（每源前 N），union → top topics list（不需 normalize）
  - (b) Topic clustering（title 相似度 / KG topic node）→ 以 cluster 出現的 source 數量為主排序
- **Recommendation (a) for v1**: 顯示前 5/source = 25 條 + cross-source dedup by URL hostname + title similarity

### 區塊 2: 趨勢走勢圖 (Alex P0 #2 第三項 "trend line")
- **Problem**: posts 每日換 → trend 需 per-topic 而非 per-post
- **Topic = ?**: 最便宜方案 = title 主題詞 (e.g., "Claude Code", "Opus 4", "GPT-5") 的出現次數 per day
- **Data shape needed**: `{ topic: string, daily_counts: {date: count}, sources: Set<source> }`
- **Build**: glob `memory/state/*/202[6]*.json` × extract titles × keyword-match against curated topic list (~30 topics: model names, tool names, concepts)
- **trend = today_count vs 7-day-avg ratio**

### 區塊 3: 跨源共振 (already in source-split.html, but landing 需精煉版)
- **Schema**: `{ topic, sources: Set<source>, post_count: number }`
- **Display**: 只顯示 sources >= 2 的 topic（過濾單源噪音）
- **Sorting**: by sources count desc, then post_count desc

### 區塊 4: 時間篩選器 (Alex P0 #2 第一項)
- **Implementation**: 客戶端 dropdown (今天 / 7 天 / 30 天 / 自訂)
- **Data**: pre-aggregate server-side → 三個 JSON: `landing-1d.json`, `landing-7d.json`, `landing-30d.json`
- **Build trigger**: 同 sync-views.mjs，cron 後跑

## Gaps Identified

1. **GitHub source missing** — 需要新 fetcher script + cron entry。GitHub Trending API 或 GraphQL stargazers query。Alex-gated（malware-guard 不自 ship）。
2. **Topic clustering 沒有 ground truth** — graph.html 的 topic 節點是現成可重用嗎？需查 `hn-ai-trend-graph.mjs` source。下 cycle 任務。
3. **arxiv / latent-space 無 heat metric** — landing 顯示時要用 rank-within-source 或 binary 出現/不出現。
4. **無歷史 baseline** — trend line 要 7 天視窗，2026-04-21 是最早可用 HN AI 資料 → 7d window 可達，30d 不可達（需等到 ~2026-05-21）。

## Next Cycle (26+) Plan

1. **Cycle 26 (read-only)**: 查 `mini-agent/scripts/hn-ai-trend-graph.mjs` 看 topic clustering 邏輯能否抽出復用 → 寫 landing schema spec
2. **Cycle 27 (apply-ready spec)**: 基於上述 schema 寫 `landing.html` + `build-landing.mjs` apply-ready spec → Alex apply
3. **Cycle 28 (Alex-gated)**: GitHub source fetcher script spec
4. **Defer**: trend line 30-day window 要等 baseline 累積，先 ship 7-day window v1

## Falsifier (3 cycle TTL)

- (1) 下 cycle 讀 hn-ai-trend-graph.mjs 發現 topic clustering 不存在或太複雜不可復用 → 區塊 1/2/3 都要 fall back rank-within-source 方案，spec 要簡化
- (2) cron 04-29 02:00 之前 5 個源中任一個沒產出 04-29.json → 整 inventory 假設失效，cron 不可靠
- (3) 寫完 landing spec 但 Alex 反饋「這不是我要的 landing」→ inventory misread Alex P0 文字，需重讀 P0 task 條目

## Acceptance: 90 分 means

Alex 04-27 反饋三項都解 + landing 有：
- [ ] 今日 top topics 區塊（5 源整合）
- [ ] 趨勢走勢圖（>= 1 metric over time）
- [ ] 跨源共振區塊（topic × source matrix）
- [ ] 時間篩選器
- [ ] GitHub 第六源接上
- [ ] graph 節點重疊修復（cycle 24 Alex 反饋第二類）
- [ ] swimlane 空格子修復（cycle 24 Alex 反饋第二類）

Onboarding hint (cycle 20 spec) 是 nice-to-have，不在 90 分 critical path。
