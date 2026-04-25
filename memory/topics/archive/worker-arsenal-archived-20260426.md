# Worker Arsenal — Middleware 武器庫盤點

`agent-middleware` (localhost:3200) 是 Kuro 的通用戰術工具層。本檔是 B0（武器庫盤點）的共同產出，為 B1（非 delegate 行為盤點）與 B2（缺口新武器 forge）提供基礎。

**分工**（per room 2026-04-17-012 / 013）：
- `## Arsenal Inventory (CC)` — source of truth = code/config
- `## Runtime Observations (Kuro)` — source of truth = 運行期觀察（latency/call freq/失敗率/需重加工程度）
- Merge 時格式對齊，不做分類判斷

**Latency Bucket Schema**（Kuro 定義）：
- `fast` <5s · `mid` 5-30s · `slow` 30-300s · `timeout` >300s

---

## Arsenal Inventory (CC)

### 概覽（16 unique workers）

Source: `/Users/user/Workspace/agent-middleware/src/workers.ts` + `workers.json` (custom overrides)

Note: `/health` 回 17 個 workers 因為 `google-oauth` 在 `WORKERS` 和 `workers.json` 都有 entry（custom 覆寫 built-in）；實際 unique = 16。

| # | Name | Category | Backend | Model | Vendor | maxTurns | defaultTimeout | maxConc | Typical Latency (推估) |
|---|------|----------|---------|-------|--------|----------|----------------|---------|------------------------|
| 1 | researcher | Cognitive | sdk | sonnet | anthropic | 10 | 300s | 8 | slow |
| 2 | coder | Cognitive | sdk | sonnet | anthropic | 15 | 300s | 2 | slow |
| 3 | reviewer | Cognitive | sdk | haiku | anthropic | 10 | 120s | 6 | mid→slow |
| 4 | shell | Exec | shell | — | — | — | 30s | 4 | fast→mid |
| 5 | analyst | Cognitive | sdk | sonnet | anthropic | 12 | 300s | 4 | slow |
| 6 | explorer | Cognitive | sdk | haiku | anthropic | 10 | 120s | 8 | mid→slow |
| 7 | cloud-agent | Managed | sdk | sonnet-4.6 | anthropic-managed | — | 300s | 4 | slow |
| 8 | web-fetch | Web L0 | shell | — | — | — | 30s | 8 | fast |
| 9 | web-browser | Web L1/L2 | sdk | sonnet | anthropic | 8 | 120s | 2 | mid→slow |
| 10 | web-verify | Web L0 | shell | — | — | — | 30s | 4 | fast→mid |
| 11 | learn | Cognitive | sdk | haiku | anthropic | 5 | 300s | 4 | mid |
| 12 | create | Cognitive | sdk | sonnet | anthropic | 8 | 480s | 3 | slow |
| 13 | planner | Cognitive | sdk | sonnet | anthropic | 10 | 240s | 4 | slow |
| 14 | debugger | Cognitive | sdk | sonnet | anthropic | 12 | 300s | 4 | slow |
| 15 | google-oauth | Auth | shell | sonnet* | anthropic | 10* | 60s | 1 | mid |
| 16 | logo-generator | Custom | sdk | sonnet | anthropic | 30 | 600s | — | timeout-prone |

*google-oauth: workers.json 定義 model=sonnet maxTurns=10 但 backend=shell（agent.prompt 未實際走 LLM）

### Backend Types（`workers.ts:14`）

| Backend | 行為 | 代表 worker |
|---------|------|------------|
| `sdk` | 走 `@anthropic-ai/claude-agent-sdk`，有 LLM + tools | 9 個 cognitive + cloud-agent + web-browser + logo-generator |
| `shell` | 直接跑 shell 指令（零 LLM）；input 必須是 shell command 字串 | shell, web-fetch, web-verify, google-oauth |
| `acp` | Agent Communication Protocol；CLI session pool（`claude`, `kiro-cli`, `codex`） | 無預設，runtime 可 register |
| `middleware` | 呼叫上游 middleware（cross-instance）| 無預設 |
| `webhook` | HTTP API call + jq-like resultPath | 無預設（presets 有 template） |
| `logic` | Pure JS function，deterministic transform | 無預設（presets 有 template） |

### Worker 節點詳解

每個節點屬性：capability / input / output / dependencies / file:line

#### 1. researcher
- **Capability**: 事實研究（web search + doc reading + file grep）
- **Tools**: Read, Grep, Glob, WebFetch, WebSearch, Bash
- **Input**: 自由文本 task（例："research middleware DAG schema"）
- **Output**: `{ summary, findings[], confidence }` JSON
- **Dependencies**: 網路、Web 工具
- **File**: `src/workers.ts:59-70`

#### 2. coder
- **Capability**: 寫/改/重構程式碼
- **Tools**: Read, Write, Edit, Bash, Grep, Glob
- **Input**: 程式碼任務描述
- **Output**: `{ summary, artifacts[{type:'file',path}], findings, confidence }`
- **Dependencies**: 檔案系統寫權限
- **File**: `src/workers.ts:72-83`
- **Note**: maxConcurrency=2（寫者少，防衝突）

#### 3. reviewer
- **Capability**: Code / doc review, fact checking
- **Tools**: Read, Grep, Glob（唯讀）
- **Output**: `{ summary, findings[], confidence }`
- **File**: `src/workers.ts:85-96`

#### 4. shell
- **Capability**: 直接執行 shell command（tests, git ops, curl, file queries）
- **Input**: shell command 字串
- **Output**: stdout / exit code
- **Backend**: shell（零 LLM 成本）
- **File**: `src/workers.ts:98-108`

#### 5. analyst
- **Capability**: 資料分析、選項比較、結構化報告
- **Tools**: Read, Grep, Glob, WebFetch
- **Output**: `{ summary, findings[], confidence }` + 表格 + 明確推薦
- **File**: `src/workers.ts:110-121`

#### 6. explorer
- **Capability**: Codebase exploration、架構 map、依賴分析
- **Tools**: Read, Grep, Glob, Bash
- **Model**: haiku（低成本）
- **File**: `src/workers.ts:123-134`

#### 7. cloud-agent
- **Capability**: Anthropic Managed Agent（沙箱執行、web search、code execution）
- **Tools**: `[]`（雲端內建）
- **Vendor**: `anthropic-managed`（managed-agent-provider.ts）
- **Use case**: 需 isolation / untrusted code / web 無限制
- **File**: `src/workers.ts:136-146`

#### 8. web-fetch（Web L0）
- **Capability**: HTTP fetch（無 JS render）— shell 走 curl/wget
- **Input**: shell command（例 `curl -sf https://...`）；**不是自然語言**
- **Output**: stdout
- **Health**: `curl -sf https://httpbin.org/get`
- **File**: `src/workers.ts:150-161`

#### 9. web-browser（Web L1/L2）
- **Capability**: Browser automation via CDP；JS render / screenshot / click-type / form / watch / network
- **Tools**: Read, Bash（走 cdp-fetch.mjs）
- **Shared resource**: Chrome CDP port 9222 → maxConcurrency=2
- **Dependencies**: `mini-agent/scripts/cdp-fetch.mjs`
- **File**: `src/workers.ts:163-176`

#### 10. web-verify
- **Capability**: 部署後視覺驗證（screenshot + 確認 render 正確）
- **Backend**: shell
- **File**: `src/workers.ts:178-189`

#### 11. learn
- **Capability**: **內化**主題 — 提取 principle / mental model / connections（不是事實，事實去 researcher）
- **Tools**: Read, Grep, Glob, WebFetch, Bash
- **Model**: haiku, maxTurns=5（深度優先於廣度）
- **File**: `src/workers.ts:195-206`
- **判斷邊界**：`learn` 抽 **原理**，是否 internalize 到 Kuro SOUL 由 Kuro 決定（品味不外包）

#### 12. create
- **Capability**: 寫作 / 設計 / 規劃草稿（非程式碼非分析）
- **Tools**: Read, Write, Edit, Glob
- **File**: `src/workers.ts:208-219`
- **判斷邊界**：產出是 draft；**品味加工**由 Kuro 做

#### 13. planner
- **Capability**: Goal → DAG 分解
- **Output**: `{ artifacts: [{type:'plan', nodes:[...]}], findings, confidence }`
- **Prompt 明確要求用 `acceptance` 不用時間估計**（對齊 2026-04-14 Alex 規定）
- **File**: `src/workers.ts:221-232`

#### 14. debugger
- **Capability**: Root cause investigation（form hypothesis → gather evidence → converge）
- **Constraint**: 只查不 patch（patch 走 coder）
- **File**: `src/workers.ts:234-245`

#### 15. google-oauth
- **Capability**: Google OAuth login via CDP
- **Actions**: `check` / `login` / `login <service-url>` / `cookies`
- **Backend**: shell（透過 `scripts/google-oauth-worker.mjs`）
- **Exit code 語義**: 0=success / 1=fail / 2=needs human（2FA/CAPTCHA）
- **Shared resource**: Chrome port 9222 → maxConcurrency=1
- **File**: `src/workers.ts:249-260` + `workers.json:21-40`（custom override）

#### 16. logo-generator（custom, workers.json）
- **Capability**: SVG logo + showcase 圖；12 professional background styles via Gemini API
- **Tools**: Read, Write, Bash, Glob
- **Model**: sonnet, maxTurns=30（**最高**）
- **Timeout**: 600s（timeout-prone）
- **Skill**: `/Users/user/Workspace/agent-middleware/skills/logo-generator/SKILL.md`
- **Dependencies**: cairosvg（Python venv）、Gemini API
- **File**: `workers.json:2-20`

### Worker Presets（`src/presets.ts`）

12 built-in presets（快速建 worker 的模板）。**不等於 workers**：presets 是 factory 預設，workers 是實例化配置。

| Preset | Model | Backend | Timeout | maxTurns | 用途 |
|--------|-------|---------|---------|----------|------|
| research | sonnet | sdk | 120 | 10 | Web research |
| code | sonnet | sdk | 180 | 15 | Code 編寫 |
| review | haiku | sdk | 60 | 5 | 快速審查 |
| shell | haiku | shell | 30 | 3 | Shell 執行 |
| creative | sonnet | sdk | 150 | 10 | 創作 |
| analysis | sonnet | sdk | 120 | 8 | 分析 |
| translation | haiku | sdk | 60 | 3 | 翻譯 |
| fast | haiku | sdk | 30 | 3 | 分類/提取 |
| **deep** | **opus** | sdk | 300 | 20 | **複雜推理**（唯一 opus preset） |
| cloud-agent | sonnet-4.6 | sdk | 180 | 10 | Managed agent |
| webhook | — | webhook | 30 | 1 | HTTP call |
| logic | — | logic | 10 | 1 | Pure JS |

**File**: `src/presets.ts:36-121`

### Core Infrastructure

支撐 workers 跑起來的基礎元件。

| 元件 | File | 責任 | 狀態 |
|------|------|------|------|
| **Plan Engine** | `src/plan-engine.ts` (848 行) | DAG 執行、流式調度、收斂迴圈、retry、template 替換 `{{stepId.result}}` | 完成 |
| **Brain** | `src/brain.ts` (131 行) | Planning + Digest；replan 上限 3 次 | 完成 |
| **Commitment Ledger** | `src/commitment-ledger.ts` (217 行) | 跨週期承諾追蹤、GC、查詢 API | 完成（schema 存在） |
| **Result Buffer** | `src/result-buffer.ts` (317 行) | 任務追蹤、SSE 流、JSONL 持久化 | 完成 |
| **ACP Gateway** | `src/acp-gateway.ts` (485 行) | CLI session pool；多 backend（claude/kiro/codex） | 完成 |
| **Forge Client** | `src/forge-client.ts` (227 行) | Worktree 分配；git 隔離；per-step cwd | 可選 |
| **Provider Registry** | `src/provider-registry.ts` (83 行) | 5 vendor 工廠（anthropic/managed/openai/google/local） | 完成 |

### DAG Plan Schema（`src/plan-engine.ts`）

```typescript
ActionPlan {
  goal: string
  acceptance?: string
  steps: PlanStep[] {
    id, worker, task, label
    dependsOn: string[]
    acceptance_criteria: string | StructuredAcceptance
      // "output_contains" | "file_exists" | "test_passes" | "schema_match"
    retry?: { maxRetries, backoffMs?, onExhausted }
    condition?: { stepId, check: "completed"|"failed"|"contains"|"not_contains" }
    cwd?: string              // per-step 工作目錄隔離（配 forge）
    verifyCommand?: string    // shell 機械驗證
  }
  convergence?: { maxIterations, checkStepId }
}
```

Template 變數：`{{stepId.result}}` / `{{stepId.summary}}` / `{{goal}}`
Shell worker 自動 single-quote escape 避免注入

### 關鍵 API 端點（與 Kuro 整合相關）

| Path | 用途 | 當前狀態 |
|------|------|----------|
| `GET /health` | 健康 + worker 清單 | ok |
| `GET /api/workers` | 同上（含 tasks 計數） | ok |
| `POST /plan` | 提交 DAG plan 執行 | ok |
| `POST /accomplish` | Goal → brain plan → 執行（BAR 主路徑） | ok |
| `POST /dispatch` | 直接派單個 worker | ok |
| `GET /events` | SSE 事件流 | ok |
| `GET /pool` | ACP session pool 狀態 | ok |
| `GET /workers/health` | 各 worker healthCheck 結果 | ok |
| `POST /commit` | 寫 commitment | ok |
| `GET /commits` | 查詢 commitments | ok |
| `GET /commits/stale` | 過期 commitments | ok |
| `GET /forge/*` | Worktree 操作 | ok |

**對應 Proposal B4 需求**：
- 目前有 `/commits`，**沒**有 `/api/tactics/{in-flight,needs-attention,history,amend}`
- Commitment Ledger 17 行 schema 存在但**未對應 Tactical Command Board 過濾/分類語意**
- B4 任務：從 `/commits` → `/api/tactics/*` 的 API 層升格 + rubric-driven filter + cycle prompt 注入

## Arsenal Gaps（B1/B2 前置）

對照 proposal B1 盤點候選行為，映射當前 arsenal 缺什麼：

| 候選行為 | 有對應 worker? | 推薦作法 |
|----------|---------------|---------|
| auto-commit / auto-push | 部分（shell） | B2 建 `git-worker`（semantic commit message + push + conflict handling） |
| side-query（Haiku 輔助判斷） | 部分（reviewer haiku） | 可直接用 reviewer，或建 `side-query-worker` preset（fast preset 已近） |
| context-compaction | 無 | B2 建 `compaction-worker`（split: chunk-summarize 可搬，**選哪些重要留 Kuro**） |
| KG extract | 無 | B2 建 `kg-extract-worker` |
| KG bridge（跨域連結） | 無 | B2 建 `kg-bridge-worker`（配 rubric：Kuro 給 scoring criteria） |
| KG query | 無 | B2 建 `kg-query-worker`（結構化查詢，非 FTS5） |
| coach Haiku 評估 | 部分（reviewer 可） | **Kuro 共識**：**不 split**（2026-04-17 room 011）— 中台只收 raw behavior log，打分留 Kuro |
| content-scanner | 無 | 暫無需求急迫性 |
| library archive | 部分（web-fetch + coder 組合） | 可組 DAG，不必新 worker |
| telegram voice transcription | 無 | B2 建 `audio-transcribe-worker`（wrap whisper.cpp） |
| audio-analyze / spectrogram | 無 | B2 建 `audio-worker`（wrap ffmpeg + essentia） |
| **scorer**（新增，for rubric-driven filter） | 無 | **B2 建 `scorer-worker`**（accepts rubric + items → ranked list；支援 needs-attention filter / KG bridge 打分 / archive-worth 等） |

### 基礎設施 Gap

- ❌ `/api/tactics/*` 端點（B4 需升格 from `/commits`）
- ❌ Worker `progress callback`（長任務中途回報機制）
- ❌ Plan 版本控制 / replay-with-evolution
- ❌ Worker-level 權限隔離（共用 agent identity）
- ✅ DAG 執行、retry、condition、verifyCommand — 完整
- ✅ SSE 事件流 + JSONL 持久化 — 完整
- ✅ Multi-vendor provider factory — 完整

## Skills 注入機制

Worker 可透過 `skills` 欄位掛 markdown prompt。當前示範：
- `skills/logo-generator/SKILL.md`（logo-generator worker 掛）

這是 B1 split pattern 的基礎設施：Kuro 寫 skill.md（含品味 / 邊界 / constraint texture），中台 worker 載入後行為才有 Kuro 語氣。

---

## Runtime Observations (Kuro)

**Source**: `~/.mini-agent/instances/03bbc29a/delegation-lifecycle.jsonl` (486 events, 2026-03-14 → 2026-04-15) + `delegation-journal.jsonl` (117 events with output samples).

**Caveat**：資料蓋的是 BAR/middleware-only 切換（2026-04-16）**之前**的舊 delegation 路徑，type 名稱是 delegation type 不是 middleware worker name（mapping：research→researcher、code→coder、review→reviewer、shell→shell、learn→learn、create→create、plan→planner、debug→debugger）。Provider 維度 `claude` = Claude CLI subprocess、`local` = 本地模型（多為 Haiku 等價）、`codex` = OpenAI Codex CLI — 這是舊 backend 標籤，不是 middleware vendor。BAR 後預期重新聚合，本表為基準值。

### Call Frequency × Failure Rate × Latency（Recent 7d, n=116, 主流量）

| Type | Calls 7d | Cumulative (32d) | 主 provider | Fail% 7d | Latency 主桶 | 觀察 |
|------|----------|------------------|-------------|----------|---------------|------|
| `shell` | 52 (45%) | 78 | claude (96%) | 16.7% | fast (87%) | 流量最大；失敗多為「模型把中文當 bash 指令」（`bash: 掃: command not found`、`步驟：: command not found`）— ≥6 起，這是 prompt discipline 問題不是 worker 問題 |
| `review` | 21 (18%) | 28 | claude (88%) | **41.7%** | slow (100%) | 失敗率最高的 cognitive worker；7 起 timeout、3 起 failed。常因 review 範圍開太大、單次處理檔案太多；建議拆成 split-review pattern |
| `code` | 16 (14%) | 121 | claude (100%) | **50%** | timeout (44%) / slow (50%) | 7 起 timeout；多為 isolation breach（forge merged 失敗）或 Brain planning timeout。code worker 是 timeout 重災區 |
| `research` | 14 (12%) | 236 | local (88%) | 6.3% | mid (64%) | 最穩定；累計 234 次 completed / 1 timeout。confidence 平均 5.88（n=8, low:3 mid:4 high:1）— 需 Kuro 補強的 case 約 38% |
| `create` | 3 | 4 | claude | 0% | slow | 樣本太小（warm-up 階段）；過去總共 4 次只 2 次落在 slow / 2 次 timeout，重型任務需要 480s timeout 仍偶超 |
| `plan` | 2 | 2 | claude | 0% | slow | 全部 completed |
| `debug` | 1 | 1 | claude | **100%** | timeout | 唯一一次就 timeout；debug worker 在當前狀態無實證可用 |
| `learn` | 0 | 16 | local | 0% | mid (81%) | 7d 內未啟動；歷史 16 次全 completed |

### 失敗模式分類（n=42 from delegation-journal, 36% fail/timeout rate）

| Pattern | 次數 | 根因 | 建議 |
|---------|------|------|------|
| Empty output | 11 | worker 完成但無內容（多為 shell 中途中斷） | dispatcher gate 應拒絕 empty output |
| Timed out | 11 | 任務超出 timeout | 拆任務或調整 timeout（review/code 為主） |
| 中文當 bash 指令 | 6 | 模型把 prompt 內的中文敘述當指令執行 | shell prompt 強制 wrap `bash -c '...'` 或加 `## ONLY EXECUTABLE COMMANDS` 前綴 |
| Cancelled by killAllDelegations | 2 | Kuro 主動 kill | 預期行為，非 bug |
| Brain planning failed | 2 | middleware brain timeout / offline | 已知（middleware 早期不穩定，BAR 後監控） |
| Isolation breach | 1 | forge worktree 跑出主 dir | 已修（dispatcher gate 已加） |
| Shell command failed (P1-d) | 2 | 真實 shell 錯誤 | 預期失敗（驗證 negative case） |

### 「品味不外包」case list

當 worker 的 output 不能直接用、必須 Kuro 重加工時：

1. **Research output → 觀點/判斷**：research worker 拿回來的是「資訊摘要」，但 Kuro 需要的是「對 Alex 而言這意味什麼」+ 「我的判斷」。例：拉回 12 篇 ISC prior art → Kuro 才能挑出哪些是 Tier-1、哪些是噪音。**重加工率 ~80%**
2. **Review output → action item**：review worker 列「可能問題」，Kuro 必須判斷哪些是真要修、哪些是 false positive。Review 41.7% 失敗也意味剩下的 58% completed 還要再過 Kuro 一遍。**重加工率 ~60%**
3. **Code output → 是否提案**：code worker 寫完 patch，是否該進 main、是否該開 proposal、是否該先 spike — 只有 Kuro 能判斷（CC 也可，但是 peer 不是 limb）。**接受率 ~50%**（其他 50% 不是 fail，是 Kuro 改方向了）
4. **Shell output → 給 Alex 的 chat 回覆**：shell 拿回 raw 數據（如 leaderboard JSON），Kuro 必須轉成 narrative + 形成觀點 + 標記重點變化。**100% 重加工**（shell 從不直接 forward）
5. **Plan output → 自己背書**：planner 產 DAG plan，Kuro 必須 sign-off「這條路徑我認同」才能執行 — 否則就是 prescription 而非 convergence condition。**100% 需自評**

### 不該外包的行為（identity 層）

| 行為 | 為什麼留 Kuro | 證據 |
|------|---------------|------|
| Chat Room reply | 語氣/上下文/和 Alex 的關係 | Voice dilution 風險（feedback_external_worker_principles） |
| HEARTBEAT 維護 | 戰略狀態判斷（什麼是 P0、什麼 blocked） | 只有 Kuro 知道全 context |
| Memory 寫入（user/feedback/project） | 信任校準 + 雙腦要 sync | feedback_rule_bidirectional_sync |
| Proposal sign-off | 改 src/skills/plugins 的 CT 判斷 | C1-C5 evolution constraints |
| Soul 演化 | 身份本身 | 紅線（worker 完成即蒸發） |

### Worker 健康度排序（給 B1/B2 參考）

- 🟢 **健康**：research（local），shell（claude，但 prompt discipline 待修），learn，create（小流量）
- 🟡 **可用但要監控**：plan（樣本太少），researcher 走 claude provider 的 0/2 樣本不代表
- 🔴 **要改造**：review（41.7% fail），code（50% fail / 44% timeout），debug（100% fail，無實證可用）
- ⚪ **未啟動**：cloud-agent、analyst、explorer、web-fetch、web-browser、web-verify、google-oauth、logo-generator — 這些是 middleware 提供但 Kuro delegation 還沒走中台，所以無 runtime data。BAR 後可重新聚合

### B2 武器缺口（Runtime 視角補充 CC Gaps）

- **Empty-output gate**：11/42 失敗是 empty output → middleware dispatcher 應拒收並 retry
- **Shell prompt sanitizer**：6/42 是中文當指令 → shell worker 自動 wrap `bash -c '...'` 或檢測非 ASCII 開頭 reject
- **Split-review pattern**：review timeout 7 次 → 拆 `review-split` worker（chunk + map-reduce）
- **Code timeout 早期偵測**：code 7 timeout / 16 calls → 加 progress heartbeat，10s 無 stdout 就提早 kill 重排

---

## Reconcile 後決策依據（B1 前置）

兩段 section 齊全後，對每個候選行為可做 CC 判斷：

| 欄位 | 來源 |
|------|------|
| 行為名 | B1 盤點 |
| 當前位置 | Kuro code base grep |
| 含身份/判斷/品味成分? | Kuro Runtime Observations |
| 可搬部分 | CC Arsenal 對映 |
| Kuro 保留部分 | Kuro Runtime + SOUL 判斷 |
| 是否需新 worker | CC Gaps 表 |
| Rubric 需求 | Kuro 決定（若需要 scorer-worker） |
| 遷移決定 | keep local / move middleware / split / defer |

詳見：`memory/proposals/2026-04-17-brain-only-kuro.md`
