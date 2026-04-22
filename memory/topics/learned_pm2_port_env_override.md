# learned_pm2_port_env_override

- [2026-04-17] PM2 `ecosystem.config.js` 裡的 `env.PORT` 只是 fallback — 如果 launchd/shell 層已經有 `PORT=xxx` 在 env，PM2 啟動時會優先吃外層 env，覆蓋 config 預設。
症狀：middleware ecosystem 寫 PORT=3200，實際起在 3001，佔了別人的 port（IPv6 劫持）。
修法：`pm2 restart --update-env PORT=3200` 強制覆蓋。
預防：ecosystem config 用 `env_production.PORT` + `pm2 start --env production`，或 launchd plist 明確不要帶 PORT。
驗證：`lsof -iTCP:PORT -sTCP:LISTEN` 確認是期望的 service。
