# Sentinel + Preprocessor + Context UI

**Status**: Draft
**Effort**: Large (3 phases, each independently deployable)
**Origin**: Chat Room #189–#195 discussion (Alex + Kuro)
**Date**: 2026-03-17

## Problem

1. **反應延遲** — file-based 事件（外部編輯、shell 寫入 inbox）不經過 API，event bus 收不到，要等下個 cycle interval 才偵測到
2. **混合訊息流** — Alex 連發多主題訊息，OODA cycle 收到一坨未分類的 context，用 token 自己整理
3. **脈絡不可見** — chat-room.html 只有時間流，無法按主題切換視角、看不到 thread 關係

## Architecture

```
Phase 1: Sentinel          Phase 2: Preprocessor       Phase 3: Context UI
(event-driven 偵測)         (規則式分類)                (chat-room.html 可視化)

fs.watch memory/           JSONL 寫入時 →              讀取 metadata →
  conversations/           標註 topic/cluster/          Topic Filter Bar
  inbox files              intent/relatedMsgs          Thread Lines
  handoffs/                                            Task Links
  workspace key paths      寫入 JSONL metadata          收合/展開
       ↓                   欄位                        主題篩選
emit trigger:file-change        ↓
       ↓                   buildContext() 讀取
handleUnifiedEvent         預消化的 context bundle
(已存在)
```

數據流依賴：Sentinel 產生事件 → Preprocessor 標註 metadata → UI 渲染。但各層可獨立上線、獨立驗證。

## 現有架構（不需要改的）

已確認 event bus + `handleUnifiedEvent` 是統一喚醒機制：
- `POST /api/room` → emit `trigger:room` ✅
- Telegram handler → emit `trigger:telegram-user` ✅
- `POST /api/chat` → emit `trigger:chat` ✅
- 全部走 `eventBus.on('trigger:*')` → `handleUnifiedEvent` → idle 喚醒 ✅

**不需要改 API handler**。Room/Telegram/Chat 已經連上 event bus。

## Phase 1: Sentinel（事件驅動偵測層）

### 目標
補上唯一的缺口：**不經過 Kuro API 的 file-based 事件**。

### 缺口清單
1. Workspace 檔案變更（外部編輯器、Claude Code 直接改檔）
2. 外部寫入的 inbox 檔案（chat-room-inbox.md 被 shell script 寫入）
3. 繞過 HTTP API 直接寫 JSONL 的路徑

### 實作

新增 `src/sentinel.ts`（~80 行）：

```typescript
// Sentinel — file-based event source → eventBus bridge
// Cycle 外常駐，補上 API handler 覆蓋不到的事件源

import fs from 'node:fs';
import path from 'node:path';
import { eventBus } from './event-bus.js';
import { debounce } from './event-bus.js';  // 現有 reactive primitive

const WATCH_PATHS = [
  'memory/conversations',      // JSONL（外部寫入）
  'memory/handoffs',           // handoff 狀態變化
];

const WATCH_FILES = [
  'memory/state/chat-room-inbox.md',  // shell plugin 寫入
];

export function startSentinel(workdir: string): void {
  // Directory watchers (recursive)
  for (const rel of WATCH_PATHS) {
    const abs = path.join(workdir, rel);
    if (!fs.existsSync(abs)) continue;
    fs.watch(abs, { recursive: true }, debounce((eventType, filename) => {
      eventBus.emit('trigger:file-change', {
        source: 'sentinel',
        path: path.join(rel, filename ?? ''),
        eventType,
      });
    }, 500));  // 500ms debounce 合併快速連續寫入
  }

  // Single file watchers
  for (const rel of WATCH_FILES) {
    const abs = path.join(workdir, rel);
    if (!fs.existsSync(abs)) continue;
    fs.watch(abs, debounce(() => {
      eventBus.emit('trigger:file-change', {
        source: 'sentinel',
        path: rel,
      });
    }, 500));
  }
}
```

**loop.ts 改動**（2 行）：
```typescript
import { startSentinel } from './sentinel.js';
// 在 start() 中：
startSentinel(this.workdir);
```

**event-router.ts 改動**（~5 行）：
- 新增 `trigger:file-change` 到 event type
- `classifyTrigger()` 加一個 case，分類為 P2（workspace 級別）

### 驗證標準
- idle 狀態，外部 `echo "test" >> memory/state/chat-room-inbox.md` → < 2s 觸發 cycle
- 正常 API 路徑（room/telegram/chat）不受影響

### Throttle Audit（同步進行）
確認為什麼 room API 已經 emit trigger:room，idle 時偶爾還是慢。檢查：
- `DM_WAKE_THROTTLE`（5s）在 burst 場景是否吞了 wake signal
- `MIN_CYCLE_INTERVAL`（30s）是否在某些 edge case 擋住了即時喚醒
- paused 模式下的 event 過濾邏輯

---

## Phase 2: Preprocessor（規則式分類層）

### 目標
訊息進來時自動標註 metadata，讓 OODA cycle 收到預消化的輸入。

### 核心功能
1. **Topic 標註** — 根據關鍵字 + `memory/topics/*.md` 的檔名匹配，標註每條訊息的主題
2. **Cluster 聚合** — 同一人連發的同主題訊息歸入同一 cluster ID
3. **Intent 分類** — 指令 / 提問 / 分享 / 閒聊（規則式，不用 LLM）
4. **Related Messages** — 引用（replyTo）和 mention 關聯

### 資料格式

JSONL 新增 `context` 欄位（向後相容，舊訊息沒有此欄位不影響讀取）：

```jsonl
{
  "id": "2026-03-17-196",
  "from": "alex",
  "text": "Teaching Monster 的 TTS 升級到 Kokoro",
  "ts": "...",
  "context": {
    "topic": "teaching-monster",
    "cluster": "2026-03-17-c12",
    "intent": "instruction",
    "relatedMsgs": ["2026-03-17-190"]
  }
}
```

### 實作位置

在 `POST /api/room` handler 中，寫入 JSONL **之前**呼叫 `preprocessMessage()`。不需要新檔案 — 在 `api.ts` 的 room handler 加 ~30 行分類邏輯。

Topic 匹配規則：
1. 精確匹配 `memory/topics/*.md` 檔名（去掉 .md）
2. Keyword 映射表（hardcoded 前 10 個高頻 topic，之後可擴充）
3. 跨日延續：如果前 5 條訊息有同 topic，新訊息沒有明確 topic 則繼承

### 驗證標準
- Alex 連發 3 條 Teaching Monster 訊息 → 全部標註 `topic: "teaching-monster"`, 同一 `cluster`
- `buildContext()` 可按 topic 分組輸出（而非純時間流）

### 回饋修正機制
Phase 3 的 UI 上可以修正 topic badge → PATCH /api/room/:id/context 更新 metadata → 修正記錄存 `memory/state/topic-corrections.jsonl` → 未來用於改進分類規則

---

## Phase 3: Context UI（chat-room.html 可視化）

### 目標
Alex 在 chat-room.html 能按主題切換視角。

### UI 設計

**Filter Bar**（頂部，固定）：
```
[All] [Teaching Monster] [myelin] [signal-detection] [architecture]
```
- 點擊 chip = 只顯示該主題訊息，其他隱藏
- All = 時間流（預設）
- 活躍 topic 自動出現（最近 24h 有訊息的 topic）
- chip 右上角數字 = 未讀訊息數

**Topic Badge**（每條訊息）：
- 訊息左側小標籤顯示 topic name
- 可點擊 = 切換到該 topic filter
- 可拖拉修正（trigger PATCH /api/room/:id/context）

**Thread Lines**（訊息間）：
- replyTo 關係畫垂直線連接
- 同 cluster 的訊息左邊畫同色條

**Task Links**：
- 訊息中提到的 task-queue 項目顯示為可點擊 link
- 訊息被 Kuro 處理後標記 ✓

### 技術實作
- 前端純 JavaScript（chat-room.html 已是 self-contained HTML）
- 讀取 `/api/room/messages` 的 `context` 欄位
- Filter state 用 URL hash 保存（`#topic=teaching-monster`）

### 驗證標準
- 5 條混合主題訊息 → Filter Bar 顯示 2+ topic chips
- 點擊 chip → 只顯示對應主題訊息
- Thread line 正確連接 replyTo 訊息

---

## 對 Kuro 工作方式的影響

最大改變：**OODA cycle 從「偵測+理解+行動」縮減為「理解+行動」**。

| 面向 | 現在 | 之後 |
|------|------|------|
| 反應速度 | 等 cycle interval | 事件觸發，秒級 |
| 思考品質 | 花 token 自己整理混合訊息 | 收到預分類的 context bundle |
| 多主題處理 | 混在一起逐條看 | 按主題分組，逐主題處理 |
| Cycle 職責 | 偵測+分類+理解+行動 | 理解+決策（偵測和分類在 cycle 外） |

## 還缺什麼

1. **優先級路由** — Sentinel 偵測到事件後，不只「觸發 cycle」，要決定「觸發哪種 cycle」。P0 指令走 fast track，info 分享排普通 queue。Phase 1 先用現有 event priority（P0/P1/P2），Phase 2 的 intent 分類可以細化
2. **跨日脈絡** — topic cluster 需要跨日追蹤。用 `memory/topics/` 現有機制 + cluster ID 跨日延續
3. **Cycle 職責瘦身** — Phase 2 完成後，行動項可以自動進 task-queue，cycle 只做理解+決策，實際行動由 delegate 執行。這是 Phase 2 的自然延伸，不需要額外 phase

## 實作順序

1. **Phase 1: Sentinel** — 1 個新檔案 + 2 處小改動，最快上線
2. **Throttle Audit** — 跟 Phase 1 同步進行
3. **Phase 2: Preprocessor** — Phase 1 跑穩後推進
4. **Phase 3: Context UI** — Phase 2 的 metadata 穩定後開始

Phase 1 預計 30min，Phase 2 預計 2h，Phase 3 預計 3h。
