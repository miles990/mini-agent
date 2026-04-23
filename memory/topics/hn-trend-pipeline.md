# hn-trend-pipeline

- [2026-04-23] [2026-04-23 08:11] cl-46 falsifier closed. LOCAL_LLM_URL=http://localhost:8000 healthy (HTTP 200, Qwen3.5-0.8B/4B MLX loaded). Three-state finding (status="enriched" + null values on 13 posts) is NOT infra — it's pipeline logic. Smoking gun: hn-ai-trend-enrich.mjs L51 filters on `novelty === 'pending-llm-pass'`, so posts with `novelty === null` are silently skipped; L103-104 fallback would produce string "unspecified", never null. Therefore status="enriched" was written by hn-ai-trend.mjs (fetch
