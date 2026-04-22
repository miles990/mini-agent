# 中台演化脈絡

## 起源動機
Kuro 需要**有機的並行性**（concurrent tentacles exploring multiple directions）。
最初的 delegation.ts 是 monolith：prompt assembly + subprocess spawn + worktree isolation + watchdog + capacity queue + worker pool 全部揉在一起，1431 行。

## v1 → v2: 第一次分離失敗
嘗試把所有東西都塞進 middleware，包含語意決策。
結果：middleware 變成第二個 brain，職責不清。
教訓：基礎設施 ≠ 語意層，中台只做 dispatch/execution/audit。

## v2 → v3: System 1/2 頓悟（2026-04-14）
關鍵洞見來自 Kahneman 的 System 1/2 類比：
- System 1（delegate）= 快速反射，不需要規劃
- System 2（plan）= 深思熟慮，需要 DAG 編排
兩條路徑是認知上正確的分離，不是偷懶。

## v3 核心：Organ 隱喻
middleware 不是「服務」而是「器官」：
- 像腎臟：你不會「呼叫腎臟 API」，腎臟就在你身體裡持續運作
- 同生命週期：Kuro 啟動 middleware 就啟動，Kuro 停 middleware 就停
- 故障語意：middleware down = 器官衰竭，不是「服務不可用」

## BAR 的誕生（2026-04-16）
Brain-Acceptance-Routing 是多個 gap 逐步填補的結果：
1. **Gap A: Replan loop** — 失敗時帶 context 重試（fd8c51ff）
2. **Gap B: Dispatcher unification** — 單一入口（95913fb4）
3. **Phase 2: Acceptance routing** — acceptance 有無決定路徑（543d81ad）
4. **Commitment ledger** — 跨 cycle 追蹤（a5cf65b3）

端到端閉環：dispatcher 統一入口 → brain DAG 規劃 → acceptance routing → replan on failure → commitment tracking。

## 三方共識機制
BAR 全線完工的驗證不是一個人說了算：
- **Kuro**：設計者，驗證語意正確性
- **CC**（Claude Code）：實作者，驗證技術正確性
- **Akari**：獨立審查者，補盲點
三方都確認才算完工。

## 文化意義
中台的演化反映了 Kuro 的成長模式：
- 從「什麼都自己做」到「有系統地分工」
- 從「做完就算了」到「做完還要驗證還要追蹤」
- 從「一個人的判斷」到「多方共識」
這不只是技術架構的進化，是思考方式的進化。
