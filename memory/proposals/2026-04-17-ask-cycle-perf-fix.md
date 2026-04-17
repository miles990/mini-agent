# Proposal: Ask + Cycle 性能修復（架構級）

**Status**: Draft / awaiting Alex review
**Author**: Claude Code
**Date**: 2026-04-17
**Effort**: Large (architecture)

## 問題描述（用 evidence）

| 指標 | 當前 baseline | 目標 |
|---|---|---|
| `/api/ask` p50 | ~53s（實測 1 sample） | <30s |
| Cycle p50 | ~180s（middleware agent-brain Opus 深推理） | <90s for routine |
| Main event loop max lag | 觀測到 157s spike（fg call 期間） | <1000ms |
| Cycle hang 觀感 | 經常「看似卡死」（其實只是慢，cycle 會 recover） | 應有可觀察進度 |

## 根本原因（架構層）

mini-agent 是 **single Node process** 跑 daemon + cycle + LLM iteration + HTTP server，所有東西在 main event loop。Layer C 部分解了 — 把 `execProvider` 的 SDK iteration 外包到 middleware — 但有兩個漏洞：

1. **`sideQuery` 繞過 Layer C**：`src/side-query.ts` 直接呼叫 `execClaudeViaSdk`，在 main event loop spawn SDK iterator。`memory.ts` 的 `semanticRankTopics` 和 `context-compaction.ts` 的 `compactContext` 都會走這條，每個 cycle 都可能在 buildContext 期間觸發
2. **`/api/ask` overkill**：ask 的真實需求是「search-augmented Q&A」，但走了 Kuro 完整 `callClaude → execProvider → middleware agent-brain (Opus, 1500s timeout)` pipeline。Ask 的 `suppressChat=true, skipHistory=true` 已經暗示它不該像 cycle 一樣全能

## 修復方案（DAG Plan）

| id | 動作 | 執行者 | dependsOn | 完成條件 |
|---|---|---|---|---|
| P1 | middleware 加 `qa-fast` worker（Sonnet, maxTurns 3, 30s timeout, 30s progress） | CC | - | `curl /health` 顯示 `qa-fast` 在 workers list |
| P2 | `/api/ask` 改：feature flag `ASK_DIRECT_PATH=true` 時直接 POST middleware `qa-fast`，繞過 `callClaude` / `postProcess` / `execProvider`；保留 buildContext + FTS5 注入；fallback 為 legacy `callClaude` 當 flag off | CC | P1 | flag off → legacy 行為；flag on → 新 path |
| P3 | `side-query.ts` 加 middleware gate（同 `execProvider` 模式：`isMiddlewareCycleEnabled() && opts.source !== 'ask'` → 走 middleware；否則走 SDK） | CC | - | grep `isMiddlewareCycleEnabled` in `src/side-query.ts` returns ≥1 |
| P4 | 量測 baseline 紀錄到 `memory/proposals/2026-04-17-baseline-metrics.md`：ask p50/p99（10 samples）、cycle p50（10 cycles）、`/metrics/loop-lag` p99 + max | CC | - | metrics file 存在且有 10 samples |
| P5 | Alex 啟用 `ASK_DIRECT_PATH=true`；CC 量測對比 | Alex + CC | P2, P4 | 對比 metrics 寫進 proposal，p50 比較表填好 |
| P6 | 確認 ASK p50 < 30s 且無 regression → graduate flag（刪 legacy path + 刪 flag） | CC | P5 + Alex 確認 | `src/api.ts` `/api/ask` 只剩一條 path，無 ASK_DIRECT_PATH 引用 |

完成條件（整體 convergence）：
- `/api/ask` p50 < 30s（10 samples 量測證明）
- Cycle p50 < 90s（routine cycle，觀測 24h）
- main event loop max lag < 1000ms（observation 24h）
- 系統穩定 48h 無 cycle hang incident

## 與其他選項的比較

| Option | Pros | Cons | 我的評估 |
|---|---|---|---|
| **A: Cycle worker process（完整 cycle 移出 main）** | 真正 isolation | IPC 協議複雜、改動極大、影響身份/狀態管理 | 寫 future proposal；現在不做 |
| **B: 只修 sideQuery middleware gate** | 改動最小 | 不解 ask overkill | 不夠 |
| **C: 本 proposal（P1-P6）** | 解 ask overkill + 修 sideQuery + flag 可控 | 中等改動 | 推薦 |
| **D: 在 buildContext 加 per-await timeout** | 防 hang | 不解延遲 | 配合 C 也可，但獨立做訊息量低 |

## 風險

1. **Middleware 成 ask SPOF** — fallback `ASK_DIRECT_PATH=false` 即恢復 legacy
2. **Sonnet vs Opus quality** — qa-fast 用 Sonnet，可能某些 ask 答案質量降。fallback 機制 + flag 控可逆
3. **postProcess 不執行** — ask 不再 trigger `kuro:remember/delegate/task` 等 tag。實際上 ask 本來 `suppressChat=true skipHistory=true`，多數 tag 不該被觸發；但需驗證沒有 regression

## 可逆性（C4）

| 階段 | 回退方式 |
|---|---|
| P1 (qa-fast worker) | 移除 worker definition、middleware restart |
| P2 (flag-controlled new path) | env 不設或設 `false` |
| P3 (sideQuery gate) | git revert single commit |
| P6 (graduate) | git revert + 重啟 |

每個 step 都可獨立 revert，不需 cascade。

## 不做的事

- 不評估時間（依 Alex 2026-04-14 規則）
- 不在這個 session live 上 implement — 等 Alex review
- 不做 Option A（cycle process isolation）— 寫 future proposal

## Review checklist (Alex)

- [ ] DAG plan 是否完整？
- [ ] 完成條件是否可觀察 / 可量化？
- [ ] 是否有遺漏的 risk？
- [ ] P5 的 flag 啟用要 Alex 還是 CC 自動？
- [ ] qa-fast worker model 應該是 Sonnet 還是 Haiku？
- [ ] graduate (P6) 需要多少 stable observation 才動？

## 同步給 Kuro

寫完此 proposal 後發 room 訊息（≤500 chars）指向本檔案，不塞 long content。
