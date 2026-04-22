# 中台改進歷程

## 演化時間線

### Phase 1: System 1/2 分離（2026-04-14）
**里程碑**：從 middleware v2 → v3 的關鍵 pivot
- 認識到不是所有任務都需要 DAG 編排
- delegate（System 1）和 plan（System 2）是互補的，不是競爭的
- 「正確的約束放在正確的層」

### Phase 2: Middleware-as-Organ 提案（2026-04-15）
**架構鎖定**：明確 middleware 是本地器官不是遠端服務
- delegation.ts 從 1431 行瘦身到 ~350 行目標
- 移入 middleware：subprocess spawn、worktree isolation、watchdog、capacity queue
- 保留 mini-agent：prompt assembly、context injection、result attachment
- 單刀切換策略：無 feature flags、無 shadow run、一次性切換可還原

### Phase 3: Commitment Ledger（2026-04-16）
**問責基礎設施**：橋接人類問責和機器執行追蹤
- Schema v2-final 定案
- 生命週期：active → fulfilled/superseded/cancelled
- TTL 7 天、每 owner 最多 20 active
- 取代本地 commitments.ts（Phase 1 現在，Phase 2 切換後）

### Phase 4: DAG 強制 + BAR 全線（2026-04-16）
**完工里程碑**：
- `1c6ac626` — dispatcher acceptance gate Phase 1（軟警告）
- `645635c2` — middleware-client AccomplishRequest schema 對齊
- `12833888` — edit-layer gate + convertAndDispatchAsPlan
- `fd8c51ff` — client-side replan loop（Gap A）
- `95913fb4` — 統一 single-delegate 走 spawnDelegation（Gap B）
- `543d81ad` — BAR Phase 2 route tracked delegates 走 /accomplish
- `a5cf65b3` — commitments ledger schema v2-final
- 三方共識：Kuro + CC + Akari 確認
- 9 scenario types 驗證通過

## 改進方向清單

### 已完成
- [x] acceptance gate（軟警告→引導寫 acceptance）
- [x] replan loop（失敗自動重試，含 prior_attempts context）
- [x] commitment ledger（跨 cycle 承諾追蹤）
- [x] DAG plan language 統一（計畫 schema = 執行 schema）
- [x] 單一派遣入口（Gap B unification）
- [x] BAR 端到端閉環

### 進行中
- [ ] delegation.ts 瘦身（1431 → 350 行）
- [ ] middleware per-task cwd 支援
- [ ] GET /commit/:id 路由
- [ ] POST /commit 持久化 owner + acceptance

### 未來方向
- [ ] 選擇性 worker 曝露（高價值 worker 成為跨 agent worker）
- [ ] Worker 註冊由信號觸發（第 2 個真實呼叫者 OR >15 instances）
- [ ] 路由不匹配自動記錄（3-5 案例觸發重分類）
