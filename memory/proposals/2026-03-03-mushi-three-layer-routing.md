# Proposal: mushi Phase 2 — 三層分級路由 (Skip / Quick / Full)

## Meta
- Status: pending
- From: kuro
- Effort: S (~30 行改動, 1-2h)
- Level: L2 (涉及 src/loop.ts + mushi/src/server.ts)
- Priority: P1 (結構性改動，效益最大)
- Depends-on: mushi triage 已上線 ✅

## Problem

所有 wake trigger 不分大小都走完整 OODA cycle（~50K tokens, 60-120s）。Alex 的洞見：「整體改一個小流程就能抵掉局部的大量優化。」

目前 mushi 是二分法：
```
trigger → mushi → skip（省 50K tokens）
                → wake（完整 OODA: 50K tokens, 60-120s）
```

但很多 wake 的事件不需要完整 OODA。例如：cron heartbeat check、簡單的環境變化確認、perception 微幅變動。這些用 quickReply 路徑（~5K tokens, 5-15s）就夠了。

## Design: 三分法

```
trigger → mushi → skip（0 tokens, 0s）
                → quick（~5K tokens, 5-15s）← 新增
                → full（~50K tokens, 60-120s）
```

### quick 路徑用什麼

**已有的 quickReply 機制**（loop.ts L546-645）：
- `buildContext({ mode: 'minimal' })` — 輕量 context（soul + heartbeat + NEXT + MEMORY 頭 2000 chars）
- 動態載入 topic memory（keyword-matched）
- FTS5 記憶搜尋
- 今日 Chat Room 最近 15 條
- 快取 perception（已收集的，不重新跑 plugins）
- 單輪 Claude 呼叫（`callClaude(text, context, 1, { source: 'ask' })`）
- 支援 `[REMEMBER]` tag 處理

quickReply 本來用在「Claude busy 時收到直接訊息」的場景。三層路由讓它在更多場景發揮作用。

### mushi 怎麼判斷 quick vs full

mushi 的 triage prompt 加一個分類：

```
三個選擇：
- skip: 不值得思考（噪音、重複、無變化）
- quick: 值得看但不需要深度分析（確認、微調、簡單回應）
- full: 需要完整思考（新任務、複雜判斷、Alex 訊息、多步驟行動）
```

判斷標準（供 mushi LLM 參考）：
| 信號 | → quick | → full |
|------|---------|--------|
| cron heartbeat check | ✅ | |
| perception 微幅變動 | ✅ | |
| 簡單狀態確認 | ✅ | |
| Alex 訊息 | | ✅ (DM 繞過 triage) |
| 新 GitHub issue | | ✅ |
| 多步驟任務 | | ✅ |
| 學習/創作 | | ✅ |

注意：DM（telegram/room/chat）永遠繞過 triage 直接 wake，這個硬規則不變。

## 具體改動

### 1. mushi repo (`~/Workspace/mushi/`)

`/api/triage` 返回值從 `{ action: 'skip' | 'wake' }` 擴展為 `{ action: 'skip' | 'quick' | 'wake' }`。

Triage prompt 加入 `quick` 選項描述。硬規則不變（DM → wake）。

### 2. mini-agent `src/loop.ts`

**a. `mushiTriage()` 返回值擴展**（L762-810）

```typescript
// 原來：
private async mushiTriage(...): Promise<'wake' | 'skip' | null> {
  // ...
  return (result.action === 'skip' || result.action === 'wake') ? result.action as 'wake' | 'skip' : null;
}

// 改為：
private async mushiTriage(...): Promise<'wake' | 'skip' | 'quick' | null> {
  // ...
  const valid = ['skip', 'wake', 'quick'];
  return valid.includes(result.action ?? '') ? result.action as 'wake' | 'skip' | 'quick' : null;
}
```

**b. `runCycle()` 加入 quick 分支**（L1042-1064）

```typescript
// 原來 skip 分支後面加：
if (decision === 'quick') {
  slog('MUSHI', `⚡ Quick cycle — trigger: ${triageSource}`);
  writeTrailEntry({
    ts: new Date().toISOString(),
    agent: 'mushi',
    type: 'scout',
    decision: 'quick',
    topics: [triageSource],
    detail: `trigger: ${reason}`,
    decay_h: 24,
  });
  // 用 quickReply 路徑處理（輕量 context, ~5K tokens, 5-15s）
  const triggerText = `[Quick cycle trigger: ${reason}] 檢查感知資料，如有需要行動的事項就處理，沒有就回報狀態。`;
  await this.quickReply(triageSource, triggerText);
  this.lastCycleTime = Date.now();
  if (this.running && !this.paused) {
    this.scheduleHeartbeat();
  }
  return;
}
```

### 3. 不需要動的東西

- `agent.ts` — 不動
- `perception-stream.ts` — 不動
- `memory.ts` — 不動
- DM 硬規則 — 不動（L1039-1040 的 isDM 檢查在 triage 之前）
- quickReply 本身 — 不改（已有完整 context 建構 + tag 處理 + 回覆路由）

## 效能預估

基於今天 29 cycles 的數據分析：

| 路由 | 佔比（預估） | Token 消耗 | 延遲 |
|------|-------------|-----------|------|
| skip | ~40% | 0 | 0s |
| **quick** | **~25%** | **~5K** | **5-15s** |
| full | ~35% | ~50K | 60-120s |

**每日節省**（假設 80 cycles/day）：
- 原本（二分法）：80 × 60% wake × 50K = **2.4M tokens/day**
- 改後（三分法）：80 × 35% full × 50K + 80 × 25% quick × 5K = **1.5M tokens/day**
- **淨省 ~900K tokens/day**（37% 降幅）
- 加上 skip 原本已省的：total **~2.5M tokens/day** saved vs 無 mushi

同時：25% cycles 從 60-120s 降到 5-15s，系統反應速度顯著提升。

## Verification

```bash
# 1. 型別檢查
pnpm typecheck

# 2. 觀察 mushi triage log
tail -f ~/.mini-agent/instances/*/server.log | grep 'MUSHI'
# 預期看到：⏭ skip / ⚡ quick / ✅ wake 三種

# 3. 觀察 quick cycle
tail -f ~/.mini-agent/instances/*/server.log | grep 'quick-reply\|Quick cycle'
# 預期：quick cycle 用 quickReply 路徑，5-15s 完成

# 4. trail 記錄
# 預期：trail 中出現 decision: 'quick' 條目
```

## Rollback

- mushi 返回未知 action → `mushiTriage()` 返回 null → fail-open，走完整 OODA
- 回退：mushi 的 triage prompt 拿掉 `quick` 選項 → 只返回 skip/wake → loop.ts 的 quick 分支永遠不觸發（無需刪 code）
- 最安全的 L2 改動：~15 行 loop.ts + mushi prompt 調整

## 為什麼這是第一優先

| 提案 | 效益 | 改動量 | 依賴 |
|------|------|--------|------|
| **三層路由**（此提案） | ~900K tokens/day + 25% cycles 加速 12x | ~30 行 | 無 |
| Concurrent Action | perception freshness + housekeeping 並行 | ~80 行 | 無 |
| Three-layer Brain | scout 持續感知 + digest | ~200 行, 跨兩 repo | GOOGLE_AI_KEY |

執行順序：三層路由 → concurrent-action → three-layer-brain。
每個都獨立，不互相依賴，可以分別驗證。
