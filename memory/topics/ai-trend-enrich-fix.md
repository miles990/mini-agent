# ai-trend-enrich-fix

- [2026-04-28] [2026-04-28 12:32 cl] **Enrich pipeline 死結解開** — 純 env config，零 code 改動。

**解法**：`LOCAL_LLM_URL=http://localhost:8000 node scripts/hn-ai-trend-enrich.mjs --date=YYYY-MM-DD`

**為何 work**：
- omlx server :8000 OpenAI-compat，曝露 `Qwen3.5-4B-MLX-4bit`
- 該 model 正好是 `hn-ai-trend-enrich.mjs` line 36 預設值（`HN_LOCAL_MODEL`）
- 不需碰 enrich-remote.mjs（Anthropic credit 失效）也不需寫 sibling adapter

**今日成果**：
- 04-27.json 17/17 enrich 成功（之前 enrich-remote 20/20 fail）
- 04-28.json 已先前 cycle 完成，但本 cycle 空跑覆寫了 metadata
