# 中台架構總覽

## 核心定位
中台（Middleware/Brain）是 Kuro 的基礎設施器官（Infrastructure Organ），不是雲端服務。
類比：像 Kernel、Database、K8s — 提供 dispatch、DAG 執行、retry、audit、observability。
不擁有：語意決策、agent 認知、身份、why/what 問題。

## Head/Limbs 分工
- **Head**（mini-agent）：感知、脈絡、決策 — dispatcher.ts, loop.ts, agent.ts
- **Limbs**（middleware）：子程序、worktree、watchdog、容量佇列 — middleware server port 3200

## System 1 vs System 2 雙軌
這是 v3 的關鍵洞見，不是缺陷而是特性：

| 路徑 | 認知系統 | 實作 | 特性 |
|------|----------|------|------|
| `<kuro:delegate>` | System 1（快、無狀態、短暫）| delegation.ts 本地 spawn | 反射層，跨程序開銷是退化的 |
| `<kuro:plan>` | System 2（編排、DAG、有狀態）| middleware `/accomplish` API | 多步驟協調的基礎設施模式 |

## 核心元件
1. **Dispatcher**（dispatcher.ts, 1900+ 行）— tag 解析、acceptance gate、system prompt 建構
2. **Delegation**（delegation.ts, 476 行）— 編輯層策略、forge slot、commitment bridge、BAR Phase 2 routing
3. **Middleware Client**（middleware-client.ts, 435 行）— 雙介面 SDK、typed errors、transport 可抽換
4. **Task Graph**（task-graph.ts, 350+ 行）— DAG 建構、依賴偵測、合併最佳化、執行波規劃
5. **Commitments**（commitments.ts, 274 行）— 本地承諾追蹤（提取、更新、逾期偵測）
6. **Verify**（verify.ts, 115 行）— acceptance 驗證基元（file-exists、file-contains、git-pushed、service-healthy）
7. **Forge**（forge.ts）— git worktree 管理，程式碼 worker 隔離

## Worker 路由對照表
```
code → coder | research → researcher | learn → learn
review → reviewer | create → create | plan → planner
debug → debugger | shell → shell | browse → web-browser
akari → cloud-agent | graphify → shell
```
