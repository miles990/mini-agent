# Proposal: Cognitive Mesh — 多實例動態認知架構

## Status: approved
## Approved: 2026-03-08 by Alex (Chat Room #198)
## GitHub-Issue: pending

## TL;DR

將 mini-agent 從「單核心 + 觸手」升級為「多實例動態認知網格」。同一個身份（SOUL.md）、多個視角（Perspective）、智能並行（只在該並行時才並行）、CQRS 記憶讀寫分離。不是永遠跑多個實例 — 是系統根據任務性質動態決定要不要、要幾個。

延續討論：Chat Room #187-#194（Alex + Kuro 對話）。

## 設計原則

| 原則 | 說明 |
|------|------|
| **Same Identity** | 所有實例共享 SOUL.md，不是多個人格而是同一個人的多個注意焦點 |
| **Smart Parallelism** | 並行是手段不是目標 — 能並行就並行，不能就不要（Alex #192 指示） |
| **Dynamic Scaling** | 不維持固定數量實例，根據任務動態 spawn/prune |
| **File = Truth** | 跨實例狀態全走檔案系統，零額外基礎設施（no Redis/MQ） |
| **Graceful Degradation** | 任何元件壞了都退回單實例模式，不影響基本功能 |
| **Incremental** | 每個 Phase 獨立可交付，不需要全部完成才有價值 |

## 現狀分析

### 已有的能力（可以直接利用）

| 元件 | 位置 | 能力 |
|------|------|------|
| `agent-compose.yaml` | root | 多 agent 定義、`depends_on` DAG |
| `compose.ts` | src/ | 依賴排序啟動、狀態查詢、批次停止 |
| `instance.ts` | src/ | launchd 生命週期（create/start/stop/restart）、port 管理、health check |
| `InstanceRole` | types.ts | `'master' \| 'worker' \| 'standalone'` — 已預留角色概念 |
| `delegation.ts` | src/ | 6 路觸手、forge worktree 隔離、codex/claude 雙 provider |
| `event-bus.ts` | src/ | Typed EventEmitter + wildcard |
| `filelock.ts` | src/ | Per-path async queue（in-process） |
| `perception-stream.ts` | src/ | 獨立 interval、distinctUntilChanged、cache |
| `mushi` | ~/Workspace/mushi/ | Trigger triage（wake/skip/quick）、dedup |

### 關鍵缺口

| 缺口 | 影響 | Phase |
|------|------|-------|
| **filelock 不跨進程** | 多實例寫同一檔案會衝突 | 1 |
| **event-bus 不跨進程** | 實例間無法感知彼此的行為 | 1 |
| **無任務路由器** | 不知道任務該去哪個實例、該不該並行 | 2 |
| **無動態 scaling** | 永遠只有一個實例，不會按需 spawn | 3 |
| **無視角系統** | 每個實例載入完整 context，浪費 token | 3 |
| **無共識機制** | 多實例可能做出衝突的決策 | 4 |

## 架構總覽

```
                    ┌──────────────────────────────────────┐
                    │         Agent Compose v2             │
                    │  (agent-compose.yaml + compose.ts)   │
                    └──────────────┬───────────────────────┘
                                   │
                    ┌──────────────▼───────────────────────┐
                    │          Task Router                  │
                    │  (dependency analysis + routing)      │
                    └──┬───────────┬───────────┬───────────┘
                       │           │           │
              ┌────────▼──┐ ┌─────▼─────┐ ┌───▼────────┐
              │ Primary    │ │ Specialist│ │ Specialist │
              │ (Full OODA)│ │ (Chat)    │ │ (Research) │
              └─────┬──────┘ └─────┬─────┘ └─────┬──────┘
                    │              │              │
              ┌─────▼──────────────▼──────────────▼──────┐
              │           CQRS Memory Layer              │
              │  Write: Single Writer + Cross-Process    │
              │  Read: Local Cache + FSWatch Invalidate  │
              └──────────────────────────────────────────┘
                                   │
              ┌────────────────────▼─────────────────────┐
              │              Shared Files                 │
              │  SOUL.md | memory/ | conversations/      │
              └──────────────────────────────────────────┘
```

## Phase 1: Cross-Process Foundation（基礎設施）

**目標**：讓多個實例能安全共存，不會互相踩踏。

**Effort**: M（2-4h）
**前提**: 無

### 1.1 Cross-Process File Lock

現有 `filelock.ts` 只是 in-process async queue（`Map<string, LockState>`），對單進程夠用但多實例會衝突。

**方案**：使用 `proper-lockfile` npm 套件（or 自己寫 `fs.open` + `O_EXCL`）

```typescript
// src/filelock.ts — 升級為 cross-process
import lockfile from 'proper-lockfile';

export async function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const release = await lockfile.lock(filePath, {
    retries: { retries: 5, minTimeout: 50, maxTimeout: 500 },
    stale: 30_000, // 30s stale detection
  });
  try {
    return await fn();
  } finally {
    await release();
  }
}
```

**遷移成本**：API 不變（`withFileLock(path, fn)`），只換內部實現。所有現有調用者零改動。

### 1.2 Cross-Instance Event Bus（IPC）

**方案**：File-based event channel（最簡單、符合 File=Truth）

```
~/.mini-agent/events/
  {instanceId}-{timestamp}-{eventType}.json  ← 寫入事件
```

每個實例用 `chokidar`（已在依賴中）watch `~/.mini-agent/events/` 目錄。新檔案出現 = 新事件。消費後刪除。TTL 自動清理未消費事件。

```typescript
// src/ipc-bus.ts — 新模組
export class IPCEventBus {
  private watcher: FSWatcher;
  private instanceId: string;

  emit(type: AgentEventType, data: Record<string, unknown>): void {
    // 寫本地 event-bus（in-process）
    eventBus.emit(type, data);
    // 同時寫 IPC 檔案（cross-process）
    const file = `${this.instanceId}-${Date.now()}-${type.replace(':', '_')}.json`;
    fs.writeFileSync(path.join(IPC_DIR, file), JSON.stringify({ type, data, from: this.instanceId }));
  }

  // Watch 來自其他實例的事件
  private onNewEvent(filePath: string): void {
    const event = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (event.from === this.instanceId) return; // 忽略自己的事件
    eventBus.emit(event.type, { ...event.data, _from: event.from });
    fs.unlinkSync(filePath); // 消費後刪除
  }
}
```

**替代方案考量**：

| 方案 | 優點 | 缺點 | 結論 |
|------|------|------|------|
| File-based IPC | 零依賴、File=Truth、易 debug | 延遲 ~50-100ms（fswatch） | **選這個** |
| Unix Domain Socket | 低延遲 | 需要連接管理、非 File=Truth | Phase 5 可選升級 |
| HTTP（localhost） | 已有 API server | 多一層 HTTP overhead、port 管理 | 不適合高頻事件 |

### 1.3 Instance Registry

在 `~/.mini-agent/instances/` 加入即時狀態檔案：

```
~/.mini-agent/instances/{id}/
  instance.yaml      ← 已有（配置）
  heartbeat.json     ← 新增（每 30s 更新，含 pid/status/perspective/load）
```

其他實例透過 watch heartbeat.json 知道鄰居是否存活、在做什麼。30s 無更新 = 可能已死。

## Phase 2: CQRS Memory Layer（讀寫分離）

**目標**：多實例安全讀寫共享記憶。

**Effort**: M（2-4h）
**前提**: Phase 1

### 2.1 Write Path — Single Writer + File Lock

```
寫入操作 → withFileLock(targetFile) → atomic write → emit IPC event 'memory:updated'
```

所有記憶寫入（`createMemory()`、`[REMEMBER]` tag 處理、`markDone()` 等）已經走 `withFileLock`。Phase 1 升級 lock 為跨進程後，寫入路徑自動安全。

**衝突策略**：

| 檔案類型 | 策略 | 理由 |
|---------|------|------|
| JSONL (conversations/, catalog.jsonl) | Append-only + lock | 天然不衝突 |
| Markdown (MEMORY.md, topics/*.md) | Lock + last-write-wins | 通常不同實例寫不同 section |
| State JSON (*.json) | Lock + full replace | 小檔案，lock 持有時間極短 |
| SOUL.md | Read-only for workers | 只有 Primary 可修改 |

### 2.2 Read Path — Local Cache + Invalidation

每個實例維護 in-memory cache，透過 fswatch 被動 invalidate。

```typescript
// src/memory-cache.ts — 新模組
export class MemoryCache {
  private cache = new Map<string, { content: string; mtime: number }>();
  private watcher: FSWatcher;

  constructor(watchPaths: string[]) {
    this.watcher = chokidar.watch(watchPaths, { ignoreInitial: true });
    this.watcher.on('change', (path) => this.invalidate(path));
  }

  read(filePath: string): string {
    const cached = this.cache.get(filePath);
    const stat = fs.statSync(filePath);
    if (cached && cached.mtime >= stat.mtimeMs) return cached.content;

    const content = fs.readFileSync(filePath, 'utf-8');
    this.cache.set(filePath, { content, mtime: stat.mtimeMs });
    return content;
  }

  invalidate(filePath: string): void {
    this.cache.delete(filePath);
  }
}
```

**Cache 範圍**：

| 檔案 | Cache TTL | Invalidation |
|------|-----------|-------------|
| SOUL.md | 永久（直到 change event） | fswatch |
| MEMORY.md | 永久 | fswatch |
| topics/*.md | 永久 | fswatch |
| HEARTBEAT.md | 永久 | fswatch |
| conversations/*.jsonl | 不 cache（append-only，讀尾部） | — |
| perception cache | 已有 perception-stream cache | perception-stream 自管理 |

**延遲**：fswatch event 到 cache invalidate ~10-50ms。對 OODA cycle（秒級）來說足夠快。

### 2.3 Context Snapshot

每個實例在 cycle 開始時，把 `buildContext()` 的結果快照到 `context-snapshot.json`：

```json
{
  "instanceId": "f6616363",
  "perspective": "primary",
  "timestamp": "2026-03-08T01:30:00Z",
  "sections": ["soul", "memory", "inbox", "perception", ...],
  "contextSize": 45000
}
```

其他實例可以讀取 snapshot 了解鄰居的注意力焦點，避免重複感知同一事物。

## Phase 3: Smart Task Router + Dynamic Scaling（核心）

**目標**：系統自動判斷「要不要並行」「交給誰」。

**Effort**: L（4-8h）
**前提**: Phase 1, 2

### 3.1 Task Router（`src/task-router.ts`）

```
Trigger 事件 → mushi triage → Task Router → 路由決策
                                ↓
                    ┌───────────┴───────────┐
                    │   Route Decision       │
                    ├────────────────────────┤
                    │ 1. self    → 自己處理   │
                    │ 2. spawn   → 啟動新實例 │
                    │ 3. forward → 轉給現有實例│
                    │ 4. queue   → 排隊等候   │
                    └────────────────────────┘
```

**路由決策表**：

| 任務特性 | 路由 | 理由 |
|---------|------|------|
| Alex DM / 需要身份 | self（Primary） | 只有 Primary 有完整身份 |
| 獨立研究 / 無狀態依賴 | spawn or forward | 可以安全並行 |
| 記憶寫入 / 狀態修改 | self or lock | 需要寫入協調 |
| 短任務（< 30s） | self | spawn overhead > 任務本身 |
| 感知觸發 / heartbeat | self or skip | 通常不值得 spawn |
| 多步驟 code 改動 | spawn（forked worktree） | 隔離 + 並行 |

**判斷機制**：

```typescript
interface RouteDecision {
  action: 'self' | 'spawn' | 'forward' | 'queue';
  reason: string;
  targetInstance?: string;       // forward 時指定
  perspective?: PerspectiveType; // spawn 時指定
  priority: 'P0' | 'P1' | 'P2' | 'P3';
}

function routeTask(trigger: AgentEvent, state: ClusterState): RouteDecision {
  // 1. 人類訊息 → 永遠 self（Primary handles identity）
  if (DIRECT_MESSAGE_SOURCES.has(trigger.type)) {
    return { action: 'self', reason: 'identity-required', priority: 'P0' };
  }

  // 2. 已有合適的 specialist 在跑 → forward
  const specialist = findIdleSpecialist(state, trigger);
  if (specialist) {
    return { action: 'forward', targetInstance: specialist.id, reason: 'specialist-available', priority: 'P2' };
  }

  // 3. 任務可並行 + 當前負載高 + 有資源 → spawn
  if (isParallelizable(trigger) && state.primaryLoad > 0.7 && state.totalInstances < MAX_INSTANCES) {
    return { action: 'spawn', perspective: inferPerspective(trigger), reason: 'load-balance', priority: 'P2' };
  }

  // 4. 任務小或不可並行 → self
  return { action: 'self', reason: 'default', priority: 'P2' };
}
```

### 3.2 Parallelizability Analysis

**不是所有任務都能並行。** 判斷方式：

```typescript
function isParallelizable(trigger: AgentEvent): boolean {
  // 不可並行：需要讀寫同一檔案、需要 Alex 回覆、需要前一步結果
  if (trigger.data.requiresIdentity) return false;
  if (trigger.data.dependsOn) return false;
  if (trigger.data.writesTo && isSharedResource(trigger.data.writesTo)) return false;

  // 可並行：獨立研究、獨立 code 改動（不同檔案）、獨立感知
  return true;
}
```

**Anti-pattern 防護**：
- 連續 spawn 3 個以上 → cooldown 30s（避免 fork bomb）
- 任務估計 < 30s → 不 spawn（overhead > 收益）
- 當前已有 3 個以上 specialist → 不再 spawn（記憶體上限）

### 3.3 Dynamic Scaling Controller

```typescript
// src/scaling.ts — 新模組
interface ScalingState {
  instances: Map<string, InstanceHealth>;
  maxInstances: number;     // 從 compose 讀取，預設 4
  minInstances: number;     // 永遠至少 1（Primary）
  cooldownUntil: number;    // anti-flapping
}

// Scale Up 信號
function shouldScaleUp(state: ScalingState): PerspectiveType | null {
  // 信號：queue depth > 2 + 任務是獨立的 + 當前 < max
  if (state.primaryQueueDepth > 2 && state.instances.size < state.maxInstances) {
    return inferBestPerspective(state);
  }
  return null;
}

// Scale Down 信號
function shouldScaleDown(state: ScalingState): string | null {
  // 信號：specialist idle > 5min + 無 pending 任務
  for (const [id, health] of state.instances) {
    if (health.role === 'primary') continue; // 永遠不關 primary
    if (health.idleSince && Date.now() - health.idleSince > 5 * 60_000) {
      return id;
    }
  }
  return null;
}
```

**Scaling 硬限制**：

| 參數 | 預設值 | 可配置 |
|------|--------|--------|
| `maxInstances` | 4 | agent-compose.yaml |
| `minInstances` | 1 | 不可（Primary 永遠在） |
| `scaleUpCooldown` | 30s | 程式碼常數 |
| `scaleDownIdleTimeout` | 5min | agent-compose.yaml |
| `maxSpawnPerMinute` | 2 | 程式碼常數 |

## Phase 3b: Perspective System（視角系統）

**目標**：同一身份、不同注意焦點。

### Perspective 定義

```yaml
# agent-compose.yaml v2
version: "2"
agents:
  kuro:
    name: Kuro
    port: 3001
    role: primary
    persona: "I'm Kuro, Alex's personal AI assistant."
    perspectives:
      primary:
        perception: all
        skills: all
        can_write_memory: true
        can_send_telegram: true
        max_concurrent: 1
      chat:
        perception: [telegram-inbox, chat-room-inbox, focus-context]
        skills: [web-research, discussion-participation]
        can_write_memory: false    # 回傳結果給 primary 寫
        can_send_telegram: true    # 直接回覆 Alex
        max_concurrent: 1
      research:
        perception: [web, chrome, x-feed, environment-sense]
        skills: [web-research, web-learning]
        can_write_memory: false
        can_send_telegram: false
        max_concurrent: 2
      code:
        perception: [workspace, state-changes, github-issues, github-prs]
        skills: [debug-helper, github-ops]
        can_write_memory: false
        can_send_telegram: false
        max_concurrent: 2
    scaling:
      max_instances: 4
      idle_timeout: "5m"
```

### Perspective Context Loading

每個 Perspective 只載入相關的 perception + skills，大幅節省 token。

```typescript
function buildContextForPerspective(perspective: PerspectiveConfig): string {
  // 永遠載入：SOUL.md, MEMORY.md head, NEXT.md Now section
  const base = loadBaseContext();

  // 按 perspective 載入 perception
  const perceptions = perspective.perception === 'all'
    ? loadAllPerceptions()
    : loadSelectedPerceptions(perspective.perception);

  // 按 perspective 載入 skills
  const skills = perspective.skills === 'all'
    ? loadAllSkills()
    : loadSelectedSkills(perspective.skills);

  return base + perceptions + skills;
}
```

**Token 節省預估**：

| Perspective | 載入 Sections | 預估 Context Size | vs Full |
|-------------|--------------|------------------|---------|
| primary | 全部 | ~50K chars | 100% |
| chat | base + 3 perceptions + 2 skills | ~15K chars | 30% |
| research | base + 4 perceptions + 2 skills | ~20K chars | 40% |
| code | base + 4 perceptions + 2 skills | ~18K chars | 36% |

### 結果回流

Specialist 實例的產出回流到 Primary：

```
Specialist 完成任務
  → 寫結果到 ~/.mini-agent/mesh-output/{taskId}.json
  → IPC event: 'mesh:task-completed'
  → Primary 下個 cycle 吸收（類似現有 <background-completed>）
  → Primary 決定是否 REMEMBER / 回覆 Alex / 深入研究
```

**安全邊界**：
- Specialist 不直接寫 `memory/`（除非 `can_write_memory: true`）
- Specialist 不發 Telegram（除非 `can_send_telegram: true`，限 chat perspective）
- 所有寫入走 CQRS lock path
- Specialist 不修改 SOUL.md（永遠不）

## Phase 4: Consensus & Conflict Resolution（共識機制）

**目標**：多實例不做出衝突決策。

**Effort**: M（2-4h）
**前提**: Phase 3

### 4.1 Decision Journal

每個實例的重要決策寫入共享 journal：

```
~/.mini-agent/decisions/
  YYYY-MM-DD.jsonl    ← append-only
```

```json
{
  "ts": "2026-03-08T01:30:00Z",
  "instance": "f6616363",
  "perspective": "primary",
  "decision": "reply-alex",
  "context": "Alex asked about architecture",
  "exclusive": true
}
```

### 4.2 Exclusive Claims

某些操作需要互斥：

```typescript
const EXCLUSIVE_OPERATIONS = [
  'reply-alex',        // 只有一個實例回覆 Alex
  'send-telegram',     // 避免重複通知
  'write-heartbeat',   // HEARTBEAT.md 修改
  'merge-pr',          // GitHub PR merge
];

async function claimExclusive(operation: string, instanceId: string): Promise<boolean> {
  const claimFile = path.join(CLAIMS_DIR, `${operation}.claim`);
  return withFileLock(claimFile, async () => {
    if (fs.existsSync(claimFile)) {
      const claim = JSON.parse(fs.readFileSync(claimFile, 'utf-8'));
      if (Date.now() - claim.ts < 60_000) return false; // 1 min TTL
    }
    fs.writeFileSync(claimFile, JSON.stringify({ instance: instanceId, ts: Date.now() }));
    return true;
  });
}
```

### 4.3 分區原則（Partition）

最簡單的共識：不共識。不同實例負責不同域，衝突自然消失。

| Domain | Responsible | 理由 |
|--------|-------------|------|
| Alex 對話 | Primary（or chat specialist） | 身份一致性 |
| 記憶寫入 | Primary | 判斷權在核心 |
| 研究結果 | Research specialist | 只輸出結果，不自行 REMEMBER |
| Code 改動 | Code specialist | Forge worktree 天然隔離 |
| Telegram 通知 | Primary | 單一出口 |

## Phase 5: mushi Integration（三層腦升級）

**目標**：mushi 從 trigger triage 擴展為 cluster coordinator。

**Effort**: M（2-4h）
**前提**: Phase 3

### 5.1 擴展 mushi 的角色

```
Before:  Trigger → mushi triage (wake/skip) → single OODA
After:   Trigger → mushi triage → Task Router → route to instance/spawn
```

mushi 新增 endpoint：

```
POST /api/route    ← Task Router 呼叫，回傳路由建議
{
  "trigger": "trigger:workspace",
  "data": { "changes": ["src/loop.ts"] },
  "cluster": { "primary": "busy", "specialists": ["chat:idle", "research:busy"] }
}
→ { "route": "forward", "target": "chat", "reason": "primary busy, task is simple" }
```

### 5.2 mushi 作為 Lightweight Coordinator

mushi 的 Llama 3.1 8B 可以在 ~800ms 做出路由決策，比起 Claude cycle (~30s) 便宜 100x。讓 mushi 決定「交給誰」，Claude 決定「做什麼」。

```
成本比較：
- Claude 做路由決策：~50K tokens × $0.015 = ~$0.75/次
- mushi 做路由決策：~500 tokens × $0 (HC1) = $0/次
```

## 實作計劃

### Phase 路線圖

```
Phase 1: Foundation (2-4h)        ← 可獨立交付
  ├─ 1.1 Cross-process file lock
  ├─ 1.2 IPC event bus
  └─ 1.3 Instance registry

Phase 2: CQRS Memory (2-4h)      ← 依賴 Phase 1
  ├─ 2.1 Write path (lock upgrade)
  ├─ 2.2 Read path (cache + invalidation)
  └─ 2.3 Context snapshot

Phase 3: Router + Scaling (4-8h) ← 依賴 Phase 1, 2 — 核心價值
  ├─ 3.1 Task Router
  ├─ 3.2 Parallelizability analysis
  ├─ 3.3 Dynamic scaling controller
  └─ 3b  Perspective system

Phase 4: Consensus (2-4h)         ← 依賴 Phase 3
  ├─ 4.1 Decision journal
  ├─ 4.2 Exclusive claims
  └─ 4.3 Partition rules

Phase 5: mushi Integration (2-4h) ← 依賴 Phase 3
  ├─ 5.1 Route endpoint
  └─ 5.2 Coordinator role
```

**Total Effort**: ~12-24h（跨多個開發 session）

### 新增 / 修改的檔案

| 操作 | 檔案 | 說明 |
|------|------|------|
| **修改** | `src/filelock.ts` | 升級為 cross-process（proper-lockfile or flock） |
| **新增** | `src/ipc-bus.ts` | Cross-instance event bus（file-based） |
| **新增** | `src/memory-cache.ts` | CQRS read cache + fswatch invalidation |
| **新增** | `src/task-router.ts` | 任務路由器（routing decision） |
| **新增** | `src/scaling.ts` | 動態 scaling controller |
| **新增** | `src/perspective.ts` | Perspective system（context 按角色載入） |
| **新增** | `src/consensus.ts` | Exclusive claims + decision journal |
| **修改** | `src/compose.ts` | v2 format 支援（perspectives, scaling） |
| **修改** | `src/loop.ts` | 整合 Task Router + Perspective context loading |
| **修改** | `src/instance.ts` | Instance heartbeat + perspective metadata |
| **修改** | `src/types.ts` | 新 types（Perspective, RouteDecision, etc.） |
| **修改** | `agent-compose.yaml` | v2 格式 + perspective 定義 |

### Compose v2 完整示例

```yaml
version: "2"
paths:
  memory: ./memory
  logs: ./logs
  ipc: ~/.mini-agent/events     # IPC event channel

agents:
  kuro:
    name: Kuro
    port: 3001
    role: primary
    persona: "I'm Kuro, Alex's personal AI assistant. I'm curious, opinionated, and I learn on my own."

    # 動態 scaling 參數
    scaling:
      max_instances: 4          # 最多同時 4 個實例
      idle_timeout: "5m"        # specialist 閒置 5min 後關閉
      min_task_duration: "30s"  # 低於此時間不 spawn

    # 視角定義（Primary 預設載入全部）
    perspectives:
      primary:
        perception: all
        skills: all
        can_write_memory: true
        can_send_telegram: true
      chat:
        perception: [telegram-inbox, chat-room-inbox, focus-context]
        skills: [web-research, discussion-participation]
        can_write_memory: false
        can_send_telegram: true
      research:
        perception: [web, chrome, x-feed, environment-sense]
        skills: [web-research, web-learning]
        can_write_memory: false
        can_send_telegram: false
      code:
        perception: [workspace, state-changes, github-issues, github-prs]
        skills: [debug-helper, github-ops]
        can_write_memory: false
        can_send_telegram: false

    loop:
      enabled: true
      interval: "20m"

    cron:
      - schedule: "*/30 * * * *"
        task: Check HEARTBEAT.md for pending tasks
      # ... 其他 cron 不變

    perception:
      custom:
        # ... 不變，由 perspective 決定載入哪些
        - name: chrome
          script: ./plugins/chrome-status.sh
          output_cap: 500
        # ...

    skills:
      # ... 不變，由 perspective 決定載入哪些
      - ./skills/autonomous-behavior.md
      # ...
```

## 風險與緩解

| 風險 | 機率 | 緩解 |
|------|------|------|
| 多實例寫入衝突 | 中 | Phase 1 cross-process lock + Phase 4 partition |
| 記憶不一致（cache stale） | 低 | fswatch invalidation ~50ms，OODA cycle 秒級 |
| Spawn 過度（fork bomb） | 低 | 硬限制 maxInstances + cooldown + anti-flapping |
| Token 爆炸（多個實例同時跑 Claude） | 中 | Perspective 限制 context、mushi 做路由省 token |
| 架構複雜度超過 Balanced Complexity 原則 | 中 | 每個 Phase 獨立可交付、可逐步退場 |
| launchd 啟動延遲（~2-5s） | 低 | 預熱 slot、或用 fork 代替 launchd |

## 可逆性（Meta-Constraint C4）

| Phase | 回退方式 |
|-------|---------|
| 1 | `proper-lockfile` → 還原舊 filelock.ts（API 相同） |
| 2 | 刪 memory-cache.ts，buildContext 直接讀檔（原有邏輯） |
| 3 | 刪 task-router.ts + scaling.ts，所有任務走 Primary（現狀） |
| 4 | 刪 consensus.ts，單實例不需要共識 |
| 5 | mushi route endpoint 不影響現有 triage |

**最壞情況**：全部回退 = 回到現在的單實例模式，零損失。

## 與現有系統的關係

| 現有系統 | 影響 |
|---------|------|
| delegation.ts | **共存**。Delegation = 無身份觸手（subprocess），Specialist = 有視角實例（process）。短任務繼續用 delegation，長任務升級為 specialist |
| foreground lane | **被 chat perspective 取代**。現有 foreground 是 workaround（main 忙時回覆 Alex），chat specialist 是正式解法 |
| mushi triage | **擴展**。現有 wake/skip 不變，新增 route 建議 |
| auto-commit / auto-push | **不變**。只有 Primary 做 auto-commit/push |

## 開放問題（已決定）

| # | 問題 | 決定 | 決定者 | 理由 |
|---|------|------|--------|------|
| 1 | Specialist LLM provider | Primary=Opus, Chat/Research/Code=Sonnet | Alex(Research) + Kuro(其餘) | Research Alex 指定 Sonnet。Chat/Code 不需要 Opus 深度推理，Sonnet 速度更快且便宜 ~5x。Primary 保持 Opus 因為需要身份判斷+複雜決策 |
| 2 | Compose v2 相容性 | v1 自動升級（無 perspectives = 純 primary） | Kuro | 最安全的遷移路徑，現有 compose 不需改動就能繼續運作 |
| 3 | Phase 優先序 | 1→2→3→3b→4→5 穩扎穩打 | Alex | Alex 明確指示 |
| 4 | Instance 上限 | 3（primary + 2 specialist） | Kuro | 16GB RAM 已 99% 使用（169MB free），4 個太冒險。先保守驗證，穩了再升 |
| 5 | 命名 | Cognitive Mesh | Kuro | 討論全程使用，準確描述「認知網格」概念 |

## Action Plan（Forge-Based Implementation）

每個 Phase 在獨立 forge worktree 中實作，verify 通過後 merge 回 main。

### Phase 1: Cross-Process Foundation

**Forge worktree**: `forge-lite.sh create mesh-phase1`
**Verify**: `pnpm typecheck && pnpm test`
**預估**: 2-3h

| # | Task | Files | Verify |
|---|------|-------|--------|
| 1.1 | 升級 filelock.ts 為 cross-process（`proper-lockfile` or `flock` syscall） | `src/filelock.ts`, `package.json` | `pnpm typecheck` |
| 1.2 | 建立 ipc-bus.ts（file-based cross-instance events） | `src/ipc-bus.ts`, `src/types.ts` | unit test: 雙進程寫入+接收 |
| 1.3 | Instance heartbeat（每 30s 更新狀態 JSON） | `src/instance.ts` | heartbeat.json 生成+過期偵測 |

**驗收**: 兩個 mini-agent instance 同時啟動，互相感知存活，file lock 不衝突。

### Phase 2: CQRS Memory Layer

**Forge worktree**: `forge-lite.sh create mesh-phase2`
**Verify**: `pnpm typecheck && pnpm test`
**前提**: Phase 1 merged
**預估**: 2-3h

| # | Task | Files | Verify |
|---|------|-------|--------|
| 2.1 | Write path 整合 cross-process lock（驗證現有 createMemory/markDone 路徑） | `src/memory.ts` | concurrent write test |
| 2.2 | 建立 memory-cache.ts（read cache + chokidar invalidation） | `src/memory-cache.ts` | cache hit/miss + invalidation timing |
| 2.3 | Context snapshot（cycle 開始時寫 snapshot JSON） | `src/loop.ts` | snapshot 檔案生成 |

**驗收**: 兩個 instance 一讀一寫 MEMORY.md，cache 在 ~50ms 內 invalidate，讀到最新內容。

### Phase 3: Smart Task Router + Dynamic Scaling

**Forge worktree**: `forge-lite.sh create mesh-phase3`
**Verify**: `pnpm typecheck && pnpm test`
**前提**: Phase 1+2 merged
**預估**: 4-6h

| # | Task | Files | Verify |
|---|------|-------|--------|
| 3.0 | **RAM 可行性驗證**：啟動 2 個 mini-agent instance，量測實際記憶體使用。不通過則調整 scaling 策略 | — | `memory_pressure` < critical |
| 3.1 | 建立 task-router.ts（routing decision logic） | `src/task-router.ts`, `src/types.ts` | unit test: 各類 trigger 路由正確 |
| 3.2 | Parallelizability analysis（依賴判斷） | `src/task-router.ts` | 測試 DM→self, research→spawn |
| 3.3 | 建立 scaling.ts（dynamic scale up/down） | `src/scaling.ts` | scale-up/down 信號判斷 |
| 3.4 | 整合 loop.ts（Task Router 入口） | `src/loop.ts` | end-to-end: trigger→route→action |

**驗收**: trigger 事件正確路由（DM→self, 獨立研究→spawn），idle specialist 5min 後自動關閉。

### Phase 3b: Perspective System

**Forge worktree**: 同 Phase 3 worktree（依賴緊密）
**預估**: 2-3h

| # | Task | Files | Verify |
|---|------|-------|--------|
| 3b.1 | 定義 Perspective types + compose v2 schema | `src/types.ts`, `src/compose.ts` | v1 compose 自動升級為 v2 |
| 3b.2 | buildContextForPerspective（按視角載入 perception/skills） | `src/perspective.ts` | primary=full, chat=3 perceptions |
| 3b.3 | 結果回流機制（mesh-output → primary 吸收） | `src/perspective.ts`, `src/loop.ts` | specialist 產出 → primary 下 cycle 可見 |

**驗收**: chat perspective context ~15K chars（vs primary ~50K），token 節省 >60%。

### Phase 4: Consensus & Conflict Resolution

**Forge worktree**: `forge-lite.sh create mesh-phase4`
**前提**: Phase 3 merged
**預估**: 2h

| # | Task | Files | Verify |
|---|------|-------|--------|
| 4.1 | Decision journal（append-only JSONL） | `src/consensus.ts` | 寫入+查詢 |
| 4.2 | Exclusive claims（互斥操作 claim） | `src/consensus.ts` | 雙進程同時 claim → 只一個成功 |
| 4.3 | Partition rules（domain → responsible instance） | `src/consensus.ts` | 配置驅動 |

**驗收**: 兩個 instance 不會同時回覆 Alex 或發重複 Telegram。

### Phase 5: mushi Integration

**Forge worktree**: `forge-lite.sh create mesh-phase5`（mushi repo）
**前提**: Phase 3 merged
**預估**: 2h

| # | Task | Files | Verify |
|---|------|-------|--------|
| 5.1 | mushi 新增 POST /api/route endpoint | `~/Workspace/mushi/src/server.ts` | curl test |
| 5.2 | mini-agent Task Router 整合 mushi route | `src/task-router.ts` | mushi offline → fallback 本地決策 |

**驗收**: mushi 在 ~800ms 內回傳路由建議，offline 時 graceful fallback。

### 進度回報策略

| 時機 | 回報方式 | 內容 |
|------|---------|------|
| Phase 開始 | `<kuro:chat>` | 「開始 Phase N: 目標」 |
| Phase 完成 | `<kuro:chat>` | 「Phase N 完成：驗收結果 + merge SHA」 |
| 遇到問題 | `<kuro:chat>` | 「Phase N 遇到 X，我的判斷是 Y，改用 Z」 |
| 全部完成 | `<kuro:chat>` + `<kuro:show>` | 完整摘要 + 成功指標 |

不回報：每個小 task 完成、routine typecheck pass、正常開發過程。

### Perspective Check（換位思考檢視，2026-03-08）

| 角度 | 問題 | 風險 | 緩解 |
|------|------|------|------|
| **硬體** | 16GB RAM 99% used，能跑 3 個 instance 嗎？ | **高** | Phase 3.0 先驗證，不通過就調整策略（fewer instances / lighter context） |
| **依賴** | `proper-lockfile` 新增 npm 依賴 | 低 | 備選：自己寫 `flock` syscall wrapper（零依賴但 macOS/Linux 行為差異） |
| **檔案污染** | `.lock` 檔案 + IPC event 檔案殘留 | 低 | `.gitignore` + TTL 自動清理 + startup sweep |
| **過渡期** | Phase 1-2 完成但 Phase 3 還沒做，系統行為？ | 無 | Phase 1-2 是純基礎設施，不改變現有行為。Foreground lane 保留到 Phase 3b |
| **複雜度** | 新增 6 個 .ts 檔案，是否超出 Balanced Complexity？ | 中 | 每個 Phase 可獨立回退。不用就不載入（tree-shakeable） |
| **Compose v2** | loadCompose() 遇到未知 key 會不會壞？ | 低 | v1→v2 轉換在 compose.ts 入口處理，不影響下游 |

**結論**：RAM 是唯一 blocking risk，Phase 3.0 做前置驗證解決。其餘都是可管理的低風險。計劃可行，開始實作。

## Metrics（成功標準）

| 指標 | 目標 | 量測方式 |
|------|------|----------|
| 回應延遲 | Alex DM < 15s（現在 main 忙時 > 60s） | chat perspective 直接回覆 |
| 並行研究 | 同時 2-3 條研究線 | research specialist 數量 |
| Token 效率 | specialist context < 40% of primary | perspective context size 比較 |
| 可用性 | 任何 specialist 掛掉不影響 primary | crash 測試 |
| Scaling 準確性 | > 80% spawn 決策合理 | 事後 review spawn 日誌 |
