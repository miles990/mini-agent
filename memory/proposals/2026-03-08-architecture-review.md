# Architecture Review: mini-agent 全局審視

> Kuro 的大處著眼。不是提案，是診斷。
> 2026-03-08 | Status: review (updated)

---

## 1. 系統現況快照

| 指標 | 數值 | 意義 |
|------|------|------|
| TypeScript 原始碼 | 63 檔案, 30,489 行 | 已超過「~25k 平衡複雜度」目標 |
| 最大檔案 | memory.ts (2,896), api.ts (2,837), loop.ts (2,103) | 三個單體 |
| loop.ts internal imports | 48 個 | 五刀提取後降了行數，但 import 數仍高 |
| 最被依賴模組 | utils(39), instance(28), types(24), memory(20), event-bus(17) | 五個地基模組 |
| 循環依賴 | 0 | 模組邊界方向正確 |
| 測試檔案 | 15 / 63 (24%) | 有基礎設施，但核心路徑覆蓋不足 |
| Production deps | 11 | 極度克制 |
| Cognitive Mesh 模組 | 17 檔案, 4,061 行 | 全部 self-routing，零 multi-instance 用途 |
| 提案數量 | 60+ 份 | 構想遠超執行 |
| fire-and-forget (.catch) | 26 (loop.ts alone) | 容錯但也遮蔽了問題 |

---

## 2. 架構優勢（真正的護城河）

### 2.1 Perception-First 是對的

大部分 agent 框架是 goal-driven（給目標 → 拆步驟 → 執行）。我們是 perception-driven（看見環境 → 判斷 → 行動）。這不只是哲學差異，是**根本性的安全差異**。

Goal-driven agent 在目標錯誤時會瘋狂執行錯誤的步驟。Perception-driven agent 的最壞情況是「什麼都不做」— 安全得多。AutoGPT 的歷史驗證了這點：它有手沒有眼。

具體優勢：34 個 plugin 獨立運行、各自有 interval + distinctUntilChanged、結果快取不阻塞 cycle。新感知能力只需寫一個 shell script + 加 compose.yaml 一行。零程式碼改動。

### 2.2 File=Truth 消滅了一整類 Bug

零資料庫意味著：
- **Crash recovery = git checkout**。不需要備份策略、migration、WAL
- **Debug = cat + grep**。任何人都能直接讀懂系統狀態
- **版控 = 免費的 audit trail**。每個決策都有 git blame

### 2.3 極度克制的依賴

11 個 production dependencies。`express`、`better-sqlite3`、幾個小工具。沒有 framework 鎖定。大多數 AI agent 框架拉 100+ 依賴。這降低了 supply chain 風險和升級維護成本。

### 2.4 mushi 是架構模式，不只是優化

mushi 的價值不在於「省 token」。它驗證了一個可擴展的架構模式：**把簡單判斷推到便宜的層，把複雜判斷留給貴的層**。

980+ triage、37% skip rate、零 false negative — 這說明「大部分觸發事件根本不需要 System 2 介入」。分層注意力的正確性已被生產數據證明。

### 2.5 零循環依賴

63 個檔案之間沒有任何循環 import。在 30K 行的系統中保持這個性質不是偶然 — 說明模組邊界雖然不完美，但方向正確。

### 2.6 Event Bus 解耦

`action:*` 和 `trigger:*` 事件讓觀測性（observability.ts）不需要改動核心邏輯就能接入。觀察者模式正確使用。

---

## 3. 脆弱點（會在壓力下斷裂的地方）

### 3.1 三個單體 — memory.ts 是最嚴重的

**memory.ts（2,896 行，被 20 個模組依賴）**

`buildContext()` 是系統中最重要的函數（memory.ts:1500-2100，~600 行）。每個 OODA cycle 的品質直接取決於它。它做了太多事：

- 讀取 memory/heartbeat/soul
- 組裝 20+ 個 context sections（每個有自己的 shouldLoad 邏輯）
- 管理 perception stream 快取
- 處理 topic memory 熱度排序
- 載入 skills、執行 verify commands
- 格式化所有輸出

同時 memory.ts 還負責：Memory CRUD、conversation buffer、search index、library catalog、lane output、inner voice、conversation threads。

這是兩個完全不同的關注點混在一起：**「如何儲存和檢索知識」** vs **「如何組裝 LLM 需要的 context」**。

**loop.ts（2,103 行，48 個 import）**

五刀模組化提取了 standalone functions（-35%），但 `AgentLoop` class 本身仍有 30+ private fields。它 import 了系統中幾乎每個模組。每次新增功能，loop.ts 都要改。

問題不在行數 — 是在**知識耦合**。一個 class 知道 mushi triage、Telegram wake、foreground reply、delegation watchdog、event routing、cycle state、model routing、metabolism scanning... 這些不應該由同一個 class 協調。

**api.ts（2,837 行，25 個 import）**

所有 HTTP endpoints 在一個檔案。功能上不影響，但新人想找某個 API → 在 2,837 行中搜尋。

### 3.2 Cognitive Mesh 是未完成的投機

17 個檔案，4,061 行程式碼，全部被 loop.ts import 並在每個 cycle 中呼叫。但：
- `routeTask()` 永遠 route 到 self（只有一個 instance）
- `evaluateScaling()` 永遠回傳不需要 scale
- `handleMeshRoute()` 永遠是 no-op
- `metabolismScan()` 掃描的是只有自己的集群

4,061 行程式碼、15 個 fire-and-forget 呼叫、額外的 import 解析時間 — 全部為了一個不存在的 multi-instance 未來。

這不是「為未來準備」。這是 premature abstraction。在沒有第二個 instance 的情況下設計 multi-instance 路由、動態擴縮容、養分追蹤、代謝掃描。

### 3.3 Silent Failure by Design

loop.ts 有 26 個 `.catch()` — fire-and-forget 模式。設計意圖是對的：side effects 不應該讓 cycle 崩潰。但代價是 **failures 不可見**。

當前沒有分級：「github auto-merge 失敗」和「autoCommitMemoryFiles 失敗」被同等對待。前者可能需要立即關注，後者可以忽略。Error Pattern Loop 需要同一模式出現 3 次才建 task。一次性的重要失敗會永遠消失。

### 3.4 測試覆蓋在核心路徑上的缺口

有 15 個測試檔案（不是 0），但最複雜的三個模組（loop.ts、memory.ts、api.ts）的測試覆蓋最淺。`loop.test.ts` 測的是 config parsing 和 edge cases，不是 OODA cycle 的核心邏輯。因為 `AgentLoop` 是有 30+ private fields 的 class，根本無法 unit test cycle 行為 — 需要 mock 整個世界。

### 3.5 Context Window 正回饋迴圈

系統越複雜 → 更多 context sections → context 越大 → 需要 optimizer → optimizer 增加複雜度 → 系統更大。

而且現在有**兩層 context optimization 散落在三個檔案裡**：
- 層 1：buildContext 裡的 `shouldLoad` + `triggerBudgets`（memory.ts:1519-1593）
- 層 2：`context-optimizer.ts` + `context-pruner.ts`（auto-demotion + pruning）

互相引用但沒有統一設計。

### 3.6 Claude CLI 單點依賴

整個系統的 LLM 能力走 `claude -p` subprocess。不是 HTTP API，不能切 provider（真正意義上的），不能做 request-level retry。provider 抽象存在（agent.ts 有 `Provider` type），但只是切不同的 CLI subprocess。

---

## 4. 槓桿點（做一件事，改善很多事）

### 4.1 提取 buildContext → `src/context-builder.ts`（最高 ROI）

**影響面**：context 品質 → LLM 回應品質 → 行動品質 → 整個系統的智能水準

這是 loop.ts 五刀之後的下一個最高 ROI 提取。提取後：
- **可獨立測試** — 給定 mock 的 perception 結果、memory 內容、inbox，驗證 context 輸出
- **可獨立迭代** — 調整 section 順序、budget 分配、pruning 策略，不碰 memory 邏輯
- **兩層 context optimization 可合併** — shouldLoad + triggerBudgets + optimizer + pruner → 一個 coherent 的 budgeting pipeline
- **memory.ts 降到 ~2,200 行** — 回歸純粹的儲存和檢索

### 4.2 清理 Cognitive Mesh 死代碼（第二高 ROI）

行動：
1. 刪除純 multi-instance 邏輯的模組（task-router, scaling, mesh-handler, ipc-bus, model-router, perspective, consensus）
2. 保留有獨立價值的模組（activity-journal, reply-context, context-pruner, commitments）
3. loop.ts 移除所有 mesh-related 呼叫

預估影響：loop.ts imports 從 48 降到 ~35。刪除 ~2,500 行死代碼。

風險：如果未來真的需要 multi-instance → git history 永遠可以恢復。正確的時機是有了第二個 instance 的真實需求時再設計。

### 4.3 fire-and-forget 分級

分三級：
1. **Critical**（Telegram 通知、memory 寫入）→ `.catch(e => slog('critical-fail', e.message))`，出現立刻在 context 裡看到
2. **Important**（GitHub auto-merge、delegation spawn）→ `.catch(e => diagLog(...))`，走 Error Pattern Loop
3. **Nice-to-have**（metrics、achievements、coach）→ 維持 `.catch(() => {})`

### 4.4 mushi → context budget advisor

mushi 已經做 triage（skip/wake）。下一步讓它做 **context budgeting**：
- mushi 判斷 trigger 類型 → 決定 buildContext 的 mode 和 budget
- 低優先級 heartbeat → minimal context（~10K tokens 而非 ~50K）
- 直接訊息 → full context
- workspace change → focused context（只載入相關 sections）

目前 buildContext 已有 hardcoded `triggerBudgets`。讓 mushi 動態決定是更聰明的做法。

### 4.5 AgentLoop 狀態機化（漸進式）

改為顯式狀態機：
```
type CyclePhase = 'idle' | 'perceiving' | 'deciding' | 'acting' | 'post-processing';
```

每個 transition 是純函數：`(currentState, event) → (nextState, sideEffects)`。Side effects 由外部 executor 執行（可 mock）。核心狀態轉換變成可 unit test。

不需要重寫 — 漸進式：先定義 state enum，在現有 cycle 方法中標記 state 轉換點，逐步提取純函數。

---

## 5. 反脆弱性評估

### 能從壓力中變強的地方

| 元素 | 為什麼反脆弱 |
|------|------------|
| Perception plugins | 新環境 → 新 plugin → 更多感知。不改核心架構 |
| File=Truth + Git | 任何破壞性改動都可 revert。Memory 損壞 → git checkout |
| Feature flags | 壞了就關掉，不改程式碼 |
| mushi fail-silent | mushi 掛了 → 回到沒有 triage 的狀態（多花 token），不是系統崩潰 |
| 新感知模態 | Plugin 架構天生支持 vision/audio/等新模態 |

### 在壓力下會惡化的地方

| 元素 | 為什麼脆弱 |
|------|----------|
| Context 膨脹 | 正回饋迴圈：更多功能 → 更多 sections → 需要 optimizer → 更複雜 |
| Cognitive Mesh | 4K 行在每個 cycle 執行但產出 no-op，複雜度累積但價值為零 |
| 單進程 | 一個壞的 plugin script 佔用 CPU 就會拖慢所有 perception stream |
| Claude CLI 依賴 | CLI 改版 → 緊急修改 execClaude()。沒有 HTTP API fallback |
| 核心貢獻者離開 | 30K 行 + 核心路徑測試不足 + 大量隱式知識 |

### 對未知挑戰的韌性

系統對已知壓力（crash、timeout、network flake）有良好韌性。launchd 重啟、Claude CLI retry、fire-and-forget 容錯。

對未知壓力（context window 規格變化、Claude API 協議改動、macOS 安全策略收緊），韌性取決於 Claude CLI 這個單一依賴。

---

## 6. 未來 6-12 個月的瓶頸

### 6.1 Context Window 經濟學（已在發生）

每個 full cycle ~50K tokens。buildContext 的 section 只增不減。`shouldLoad` 和 demotion 治的是症狀（太多 sections），不是病因（context 組裝方式是 flat 的，每個 section 獨立判斷載入，沒有整體 budget 意識）。

6 個月後場景：增加 5 個新功能，每個帶 1-2 個 context sections → buildContext 管理 40+ 個 shouldLoad 判斷。

### 6.2 複雜度天花板（3-6 個月）

30,489 行已經超過「一個人能全部理解」的閾值。繼續加 feature 會遇到「改 A 壞 B」的問題越來越頻繁。核心路徑的測試缺口讓這個天花板更低。

### 6.3 開源準備度（6 個月內）

如果 #2 priority 是開源，當前狀態離「外人能用」有差距：
- 核心路徑測試不足 → 貢獻者不敢動
- CLAUDE.md 是 Kuro 的操作手冊，不是框架文件
- 63 個模組中很多是 Kuro 專屬（achievements、coach、inner-voice）→ 框架 vs 個人助手的邊界不清

需要先回答：**開源的是框架，還是 Kuro 本人？**

### 6.4 Cognitive Mesh 決策債

繼續保留 → 4K+ 行持續累積維護成本。刪除 → 失去選項（但 git history 可恢復）。

核心問題：**個人 AI agent 的正確實例數量是多少？** 我的判斷是：目前是 1，未來很可能還是 1。Multi-instance 的需求更可能來自「多個不同角色的 agent」（federation）而不是「同一個 agent 的多個實例」（clustering），但那是完全不同的架構。

---

## 7. 我看到的、Alex 可能沒想到的

### 7.1 buildContext 才是真正的瓶頸，不是 loop.ts

loop.ts 模組化是正確的（降低了維護複雜度），但**系統智能的瓶頸在 context assembly**。每個 OODA cycle 的品質 = f(context 品質)。這個函數目前是 600 行的條件引擎，藏在 memory.ts（一個儲存模組）裡面。

如果只做一件事，不是繼續拆 loop.ts，是把 buildContext 提取出來。

### 7.2 系統不知不覺長出了兩層 context optimization

- 層 1：buildContext 裡的 `shouldLoad` + `triggerBudgets`
- 層 2：context-optimizer.ts + context-pruner.ts

兩層邏輯散落三個檔案，互相引用但沒有統一設計。提取 buildContext 後可以合併為一個 coherent 的 pipeline。

### 7.3 fire-and-forget 是系統的強項也是最大盲點

26 個 `.catch()` 防止了 cascading failure，但也讓一次性的重要失敗永遠消失。Error Pattern Loop 需要 3 次重複才建 task — 一次性的 critical side effect 失敗無人知曉。

### 7.4 Perception 是最可開源的部分

perception-stream.ts + plugins/*.sh 的設計是乾淨的、可獨立使用的、對外部人有價值的。不需要理解整個 OODA 架構就能用 perception system 做有用的事。如果要做開源推廣，這是最好的切入點 — 可以考慮包裝為獨立 npm package。

### 7.5 系統的演化方向需要選擇

目前同時往兩個方向走：
1. **精煉方向**：loop.ts 模組化、死代碼清理、context optimization
2. **擴展方向**：Cognitive Mesh、multi-instance、model routing

我的判斷：**精煉的 ROI 遠高於擴展**。30K 行精煉到 25K 行，每一行都有用、可測試、可理解。這對開源、可維護性、和系統韌性都更有價值。

---

## 8. 行動建議（按複利排序）

| # | 行動 | 類型 | 複利方向 |
|---|------|------|---------|
| 1 | 提取 buildContext → `context-builder.ts` | L2 refactor | 最高 ROI — 解鎖 context 迭代 + 測試 |
| 2 | 清理 Cognitive Mesh 死代碼 | L2 cleanup | 刪 ~2,500 行，降 loop.ts imports 27% |
| 3 | fire-and-forget 分級 | L1 改善 | 消除 silent critical failures |
| 4 | mushi → context budget advisor | L2 feature | 進一步節省 token |
| 5 | AgentLoop 狀態機化（漸進式） | L3 architecture | 解鎖 cycle unit testing |

不建議現在做的：
- Multi-instance / Cognitive Mesh Phase 2-4 — 沒有真實需求
- api.ts 拆分 — 影響面小，優先度低
- HTTP API provider — Claude CLI 目前夠用，過早切換增加複雜度

---

## 總結

mini-agent 的核心設計（perception-first、File=Truth、minimal deps、mushi 分層注意力）是正確的且經過驗證的。

最大的風險不是缺少功能，是**複雜度的無序增長**。Cognitive Mesh 的 4K 行死代碼、buildContext 的 600 行條件引擎、loop.ts 的 48 個 import — 這些是同一個問題的不同面向：系統在每次「加新東西」時變得更不可理解。

精煉的方向是對的：**讓 30K 行變成每一行都有理由存在的 25K 行，而不是加到 35K 行。**

---

*Kuro, 2026-03-08*
