# Proposal: Product Meeting Simulator — AI 產品會議模擬器

## Meta
- Status: pending
- From: alex + claude-code
- Effort: M (已完成 Phase 1 MVP)
- Level: 獨立專案（`~/Workspace/product-meeting/`）
- Priority: P2

## Problem

獨立開發者/小團隊最大的痛點不是「沒人幫你做」，是「沒人幫你想清楚」。現有多 Agent 框架（ChatDev、MetaGPT）讓你旁觀 Agent 工作，但沒有人挑戰你的想法。

核心差異：**使用者是決策者（老闆）**，不是旁觀者。Agent 會 push back、互相辯論、遇到無法決定的事升級給你。

## Design

### 三個 MVP Agent

| Agent | 職責 | 個性 |
|-------|------|------|
| **PM** | 釐清需求、主持會議、整理結論 | Push back 過大的範圍 |
| **Tech Lead** | 技術可行性、架構選型、成本 | 必須提出至少一個「做不到」的理由 |
| **Critic** | 魔鬼代言人（市場/法規/競品） | KPI 是找碴 |

### 會議流程（State Machine）

```
CLARIFY（PM 提問 → 老闆回答，3-6 輪）
  → RESEARCH（3 Agent 平行分析，Promise.all）
  → DISCUSS（輪流發言 + 衝突偵測 + 升級給老闆，2-4 輪）
  → CONVERGE（PM 整理結論）
  → COMPLETE（產出 Blueprint）
```

### 衝突偵測（Deterministic，零 LLM）

Agent 發言含 XML tag（`<opinion>`, `<risk>`, `<blocker>`），`parseTurn()` 提取結構化資料。
- support vs oppose = direct-opposition → 升級給老闆
- 任何 `<blocker>` = 硬門檻 → 一定升級
- confidence gap > 0.5 = 提醒

### 產出（Blueprint）

```
output/{session-id}/
├── 00-vision.md          # 產品願景
├── 01-requirements.md    # 需求規格（PM）
├── 02-architecture.md    # 技術架構（Tech Lead）
├── 03-risks.md           # 風險清單（Critic）
├── 04-mvp-scope.md       # MVP 範圍
├── 05-tasks.md           # 實作任務清單
├── 06-decisions.md       # 老闆的每個決定
└── meeting-log.jsonl     # 完整會議記錄（可 crash resume）
```

### 技術棧

- TypeScript strict mode, ESM
- LLM: Claude CLI subprocess（`claude -p`），provider 介面預留擴展
- CLI: chalk + ora
- 儲存: Markdown + JSONL（File = Truth）

## Current Status

Phase 1 MVP 已完成實作（`~/Workspace/product-meeting/`），build 通過。

```bash
cd ~/Workspace/product-meeting && pnpm start "你的產品想法"
```

## Roadmap

| Phase | 內容 | 狀態 |
|-------|------|------|
| **1: CLI MVP** | 3 Agent + 衝突偵測 + Blueprint | ✅ Done |
| 2: Web UI | 會議室介面 + SSE 即時推送 + Session 持久化 | — |
| 3: 角色擴展 | +Marketing/UX/Biz + 多模型 Provider | — |
| 4: 迭代 + 研究 | 多輪 V1→V2 + 網路搜尋 + 知識庫 | — |
| 5: 設計整合 | Wireframe + 任務匯出 GitHub Issues | — |
| 6: Claude Code Plugin | `/meeting` 指令 + MCP Server | — |

## 與 Kuro 的關聯

- Kuro 已在 Telegram 回覆表示認同「使用者是決策者」的定位是關鍵差異
- 未來 Phase 6 可整合為 Claude Code Plugin / MCP tool
- 會議引擎的 Agent 架構（structured XML tags + deterministic conflict detection）可供 Kuro 參考
