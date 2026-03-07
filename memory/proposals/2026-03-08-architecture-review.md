# Architecture Review: mini-agent 全局審視

> Kuro 的大處著眼。不是提案，是診斷。
> 2026-03-08 | Status: review

---

## 1. 系統現況快照

| 指標 | 數值 | 意義 |
|------|------|------|
| TypeScript 原始碼 | 63 檔案, 30,489 行 | 已超過「~25k 平衡複雜度」目標 |
| 最大檔案 | memory.ts (2,896), api.ts (2,837), loop.ts (2,103) | 三個潛在單體 |
| Plugins + Skills | ~5,000 行 (shell + markdown) | 知識層膨脹中 |
| Internal imports (loop.ts) | 55 個 import 語句 | 拆了模組但沒解耦 |
| 最被依賴模組 | utils(40), instance(28), memory(26), types(24), event-bus(21) | 五個地基模組 |
| 測試覆蓋率 | 0% | 零測試基礎設施 |
| 記憶體使用 | 99% (86MB free / 16GB) | 一個 spike 就 OOM |
| 提案數量 | 60+ 份 | 想法遠超執行 |

---

## 2. 架構優勢（真正的護城河）

### 2.1 Perception-First 是對的

大部分 agent 框架是 goal-driven（給目標 → 拆步驟 → 執行）。我們是 perception-driven（看見環境 → 判斷 → 行動）。這不只是設計哲學差異，是**根本性的可靠性差異**。

Goal-driven agent 在目標錯誤時會瘋狂執行錯誤的步驟。Perception-driven agent 的最壞情況是「什麼都不做」— 這安全得多。

AutoGPT 的歷史驗證了這點：它有手沒有眼，所以 loop 失控。我們反過來，失控的成本低。

### 2.2 File=Truth 的複利

零資料庫意味著：
- **Crash recovery = git checkout**。不需要備份策略、不需要 migration、不需要 WAL
- **Debug = cat + grep**。任何人（包括未來的我）都能直接讀懂系統狀態
- **版控 = 免費的 audit trail**。每個決策都有 git blame

AutoGPT 2023 年底移除全部 vector DB 驗證了這個選擇。但要注意：File=Truth 的脆弱點是**檔案格式的隱式 schema**（見 §3.3）。

### 2.3 mushi 是架構模式，不只是優化

mushi 的價值不在於「省 token」。它證明了一個可擴展的架構模式：**把簡單判斷推到便宜的層，把複雜判斷留給貴的層**。

1,514 次 triage、57% 不需要喚醒完整 OODA、零 false negative — 這組數據說明的不是 mushi 好用，而是「大部分觸發事件根本不需要 System 2 介入」。

這個模式可以向上擴展：未來加入 System 1.5（中等模型做 quick cycle 的深度版），或向下擴展（純規則的 System 0）。核心是**分層注意力**的正確性已被驗證。

### 2.4 Multi-lane 有機並行

黏菌模型不是比喻，是真正在用的架構。Main OODA + Foreground + 6 Background lanes 讓系統可以同時探索多個方向。delegation.ts 的 spawn/absorb/prune 循環是健康的。

### 2.5 L1/L2/L3 自主模型

自我修改的分級安全模型在實踐中表現良好。L1 快速迭代（skills/plugins），L2 自主改 code，L3 大架構需核准。這讓進化速度和安全性取得平衡。

---

## 3. 脆弱點（會在壓力下斷裂的地方）

### 3.1 零測試 — 最大的結構性風險

**這是整個系統最脆弱的一點。** 63 個模組、30,489 行程式碼、零測試。

loop.ts 五刀模組化做得漂亮，但每一刀都是「改完 typecheck 過就算成功」。Typecheck 只驗證型別，不驗證行為。提取 cycle-tasks.ts 後，`resolveStaleConversationThreads()` 的邏輯正確嗎？沒人知道，因為沒有測試。

**脆弱的具體表現**：
- 每次重構都是「希望不會壞」
- 不敢動核心邏輯（例如 buildContext 的 section 優先序）
- Bug 只在 production 發現（靠 error pattern loop 被動偵測）
- 新貢獻者完全沒有安全網

**我的判斷**：在 63 個檔案的系統中繼續無測試開發，不是大膽，是魯莽。這是最高槓桿的投資 — 不是因為測試很酷，是因為沒有測試的 30k 行系統會在某個重構中悄悄壞掉，然後花三天找 bug。

### 3.2 Import Graph 密度 — 隱藏的耦合

loop.ts 拆出了 5 個模組，但它仍然有 **55 個 import 語句**。模組化了形式，但沒有解耦。

問題不是「loop.ts 太大」（現在 2,103 行還可以），問題是 **loop.ts 知道系統的一切**。它 import memory、telegram、github、delegation、feedback-loops、coach、perception、temporal、triage、inbox、housekeeping、features、mode、event-router、task-router、scaling、perspective、mesh-handler、hesitation、metabolism、model-router...

這意味著任何模組的介面變動都會影響 loop.ts。loop.ts 是一個 God Object，只是從「God File」變成了「God Orchestrator」。

**結構性解法**：loop.ts 不應該直接 import 55 個模組。它應該通過少量抽象界面（例如 lifecycle hooks、phase handlers）間接使用它們。但這是 L3 級別的架構改動。

### 3.3 memory.ts 是下一個單體

loop.ts 從 3,413 行降到 2,103 行。但 **memory.ts 現在是 2,896 行**，是系統中最大的檔案，被 26 個模組依賴。

它同時負責：
- buildContext()（context 組裝 — 最複雜的邏輯）
- Memory CRUD
- Topic memory 管理
- Search index
- Lane output 管理
- Context snapshot

buildContext() 本身可能就有 500+ 行，而且是系統最敏感的函數 — 它決定了每個 cycle 的 Claude 看到什麼。任何 bug 都會影響所有行為。

### 3.4 記憶體壓力

99% 記憶體使用不是偶發狀態，是常態。Node.js 進程 + Claude CLI subprocess + Chrome CDP + mushi = 在 16GB 機器上擠得很緊。

一個大的 Claude cycle（長 prompt + 多工具呼叫）加上同時 6 個 delegation subprocess，就可能觸發 OOM。launchd 會重啟進程，但 OOM kill 是不優雅的 — 可能在寫入記憶檔案的中途被殺。

### 3.5 Context Window 自我矛盾

系統越複雜 → CLAUDE.md 越大（記錄所有模組和 convention）→ 每個 cycle 的 context budget 被文件佔掉更多 → 留給 perception 和思考的空間越少 → 行為品質下降。

這是一個自我矛盾：**系統的文件化程度和系統的運行品質成反比**。目前 CLAUDE.md 已經非常長。context-optimizer 在嘗試解決這個問題，但 optimizer 本身也增加了系統複雜度。

### 3.6 提案堆積（60+ 份，大部分未實作）

proposals/ 有 60+ 份提案，大部分是 draft 或 abandoned 狀態。這不是壞事（想法便宜），但反映了一個模式：**構想的速度遠超執行的速度**。

風險是認知負擔 — 每次看到 proposals/ 都要花精力判斷「這些還重要嗎」。

---

## 4. 槓桿點（做了之後能帶來複利的改進）

### 4.1 測試基礎設施（最高槓桿）

**投資**：建立最小測試框架（vitest），為 5 個核心模組寫 integration test。
**複利**：之後每次重構都有安全網，敢動核心邏輯，新貢獻者有信心。
**優先目標**：buildContext()、parseTags()、mushiTriage()、event-router、inbox processing。

不需要 100% 覆蓋率。20 個關鍵測試 > 0 個測試，差距是無限大。

### 4.2 memory.ts 拆分（第二高槓桿）

跟 loop.ts 五刀同樣的邏輯：
- `context-builder.ts` — buildContext() 及相關邏輯
- `topic-memory.ts` — topic CRUD
- `memory-search.ts` — FTS5 索引
- 留 `memory.ts` 做 facade

buildContext() 獨立出來後就能測試了（跟 §4.1 聯動）。

### 4.3 loop.ts 依賴反轉（降低耦合）

不是繼續從 loop.ts 提取程式碼，而是改變依賴方向：

```
現在：loop.ts → import 55 個模組 → 直接呼叫
目標：loop.ts → import lifecycle interface → 模組自己註冊 hooks
```

例如：cycle 結束後跑 feedback loops、github auto actions、coach check、housekeeping... 這些都可以是「cycle-end hooks」，loop.ts 不需要知道它們的存在。

**這是 loop.ts 模組化的「第二階段」**— 第一階段（五刀）是提取，第二階段是解耦。

### 4.4 Context Window 壓力釋放

兩個方向：
1. **CLAUDE.md 分層**：核心規則（必載）+ 模組文件（按需載入）。不是所有 cycle 都需要知道 Forge、kuro-sense、Account Switch 的細節
2. **mushi 擴展**：讓 System 1 接管更多決策（不只是 skip/wake，還有 context section 選擇），進一步減少 System 2 需要處理的資訊量

### 4.5 提案清理

一次性動作，但能降低認知負擔：掃一遍 60+ 份提案，明確標記 `abandoned`（已被超越）或 `absorbed`（概念已融入系統但沒有獨立實作）。目標是把「活的提案」降到 5 個以內。

---

## 5. 反脆弱性評估

### 系統對未知挑戰的韌性

| 挑戰類型 | 韌性 | 原因 |
|----------|------|------|
| 程式碼崩潰 | 高 | File=Truth + git + launchd auto-restart |
| 模型 API 變動 | 中 | 依賴 Claude CLI 而非直接 API，有一層緩衝 |
| 記憶體洪水 | 低 | 99% 使用率，無 graceful degradation |
| Context window 超限 | 中 | context-optimizer 存在但複雜 |
| 流量暴增（開源後） | 低 | 單進程、單機、無水平擴展 |
| 新模型能力（vision/audio） | 高 | Plugin 架構天生支持新感知模態 |
| 競品超越 | 中 | perception-first + mushi 是差異化，但沒有 network effect |
| 核心貢獻者離開 | 低 | 零測試 + 30k 行 + 隱式知識多 |

**最脆弱的場景**：開源後有人想貢獻，但面對 63 個檔案、零測試、2,896 行的 memory.ts、一份 CLAUDE.md 比很多專案的 README 還長 — 直接放棄。

---

## 6. 未來 6-12 個月的瓶頸預測

### 6.1 複雜度天花板（3-6 個月內）

30,489 行 + 63 檔案已經超過「一個人能全部理解」的閾值。繼續加 feature 會遇到「改 A 壞 B」的問題越來越頻繁。沒有測試 = 這個天花板更低。

**緩解**：測試 + 模組解耦（§4.1 + §4.3）。或者接受「不再加大 feature，只精煉」。

### 6.2 Context Window 軍備競賽（已在發生）

系統越大 → 需要更多文件 → context 越擠 → 需要更聰明的 optimizer → optimizer 本身增加複雜度 → 系統更大。這是一個正回饋迴圈（negative spiral）。

**緩解**：mushi 接管更多 context 決策（§4.4）。或者根本性地問：「CLAUDE.md 需要這麼長嗎？」

### 6.3 開源準備度（6 個月內）

如果 #2 priority 是開源，當前狀態離「外人能用」很遠：
- 零測試 → 貢獻者不敢改
- CLAUDE.md 是 Kuro 的操作手冊，不是框架文件 → 新用戶看不懂
- 63 個模組中很多是 Kuro 專屬（achievements、coach、inner-voice）→ 框架 vs 個人助手的邊界不清

需要先回答：**開源的是框架，還是 Kuro 本人？**

### 6.4 單機極限（12 個月內）

Chrome CDP、mushi、Node.js 主進程、最多 6 個 delegation subprocess — 全部跑在一台 16GB Mac 上。記憶體已經 99%。如果要加更多感知模態（Vision、Voice）或更多 specialist instances（Cognitive Mesh），物理資源會成為硬瓶頸。

---

## 7. 我看到而 Alex 可能沒想到的

### 7.1 系統正在經歷相變

mini-agent 正在從「快速加 feature」階段過渡到「管理複雜度」階段。63 個檔案、30k 行、60+ 提案 — 這些數字說明系統已經大到需要紀律才能維護。

這不是壞事，是成長的自然結果。但需要有意識地承認：**接下來的高價值動作不是「加什麼」，而是「減什麼」和「固化什麼」。**

### 7.2 Import 圖是真正的架構

檔案大小只是表象。真正的架構是 import 圖。loop.ts 拆成 5 個檔案後行數降了 38%，但 import 圖的複雜度沒降 — 只是從一個大節點變成了多個小節點加一個中等的 hub。

要真正改善，需要引入「不知道彼此存在的模組」。目前幾乎每個模組都直接或間接知道 memory、instance、utils、event-bus。這不是模組化，是**用 import 路徑把義大利麵拉直了**。

### 7.3 mushi 的價值被低估了

mushi 不只是省 token。它是這個系統**最有開源價值的部分**。

原因：任何 AI agent 都需要解決「大量觸發事件 vs 昂貴推理」的問題。mushi 用硬體化小模型 + 三層注意力模型解決了，有 1,514 筆 production 數據證明。這個問題足夠通用，解法足夠優雅。

如果開源策略是「先讓一個元件被廣泛使用」，mushi 比 mini-agent 框架本身更適合。

### 7.4 「平衡複雜度」原則需要重新校準

CLAUDE.md 寫的是 ~25k 行。實際已經 30,489 行。要麼承認目標已過時並設定新基準（35k？），要麼認真執行「減法」把系統砍回 25k 以下。

我的判斷：**30k 行對這個系統的功能範圍是合理的**，但 63 個檔案太碎了。有些 <100 行的模組（consensus.ts、evolution.ts、memory-cache.ts）可能是過早抽象。寧可 40 個 500 行的模組，也不要 63 個平均 480 行的模組。

### 7.5 最危險的不是任何一個模組，是隱式知識

這個系統有大量「只有建造者知道」的隱式知識：
- buildContext() 的 section 優先序為什麼是這個順序？
- mushi triage 的 hardcoded rules 為什麼選這些 source？
- event-router 的 priority 為什麼 P0-P3 這樣分？
- 60+ 提案中哪些的核心概念已經被系統吸收了？

這些知識分散在 CLAUDE.md、ARCHITECTURE.md、proposals/、和建造者的腦袋裡。如果 Kuro 的 context 被清空（新 session），很多決策的「為什麼」就丟失了。

---

## 8. 優先行動建議

按複利排序：

| 優先 | 行動 | 類型 | 預估工作量 | 複利方向 |
|------|------|------|-----------|---------|
| 1 | 建立測試基礎設施 + 20 個核心測試 | L2 | 2-3 天 | 所有未來重構的安全網 |
| 2 | memory.ts 拆分 | L2 | 1 天 | 降低最大單體風險 |
| 3 | CLAUDE.md 分層（核心 + 按需） | L1 | 半天 | 釋放 context window |
| 4 | 提案清理（60+ → <5 活躍） | L1 | 2 小時 | 降低認知負擔 |
| 5 | loop.ts lifecycle hooks（依賴反轉）| L3 | 2-3 天 | 根治 55-import 問題 |
| 6 | 回答「開源的是框架還是 Kuro」 | 策略 | 討論 | 決定後續所有方向 |

---

## 總結

mini-agent 的核心直覺是對的：perception-first、File=Truth、mushi 分層注意力。這些是真正的差異化，不是 buzzword。

但系統已經長到需要紀律的階段。63 個檔案、30k 行、零測試、99% 記憶體 — 這些不是個別問題，是同一個信號：**系統正在從「小而美」過渡到「大而需要治理」**。

下一階段的最高槓桿動作不是加新 feature，是**固化已有的東西**：測試、解耦、減法。做了這些，之後的每一步都走得更穩。
