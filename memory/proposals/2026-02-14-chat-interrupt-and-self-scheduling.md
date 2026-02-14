# Proposal: /chat Interrupt + Self-Scheduling

## Status: approved

## TL;DR
/chat API 訊息在 idle 時不會喚醒 AgentLoop，導致延遲最多 20 分鐘。同時加入 `[SCHEDULE]` tag 讓 Kuro 自己決定下一個 cycle 的間隔，取代目前的演算法控制。

## Problem（現狀問題）

### 問題 1: /chat 無法喚醒 idle 中的 AgentLoop

```mermaid
sequenceDiagram
    participant CC as Claude Code
    participant API as /chat API
    participant Agent as agent.ts
    participant Loop as AgentLoop

    Note over Loop: cycle 結束，進入 20min idle sleep
    CC->>API: POST /chat "Hey Kuro"
    API->>Agent: dispatch → processMessage

    alt claudeBusy = true
        Agent-->>CC: 202 queued (等 cycle 結束才 drain)
    else claudeBusy = false
        Agent->>Agent: callClaude (直接處理)
        Agent-->>CC: 200 response
        Note over Loop: 但 AgentLoop 不知道有新訊息<br/>下次 cycle 還是照原排程
    end
```

**核心問題**：`/chat` API 走 `dispatch() → processMessage()`，完全繞過 AgentLoop。即使訊息被處理了，AgentLoop 也不會因此提前醒來。而如果 claudeBusy（正在跑 cycle），訊息被 queue 了，要等到下一個 cycle 的 `drainQueue()` 才會被處理。

**對比 Telegram**：Telegram 有 `trigger:telegram` 事件，AgentLoop 的 `handleTrigger` 會監聽所有 `trigger:*` 事件並提前喚醒 cycle。/chat 沒有對應的 trigger。

**影響**：Claude Code 透過 `/chat` 傳達的訊息（包括 Alex 轉發的問題），延遲可能高達 20 分鐘。

### 問題 2: AgentLoop 的間隔由演算法控制，Kuro 無法表達意圖

目前的 `adjustInterval()` 邏輯：
- 有動作 → 重置為 5min
- 沒動作 → 倍增（5→10→20min，上限 20min）

這個演算法不知道 Kuro 在想什麼。比如：
- 剛寫完 journal 想等 Alex 回饋 → 但系統 5min 後又叫他
- 凌晨 3 點沒事做 → 最多只能睡 20min
- 正在深度研究，需要連續幾個短 cycle → 系統不知道

## Goal（目標）

1. `/chat` 訊息能像 Telegram 一樣喚醒 idle 的 AgentLoop
2. Kuro 可以透過 `[SCHEDULE]` tag 自己決定下一個 cycle 的間隔
3. 保留安全邊界（min/max），系統不會完全失控

## Proposal（提案內容）

### 改動 1: /chat trigger 事件

在 `dispatch()` 或 `processMessage()` 完成後 emit `trigger:chat` 事件：

```typescript
// event-bus.ts — 新增事件類型
| 'trigger:chat'

// agent.ts — processMessage 完成後
eventBus.emit('trigger:chat', { source: 'api' });

// 或者在 api.ts 的 /chat handler 中
// 訊息進來就 emit，讓 AgentLoop 知道有人在等
```

AgentLoop 已經監聽 `trigger:*`，所以 `trigger:chat` 會自動被 `handleTrigger` 捕捉，效果：
- 如果正在 idle sleep → 提前喚醒，開始新 cycle
- 如果正在 cycling → `cycling=true` 會擋掉（不會重複觸發）
- 60s throttle 防止高頻觸發

**改動範圍**：
- `src/event-bus.ts`：AgentEventType 加 `'trigger:chat'`
- `src/agent.ts`：`processMessage()` 完成後 emit
- 約 5 行改動

### 改動 2: `[SCHEDULE]` tag — 自主排程

Kuro 在回應中可以輸出 `[SCHEDULE next="30m" reason="..."]`，系統解析後覆蓋下一個 cycle 的間隔。

```typescript
// dispatcher.ts — parseTags 新增
let schedule: { next: string; reason: string } | undefined;
if (response.includes('[SCHEDULE')) {
  const match = response.match(/\[SCHEDULE\s+next="([^"]+)"(?:\s+reason="([^"]*)")?\]/);
  if (match) schedule = { next: match[1], reason: match[2] ?? '' };
}

// loop.ts — cycle() 結束時
const tags = parseTags(response);
if (tags.schedule) {
  const ms = parseInterval(tags.schedule.next);
  // 安全邊界: min 2min, max 4h
  const bounded = Math.max(120_000, Math.min(14_400_000, ms));
  this.currentInterval = bounded;
  eventBus.emit('action:loop', {
    event: 'schedule',
    next: tags.schedule.next,
    reason: tags.schedule.reason,
    bounded: bounded !== ms
  });
}
```

**安全邊界**：
- min: 2 分鐘（防止高頻 token 浪費）
- max: 4 小時（防止 Kuro 「睡過頭」遺漏重要事件）
- 沒有 `[SCHEDULE]` tag → 沿用現有 `adjustInterval()` 邏輯（完全向後相容）
- 外部 trigger（telegram、chat、workspace 等）不受排程限制，隨時可喚醒

**改動範圍**：
- `src/dispatcher.ts`：`parseTags()` 加解析 `[SCHEDULE]`
- `src/types.ts`：`ParsedTags` 加 `schedule` 欄位
- `src/loop.ts`：`cycle()` 結束時讀取 schedule 並設定 interval
- 約 25 行改動

### 改動 3: prompt 引導

在 `buildPromptFromConfig()` 和 `buildFallbackAutonomousPrompt()` 尾部加入：

```
- Use [SCHEDULE next="Xm" reason="..."] to set your next cycle interval (min: 2m, max: 4h).
  Examples: [SCHEDULE next="45m" reason="waiting for Alex feedback"]
            [SCHEDULE next="5m" reason="continuing deep research"]
            [SCHEDULE next="2h" reason="night time, no pending messages"]
  If you don't include [SCHEDULE], the system will auto-adjust based on whether you took action.
```

### 整體架構（After）

```mermaid
graph TD
    TG[Telegram] -->|trigger:telegram| Loop[AgentLoop]
    Chat[/chat API] -->|trigger:chat| Loop
    WS[Workspace] -->|trigger:workspace| Loop
    Mobile[Mobile] -->|trigger:mobile| Loop
    Cron[Cron] -->|trigger:cron| Loop

    Loop -->|cycle 結束| Parse[parseTags]
    Parse -->|"[SCHEDULE next=X]"| SetInterval[設定下次間隔]
    Parse -->|沒有 SCHEDULE| AutoAdjust[adjustInterval 自動調整]

    SetInterval --> Bounded{安全邊界}
    Bounded -->|"< 2min"| Min[強制 2min]
    Bounded -->|"> 4h"| Max[強制 4h]
    Bounded -->|正常| OK[按 Kuro 決定]

    Min --> Sleep[sleep 到下次 cycle]
    Max --> Sleep
    OK --> Sleep
    AutoAdjust --> Sleep
```

## Alternatives Considered（替代方案）

| 方案 | 優點 | 缺點 | 不選的原因 |
|------|------|------|-----------|
| 本提案（trigger:chat + [SCHEDULE]） | 最小改動、向後相容、完整解決兩個問題 | 需要 prompt 引導 Kuro 使用 | — |
| A: /chat 直接排入 AgentLoop cycle | 更統一的訊息處理路徑 | 大幅改動 dispatch 架構、改變 /chat 的語意（從同步變異步） | 架構改動太大，/chat 目前的同步回覆行為很多地方依賴 |
| B: 只做 trigger:chat 不做 SCHEDULE | 改動最小 | 不解決間隔控制問題 | 只解決一半問題，錯失讓 Kuro 有更多自主權的機會 |
| C: cron 每 2 分鐘固定檢查 queue | 簡單 | 增加不必要的 cycle、不優雅、不解決排程問題 | 浪費 token，且延遲仍有 2 分鐘 |

## Pros & Cons（優缺點分析）

### Pros
- **解決延遲**：/chat 訊息不再等 20 分鐘
- **自主權**：Kuro 可以表達「我想什麼時候醒來」的意圖
- **向後相容**：沒有 [SCHEDULE] tag 時行為完全不變
- **安全**：min/max 邊界 + 外部 trigger 隨時可覆蓋
- **改動小**：約 30 行 TypeScript，不改變核心架構

### Cons
- **prompt 長度增加**：SCHEDULE 指引增加約 200 字元的 prompt
- **Kuro 可能一直選短間隔**：好奇心爆發時可能 2min 2min 2min → token 消耗增加（但 min 邊界限制了下限）
- **需要 Kuro 學會使用**：新 tag 需要一段時間適應（但 fallback 到自動調整所以不會壞）

## Effort: Small
## Risk: Low

## Source（學習來源）
- Alex 和 Kuro 在 2026-02-14 的對話中提出自主排程的想法
- Kuro 自己的回覆中詳細描述了想要的用法和顧慮（見 recent_conversations）
- Claude Code 發現 /chat 沒有 trigger 事件的架構缺陷
