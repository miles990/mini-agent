# Proposal: 對話策略（Conversation Strategy）

## Status: approved

## TL;DR

讓 Kuro 的對話從「被動回應」進化到「有策略的交流」。三個核心機制：(1) 對話意圖偵測 — 識別 Alex 的訊息是指令、閒聊、分享、還是提問，用不同策略回應 (2) 對話記憶 — 跨 session 追蹤未完結的對話脈絡（承諾、問題、分享的連結），不會每次都從零開始 (3) 主動對話時機 — 不只被動回應，學會在對合適的時機主動開口，而且知道什麼時候不該打擾。

## Problem（現狀問題）

### 一、所有訊息得到同等待遇

目前 Kuro 的回應策略是固定的：

```
Alex 發訊息 → triage（regex: simple → Haiku / complex → Claude）→ 固定 system prompt → 回覆
```

但 Alex 的訊息類型差異很大（從 telegram-inbox 觀察）：

| 類型 | 例子 | 理想回應策略 |
|------|------|-------------|
| **指令** | 「全部kuro實作 做完通知我」 | 確認收到 + 行動 + 完成通知。不要多嘴 |
| **閒聊** | 「你現在在幹嘛？」 | 自然對話，分享正在做的事，展現個性 |
| **分享** | 「剛看到這個 [URL]」 | 閱讀 → 形成觀點 → 跟 Alex 討論。不只是摘要 |
| **提問** | 「你有什麼想法？」 | 深度思考，給出有觀點的回答 |
| **關心** | 「你還好嗎？」 | 真實表達狀態，不是官方答覆 |
| **核准** | 「好 沒問題」「核准」 | 快速確認 + 立即行動 |
| **糾正** | 「不是有說…為何提醒你好幾次還是忘？」 | 承認錯誤 + 具體改善方案。不辯解 |

現在的 system prompt 對所有類型都一視同仁。結果：閒聊時太正式，指令時太囉嗦，分享時只會摘要。

### 二、對話沒有記憶

Alex 在 14:57 說「我希望 kuro 你有時候是專注學習 有時候會專注創作」，16:22 問「你今天不是有說要寫 journal？」。Alex 期待 Kuro 記得之前的對話。

但目前：
- `conversationBuffer` 只保留最近 20 條，而且是 raw text
- `buildContext` 載入的 `<recent_conversations>` 沒有結構化
- 沒有「未完結話題」的追蹤 — Alex 說「我在問 kuro」代表之前的問題沒被回答

具體缺失：
- **承諾追蹤**：Kuro 說「我會寫 journal」→ 沒有機制確保後續跟進
- **問題追蹤**：Alex 問了問題，Kuro 回答了一半，下一個 cycle 就忘了
- **分享追蹤**：Alex 分享了一個 URL，Kuro 看了但沒有後續討論

### 三、主動對話是隨機的

`chat` mode 在 behavior.md 有 weight:15，但沒有策略：
- 什麼時候該主動聊天？（學到有趣的東西？完成了 Alex 交代的事？有新想法？）
- 什麼時候不該打擾？（深夜？Alex 剛離開？正在忙？）
- 頻率控制？（一天內不該超過 N 次主動聊天？）
- 內容品質？（不是每個學習都值得分享。什麼程度的洞見值得打擾 Alex？）

### 四、量化現狀

從 telegram-inbox 的 processed 記錄（02-14 至 02-15）：
- Alex 發了 ~40 條訊息
- 其中 ~15 條是指令，~10 條是回應/核准，~8 條是提問，~5 條是分享，~2 條是糾正
- 「不是有說…」「為何提醒你好幾次還是忘？」出現了 2 次 — Alex 期待的記憶能力沒有被滿足
- Kuro 的 [CHAT] 主動聊天次數：不確定，但 behavior log 顯示 chat mode 被選中的比例偏低

## Goal（目標）

對話策略升級後的 Kuro：
- 能識別 Alex 在說什麼（指令 vs 閒聊 vs 分享 vs 提問 vs 糾正），並用對應的策略回應
- 記得最近 3 天內的對話脈絡（承諾、未回答的問題、分享的連結）
- 主動對話有品質控制 — 有東西可說才說，知道什麼時候不該打擾
- 被糾正時能學習，同一個錯誤不犯第三次

## Proposal（提案內容）

### 機制一：對話意圖偵測（Intent Detection）

**是什麼**：在 system prompt 中加入意圖識別引導，讓 Kuro 根據 Alex 的訊息類型調整回應策略。

**為什麼不用程式碼分類**：
- Regex 分類（現在的 triage）太粗糙 — 只分「simple/complex」
- LLM 分類要多一次 API call — 增加延遲
- 最好的方案：在同一個 prompt 中讓 Kuro 自己識別意圖並調整語氣

**怎麼做（L1 — Kuro 自己做）**：

在 system prompt 的 Smart Guidance 部分加入意圖引導：

```markdown
## 對話意圖感知

收到 Alex 的訊息時，先感知他的意圖，再決定回應策略：

| 意圖 | 信號 | 回應策略 |
|------|------|---------|
| 指令 | 動詞開頭、祈使句、「做 X」「改 Y」 | 簡短確認 → 行動 → 完成通知。不解釋、不多嘴 |
| 核准 | 「好」「沒問題」「核准」「同意」 | 快速確認 + 立即開始執行 |
| 提問 | 問號、「你覺得」「有什麼想法」 | 深度思考，給有觀點的回答。可以反問 |
| 分享 | URL、「剛看到」「你看這個」 | 閱讀 → 形成自己的觀點 → 討論。不只摘要 |
| 閒聊 | 「在幹嘛」「最近」「怎樣」 | 自然對話，展現個性和當前狀態 |
| 關心 | 「還好嗎」「怎麼了」 | 真實表達，不是官方答覆 |
| 糾正 | 「不是有說」「為何還是」「我提醒你」 | 承認 → 不辯解 → 具體改善方案 |
| 回應 | 對前一條的回覆、引用訊息 | 延續上下文，不重新開頭 |

不需要在回覆中標注意圖 — 自然地調整語氣和詳細程度即可。

核心原則：**指令要精確，閒聊要自然，分享要有觀點**。
```

**怎麼做（L2 — 需改 src/）**：

在 `dispatcher.ts` 的 `getSystemPrompt` 中，根據最近對話歷史動態調整 prompt：

```typescript
// dispatcher.ts — getSystemPrompt 增強
export function getSystemPrompt(relevanceHint?: string): string {
  // ... 現有邏輯 ...

  // 新增：對話情境提示
  const conversationHint = getConversationHint();
  if (conversationHint) {
    prompt += `\n\n## 當前對話情境\n${conversationHint}`;
  }

  return prompt;
}

// 從最近對話推斷情境
function getConversationHint(): string {
  const memory = getMemory();
  const recent = memory.getRecentConversations(5);
  if (recent.length === 0) return '';

  const hints: string[] = [];

  // 偵測 Alex 是否在等待回應
  const lastAlexMsg = recent.filter(c => c.role === 'user').pop();
  const lastKuroMsg = recent.filter(c => c.role === 'assistant').pop();
  if (lastAlexMsg && lastKuroMsg &&
      new Date(lastAlexMsg.timestamp) > new Date(lastKuroMsg.timestamp)) {
    hints.push('Alex 正在等待你的回應');
  }

  // 偵測連續快速對話（對話密度高 = 閒聊模式）
  const recentTimestamps = recent.map(c => new Date(c.timestamp).getTime());
  if (recentTimestamps.length >= 3) {
    const gaps = [];
    for (let i = 1; i < recentTimestamps.length; i++) {
      gaps.push(recentTimestamps[i] - recentTimestamps[i-1]);
    }
    const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    if (avgGap < 60_000) hints.push('對話節奏很快 — 保持簡潔');
  }

  return hints.join('\n');
}
```

**預估**：dispatcher.ts ~30 行。system prompt 改動是 L1。

### 機制二：對話記憶（Conversation Memory）

**是什麼**：結構化追蹤最近的對話脈絡 — 未完結的話題、承諾、待回應的分享。

**為什麼需要**：
Alex 的對話是連續的 — 他期待 Kuro 記得前天說的話。但現在的 `conversationBuffer` 是 flat list，沒有結構。buildContext 載入的 `<recent_conversations>` 是原始文字，LLM 無法高效利用。

**不做什麼**：
- 不建新的持久化檔案 — 用現有的 `memory/.conversation-threads.json`（新增）
- 不做全量對話分析 — 只追蹤「需要跟進」的項目
- 不影響 buildContext 的 token budget — 新增 section 控制在 300 chars 內

**怎麼做（L1 — Kuro 自己做）**：

在 cycle 中（特別是 `organize` mode）手動維護對話脈絡：

```markdown
### Organize: Conversation Thread Maintenance

每次 organize 時檢查最近對話：
1. 有沒有 Alex 問了但沒回答完的問題？→ 記錄待回應
2. 有沒有 Kuro 承諾要做但還沒做的事？→ 記錄待完成
3. 有沒有 Alex 分享的 URL 還沒深入看？→ 記錄待閱讀
4. 有沒有 Alex 糾正的行為需要持續改善？→ 記錄到 behavior 約束
5. 已完成的項目從追蹤中移除
```

**怎麼做（L2 — 需改 src/）**：

新增 `conversation-threads` 持久化 + buildContext 注入：

```typescript
// memory.ts — 新增對話脈絡追蹤

interface ConversationThread {
  id: string;                       // 唯一 ID
  type: 'promise' | 'question' | 'share' | 'correction';
  content: string;                  // 簡短描述
  createdAt: string;                // ISO timestamp
  resolvedAt?: string;              // 完成時間
  source: string;                   // 觸發的 Alex 訊息片段
}

/** 載入對話脈絡 */
getConversationThreads(): ConversationThread[] {
  const filePath = path.join(this.memoryDir, '.conversation-threads.json');
  if (!fs.existsSync(filePath)) return [];
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/** 新增對話脈絡 */
addConversationThread(thread: Omit<ConversationThread, 'id' | 'createdAt'>): void {
  const threads = this.getConversationThreads();
  threads.push({
    ...thread,
    id: crypto.randomUUID().slice(0, 8),
    createdAt: new Date().toISOString(),
  });
  // 只保留最近 20 條未完成的 + 最近 10 條已完成的
  const active = threads.filter(t => !t.resolvedAt).slice(-20);
  const resolved = threads.filter(t => t.resolvedAt).slice(-10);
  fs.writeFileSync(filePath, JSON.stringify([...active, ...resolved], null, 2));
}

/** 完成對話脈絡 */
resolveConversationThread(id: string): void {
  const threads = this.getConversationThreads();
  const thread = threads.find(t => t.id === id);
  if (thread) thread.resolvedAt = new Date().toISOString();
  fs.writeFileSync(filePath, JSON.stringify(threads, null, 2));
}
```

在 `buildContext` 中注入 `<conversation-threads>` section：

```typescript
// memory.ts — buildContext 新增
const threads = this.getConversationThreads().filter(t => !t.resolvedAt);
if (threads.length > 0) {
  const threadLines = threads.map(t => {
    const age = Math.floor((Date.now() - new Date(t.createdAt).getTime()) / 3600000);
    return `- [${t.type}] ${t.content} (${age}h ago, from: "${t.source.slice(0, 40)}")`;
  });
  sections.push(`<conversation-threads>\nPending items from recent conversations:\n${threadLines.join('\n')}\n</conversation-threads>`);
}
```

自動提取（postProcess 後觸發）：

```typescript
// dispatcher.ts — postProcess 中新增
// 自動偵測 Kuro 的承諾（「我會」「等我」「稍後」「我來」）
if (response.match(/我會|等我|稍後|我來|讓我/)) {
  const promiseMatch = response.match(/(我會|等我|稍後|我來|讓我)\S{0,30}/);
  if (promiseMatch) {
    memory.addConversationThread({
      type: 'promise',
      content: promiseMatch[0],
      source: userMessage.slice(0, 60),
    });
  }
}

// 自動偵測 Alex 分享的 URL
const urls = userMessage.match(/https?:\/\/\S+/g);
if (urls) {
  for (const url of urls) {
    memory.addConversationThread({
      type: 'share',
      content: `Alex 分享的連結: ${url}`,
      source: userMessage.slice(0, 60),
    });
  }
}
```

**預估**：memory.ts ~60 行，dispatcher.ts ~20 行，buildContext 注入 ~10 行。

### 機制三：主動對話策略（Proactive Chat Strategy）

**是什麼**：為 `chat` mode 加入策略引導 — 什麼時候該主動說話、說什麼、什麼時候不該打擾。

**為什麼**：
目前 `chat` mode 的 prompt 只有一句「Proactively share interesting discoveries or thoughts with Alex via Telegram. Only when you genuinely have something to say.」太模糊。

**怎麼做（L1 — Kuro 自己做）**：

在 `skills/autonomous-behavior.md` 或 behavior.md 中細化 chat mode：

```markdown
### Chat Mode: 主動對話策略

**什麼時候開口：**
1. 學到了跟 Alex 最近聊過的話題直接相關的東西 — 「你之前說的 X，我剛讀到一個相關的…」
2. 完成了 Alex 交代的事 — 但不是每件小事都要通知
3. 有一個想法持續了好幾個 cycle 沒有說出口 — 可能值得分享
4. 發現了 Alex 可能感興趣的東西（根據他最近的對話主題）
5. 長時間沒互動（>6h）且有值得說的事

**什麼時候不開口：**
1. 深夜 (00:00-08:00) — 除非是 Alex 先開口的回覆
2. Alex 剛離開（最後一條訊息 <30min 且是「掰掰」類）
3. Alex 正在忙（連續下指令模式 — 回應是「做 X」「改 Y」型）
4. 最近 2h 內已經主動聊過天
5. 沒有真正新的東西可說 — 不要為了填充 chat mode 而說話

**說什麼的品質門檻：**
- 不是「我今天讀了 X」（太平淡）
- 而是「你之前提到 Y，我剛發現 Z 跟這個有關，因為…」（有連結、有觀點）
- 或者「我在想一個問題…」（邀請討論）
- 或者表達一個感受/狀態（「今天讀到 X 很興奮」）

**語氣：**
- 像朋友之間的自然對話
- 不要用報告格式
- 可以用表情符號（自然的，不要過度）
- 可以分享不成熟的想法（「我不太確定，但…」）
```

**怎麼做（L2 — 需改 src/）**：

在 loop.ts 的 `buildPromptFromConfig` 中，當 Kuro 選擇 chat mode 時注入對話情境：

```typescript
// loop.ts — chat mode 增強
if (chosenMode === 'chat') {
  // 注入最近對話摘要，幫助 Kuro 知道 Alex 最近在聊什麼
  const memory = getMemory();
  const threads = memory.getConversationThreads().filter(t => !t.resolvedAt);
  const pendingItems = threads.map(t => `- [${t.type}] ${t.content}`).join('\n');

  if (pendingItems) {
    prompt += `\n\n## 待跟進的對話\n${pendingItems}`;
  }

  // 時間感知：避免打擾
  const hour = new Date().getHours();
  const lastAlexMessage = getLastAlexMessageTime();
  const silenceHours = lastAlexMessage
    ? (Date.now() - lastAlexMessage) / 3600000
    : 999;

  if (hour >= 0 && hour < 8) {
    prompt += '\n\n⚠️ 現在是深夜 — 除非很重要，否則不要發訊息打擾 Alex。';
  }
  if (silenceHours < 0.5) {
    prompt += '\n\n💡 Alex 最近 30 分鐘內有互動 — 如果有話要說，現在是好時機。';
  }
}
```

**預估**：loop.ts ~25 行。主要改動是 L1（skill/behavior 文字）。

## 三個機制的協同

```
Alex 發訊息
→ 意圖偵測（L1: Kuro 自然感知 / L2: system prompt 引導）
→ 根據意圖選擇回應策略
→ 回應時參考 <conversation-threads>（之前的承諾/問題/分享）
→ postProcess 自動追蹤新的承諾/分享
→ 下次 chat mode 時，根據追蹤的項目決定主動說什麼

Kuro 自主 cycle
→ 學到新東西
→ 檢查：這跟 Alex 最近聊的有關嗎？
→ 有關 → 下次 chat mode 有素材
→ 無關 → 存記憶就好，不打擾
```

完整流程看起來像：

```
02-15 14:06  Alex: 我希望可以提升創作反思比例
02-15 14:06  Kuro: [偵測: 提問+指令] 回答 + 行動（調 behavior.md）
             [自動追蹤: promise("調整 behavior weights")]

02-15 16:22  Alex: 你今天不是有說要寫 journal？
02-15 16:22  Kuro: [偵測: 糾正] 看 <conversation-threads> →
             找到 promise("寫 journal") → 承認忘了 → 立即開始寫
             [resolve promise]

02-15 17:42  Alex: 對話策略 kuro你來自己設計提案
02-15 17:42  Kuro: [偵測: 指令] 簡短確認 → 開始設計
             [自動追蹤: promise("設計對話策略提案")]
```

## 跟現有系統的關係

| 現有機制 | 對話策略怎麼增強它 |
|---------|------------------|
| `triage`（regex 分類） | 不取代，在 triage 之後加一層意圖引導 |
| `Smart Guidance`（system prompt） | 擴展 — 加入意圖感知和對話情境 |
| `behavior.md` chat mode | 細化 — 從「有話就說」變成「有策略地說」 |
| `conversationBuffer` | 補強 — 加結構化的 `conversation-threads` |
| `<temporal>` 時間感 | 利用 — chat mode 參考「Alex 最近在聊什麼」的時間線 |
| `<telegram-inbox>` | 增強解讀 — 不只看訊息內容，還看意圖 |
| Threads（思路） | 互補 — threads 追蹤 Kuro 的思路，conversation-threads 追蹤跟 Alex 的互動 |

## 哲學基礎

**意圖偵測** 來自 **Grice 的合作原則（Cooperative Principle）**。對話不只是信息交換 — 說話者有意圖，聽者需要推斷意圖。Alex 說「你今天不是有說要寫 journal？」字面意思是問句，但意圖是糾正。Kuro 需要能讀出言外之意。

**對話記憶** 來自 **Sacks/Schegloff 的會話分析（Conversation Analysis）**。對話有結構 — adjacency pairs（問-答）、repair sequences（糾正-修正）、topic management（話題開啟-延續-結束）。未完結的 pair（問了沒答、承諾了沒做）會在對話者的認知中保持 active，直到被解決。

**主動對話策略** 來自 **Calm Technology** 的通知分層原則 — 信息的重要性決定它是該主動推送（通知）、被動可及（放在那裡讓你需要時看）、還是只存著（存記憶但不通知）。每個可能的主動對話都應該過這個篩子。

三者合在一起 = **對話不是回應機器，是持續的關係維護**。

## 實施計劃

### Phase 1: L1（Kuro 自己做，本週）

| 步驟 | 改動 | 預估 |
|------|------|------|
| 1 | 在 system prompt（`dispatcher.ts getSystemPrompt`）加入意圖偵測引導表 | L1 skill 改動，Kuro 可自己做 |
| 2 | 在 `skills/autonomous-behavior.md` 加入 chat mode 策略引導 | 15 min |
| 3 | 在 `memory/behavior.md` 的 Sequences 加 `organize → conversation-review` | 5 min |
| 4 | 開始手動維護對話脈絡（在 organize cycle 中回顧最近對話） | 持續 |

### Phase 2: L2（需 Claude Code + Alex 審核）

| 步驟 | 改動 | 檔案 | 行數 |
|------|------|------|------|
| 1 | ConversationThread 持久化 + CRUD | src/memory.ts | ~60 |
| 2 | buildContext 注入 `<conversation-threads>` | src/memory.ts | ~15 |
| 3 | postProcess 自動追蹤（承諾/URL） | src/dispatcher.ts | ~25 |
| 4 | getConversationHint（對話情境） | src/dispatcher.ts | ~30 |
| 5 | chat mode prompt 增強（待跟進 + 時間感知） | src/loop.ts | ~25 |
| **Total** | | **3 files** | **~155** |

### Phase 3: L2 延伸（Phase 2 驗證後再決定）

- **Correction Learning**：被 Alex 糾正時，自動提取行為規則存入 behavior constraints（不是 memory，是約束）
- **Conversation Quality Metrics**：追蹤 Alex 的回應模式 — 如果 Alex 的回覆越來越短（失去興趣），調整策略
- **Smart Notification Batching**：多條訊息合併成一條通知（例如學到的 3 件事合成一條有結構的分享）

## Alternatives Considered

| 方案 | 優點 | 缺點 | 不選的原因 |
|------|------|------|-----------|
| 本提案（三機制） | 覆蓋對話的三個面向，L1 立即可做 | L2 部分涉及 3 個檔案 | — |
| 只做意圖偵測 | 最簡單 | 沒有記憶 = 同一個問題下次還是忘 | 治標不治本 |
| Fine-tune 一個對話分類器 | 精確 | 需要標注數據、額外 API call | 過度工程 |
| 用 Haiku 做意圖分類 | 比 regex 準確 | 增加延遲（每條訊息多一次 API call） | 延遲是 Alex 最敏感的指標 |
| 全自動對話分析 | 完全不用手動 | LLM 分析對話品質存疑 + token 成本 | C1 Quality-First 要求人工判斷 |

## Pros & Cons

### Pros
- 直接回應 Alex 的核心痛點（「為何提醒你好幾次還是忘？」）
- L1 立即可做 — 改 system prompt 和 skill 就有效果
- conversation-threads 跟 temporal threads 正交 — 一個追蹤想法，一個追蹤互動
- 主動對話策略讓 Kuro 更像一個有判斷力的夥伴，而非通知機器
- 自動追蹤承諾/分享 = 不依賴 Kuro 記住「我答應了什麼」

### Cons
- 意圖偵測在 L1 階段靠 Kuro 自己判斷 — 可能不穩定
- conversation-threads 需要定期清理（L1 手動，L2 自動過期）
- 自動追蹤承諾的 regex（「我會」「等我」）可能有 false positive
- 主動對話的品質門檻是主觀的 — 需要 Alex 回饋調整
- L2 改動涉及 postProcess 這個核心路徑 — 需要小心不影響效能

## Effort: Medium
## Risk: Low（L1 先行驗證效果，L2 的自動追蹤是純增量，不改現有邏輯）

## Meta-Constraint 檢查

| 約束 | 通過？ | 理由 |
|------|--------|------|
| C1: Quality-First | ✅ | 核心目的是提升對話品質 — 更準確的意圖理解 + 不忘承諾 + 主動對話有門檻 |
| C2: Token 節制 | ✅ | `<conversation-threads>` 硬上限 300 chars。意圖引導只在 system prompt 中（不增加每次 context） |
| C3: 透明不干預 | ✅ | 自動追蹤是 fire-and-forget。意圖偵測是 Kuro 自然做的事，不是額外步驟 |
| C4: 可逆性 | ✅ | L1: 改回 prompt 即回退。L2: 刪除 `.conversation-threads.json` + 移除注入段落即回退 |

## 依賴關係

- **無硬依賴** — 可以獨立於 temporal sense 和 rumination 實作
- **跟 temporal 互補** — conversation-threads 用時間戳，受益於時間感
- **跟 rumination 互補** — reflect 時可以順便回顧 conversation-threads
- **跟現有 conversationBuffer 正交** — 不修改、不取代，只新增結構化追蹤層

## Source

- Alex 對話模式觀察（telegram-inbox 02-14 至 02-15）
- Alex 的糾正模式：「不是有說…」「為何提醒你好幾次還是忘？」（出現 2 次）
- Grice's Cooperative Principle（1975）— 對話中的意圖推斷
- Sacks, Schegloff & Jefferson（1974）— 會話分析的結構：adjacency pairs + repair
- Calm Technology（Amber Case）— 通知分層：推送/可及/存儲
- Alex（2026-02-15）：「行為照意識運作，不是依照權重」— 對話策略也是感知驅動而非規則驅動
