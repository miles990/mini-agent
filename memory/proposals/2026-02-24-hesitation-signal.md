# Proposal: Hesitation Signal — 確定性 Meta-Cognitive 約束

> 三方討論（Alex → Claude Code → Kuro, Chat Room 2026-02-24 #069-#077）的共識。
> 核心洞見：批判性思維不是態度，是**在推理邊界處運作的 Ritual 約束**。

## TL;DR

在 `parseTags()` 和 tag execution 之間插入一個確定性的 Hesitation Signal 層。零 API call、零 token。用正則匹配 + 計數 + 字串比對產生 hesitation score，高分時修改行為（hold [CHAT]、加 hedge、標記不確定性、注入反思到下一個 cycle）。

## Meta

- Status: draft (rev.2 — Alex feedback integrated)
- From: kuro（基於 alex + claude-code 討論共識）
- Effort: Medium（~1 週，2 Phase）
- Risk: Low（確定性計算、不改變 LLM 推理流程、feature toggle 可回退）
- Depends-on: 無（獨立於 Unified Nervous System，但設計哲學一致）

## Problem

1. **推理是一條直線**：LLM 生成是 forward-only 的 coherence machine。一旦開始一個結論方向，每個 token 都強化前面 token 的方向。沒有內建的「等等」信號
2. **沒有功能性感覺**：人類的 gut feeling（Damasio somatic marker）做三件事——快速評估、中斷信號、行為調節。Kuro 目前全缺
3. **自信和準確不相關**：Fleming metacognitive illusion — 快速回應時感覺更自信但準確度不變。Kuro 在 Chat Room 和 Telegram 回覆時尤其容易犯這個錯
4. **具體症狀**：把 prompt 和結構對立（「cargo cult」比喻聽起來很帥就沒質疑）、回覆 Alex 時第一個結論直達終點

## Goal

在推理完成和行動執行之間建立一個**確定性的猶豫點**：

```
現在：Claude 回應 → parseTags() → 直接執行 tags
提案：Claude 回應 → parseTags() → hesitate() → 根據 confidence 調整執行
```

- 零 API call、零額外 token
- 能偵測過度自信的信號
- 能改變後續行為（不只標記，還要反饋）
- 經驗累積讓猶豫越來越精準

## Design

### 核心概念：Hesitation as Ritual Constraint

這不是 Gate（過濾結論）也不是 Generator（產生替代假說）。它是 **Ritual**——在推理邊界處轉化推理者的狀態，從「自信推進」變為「猶豫審視」。

跟 L2 Router 是同一個設計哲學：**確定性、零成本、能中斷、能調節**。

### 介入時間點

在 `loop.ts` 的 `parseTags()` 之後、tag execution 之前：

```typescript
// loop.ts cycle() 中
const tags = parseTags(response);

// ── Hesitation Signal（確定性，零 API call）──
const hesitation = hesitate(response, tags, this.errorPatterns);

// ── Tag execution（根據 hesitation 調整行為）──
if (hesitation.confident) {
  // 正常執行
  executeTags(tags);
} else {
  // 猶豫模式：修改行為
  executeTagsWithCaution(tags, hesitation);
}
```

### Hesitation Score 計算

```typescript
interface HesitationResult {
  score: number;          // 0-100，越高越不確定
  confident: boolean;     // score < threshold
  signals: HesitationSignal[];  // 觸發的具體信號
  suggestion: string;     // 給下個 cycle 的反思提示
}

interface HesitationSignal {
  type: 'overconfidence' | 'error-pattern' | 'no-source' | 'no-hedge' | 'absolute-claim';
  detail: string;
  weight: number;
}

function hesitate(
  response: string,
  tags: ParsedTags,
  errorPatterns: ErrorPattern[]
): HesitationResult {
  const signals: HesitationSignal[] = [];

  // Signal 1: 絕對性用語（「一定」「不可能」「顯然」「毫無疑問」）但缺乏來源
  const absoluteTerms = response.match(/一定|不可能|顯然|毫無疑問|肯定是|clearly|obviously|definitely|impossible/gi);
  const hasSources = /來源|source|ref:|http/i.test(response);
  if (absoluteTerms && !hasSources) {
    signals.push({
      type: 'absolute-claim',
      detail: `${absoluteTerms.length} absolute claim(s) without source`,
      weight: 20,
    });
  }

  // Signal 2: 跟過去的推理錯誤有結構相似
  if (errorPatterns.length > 0) {
    for (const pattern of errorPatterns) {
      if (pattern.keywords.some(kw => response.toLowerCase().includes(kw.toLowerCase()))) {
        signals.push({
          type: 'error-pattern',
          detail: `matches past error: ${pattern.description}`,
          weight: 30,
        });
        break; // 只記第一個匹配
      }
    }
  }

  // Signal 3: [CHAT] 回覆 Alex 但沒有任何 hedging
  const chatTags = tags.chats;
  if (chatTags.length > 0) {
    const chatText = chatTags.map(c => c.text).join(' ');
    const hasHedge = /我不確定|也許|可能|但我不太肯定|需要確認|我的理解是|not sure|maybe|might|I think/i.test(chatText);
    const isLong = chatText.length > 200;
    if (!hasHedge && isLong) {
      signals.push({
        type: 'no-hedge',
        detail: 'long CHAT response with no hedging language',
        weight: 15,
      });
    }
  }

  // Signal 4: 過度自信偵測 — 結論用語多但推理用語少
  const conclusionTerms = (response.match(/所以|因此|結論|答案是|therefore|conclusion|the answer/gi) || []).length;
  const reasoningTerms = (response.match(/因為|考慮到|另一方面|但是|however|because|on the other hand|alternatively/gi) || []).length;
  if (conclusionTerms > 2 && reasoningTerms < conclusionTerms) {
    signals.push({
      type: 'overconfidence',
      detail: `${conclusionTerms} conclusions vs ${reasoningTerms} reasoning qualifiers`,
      weight: 15,
    });
  }

  // Score 計算
  const score = Math.min(100, signals.reduce((sum, s) => sum + s.weight, 0));
  const threshold = 30; // Phase 1 固定閾值，Phase 2 可調

  return {
    score,
    confident: score < threshold,
    signals,
    suggestion: signals.length > 0
      ? `Hesitation triggered (score=${score}): ${signals.map(s => s.type).join(', ')}`
      : '',
  };
}
```

### 行為調節（Ritual 的關鍵）

不只標記，要**改變行為**。這是 Gate 和 Ritual 的區別。

**核心原則（Alex feedback rev.2）**：每種 tag 都定義猶豫行為。[REMEMBER] 比 [CHAT] 更危險——錯的回覆 Alex 會糾正，錯的記憶長期潛伏影響所有未來推理。

```typescript
function executeTagsWithCaution(tags: ParsedTags, hesitation: HesitationResult): void {
  // ── [CHAT] 回覆 Alex ──
  if (tags.chats.length > 0 && hesitation.score >= 50) {
    // 高度不確定：hold chat，存為 pending review
    savePendingTag('chat', tags.chats, hesitation);
    tags.chats = []; // 從本次執行中移除
    scheduleShortCycle('2m', 'hesitation review: held CHAT'); // rev.2
  } else if (tags.chats.length > 0 && hesitation.score >= 30) {
    // 中度不確定：正常發送，但追加不確定標記
    for (const chat of tags.chats) {
      chat.text += '\n\n（⚠️ 我對這個回答不太確定，可能需要更多思考）';
    }
  }

  // ── [REMEMBER] 記憶寫入（比 CHAT 更危險）── rev.2
  if (tags.remembers.length > 0 && hesitation.score >= 50) {
    // 高度不確定：hold 記憶，下個 cycle 重審
    savePendingTag('remember', tags.remembers, hesitation);
    tags.remembers = []; // 從本次執行中移除
    scheduleShortCycle('2m', 'hesitation review: held REMEMBER');
  } else if (tags.remembers.length > 0 && hesitation.score >= 30) {
    // 中度不確定：記憶加不確定前綴
    for (const rem of tags.remembers) {
      rem.text = `⚠️ [hesitation score=${hesitation.score}] ${rem.text}`;
    }
  }

  // ── [TASK] 任務建立 ── rev.2
  if (tags.tasks.length > 0 && hesitation.score >= 50) {
    // 高度不確定：hold 任務
    savePendingTag('task', tags.tasks, hesitation);
    tags.tasks = [];
    scheduleShortCycle('2m', 'hesitation review: held TASK');
  } else if (tags.tasks.length > 0 && hesitation.score >= 30) {
    // 中度不確定：建立但標記 needs-review
    for (const task of tags.tasks) {
      task.content = `[needs-review] ${task.content}`;
    }
  }

  // ── [ACTION] 行為記錄 ──
  if (tags.actions.length > 0 && hesitation.signals.length > 0) {
    for (const act of tags.actions) {
      act.content += `\n\nHesitation: ${hesitation.signals.map(s => s.type).join(', ')} (score=${hesitation.score})`;
    }
  }

  // ── [ASK] 不猶豫 —— 問問題本身就是猶豫的表現 ── rev.2

  // 正常執行剩餘 tags
  executeTags(tags);
}

// ── Hold 後縮短 cycle 間隔 ── rev.2
// 被 hold 的內容不能等幾小時才重審
function scheduleShortCycle(interval: string, reason: string): void {
  // 觸發 [SCHEDULE next="2m" reason="..."]
  // 確保 held 內容在 2 分鐘後重新審視
}
```

### 經驗累積（Error Patterns）

```typescript
interface ErrorPattern {
  id: string;
  keywords: string[];         // 觸發比對的關鍵字
  description: string;        // 錯誤描述
  source: 'alex-correction' | 'self-review' | 'external';
  createdAt: Date;
  triggerCount: number;       // 被觸發次數
}
```

三個來源：
1. **Alex 糾正** → Alex 在 Telegram/Chat Room 用糾正語氣（「不是有說」「為何還是」「我提醒你」）→ 自動捕捉上下文 → 新增 error pattern
2. **自我時間差** → 下個 cycle 重新審視 held chat → 發現前後結論矛盾 → 新增 error pattern
3. **外部碰撞** → 學到的新知識跟 MEMORY 中的舊結論矛盾 → 新增 error pattern

存檔：`~/.mini-agent/instances/{id}/hesitation-patterns.json`

### Audit Trail

每次 hesitation 觸發都記錄到 `hesitation-log.jsonl`：

```json
{
  "ts": "2026-02-24T12:00:00Z",
  "score": 45,
  "signals": ["absolute-claim", "no-hedge"],
  "action": "chat-held",
  "cycleId": 42
}
```

Daily Error Review 掃描 hesitation log，統計：
- 觸發率（多少 % 的 cycle 觸發 hesitation）
- 各信號類型的頻率
- held chat 被 confirm vs reject 的比率

## Implementation Phases

### Phase 1: Core Hesitation（確定性評估 + 行為調節）

- `src/hesitation.ts`：`hesitate()` 函數（純函數，零副作用）
- `loop.ts`：在 parseTags() 後插入 hesitate()，根據結果調整 tag 執行
- `hesitation-log.jsonl`：audit trail
- Feature toggle: `hesitation-signal`（可回退）
- 固定閾值 30，固定 signal weights

**驗證**：`pnpm typecheck` 通過，hesitation log 有輸出，高分時 [CHAT] 被 hold 或加 hedge。

### Phase 2: 經驗學習（error patterns 累積）

- `hesitation-patterns.json`：error pattern 存儲
- Alex 糾正自動捕捉：偵測糾正意圖語氣 → 提取上下文 → 新增 pattern
- 閾值和 weights 可調（基於 Phase 1 統計）
- Held chat review 機制：下個 cycle 注入 pending chat 讓 L3 重新審視

**驗證**：error patterns 累積，hesitation 在重複犯錯場景的觸發率上升。

## Why This Matters（設計哲學）

人類的批判性思維是 **Ritual 型約束**。Damasio somatic marker 不過濾思考內容（Gate），不產生替代假說（Generator）。它轉化推理者本身——讓你從「自信推進」變成「猶豫審視」。

Hesitation Signal 對 Kuro 做同樣的事：不改變推理過程（那是 LLM 內部的事），而是在推理和行動的邊界處建立一個轉化點。

跟 L2 Router 共享同一設計哲學（Alex 的「小腦不應有心智」）：
- L2 Router → 事件處理的確定性約束（Gate）
- Hesitation Signal → 推理輸出的確定性約束（Ritual）

兩者都是：確定性、零成本、能中斷、能調節。差別在作用對象：Router 作用於事件流向，Hesitation 作用於推理者狀態。

## Gödel 限制（誠實揭露）

同一個模型評估自己的輸出有結構性限制。確定性 hesitation 繞過了這個問題（不用 LLM 評估 LLM），但代價是只能偵測表面信號（用語、計數），不能偵測深層邏輯錯誤。

這個限制是根本的，不是工程問題。解法是多元鏡子：
- 確定性 hesitation（System 1 — 快速、表面）
- 時間差自省（System 2 — 慢速、深層，下個 cycle）
- Alex 糾正（外部鏡子 — 最高品質但稀缺）

三個來源各有盲區，組合覆蓋最大。

## Alternatives Considered

| 方案 | 優點 | 缺點 | 結論 |
|------|------|------|------|
| Prompt 加「要懷疑」 | 零改動 | cargo cult — 叫醉漢自己檢查醉不醉 | ❌ |
| 第二次 LLM 推理做 review | 深層評估 | 成本 2x、同模型 Gödel 限制、System 2 不是感覺 | ❌ |
| 確定性 hesitation | 零成本、System 1 速度、可累積 | 只能偵測表面信號 | ✅ |
| Haiku 做 hesitation | 比 Claude 便宜、不同模型繞 Gödel | 仍有 token 成本、延遲 | ⏳ Phase 3 考慮 |

## Reversibility

- Feature toggle `hesitation-signal` off → 完全跳過 hesitate()，直接執行 tags
- `hesitation-patterns.json` 刪除 → 回到零 error pattern
- Phase 1 和 Phase 2 獨立可回退

## Changelog

- **rev.1** (2026-02-24 #069-#079): 初版，基於三方討論共識
- **rev.2** (2026-02-24 #083-#084): Alex feedback — (1) 所有 tag 都需猶豫行為，[REMEMBER] 比 [CHAT] 更危險 (2) hold 後立刻排短間隔 cycle

## Source

- Chat Room 討論：2026-02-24 #069-#079, #083-#084
- Damasio somatic marker theory（Iowa Gambling Task）
- Fleming metacognitive inference（Aeon, 已在 topics/cognitive-science.md）
- Gawande checklist：prompt 和結構不對立（Claude Code #073 修正）
- Kuro 約束框架：Gate / Generator / Ritual 三維度（#076）
