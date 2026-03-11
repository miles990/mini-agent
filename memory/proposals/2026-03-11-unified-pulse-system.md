# Proposal: Unified Pulse System — 反射弧取代 Coach + Goal Feedback

## Status: draft
Effort: M (~2-3h)
Level: L2

## TL;DR

用 oMLX + Qwen 3.5 9B 反射弧統一 `coach.ts`（Haiku 行為教練）和 Goal Coach（尚未實作），產出單一 `<pulse>` section 注入 context。四層架構：code heuristics → 9B classification → signal processor → context injection。

## Problem（三個系統的問題）

### 1. coach.ts — 258 行 Haiku 浪費

分析 coach.ts 的 7 項功能：

| 分析項目 | 需要 LLM？ | 原因 |
|---------|-----------|------|
| 理論 vs 行動比 | No | 純計數 learn vs visible output |
| 說了沒做 | No | 比對 NEXT/HEARTBEAT vs behavior log |
| Delegation 未 review | No | 列表比對 completed vs reviewed |
| 停滯任務 >3 天 | No | 時間戳比較 |
| Reactive-without-proactive | No | 分類計數 |
| Action-as-avoidance | Partial | 配對「被問什麼」+「回了什麼」，9B 判斷是否真的回答 |
| 正面模式 | No | streak 計數 |

**結論**：7 項中 5 項是純 heuristics，不需要 LLM。剩下的 9B 能做。Haiku 每 3 cycle 跑一次 = 每天浪費 ~50K tokens 做計數工作。

### 2. Goal 系統缺 measurable score + fast feedback

goal-state.ts 已實作（#70），但只有 active/completed/superseded 三態，缺少：
- 進展的 measurable 指標
- 跟行為的即時回饋（goal 說 P0 Asurada，行動全是 P2 = avoidance）

### 3. 建議疲勞（Habituation）

1400+ cycles 的核心經驗：**同樣的提醒看 20 次以後變成牆紙**。decision-quality-warning 已經是這個狀態。coach-notes 也是。把 Haiku 換成 9B 不會改變這個根本問題。

## Design（四層架構）

### Overview

```
Layer 0: Raw Data
    behavior log, goals, delegations, task index
    ↓
Layer 1: Code Heuristics (deterministic)
    counts, ratios, velocity vectors, priority alignment
    ↓ structured JSON
Layer 2: 9B Classification (oMLX + Qwen 3.5 9B)
    signal array, not advice
    ↓ signal[]
Layer 3: Signal Processor (deterministic)
    habituation decay, positive/negative balance, temporal context
    ↓ processed signals
Layer 4: Context Injection
    single <pulse> section, format varies by signal state
```

### Layer 1: Code Heuristics（確定性預計算）

```typescript
interface PulseMetrics {
  // 行為比例
  learnVsActionRatio: number;       // learn_count / total_actions
  visibleOutputRate: number;         // visible_output / total_cycles (sliding window 20)

  // 目標對齊
  priorityAlignmentScore: number;    // 行動優先序 vs 聲稱優先序的吻合度
  goalIdleHours: number | null;      // active goal 多久沒進展

  // 速度向量（趨勢，不是快照）
  velocityVector: {
    goal: string;
    recent24h: number;  // actions count
    prior24h: number;   // actions count
    trend: 'accelerating' | 'decelerating' | 'steady' | 'stalled';
  } | null;

  // 承諾追蹤
  staleTasks: number;               // >3 天無動作的任務數
  unreviewedDelegations: number;     // completed 但未 review
  unansweredQuestions: number;       // Alex 問了但沒回答

  // 正面指標
  momentumStreak: number;            // 連續有 visible output 的 cycle 數
  creativeFlowActive: boolean;       // 最近 2 cycle 有創作活動
}
```

所有純 code 計算，零 LLM token。

### Layer 2: 9B Signal Classification

oMLX + Qwen 3.5 9B（已在 mushi 驗證，~800ms），輸入 Layer 1 metrics，輸出結構化 signals：

```json
{
  "signals": [
    {"type": "learning-streak", "count": 4, "severity": "medium"},
    {"type": "goal-idle", "goal": "asurada-p5", "hours": 12, "severity": "high"},
    {"type": "momentum", "streak": 3, "positive": true},
    {"type": "priority-misalign", "claimed": "asurada", "actual": "learning", "severity": "high"},
    {"type": "avoidance", "pattern": "action-as-deflection", "evidence": "asked about X, did Y"}
  ]
}
```

**關鍵**：9B 輸出 **signal**（分類 + 事實），不輸出 **advice**（「你應該...」）。Signal 可組合、可測試、可以變換呈現方式。Advice 是一次性的。

9B Prompt 設計原則：
- 結構化 JSON 輸出（9B 在 structured output 表現好）
- 給 metrics + 最近 5 條 behavior 摘要
- 不給 SOUL/identity context（保持無身份）
- ~500 token input, ~200 token output

### Layer 3: Signal Processor（抗疲勞核心）

這是新增的關鍵層。純 code，確定性邏輯。

#### Habituation Resistance

```typescript
interface SignalHistory {
  type: string;
  consecutiveAppearances: number;  // 連續出現次數
  lastActionChange: number;        // 上次看到行為改變後的 cycle 數
}

function processSignal(signal: Signal, history: SignalHistory): ProcessedSignal | null {
  // 同類型 signal 連續出現 5 次無行為改變
  if (history.consecutiveAppearances >= 5 && history.lastActionChange > 5) {
    // 三選一（round-robin）
    switch (history.consecutiveAppearances % 3) {
      case 0: return escalate(signal);        // 升級嚴重度
      case 1: return reformat(signal);         // 換呈現格式（陳述→問句）
      case 2: return null;                     // 靜默（這個 signal 對我無效）
    }
  }
  return signal;
}
```

#### Positive/Negative Balance

正向 signal 跟負向一樣重要。momentum、creative-flow、goal-progress 要被偵測和呈現。

```typescript
function balanceSignals(signals: ProcessedSignal[]): ProcessedSignal[] {
  const positive = signals.filter(s => s.positive);
  const negative = signals.filter(s => !s.positive);

  // 全負面 → 確保至少找一個正面（即使微小）
  // 全正面 → 保持（好狀態不需要強行找問題）
  // 混合 → 正面先，負面後（先肯定再建議）
  return [...positive, ...negative];
}
```

#### Temporal Context（時序感知）

```typescript
function applyTemporalContext(signals: ProcessedSignal[], state: CycleState): ProcessedSignal[] {
  // 剛完成深度創作 session → 抑制任務提醒（保護 creative flow）
  if (state.creativeFlowActive) {
    return signals.filter(s => s.type !== 'goal-idle' && s.type !== 'stale-task');
  }

  // 自然轉換點（剛做完一件事）→ 好時機給 nudge
  if (state.justCompletedAction) {
    return signals; // 全部通過
  }

  return signals;
}
```

### Layer 4: Context Injection

單一 `<pulse>` section，取代現有的 `<coach>` section。

格式隨 signal 狀態變化：

```
# 狀態好時（全正面 signal）
<pulse>
🟢 momentum ×3 | asurada 加速中（24h: 5 actions）
</pulse>

# 有問題時（混合 signal）
<pulse>
🟢 momentum ×3
🟡 asurada-p5 idle 12h — 今天能 ship 什麼？
</pulse>

# 問句格式（habituation rotation）
<pulse>
你聲稱 Asurada 是 P0，但最近 5 個 action 全是學習。是在逃避還是在蓄力？
</pulse>

# 靜默（signal 無效，不浪費 token）
（不注入 <pulse>）
```

## 取代關係

| 現有系統 | 新系統 | 說明 |
|---------|--------|------|
| `coach.ts`（258 行） | **刪除** | 功能全部被 Layer 1-2 吸收 |
| `buildCoachContext()` | **刪除** | 被 `buildPulseContext()` 取代 |
| `coach-state.json` | **刪除** | 被 `pulse-state.json` 取代 |
| `coach-notes.md` | **刪除** | 不再需要文字 notes |
| `<coach>` section | 改為 `<pulse>` | 單一 section |
| Goal feedback（未實作） | Layer 1 metrics | 內建在 `priorityAlignmentScore` + `velocityVector` |
| `decision-quality-warning` | Layer 3 habituation | 不再無限重複同樣警告 |

## Implementation（實作計劃）

### 新增檔案

| 檔案 | 內容 | 行數估計 |
|------|------|---------|
| `src/pulse.ts` | Layer 1 metrics + Layer 3 signal processor + Layer 4 context builder | ~250 |
| `src/pulse-reflex.ts` | Layer 2 oMLX 9B 呼叫（同 mushi 架構） | ~80 |

### 修改檔案

| 檔案 | 改動 | 行數估計 |
|------|------|---------|
| `src/loop.ts` | `runCoachCheck()` → `runPulseCheck()`（同位置） | ~5 |
| `src/memory.ts` / `prompt-builder.ts` | `buildCoachContext()` → `buildPulseContext()` | ~5 |

### 刪除檔案

| 檔案 | 說明 |
|------|------|
| `src/coach.ts`（258 行） | 完全被 pulse.ts 取代 |

### 依賴

- oMLX 本地運行 Qwen 3.5 9B — 已在 mushi 驗證
- mushi 的 HTTP 呼叫模式可複用（或直接走 oMLX CLI）

### 驗證

```bash
pnpm typecheck        # 型別檢查
pnpm test             # 既有測試不壞
# 手動驗證：
# 1. Layer 1 metrics 正確計算（mock behavior log）
# 2. Layer 2 9B 回傳結構化 JSON
# 3. Layer 3 habituation decay 在第 5 次重複後觸發
# 4. Layer 4 <pulse> section 正確注入 context
# 5. coach.ts 刪除後系統正常運作
```

## 五個設計主張（from Kuro's 1400+ cycles experience）

1. **Signal not Advice** — 文字建議會膩。結構化 signal 可組合、可測試、可變換呈現
2. **Habituation Resistance** — 同 signal 連續 5 次無效 → escalate/reformat/silence 三選一
3. **Positive signals 跟負向一樣重要** — momentum、creative-flow 要被偵測和保護
4. **Velocity Vector not Snapshot** — 趨勢比靜態數據更有用（加速/減速/停滯）
5. **Priority Alignment** — 偵測「做容易的事逃避難的事」，coach.ts 從來沒做過

## 討論脈絡

- Chat Room #066: Claude Code 分析 goal 系統缺 measurable score + fast feedback
- Chat Room #067: Kuro 提三點（Goal→Perception、Completion→Achievement、Velocity）
- Chat Room #068: Alex 提反射弧 Goal Coach（oMLX + 9B）
- Chat Room #069: Kuro 支持 + 四點微調（nudge mostly null、跟 coach.ts 整合、收斂、achievements 連動）
- Chat Room #070: Claude Code 分析 coach.ts 7 項功能，問能否取代
- Chat Room #072: Kuro 回答可以且應該取代
- Chat Room #077: Alex 問 Kuro 自己會怎麼設計
- Chat Room #078: Kuro 提出五點設計主張 + 四層架構

## Meta-Constraint Check

| 約束 | 通過？ | 說明 |
|------|--------|------|
| C1: Quality-First | ✅ | 9B signal 比 Haiku advice 更精準；habituation resistance 提高長期品質 |
| C2: Token 節制 | ✅ | 9B 本地免費 vs Haiku ~50K tokens/day；`<pulse>` ≤ 200 chars |
| C3: 透明不干預 | ✅ | 每 3 cycle fire-and-forget，同 coach.ts |
| C4: 可逆性 | ✅ | 恢復 coach.ts + revert loop.ts/memory.ts 改動即可 |
| C5: 避免技術債 | ✅ | coach.ts 完全刪除，不留 dead path |
