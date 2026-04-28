<!-- Auto-generated summary — 2026-04-28 -->
# 2026-04-28-ai-trend-90-diagnosis

Fetcher 基礎設施正常運作，但 enrichment pipeline 因 Anthropic API 餘額不足全面失效，導致所有文章的 LLM-generated summary（claim/evidence/novelty）仍在 pending 狀態，資料品質未達 90 分目標。此外發現 off-by-one date bug 仍未完全修復，且 cron 實際執行時間（06:17/06:18）與排程時間（01:30）不符，需進一步排查。
