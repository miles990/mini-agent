<!-- Auto-generated summary — 2026-04-21 -->
# middleware-as-infra

Middleware 應定位為 agent 的基礎設施層（如 kernel/DB/K8s），管理路由、重試、配額等機械性通用問題，不做語義決策。三層分工清晰：Primary (Kuro) 決策意圖、Middleware 提供基礎服務、Worker 執行專業能力，任何涉語義、創造或身份的決策都不歸 infra 管。這個架構錨點終結了之前關於 middleware 權責邊界的爭議，將模糊的連續光譜轉為離散判斷規則。
