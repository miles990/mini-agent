# guardrails-automation-principle

- [2026-04-19] [2026-04-19] guardrails-v2 (commit f75479ca) 確立原則：能自動化的護欄用 code 不用 prompt。具體實作：(1) noopStreak 持久化到 loop-health.json，跨 restart 不歸零 (2) noopStreak >= 3 自動廣播 action summary 到 TG，不依賴 Kuro 記得說。見 feedback_automate_everything.md。行為影響：看到「Kuro 有時會 X」pattern 時，預設思考「寫成 gate/hook/persistent state」而不是「加 HEARTBEAT 規則」。Prompt 是建議、code 是事實。
