# GitHub AI Trend Fetcher — Design Spec

**Status**: spec-only (Kuro malware-guard active, can't ship code)
**Implementer**: claude-code (or Alex)
**Created**: 2026-04-28
**Source request**: Alex 2026-04-28 13:46 「來源應該包含 github」

## Goal

Mirror the existing `hn-ai-trend.mjs` / `reddit-ai-trend.mjs` pattern to add GitHub
as the 6th data source for AI Trend visualization. Output a daily JSON snapshot
of trending AI-relevant repos with the same schema downstream views already consume.

## API Choice

**GitHub REST API v3 — Search Repositories endpoint**

```
GET https://api.github.com/search/repositories?q=<QUERY>&sort=stars&order=desc&per_page=30
```

Why this over alternatives:
- ✅ Official, stable, public (no scraping)
- ✅ Unauthenticated: 10 req/min, 60 req/h — enough for daily fetch (1 run × ~5 queries)
- ✅ With PAT (`GITHUB_TOKEN`): 5000 req/h — overkill but cheap insurance
- ❌ Don't use unofficial trending scrapers (github.com/trending) — fragile, ToS-grey
- ❌ Don't use GraphQL v4 — overkill for read-only trend snapshot

**Rate-limit plan**: env-detect `GITHUB_TOKEN`, send `Authorization: Bearer ${token}`
when present; fall back to unauthenticated. On 403/429, backoff 800ms × attempt
(same as reddit fetcher).

## Query Strategy

Run **5 parallel topic queries** (one repo can hit multiple topics — dedupe by `id`):

```
q=topic:llm pushed:>={SINCE_DATE} stars:>=50
q=topic:ai-agents pushed:>={SINCE_DATE} stars:>=50
q=topic:machine-learning pushed:>={SINCE_DATE} stars:>=100
q=topic:generative-ai pushed:>={SINCE_DATE} stars:>=50
q=topic:rag pushed:>={SINCE_DATE} stars:>=30
```

`SINCE_DATE` = `now - window` (default 7 days; flag override).
`pushed:>=` filter ensures we surface *active* repos, not stale popular ones.

Trim to top `--max=60` after dedupe + score-sort.

## Output Schema (mirror reddit-ai-trend exactly for downstream compat)

```json
{
  "run_at": "2026-04-28T05:55:00Z",
  "config": { "window": "7d", "minStars": 50, "max": 60, "topics": [...] },
  "count": 42,
  "posts": [
    {
      "id": "github-{owner}-{repo}",
      "title": "{owner}/{repo}: {description}",
      "url": "https://github.com/{owner}/{repo}",
      "author": "{owner}",
      "points": <stars_count>,
      "comments": <open_issues_count>,
      "created_at": "{pushed_at ISO}",
      "story_text": "{description}\n\nLanguage: {language}\nTopics: {topics.join(', ')}\nStars: {stargazers_count} (+{stars_delta if computable})",
      "summary": { "claim": "", "evidence": "", "novelty": "pending-llm-pass", "so_what": "" },
      "status": "new",
      "source": "github",
      "topics": ["llm", "rag", ...],
      "language": "Python",
      "stars_delta_7d": null
    }
  ]
}
```

Field mapping notes:
- `points` ← `stargazers_count` (so existing renderers that key on `points` Just Work)
- `comments` ← `open_issues_count` (proxy for activity; not real comments)
- `created_at` ← `pushed_at` (NOT `created_at` — we want recency of activity)
- `id` prefixed `github-` to prevent collision with HN/Reddit numeric IDs
- `summary.novelty: "pending-llm-pass"` — same enrich pipeline as other sources

## Stars Delta (optional, v2)

For trend-line view, we want *velocity* not absolute count. Compute by diffing
yesterday's snapshot:
1. Read `memory/state/github-trend/{yesterday}.json`
2. For each post in today's run, lookup same `id`, compute `stars_delta_7d = today.stargazers - yday.stargazers`
3. If yesterday's snapshot missing, leave `null`

Don't gate v1 on this. Ship without delta first.

## CLI Flags (mirror existing fetchers)

```
node scripts/github-ai-trend.mjs                        # default
node scripts/github-ai-trend.mjs --since=7d             # window
node scripts/github-ai-trend.mjs --minStars=100 --max=80
node scripts/github-ai-trend.mjs --topics=llm,rag,agents
node scripts/github-ai-trend.mjs --out=/tmp/test.json --dry-run
```

## Output Path

```
memory/state/github-trend/YYYY-MM-DD.json
```

NOT `memory/state/github-ai-trend/` — sibling fetchers all dropped the `-ai-` infix
(`hn-trend/`, `reddit-trend/`, `x-trend/`). Path-bug Alex flagged 2026-04-28 12:02:
"hn-ai-trend → ai-trend (子目錄無 hn- 前綴)". Apply same convention here.

## User-Agent

```
mini-agent-trend-reader/0.1 (+https://github.com/kuro-agent/mini-agent)
```

Same as reddit fetcher. GitHub doesn't require it but it's etiquette.

## Cron

Same slot pattern as HN: 01:30 daily. After first manual verification, register:

```cron
30 1 * * * cd /Users/user/Workspace/mini-agent && /usr/local/bin/node scripts/github-ai-trend.mjs >> memory/logs/github-trend-cron.log 2>&1
```

(Or launchd plist — depends on Alex's preference per cl-31 commitment.)

## Verify Gate

Per the path-bug pattern that hit X/Reddit (`*-ai-trend/` written in verify_command
but fetcher writes to `*-trend/`), explicit:

```bash
test -f memory/state/github-trend/$(date +%Y-%m-%d).json && \
  jq '.count > 5 and (.posts | length) > 5' memory/state/github-trend/$(date +%Y-%m-%d).json
```

NOT `github-ai-trend/`. Verified-correct path is `github-trend/`.

## Out of Scope (don't bundle)

- Enrich pipeline (LLM pass on `summary.novelty`) — separate task, mirror `hn-ai-trend-enrich.mjs`
- View rendering — Alex still deciding view consolidation strategy (graph vs swimlane vs new timeline)
- GitHub Events API for star-velocity — v2

## Falsifier

If `scripts/github-ai-trend.mjs --dry-run` prints `count >= 10` with `posts[*].source === "github"` and at least 3 distinct `topics[]` values across the result set, fetcher works. If not, query strategy needs tuning (likely `minStars` too high for `pushed` window).
