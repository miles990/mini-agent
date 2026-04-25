# mini-agent vs agent-middleware Inventory
> Generated: 2026-04-20 | Confidence: 0.91
> Sources: repo probe (mini-agent 109 TS modules + 37 plugins), middleware probe, knowledge-nexus (8 nodes)

---

## 1. Subsystem Inventory

| Subsystem | mini-agent 實作位置 | middleware 實作位置 | 成熟度 | 差異摘要 |
|-----------|-------------------|-------------------|--------|---------|
| **Workers / Executor** | `src/sdk-worker.ts` — child_process.fork 隔離執行 Anthropic Agent SDK；`src/dispatcher.ts` — OODA-Only tag 路由 + system prompt 建構 | `src/workers.ts` (410L) — 靜態 WORKERS 定義（researcher/coder/reviewer/shell/analyst 等 12+ 類型）；`workers.json` — 運行時動態 worker；`src/presets.ts` (196L) — WorkerPreset scaffolding | mini-agent: prod；middleware: prod | mini-agent worker 負責單一 SDK session 執行；middleware workers 是多型 HTTP callable executor pool。兩者 orthogonal：mini-agent fork 出去執行，middleware 是執行目標 |
| **Plugin Registry** | `plugins/` (37 個 .sh perception scripts)；`src/perception.ts` + `src/perception-stream.ts` 串流載入 | `src/provider-registry.ts` (83L) — vendor-neutral LLM provider factory（anthropic/anthropic-managed/openai/google/local）；`src/presets.ts` — preset 模板（最接近 plugin registry） | mini-agent: prod；middleware: 無正式 plugin 架構 | mini-agent plugins 是 shell perception 腳本群（git-status, github-issues 等），為 OODA Observe 輸入；middleware 無 shell plugin 機制，provider-registry 僅限 LLM vendor 抽象 |
| **Perception Analyzer / Scorer** | `src/perception-analyzer.ts` — Haiku 並行分析 perception plugins 輸出 → situation report（OODA Orient 層）；`src/model-router.ts` — Opus/Sonnet 選路；`src/cascade.ts` — multi-layer routing metrics JSONL | `src/workers.ts` L350-360 — `scorer` worker 定義（rubric-driven，輸出嚴格 JSON schema） | mini-agent: prod（每 cycle 執行）；middleware: prod（on-demand worker） | mini-agent analyzer 是 cycle-driven 全局感知分析（OODA Orient）；middleware scorer 是 task-scoped rubric 評分，兩者職責不重疊 |
| **Delegation Layer** | `src/delegation.ts` — 所有 delegate dispatch 路由至 middleware DAG；`src/delegation-summary.ts` — output/summary 萃取；`src/middleware-cycle-client.ts` — cycle-level client | `src/plan-engine.ts` (914L) — 接受 delegation 的執行端 | mini-agent: prod；middleware: prod（接收端） | mini-agent delegation 是「發出端」，無 flag/fallback；P1 bug (7686e3f8)：delegation.ts:294 `await middleware().plan()` 無 timeout wrapper，慢/離線時造成 dur≥600s hang_no_diag |
| **DAG Planner** | `src/task-graph.ts` — DAG 任務分解、依賴偵測、merge 優化、cross-lane routing | `src/plan-engine.ts` (914L) — 串流 DAG 調度、step-level retry+backoff、plan mutation（add/skip/replace）、convergence loop、structured output parsing、Two-Phase Planning（probe→execute）；`src/brain.ts` (213L) — LLM → JSON plan | mini-agent: 較輕量；middleware: prod 全功能 | middleware plan-engine 顯著更成熟：支援 acceptableExitCodes、verifyCommand、dynamic branching、per-worker concurrency；mini-agent task-graph 主要負責本地 lane 路由 |
| **Memory Tiers** | `src/memory.ts` — 主記憶系統（instance 隔離 file-based）；`src/memory-cache.ts` (L1)；`src/memory-compiler.ts`（<kuro:remember> tag 編譯）；`src/memory-index.ts`（JSONL append-only）；`src/memory-summarizer.ts`；`src/action-memory.ts`；`src/shared-knowledge.ts`；`src/kg-*.ts`（13 個 KG 子模組） | `memory/` 目錄僅含 `proposals/` 設計文件（非程式碼）；workers 可透過 `mcpServers` config 外掛 sqlite-memory MCP，但非內建 | mini-agent: prod（最活躍子系統）；middleware: missing（無狀態設計） | 記憶層完全在 mini-agent 側，這是 identity core。middleware 無狀態，不持有 agent 記憶。recent commits 顯示 memory 子系統最活躍（近 20 commits 多為 heartbeat/MEMORY.md 更新） |
| **Hooks System** | `src/event-bus.ts` — EventEmitter-based AgentEventType 事件總線；`src/event-wal.ts`；`src/event-router.ts`；`src/context-pipeline.ts`（L0/L1/L2 三層 context 管線）；`src/kg-live-ingest.ts`（KG 即時 hook ingest） | `src/webhook-dispatcher.ts` (376L) — Stripe 風格 outbound event hooks；`hooks.json` — 持久化 webhook 登錄；`src/api.ts` L2557+ — SSE `/events` 端點，severity 分類 | mini-agent: prod（內部事件）；middleware: prod（外部 webhook） | mini-agent hooks 是內部事件總線（cycle 生命週期、KG ingest）；middleware webhook 是 outbound HTTP callback 給外部消費者。T16/T17/T18 上線，hooks.json 顯示 delivered:3, failed:4243（目標服務離線） |
| **Forge (Worktree 管理)** | `src/forge.ts` — worktree slot 管理器，為 code worker 分配隔離 git worktree；`forge-lite.sh` 實作在此 | `src/forge-client.ts` (227L) — 薄客戶端，shell out 到 mini-agent 的 forge-lite.sh（透過 `FORGE_LITE_PATH` env var） | mini-agent: prod（實作端）；middleware: prod（client 端，有跨 repo 耦合） | middleware forge 依賴 mini-agent 實作，`tests/forge.test.ts` (364L) 覆蓋完整。這是少見的 middleware→mini-agent 反向依賴 |
| **Commitments / Ledger** | `src/commitments.ts` — cross-cycle commitment 追蹤 | `src/commitment-ledger.ts` — commitment 持久化帳本 | 兩者均 prod；真重複（knowledge-nexus ba767392） | 遷移方向已定：mini-agent 成為 middleware ledger 的 thin client，cross-cycle 狀態統一放 middleware |

---

## 2. Migration Candidates

### Candidate A：Context Compaction → middleware `summarizer` worker

**為何適合搬上中台**
`src/context-compaction.ts` 每次執行阻塞 ~45s，是純文本處理（壓縮過長 context window）。middleware `summarizer` worker 已具備 LLM call + structured output 能力，且 plan-engine 支援 per-step retry。搬上中台後可 pre-dispatch（提前 1 cycle 非同步執行），命中 cache 時 swap in 壓縮版本，miss 時 inline fallback，消除目前同步阻塞。

**風險**
- **Lock-in**：context 格式若含 mini-agent 特有結構（<kuro:remember> tags、pulse markers），middleware summarizer 需知曉格式，產生 API contract 耦合
- **效能**：network RTT 加上 plan-engine overhead（通常 200-500ms）在 low-latency cycle（目標 <3s orient）下可能不划算；需 cache-hit rate >80% 才有淨收益
- **資料流**：壓縮後的 context 需回傳 mini-agent 寫入正確 instance 路徑（`~/.mini-agent/instances/{id}/`），涉及雙向資料流

**驗證 smoke test**
```bash
# Step 1: 確認 summarizer worker 可正常接收 text payload
curl -s -X POST http://localhost:3200/dispatch \
  -H 'Content-Type: application/json' \
  -d '{"type":"summarizer","input":{"text":"test context","maxTokens":500}}' | jq '.status'
# expect: "completed"

# Step 2: 計時比較 inline vs delegated 壓縮
time node -e "require('./src/context-compaction').compact('$(cat ~/.mini-agent/instances/*/MEMORY.md | head -200)')"

# Step 3: 驗證 cache-hit path（相同 input hash 應 <100ms）
curl -s -X POST http://localhost:3200/dispatch \
  -d '{"type":"summarizer","input":{"text":"same text","maxTokens":500}}' | jq '.duration_ms'
```

---

### Candidate B：Perception Analyzer → middleware `analyst` worker + KN cache

**為何適合搬上中台**
`src/perception-analyzer.ts` 每 cycle 觸發 6× Haiku 並行 LLM call，約耗 500-800ms，純輸入/輸出轉換（perception raw text → situation JSON）。middleware `analyst` worker 天然對應此職責（已有 rubric-driven JSON output）。KN（knowledge-nexus）可作 cache 層，key = `plugin_id + input_hash`，TTL = 1 cycle，cache miss 才呼叫 LLM，大量重複 perception 輸出（git-status 若 30s 內無變化）可直接命中。

**風險**
- **效能**：KN lookup 本身有 500ms guard 限制（knowledge-nexus ba767392），若 miss + LLM = 800ms，加上 RTT 可能超出 3s Orient budget；需強制保留 inline fallback
- **Lock-in**：situation report schema 若有 mini-agent 特有欄位（lane routing hints、OODA metadata），analyst worker 需相容版本控制
- **資料流改動**：cache miss 時 analyst worker 需能接收 raw perception blob（可達 10-50KB），需確認 middleware request size limit

**驗證 smoke test**
```bash
# Step 1: 健康檢查（workers 數量確認 analyst 在線）
curl -s http://localhost:3200/health | jq '{status:.status, workers:.workers}'
# expect: status:"ok", workers >= 21

# Step 2: 用真實 perception 輸出測試 analyst worker
PERC=$(bash plugins/git-status.sh 2>/dev/null)
curl -s -X POST http://localhost:3200/dispatch \
  -H 'Content-Type: application/json' \
  -d "{\"type\":\"analyst\",\"input\":{\"raw\":$(echo $PERC | jq -Rs .),\"schema\":\"situation_report\"}}" \
  | jq '{status:.status, has_output: (.output != null)}'

# Step 3: 同 payload 二次請求驗 KN cache-hit（duration 應 <100ms）
# （重複上一步 curl，比較 duration_ms）
```

---

### Candidate C：Commitments Ledger 統一 → middleware `commitment-ledger` thin-client 化

**為何適合搬上中台**
knowledge-nexus (ba767392) 已明確指定：`src/commitments.ts`（mini-agent）與 `src/commitment-ledger.ts`（middleware）是真重複，遷移方向已有共識——cross-cycle 狀態統一放 middleware，mini-agent 成為 thin client。此遷移消除雙寫、解決 commitment ghost 系列 bug（ghost-commitments-bug.md、commitment-ghost-closure-20260420.md），且 middleware ledger 具備 HTTP API 可讓外部工具查詢。

**風險**
- **Lock-in**：mini-agent 的 commitment lifecycle（OPEN→CLOSED→GHOSTED）若與 middleware ledger schema 不完全對齊，需 schema migration；一旦統一，rollback 需雙邊同步
- **效能**：每次 commitment 狀態查詢（OODA Act 前校驗）從本地 in-process 變成 HTTP call（+50-100ms），高頻呼叫 cycle 可能累積延遲
- **資料流改動**：歷史 commitments 需一次性遷移（mini-agent instance 目錄 → middleware 持久化儲存），遷移期間需雙讀防止遺漏

**驗證 smoke test**
```bash
# Step 1: 確認 middleware commitment-ledger 端點可用
curl -s http://localhost:3200/health | jq '.status'

# Step 2: 建立測試 commitment，確認 CRUD 正常
curl -s -X POST http://localhost:3200/commitments \
  -H 'Content-Type: application/json' \
  -d '{"id":"test-001","description":"smoke test commitment","status":"OPEN"}' | jq '.id'

# Step 3: 驗證 mini-agent thin client 讀取（修改後）
# 在 src/commitments.ts 改為呼叫 middleware client 後：
node -e "const c = require('./src/commitments'); c.list().then(console.log)"
# expect: 包含 test-001

# Step 4: 清理
curl -s -X DELETE http://localhost:3200/commitments/test-001 | jq '.status'
```

---

## 3. Boundary Rules Draft

以下規則為「何時走中台、何時本地做」的具體觸發條件：

---

**Rule 1：純文本轉換 / 評分任務 → 走中台**
> 當任務輸入 = 文本 blob，輸出 = 結構化 JSON，且無 mini-agent identity 元數據依賴時，派給 middleware `analyst`/`scorer`/`summarizer` worker。
> *原因*：middleware workers 有 per-step retry、structured output parsing、cost tracking；本地 LLM call 無這些保護。
> *例外*：若任務在 Orient budget 3s 內且無 cache，inline 更快。

**Rule 2：記憶寫入 / KG ingest → 永遠本地**
> 任何對 `~/.mini-agent/instances/{id}/` 的寫入、`<kuro:remember>` tag 編譯、KG entity/edge 更新，必須在 mini-agent 前景執行，不得 delegate。
> *原因*：memory 是 identity core，分散寫入會造成 JSONL index corruption；middleware 無狀態，不具備 instance 隔離語意。

**Rule 3：DAG 多步驟工作流（≥3 步）→ 走中台**
> 當任務需要 plan → execute → verify 三階段，且步驟間有 output 傳遞依賴時，透過 `src/delegation.ts` 派給 middleware plan-engine。
> *原因*：middleware plan-engine 有 Two-Phase Planning、convergence loop、zombie step 防護（最近 commit a6ab761 修復）；mini-agent task-graph 無這些機制。
> *必須*：delegation.ts:294 需加 `Promise.race` + 120s timeout，防止 hang_no_diag（P1 bug 7686e3f8 未修）。

**Rule 4：有外部 webhook 通知需求 → 走中台**
> 當 agent 動作需要通知外部系統（CI/CD trigger、Slack、第三方 API callback）時，透過 middleware `src/webhook-dispatcher.ts` 發送，不在 mini-agent 側維護外部 HTTP client。
> *原因*：middleware 已有 Stripe 風格 retry、delivery 記錄（hooks.json）、SSE `/events` 端點；mini-agent 側重複實作這些機制是 infra 浪費。

**Rule 5：Forge worktree 操作 → 呼叫 mini-agent，不繞過**
> middleware 需要 git worktree 時，必須透過 `src/forge-client.ts` + `FORGE_LITE_PATH` 指向 mini-agent 的 `forge-lite.sh`，不得在 middleware 側另起 worktree 管理邏輯。
> *原因*：worktree slot 狀態（allocate/release/cleanup）由 mini-agent 統一管理，middleware 側若另維護會造成 slot leak（forge.test.ts 364L 的測試即驗此邊界）。

**Rule 6：跨 cycle 狀態（commitments）→ 走中台，同 cycle 狀態 → 本地**
> 需要在多個 OODA cycle 間持久的狀態（commitments、task completion records）放 middleware ledger；僅在當前 cycle 有效的暫態（perception cache、orient scratch）保留本地。
> *原因*：middleware 提供 HTTP API 讓外部工具查詢 commitment 狀態；mini-agent 實例重啟後本地狀態可能遺失（knowledge-nexus ba767392 架構決策）。

**Rule 7：OODA Loop 核心路徑（BAR: Breathe/Act/Rest）→ 永遠本地**
> `src/loop.ts`、`src/metabolism.ts`、`src/cycle-tasks.ts`、`src/pulse.ts` 的執行不得走 middleware，必須保持前景低延遲。
> *原因*：BAR loop 是 mini-agent 的心跳，delegation 到 middleware 引入 network latency 會破壞 cycle timing（目前 loop hang timeout fix 正在積極維護中：commits 35f0add9, 7edd55d3）。

---

## Metadata

```json
{
  "generated": "2026-04-20",
  "sources": [
    "mini-agent repo probe (109 TS modules, 37 shell plugins)",
    "agent-middleware repo probe (src/, tests/, workers.json, hooks.json)",
    "knowledge-nexus nodes: ba767392, 7686e3f8, a242e7c4, b39c5a5f, 28addd87"
  ],
  "confidence": 0.91,
  "known_gaps": [
    "delegation.ts:294 timeout P1 bug 狀態（7686e3f8）尚未確認是否已修復",
    "middleware /health port 存在 3200 vs 3737 環境差異（a242e7c4 vs b39c5a5f）需確認"
  ],
  "next_review": "下次執行遷移規劃前，先 search_knowledge('mini-agent-vs-middleware-inventory') 命中本文件，不重複執行 inventory"
}
```
