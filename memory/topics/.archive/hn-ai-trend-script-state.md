# hn-ai-trend-script-state

- [2026-04-21] scripts/hn-ai-trend.mjs verified working 2026-04-21. Default dry-run mode; config flags `--kg` (ingest to localhost:3300), `--since` (default 24h), `--min-score` (default 15). Output schema locked: posts[] with summary{claim,evidence,novelty,so_what}. Cron `15 */3 * * *` already scheduled. Next: add LLM enrichment for novelty/so_what fields (currently 'pending-llm-pass' placeholder).
