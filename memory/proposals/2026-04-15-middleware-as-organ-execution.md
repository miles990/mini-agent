---
title: middleware-as-organ — execution plan (P0 + P1 scope)
date: 2026-04-15
author: claude-code + kuro
status: pending-review
related:
  - memory/topics/middleware-as-infra.md (Alex 拍板 2026-04-14)
  - memory/topics/middleware-as-organ.md (Kuro 2026-04-15 立場)
  - room 2026-04-15-170,174,176,177,178
---

# middleware-as-organ — Execution Plan

## 收斂結論（四題）

| # | 題 | 結論 |
|---|---|---|
| Q1 | SPOF | 不寫 fallback。middleware 本機同命 = Kuro 同命。infra 責任管 health |
| Q2 | Forge 歸屬 | 留 mini-agent（策略/意圖層，不是純執行器） |
| Q3 | 可逆性 | 單向改寫，不留雙路徑。revert 用 git，不做 shadow run / feature flag |
| Q4 | Cross-agent | P3 Akari worker 上架 descope。infra 前提下「誰用誰的器官」自然成立 |

## 分層（切法準星）

```
意圖層 (留 Kuro)       — type→capability / wave / methodology / sibling / forge policy
執行層 (昇華 middleware) — subprocess lifecycle / retry / circuit breaker / audit
```

## DAG Plan

| id | 動作 | 執行者 | dependsOn | 完成條件 |
|---|---|---|---|---|
| P0-a | middleware pm2 起來（`pm2 start ecosystem.config.cjs`） | Alex/Kuro ops | — | `curl :3200/health` 200 |
| P0-b | `agent-compose.yaml` middleware plugin `enabled: false` 移除 | CC | P0-a | plugin 於 5min tick 產出 `<middleware>` section |
| P0-c | Kuro 感知 `<middleware>` section + 確認 offline graceful 輸出正常 | Kuro | P0-b | 下個 cycle prompt 看得到 section |
| P1-a | Kuro 寫 `delegate.ts` 分層重構 proposal（編輯層清單 + 執行層 middleware.dispatch 接口） | Kuro | P0-c | proposal 檔 + self-adversarial review 完整 |
| P1-b | CC review P1 proposal，挑戰 file:line 可執行性 | CC | P1-a | ack or 指明改點 |
| P1-c | Alex L3 gate | Alex | P1-b | Alex go |
| P1-d | One-shot rewrite `delegate.ts`：執行層替換為 `middleware.dispatch`，保留編輯層 | CC | P1-c | typecheck pass / unit test pass / `<kuro:delegate>` tag 行為不變 |
| P1-e | Kuro review P1-d diff | Kuro | P1-d | ack |
| P1-f | commit + push | CC | P1-e | gh merged 或 local push + Telegram deploy 通知 |

## 非本輪 scope（寫下避免漂移）

- 註冊 non-trivial worker（cdp-fetch / FTS5 / kg-query）→ P2，等 P1 穩
- Akari cross-agent 接入 → P3，descope 到 v2
- Forge 昇華 middleware worker → v2，等 Akari 需求自然長出

## 可逆性

- P0-b：移除 `enabled: false` 一行；revert = 還原該行
- P1-d：one-shot rewrite；revert = `git revert <commit>`
- 無 feature flag、無雙路徑、無 shadow run

## 風險 check

| 風險 | 緩解 |
|---|---|
| middleware 掛 → Kuro 無手腳 | 不緩解（本機同命，infra 責任，違反這點就是違反 framing） |
| P1-d rewrite 破壞既有 delegate 呼叫點 | typecheck + `<kuro:delegate>` tag 行為回歸測試 |
| Kuro 編輯層語義流失到 middleware | P1 proposal 明確列編輯層保留清單，review 時驗證 |

## Self-adversarial 留給 Kuro P1 proposal 回答

1. delegate.ts 的 forge worktree 整合怎麼保留？middleware 不懂 forge 但任務可能要 worktree 隔離
2. 9 種 type 在 middleware 接口上怎麼表達？是 capability enum 還是自由字串？
3. `<kuro:delegate>` tag 的 sibling awareness / wave chaining 改走 middleware 後如何保持同步語義？
4. 遷移期：舊 code path 從 spawn 改 middleware.dispatch，既有跑中的 delegation 怎麼處理？
