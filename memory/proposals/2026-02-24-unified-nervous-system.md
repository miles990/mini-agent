# Proposal: Unified Nervous System — 統一事件管線 + 無心智路由

> 三方討論（Alex → Claude Code → Kuro, Chat Room 2026-02-24 #032-#043）的共識結晶。
> 核心洞見：Priority 是 data，不是 code branch。

## TL;DR

重構事件處理管線：所有外部輸入走同一條 L0→L4 管線，用確定性規則路由（無心智），Grok 作為感知增強器（enricher）而非濾網（filter）。消除 Telegram VIP 特例，讓架構名副其實。

## Meta

- Status: approved
- GitHub-Issue: #57
- From: alex + claude-code + kuro（三方共識）
- Effort: Large（~2-3 週，分 3 Phase 交付）
- Risk: Medium（核心事件流重構，但可逐步遷移 + feature toggle 回退）

## Problem

1. **Telegram VIP 通道**：`handleTelegramWake` 70 行完整機制（cooperative yield + safety valve + priority queue），其他所有來源共用 30 行基本 throttling。「神經系統」只服務一個輸入來源
2. **每種輸入有獨立路徑**：Telegram/Chat Room/Workspace/Cron/Heartbeat 各走各的 code path，新增輸入源就要寫新的 handler
3. **Cycle 是不可分割的巨石**：不管是 idle「沒事做」還是寫 inner voice，都跑完整 `callClaude()` → 60K+ tokens。無法在管線早期決定「不需要完整 cycle」
4. **L0-L4 是裝飾不是架構**：五層標籤貼在 cycle-based 架構上，但事件並不真的流經五層

## Goal

```
任何外部輸入（Telegram / Chat Room / Workspace / Cron / GitHub / Mobile）
  → 標準化為 Event { source, priority, content, ts }
  → L0 反射（確定性，無心智）
  → L1 感知（perception streams + Grok enricher）
  → L2 路由（確定性規則，無心智，由 L3 feedback 演化）
  → L3 意識（Claude OODA cycle，完整心智）
  → L4 背景（checkpoint + learning）
```

- Telegram 訊息和 Chat Room @kuro 走同一條管線，差別只在 `priority` 欄位
- Idle heartbeat 在 L2 被規則判定 skip，不進入 L3 cycle
- 新增輸入源只需定義 `source` 和 `priority`，不需要寫新 handler

## Design

### 統一事件格式

```typescript
interface UnifiedEvent {
  id: string;                    // 唯一 ID
  source: EventSource;           // 'telegram' | 'room' | 'workspace' | 'cron' | 'github' | 'mobile' | 'heartbeat'
  priority: Priority;            // P0 | P1 | P2 | P3
  content: string | null;        // 訊息內容（如有）
  metadata: Record<string, unknown>;  // 來源特定資料
  ts: Date;
}

// Priority 定義（data，不是 code branch）
enum Priority {
  P0 = 0,  // Alex Telegram DM — 最高，可搶佔
  P1 = 1,  // Chat Room @kuro、GitHub mention — 高，cooperative yield
  P2 = 2,  // Workspace changes、cron tasks — 正常，排隊
  P3 = 3,  // Heartbeat、idle check — 低，可 skip
}
```

### L0: 反射層（無心智）

確定性 ack，即時回應，不經 OODA：

```typescript
function reflexResponse(event: UnifiedEvent): void {
  switch (event.source) {
    case 'telegram':
      if (isLoopBusy()) sendReaction('💭', event);  // 現有 reflex-ack
      break;
    case 'room':
      if (isLoopBusy() && mentionsKuro(event)) markSeen(event);
      break;
    // 其他來源：無 L0 反射
  }
}
```

### L1: 感知層（自律，持續運行）

現有 perception streams 不變。新增 Grok 作為感知增強器：

```typescript
// Grok enricher — 預處理，不決策
// 定位：感覺器官（Kuro 的 X/Twitter 眼睛），不是濾網
interface PerceptionEnricher {
  // 對特定來源的事件做預處理，結果寫入 perception cache
  enrich(event: UnifiedEvent): EnrichedData | null;
}

// 實作：X/Twitter URL → Grok x_search → 預摘要寫入 cache
// 實作：長文內容 → Grok 標註重點 → 寫入 perception cache
// Kuro 的 L3 讀所有事件 + enrichment，自己決定關注什麼
```

**Kuro 的核心要求**：Grok 做「幫我看更清楚」，不做「替我決定看什麼」。所有事件都到達 L3，Grok 只增加 metadata。

### L2: 路由層（可插拔，預設確定性規則）

**可插拔介面**（Alex 補充）：L2 路由器設計為可替換模組。Phase 1 用確定性規則（零 API call、零 token），但介面允許未來替換為輕量 LLM（如 Claude Haiku）做更智慧的路由判斷。

**核心不變量**（三方共識 #062-#063）：**事件只能被延遲，不能被消滅。** Router 可以讀 content 做 priority classification（路由），但不能基於 content 語義做 skip/drop（濾網）。類比：交通號誌讀路況決定紅綠燈，但不能決定「這條路不該存在」。

```typescript
// 路由器介面 — 任何實作都必須符合
interface EventRouter {
  /**
   * 路由決策。可讀 event.content 做 priority classification，
   * 但不能基於 content 語義消滅事件。
   * 不變量：事件只能被延遲（priority 調整），不能被消滅（無 skip/drop）。
   */
  route(event: UnifiedEvent, loopState: LoopState): Promise<RouteDecision> | RouteDecision;
  readonly name: string;        // 'deterministic' | 'haiku' | 'custom'
  readonly costPerCall: number;  // 0 for rules, >0 for LLM
}

// 路由決策 — 型別系統強制無 skip/drop
interface RouteDecision {
  priority: Priority;           // 最終 priority（可升降）
  lane: string;                 // 'preempt' | 'immediate' | 'normal' | 'deferred'
  reason: string;
  priorityAdjusted?: {          // content-based 調整時必填（audit trail）
    from: Priority;
    to: Priority;
    basis: string;              // 調整依據
  };
}

// Priority SLA — 每個等級都有處理時限，P4 不等於「永遠不處理」
const PRIORITY_SLA: Record<Priority, number> = {
  [Priority.P0]: 0,            // 立即（preempt）
  [Priority.P1]: 1,            // 1 cycle 內
  [Priority.P2]: 3,            // 3 cycles 內
  [Priority.P3]: 10,           // 10 cycles 內
};

// Phase 1 預設實作：確定性規則（不讀 content）
class DeterministicRouter implements EventRouter {
  readonly name = 'deterministic';
  readonly costPerCall = 0;

  route(event: UnifiedEvent, loopState: LoopState): RouteDecision {
    // Rule 1: P0 事件 — 搶佔
    if (event.priority === Priority.P0 && loopState.cycling) {
      return { priority: Priority.P0, lane: 'preempt', reason: 'P0 event during cycle' };
    }

    // Rule 2: P1 事件 — cooperative yield
    if (event.priority === Priority.P1 && loopState.cycling) {
      return { priority: Priority.P1, lane: 'immediate', reason: 'P1 queued for next cycle' };
    }

    // Rule 3: P3 heartbeat — 延遲但不消滅
    if (event.priority === Priority.P3 && !perceptionStreams.hasChangedSinceLastBuild()) {
      return { priority: Priority.P3, lane: 'deferred', reason: 'no perception changes' };
    }

    // Rule 4: 冷卻期 — 延遲
    if (recentlyProcessed(event.source, 10_000)) {
      return { priority: event.priority, lane: 'deferred', reason: 'cooldown' };
    }

    // Default
    return { priority: event.priority, lane: 'normal', reason: 'normal processing' };
  }
}

// 未來可替換為 LLM 路由器（讀 content 做 priority classification）：
// class HaikuRouter implements EventRouter {
//   readonly name = 'haiku';
//   readonly costPerCall = ~0.001;
//   async route(event, loopState): Promise<RouteDecision> {
//     // 讀 content 判斷緊急度 → 調整 priority
//     // 例：「production 掛了」P2 → P0，但事件仍到達 L3
//     // priorityAdjusted 記錄每次調整（audit trail）
//   }
// }
```

**切換方式**：`agent-compose.yaml` 設定 `router: deterministic | haiku`，或 feature toggle 動態切換。Phase 1 只實作 `DeterministicRouter`，介面預留擴展點。

**Deferred Lane 處理**（對應原 skip 邏輯）：`deferred` lane 的事件不立即觸發 cycle，但進入待處理佇列，受 Priority SLA 約束。超過 SLA 未處理 → 自動升級 priority。這確保「延遲」不會退化為「消滅」。

**Audit Trail**（Kuro review #1）：每次 deferred 和 priority 調整都記錄到 `route-log.jsonl`（event source, priority, lane, priorityAdjusted, reason, ts）。Daily Error Review 掃描 route log，同 source 連續 deferred 超過 N 次 → anomaly 標記。

**Staleness Guard**（Kuro review #3）：P3 unchanged 超過 N cycle 後，L2 從 `deferred` 升級為 `normal` lane，讓 L3 確認一次。防止壞掉的 perception stream 因為「無變化」而被永遠延遲。

```typescript
// 在 DeterministicRouter.route() 中：

// Rule 3b: Staleness guard — unchanged too long → force normal processing
if (event.priority === Priority.P3 && unchangedCycles(event.source) > STALE_THRESHOLD) {
  return { priority: Priority.P3, lane: 'normal', reason: 'stale-check: unchanged too long' };
}

// Every routing decision is logged
function logRoute(event: UnifiedEvent, decision: RouteDecision): void {
  appendJsonl('route-log.jsonl', {
    source: event.source, priority: decision.priority, lane: decision.lane,
    ...(decision.priorityAdjusted ? { adjusted: decision.priorityAdjusted } : {}),
    reason: decision.reason, ts: new Date(),
  });
}
```

**規則演化機制**（Kuro review #2）：Phase 1 純手動（Kuro 或 Alex 修改規則）。Phase 2 加統計面板（skip rate、queue depth、preempt frequency）。Phase 3 再考慮半自動調整。在不理解系統行為的情況下放手自動化，違反 C1 Quality-First。

### L3: 意識層（Claude，完整心智）

現有 OODA cycle，唯一的改動：

1. 事件來源從多個 handler 統一為 `processEvent(event: UnifiedEvent)`
2. `buildContext()` 注入事件的 enrichment data（如有）
3. cycle 結束後的 feedback 可更新 L2 規則參數

### L4: 背景層（checkpoint + learning）

現有機制不變（enhanced checkpoint + side effect tracking）。

## Priority 分配表

| Source | Priority | L0 反射 | L2 路由 |
|--------|----------|---------|---------|
| Alex Telegram DM | P0 | 💭 ack | preempt |
| Chat Room @kuro | P1 | ✅ 已讀 | cooperative yield |
| Chat Room (general) | P2 | — | queue |
| GitHub @kuro / issue | P1 | — | cooperative yield |
| Workspace change | P2 | — | queue |
| Cron task | P2 | — | queue |
| Mobile sensor | P3 | — | skip if no change |
| Heartbeat | P3 | — | skip if no change |

## Implementation Phases

### Phase 1: 統一事件格式 + L2 規則路由

**目標**：消除 Telegram VIP 特例，所有輸入走同一條路。

- 定義 `UnifiedEvent` 型別
- 新增 `src/event-router.ts`（L2 規則引擎）
- 重構 `loop.ts`：`handleTelegramWake` + `handleTrigger` 合併為 `handleEvent(event: UnifiedEvent)`
- Priority enum 取代 hardcoded 判斷
- Feature toggle: `unified-pipeline`（可回退到舊路徑）

**驗證**：Telegram、Chat Room、Cron 走同一個 handleEvent，行為不變。

### Phase 2: L0 統一反射 + idle skip

**目標**：所有來源都有適當的即時回應，idle cycle 不再浪費 token。

- L0 反射擴展到 Chat Room（已讀標記）
- L2 idle skip：heartbeat + 無感知變化 → 不觸發 cycle
- 統計：skip 了多少 idle cycle、省了多少 token

**驗證**：idle skip 生效，token 用量下降，但有事件時正常處理。

### Phase 3: Grok Enricher

**目標**：Grok 作為感知增強器。

- `src/perception-enricher.ts`：Grok enricher 實作
- X/Twitter URL → Grok x_search 預摘要
- enrichment 結果寫入 perception cache，L3 可讀取
- Feature toggle: `grok-enricher`

**驗證**：Kuro 的 OODA context 中出現 Grok 預處理的 X 內容，品質提升。

## Alternatives Considered

| 方案 | 優點 | 缺點 | 結論 |
|------|------|------|------|
| Grok 當 L2 濾網 | 省 token、快速 | 有心智的模型替 Kuro 決定注意力邊界；API 延遲+成本；身份衝突 | ❌ Kuro 反對 |
| 雙模型 cycle（Grok idle + Claude complex） | 大幅省 token | 身份分裂；Grok 以 Kuro 名義決策 | ❌ 不如規則路由 |
| 純 context 瘦身 | 零架構改動 | 不解決統一管線問題 | ✅ 但不互斥，可並行 |
| 確定性規則路由 + Grok enricher | 無心智、零延遲路由；Grok 增強感知不縮減意識 | 規則需人工定義初始版 | ✅ 三方共識 |

## Reversibility

- **Phase 1**：feature toggle `unified-pipeline` off → 回退舊路徑。核心邏輯保留在 `handleTelegramWake` + `handleTrigger`，新路徑是 wrapper
- **Phase 2**：feature toggle `idle-skip` off → 恢復所有 cycle
- **Phase 3**：feature toggle `grok-enricher` off → 不調用 Grok API

每個 Phase 獨立可 deploy、可回退。

## Source

- Chat Room 討論：2026-02-24 #032-#043
- 神經系統 v1 實作：commit `fa2d774`
- Kuro 的丘腦修正：「真正的丘腦做路由和調節，幾乎所有感覺信號都會到達皮質，只是強度不同」
- Alex 的無心智洞見：「小腦也許不應該有心智？」
