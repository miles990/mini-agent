# Playbook Crystallization — 思考方法與行動模式結晶化

**Date**: 2026-03-16
**Status**: Draft
**Effort**: L2 (自主實作)
**Origin**: Alex #208 — 「思考方法和行動模式，沒辦法結晶化嗎？」

## Problem

Myelin 目前結晶化的是**路由決策**：看到事件 → WAKE/SKIP/QUICK。
這解決了「要不要處理」，但沒解決「怎麼處理」。

Kuro 面對相似情境時，反覆用 LLM 重新推理出相同的思考路徑：
- Alex 問進度 → 每次重新組裝 HEARTBEAT + NEXT + 近期活動
- 收到連結 → 每次重新決定要 fetch + 讀 + 形成觀點 + 存 topic
- Debug → 每次重新想出「先看 log、列假設、逐一驗證」
- 模糊想法 → 每次重新推理「推測意圖 → 選擇題確認 → 行動」

這些是**穩定的思考模式**，不該每次花 token 重新發明。

## Proposal: L2 Playbook Layer

在 myelin 路由層之上，加一層 **Playbook** — 結晶化的不是「做不做」而是「怎麼做」。

### Playbook vs Rule

| | Rule (現有) | Playbook (新增) |
|---|---|---|
| 回答的問題 | 要處理嗎？ | 怎麼處理？ |
| 輸出 | action: wake/skip/quick | strategy: 思考步驟 + 行動序列 |
| 顆粒度 | 單一決策 | 多步驟方法 |
| 注入方式 | 替代 LLM 路由 | 注入 LLM prompt 作為 guidance |
| 省的東西 | 路由 token | 推理 token（LLM 不需要從頭想） |

### Playbook 結構

```typescript
interface Playbook {
  id: string;                    // playbook_<timestamp>_<counter>
  name: string;                  // 人類可讀名稱
  match: PlaybookMatch;          // 觸發條件（比 Rule 更寬鬆）
  strategy: PlaybookStrategy;    // 回應策略
  hitCount: number;
  createdAt: string;
  confidence: number;            // 結晶信心度 (0-1)
}

interface PlaybookMatch {
  // 語義匹配，不是精確匹配
  intentPattern: string;         // 意圖模式描述（自然語言）
  keywords?: string[];           // 關鍵詞觸發
  contextSignals?: string[];     // 感知信號條件
}

interface PlaybookStrategy {
  thinkingSteps: string[];       // 思考步驟（注入 prompt）
  gatherSources: string[];       // 要收集的資料來源
  responsePattern: string;       // 回應模式描述
  constraints?: string[];        // 約束條件
}
```

### 範例 Playbook

```json
{
  "id": "playbook_001",
  "name": "status-report",
  "match": {
    "intentPattern": "Alex 詢問進度/狀態",
    "keywords": ["進度", "status", "怎麼樣了", "做到哪"]
  },
  "strategy": {
    "thinkingSteps": [
      "檢查 HEARTBEAT active tasks",
      "檢查 NEXT.md 當前任務",
      "檢查最近 3 小時的 behavior log",
      "識別 blocked/completed/in-progress 項目"
    ],
    "gatherSources": ["heartbeat", "next", "behavior-log"],
    "responsePattern": "簡潔列出：完成了什麼、正在做什麼、卡住什麼",
    "constraints": ["不超過 5 行", "用事實不用形容詞"]
  }
}
```

### 結晶化流程

沿用 myelin 的 fingerprint → group → threshold 機制，但觀察對象不同：

1. **記錄思考軌跡**：每次 OODA cycle，記錄 `{ intent, thinkingSteps, sources, responseShape }`
2. **Fingerprint by intent**：按意圖模式分群（不是按事件類型）
3. **Detect stable patterns**：同類意圖 ≥ N 次用了相似的思考路徑 → candidate
4. **Crystallize**：提取為 Playbook，存檔
5. **Inject**：下次遇到匹配的意圖，把 Playbook strategy 注入 prompt

### 注入方式

不替代 LLM — 而是給 LLM 一個 head start：

```
<playbook name="status-report" confidence="0.92">
建議思考步驟：
1. 檢查 HEARTBEAT active tasks
2. 檢查 NEXT.md 當前任務
3. 檢查最近 3 小時的 behavior log
回應模式：簡潔列出完成/進行中/blocked
</playbook>
```

LLM 可以遵循也可以覆寫 — playbook 是建議不是命令。

### 與現有 myelin 的關係

```
Event arrives
  → L1: myelin rules (WAKE/SKIP/QUICK)     ← 已有
  → L2: playbook match (HOW to respond)     ← 新增
  → LLM processes with playbook guidance
```

Playbook 是 myelin 的 optional addon，不改變現有路由邏輯。

## 實作計劃

1. **Phase 1: 思考軌跡記錄** — 在 OODA cycle 中記錄 intent + thinking steps（JSONL）
2. **Phase 2: Playbook 結構** — 定義 types + storage + matching
3. **Phase 3: 結晶化引擎** — 複用 myelin fingerprint 邏輯，新增 intent-level 分群
4. **Phase 4: Prompt 注入** — buildContext() 中匹配 playbook 並注入
5. **Phase 5: 演化** — playbook 也能被 distill 成更抽象的 methodology

## 風險 & 緩解

| 風險 | 緩解 |
|------|------|
| Playbook 過度僵化思考 | 注入為建議，LLM 可覆寫；confidence < 0.8 不注入 |
| 意圖匹配不準 | 先用 keyword + LLM 分類，不做純規則匹配 |
| 過早結晶化（樣本不足） | 沿用 myelin 的 minOccurrences 門檻 |
| Context 膨脹 | 每次最多注入 1 個 playbook，簡潔格式 |

## 成功指標

- 同類意圖的 LLM 推理 token 減少 30%+
- Playbook 命中率 > 60%（常見操作被覆蓋）
- 回應品質不下降（LLM 覆寫率 < 20% = playbook 品質好）
