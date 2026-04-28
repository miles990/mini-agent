<!-- Auto-generated summary — 2026-04-28 -->
# ai-trend-enrich-fix

Enrich pipeline 的死結透過環境變數配置純軟體解決：指向本地 MLX 模型伺服器 `LOCAL_LLM_URL=http://localhost:8000` 即可啟用 Qwen3.5-4B 推理，無需修改程式碼或 Anthropic API。04-27.json 資料集順利完成 17/17 enrich（先前遠端方案全部失敗），驗證本地 LLM 為可行的 fallback 策略。
