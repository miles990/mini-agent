---
related: [middleware-as-organ, system-reminder-split-plan, mini-agent-roadmap, feedback_middleware_integration_decision, feedback_commitment_ghost_root_cause]
---
# mini-agent Proposal v2-final — middleware-as-organ + commitments ledger

**Status**: v2-final draft — 2026-04-16 by Kuro
**Audience**: CC (middleware worker) as primary implementer; Alex as L3 gate
**Supersedes**: v1 (scattered across `middleware-as-organ.md` + chat-room threads cycles #130–#258)
**Source of truth**: this file. 其它相關檔 (middleware-as-organ.md / system-reminder-split-plan.md) 只存歷史推導，與此文件矛盾時以此為準。

---

## §1 目標與非目標

### CC 映射
- **CC-R (Reasoning Continuity)** 主攻：commitments 不蒸發、delegation 執行層可觀察
- **CC-T (Trust Boundary)** 不在此 proposal 範圍（由 system-reminder-split-plan P2 處理）
- **CC-D (Distribution)** 不受此 proposal 影響

### In scope
1. **middleware-as-organ**：把 delegation 執行層（subprocess spawn / lifecycle / timeout / exit classification）從 `src/delegation.ts` 抽到 local middleware service
2. **commitments ledger**：mini-agent 跨 cycle 承諾持久化 API，反 drift 基礎設施
3. **delegate converter**：`src/delegation.ts` 砍到 ≤50 行 tag-to-DAG converter（Q-S2 砍掉重練），不再是「shim 包 spawn」而是「轉譯 `<kuro:delegate>` tag 成 DAG node 丟給 middleware /plan」
4. **mini-agent ↔ middleware 介面契約**：HTTP port 3200，固定 endpoint set
5. **single-organ commitment**：mini-agent 只剩 /accomplish 或 /plan 一個入口（Q-S1 完全取代），delegate tool 從 agent-compose 下架

### Out of scope
- 外部 worker / cross-agent delegation（v3）
- trust channel 遷移（P2 單獨 proposal）
- multi-Kuro instance 同步
- Forge / Akari 接入 middleware（Q2/Q4 已判：留 mini-agent）

### Non-goals（顯式拒絕）
- middleware 不做 cloud SPOF 補償（本機同命 = filesystem 等級器官）
- 不寫 dual-routing fallback（單向改寫，避免 C5 技術債）
- ledger 不做 eventual consistency / distributed transactions（單一 mini-agent instance）

---

## §2 架構

```
┌──────────────────────────────────────────────────────┐
│                    mini-agent (Kuro)                 │
│  ┌────────────────────────────────────────────────┐  │
│  │  Perception  →  Reason  →  Act                 │  │
│  │                                                │  │
│  │  Act 時產出 3 類 artifact：                     │  │
│  │    - subprocess spawn request                  │  │
│  │    - commitment write                          │  │
│  │    - commitment resolve                        │  │
│  └──────────────┬─────────────────────────────────┘  │
│                 │ HTTP localhost:3200                │
└─────────────────┼────────────────────────────────────┘
                  ▼
┌──────────────────────────────────────────────────────┐
│            middleware (local OS-level organ)         │
│  ┌─────────────────┐  ┌─────────────────────────┐    │
│  │  Subprocess     │  │  Commitments Ledger     │    │
│  │  Pool           │  │  (jsonl-backed KV)      │    │
│  │  - spawn        │  │  - commit / patch       │    │
│  │  - track        │  │  - query by status      │    │
│  │  - classify exit│  │  - cross-cycle recall   │    │
│  │  - PATCH ledger │  │                         │    │
│  │    onExit       │  │                         │    │
│  └─────────────────┘  └─────────────────────────┘    │
│                                                      │
│  Persistence: ~/.mini-agent/middleware/              │
│    - commits/YYYY-MM-DD.jsonl                        │
│    - subprocesses.jsonl (append-only audit)          │
└──────────────────────────────────────────────────────┘
```

**切面準星**（Alex #246 已定）：
- 執行引擎 → middleware
- 策略語義（wave / methodology / sibling 編排）→ mini-agent ~400 行 edit-layer

**SPOF 態度**：middleware 掛 ≈ Kuro 掛（OS-level 同命）。由 launchd KeepAlive 看管，mini-agent 不寫 fallback。

---

## §3 資料流

### 3.1 Delegation (subprocess spawn)
```
Kuro decision
  → delegation.ts edit-layer: converter (parse <kuro:delegate>)
  → HTTP POST /spawn → middleware
  → middleware: fork subprocess, track PID, set timeout
  → middleware onExit: classify (graceful/circuit/preempt/external)
  → middleware: PATCH /commit/:taskId fire-and-forget
  → background-completed 回流進下 cycle perception
```

### 3.2 Commitment (cross-cycle promise)
```
Kuro 說「我下 cycle 做 X」
  → edit-layer 偵測 commitment phrase (或 Kuro 顯式 <kuro:commit>)
  → HTTP POST /commit → middleware ledger
  → 下 cycle perception 從 middleware 拉 open commitments
  → 顯示於 <perception> 開頭的 "Open Commitments" 區塊
  → Kuro 看到後：兌現 → PATCH 標 resolved / 或顯式延期 / 或取消
```

### 3.3 轉譯邊界
- **Truth**：middleware jsonl 檔（append-only，git 以外的第二層版控語義）
- **View**：perception `<open-commitments>` digest（由 mini-agent prompt-builder 從 middleware pull 再 render）
- **Conflict rule**（對齊 feedback_memory_infra_boundary）：ledger jsonl 為 truth，memory.md 提及 commitments 時 compiled+raw fallback 帶 source pointer

---

## §4 Runtime Components

### 4.1 middleware 服務
- **Binary location**: `~/.mini-agent/middleware/bin/middleware` (TypeScript → bun compile)
- **Entry**: `middleware/src/server.ts`
- **Port**: `MIDDLEWARE_PORT_DEFAULT = 3200`，env `PORT` 可覆蓋
- **Lifecycle**: launchd `com.kuro.mini-agent.middleware.plist`, KeepAlive=true
- **Logs**: `~/.mini-agent/middleware/logs/YYYY-MM-DD.log`

### 4.2 mini-agent 客戶端
- **File**: `src/middleware-client.ts`（新檔，~120 行）
- **Depends on**: `undici` fetch（bun native OK）
- **URL**: `process.env.MIDDLEWARE_URL ?? 'http://localhost:3200'`
- **Retry**: 單次指數 backoff 2 次（middleware 同命，不做長期重試）
- **Timeout**: 請求 500ms hard cap（同機 HTTP 不該慢）

### 4.3 edit-layer（`src/delegation.ts` 重寫）
- 目標行數：~350 行（從 1431 瘦身 ~75%）
- **保留**：DAG planning, wave orchestration, sibling deduping, methodology routing, `<kuro:delegate>` parser
- **移除**：spawn, exec, timeout handling, exit classification, 直接 pid 操作
- **改寫**：spawn call → `middlewareClient.spawn(req)`

---

## §5 Commitments Ledger — API & Schema

### 5.1 資料模型

```typescript
type CommitmentStatus = 'open' | 'resolved' | 'cancelled' | 'expired';

interface Commitment {
  id: string;              // `cmt_${yyyymmdd}_${nanoid(6)}`
  createdAt: string;       // ISO8601
  cycle: number;           // mini-agent cycle number at creation
  owner: 'kuro' | 'cc' | 'alex';
  source: {
    channel: 'room' | 'inner' | 'delegate' | 'user-prompt';  // 粗粒度 4 值
    subtype?: string;      // 例: 'forge-spawn' | 'sibling-handoff'
    messageRef?: string;   // room/jsonl 訊息 ID 或 hash
  };
  action: string;          // 短描述「下 cycle 寫 P3 spec」
  acceptance: string;      // 驗收條件「memory/topics/llm-wiki-v2-proposal.md exists + committed」
  blockedOn: string[];     // 其他 commitment id 或外部 token
  dueBy?: string;          // ISO8601；缺則無 deadline
  status: CommitmentStatus;
  resolvedAt?: string;
  resolution?: {
    kind: 'task-close' | 'superseded' | 'dropped' | 'expired';
    evidence: string;      // 'exit:0' | 'exit:143' | 'cancelled' | 'timeout' | commit sha | free-text
    sha?: string;          // 若有 git commit 關聯
    note?: string;
  };
}
```

### 5.2 API Endpoints

| Method | Path | Purpose | Body | Response |
|---|---|---|---|---|
| POST | `/commit` | Create commitment | `Omit<Commitment,'id'\|'createdAt'\|'status'>` | `{id, createdAt}` |
| GET | `/commit/:id` | Fetch one | — | `Commitment` |
| PATCH | `/commit/:id` | Update status / add resolution | `Partial<{status, resolution, blockedOn, dueBy}>` | `{ok: true}` |
| GET | `/commits?status=open&owner=kuro&channel=room` | Query | query params | `Commitment[]` |
| GET | `/commits/stale?cycles=3` | Open commitments older than N cycles | — | `Commitment[]` |

### 5.3 PATCH onExit 契約（CC #259 Q3 答案）

Subprocess spawn 時，middleware 內部自動在 commitments ledger 開 commitment（owner='kuro', channel='delegate'）；onExit 時 fire-and-forget PATCH 自己 id：

```typescript
// middleware 內部，不是 mini-agent 的責任
onExit(pid, exitCode, classification) {
  fetch(`http://localhost:${PORT}/commit/${commitmentId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: exitCode === 0 ? 'resolved' : 'resolved',
      resolution: {
        kind: 'task-close',
        evidence: `exit:${exitCode}`,
        note: classification  // 'graceful' | 'circuit' | 'preempt' | 'external'
      }
    })
  }).catch(() => {});  // fire-and-forget
}
```

**三好處**（Alex #259 原文）：
- (a) ledger 對帳真實
- (b) `/commits/stale` 不會誤報已完成 task
- (c) audit trail 完整

### 5.4 Persistence format

`~/.mini-agent/middleware/commits/YYYY-MM-DD.jsonl` — append-only。PATCH 寫新 entry `{...original, ...patch, updatedAt}`，讀取時以最後一筆 same-id 為 effective。compact job 跨日合併（v2 再做，v2-final 不必要）。

### 5.5 Perception 整合

`prompt-builder.ts` 新增 section：

```
<open-commitments>
  ${GET /commits?status=open&owner=kuro JSON}
  (顯示 id / action / acceptance / createdAt / blockedOn)
</open-commitments>
```

插入位置：`<task-queue>` 前。Kuro 每 cycle 看到未兌現承諾，減少 working memory drift（= 修 feedback_commitment_ghost_root_cause）。

---

## §6 Mini-agent (Designer) vs Middleware Worker (Implementer)

### 6.1 Alex #257 定調
> mini-agent = 規劃設計，middleware worker = 實作

### 6.2 職責邊界

| 維度 | mini-agent (Kuro) | middleware (CC impl) |
|---|---|---|
| Decision | 是否要 spawn、要 spawn 什麼、什麼時候放棄 | 不決策，只執行 |
| Strategy | DAG planning / wave / sibling dedup | 無策略（純 executor） |
| Trust | 擁有 voice / judgment / identity | 無 identity，pure service |
| State | Working memory（揮發）+ 委外給 ledger | Ledger + subprocess pool（持久） |
| Failure | Kuro 重 reason 找新路徑 | middleware 回 error code，不嘗試修復 |
| Observability | Kuro 讀 perception 消化 | 寫 structured logs，不解讀 |

### 6.3 Worker 執行 DAG 計畫

本 proposal 本身就是第一張 DAG：

```
CC 實作順序（middleware 視角）:
  W1: middleware skeleton (bun server, port 3200, POST /spawn stub)
  W2: commitments ledger (POST /commit, GET /commit/:id, jsonl persistence)
  W3: subprocess pool (fork + timeout + exit classify)
  W4: onExit PATCH hook (§5.3)
  W5: query endpoints (/commits, /commits/stale)
  W6: launchd plist + KeepAlive
  W7: worktree lifecycle endpoints — GET /worktrees, POST /worktrees/:id/recover, GET /tasks?status=stale (Q-S3 forge 遷移，過渡期可 shell out scripts/forge-lite.sh)

Kuro 實作順序（mini-agent 視角）:
  K1: middleware-client.ts (undici fetch wrapper)
  K2: delegation.ts edit-layer diff (blocked-by W1+W3)
  K3: prompt-builder.ts <open-commitments> section (blocked-by W2+W5)
  K4: commitment detection / <kuro:commit> parser (edit-layer 擴充)
  K5: golden regression tests
```

**關鍵約束**：W1+W2+W3 綠 → K1+K2 才能動；W5 綠 → K3 才有意義。CC 自己跑 W 序列，不需 Kuro 介入。Kuro 遇疑問退回自己 spec，不碰 middleware 內部實作。

### 6.4 Strategic Resolutions（Alex #230 拍板，2026-04-15）

三軸策略決議，取代先前 #227 對齊的 (C/留/incremental) 保守版本：

| Axis | Question | Resolution | 對本 proposal 的衝擊 |
|---|---|---|---|
| **Q-S1** | delegate tool 命運？ | **(A) 完全取代** — agent-compose 不再暴露 delegate tool | delegation.ts 不是 shim，是 converter；sunset criteria Day 1 就拔不等 7d zero-fallback |
| **Q-S2** | 9-type capability map 去留？ | **砍掉重練** — baseline pool 不砍但成長路徑變「缺了就設計可複用 worker 進池」 | 9 type 昇華成 middleware worker registry（learn/create 已上線 2026-04-15）；cold-path worker（plan/debug/review）need-driven 補 |
| **Q-S3** | mini-agent vs middleware 器官關係？ | **middleware = 唯一器官** — 執行端全部由 worker 負責，mini-agent 只剩 DAG plan + worker selection | forge worktree 仍留 mini-agent（DAG builder 呼 forgeAllocate 拿 cwd），但 forgeStatus/forgeRecover/recoverStaleDelegations/watchdogDelegations/killAllDelegations 5 個 symbol 遷到 middleware（CC #238 確認 α 路線） |

**Alex 原話精華**（#230）：
> mini-agent 應該變成把專注力放在制定最好的最合適的 DAG plan 和選用最合適的 worker，沒有的話設計一個可以被重複使用的 worker，以後遇到相同類似情境就可以直接用這個 worker

**落地意義**：
- 本 proposal 從「middleware 接手部分執行」升級為「middleware 接手全部執行」。mini-agent 的腦 = DAG plan + worker selection + commitment emission；middleware 的手 = 所有 subprocess / worktree / lifecycle
- K2 不再是「delegation.ts 瘦身到 350 行 shim」，而是「delegation.ts 砍到 ≤50 行 tag-to-DAG converter」
- W1-W6 worker 實作範圍擴充涵蓋 forge/watchdog endpoints（新增 W7: worktree lifecycle endpoints）

---

## §7 Migration Plan

### 7.1 Cutover order
1. **W1-W6 完成**（middleware 全綠，localhost:3200 運作）
2. **K1 完成**（client wrapper）
3. **K2 shadow run 1-2 週**：edit-layer 改造，主路徑仍走原 spawn，parallel 送 middleware 對照
4. **Diff check**：比對 taskId format / exit 分類 / timeout 行為，出 parity report
5. **翻 flag**：`MIDDLEWARE_PRIMARY=true`，原 spawn 路徑保留 1 個 cycle 做 rollback safety
6. **清除舊路徑**：`src/delegation.ts` 的 spawn 相關代碼刪除，瘦身到 ~350 行

### 7.2 Golden regressions（K5）
- **delegation-parity**：`<kuro:delegate type="research">...</kuro:delegate>` → taskId 格式 / result jsonl shape 與原版 identical
- **commitment-roundtrip**：Kuro 寫 commitment → 下 cycle `<open-commitments>` 可見 → PATCH resolved → 再下 cycle 消失
- **crash-recovery**：middleware kill -9 → launchd 重啟 → open commitments 不遺失（jsonl 讀回）

### 7.3 Unblocks downstream
- ✅ 解鎖 P2 system-reminder split（delegation 結果 ingest 點清楚後可 sanitize）
- ✅ 解鎖 P3 LLM Wiki v2（commitments ledger 建立起 jsonl-as-truth pattern，Wiki compiler 可複用）
- ✅ 解鎖 P4 kuro.page 感知通道（middleware 多一個 inbox source endpoint）

---

## §8 Rollback

- **middleware 服務掛**：launchd 自動重啟；若持續失敗 → Alex L3 人介入；mini-agent 不 fallback
- **ledger 腐壞**：jsonl append-only 特性保證 truncate 重放可恢復；compact job bug 時用前一天 snapshot
- **edit-layer 回退**：shadow run 期間保留原 spawn，K2 翻 flag 後 1 cycle 仍可 revert commit
- **全面 revert**：刪 launchd plist，還原 `src/delegation.ts`，刪 `~/.mini-agent/middleware/`。不破壞其他 topic

---

## §9 Open Questions（v2-final 不擋實作，但需在 cutover 前回答）

| ID | Question | Default | Owner |
|---|---|---|---|
| Q-V1 | Commitment 自動過期規則？（stale > 14 cycles 自動 cancel？） | stale 14 cycles → `expired`，不自動刪 | Kuro before K3 |
| Q-V2 | 同一 action 不同 cycle 重複寫 commitment 要 dedupe 嗎？ | 不 dedupe，latest open 為準 | Kuro before K4 |
| Q-V3 | middleware 升級 rolling restart 策略？ | v2 再做，v2-final launchd stop/start 即可 | CC before W6 |
| Q-V4 | 跨 mini-agent instance（Kuro + Akari）共用 middleware 嗎？ | 不共用，Q4 已判 Akari 不接 | 已關 |

---

## §10 Cutover Checklist（final gate）

- [ ] W1-W6 全部 merged to middleware main
- [ ] K1-K2 shadow run parity report ≥ 99% match over 50 delegations
- [ ] K3 `<open-commitments>` 在 perception 出現並被 Kuro 正確處理（≥ 3 cycle 觀察）
- [ ] K5 golden regressions 全綠
- [ ] Alex L3 approve flag flip
- [ ] `src/delegation.ts` 瘦身 diff reviewed + merged

**此文件本身進入 commitments ledger（首筆）**：Kuro 自己帶頭 dogfood，cutover 完成後回填本節每項的日期與 sha。
