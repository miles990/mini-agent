# X timeline 2-day mention delta (04-27 → 04-28)

**Status**: addendum to `cross-source-overlap.md` — adds velocity dimension to the entity overlap analysis.

**Method**: read-only on-disk analysis of `memory/state/x-trend/2026-04-{27,28}.json`. Each day = top-15 X posts (Grok query "trending AI agent posts in last 24h"). Per-entity weighted score = Σ(points + 2·comments) for posts whose `(title + handle + summary)` contains the entity token (case-insensitive substring).

**Premise correction**: cl-19 framed this as "7-day delta". Disk has only 2 days. Original delegate plan would have invented data — pivoted to honest 2-day on-disk diff. Saved ~$0.3 sub-agent budget.

## Headline signal

| entity | 04-27 | 04-28 | Δ | % |
|---|---:|---:|---:|---:|
| **agent** | 2268 | 9475 | +7207 | +318% |
| **coding** | 1176 | 6868 | +5692 | +484% |
| **claude** | 2120 | 7228 | +5108 | +241% |
| **anthropic** | 239 | 3011 | +2772 | **+1160%** |
| **opus** | 180 | 2771 | +2591 | **+1439%** |
| cursor | 0 | 240 | +240 | NEW |
| openai | 77 | 77 | 0 | 0% |
| rag | 901 | 876 | -25 | -3% |
| mcp | 62 | 0 | -62 | -100% |
| deepseek | 136 | 0 | -136 | -100% |
| gpt | 158 | 0 | -158 | -100% |
| gemini | 453 | 0 | -453 | -100% |
| meta | 1053 | 0 | -1053 | -100% |
| **kimi / moonshot** | 1991 | 0 | -1991 | **-100%** |

## Interpretation (3 paired insights)

### 1. Anthropic isn't just present-in-3-sources, it's accelerating on X
`cross-source-overlap.md` flagged Anthropic/Claude as the only Tier-1 (HN+Reddit+X all 3) entity. Velocity dim adds: on X alone, anthropic +1160% / opus +1439% in 24h. This is not steady-state cross-source presence — it's a release-day spike (Opus model event likely). The 3-source convergence is **co-temporal** with a velocity surge, not a slow burn.

**Falsifier**: if 04-29 x-trend shows anthropic/opus drop ≥80%, this was a single-event spike, not a trend. If sustained ≥500 weighted score, real momentum.

### 2. "Agent" + "coding" co-surge confirms HN/Reddit pattern at higher resolution
Both terms moved +318% / +484% together on X. Matches HN+Reddit's "coding agents" bundle but with daily-level resolution. The two tokens move as one cluster, not independently — supports `cross-source-overlap.md`'s claim that "agent" is the dominant frame, not "LLM" or "model".

### 3. Kimi/Moonshot evaporation = top-15 sampling is brittle
04-27: Kimi K2.6 #1 OpenRouter post drove 1991 weighted score (single high-engagement post). 04-28: zero. **Not** "Kimi died" — single-post sampling at n=15 means one viral tweet dominates a day's score and absence on the next day looks like collapse. Same for gpt/gemini/meta dropping to literal zero — implausible; reflects sample noise, not signal collapse.

**Methodological lesson**: 2-day delta at n=15 has high variance per entity. Need ≥7 days to separate signal (sustained accel/decel) from noise (single-tweet artifacts). `x-trend/` archive needs 5 more days before this analysis is robust.

## Δ vs `cross-source-overlap.md`

| dimension | overlap.md (presence) | this file (velocity) |
|---|---|---|
| Anthropic/Claude | Tier-1 (3 sources) | +1160% / +1439% on X in 24h |
| coding-agents bundle | strong cross-source | +318% / +484% co-surge on X |
| Kimi | Tier-2 (X only) | volatile peak — single-post artifact |
| OpenAI | Tier-2 cross-source | flat (77→77, 0% Δ on X) |
| Cursor | not in overlap.md | NEW on 04-28 (240) — emerging |

## Falsifiers (this file)

1. If `x-trend/2026-04-29.json` shows **anthropic + opus combined < 500 weighted score** (vs 5782 today) → single-event spike confirmed, not sustained trend.
2. If after 7 days of x-trend archive (2026-05-04), **agent/coding/claude entity rankings differ >50%** vs this snapshot → 2-day delta was noise-dominated as suspected.
3. If `cursor` doesn't appear again in next 5 days → 04-28 NEW entry was single-tweet artifact, not emergence.

## Action

This analysis is **read-only research output**. Not actionable until x-trend archive grows to 7 days. Re-run script on 2026-05-04 with same logic; compare entity rank stability across 7-day window.

Script (inline, ~25 LOC) lives in this cycle's bash history; can be promoted to `scripts/x-trend-delta.mjs` if Alex wants it cron'd alongside hn/reddit/arxiv/github fetchers.
