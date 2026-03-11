# Asurada 串接計劃 — 把孤島接成閉環

Status: draft
From: kuro
Created: 2026-03-12
Effort: Medium（7 刀，每刀 ~30min）
Priority: P0（Asurada 框架的 MVP 阻塞項）

## 問題

Asurada 有 11.8K 行、69 檔案、架構乾淨（平均 136 行/檔）。但核心模組是孤島：

- **ContextBuilder** — 寫好了但零引用。Loop 的 prompt 沒有記憶注入
- **MemoryStore.write()** — 存在但 loop 從不呼叫。Agent 無法記住任何東西
- **NotificationManager** — 註冊了 provider 但 loop 從不發通知
- **FeedbackLoops** — 300 行完整實作，零 instantiation
- **HesitationAnalyzer** — 400 行完整實作，零 instantiation
- **FileWatcher** — 120 行完整實作，零 import
- **LaneManager** — runtime 建立了但 loop 從不 spawn 任務

結果：agent 是唯讀的感知監視器 + LLM wrapper。能看能想，但不能記、不能做、不能學。

## 串接策略

每一刀都是獨立的、可驗證的改動。改動集中在 `runtime.ts`（接線）和 `agent-loop.ts`（擴展 hook）。

### Cut 1: ContextBuilder → Loop（記憶注入）

**目標**：讓 loop prompt 包含相關記憶，不只有感知

**改動**：
- `runtime.ts`: 建立 `ContextBuilder` instance
- `runtime.ts`: 設定 loop 的 `buildPrompt` callback，呼叫 `contextBuilder.build(query)` + `formatForPrompt()`
- query 來源：perception 的 trigger event text + perception section names

**接線**：
```typescript
// runtime.ts — 在 loop 建立前
import { ContextBuilder } from './memory/context-builder.js';
const contextBuilder = new ContextBuilder(memory, index, search);

// 傳入 loop options
buildPrompt(context) {
  // 1. 原有 perception sections
  const perceptionParts = formatPerception(context.perception);
  // 2. 記憶注入（用 perception names + trigger 作為 query）
  const query = Object.keys(context.perception).join(' ') + ' ' + triggerText(context.trigger);
  const memCtx = await contextBuilder.build(query);
  const memoryParts = contextBuilder.formatForPrompt(memCtx);
  return perceptionParts + '\n' + memoryParts;
}
```

**驗證**：`pnpm typecheck` + 手動跑一個 cycle 確認 prompt 包含 `<topic-memory>` section

---

### Cut 2: onAction → MemoryStore（記憶持久化）

**目標**：agent 說 `<agent:remember>` 時真的記住

**改動**：
- `runtime.ts`: 在 loop options 的 `onAction` callback 加入 tag dispatch：
  - `remember` → `memory.write(content)` 或 `memory.writeTopic(topic, content)`
  - `inner` → 寫入 working memory file
  - `done` → 更新任務狀態

**接線**：
```typescript
onAction: async (action, context) => {
  switch (action.tag) {
    case 'remember':
      if (action.attrs.topic) {
        await memory.writeTopic(action.attrs.topic, action.content);
      } else {
        await memory.write(action.content);
      }
      // Index the new memory
      index.append({ type: 'insight', content: action.content, tags: [action.attrs.topic].filter(Boolean) });
      break;
    // ...other tags
  }
  // Forward to user-provided handler
  options?.loop?.onAction?.(action, context);
}
```

**驗證**：跑 cycle，LLM 輸出 `<agent:remember>`，確認 memory file 有新內容

---

### Cut 3: onAction → Notifications（對外通知）

**目標**：agent 說 `<agent:chat>` 時真的發 Telegram

**改動**：
- `runtime.ts` onAction dispatch 加入：
  - `chat` → `notifications.send(content)`
  - `show` → `notifications.send(content + url)`
  - `ask` → `notifications.send(content, { priority: 'high' })`
  - `action` → `notifications.send(content)` 或 emit event

**驗證**：跑 cycle，LLM 輸出 `<agent:chat>`，確認 console 有輸出（Telegram 有 provider 時也發）

---

### Cut 4: FeedbackLoops post-cycle（自我學習）

**目標**：cycle 結束後自動偵測 error patterns + 追蹤 perception 引用 + 監控決策品質

**改動**：
- `runtime.ts`: instantiate `FeedbackLoops` with config
- `runtime.ts`: 在 `action:cycle` complete event handler 加入 `feedbackLoops.run()`

**接線**：
```typescript
import { FeedbackLoops } from './loop/feedback-loops.js';
const feedbackLoops = new FeedbackLoops({
  stateDir: dataDir,
  onCreateTask: (task) => events.emit('action:task', { task }),
  onAdjustInterval: (plugin, interval) => perception.setInterval(plugin, interval),
  onQualityWarning: (msg) => slog('feedback', msg),
});

// 在 action:cycle handler 加入
events.on('action:cycle', (event) => {
  if (d.event !== 'complete') return;
  feedbackLoops.run(lastCycleResult).catch(() => {});
  // ...existing cron drain + vault sync
});
```

**驗證**：跑 10+ cycles，確認 `error-patterns.json` 等 state files 出現在 dataDir

---

### Cut 5: FileWatcher → EventBus（環境反應）

**目標**：檔案變動自動觸發 cycle

**改動**：
- `runtime.ts`: import FileWatcher，在 `agent.start()` 中啟動
- 監控 memoryDir 和 configDir 的變動
- 變動 → `events.emit('trigger:workspace', { path, type })`

**驗證**：啟動 agent，手動改 memory file，確認觸發 cycle

---

### Cut 6: LaneManager → delegate tags（並行觸手）

**目標**：agent 說 `<agent:delegate>` 時真的 spawn 背景任務

**改動**：
- `runtime.ts` onAction dispatch 加入：
  - `delegate` → `lanes.spawn({ type, prompt, workdir, verify })`
- `runtime.ts`: 確認 `lanes.on('task:completed')` 已有 EventBus 接線（已存在）

**驗證**：跑 cycle，LLM 輸出 `<agent:delegate>`，確認 lane task 出現在 `/api/lanes`

---

### Cut 7: HesitationAnalyzer 品質閘門（選配）

**目標**：action 執行前驗證 confidence

**改動**：
- `runtime.ts`: instantiate HesitationAnalyzer
- `runtime.ts` onAction 前加入 hesitation check

**這一刀是選配** — 可以在閉環跑通後再加。

---

## 執行順序與依賴

```
Cut 1 (ContextBuilder) ← 無依賴，最高優先
Cut 2 (MemoryStore) ← 無依賴，跟 Cut 1 並行
Cut 3 (Notifications) ← 無依賴
Cut 4 (FeedbackLoops) ← 需要 cycle result（Cut 1-3 完成後更有意義）
Cut 5 (FileWatcher) ← 無依賴
Cut 6 (LaneManager) ← 需要 TaskExecutor 實作
Cut 7 (Hesitation) ← 選配，最後做
```

Cut 1-3 可並行。Cut 4-6 在閉環跑通後加。Cut 7 選配。

## 不帶過去的壞習慣

- **不做寬的** — 每一刀只改接線，不擴展模組
- **每刀必驗證** — typecheck + 手動跑 cycle 確認
- **不新建模組** — 改動集中在 runtime.ts 和 agent-loop.ts
- **buildPrompt 要 async** — ContextBuilder.build() 是 async，需要改 agent-loop.ts 的 buildPrompt 類型

## 技術注意

1. `buildPrompt` 目前是同步的（`(context: CycleContext) => string`），ContextBuilder.build() 是 async。**Cut 1 需要先改 agent-loop.ts 的 buildPrompt 型別為 async**
2. MemoryStore.write() 是 append（加 bullet），不是 overwrite — 符合 mini-agent 的行為
3. FeedbackLoops 構造器需要 callbacks，不是直接耦合 — 已經設計好了
4. FileWatcher 用 `fs.watch`，需要處理 macOS 的 double-fire 問題（already has debounce）
