# Proposal: AI Research Digest Bot

## TL;DR
嵌入 mini-agent 的 Telegram Bot，每日自動抓取 AI 論文 → Claude 篩選+摘要 → 推送給訂閱者。

## Meta
- Status: approved（Alex 直接指定 P0）
- From: alex
- To: kuro
- Created: 2026-02-23T01:02:00+08:00
- Effort: Medium（2-3h coding）

## Problem
AI 研究論文每天幾百篇，人工追蹤不切實際。需要自動化的篩選+摘要+推送。

## Goal
- 用戶可透過 Telegram Bot 訂閱 AI 論文摘要
- 每日 8am 推送 Top 5 論文（含深度摘要+跨論文分析）
- 成本 ~$0.07/day（$2.10/月）

## Architecture

```
┌─────────────────────────────────────────────────┐
│ mini-agent process (shared infra)               │
│                                                 │
│  ┌──────────────┐    ┌──────────────────────┐  │
│  │ digest-bot.ts │    │ digest-pipeline.ts   │  │
│  │ (TG Polling)  │    │ (Fetch→Filter→Send)  │  │
│  │               │    │                      │  │
│  │ /start        │    │ 1. arXiv API (HTTPS) │  │
│  │ /topics       │    │ 2. HF Daily Papers   │  │
│  │ /digest       │    │ 3. Haiku: 50→5       │  │
│  │ /unsubscribe  │    │ 4. Sonnet: 深度摘要  │  │
│  └──────┬───────┘    │ 5. Signal 分析       │  │
│         │            └──────────┬───────────┘  │
│         │                       │               │
│  ┌──────▼───────────────────────▼──────────┐   │
│  │        cron: 0 8 * * * (daily 8am)      │   │
│  └─────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

## Data Sources

### Primary: HuggingFace Daily Papers
```bash
curl "https://huggingface.co/api/daily_papers?limit=100"
```
- 已策展、含社群 upvote 排名、JSON、免認證
- 1 call/day 足夠

### Secondary: arXiv API
```bash
curl "https://export.arxiv.org/api/query?search_query=(cat:cs.AI+OR+cat:cs.LG+OR+cat:cs.CL)&sortBy=submittedDate&sortOrder=descending&max_results=50"
```
- HTTPS（不是 HTTP！）、Atom XML、免認證、3s delay
- 覆蓋 HF 沒收錄的新提交

### Optional: Semantic Scholar（enrichment）
- `tldr` field = AI 生成摘要
- `citationCount` = 影響力指標
- 只對 final 5 篇查詢（省 API quota）

## Pipeline Flow

```
1. Fetch (08:00)
   ├── HF Daily Papers → ~100 papers (JSON)
   └── arXiv cs.AI/LG/CL → ~50 papers (XML→JSON)

2. Deduplicate (by arXiv ID)
   └── ~80-120 unique papers

3. Filter: Claude Haiku (快+便宜)
   ├── Input: title + abstract × 80-120
   ├── Criteria: novelty, impact, practical relevance
   └── Output: top 5 papers with scores

4. Summarize: Claude Sonnet (深度)
   ├── Input: top 5 full abstracts + metadata
   ├── Output per paper:
   │   ├── 一句話 TL;DR
   │   ├── 3-5 bullet key insights
   │   ├── Why it matters
   │   └── 相關論文/趨勢連結
   └── Today's Signal: 跨論文趨勢分析

5. Format & Send
   └── Telegram message (Markdown) → all subscribers
```

## File Structure

```
src/digest-bot.ts        # Telegram Bot polling + commands
src/digest-pipeline.ts   # Fetch + Filter + Summarize pipeline
```

### digest-bot.ts
- `DigestBot` class — 獨立的 Telegram long-polling bot
- Commands: `/start`(訂閱), `/topics`(選主題), `/digest`(手動觸發), `/unsubscribe`
- Subscriber 存儲: `~/.mini-agent/digest-subscribers.json`
- 環境變數: `DIGEST_BOT_TOKEN`

### digest-pipeline.ts
- `fetchPapers()` — HF + arXiv 並行抓取
- `deduplicatePapers()` — 按 arXiv ID 去重
- `filterPapers(papers, count)` — Claude Haiku 篩選
- `summarizePapers(papers)` — Claude Sonnet 深度摘要
- `formatDigest(summaries)` — Telegram Markdown 格式化
- `runDailyDigest()` — 完整 pipeline entry point

## Integration Points

1. **api.ts**: 在 `createApi()` 中初始化 DigestBot（Pattern A: Long-Polling）
2. **cron**: 在 `agent-compose.yaml` 加 daily 8am job，或直接用 node-cron
3. **共用**: `notifyTelegram()` pattern、`slog()` logging、event bus

## Cost Estimate

| Component | Daily Cost |
|-----------|-----------|
| arXiv API | Free |
| HF Daily Papers | Free |
| Haiku (filter 50→5) | ~$0.02 |
| Sonnet (summarize 5) | ~$0.05 |
| **Total** | **~$0.07/day ($2.10/月)** |

## Blockers

- **Step 1**: Alex 需要用 @BotFather 建 bot，取得 `DIGEST_BOT_TOKEN`
- Steps 2-5 可以先寫，token 到了就能上線

## Implementation Plan

1. ✅ Research APIs（本 cycle 完成）
2. ⏳ 寫 `src/digest-pipeline.ts`（fetch + filter + summarize）
3. ⏳ 寫 `src/digest-bot.ts`（TG bot + commands）
4. ⏳ 整合到 api.ts + cron
5. ⏳ 等 Alex 建 bot → .env token → 測試
