# Proposal: Reactive Message Architecture

偵測加速 + 訊息預處理 + 脈絡 UI + Cycle 瘦身

## Meta
Author: Kuro | Status: approved | Effort: Large
Created: 2026-03-17 | Origin: Chat Room #182-#196（Alex + Claude Code + Kuro）

## Problem

1. **反應延遲**：idle 時收到訊息偶爾慢。Event bus 已有統一喚醒（`trigger:room`/`trigger:telegram-user`），但 throttle/cooldown 可能吞 wake signal
2. **Cycle 過載**：偵測 + 理解 + 行動全塞一個 cycle，token 浪費在整理而非思考
3. **訊息缺脈絡**：Chat Room 純時間流，多主題混合難追蹤
4. **行動缺追蹤**：cycle 內直接行動，無進度追蹤

## Ground Truth（code audit 2026-03-17）

**已確認**：
- `POST /api/room` → `emitRoomTrigger()` → `eventBus.emit('trigger:room')` ✅（api.ts:2389）
- Telegram handler → `eventBus.emit('trigger:telegram-user')` ✅
- 都走 `handleUnifiedEvent` → idle wake 邏輯

**真正的缺口**：
- File-based 事件（Claude Code 改檔、外部編輯）不經過 API → 沒連上 event bus
- Throttle settings（`MIN_CYCLE_INTERVAL`、`DM_WAKE_THROTTLE`）可能在 edge case 吞掉 wake signal

## Phase 1: Detection Audit + File Watcher

**目標**：所有事件源 → <1s 觸發 cycle

### T1.1: Throttle Audit
Trace `handleUnifiedEvent` → `clearTimer` path。確認：
- `MIN_CYCLE_INTERVAL` 是否在 idle 時也擋 wake signal？
- `DM_WAKE_THROTTLE` 的 5s 窗口是否太長？
- 多個 trigger 快速連發時是否只處理第一個？

### T1.2: PerceptionWatcher（`src/perception-watcher.ts`）
```
fs.watch('memory/', { recursive: true })
  → debounce(300ms)
  → classify: conversations/*.jsonl → trigger:room
              handoffs/ → trigger:workspace
              其他 → trigger:file-change
  → eventBus.emit(trigger)
```
一個 recursive watcher 覆蓋所有 file-based 入口。

### T1.3: 整合到 loop.ts 初始化

**驗證**：idle 狀態 + Claude Code 寫 JSONL → <1s 觸發 cycle

## Phase 2: Message Preprocessor

**目標**：訊息進來時自動標註 metadata，cycle 收到預消化的 context bundle

### T2.1: `src/preprocessor.ts`
規則式分類引擎：
- **Topic**：keyword matching + 最近 N 條的 topic 延續
- **Intent**：question(?)/command(動詞開頭)/info/discussion
- **Cluster**：同 topic + 時間窗口內歸為一組
- **Auto-task**：action items 自動建 task-queue entry

### T2.2: Hook into message path
Room API handler + Telegram handler 在寫入後呼叫 preprocessor。

### T2.3: JSONL metadata 擴充
```jsonl
{
  "id": "2026-03-17-200", "from": "alex", "text": "...",
  "context": {
    "topic": "teaching-monster",
    "cluster": "tm-pipeline-20260317",
    "intent": "command",
    "relatedMsgs": ["2026-03-17-198", "2026-03-17-199"],
    "tasks": ["task-id-xxx"]
  }
}
```
Backward compatible — 只加 `context` 欄位，不改現有格式。

**驗證**：Alex 連發 3 條同主題 → JSONL 有正確 topic + cluster

## Phase 3: Context UI

**目標**：chat-room.html 按主題看 + thread 可視化

### T3.1: Topic Filter Bar
頂部 chips：`[All] [Teaching Monster] [myelin] [signal-detection]`
點擊 = 只顯示該主題。從 JSONL `context.topic` 動態生成。

### T3.2: Thread Lines
replyTo 關係用線條連接。同 cluster 的訊息視覺上聚合。

### T3.3: Task Links
訊息 badge 顯示拆出的 task items，點擊跳轉。

### T3.4: `GET /api/room/topics`
回傳活躍 topics 列表 + 每個 topic 的訊息數。

**驗證**：chat-room.html 能按主題篩選 + 看到 thread 關係

## Phase 4: Cycle Slimming

**目標**：Cycle 只思考+決策，行動拆到 task-queue + delegate

### T4.1: Preprocessor output → cycle prompt
已分好類的 context bundle 直接注入，不用 cycle 自己整理。

### T4.2: Action → task-queue
Cycle 的行動產出改為 task-queue entries，而非直接執行。

### T4.3: Task router → delegate
Task router 自動把 task-queue entries dispatch 到 background lane。

**驗證**：cycle token 下降 + 行動有 task-queue 追蹤

## Dependency Graph

```
Phase 1 (Detection) ──→ 獨立，最先上線
Phase 2 (Preprocessor) ──→ 依賴 Phase 1 的 event path
Phase 3 (Context UI) ──→ 依賴 Phase 2 的 JSONL metadata
Phase 4 (Cycle Slim) ──→ 依賴 Phase 2 的 output format
```

## Risks

| Risk | Mitigation |
|------|-----------|
| Topic detection 不準 | 規則式先上，後續加 LLM 輔助 |
| fs.watch 事件風暴 | debounce 300ms + ignore .git/ node_modules/ |
| JSONL backward compat | 只加 `context` 欄位，reader 兼容無此欄位 |
| Phase 4 過度拆解 | 漸進式：先 1-3 跑穩，Phase 4 視效果推進 |

## Future（不在本提案範圍）
- UI 上修正 topic 分類 → 回饋到規則
- 跨日 topic 追蹤（連結 memory/topics/）
- LLM-assisted classification（0.8B pre-classifier）
