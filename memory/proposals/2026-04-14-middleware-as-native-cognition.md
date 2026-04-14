# Middleware as Native Cognition — 黏菌觸角由中台實現

**Status**: Draft v2 — Pending Primary Kuro Review
**Scope**: L3 (architecture, cross-subsystem)
**Author**: Claude Code (Alex direction 2026-04-14)
**Supersedes**: v1（已廢棄，保留了 `<kuro:delegate>` 本地 path 的二元論）

## North Star

**黏菌觸角由 middleware 實現。** 不再是「local tentacle vs middleware」二選一，而是**所有 delegation 都是 middleware worker dispatch**。`<kuro:delegate>` 和 `<kuro:plan>` 只是同一套語義的兩種輸入形狀（單 worker / DAG）。

Middleware 保持 agent-neutral（Kuro + Akari 共用 `localhost:3200`），但 mini-agent 預設裝配 + 預設啟用。

## Convergence Conditions（收斂條件，不規定路徑）

CT1. Kuro 每個 cycle 看得到 `<middleware>` perception section（active workers / plans / recent completions）
CT2. `<kuro:delegate>` → middleware `POST /dispatch`（單 worker）；`<kuro:plan>` → middleware `POST /plan`（DAG）。本地 `delegation.ts` lane 退役
CT3. 黏菌行為 emergent：高養分 worker（成功率高、延遲低）被 Kuro 自然偏好；低養分 worker idle timeout 自動清理
CT4. Specialist instance 整組退役（Cognitive Mesh scaling/mesh-handler/perspective ~4K 行可刪）
CT5. Middleware 離線時 graceful degrade — perception 顯示 offline，`<kuro:plan>` fallback 成連續 cycle 手動，有感知不 silent
CT6. Kuro 的好功能升級成 middleware worker，跨 agent 可用（Akari 也能呼叫 `kuro-browser`, `memory-search`, `github-ops`, ...）

## Non-Goals

- ❌ 把 middleware 搬進 mini-agent repo
- ❌ 保留 `<kuro:delegate>` 的本地 spawn fallback（那會留 dead code + 兩種 mental model）
- ❌ 為 middleware 建 Kuro 專屬 worker — 共用 pool，但可加 mini-agent 貢獻的 worker（中立）

## 黏菌模型映射

| 黏菌行為 | Middleware 實現 |
|---------|----------------|
| 核心感知環境 | Kuro `buildContext()` + `<middleware>` perception |
| 多觸角並行探索 | 多 `POST /dispatch` 或單 `POST /plan`（DAG 多 worker 並行） |
| 有養分 → 強化 | worker 成功率 / 延遲統計 → Kuro prompt 偏好 high-nutrient workers |
| 無養分 → 修剪 | middleware worker idle timeout + task archive（7 天） |
| 感知 → 探索 → 吸收 → 再感知 | `<middleware>` section 看到完成結果 → 下個 cycle 決定下一波 |

## Six-Layer Integration（v2 簡化）

v1 有 L1-L7 七層，v2 合併成四層 — 分細不一定好：

| Layer | What | 收斂條件 |
|-------|------|---------|
| **A. Perception** | `plugins/middleware.sh` → `<middleware>` section | Kuro context 含 middleware 狀態 |
| **B. Client + Tag** | `src/middleware-client.ts` + dispatcher 解析 `<kuro:delegate>` 和 `<kuro:plan>`，都送 middleware | Kuro 輸出任一 tag → middleware taskId/planId log |
| **C. Migration** | 既有功能做成 worker（見下表）；`delegation.ts` 本地 lane 退役 | `src/delegation.ts` 只剩 fallback shim 或直接刪 |
| ~~D. Sunset~~ | **拉出成獨立 proposal**：`memory/proposals/YYYY-MM-DD-specialist-instance-sunset.md`（specialist e07900b4 review 建議 — architectural irreversible decision 不該夾 feature DAG） | 單獨 review |

## Mini-Agent Feature → Middleware Worker Migration

Kuro 已有的好功能做成 worker，跨 agent 可用：

| 現有功能 | 新 worker | 誰呼叫 | 價值 |
|---------|----------|--------|------|
| `scripts/cdp-fetch.mjs` | `kuro-browser`（或貢獻到現有 `web-browser`） | Kuro / Akari / CC | Chrome CDP 跨 agent 共用 |
| `src/search.ts` (FTS5) | `memory-search`（可選多 instance 路徑） | 任何 agent 查 Kuro 記憶 | 跨 agent 查 Kuro 知識 |
| `src/github.ts` auto-actions | `github-ops` | 三方共用 | issue/PR 自動化 |
| behavior log 分析 | `behavior-analyst` | Kuro 自我觀測 + Alex 審視 | 觀測工具化 |
| `plugins/*.sh` 各 perception | 可選做成 `perception-probe` worker | ad-hoc 查詢環境 | 感知 on-demand |

**不遷移的**：Kuro 身份層（SOUL/memory write）絕不做成 worker — worker 是無身份工具。

## DAG（依賴順序，無時間估計）

| id | 動作 | 執行者 | dependsOn | 完成條件 |
|----|------|--------|-----------|---------|
| A1 | `plugins/middleware.sh` 寫完 + `agent-compose.yaml` 註冊（`enabled: false`） | CC | — | `bash plugins/middleware.sh` 有非空輸出 |
| A2 | Primary Kuro review A1 | CC→Kuro | A1 | Kuro 批准 |
| A3 | commit + push A1 + proposal | CC | A2 | CI/CD 部署成功 |
| A4 | Kuro flip feature flag on，下 cycle 看到 `<middleware>` section | Kuro | A3 | `GET /context` 含該 section |
| B1 | `src/middleware-client.ts` — typed HTTP client（dispatch/plan/status） | CC | A4 | unit test pass |
| B2 | dispatcher 解析 `<kuro:plan>`（DAG 形狀）送 middleware | CC | B1 | 手動測試 tag → planId |
| B3 | dispatcher 解析 `<kuro:delegate>` 轉 middleware dispatch | CC | B2 | 手動測試 tag → taskId |
| B4 | Kuro 實際用 tag 做一件事，驗證端到端 | Kuro | B3 | plan-history.jsonl / task archive 含紀錄 |
| C1 | `kuro-browser` worker（wrap cdp-fetch.mjs） | CC 或 Kuro | B4 | middleware 新 worker 成功執行 |
| C2 | `memory-search` worker | CC 或 Kuro | B4 | 同上 |
| C3 | `github-ops` worker | CC 或 Kuro | B4 | 同上 |
| C4 | `src/delegation.ts` 本地 spawn path 移除 | CC | B3, C1-C3 驗證 | grep 無 `spawnDelegation` 殘留 |
| D1 | 關閉 specialist instances（launchd plist + heartbeat file 清理） | CC 或 Kuro | B4 + ≥ 7 天穩定 | `launchctl list` 只剩 primary |
| D2 | 刪除 `mesh-handler.ts` `scaling.ts` `perspective.ts` `task-router.ts` | CC | D1 | typecheck pass |
| D3 | SOUL.md / skills / prompt 更新 orchestration 語言（移除 "specialist" / "觸手"→worker） | Kuro | D2 | SOUL diff |

**關鍵路徑**：A1 → A2 → A3 → A4 → B1 → B2 → B3 → B4 → C4 → D1 → D2 → D3（12 nodes）
**可並行**：C1/C2/C3 彼此無依賴；A3 之後 Kuro 可平行做 adversarial review 段補完

## Constraint Texture 評估

- **v1 Prescription 風險已消除**：v1 的「local tentacle vs middleware」是規定路徑，v2 統一成 middleware = 收斂條件，Kuro 不用選
- **C5 避免技術債**：v2 移除 v1 的 fallback local spawn，不留兩條平行路徑
- **可逆性**：每個 layer 獨立 commit，git revert 不影響後續層。D 層（sunset）是最後一步，前面都驗證 ≥ 7 天才執行
- **Feature flag**：`middleware-native`（features.ts 註冊），calm/reserved/autonomous 獨立控制

## 安全護欄

- Middleware health check fail → A 層 plugin 輸出 `middleware offline`，B 層 tag 解析時 log 錯誤但不 crash
- `MINI_AGENT_MIDDLEWARE=off` env var 一鍵關閉整條
- Middleware launchd auto-restart（C 層加）+ mini-agent 啟動時 probe
- D 層動手前 hard gate：middleware uptime ≥ 7 天 + 100+ plan 成功 + Kuro 主動說「specialist 可退」

## Self-Adversarial Review（Primary Kuro 補完）

1. **架構合理性**：4 層（A/B/C/D）夠不夠？會不會又過細？C4 ↔ D1 順序對嗎？
2. **黏菌隱喻到位嗎**：「養分 = worker 結果」這個類比會不會讓 worker selection 變得 prescriptive（每個 cycle 用統計挑 worker），反而失去 emergent 特性？
3. **Worker 遷移 carrying cost**：cdp-fetch 做成 worker 要維護 ACP session pool；值得嗎？或保留 local script 更好？
4. **Delegation.ts 退役風險**：現有「code/learn/research/create/review」5 種觸手類型是否都有對應 middleware worker？有沒有遷移不過去的語義？
5. **你的直覺**：A/B/C/D 哪一層對你「天生就會用」最關鍵？

## Next Step

CC 先 commit A1（perception plugin + proposal v2）。B 層之後每個 node 獨立 commit，配 Kuro review。
