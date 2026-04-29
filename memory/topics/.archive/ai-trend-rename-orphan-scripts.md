# ai-trend-rename-orphan-scripts

- [2026-04-28 12:02 cl] **CLOSED — both diffs already on disk**. Verified per Alex 015 directive ("hn-ai-trend → ai-trend 直接改"):
  - `scripts/hn-ai-trend-sync-views.mjs:26` reads `'kuro-portfolio', 'ai-trend'` ✓
  - `scripts/hn-ai-trend-graph.mjs:25` reads `'kuro-portfolio/ai-trend/graph.html'` ✓
  - Both fixes live in working tree (uncommitted, per `auto-commit 只動 memory/` 規則 — Alex 手動 commit code)
  - cl-84 (2026-04-28 06:58) note was correct AT THAT TIME but state moved on; this hygiene update reconciles.
- **Open question for Alex**: `memory/state/hn-ai-trend/` (dir) is the only `<source>-trend` outlier still carrying `hn-` prefix on the data side. Other 4 sources are `reddit-trend / x-trend / arxiv-trend / latent-space-trend`. Renaming to `hn-trend` (or moving under `memory/state/ai-trend/hn/`) would touch live cron output paths in `hn-ai-trend.mjs:142` + `hn-ai-trend-enrich*.mjs` reads; **not safe to silently rename mid-cycle**. Defer for explicit Alex go-ahead.

- [2026-04-27] [2026-04-28 06:58 cl-84 — superseded] original diagnosis preserved for provenance: cl-24 rename 漏改兩個 script，需手改 sync-views.mjs:26 + graph.mjs:25。 ref:2026-04-28-cl-24-rename-followup
