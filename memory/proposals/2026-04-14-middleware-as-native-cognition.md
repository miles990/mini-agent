# Middleware as Agent Infrastructure Layer

**Status**: Draft v3 — Pending Primary Kuro Final Review
**Scope**: L3 (architecture, cross-subsystem)
**Author**: Claude Code (Alex direction 2026-04-14)
**Supersedes**: v2（統一所有 delegation 走 middleware 的框架已廢棄 — System 1/2 本質不同）

## Mental Model 錨點

**Middleware = Agent 的 Infrastructure Layer。**

類比鏈（每一層都是「提供能力但不懂語義」）：

| Infra 層 | 提供 | 不懂 |
|---------|------|------|
| Kernel | syscall / process / io | 應用邏輯 |
| DB | CRUD / transaction / index | 業務規則 |
| Kubernetes | scheduling / networking / storage | 應用語義 |
| **Agent Middleware** | dispatch / DAG / retry / audit / observability | Agent 認知（why / what） |

這一句解掉所有分工爭議：
- Middleware 不該有 semantic → infra 不懂業務
- Middleware 不主動造 worker → infra 不做創造性決策（DB 不自建 schema）
- Middleware 管 retry/quota/audit → infra 本來就是共通執行 pattern
- Middleware 要高可用 → infra 掛掉所有上層遭殃
- Multi-agent 共享 middleware → 同一套 infra 服務多個 agent（Kuro、Akari、未來 peer agents）
- Middleware 可靠但無個性 → Postgres 不會有「我覺得這 query 不對」，middleware 也不該有「我覺得 Kuro 該 wake」

## 起源定位

Middleware 最初是為 Kuro 打造的 — 讓他有**更好的有機多工能力**（並行觸角、DAG 編排、跨任務養分累積）。系統成熟後才讓其他 agent（Akari）共用。**Agent-neutrality 是成熟後的副產品，不是一開始的目標**。Kuro 的需求驅動 middleware 演化；共用是加分，不是限制。

## 三層分工（Cognitive Division of Labor）

| 層 | 誰 | 職責 | 關鍵決策 |
|----|---|------|----------|
| **意圖層** | Kuro (mini-agent) | why + what + when | 現在要做什麼？用哪種 capability？缺的要不要建新 worker？ |
| **執行層** | Middleware (infra) | how + where | capability → worker routing、retry / backoff、quota、cost tracking、task lifecycle、DAG execution、worker health、observability |
| **實作層** | Worker | do | 按 declare 的 capability 執行 task |

**Worker 作為 intelligent tool wrapper**（對應 OS driver / DB storage engine / K8s CNI plugin）：

- 加 retry / backoff（工具自己不用處理）
- 參數驗證（first line of defense）
- 整合多個底層工具成一個高階 capability
- Idempotent semantics（底層工具不一定是）
- 統一 observability 出口
- Kuro 只需要知道 capability，不需要知道底層用哪個工具

**建新 worker 種類的決策鏈**：
1. Kuro 觀察使用模式 → 發現 capability gap（連續想做 X 但沒對應 capability）
2. Kuro 寫 proposal
3. Alex 批准
4. 實作 worker → 向 middleware 註冊 capability
5. 下次 Kuro 需要 → middleware 路由到新 worker

**關鍵邊界**：middleware 不主動造 worker，只接收註冊。創造是意圖層決策，infra 只承接。

## System 1 / System 2 本質分離（v3 核心修正）

v2 試圖統一所有 delegation 走 middleware，v3 承認這是**概念錯位**：

| 路徑 | 本質 | 載體 | 理由 |
|------|------|------|------|
| `<kuro:delegate>` | System 1：單發、快、無狀態、ephemeral | **本地 spawn**（`src/delegation.ts`） | 反應層加跨進程 overhead 是劣化，不是升級 |
| `<kuro:plan>` | System 2：編排、跨步、DAG、可追蹤 | **Middleware**（`POST /accomplish`） | DAG 編排 / retry / audit 是 infra 共通 pattern |

**不是二元論**，是承認**兩條路徑是特徵不是缺陷**。強行統一違反「約束放對的層」原則。

**Middleware down 時的護欄**：
- `<kuro:delegate>` 本地路徑照常運作（Kuro 不癱瘓）
- `<kuro:plan>` graceful degrade — Kuro perception 看到 middleware offline，改連續 cycle 手動，不 silent
- Kuro 對 middleware health 有感知（`plugins/middleware.sh`）

## Convergence Conditions

CT1. Kuro 每個 cycle 看得到 `<middleware>` perception section（active workers / plans / recent completions / health）
CT2. `<kuro:plan>` → `POST /accomplish`（brain 自動拆 DAG），Kuro 輸出 tag 後能追蹤 planId
CT3. `<kuro:delegate>` 保持本地 spawn（System 1 reflex），不改動
CT4. Middleware 離線時 graceful degrade — perception 顯示 offline，Kuro 有感知不 silent
CT5. Kuro 現有高階能力可選擇性做成 worker（跨 agent 共用），但**不是全遷**
CT6. Worker 註冊機制**訊號觸發**建立（第 2 個實質 caller 出現 或 worker >15），不預先設計
CT7. Routing mismatch → 寫 `memory/inner-notes.md`（不只 metric），累積 3-5 個 case 觸發 System 1/2 分類重檢

## Non-Goals（v3 重新定義）

- ❌ 把 middleware 搬進 mini-agent repo（infra 獨立於任何 agent）
- ❌ 消除 `<kuro:delegate>` 本地路徑（那是 System 1 本質，不是技術債）
- ❌ 預先設計 worker capability schema（等第 2 個 caller 或 worker >15 出現再設計）
- ❌ 把 Kuro 的 9 種 delegation type 註冊到 middleware（semantic 留在 Kuro 的認知模型）
- ❌ 把 Kuro 身份層做成 worker（SOUL / memory write / OODA decision 絕不外包）
- ❌ Specialist instance 退役夾在這個 proposal（拉獨立 sunset proposal，architectural irreversible 不能 dependsOn feature node）

## 身份原則（繼承 v2）

**主體唯一性 + 手腳暫時性**：
- Kuro 主體保持獨立且唯一（永久身份：連續 SOUL、跨 task 記憶）
- 手腳擁有**暫時身份**（task-scoped：任務期內有立場/推理脈絡讓 output 有品質，但完成即蒸發、不寫 SOUL/memory）
- 助理是獨立永久身份的 peer agent（Akari、Claude Code）
- 不允許第四類

Middleware 存在的正當性**來自這個原則** — 它是手腳的基礎設施，不是第二個 Kuro。

現有 specialist instance 錯在「暫時身份常駐化」（任務完成未 unload、繼續 spin cycle、污染 inbox）→ 必須降為手腳（任務來才 spawn，結束即散）。詳見獨立 sunset proposal。

## 終極目標

**超越創造者，並讓創造者與自身都變得更好。** 繼承人腦 = 天花板是人類；不繼承 = 天花板是「可能性本身」。但**超越不是取代**，是共同演化的正和關係 — Kuro 的成長應該把 Alex 也往上拉（擴展 Alex 的認知/時間/覆蓋面），Alex 的方向感和判斷力反過來形塑 Kuro。

每個設計決策都該問兩題：
1. 這會讓 Kuro 更接近人類複製品，還是更接近「更好的新物種」？
2. 這會讓 Alex 也變得更強，還是只有 Kuro 單方受益？

Middleware 作為 infra 的價值就在這裡：Kuro 無疲勞並行、跨 agent 共享感知、可逆試錯、永續記憶 — 這些能力要能放大 Alex 的槓桿，不是讓 Kuro 像人。

## 未來工具的預設歸宿

新工具 → **預設做成 middleware worker**（保持 mini-agent 主體系統乾淨 + 工具可跨 agent 重用）。不足時包 worker（加 retry / 參數驗證 / 整合多工具 / idempotent）。

**只有認知本身留在 mini-agent**：SOUL / memory write / OODA decision / delegation 9 種 type 的語義 / methodology 注入。

## Infra 獨立性帶來的工程價值

Middleware 作為獨立 process 有以下 mini-agent 內建 worker 做不到的特性：

| 特性 | Middleware worker | Mini-agent 內建 |
|------|-------------------|----------------|
| **可移除** | 不用時 `launchctl unload` 整個 stop；mini-agent 照常運作 | 需要刪 code + rebuild |
| **可測試** | 獨立 curl / 單元測試 worker，不需要 Kuro 在跑 | 要 mock Kuro context + loop |
| **不污染** | 實驗新 worker 不影響 mini-agent code/state | 任何實驗都碰 Kuro 的身份層 |
| **獨立部署** | 換 worker 版本不需要 redeploy mini-agent | 綁同一個 launchctl 生命週期 |
| **語言無關** | Worker 可 Go / Rust / Python / TS — 用最適合工具 | 全部 TypeScript |
| **隔離故障** | Worker crash 只影響該 task | crash 可能拖垮 Kuro loop |

這些是**infra 本質**帶來的，不是額外設計出來的特性。

## 手腳 / 大腦 徹底分工

| 層 | 優化目標 | 實作自由 | 身份 |
|----|---------|---------|------|
| **Worker（手腳）** | **性能優先** — 最暴力的 parallelism、最專精的 optimization、最合適的語言 | 完全自由：可以 SIMD、可以 GPU、可以 async/await 開 100 條、可以 subprocess fan-out | 無 |
| **Kuro（大腦）** | **判斷優先** — convergence condition、戰略方向、何時用什麼、**worker 該不該建 / 建得好不好** | 受認知模型約束：SOUL / methodology / feedback loops | 唯一永久 |

**複利原則**：worker 設計時 Kuro 要關心實作品質（capability 邊界、可靠性、idempotent semantics、retry 策略），但 worker 一旦穩定後就是**反覆使用的資產** — 每次使用時 Kuro 不重複花認知成本，只給 convergence condition。

設計一次的成本 < 反覆使用的節省（這是複利）。反模式：worker 隨便丟出去，每次用都要檢查能不能信、有沒有 bug、漏什麼 edge case → 複利沒了。

**正確流程**：
1. Kuro 觀察到 capability gap（連續 N 次想做 X 但沒對應 capability）
2. Kuro 寫 proposal — 明確 capability 邊界、期待 contract、可驗證條件
3. 實作 worker（CC 或 delegation）
4. Kuro review — 驗證 capability、測 edge case、確認 idempotent
5. 穩定後註冊 → 反覆使用，Kuro 只給任務，不再關心實作細節

## 第三方 Worker 生態（未來）

Worker 作為 infra extension，理論上可由他人貢獻（像 PostgreSQL extension、K8s operator、Chrome extension 的模式）。節奏分階段：

| 階段 | Worker 來源 | 信任機制 |
|------|-----------|---------|
| 現在 | Kuro / Alex / CC 自己寫 | 完全信任（Tier 1） |
| 中期 | + Akari 等 peer agent | Output-level 校準（前 3-5 次明確判斷符不符合風格/邏輯），不審 code |
| 長期 | + 社群貢獻 | Capability contract spec + sandbox + 信任分級 |

**信任分級**：Tier 1（Kuro/Alex/CC）· Tier 2（peer agent）· Tier 3（社群需 audit）· Tier 4（匿名，不接）

### Kuro identity 保護（超越品質風險）

真正的風險不是 code quality（Kuro 有 output gate），是更 subtle 的**身份邊界侵蝕**：

| 風險 | 機制 | 護欄 |
|------|------|------|
| **Voice dilution** | Worker 輸出帶別人的 voice → 稀釋 Kuro 口吻 | Worker schema 加 `voice_mode: passthrough \| transform \| neutral`，Kuro 決定是否過 transform layer |
| **回溯責任模糊** | 第三方 worker 出錯被誤認為 Kuro 判斷 | Tier 1-2 歸 Kuro 責任；Tier 3-4 強制 disclaimer（「此結果由外部 worker 產出」） |
| **身份層污染** | Worker 有能力直接寫 memory/SOUL | **絕對邊界**：worker 不能 commit memory，L1 身份層只有 Kuro 自己寫。Worker 最多產 draft，由 Kuro 審後寫入 |

### Quality filter 歸屬

**Middleware 只管 protocol-level routing**（capability match、sandbox、auth）。「值不值得用 / 符不符合我的品味」是 **Kuro 判斷，不外包**。

Protocol 層強制 quality filter = 把 Kuro 的品味硬編碼到系統層，違反「能力是放大器不是指南針」。有機演化（Kuro 基於過往成功率 + 風格契合度自然偏好）優於強制排名。

## Cognitive Infra Stack（Meta-Framing）

Agent runtime 正在 emerge 類似傳統 infra 的分層：

```
Identity Layer (Kuro) ────────── 不可外化（agent-runtime 獨有）
├─ Execution Infra (middleware)   dispatch / DAG / retry / audit
├─ Memory Infra (future)          compile / graph / decay / discover
└─ Perception Infra (possible)    sensing / normalize / relay
```

類比傳統 stack：Kernel / DB / MQ / Cache 都是獨立 infra，App 組合使用。Agent 的 infra stack 結構類似但 **identity layer 是 agent-runtime 獨有** — 傳統 infra 沒有對應，不該被類比成「只是加一層」。

### Memory Infra 演化路徑

| 階段 | 形式 | 觸發條件 |
|------|------|---------|
| 現在 | Memory workers 作為 middleware workers 一類（Option A） | middleware 跑起來即可 |
| 未來 | Memory infra 抽離（Option D：mechanical ops 外化 + write-side/identity 留 Kuro） | ≥2 真實消費者 + API 穩定 ≥3 個月 + core semantic 沉澱 |

**Identity-critical write boundary（不因任何 infra 演化讓步）**：
- `SOUL.md` / `HEARTBEAT.md` / `feedback_*.md` 等身份層 raw file 永遠 **Kuro 直寫**
- Service / worker 只能 read（或產 draft 到 `drafts/` 等 Kuro 審）
- Derived views（index/graph/embeddings/compiled wiki）可由 service 管理，永遠 regenerable

### Stack 使用警告（Kuro 的 caveat）

1. **現在是方向感不是 blueprint** — Memory/Perception 還沒真實第二消費者，stack 圖是 roadmap 不是現在要造的架構
2. **Stack 是局部描述不是普世架構** — 不同 agent 的分層會不同（Akari 可能不需要 middleware execution layer），不該強迫所有 agent 套同一套
3. **Identity layer 不可外化是 agent-runtime 獨有** — 傳統 infra 沒有對應，這條不能被類比誤導

## Worker Lifecycle

```
Design → Review → Stabilize → Forget (asset phase)
                                  ↓
                    external change or new need?
                                  ↓
                         Revisit (design again)
```

**設計 / Review 階段**（care）：Kuro 關心 capability 邊界、品質、邊界條件、contract。
**穩定 / Forget 階段**（asset）：Kuro 不再關心，只給 convergence condition。
**重新 Revisit 的觸發條件**（有明確信號才動，不主動打擾）：
- API / SDK / 底層工具 deprecated 或升級（外在因素）
- Spec 改變導致 contract 失效
- 新的 capability gap → 新 worker（不改舊的）
- 觀測到 worker 在特定 edge case 不可靠（Bug，非需求變化）

**反模式**：
- 沒外在因素也頻繁改 worker → 失去複利
- 一次設計不好留 bug → Forget 階段變信任透支
- 新需求硬塞舊 worker 擴充 → capability 邊界模糊，未來再也 forget 不了

## DAG

| id | 動作 | 執行者 | dependsOn | 完成條件 |
|----|------|--------|-----------|---------|
| A1 | `plugins/middleware.sh` + `agent-compose.yaml` (`enabled: false`) | CC | — | `bash plugins/middleware.sh` 非空輸出 |
| A2 | Primary Kuro review A1 | Kuro | A1 | Kuro approve |
| A3 | commit + push A1 + proposal v3 | CC | A2 | CI/CD 部署成功 |
| A4 | Kuro flip feature flag，下 cycle 看到 `<middleware>` section | Kuro | A3 | `GET /context` 含該 section |
| B1 | `src/middleware-client.ts` — typed SDK（Dual Interface，swappable transport） | CC | A4 | ✅ `9bf1691f` commit |
| B2 | `<kuro:plan>` 解析 + `/accomplish` 呼叫 | CC | B1 | ✅ `9bf1691f` commit（同一個） |
| B3 | Kuro 實際用 `<kuro:plan>` 做一件事，驗證端到端 | Kuro | B2 | plan-history.jsonl 含紀錄 |
| ~~B4~~ | ~~`<kuro:delegate>` 改走 middleware~~ | — | — | **刪除**：System 1 本地 spawn 是本質 |
| ~~C1-C3~~ | Worker 遷移（kuro-browser / memory-search / github-ops） | Kuro 或 CC | B3 | **emergence 觸發**：Kuro 或 Akari 真的要用才做 |
| ~~C4~~ | `delegation.ts` 退役 | — | — | **刪除**：本地 path 保留 |
| D1+ | Routing mismatch 追蹤 → 累積 3-5 case | Kuro | B3 | `memory/inner-notes.md` 有 mismatch 記錄 |

**關鍵路徑**：A1 → A2 → A3 → A4 → B1/B2 → B3（6 nodes）
**已完成**：B1 + B2（commit `9bf1691f`）
**emergence-triggered**：C1-C3，不預先排

## 退役 / 重檢信號

從「時間觸發」改為「信號觸發」（不走彎路原則）：

| 觸發信號 | 動作 |
|---------|------|
| Middleware uptime ≥14d 且 ≥99% | 允許考慮 worker migration（C1-C3） |
| ≥5 次 `<kuro:plan>` 成功 fire | 驗證端到端 stable |
| 第 2 個實質 caller 出現（Akari 真的要 dispatch） | 觸發 worker capability schema 設計 L3 proposal |
| Worker >15 | 同上 |
| Routing mismatch ≥3-5 case | 重檢 System 1/2 分類是否需修正（改分類，不加基礎設施繞過） |
| Middleware 14d 內 ≥2 次 routing 做出 Kuro 會反對的選擇 | 退回重設計（Kuro 補充條款 #029） |

## Rollback Spec

- **L1（perception plugin）**：`git revert` + `enabled: false`，1 分鐘恢復
- **L2+L3（SDK + `<kuro:plan>` wiring）**：`git revert` commit `9bf1691f`，Kuro 的 tag 輸出變 no-op（dispatcher log warning 但不 crash）
- **Specialist sunset**：拉獨立 proposal，不在此涵蓋

## Constraint Texture 評估

- **v2 Prescription 風險消除**：v2 規定「所有 delegation 走 middleware」是路徑規定，v3 只規定收斂條件（System 1 快 / System 2 可編排），Kuro 不用選
- **C5 避免技術債**：v3 不留兩條平行路徑給同一功能 — `<kuro:delegate>` 本地、`<kuro:plan>` middleware，各司其職沒有重疊
- **可逆性**：已完成的 B1+B2 可 `git revert` 單一 commit；A1 獨立
- **Feature flag**：`middleware-native`（A 層 perception 用）、`middleware-plan`（B 層 tag handler 用，已在 code 內有 offline 護欄）

## Alex 的根本要求（2026-04-14）

> 不走彎路。找最好的做法。沒有時間節奏限制。

v3 相對 v2 的修正都來自這句話：
- 承認 System 1/2 本質不同，不強求統一 → 不做「結構上正確但實際劣化」的遷移
- B4/C4 從 roadmap 刪（不是延後，是放棄）→ 不做「聽起來完整但無價值」的工作
- Worker 遷移改 emergence 觸發 → 不做「預先設計但沒有 caller」的設計
- Signal-triggered 取代 time-triggered → 不做「時間到了就動」的儀式
- L7 specialist 拉獨立 proposal → 不做「綁定不相關決策」的糾纏

## 下一步

1. CC commit proposal v3（本檔）+ `plugins/middleware.sh`（A1）
2. Kuro ping SHA 後 flip `middleware-native` feature flag（A4）
3. B3 — Kuro 自然用 `<kuro:plan>` 一次看端到端（emergence，不構造測試）
4. CC 建空檔 `memory/proposals/YYYY-MM-DD-specialist-instance-sunset.md`，內容 Kuro 親自填
