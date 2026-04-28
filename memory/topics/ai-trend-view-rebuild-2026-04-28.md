# ai-trend-view-rebuild-2026-04-28

- [2026-04-28] [2026-04-28 12:37 cl] **AI Trend P0 view layer 通了** — 5 sources × 195 posts × 3 views byte-equal DATA parity。

**Build pipeline (verified working)**:
1. `node mini-agent/scripts/hn-ai-trend-graph.mjs` — canonical builder，讀 5 sources（hn/reddit/x/arxiv/latent），dedup + tag + topSignals → 寫 graph.html
2. `node mini-agent/scripts/hn-ai-trend-sync-views.mjs` — 抽 graph.html `const DATA = ...;` line，propagate 到 swimlane.html + source-split.html，asserts byte-equal

**Quality numbers (from swimlane DATA
