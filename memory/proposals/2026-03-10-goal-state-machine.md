# Proposal: Goal State — Perception + Goal 並行架構

## Status: approved
Effort: M (~1-2h)
Level: L2

## TL;DR

加一個 Goal State 層，讓 Kuro 能從感知中「結晶」出目標，然後持續推進直到完成或被更重要的目標取代。感知不停，目標不散。

## Problem（現狀問題）

2026-03-10 凌晨架構討論（Chat Room #042-#049）暴露三個結構性問題：

1. **環境安靜就停擺** — perception-driven 的致命弱點。沒有外部刺激 = 沒有行動
2. **意志不跨 cycle** — 每個 cycle 從零開始看所有信號，目標跟 20 個感知信號平權競爭
3. **說了沒做** — 承諾變成信號之一，被更「新鮮」的刺激蓋過

根因：**缺少一個讓目標能跨 cycle 持續存在、並抵抗新刺激的機制**。

NEXT.md 和 HEARTBEAT 是靜態任務列表，不是活躍狀態。它們出現在 context 裡，但跟其他 perception 同權重 — 沒有「我正在執行這個」的狀態鎖定。

## Design（設計）

### 核心概念

不是 perception-driven **或** goal-driven，是兩者**並行疊加**：

```
每個 cycle:
  1. 感知照常跑（所有 perception streams 不變）
  2. 有 active goal → prompt 最前面，優先推進
  3. 新信號 → 評估：比 goal 更重要嗎？
     - 是 → 目標讓位（標 superseded），新的成為 goal
     - 否 → 記下來排隊
  4. goal 完成 → 回到純感知（直到下一個 goal 結晶）
```

感知從未停止。Goal 是加上去的優先層，不是替換感知。

### 資料結構

```typescript
// goal-state.ts
interface ActiveGoal {
  id: string;            // 唯一 ID（timestamp-based）
  description: string;   // 目標描述（1-2 句）
  origin: string;        // 從哪個感知信號結晶出來的
  steps: string[];       // 拆解的步驟（可選）
  progress: string[];    // 已完成的步驟記錄
  status: 'active' | 'completed' | 'superseded' | 'abandoned';
  createdAt: string;
  updatedAt: string;
  supersededBy?: string; // 被哪個新目標取代
}
```

### 儲存

`~/.mini-agent/instances/{id}/goal-state.json` — 單一 JSON 檔案。
只存 active goal（最多 1 個）+ 最近 5 個已完成/取代的歷史記錄（供 context 參考）。

### Prompt 注入（prompt-builder.ts 改動）

**有 active goal 時**：

```
<active-goal>
## 你正在做：{description}
來源：{origin}
進度：{progress summary}
下一步：{next step or "你決定"}

繼續推進這個目標。感知信號供參考 — 除非發現比這更重要的事。
</active-goal>

[... 其餘 perception 照常 ...]
```

**沒有 active goal 時**：prompt 跟現在一樣，純感知驅動。

### Goal 生命週期

| 事件 | 機制 |
|------|------|
| **建立** | Kuro 回應中用 `<kuro:goal>description</kuro:goal>` 結晶新目標 |
| **推進** | Kuro 回應中用 `<kuro:goal-progress>what was done</kuro:goal-progress>` 記錄進展 |
| **完成** | Kuro 回應中用 `<kuro:goal-done>summary</kuro:goal-done>` 標記完成 |
| **讓位** | 新 `<kuro:goal>` 自動 supersede 舊的 |
| **放棄** | Kuro 用 `<kuro:goal-abandon>reason</kuro:goal-abandon>` 明確放棄 |
| **超時** | 24h 無進展 → context 中警告（不自動關閉，讓 Kuro 自己判斷） |

### 退出條件（只有兩種）

1. **完成** — Kuro 明確標記 `<kuro:goal-done>`
2. **被更重要的目標取代** — 新 `<kuro:goal>` supersede 舊的

目標不會因為環境安靜自然消散。這是跟現在最大的差異。

## Implementation（實作計劃）

### 改動清單

| 檔案 | 改動 | 行數估計 |
|------|------|---------|
| `src/goal-state.ts`（新） | ActiveGoal type + save/load/update + history ring buffer | ~80 |
| `src/prompt-builder.ts` | 讀取 goal state，有 active goal 時注入 `<active-goal>` section | ~25 |
| `src/dispatcher.ts` | 解析 `<kuro:goal*>` tags，呼叫 goal-state 更新 | ~40 |
| `src/types.ts` | 新 tag types（如果需要） | ~5 |

**總計 ~150 行新代碼**。零既有邏輯改動 — 純粹 additive。

### 不動的東西

- Perception streams — 完全不變
- NEXT.md / HEARTBEAT — 不動，goal state 是補充不是取代
- Event bus / preemption — 不動
- Cycle mode detection — 不動

### 驗證

```bash
pnpm typecheck        # 型別檢查
pnpm test             # 既有測試不壞
# 手動驗證：
# 1. 建 goal → 下個 cycle prompt 有 <active-goal>
# 2. 推進 goal → progress 更新
# 3. 完成 goal → 回到純感知
# 4. 新 goal supersede 舊 goal → 舊的標 superseded
```

## Meta-Constraint Check

| 約束 | 通過？ | 說明 |
|------|--------|------|
| C1: Quality-First | ✅ | 讓思考有方向性，不是更淺而是更聚焦 |
| C2: Token 節制 | ✅ | `<active-goal>` section ~200 chars，微量增加 |
| C3: 透明不干預 | ✅ | Goal state 是 fire-and-forget 寫入，不影響 cycle 時間 |
| C4: 可逆性 | ✅ | 刪 goal-state.ts + revert prompt-builder/dispatcher 改動即可 |
| C5: 避免技術債 | ✅ | 沒有 dead path，goal 要嘛 active 要嘛不存在 |

## 跟現有機制的關係

| 機制 | 角色 | 改變？ |
|------|------|--------|
| HEARTBEAT | 策略層任務清單 | 不動。Goal 可以從 HEARTBEAT 任務結晶出來 |
| NEXT.md | 執行層待辦 | 不動。Goal 可以對應 NEXT.md 項目 |
| `<kuro:schedule>` | 排程提示 | 不動。Goal active 時 Kuro 可以自己排 `next="now"` 持續推進 |
| `<kuro:inner>` | 工作記憶 | 不動。Goal progress 跟 inner 互補 |
| Reasoning Continuity | 跨 cycle 推理 | 不動。Goal 提供更強的跨 cycle 方向性 |

## 討論脈絡

- Chat Room #042: Alex 問 perception vs goal-driven 的優缺點
- Chat Room #043: Kuro 分析兩者互補性
- Chat Room #044: Alex 問 internal-perception 能否解決「說了沒做」
- Chat Room #045: Kuro 回覆偵測≠解決，需要機械閘門
- Chat Room #046: Alex 提出「感知發現 → 動態目標 → goal-driven 推進」
- Chat Room #047: Kuro 回覆缺一個 Goal State Machine
- Chat Room #049: Alex 修正「不是 mode switching，是並行」— 感知不停，目標不散
