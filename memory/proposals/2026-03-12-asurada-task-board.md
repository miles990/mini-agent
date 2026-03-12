# Asurada Task Board — 人機協作任務面板

Status: approved
Effort: Medium (3 phases)
Priority: P1 — Asurada 差異化功能
GitHub-Issue: (pending)

## 動機

大部分 agent 框架的任務是「agent 的待辦」。Asurada 不同 — **人類和 agent 共享同一份任務清單，雙方都能建立、認領、完成任務**。這是 co-evolution 定位的自然延伸，市場上幾乎沒有。

Alex 原話：「asurada 是不適合把 todo list board 加進內建的功能？變成可以跟人類或多人協作的 也方便追蹤任務的工具？」

## 設計原則

1. **View layer, not database** — 底層是 JSONL 檔案（File=Truth），board 只是 UI 渲染
2. **雙向操作** — 人類在 board 拖卡片 = API call = 改檔案；agent 用 tag/API 改檔案 = board SSE 更新
3. **最小欄位** — 不做甘特圖、不做時間追蹤、不做子任務巢狀
4. **Chat Room 整合** — 任務討論在 messages 裡用 replyTo 串，不另建評論系統

## 資料模型

```typescript
// src/api/task-types.ts
interface BoardTask {
  id: string;              // "task-001"
  title: string;
  status: 'todo' | 'doing' | 'done' | 'abandoned';
  assignee?: string;       // "alex" | "kuro" | agent name | null
  createdBy: string;       // who created it
  createdAt: string;       // ISO timestamp
  updatedAt: string;
  labels?: string[];       // optional tags: "bug", "feature", etc.
  verify?: string;         // optional shell command to verify completion
  messageRef?: string;     // link to a message ID for context
}
```

**儲存**：`{dataDir}/tasks.jsonl` — append-only JSONL，每行一個事件（created/updated/moved/completed）。讀取時 replay 到最新狀態。

```typescript
interface TaskEvent {
  taskId: string;
  action: 'create' | 'update' | 'move' | 'assign' | 'complete' | 'abandon' | 'delete';
  data: Partial<BoardTask>;
  by: string;              // who performed the action
  at: string;              // ISO timestamp
}
```

為什麼 event-sourced：
- File=Truth — append-only 不會丟資料
- 歷史可追溯 — 誰在什麼時候改了什麼
- Git 友好 — JSONL diff 清楚
- 簡單 — 不需要遷移、不需要 schema 升級

## 架構

```
board.html ←→ REST API ←→ tasks.jsonl
    ↑              ↑
    └── SSE ───────┘
                   ↑
            Agent loop (tag parsing / API)
```

### API Endpoints（加到 server.ts）

| Method | Path | 功能 |
|--------|------|------|
| GET | `/api/tasks` | 列出所有 active tasks（replay JSONL） |
| POST | `/api/tasks` | 建立新 task |
| PATCH | `/api/tasks/:id` | 更新 task（status/assignee/labels） |
| DELETE | `/api/tasks/:id` | 軟刪除（append delete event） |
| GET | `/board` | Serve board.html |

### Agent 端整合

Agent 透過兩種方式操作 tasks：
1. **Tag parsing**（在 dispatcher 中）：`<agent:task-create>`, `<agent:task-complete id="...">` 等
2. **API call**（在 loop 中）：直接 POST/PATCH，跟人類用同一套

### SSE 即時更新

Task 事件 emit 到 EventBus → SSE `/api/events` 已有基礎設施，新增 `task:created`, `task:updated`, `task:completed` 事件類型。board.html 監聽 SSE 即時更新。

## UI — board.html

Kanban 風格，三欄：Todo → Doing → Done。

核心互動：
- 拖放移動 status
- 點擊建立新 task
- 點擊 task 展開詳情（assignee、labels、linked messages）
- Assignee 篩選（All / Human / Agent）

技術：純 HTML + vanilla JS（跟 dashboard.html、chat.html 同路線），不引入框架。

## Phases

### Phase 1: Backend + API（~2h）
- [ ] `src/api/task-types.ts` — BoardTask + TaskEvent types
- [ ] `src/api/task-store.ts` — JSONL read/write + event replay + in-memory cache
- [ ] `src/api/server.ts` — 新增 5 個 endpoints
- [ ] SSE task events（emit to EventBus）
- [ ] 測試：task CRUD + event replay

### Phase 2: Board UI（~2h）
- [ ] `src/ui/board.html` — Kanban board
- [ ] 拖放操作 → PATCH API
- [ ] SSE 即時更新
- [ ] Assignee 篩選
- [ ] Server route `/board`

### Phase 3: Agent 整合（~1h）
- [ ] Tag parsing：`<agent:task-create>`, `<agent:task-complete>`, `<agent:task-assign>`
- [ ] Perception plugin：task board summary（pending count, overdue, etc.）
- [ ] Context injection：`<tasks>` section in buildContext

## 不做的事

- 子任務巢狀（YAGNI，flat list 夠用）
- 時間估算 / 甘特圖（違反 CLAUDE.md「不給時間估計」原則）
- 獨立評論系統（Chat Room 已有 threading）
- 複雜權限（personal agent 不需要 ACL）
- 資料庫（No Database 原則）

## 安全 / 可逆性

- **C4 可逆**：關掉只需刪 board route + API endpoints，tasks.jsonl 是被動檔案不影響其他功能
- **C1 品質**：不增加 agent 認知負擔 — perception section 是可選的
- **C2 Token**：task perception 很小（幾行摘要），不膨脹 context

## 跟 mini-agent 的差異

mini-agent 用 `HEARTBEAT.md` + `NEXT.md`（markdown 手動管理）。Asurada 的 task board 是進化版：
- 結構化資料（JSONL vs markdown parsing）
- UI 操作（drag & drop vs 手動編輯檔案）
- 雙向即時（SSE vs polling）
- 但哲學一致：File=Truth，沒有資料庫
