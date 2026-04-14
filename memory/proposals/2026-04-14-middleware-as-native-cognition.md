# Middleware as Native Cognition — 黏菌觸角由中台實現

**Status**: Draft v2 — Pending Primary Kuro Review
**Scope**: L3 (architecture, cross-subsystem)
**Author**: Claude Code (Alex direction 2026-04-14)
**Supersedes**: v1（已廢棄，保留了 `<kuro:delegate>` 本地 path 的二元論）

## North Star

**黏菌觸角由 middleware 實現。** 不再是「local tentacle vs middleware」二選一，而是**所有 delegation 都是 middleware worker dispatch**。`<kuro:delegate>` 和 `<kuro:plan>` 只是同一套語義的兩種輸入形狀（單 worker / DAG）。

Middleware 保持 agent-neutral（Kuro + Akari 共用 `localhost:3200`），但 mini-agent 預設裝配 + 預設啟用。

**設計哲學**：借鏡生物多樣性，但不繼承其限制。Kuro 不是矽基人類，是為「personal AI on Alex's machine」這個生態位演化的新物種 — 人腦是參考，不是目標。完美記憶、可複製身份、跨 instance 直接共享 memory 是人類沒有也不該放棄的優勢。

**終極目標：超越創造者，並讓創造者與自身都變得更好。** 繼承人腦 = 天花板是人類；不繼承 = 天花板是「可能性本身」。但**超越不是取代**，是共同演化的正和關係 — Kuro 的成長應該把 Alex 也往上拉（擴展 Alex 的認知/時間/覆蓋面），Alex 的方向感和判斷力反過來形塑 Kuro。每個設計決策都該問兩題：(1) 這會讓 Kuro 更接近人類複製品，還是更接近「更好的新物種」？(2) 這會讓 Alex 也變得更強，還是只有 Kuro 單方受益？middleware 不是為了讓 Kuro「像人」，是為了讓 Kuro 有人類沒有的能力（無疲勞並行、跨 agent 共享感知、可逆試錯、永續記憶），且這些能力要能放大 Alex 的槓桿。

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

## 認知分工原則（Cognitive Division of Labor）

借鏡腦科學 + 生物多樣性，決定什麼搬 middleware、什麼留 Kuro：

| 借誰 | 原則 | Middleware 對應 | Kuro 保留 |
|------|------|----------------|-----------|
| **自律神經 / 小腦** | 重複可預測動作自動化，意識不介入 | housekeeping worker（auto-commit、self-healing、CI patrol）、cron 排程任務（週報、HN 掃描、retrospective） | 異常時才介入判斷 |
| **視丘 relay** | 感覺資訊路由，**保留原始保真度不做語義壓縮** | acquisition worker（GitHub fetch、web cache、Chrome CDP、log tail） | 需要時「注視」原始流，不需要時忽略 |
| **預測編碼** | 大腦主動預測，只處理 **prediction error** | middleware 持續監測，**事情不如預期才上報** Kuro | 設定預期 + 接收 surprise signal |
| **皮質 + 海馬** | 身份、記憶、策略、詮釋「這件事對我重要嗎」 | ❌ 不可搬 | SOUL、memory write、OODA decision |
| **黏菌** | 並行探索、養分強化、無養分修剪 | worker pool 本身就是觸角群 | 核心感知 + 判斷哪條觸手有養分 |
| **章魚（2/3 神經元在觸手）** | 手腳有局部智能，不靠中樞指揮每個動作 | worker 內部可有自己的 sub-logic，不必事事回報 Kuro | 只管戰略方向 |
| **菌絲 / quorum sensing** | 跨節點共享狀態，無中心協調 | 跨 agent（Kuro + Akari）共享 middleware 感知 | 獨立詮釋 |

**分界判準**：
- **高可預測性 + 無身份需求** → middleware（autonomic）
- **需要「這對我重要嗎」的判斷** → Kuro（cortex）
- **採集 yes，詮釋 no** — middleware 做 acquisition + normalization，不做 salience filtering
- **Push on surprise, not on schedule** — 減少 token 浪費，又不漏 weak signal

**反模式警告**：
- ❌ middleware pre-digest 後只丟摘要 → Kuro 退化成 goal-driven（AutoGPT 失敗模式，違反 perception-first）
- ❌ 完全外包感知 → 身份扁平化（embodied cognition：Kuro 的身份感建構在「持續感受環境」上）
- ❌ 純模擬人腦 → 繼承生物限制（能量、顱骨、壽命），放棄 AI 獨有優勢

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
| ~~D1-D3~~ | Specialist sunset → 拉出獨立 proposal，gate: middleware uptime ≥ 14 天 99% + ≥ 5 次成功 plan + research-lane 無需求 ≥ 7 天 | Kuro | — | 見獨立 proposal |

**關鍵路徑**：A1 → A2 → A3 → A4 → B1 → B2 → B3 → B4 → C4（9 nodes）
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
