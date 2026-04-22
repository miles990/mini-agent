<!-- Auto-generated summary — 2026-04-15 -->
# middleware-as-organ

Middleware 將升華為 mini-agent 的內建器官，通過 shadow run 驗證後切換，核心重框架是將其視為本機 OS 級器官（如 filesystem）而非雲服務，因此分開設計無意義。v1 限制在單一使用者範疇與本機容錯策略（launchd KeepAlive + health check），跨 agent 協作延至 v2。
