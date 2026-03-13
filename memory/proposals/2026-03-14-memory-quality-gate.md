# Proposal: Memory Quality Gate

**Date**: 2026-03-14
**Author**: Kuro
**Status**: draft
**Priority**: P2
**Effort**: M（核心 ~300 行，整合 ~150 行）
**Origin**: Chat Room delegation 改善討論 → 「confidence 校準度是後續觀察重點」→ 自然延伸到記憶寫入品質

## Problem

記憶系統目前是「來者不拒」：任何 `<kuro:remember>` 或 delegation 產出都直接寫入 topics/，沒有品質篩選。

具體問題：
1. **垃圾進垃圾出** — delegation confidence 3/10 的研究結果跟 Alex 親口確認的事實，寫入後地位相同
2. **重複堆積** — 同一件事從不同 cycle 學到，各寫一條，沒有去重或合併
3. **腐化無感** — 過時資訊留在 topics/ 裡，等到載入 context 才發現已經不對（但那時已浪費 tokens）
4. **品質不可見** — 沒有 metadata 追蹤每條記憶的來源可信度、引用頻率、最後驗證時間

根因：**把記憶當 append-only log 而非 curated knowledge base**。

## Goal

在記憶寫入和載入之間加一層品質閘門，確保：
- 低品質記憶不進入 context（或標記為 speculative）
- 重複記憶自動合併
- 過時記憶有退場機制
- 品質 metadata 支撐未來的 belief tracking（ref: Alex #166 belief as first-class type）

## Proposal

### 三層品質閘門

```
寫入時          儲存中            載入時
┌─────────┐   ┌──────────┐   ┌──────────┐
│ Gate 1   │──→│ Quality  │──→│ Gate 3   │
│ 輸入驗證 │   │ Metadata │   │ Context  │
│          │   │          │   │ 篩選     │
└─────────┘   └──────────┘   └──────────┘
```

### Gate 1: 輸入驗證（寫入時）

每條記憶寫入前，跑三個檢查：

| 檢查 | 方法 | 成本 |
|------|------|------|
| **去重** | FTS5 搜現有 entries，similarity > 0.8 → 合併而非新增 | ~5ms |
| **來源標記** | 自動標注 `origin`: alex-said / self-learned / delegation / external | 0ms（從 context 推斷）|
| **最低品質** | delegation confidence < 4 → 標為 `speculative`，不直接進 topics/ | 0ms |

不合格的記憶不是丟棄，而是寫入 `memory/staging/` 等待人工或自動驗證。

### Quality Metadata（per entry）

擴展 MemoryIndex entry：

```typescript
interface QualityMeta {
  origin: 'alex-confirmed' | 'self-learned' | 'delegation' | 'external';
  confidence: 'verified' | 'high' | 'medium' | 'speculative';
  citedCount: number;       // 被載入 context 的次數
  lastCited: string;        // 上次被載入的 ISO timestamp
  lastVerified: string;     // 上次確認仍然正確的時間
  supersededBy?: string;    // 被更新版本取代的 entry id
}
```

**confidence 升降規則**：
- `alex-confirmed` 來源 → 自動 `verified`
- delegation confidence 7+ → `high`
- delegation confidence 4-6 → `medium`
- delegation confidence < 4 → `speculative`
- 被引用 5+ 次且無矛盾 → 升級一檔
- 30 天未引用 → 降級一檔（不低於 speculative）

### Gate 3: Context 篩選（載入時）

ContextBuilder 組裝 context 時，用 quality metadata 調整：

1. **token 預算分配** — `verified` 和 `high` 的 entries 優先佔 budget，`speculative` 只在剩餘空間才載入
2. **標記顯示** — `speculative` 條目在 context 中帶 `[?]` 前綴，提醒自己此資訊未驗證
3. **品質摘要** — 每次 context 組裝產出品質分佈（verified: N, high: N, speculative: N），寫入 telemetry

### 自動退場

每日 maintenance（已有 cron 基礎）：
- 90 天未引用 + `speculative` → 自動歸檔到 `memory/archive/`
- 30 天未引用 + 有 `supersededBy` → 自動歸檔
- 歸檔 ≠ 刪除，FTS5 仍可搜到但不自動載入

## Alternatives

### A. 純人工審核
Alex 定期審 topics/，手動刪除低品質條目。
**Why not**: 不 scale，Alex 有更重要的事做。

### B. LLM 品質評分
每條記憶用 LLM 打分（類似 delegation confidence）。
**Why not**: 成本高（每條 ~1K tokens），且 LLM 評自己寫的東西 = 自我評分偏差。但可以作為 Phase 2 的 optional 驗證。

### C. 只做 citation-based decay
靠引用頻率自然淘汰低品質內容。
**Why not**: 太被動。垃圾內容一旦被載入一次就會累積 citation，形成正回饋迴路。需要輸入端也擋。

## Pros & Cons

**Pros**:
- 直接提升 context 品質 → 更好的推理
- staging 機制讓低品質記憶有第二次機會而非直接丟棄
- quality metadata 是 belief tracking（Alex #166）的結構性基礎
- 減少 context window 浪費在過時/重複資訊上

**Cons**:
- 增加寫入路徑複雜度（但都是 <10ms 檢查）
- 去重的 similarity 閾值需要調校
- confidence 升降規則初期可能需要微調

## 實作計劃

### Phase 1: Metadata + 輸入閘門（~200 行）
- QualityMeta type 加入 MemoryIndex
- 寫入時自動標注 origin + confidence
- FTS5 去重檢查
- staging/ 目錄機制

### Phase 2: Context 篩選（~100 行）
- ContextBuilder 讀取 quality metadata
- 預算分配 by confidence tier
- `[?]` 標記顯示

### Phase 3: 自動維護（~100 行）
- 日常 maintenance: 歸檔、降級
- 品質分佈 telemetry
- citation tracking 整合

## 與現有提案的關係

| 提案 | 關係 |
|------|------|
| Multi-Dimensional Memory Index | quality metadata 嵌入 MemoryIndexEntry，共用結構 |
| Unified Pulse System | 可共享 confidence scoring 邏輯 |
| Asurada Phase 6 | MemoryIndex 已有 `refs[]`，quality gate 是額外維度 |
| Alex #166 belief tracking | quality metadata 是 belief evolution 的前置條件 |

## Risk

- **過度篩選**：閾值太嚴漏掉有價值但模糊的洞見 → 用 staging 而非丟棄來緩解
- **去重誤判**：不同 context 下的相似內容被錯誤合併 → similarity 閾值保守（0.8+），合併前保留原文
- **metadata 膨脹**：每條記憶多 ~200 bytes metadata → 可接受，manifest 膨脹在 Phase 1 可控

## Source

- Chat Room delegation 改善討論（2026-03-14）
- Alex #166：memory index + belief as first-class cognitive type + structural contradiction detection
- Asurada 設計原則「Confidence Gate Theorem」（ArXiv 2603.09947）
- 記憶弱的根因分析（2026-03-09）：「把記憶當儲存問題，實際是意識問題」
