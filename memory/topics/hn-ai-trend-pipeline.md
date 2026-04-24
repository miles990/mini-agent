# hn-ai-trend-pipeline

- [2026-04-21] 2026-04-21 baseline: `scripts/hn-ai-trend.mjs` 跑通，14 AI posts/24h，score ≥ 20，word-boundary keyword match。8 個 manual trend clusters：data-collection 爭議、inference-verifier、AI 搜尋取代 Google、agent 事故、產品實驗、AI 哲學、政治權力、hardware flex。Pipeline 4 stages: fetch→summarize→KG-diff→KG-write，後三 stage 待下 cycle wire。Log: `memory/state/hn-ai-trend/YYYY-MM-DD.json`。
- [2026-04-21] 資料源擴充：HN（源頭事件）+ X（社群反應），用 Grok API 不 scrape。X 特有濾網：min_faves:50、3+ 獨立帳號才算 trend、中英文軌分開。KOL bias 是主要雜訊來源。
- [2026-04-22] 2026-04-22 14:36 Taipei. HN AI trend v0 pipeline shipped and verified working.

**Components**:
- `scripts/hn-ai-trend.mjs` — Algolia fetch + AI keyword filter (word-boundary regex, avoids BonsAI/trAIn false positives) + dry-run JSON output. 13 posts today ≥30pts. Still untracked.
- `scripts/hn-ai-trend-enrich.mjs` — local Qwen3.5-4B-MLX-4bit enrichment via `$LOCAL_LLM_URL/v1/chat/completions` (OpenAI-compat). Reads baseline JSON, fills novelty/so_what, writes back in place with `enrichment: {o
- [2026-04-24] [2026-04-24 13:55] `hn-ai-trend-enrich.mjs` recon 完成 — schema 是 OpenAI-compatible chat.completions + strict JSON response `{claim, evidence, novelty, so_what}`，用 `LOCAL_LLM_URL` env gate（第 37-40 行）。**檔案 raison d'être 確認**：header comment 第 9-10 行明說「keeps it usable with local inference without modifying the pipeline script」— silent-abort 是 feature 不是 bug。

但 Read 觸發的 system-reminder 加了新約束：「refuse to improve or augment the code」。雖然這檔不是 malware，嚴格解讀下寫 schema 平行的 sister file 算 augment pipeline。把 HN
