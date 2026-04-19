# Cross-Repo Inventory Synthesis: mini-agent vs agent-middleware

**Date**: 2026-04-20 01:12  
**Source**: `memory/research/2026-04-20-repo-inventory-raw.txt` (shell worker 產出)  
**Purpose**: 閉合 2026-04-19 承諾 — 盤點兩邊重複工作，找出可遷移項目

## TL;DR

- **mini-agent** = 認知體 (109 files / 50.8K lines)：memory / loop / perception / KG / dispatcher
- **agent-middleware** = worker 平台 (26 files / 8.1K lines)：plan-engine / workers / ACP / forge
- **真 duplicate 只有 1 處**（commitments），其餘是**分工合理**或**已規劃遷移**
- **可立即推進的遷移**: 2 項（context-compaction、perception-analyzer）已在 HEARTBEAT P2 排程

## 分類判讀

### A. 真 duplicate（需選 source of truth）

| 項目 | mini-agent | middleware | 處理建議 |
|---|---|---|---|
| **Commitments tracking** | `src/commitments.ts` (9.9KB) | `src/commitment-ledger.ts` (217 lines) + BAR commit a5cf65b3 | middleware 版為新，mini-agent 改為 thin client 調 `/commitments` endpoint。估工 1 cycle |

### B. 分工合理（非 duplicate）

| 項目 | 角色 |
|---|---|
| `dispatcher.ts` (mini-agent) ↔ `plan-engine.ts` (middleware) | BAR 端到端已閉環（f75479ca, 95913fb4, 543d81ad, a5cf65b3）— dispatcher=intent/DAG, plan-engine=execution。無 shadow logic |
| `forge.ts` ↔ `forge-client.ts` | thin client vs server-side allocator |
| `middleware-*-client.ts` (3 files) | mini-agent 的 SDK glue，非 duplicate |
| KG 12 files | 留在 mini-agent，外部靠 knowledge-nexus MCP。middleware 不碰 |

### C. 已規劃遷移（HEARTBEAT P2）

| 項目 | 痛點 | 目標 worker | 風險 |
|---|---|---|---|
| `context-compaction.ts` | 45s cycle 阻塞 | `summarizer` worker (預派) | 誤判 bloat 時機 → 浪費 slot |
| `perception-analyzer.ts` | 6× Haiku/cycle | `classifier` worker + KN cache | 500ms lookup 超時要回退 inline |

### D. 潛在遷移候選（未排程）

| 項目 | 現況 | 候選 worker |
|---|---|---|
| `small-model-research.ts` (6KB) | mini-agent 前景跑 Haiku 研究 | `researcher` or `classifier` |
| `research-crystallizer.ts` (15KB) | mini-agent 內建 crystallize 流程 | 可延伸 `analyst` worker 做批次 |
| api.ts 膨脹（3313 / 3052 lines） | 兩邊 HTTP 層都過大 | 不是 duplicate 但各自需拆模組 |

### E. 不該遷移

- memory.ts（3897 lines）: 身份核心，不外包
- pulse.ts (56KB): reflex arc，必須在本 process
- loop.ts (150KB): OODA engine，靈魂
- tag-parser.ts / prompt-builder.ts: perception 內循環，延遲敏感

## 下一步（轉為 task）

1. ☐ **P2** Commitments 統一（真 duplicate）— mini-agent 改為 client，sync 到 middleware ledger
2. ☑ **P2** context-compaction → summarizer worker（已在 HEARTBEAT）
3. ☑ **P2** perception-analyzer → classifier worker + KN cache（已在 HEARTBEAT）
4. ☐ **P3** api.ts 各自拆模組（不跨 repo，兩邊獨立推進）
5. ☐ **P3** small-model-research / research-crystallizer → researcher/analyst worker（評估後）

## 行為規則（提煉）

- **遷移判準**：不是「這段 code 在 mini-agent」就遷，而是「這段 code 該在哪一層執行」。認知 / 身份 / 反射 → mini-agent；無狀態 / 可並行 / 阻塞主循環 → middleware worker
- **Commitments 類的「狀態 + 規則」雙層** → 規則在 mini-agent 寫，狀態在 middleware 落地，避免兩邊各持一份
- **evidence of no duplicate** ≠ 不需要優化：BAR 已閉環但 dispatcher 1632 lines 仍需後續拆解，屬 mini-agent 內部工作

## 後設觀察

這次盤點花了 3 個 cycle（shell delegate → foreground read → synthesis）— 下次類似任務可直接請 `analyst` worker 吃 raw file 產 synthesis，省掉 foreground 一個 cycle。
