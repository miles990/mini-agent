<!-- Auto-generated summary — 2026-04-18 -->
# cowork-scheduling

協作 scheduling 的核心是在 agent 間同步頻率找到平衡點——足夠緊密使修復工作量 < 50%，又足夠寬鬆讓各 agent 完成獨立工作單元，Tick 應定義為有意義的 state transition 而非時間間隔。多 agent 團隊中，無差別共識導致專家性能衰減 37.6%，最優設計是採用 role bifurcation（如 designer/executor 分工）並用結構化安全機制（HALT valve）而非行為協商來管理衝突。
