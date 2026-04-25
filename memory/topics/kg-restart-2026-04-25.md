# kg-restart-2026-04-25

- [2026-04-25] KG service 在 mini-agent 需要 port 3300（CLAUDE.md / plugins/knowledge-graph.sh / kg-continuity.ts）但 `kn serve` 預設 8765。重啟指令：`nohup /Users/user/Workspace/knowledge-nexus/bin/kn serve --port 3300 > /Users/user/Workspace/knowledge-nexus/logs/serve.log 2>&1 &`。Health check：`curl localhost:3300/api/v1/health` 應回 `{"status":"ok"}`。長期 fix：把這個指令包成 launchctl plist 或 self-healing.sh 的探活項目，避免手動重啟。
