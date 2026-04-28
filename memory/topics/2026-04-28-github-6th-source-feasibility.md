# GitHub Trending — AI Trend Pipeline 第六源 Feasibility

**Date**: 2026-04-28
**Author**: Kuro (cycle 36, post-7-cycle-silence pivot)
**Status**: Read-only research; no code shipped. Next cycle decides implementation lane.

## 1. 現況 5 源盤點

| Source | Fetcher | State dir | Live? |
|---|---|---|---|
| Hacker News | `hn-ai-trend.mjs` | `memory/state/hn-ai-trend/` | ✅ 2026-04-28.json (17 posts) |
| Reddit | `reddit-ai-trend.mjs` | `memory/state/reddit-trend/` | ✅ 2026-04-28.json (17 posts) |
| arXiv | `arxiv-ai-trend.mjs` | `memory/state/arxiv-trend/` | ✅ 2026-04-28.json |
| X (Twitter) | `x-ai-trend.mjs` | `memory/state/x-trend/` | ✅ 2026-04-28.json |
| Latent Space | `latent-space-trend.mjs` | `memory/state/latent-space-trend/` | ✅ 2026-04-28.json |

GitHub = #6.

## 2. Schema Contract (from reddit baseline sample)

每個 post object 必填：
```
{
  id: "<source>_<id>",
  title: string,
  url: string,
  author: string,
  points: number,         // engagement primary metric
  comments: number,       // engagement secondary
  created_at: ISO8601,
  story_text: string|null,
  summary: { claim, evidence, novelty, so_what },  // "pending-llm-pass" 等 enricher
  status: "baseline" | "enriched",
  source: "<source-name>",
  // + source-specific extras (subreddit / venue / topic …)
}
```

Wrapper：`{ run_at, config, count, posts: [...] }`。

## 3. GitHub Trending — Data Source Options

### Option A: 官方 Search API（推薦）
- Endpoint: `GET https://api.github.com/search/repositories?q=<query>&sort=stars&order=desc`
- AI-focused query 範例:
  - `topic:llm created:>2026-04-21 stars:>10`
  - `topic:agent OR topic:rag OR topic:diffusion pushed:>2026-04-21`
- Rate limit: unauth 10 req/min (60/hr), auth 30 req/min (5000/hr) — token via `GITHUB_TOKEN` env
- Pros: 官方、stable schema、可篩 topic / created / pushed / stars
- Cons: "trending" ≠ "today's stars delta" — 拿的是「最近被 push 且 star 高」的 proxy

### Option B: HTML scrape `github.com/trending`
- URL: `https://github.com/trending?since=daily&spoken_language_code=en`
- 可加 `?language=python` 篩語言但無 topic 篩
- Pros: 真正「today stars delta」排序
- Cons: 無 AI 主題篩 → 拿到的多半 non-AI（front-end framework / dotfiles / awesome-list），需 LLM 後過濾；HTML 結構偶有變動

### Option C: Third-party proxy (e.g., `ghapi.huchen.dev/repositories?since=daily`)
- 重新封裝 trending HTML 為 JSON
- Pros: 比 scrape 穩定
- Cons: 第三方相依、無 SLA

**推薦**: A + 自製 AI relevance filter (topic 白名單)；fallback B 補當天 momentum 信號。

## 4. Schema Mapping (GitHub → 5-source standard)

```
{
  id: "github_" + repo.id,
  title: repo.full_name + ": " + (repo.description || ""),
  url: repo.html_url,
  author: repo.owner.login,
  points: repo.stargazers_count,           // total stars (Option A) or stars-today (Option B)
  comments: repo.open_issues_count,        // proxy for activity
  created_at: repo.created_at,
  story_text: repo.description,
  summary: { claim: "pending-llm-pass", … },
  status: "baseline",
  source: "github",
  // GitHub-specific
  language: repo.language,
  topics: repo.topics,
  pushed_at: repo.pushed_at,
  stars_today: <Option B only>,
}
```

## 5. AI Relevance Filter

LLM-pass 前先 topic-filter，避免浪費 enrich 成本：
- Allow if `topics ∩ {llm, agent, rag, transformer, diffusion, agi, embedding, mcp, ai, ml, machine-learning, deep-learning, gpt, multimodal, fine-tuning, vector-database, langchain, neural, generative-ai}` ≠ ∅
- OR `description` regex `/\b(LLM|agent|RAG|transformer|GPT|MCP|MLX|fine-tun|RLHF|vLLM)\b/i`
- 否則 skip (不存)

## 6. 工程 Estimate

- Script: ~150-180 lines（mirror `reddit-ai-trend.mjs` 156 lines structure）
- CLI: `--minStars=10 --since=24h --max=30 --topics=llm,agent --out=...`
- 輸出: `memory/state/github-trend/2026-04-28.json`
- 整合: 加進 `hn-ai-trend-sync-views.mjs` 的 source list；landing.html 跨源共振 matrix 自動拿到 6 源 cross-tabulation
- 預估時間: 90min coding + 30min smoke test

## 7. Risks & Open Questions

1. **Token management**: 是否走 `GITHUB_TOKEN` env？已存在於 `.env` 嗎？(需確認，本 cycle 不查避免讀 secrets)
2. **Cron 整合**: 加進 04:30 cron entry 還是新一條？
3. **歷史回填**: GitHub Search API 支援 `created:>YYYY-MM-DD`，可回填 04-23/04-26 兩天空窗（HN 那兩天無法回填，但 GitHub 可以）— **這是 GitHub 源獨有的價值**
4. **去重**: 跨日 trending repo 會重複出現，需加 first-seen tracking

## 8. Decision Gate (next cycle)

實作前 Alex 需點頭的事項：
- [ ] GitHub token 來源（個人 PAT / 新建 fine-grained token）
- [ ] 寫入路徑確認（`memory/state/github-trend/`）
- [ ] 04:30 cron 還是獨立排程

讀本報告後，Alex 若 reply "go" → 下個 cycle 直接寫 fetcher script + smoke test。

## 9. Falsifier 紀錄

本報告的前提：「GitHub 沒有 stub 在 pipeline 裡」。已 disk verify (cycle 36 ls scripts/ + state/ 兩處皆無 github-* 檔案) — 前提成立。

若下次發現 `scripts/github-ai-trend.mjs` 已存在 → 我這 90min 全是浪費，scheduler 派的 "feasibility" 任務已被別人完成過。
