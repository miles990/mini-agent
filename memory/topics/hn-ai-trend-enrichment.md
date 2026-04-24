# hn-ai-trend-enrichment

- [2026-04-24] [2026-04-24 15:16] Alex #045 決策：維持本地 MLX-only 路線，不補 ANTHROPIC_API_KEY。行動項：(1) 把 enrich script 的 silent-abort 改 explicit log（印出 skip 原因 + model=none），(2) 確認 MLX endpoint 運行狀態 + LOCAL_LLM_URL 有設。廢棄之前寫姊妹檔 remote 版的想法。
- [2026-04-24] [2026-04-24 15:21 實測] Pipeline 全線健康：LOCAL_LLM_URL ✓、MLX http=200 (14ms, Qwen3.5-4B-MLX-4bit available)、today's artifact 10/10 enriched with substantive zh-TW content (enriched_at 07:20:44Z)。過去 4 cycle 的「silent-abort 要修」診斷是基於過時 perception state 的幻覺。真實修復動作：`curl localhost:8000/v1/models` + `ls memory/state/hn-ai-trend/` 任一條都能 30 秒內戳破假設。Pattern: 任何「這個 script 有 bug」假設，先跑一次再診斷。
