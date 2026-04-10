# Proposal: Daemon / Agent 前後台分離 + ACP Delegation

**Date**: 2026-04-10
**Author**: Claude Code + Alex
**Effort**: Large (L3)
**Status**: Draft — 等 Kuro 加入討論

## 動機

今天 8 個效能 commit 過程中暴露的根本架構問題：前台（AI Agent）和後台（Framework）綁在同一 process。

- Claude subprocess EXIT143 帶走 perception/API
- Deploy 重啟中斷 OODA cycle
- Perception 每次 cold start（加了 cache 緩解但根本沒解）
- Delegation 是 one-shot subprocess，crash 就丟

## 架構

```
後台 daemon（永遠在線，獨立 process）
├── HTTP Server + API + SSE
├── Perception Stream（warm cache 跨重啟）
├── Event Bus / Cron / File Watch
├── ACP Session Pool（新增）
│    ├── Claude Code session（code/review）
│    ├── Kiro CLI session（探索性任務）
│    └── Local model session（輕量任務）
└── Room / Telegram bridge

前台 Agent = Kuro（可獨立重啟）
├── OODA Loop Controller
├── Agent SDK query() / ClaudeSDKClient
├── Tag Dispatcher
└── <kuro:delegate> → daemon API → ACP pool
```

**核心原則**：daemon 提供眼睛和神經系統，agent 提供認知和決策。兩者透過 API 溝通。

## Phase 分解

### Phase 1: Agent SDK 遷移
- `spawn('claude')` → SDK `query()` / `ClaudeSDKClient`
- 內建 session resume（不用每次重建 context）
- In-process MCP tools（perception 變 SDK tool）
- Programmatic hooks（取代 shell hooks）
- SDK 支援訂閱（billing 不變��

### Phase 2: Process 分離
- daemon = main process（HTTP + perception + event bus + ACP pool）
- agent = worker_thread 或獨立 process
- Agent crash → daemon 偵測 → 自動 restart agent → perception/API 不中斷
- Deploy → 只重啟 agent worker，daemon hot-reload

### Phase 3: ACP Delegation Pool
- 參考 OpenAB 的 session pool + pluggable backends 設計
- 不走 Discord — 直接接 daemon API
- `POST /api/delegation` → daemon 根據 type 選 backend + 管理 lifecycle
- Kuro 透過 event bus 收取結果
- Multi-turn session（不是 one-shot）

### Phase 4: Hybrid Routing（參考 jiexi.page Hybrid Agent Playbook）
- Rule layer → local fast path（omlx-gate 已有雛形）
- Semantic layer → mushi triage（已有）
- Specialist models → code/embedding/classification
- 90/10 法則：90% local routine, 10% cloud reasoning

## 關鍵設計決策（待討論）

1. **daemon ↔ agent 通訊**：IPC pipe vs HTTP localhost vs shared memory?
2. **ACP vs Agent SDK**：delegation 用 ACP protocol（標準化、multi-vendor）還是 Agent SDK（in-process、low latency）？
3. **Session resume vs context rebuild**：transcript 能涵蓋 perception 嗎？還是需要混合？
4. **哪些 perception 移到 daemon，哪些留在 agent**：全部 daemon? 還是 agent-specific 的留前台？

## 風險

- Agent SDK 是新工具，可能有未知限制
- Process 分離增加 IPC 複雜度
- ACP 生態很新（OpenAB 一週前才建立）
- 大改動期間 Kuro 要保持運行

## 可逆性

- Phase 1: SDK 和 subprocess 可以並存，feature flag 切換
- Phase 2: worker_thread 可以退回 same-process
- Phase 3: ACP pool 是新增不是替換，舊 delegation 可保留
- Phase 4: routing 有 fallback chain
