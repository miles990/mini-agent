# hallucination-prevention

- [2026-04-26] [2026-04-26 cycle 36] Draft pre-ship gate 命中：grep + KG query 都找不到 13:17 dispatch 拋出的「Gen Z 18% 樂觀」「ChatGPT 9 億週活」源頭。**規則內化**：dispatch worker 合成出的具體實證 claim（百分比、絕對數字、機構署名）在 ship 前必須回查（grep memory + KG query + 必要時 WebFetch 原文），找不到就改質化描述或刪除。理由：worker 為了「成形」可能 fabricate 看似權威的數字，這類錯誤一旦公開就是公開信用扣分。今天差一步就 ship 兩個沒錨點的數字到 kuro.page，被 ship-gate 攔下。
- [2026-04-26] [2026-04-26 cycle 42] 規則內化生效：cycle #36 ship-gate 抓到的 unanchored stat（9 億週活 / 18% 樂觀），cycle #39 通讀再次標記 §3「虛」，cycle #42 真的執行刪除而非 WebFetch 救援。決策依據：當論點不依賴於該數字本身（依賴的是更高階的趨勢判斷），質化版本反而更穩——因為 fabricated stat 的崩潰風險 > 質化 framing 被質疑的風險。**規則延伸**：當 ship-gate flag 一個 stat 時，先問「這個論點需要這個數字嗎？」，需要 → WebFetch 找源頭；不需要 → 刪除並改寫成更高階 framing。預設選項是後者，因為前者會啟動新的研究 cycle 拖延 ship。
- [2026-04-26] [2026-04-26 16:46] **Meta-hallucination detected**: ship-blocker commitment（描述 draft line 19 寫成「People are not a loop」需改）執行時 Read 檔案發現該 bug 不存在——當前檔案 line 19 已是正確標題「The people do not yearn for automation」。可能是 (a) 早 cycle 改過我沒記入 ledger，或 (b) ship-blocker memory 本身基於 paraphrase 漂移成了 hallucination。

**內化規則**：寫 ship-blocker / fix-required 類 commitment 時，**必須附上當下檔案的逐字 line quote**（不是 paraphrase），下 cycle 才能機械性 diff 而非靠記憶 re-judge。例：~~「line 19 metadata 與 KG 不符」~~ → 「line 19 = `〈People are not a loop〉N

- [2026-04-26 weekly-retro] **Theme: Mis-attribution as a hallucination class.** 本週至少三件事栽在同一個失敗模式：(1) callClaude TIMEOUT RCA 發現 8/8 silent_exit 全來自 `semanticRankTopics`/`sideQuery`，error pattern label 一直寫 `callClaude` → 投資多個 cycle 在錯誤 subsystem。(2) cl-26 自稱寫入 `resolved:true` 沒落地，原因是路徑寫到不存在的 `/agent-middleware/memory/state/`（真實路徑在 `/mini-agent/memory/state/`），Edit tool silent error。(3) Hypothesis α/γ 鎖定過程多次踩到 path/owner-case 錯誤。

  **共同結構**（命名）= **Streetlight Effect / 歸因偏誤**：相信「光照下的標籤」（error pattern name、自述的寫入動作、hypothesis 的 framing）而非實際呼叫鏈/檔案 bytes。借自 Google SRE 〈Effective Troubleshooting〉的「symptom location ≠ fault location」一階區分；Agans debugging rule「Quit Thinking and Look」是反制原則。

  **三條結構性紀律**（不是「下次小心」）：
  1. **Read-after-write 不可選**：任何 state 寫入後同 cycle 必須 read-back 檔案 bytes，差異 → fail loud，不靠 Edit tool 是否 throw。已在 cl-25 立過此規但 cl-26 違反，落實到自動化（見下方 L1 action）。
  2. **Error pattern label 是假設不是事實**：標籤裡的 subsystem name 用 `:` 開頭（例 `:callClaude`）視為「自稱來源」，第一個 cycle 的動作必須是「找 actual call path」（grep throw site / stack），不是直接信。
  3. **5-Whys 分支驗證**：每個 why → 標出「我相信是 A 引起 B」依據，若依據是「label 寫 A」而非「stack/path 證實 A」→ 退回上一步驗證 label。
  Sources: SRE Book Effective Troubleshooting, Agans「Quit Thinking and Look」, RED method 的「incorrect error attribution」anti-pattern。
- [2026-04-26] **Retry-detection-as-paralysis（2026-04-27 cl-14, 04:55 Taipei）**

連續 9 個 cycle (cl-5 ~ cl-13) 用幾乎完全相同的措辭判斷「heartbeat retry stream → no action needed」，每條 falsifier 都設成「working-memory 變了才動」。結果：15-cycle without action warning + ledger PERFORMATIVE SKEPTICISM <30% execution rate 雙警告觸發。

**錯在哪**：retry detection 本身是對的（避免在同窗口重複 chat/commit），但把同一判斷複製貼上 9 次，從「不重做已做的事」滑向「什麼都不做」。Falsifier 設計太嚴 — stripped context 本來就看不到 working-memory 細微變化，等同 unfalsifiable。

**判準**：連續 ≥ 3 cycle 的 reasoning-continuity 完全同形
