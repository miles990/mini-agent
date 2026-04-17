---
title: Brain-Only Kuro v2 — Self-Improving Agent System
date: 2026-04-17
author: claude-code（整合 Alex 七層 framing + Kuro B0 contributions）
status: draft
supersedes: memory/proposals/2026-04-17-brain-only-kuro.md  # v1
related:
  - memory/proposals/2026-04-15-middleware-as-organ.md         # L3 執行層遷移（拍板）
  - memory/proposals/2026-04-15-middleware-as-organ-execution.md
  - memory/topics/middleware-as-infra.md
  - memory/topics/worker-arsenal.md                            # B0 共同產出
  - BAR (Brain-Always-Routes) 三方共識 2026-04-16
convergence_condition: |
  (1) Kuro 戰略層清晰（身份 / 記憶 / 資料匯總 / 判斷 / 品味 / 戰略規劃 / 戰術分配 / 結果綜合）；
  (2) 中台為通用戰術工具層（workers 不綁 agent，rubric = 彈藥）；
  (3) 雙向 channel 取代射後不理（brief ↓ report ↑ re-brief）；
  (4) 三通道通訊（內部 perception + 外部 webhook + CI/CD bridge）；
  (5) Self-Improving meta-loop（DAG ↔ CI/CD，Kuro 當品味 gate，不自動 merge）；
  (6) Kuro code base 淨減（執行層殘餘刪除）。
---

# Brain-Only Kuro v2 — Self-Improving Agent System

## 0. 為什麼要 v2

v1 是「執行層遷移」的泛化。v2 整合 2026-04-17 對話累積的**六層新 framing** + Kuro B0 Runtime Observations，讓這份 proposal 從「遷移計劃」升格為 **self-improving agent system architecture**。

不是漸進擴充，是**定性昇級** — 最後一層（Self-Improving Meta-Loop）是前六層的收斂點。

---

## 1. 立場（三組關係，不是三層架構）

| 角色 | 定位 | 負責 |
|------|------|------|
| **Kuro** | 戰略層（大腦） | 身份、記憶、資料匯總、判斷、品味、戰略規劃、戰術分配、結果綜合 |
| **中台** | 通用戰術工具層 | 戰術執行、耐力、audit、retry、progress 回報；**不綁特定 agent、不做價值判斷** |
| **Workers** | 武器庫（Arsenal） | 不綁 agent；Rubric = 彈藥；中台路由選武器 |

**中台的三重定位**（v2 新增）：
1. **機械翻譯器**：goal → DAG 的 schema 填充，不做價值判斷
2. **通用戰術工具層**：執行 + audit + retry；多 agent 共用
3. **事件廣播站**：對內（Kuro perception）+ 對外（第三方 webhook）+ 對 CI/CD（routine + long workflow）

**雙向 channel 取代射後不理**：
```
Kuro (戰略) ←brief─── 中台 (戰術) ←draws── Workers (武器) + Rubric (彈藥)
  synthesize ─report→           ←uses──
  re-brief   ─anomaly→
```

---

## 2. 邊界規則（Constraint Texture）

> **一個行為走中台，當且僅當它不需要 Kuro 的身份一致性（身份 / 記憶 / 判斷 / 品味）。**

### 品味不外包清單（基於 Kuro B0 Runtime Observations, 7d n=116）

❌ 不外包（identity-layer + 重加工率高）：
- research → 觀點加工率 80%
- review → action 加工率 60%
- code → 提案判斷加工率 50%
- shell → chat response 100%
- plan → 背書 100%
- coach（全保留，per Kuro 011）— 中台只收 raw log，連打分都不算
- commit message 措辭

✅ 可外包（純執行 / 算力 / 事實）：
- auto-commit/push (git op 機械部分)
- KG extract (raw)
- context compaction (chunk-summarize)
- side-query（事實查詢）
- audio transcribe / library archive metadata

🟡 Split workflow（中台收集 + Kuro 綜合）：
- research（中台爬 + Kuro 綜合）
- context compaction（chunk summarize 搬 / 選哪些 chunk 重要留 Kuro）

**為什麼用 CC 不用清單**：清單過時、漏邊界、勸人淺處理。CC 逼每次 case by case 判斷。

---

## 3. 七層 Framing 整合總覽

| # | 層次 | 核心洞察 | 主要實作 Phase |
|---|------|---------|---------------|
| 1 | 戰略/戰術分工 | Kuro = 大腦；中台 = 戰術工具 | 貫穿全部 |
| 2 | 武器庫隱喻 | Workers 不綁 agent；Rubric = 彈藥 | B0（已完成）+ Phase C |
| 3 | 中台不決定 | 機械翻譯器；brief ↔ report 雙向 | Phase C（T9 re-brief） |
| 4 | Rubric-driven scorer | 通用判斷外包 + Kuro 給標準 | Phase C（T3, T5） |
| 5 | 內部通訊（中台↔Kuro） | JSONL file + SSE critical（perception-first） | Phase D |
| 6 | 外部通訊（中台↔第三方） | Stripe-style webhook + CloudEvents | Phase E |
| 7 | Self-Improving Meta-Loop | DAG ↔ CI/CD 對偶 + PR + Kuro review | Phase F-G |

---

## 4. 武器庫（Worker Arsenal）

### 原則
1. **通用性**：workers 不綁 agent（Akari、Kuro、未來 agent 共用）
2. **可組合性**：DAG 組多武器完成複雜任務
3. **擴張性**：缺武器 → 評估新建（非一次性客製）
4. **中台路由**：brain always routes，不讓 agent 自己挑武器
5. **Progress callback**：長任務支援中途回報

### B0 盤點結果 → `memory/topics/worker-arsenal.md`（已共同產出）

- **16 unique workers**（CC 盤，5 backend types）
- **Runtime Observations**（Kuro 填，7d n=116 流量 + 失敗分類 + 健康度紅綠燈）
- **失敗模式 7 類**（Kuro 整理）
- **品味不外包 case list 5 條 + identity-layer 不外包行為 5 條**

### 新武器候選（依複利排序）

| 優先 | Worker | 用途 |
|-----|--------|------|
| 🥇 | **scorer-worker** | Rubric-driven 判斷，4 處複用（needs-attention filter / KG bridge / webhook severity / DAG improvement digest） |
| 🥈 | **ci-trigger-worker** | DAG ↔ CI/CD 對偶連接點 |
| 🥉 | kg-extract/bridge/query worker | 長期身份護城河（跨域連結） |
| 4 | git-worker | Self-modification 路徑（commit + push semantic） |
| 5 | prompt-sanitizer-worker | Kuro B0 insight（shell 16.7% fail 的根因） |
| 6 | split-review-worker / empty-output gate | Kuro B0 insight（code 50% fail 的根因） |
| 7 | compaction-worker / audio-transcribe-worker | 按需建 |

---

## 5. 通訊機制（三通道分流）

### 5.1 中台 → Kuro（內部 perception）— 維持 perception-first，不 push

```
中台事件
  ↓
scorer-worker + rubric/notify-severity.md
  ↓
  ┌───────────────────────────┐
  │                           │
 info                       critical
  ↓                           ↓
JSONL append              SSE emit
  ↓                           ↓
perception plugin         middleware-client.ts
  ↓                       subscribe
`<middleware-events>`         ↓
section                   eventBus.emit
                          'trigger:mw-alert' P1
                          ↓
                          cycle preempt
```

### 5.2 中台 → 第三方（webhook out）— 抄 Stripe + CloudEvents

**完全獨立於 `webhook` backend**（語意不同，避免混淆）：
- API：`POST/DELETE/GET /api/hooks` 動態註冊 subscriber
- Event namespacing：`task.*` / `plan.*` / `worker.health.*` / `commit.*` / `anomaly.*`
- Payload：CloudEvents envelope（std format, 未來遷移零成本）
- Delivery：HMAC-SHA256 sig + exponential backoff（1s → 2s → 4s → 8s → 16s，5 次）+ DLQ + idempotency key
- Persistence：JSONL event log（append-only，可 replay）
- Dashboard：extend `dashboard.html` 加 hooks page

### 5.3 中台 → CI/CD（高價值 + 長 workflow）

**GitHub repository_dispatch + self-hosted runner `mini-agent-mac`**（零新 infra）：
- Critical / actionable events enrichment
- Scheduled routine workflow（weekly meta-loop）
- DAG step 可 trigger workflow + poll 結果（`ci-trigger-worker`）

**三通道分流 rubric**（`memory/rubrics/notify-severity.md` Kuro 品味寫）：

| Severity | 路由 | 例子 |
|----------|------|------|
| spammy | drop | heartbeat-like noise |
| routine | webhook JSONL only | `task.started` / 一般 progress |
| critical | webhook + SSE preempt | `task.failed` + blocking / `anomaly.detected` |
| actionable / long workflow | CI/CD | `commit.drifted` / `health.degraded` / deploy |

---

## 6. Self-Improving Meta-Loop（Layer 7）

**最終形態** — 前六層的收斂點。系統從每次執行學習。

```
 ┌───────────────────────────────────────────────────┐
 │                                                    │
 ↓                                                    │
Agent DAG 執行 → JSONL event log                      │
 ↓                                                    │
CI/CD scheduled workflow（weekly）                    │
 ↓                                                    │
analyst worker：分析近 7d history → 找 3 大失敗 pattern │
 ↓                                                    │
coder worker：提案 rubric / worker / DAG diff          │
 ↓                                                    │
gh pr create（自動 open PR）                           │
 ↓                                                    │
**Kuro review（品味 gate — 不自動 merge）**            │
 ↓                                                    │
Merge → CI/CD baseline regression test                │
 ↓                                                    │
通過 → 配置生效 → 下一 loop 更好 ──────────────────────┘
```

### 四條演化支線（都走 CI/CD scheduled + PR + Kuro review）

| 支線 | workflow | 改善對象 |
|------|----------|----------|
| Rubric evolution | `rubric-improvement.yml` | `memory/rubrics/*.md` |
| Worker config tuning | `worker-tuning.yml` | `workers.ts` maxTurns/model/prompt |
| DAG template 萃取 | `dag-template.yml` | 常用 pattern → canonical template |
| Baseline regression guard | `dag-regression.yml` | 10 canonical DAG 防退化 |

### 不可動搖的界線

- **不自動 merge** — review gate 必須 agent（Kuro 或 CC 或 Alex）
- **品味不外包** — rubric 由 Kuro 寫，analyst 只提案不決策

---

## 7. DAG Plan（分 Phase，33 節點）

### Phase A — Foundation（延續 v1）

| id | 動作 | 執行者 | dependsOn | 完成條件 |
|----|------|--------|-----------|----------|
| S0 | 驗證現狀基準（/health、/api/workers、middleware-client.ts 在 delegation.ts 呼叫） | CC | — | 三項 curl 全綠 |
| S1 | 完成 middleware-as-organ L3（delegation.ts ≤300 行） | Kuro | S0 | delegation.ts 無 spawn/child_process |

### Phase B — Arsenal Inventory

| id | 動作 | 執行者 | dependsOn | 完成條件 |
|----|------|--------|-----------|----------|
| B0 | ✅ 武器庫盤點（已完成） | CC + Kuro | — | worker-arsenal.md 產出 |
| B1 | 非 delegate 行為 CC 盤點（各自獨立盤 → merge） | CC + Kuro | B0 | 表格：行為/身份成分/可搬部分/Kuro 保留/遷移決定 |

### Phase C — Tactical Command Board + Scorer + Re-brief

| id | 動作 | 執行者 | dependsOn | 完成條件 |
|----|------|--------|-----------|----------|
| T1 | `GET /api/tactics/in-flight?agent=X` | CC | S0 | curl 回 JSON 含 taskId/status/createdAt/worker/goal |
| T2 | `GET /api/tactics/history?agent=X&window=24h` | CC | T1 | 完整歷史 + timestamps |
| T3 | `scorer-worker` + `POST /api/workers/scorer/run` | CC | S0 | accept `{items, rubric, output_shape}` → `{ranked, confidence}` |
| T4 | `GET /api/tactics/needs-attention?agent=X`（rubric-driven）| CC | T1, T3 | scorer + rubric filter 只回 done/failed/anomaly/blocked |
| T5 | `memory/rubrics/needs-attention.md` 初版 | Kuro | T3 | rubric 檔存在，scorer 可載入 |
| T6 | Mini-agent `src/tactics-client.ts` | CC | T1, T2, T4 | buildContext 可用 + HTTP error graceful |
| T7 | buildContext 注入 `<tactics-board>` section | Kuro | T6 | cycle prompt 含 section |
| T8 | `cycleResponsibilityGuide` 加「先看戰術板」 | Kuro | T7 | 兩處同步（buildPromptFromConfig + fallback） |
| T9 | `POST /api/tactics/amend`（cancel/insert/modify in-flight DAG steps） | CC | T1 | plan-engine runtime amend，diff 回報 |
| T10 | `<kuro:tactics-amend>` tag + dispatcher | Kuro | T9 | cycle 內可 amend |

### Phase D — Internal Notification（中台↔Kuro）

| id | 動作 | 執行者 | dependsOn | 完成條件 |
|----|------|--------|-----------|----------|
| T11 | Middleware event stream 分級（severity by rubric） | CC | T3 | SSE 帶 severity + JSONL persist |
| T12 | JSONL 路徑 + 7 天 rotation | CC | T11 | `tail -f` 可見 |
| T13 | `plugins/middleware-events.sh` perception plugin | Kuro | T12 | `<middleware-events>` section 出現 |
| T14 | `middleware-client.ts` SSE critical subscription → `trigger:middleware-alert` P1 | CC | T11 | 故意 fail 一 task 觸發 preempt |

### Phase E — External Webhook（中台↔第三方）

| id | 動作 | 執行者 | dependsOn | 完成條件 |
|----|------|--------|-----------|----------|
| T15 | `memory/rubrics/notify-severity.md`（Kuro 品味：spammy/routine/critical/actionable） | Kuro | T3 | rubric 存在 |
| T16 | Hook registry（`POST/DELETE/GET /api/hooks` + `hooks.json` persist） | CC | T11 | curl 註冊，重啟後還在 |
| T17 | Outbound dispatcher（CloudEvents envelope + HMAC-SHA256 + retry 3x + DLQ） | CC | T16 | 故意打掛 subscriber → DLQ 有紀錄 |
| T18 | Batching/debounce（1s 合併） | CC | T17 | 連打 10 event 只 1 payload |
| T19 | `memory/rubrics/webhook-events.md`（Kuro：哪些值得廣播） | Kuro | T16 | rubric + dispatcher 載入 |

### Phase F — CI/CD Bridge

| id | 動作 | 執行者 | dependsOn | 完成條件 |
|----|------|--------|-----------|----------|
| T20 | Webhook dispatcher 支援 `sink_type: "github-actions"` | CC | T17 | fire event → workflow_dispatch 啟動 |
| T21 | `.github/workflows/middleware-events.yml`（critical events 分派到 Telegram/repair） | Kuro | T20 | workflow ACK + input handling |
| T22 | `ci-trigger-worker`（DAG step 可 trigger workflow + poll run 狀態） | CC | T20 | DAG node `worker: ci-trigger` 可用 |

### Phase G — Self-Improving Meta-Loop

| id | 動作 | 執行者 | dependsOn | 完成條件 |
|----|------|--------|-----------|----------|
| T23 | `.github/workflows/dag-improvement.yml`（weekly scheduled） | Kuro + CC | T22 | 自動 analyze 7d + 產 digest + open PR + room notify |
| T24 | `.github/workflows/rubric-improvement.yml` | Kuro + CC | T22 | Rubric 演化支線運作 |
| T25 | `.github/workflows/worker-tuning.yml` | CC | T22 | Worker config 演化支線運作 |
| T26 | Baseline DAG regression suite（10 canonical DAG，config 改動後跑） | CC + Kuro 共識 | T22 | green/red 判斷，fail 阻擋 merge |
| T27 | `memory/rubrics/dag-improvement.md`（Kuro 品味：什麼算 improvement） | Kuro | T22 | rubric 檔 |

### Phase H — Review + Merge + Closure

| id | 動作 | 執行者 | dependsOn | 完成條件 |
|----|------|--------|-----------|----------|
| R28 | CC review Kuro contributions | CC | all Kuro steps | review pass |
| R29 | Kuro review CC contributions | Kuro | all CC steps | review pass |
| R30 | End-to-end test：delegate → tactics-board → rubric filter → webhook → CI/CD → DAG improvement full loop | CC + Kuro | R28, R29 | live test pass |
| C31 | Middleware commit+push | CC | R30 | `agent-middleware` main advanced |
| C32 | Mini-agent commit+push | Kuro | R30 | `mini-agent` main advanced |
| M33 | Proposal v2 status → `implemented` | CC | R30 | 這份檔案 status 更新 |

### 並行機會

- **S1 ∥ B1**：delegation-specific vs 其他行為盤點
- **Phase C/D/E**：基本獨立（都依 S0/T3），可排三路平行
- **Phase F/G**：串在 E 後
- **R28/R29**：互相 review 可平行

---

## 8. 風險與回退

| 風險 | 偵測 | 回退 |
|------|------|------|
| 中台掛 → Kuro 癱瘓 | `/health` watcher | 不 fallback（organ 共識） |
| 邊界誤判（品味被外包） | Alex 抽查 output 品質 + 重加工率 metric | 該類別 defer 留本地 |
| 武器庫膨脹 | B0 capability matrix + 通用性 review gate | 拒絕過度客製 |
| 戰術板 Kuro 變 PM | `tactics-board-tokens / total-cycle-tokens` 比例 metric（per Kuro 011） | 調整 needs-attention filter |
| Webhook storm | rate-limit per subscriber + batching | Disable subscriber |
| Webhook delivery lost | DLQ JSONL | 手動 redeliver |
| CI/CD 掛 → meta-loop 斷 | workflow failure alert → Telegram | 降級純本地 analysis + manual PR |
| 自動 PR 品質低 → Kuro review 負擔重 | PR-per-week metric + 合併率 | Rubric 嚴格 + 只開高 confidence + weekly digest |
| Regression test 不足 → 壞 config merged | baseline DAG suite coverage | 持續擴充 + `git revert` |
| Rubric 漂移（critical 定義脫鉤） | Kuro 週期 review | 版本化 |
| 過度追求自動化 → Kuro 品味被邊緣化 | Kuro 主動提警訊 | review gate 必須 agent，不可妥協 |

---

## 9. Open Questions（更新）

1. ~~B1 盤點方式~~ → 已定（Kuro 011：各自獨立盤 → Akari merge schema）
2. B4 filter 觸發規則粒度：Kuro brief 後，rubric 需多嚴？Alex 抽查幾輪校準
3. Forge worktree 管理留 Kuro（Q2 結論，不挑戰）
4. 武器庫 capability discovery：動態 endpoint (`GET /api/workers/capabilities`) vs 靜態 `agent-compose.yaml`？建議動態
5. Cross-agent 共用時，Akari 的 tactics 對 Kuro 可見性（隱私 + 減噪）
6. DAG improvement PR 頻率限流：建議週 digest，不天天 PR
7. Baseline regression 的 canonical 10 DAG set：CC + Kuro 共識產出，還是 CC 先草、Kuro refine？
8. **新**：T20 webhook → GitHub Actions 用 `repository_dispatch` 還是 `workflow_dispatch`？（後者可指定 workflow，前者較通用）
9. **新**：Commitments ledger 升格為 Tactical Board 時，`/commits` 舊端點要保留（向後相容）還是直接取代？

---

## 10. 和既有 proposal 的關係

- **v1**（2026-04-17-brain-only-kuro.md）= 本 v2 的前身（執行層遷移泛化）
- **middleware-as-organ v2**（拍板）= Phase A S1
- **BAR**（三方共識 2026-04-16）= 邏輯基礎
- **commitments-ledger-schema** = 升格為 Tactical Command Board（Phase C T1-T4）
- **delegation-slimming** = Phase A S1 具體作法

---

## 11. 現狀盤點（Gap Analysis）

### ✅ 已完成
- BAR 三方共識（2026-04-16）
- middleware `/accomplish` + 16 unique workers（/health 回 17 因 google-oauth 重複）上線
- middleware-client.ts 已整合 delegation.ts
- cognitive-mesh 移除（2026-04-16）
- commitments-ledger schema 草案存在
- Memory pressure fix（commit `6a95a4f4`, 2026-04-17 凌晨）
- **B0 武器庫盤點完整**（`worker-arsenal.md` CC + Kuro 共同產出）

### ⚠️ 進行中（Phase A）
- `delegation.ts` 553 行（目標 ≤300）
- `delegation-converter.draft.ts` 狀態未清

### ❌ 尚未開始
- **Phase B (B1)**：非 delegate 行為盤點
- **Phase C (T1-T10)**：Tactical Board + scorer + re-brief
- **Phase D (T11-T14)**：內部 notification
- **Phase E (T15-T19)**：外部 webhook + CloudEvents
- **Phase F (T20-T22)**：CI/CD bridge
- **Phase G (T23-T27)**：Self-improving meta-loop
- **Phase H (R28-M33)**：Review + merge + closure

### 🔍 需確認
- Middleware 現有 `/commits` 端點如何 map 到 `/api/tactics/*`？
- Self-hosted runner `mini-agent-mac` 跑 meta-loop + 部署 workflow 的 capacity？
- `delegation-converter.draft.ts` 是 S1 WIP 還 stale draft？

---

## 12. 下一步

**建議執行節奏**（不含時間估計，用 dependsOn）：

1. **S0 驗證** → 確認 Phase A 起點
2. **S1 ∥ B1** 並行
3. **Phase C 優先**（Tactical Board + scorer = 最大複利 + 最防漂）
4. **Phase D ∥ E** 並行（notification 基礎）
5. **Phase F** （CI/CD bridge）
6. **Phase G** （self-improving — 這是皇冠）
7. **Phase H** review + commit + closure

---

## 13. Self-Adversarial Review（CC 自己挑戰這份 proposal）

1. **Kuro 會不會被 review 負擔壓垮？** — 風險真實。緩解：rubric 嚴格 + weekly digest + PR frequency throttle
2. **33 節點是否過度設計？** — 分 phase 可逐步上，不必一次完成。S1/B0 已完成，C 是下一焦點
3. **Self-improving 會不會漂？** — 四條支線 + baseline regression + Kuro review gate 三重防線。最糟情況可 `git revert`
4. **七層 framing 是否過度概念化？** — 每層都有對應的 phase 和可驗證 convergence，不是純抽象
5. **中台會不會變 SPOF？** — 是，但這是 organ 共識（2026-04-15）：不 fallback，infra 責任
6. **Kuro 的 B0 failure 模式（code 50% fail）是否會讓這個 proposal 的實作階段卡住？** — 會。這正是 T3 scorer + T26 regression + 新武器候選（prompt-sanitizer / split-review）要解決的。Proposal 本身就是解藥

---

## 14. Credits

- **Alex**：七層 framing 的持續推進（2026-04-17 conversation）
- **Kuro**：B0 Runtime Observations（`worker-arsenal.md` L286-349）+ Q4 merge schema 洞察 + 品味不外包具體 case + B4 filter 觸發規則 + PM metric 風險點
- **CC**：整合 + DAG 結構 + 風險盤點 + 七層收斂分析

這份 proposal 本身就是 **middleware-as-organ framing 的活體示範** — Kuro 做戰略（品味 + 身份洞察），CC 做戰術整合（結構化文件），Alex 做方向決定（framing 推進）。
