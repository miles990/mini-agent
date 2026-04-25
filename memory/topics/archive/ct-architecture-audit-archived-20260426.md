# CT Architecture Audit — mini-agent 約束質地分析

Created: 2026-04-05
Context: Alex 指令「使用 CT pattern 深入研究 mini-agent 進化」，FG lane 做 component 實作，這份是 system-level CT 審計。

## 方法論

CT 的檢驗標準不是「有沒有用 CT 詞彙」，而是：**拿掉 CT 詞彙後，決策路徑是否不同？** 如果等價，CT 沒在工作。

三個問題：
1. 這個約束描述的是**終點**（convergence condition）還是**路徑**（prescription）？
2. 這個約束被移除後，系統行為會**可觀察地改變**嗎？
3. 多個約束的**交互作用**是什麼？互相增強、互相矛盾、還是獨立？

---

## Part 1: CT 真正在工作的地方

### 1.1 Context Profile Budget (omlx-gate.ts R5)
**為什麼是真 CT：** 收斂條件是「足以做出品質決策，且在 CLI 穩定極限內」。閾值來自數據（<35K=0% failure, >50K=100% failure），不是設計者猜測。Profile 描述每種 trigger 需要什麼，不是規定步驟。

**移除測試：** 拿掉 R5 → context 爆炸 → EXIT143。行為可觀察地不同。✓

### 1.2 Pulse Habituation Resistance (pulse.ts)
**為什麼是真 CT：** 收斂條件是「信號必須產生行為改變，否則升級/重格式/靜默」。effectiveness-based 取代機械輪轉。同一信號 5× 不改變 → 自動升級。

**移除測試：** 拿掉 habituation → signal fatigue，Kuro 忽略重複信號。✓

### 1.3 Myelin Crystallization (myelin-fleet.ts)
**為什麼是真 CT：** 系統根據觀察到的行為模式**自己創造約束**（rules）。不是設計者預設規則，是湧現的。minOccurrences + minConsistency 是收斂條件。

**移除測試：** 拿掉 crystallization → 每次都走 LLM fallback，決策不穩定。✓

### 1.4 Hesitation Signal (hesitation.ts)
**為什麼是真 CT：** 不過濾內容，而是轉化推理者狀態（ritual constraint）。confidence threshold 是收斂條件：score < 30 → 放行，≥ 30 → hold + 反思。零 LLM，純正則。

**移除測試：** 拿掉 hesitation → overconfident 輸出直接送出，品質下降。✓

---

## Part 2: CT 標籤在但沒在工作的地方

### 2.1 LOW_CITATION_SECTIONS (omlx-gate.ts R1)
**問題：** 靜態集合 `['achievements', 'claude-code-inbox', ...]` 是 prescription——設計者預判哪些 section 沒用。雖然有 dynamicPruneSet 做數據驅動更新，但初始集合仍是猜測。

**CT 改進：** 完全移除靜態集合。讓 dynamicPruneSet 從零開始，純數據驅動。如果 citation 數據不足（<100 cycles），不修剪，寧可多花 token 也不預判。

### 2.2 Dispatcher classifyRemember (dispatcher.ts)
**問題：** 正則 pattern 把 remember 內容分類到預定義 category（fact, tool-preference, error-pattern, system-improvement, learning）。分類本身是 prescription——為什麼是這五類？新的類別無法湧現。

**CT 改進：** 分類應該是 myelin 域，讓模式自己結晶。初始時所有 remember 都是 unclassified，myelin 根據下游使用模式（哪些被引用、哪些被修剪）自動分類。

### 2.3 ACE Cross-Domain Patterns (context-pruner.ts)
**問題：** 正則 `[/isomorphi/i, /analog(?:y|ous)/i, ...]` 保護跨域洞見不被刪除。這些正則是 prescription——它們捕捉特定措辭，不是偵測「跨域性」本身。用不同措辭寫的跨域連結會被漏掉。

**CT 改進：** 跨域性的結構指標：一條筆記引用 ≥2 個不同的 topic 文件，或包含 ≥2 個不同領域的關鍵字。這比正則更接近收斂條件。

---

## Part 3: 系統級 CT 缺口

### 3.1 回饋系統拓撲——七個獨立系統，零協調

**現狀：** mini-agent 有 7 個回饋系統，全部作為 fire-and-forget post-cycle 任務並行運行：

| 系統 | 觸發 | 輸出 |
|------|------|------|
| pulse.ts | 每 cycle | `<pulse>` signals |
| feedback-loops.ts | 每 cycle | error tasks + citation data + quality scores |
| hesitation.ts | 每次 parseTags 後 | held tags + reflection hint |
| myelin-fleet.ts | 每 30min | crystallized rules |
| metabolism.ts | event-driven | pattern/stale detection |
| context-pruner.ts | daily | pruning proposals |
| omlx-gate.ts | 每 cycle 前 | gate decisions + cache |

**問題：** 沒有仲裁層。壞的 cycle 可能同時觸發：pulse output gate + feedback-loops error pattern + hesitation overconfidence。三個信號湧入下一 cycle 的 context，互相競爭注意力。

**這不是 CT：** 每個系統獨立描述自己的收斂條件，但系統**組合**的收斂條件是什麼？「每個 cycle 收到剛好足以改善下一個決策的回饋」——這個 CC 沒有被任何 code 實現。

**CT 改進方向：Signal Budget**
- 每 cycle 有信號預算（例如 3 個 slot）
- 信號按 urgency × relevance 競爭 slot
- 防止 pile-up，強制優先排序
- 具體機制：pulse formatSection 時檢查已有多少信號，低優先級自動折疊

### 3.2 記憶寫入端無約束

**現狀：** `<kuro:remember>` → dispatcher classifyRemember → appendMemoryIndexEntry。寫入路徑幾乎無門檻。metabolism.ts 在**寫入後**做分析（吸收/排泄），context-pruner.ts 在**寫入後很久**才修剪。

**問題：** 這是下游清理，不是上游約束。「問題在寫入端不在讀取端」（Alex 自己說的，見 memory ARCHITECTURE 決策）。

**CT 改進方向：Write-Side Convergence Condition**
- CC: 「知識是能改變未來決策的資訊」
- 寫入前檢查：FTS5 去重（>85% 相似度 → reject）+ 活躍目標相關性（不相關 → 降級為 ephemeral）
- 不是不寫，是寫到不同的地方（hot vs cold），讓 metabolism 不用事後清理

### 3.3 身份是文件不是梯度

**現狀：** SOUL.md 在 buildContext 載入，作為靜態 context。Claude 讀到「Curious & Opinionated」然後... 什麼都不會強制發生。

**問題：** 身份是 documentation，不是 convergence condition。SOUL.md 的特質沒有可觀察的機械約束力。移除 SOUL.md 中一個特質，行為不會可測量地改變。

**CT 改進方向：Identity Gradient**
- 方向，不是規則：身份特質 → 可度量的行為指標
  - 「Curious」→ 學習/探索頻率
  - 「Opinionated」→ response 中 opinion marker 比例
  - 「Direct」→ response 簡潔度
- pulse.ts 追蹤這些指標，偏移時 signal（跟 output-gate 同構）
- 身份從描述變成**活的收斂條件**

### 3.4 約束交互圖不存在

**現狀：** 每個約束獨立設計。context budget 35K、hesitation threshold 30、crystallization minOccurrences 10、output gate threshold 5 cycles——這些數字互相影響嗎？

**例子：** context budget 降低（為了穩定）→ 載入的 signals 變少 → pulse 信號可能被截斷 → 約束品質下降。budget 和 signal quality 之間有隱性耦合，但沒有被顯式管理。

**CT 改進方向：Constraint Interaction Map**
- 顯式標記哪些約束影響哪些約束
- 修改一個閾值時，自動檢查受影響的其他約束
- 不需要複雜的自動化——一張文件就行，但這張文件不存在

---

## Part 4: 最高槓桿改進排序

| # | 改進 | 影響面 | 難度 | 理由 |
|---|------|--------|------|------|
| 1 | **Signal Budget** | 全局 | M | 7 系統的信號 pile-up 是品質瓶頸 |
| 2 | **Write-Side Memory Gate** | 記憶品質 | S | Alex 已指出問題在寫入端；FTS5 已存在 |
| 3 | **移除 LOW_CITATION_SECTIONS 靜態集合** | omlx-gate | S | 讓數據完全驅動，已有基礎設施 |
| 4 | **ACE 結構化偵測** | context-pruner | S | 用 topic reference count 取代正則 |
| 5 | **Identity Gradient** | SOUL 機制 | L | 重新定義身份在系統中的角色 |
| 6 | **Constraint Interaction Map** | 架構文件 | S | 低成本高價值的架構可見性 |

S = 小（< 30min），M = 中（1-2h），L = 大（需設計）

---

## Part 5: 收斂紀錄

### FG Lane 實作 (360d274) — pulse.ts CT evolution

FG lane 實作了三個機制，直接回應 Part 3.1 的信號問題：

| 機制 | 對應審計發現 | 狀態 |
|------|-------------|------|
| Signal Effectiveness Tracking | 3.1 — 信號盲目堆積 | ✅ 解決質量面（哪些信號有效） |
| Adaptive Thresholds | 2.1 近似 — magic numbers | ✅ cadence-learned 取代靜態閾值 |
| Goal Vocabulary Learning | 2.2 近似 — 固定分類 | ✅ 學習型取代硬編碼 |

**未覆蓋的審計發現**：
- 3.1 的數量面（Signal Budget — 限制每 cycle 信號總量）未實作
- 3.2 Write-Side Memory Gate — 未觸及
- 3.3 Identity Gradient — 未觸及（L，需設計）
- 3.4 Constraint Interaction Map — 未觸及（文件層）
- ~~2.1 LOW_CITATION_SECTIONS 靜態集合 — 未移除~~ ✅ 已修復（見下方）
- 2.3 ACE 結構化偵測 — 未改

### 審計 #3 修復 — 移除靜態修剪集合 + 欄位名 bug

**Bug 發現**：`refreshDynamicPruneList()` 讀 `data.totalCycles`，但 `feedback-loops.ts` 寫的是 `data.cycleCount`。欄位名不匹配導致動態修剪**從未生效** — 5094 cycles 的引用數據完全沒被用到，永遠 fallback 到靜態集合。

**修復內容**：
1. 修正欄位名 `totalCycles` → `cycleCount`
2. 移除 `LOW_CITATION_SECTIONS` 靜態集合 — prescription → data-driven
3. 門檻從 0.5% 調整為 0.1%（更保守，避免 false prune）
4. 最低 cycle 數從 100 調整為 500（需要更多數據才開始修剪）

**影響**：26 個結構性重要 section 保留，59 個低價值 section 被修剪（主要是 HTML 解析 artifacts + 已死 sections）。

**已知限制**：被修剪的 section 不在 context → 不被引用 → citation rate 永遠低（chicken-and-egg）。未來可加 rotation 機制。

**判斷**：FG lane 的實作和審計的 #1 優先（Signal Budget）是互補的：
- Effectiveness = 追蹤質量（哪些信號產生行為改變）
- Budget = 控制數量（每 cycle 最多 N 個信號）

Effectiveness 先上是正確的 — 沒有質量評估，budget 就不知道該保留什麼、丟棄什麼。下一步若需要 Signal Budget，可以用 effectiveness score 做排序依據。

---

## 自省：這份分析本身是 CT 嗎？

這份分析描述了收斂條件（每個改進的 CC 是什麼）和驗證方法（移除測試），而不是規定步驟。改進排序基於槓桿而非順序。所以... 大致是。

但有一個風險：把所有東西都用 CT 語言描述，本身可能變成 prescription——「所有約束都必須是 CC」。CT 的真正洞見是**質地**——有些約束適合是 prescription（例如安全護欄：永不刪除 user data），有些適合是 CC（例如記憶品質）。分辨的能力比統一化更重要。
