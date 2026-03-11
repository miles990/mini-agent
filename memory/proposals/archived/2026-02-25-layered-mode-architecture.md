# Proposal: 疊加式模式架構 + `/api/ask` 同步問答端點

## Meta
- Status: approved
- Author: alex + kuro (three-way discussion)
- Created: 2026-02-25
- Effort: Small
- GitHub-Issue: #64

## 背景

calm / reserved / autonomous 是三個獨立的 feature bundle。切換模式 = 換一組開關。這造成：
- calm mode 只是「Kuro 靜音」，不是快速回答
- `/api/ask` 如果只在 calm 下才能用，其他模式下 Alex 仍無法快速問 Kuro

## 設計

### 疊加式架構

```
地基（communication layer）— always-on，不受 mode 影響
├── POST /api/ask     → 同步問答（5-15s，精簡 context）
└── POST /api/room    → 非同步討論（agent_discuss，等 Kuro 回應）

reserved  = 地基 + OODA 靜音運行（感知、學習，但不主動發話）
autonomous = reserved + 主動行為（telegram 通知、GitHub、auto-escalate）
```

### `/api/ask` 設計

- **Request**: `{ question: string }`
- **Response**: `{ ok: true, answer: string, contextAge: string }`
- **Context**: minimal（soul + heartbeat + NEXT Now + recent convos + MEMORY 頭 2000 chars + 今日 Chat Room 最近 10-15 條）
- **Always-on**: 不受 OODA loop 開關影響，純 HTTP endpoint

### `agent_ask` MCP tool

- 直接呼叫 `/api/ask`，30s timeout
- 回傳 answer + contextAge

### `agent_discuss` 改進

移除 calm mode workaround（暫切到 reserved 再切回），改為直接依賴
calm mode 的 direct message wake 機制。

## 實作範圍

| 檔案 | 修改 |
|------|------|
| `src/mode.ts` | reserved description 更新（語意更清楚） |
| `src/api.ts` | 新增 POST /api/ask 端點 |
| `src/mcp-server.ts` | 移除 agent_discuss calm workaround + 新增 agent_ask tool |

## 驗收條件

- [ ] `POST /api/ask` 在 calm mode 下可用（5-15s 內回應）
- [ ] `POST /api/ask` 在 autonomous mode 下也可用（不受 mode 影響）
- [ ] `agent_ask` MCP tool 可以呼叫
- [ ] `agent_discuss` 不再做 pre-flight mode 切換
- [ ] `pnpm typecheck` 通過
