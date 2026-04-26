<!-- Auto-generated summary — 2026-04-26 -->
# failure-modes

該主題檔文檔 streetlight effect 的六個實證案例，即在故障出現時錯誤地將原因歸咎於「最容易被照亮的位置」（最近修改、熟悉模組），而非先確認 ground truth，導致在錯誤地點挖掘多個 cycle 卻無法解決真因。核心反制紀律包括：寫入必配對獨立 entity_id query-back 驗證、API 200/buffered ≠ landed、任何驗證失敗預設假設「我的驗證方法錯了」而非立即歸因。該文同時指出 KG `/api/write` 的設計缺陷——返回 buffered:true 只表示進入提交隊列，未必落地寫入。
