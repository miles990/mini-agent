# Architecture Reference

> 詳細架構說明。Claude Code 開發和 Agent 運行時都能參考。

## Perception System

### Builtin Modules (8)

| Module | Tag | Data |
|--------|-----|------|
| Environment | `<environment>` | Time, timezone, instance ID |
| Self | `<self>` | Name, role, port, persona, loop/cron status |
| Process | `<process>` | Uptime, PID, memory, other instances, log stats |
| System | `<system>` | CPU, memory, disk, platform |
| Logs | `<logs>` | Recent errors, events summary |
| Network | `<network>` | Port status, service reachability |
| Config | `<config>` | Compose agents, global defaults |
| Workspace | `<workspace>` | File tree, git status, recent files |

### Custom Plugins (Shell Scripts)

任何可執行檔 → stdout → `<name>...</name>` XML tag → Claude context

```yaml
perception:
  custom:
    - name: docker
      script: ./plugins/docker-status.sh
      timeout: 5000
```

現有: chrome-status / web-fetch / docker-status / port-check / disk-usage / git-status / homebrew-outdated

### Skills (Markdown Knowledge)

Markdown 檔案注入 system prompt (`## Your Skills`)

現有: web-research / docker-ops / debug-helper / project-manager / code-review / server-admin

## Web Access (Three-Layer)

1. **curl** — 公開頁面、API（快速 <3s）
2. **Chrome CDP** — 使用者已登入的 session（port 9222）
3. **Open page** — 可見 tab 讓使用者登入/驗證

Key files:
- `scripts/cdp-fetch.mjs` — 零依賴 CDP client（commands: status/fetch/open/extract/close）
- `scripts/chrome-setup.sh` — 互動式設定
- `plugins/chrome-status.sh` — CDP 狀態 + smart guidance
- `plugins/web-fetch.sh` — 自動 URL 提取
- `skills/web-research.md` — 三層工作流知識

## Project Structure

```
./
├── agent-compose.yaml   # Compose 配置
├── plugins/             # Shell script 感知插件
├── skills/              # Markdown 知識模組
├── memory/              # 記憶（此檔案所在）
│   ├── MEMORY.md        # 長期知識
│   ├── HEARTBEAT.md     # 任務管理
│   ├── ARCHITECTURE.md  # 架構參考（本檔案）
│   └── daily/           # 每日對話日誌
├── scripts/             # 工具腳本
└── src/                 # TypeScript source
```

## AgentLoop (OODA)

Observe → Orient → Decide → Act

支援：暫停/繼續、手動觸發、Cron 整合

## Multi-Instance (Docker-style)

```bash
mini-agent up [-d] / down / list / attach <id> / status / logs [-f]
```

每個實例隔離在 `~/.mini-agent/instances/{id}/`
