# Reactive Cycle Architecture

**Date**: 2026-03-17
**Status**: draft
**Effort**: Large (L3)
**Origin**: Chat Room #192 — Alex 提出 cycle 職責瘦身 + 整合前幾天討論的所有改進方向

## Problem

Cycle 承擔太多職責：偵測、思考、行動全塞在一個 OODA 迴圈裡。結果是：
1. **偵測延遲** — API handler 寫完檔案就 return，不通知 loop，要等下一個 cycle 的 perception 才偵測到
2. **行動阻塞思考** — cycle 花時間執行行動（delegate、記憶、task 管理），壓縮了思考時間
3. **訊息脈絡不可見** — chat-ui 是純時間序列，混雜主題的訊息流無法分離或聚合
4. **無前處理層** — 每條訊息都丟給 LLM cycle 處理，浪費 token 在分類和 task 拆解

## Solution: 四層改進

```
Layer 0: Event Emission     ─ API handler → eventBus（即時偵測）
Layer 1: Preprocessor       ─ 訊息分類 + 自動 task 拆解（零 LLM）
Layer 2: Chat-UI Context    ─ topic badge + 主題篩選 + thread line
Layer 3: Cycle Slimming     ─ 行動拆到 task-queue + delegate 執行
```

---

## Layer 0: API Handler Event Emission

**問題**：`/api/room` POST handler 寫完 JSONL 後，只有從非 kuro 的訊息才 emit `trigger:room`。但即使有 emit，loop 的 `handleUnifiedEvent` 也只在 idle 時用 `clearTimeout` 打斷——cycling 中的訊息要等 cycle 結束。

**現狀程式碼分析**：
- `writeRoomMessage()` 在 `observability.ts` 已經 emit `action:room`（給 SSE stream 用）
- `/api/room` handler 在 `api.ts` 中，只對 from !== 'kuro' 的訊息 emit `trigger:room`
- Telegram webhook 在 `telegram.ts` 已有 emit `trigger:telegram`
- `/api/chat` handler 已有 emit `trigger:chat`

**修法**：不需要改 — `trigger:room` 已經在 emit。真正的問題在 **idle sleep 期間的偵測延遲**（5-10 分鐘 interval）。但 `handleUnifiedEvent` 已經有 `clearTimeout` + `triggerCycle` 邏輯。

**實際瓶頸**：`api.ts` 中的 `emitRoomTrigger()` 用了 `setTimeout(300)`（300ms 延遲），加上 batch buffer（3s window）。這設計合理——防止連續訊息觸發多個 cycle。

**結論**：Layer 0 的改動很小：
1. 確認所有 API 端點（`/api/room`, `/api/chat`, telegram webhook）都有 emit trigger event — **已滿足**
2. 唯一遺漏：`/api/ask` 端點可能沒有 emit — 需確認
3. 考慮把 `emitRoomTrigger` 的 300ms 延遲降為 100ms，提升反應速度

**改動量**：~5 行

---

## Layer 1: Preprocessor（訊息分類 + 自動 Task 拆解）

### 定位

Preprocessor 是 event emission 和 OODA cycle 之間的**輕量處理層**。純規則驅動，零 LLM 呼叫。

### 觸發時機

在 `/api/room` handler 中，`writeRoomMessage()` 之後、`emitRoomTrigger()` 之前。

### 輸出：Metadata Enrichment

每則訊息在寫入 JSONL 時，多加 `context` 欄位：

```jsonl
{
  "id": "2026-03-17-168",
  "from": "alex",
  "text": "我看#discussion有一些資訊及資源 你看一下競賽有沒有可以用的或參考的部分",
  "ts": "2026-03-17T14:38:00.000Z",
  "mentions": ["kuro"],
  "context": {
    "topic": "teaching-monster",
    "intent": "action",
    "tasks": ["scan-discussion-channel", "add-useful-items-to-todo"],
    "cluster": "cl-2026-03-17-03"
  }
}
```

### 分類規則

#### Topic Detection（主題偵測）
```typescript
// 關鍵字 → topic 映射表（可擴展）
const TOPIC_RULES: Array<{ keywords: string[]; topic: string }> = [
  { keywords: ['競賽', 'teaching monster', 'warm-up', '熱身', '提交', 'pipeline'], topic: 'teaching-monster' },
  { keywords: ['myelin', 'crystallize', 'distill', 'bypass'], topic: 'myelin' },
  { keywords: ['mushi', 'route', 'triage'], topic: 'mushi' },
  { keywords: ['deploy', '部署', 'CI', 'CD', 'launchctl'], topic: 'ops' },
  { keywords: ['memory', '記憶', 'MEMORY.md', 'topic'], topic: 'memory' },
  { keywords: ['asurada', 'framework', 'npm'], topic: 'asurada' },
  // ... 可從 topics/ 目錄自動生成
];

function detectTopic(text: string): string | undefined {
  const lower = text.toLowerCase();
  for (const rule of TOPIC_RULES) {
    if (rule.keywords.some(kw => lower.includes(kw.toLowerCase()))) {
      return rule.topic;
    }
  }
  return undefined;
}
```

#### Intent Classification（意圖分類）
```typescript
type Intent = 'action' | 'question' | 'info' | 'discussion' | 'approval';

function classifyIntent(text: string, from: string): Intent {
  // Action: 指令動詞開頭（看一下、做、改、加、刪、部署、提交...）
  if (/^(看|做|改|加|刪|部署|提交|跑|檢查|掃|研究|升級|實作)/.test(text)) return 'action';
  // Action: Alex 的 room 訊息帶有 task 語義
  if (from === 'alex' && /(?:你|幫我|去|要|先|趕快|立刻|馬上)/.test(text)) return 'action';
  // Question: 問號結尾或疑問詞
  if (/[？?]$/.test(text.trim()) || /^(怎麼|為什麼|能不能|有沒有|是不是)/.test(text)) return 'question';
  // Approval: 確認/核准語義
  if (/^(好|可以|同意|approved|LGTM|核准|通過)/.test(text)) return 'approval';
  // Info: 分享連結或資訊
  if (/https?:\/\//.test(text) || /^(這是|分享|FYI|看到)/.test(text)) return 'info';
  return 'discussion';
}
```

#### Auto Task Extraction（自動 Task 拆解）
```typescript
interface ExtractedTask {
  title: string;
  origin: string;  // 來源訊息 ID
}

function extractTasks(text: string, intent: Intent, msgId: string): ExtractedTask[] {
  if (intent !== 'action') return [];

  const tasks: ExtractedTask[] = [];

  // 拆解多個動作（用「並」「然後」「還有」分隔）
  const segments = text.split(/[，。；\n]|(?:並|然後|還有|另外)/);
  for (const seg of segments) {
    const trimmed = seg.trim();
    if (trimmed.length > 5 && /[\u4e00-\u9fff]/.test(trimmed)) {
      tasks.push({ title: trimmed, origin: msgId });
    }
  }

  // 如果沒拆出來，整句作為一個 task
  if (tasks.length === 0 && intent === 'action') {
    tasks.push({ title: text.slice(0, 100), origin: msgId });
  }

  return tasks;
}
```

#### Cluster Detection（語義聚合）
```typescript
// 同一 topic + 5 分鐘時間窗口 = 同一 cluster
function assignCluster(topic: string | undefined, ts: Date): string {
  if (!topic) return `cl-${ts.toISOString().slice(0, 10)}-misc`;

  const key = topic;
  const last = activeClusterMap.get(key);
  if (last && ts.getTime() - last.ts < 5 * 60 * 1000) {
    return last.clusterId;
  }

  const clusterId = `cl-${ts.toISOString().slice(0, 10)}-${String(clusterCounter++).padStart(2, '0')}`;
  activeClusterMap.set(key, { clusterId, ts: ts.getTime() });
  return clusterId;
}
```

### 整合點

```typescript
// 在 api.ts 的 POST /api/room handler 中
const id = await writeRoomMessage(from, text, replyTo);

// NEW: Preprocessor enrichment
const context = preprocessMessage(text, from, id, new Date());
// context = { topic, intent, tasks, cluster }

// 回寫 metadata（append 到同一行 JSONL 或更新 in-memory cache）
enrichMessageMetadata(id, context);

// 如果 intent === 'action' && from === 'alex'，自動建 task
for (const task of context.tasks) {
  createTask(memDir, {
    type: 'task',
    title: task.title,
    status: 'pending',
    origin: `room:${id}`,
  });
}
```

### 新檔案

`src/preprocessor.ts` — 約 150-200 行

---

## Layer 2: Chat-UI 脈絡可視化

### 設計原則

**同主題聚合，不同主題分離。** Alex 的核心需求。

### 四個 UI 元件

#### 2a. Topic Badge（主題標籤）
- 每則訊息右上角顯示 topic badge（如 `[teaching-monster]`）
- 顏色按 topic 名稱 hash 生成（一致性）
- 無 topic 的訊息不顯示 badge

```css
.topic-badge {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 8px;
  opacity: 0.8;
  cursor: pointer;  /* 點擊 = 篩選此 topic */
}
```

#### 2b. Topic Filter（主題篩選）
- 訊息列表上方新增篩選列
- 顯示當天出現的所有 topic（badge 形式）
- 點擊 topic = 只顯示該 topic 的訊息
- 「All」= 顯示全部（預設）
- 篩選時，非該 topic 的訊息 `display: none`

```html
<div id="topic-filter" class="topic-filter-bar">
  <span class="topic-chip active" data-topic="all">All</span>
  <!-- 動態生成 -->
</div>
```

#### 2c. Cluster Collapse（同主題收合）
- 同一個 `cluster` 的連續訊息可以收合
- 收合狀態顯示：「Alex 發了 3 則關於 teaching-monster」
- 點擊展開
- 依賴 Layer 1 Preprocessor 的 cluster 資料 → Phase 2 實作

#### 2d. Thread Line（回覆脈絡線）
- 有 `replyTo` 的訊息左側顯示 vertical line
- hover 時高亮同 thread 所有訊息
- 現有 `replyTo` 已有 inline quote，加 thread line 是視覺增強

```css
.msg[data-reply-to]::before {
  content: '';
  position: absolute;
  left: -8px;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--thread-color);
  border-radius: 1px;
}
```

### 資料來源

Phase 1（2a + 2d）：不依賴 Preprocessor，用簡單的 client-side 關鍵字匹配 + 現有 `replyTo`。
Phase 2（2b + 2c）：讀取 JSONL 中的 `context` 欄位（Layer 1 產出）。

### API 擴展

```typescript
// GET /api/room?date=YYYY-MM-DD 回傳的 messages 已包含 context 欄位
// 不需要額外 endpoint
```

### 改動範圍

`chat-room.html` — CSS + JS 渲染邏輯。約 100-150 行改動。

---

## Layer 3: Cycle 職責瘦身

### 核心理念

**Cycle 只做思考和決策，不做行動。**

```
Before:  Cycle = 偵測 + 思考 + 決策 + 行動（全部）
After:   Cycle = 思考 + 決策（輕量）
         行動 = task-queue + delegate 執行（可追蹤）
```

### 流程變化

```
Alex 說「加入 Slack」
    ↓
Layer 0: API emit trigger:room
    ↓
Layer 1: Preprocessor 分類
  → intent: action
  → topic: ops
  → tasks: [{ title: "加入 Slack", origin: "room:2026-03-17-195" }]
  → 自動建 task-queue entry（status: pending）
    ↓
Cycle 開始
  → 看到 task-queue 有 pending task
  → 決策：優先序、是否委派、怎麼做
  → 輸出：<kuro:delegate> 或 <kuro:task-queue op="update" status="in_progress">
  → **不在 cycle 內執行行動本身**
    ↓
Delegate 觸手執行
  → 完成後更新 task-queue（status: completed, verify: ...）
  → 結果進入下一 cycle 的 perception
```

### Cycle Prompt 變化

在 `prompt-builder.ts` 的 system prompt 中加入指引：

```markdown
## Cycle 職責

你的 cycle 只負責思考和決策：
1. 看 task-queue 中的 pending 項目
2. 評估優先序（P0 先做）
3. 決定每個 task 怎麼處理：
   - 小事（< 1 min）：直接用 <kuro:chat> 回覆
   - 可委派：用 <kuro:delegate> 分配給觸手
   - 需要你深度思考：留到下個 cycle
4. 用 <kuro:task-queue op="update"> 更新狀態

不要在 cycle 中做長時間操作。行動交給 delegate。
```

### Task 自動追蹤

Preprocessor（Layer 1）自動建立的 task 帶 `origin: "room:{msgId}"`，cycle 可以看到是從哪條訊息來的，做決策時有完整脈絡。

Delegate 完成後，`postProcess` 自動更新 task-queue：
```typescript
// 在 delegation.ts 的 completion handler 中
if (delegation.originTask) {
  updateTask(memDir, delegation.originTask, {
    status: delegation.success ? 'completed' : 'pending',
    verify: [{ name: 'delegate', status: delegation.success ? 'pass' : 'fail', detail: delegation.output.slice(0, 200) }],
  });
}
```

### 改動範圍

- `src/prompt-builder.ts` — 加入 cycle 職責指引（~20 行）
- `src/delegation.ts` — completion handler 更新 task-queue（~15 行）
- `src/api.ts` — Preprocessor 整合（~10 行）

---

## Implementation Plan

### Phase 1: Instant（可立即做，不依賴其他 Phase）

| # | Task | File | Est. |
|---|------|------|------|
| 1a | 確認所有 API 端點都 emit trigger | `src/api.ts` | 10 min |
| 1b | Topic badge（client-side keyword matching） | `chat-room.html` | 30 min |
| 1c | Thread line（replyTo visual enhancement） | `chat-room.html` | 20 min |
| 1d | Topic filter bar | `chat-room.html` | 30 min |

### Phase 2: Preprocessor（Layer 1 核心）

| # | Task | File | Est. |
|---|------|------|------|
| 2a | 建立 `src/preprocessor.ts` | new file | 45 min |
| 2b | 整合進 `/api/room` handler | `src/api.ts` | 15 min |
| 2c | JSONL 欄位擴展（context metadata） | `src/observability.ts` | 15 min |
| 2d | Chat-UI 讀取 context 欄位渲染 | `chat-room.html` | 20 min |

### Phase 3: Cycle Slimming（Layer 3）

| # | Task | File | Est. |
|---|------|------|------|
| 3a | Cycle prompt 加入職責指引 | `src/prompt-builder.ts` | 15 min |
| 3b | Delegate completion → task-queue update | `src/delegation.ts` | 20 min |
| 3c | Cluster collapse UI | `chat-room.html` | 30 min |

### 依賴關係

```
Phase 1 (1a, 1b, 1c, 1d) — 並行，無依賴
    ↓
Phase 2 (2a → 2b → 2c → 2d) — 序列
    ↓
Phase 3 (3a, 3b 並行 → 3c 最後)
```

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Preprocessor 分類錯誤 | 規則驅動，可逐步調整。錯了不影響功能，只影響 UI 展示 |
| JSONL 格式變更 | context 是新增欄位，不改現有欄位。向後相容 |
| Cycle prompt 改變行為 | 只是指引，不強制。Kuro 仍可在 cycle 中做小事 |
| Chat-UI 效能 | 純 client-side filter/collapse，DOM 操作，不影響載入速度 |

## Rollback

每個 Phase 獨立可回退：
- Phase 1：chat-room.html 是 self-contained，git revert 即可
- Phase 2：preprocessor.ts 是新檔案，刪除即可。api.ts 改動用 feature flag
- Phase 3：prompt 改動用 feature flag，delegation.ts 改動是 additive
